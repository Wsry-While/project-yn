import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeName } from './team-member-service';

/**
 * 把当前登录用户解析为 team_members.id。
 * 优先按 chaoxing.uid（与推送时保存的 puid 一致）匹配；
 * 找不到再按 displayName/name 规范化匹配；都没有返回 null。
 */
export async function resolveCurrentMemberId(
  db: SupabaseClient,
  user: { chaoxing: { uid: string; name?: string; displayName?: string } },
): Promise<string | null> {
  const uid = user.chaoxing.uid?.trim();
  if (uid) {
    const { data } = await db
      .from('team_members')
      .select('id')
      .or(`puid.eq.${uid},name.eq.${uid}`)
      .eq('active', true)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (data?.id) return data.id;
  }
  const displayName = user.chaoxing.displayName?.trim() || user.chaoxing.name?.trim();
  if (!displayName) return null;
  const { data: byName } = await db
    .from('team_members')
    .select('id, name')
    .eq('active', true)
    .limit(100);
  if (!byName) return null;
  const norm = normalizeName(displayName);
  const hit = (byName as Array<{ id: string; name: string }>).find(
    (r) => normalizeName(r.name) === norm,
  );
  return hit?.id ?? null;
}
