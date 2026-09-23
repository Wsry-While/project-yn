/**
 * 从超星导出的 Excel 批量导入「招投标截图支持申请」历史数据。
 *
 * 数据特征（assets/招投标截图支持申请表 (2)_*.xlsx）：
 * - 1 行表头 + 46 行数据 × 36 列；data_id 为 64 位 hex，作为 external_id 幂等键。
 * - 文件列（项目招标文件 / 交付文档上传 / 附件材料 / 整改后文档）单元格文本是文件名，
 *   真正的下载地址挂在单元格的 hyperlink 上（多文件时是一个 multiple/download 打包链接）。
 *   xlsx (SheetJS) 默认读不出 hyperlink，因此导入前用 python openpyxl 预扫描生成
 *   /tmp/bidding-hyperlinks.json（key="<excel行号>:<0-based列号>"），本脚本读取并配对。
 * - 「完成情况」= 已完成(27)/空(19)，映射 completion_status。
 * - 「审批状态」(待处理/已通过/已拒绝/已撤销) 不写入 completion_status，全量落 raw_meta。
 * - 「交付信息备注/销售反馈/整改反馈」是带 <p element-id> 的 HTML，sanitize 后取纯文本。
 * - 人员只有中文姓名（无 puid），走 TeamMemberService.upsert 按 name 匹配/建档；
 *   指派项目经理可能是多人（逗号分隔），与实时推送一致用「、」拼接存文本。
 *
 * 复用 BiddingScreenshotService.upsertFromExternal 管道，保证学校自动建档、
 * 幂等写入与软删除口径与实时推送一致。
 *
 * 预扫描 hyperlink（导入前执行一次）：
 *   python3 - <<'PY'
 *   import openpyxl,json
 *   wb=openpyxl.load_workbook('assets/招投标截图支持申请表 (2)_20260824224513692.xlsx',data_only=True)
 *   ws=wb['招投标截图支持申请表']; links={}
 *   for r in range(2,ws.max_row+1):
 *     for col in [11,14,17,18]:
 *       c=ws.cell(row=r,column=col+1)
 *       if c.hyperlink is not None and c.hyperlink.target: links[f'{r}:{col}']=c.hyperlink.target
 *   json.dump(links,open('/tmp/bidding-hyperlinks.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
 *   PY
 *
 * 用法：
 *   pnpm tsx scripts/import-bidding-screenshots-from-xlsx.ts <file.xlsx> [--dry-run] [--limit=N] [--start=N]
 */
import * as fs from 'node:fs';
import { BiddingScreenshotService, type BiddingScreenshotInput } from '@/lib/domain/bidding-screenshot-service';
import { ReferenceResolver } from '@/lib/domain/reference-resolver';
import { TeamMemberService } from '@/lib/domain/team-member-service';
import { DictService } from '@/lib/domain/dict-service';
import { sanitizeRichText } from '@/lib/domain/sanitize';
import type { BiddingFileRef } from '@/lib/domain/types';
import {
  parseImportArgs,
  runXlsxImport,
  type UpsertOutcome,
  type XlsxImportContext,
  type XlsxSheetImporter,
} from './lib/xlsx-importer';

const SOURCE = 'chaoxing';
const HYPERLINKS_FILE = '/tmp/bidding-hyperlinks.json';

/** 列位置（0-based）。 */
const COL = {
  dataId: 0,
  projectName: 1,
  school: 2,
  secondaryUnit: 3,
  salesManager: 4,
  submissionDate: 5,
  dueDeliveryDate: 6,
  reservedDays: 7,
  isCompanyParameter: 8,
  assignedPm: 9,
  completionStatus: 10,
  deliveryDocument: 11,
  deliveryRemark: 12,
  salesFeedback: 13,
  attachments: 14,
  isMeetRequirement: 15,
  rectificationFeedback: 16,
  rectifiedDocument: 17,
  projectBiddingFile: 18,
  projectCategory: 19,
  screenshotRequirement: 20,
  // 21~35 审批流元数据，全量落 raw_meta
  currentNode: 21,
  initiator: 22,
  approvalFinishedAt: 23,
  approvers: 24,
  initiatedAt: 25,
  currentApprover: 26,
  actualApprover: 27,
  uid: 28,
  ccList: 29,
  approvalStatus: 30,
  department: 31,
  phone: 32,
  nodeStatus: 33,
  employeeNo: 34,
  sourceUpdatedAt: 35,
} as const;

function asString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function asInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function asBool(v: unknown): boolean {
  return asString(v) === '是';
}

function htmlToText(v: unknown): string | null {
  const html = asString(v);
  if (!html) return null;
  const cleaned = sanitizeRichText({ html });
  return cleaned.text || null;
}

/**
 * 文件列：单元格文本是文件名（可能多文件以换行分隔），下载地址取自 hyperlink 映射。
 * excelRow 是 openpyxl 的 1-based 行号（表头第1行，数据从2开始）。
 */
function makeFileRefs(
  row: unknown[],
  col: number,
  excelRow: number,
  hyperlinks: Record<string, string>,
): BiddingFileRef[] {
  const text = asString(row[col]);
  if (!text) return [];
  const names = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return [];
  const url = hyperlinks[`${excelRow}:${col}`] ?? null;
  // 多文件名但只有一个打包下载地址时，每个文件共享该 URL。
  return names.map((name) => ({
    name,
    url,
    objectId: null,
    storageStatus: url ? 'direct' : 'pending',
  }));
}

/** 类别列形如「平台类/泛雅智慧课程平台」「课程类」，整体作为一个分类标签入库。 */
function splitCategory(v: unknown): string[] {
  const s = asString(v);
  return s ? [s] : [];
}

/** 多项目经理姓名：逗号/顿号分隔后用「、」拼接（与超星实时推送口径一致）。 */
function joinManagers(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const names = s
    .split(/[,，、]/)
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length ? names.join('、') : null;
}

interface BiddingImportRecord {
  input: BiddingScreenshotInput;
  schoolName: string;
  salesName: string;
  pmName: string | null;
  category: string[];
}

function loadHyperlinks(): Record<string, string> {
  try {
    if (!fs.existsSync(HYPERLINKS_FILE)) return {};
    return JSON.parse(fs.readFileSync(HYPERLINKS_FILE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

const importer: XlsxSheetImporter<BiddingImportRecord> = {
  name: '招投标截图',
  sheet: '招投标截图支持申请表',
  headerRow: 0,
  requiredColumns: ['data_id', '项目名称', '项目所属学校', '提交日期'],

  mapRow(row, rowIndex): BiddingImportRecord | null {
    const dataId = asString(row[COL.dataId]);
    const projectName = asString(row[COL.projectName]);
    const schoolName = asString(row[COL.school]);
    const submissionDate = asDate(row[COL.submissionDate]);

    if (!dataId || !projectName || !schoolName || !submissionDate) {
      return null;
    }

    const hyperlinks = loadHyperlinks();
    const excelRow = rowIndex + 2; // 0-based 数据行 → 1-based Excel 行（表头占第1行）

    const biddingFiles = makeFileRefs(row, COL.projectBiddingFile, excelRow, hyperlinks);
    const deliveryFiles = makeFileRefs(row, COL.deliveryDocument, excelRow, hyperlinks);
    const attachmentFiles = makeFileRefs(row, COL.attachments, excelRow, hyperlinks);
    const rectifiedFiles = makeFileRefs(row, COL.rectifiedDocument, excelRow, hyperlinks);

    const completionRaw = asString(row[COL.completionStatus]);
    const category = splitCategory(row[COL.projectCategory]);
    const pmName = joinManagers(row[COL.assignedPm]);
    const salesName = asString(row[COL.salesManager]);

    const rawMeta = {
      completion_status_raw: completionRaw || null,
      approval_status: asString(row[COL.approvalStatus]) || null,
      current_node: asString(row[COL.currentNode]) || null,
      initiator: asString(row[COL.initiator]) || null,
      approval_finished_at: asString(row[COL.approvalFinishedAt]) || null,
      approvers: asString(row[COL.approvers]) || null,
      initiated_at: asString(row[COL.initiatedAt]) || null,
      current_approver: asString(row[COL.currentApprover]) || null,
      actual_approver: asString(row[COL.actualApprover]) || null,
      uid: asString(row[COL.uid]) || null,
      cc_list: asString(row[COL.ccList]) || null,
      department: asString(row[COL.department]) || null,
      phone: asString(row[COL.phone]) || null,
      node_status: asString(row[COL.nodeStatus]) || null,
      employee_no: asString(row[COL.employeeNo]) || null,
      source_updated_at: asString(row[COL.sourceUpdatedAt]) || null,
      import_source: 'xlsx:招投标截图支持申请表',
    };

    const input: BiddingScreenshotInput = {
      externalId: dataId,
      externalSource: SOURCE,
      externalOp: 'data_import',
      salesManager: salesName,
      projectName,
      projectSchool: schoolName,
      projectSecondaryUnit: asString(row[COL.secondaryUnit]) || null,
      isCompanyParameter: asBool(row[COL.isCompanyParameter]),
      submissionDate,
      dueDeliveryDate: asDate(row[COL.dueDeliveryDate]),
      reservedDays: asInt(row[COL.reservedDays]),
      projectBiddingFile: biddingFiles,
      projectCategory: category,
      screenshotRequirement: asString(row[COL.screenshotRequirement]) || null,
      assignedProjectManager: pmName,
      completionStatus: completionRaw || null,
      deliveryDocument: deliveryFiles,
      deliveryRemark: htmlToText(row[COL.deliveryRemark]),
      isMeetScreenshotRequirement: asBool(row[COL.isMeetRequirement]),
      salesFeedback: htmlToText(row[COL.salesFeedback]),
      attachments: attachmentFiles,
      rectificationFeedback: htmlToText(row[COL.rectificationFeedback]),
      rectifiedDocument: rectifiedFiles,
      rawMeta,
    };

    return { input, schoolName, salesName, pmName, category };
  },

  async upsert(record: BiddingImportRecord, ctx: XlsxImportContext): Promise<UpsertOutcome> {
    const { input, schoolName, salesName, pmName, category } = record;
    const resolver = new ReferenceResolver(ctx.db);
    const memberService = new TeamMemberService(ctx.db);
    const dictService = new DictService(ctx.db);

    const [schoolId, salesMember, pmMember, categoryNorm] = await Promise.all([
      resolver.resolveSchool(schoolName),
      salesName
        ? memberService.upsert({
            puid: null,
            name: salesName,
            syncedFrom: SOURCE,
            role: 'sales',
            contactRaw: { name: salesName, source: 'xlsx_import' },
          })
        : Promise.resolve(null),
      pmName
        ? memberService.upsert({
            puid: null,
            name: pmName.split('、')[0],
            syncedFrom: SOURCE,
            role: 'pm',
            contactRaw: { name: pmName, source: 'xlsx_import', multi: true },
          })
        : Promise.resolve(null),
      dictService.normalize('bidding_category', category[0] ?? '', { source: 'xlsx_import' }),
    ]);

    const service = new BiddingScreenshotService(ctx.db);
    const { created } = await service.upsertFromExternal(
      {
        ...input,
        salesManagerId: salesMember?.id ?? null,
        assignedPmId: pmMember?.id ?? null,
        projectCategoryNorm: categoryNorm ? [categoryNorm] : input.projectCategory,
      },
      schoolId,
    );
    return created ? 'created' : 'updated';
  },
};

async function main(): Promise<void> {
  const { file, options } = parseImportArgs(process.argv);
  if (!file) {
    console.error('用法：pnpm tsx scripts/import-bidding-screenshots-from-xlsx.ts <file.xlsx> [--dry-run] [--limit=N] [--start=N]');
    process.exit(1);
  }
  if (!fs.existsSync(HYPERLINKS_FILE)) {
    console.warn(
      `[warn] 未找到 ${HYPERLINKS_FILE}，文件列将缺少下载链接。请先用 openpyxl 预扫描生成（见脚本头部注释）。`,
    );
  }
  await runXlsxImport(file, importer, options);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
