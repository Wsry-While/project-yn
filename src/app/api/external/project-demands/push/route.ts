import { NextRequest, after } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { parseChaoxingFormData, isValidOp, toIsoFromEpoch } from '@/lib/domain/chaoxing/parser';
import { ProjectDemandService } from '@/lib/domain/project-demand-service';
import { processDemandAttachments } from '@/lib/domain/project-demand-attachment-service';

const SOURCE = 'chaoxing';
const DEMAND_FORM_ID = (process.env.CHAOXING_DEMAND_FORM_ID || '254046').trim();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    source: 'project-demand',
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

function pickField(data: Array<{ alias: string | number; compt: string; values?: unknown }>, alias: string) {
  return data.find((f) => String(f.alias) === alias);
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const first = v.find((x) => x !== null && x !== undefined && x !== '');
    return first === undefined ? null : asString(first);
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.uname === 'string') return obj.uname;
    if (typeof obj.text === 'string') return obj.text;
  }
  return null;
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(asString).filter((x): x is string => !!x);
  }
  const s = asString(v);
  return s ? [s] : [];
}

function asContactName(v: unknown): string | null {
  if (Array.isArray(v)) {
    return v.map((x) => asContactName(x)).filter((x): x is string => !!x).join('、') || null;
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return asString(obj.uname ?? obj.name ?? obj.value);
  }
  return asString(v);
}

function asDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const d = asDate(item);
      if (d) return d;
    }
    return null;
  }
  if (typeof v === 'number') {
    // 超星日期可能是毫秒时间戳
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    // YYYY-MM-DD 或 YYYY/MM/DD 或带时间
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const n = Number(s);
    if (Number.isFinite(n)) return asDate(n);
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function asYear(v: unknown): string | null {
  // 年度可能是 "2025"、"2025年"、数字
  const s = asString(v);
  if (!s) return null;
  const m = /(\d{4})/.exec(s);
  return m ? m[1] : null;
}

function asRichText(v: unknown): { html: string | null; text: string | null } {
  if (v === null || v === undefined || v === '') return { html: null, text: null };
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object') return asRichText(parsed);
    } catch {
      // not json
    }
    return { html: v, text: v.replace(/<[^>]+>/g, '').trim() || null };
  }
  if (Array.isArray(v)) return asRichText(v[0]);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const html = asString(obj.html ?? obj.content ?? obj.value);
    const text = asString(obj.text ?? obj.plainText);
    return { html, text };
  }
  return { html: null, text: null };
}

type FileRefLike = {
  name: string | null;
  url: string | null;
  objectId: string | null;
  resid: string | null;
  suffix: string | null;
  size: string | null;
  byteSize: number | null;
  type: string | null;
};

function asFiles(v: unknown): FileRefLike[] {
  if (!v) return [];
  const items = Array.isArray(v) ? v : [v];
  const out: FileRefLike[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = asString(obj.name ?? obj.fileName ?? obj.fn);
    const url = asString(obj.url ?? obj.href ?? obj.path);
    const objectId = asString(obj.objectId ?? obj.object_id);
    const resid = asString(obj.resid);
    const suffix = asString(obj.suffix);
    const size = asString(obj.size);
    const byteSize =
      typeof obj.byteSize === 'number'
        ? obj.byteSize
        : typeof obj.byteSize === 'string' && obj.byteSize.trim()
          ? Number(obj.byteSize) || null
          : typeof obj.size === 'number'
            ? obj.size
            : null;
    const type = asString(obj.type ?? obj.contentType);
    if (!url && !objectId && !resid) continue;
    out.push({ name, url, objectId, resid, suffix, size, byteSize, type });
  }
  return out;
}

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
    const auditPayload = {
      op: payload.op,
      formId: payload.formId,
      formName: payload.formName,
      formAlias: payload.formAlias,
      appName: payload.appName,
      uid: payload.uid,
      auditStatus: payload.auditStatus,
      inserttime: payload.inserttime,
      insertIso: toIsoFromEpoch(payload.inserttime),
      updatetime: payload.updatetime,
      updateIso: toIsoFromEpoch(payload.updatetime),
      uuid: payload.uuid,
    };

    if (DEMAND_FORM_ID && payload.formId !== DEMAND_FORM_ID) {
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId || '0',
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'skipped',
        entityType: 'project-demand',
        externalId: payload.indexId || payload.formId,
        message: `formId 不匹配，仅处理 ${DEMAND_FORM_ID}`,
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
      const service = new ProjectDemandService(db);
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
        entityType: 'project-demand',
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

    // upsert 流程
    try {
      const data = payload.data;
      const f = (alias: string) => pickField(data, alias);
      const v = (alias: string) => f(alias)?.values;

      // 字段映射（alias 按实际表单回填，当前先按英文/数字双兜底）
      const projectYear = asYear(v('projectYear') ?? v('1'));
      const salesManager = asContactName(v('salesManager') ?? v('2'));
      const demandType = asString(v('demandType') ?? v('3'));
      const product = asString(v('product') ?? v('4'));
      const company = asString(v('company') ?? v('5'));
      const industryCategory = asString(v('industryCategory') ?? v('6'));
      const demandDesc = asRichText(v('demandDesc') ?? v('7'));
      const providedMaterials = asFiles(v('providedMaterials') ?? v('8'));
      const requiredFinishDate = asDate(v('requiredFinishTime') ?? v('9'));
      const projectManager = asContactName(v('projectManager') ?? v('10'));
      const completionStatus = asString(v('completionStatus') ?? v('11'));
      const estimatedFinishDate = asDate(v('estimatedFinishTime') ?? v('12'));
      const deliveryContent = asString(v('deliveryContent') ?? v('13'));
      const otherDeliveryContent = asString(v('otherDeliveryContent') ?? v('14'));
      const deliveryDocType = asStrings(v('deliveryDocType') ?? v('15'));
      const deliveryDocs = asFiles(v('deliveryDocUpload') ?? v('16'));
      const deliveryRemark = asString(v('deliveryRemark') ?? v('17'));

      if (!salesManager || !company) {
        throw new Error('缺少必填字段：负责销售经理（salesManager）或所属单位（company）');
      }

      const service = new ProjectDemandService(db);
      const { row, created } = await service.upsertFromExternal({
        externalId: payload.indexId,
        externalSource: SOURCE,
        externalOp: payload.op,
        externalSerial: payload.uuid || null,
        externalOperator: payload.uid || null,
        projectYear,
        salesManager,
        demandType,
        product,
        company,
        industryCategory,
        demandDescHtml: demandDesc.html,
        demandDescText: demandDesc.text,
        providedMaterials,
        requiredFinishDate,
        projectManager,
        completionStatus,
        estimatedFinishDate,
        deliveryContent,
        otherDeliveryContent,
        deliveryDocType,
        deliveryDocs,
        deliveryRemark,
        rawPayload: payload.data,
        rawMeta: auditPayload,
      });

      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'success',
        entityType: 'project-demand',
        entityId: row.id,
        externalId: payload.indexId,
        message: `已${created ? '创建' : '更新'}项目建设申请`,
        payload: auditPayload,
      });

      after(async () => {
        try {
          await processDemandAttachments(row);
        } catch (err) {
          console.error(JSON.stringify({ service: 'project-demand-push', level: 'error', message: 'async attachment transfer failed', externalId: payload.indexId, error: (err as Error).message }));
        }
      });

      return ok({
        received: 1,
        results: [{ indexId: payload.indexId, result: created ? 'created' : 'updated', localId: row.id }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '数据映射失败';
      console.error('[project-demand push] failed:', err);
      await writeSyncLog({
        db,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        entityType: 'project-demand',
        externalId: payload.indexId,
        error: message,
        payload: { ...auditPayload, dataPreview: payload.data.slice(0, 50) },
      });
      return fail('invalid_param', message, 422);
    }
  });
}
