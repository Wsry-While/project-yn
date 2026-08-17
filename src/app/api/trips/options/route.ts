import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { OptionDictionaryService } from '@/lib/domain/trip-option-service';

/**
 * GET /api/trips/options?fieldKey=support_type
 * 返回项目外出筛选字典（外出类型/行业/产品等），未知值由超星推送自动学习。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const fieldKey = request.nextUrl.searchParams.get('fieldKey') ?? 'support_type';
    const service = new OptionDictionaryService(getAdminSupabase());
    const rows = await service.list(fieldKey);
    return ok(rows);
  });
}
