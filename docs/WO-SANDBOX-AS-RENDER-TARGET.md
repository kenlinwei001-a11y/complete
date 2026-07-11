# WO · SANDBOX-AS-RENDER-TARGET（沙盘从独立页 → "时序推演"意图落地渲染器）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。
> 一句话：把 `SandboxView` 注册为**渲染器**，定义一类"**时序推演**"意图，让**人机对话/场景卡/what-if 按钮/主动告警**等异构触发全部归一成一个 `SimulationRequest`，经**同一管线**（配套预检→建会话注入扰动→推演→渲染进沙盘→答案先行→对话追问分支）落地——沙盘从"孤立工具页"降为"对话/意图的答案画布"。
> 依据：`docs/REVIEW-sandbox-intent-vs-reality.md §8`（页面定位裁定）+ `docs/WO-SANDBOX-CONFIG-COVERAGE.md`（S0·配套门·**本 WO 的前置**）。所有锚点已核对真实存在。
> 纪律：沿 `docs/DESIGN-refit-rollback-plan.md` 七原则（暗发/只加不改/旁路/影子/回退演练入齿/单期复验/失败判据前置）。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`ClassificationResult`（§2.H·`qos.ts:224`）· `Intent`/`ExecutionPlan`（§2.H·目录新增时序意图类）· `SimSession`/`PropagationRule`/`SandboxViewConfig`（§2.I·`contracts/sim.ts`）· `ScenarioCard.presetContext`（§2.H·`scenarios-catalog.ts:26`）· `AnswerBlock`（§2.H·`qos.ts:251`）· 拟立 `SimulationRequest`（§2.I·统一触发载荷）。
**触及链路（母体 §3）**：**编排链答案侧新增落点**——Query→classify→时序意图→plan(`targetView:"sim-sandbox"`)→SimSession→render；多轮对话→`simBranch`；采纳→Action(R4)。
**不变量（母体 §5）**：R1 contracts-only · R2 tenant · R3 entitlement 先于 authz（暗发门）· R6 确定性（同 request 同 tick 序同结果·LLM mock）· R13 溯源（每 tick trace + 数据血缘）· R14 零业务常数（触发载荷抽象·配置驱动）· R16 发育（配套缺→GrowthTicket）· R17 决策单页（答案先行）。**发布律十红线**：RL2 暗发（`defaultOn:false`）· RL9 additive（旧路径永不删）· RL10 不与在建分叉。
**断点（母体 §8）**：G-1（配套预诊断补强）· G-3（presetContext 注入·本 WO 归一它）· G-4（入口收口·沙盘不再独立 nav）· G-9（场景→推演发育）。
**回写母体**：落地后 §2.I 登记 `SimulationRequest`、§3 补"时序意图→沙盘渲染"落点链、§4 复用（无新事件）；跑 `pnpm ontology:slices`。

---

## §1 背景·目标·依赖

### 1.1 问题（REVIEW §8 裁定）
`SandboxView` 不在 `views/registry.ts` 渲染器注册表（注册的是 dashboard/risk-board/project-sim/plan-audit/sop-balance/order-chain），是独立路由 `/v/sim-sandbox`（`App.tsx:143`），**孤立于"问题→意图→渲染"主链**——这是"不知道怎么用/没入口"的架构根因。且人机对话、场景卡、告警等触发各接各的。

### 1.2 目标
把沙盘重定位为 **"时序推演"意图的落地渲染器（主）+ 沙盘工作台（副）**，所有触发归一。**净效果**：入口 −1（收敛①）· 对话即推演（倒推②的自然入口）· 从不冷开（自解"不知道怎么用"）· 配套缺则诚实报缺不假跑（呼应配套诚信）。

### 1.3 依赖
- **前置**：`WO-SANDBOX-CONFIG-COVERAGE`（S0）——配套（传导规则/状态变量）须先对 gap 引擎可见，本 WO 的"配套预检门"才能判"渲染进沙盘 vs 显配套缺口"。
- **协同**：`PRD-upstream-classify-precision`（兄弟单A）——时序意图若识别不准会落 Path B；融合分类提升命中。
- **复用（已存在·非新造）**：`presetContext`（`scenarios-catalog.ts:26`）· `registerRenderer`（`registry.ts:16`）· 多轮上下文 `conversationSummary`/`previousConversationTasks`（`orchestrator.ts:679`）· `createSimSession`/`simTick`/`simBranch`（`/a/v1/sim/*`·`SandboxView.tsx:753`）· `AnswerBlock` 判别联合（`qos.ts:251`）。

---

## §2 统一触发架构（核心设计）

### 2.1 归一载荷 `SimulationRequest`（v1.1 泛化·情景四原型·不限产能）
所有触发产出同一载荷。**v1.1 修正（用户钉）**：情景不只"冲击型"（停线/急单）——须覆盖**保持型**（"成品库存水位保持 X，未来 60 天利好利空"）、**趋势型**（需求逐周 +2%）、**政策型**（改一条规则系数）。抽象四原型全走 `(typeKey, stateVar, 数值)`（R14 零业务常数·库存/产能/物流/金融只是配置内容）：
```typescript
// packages/contracts/src/sim.ts（新增）
const CellRefSchema = z.object({                       // 作用到谁的哪个状态变量（抽象·任意行业）
  objectType: z.string(), objectIds: z.union([z.array(z.string()), z.literal("ALL")]), stateVar: z.string(),
});
export const ScenarioActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shock"),  target: CellRefSchema, delta: z.number(), atTick: z.number().int().default(0) }),                    // 冲击：一次性增量（停线/急单）
  z.object({ kind: z.literal("hold"),   target: CellRefSchema, value: z.number(), fromTick: z.number().int().default(0), toTick: z.number().int().nullable().default(null) }), // 保持：钉住水位（库存保持 X·用户示例）
  z.object({ kind: z.literal("trend"),  target: CellRefSchema, deltaPerTick: z.number() }),                                                  // 趋势：逐 tick 递变
  z.object({ kind: z.literal("policy"), ruleKey: z.string(), coefficientOverride: z.number() }),                                             // 政策：会话级系数覆盖（叠 G-10 coefficientRef 之上）
]);
export const SimulationRequestSchema = z.object({
  targetView: z.literal("sim-sandbox"),
  scope: z.object({ objectType: z.string(), objectIds: z.array(z.string()) }),
  scenario: z.array(ScenarioActionSchema).default([]), // 空 = 纯当前态演化
  horizonTicks: z.number().int().min(1),               // tick=1 模拟日（simclock 同义）·"60 天"→60、"3 周"→21
  compareBaseline: z.boolean().default(true),          // true = 双跑（基线 vs 情景）产 ImpactAssessment（§2.5）
  slotPresets: z.record(z.string(), z.unknown()).default({}),
  source: z.string(),                                  // dialogue/scenario/whatif/alert/workspace（溯源 R13）
});
export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;
```
> **引擎 additive 小扩展（`sim/propagation.ts`·纯函数·R6）**：`hold`/`trend` 需一个 `applyScenarioOverlay(state, actions, tick)`——每 tick 传导算完后把 pinned 格重钉/递变（确定性、不读未来、trace 记 overlay 来源）；`policy` = `effectiveCoefficient` 查找序加一层"会话级 override"（现有 coefficientRef 机制之上·additive）。**传导核数学不动。**

### 2.2 五类触发 → 同一 SimulationRequest
| 触发 | 归一方式 |
|---|---|
| **① 人机对话(QueryDock NL)** ★ | classify → 时序意图 → `extractedSlots{scope,disruption,horizon}` → SimulationRequest（§2.4） |
| ② 场景卡 | `card.presetContext` 直接映射（targetView 指 sim-sandbox·slotPresets→disruption） |
| ③ 决策视图 what-if 按钮 | `whatif.ts whatIfQuery` 归一为 SimulationRequest（替换现散字段） |
| ④ 沙盘工作台直接 | 页面内扰动控件（改造 S1）产出 |
| ⑤ 主动告警/推送 | 检出风险 → 预置 SimulationRequest（"推演一下?"） |

### 2.3 统一管线（所有触发汇流·含诚实门）
```
[任意触发] → SimulationRequest
   ├─(前置门·S0)配套预检 preAnalyze：传导规则/状态变量齐吗?
   │     ├ 缺 → gap AnswerBlock「配套缺 N 项」+ GrowthTicket（不假跑·诚实空态）
   │     └ 齐 ↓
   ├─ createSimSession(baseSnapshot=真态, scope 注入 disruption)
   ├─ propagateTick(horizonTicks)（引擎逐 tick 真传导·R6）
   ├─ render into sandbox（targetView:"sim-sandbox"·答案先行横幅 + DAG 证据）
   └─ 出口：采纳→Action(R4·RL4) ／ 对话追问→simBranch
```

### 2.4 人机对话路径（headline·多轮·两类问句示例）
**冲击型**：QueryDock 打"常州二线停 3 周,交付缺口多大?" → classify 命中 `sim.shock` 类意图 → slots `{scope:常州二线, shock:停线, horizon:21}` → 双跑 → 横幅"W3 交付缺口 1.8 万套" → 追问"那外协呢?" → `previousConversationTasks` 恢复场景 → `simBranch` B 注入应对 → A/B 对比。
**保持型（用户示例·泛化关键）**："成品库存水位保持在 X,未来 60 天对企业运营有哪些利好和利空?" → classify 命中 `sim.hold` 类意图 → slots `{target:成品库存.水位, value:X, horizon:60}` → **双跑**（基线=自然演化 vs 情景=hold）→ 产 `ImpactAssessment` → 横幅分**利好/利空**两栏（§2.5）。两类问句走**同一管线**,只是 ScenarioAction 原型不同。

### 2.5 ImpactAssessment（利好/利空双向评估·答案先行的泛化形态）
"缺口 X 万套"单值结论只适合冲击型;保持/政策型的答案是**多维双向影响**。设计:
```typescript
// 决策维注册表（配置·R14 零硬编码——"交付/成本/齐套"只是电池租户的配置内容）
// DecisionDim = { key, label(i18n), source:{solverKey,outputPath}|{stateVar}, direction:"higher_is_better"|"lower_is_better" }
export const ImpactAssessmentSchema = z.object({
  horizonTicks: z.number().int(),
  items: z.array(z.object({
    dimKey: z.string(), baseline: z.number().nullable(), scenario: z.number().nullable(),
    delta: z.number().nullable(),
    verdict: z.enum(["FAVORABLE", "UNFAVORABLE", "NEUTRAL", "NO_DATA"]),  // delta×direction 判·无数据诚实 NO_DATA
    evidence: z.string(),                                                  // 真源（solver provId / trace·R13）
  })),
  summary: z.string(),                                                     // "利好 2 项 · 利空 2 项 · 净判断…"
});
```
- **verdict 判定纯机械**：`delta` 的符号 × 维度 `direction` → FAVORABLE/UNFAVORABLE（R6 确定性·不靠 LLM 判好坏）；求解器无数据 → `NO_DATA`（诚实·绝不硬凑）。
- **⛔ 接地门禁（S6 前置·2026-07-11 配套审计钉死）**：求解器决策维必须经 **SimContextOverlay** 在模拟态上算（否则基线==情景=假评估）；`hold`/长 horizon（60 天）必须有 **ExogenousFeed 真源覆盖 + 守恒输出**。三者由 `WO-SANDBOX-TEMPORAL-GROUNDING`（S6）提供——**S6 未 DONE 前：ImpactAssessment 求解器维/hold 类意图不得上线**，hold 问句诚实答"时序接地配套建设中"+ 工单（KILL-MOCK-RED）。S1 MVP 边界 = shock 短程 + 状态变量级结论。
- 库存-保持示例的维（**演示配置·非代码写死**）：齐套达成(`kit_readiness`·higher)↑=利好 · 缺货风险(`risk_timeline`·lower)↓=利好 · 持有成本(`inventory_optimize`·lower)↑=利空 · 资金占用(`finance_pnl`·lower)↑=利空——四个都是 `SOLVER_DATADEP` 真实求解器。
- 该注册表与 S3（分支对比决策维）**共用同一份**（一处配置两处消费·R-一致）。

---

## §3 详细设计（dev 照此实现）

### 3.1 契约（`packages/contracts/src/sim.ts`）
- 新增 `SimulationRequestSchema`（§2.1）。
- `SimSession.scope` 接受 `disruption`（现 scope 是 `{presetContext}`·additive 扩）。

### 3.2 沙盘注册为渲染器（`apps/frontend-shell/src/views/registry.ts`）
```typescript
registerRenderer("sim-sandbox", () => import("./sim/SandboxView"));
```
- `SandboxView` 适配 `ViewRendererProps`（现是独立页·需接 `view`/`presetContext` 入参而非只读 URL）——**保留 URL what-if 兼容路径（RL9 不删）**。
- 保留独立路由 `/v/sim-sandbox`（副态·工作台）；**从一级 nav 降级**为"从任一推演答案→展开工作台"（沿 GROWTH-TICKET-MERGE tombstone 范式·不静默删）。

### 3.3 时序推演意图类（v1.1 按情景原型组织·不按业务域组织·R14）
新增一组意图，plan 带 `targetView:"sim-sandbox"` + sim 编排步。**按 §2.1 四原型组织（域无关），业务问法进 examples（租户配置）**：
- `sim.shock_whatif`（冲击类·examples:"停线/急单/断供…"）· `sim.hold_whatif`（保持类·examples:"库存水位保持X未来60天利好利空/价格保持…"）· `sim.trend_whatif`（趋势类·examples:"需求每周涨2%…"）· `sim.policy_whatif`（政策类·examples:"安全库存系数调到X…"）。
- 每意图：examples（供 classify·租户可扩）+ slots（scope/target/value|delta/horizon）+ plan（S0 预检 → createSession(scenario) → 双跑 → ImpactAssessment/缺口 → render）。
- **域泛化自检（验收必测）**：同一意图类须至少 2 个不同域问法命中（产能"停线3周" + 库存"水位保持X60天"）——证意图类不锁产能。
> **诚实边界**：意图识别质量依赖兄弟单A（classify 融合）；本 WO 建意图目录 + plan 落点，识别精度由 A 提升。未命中→诚实 Path B（不硬塞）。
> **与 WO-CAP-08-OPS-FLOW 分工（防撞车·对账 2026-07-11）**：CAP-08 做"运营负责人一条龙"（沙盘内操作流串联·依赖 CAP-05/06/07）；本 WO 做"NL 意图→渲染器落地"（QueryDock 进沙盘）。接缝 = 本 WO 的 SimulationRequest 供 CAP-08 的流内跳转复用；**互不重复实现**。

### 3.4 配套预检门接入（复用 S0）
plan 首步（或 preAnalyzeQuery 旁路）调 gap 引擎判 `propagation_rule`/`state_var` 是否齐（依赖 S0 覆盖）：
- 缺 → 产 `type:"gap"` AnswerBlock + GrowthTicket，**不进 createSession**。
- 齐 → 继续。

### 3.5 两层实现
- **Layer 1 · 渲染驱动（本 WO 交付·MVP）**：plan 设 targetView + 传 SimulationRequest 作 presetContext → SandboxView（渲染器）复用现有建会话/推 tick/渲染逻辑。对话追问用现有多轮上下文 + `simBranch`。
- **Layer 2 · 技能驱动（登记后续 WO·不在本单）**：注册 `sim.tick/sim.act/sim.branch` MCP 工具让 Agent 多步主动驱动（真主动指挥台·后端编排 provenance 更强）。

---

## §4 触点清单（dev 改哪些文件）

| 文件 | 改动 | 面 |
|---|---|---|
| `packages/contracts/src/sim.ts` | +`SimulationRequestSchema`·scope 扩 disruption（additive） | 契约 |
| `apps/frontend-shell/src/views/registry.ts` | +`registerRenderer("sim-sandbox",…)` | 前端 |
| `apps/frontend-shell/src/views/sim/SandboxView.tsx` | 适配 `ViewRendererProps`（接 view/presetContext·保 URL 兼容） | 前端 |
| `apps/frontend-shell/src/App.tsx` · `ShellLayout.tsx` | 沙盘从一级 nav 降级（tombstone·保路由） | 前端 |
| `apps/agentcore/src/scenarios-catalog.ts` 或意图目录 | +4 时序意图类（examples/slots/plan·targetView:sim-sandbox） | 后端/发育 |
| `apps/agentcore/src/router/orchestrator.ts` | 时序意图 plan → SimulationRequest 组装 + S0 预检旁路 | 后端 |
| `apps/agentcore/src/growth/pre-analyze.ts`（S0 落地后） | 配套预检复用 | 后端 |
| `docs/SYSTEM-ONTOLOGY.md` §2.I/§3 | 回写 SimulationRequest + 落点链 | 回写 |

---

## §5 验收（真跑·铁律 0.4·含回退演练）

1. **人机对话 E2E（真起双服务+真浏览器·两原型都测）**：
   a. 冲击型："常州二线停3周交付缺口"→ 渲染进沙盘、横幅出缺口结论、DAG 高亮、逐值对照后端 SimSession 态。
   b. **保持型（域泛化）**："成品库存水位保持X，未来60天利好利空"→ 双跑（基线vs情景）→ 横幅出利好/利空两栏，每项 verdict==机械判定（delta×direction）、evidence 指真求解器输出（provId 可点）；无数据维显 NO_DATA 不硬凑。
2. **配套缺诚实**：对一个**无传导规则**的租户/scope 发同问句 → 出"配套缺N项"gap 卡 + GrowthTicket，**绝不假跑出红**（§10 诚信·green→red 自证：临时删规则→应转 gap 卡）。
3. **多轮追问→分支**："那外协呢?"→ 恢复场景 + `simBranch` + A/B 对比真跑。
4. **五触发归一**：场景卡/what-if 按钮/告警各发一次 → 都落同一 SimulationRequest 管线、同一渲染（触发源 source 字段可溯 R13）。
5. **R6 确定性**：同 SimulationRequest 双跑字节一致（LLM mock）。
6. **回退演练**：feature key `sim.sandbox_render`（`defaultOn:false`）关 → 时序意图回落原行为（Path B 或旧 what-if URL 路径·**旧路径未删**）；沙盘独立路由仍在（副态）；`registerRenderer` 摘除 → 无该渲染器诚实空态卡（非白屏）。
7. **入口收敛**：nav 无沙盘一级项、`/v/sim-sandbox` 302/tombstone 承接（参 GROWTH-TICKET-MERGE 齿）。
8. **gates 全绿**（含 prd:check / css-vars / genuine-sim）。

---

## §6 失败判据（中止即回退·派单时写死）
- F1 时序意图误命中普通问句（把非推演问题吸进沙盘）→ 收窄意图 examples + τ;关 `sim.sandbox_render`。
- F2 配套缺却假跑（违诚信）→ S0 预检未接死;关闸,补预检。
- F3 SandboxView 适配渲染器破坏原独立页/URL what-if → RL9 违例;revert,保双路径。
- F4 对话多轮丢上下文（追问重新问）→ 查 previousConversationTasks 接线。
- F5 任一门禁红 → 不进下一期（P6）。

---

## §7 排序与依赖
- **前置**：`WO-SANDBOX-CONFIG-COVERAGE`（S0·配套可见）DONE + 主 PRD `preAnalyzeQuery` 可用。
- **协同**：兄弟单A（classify 精度·提升时序意图命中）。
- **本 WO = S1 核心**（"页面→意图落地视图"重定位·Layer1）。
- **后续**：Layer2（sim.* MCP 技能·主动指挥台）· S2 trust badge · S3 分支注入 · S4 雷达合一 · S5 tick↔日历（见 DISPATCH）。

## 附录 · 证据锚点
`views/registry.ts:16/50-60`（registerRenderer·沙盘缺）·`App.tsx:143`（独立路由）·`scenarios-catalog.ts:26`（presetContext 归一载荷）·`orchestrator.ts:679`（多轮上下文）·`qos.ts:224/227/251`（ClassificationResult/extractedSlots/AnswerBlock）·`SandboxView.tsx:753`（createSimSession scope 注入）·`app.ts:1473`（simBranch）·母体 §5 R1/R3/R6/R13/R14/R16/R17 · §8 G-1/G-3/G-4/G-9。
