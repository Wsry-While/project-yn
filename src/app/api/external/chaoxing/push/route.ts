import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';
import { ReferenceResolver } from '@/lib/domain/reference-resolver';
import { TeamMemberService } from '@/lib/domain/team-member-service';
import { DictService } from '@/lib/domain/dict-service';
import { parseChaoxingFormData, isValidOp, toIsoFromEpoch } from '@/lib/domain/chaoxing/parser';
import { mapTripFields, MapFieldError } from '@/lib/domain/chaoxing/mapping';
import { queueSyncLog, logPushReceived, logPushAck } from '@/lib/domain/external-sync-log';

const SOURCE = 'chaoxing';
const SYNC_SOURCE = 'trip-request';
const TRIP_FORM_ID = '253633';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  return withApi(async () => {
    const form = await request.formData().catch(() => null);
    if (!form) return fail('invalid_param', '请求体必须是 form-data / urlencoded', 400);

    const payload = await parseChaoxingFormData(form);
    if (!isValidOp(payload.op)) return fail('invalid_param', `不支持的 op：${payload.op}`, 400);
    if (!payload.formId) return fail('invalid_param', 'formId 必填', 400);

    const db = getAdminSupabase();
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null;
    logPushReceived('chaoxing-trip', {
      op: payload.op,
      formId: payload.formId,
      indexId: payload.indexId,
      uid: payload.uid,
      auditStatus: payload.auditStatus,
    });
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
      queueSyncLog({
        source: SYNC_SOURCE,
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
      logPushAck('chaoxing-trip', { result: 'skipped', reason: 'form_id_mismatch' }, startedAt);
      return ok({
        received: 1,
        results: [{ indexId: payload.indexId || '0', result: 'skipped', reason: 'form_id_mismatch' }],
      });
    }

    if (payload.op === 'form_update') {
      queueSyncLog({
        source: SYNC_SOURCE,
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
      logPushAck('chaoxing-trip', { result: 'ack' }, startedAt);
      return ok({ received: 1, results: [{ indexId: '0', result: 'ack' }] });
    }

    if (!payload.indexId) return fail('invalid_param', 'indexID 必填', 400);

    if (payload.op === 'data_remove' || payload.op === 'data_recover') {
      const service = new TripService(db);
      const row =
        payload.op === 'data_remove'
          ? await service.softDeleteByExternal(SOURCE, payload.indexId)
          : await service.recoverByExternal(SOURCE, payload.indexId);
      queueSyncLog({
        source: SYNC_SOURCE,
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
      logPushAck(
        'chaoxing-trip',
        {
          result: row ? (payload.op === 'data_remove' ? 'deleted' : 'recovered') : 'skipped',
          indexId: payload.indexId,
        },
        startedAt,
      );
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
      const resolver = new ReferenceResolver(db);
      const memberService = new TeamMemberService(db);
      const dictService = new DictService(db);

      const schoolId = await resolver.resolveSchool(mapped.schoolName);
      const [salesMember, pmMember, supportTypeNorm, industryNorm, productsNorm] = await Promise.all([
        mapped.salesManager?.name
          ? memberService.upsert({
              puid: mapped.salesManager.puid,
              name: mapped.salesManager.name,
              contactRaw: mapped.salesManager as unknown as Record<string, unknown>,
              syncedFrom: 'chaoxing',
              role: 'sales',
            })
          : Promise.resolve(null),
        mapped.projectManager?.name
          ? memberService.upsert({
              puid: mapped.projectManager.puid,
              name: mapped.projectManager.name,
              contactRaw: mapped.projectManager as unknown as Record<string, unknown>,
              syncedFrom: 'chaoxing',
              role: 'pm',
            })
          : Promise.resolve(null),
        dictService.normalize('trip_support_type', mapped.supportType),
        dictService.normalize('trip_industry', mapped.industry),
        dictService.normalizeMany('trip_product', mapped.products),
      ]);

      const service = new TripService(db);
      const { row, created } = await service.upsertFromExternal(
        {
          ...mapped,
          schoolName: mapped.schoolName,
          tripDate: mapped.tripDate,
          supportType: mapped.supportType,
          salesManagerId: salesMember?.id ?? null,
          projectManagerId: pmMember?.id ?? null,
          supportTypeNorm,
          industryNorm,
          productsNorm,
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

      queueSyncLog({
        source: SYNC_SOURCE,
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

      logPushAck(
        'chaoxing-trip',
        { result: created ? 'created' : 'updated', indexId: payload.indexId, localId: row.id },
        startedAt,
      );

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
      console.error('[chaoxing-trip] failed:', err);
      queueSyncLog({
        source: SYNC_SOURCE,
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
      logPushAck('chaoxing-trip', { result: 'failed', error: message }, startedAt);
      return fail('mapping_failed', message, 422);
    }
  });
}
