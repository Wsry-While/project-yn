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

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asString(item);
      if (s) return s;
    }
    return null;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // 超星 selectbox/dateinput 等：优先 val/realDateVal，然后 name/uname/text
    return asString(obj.val ?? obj.realDateVal ?? obj.name ?? obj.uname ?? obj.text ?? obj.value);
  }
  return null;
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const s = asString(obj.val ?? obj.name ?? obj.text);
        if (s) out.push(s);
      } else {
        const s = asString(item);
        if (s) out.push(s);
      }
    }
    return out;
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
    return asString(obj.uname ?? obj.name ?? obj.val ?? obj.value);
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
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // 优先 realDateVal（毫秒），其次 val（"2026-08-09" 或完整时间）
    return asDate(obj.realDateVal ?? obj.val ?? obj.value);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
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
    // 超星 richtext: val = 原始 html；content = 纯文本（可能含换行）
    const html = asString(obj.val ?? obj.html);
    const contentText = asString(obj.content);
    const text =
      contentText && contentText !== html
        ? contentText
        : html
          ? html.replace(/<[^>]+>/g, '').trim() || null
          : asString(obj.text ?? obj.plainText);
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
      // 超星真实字段 alias 不连续（1,3,4,7,8,10,11,12,13,14,15,16,17,18,20,21,22,23），
      // 不能按序号兜底，统一按 fields[].label（中文名）匹配，英文 alias 作为 fallback。
      const byLabel = (label: string) =>
        payload.data.find((f) => {
          const labels = f.fields?.map((x) => x.label).filter(Boolean) as string[] | undefined;
          return labels?.includes(label);
        });
      const v = (label: string, alias?: string) =>
        byLabel(label)?.values ?? (alias ? payload.data.find((f) => String(f.alias) === alias)?.values : undefined);

      const projectYear = asYear(v('项目所属年度'));
      const salesManager = asContactName(v('负责销售经理'));
      const demandType = asString(v('需求类型'));
      const product = asStrings(v('所属产品'));
      const company = asString(v('所属单位'));
      const industryCategory = asString(v('所属行业类别'));
      const demandDesc = asRichText(v('具体事宜及需求说明'));
      const providedMaterials = asFiles(v('所提供的材料'));
      const requiredFinishDate = asDate(v('要求完成时间'));
      const projectManager = asContactName(v('项目负责人'));
      const completionStatus = asString(v('完成情况'));
      const estimatedFinishDate = asDate(v('预计完成时间'));
      const deliveryContent = asString(v('交付内容'));
      const otherDeliveryContent = asString(v('交付内容（其他）'));
      const deliveryDocType = asStrings(v('交付文档类型'));
      const deliveryDocs = asFiles(v('交付文档上传'));
      const deliveryRemarkRich = asRichText(v('交付信息备注'));
      const deliveryRemark = deliveryRemarkRich.text ?? deliveryRemarkRich.html;

      if (!salesManager || !company) {
        throw new Error('缺少必填字段：负责销售经理 / 所属单位');
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
