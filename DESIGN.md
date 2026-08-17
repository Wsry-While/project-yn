# DESIGN.md — 项目中心

## 项目与用户画像

- 产品：**项目中心**，一个面向内部团队（≤20 人并发）的项目 / 任务协作平台。
- 视觉对标：**Linear.app** —— 冷峻、工程感、极简、克制、高密度信息但不拥挤。
- 用户：企业内部的项目成员，对键盘快捷键、密集信息、深色模式有偏好。

## 气质与意象

- 深灰金属面板上发出一束冷蓝光，像高端 IDE 与 Linear 后台的混合体。
- 信息层级靠**留白、字重、对比度**而不是色块。
- 强调色 Indigo 像电路上的指示灯，只在关键动作和当前状态点亮。

## Design Tokens

### 色彩

- 基底（浅）：纯白 `#FFFFFF` / Zinc 50 `#FAFAFA`（次级面板）。
- 基底（深）：Zinc 950 `#09090B` / Zinc 900 `#18181B`（卡片）。
- 文字：Zinc 900→Zinc 400 的阶梯灰阶。
- 边框：`rgba(0,0,0,0.08)`（浅）/ `rgba(255,255,255,0.08)`（深）。
- **唯一强调色**：Indigo `#4F46E5`（hover `#4338CA`），不使用渐变、不使用紫粉。
- 状态色：
  - 待办：Zinc 500
  - 进行中：Indigo 500
  - 审阅中：Amber 500
  - 已完成：Emerald 500
  - 危险：Red 500

### 字体

- 正文 / UI：`Inter`（Latin）+ `PingFang SC`（中文回落）。
- 数字 / 编码 / ID：`JetBrains Mono`。
- 字号阶梯：12 / 13 / 14（正文）/ 16 / 20 / 24 / 32。
- 字重：400 / 500 / 600。标题不用 700 以上。

### 圆角

- 控件 / 卡片：6–8px（`rounded-md`）。
- 浮层 / 弹窗：10px（`rounded-lg`）。
- 禁止大圆角（>12px），那会破坏工程极简感。

### 阴影

- 卡片：`0 1px 2px rgba(0,0,0,0.04)`。
- Hover：`0 4px 12px rgba(0,0,0,0.08)`。
- 浮层 / 弹窗：`0 12px 32px rgba(0,0,0,0.16)`。
- 深色模式下阴影改为更弱的黑色叠加 + 1px 内边框高光。

### 动效

- 缓动：`cubic-bezier(0.16, 1, 0.3, 1)`（spring 感）。
- 持续：150–250ms。
- 仅动画 `transform` / `opacity`；禁用 top/left/width/height 动画。
- 卡片 hover：`translateY(-1px)` + 阴影加深。
- 进度条入场：0.6s 宽度从 0 到值。
- 弹窗：`opacity` + `translateY(8px) scale(0.98)` 同时进入。

## 布局

- 左侧固定侧边栏 **240px**，深色 Zinc-900 与主区形成层级（即使浅色模式也是深色侧边栏）。
- 侧边栏：Logo「项目中心」+ 4 项导航 + 主题切换 + 底部用户头像。
- 主内容区：最大宽度 1280px，水平 padding 24px / 32px。
- 移动端：侧边栏变抽屉，汉堡按钮触发，遮罩 + 滑入。
- 看板：4 列 grid，`≤768px` 自动竖向堆叠。

## 组件规范

- **按钮**：Primary = Indigo 实心；Secondary = 描边 Zinc；Ghost = 无背景 hover 背景。
- **输入框**：1px Zinc 边框，focus 时变 Indigo 环。
- **卡片**：白底 / Zinc-900，1px 边框，hover 上浮。
- **Tag / 优先级标签**：小号大写字母 + 半透明背景。
- **Modal**：居中，最大宽度 480px，ESC 关闭，点遮罩不关闭（防误触）。
- **Toast**：右下角堆叠，3s 自动消失，含 success/error/info 三种。
- **LlmLoadingMask**：局部容器右上角小 Logo 旋转 + 半透明扫描线背景；**绝不全屏遮罩**。

## 交互与状态

- 快捷键：`⌘1–4` 切页、`⌘N` 新建任务、`Esc` 关弹窗。按下时显示快捷键提示。
- 拖拽：HTML5 DnD，落点 1px Indigo 边线 + 背景 Indigo/5 闪烁。
- 乐观更新：看板拖拽先更新 UI，失败回滚并 Toast 提示冲突。
- 并发：任务带 `version` 字段，PATCH 时带 `If-Match`，冲突返回 409。

## 可访问性

- 所有图标按钮带 `aria-label`。
- 表单 `<label htmlFor>`。
- 弹窗 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`。
- 焦点环：2px Indigo，不依赖颜色单独传达信息。
- 颜色对比 ≥ AA。

## 设计禁忌

- ❌ 紫 / 粉 / 蓝紫渐变、霓虹发光、玻璃拟态。
- ❌ 大圆角（>12px）、拟物阴影、彩色卡片背景。
- ❌ 全大写英文标语、emoji 作为主要 icon。
- ❌ 顶部彩色 banner、渐变按钮。
- ❌ 全局 Loading 遮罩阻塞页面阅读。
