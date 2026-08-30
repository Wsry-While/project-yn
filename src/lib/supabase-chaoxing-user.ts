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
 * GoTrue generateLink 返回的一次性 token 类型。
 * 实例开启 mailer_autoconfirm 后，全新用户拿到的是 signup 验证链接、
 * 已存在用户拿到的是 magiclink 登录链接；必须用返回里的真实 verification_type
 * 去 verifyOtp，类型不匹配会被判成 otp_expired（"Email link is invalid or has expired"）。
 */
export type SupabaseLoginVerificationType = 'magiclink' | 'signup' | 'recovery' | 'invite' | 'email';

export interface SupabaseLoginToken {
  /** generateLink 返回的 hashed_token，配合 verification_type 走 verifyOtp(token_hash)。 */
  tokenHash: string;
  verificationType: SupabaseLoginVerificationType;
}

/**
 * 调用 admin.generateLink 并校验返回结构，失败时打结构化日志。
 * 对不存在的邮箱会自动建用户、对已存在邮箱返回登录链接，一步完成「建用户 + 取 token」。
 */
async function generateLoginLink(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  email: string,
) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !link.properties?.hashed_token || !link.user?.id) {
    console.error('[chaoxing-login] admin.generateLink 失败:', linkError
      ? {
          message: linkError.message,
          name: (linkError as { name?: string }).name,
          status: (linkError as { status?: number }).status,
          code: (linkError as { code?: string }).code,
          stack: linkError.stack,
        }
      : '返回结构缺少 hashed_token/user.id');
    throw new Error(`无法为超星用户生成 Supabase 登录凭据：${linkError?.message || '未知错误'}`);
  }
  return link;
}

/**
 * 将已验证的超星身份映射为 Supabase Auth 用户，并生成一次性登录 token。
 * 不创建或保存用户密码。
 */
export async function createSupabaseLoginToken(
  identity: ChaoxingIdentity,
): Promise<SupabaseLoginToken> {
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

  // 第一次 generateLink：对不存在的邮箱自动建用户（无需先 createUser，后者对已存在邮箱
  // 会 422，且在并发/重复登录时容易产生竞态），拿到 userId 后把超星资料写进 metadata。
  const first = await generateLoginLink(admin, email);
  const userId = first.user.id;
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...first.user.app_metadata, ...appMetadata },
    user_metadata: { ...first.user.user_metadata, ...userMetadata },
    email_confirm: true,
  });
  if (updateError) throw new Error(`无法同步超星用户资料：${updateError.message}`);

  // 关键：updateUserById（尤其带 email_confirm）会让上面那枚挂起的一次性 OTP 立即作废，
  // 直接拿 first.hashed_token 去 verifyOtp 会被判 otp_expired（实测新用户 signup 链接必现）。
  // 写完资料后再生成一次链接，用这枚新鲜、且一定是 magiclink 类型的 token 去验证；
  // 此时用户已存在且邮箱已确认，返回的 verification_type 稳定为 magiclink。
  const second = await generateLoginLink(admin, email);
  const verificationType = (second.properties.verification_type ??
    'magiclink') as SupabaseLoginVerificationType;

  return {
    tokenHash: second.properties.hashed_token,
    verificationType,
  };
}
