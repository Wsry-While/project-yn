import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase, requireUser } from '@/lib/domain/api-utils';
import { ProjectDemandService } from '@/lib/domain/project-demand-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withApi(async () => {
    const session = await requireUser(request);
    if (session instanceof Response) return session;

    const sp = request.nextUrl.searchParams;
    const search = sp.get('search')?.trim() || undefined;
    const year = sp.get('year')?.trim() || undefined;
    const salesManager = sp.get('salesManager')?.trim() || undefined;
    const completionStatus = sp.get('completionStatus')?.trim() || undefined;
    const limit = Math.min(Number(sp.get('limit') ?? '100') || 100, 500);
    const offset = Number(sp.get('offset') ?? '0') || 0;

    const db = getAdminSupabase();
    const service = new ProjectDemandService(db);
    const { rows, total } = await service.list({
      search,
      year,
      salesManager,
      completionStatus,
      limit,
      offset,
    });
    return ok({ rows, total });
  });
}
