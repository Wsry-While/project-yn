import { NextRequest } from 'next/server';
import { withApi, fail, ok } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { ScreenshotExampleService } from '@/lib/domain/screenshot-example-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/bidding-screenshots/kb-images?keywords=知识图谱,多形态&limit=60
 * 人工挑图工作台用：在截图知识库（图组）里按参数关键词/模块名搜索，
 * 返回单张大图平铺结果（每张带所属图组上下文，可整组加入）。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('keywords');
    const limit = Math.min(Number(searchParams.get('limit') ?? '60') || 60, 120);
    if (!raw || !raw.trim()) return fail('invalid_param', 'keywords 不能为空', 400);

    const keywords = raw
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!keywords.length) return fail('invalid_param', 'keywords 不能为空', 400);

    const db = getSupabaseAdminClient();
    const rows = await new ScreenshotExampleService(db).searchKbImages(keywords, { limit });
    return ok({ rows });
  });
}
