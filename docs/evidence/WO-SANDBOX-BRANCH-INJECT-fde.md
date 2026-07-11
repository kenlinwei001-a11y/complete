# FDE 证据 · WO-SANDBOX-BRANCH-INJECT（S3 后端 · Dev-1）

分支后每条时间线可注入不同应对（外协/加班/降配），`compare` 从"全局态均值曲线"升级为
**决策维差量**（DecisionDim 注册表·配置驱动 R14·不写死交付/成本/齐套）。决策维经 S6
`SimContextOverlay`（`buildSimSolverContext`）在各分支模拟末态上**真算**——A/B 各覆盖真世界承载对象
props → 按 objectType 聚合 stateVar → `delta×direction` 机械判（**非原始态 diff·非曲线均值·非造 delta**·
KILL-MOCK-RED）。暗发 `sim.branch_inject`（双注册 datacore+agentcore·defaultOff·requires `sim.branch`）。

## 铁律 0 · 本体引用与影响
- 对象类型：`SimSession`（`scope.mitigation` 承载注入·SimSessionSchema 未改）、`ObjectInstance`（overlay 承载）。
- 契约：`contracts/sim.ts` 末尾 additive `// === S3 branch-inject ===` 块（`SimMitigation`/`DecisionDim`/`CompareDecisionValue`/`CompareDecisionVerdict` 等 6 导出·零改既有 schema→merge-clean）。
- 链路：`POST /a/v1/sim/sessions/:id/branch`（+`mitigation` 注入 child tick0 baseSnapshot）、`GET /a/v1/sim/compare?…&dims=…`（+`decisionDims`）。
- 不变量：R6（同 compare 双跑字节一致）、R14（决策维配置驱动·零业务常数）；经 S6 overlay 真算（非 `loadContext(live)` 重读→守 G-B「基线==情景」不塌）。
- 门禁：`feature-parity:check`（sim.branch_inject 双注册·enforced 13 键）、`sim:check`、`system-ontology:check`。

## 边界 / 诚实缩范围（钉死）
- **coefficient-level 注入（WO §3.1 ruleAdjustments/actionTemplateRef）未做**：需 session-scoped `effectiveCoefficient` overlay 进 `sim/propagation.ts`（并行 agent 文件域·off-limits）。本 WO 落 §3.1 备选——**state-level tick0 注入**（`injections[]` 叠 child baseSnapshot），完整满足验收 §5.1–§5.5（A≠B·真决策维 delta·R6·rollback）。coefficient-level 待 propagation.ts session-overlay 落地后另单。
- **决策维聚合于 `loadContext` 的 typed carrier arrays**（`OVERLAYABLE_CONTEXT_ARRAYS`）：Battery/demo 类型(Base/Order)命中；未载入的完全通用非电池类型聚合为 `null`（诚实 NO_DATA·非伪造）——S6 overlay 面继承限，非本 WO 引入。
- **未在 overlay 上跑图求解器**（finance_pnl/order_fullchain）：其内部 `loadContext(live)` 会重读 live 抵消 overlay（G-B 失败模式）。直接 stateVar 聚合于 overlay 态才是诚实的"经 overlay 真算"·且守文件域。

## teeth（test/sim-branch-inject.test.ts · 5/5 绿）
| 场景 | 结果 |
|------|------|
| Feature ON | branch A(outsource −3)→`baseSnapshot.risk=7`·B(overtime +5)→`15`；compare `decisionDims=[{a:7,b:15,delta:8,LOWER_BETTER→A_BETTER}]` |
| Feature OFF（fresh tenant） | mitigation 被忽略→两分支 `risk=10`（回容器分支）·无 `mitigation` echo·compare 省略 `decisionDims`（旧行为字节一致） |
| R6 | 同 compare 双跑字节一致 |

## FDE（真起服务 · 铁律 0.4 · 收口方独立复跑 2026-07-11）
真起 `apps/datacore/dist/server.js`（PORT=4071·SEED_DEMO=1·内存仓储）→ curl demo/admin：
create session（`baseSnapshot.obj_test.risk=10`）→ checkpoint → branch A/B 各携不同 `mitigation`（`key`+`injections[]`）：
- **branch A**（`outsource`·inject risk −3）→ tick0 `state.obj_test.risk = **7**`。
- **branch B**（`overtime`·inject risk +5）→ tick0 `state.obj_test.risk = **15**`。
- **A ≠ B**（7 vs 15）——同 checkpoint 分叉、不同应对导出不同时间线（acceptance §5.1–5.5 达标）。
- 关闸演练：无 `mitigation` 的 branch C → 恒等容器分支（无注入·`scope.mitigation=undefined`）——回退演练 §5.5。
- `compare` `decisionDims` 经 S6 overlay 在真 carrier 对象上聚合（a=7/b=15/delta=8/A_BETTER）由 §5.4 test（合并态全量 EXIT=0）+ 施工 agent dist-server 原跑覆盖。

## 门 / 构建
- 三包 build 绿（contracts/datacore/agentcore）。`sim:check`/`genuine-sim:check`(exit 0)/`sim-readiness:check`/`propagation:check`/`feature-parity:check`(exit 0·enforced sim.branch_inject 双注册)/`system-ontology:check`(exit 0)/`ontology-slices --check`：全绿。
- 合并态 datacore 全量：见收口。
