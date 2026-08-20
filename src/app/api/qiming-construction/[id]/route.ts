import { NextRequest, NextResponse } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase, requireUser } from '@/lib/domain/api-utils';
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
