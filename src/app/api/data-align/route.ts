import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { DataAlignService, type AlignStatus } from '@/lib/domain/data-align-service';

export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;
    const url = new URL(req.url);
    const status = url.searchParams.get('status') as AlignStatus | null;
    const entityType = url.searchParams.get('entityType');
    const limit = url.searchParams.get('limit');
    const data = await DataAlignService.list({
      status: status ?? undefined,
      entityType: entityType ?? undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(data);
  });
}
