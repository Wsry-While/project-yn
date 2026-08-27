import { NextRequest } from 'next/server';
import { withApi, ok, fail, readJson } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const service = new BiddingScreenshotService(getAdminSupabase());
    const row = await service.getById(id);
    if (!row) return fail('not_found', '招投标截图记录不存在', 404);
    return ok(row);
  });
}

interface PatchBody {
  completionStatus?: string;
  deliveryDocument?: string;
  deliveryRemark?: string;
  isMeetScreenshotRequirement?: boolean;
  salesFeedback?: string;
  rectificationFeedback?: string;
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requirePermission(request, 'bidding:edit');
    if ('status' in auth) return auth;

    const { id } = await ctx.params;
    const body = await readJson<PatchBody>(request);

    const update: Record<string, unknown> = {};
    if (typeof body.completionStatus === 'string' && body.completionStatus.trim()) {
      update.completion_status = body.completionStatus.trim().slice(0, 100);
    }
    if (typeof body.deliveryDocument === 'string') {
      update.delivery_document = body.deliveryDocument.slice(0, 2000);
    }
    if (typeof body.deliveryRemark === 'string') {
      update.delivery_remark = body.deliveryRemark.slice(0, 5000);
    }
    if (typeof body.isMeetScreenshotRequirement === 'boolean') {
      update.is_meet_screenshot_requirement = body.isMeetScreenshotRequirement;
    }
    if (typeof body.salesFeedback === 'string') {
      update.sales_feedback = body.salesFeedback.slice(0, 5000);
    }
    if (typeof body.rectificationFeedback === 'string') {
      update.rectification_feedback = body.rectificationFeedback.slice(0, 5000);
    }

    if (Object.keys(update).length === 0) {
      return fail('invalid_param', '没有可更新的字段');
    }

    const db = getAdminSupabase();
    const { data, error } = await db
      .from('bidding_screenshots')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', '招投标截图记录不存在', 404);

    const service = new BiddingScreenshotService(db);
    const row = await service.getById(id);
    return ok(row);
  });
}
