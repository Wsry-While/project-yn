import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/domain/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 轻量健康检查端点。
 * - 默认只返回进程级状态，不查 DB，响应快，适合外部保活探针；
 * - ?deep=1 时顺带探测 Supabase 连通性，用于监控告警。
 */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') === '1';

  if (!deep) {
    return NextResponse.json({
      status: 'ok',
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    });
  }

  let db: 'ok' | 'error' = 'ok';
  let dbError: string | null = null;
  try {
    const admin = getAdminSupabase();
    const { error } = await admin.from('schools').select('id', { count: 'exact', head: true });
    if (error) {
      db = 'error';
      dbError = error.message;
    }
  } catch (err) {
    db = 'error';
    dbError = err instanceof Error ? err.message : 'unknown';
  }

  const ok = db === 'ok';
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      uptime: process.uptime(),
      db,
      dbError,
      ts: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
    { status: ok ? 200 : 503 },
  );
}
