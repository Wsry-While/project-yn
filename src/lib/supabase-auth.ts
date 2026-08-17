import type { User } from '@supabase/supabase-js';
import type { ChaoxingRole, ChaoxingUserInfo } from '@/lib/chaoxing-client';
import { createReadOnlySupabaseClient } from '@/lib/supabase-ssr';

interface CookieReader {
  getAll(): Array<{ name: string; value: string }>;
}

/** user_metadata 里的展示资料，键名沿用 Supabase 生态约定，值可被用户改写。 */
export interface SessionProfile {
  displayName: string;
  avatar: string;
}

export interface SessionUser {
  /** 以下字段来自 Supabase Auth 账号本身。 */
  id: string;
  email: string | null;
  provider: string;
  createdAt: string;
  lastSignInAt: string;
  /** 来自 app_metadata.chaoxing，字段名与超星返回一致，仅服务端可写，可用于鉴权。 */
  chaoxing: ChaoxingUserInfo;
  /** 来自用户可改写的 user_metadata，仅供展示，禁止用于鉴权。 */
  profile: SessionProfile;
}

export interface SessionContext {
  user: SessionUser;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function getString(sources: Array<Record<string, unknown>>, keys: string[]): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
  }
  return '';
}

function getStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''))
    .filter(Boolean);
}

function getRoles(source: Record<string, unknown>, key: string): ChaoxingRole[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChaoxingRole[] => {
    const role = asRecord(item);
    const roleId = getString([role], ['roleId']);
    const roleName = getString([role], ['roleName']);
    if (!roleId && !roleName) return [];
    return [{ roleId, roleName }];
  });
}

function normalizeUser(user: User): SessionUser {
  const userMetadata = asRecord(user.user_metadata);
  const appMetadata = asRecord(user.app_metadata);
  // 身份字段只认 app_metadata.chaoxing。user_metadata 是用户自己可写的，
  // 一旦参与解析，登录用户就能把自己伪装成任意 uid / fid / 学工号。
  const chaoxing = asRecord(appMetadata.chaoxing);

  const uid = getString([chaoxing], ['uid']);
  const name = getString([chaoxing], ['name']);
  const openid = getString([chaoxing], ['openid']);

  return {
    id: user.id,
    email: user.email ?? null,
    provider: getString([appMetadata], ['provider']) || 'chaoxing',
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? '',
    chaoxing: {
      openid,
      uid,
      name,
      displayName: getString([chaoxing], ['displayName']),
      fid: getString([chaoxing], ['fid']),
      orgName: getString([chaoxing], ['orgName']),
      role: getRoles(chaoxing, 'role'),
      loginNames: getStringArray(chaoxing, 'loginNames'),
    },
    profile: {
      displayName: getString([userMetadata], ['full_name', 'display_name']) || name || uid || openid,
      avatar: getString([userMetadata], ['avatar_url', 'picture']),
    },
  };
}

export async function getSessionUser(cookies: CookieReader): Promise<SessionContext | null> {
  const supabase = createReadOnlySupabaseClient(cookies);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { user: normalizeUser(data.user) };
}
