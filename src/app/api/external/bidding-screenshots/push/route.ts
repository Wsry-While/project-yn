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

function parseBody(body: Record<string, unknown>, topLevel: Record<string, unknown> = {}) {
  const read = (...keys: string[]) => pickString(body, keys) || pickString(topLevel, keys);
  const salesManager =
    read('salesManager', 'sales_manager', '销售经理') ||
    read('salesManagerName', 'salesOwner');
  const projectName = read('projectName', 'project_name', '项目名称');
  const projectSchool = read('projectSchool', 'project_school', '项目所属学校', 'schoolName');
  const submissionDate = toDateString(
    body.submissionDate ?? body.submission_date ?? body['提交日期'] ??
    topLevel.submissionDate ?? topLevel.submission_date ?? topLevel['提交日期'],
  );

  return {
    salesManager,
    projectName,
    projectSchool,
    submissionDate,
    projectSecondaryUnit: read('projectSecondaryUnit', 'project_secondary_unit', '项目所属二级单位'),
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
    projectCategory: read('projectCategory', 'project_category', '项目所属类别'),
    screenshotRequirement: read('screenshotRequirement', 'screenshot_requirement', '截图需求说明'),
    assignedProjectManager: read('assignedProjectManager', 'assigned_project_manager', '指派项目经理'),
    completionStatus: read('completionStatus', 'completion_status', '完成情况'),
    deliveryDocument: normalizeFile(body.deliveryDocument ?? body.delivery_document ?? body['交付文档上传'] ?? topLevel.deliveryDocument ?? topLevel.delivery_document),
    deliveryRemark: read('deliveryRemark', 'delivery_remark', '交付信息备注'),
    isMeetScreenshotRequirement: toBoolean(
      body.isMeetScreenshotRequirement ?? body.is_meet_screenshot_requirement ?? body['是否按截图需求完成'] ??
      topLevel.isMeetScreenshotRequirement ?? topLevel.is_meet_screenshot_requirement ?? topLevel['是否按截图需求完成'],
    ),
    salesFeedback: read('salesFeedback', 'sales_feedback', '销售反馈意见'),
    attachments: normalizeFiles(body.attachments ?? body['附件材料'] ?? topLevel.attachments),
    rectificationFeedback: read('rectificationFeedback', 'rectification_feedback', '整改情况反馈'),
    rectifiedDocument: normalizeFile(body.rectifiedDocument ?? body.rectified_document ?? body['整改后文档'] ?? topLevel.rectifiedDocument ?? topLevel.rectified_document),
    externalId: read('externalId', 'external_id', 'id', 'indexID', 'serialNo'),
    externalSerial: read('externalSerial', 'external_serial', 'serialNo', '编号'),
    externalOperator: read('operator', 'uid', 'submitter', '提交人'),
  };
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
    // 与项目外出（/api/external/chaoxing/push）保持一致：第三方推送按无鉴权设计，
    // 入口仅通过公网 HTTPS + 业务白名单（external_id 幂等 + source 固定）控制。
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | Record<string, unknown>[] | null;
    if (!raw) return fail('invalid_param', '请求体必须是 JSON 对象或数组', 400);
    const items = Array.isArray(raw) ? raw : [raw];
    if (items.length === 0 || items.length > 100) return fail('invalid_param', '单次推送 1–100 条', 400);

    const db = getAdminSupabase();
    const service = new BiddingScreenshotService(db);
    const schools = new SchoolService(db);
    const results: Array<{ externalId: string; result: 'created' | 'updated' | 'deleted' | 'recovered' | 'skipped'; localId?: string }> = [];

    const topLevelOp = typeof items[0]?.op === 'string' ? String(items[0].op) : undefined;
    for (const item of items) {
      const op = topLevelOp || (typeof item.op === 'string' ? String(item.op) : typeof item.externalOp === 'string' ? String(item.externalOp) : 'upsert');
      const rawRecords = Array.isArray(item.records)
        ? item.records.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        : [item];
      for (const record of rawRecords) {
        const parsed = parseBody(record, item);
        const externalId = parsed.externalId;
        if (!externalId) {
          results.push({ externalId: '', result: 'skipped' });
          continue;
        }

        if (op === 'data_remove' || op === 'remove' || op === 'delete') {
          const row = await service.softDeleteByExternal(SOURCE, externalId);
          results.push({ externalId, result: row ? 'deleted' : 'skipped', localId: row?.id });
          continue;
        }
        if (op === 'data_recover' || op === 'recover') {
          const row = await service.recoverByExternal(SOURCE, externalId);
          results.push({ externalId, result: row ? 'recovered' : 'skipped', localId: row?.id });
          continue;
        }

        if (!parsed.salesManager || !parsed.projectName || !parsed.projectSchool || !parsed.submissionDate) {
          results.push({ externalId, result: 'skipped' });
          continue;
        }

        const schoolId = await schools.findOrCreateSchoolByName(parsed.projectSchool);
        const { row, created } = await service.upsertFromExternal(
          {
            ...parsed,
            salesManager: parsed.salesManager,
            projectName: parsed.projectName,
            projectSchool: parsed.projectSchool,
            submissionDate: parsed.submissionDate,
            externalId,
            externalSource: SOURCE,
            externalOp: op,
            rawPayload: record,
            rawMeta: {
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
