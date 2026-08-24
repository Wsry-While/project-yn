# DESIGN.md — 项目中心

## 项目与用户画像

- 产品：**项目中心**，面向内部团队（≤20 人并发）的项目 / 任务协作平台，承载学校业务数据。
- 视觉方向：**企业信息化驾驶舱**（参考 Ant Design Pro / TDesign Pro / 阿里云控制台），不再使用 Linear / Vercel 极简风。
- 用户：企业内部项目成员，需要在一屏内快速掌握关键指标、筛选业务、定位详情。

## 气质与意象

- 深色侧边栏 + 浅色工作区形成强烈分区，像政企后台而不是营销站。
- 信息密度高于留白：工具栏、KPI 卡、图表、表格紧凑排列。
- 主色科技蓝 `#1677FF` 用于主操作、链接、当前态、关键数据高亮。

## Design Tokens

### 色彩

- 主色：`#1677FF`（oklch 0.55 0.19 258），hover `#0958D9`。
- 侧边栏：`#001529`（深蓝黑），菜单项悬停 `rgba(255,255,255,0.06)`，选中态左侧 3px 主色指示条。
- 文字：浅色模式 Zinc 900→Zinc 400 灰阶；深色模式 Zinc 100→Zinc 400。
- 边框：`rgba(0,0,0,0.08)`（浅）/ `rgba(255,255,255,0.08)`（深）。
- 状态色：
  - 成功 / 已完成：Emerald 600
  - 警告 / 待交付：Amber 500
  - 危险 / 逾期：Red 500
  - 信息 / 新建：Sky 500
  - 中性：Zinc 500
- 图表序列：`#1677FF / #13C2C2 / #52C41A / #FA8C16 / #722ED1`。

### 字体

- 正文 / UI：`Inter`（Latin）+ `PingFang SC`（中文回落）。
- 数字 / 编码 / ID：`JetBrains Mono`。
- KPI 大数字：`font-mono text-3xl font-semibold tabular-nums`。

### 圆角

- 控件 / 卡片：6px（`rounded-md`，`--radius: 0.375rem`）。
- 浮层 / 弹窗：8px（`rounded-lg`）。
- 禁止大于 12px 的圆角。

### 阴影

- 卡片：`0 1px 2px rgba(15,23,42,0.04)`。
- Hover：`0 4px 12px rgba(15,23,42,0.06)`。
- 浮层：`0 12px 32px rgba(15,23,42,0.12)`。

### 动效

- 缓动：`cubic-bezier(0.16, 1, 0.3, 1)`，150–250ms。
- 仅动画 `transform` / `opacity`；进度条 / 图表入场 0.6s。

## 布局

- 左侧深色侧边栏 **220–240px**，主区浅色背景。
- 顶栏 **h-14**，含面包屑 + 全局搜索 + 通知入口；sticky + backdrop-blur。
- 内容区最大宽度 **1400px**，padding 20–24px。
- 列表页结构固定为：PageHeader → 工具栏卡片（搜索 + Select 筛选 + 结果计数） → 表格 / 列表 → Pagination。
- 仪表盘结构：PageHeader → 4 张 KPI 卡 → 进度 / 趋势图 → 我的待办 → 图表 + 到期 + 动态。

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
