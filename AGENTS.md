# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库 / 鉴权**: Supabase（PostgreSQL + Auth）
- **大模型**: `coze-coding-dev-sdk` 中的 LLMClient，后端 SSE 流式输出

## 业务概览

本项目在超星 OAuth 登录模板之上扩展为「项目中心」——一个 Linear 风格的内部团队项目管理平台：

- 已登录用户进入 `/dashboard`，未登录用户在首页看到超星登录入口。
- 四大业务视图：仪表盘 `/dashboard`、任务看板 `/kanban`、团队 `/team`、项目设置 `/settings`。
- 任务支持 HTML5 原生拖拽跨列更新，带 `version` 乐观锁，冲突返回 409 后前端回滚并 Toast 提示。
- 内置大模型助手（普通对话、生成建设方案、生成启明星课程导入数据），SSE 增量渲染，仅面板局部 loading，不阻塞页面。
- 第三方系统可通过 `POST /api/external/push` 推送任务，按 `external_id + source` 幂等。

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
├── src/
│   ├── app/
│   │   ├── (app)/          # 登录后业务路由组，layout 校验登录
│   │   │   ├── dashboard/  # 仪表盘
│   │   │   ├── kanban/     # 任务看板
│   │   │   ├── team/       # 团队管理
│   │   │   └── settings/   # 项目设置
│   │   ├── api/            # Route Handlers
│   │   │   ├── projects/   # 项目 CRUD
│   │   │   ├── tasks/      # 任务 CRUD（PATCH 必须带 version）
│   │   │   ├── team/       # 团队成员
│   │   │   ├── activity/   # 操作日志
│   │   │   ├── stats/      # 仪表盘统计
│   │   │   ├── external/push/  # 第三方任务推送
│   │   │   ├── llm/chat/   # 大模型 SSE 对话
│   │   │   └── agent/      # 建设方案 / 启明星课程 SSE/JSON
│   │   ├── page.tsx        # 首页（未登录显示登录，已登录跳转 /dashboard）
│   │   ├── layout.tsx
│   │   └── globals.css     # 主题变量、动画、Tailwind v4 @theme
│   ├── components/
│   │   ├── ui/             # shadcn/ui 基础组件
│   │   ├── app-shell.tsx   # 登录后外壳：侧边栏 + 顶栏 + AI 助手
│   │   ├── sidebar.tsx
│   │   ├── new-task-drawer.tsx
│   │   ├── ai-assistant.tsx
│   │   ├── dashboard-view.tsx / kanban-view.tsx / team-view.tsx / settings-view.tsx
│   │   ├── modal.tsx / confirm-dialog.tsx / toast-viewport.tsx / timeline.tsx
│   │   ├── llm-loading-mask.tsx
│   │   └── theme-bootstrap.tsx
│   ├── lib/
│   │   ├── domain/         # 领域模型、Mapper、Service、HTTP 工具
│   │   │   ├── types.ts
│   │   │   ├── http.ts           # ok/fail/withApi
│   │   │   ├── api-utils.ts      # requireUser / getAdminSupabase
│   │   │   ├── mappers.ts
│   │   │   ├── project-service.ts
│   │   │   ├── task-service.ts   # 乐观锁、ConflictError
│   │   │   ├── team-service.ts
│   │   │   ├── activity-service.ts
│   │   │   ├── stats-service.ts
│   │   │   ├── llm-types.ts
│   │   │   └── llm-prompts.ts
│   │   ├── web/            # 前端基础设施（仅 'use client' 引入）
│   │   │   ├── api-client.ts     # apiFetch / apiFetchSSE
│   │   │   ├── store.ts          # useSyncExternalStore 极简 store
│   │   │   ├── app-store.ts
│   │   │   ├── toast-store.ts
│   │   │   ├── theme.ts
│   │   │   ├── operation-logger.ts
│   │   │   ├── session-context.ts
│   │   │   ├── agent-bridge.ts
│   │   │   ├── hotkeys.ts
│   │   │   └── *-web-service.ts
│   │   └── utils.ts        # cn 等通用工具
│   └── server.ts           # 自定义服务端入口
├── next.config.ts
├── package.json
├── DESIGN.md               # 视觉/交互设计规范（Linear 风格）
└── tsconfig.json
```

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 数据库

核心表：`projects`、`project_members`、`tasks`、`activity_log`、`system_configs`。

- 所有表启用 RLS；服务端业务接口使用 admin 客户端 + 显式登录校验。
- `tasks.version` 用于乐观锁，PATCH 必须带 `version`，冲突抛 409。
- 常用查询字段已建索引：`tasks(project_id,status)`、`tasks(assignee_id)`、`tasks(external_id, external_source)` 部分唯一索引、`activity_log(project_id, created_at desc)` 等。
- 触发器自动维护 `updated_at`。

## API 约定

- 所有 JSON 接口返回 `ApiResponse<T>`：成功 `{ success:true, data }`，失败 `{ success:false, error:{ code, message } }`。
- 使用 `withApi` 包装 handler 以统一 500 错误。
- SSE 接口（`/api/llm/chat`、`/api/agent/build-plan`）使用 `ReadableStream`，事件类型 `delta/done/error`。
- 第三方推送 `POST /api/external/push` 通过 `x-push-token` 或 `?token=` 鉴权，token 读取 `EXTERNAL_PUSH_TOKEN`，开发兜底值 `dev-push-token-change-me`。

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。
- 领域层（`src/lib/domain`）保持框架无关，不直接依赖 React；前端状态与请求封装放在 `src/lib/web`，且必须 `'use client'`。

### next.config 配置规范

- 配置路径不要写死绝对路径，必须使用 `path.resolve(__dirname, ...)`、`import.meta.dirname` 或 `process.cwd()` 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 `typeof window`、`Date.now()`、`Math.random()` 等动态数据。必须使用 `'use client'` 并配合 `useEffect + useState` 确保动态内容仅在客户端挂载后渲染；严禁非法 HTML 嵌套（如 `<p>` 嵌套 `<div>`）。
2. 禁止使用 `<head>` 标签，优先使用 `metadata`：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   - 三方 CSS、字体等资源可在 `globals.css` 顶部通过 `@import` 引入或使用 `next/font`。
   - `preload/preconnect/dns-prefetch` 通过 ReactDOM 的对应方法引入。
   - JSON-LD 参考：https://nextjs.org/docs/app/guides/json-ld

### 前端交互约定

- 所有网络请求走 `apiFetch`，错误由 `ApiError` 抛出，组件层 `try/catch` 后通过 `showToast` 反馈。
- 大模型请求必须使用 `apiFetchSSE` 增量渲染，配合 `LlmLoadingMask` 做局部 loading，**禁止全屏遮罩**。
- 用户关键操作通过 `logActivity()` 写入本地队列并批量上报到 `/api/activity`。
- 全局快捷键：⌘/Ctrl+1~4 切换视图，⌘N 新建任务，Esc 关闭弹窗，逻辑集中在 `src/lib/web/hotkeys.ts`。

## UI 设计与组件规范

- 基础组件使用 `src/components/ui/` 下的 shadcn/ui 组件；按钮主色使用 `bg-brand`（Indigo `#4F46E5`），不要回到默认 `primary`。
- 颜色、圆角、阴影、动画统一使用 `globals.css` 中定义的语义变量（`bg-card`、`text-muted-foreground`、`rounded-lg` 等），禁止硬编码 Hex 或 Tailwind 原生色盘。
- 视觉规范以 `DESIGN.md` 为准（Linear 风格、Zinc 灰阶、Inter + JetBrains Mono、克制动效）。

## 验证

- 修改代码后通过 `test_run` 同时跑静态检查和接口冒烟测试。
- 业务接口必须至少一条 curl 冒烟；未登录场景下 `/api/auth/me` 返回 401 属预期。
