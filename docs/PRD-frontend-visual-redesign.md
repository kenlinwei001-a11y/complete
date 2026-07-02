# PRD · 前端视觉换肤 + 决策卡设计 + 沙盘布局重构（量化整页 · 遵 R-QUANT / R-PRD）

> 由来：用户 2026-07-02 提供房产 App 参考图，要求（1）改背景色本身 + 对应字体色 + 框体色（非只补对比度）（2）采纳参考图右侧 2 个 block 的设计（3）沙盘布局重构。用户同时亲立两条铁律 **R-QUANT**（视觉必给色号/精确值）+ **R-PRD**（重构必附整页逐元素 PRD）。本 PRD 即遵此二律：全程色号/px 量化、逐元素。
>
> 参考图右侧 2 block 已核历史：= 平台既有 **结论卡/6KPI卡/属性chips**（`PRD-order-project-sim-1to1.md:9`）+ **what-if 调参卡**（`PRD-frontend-addendum-sim-views.md:72`）+ **R17 决策单页**（`ARCH-redlines-and-R17-decision-page.md §17.1/17.2`）。参考图是视觉质量标杆，非新概念。

## 0. 本体引用与影响（铁律 0）

- **对象类型**：无新增（纯前端视觉层）。
- **链路**：`决策页渲染 ← WorkspaceConfig/ViewConfig.layout + tokens.css`（R14 换租户=换配置）。
- **不变量**：**R-QUANT / R-PRD**（本 PRD 自证遵守）· **R14**（色/结构走 token/config 不内联业务常数）· **R13/G-DM-1**（决策色 danger/ok/muted 语义不被换肤破坏——`--danger #E0626C` / `--ok #5FBE77` / `--muted2` 三色语义保留，仅底色/文字色换）· **R17**（决策单页三栏）。
- **断点**：无新增；THEME 换肤须守 **G-DM-1**（换肤后 SYNTHETIC 仍 muted、LIVE 仍 danger 红，不因新底色失真）。
- **回写**：本 PRD 落地后，`docs/SYSTEM-ONTOLOGY.md §5 R17` 补"决策卡视觉规范锚点 → 本 PRD §2/§3"。

---

## 1. Palette（色号锁定 · 全 WCAG AA 实测 · tokens.css）

替换 `apps/frontend-shell/src/styles/tokens.css`。**根因**：旧 `--bg #0A0D14` 近纯黑无蓝调、`--muted2 #59636F` 三级文字仅 2.88:1（看不清元凶）。新值全部实测达标：

| token | 旧值 | **新值(色号)** | 用途 | 对比度实测 |
|---|---|---|---|---|
| `--bg` | #0A0D14 | **#0E1420** | 页面底(深蓝调非纯黑) | 主文本 16.86:1 |
| `--bg2` | — | **#141C2C** | 顶部/hero 渐变亮端 | — |
| `--panel` | #141924 | **#1A2233** | 卡片面 | 主文本 14.55:1 |
| `--panel2` | #10141C | **#212B3D** | 卡内嵌区(滑块槽/chip底) | — |
| `--border` | (近无) | **#2C3648** | 卡片发丝边(1px) | — |
| `--border-strong` | — | **#3A4658** | 分隔线/表头下线 | — |
| `--txt` | #EDF1F8 | **#F2F5FA** | 主文本/大标题 | 16.86 / 14.55 ✅ |
| `--muted` | #8C96A6 | **#AEB8C9** | 次要文本/标签 | 9.21 / 7.95 ✅ |
| `--muted2` | #59636F | **#8A94A6** | 三级文本/说明 | **6.03 / 5.20 ✅**(旧2.88) |
| `--accent` | (杂) | **#5B7CFA** | 皇家蓝 CTA/选中/链接 | 5.01:1 on bg ✅ |
| `--accent-hover` | — | **#6E8BFF** | CTA hover | — |
| `--accent-weak` | — | **#1E2A4A** | 蓝底徽标/选中 tab 底 | — |
| `--danger` | #E0626C | **#E0626C**(不动) | 越线/不建议(决策语义) | 4.64:1 on panel ✅ |
| `--ok` | #5FBE77 | **#5FBE77**(不动) | 达标/可接 | 6.91:1 ✅ |
| `--warn` | #D2B04C | **#D2B04C**(不动) | 临近/预警 | — |

**渐变**：`--bg` 页面用 `linear-gradient(160deg, #141C2C 0%, #0E1420 60%)`（参考图深蓝→更深的纵向渐变·hero 区更亮）。
**决策色不动**：`--danger/--ok/--warn` 语义保留（守 G-DM-1/R13）；白字 on `--accent` = 3.68:1（大字/粗体 CTA ≥3 达标，按钮文字 ≥14px 600 weight）。

---

## 2. 决策摘要卡（对应参考图右上 block · 组件 `DecisionSummaryCard`）

参考图：大价格 `$164,800` + 地址 + 4 格指标网格(2 Beds/2 baths/1,421 sqft/B Class) + 4 枚胶囊 chip。平台映射：headline 决策指标 + 对象名/上下文 + KPI 网格 + 属性 chips。**逐元素量化**：

- **卡容器**：`background:var(--panel)`·`border:1px solid var(--border)`·`border-radius:16px`·`padding:20px 22px`·`box-shadow:0 2px 12px rgba(0,0,0,.28)`。
- **Headline 行**：主指标数值 `font-size:30px`·`font-weight:700`·`color:var(--txt)`·`line-height:1.1`（如"缺口 35.2 万套"/"综合分 72"）；决策色仅用于 verdict 徽标非整数字（守 dataMode：SYNTHETIC→`--muted2`）。副标题(对象名/地址) `font-size:13px`·`color:var(--muted)`·`margin-top:4px`。
- **KPI 网格**：`display:grid`·`grid-template-columns:repeat(4,1fr)`·`gap:1px`·`background:var(--border)`（格间发丝线）·`margin:16px 0`；每格 `background:var(--panel)`·`padding:12px 14px`：数值 `18px/600/var(--txt)` + 标签 `11px/var(--muted2)`（如 P50/P90/需求/达成率）。
- **属性 chips**：`display:flex`·`flex-wrap:wrap`·`gap:8px`；每枚 chip `border-radius:999px`(胶囊)·`background:var(--panel2)`·`padding:5px 12px`·`font-size:12px`·`color:var(--muted)`·可选前置 icon 14px；chip 是"配置/属性"非决策裁决（不上决策色）。
- **状态**：加载→骨架灰块(`--panel2`)；空态→`--muted2` "暂无数据" 引导；SYNTHETIC→顶部 `DecisionModeBanner` + 数值降 `--muted2`（复用现有守卫）。

## 3. what-if 计算器卡（对应参考图右中 block · 组件 `WhatIfCalculatorCard`）

参考图：Term/Type/Interest tab + Down Payment 滑块 + 实时 `Estimated $1,312.03` + 双 CTA(Request a tour / Contact agent) + "as early as today"。平台映射：调参 tab + 参数滑块(加夜班/扩通道/外协) + 实时重算结果(缺口归零/富余) + 采纳→Action + 次 CTA。**逐元素量化**：

- **卡容器**：同 §2（`--panel`/`border 1px --border`/`radius 16px`/`padding 20px 22px`）；标题 `[ 方案试算 ]` `12px/600/var(--muted2)`·`letter-spacing:.5px`。
- **参数 tab 行**（对应 Term/Type）：`display:flex`·`gap:8px`；每 tab `padding:8px 14px`·`radius:10px`·未选 `background:var(--panel2)`/`color:var(--muted)`·选中 `background:var(--accent-weak)`/`color:var(--accent)`/`border:1px solid var(--accent)`。
- **滑块**（对应 Down Payment·每参数一条）：轨 `height:4px`·`radius:2px`·`background:var(--panel2)`·已填段 `background:var(--accent)`；滑块柄 `20px 圆`·`background:var(--accent)`·`border:3px solid var(--panel)`·`box-shadow:0 0 0 4px rgba(91,124,250,.2)`；左右端标签 `11px/var(--muted2)`；step/范围按业务(加夜班0–3/扩通道0–6/外协0–20%·`PRD-frontend-addendum-sim-views §⑥`)。
- **实时结果**（对应 Estimated pr.）：`font-size:24px`·`font-weight:700`；缺口归零→`var(--ok)`+"✓ 缺口归零·富余 {x}"；仍缺→`var(--danger)`+"✗ 缺口 {x}"；旁注 `11px/var(--muted2)` "拖动即按 S1.2-7 公式实时重算"。
- **双 CTA**（对应 Request a tour / Contact agent）：主 CTA "采纳此方案 → 工单" `background:var(--accent)`·`color:#fff`·`padding:10px 18px`·`radius:10px`·`font:14px/600`·hover `--accent-hover`；次 CTA "存档对比" `background:transparent`·`border:1px solid var(--border-strong)`·`color:var(--muted)`。CTA 走 R4 Action(采纳产能保障方案)。
- **时间戳注**（对应 as early as today）：`11px/var(--muted2)` + 时钟 icon "最快今日可执行 / 快照 {version}"。

## 4. 卡片通用规格

- 圆角统一 `16px`(大卡)/`10px`(按钮·tab)/`999px`(chip)；发丝边 `1px solid var(--border)`；卡间距 `16px`；卡内区块间距 `16px`；阴影 `0 2px 12px rgba(0,0,0,.28)`。
- 右侧决策卡栈：`display:flex`·`flex-direction:column`·`gap:16px`·`width:` 参考图约 33%（决策页三栏右栏）。

---

## 5. 推演沙盘一页布局重构（整页 · 治拥挤 · Option A · 组件 `SandboxView`）

**现状**（`docs/` 截图证）：约 12 面板(全局态/AI指挥台/推进tick/评估清单/就绪认证/三元组/TrialTick/世界完整度/健康雷达/信任雷达/状态变量列表/历史记录)平铺堆一屏，等权重、贴挤、无留白 = 拥挤非工业级。**目标**：参考图信息层级——1 主体焦点 + 右侧折叠卡片栈 + 大留白。**不删任何功能，只重组视觉权重与密度。**

**整页栅格**（`display:grid`·`grid-template-columns:` 主 7fr / 右 5fr（≈58%/42%）·`gap:20px`·`padding:20px`·`background:` §1 渐变）：

**左主区（7fr · hero 焦点）**——纵向：
1. **顶栏**：全局态标量(大数 `30px/700`) + tick 时间轴 heat（保留·占顶部 1 行）+ 推进/存档/分支 3 按钮收为一条 `sandbox-controls` 命令条（`padding:10px 14px`·按钮 §3 CTA 规格）。
2. **主视觉·业务建模链 DAG**（`min-height:420px`·占左主区主体·节点色随 tick 变·参考图 3D-render 的地位）。
3. **AI 指挥台**：收为底部命令条 `sandbox-ai-input`(`height:40px`·`radius:10px`·`--panel2` 底) + `执行` CTA；echo 单行 `12px/--muted`。

**右栏（5fr · 折叠卡片栈 · `gap:16px`）**——默认**只展开 1 张，其余折叠**（渐进披露·治拥挤核心）：
1. **就绪认证卡**（默认展开·§2 卡壳）：L0–L4 stepper + 综合分(大数) + gauge；`世界完整度` 环形。
2. **健康雷达 + 信任雷达卡**（默认折叠·点标题展开）：2 个 RadarChart(6维/4维)。
3. **L4 三元组 + Trial Tick 卡**（默认折叠）。
4. **历史推演记录卡**（`SANDBOX-RUN-HISTORY` 并入·默认折叠·点开看逐 tick 轨迹·§2 卡壳）。
5. **将进入状态变量清单**（默认折叠·可展开滚动区 `max-height:240px`）。

**折叠交互**：卡标题行 `cursor:pointer` + `▸/▾`；折叠态仅显标题+1 行摘要(`--muted2`)；展开态显全内容。同一时刻建议 1–2 张展开，其余摘要态 → 一屏密度从 12 面板降到"1 主体 + 5 折叠卡"。

**留白**：卡内 `padding:16–20px`·卡间 `16px`·主右栏间 `20px`（对齐参考图呼吸感）。

---

## 6. 验收（getComputedStyle 逐值 · 遵 R-QUANT 可测）

- **C1 palette**：`tokens.css` 15 token 值 = §1 色号（逐字节）；真浏览器 `getComputedStyle` 抽 6 处文本对比度全 ≥4.5（`--muted2` 从 2.88→5.20+）。
- **C2 摘要卡**：真浏览器测 `DecisionSummaryCard` 圆角=16px·发丝边=1px `#2C3648`·headline=30px/700·chip=胶囊 999px·KPI 网格 4 列——逐值对 §2。
- **C3 计算器卡**：滑块柄 20px + 蓝 `#5B7CFA`·主 CTA 底 `#5B7CFA`/白字·实时结果拖动重算(缺口值随滑块变·前后端一致)——对 §3。
- **C4 沙盘布局**：真浏览器测右栏默认仅 1–2 卡展开、其余折叠(摘要态)·一屏可见面板数 < 现状·所有功能仍可达(逐项点验)——对 §5。
- **C5 决策色不失真**：SYNTHETIC 页决策数仍 `--muted2`、LIVE 越线仍 `--danger #E0626C`(守 G-DM-1)·四包 build/test/gates 绿。
