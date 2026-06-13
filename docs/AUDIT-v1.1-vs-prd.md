# 一致性核对报告 · v1.1 实现 vs PRD 文档集（28 份）

| 项 | 值 |
|---|---|
| 核对对象 | f9b770ec…v1.1.zip（=fbf851eb…v1.1，两份字节相同）；477 源文件 |
| 方法 | 契约级硬约束优先，静态比对 + 行级取证；非全量逐行（477 文件） |
| 总评 | **高度一致**：实现严格跟随 PRD 架构与契约；发现 2 个实质缺口，均为"代码早于最近增量"所致——其中 1 个正是客户验收发现的"绑定执行计划"死路，根因已定位到行 |

## 一、强一致项（抽样核对，逐项匹配）

| 契约点 | 文档 | 实现 | 结论 |
|---|---|---|---|
| SSE 事件名（8 个） | QOS §8.2 | task.accepted/routing.completed/clarification.required/step.started/step.completed/answer.final/action_draft.created/task.failed/task.cancelled 全部存在 | ✅ 逐字一致 |
| 错误码 | 实施手册 §1 | AGENT_SCOPE_VIOLATION/CYCLIC_DERIVATION/CYCLIC_INVOCATION/NESTING_DEPTH_EXCEEDED/PLAN_LOCKED/PLAN_VALIDATION_ERROR/IMMUTABLE_VERSION/FEATURE_NOT_FOUND/DATACORE_UNAVAILABLE/BUDGET_EXCEEDED… 全部命中 | ✅ |
| contracts 包结构 | 各 PRD interface | 18 个契约文件（actions/admin/agentcore/datacore/execution/features/livedin/llm/ontology-governance/qos/refs/replay-ops/solvers/timeseries/workspace…）与文档模块一一对应 | ✅ |
| 产能预测公式 | §S1.2 | capacity.ts:158 `curveMult: ramp 0.88+0.03(w−1)(w≤4),1.0(w≥5); maint×0.72`；certFactor；健康度系数——注释直接引用 §S1.2 | ✅ 公式忠实 |
| 意图目录 20 场景 | 20 场景目录 §1 | scenarios-catalog.ts 含全部 20 个意图 key（capacity_feasibility…carbon_q） | ✅ 内容到位 |
| 管理台页面 | 管理平台+治理+运营增量 | 26 个 admin 页（Catalog/Agents/Workflows/Skills/Mcp/Scenes/Rules/RuleDocs/Permissions/Synthetic/Connections/Calibration/OpsFallback/OpsSchedule/Features/LlmProviders/Tenants/Users/Views/Modeling/FieldProfile/Actions…）+ Object360/TaskDetail | ✅ 远超骨架 |
| 持久化 | 实施手册 W01 | 真实 PostgreSQL migrations（datacore 3 + agentcore 4 个 .sql DDL），非内存 | ✅ |
| 双系统松耦合 | 平台 §1.2 | datacore/agentcore 独立 app，agentcore 经 API 调 datacore | ✅ |

**判断**：实现团队紧贴文档，契约纪律执行到位——这是远高于行业平均的"文档→代码"一致度。

## 二、实质缺口（2 个，需修复）

### G1【死路·契约违反】执行计划与工作流未统一（=客户验收发现的那个死路）

- **现象**：意图编辑器"绑定执行计划"下拉无选项/无法进入下一级。
- **行级根因**：`CatalogPage.tsx:216` 绑定下拉遍历 `(plans ?? [])` 集合；而全仓**唯一**的工作流创作页是 `WorkflowsPage.tsx`，它创建的是 `workflows` 集合。二者是**两个不同集合**——意图要 `plans`，没有任何页面创建 `plans` → 下拉恒空 → 死路。
- **契约状态**：实现停留在 planId/ExecutionPlan 与 workflow **分裂**的旧模型（仓内同时存在 planId/planKey/planRef 与 workflowRef/workflowKey，过渡态）。
- **对应裁决**：这正是**基线裁决 #27（管理面闭合性增量 §1）** 要修的——ExecutionPlan = Workflow 统一为单一资源（kind=PLAN/ORCHESTRATION），意图绑定改 `workflowRef` 且下拉列 kind=PLAN 已发布工作流。该增量晚于 v1.1，故未实现。
- **修复**：按管理面闭合性增量 §1+§3 统一资源 + WorkflowsPage 作为唯一创作页 + 意图下拉改读 kind=PLAN 工作流；并补 §2 的"＋新建/查看"三态（D-27）。

### G2【完整性缺口】13/21 求解器未实现，对应 13 个场景运行时会失败

- **行级证据**：`datacore/src/solvers/service.ts:165 compute()` 的 switch 仅实现 capacity_forecast/bottleneck_matrix/risk_timeline/affected_orders/plan_audit/plan_generate/capex_scenario（7 个；sop_balance 按 §S1.8 为工作流）。
- **缺失**：mitigation_select/cert_schedule/kit_readiness/lta_gap/inventory_optimize/changeover_sequence/yield_diagnosis/maintenance_stagger/outsourcing_split/quote_margin/credit_exposure/quarterly_gap/carbon_footprint——这 13 个只在 `scenarios-catalog.ts`（意图/场景声明）出现，无 compute 实现。
- **后果**：S06、S07–S16、S19、S20 共 13 个场景触发后 `invoke_solver` 抛 SOLVER_NOT_FOUND；仅 S01–S05、S17、S18（7 个）端到端可跑。
- **对应文档**：20 场景目录 §2 给了这 13 个的**公式级规格**——晚于 v1.1，故声明先到、实现未跟。
- **修复**：按 §2 公式逐一实现并入 compute switch + 参照实现双算进 VLE。

## 三、时间线解读（为何恰好缺这两块）

v1.1 打包于 06-13 14:43，**忠实实现了截至最近几份增量之前的全部 PRD**；而 G1（裁决 #27 管理面闭合）与 G2（20 场景目录的 13 个求解器公式）是我**最近几轮**才产出的增量——意图/场景的**声明层**已被收进 v1.1（20 意图、scenarios-catalog），但 G1 的**资源统一**与 G2 的**求解器实现**尚未传导到代码。客户发现的死路 = 裁决 #27 的精确印证。

## 四、待补核对（需要时继续）

本轮覆盖契约骨架与两条关键线；以下未逐一展开，可按需深入：派生公式 DSL/resolveSlice 文法符合性、权限行级注入实现、上下文三刀、MCP 命名空间、数据流闭环接线（DL1–DL10）、ID 生成裁决 D-01。如要全量逐文件，建议按 28 份文档 × 模块分批核对。

## 五、结论

实现与文档**一致度高、契约纪律强**；两个缺口都不是"实现错了"，而是"最新两份增量尚未传导"——且其中一个正是你用真实系统验收时撞到的死路，静态核对已定位到 `CatalogPage.tsx:216`。修复路径明确（裁决 #27 + 20 场景目录 §2），不涉及返工。
