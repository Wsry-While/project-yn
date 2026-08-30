# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库 / 鉴权**: Supabase（PostgreSQL + Auth）
- **大模型**: `coze-coding-dev-sdk` 中的 LLMClient，后端 SSE 流式输出；模型按场景选择（`getModelForScenario`），日常对话/周报/NL 解析走 Lite，建设方案/招投标评分项/截图建议/截图视觉理解走 Seed 2.0 Pro（多模态），可用 `LLM_MODEL_LITE`/`LLM_MODEL_PRO` 覆盖。

## 业务概览

本项目在超星 OAuth 登录模板之上扩展为「项目中心」——一个企业信息化驾驶舱风格的内部团队项目管理平台，并已落地学校业务模型：

- 已登录用户进入 `/dashboard`，未登录用户在首页看到超星登录入口。
- 超星登录建会话链路（`src/lib/supabase-chaoxing-user.ts` + `src/app/api/auth/callback/chaoxing/route.ts`）用虚拟邮箱 `chaoxing_<sha256(openid)>@oauth.invalid` 映射 Supabase Auth。必须严格按此时序，否则回调报 `403 otp_expired`（Email link is invalid or has expired）跳到 `/auth/error?reason=session_failed`：① `admin.generateLink({type:'magiclink'})`（对不存在邮箱自动建用户）→ ② `admin.updateUserById({app_metadata, user_metadata, email_confirm:true})` 写超星资料 → ③ **再调一次 `generateLink`**，用这枚新鲜 token 的 `properties.hashed_token` + `properties.verification_type` 给 `supabase.auth.verifyOtp({token_hash, type})` 验证。原因：本实例 `mailer_autoconfirm=true`，第②步会让第①步那枚挂起 OTP 立即作废；且新用户首枚链接的 `verification_type` 是 `signup` 而非 `magiclink`，类型必须取自 generateLink 返回值，不能写死。实测「生成→更新→直接验证」必现 otp_expired。
- 核心业务视图：仪表盘 `/dashboard`、我的工作台 `/workbench`、任务看板 `/kanban`、学校档案 `/schools`、项目外出 `/trips`、招投标截图 `/bidding-screenshots`、项目建设申请 `/project-demands`、启明星建设 `/qiming-construction`、团队 `/team`、项目设置 `/settings`。
- 学校和部门作为客户档案；招投标、启明星建设、项目建设、日常运营等作为项目；项目内通过里程碑管理阶段。
- 项目外出是独立业务工单，完全由超星表单推送驱动，系统内只查看/筛选/详情，不提供内部新建或编辑入口。
- 招投标截图是第三方推送驱动的只读交付跟踪数据，按销售经理、项目名称、学校、提交日期等字段建模，系统内不提供新增或编辑入口。
- 项目建设申请（`project_demands`）是超星表单（formId=`254046`，可由 `CHAOXING_DEMAND_FORM_ID` 覆盖）推送的只读需求工单，字段 alias 不连续（1,3,4,7,8,10,11,12,13,14,15,16,17,18,20,21,22,23），路由统一按 `fields[].label`（中文名）映射，不按序号兜底：项目所属年度/负责销售经理(contact)/需求类型/所属产品(multipleselect→text[])/所属单位/所属行业类别/具体事宜及需求说明(richtext→sanitize)/所提供的材料(fileupload[])/要求完成时间/项目负责人(contact多值用「、」拼接)/完成情况/预计完成时间/交付内容/交付内容（其他）/交付文档类型/交付文档上传(fileupload[])/交付信息备注(richtext)，系统内不提供新增或编辑入口，附件转存规则同招投标截图（共用 `external_file_assets` + `bidding-attachments` bucket，已登录用户通过 `/api/files/demand-attachments/:assetId` 换签名 URL 下载）。
- 启明星建设（`qiming_construction`）是超星表单推送的只读建设工单，formId 由 `CHAOXING_QIMING_FORM_ID` 指定（未配置时不做白名单过滤，仅用于联调）。字段按 `fields[].label`（中文名）映射：负责销售经理(contact)/所属年度/项目名称/是否签合同(radiobutton 是/否→boolean)/学校/学院/学校层级/建设专业/建设内容(richtext→sanitize)/建设内容特殊说明及材料(richtext→sanitize)/项目相关资料(fileupload[])/项目交付时间(dateinput 保留为 timestamptz)/负责项目经理(contact)/项目情况反馈。按 `external_source='chaoxing' + external_id=indexID` 幂等，删除/恢复使用 `deleted_at` 软删除。附件转存规则同项目建设申请，已登录用户通过 `/api/files/qiming-attachments/:assetId` 换签名 URL 下载。
- 任务支持 HTML5 原生拖拽跨列更新，带 `version` 乐观锁，冲突返回 409 后前端回滚并 Toast 提示。
- 内置大模型助手（普通对话、生成建设方案、生成启明星课程导入数据），SSE 增量渲染，仅面板局部 loading，不阻塞页面。
- 第三方系统可通过 `POST /api/external/push` 推送任务，按 `external_id + source` 幂等。
- 超星表单可通过 `POST /api/external/chaoxing/push` 推送项目外出数据，formId=`253633`，按 `external_source='chaoxing' + external_id=indexID` 幂等，删除/恢复使用软删除。

### 六大增值分析模块

在四张只读业务表（招投标/建设申请/启明星/项目外出）之上构建跨源聚合与分析能力，全部为只读：

- **项目生命周期时间线**：学校 360 视图内，`School360Service.buildThreads()` 按 `normalizeProjectName()`（去除"项目/工程/建设/一期/二期"等后缀后归一）把同一项目名下的招投标→建设申请→启明星→外出记录聚合成一条主线，前端组件 `SchoolProjectThreads` 以四源节点时间线呈现，直观看到从商机到交付的全过程。
- **风险预警雷达**：`RiskService.list()` 跨四源跑规则引擎，输出 high/medium/insight 三级风险。规则含：招投标逾期（`due_delivery_date < today` 且未完成）、预留天数≤3、未满足截图需求；建设申请逾期/7天内到期；启明星未签合同且临近交付/已逾期；项目外出综合评分≤2、负面反馈；高频外出但无立项。页面 `/risks`，接口 `GET /api/risks`（支持 severity/ownerId 过滤）。
- **客户经理 360**：`Person360Service.get(personId)` 与学校 360 对称，按 `sales_manager_id` 聚合四源数据，输出 KPI（在办/本月外出/均分/逾期率）、近 6 月堆叠业务量、评分趋势、Top 学校、最近动态。页面 `/team/[id]`，接口 `GET /api/team/:id/360`。
- **AI 周报**：`WeeklyReportService.build(filter)` 按时间范围（默认近 7 天，可按销售/学校过滤）汇总四源数据与风险，`POST /api/reports/weekly/generate` 通过 SSE 流式生成五段式 Markdown 周报（概览/进展/交付/风险/下周计划），先发 `meta` 事件（range+summary）再发 `delta`；前端支持复制与下载 `.md`。数据预览接口 `GET /api/reports/weekly/data`。
- **数据对齐工作台**：`DataAlignService` 读取 `data_align_queue`，按 entity_type/status 筛选待人工复核的解析记录，支持 PATCH 标记 resolved/ignored 并写 resolution_note。页面 `/data-align`，接口 `GET /api/data-align`、`PATCH /api/data-align/:id`。
- **多维分析台 + 学校健康分 + 自然语言查询**：`AnalyticsService.dimension()` 支持 school/industry/sales/product/year 五维 × volume/ontime/score/trips 四指标的 Top N 排名；`AnalyticsService.schoolHealth()` 按活跃度 0.2 / 满意度 0.25 / 转化 0.2 / 准时率 0.2 / 合同 0.15 加权计算 0–100 健康分并给出雷达图五维；`POST /api/analytics/nl-query` 用 LLM 把中文问题解析为 `{source, filters, intent}` 后执行 Supabase 查询并返回带跳转链接的结果行。页面 `/analytics`。

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
- `team_members`：员工基础数据表，以超星 `puid` 为稳定标识（唯一），name 为 fallback；四张业务表的 `sales_manager_id` / `project_manager_id` / `assigned_pm_id` 外键都指向它，替代早期纯中文姓名存储。推送时由 `TeamMemberService.upsertByContact` 自动 upsert，多项目经理写入 `qiming_pm_members` / `bidding_pm_members` / `project_demand_managers` 关联表。
- `dict_options`：统一字典表（category+value 唯一，支持 aliases 别名数组），取代早期分散的 `trip_option_dict` 和业务表里的裸文本枚举。推送时 `DictService.normalize(category, rawValue)` 做「精确→别名→自动登记」三级归一，未命中值自动登记为新 option（自学习），管理员事后在字典管理页合并/重命名。已启用分类：`trip_support_type` / `trip_industry` / `trip_product` / `bidding_category` / `bidding_completion` / `demand_type` / `industry_category` / `school_level` / `build_major`。
- `school_aliases` / `school_department_aliases`：学校与部门别名表，支持同一学校多个名称（如"XX大学"与"XX大学XX校区"）命中同一 `school_id`。`ReferenceResolver.resolveSchool/resolveDepartment` 按「精确名称→别名→规范化（去空格/全角空格/括号备注）→子串模糊→自动创建」五级查找，四张业务表推送时统一调用。
- 业务表设计原则：**旧中文文本列（`sales_manager` / `school` / `college` / `support_type` 等）全部保留为快照，不删不改 NOT NULL 约束**；新增的 uuid 外键列与 `*_norm` 标准化列承载规范化引用，用于关联查询、"我的工作台"按当前用户聚合、学校 360 视图等深度应用。历史数据通过 `scripts/backfill-master-data.ts` 回填，支持 `--dry-run` 和 `--table=...`。
- `data_align_queue`：数据对齐队列表，记录自动解析置信度不足或字典未命中需要人工复核的字段（entity_type/entity_id/field/raw_value/reason/suggestion_id/status），供"数据对齐"管理台批量处理。
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
│   │   │   ├── parse/            # 文档解析：docx 抽图(mammoth)、pdf/docx 文本抽取
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
├── DESIGN.md               # 视觉/交互设计规范（企业信息化驾驶舱风格）
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
- SSE 接口（`/api/llm/chat`、`/api/agent/build-plan`、`/api/reports/weekly/generate`）使用 `ReadableStream`，事件类型 `delta/done/error`；周报生成额外先发 `meta` 事件。`apiFetchSSE` 的 handlers 支持 `onMeta` 回调。
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
  - `GET /api/risks`：跨四源风险预警，支持 severity（high/medium/insight）、ownerId 过滤，返回 `RiskSummary`。
  - `GET /api/team/:id/360`：客户经理 360 视图，按 sales_manager_id 聚合四源 KPI/趋势/Top 学校。
  - `GET /api/reports/weekly/data`：周报数据预览，支持 startDate/endDate/days/salesManagerId/schoolId。
  - `POST /api/reports/weekly/generate`：AI 周报 SSE 流式生成，事件 `meta`（range+summary）/`delta`/`done`/`error`。
  - `GET /api/data-align` / `PATCH /api/data-align/:id`：数据对齐队列查询与状态更新（pending/resolved/ignored + resolution_note）。
  - `GET /api/analytics/dimension`：多维排名，参数 dimension（school/industry/sales/product/year）、metric（volume/ontime/score/trips）、limit。
  - `GET /api/analytics/school-health`：学校健康分（五维加权），参数 limit。
  - `POST /api/analytics/nl-query`：自然语言查询，body `{query}`，LLM 解析后返回 `{intent,source,count,rows[]}`，rows 带 url 跳转。
  - 附件通用访问（登录即可）：`GET /api/files/meta/:assetId`（元数据+预览类型）、`GET /api/files/preview/:assetId`（307 到可内联的签名 URL，Office 返回 415）、`POST /api/files/:assetId/retry`（重新转存失败/待处理附件，超大文件降级 direct）。业务下载老路由 `/api/files/attachments|demand-attachments|qiming-attachments/:assetId` 保留，均委托给 `src/lib/domain/asset-access.ts`。
  - 截图知识库 1.0：`screenshot_parameter_mappings`（参数↔图片映射，按 example_id+parameter_key 幂等）+ `knowledge_base_versions`（版本/计数/状态）两表支撑。`POST /api/admin/kb/learn`（仅超管，SSE）由 `ScreenshotKnowledgeService.learnAll()` 全库扫描未删除招投标记录：主力来源是**贴满截图的 Word 交付文档（delivery_document 为 .docx）**——`fetchAndExtractDocx()` 下载 docx（有 assetId 走对象存储；storageStatus=direct/无 assetId 时用 `getChaoxingDirectDownloadUrl(objectId)` 现换超星签名并带 `Referer: https://office.chaoxing.com/`，objectId 可从 url 的 `?objectid=` 解析），再经 `src/lib/domain/parse/docx-images.ts` 的 `extractImagesFromDocx()`（mammoth `convertImage` 回调，注意入参是 `{buffer}` 不是 `{arrayBuffer}`）逐张抽内嵌图，用占位符在 HTML 中回溯前文「▲/编号/支持…」参数标题作为 contextHint，按内容 FNV-1a hash 跨 docx 去重后上传到 Storage（source=`kb-docx`，按 object_id=hash 幂等）；独立图片附件作为兼容来源一并扫描。每张图走 `bidding-vision-param`（Pro 多模态，带 contextHint）输出 {systemModule,pagePath,parameters[{name,evidenceElements,note,confidence}]}。**注意：图片以 base64 data URL 内联随请求发送，不用 Storage 签名 URL**——火山托管 Supabase 的下载域名对 LLM 服务端网络不可达，传签名 URL 会 `URL is not reachable: HTTP 404`。assetId 仍上传 Storage，仅供前端预览/指导书展示。，upsert `bidding_screenshot_examples` 与参数映射，版本号 `1.YYYYMMDDHHmm`；`GET /api/admin/kb/learn` 返回最新 ready 版本。`ScreenshotExampleService.searchByParameter(keywords, {limit,kbVersion})` 的召回规则（务必注意，改错会导致指导书全 0 匹配）：① **不按 kb_version 硬过滤**——版本是每次全库学习滚动生成的，评分项生成时的 latestReady 版本号与 mappings 实际写入版本经常错位（历史 404 时代 ready 版本下一条映射都没有），跨所有版本召回、让高置信度/新版本自然排前；`kbVersion` 仅作同分 +0.05 优先。② **不要把评分项 `category`（如"技术参数"）当系统模块拼进 parameter_key**——视觉库 key 前缀是真实业务模块（`知识图谱:`/`微课:`/`ai助教:`…），用 category 当前缀会让精确与 ilike 全部落空。③ 召回内部用 `extractMatchTerms()` 把评分项标题（如「知识图谱支持课程章节一键转化」）拆成模块词（MODULE_HINTS）+ 功能短语，分别 ilike `system_module`/`parameter_key` 前缀与 `parameter_key`/`parameter_name`，按 (模块命中+2/功能词命中+2/vision_note+0.5 + confidence/100) 打分，同 asset 保留最高分。指导书调用只传 `[row.title]`。实测真实评分项召回覆盖率 21/22=95%。
  - 截图作业指导书：`POST /api/bidding-screenshots/[id]/screenshot-guide`（SSE step/done/error，登录即可）由 `ScreenshotGuideService.generate()` 读最新 ready 的 `bidding_documents` → 读其 `bidding_score_items` 中 delivery_method='screenshot' 且 match_status<>'na' 的项 → 对每项 `searchByParameter` 召回 Top3 参考图 → 分批（≤15/批）调 LLM(bidding-advice) 生成「到哪个菜单/截什么/如何证明」作业说明，一次性下发完整 `ScreenshotGuide`。前端 `screenshot-guide-dialog.tsx` 左右分栏（左参数列表+状态，右参考图切换+可编辑说明），用户可改说明、切状态(ready/pending/na)；`POST /api/bidding-screenshots/[id]/screenshot-guide/export` 接收编辑后的 guide，由 `buildScreenshotGuideDocx()`（src/lib/domain/screenshot-guide-export.ts）实时生成 Word（封面+概览+清单表+逐项说明+首张参考图），不入库。入口在交付文档面板「截图指导书」按钮（需已有已确认文档），超管在「项目设置」底部「截图知识库 1.0」卡片触发全库学习。
  - 招投标 AI 截图闭环：`POST /api/agent/bidding-score-items`（读招标文件 PDF/docx，SSE 流式输出评分项 JSON，scenario=`bidding-score`，走 Pro 模型）、`GET /api/bidding-screenshots/examples?keywords=`（召回历史截图示例，>30 天标记 stale）、`POST /api/agent/bidding-screenshot-advice`（评分项+历史示例→SSE Markdown 截图作业指导，scenario=`bidding-advice`）、`POST /api/agent/bidding-learn`（对交付截图做多模态视觉理解，写入 `bidding_screenshot_examples`，scenario=`bidding-vision`）。文档解析在 `src/lib/domain/parse/document-parser.ts`（pdf-parse + mammoth，6 万字符截断，自动定位评分办法章节）。
  - 招投标交付文档与督办（项目部内部使用）：`POST /api/bidding-screenshots/[id]/generate-document`（SSE：解析招标文件→LLM 抽取评分项→匹配 `bidding_screenshot_examples`→写入 `bidding_score_items`/`bidding_documents`）、`GET /api/bidding-screenshots/[id]/document`（最新文档 + 评分项 + 督办任务）、`GET /api/bidding-screenshots/progress?ids=`（列表页批量进度摘要）、`PATCH /api/bidding-screenshots/[id]/score-items/[itemId]`（matched/pending/task_created/uploaded/na 五态切换）、`POST /api/bidding-screenshots/[id]/score-items/[itemId]/followup-task`（创建督办任务，支持内部 team_members 或外部协作人 externalAssigneeName/Contact/Org）、`PATCH /api/bidding-screenshots/followup-tasks/[taskId]`、`GET /api/bidding-screenshots/team/options`、`GET /api/bidding-screenshots/[id]/document/download?format=docx|pdf[&regenerate=1]`（实时生成 docx/pdf；docx 嵌入命中截图，待补充项标黄；首次生成后缓存到 `external_file_assets` + `bidding_documents.docx_asset_id/pdf_asset_id`；PDF 走 pdfkit 文本版，截图请使用 docx）。三张表 `bidding_score_items` / `bidding_documents` / `bidding_followup_tasks` 已加 RLS 与 updated_at 触发器，按 record_id 级联删除；前端入口在 `src/components/bidding-document-panel.tsx`，已嵌入招投标详情抽屉，列表行新增「文档进度」列。
- 第三方推送 `POST /api/external/push` 通过 `x-push-token`、`Authorization: Bearer` 或 `?token=` 鉴权，token 读取 `EXTERNAL_PUSH_TOKEN`，开发兜底值 `dev-push-token-change-me`。
- 健康检查 `GET /api/health`（无 DB，给保活探针/负载均衡用），`GET /api/health?deep=1` 同时探测 Supabase，返回 `{status,uptime,db,ts,durationMs}`，异常时 HTTP 503。
- 生产保活：`src/instrumentation.ts` 在 Node.js runtime 启动后每 4 分钟自请求 `/api/health`，降低 FaaS 空闲回收导致的冷启动概率。可通过 `KEEPALIVE_INTERVAL_MS` 调整间隔，`DISABLE_KEEPALIVE=1` 关闭。
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
  - 附件转存：upsert 成功后通过 Next.js `after()` 异步触发 `processBiddingAttachments`，按 `(source='chaoxing', object_id)` 幂等下载。下载流程（见 `src/lib/domain/chaoxing/file-tool.ts`，2026-01 联调确认）：先 `GET https://mooc1.chaoxing.com/ananas/status/{objectId}`（匿名，浏览器 UA + `Referer: https://office.chaoxing.com/`）换取返回体里带临时签名 `at_/ak_/ad_` 的 `download` 地址，再请求该地址下载；签名必须现换现下、不可缓存。直接访问裸地址 `https://d0.cldisk.com/download/{objectId}` 会被 CDN 边缘 403（与来源 IP 无关，缺签名即拒）。32 位 hex objectId 校验防 SSRF，默认 250MB 上限（可由 `CHAOXING_MAX_FILE_MB` 覆盖，已观测到 195MB 源文件）、状态接口 30s 超时、文件下载 120s 超时；超过上限的源文件会标记 `failed: too_large`。上传到 Supabase Storage bucket `bidding-attachments`（可由 `STORAGE_BUCKET` 覆盖以区分环境）。注意当前 Supabase 实例单文件上传有上限（实测约 50MB，超过返回 `maximum allowed single file size`），该错误由 `isStorageFileTooLargeError()` 识别，附件会**降级为超星直链**：`external_file_assets.status` 与业务记录 `storageStatus` 置为 `direct`（CHECK 约束 `chk_external_file_asset_status` 已含 `direct`），`error_message` 记「超大文件，走超星直链下载」；用户下载时 `getAssetSignedUrl()` 实时调用 `getChaoxingDirectDownloadUrl(objectId)` 换取新鲜签名 URL，307 跳转，响应带 `Referrer-Policy: origin`（超星直链为 http，https→http 协议降级时默认会剥离 Referer 触发 403，origin 策略保证仍发送我方 origin，且我方域名已在超星白名单）。普通小文件转存状态为 `stored`，走对象存储签名 URL。已登录用户通过 `GET /api/files/attachments/:assetId`（启明星 `/api/files/qiming-attachments/:assetId`、建设申请 `/api/files/demand-attachments/:assetId`）下载。
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

- 基础组件使用 `src/components/ui/` 下的 shadcn/ui 组件；按钮主色使用 `bg-brand`（科技蓝 `#1677FF`），不要回到默认 `primary`。
- 颜色、圆角、阴影、动画统一使用 `globals.css` 中定义的语义变量（`bg-card`、`text-muted-foreground`、`rounded-lg` 等），禁止硬编码 Hex 或 Tailwind 原生色盘。
- 业务标签使用半透明状态色；项目类型、任务类型、产品和里程碑标签保持小写工程感，不使用彩色大卡片。
- 视觉规范以 `DESIGN.md` 为准（企业信息化驾驶舱风格、科技蓝主色 + 深蓝侧边栏、Inter + JetBrains Mono、KPI 卡 + Recharts 图表）。

## 验证

- 修改代码后通过 `test_run` 同时跑静态检查和接口冒烟测试。
- 业务接口必须至少一条 curl 冒烟；未登录场景下 `/api/auth/me`、`/api/schools`、`/api/trips`、`/api/bidding-screenshots` 等返回 401 属预期。
