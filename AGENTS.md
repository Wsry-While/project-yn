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

本项目在超星 OAuth 登录模板之上扩展为「项目中心」——一个 Linear 风格的内部团队项目管理平台，并已落地学校业务模型：

- 已登录用户进入 `/dashboard`，未登录用户在首页看到超星登录入口。
- 核心业务视图：仪表盘 `/dashboard`、任务看板 `/kanban`、学校档案 `/schools`、项目外出 `/trips`、团队 `/team`、项目设置 `/settings`。
- 学校和部门作为客户档案；招投标、启明星建设、项目建设、日常运营等作为项目；项目内通过里程碑管理阶段。
- 项目外出是独立业务工单，后续可由第三方系统同步，也可在系统内新建。
- 任务支持 HTML5 原生拖拽跨列更新，带 `version` 乐观锁，冲突返回 409 后前端回滚并 Toast 提示。
- 内置大模型助手（普通对话、生成建设方案、生成启明星课程导入数据），SSE 增量渲染，仅面板局部 loading，不阻塞页面。
- 第三方系统可通过 `POST /api/external/push` 推送任务，按 `external_id + source` 幂等。
- 超星表单可通过 `POST /api/external/chaoxing/push` 推送项目外出数据，formId=`253633`，按 `external_source='chaoxing' + external_id=indexID` 幂等，删除/恢复使用软删除。

## 业务数据模型

- `schools`：学校主档，名称唯一，保存行业、地区、层级、第三方来源字段。
- `school_departments`：学校下的部门/院系，记录销售负责人、提交人、UID、销售团队、手机号、学工号等。
- `projects`：项目主表，支持 `project_type`（bidding/qiming/construction/operation/other）、学校、部门、行业、产品、外部来源字段。
- `project_milestones`：项目里程碑，创建项目时按项目类型初始化默认阶段。
- `tasks`：任务，支持 `task_type`、产品、里程碑、学校、来源类型、来源 ID、外部幂等字段。
- `trip_requests`：项目外出申请，字段对齐《项目外出申请.xlsx》模板，保存学校、部门、支持类型、产品、日期、销售/项目经理、完成情况、评分反馈、超星 `uuid/operator/originUid/auditStatus/rawPayload/deletedAt` 等同步字段。
- `external_sync_logs`：记录第三方接口同步日志，包含 `direction/op/form_id/index_id/operator/ip/duration_ms/status/error/payload`，用于审计和联调排障。

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本、Excel 导入脚本
├── assets/                 # 用户提供的业务 Excel 模板
├── src/
│   ├── app/
│   │   ├── (app)/          # 登录后业务路由组，layout 校验登录
│   │   │   ├── dashboard/  # 仪表盘
│   │   │   ├── kanban/     # 任务看板
│   │   │   ├── schools/    # 学校档案
│   │   │   ├── trips/      # 项目外出
│   │   │   ├── team/       # 团队管理
│   │   │   └── settings/   # 项目设置 + 里程碑
│   │   ├── api/            # Route Handlers
│   │   │   ├── projects/   # 项目 CRUD，支持项目类型/学校/产品
│   │   │   ├── tasks/      # 任务 CRUD（PATCH 必须带 version）
│   │   │   ├── milestones/ # 里程碑 CRUD
│   │   │   ├── schools/    # 学校档案查询
│   │   │   ├── trips/      # 项目外出申请
│   │   │   ├── team/       # 团队成员
│   │   │   ├── activity/   # 操作日志
│   │   │   ├── stats/      # 仪表盘统计
│   │   │   ├── external/push/  # 第三方任务推送
│   │   │   ├── external/chaoxing/push/ # 超星项目外出表单推送
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
│   │   ├── milestone-section.tsx
│   │   ├── schools-view.tsx
│   │   ├── trips-view.tsx
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
│   │   │   ├── school-service.ts
│   │   │   ├── project-service.ts
│   │   │   ├── milestone-service.ts
│   │   │   ├── task-service.ts   # 乐观锁、ConflictError
│   │   │   ├── trip-service.ts   # 外出工单、软删除、超星 upsert
│   │   │   ├── chaoxing/         # 超星 form-data 解析、字段映射
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

核心表：`schools`、`school_departments`、`projects`、`project_members`、`project_milestones`、`tasks`、`trip_requests`、`activity_log`、`system_configs`、`external_sync_logs`。

- 所有表启用 RLS；服务端业务接口使用 admin 客户端 + 显式登录校验。
- `tasks.version` 用于乐观锁，PATCH 必须带 `version`，冲突抛 409。
- 学校导入脚本：`scripts/import-schools.py`，从 `assets/学校信息汇总表.xlsx` 读取并 upsert 学校/部门。
- 项目创建时按 `project_type` 初始化默认里程碑：招投标、启明星建设、项目建设、日常运营均有阶段模板。
- 常用查询字段已建索引：`tasks(project_id,status)`、`tasks(assignee_id)`、`tasks(milestone_id)`、`tasks(external_id, external_source)`、`school_departments(school_id)`、`trip_requests(trip_date)`、`trip_requests(external_source, external_id)`、`trip_requests(deleted_at)` 等。
- 触发器自动维护 `updated_at`。

## API 约定

- 所有 JSON 接口返回 `ApiResponse<T>`：成功 `{ success:true, data }`，失败 `{ success:false, error:{ code, message } }`。
- 使用 `withApi` 包装 handler 以统一 500 错误。
- SSE 接口（`/api/llm/chat`、`/api/agent/build-plan`）使用 `ReadableStream`，事件类型 `delta/done/error`。
- 业务接口：
  - `GET /api/schools`：学校档案列表，支持 search/salesOwner/limit。
  - `GET /api/schools/:id`：学校详情及部门列表。
  - `GET/POST /api/trips`：项目外出列表/新建。
  - `GET/PATCH/DELETE /api/milestones/:id`：里程碑更新/删除。
- 第三方推送 `POST /api/external/push` 通过 `x-push-token` 或 `?token=` 鉴权，token 读取 `EXTERNAL_PUSH_TOKEN`，开发兜底值 `dev-push-token-change-me`。
- 超星推送 `POST /api/external/chaoxing/push`：
  - 仅接受 form-data / urlencoded，`data` 为 JSON 字符串数组，formId 当前配置为 `253633`。
  - 按无鉴权接入设计，不校验 `Authorization` / token，仅通过公网 HTTPS 与 formId 白名单控制入口范围。
  - `op=data_create/data_update` 时映射并 upsert 项目外出；学校按名称自动查找/创建；`auditStatus=2` 入库但标记为 rejected。
  - `op=data_remove/data_recover` 对 `trip_requests.deleted_at` 做软删除/恢复；`op=form_update` 只记录审计日志并 ack。
  - 字段映射保存在 `system_configs(key='chaoxing_form_trip').value.fieldMapping`；当前按中文 label 兜底，联调拿到真实 alias 后更新为 alias 优先。同一 label 出现多个字段时，解析器自动跳过空值字段，保留有值字段。

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
- 全局快捷键：⌘/Ctrl+1~6 切换视图，⌘N 新建任务，Esc 关闭弹窗，逻辑集中在 `src/lib/web/hotkeys.ts`。

## UI 设计与组件规范

- 基础组件使用 `src/components/ui/` 下的 shadcn/ui 组件；按钮主色使用 `bg-brand`（Indigo `#4F46E5`），不要回到默认 `primary`。
- 颜色、圆角、阴影、动画统一使用 `globals.css` 中定义的语义变量（`bg-card`、`text-muted-foreground`、`rounded-lg` 等），禁止硬编码 Hex 或 Tailwind 原生色盘。
- 业务标签使用半透明状态色；项目类型、任务类型、产品和里程碑标签保持小写工程感，不使用彩色大卡片。
- 视觉规范以 `DESIGN.md` 为准（Linear 风格、Zinc 灰阶、Inter + JetBrains Mono、克制动效）。

## 验证

- 修改代码后通过 `test_run` 同时跑静态检查和接口冒烟测试。
- 业务接口必须至少一条 curl 冒烟；未登录场景下 `/api/auth/me`、`/api/schools`、`/api/trips` 等返回 401 属预期。
