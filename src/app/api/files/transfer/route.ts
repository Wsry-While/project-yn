import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail, ok } from '@/lib/domain/http';
import { getAdminSupabase, requireUser } from '@/lib/domain/api-utils';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';
import { ProjectDemandService } from '@/lib/domain/project-demand-service';
import { QimingConstructionService } from '@/lib/domain/qiming-construction-service';
import { retransferBiddingFile } from '@/lib/domain/bidding-attachment-service';
import { retransferDemandFile } from '@/lib/domain/project-demand-attachment-service';
import { retransferQimingFile } from '@/lib/domain/qiming-construction-attachment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TransferBody {
  business?: 'bidding' | 'demand' | 'qiming';
  recordId?: string;
  field?: string;
  objectId?: string;
}

const BIDDING_FIELDS = ['projectBiddingFile', 'deliveryDocument', 'attachments', 'rectifiedDocument'];
const DEMAND_FIELDS = ['providedMaterials', 'deliveryDocs'];

/**
 * 对「只有超星 objectId、尚未建 asset/转存」的历史附件，手动触发一次转存并回写业务表。
 *
 * body: { business: 'bidding'|'demand'|'qiming', recordId, field, objectId }
 * - bidding：field 取值 projectBiddingFile/deliveryDocument/attachments/rectifiedDocument
 * - demand：field 取值 providedMaterials/deliveryDocs
 * - qiming：固定 project_materials，field 可省略
 * 转存成功返回 { ok, status, assetId }，前端刷新后即可走预览/下载。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    let body: TransferBody = {};
    try {
      body = (await request.json()) as TransferBody;
    } catch {
      return fail('invalid_param', '请求体需为 JSON', 400);
    }

    const business = body.business;
    const recordId = (body.recordId || '').trim();
    const objectId = (body.objectId || '').trim();
    const field = (body.field || '').trim();

    if (!business || !['bidding', 'demand', 'qiming'].includes(business)) {
      return fail('invalid_param', 'business 非法', 400);
    }
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return fail('invalid_param', 'recordId 非法', 400);
    if (!/^[a-f0-9]{32}$/i.test(objectId)) return fail('invalid_param', 'objectId 非法', 400);

    const db = getAdminSupabase();

    if (business === 'bidding') {
      if (!BIDDING_FIELDS.includes(field)) return fail('invalid_param', 'field 非法', 400);
      const service = new BiddingScreenshotService(db);
      const record = await service.getById(recordId);
      if (!record) return fail('not_found', '招投标记录不存在', 404);
      const result = await retransferBiddingFile(
        record,
        field as 'projectBiddingFile' | 'deliveryDocument' | 'attachments' | 'rectifiedDocument',
        objectId,
      );
      if (!result.ok) return ok({ ok: false, status: result.status, error: result.error });
      return ok({ ok: true, status: result.status, assetId: result.assetId });
    }

    if (business === 'demand') {
      if (!DEMAND_FIELDS.includes(field)) return fail('invalid_param', 'field 非法', 400);
      const service = new ProjectDemandService(db);
      const record = await service.getById(recordId);
      if (!record) return fail('not_found', '建设申请记录不存在', 404);
      const result = await retransferDemandFile(
        record,
        field as 'providedMaterials' | 'deliveryDocs',
        objectId,
      );
      if (!result.ok) return ok({ ok: false, status: result.status, error: result.error });
      return ok({ ok: true, status: result.status, assetId: result.assetId });
    }

    // qiming
    const service = new QimingConstructionService(db);
    const record = await service.getById(recordId);
    if (!record) return fail('not_found', '启明星记录不存在', 404);
    const result = await retransferQimingFile(record, objectId);
    if (!result.ok) return ok({ ok: false, status: result.status, error: result.error });
    return ok({ ok: true, status: result.status, assetId: result.assetId });
  });
}
