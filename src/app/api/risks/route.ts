import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { RiskService, type RiskSeverity } from '@/lib/domain/risk-service';
import { getAdminSupabase } from '@/lib/domain/api-utils';

export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;

    const url = new URL(req.url);
    const severity = url.searchParams.get('severity') as RiskSeverity | null;
    const ownerId = url.searchParams.get('ownerId') || undefined;

    const admin = getAdminSupabase();
    const svc = new RiskService(admin);
    const summary = await svc.list({ severity: severity ?? undefined, ownerId });
    return ok(summary);
  });
}
