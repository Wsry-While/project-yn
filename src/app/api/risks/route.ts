import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { RiskService, type RiskSeverity } from '@/lib/domain/risk-service';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { resolveCurrentMemberId } from '@/lib/domain/current-member';

export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;

    const url = new URL(req.url);
    const severity = url.searchParams.get('severity') as RiskSeverity | null;
    const mine = url.searchParams.get('mine') === '1';
    let ownerId = url.searchParams.get('ownerId') || undefined;

    const admin = getAdminSupabase();

    // "我的风险"：把当前登录用户解析为 team_members.id 后按责任人过滤
    if (mine && !ownerId) {
      ownerId = (await resolveCurrentMemberId(admin, auth.user)) ?? undefined;
    }

    const svc = new RiskService(admin);
    const summary = await svc.list({ severity: severity ?? undefined, ownerId });
    return ok(summary);
  });
}
