# FDE 证据 · WO-SANDBOX-TEMPORAL-GROUNDING（S6·时序推演接地·§3.1–§3.5）

> Dev-1/Lane 沙盘-后端。范围：ExogenousFeed（契约+init 冻结+引擎注入口）+ SimContextOverlay + hold 守恒 + 约束层。
> §3.6（回放校验 + S0 horizon 覆盖预检）由另一 agent 落，本单不含。
> 纪律：真跑（铁律 0.4）· KILL-MOCK-RED（无真源→缺口卡·绝不合成未来）· R6 确定性 · 暗发可回退。

## 1. 五件套如何"真"（非 mock）

| 件 | 文件 | 真在哪 |
|---|---|---|
| ① ExogenousFeed 冻结 | `contracts/sim.ts` + `sim/exogenous-feed.ts` + `app.ts createSimSession` | init 时从**真源**（`solvers.loadContext` 真 `demandSegments/sopVersions/purchaseOrders/maintPlans` + A8 真 `ts_points`）解逐 tick 序列冻结进 `SimSession.feeds`。无真源→feed 不生成 + `feedGaps` 缺口卡（绝不合成/外推）。 |
| ② 引擎注入口 | `sim/propagation.ts propagateTick(...,feeds?)` | 每 tick 把 `feeds[].series[tick].delta` 加到 target 格·trace 记 `feed:<key>`（R13）。缺省空=v1.1 字节一致。 |
| ③ SimContextOverlay | `sim/context-overlay.ts` | `buildSimSolverContext` 在 `loadContext(live)` 上覆盖模拟态 props（复用 `replay.ts patchContext`）。基线跑基线态、情景跑情景态→真 delta。R4 只读不 mutate base。 |
| ④ hold 守恒 | `sim/hold-conservation.ts` | `sustainingFlow[t]=pinned−naturalValue[t]`（naturalValue 来自**同真引擎跑不钉的自然演化**·非手写）→「隐含净补/日=mean」；无流入边→「纯政策假设」标注。 |
| ⑤ 约束层 | `contracts/sim.ts ConstraintViolation` + `sim/propagation.ts` | `PropagationRule +bounds{min?,max?}`·每 tick clamp 并记 `constraintViolations{raw,clamped,boundRef}`（物理不可能轨迹暴露不静默）。 |

## 2. green→red 牙齿（acceptance 逐条）

单测 `apps/datacore/test/sim-temporal-grounding.test.ts`（16 测·全绿）。

- **#1 外生真驱动·逐值对**：真 DemandSegment(dailyP50=2.5,coverageDays=60)→冻结 series 逐值===2.5；60 tick 引擎轨迹逐 tick 增量===series[t].delta，末态 250。改 dailyP50 2.5→3.0→轨迹 125→130 真变（证读真源非写死）。**牙齿实测**：把注入 share 置 0（植假）→ #1/#1b 立红（`expected +0 to be 2.5` / `expected 100 to be 125`），还原即绿。
- **#2 断真源诚实缺口卡·不假跑**：删细分（无匹配对象）→ `feeds=[]` + `gaps[gapCode=EMPTY_DATA, detail~/未找到/]`；仅聚合 p50 无逐日/覆盖→`detail~/不铺伪日曲线/`（绝不合成未来）。
- **#3 overlay 真隔离**：同一读值"求解器"基线态 0.5 vs 情景态 0.9 算出不同值；base 不被 mutate（R4 只读·`base.bases !== scenario.bases`）；未命中格保持真值。
- **#4 hold 守恒逐值对**：naturalTrajectory=[98,96,94,92,90]（真引擎跑不钉自然演化）→ sustainingFlow=[2,4,6,8,10] 逐值===pinned−natural；隐含净补/日===mean===6；无流入边→纯政策假设标注。**牙齿实测**：植假注入→natural 变 [100×5]→#4 红。
- **#5 约束 clamp+违例**：把库存推负（5+(−20)=−15）→clamp 到 0 + `constraintViolations[{raw:-15,clamped:0,boundRef:R_DRAW}]`；未越界→无违例（不误报）。
- **#7 R6 双跑字节一致**：`resolveExogenousFeeds` 双跑 `toEqual`；`propagateTick` 带 feeds 双跑 `toEqual`（含 trace feed 来源）。
- **#8 关闸=v1.1 字节一致**：`propagateTick(6 参)` 与 `propagateTick(...,{},[])` 的 next/pending/trace 全等，`constraintViolations=[]`；`sim.temporal_grounding` 关→feeds 不注入/overlay 不用/不 clamp（contracts `default([])` 旧会话零破坏）。
- **#6（回放 VALIDATED/NO_HISTORY）**：另一 agent §3.6 范围，本单不含。

## 3. 暗发 · 双注册 · 可回退

- feature `sim.temporal_grounding`（BLOCK·defaultOn:false·requires sim.propagation）**双注册**：datacore `features.ts` + agentcore `features/registry.ts`。`feature-parity:check` 绿并列 `enforced` 含 `sim.temporal_grounding`。
- 关闸路径：createSimSession 不解析 feeds（空冻结）+ tick 不注入 + 无 overlay/clamp = 回 v1.1 行为（acceptance #8）。

## 4. R9 落库（pg+memory 双实现）

- migration `040_sim_temporal_grounding.sql`：`sim_session +feeds jsonb DEFAULT '[]'`、`sim_tick_state +constraint_violations jsonb`（含 down）。
- `PgSimRepo`（自定义写列）putSession/rowToSession +feeds、putTickState/rowToTick +constraint_violations；MemSimRepo 整对象存天然带。

## 5. 门 / 测试

- 4 包 build 绿（contracts/llm-adapters/datacore/agentcore）。
- gates 绿：`sim:check` · `propagation:check`（含 sim-propagation.test.ts 回归·关闸字节一致）· `sim-readiness:check` · `genuine-sim:check` · `feature-parity:check` · `ontology-slices:check` · `ontology-writeback:check` · `system-ontology:check`。
- `test/sim-temporal-grounding.test.ts` 16/16 绿；datacore 全量套件绿（一次跑·maxThreads=2）。

## 6. 诚实边界 / caveat

- **未真起 datacore 播 60 天真 DemandSegment 走 HTTP createSimSession**：现网 battery 种子 DemandSegment 为聚合 p50（无 dailyP50/coverageDays），据设计→缺口卡（正确诚实态）。60 tick 真驱动机制以**真对象形状**（含 dailyP50+coverageDays 的 DemandSegment）在 resolver + 引擎层逐值对证明（#1）+ 植假即红牙齿证非 vacuous。端到端 HTTP 冻结路径已接（createSimSession resolveFrozenFeeds），resolver 吃的是 `loadContext` 真对象。
- ImpactAssessment/决策维**端到端 HTTP 编排**（baseline vs scenario overlay 双跑成 ImpactAssessment 答案块）属渲染/orchestrator 面（Dev-3 域·`maybeRenderSandbox`），本单只交引擎侧构件（overlay + hold + 约束）+ 单测证其真隔离/守恒/暴露。
- 单路径确定性推演·非概率区间（§2 out-of-scope·页面须标）。系数×延迟真值仍需领域判断（校准正门·不合成冒充）。
