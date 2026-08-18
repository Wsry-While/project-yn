import { NextRequest, NextResponse } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase, requireUser } from '@/lib/domain/api-utils';
import { ProjectDemandService } from '@/lib/domain/project-demand-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  return withApi(async () => {
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;
    const { id } = await context.params;
    if (!id) return fail('invalid_param', 'id 必填', 400);

    const db = getAdminSupabase();
    const service = new ProjectDemandService(db);
    const row = await service.getById(id);
    if (!row) return fail('not_found', '项目建设申请不存在', 404);
    return ok(row);
  });
}
