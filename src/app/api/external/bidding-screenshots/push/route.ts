import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';
import { SchoolService } from '@/lib/domain/school-service';
import {
  normalizeFile,
  normalizeFiles,
  pickString,
  toBoolean,
  toDateString,
  toNumber,
} from '@/lib/domain/bidding-normalize';

const SOURCE = 'bidding-screenshot';

type PushItem = Record<string, unknown>;
type ParseResult =
  | { items: PushItem[]; topLevelMeta: PushItem }
  | { error: string };

function tryParseJson(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;
  if (!(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 第三方实际推送可能使用：
 *  - application/json
 *  - multipart/form-data（业务字段在 form 字段，或 data 字段是 JSON 字符串数组 —— 与超星一致）
 *  - application/x-www-form-urlencoded
 *  - text/plain（body 直接是 JSON 字符串）
 * 这里统一收敛成 items 数组 + 顶层 meta，和 chaoxing 推送保持一致的容错。
 */
async function parseRequestBody(request: NextRequest): Promise<ParseResult> {
  const contentType = request.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const isFormUrlEncoded = contentType.includes('application/x-www-form-urlencoded');
  const isMultipart = contentType.includes('multipart/form-data');
  const isText = contentType.startsWith('text/');

  const topLevelMeta: PushItem = {};

  if (isJson || (!isFormUrlEncoded && !isMultipart && !isText)) {
    // 1) JSON 或 Content-Type 缺失时，先按 JSON 尝试
    const text = await request.text();
    const parsed = tryParseJson(text);
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed)) return { items: parsed as PushItem[], topLevelMeta };
      return { items: [parsed as PushItem], topLevelMeta };
    }
    // JSON 解析失败：若看起来像 form 编码，继续走 form 解析
    if (!text.includes('=') || !isFormUrlEncoded) {
      return { error: '请求体必须是 JSON 对象/数组，或 form-data 中携带 data JSON 字符串' };
    }
  }

  if (isMultipart) {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (key === 'data') continue;
      if (typeof value === 'string') {
        topLevelMeta[key] = value;
      } else if (value && typeof value === 'object' && 'name' in value) {
        // File 对象，跳过（招投标接口文件字段在 JSON 里是 {name,url}，不需要上传二进制）
        topLevelMeta[key] = { name: (value as File).name, size: (value as File).size };
      }
    }
    const rawData = form.get('data');
    if (typeof rawData === 'string' && rawData.trim()) {
      const parsed = tryParseJson(rawData);
      if (Array.isArray(parsed)) return { items: parsed as PushItem[], topLevelMeta };
      if (parsed && typeof parsed === 'object') return { items: [parsed as PushItem], topLevelMeta };
    }
    // 没有 data 字段：把整个 form 字段当作一条业务记录
    const record: PushItem = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') record[key] = value;
    }
    if (Object.keys(record).length > 0) return { items: [record], topLevelMeta };
    return { error: 'form-data 缺少 data JSON 字符串或业务字段' };
  }

  if (isFormUrlEncoded) {
    const form = await request.formData();
    const record: PushItem = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') record[key] = value;
    }
    const rawData = record.data;
    if (typeof rawData === 'string' && rawData.trim()) {
      const parsed = tryParseJson(rawData);
      if (Array.isArray(parsed)) return { items: parsed as PushItem[], topLevelMeta: record };
      if (parsed && typeof parsed === 'object') return { items: [parsed as PushItem], topLevelMeta: record };
    }
    if (Object.keys(record).length > 0) return { items: [record], topLevelMeta: record };
    return { error: 'urlencoded 请求缺少业务字段' };
  }

  // text/plain 兜底：body 即 JSON 字符串
  const text = await request.text();
  const parsed = tryParseJson(text);
  if (Array.isArray(parsed)) return { items: parsed as PushItem[], topLevelMeta };
  if (parsed && typeof parsed === 'object') return { items: [parsed as PushItem], topLevelMeta };
  return { error: 'text/plain 请求体必须是 JSON 字符串' };
}

function parseBody(body: PushItem, topLevel: PushItem = {}) {
  const read = (...keys: string[]) => pickString(body, keys) || pickString(topLevel, keys);
  const salesManager =
    read('salesManager', 'sales_manager', '销售经理') ||
    read('salesManagerName', 'salesOwner');
  const projectName = read('projectName', 'project_name', '项目名称');
  const projectSchool = read('projectSchool', 'project_school', '项目所属学校', '学校', 'schoolName');
  const submissionDate = toDateString(
    body.submissionDate ?? body.submission_date ?? body['提交日期'] ??
    topLevel.submissionDate ?? topLevel.submission_date ?? topLevel['提交日期'],
  );

  return {
    salesManager,
    projectName,
    projectSchool,
    submissionDate,
    projectSecondaryUnit: read('projectSecondaryUnit', 'project_secondary_unit', '项目所属二级单位', '二级单位'),
    isCompanyParameter: toBoolean(
      body.isCompanyParameter ?? body.is_company_parameter ?? body['是否公司参数'] ??
      topLevel.isCompanyParameter ?? topLevel.is_company_parameter ?? topLevel['是否公司参数'],
    ) ?? false,
    dueDeliveryDate: toDateString(
      body.dueDeliveryDate ?? body.due_delivery_date ?? body['需交付日期'] ??
      topLevel.dueDeliveryDate ?? topLevel.due_delivery_date ?? topLevel['需交付日期'],
    ),
    reservedDays: toNumber(
      body.reservedDays ?? body.reserved_days ?? body['预留天数'] ??
      topLevel.reservedDays ?? topLevel.reserved_days ?? topLevel['预留天数'],
    ),
    projectBiddingFile: normalizeFile(body.projectBiddingFile ?? body.project_bidding_file ?? body['项目招标文件'] ?? topLevel.projectBiddingFile ?? topLevel.project_bidding_file),
    projectCategory: read('projectCategory', 'project_category', '项目所属类别', '类别'),
    screenshotRequirement: read('screenshotRequirement', 'screenshot_requirement', '截图需求说明', '截图需求'),
    assignedProjectManager: read('assignedProjectManager', 'assigned_project_manager', '指派项目经理', '项目经理'),
    completionStatus: read('completionStatus', 'completion_status', '完成情况'),
    deliveryDocument: normalizeFile(body.deliveryDocument ?? body.delivery_document ?? body['交付文档上传'] ?? body['交付文档'] ?? topLevel.deliveryDocument ?? topLevel.delivery_document),
    deliveryRemark: read('deliveryRemark', 'delivery_remark', '交付信息备注', '交付备注'),
    isMeetScreenshotRequirement: toBoolean(
      body.isMeetScreenshotRequirement ?? body.is_meet_screenshot_requirement ?? body['是否按截图需求完成'] ?? body['需求达成'] ??
      topLevel.isMeetScreenshotRequirement ?? topLevel.is_meet_screenshot_requirement ?? topLevel['需求达成'],
    ),
    salesFeedback: read('salesFeedback', 'sales_feedback', '销售反馈意见', '销售反馈'),
    attachments: normalizeFiles(body.attachments ?? body['附件材料'] ?? body['附件'] ?? topLevel.attachments),
    rectificationFeedback: read('rectificationFeedback', 'rectification_feedback', '整改情况反馈', '整改反馈'),
    rectifiedDocument: normalizeFile(body.rectifiedDocument ?? body.rectified_document ?? body['整改后文档'] ?? topLevel.rectifiedDocument ?? topLevel.rectified_document),
    externalId: read('externalId', 'external_id', 'id', 'indexID', 'indexId', 'serialNo'),
    externalSerial: read('externalSerial', 'external_serial', 'serialNo', '编号'),
    externalOperator: read('operator', 'uid', 'submitter', '提交人'),
  };
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
    // 与项目外出（/api/external/chaoxing/push）保持一致：第三方推送按无鉴权设计，
    // 入口仅通过公网 HTTPS + 业务白名单（external_id 幂等 + source 固定）控制。
    const parsed = await parseRequestBody(request);
    if ('error' in parsed) return fail('invalid_param', parsed.error, 400);

    const { items, topLevelMeta } = parsed;
    if (items.length === 0 || items.length > 100) return fail('invalid_param', '单次推送 1–100 条', 400);

    const db = getAdminSupabase();
    const service = new BiddingScreenshotService(db);
    const schools = new SchoolService(db);
    const results: Array<{ externalId: string; result: 'created' | 'updated' | 'deleted' | 'recovered' | 'skipped'; localId?: string }> = [];

    const topLevelOp = typeof topLevelMeta.op === 'string' ? String(topLevelMeta.op) : undefined;

    for (const item of items) {
      const op =
        topLevelOp ||
        (typeof item.op === 'string' ? String(item.op)
        : typeof item.externalOp === 'string' ? String(item.externalOp)
        : typeof topLevelMeta.externalOp === 'string' ? String(topLevelMeta.externalOp)
        : 'upsert');

      // 顶层 op 不随单条 item 覆盖
      const effectiveOp = topLevelOp ?? op;
      const rawRecords = Array.isArray(item.records)
        ? item.records.filter((r): r is PushItem => !!r && typeof r === 'object')
        : [item];

      for (const record of rawRecords) {
        const mapped = parseBody(record, { ...topLevelMeta, ...item });
        const externalId = mapped.externalId;
        if (!externalId) {
          results.push({ externalId: '', result: 'skipped' });
          continue;
        }

        if (effectiveOp === 'data_remove' || effectiveOp === 'remove' || effectiveOp === 'delete') {
          const row = await service.softDeleteByExternal(SOURCE, externalId);
          results.push({ externalId, result: row ? 'deleted' : 'skipped', localId: row?.id });
          continue;
        }
        if (effectiveOp === 'data_recover' || effectiveOp === 'recover') {
          const row = await service.recoverByExternal(SOURCE, externalId);
          results.push({ externalId, result: row ? 'recovered' : 'skipped', localId: row?.id });
          continue;
        }

        if (!mapped.salesManager || !mapped.projectName || !mapped.projectSchool || !mapped.submissionDate) {
          results.push({ externalId, result: 'skipped' });
          continue;
        }

        // 经过上面的必填校验后收窄为非空字段，避免把 string | null 传给 BiddingScreenshotInput
        const validated = {
          salesManager: mapped.salesManager,
          projectName: mapped.projectName,
          projectSchool: mapped.projectSchool,
          submissionDate: mapped.submissionDate,
          projectSecondaryUnit: mapped.projectSecondaryUnit,
          isCompanyParameter: mapped.isCompanyParameter,
          dueDeliveryDate: mapped.dueDeliveryDate,
          reservedDays: mapped.reservedDays,
          projectBiddingFile: mapped.projectBiddingFile,
          projectCategory: mapped.projectCategory,
          screenshotRequirement: mapped.screenshotRequirement,
          assignedProjectManager: mapped.assignedProjectManager,
          completionStatus: mapped.completionStatus,
          deliveryDocument: mapped.deliveryDocument,
          deliveryRemark: mapped.deliveryRemark,
          isMeetScreenshotRequirement: mapped.isMeetScreenshotRequirement,
          salesFeedback: mapped.salesFeedback,
          attachments: mapped.attachments,
          rectificationFeedback: mapped.rectificationFeedback,
          rectifiedDocument: mapped.rectifiedDocument,
        };

        const schoolId = await schools.findOrCreateSchoolByName(validated.projectSchool);
        const { row, created } = await service.upsertFromExternal(
          {
            ...validated,
            externalId,
            externalSource: SOURCE,
            externalOp: effectiveOp,
            externalSerial: mapped.externalSerial,
            externalOperator: mapped.externalOperator,
            rawPayload: record,
            rawMeta: {
              ...topLevelMeta,
              ip: request.headers.get('x-forwarded-for'),
              receivedAt: new Date().toISOString(),
            },
          },
          schoolId,
        );
        results.push({ externalId, result: created ? 'created' : 'updated', localId: row.id });
      }
    }

    return ok({ received: results.length, results });
  });
}
