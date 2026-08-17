const CHAOXING_TOKEN_URL = 'https://auth.chaoxing.com/sns/oauth2/access_token/v1.0';
const CHAOXING_USER_URL = 'https://v1.chaoxing.com/backSchool/user/getUserByTokenFormMooc';

export interface ChaoxingRole {
  roleId: string;
  roleName: string;
}

/**
 * 字段名与超星 getUserByTokenFormMooc 返回的 userInfo 保持一致，业务代码沿用超星语义：
 * name 是学工号（登录名），displayName 才是姓名，role 是角色数组。
 * openid 例外，它来自 access_token 接口，是本应用内的用户唯一主键。
 */
export interface ChaoxingUserInfo {
  openid: string;
  uid: string;
  name: string;
  displayName: string;
  fid: string;
  orgName: string;
  role: ChaoxingRole[];
  loginNames: string[];
}

/** 超星不返回头像，avatar 是按 uid 拼出的派生字段，只能用于展示。 */
export interface ChaoxingIdentity extends ChaoxingUserInfo {
  avatar: string;
}

/**
 * 登录失败的分类，决定错误页给用户什么指引。
 * - config_missing：环境变量没配全，用户无能为力，只能找管理员
 * - institution_mismatch：轮询完 CHAOXING_FIDS 都没命中，账号不属于任何允许机构
 * - oauth_failed：超星侧授权没走通，重新发起即可
 */
export type ChaoxingLoginErrorReason =
  | 'config_missing'
  | 'institution_mismatch'
  | 'oauth_failed';

export class ChaoxingLoginError extends Error {
  readonly reason: ChaoxingLoginErrorReason;

  constructor(reason: ChaoxingLoginErrorReason, message: string) {
    super(message);
    this.name = 'ChaoxingLoginError';
    this.reason = reason;
  }
}

/** 允许登录的机构。未配名称时 name 回落成 FID 本身。 */
export interface ChaoxingInstitution {
  fid: string;
  name: string;
}

/**
 * 登录界面的两种形态，由 CHAOXING_FIDS 的写法决定：
 * - institutions 非空：配了机构名称，用户在下拉框里自选，登录严格限定在所选机构下
 * - institutions 为空：只配了裸 FID，界面只有一个按钮，机构靠回调静默轮询
 */
export interface ChaoxingLoginOptions {
  configured: boolean;
  institutions: ChaoxingInstitution[];
}

interface ChaoxingConfig {
  appid: string;
  secret: string;
  institutions: ChaoxingInstitution[];
  redirectUri: string;
}

interface ChaoxingToken {
  accessToken: string;
  openid: string;
  expiresTime: string;
  refreshToken?: string;
  scope?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function getString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''))
    .filter(Boolean);
}

function getRoles(value: unknown): ChaoxingRole[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): ChaoxingRole[] => {
    const role = asRecord(item);
    if (!role) return [];
    // 超星的 roleId 是数字，getString 会统一转成字符串。
    const roleId = getString(role, ['roleId']);
    const roleName = getString(role, ['roleName']);
    if (!roleId && !roleName) return [];
    return [{ roleId, roleName }];
  });
}

async function postFormJson(url: string, body: URLSearchParams): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  const raw = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`超星接口返回非 JSON 数据（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(`超星接口请求失败（HTTP ${response.status}）`);
  }

  return data;
}

/**
 * CHAOXING_FIDS 是逗号分隔的机构列表，允许出现空格，两种写法可混用：
 * - `1385`：只有 FID，界面上没有名字可显示
 * - `1385:超星集团`：带机构名称，名称会出现在登录界面的下拉框里
 *
 * 例：`CHAOXING_FIDS=1385:超星集团, 344402:课程项目, 110:测试`
 */
function parseInstitutions(raw: string): ChaoxingInstitution[] {
  const byFid = new Map<string, ChaoxingInstitution>();

  for (const entry of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    const fid = separator < 0 ? entry : entry.slice(0, separator).trim();
    const name = separator < 0 ? '' : entry.slice(separator + 1).trim();
    // 同一 FID 写多次只会让轮询多打无用请求，保留首次出现的位置与名称。
    if (fid && !byFid.has(fid)) byFid.set(fid, { fid, name: name || fid });
  }

  return [...byFid.values()];
}

/** 日志里用「名称（FID）」定位机构；没配名称时 name 就是 FID，不必再重复一遍。 */
function institutionLabel({ fid, name }: ChaoxingInstitution): string {
  return name === fid ? fid : `${name}（${fid}）`;
}

function getChaoxingConfig(): ChaoxingConfig {
  const appid = process.env.CHAOXING_APPID?.trim() ?? '';
  const secret = process.env.CHAOXING_SECRET?.trim() ?? '';
  const redirectUri = process.env.CHAOXING_REDIRECT_URI?.trim() ?? '';
  const institutions = parseInstitutions(process.env.CHAOXING_FIDS ?? '');

  if (!appid || !secret || !redirectUri || institutions.length === 0) {
    throw new ChaoxingLoginError(
      'config_missing',
      '缺少 CHAOXING_APPID、CHAOXING_SECRET、CHAOXING_REDIRECT_URI 或 CHAOXING_FIDS',
    );
  }

  return { appid, secret, institutions, redirectUri };
}

/**
 * 只有"配了名称且不止一个机构"时才让用户选：名称是唯一能让用户认出自己机构的信息，
 * 裸 FID 选不出所以然；只有一个机构时也没有可选项。
 * 这同时决定了身份解析策略——能选就必须选准，不能选才轮询。
 */
function requiresInstitutionChoice(institutions: ChaoxingInstitution[]): boolean {
  return institutions.length > 1 && institutions.some(({ fid, name }) => name !== fid);
}

/**
 * 决定登录界面长什么样。配置缺失时返回 configured: false 而不是抛错，
 * 否则未配置环境变量的部署会整页 500，连"登录不可用"都提示不了。
 */
export function getChaoxingLoginOptions(): ChaoxingLoginOptions {
  try {
    const { institutions } = getChaoxingConfig();
    return {
      configured: true,
      institutions: requiresInstitutionChoice(institutions) ? institutions : [],
    };
  } catch (error) {
    console.error('超星登录配置不可用:', error);
    return { configured: false, institutions: [] };
  }
}

async function exchangeChaoxingCode(code: string): Promise<ChaoxingToken> {
  const { appid, secret } = getChaoxingConfig();
  const raw = asRecord(
    await postFormJson(
      CHAOXING_TOKEN_URL,
      new URLSearchParams({ appid, secret, code, grant_type: 'authorization_code' }),
    ),
  );

  if (!raw) throw new ChaoxingLoginError('oauth_failed', '超星 Token 响应格式错误');

  const accessToken = getString(raw, ['access_token']);
  const openid = getString(raw, ['openid']);
  const expiresTime = getString(raw, ['expires_time']);
  if (!accessToken || !openid || !expiresTime) {
    const description = getString(raw, ['describe', 'errorMsg', 'errmsg', 'msg']);
    throw new ChaoxingLoginError(
      'oauth_failed',
      description || '超星未返回有效的 access_token、openid 或 expires_time',
    );
  }

  const refreshToken = getString(raw, ['refresh_token']);
  const scope = getString(raw, ['scope']);
  return {
    accessToken,
    openid,
    expiresTime,
    ...(refreshToken ? { refreshToken } : {}),
    ...(scope ? { scope } : {}),
  };
}

function getAvatarUrl(userInfo: Record<string, unknown>, uid: string): string {
  const explicit = getString(userInfo, [
    'avatar',
    'avatarUrl',
    'avatar_url',
    'headPic',
    'headpic',
    'headImg',
    'photo',
    'pic',
    'imageUrl',
  ]);
  if (explicit.startsWith('https://') || explicit.startsWith('http://')) return explicit;
  return uid ? `https://photo.chaoxing.com/p/${encodeURIComponent(uid)}_80` : '';
}

async function fetchIdentity(
  token: ChaoxingToken,
  institution: ChaoxingInstitution,
): Promise<ChaoxingIdentity | null> {
  const { fid } = institution;
  const raw = asRecord(
    await postFormJson(
      CHAOXING_USER_URL,
      new URLSearchParams({
        access_token: token.accessToken,
        openid: token.openid,
        expires_time: token.expiresTime,
        state: fid,
      }),
    ),
  );
  // 失败时超星依然返回 HTTP 200，只把 status 置 false 并给出 msg。轮询下这只说明
  // 账号不在这个 FID 里，属于正常的未命中，不能中断后续 FID；原因留在服务端日志。
  if (raw && raw.status === false) {
    console.warn(
      `超星拒绝返回 ${institutionLabel(institution)} 的用户信息:`,
      getString(raw, ['msg', 'errorMsg', 'describe']) || '未给出原因',
    );
    return null;
  }

  const userInfo = raw ? asRecord(raw.userInfo) : null;
  if (!userInfo) return null;

  const uid = getString(userInfo, ['uid', 'puid', 'id']);
  if (!uid) return null;

  // 超星的 name 是学工号，不是姓名；姓名在 displayName。别名 key 是对未按文档
  // 返回的机构做的兜底，正常机构只会命中第一个。
  const name = getString(userInfo, ['name', 'studentcode', 'username']);

  return {
    openid: token.openid,
    uid,
    name,
    displayName: getString(userInfo, ['displayName', 'realname']) || name || uid,
    fid: getString(userInfo, ['fid']) || fid,
    orgName: getString(userInfo, ['orgName', 'schoolname']),
    role: getRoles(userInfo.role),
    loginNames: getStringArray(userInfo.loginNames),
    avatar: getAvatarUrl(userInfo, uid),
  };
}

/**
 * 超星把 OAuth state 当作机构 FID 使用，发起授权时必须带一个：下拉框模式送用户
 * 选中的（回调会严格按它校验身份），按钮模式送第一个（回调会轮询其余机构）。
 */
export function getChaoxingAuthorizationConfig(requestedFid: string | null): Pick<
  ChaoxingConfig,
  'appid' | 'redirectUri'
> & { stateFid: string } {
  const { appid, redirectUri, institutions } = getChaoxingConfig();
  const requested = requestedFid?.trim();
  // 带了 FID 却不在白名单，说明前端和配置对不上，早点报出来而不是默默换一个。
  if (requested && !institutions.some(({ fid }) => fid === requested)) {
    throw new ChaoxingLoginError('institution_mismatch', '登录 FID 不在 CHAOXING_FIDS 允许列表中');
  }
  // 下拉框模式下不允许不选就登录，否则会被静默地按第一个机构严格校验。
  if (!requested && requiresInstitutionChoice(institutions)) {
    throw new ChaoxingLoginError('institution_mismatch', '发起登录时必须通过 fid 参数指定机构');
  }
  return { appid, redirectUri, stateFid: requested || institutions[0].fid };
}

/**
 * 决定拿哪些机构去问超星。callbackFid 是超星回调带回的 state，即发起授权时送出的 FID。
 * - 下拉框模式：用户已明确选了机构，只认这一个，不匹配就报错，绝不改判到别的机构
 * - 按钮模式：用户没得选，把所有机构排进候选轮询，选中的排队首少打几次请求
 */
function getIdentityCandidates(
  institutions: ChaoxingInstitution[],
  callbackFid: string,
): ChaoxingInstitution[] {
  const selected = institutions.find((item) => item.fid === callbackFid);

  if (requiresInstitutionChoice(institutions)) {
    if (!selected) {
      throw new ChaoxingLoginError('institution_mismatch', '回调 FID 不在 CHAOXING_FIDS 允许列表中');
    }
    return [selected];
  }

  return selected ? [selected, ...institutions.filter((item) => item !== selected)] : institutions;
}

/**
 * 回调只有一个 code：先换 token，再按候选机构逐个调 getUserByTokenFormMooc，
 * 第一个返回用户信息的即命中机构。候选怎么来的见 getIdentityCandidates。
 */
export async function resolveChaoxingIdentity(
  code: string,
  callbackFid: string,
): Promise<ChaoxingIdentity> {
  const { institutions } = getChaoxingConfig();
  const candidates = getIdentityCandidates(institutions, callbackFid.trim());

  const token = await exchangeChaoxingCode(code);
  for (const institution of candidates) {
    const identity = await fetchIdentity(token, institution);
    if (identity) return identity;
  }

  throw new ChaoxingLoginError(
    'institution_mismatch',
    `在 ${candidates.map(institutionLabel).join('、')} 下都没有取到超星用户信息`,
  );
}
