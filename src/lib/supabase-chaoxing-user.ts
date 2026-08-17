import { createHash } from 'crypto';
import type { ChaoxingIdentity } from '@/lib/chaoxing-client';
import { getSupabaseAdminClient } from '@/lib/supabase-client';

/**
 * 0.1 版本把超星字段打平成 chaoxing_xxx 存在 app_metadata 里，现已改为 chaoxing 命名空间。
 * Supabase 的 metadata 是合并更新，把旧键显式置 null 才会被删除，否则会一直占用 JWT 体积。
 */
const LEGACY_APP_METADATA_KEYS = {
  chaoxing_openid: null,
  chaoxing_uid: null,
  chaoxing_fid: null,
  chaoxing_login_name: null,
  chaoxing_org_name: null,
  chaoxing_login_names: null,
  chaoxing_roles: null,
};

/** 学工号已不再写入 user_metadata，老用户下次登录时清掉这个残留键。 */
const LEGACY_USER_METADATA_KEYS = {
  preferred_username: null,
};

function virtualEmail(openid: string): string {
  const subjectHash = createHash('sha256').update(openid).digest('hex').slice(0, 48);
  return `chaoxing_${subjectHash}@oauth.invalid`;
}

/**
 * 将已验证的超星身份映射为 Supabase Auth 用户，并生成一次性登录 token。
 * 不创建或保存用户密码。
 */
export async function createSupabaseLoginToken(
  identity: ChaoxingIdentity,
): Promise<string> {
  const admin = getSupabaseAdminClient();
  const { avatar, ...userInfo } = identity;
  const email = virtualEmail(userInfo.openid);
  // user_metadata 可被用户自己用 supabase.auth.updateUser({ data }) 改写，
  // 只放展示字段；任何用于鉴权的标识必须同时写入 app_metadata（仅 service role 可写）。
  // 这里沿用 Supabase 生态约定的键名（Studio 和多数 UI 组件按它们取展示信息），
  // 业务代码一律读 app_metadata.chaoxing。学工号属于身份标识，只存 app_metadata。
  const userMetadata = {
    ...LEGACY_USER_METADATA_KEYS,
    full_name: userInfo.displayName,
    avatar_url: avatar,
  };
  // 直接存超星返回的 userInfo 结构，键名不做二次翻译。
  // 注意：app_metadata 会进入 JWT，与 Session 单 Cookie 大小限制竞争，
  // 只放已解析的这几个字段，不要把响应里的其他内容原样塞进来。
  const appMetadata = { ...LEGACY_APP_METADATA_KEYS, chaoxing: userInfo };

  const { data: created } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  });

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !link.properties?.hashed_token || !link.user?.id) {
    throw new Error(`无法为超星用户生成 Supabase 登录凭据：${linkError?.message || '未知错误'}`);
  }

  const userId = created.user?.id || link.user.id;
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...link.user.app_metadata, ...appMetadata },
    user_metadata: { ...link.user.user_metadata, ...userMetadata },
  });
  if (updateError) throw new Error(`无法同步超星用户资料：${updateError.message}`);

  return link.properties.hashed_token;
}
