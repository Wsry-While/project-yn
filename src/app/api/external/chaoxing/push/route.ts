import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';
import { SchoolService } from '@/lib/domain/school-service';
import { parseChaoxingFormData, isValidOp, toIsoFromEpoch } from '@/lib/domain/chaoxing/parser';
import { mapTripFields, MapFieldError } from '@/lib/domain/chaoxing/mapping';

const SOURCE = 'chaoxing';
const TRIP_FORM_ID = '253633';

async function writeSyncLog(input: {
  db: ReturnType<typeof getAdminSupabase>;
  formId: string;
  indexId: string;
  op: string;
  operator: string | null;
  ip: string | null;
  durationMs: number;
  status: 'success' | 'failed' | 'skipped';
  entityType: string;
  entityId?: string | null;
  externalId?: string;
  message?: string | null;
  payload?: unknown;
  error?: string | null;
}): Promise<void> {
  const { db, ...row } = input;
  await db.from('external_sync_logs').insert({
    source: SOURCE,
    direction: 'inbound',
    form_id: row.formId,
    index_id: row.indexId,
    external_id: row.externalId ?? row.indexId,
    entity_type: row.entityType,
    entity_id: row.entityId ?? null,
    op: row.op,
    operator: row.operator,
    ip: row.ip,
    duration_ms: row.durationMs,
    status: row.status,
    message: row.message ?? null,
    error: row.error ?? null,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
  });
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
    const startedAt = Date.now();
    const form = await request.formData().catch(() => null);
    if (!form) return fail('invalid_param', '请求体必须是 form-data / urlencoded', 400);

    const payload = await parseChaoxingFormData(form);
    if (!isValidOp(payload.op)) return fail('invalid_param', `不支持的 op：${payload.op}`, 400);
    if (!payload.formId) return fail('invalid_param', 'formId 必填', 400);

    const db = getAdminSupabase();
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null;
    const auditPayload = {
      op: payload.op,
      formId: payload.formId,
      formName: payload.formName,
      formAlias: payload.formAlias,
      appName: payload.appName,
      deptId: payload.deptId,
      formUserId: payload.formUserId,
      uid: payload.uid,
      originUid: payload.originUid,
      auditStatus: payload.auditStatus,
      inserttime: payload.inserttime,
      insertIso: toIsoFromEpoch(payload.inserttime),
      updatetime: payload.updatetime,
      updateIso: toIsoFromEpoch(payload.updatetime),
      uuid: payload.uuid,
      formType: payload.formType,
    };

    if (payload.formId !== TRIP_FORM_ID) {
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId || '0',
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'skipped',
        entityType: 'trip',
        externalId: payload.indexId || payload.formId,
        message: `formId 不匹配，仅处理 ${TRIP_FORM_ID}`,
        payload: auditPayload,
      });
      return ok({
        received: 1,
        results: [{ indexId: payload.indexId || '0', result: 'skipped', reason: 'form_id_mismatch' }],
      });
    }

    if (payload.op === 'form_update') {
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId || '0',
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'success',
        entityType: 'form',
        externalId: payload.formId,
        message: '表单结构变化通知，已 ack',
        payload: auditPayload,
      });
      return ok({ received: 1, results: [{ indexId: '0', result: 'ack' }] });
    }

    if (!payload.indexId) return fail('invalid_param', 'indexID 必填', 400);

    if (payload.op === 'data_remove' || payload.op === 'data_recover') {
      const service = new TripService(db);
      const row =
        payload.op === 'data_remove'
          ? await service.softDeleteByExternal(SOURCE, payload.indexId)
          : await service.recoverByExternal(SOURCE, payload.indexId);
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: row ? 'success' : 'skipped',
        entityType: 'trip',
        entityId: row?.id,
        externalId: payload.indexId,
        message: row ? undefined : '本地不存在该记录',
        payload: auditPayload,
      });
      return ok({
        received: 1,
        results: [
          {
            indexId: payload.indexId,
            result: row ? (payload.op === 'data_remove' ? 'deleted' : 'recovered') : 'skipped',
            localId: row?.id ?? null,
          },
        ],
      });
    }

    try {
      const mapped = mapTripFields(payload.data);
      if (!mapped.schoolName || !mapped.tripDate || !mapped.supportType) {
        throw new MapFieldError('缺少必填字段：学校（alias=33）、外出支持类型（alias=4）或外出日期（alias=9）');
      }
      const schoolService = new SchoolService(db);
      const schoolId = await schoolService.findOrCreateSchoolByName(mapped.schoolName, mapped.industry);

      const service = new TripService(db);
      const { row, created } = await service.upsertFromExternal(
        {
          ...mapped,
          schoolName: mapped.schoolName,
          tripDate: mapped.tripDate,
          supportType: mapped.supportType,
          externalId: payload.indexId,
          externalSource: SOURCE,
          externalUuid: payload.uuid || null,
          externalOp: payload.op,
          externalOperator: payload.uid || null,
          externalOperatorName: null,
          externalOriginOperator: payload.originUid || null,
          auditStatus: payload.auditStatus,
          rawPayload: payload.data,
          rawMeta: auditPayload,
        },
        schoolId,
      );

      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'success',
        entityType: 'trip',
        entityId: row.id,
        externalId: payload.indexId,
        message: `已${created ? '创建' : '更新'}外出记录`,
        payload: auditPayload,
      });

      return ok({
        received: 1,
        results: [
          {
            indexId: payload.indexId,
            result: created ? 'created' : 'updated',
            localId: row.id,
            approvalStatus: row.approvalStatus,
          },
        ],
      });
    } catch (err) {
      const message = err instanceof MapFieldError ? err.message : err instanceof Error ? err.message : '数据映射失败';
      console.error('[chaoxing] failed:', err);
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        entityType: 'trip',
        externalId: payload.indexId,
        error: message,
        payload: { ...auditPayload, dataPreview: payload.data.slice(0, 50) },
      });
      return fail('mapping_failed', message, 422);
    }
  });
}
