import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';
import { SchoolService } from '@/lib/domain/school-service';
import {
  parseChaoxingFormData,
  isValidOp,
  toIsoFromEpoch,
} from '@/lib/domain/chaoxing/parser';
import {
  mapChaoxingDataToTrip,
  type ChaoxingFormConfig,
} from '@/lib/domain/chaoxing/mapping';
import type { TripApprovalStatus } from '@/lib/domain/types';

/**
 * 【超星表单推送接口】
 * POST /api/external/chaoxing/push
 *
 * 数据以 application/x-www-form-urlencoded / multipart/form-data 提交：
 *   op/formId/formAlias/indexID/formUserId/uid/originUid/auditStatus/
 *   inserttime/updatetime/uuid/deptId/data(JSON 字符串)
 *
 * 幂等：按 (external_source='chaoxing', external_id=indexID) upsert。
 * 审计：每次请求写 external_sync_logs。
 */

const SOURCE = 'chaoxing';
const CONFIG_KEY = 'chaoxing_form_trip';

function approvalStatusFromCode(code: number | null): TripApprovalStatus {
  if (code === 1) return 'approved';
  if (code === 2) return 'rejected';
  return 'pending';
}

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

async function loadFormConfig(db: ReturnType<typeof getAdminSupabase>): Promise<ChaoxingFormConfig | null> {
  const { data, error } = await db
    .from('system_configs')
    .select('value')
    .eq('key', CONFIG_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return null;
  return data.value as unknown as ChaoxingFormConfig;
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
    const startedAt = Date.now();

    const form = await request.formData().catch(() => null);
    if (!form) return fail('invalid_param', '请求体必须是 form-data / urlencoded', 400);

    const payload = await parseChaoxingFormData(form);
    if (!isValidOp(payload.op)) {
      return fail('invalid_param', `不支持的 op：${payload.op}`, 400);
    }
    if (!payload.formId) {
      return fail('invalid_param', 'formId 必填', 400);
    }

    const db = getAdminSupabase();
    const ip = request.headers.get('x-forwarded-for') ?? null;
    const config = await loadFormConfig(db);

    // form_update：只记录日志，不处理业务数据
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
        entityId: null,
        externalId: payload.formId,
        message: '表单结构变化通知，已记录',
        payload: { formAlias: payload.formAlias, formName: payload.formName },
      });
      return ok({ received: 1, results: [{ indexId: '0', result: 'ack' }] });
    }

    if (!config || config.business !== 'trip') {
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'skipped',
        entityType: 'trip',
        externalId: payload.indexId,
        message: '未配置该 formId 的业务映射，已忽略',
        payload: { formAlias: payload.formAlias, formName: payload.formName },
      });
      return ok({
        received: 1,
        results: [{ indexId: payload.indexId, result: 'skipped', reason: 'form_not_configured' }],
      });
    }

    const expectedFormId = config.formId || config.formAlias;
    if (expectedFormId && payload.formId !== expectedFormId && payload.formAlias !== expectedFormId) {
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'skipped',
        entityType: 'trip',
        externalId: payload.indexId,
        message: `formId 不匹配，期望 ${expectedFormId}`,
      });
      return ok({
        received: 1,
        results: [{ indexId: payload.indexId, result: 'skipped', reason: 'form_id_mismatch' }],
      });
    }

    // 删除 / 恢复
    if (payload.op === 'data_remove' || payload.op === 'data_recover') {
      if (!payload.indexId) return fail('invalid_param', 'indexID 必填', 400);
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

    // create / update：必须有行 ID
    if (!payload.indexId) return fail('invalid_param', 'indexID 必填', 400);

    try {
      const mapped = await Promise.resolve()
        .then(() =>
          mapChaoxingDataToTrip(payload.data, config, {
            uid: payload.uid,
            originUid: payload.originUid,
            inserttime: payload.inserttime,
            updatetime: payload.updatetime,
          }),
        )
        .catch((err) => {
          console.error('[chaoxing] map failed:', err);
          throw err;
        });

      const schoolService = new SchoolService(db);
      const schoolId = await schoolService.findOrCreateSchoolByName(
        mapped.schoolName,
        mapped.industry,
      );

      const service = new TripService(db);
      const { row, created } = await service.upsertFromExternal(
        {
          ...mapped,
          externalId: payload.indexId,
          externalSource: SOURCE,
          externalUuid: payload.uuid || null,
          externalOperator: payload.uid || null,
          externalOriginOperator: payload.originUid || null,
          auditStatus: payload.auditStatus,
          rawPayload: {
            op: payload.op,
            formId: payload.formId,
            formAlias: payload.formAlias,
            formName: payload.formName,
            deptId: payload.deptId,
            inserttime: payload.inserttime,
            insertIso: toIsoFromEpoch(payload.inserttime),
            updatetime: payload.updatetime,
            updateIso: toIsoFromEpoch(payload.updatetime),
            uuid: payload.uuid,
            data: payload.data,
          },
        },
        schoolId,
      );

      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid || mapped.initiator || payload.originUid || null,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'success',
        entityType: 'trip',
        entityId: row.id,
        externalId: payload.indexId,
        message: `已${created ? '创建' : '更新'}外出记录`,
      });

      return ok({
        received: 1,
        results: [
          {
            indexId: payload.indexId,
            result: created ? 'created' : 'updated',
            localId: row.id,
            approvalStatus: approvalStatusFromCode(payload.auditStatus),
          },
        ],
      });
    } catch (err) {
      let message = '数据映射失败';
      let details: unknown = null;
      if (err instanceof Error) {
        message = err.message;
        const anyErr = err as { code?: string; details?: string; hint?: string };
        if (anyErr.code || anyErr.details || anyErr.hint) {
          details = { code: anyErr.code, details: anyErr.details, hint: anyErr.hint };
          message = `${message} [${anyErr.code ?? 'DB_ERROR'}]`;
        }
      }
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
        payload: { dataPreview: payload.data.slice(0, 50) },
      });
      return fail('mapping_failed', message, 422, details);
    }
  });
}
