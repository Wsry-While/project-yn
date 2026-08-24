import { NextRequest } from 'next/server';
import { withApi, fail, ok } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { ScreenshotExampleService } from '@/lib/domain/screenshot-example-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bidding-screenshots/examples?keywords=企业资质,业绩&limit=8
 * 召回相关历史截图示例（超过 30 天的标记 stale）。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('keywords');
    const limit = Math.min(Number(searchParams.get('limit') ?? '8'), 20) || 8;
    if (!raw) return fail('invalid_param', 'keywords 不能为空', 400);
    const keywords = raw
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!keywords.length) return fail('invalid_param', 'keywords 不能为空', 400);

    const db = getSupabaseAdminClient();
    const rows = await new ScreenshotExampleService(db).search(keywords, limit);
    return ok({ rows });
  });
}
