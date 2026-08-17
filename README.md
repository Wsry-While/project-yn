# 超星登录 + Supabase 模板

基于 Next.js 16、React 19、TypeScript、shadcn/ui 和 Supabase Auth，实现超星 OAuth
登录并建立标准 Supabase Session。

## 登录流程

```text
超星授权
→ 服务端换取超星用户信息
→ 创建或同步 Supabase auth.users
→ 消费一次性 Magic Link
→ 写入 Supabase Session Cookie
```

认证接口：

| 接口 | 用途 |
| --- | --- |
| `/api/auth/chaoxing` | 发起登录 |
| `/api/auth/callback/chaoxing` | 处理超星回调 |
| `/api/auth/me` | 获取当前用户 |
| `/api/auth/logout` | 退出登录 |

## 本地开发

仅使用 pnpm：

```bash
pnpm install
cp .env.example .env
pnpm dev
```

默认访问地址：`http://127.0.0.1:5000`。

必须配置：

```env
CHAOXING_APPID=your-appid
CHAOXING_SECRET=your-appkey
CHAOXING_FIDS=your-fid
CHAOXING_REDIRECT_URI=https://your-domain/api/auth/callback/chaoxing
```

本地运行还需填写 `.env.example` 中的 Supabase 和 Coze 配置。

`CHAOXING_FIDS` 是允许登录的机构 FID 列表，多个用英文逗号分隔，可带空格。
它有两种写法，可混用，登录界面的形态由此决定：

```bash
# 只写 FID：登录界面只有一个按钮，机构靠静默轮询
CHAOXING_FIDS=1385, 344402, 110

# 写成 fid:机构名称：登录界面显示机构下拉框，登录严格限定在所选机构下
CHAOXING_FIDS=1385:超星集团, 344402:课程项目, 110:测试
```

只有配了名称且不止一个机构时才显示下拉框——裸 FID 用户认不出是哪个学校，单个机构也没得选。
混用时未配名称的项在下拉框里显示 FID 本身。两种写法的身份解析策略不同：

| | 下拉框模式 | 按钮模式 |
| --- | --- | --- |
| 机构来源 | 用户在界面上选 | 用户不感知 |
| 回调解析 | 只用所选机构调一次 `getUserByTokenFormMooc` | 按配置顺序逐个调，命中即停 |
| 账号不在该机构 | 报错，提示换一个机构重试 | 继续试下一个，全不中才报错 |

用户所选的 FID 通过超星的 `state` 参数原样带回回调（超星把 OAuth `state` 定义为机构 FID），
回调据此判定该走哪种策略。轮询过程中逐个 FID 的拒绝原因只记在服务端日志里，界面上不暴露。

## Coze 部署

Coze 实例化 Supabase 后会自动注入 `COZE_*` 变量，只需手动配置上述四个
`CHAOXING_*` 变量。

推荐流程：

1. 上传项目并实例化 Supabase。
2. 首次部署，取得公网域名。
3. 在超星后台登记：
   `https://<公网域名>/api/auth/callback/chaoxing`。
4. 在 Coze 配置四个 `CHAOXING_*` 变量，其中
   `CHAOXING_REDIRECT_URI` 必须与超星后台完全一致。
5. 重新部署并访问 `/api/auth/chaoxing` 验证登录。

`pnpm gen:env` 只会把平台已有变量同步到本地 `.env`，不会把本地变量上传到平台，
而且会覆盖现有 `.env`。如果压缩包已经包含配置好的 `.env`，不要在变量尚未写入平台前执行它。

项目不包含业务表或数据库迁移，不要执行 `pnpm db:migrate`。

## 获取当前用户

```tsx
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase-auth';

export default async function Page() {
  const session = await getSessionUser(await cookies());
  if (!session) return <div>请先登录</div>;
  return <div>你好，{session.user.chaoxing.displayName}</div>;
}
```

可信身份字段在 `session.user.chaoxing`，来自仅服务端可写的 `app_metadata.chaoxing`，
键名与超星 `getUserByTokenFormMooc` 返回的 `userInfo` 保持一致：

| 字段 | 含义 |
| --- | --- |
| `openid` | 用户在本应用下的唯一主键（来自 access_token 接口） |
| `uid` | 超星用户唯一标识 |
| `name` | 登录名，即**学工号**，不是姓名 |
| `displayName` | 用户姓名 |
| `fid` | 所在单位 FID |
| `orgName` | 所在单位名称 |
| `role` | 角色数组，元素为 `{ roleId, roleName }` |
| `loginNames` | 该单位下的所有登录名（学工号）列表 |

`session.user.profile` 里的 `displayName`、`avatar` 来自用户可修改的 `user_metadata`
（对应 `full_name`、`avatar_url`），只能用于展示，不能用于鉴权。学工号只存在
`app_metadata.chaoxing.name`，不再写入 `user_metadata`。
头像不是超星返回的字段，是按 `uid` 拼出的 `https://photo.chaoxing.com/p/<uid>_80`，不保证存在。

## 安全说明

- `CHAOXING_SECRET` 和 `COZE_SUPABASE_SERVICE_ROLE_KEY` 只能在服务端使用。
- Supabase 后台应关闭公开邮箱注册和未使用的登录 Provider。
- 新增业务表必须启用 RLS 并配置访问策略。
- Session Cookie 为兼容浏览器端 Supabase 客户端而没有启用 `httpOnly`，需严格防范 XSS。
- 超星将 OAuth `state` 用作机构 FID，当前兼容直达回调，因此不具备标准 OAuth
  随机 state 的完整 CSRF 防护。
- 退出本应用不会退出超星 Passport，重新登录时可能无感授权。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm validate` | TypeScript 和 ESLint 检查 |
| `pnpm build` | 生产构建 |
| `pnpm gen:env` | 从 Coze 同步环境变量 |
| `pnpm bundle` | 生成安全分享包 |

`pnpm bundle` 默认排除 `.env`、依赖和构建产物，只保留 `.env.example`。如需把真实
`.env` 放入压缩包，应将其视为敏感文件，禁止公开分享或提交到 Git。
