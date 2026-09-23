import { NextRequest, after } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';
import { processBiddingAttachments } from '@/lib/domain/bidding-attachment-service';
import { TeamMemberService } from '@/lib/domain/team-member-service';
import { DictService } from '@/lib/domain/dict-service';
import { ReferenceResolver } from '@/lib/domain/reference-resolver';
import {
  normalizeFiles,
  pickContactName,
  pickString,
  pickStrings,
  toBoolean,
  toDateString,
  toNumber,
} from '@/lib/domain/bidding-normalize';
import { flattenChaoxingFormData } from '@/lib/domain/bidding-form-data';
import { queueSyncLog, logPushReceived, logPushAck } from '@/lib/domain/external-sync-log';

const SOURCE = 'bidding-screenshot';
const SYNC_SOURCE = 'bidding-screenshot';
const BIDDING_FORM_ID = '254045';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// data_flow = 第三方整表/分页同步下发，语义等同于 upsert，每条记录都带全量业务字段
const UPSERT_OPS = new Set([
  'data_create',
  'data_edit',
  'data_update',
  'data_flow',
  'upsert',
]);
const REMOVE_OPS = new Set(['data_remove', 'remove', 'delete']);
const RECOVER_OPS = new Set(['data_recover', 'recover']);
const FORM_UPDATE_OPS = new Set(['form_update']);

type PushItem = Record<string, unknown>;
type ParseResult =
  | { items: PushItem[]; topLevelMeta: PushItem }
  | { error: string };

function isPlainObject(value: unknown): value is PushItem {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

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

function stringifyMeta(value: FormDataEntryValue): unknown {
  if (typeof value === 'string') return value;
  return { name: value.name, size: value.size, type: value.type };
}

function flattenForm(form: FormData): PushItem {
  const out: PushItem = {};
  for (const [key, value] of form.entries()) {
    if (key === 'data') continue;
    out[key] = stringifyMeta(value);
  }
  return out;
}

/**
 * 与项目外出 /api/external/chaoxing/push 对齐：
 *  1. 支持 application/json / text/plain(JSON) / multipart/form-data / x-www-form-urlencoded
 *  2. form-data 里 data 字段是 JSON 字符串数组（超星推送的真实结构）
 *  3. records / data / list / items 等常见包装都展开为业务记录
 *  4. 顶层 op/externalId/externalSerial/operator 对每条记录透传
 */
async function parseRequestBody(request: NextRequest): Promise<ParseResult> {
  const contentType = request.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const isFormUrlEncoded = contentType.includes('application/x-www-form-urlencoded');
  const isMultipart = contentType.includes('multipart/form-data');
  const isText = contentType.startsWith('text/');

  if (isJson || isText || (!isFormUrlEncoded && !isMultipart)) {
    const text = await request.text();
    const parsed = tryParseJson(text);
    if (parsed && typeof parsed === 'object') {
      // 超星风格：{formId, indexID, formData:[{alias,compt,values}], ...}
      const envelope = coerceChaoxingEnvelope(parsed);
      if (envelope) return envelope;
      const topLevelMeta: PushItem = {};
      return { items: expandRecords(parsed, topLevelMeta), topLevelMeta };
    }
    if (!isText) {
      // Content-Type 缺失或未知时，继续尝试 form 解析
      if (!text.includes('=')) return { error: '请求体必须是 JSON 对象/数组，或 form-data 中携带 data JSON 字符串' };
    } else {
      return { error: 'text/plain 请求体必须是 JSON 字符串' };
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return { error: '请求体必须是 form-data / urlencoded' };
  const topLevelMeta = flattenForm(form);

  // 1) 超星风格：formData 是 JSON 字符串数组（与文件原文一致）
  const formDataRaw = form.get('formData');
  if (typeof formDataRaw === 'string' && formDataRaw.trim()) {
    const parsedFormData = tryParseJson(formDataRaw);
    if (parsedFormData !== null && typeof parsedFormData === 'object') {
      const envelope = coerceChaoxingEnvelope({ ...topLevelMeta, formData: parsedFormData });
      if (envelope) return envelope;
    }
  }

  // 2) 通用：data 字段为 JSON 对象/数组
  const rawData = form.get('data');
  if (typeof rawData === 'string' && rawData.trim()) {
    const parsed = tryParseJson(rawData);
    if (!parsed || typeof parsed !== 'object') return { error: 'data 字段必须是 JSON 对象或数组' };
    // data 可能是超星单条 {formData:[...]} 包装
    if (isPlainObject(parsed)) {
      const envelope = coerceChaoxingEnvelope({ ...topLevelMeta, ...parsed });
      if (envelope) return envelope;
    }
    return { items: expandRecords(parsed, topLevelMeta), topLevelMeta };
  }

  // 3) form-data 直接摊平业务字段
  const record: PushItem = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') record[key] = value;
  }
  if (Object.keys(record).length === 0) return { error: 'form-data 缺少 formData / data JSON 字符串或业务字段' };
  return { items: expandRecords(record, topLevelMeta), topLevelMeta };
}

/**
 * 把 {records:[...]} / {data:[...]} / {list:[...]} / {items:[...]} 等包装
 * 展开为真正的业务对象数组，同时把顶层 meta 合并到 topLevelMeta。
 */
function expandRecords(input: unknown, topLevelMeta: PushItem): PushItem[] {
  if (Array.isArray(input)) return input.filter(isPlainObject);
  if (!isPlainObject(input)) return [];

  for (const key of ['externalId', 'external_id', 'indexID', 'indexId', 'id',
                     'externalSerial', 'external_serial', 'serialNo',
                     'op', 'externalOp', 'operator', 'uid', 'submitter',
                     'formId', 'formName', 'uuid']) {
    if (input[key] !== undefined) topLevelMeta[key] = input[key];
  }

  for (const key of ['records', 'data', 'list', 'items', 'rows']) {
    const v = input[key];
    if (Array.isArray(v)) return v.filter(isPlainObject);
    if (isPlainObject(v)) return [v];
  }
  return [input];
}

function readField(body: PushItem, topLevel: PushItem, keys: string[]): string | null {
  return pickString(body, keys) || pickString(topLevel, keys);
}

/**
 * 超星招投标截图推送是单条 JSON：顶层 meta + `formData` 字段数组。
 * 这里先把 formData 按 alias/compt 展平到业务 KV，再和顶层 meta 合并后走通用 parseBody。
 */
function coerceChaoxingEnvelope(parsed: unknown): { items: PushItem[]; topLevelMeta: PushItem } | null {
  if (!isPlainObject(parsed)) return null;
  const hasFormData =
    typeof parsed.formData === 'string' ||
    (Array.isArray(parsed.formData) && parsed.formData.length > 0);
  if (!hasFormData) return null;

  const topLevelMeta: PushItem = {};
  for (const key of [
    'op', 'formId', 'formName', 'fid', 'appName', 'indexID', 'formUserId',
    'uid', 'uname', 'originUid', 'deptId', 'uuid', 'title',
    'inserttime', 'updatetime', 'completetime',
    'aprvStatus', 'aprvStatusId', 'ApprovalStatus', 'currentNodeStatus',
    'currentApproveNode', 'receivedAt',
  ]) {
    if (parsed[key] !== undefined) topLevelMeta[key] = parsed[key];
  }

  const flat = flattenChaoxingFormData(parsed.formData);
  const record: PushItem = { ...(flat as PushItem) };
  // 顶层 indexID/uid 作为 externalId/operator 的兜底
  if (parsed.indexID && !record.externalId) record.externalId = String(parsed.indexID);
  if (parsed.uid && !record.operator) record.operator = String(parsed.uid);
  if (parsed.uname && !record.operatorName) record.operatorName = String(parsed.uname);

  return { items: [record], topLevelMeta };
}

function parseBody(body: PushItem, topLevel: PushItem = {}) {
  const read = (...keys: string[]) => readField(body, topLevel, keys);
  const salesManagerContact =
    body.salesManager ?? body.sales_manager ?? body['销售经理'] ??
    topLevel.salesManager ?? topLevel.sales_manager;
  const pmContact =
    body.assignedProjectManager ?? body.assigned_project_manager ?? body['指派项目经理'] ?? body['项目经理'] ??
    topLevel.assignedProjectManager ?? topLevel.assigned_project_manager;
  const salesManager =
    pickContactName(salesManagerContact) ||
    read('salesManagerName', 'salesOwner');
  const projectName = read('projectName', 'project_name', '项目名称');
  const projectSchool = read('projectSchool', 'project_school', '项目所属学校', '学校', 'schoolName');
  const submissionDate = toDateString(
    body.submissionDate ?? body.submission_date ?? body['提交日期'] ??
    topLevel.submissionDate ?? topLevel.submission_date ?? topLevel['提交日期'],
  );

  return {
    salesManager,
    salesManagerContact,
    pmContact,
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
    projectBiddingFile: normalizeFiles(
      body.projectBiddingFile ?? body.project_bidding_file ?? body['项目招标文件'] ??
      topLevel.projectBiddingFile ?? topLevel.project_bidding_file,
    ),
    projectCategory: pickStrings(body, ['projectCategory', 'project_category', '项目所属类别', '类别']),
    screenshotRequirement: read('screenshotRequirement', 'screenshot_requirement', '截图需求说明', '截图需求'),
    assignedProjectManager:
      pickContactName(body.assignedProjectManager) ||
      read('assignedProjectManager', 'assigned_project_manager', '指派项目经理', '项目经理'),
    completionStatus: read('completionStatus', 'completion_status', '完成情况'),
    deliveryDocument: normalizeFiles(
      body.deliveryDocument ?? body.delivery_document ?? body['交付文档上传'] ?? body['交付文档'] ??
      topLevel.deliveryDocument ?? topLevel.delivery_document,
    ),
    deliveryRemark: read('deliveryRemark', 'delivery_remark', '交付信息备注', '交付备注'),
    isMeetScreenshotRequirement: toBoolean(
      body.isMeetScreenshotRequirement ?? body.is_meet_screenshot_requirement ?? body['是否按截图需求完成'] ?? body['需求达成'] ??
      topLevel.isMeetScreenshotRequirement ?? topLevel.is_meet_screenshot_requirement ?? topLevel['需求达成'],
    ),
    salesFeedback: read('salesFeedback', 'sales_feedback', '销售反馈意见', '销售反馈'),
    attachments: normalizeFiles(
      body.attachments ?? body['附件材料'] ?? body['附件'] ?? topLevel.attachments,
    ),
    rectificationFeedback: read('rectificationFeedback', 'rectification_feedback', '整改情况反馈', '整改反馈'),
    rectifiedDocument: normalizeFiles(
      body.rectifiedDocument ?? body.rectified_document ?? body['整改后文档'] ??
      topLevel.rectifiedDocument ?? topLevel.rectified_document,
    ),
    externalId: read('externalId', 'external_id', 'id', 'indexID', 'indexId', 'serialNo'),
    externalSerial: read('externalSerial', 'external_serial', 'serialNo', '编号'),
    externalOperator: read('operator', 'uid', 'submitter', '提交人'),
  };
}

type MappedBody = ReturnType<typeof parseBody>;

function missingRequiredFields(mapped: MappedBody): string[] {
  const missing: string[] = [];
  if (!mapped.salesManager) missing.push('销售经理(salesManager)');
  if (!mapped.projectName) missing.push('项目名称(projectName)');
  if (!mapped.projectSchool) missing.push('项目所属学校(projectSchool)');
  if (!mapped.submissionDate) missing.push('提交日期(submissionDate)');
  return missing;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  return withApi(async () => {
    const parsed = await parseRequestBody(request);
    if ('error' in parsed) return fail('invalid_param', parsed.error, 400);

    const { items, topLevelMeta } = parsed;
    if (items.length === 0 || items.length > 100) return fail('invalid_param', '单次推送 1–100 条', 400);

    const db = getAdminSupabase();
    const service = new BiddingScreenshotService(db);
    const resolver = new ReferenceResolver(db);
    const memberService = new TeamMemberService(db);
    const dictService = new DictService(db);
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null;

    const topLevelOp = typeof topLevelMeta.op === 'string' ? String(topLevelMeta.op) : undefined;
    const topLevelFormId =
      typeof topLevelMeta.formId === 'string' || typeof topLevelMeta.formId === 'number'
        ? String(topLevelMeta.formId)
        : undefined;
    const topLevelFormName =
      typeof topLevelMeta.formName === 'string' ? topLevelMeta.formName : undefined;

    logPushReceived('bidding-screenshot', {
      itemCount: items.length,
      topLevelOp,
      topLevelFormId,
      topLevelFormName,
    });
    const results: Array<{
      externalId: string;
      result: 'created' | 'updated' | 'deleted' | 'recovered' | 'skipped' | 'failed';
      localId?: string | null;
      reason?: string;
    }> = [];


    // formId 白名单：只处理 254045（招投标截图），其他表单 ack skipped，和 chaoxing 推送行为一致
    if (topLevelFormId && topLevelFormId !== BIDDING_FORM_ID) {
      queueSyncLog({
        source: SYNC_SOURCE,
        externalId: '0',
        op: topLevelOp ?? 'unknown',
        operator: null,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'skipped',
        entityType: 'bidding_screenshot',
        message: `formId 不匹配（期望 ${BIDDING_FORM_ID}，实际 ${topLevelFormId}）`,
        payload: { ...topLevelMeta, ip, receivedAt: new Date().toISOString() },
      });
      logPushAck('bidding-screenshot', { result: 'skipped', reason: 'form_id_mismatch' }, startedAt);
      return ok({ received: 0, skipped: true, reason: 'form_id_mismatch' });
    }

    // form_update：仅记录元数据，不写业务数据
    if (topLevelOp && FORM_UPDATE_OPS.has(topLevelOp)) {
      queueSyncLog({
        source: SYNC_SOURCE,
        externalId: '0',
        op: topLevelOp,
        operator: null,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'success',
        entityType: 'form',
        message: topLevelFormName ? `表单更新：${topLevelFormName}` : '表单更新',
        payload: { ...topLevelMeta, ip, receivedAt: new Date().toISOString() },
      });
      logPushAck('bidding-screenshot', { result: 'ack' }, startedAt);
      return ok({ received: 0, results: [{ externalId: '0', result: 'ack' }] });
    }

    for (const item of items) {
      const record = isPlainObject(item) ? item : {};
      const mergedMeta = { ...topLevelMeta, ...record };
      const effectiveOp =
        topLevelOp ||
        (typeof record.op === 'string' ? String(record.op)
        : typeof record.externalOp === 'string' ? String(record.externalOp)
        : typeof topLevelMeta.externalOp === 'string' ? String(topLevelMeta.externalOp)
        : 'upsert');
      const mapped = parseBody(record, mergedMeta);
      const externalId = mapped.externalId;
      const operator = mapped.externalOperator;
      const auditPayload = { ...topLevelMeta, op: effectiveOp, ip, receivedAt: new Date().toISOString() };

      if (!externalId) {
        const reason = '缺少外部记录 ID（externalId/indexID/id）';
        results.push({ externalId: '', result: 'failed', reason });
        queueSyncLog({ source: SYNC_SOURCE, externalId: '', op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: 'failed', entityType: 'bidding_screenshot', error: reason, payload: auditPayload });
        continue;
      }

      if (REMOVE_OPS.has(effectiveOp)) {
        const row = await service.softDeleteByExternal(SOURCE, externalId);
        results.push({ externalId, result: row ? 'deleted' : 'skipped', localId: row?.id ?? null, reason: row ? undefined : '本地不存在该记录' });
        queueSyncLog({ source: SYNC_SOURCE, externalId, op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: row ? 'success' : 'skipped', entityType: 'bidding_screenshot', entityId: row?.id, message: row ? undefined : '本地不存在该记录', payload: auditPayload });
        continue;
      }
      if (RECOVER_OPS.has(effectiveOp)) {
        const row = await service.recoverByExternal(SOURCE, externalId);
        results.push({ externalId, result: row ? 'recovered' : 'skipped', localId: row?.id ?? null, reason: row ? undefined : '本地不存在该记录' });
        queueSyncLog({ source: SYNC_SOURCE, externalId, op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: row ? 'success' : 'skipped', entityType: 'bidding_screenshot', entityId: row?.id, message: row ? undefined : '本地不存在该记录', payload: auditPayload });
        continue;
      }
      if (!UPSERT_OPS.has(effectiveOp)) {
        const reason = `不支持的 op：${effectiveOp}`;
        results.push({ externalId, result: 'failed', reason });
        queueSyncLog({ source: SYNC_SOURCE, externalId, op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: 'failed', entityType: 'bidding_screenshot', error: reason, payload: auditPayload });
        continue;
      }

      const missing = missingRequiredFields(mapped);
      if (missing.length > 0) {
        const reason = `缺少必填字段：${missing.join('、')}`;
        results.push({ externalId, result: 'failed', reason });
        queueSyncLog({ source: SYNC_SOURCE, externalId, op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: 'failed', entityType: 'bidding_screenshot', error: reason, payload: { ...auditPayload, recordKeys: Object.keys(record) } });
        continue;
      }

      try {
        const validated = {
          salesManager: mapped.salesManager as string,
          projectName: mapped.projectName as string,
          projectSchool: mapped.projectSchool as string,
          submissionDate: mapped.submissionDate as string,
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

        const schoolId = await resolver.resolveSchool(validated.projectSchool);
        const [salesMember, pmMembers, normCategories, normCompletion] = await Promise.all([
          memberService.upsertByContact(mapped.salesManagerContact, 'sales'),
          memberService.upsertManyByContacts(mapped.pmContact, 'pm'),
          dictService.normalizeMany('bidding_category', validated.projectCategory ?? []),
          dictService.normalize('bidding_completion', validated.completionStatus),
        ]);
        const primaryPmId = pmMembers[0]?.id ?? null;
        const { row, created } = await service.upsertFromExternal(
          {
            ...validated,
            projectCategory: validated.projectCategory ?? [],
            projectCategoryNorm: normCategories,
            completionStatusNorm: normCompletion,
            salesManagerId: salesMember?.id ?? null,
            assignedPmId: primaryPmId,
            externalId,
            externalSource: SOURCE,
            externalOp: effectiveOp,
            externalSerial: mapped.externalSerial,
            externalOperator: mapped.externalOperator,
            rawPayload: record,
            rawMeta: auditPayload,
          },
          schoolId,
        );

        // 维护多值 PM 关联表
        if (row.id) {
          const allPmIds = pmMembers.map((m) => m.id);
          await db.from('bidding_pm_members').delete().eq('bidding_id', row.id);
          if (allPmIds.length > 0) {
            await db.from('bidding_pm_members').insert(
              allPmIds.map((memberId, idx) => ({
                bidding_id: row.id,
                member_id: memberId,
                sort_order: idx,
              })),
            );
          }
        }
        results.push({ externalId, result: created ? 'created' : 'updated', localId: row.id });
        queueSyncLog({ source: SYNC_SOURCE, externalId, op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: 'success', entityType: 'bidding_screenshot', entityId: row.id, message: `已${created ? '创建' : '更新'}招投标截图记录`, payload: auditPayload });
        after(async () => {
          try {
            await processBiddingAttachments(row);
          } catch (err) {
            console.error(JSON.stringify({ service: 'bidding-push', level: 'error', message: 'async attachment transfer failed', externalId, error: (err as Error).message }));
          }
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : '数据写入失败';
        results.push({ externalId, result: 'failed', reason });
        queueSyncLog({ source: SYNC_SOURCE, externalId, op: effectiveOp, operator, ip, durationMs: Date.now() - startedAt, status: 'failed', entityType: 'bidding_screenshot', error: reason, payload: { ...auditPayload, recordKeys: Object.keys(record) } });
      }
    }

    const failed = results.filter((r) => r.result === 'failed');
    logPushAck(
      'bidding-screenshot',
      {
        received: results.length,
        created: results.filter((r) => r.result === 'created').length,
        updated: results.filter((r) => r.result === 'updated').length,
        failed: failed.length,
        skipped: results.filter((r) => r.result === 'skipped').length,
      },
      startedAt,
    );
    if (failed.length > 0 && failed.length === results.length) {
      return fail('invalid_param', failed[0].reason || '推送处理失败', 422, { results });
    }
    return ok({ received: results.length, results });
  });
}
