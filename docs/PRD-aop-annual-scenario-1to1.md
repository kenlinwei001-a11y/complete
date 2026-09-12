# PRD · 年度情景规划台（aop / AnnualScenario）参考原型 1:1 复刻

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 前端+数据管线 |
| 取代/扩展 | 扩 `PRD-frontend.md`（§7.14 年度情景规划台）· 同 `PRD-cockpit-capacity-1to1-parity.md` 的 1:1 复刻范式（数据走管线、零写死） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R4/R6/R13/R14/R-一致） · `docs/reference-prototype-decision-platform.html`（`buildAOP` L3149-3185）· `apps/frontend-shell/src/views/plan/AnnualScenarioView.tsx` · `packages/contracts/src/planviews.ts`（AopResponse L8-73）· `apps/datacore/src/planviews.ts`（aop/capexScenario L46-181）· `apps/datacore/src/synthetic/battery.ts`（generatePlanDomain L1163-1272）· `apps/datacore/src/app.ts:2564`（GET /a/v1/plan/aop） |

> 一句话：年度情景规划台**系统已实现且多处强于 HTML**（活 capex_scenario 求解器 / 真规则引擎 C18·C23 / Action 拍板审批 / TRIGGERED 触发态 / 分解溯源）。本 PRD 把**与 HTML 的 1:1 视觉/数据差异点补齐 + 修一个 2027/2026 接线 bug**，并**保留系统超集能力**——不做"把活的退回静态"的复刻。所有对齐数据经**电池域合成生成器**产出（R14 零前端写死、R6 确定性）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.B/E，plan 域）：`AnnualScenario`（扩 `note` 字段）·`ScenarioTrigger`·`PlanTarget`（目标分解=目标线）·`Solver(capex_scenario)`·`ActionType(AOP情景拍板)`·`FeatureConfig(view.annual-scenario/act.aop-finalize)`。
- **触及链路**（§3）：`合成 generatePlanDomain → AnnualScenario/ScenarioTrigger/PlanTarget 物化 → GET /a/v1/plan/aop（PlanService.aop 跑 capex_scenario + 规则引擎 C18/C23）→ AnnualScenarioView 渲染`；拍板 `→ ActionDraft(AOP情景拍板) → 审批 → aop.finalized`。
- **触及事件/数据流**（§4）：复用 `aop.finalized`（拍板）·`materialize.completed`/`dataset.regenerated`（合成重生成失效本视图）。无新事件。
- **触及不变量**（§5）：
  - **R14 应用层无业务常数（核心）**：HTML 的演示字符串/数值（note/产能决策/长协/触发条件/分解值）**作为电池域生成器的种子配置**（`battery.ts` planview config）产出，**不前端写死**；前端只渲染 API 数据。过 `debattery:check`。
  - **R6 确定性**：对齐 HTML 的数值经生成器固定种子产出，同 (industry,scale,seed) 字节一致。
  - **R4 真值经 Action**：拍板（finalize）仍走 `AOP情景拍板` ActionDraft 审批（系统超集，保留）。
  - **R13 可溯源 / R-一致**：分解节点 `targetRef` 指向 S&OP 平衡台目标线（同源勾稽，2026-07=127.6），跨视图同值；规则校验 C18/C23 走真规则引擎 explanation。
- **关闭/影响断点**（§8）：修复 **2027/2026 年份接线 bug**（视图请求 YEAR=2027、合成只种 2026 → 可能空数据）。
- **门禁**（§7）：`debattery:check`（无前端内联）· `chain:check`（capex_scenario 注册）· `ontology:check` · 前端回归（年度视图 parity + 角色门）· FDE 亲手跑。
- **回写承诺**：`AnnualScenario` 加 `note` 字段 → 回写本体 §2.B；其余复用既有，无新链路/事件。

## 1. 目标 / 非目标
### 目标
1. **结构/功能/UI 1:1**：四块（头部 + 三情景卡 + 触发挂牌 + 目标分解引擎）与 HTML 对齐：补 **`note` 行**、**"三情景对比" chip**、分解段 **header "基准情景 X 万套"**、prose 内 **C18/C21/C23 行内规则悬浮链接**、**缺口/过剩窗口曲线渲染**（capex_scenario 已产 demand/supply/gap/windows，前端未画）。
2. **数据经管线对齐**：把 HTML 的情景 note/产能决策/长协/触发条件/分解口径**对齐为电池域生成器种子**（如需严格匹配演示值，见 §9 确认），数据经合成→物化→端点产出。
3. **修接线**：年份 2027/2026 对齐（视图、端点默认、生成器同年）。
4. **保留系统超集**：活 capex_scenario（项目测算 C1）、真规则 C18/C23 explanation、Action 拍板审批、TRIGGERED 触发态+通知、分解溯源——**全部保留，不退化**。

### 非目标
- **不为对齐 HTML 演示数值而在前端/后端写死**（R14）——经生成器种子产出。
- 不删系统已有的超集能力（不做"复刻成静态 demo"）。
- 不改 capex_scenario 求解器数学（仅渲染其已产曲线）。

## 2. 现状与缺口（HTML vs 系统，file:line · 摘自实测 gap）
| # | HTML 元素 | 系统 | 缺口/差异 |
|---|---|---|---|
| 1 | 四块结构 + 头部 h3/sub | ✅ | 一致（`AnnualScenarioView.tsx:33`） |
| 2 | 头部"三情景对比" chip | ❌ | 未渲染 |
| 3 | 情景卡 `note`（乘用车放缓+8%…） | ❌ | `AnnualScenario` 无 `note` 字段；`.scenNote` CSS 已存但未用 |
| 4 | 三情景卡 + 灰蓝/青/琥珀 边框 + 已拍板 chip | ✅ | `SCEN_COLORS` 精确一致 |
| 5 | dem 1420/1580/1760 万套/年 | ◐ | 系统由种子算（base×0.88/1/1.18），值不必等于演示值 |
| 6 | 产能决策 / 长协锁量 文案 | ◐ | 系统串不同（合肥/盐城 vs 枣庄/江门） |
| 7 | 财务测算 收入/CAPEX/IRR | ✅ | IRR 由求解器活算（超集） |
| 8 | 规则校验 C18/C23 行内+悬浮 | ◐ | 系统为**可点徽章+真引擎 explanation**（超集），但丢了 prose 内行内链接 |
| 9 | 项目测算（C1）逐项 IRR/24月利用率/C23 | ➕ | **系统独有**（活 capex_scenario） |
| 10 | 拍板（finalize）Action | ➕ | **系统独有**（AOP情景拍板审批 + aop.finalized） |
| 11 | 触发表 3 列 + 2 条（海外大单/储能） | ◐ | 系统 4 条不同条件 + 可执行 expr；TRIGGERED 态（超集）；HTML 那 2 条不在种子 |
| 12 | 分解：无 year 根、6 季跨 26/27、Q3-only 月 | ◐ | 系统有 year 根 + 单年 4 季 12 月（皆有月 chip）+ 溯源（超集）；结构/值与 HTML 不同 |
| 13 | 缺口/过剩窗口曲线 | ◐ | 数据已在 `capexScenario.windows/gap`，**前端未画曲线** |
| 14 | prose 内 C18/C21/C23 行内规则链接 | ◐ | 系统 header/footnote 为纯文本"C23"，无 `linkRules` 悬浮 |
| 15 | **年份** | 🔴 | 视图请求 `YEAR=2027`，合成种 `2026`、端点默认 2026 → **可能空数据接线 bug** |

## 3. 设计（对齐缺失项 + 修接线 + 保超集）
### 3.1 数据层（电池域生成器，R14/R6）
- `contracts/planviews.ts` `AnnualScenario` 加 `note?: string`（回写本体 §2.B）。
- `battery.ts generatePlanDomain`：① 给 3 情景填 `note`（乘用车放缓/储能放量/海外大单——作为电池域种子文案）；② 产能决策/长协/触发条件/分解口径**按需对齐 HTML 演示口径**（§9 确认严格度）；③ **修年份**：生成器与端点默认与视图统一（2026 或 2027，见 §9）。
- 数据经合成→物化→`GET /a/v1/plan/aop` 产出（无前端写死）。
### 3.2 渲染层（前端，补齐 + 保超集）
- `AnnualScenarioView.tsx`：① 头部加 **"三情景对比" chip**；② 情景卡渲染 **`note` 行**（用既有 `.scenNote`）；③ 分解段 header 显 **"基准情景 {baseline.demand} 万套"**（取数据，非写死）；④ prose 的 C18/C21/C23 用 **`<RuleRef>` 行内悬浮**（与 risk/驾驶舱同款）；⑤ **缺口/过剩窗口曲线**：用 `capexScenario.demand/supply/gap/windows` 画一条季度曲线（兑现 header "缺口/过剩窗口"承诺）。
- **保留**：项目测算（C1）、C18/C23 真引擎徽章、拍板 Action 按钮、TRIGGERED 高亮+通知、分解溯源 popup——不动。
### 3.3 接线修复
- 统一 `YEAR`（视图）/ 端点默认 / `generatePlanDomain` 年份；确保请求年有数据（否则视图空）。

## 4. 契约 / 端点
- `contracts/planviews.ts`：`AnnualScenario.note?`（唯一契约新增）。其余 `AopResponse` 复用。
- 端点：复用 `GET /a/v1/plan/aop?year=`（修默认年）· 拍板 `POST /a/v1/action-drafts`（既有）。
- 仓储：`AnnualScenario` 加 note（合成产出，无新表）。

## 5. 关键流程
合成 `generatePlanDomain(seed)` 产 3 情景（含 note）+ 4 触发 + 年/季/月目标 → 物化 → `GET /a/v1/plan/aop?year=2026`（跑 capex_scenario + C18/C23 规则）→ 视图渲染 四块（含 note 行/三情景对比 chip/窗口曲线/行内规则链接）→ catalog_admin 拍板 → ActionDraft 审批 → aop.finalized。

## 6. 非功能（§5）
R14（数据经生成器、前端零业务常数）· R6（种子确定，字节一致）· R4（拍板审批）· R13/R-一致（分解=S&OP 目标线同源、规则真引擎）。

## 7. 验收（DoD）
- 四块与 HTML 视觉对齐：note 行/三情景对比 chip/分解 header 数字/行内规则链接/窗口曲线 全到位。
- 数据经管线（合成→端点），**前端零写死**（`debattery:check` 不超基线）；换 seed 字节一致。
- **系统超集保留**：项目测算 C1 / 真规则 explanation / 拍板审批 / TRIGGERED / 分解溯源 全在。
- **年份接线修复**：请求年有数据、视图非空。
- `pnpm -r build && pnpm -r test` 全绿（年度视图前端回归 + 角色门 + AnnualScenario.note 双仓储）；`chain:check`/`ontology:check` 过。
- FDE：起真后端 + 前端亲手点一遍（三情景/触发/分解/拍板），截图留证。
- 回写本体 §2.B（AnnualScenario.note）。

## 8. 分期
- **AOP.1** 契约 `note` + 生成器填 note/对齐口径 + 年份接线修复（数据对齐）。
- **AOP.2** 前端补齐：三情景对比 chip + note 行 + 分解 header 数字 + 行内规则链接。
- **AOP.3** 缺口/过剩窗口曲线渲染（消费 capexScenario.windows/gap）+ parity 走查 + 回归。

## 9. 1:1 尺度（已定 · 全局标准）
- **100% 1:1 复刻**（用户裁决，见 `PRD-reference-views-1to1-roadmap.md` §0）：HTML 的**精确演示数值/字符串/结构/交互逐项还原**（dem 1420/1580/1760、产能决策"枣庄/江门"、触发"海外大单≥80万套"、分解 382/398…、Q3-only 月、三情景对比 chip、note 行、缺口窗口曲线、行内规则链接…全部对齐）；**唯色调(配色)/字体可调**。
- **不前端写死**：这些精确值/串作为**电池域生成器种子配置**（`battery.ts generatePlanDomain`）产出，数据走管线（R14/R6）。系统超集（活求解器/真规则/Action 拍板/溯源）保留为底层实现，**可见输出与 HTML 100% 一致**即可。

> 与全视图复刻的关系：本 PRD 是"参考原型全视图 1:1 复刻"队列的第 1 个（aop）；其余 sop/quarter/audit/generate/order/story/model 同法逐个出 PRD（建议另立总索引 PRD 统辖，防再漏）。基线分支：前端 + 生成器 + 契约一字段，冲突小。
