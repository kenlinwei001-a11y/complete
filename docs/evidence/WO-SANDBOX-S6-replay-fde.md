# FDE 证据 · WO-SANDBOX-TEMPORAL-GROUNDING §3.6（回放校验接线 + horizon 覆盖预检）

> Dev-1/Lane 沙盘-后端 · 暗发（`sim.temporal_grounding` 同键 + env 逃生阀）· 关闸 = v1.1 行为字节一致（NG6）。
> 铁律 0.4：真起 · 真 A8 ts_points · 真 cert 端点 · 逐值对照 · 不作假。无真源 → 诚实 NO_HISTORY / 缺口卡，绝不假验证/外推（KILL-MOCK-RED）。

## 1. 交付物（严守 lane）

| 文件 | 归属 | 改动 |
|---|---|---|
| `apps/datacore/src/sim/replay-validate.ts` | 独占（新） | `replayPropagationRules`（复用 propagateTick 确定性引擎 + M11 回放-对比范式）+ `buildDailyStatesFromSeries`（A8→逐日真态·稀疏不外推） |
| `apps/datacore/test/sim-replay-validate.test.ts` | 独占（新） | 10 例：纯函数 VALIDATED/OUT_OF_TOLERANCE/NO_HISTORY/R6 + 真 A8 端到端 cert + horizon 预检 + 暗发回退 |
| `docs/evidence/WO-SANDBOX-S6-replay-fde.md` | 独占（本文件） | — |
| `packages/contracts/src/sim.ts` | 共享·append-only 末尾块 | 仅 `// === WO-S6 §3.6 replay-validate ===`：ReplayValidationStatus/RuleReplayResult/ReplayValidationResult/HorizonCoverage |
| `apps/datacore/src/app.ts` | 共享·仅 cert/precheck 函数 | L3 回放钩子 + S0 horizon 预检 + 3 私有 helper（temporalGroundingOn/buildReplayHistory+runReplayValidation/computeHorizonCoverage）；**未触** createSimSession |

未触碰（他 agent §3.1–§3.5）：`sim/propagation.ts`、`sim/context-overlay.ts`、`ExogenousFeedSchema`、`SimSession.feeds`、hold/约束。未触 `docs/SYSTEM-ONTOLOGY.md`（避免双 agent 冲突·§8 G-10 由主循环收口回写，文见 §6）。

## 2. 回放如何复用 M11（未重建传导数学）

- **确定性重放引擎** = 复用沙盘既有 `sim/propagation.ts propagateTick`（与 `/tick` 端点同一逻辑）——只"驱动"逐日前推，**不另写任何传导数学**（check-propagation 门守 sim/ 内 R14 零业务常数·绿）。
- **回放-对比范式** = 同构移植 `calibration/replay.ts` M11 `replayPairs`（逐样本 预测 vs 实际、APE 累加、容差判定）。M11 的 `replayPredictedDaily`（一次 rollup 重放任意样本）在此由 `propagateTick`（一次 tick 重放整图）担同一"确定性预测器"角色。
- **教师强制**：每步都以真实态为源（真实外生=真历史逐日喂入），比较模型预测 Δ 与真实 Δ，隔离规则本身预测力（避免误差跨日复合污染判定）。延迟规则 pending 跨步携带（到达步真触发）。
- R6 确定性：纯重算，无 Date.now/random；computedAt 由调用方传入；遍历按 key 稳定排序。（test「R6 双跑字节一致」绿）

## 3. green→red teeth（验收 #6）

| 场景 | 输入 | 断言（绿） | 红条件 |
|---|---|---|---|
| VALIDATED（纯函数） | 真历史 tgtΔ=0.5×src，规则 coeff=0.5 | status=VALIDATED · meanApe=0 · samples=19 · validatedCount=1 | — |
| OUT_OF_TOLERANCE teeth | 同上真历史，规则 coeff=0.9（偏离真值） | status=OUT_OF_TOLERANCE · meanApe>15% | 若容差判定失灵会误标 VALIDATED → 红 |
| NO_HISTORY | dailyStates=[] | status=NO_HISTORY · meanApe=null | 若假验证会给 VALIDATED → 红（KILL-MOCK-RED） |
| **真 A8 端到端（cert）** | 真 repos：2 类型/2 对象/1 链路 + 2 真历史 series（tgtΔ=0.5×src·20 天真 ts_points）+ 1 已发布规则 | cert.replayValidation.status=VALIDATED · rule PR_DRIVES=VALIDATED · meanApe=0 · **l3Validated=true** | UNCALIBRATED→VALIDATED 转正路径断则红 |
| **NO_HISTORY teeth（真 demo battery）** | demo 有 90 天 A8 历史但 series 度量与传导 stateVar 不重叠 | replayValidation.status=NO_HISTORY · 全规则 NO_HISTORY · 缺口 RULES_UNCALIBRATED · l3Validated=false | 若拿不匹配历史假验证会给 VALIDATED → 红 |
| 暗发回退（NG6） | gate 关（无 env/无 feature） | cert **无** replayValidation/l3Validated 字段（v1.1 行为不变） | — |

## 4. S0 horizon 覆盖预检（真源=需求预测周期 ForecastSnapshot.weeks×7）

| 场景 | 断言 |
|---|---|
| 30 天预测 + `?horizon=60`（gate 开） | horizonCoverage.sufficient=false · source=`forecast_snapshot.weeks` · 缺口 **HORIZON_UNCOVERED**（"需求预测仅覆盖 N 天，无法支撑 60 天推演——绝不静默截断/外推"·喂 GrowthTicket） |
| gate 关 / 无 horizon 参数 | precheck **无** horizonCoverage 字段（原视图不变） |

**绝不静默截断/外推**：覆盖不足只出诚实缺口卡（KILL-MOCK-RED），不合成未来。

## 5. gate/test 结果

- `@platform/contracts` build 绿 · `datacore` build 绿。
- 定向 `test/sim-replay-validate.test.ts`：**10/10 绿**。
- 沙盘/诚实门：`sim:check` · `genuine-sim:check` · `sim-readiness:check`（certification.ts 投影纯度未破·我未触该文件）· `propagation:check`（sim/ 内 R14 零业务常数·replay-validate.ts 清白）· `no-fake-data:check` · `no-silent-mock:check` 全绿。
- datacore 全量套件：见提交说明（一次跑·maxThreads=2）。

## 6. 母体回写待办（§8 G-10·主循环收口写·避免双 agent 冲突）

> 建议文本：**G-10「改规则即改推演」状态补**：
> "回放校验已接（WO-S6 §3.6）：`sim/replay-validate.ts replayPropagationRules` 取 A8 `ts_points` 近 N 天真实序列，以真实态为初、真实外生逐日喂入 `propagateTick`（确定性重放·复用而非重建），逐日对比预测 Δ vs 实际 Δ，容差内 → 规则 `VALIDATED`；无历史 → 诚实 `NO_HISTORY`。结果进就绪认证 cert（`replayValidation` + `l3Validated`）——L3『已验证』获得实义 = 关键传导规则回放容差内，是 S2 徽标 `UNCALIBRATED → VALIDATED` 的唯一转正路径。S0 预检扩 horizon 覆盖（`forecast_snapshot.weeks×7` vs 请求 horizon，不足→`HORIZON_UNCOVERED` 缺口卡 + GrowthTicket，绝不静默截断/外推）。暗发键 `sim.temporal_grounding`，关闸=v1.1 行为字节一致。"

## 7. 诚实边界（caveat）

- **demo battery 无匹配 series → 真 NO_HISTORY**：demo 的 A8 度量（attainment/oee/yield）与种子传导规则 stateVar（demandDelta 等）不重叠，故 demo 上回放诚实判 NO_HISTORY——这是真实结果，非缺陷；VALIDATED 转正路径以「真 repos 写入的对齐 A8 ts_points 世界」经真 cert 端点证明（test 例①，非 mock 函数返回）。
- **暗发键双注册**：`sim.temporal_grounding` 由他 agent（§3.1–§3.5）在 `features.ts FEATURE_REGISTRY` 注册；本 lane **不另立键**、只消费同键（`features.enabled` 对未注册键安全返 false）。额外 env 逃生阀 `SIM_TEMPORAL_GROUNDING=1` 仅供注册落地前真跑校验，默认 OFF。
- **规则-格归因**：预测/实际按目标格全值 Δ 对比（模型对现实的预测力），多规则命中同格时误差归各贡献规则——MVP 容差判定口径，已注释说明。
