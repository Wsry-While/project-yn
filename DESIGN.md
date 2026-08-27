# DESIGN.md — 项目中心

## 项目与用户画像

- 产品：**项目中心**，面向内部团队（≤20 人并发）的项目 / 任务协作平台，承载学校业务数据。
- 视觉方向：**RuoYi 风格企业信息化驾驶舱**（参考 RuoYi-Vue / Element UI 后台模板），不再使用 Linear / Vercel 极简风。
- 用户：企业内部项目成员，需要在一屏内快速掌握关键指标、筛选业务、定位详情。

## 气质与意象

- 深色侧边栏 + 浅色工作区形成强烈分区，像政企后台而不是营销站。
- 信息密度高于留白：工具栏、KPI 卡、图表、表格紧凑排列。
- 主色 Element 蓝 `#409EFF` 用于主操作、链接、当前态、关键数据高亮。

## Design Tokens

### 色彩

- 主色：`#409EFF`，hover `#66b1ff`，active `#3a8ee6`。
- 侧边栏：`#304156`，菜单项悬停 `#263445`，选中态整行 `#409EFF` 蓝底白字。
- 内容背景：`#f0f2f5`；卡片纯白。
- 文字：浅色模式 `#303133 / #606266 / #909399`；深色模式反色。
- 边框：`#e4e7ed`（浅）/ `#2c2d2e`（深）。
- 状态色（Element 调色板）：
  - 成功：`#67c23a`
  - 警告：`#e6a23c`
  - 危险：`#f56c6c`
  - 信息：`#909399`
  - 主色：`#409eff`
- 图表序列：`#409eff / #67c23a / #e6a23c / #f56c6c / #909399`。

### 字体

- 正文 / UI：`Inter`（Latin）+ `PingFang SC`（中文回落）。
- 数字 / 编码 / ID：`JetBrains Mono`。
- KPI 大数字：`font-mono text-3xl font-semibold tabular-nums`。

### 圆角

- 控件 / 卡片：4px（`rounded-md`，`--radius: 0.25rem`）。
- Tags-View 标签：2px。
- 禁止大于 8px 的圆角。

### 阴影

- 卡片：`0 1px 4px rgba(0, 21, 41, 0.08)`。
- 下拉 / 浮层：`0 2px 12px 0 rgba(0, 0, 0, 0.1)`。
- 避免使用厚重的彩色投影。

### 动效

- 缓动：`cubic-bezier(0.16, 1, 0.3, 1)`，150–250ms。
- 仅动画 `transform` / `opacity`；侧边栏宽度过渡 200ms linear。

## 布局

- 左侧深色侧边栏 **210px（展开）/ 64px（折叠成图标）**，折叠后菜单项 title 提示。
- 顶栏 **h-[50px]** 纯白，左侧汉堡按钮触发折叠，含面包屑 + 全局搜索 + 通知；sticky + 淡阴影。
- Tags-View 多页签条 **h-9**，紧贴顶栏下，白底；右键菜单：刷新 / 关闭 / 关闭其他 / 关闭所有；Dashboard 固定不可关闭。
- 内容区背景 `#f0f2f5`，内边距 p-4，卡片之间 gap-3。
- 列表页结构固定为：PageContainer → 工具栏（搜索 + Select 筛选 + 结果计数 + 操作按钮） → 表格 → Pagination。

## 组件规范

- **PageHeader**：面包屑 + 图标色块 + 标题 + 副标题 + 右侧 actions。
- **KpiCard**：大数字 + 右上角彩色图标块 + 可选 delta / hint，tone 支持 brand/success/warning/danger/neutral。
- **Badge**：6 种 tone（brand/success/warning/danger/info/neutral），支持 dot 圆点；通过 `toneFromStatus()` 根据中文状态自动映射。
- **Button**：Primary 蓝底白字，Secondary 描边，Ghost 无背景。
- **Pagination**：上一页 / 页码 / 下一页 + “共 N 条，显示 X–Y”。
- **表格**：11px 大写表头 + 12–13px 行内文本；行 hover `bg-muted/30`；focus 行 `bg-brand/5 ring-1 ring-brand/40`。
- **Modal**：使用统一 `<Modal>` 组件，禁止自定义遮罩。
- **图表**：Recharts，tooltip 用卡片色 + 1px 边框，轴线 / 网格使用 `var(--border)`，颜色引用 chart token。
- **Command Palette（全局搜索 ⌘K）**：顶栏搜索触发器 hover 边框转 `--brand/40`；弹层 `shadow-[0_24px_60px_rgba(0,0,0,0.32)]`、`max-h-[52vh]`；激活项 `bg-brand-muted text-brand` + 右侧 ↵ 提示；支持 ↑↓/↵/esc，底部用 `Kbd` 展示快捷键；中文输入自动走业务数据语义搜索。
- **Kbd**：所有键盘提示统一用 `<Kbd>`（`h-5`、`font-mono text-[10px]`、内嵌高光阴影），禁止手写裸 `<kbd>`。
- **CSV 导出**：列表筛选栏右侧「导出 CSV」按钮，图标 + 文字，禁用态 `opacity-50`，按当前筛选导出。

## 交互与状态

- 列表筛选：搜索框 + Select 下拉，不再使用 chip 按钮组。
- 所有列表读取 `?focus=:id` 参数，命中行高亮并可后续自动打开。
- 分页：客户端分页，PAGE_SIZE = 20。
- 快捷键：`⌘1–9 / ⌘0` 切换侧边栏导航，`⌘K` 唤起全局搜索，`⌘N` 新建任务，`Esc` 关闭弹窗。
- Toast：右下角堆叠，3s 自动消失。
- 可访问性：交互元素具备 `focus-visible:ring` 焦点环；图标按钮配 `aria-label`；弹窗使用 `role="dialog" aria-modal="true"`。

## 设计禁忌

- ❌ 紫 / 粉 / 蓝紫渐变、霓虹发光、玻璃拟态。
- ❌ 大圆角（>12px）、拟物阴影、彩色卡片背景。
- ❌ Linear / Vercel 极简留白风格、灰阶标签 cloud。
- ❌ 全局 Loading 遮罩阻塞页面阅读；所有加载使用局部 `LlmLoadingMask`。
- ❌ chip 按钮组作筛选器（用 Select 替换）。
- ❌ 硬编码 hex 色，统一通过 `bg-*` / `text-*` 语义 token 引用。
