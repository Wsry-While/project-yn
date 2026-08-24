/**
 * 从第三方导出的 Excel 批量导入「项目外出」历史数据。
 *
 * 数据特征（assets/项目外出申请3.xlsx）：
 * - 1 行表头 + 451 行数据 × 41 列；data_id 为 64 位 hex，作为 external_id 幂等键。
 * - 重名列「外出支持类型」出现两次（列 4 是下拉值，列 16 是"其他"补充文本），
 *   因此本脚本统一按列位置（0-based 索引）取值，不按列名取值。
 * - 「是否完成」是六态文本（是/否/临时取消/已协调其他人员处理/已打回/空），
 *   仅"是"映射 is_completed=true，其余 false，原文落到 raw_meta.completion_status_raw。
 * - 「审批状态」中文枚举映射到 approval_status，新增 revoked=已撤销。
 * - 「具体事宜」是重度污染的 richtext，经 sanitizeRichText 剥除内联样式/危险标签。
 * - 人员只有中文姓名（无 puid），走 TeamMemberService.upsert 按 name 匹配/建档。
 *
 * 复用实时推送同一条 TripService.upsertFromExternal 管道，保证学校自动建档、
 * 字典自学习、幂等写入与软删除口径一致。
 *
 * 用法：
 *   pnpm tsx scripts/import-trips-from-xlsx.ts <file.xlsx> [--dry-run] [--limit=N] [--start=N]
 *
 * 示例：
 *   pnpm tsx scripts/import-trips-from-xlsx.ts assets/项目外出申请3.xlsx --dry-run
 *   pnpm tsx scripts/import-trips-from-xlsx.ts assets/项目外出申请3.xlsx --dry-run --limit=20
 *   pnpm tsx scripts/import-trips-from-xlsx.ts assets/项目外出申请3.xlsx
 */
import { TripService, type TripExternalInput } from '@/lib/domain/trip-service';
import { ReferenceResolver } from '@/lib/domain/reference-resolver';
import { TeamMemberService } from '@/lib/domain/team-member-service';
import { DictService } from '@/lib/domain/dict-service';
import { sanitizeRichText } from '@/lib/domain/sanitize';
import type { TripApprovalStatus, TripContact } from '@/lib/domain/types';
import {
  parseImportArgs,
  runXlsxImport,
  type UpsertOutcome,
  type XlsxImportContext,
  type XlsxSheetImporter,
} from './lib/xlsx-importer';

const SOURCE = 'chaoxing';

/** 列位置（0-based）。表头里「外出支持类型」重名（列 4 与列 16），故按索引取。 */
const COL = {
  dataId: 0,
  year: 1,
  school: 2,
  salesManager: 3,
  supportType: 4,
  tripDate: 5,
  weekday: 6,
  products: 7,
  detail: 8,
  projectManager: 9,
  isCompleted: 10,
  reportConsistent: 11,
  industry: 12,
  startAt: 13,
  endAt: 14,
  serialNo: 15,
  supportTypeOther: 16,
  serviceSummary: 17,
  salesLate: 18,
  salesScore: 19,
  serviceLate: 20,
  overallScore: 21,
  overallFeedback: 22,
  // 23~40 为审批流元数据，全量落到 raw_meta
  currentNode: 23,
  initiator: 24,
  approvalFinishedAt: 25,
  approvers: 26,
  initiatedAt: 27,
  currentApprover: 28,
  actualApprover: 29,
  approvalRecord: 30,
  ccRecord: 31,
  uid: 32,
  ccList: 33,
  approvalStatus: 34,
  department: 35,
  approvalComment: 36,
  phone: 37,
  nodeStatus: 38,
  employeeNo: 39,
  sourceUpdatedAt: 40,
} as const;

const APPROVAL_MAP: Record<string, TripApprovalStatus> = {
  已通过: 'approved',
  已拒绝: 'rejected',
  已撤销: 'revoked',
  待处理: 'pending',
};

function asString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function asInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asScore(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 日期：支持 "YYYY-MM-DD"、"YYYY/MM/DD"、Excel 序列号等，统一截成 YYYY-MM-DD。 */
function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  // 纯数字（Excel 序列号）
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    // Excel 序列号起点 1899-12-30
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s.slice(0, 10);
}

/** "是"→true，"否"→false，"不好说"/空→null。 */
function asTribool(v: unknown): boolean | null {
  const s = asString(v);
  if (s === '是') return true;
  if (s === '否') return false;
  return null;
}

function asBool(v: unknown): boolean {
  return asString(v) === '是';
}

function splitProducts(v: unknown): string[] {
  return asString(v)
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeContact(name: unknown): TripContact | null {
  const n = asString(name);
  if (!n) return null;
  return { name: n, puid: null, enc: null, uidEnc: null };
}

interface TripImportRecord {
  input: TripExternalInput;
}

const importer: XlsxSheetImporter<TripImportRecord> = {
  name: '项目外出',
  sheet: '项目外出申请3',
  headerRow: 0,
  requiredColumns: ['data_id', '学校', '外出日期'],

  mapRow(row): TripImportRecord | null {
    const dataId = asString(row[COL.dataId]);
    const schoolName = asString(row[COL.school]);
    const tripDate = asDate(row[COL.tripDate]);

    // 下拉值（列 4）为空但补充文本（列 16）有值时，归一为"其他"
    let supportType = asString(row[COL.supportType]);
    const supportTypeOther = asString(row[COL.supportTypeOther]);
    if (!supportType && supportTypeOther) supportType = '其他';

    // 关键字段缺失则跳过（不计失败）
    if (!dataId || !schoolName || !tripDate || !supportType) {
      return null;
    }

    const completionRaw = asString(row[COL.isCompleted]);
    const isCompleted = completionRaw === '是';

    const approvalRaw = asString(row[COL.approvalStatus]);
    const approvalStatus = APPROVAL_MAP[approvalRaw] ?? 'pending';

    const detailHtml = asString(row[COL.detail]);
    const detail = sanitizeRichText({ html: detailHtml });
    const serviceSummary = sanitizeRichText({ html: asString(row[COL.serviceSummary]) });
    const overallFeedback = sanitizeRichText({ html: asString(row[COL.overallFeedback]) });

    const rawMeta = {
      completion_status_raw: completionRaw || null,
      approval_status_raw: approvalRaw || null,
      current_node: asString(row[COL.currentNode]) || null,
      initiator: asString(row[COL.initiator]) || null,
      approval_finished_at: asString(row[COL.approvalFinishedAt]) || null,
      approvers: asString(row[COL.approvers]) || null,
      initiated_at: asString(row[COL.initiatedAt]) || null,
      current_approver: asString(row[COL.currentApprover]) || null,
      actual_approver: asString(row[COL.actualApprover]) || null,
      approval_record: asString(row[COL.approvalRecord]) || null,
      cc_record: asString(row[COL.ccRecord]) || null,
      uid: asString(row[COL.uid]) || null,
      cc_list: asString(row[COL.ccList]) || null,
      department: asString(row[COL.department]) || null,
      approval_comment: asString(row[COL.approvalComment]) || null,
      phone: asString(row[COL.phone]) || null,
      node_status: asString(row[COL.nodeStatus]) || null,
      employee_no: asString(row[COL.employeeNo]) || null,
      source_updated_at: asString(row[COL.sourceUpdatedAt]) || null,
      import_source: 'xlsx:项目外出申请3',
    };

    const input: TripExternalInput = {
      externalId: dataId,
      externalSource: SOURCE,
      externalOp: 'data_import',
      serialNo: asString(row[COL.serialNo]) || null,
      year: asInt(row[COL.year]),
      schoolName,
      industry: asString(row[COL.industry]) || null,
      supportType,
      supportTypeOther: supportType === '其他' ? supportTypeOther || null : null,
      products: splitProducts(row[COL.products]),
      detail,
      tripDate,
      startAt: asString(row[COL.startAt]) || null,
      endAt: asString(row[COL.endAt]) || null,
      weekday: asInt(row[COL.weekday]),
      salesManager: makeContact(row[COL.salesManager]),
      projectManager: makeContact(row[COL.projectManager]),
      isCompleted,
      reportConsistent: asTribool(row[COL.reportConsistent]),
      serviceSummary,
      salesLate: asTribool(row[COL.salesLate]),
      salesScore: asScore(row[COL.salesScore]),
      serviceLate: asTribool(row[COL.serviceLate]),
      overallScore: asScore(row[COL.overallScore]),
      overallFeedback,
      approvalStatus,
      rawMeta,
    };

    return { input };
  },

  async upsert(record: TripImportRecord, ctx: XlsxImportContext): Promise<UpsertOutcome> {
    const { input } = record;
    const resolver = new ReferenceResolver(ctx.db);
    const memberService = new TeamMemberService(ctx.db);
    const dictService = new DictService(ctx.db);

    const [schoolId, salesMember, pmMember, supportTypeNorm, industryNorm, productsNorm] = await Promise.all([
      resolver.resolveSchool(input.schoolName),
      input.salesManager?.name
        ? memberService.upsert({
            puid: input.salesManager.puid,
            name: input.salesManager.name,
            syncedFrom: SOURCE,
            role: 'sales',
            contactRaw: input.salesManager as unknown as Record<string, unknown>,
          })
        : Promise.resolve(null),
      input.projectManager?.name
        ? memberService.upsert({
            puid: input.projectManager.puid,
            name: input.projectManager.name,
            syncedFrom: SOURCE,
            role: 'pm',
            contactRaw: input.projectManager as unknown as Record<string, unknown>,
          })
        : Promise.resolve(null),
      dictService.normalize('trip_support_type', input.supportType, { source: 'xlsx_import' }),
      dictService.normalize('trip_industry', input.industry, { source: 'xlsx_import' }),
      dictService.normalizeMany('trip_product', input.products, { source: 'xlsx_import' }),
    ]);

    const service = new TripService(ctx.db);
    const { created } = await service.upsertFromExternal(
      {
        ...input,
        salesManagerId: salesMember?.id ?? null,
        projectManagerId: pmMember?.id ?? null,
        supportTypeNorm,
        industryNorm,
        productsNorm,
      },
      schoolId,
    );
    return created ? 'created' : 'updated';
  },
};

async function main(): Promise<void> {
  const { file, options } = parseImportArgs(process.argv);
  if (!file) {
    console.error('用法：pnpm tsx scripts/import-trips-from-xlsx.ts <file.xlsx> [--dry-run] [--limit=N] [--start=N]');
    process.exit(1);
  }
  await runXlsxImport(file, importer, options);
}

main().catch((err) => {
  console.error('导入失败：', err);
  process.exit(1);
});
