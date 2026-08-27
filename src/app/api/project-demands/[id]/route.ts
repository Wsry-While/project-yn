import { NextRequest } from 'next/server';
import { withApi, ok, fail, readJson } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await context.params;
    const db = getAdminSupabase();
    const { data, error } = await db
      .from('project_demands')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', '项目建设申请不存在', 404);
    return ok(data);
  });
}

interface PatchBody {
  completionStatus?: string;
  estimatedFinishDate?: string | null;
  deliveryContent?: string;
  otherDeliveryContent?: string;
  deliveryRemark?: string;
}

export async function PATCH(request: NextRequest, context: Ctx) {
  return withApi(async () => {
    const auth = await requirePermission(request, 'demand:edit');
    if ('status' in auth) return auth;

    const { id } = await context.params;
    const body = await readJson<PatchBody>(request);

    const update: Record<string, unknown> = {};
    if (typeof body.completionStatus === 'string') {
      update.completion_status = body.completionStatus.slice(0, 100);
    }
    if ('estimatedFinishDate' in body) {
      const v = body.estimatedFinishDate;
      update.estimated_finish_date = v ? String(v).slice(0, 10) : null;
    }
    if (typeof body.deliveryContent === 'string') {
      update.delivery_content = body.deliveryContent.slice(0, 2000);
    }
    if (typeof body.otherDeliveryContent === 'string') {
      update.other_delivery_content = body.otherDeliveryContent.slice(0, 2000);
    }
    if (typeof body.deliveryRemark === 'string') {
      update.delivery_remark = body.deliveryRemark.slice(0, 5000);
    }

    if (Object.keys(update).length === 0) {
      return fail('invalid_param', '没有可更新的字段');
    }

    const db = getAdminSupabase();
    const { data, error } = await db
      .from('project_demands')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', '项目建设申请不存在', 404);

    const { data: fresh } = await db.from('project_demands').select('*').eq('id', id).single();
    return ok(fresh);
  });
}
