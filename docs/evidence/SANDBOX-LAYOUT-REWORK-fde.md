# FDE 交付证据 · SANDBOX-LAYOUT-REWORK（推演沙盘一页布局重构 · Option A）

**WO**：SANDBOX-LAYOUT-REWORK（P1·道 F frontend）
**PRD**：`docs/PRD-frontend-visual-redesign.md §5`（整页栅格 7fr/5fr · 右栏折叠卡片栈渐进披露 · 治 12 面板平铺拥挤 · 不删功能）
**本体**：G-11 交互沙盘 / R14（配置驱动·零业务常数）
**接续**：陈旧认领（peer 失联 2.5 天·f88189c 已落 CollapsibleCard/DecisionSummaryCard/WhatIfCalculatorCard + 双雷达/历史折叠卡）→ 本次续做栅格重构主体。

## 已落（f88189c·复用不重做）
- `CollapsibleCard`（折叠交互·内容保留 DOM `hidden` 不破 testid）
- `DecisionSummaryCard`（§2 摘要卡）· `WhatIfCalculatorCard`（§3 计算器卡）
- 双雷达 + 历史推演记录已收为折叠卡（半程）

## 本次完成（栅格主体重构）
- `SimViews.module.css`：新增 `.heroGrid`(7fr/5fr·gap20·窄屏纵向堆叠) / `.heroMain` / `.heroSide` / `.heroState` / `.kpiHero`(30px·700) / `.heroDag`(min-height 420) / `.page`(根 block 全宽)。
- `SandboxView.tsx`：整页重排为 **主体 + 渐进披露卡片栈**——
  - **左主区 7fr**：顶栏（全局态大数 30px/700 + 次级 stateVar KPI）→ 命令条（推进/存档/分支/采纳 + tick 时间轴 heat）→ **主视觉 DAG（420px·占主体）** → AI 指挥台底栏。
  - **右栏 5fr 折叠卡栈**：就绪认证卡（默认展开）+ 双雷达/运行态·风险TOP3/Schema派生/运行台Console/历史推演记录（默认折叠）+ 分支对比卡（出现即展开）。
  - **不删功能**：RiskTop3 / runstate / SchemaDeriveRules / PlatformConsole / compare 全部收进右栏折叠卡（内容保留 DOM·点标题展开·功能仍可达）。
- 根容器由 `.head`（flex-row·会挤压）改为 `.page`（block 全宽）——修 heroGrid 被压成窄列的缺陷。

## 真浏览器取证（VITE_MOCK build + vite preview + Playwright chromium·真登录 planner/demo·SPA 内 nav·真看 UI）
脚本：`docs/evidence/SANDBOX-LAYOUT-fde.mjs`（addInitScript 注入 sim.sandbox 暗发 entitlement=等价 tenant-admin 勾选·沙盘 view-config/cert/session 数据全走真 mock 端点未改一值）。

### C1 · 主视觉主导 + 密度下降（截图 `SANDBOX-LAYOUT-C1-default.png`）
`getComputedStyle` / getBoundingClientRect 实测：
- `grid-template-columns = 658px 470px`（比 1.40 ≈ 7:5）· `gap = 20px`
- 主视觉 DAG `height = 420px`（占左主区主体）
- 全局态大数 `font-size 30px / font-weight 700`（主指标视觉权重最高）
- **右栏 6 卡：1 展开（就绪认证）+ 5 折叠**（双雷达/运行态/Schema/Console/历史）→ 一屏密度从「12 面板等权平铺」降为「1 主体 DAG + 1 展开卡 + 5 折叠标题」。

### C2 · 所有既有功能仍可达（逐项点验·截图 `SANDBOX-LAYOUT-C2-features.png`）
| 功能 | 点验结果 |
|---|---|
| 推进 tick | 全局态 `28.3 → 47.5`（真 world 态更新·tick 0→1） |
| tick 时间轴 heat | 推进后 heat 格填充 |
| 存档检查点 | 按钮可点（enabled） |
| 分支对比 | 点分支 → `sandbox-compare-card` 出现（count=1） |
| 就绪认证 | L0–L4 stepper 全渲染 + gauge 60% + L4 三元组 + Trial Tick |
| AI 指挥台 | 输入「推进 2 个 tick」→ echo「意图：推进 2 个 tick ✓」 |
| 历史推演记录 | 展开卡 → 内容/诚实空态可达 |
| 采纳此推演结论 | 点采纳 → toast「草稿已创建，待审批（/admin/actions）」（R4 Action） |

### C3 · 信息层级 + 渐进披露真可展开（截图 `SANDBOX-LAYOUT-C3-radar-expanded.png`）
- 点双雷达卡标题 → `data-open 0→1` · body 去 `hidden` · `sandbox-health-radar` 真渲染（健康度 6 维 综合 62 + 信任度 4 维 综合 48 双雷达 + 图例）。
- 留白充足（卡内 padding 16–20 · 卡间 16 · 主右栏间 20）· 主指标 30px 远大于次级 · 对齐参考图卡片栈观感。

## C4 · 门禁 / 测试
- 前端牙齿：`test/sandbox-layout.test.tsx`（4 用例·新增）——栅格 7fr/5fr 结构 + DAG 落左主区 + 渐进披露默认态（1 展开 5 折叠）+ 折叠交互展开 + 不删功能入口全在 DOM。
- 回归：`sandbox-view`(14) / `sandbox-p0`(3) / `theme-cards`(4) / `sandbox-run-history`(4) / `wo-nav-data-sandbox`(3) 全绿。
- 前端全量 `vitest run`：**441/441 绿**（含本 WO 新增 4）。
- 四包 build + `pnpm gates`：见提交说明（退 0）。

## 红线自检
- ✅ 真浏览器真看 UI（非仅改码）·截图证密度下降 + 层级清晰 + 折叠可真展开。
- ✅ 不删任何功能（C2 逐项点验通过）。
- ✅ 复用 f88189c 已落 CollapsibleCard/决策卡·未重做。
- ✅ 不作假：entitlement 开门=等价 admin 勾选·沙盘数据全真 mock 端点。
