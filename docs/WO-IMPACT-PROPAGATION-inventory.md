# WO-IMPACT-PROPAGATION · 影响面计算存量盘点

> 取证日期 2026-08-10 · 分支 `claude/handoff-wo-impact-propagation`（从 canonical `a7f3555` 开）
> 本文是 WO 交付物 1。**先取证再动手** —— 端点怎么归一由本文的结论决定，不是先写端点再补文档。

---

## 0 · 工具自证（铁律 0.6：扫描类结论一律先跑金丝雀）

报「0 命中 / 不存在」这类**否定结论**之前，先跑一个已知必中的样例证明 grep 是活的：

| 金丝雀 | 命令 | 命中 | 判定 |
|---|---|---|---|
| `propagateTick` | `grep -rn "propagateTick" apps/datacore/src --include=*.ts \| wc -l` | **11** | ✅ 工具正常 |

金丝雀命中 ⇒ 下面的 0 命中才是「它不存在」，而不是「我没找到」。

| 否定结论 | 命令 | 结果 |
|---|---|---|
| `impact-analysis` 端点全仓不存在 | `grep -rn "impact-analysis" apps packages --include=*.ts \| wc -l` | **0** ✅ 基线正确 |
| `impactAnalysis` 标识符全仓不存在 | `grep -rn "impactAnalysis" apps packages --include=*.ts \| wc -l` | **0** |
| 本体里无 `Process_Instance` 对象类型 | `grep -rn "Process_Instance\|ProcessInstance" apps/datacore/src` | **0** |
| 本体里无 `Decision` **对象类型** | `grep -rn "typeKey: \"Decision\"" apps/datacore/src` | **0** |

---

## 1 · ⚠️ 对派单事实基线的两处订正

派单写：

> - `POST /simulation/impact-analysis` 端点：**0 命中**（不存在）
> - `affectedObjects` 类计数：**15 处**
> - `Process_Instance`=0 / `Decision`=0 是我实测的

### 订正 ①：计数是 13 / 21，不是 15（小事，但口径要对得上）

| 范围 | 命令 | 实测 |
|---|---|---|
| `apps/datacore/src` | `grep -rn "affectedObjects" apps/datacore/src --include=*.ts \| wc -l` | **13** |
| 全仓 `apps` + `packages` | `grep -rn "affectedObjects" apps packages --include=*.ts \| wc -l` | **21** |

「15」两个口径都对不上。不影响结论方向（散在别处、无统一入口），但**下面按 13 处逐条列**。

### 订正 ②：`Decision` 与 `Process` **都有一等承载物**，「=0」量错了对象（这条影响修法）

照铁律 0.6 的句式写成一句：

> **「我用『本体里没有名为 `Decision`/`Process_Instance` 的对象类型』当作『平台没有决策/流程承载物』的证据，而前者并不度量后者。」**

实测两者**都存在，且都在 `Repos` 接口上是一等 Store**：

| 维 | 承载物 | file:line | 数据 |
|---|---|---|---|
| 决策 | `decisions: Store<Decision>` | `apps/datacore/src/repo/repo.ts:247` | 运行期由 `POST /a/v1/decisions` 写入（`decision/kernel.ts:100`）；**种子 0 条**（不是没承载物，是台账当前为空） |
| 流程 | `processDefinitions: Store<ProcessDefinition>` | `apps/datacore/src/repo/repo.ts:336` | **种子 65 条**（`seed.ts:698` `seedDemoProcessLayer`），每条带 `carrierTypeKey` |
| 流程域 | `processDomains: Store<ProcessDomain>` | `apps/datacore/src/repo/repo.ts:335` | 种子 13 条（`seed.ts:697`） |

`ProcessDefinition.carrierTypeKey`（`packages/contracts/src/process.ts:200`）是**红线 3**：每条流程必须声明它作用在哪个本体对象类型上，且由 `test/process-layer.test.ts` 断言①「真跑种子后在本体里查得到」。

⇒ **这正是 `affectedProcesses` 的连接键**：受影响对象的 `type` 集合 ∩ `ProcessDefinition.carrierTypeKey` = 受影响流程。**不需要造引擎，也不需要 `ProcessInstance`。**

真正不可用的是**更细一层**：`ProcessInstance` / `ProcessTask`（PRD-enterprise-decision-twin §1「新增」清单里明写是新增）确实为 0 ⇒ 「哪一**个**流程实例被卡住、卡在谁那里」今天答不出。PRD §2.2 自述同一事实：

> **流程节点没有 Owner**：`BuildWorkflowStepSchema` / `FdeNodeSchema` / `ChainStepSchema` 三处 schema **全无** owner/actor/assignee 字段 ⇒ 「卡在谁那里」今天在数据层就答不出。
> **五种 WAITING 一个都没有**。

所以 `affectedProcesses` 的诚实形态是 **definition 粒度可用 · instance 粒度不可用**，不是整维不可用。

---

## 2 · 13 处 `affectedObjects` 逐条（file:line · 算哪类影响 · 输入 · 输出形状）

### 2.1 真正在算影响面的（3 处，其余 10 处是同一口径的传递/占位/字典）

| # | file:line | 算的是哪一类影响 | 输入 | 输出形状 |
|---|---|---|---|---|
| **A** | `apps/datacore/src/ontology-core.ts:536`（`recompute`，:341 起） | **变更驱动的依赖闭包**（栈 B 的核心）：改某对象某属性 → 沿派生规格反向依赖闭包 + 反向链路导航 → 拓扑序前向重算 | `changes: {typeKey, prop, objectIds}[]` + `opts{dryRun, apply:{objectId,prop,value}[]}` | `{ updatedObjects:number, affectedObjectIds:string[](已排序), order:string[], epoch, dryRunDeltas?:{objId,type,prop,before,after}[] }` |
| **B** | `apps/datacore/src/app.ts:3082`（`POST /a/v1/inference/whatif`，:3065 起） | A 的**唯一 REST 出口**。通用 what-if | `{ apply:[{objectType,objectId,prop,value}] }`（1–50 条） | `{ deltas, affectedObjects:number }` ← **只有一个数字，没有分项** |
| **C** | `apps/datacore/src/solvers/service.ts:672`（`genericInference`，:640 起） | A 的**求解器出口**（`generic_inference`），额外加 `rows`/`unit`/`dataMode` 诚实标 | `args.apply[]`（或 `mode:"levers"` / `grain` 分支） | `{ deltas, rows, affectedObjects:number, count, rootTypes, dataMode:"LIVE"\|"EMPTY", note? }` |

**A 是全平台唯一真正的「变更 → 受影响闭包」引擎**，B/C 都只是它的包装。这三处的 `affectedObjects` 全部 = `affected.size`（一个 number）。

### 2.2 其余 10 处（同口径的空值/占位/字典/注释，不构成第二套算法）

| # | file:line | 是什么 |
|---|---|---|
| 4 | `solvers/service.ts:270` | `generic_inference` 的 `outputShape` 契约声明（键名清单，非计算） |
| 5 | `solvers/service.ts:645` | 注释：说明 `mode:"levers"` 分支与默认路径同键 |
| 6 | `solvers/service.ts:787` | `capacityInferenceApply` 空结果占位 `affectedObjects: 0` |
| 7 | `solvers/service.ts:848` | `discoverCapacityLevers` 的 `empty` 常量 |
| 8 | `solvers/service.ts:939` | 杠杆发现返回（杠杆不是对象影响，恒 `0`） |
| 9 | `solvers/service.ts:950` | 注释：前端 `DynamicLeverPanel` 读哪些键 |
| 10 | `solvers/service.ts:962` | `dataMode:"EMPTY"` 诚实分支（型号无认证基地） |
| 11 | `solvers/service.ts:990` | 产能链分支 `affectedObjects: deltas.length`（**口径不同**：这里数的是 delta 行数，不是去重对象数） |
| 12 | `synthetic/battery.ts:902` | `EngineeringChange.affectedObjects` 属性定义（json 列，**业务数据字段**，与引擎无关） |
| 13 | `synthetic/battery.ts:1849` / `:3879` | 同上：中文名字典 + 种子值 |

> ⚠️ 第 11 条是**已存在的口径漂移**：`affectedObjects = deltas.length` 与 A 的 `affected.size`（去重对象数）不是一回事。本单**不改它**（超范围），但归一端点必须走 A 的口径并在文档里点名，免得第三套口径。

### 2.3 另一套栈（栈 A · 沙盘传导）——不产 `affectedObjects`，但它是「世界」的所有者

| file:line | 是什么 | 输入 | 输出 |
|---|---|---|---|
| `apps/datacore/src/sim/propagation.ts:302` `propagateTick` | **时间增量**传导（t→t+1 累加贡献），每 tick 全量扫全部规则 × 该类型全部对象 | `graph, state, rules, pending, tick, ruleParams, gates, perturbations` | `{ next:TickState, pending, trace, unresolvedGates, appliedPerturbations }` |
| `apps/datacore/src/app.ts:1415` `POST /a/v1/sim/sessions/:id/tick` | 上者的 REST 出口 | `sessionId` | tick 结果 |
| `packages/contracts/src/sim.ts:88` `SimSession` | **世界**：`baseSnapshot`(tick0 态) + `scope` + `curTick` + `parentCheckpointId`(分叉) | — | — |

PRD `docs/PRD-enterprise-decision-twin.md:357` 一句话总结，与本次盘点完全吻合：

> **想要的 `impact-analysis` = 栈 B 的传播算法 × 栈 A 的世界隔离。两边各有一半，缝在中间。**

同文件 §2.1 精确点出缺口：`POST /a/v1/inference/whatif` 「**没有 `world_id`**」「`affectedObjects` 是**一个数字**，**没有 processes / decisions / kpis 的分项计数**」。

---

## 3 · 四维承载物盘点（决定哪维真接、哪维诚实报不可用）

| 维 | 承载物 | file:line | 连接键（怎么从「受影响对象」推到这一维） | 形态 |
|---|---|---|---|---|
| `affectedObjects` | `ObjectInstance` + `recompute` | `ontology-core.ts:341/536` | 直接就是 `affectedObjectIds` / `dryRunDeltas` | ✅ **已实装** |
| `affectedKpis` | `Metric` 对象类型（`metricProps` + `metricDerived{delta,gapPct}`） | `synthetic/battery.ts:2265` / `:1096` / `:1115` | 受影响对象里 `type === "Metric"` 的那些；派生边由 `recompute` 自动走到 | ✅ **已实装**（`Metric` 是真类型，有 `target/actual/floorVal/unit/ksfRef`） |
| `affectedProcesses` | `ProcessDefinition` × 65 | `repo.ts:336` · `seed.ts:576-698` | 受影响对象的 `type` 集合 ∩ `carrierTypeKey` | ⚠️ **definition 粒度可用；instance 粒度不可用**（`ProcessInstance`/`ProcessTask` 全仓 0，PRD §1 列为「新增」） |
| `affectedDecisions` | `Decision` 台账 | `repo.ts:247` · `decision/kernel.ts` · `contracts/decision-kernel.ts:117` | `Decision.metricKey` / `rootRef.rootMetric.key` ∩ 受影响 `Metric` 的 `key` 属性 | ✅ **机制已实装**；台账种子 0 条 ⇒ 必须把「台账里一共几条」一起报，否则 `count:0` 会被读成「查过了没影响」 |

### 3.1 「0」的三种含义必须分开报（本仓最恨静默错答）

| 含义 | 响应形状 | 为什么不能混 |
|---|---|---|
| 这一维**没有承载物**，根本算不了 | `{ available:false, reason:"…" }` | 返 `0` = 谎称「查过了、没影响」 |
| 这一维**有承载物但全域为空**（台账 0 条） | `{ available:true, count:0, universe:0, note:"台账为空" }` | 与「有 500 条决策、一条都没受影响」是完全不同的事实 |
| 这一维**有承载物、全域非空、确实没被波及** | `{ available:true, count:0, universe:65 }` | 这才是真正的「没影响」 |

**归一端点必须能表达这三种**。只给 `count:number` 三种全部塌成 `0`，那正是本单要修的病。

---

## 4 · 结论 → 端点怎么归一

1. **口径单源**：四维全部从 **A（`ontology-core.recompute` dryRun）** 的 `affectedObjectIds` / `dryRunDeltas` 派生，**不新起算法**。`affectedObjects.count` 用 `affected.size`（去重对象数），与 `solvers/service.ts:990` 的 `deltas.length` 口径**明确区分**并在响应里注明。
2. **世界隔离**：`worldId` 映射到 `SimSession.id`（栈 A 的世界）。世界必须存在且同租户，否则 404 —— 这一条是 PRD §2.1「whatif 没有 world_id」缺口的直接落点。
3. **诚实标记**：`affectedProcesses` 带 `instanceLevel:{available:false, reason}`；`affectedDecisions` 带 `universe`（台账总数）。绝不用裸 `0`。
4. **不改存量**：不动 `recompute` 数学、不动 `inference/whatif`、不动 `propagateTick`。新端点是**第四个出口**，与 B/C 平行。
