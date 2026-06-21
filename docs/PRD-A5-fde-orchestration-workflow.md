# PRD · A5 · FDE 编排工作流（可观测节点状态图：意图→倒推→查能力→比差→各模块生成→进启动器）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 3 |
| 取代/扩展 | 扩 `PRD-fullstack-story-build-g8.md`（数据构建发动机）· `PRD-fde-fullstack-build-workflow.md` · 消费 `PRD-A3-*`（多跳切片规划器=查能力/比差/倒推的图基座） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H StoryBuildRun · §3 构建链 · §5 R10/R11/R13） · `apps/datacore/src/databuilder/{service.ts,comprehend.ts,capability-inventory.ts,closure.ts,artifacts.ts,selfcheck.ts}` · `apps/agentcore/src/workflow/executor.ts`（节点执行范式） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：数据构建发动机的全栈倒推**逻辑已在**（comprehend→查能力→比差→倒推→各模块 scaffold→闭包→publish→runInference），但**没被表达成一张可观测的节点状态图**。A5 把 FDE 建域过程定义为一条**编排工作流**，每个阶段是一个可观测节点（状态 + I/O + 下钻 + 耗时），实时推进，终点"进启动器"——让"建域到底走到哪一步、断在哪"一眼可见。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H/D1）：`StoryBuildRun`（建域记录，作 run 容器）·`BuildPlan`·`ClosureReport`·`ScaffoldReceipt`·`GapReport`·`ProducedArtifact`（模块同步矩阵）·`ExecutionPlan/Workflow`（FDE 编排本身可注册为一条 ORCHESTRATION 工作流）·`Scenario`（进启动器）。
- **触及链路**（§3 构建链 + §10.3 `sys.meta.change_loop`）：把 `StoryScript → comprehend → capability-inventory(查能力) → gap(比差) → assemblePlanBody(倒推各模块) → scaffold → closure → publish → 启动器` 显式建为**节点状态图**；查能力/比差/多跳倒推消费 **A3 切片规划器**。
- **触及事件/数据流**（§4，D-29）：复用 `storybuild.run_recorded`；**新增** `fde.node_advanced`（节点状态变更，IN_SESSION，失效 FDE 编排图）——让跨会话/被动页实时反映节点推进。
- **触及不变量**（§5）：
  - **R10 D-29**：每节点完成发 `fde.node_advanced`，前端订阅实时刷新。
  - **R11 全链闭包**：节点图末段"闭包/scaffold/全链闭合"是 R11 的可视化（CHAIN/SHAPE/OBJECT/DATA/FORWARD 逐段 + HARD/SOFT 徽章，复用既有）。
  - **R13 可溯源**：每节点 I/O 可下钻到真实产物（BuildPlan/ClosureReport/ScaffoldReceipt/GapReport）。
  - **R6**：节点状态由确定性管线驱动（LLM 仅 comprehend 节点，mock 测试）。
- **关闭/影响断点**（§8）：补 **G-3/G-8**（建域过程不可观测 → 现可视、断点定位）；是 A10 终态闭环的"可观测载体"。
- **门禁**（§7）：`ontology:check`（事件/锚不漂）· 闭包门（节点图末段即闭包门可视化）· 前端回归（节点图渲染 + 断点高亮）。
- **回写承诺**：回写本体 §2.H（FDE 编排工作流 + fde.node_advanced）· §3（构建链节点化）· §10.3（`sys.meta.change_loop` 节点图投影）· §8（G-3/G-8 推进）。

## 1. 目标 / 非目标
### 目标
1. **FDE 建域 = 一条可观测编排工作流**，固定节点序：`① 意图/故事 → ② comprehend 倒推 → ③ 查能力(capability-inventory) → ④ 比差(gap) → ⑤ 各模块生成(对象/规则/求解器/切片/B栈 scaffold) → ⑥ 闭包(closure R11) → ⑦ publish(R4) → ⑧ 进启动器(Scenario)`。
2. **每节点可观测**：状态（PENDING/RUNNING/DONE/FAILED/SKIPPED）+ I/O 计数 + 耗时 + **下钻真实产物** + 断点高亮（FAILED→缺口码）。
3. **实时**：节点推进经 `fde.node_advanced` 事件实时反映（R10），跨会话/被动页可见。
4. **复用**：run 容器 = `StoryBuildRun`；节点产物 = 既有 BuildPlan/ClosureReport/ScaffoldReceipt/GapReport/模块同步矩阵；执行范式借 `workflow/executor.ts`。

### 非目标
- 不重写建域逻辑；A5 是**观测层 + 编排表达**，把既有阶段串成节点图。
- 不替代 DataBuilderPage 现有区块（时间线/矩阵/闭包可视化）；A5 把它们统一进"节点状态图"主视图。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 倒推逻辑 | `comprehend.ts`（LLM 三件 + 确定性 B 栈倒推 `assemblePlanBody:113`）· `capability-inventory.ts`（查能力/比差 `:5`） | 未成节点图 |
| 闭包/自检 | `closure.ts`（R12/R11）· `selfcheck.ts`（缺口码） | 未挂节点状态 |
| 模块产物 | `artifacts.ts`（producedArtifacts/模块同步矩阵） | 未挂节点 I/O |
| run 记录 | `StoryBuildRun`（时间线、validationTrace、storyCoverage） | 无"节点逐步状态"维度 |
| 节点执行范式 | `workflow/executor.ts`（QOS path-A 节点状态） | 未用于 BUILD 管线 |
| 实时 | `storybuild.run_recorded`（终态） | 无逐节点实时事件 |

## 3. 设计（节点图 = 既有阶段的可观测编排表达）
### 3.1 FDE 编排定义（声明式节点序）
- `databuilder/fde-graph.ts`（新）：定义 `FDE_NODES`（8 节点 + 各自 `produces`/`consumes`/`gateKind`）。可选把它注册为一条平台 `ExecutionPlan kind=ORCHESTRATION`（dogfooding：用平台工作流表达平台建域）。
### 3.2 节点状态机（复用 StoryBuildRun）
- `StoryBuildRun` 加 `nodes:[{key,label,status,startedAt,endedAt,io:{in,out},drilldownRef,gapCode?}]`（contracts 扩，仓储一字段）。
- `runStory` 各阶段在进入/完成时更新对应 node + 发 `fde.node_advanced`（节点 key + 状态 + I/O）。
- 节点→产物下钻引用：② BuildPlan · ③ capabilityInventory · ④ GapReport · ⑤ producedArtifacts/ScaffoldReceipt · ⑥ ClosureReport · ⑦ publish Action · ⑧ Scenario(targetView)。
### 3.3 查能力/比差/倒推接 A3
- ③查能力 / ④比差 用 **A3 多跳切片规划器**：把 comprehend 的"需求清单"对现状切片/求解器做图路径覆盖 diff（命中=复用、未命中=缺口 NO_PATH）。
### 3.4 前端节点状态图（DataBuilderPage 主视图）
- `<FdeGraph>`：8 节点横向 DAG，节点显示状态色 + I/O 计数 + 耗时；点节点 → 抽屉下钻真实产物；FAILED 节点红 + 缺口码（"断在 NO_SLICE/SHAPE_MISMATCH"）。
- 实时：订阅 `fde.node_advanced`（经 F1 全局事件通道）逐节点点亮。
- 末节点"进启动器"：DONE 即出 `InferenceButton`/`useQuickLaunch`（跳 targetView 出答案，接 A10）。

## 4. 契约 / 端点
- `contracts/storybuildrun.ts`：`StoryBuildRun.nodes[]`、`FdeNodeSchema`、`FDE_NODE_KEYS`。
- 端点：复用 `POST/GET /a/v1/databuilder/runs`（run 带 nodes）；新事件 `fde.node_advanced` 入 `event-subscriptions.ts`。
- 仓储：StoryBuildRun 加 nodes 字段（R9：memory+pg+migration+接口；story_build_runs 表已在）。

## 5. 关键流程（端到端）
提交故事 → 节点图起：①意图 DONE → ②comprehend RUNNING→DONE（产 BuildPlan，可下钻）→ ③查能力（A3 规划器 diff，产 inventory）→ ④比差（GapReport，缺口高亮）→ ⑤各模块生成（对象/规则/求解器/切片/B栈，producedArtifacts 逐增）→ ⑥闭包（R11 逐段徽章）→ ⑦publish（R4 审批）→ ⑧进启动器（出答案，交 A10 验证）。任一节点 FAILED → 红 + 缺口码，守"绿测试≠能用"。

## 6. 非功能（§5）
R10（节点事件实时）· R11（闭包节点可视）· R13（节点产物可溯）· R6（确定性管线，LLM mock）。

## 7. 验收（DoD）
- 建域跑一遍，8 节点状态图实时点亮；每节点可下钻真实产物；断链节点红 + 缺口码。
- `fde.node_advanced` 驱动跨会话实时刷新。
- `pnpm -r build && pnpm -r test` 全绿（StoryBuildRun.nodes 双仓储 + FdeGraph 前端用例 + 事件订阅回归）；`ontology:check`/闭包门过。
- 回写本体 §2.H/§3/§4/§10.3/§8。

## 8. 分期
- **A5.1** FDE_NODES 定义 + StoryBuildRun.nodes 字段（R9 四处）+ runStory 各阶段写节点状态。
- **A5.2** `fde.node_advanced` 事件 + 前端 `<FdeGraph>` 实时节点图 + 下钻。
- **A5.3** ③/④ 接 A3 切片规划器（查能力/比差图覆盖）+ 末节点接 A10。

> 依赖 A3（规划器）。基线分支：StoryBuildRun 加字段涉 migration，需对准基线。
