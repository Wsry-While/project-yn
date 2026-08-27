import { NextRequest } from 'next/server';
import { withApi, ok, fail, readJson } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';

/** GET /api/trips/:id */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const service = new TripService(getAdminSupabase());
    const trip = await service.getById(id);
    if (!trip) return fail('not_found', '外出申请不存在', 404);
    return ok(trip);
  });
}

interface PatchBody {
  isCompleted?: boolean;
  reportConsistent?: boolean;
  salesLate?: boolean;
  serviceLate?: boolean;
  salesScore?: number | null;
  overallScore?: number | null;
  serviceSummaryText?: string;
  overallFeedbackText?: string;
  detailText?: string;
}

const SCORE_MIN = 0;
const SCORE_MAX = 5;

function clampScore(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(n)));
}

/** PATCH /api/trips/:id  超管编辑纠错字段 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requirePermission(request, 'trip:edit');
    if ('status' in auth) return auth;

    const { id } = await ctx.params;
    const body = await readJson<PatchBody>(request);

    const update: Record<string, unknown> = {};
    if (typeof body.isCompleted === 'boolean') {
      update.is_completed = body.isCompleted;
      if (body.isCompleted) update.completed_at = new Date().toISOString();
    }
    if (typeof body.reportConsistent === 'boolean') update.report_consistent = body.reportConsistent;
    if (typeof body.salesLate === 'boolean') update.sales_late = body.salesLate;
    if (typeof body.serviceLate === 'boolean') update.service_late = body.serviceLate;
    if ('salesScore' in body) update.sales_score = clampScore(body.salesScore);
    if ('overallScore' in body) update.overall_score = clampScore(body.overallScore);
    if (typeof body.serviceSummaryText === 'string') {
      update.service_summary_text = body.serviceSummaryText.slice(0, 5000);
      update.service_summary_html = body.serviceSummaryText
        ? `<p>${escapeHtml(body.serviceSummaryText)}</p>`
        : null;
    }
    if (typeof body.overallFeedbackText === 'string') {
      update.overall_feedback_text = body.overallFeedbackText.slice(0, 5000);
      update.overall_feedback_html = body.overallFeedbackText
        ? `<p>${escapeHtml(body.overallFeedbackText)}</p>`
        : null;
    }
    if (typeof body.detailText === 'string') {
      update.detail_text = body.detailText.slice(0, 20000);
      update.detail_html = body.detailText ? `<p>${escapeHtml(body.detailText)}</p>` : null;
    }

    if (Object.keys(update).length === 0) {
      return fail('invalid_param', '没有可更新的字段');
    }

    const db = getAdminSupabase();
    const { data, error } = await db
      .from('trip_requests')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', '外出申请不存在', 404);

    const service = new TripService(db);
    const trip = await service.getById(id);
    return ok(trip);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}
