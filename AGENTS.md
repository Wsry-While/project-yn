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
- 核心业务视图：仪表盘 `/dashboard`、任务看板 `/kanban`、学校档案 `/schools`、项目外出 `/trips`、招投标截图 `/bidding-screenshots`、项目建设申请 `/project-demands`、启明星建设 `/qiming-construction`、团队 `/team`、项目设置 `/settings`。
- 学校和部门作为客户档案；招投标、启明星建设、项目建设、日常运营等作为项目；项目内通过里程碑管理阶段。
- 项目外出是独立业务工单，完全由超星表单推送驱动，系统内只查看/筛选/详情，不提供内部新建或编辑入口。
- 招投标截图是第三方推送驱动的只读交付跟踪数据，按销售经理、项目名称、学校、提交日期等字段建模，系统内不提供新增或编辑入口。
- 项目建设申请（`project_demands`）是超星表单（formId=`254046`，可由 `CHAOXING_DEMAND_FORM_ID` 覆盖）推送的只读需求工单，字段 alias 不连续（1,3,4,7,8,10,11,12,13,14,15,16,17,18,20,21,22,23），路由统一按 `fields[].label`（中文名）映射，不按序号兜底：项目所属年度/负责销售经理(contact)/需求类型/所属产品(multipleselect→text[])/所属单位/所属行业类别/具体事宜及需求说明(richtext→sanitize)/所提供的材料(fileupload[])/要求完成时间/项目负责人(contact多值用「、」拼接)/完成情况/预计完成时间/交付内容/交付内容（其他）/交付文档类型/交付文档上传(fileupload[])/交付信息备注(richtext)，系统内不提供新增或编辑入口，附件转存规则同招投标截图（共用 `external_file_assets` + `bidding-attachments` bucket，已登录用户通过 `/api/files/demand-attachments/:assetId` 换签名 URL 下载）。
- 启明星建设（`qiming_construction`）是超星表单推送的只读建设工单，formId 由 `CHAOXING_QIMING_FORM_ID` 指定（未配置时不做白名单过滤，仅用于联调）。字段按 `fields[].label`（中文名）映射：负责销售经理(contact)/所属年度/项目名称/是否签合同(radiobutton 是/否→boolean)/学校/学院/学校层级/建设专业/建设内容(richtext→sanitize)/建设内容特殊说明及材料(richtext→sanitize)/项目相关资料(fileupload[])/项目交付时间(dateinput 保留为 timestamptz)/负责项目经理(contact)/项目情况反馈。按 `external_source='chaoxing' + external_id=indexID` 幂等，删除/恢复使用 `deleted_at` 软删除。附件转存规则同项目建设申请，已登录用户通过 `/api/files/qiming-attachments/:assetId` 换签名 URL 下载。
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
- `trip_requests`：超星驱动的项目外出工单，按 `external_source='chaoxing' + external_id=indexID` 幂等。字段按真实表单反向建模：编号/年度/学校/行业/支持类型/产品/富文本事宜/日期时间/周几/销售与项目经理联系人/完成与反馈评分；richtext 拆 `*_html` + `*_text` 并在入库前 sanitize，contact 拆 `*_name/*_puid/*_enc`，布尔字段使用 boolean，删除/恢复使用 `deleted_at` 软删除。
- `trip_option_dict`：项目外出选项自学习字典，按 `(field_key, source_value)` 唯一；超星推送出现的新支持类型、行业、产品会自动登记并启用，前端筛选用此表。
- `bidding_screenshots`：招投标截图第三方推送数据，按 `(external_source, external_id)` 唯一；记录销售经理、项目名称、学校/二级单位、是否公司参数、提交日期、需交付日期、预留天数、项目招标文件、类别、截图需求、项目经理、完成情况、交付文档/备注、需求达成、销售反馈、附件、整改反馈与整改文档；删除/恢复使用 `deleted_at` 软删除。
- `qiming_construction`：启明星建设超星推送数据，按 `(external_source, external_id)` 唯一；记录负责销售经理/所属年度/项目名称/是否签合同/学校/学院/学校层级/建设专业/建设内容(richtext html+text)/建设内容特殊说明(richtext)/项目相关资料(jsonb 文件数组)/项目交付时间(timestamptz)/负责项目经理/项目情况反馈；删除/恢复使用 `deleted_at` 软删除。
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
│   │   │   ├── bidding-screenshots/ # 招投标截图
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
│   │   │   ├── external/bidding-screenshots/push/ # 招投标截图第三方推送
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
│   │   ├── bidding-screenshots-view.tsx
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
│   │   │   ├── trip-service.ts   # 外出只读查询、超星 upsert、软删除/恢复
│   │   │   ├── trip-option-service.ts # 外出选项字典自学习
│   │   │   ├── bidding-screenshot-service.ts # 招投标截图第三方 upsert/软删除
│   │   │   ├── bidding-normalize.ts # 招投标截图字段标准化
│   │   │   ├── sanitize.ts       # richtext 入库前清洗
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

核心表：`schools`、`school_departments`、`projects`、`project_members`、`project_milestones`、`tasks`、`trip_requests`、`trip_option_dict`、`bidding_screenshots`、`activity_log`、`system_configs`、`external_sync_logs`。

- 所有表启用 RLS；服务端业务接口使用 admin 客户端 + 显式登录校验。
- `tasks.version` 用于乐观锁，PATCH 必须带 `version`，冲突抛 409。
- 学校导入脚本：`scripts/import-schools.py`，从 `assets/学校信息汇总表.xlsx` 读取并 upsert 学校/部门。
- 项目创建时按 `project_type` 初始化默认里程碑：招投标、启明星建设、项目建设、日常运营均有阶段模板。
- 常用查询字段已建索引：`tasks(project_id,status)`、`tasks(assignee_id)`、`tasks(milestone_id)`、`tasks(external_id, external_source)`、`school_departments(school_id)`、`trip_requests(trip_date)`、`trip_requests(support_type)`、`trip_requests(school_name)`、`trip_requests(external_source, external_id)` 部分唯一索引、`trip_requests(deleted_at)`、`trip_option_dict(field_key, source_value)` 唯一索引、`bidding_screenshots(project_school)`、`bidding_screenshots(sales_manager)`、`bidding_screenshots(due_delivery_date)`、`bidding_screenshots(deleted_at)`、`qiming_construction(project_year)`、`qiming_construction(sales_manager)`、`qiming_construction(school)`、`qiming_construction(project_name)`、`qiming_construction(project_delivery_time)`、`qiming_construction(deleted_at)`、`qiming_construction(external_source, external_id)` 唯一索引。
- 触发器自动维护 `updated_at`。

## API 约定

- 所有 JSON 接口返回 `ApiResponse<T>`：成功 `{ success:true, data }`，失败 `{ success:false, error:{ code, message, details } }`。
- 统一错误码：`unauthorized` 表示登录会话失效；参数错误使用 `invalid_param`；未捕获异常使用 `internal_error`。只有 `/api/external/push`（第三方任务推送）使用 token 鉴权，其失败码为 `missing_push_token` / `invalid_push_token` / `push_token_not_configured`。
- 使用 `withApi` 包装 handler 以统一 500 错误。
- SSE 接口（`/api/llm/chat`、`/api/agent/build-plan`）使用 `ReadableStream`，事件类型 `delta/done/error`。
- 业务接口：
  - `GET /api/schools`：学校档案列表，支持 search/salesOwner/limit。
  - `GET /api/schools/:id`：学校详情及部门列表。
  - `GET /api/trips`：项目外出只读列表，支持 search/supportType/year/limit/offset，返回 `{rows,total}`。
  - `GET /api/trips/:id`：单条项目外出详情。
  - `GET /api/trips/options?fieldKey=support_type`：外出选项字典，用于筛选；未知选项由超星推送自动学习。
  - `GET /api/bidding-screenshots`：招投标截图只读列表，支持 search/completionStatus/salesManager/overdue/limit/offset，返回 `{rows,total}`。
  - `GET /api/bidding-screenshots/:id`：单条招投标截图详情。
  - `GET /api/project-demands`：项目建设申请只读列表，支持 search/year/salesManager/completionStatus/limit/offset，返回 `{rows,total}`。
  - `GET /api/project-demands/:id`：单条项目建设申请详情。
  - `GET /api/qiming-construction`：启明星建设只读列表，支持 search/year/salesManager/school/limit/offset，返回 `{rows,total}`。
  - `GET /api/qiming-construction/:id`：单条启明星建设详情。
  - `GET/PATCH/DELETE /api/milestones/:id`：里程碑更新/删除。
- 第三方推送 `POST /api/external/push` 通过 `x-push-token`、`Authorization: Bearer` 或 `?token=` 鉴权，token 读取 `EXTERNAL_PUSH_TOKEN`，开发兜底值 `dev-push-token-change-me`。
- 第三方招投标截图推送 `POST /api/external/bidding-screenshots/push`：
  - 与超星项目外出推送保持一致，按无鉴权接入设计，不校验 `Authorization` / token，入口仅通过公网 HTTPS + `formId=254045` 白名单 + 业务幂等键控制。
  - 接受 JSON 对象/数组、`multipart/form-data`、`application/x-www-form-urlencoded`、`text/plain`(JSON 字符串)。
  - **真实超星推送格式**：顶层 meta（`formId/indexID/uid/op/formData`）+ `formData` 为字段数组，每项 `{compt,alias,values}`。`compt` 取值：contact/editinput/edittextarea/selectbox/radiobutton/dateinput/numberinput/fileupload/multipleselect/richtext。按 alias 固定映射：salesManager/projectName/projectSchool/projectSecondaryUnit/isCompanyParameter/submissionDate/dueDeliveryDate/reservedDays/projectBiddingFile/projectCategory/screenshotRequirement/assignedProjectManager/completionStatus/deliveryDocument/deliveryRemark/isMeetScreenshotRequirement/salesFeedback/attachments/rectificationFeedback/rectifiedDocument。
  - form-data / urlencoded 场景：
    - 超星标准推送：`formData` 字段为 JSON 字符串数组（每项 `{compt,alias,values}`），顶层携带 `op/formId/indexID/uid/uname` 等 meta，接口会按 alias/compt 展平后入库；
    - 也可把业务 JSON 数组放在 `data` 字段里；
    - 或者把业务字段直接摊平在表单字段里；
    - 顶层 `op/externalId/externalSerial/operator` 会作为 meta 透传给每条记录。
  - 顶层可传 `externalId/externalSerial/op/operator/records/data/list/items`，也可直接把业务字段放在顶层；`records/data/list/items` 数组中的每个元素作为一条业务记录。
  - `op=data_create/data_edit/data_update/data_flow/upsert` 按字段映射 upsert；`op=data_remove/remove/delete` 软删除；`op=data_recover/recover` 恢复；`op=form_update` 仅记录审计日志并 ack；formId 不匹配返回 skipped。
  - 必填字段缺失、op 不支持、externalId 缺失等场景返回 `422 invalid_param` 并在 `details.results` 中给出每条失败原因；禁止静默 `skipped` 吞掉业务写入失败。
  - 每次推送都写 `external_sync_logs`（source=`bidding-screenshot`，status=`success/failed/skipped`），用于联调排障；单条原始 formData 存在 `bidding_screenshots.raw_payload`。
  - 必填字段：销售经理、项目名称、项目所属学校、提交日期。
  - 文件字段统一为 `BiddingFileRef`（`{name,url?,objectId?,resid?,enc?,puid?,suffix?,size?,byteSize?,modifyDate?,type?,assetId?,bucket?,storageKey?,storageStatus?,storedAt?,storageError?}`）或该对象数组；超星 fileupload 只有 `objectId/resid` 没有外链时 `url=null`。
  - 附件转存：upsert 成功后通过 Next.js `after()` 异步触发 `processBiddingAttachments`，按 `(source='chaoxing', object_id)` 幂等下载（UA=`ProjectCenter-ChaoXing-FileProxy/1.0`，Referer 必须为空，32 位 hex objectId 校验防 SSRF，100MB 上限、30s 超时），上传到 Supabase Storage bucket `bidding-attachments`（可由 `STORAGE_BUCKET` 覆盖以区分环境）。转存状态回写 `external_file_assets` 与业务记录附件 JSONB（`storageStatus: pending/fetching/stored/failed`）。已登录用户通过 `GET /api/files/attachments/:assetId` 换签名 URL 后 307 重定向下载。
  - `projectCategory`（multipleselect）存 `text[]`；`assignedProjectManager`（多 contact）把 `uname` 用「、」拼接；`isCompanyParameter/isMeetScreenshotRequirement`（radiobutton 是/否）存 boolean；日期字段按本地 `YYYY-MM-DD` 存储，不走 UTC 偏移。
- 超星推送 `POST /api/external/chaoxing/push`：
  - 仅接受 form-data / urlencoded，`data` 为 JSON 字符串数组，固定处理 formId=`253633`。
  - 按无鉴权接入设计，不校验 `Authorization` / token，仅通过公网 HTTPS 与 formId 白名单控制入口范围。
  - `op=data_create/data_edit/data_update/data_flow` 按 alias 固定映射并 upsert 项目外出；学校按名称自动查找/创建；`auditStatus=2` 入库但标记为 rejected。
  - `op=data_remove/data_recover` 对 `trip_requests.deleted_at` 做软删除/恢复；`op=form_update` 只记录审计日志并 ack；formId 不匹配返回 skipped。
  - alias 映射：1 编号、35 年度、3 销售经理 contact、33 学校、27 行业、4 支持类型、23 其他类型说明、26 产品多选、8 具体事宜 richtext、9 外出日期、10 开始时间、11 结束时间、36 周几（1=周一...7=周日）、13 项目经理 contact、14 是否完成、37 汇报一致、15 服务内容简述、28 销售迟到、16 销售评分、29 服务迟到、32 综合评分、17 整体评价。
  - `richtext` 入库前经 `src/lib/domain/sanitize.ts` 清洗脚本/事件/危险标签，保存 html+text；`contact` 保存 name/puid/enc；`selectmultibox` 保存为 string[]；`rate/numberinput` 保存为 number；`dateinput` 支持日期与日期时间。
- 超星推送 `POST /api/external/qiming-construction/push`：
  - 与项目外出/项目建设申请保持一致的无鉴权接入；formId 由 `CHAOXING_QIMING_FORM_ID` 指定，未配置时不做白名单过滤（联调用），配好后不匹配返回 skipped。
  - 字段按 `fields[].label`（中文名）固定映射：负责销售经理(contact)/所属年度/项目名称/是否签合同(radiobutton 是/否，存 boolean)/学校/学院/学校层级/建设专业/建设内容(richtext→sanitize)/建设内容特殊说明及材料(richtext→sanitize)/项目相关资料(fileupload[])/项目交付时间(dateinput 存 timestamptz)/负责项目经理(contact)/项目情况反馈(edittextarea)。
  - `op=data_create/data_edit/data_update/data_flow` upsert；`data_remove/data_recover` 软删/恢复；`form_update` ack；按 `external_source='chaoxing' + external_id=indexID` 幂等。
  - 每次推送写 `external_sync_logs`（source=`qiming-construction`）；附件转存规则与项目建设申请一致（共用 `external_file_assets` + `bidding-attachments` bucket，已登录用户通过 `/api/files/qiming-attachments/:assetId` 换签名 URL 下载）。

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
- 全局快捷键：⌘/Ctrl+1~7 切换视图，⌘N 新建任务，Esc 关闭弹窗，逻辑集中在 `src/lib/web/hotkeys.ts`。

## UI 设计与组件规范

- 基础组件使用 `src/components/ui/` 下的 shadcn/ui 组件；按钮主色使用 `bg-brand`（Indigo `#4F46E5`），不要回到默认 `primary`。
- 颜色、圆角、阴影、动画统一使用 `globals.css` 中定义的语义变量（`bg-card`、`text-muted-foreground`、`rounded-lg` 等），禁止硬编码 Hex 或 Tailwind 原生色盘。
- 业务标签使用半透明状态色；项目类型、任务类型、产品和里程碑标签保持小写工程感，不使用彩色大卡片。
- 视觉规范以 `DESIGN.md` 为准（Linear 风格、Zinc 灰阶、Inter + JetBrains Mono、克制动效）。

## 验证

- 修改代码后通过 `test_run` 同时跑静态检查和接口冒烟测试。
- 业务接口必须至少一条 curl 冒烟；未登录场景下 `/api/auth/me`、`/api/schools`、`/api/trips`、`/api/bidding-screenshots` 等返回 401 属预期。
