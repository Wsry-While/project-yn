import { NextRequest, after } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { parseChaoxingFormData, isValidOp, toIsoFromEpoch } from '@/lib/domain/chaoxing/parser';
import { QimingConstructionService } from '@/lib/domain/qiming-construction-service';
import { processQimingAttachments } from '@/lib/domain/qiming-construction-attachment-service';
import { TeamMemberService } from '@/lib/domain/team-member-service';
import { DictService } from '@/lib/domain/dict-service';
import { ReferenceResolver } from '@/lib/domain/reference-resolver';
import { queueSyncLog, logPushReceived, logPushAck } from '@/lib/domain/external-sync-log';

const SOURCE = 'chaoxing';
const SYNC_SOURCE = 'qiming-construction';
// 启明星建设表单 formId，由 CHAOXING_QIMING_FORM_ID 指定；未配置时不做白名单过滤（联调期）。
const QIMING_FORM_ID = (process.env.CHAOXING_QIMING_FORM_ID || '').trim();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    return asString(obj.val ?? obj.realDateVal ?? obj.name ?? obj.uname ?? obj.text ?? obj.value);
  }
  return null;
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

function asBoolean(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) {
    for (const item of v) {
      const b = asBoolean(item);
      if (b !== null) return b;
    }
    return null;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return asBoolean(obj.val ?? obj.value ?? obj.checked);
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是', '已签', '签了', '已签订', '签订'].includes(s)) return true;
    if (['false', '0', 'no', 'n', '否', '未签', '未签订'].includes(s)) return false;
    return null;
  }
  return null;
}

function asYear(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const m = /(\d{4})/.exec(s);
  return m ? m[1] : null;
}

/** 日期时间：返回 ISO 字符串，保留本地时间（不做 UTC 偏移）。 */
function asDateTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const d = asDateTime(item);
      if (d) return d;
    }
    return null;
  }
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return asDateTime(obj.realDateVal ?? obj.val ?? obj.value);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n) && /^\d+$/.test(s)) return asDateTime(n);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
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
    logPushReceived('qiming-construction', {
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
      uid: payload.uid,
      auditStatus: payload.auditStatus,
      inserttime: payload.inserttime,
      insertIso: toIsoFromEpoch(payload.inserttime),
      updatetime: payload.updatetime,
      updateIso: toIsoFromEpoch(payload.updatetime),
      uuid: payload.uuid,
    };

    if (QIMING_FORM_ID && payload.formId !== QIMING_FORM_ID) {
      queueSyncLog({
        source: SYNC_SOURCE,
        formId: payload.formId,
        indexId: payload.indexId || '0',
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'skipped',
        entityType: 'qiming-construction',
        externalId: payload.indexId || payload.formId,
        message: `formId 不匹配，仅处理 ${QIMING_FORM_ID}`,
        payload: auditPayload,
      });
      logPushAck('qiming-construction', { result: 'skipped', reason: 'form_id_mismatch' }, startedAt);
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
      logPushAck('qiming-construction', { result: 'ack' }, startedAt);
      return ok({ received: 1, results: [{ indexId: '0', result: 'ack' }] });
    }

    if (!payload.indexId) return fail('invalid_param', 'indexID 必填', 400);

    if (payload.op === 'data_remove' || payload.op === 'data_recover') {
      const service = new QimingConstructionService(db);
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
        entityType: 'qiming-construction',
        entityId: row?.id,
        externalId: payload.indexId,
        message: row ? undefined : '本地不存在该记录',
        payload: auditPayload,
      });
      logPushAck(
        'qiming-construction',
        { result: row ? (payload.op === 'data_remove' ? 'deleted' : 'recovered') : 'skipped', indexId: payload.indexId },
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

    // upsert 流程
    try {
      // 按 fields[].label（中文名）匹配，alias 不连续时英文 alias 作为 fallback。
      const byLabel = (label: string) =>
        payload.data.find((f) => {
          const labels = f.fields?.map((x) => x.label).filter(Boolean) as string[] | undefined;
          return labels?.includes(label);
        });
      const v = (label: string) => byLabel(label)?.values;

      const salesManager = asContactName(v('负责销售经理'));
      const projectYear = asYear(v('所属年度'));
      const projectName = asString(v('项目名称'));
      const isSignContract = asBoolean(v('是否签合同'));
      const school = asString(v('学校'));
      const college = asString(v('学院'));
      const schoolLevel = asString(v('学校层级'));
      const buildMajor = asString(v('建设专业'));
      const buildContent = asRichText(v('建设内容'));
      const buildSpecialDesc = asRichText(v('建设内容特殊说明及材料'));
      const projectMaterials = asFiles(v('项目相关资料'));
      const projectDeliveryTime = asDateTime(v('项目交付时间'));
      const projectManager = asContactName(v('负责项目经理'));
      const projectStatusFeedback = asString(v('项目情况反馈'));

      // 引用解析：学校/学院、员工、字典归一
      const resolver = new ReferenceResolver(db);
      const memberService = new TeamMemberService(db);
      const dictService = new DictService(db);

      const schoolId = await resolver.resolveSchool(school);
      const [collegeId, salesMember, pmMembers, schoolLevelNorm, buildMajorNorm] = await Promise.all([
        resolver.resolveDepartment(schoolId, college, 'college'),
        memberService.upsertByContact(v('负责销售经理'), 'sales'),
        memberService.upsertManyByContacts(v('负责项目经理'), 'pm'),
        dictService.normalize('school_level', schoolLevel),
        dictService.normalize('build_major', buildMajor),
      ]);

      const primaryPmId = pmMembers[0]?.id ?? null;

      const service = new QimingConstructionService(db);
      const { row, created } = await service.upsertFromExternal({
        externalId: payload.indexId,
        externalSource: SOURCE,
        externalOp: payload.op,
        externalSerial: payload.uuid || null,
        externalOperator: payload.uid || null,
        salesManager,
        salesManagerId: salesMember?.id ?? null,
        projectYear,
        projectName,
        isSignContract,
        school,
        schoolId,
        college,
        collegeId,
        schoolLevel,
        schoolLevelNorm,
        buildMajor,
        buildMajorNorm,
        buildContentHtml: buildContent.html,
        buildContentText: buildContent.text,
        buildSpecialDescHtml: buildSpecialDesc.html,
        buildSpecialDescText: buildSpecialDesc.text,
        projectMaterials,
        projectDeliveryTime,
        projectManager,
        projectManagerId: primaryPmId,
        projectStatusFeedback,
        rawPayload: payload.data,
        rawMeta: auditPayload,
      });

      // 维护多值 PM 关联表：先清空再重建
      if (row.id) {
        const allPmIds = pmMembers.map((m) => m.id);
        await db.from('qiming_pm_members').delete().eq('qiming_id', row.id);
        if (allPmIds.length > 0) {
          await db.from('qiming_pm_members').insert(
            allPmIds.map((memberId, idx) => ({
              qiming_id: row.id,
              member_id: memberId,
              sort_order: idx,
            })),
          );
        }
      }

      queueSyncLog({
        source: SYNC_SOURCE,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'success',
        entityType: 'qiming-construction',
        entityId: row.id,
        externalId: payload.indexId,
        message: `已${created ? '创建' : '更新'}启明星建设记录`,
        payload: auditPayload,
      });

      logPushAck(
        'qiming-construction',
        { result: created ? 'created' : 'updated', indexId: payload.indexId, localId: row.id },
        startedAt,
      );

      after(async () => {
        try {
          await processQimingAttachments(row);
        } catch (err) {
          console.error(JSON.stringify({ service: 'qiming-construction-push', level: 'error', message: 'async attachment transfer failed', externalId: payload.indexId, error: (err as Error).message }));
        }
      });

      return ok({
        received: 1,
        results: [{ indexId: payload.indexId, result: created ? 'created' : 'updated', localId: row.id }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '数据映射失败';
      console.error('[qiming-construction] failed:', err);
      queueSyncLog({
        source: SYNC_SOURCE,
        formId: payload.formId,
        indexId: payload.indexId,
        op: payload.op,
        operator: payload.uid,
        ip,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        entityType: 'qiming-construction',
        externalId: payload.indexId,
        error: message,
        payload: { ...auditPayload, dataPreview: payload.data.slice(0, 50) },
      });
      logPushAck('qiming-construction', { result: 'failed', error: message }, startedAt);
      return fail('invalid_param', message, 422);
    }
  });
}
