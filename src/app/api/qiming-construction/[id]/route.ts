import { NextRequest, NextResponse } from 'next/server';
import { ok, fail, withApi, readJson } from '@/lib/domain/http';
import { getAdminSupabase, requireUser, requirePermission } from '@/lib/domain/api-utils';
import { QimingConstructionService } from '@/lib/domain/qiming-construction-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  return withApi(async () => {
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    const { id } = await context.params;
    const db = getAdminSupabase();
    const service = new QimingConstructionService(db);
    const row = await service.getById(id);
    if (!row) return fail('not_found', '启明星建设记录不存在', 404);
    return ok(row);
  });
}

interface PatchBody {
  isSignContract?: boolean;
  buildMajor?: string;
  projectDeliveryTime?: string | null;
  projectStatusFeedback?: string;
}

export async function PATCH(request: NextRequest, context: Ctx) {
  return withApi(async () => {
    const auth = await requirePermission(request, 'qiming:edit');
    if (auth instanceof NextResponse) return auth;

    const { id } = await context.params;
    const body = await readJson<PatchBody>(request);

    const update: Record<string, unknown> = {};
    if (typeof body.isSignContract === 'boolean') update.is_sign_contract = body.isSignContract;
    if (typeof body.buildMajor === 'string') {
      update.build_major = body.buildMajor.slice(0, 200);
    }
    if ('projectDeliveryTime' in body) {
      const v = body.projectDeliveryTime;
      update.project_delivery_time = v ? new Date(v).toISOString() : null;
    }
    if (typeof body.projectStatusFeedback === 'string') {
      update.project_status_feedback = body.projectStatusFeedback.slice(0, 5000);
    }

    if (Object.keys(update).length === 0) {
      return fail('invalid_param', '没有可更新的字段');
    }

    const db = getAdminSupabase();
    const { data, error } = await db
      .from('qiming_construction')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', '启明星建设记录不存在', 404);

    const service = new QimingConstructionService(db);
    const row = await service.getById(id);
    return ok(row);
  });
}
