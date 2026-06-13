# 修复报告 · G1 执行计划死路（裁决 #27 半截统一补完）

| 项 | 值 |
|---|---|
| 缺陷 | 意图"绑定执行计划"为死路——无执行计划创作模块（核对报告 G1） |
| 根因 | 团队已实现裁决 #27 的 CRUD/过滤/校验侧（workflowKind、`?kind=PLAN`、validate、求解器目录），但**意图绑定与执行解析仍走旧 `repos.plans` 存储**，未切到 workflows(kind=PLAN)——半截统一 |
| 修法 | 补完统一：意图可绑定/解析到 workflows(kind=PLAN)，使现有 WorkflowsPage 成为唯一执行计划创作页 |
| 验证 | typecheck 全绿；agentcore 161 测试通过（原 160 + 新增桥接回归 1）；含新测试断言"意图 planRef→workflow(kind=PLAN) 可解析执行" |
| 交付 | `G1-fix-execution-plan-unification.tar.gz`（4 个改动文件）+ `G1.diff.txt`（统一 diff） |

## 改动清单（4 文件）

1. **`apps/agentcore/src/catalog/service.ts`**（承重）
   - 新增 `isPlanWorkflow` / `workflowToPlan` / `resolveWorkflowAsPlan` 三个桥接函数；
   - `resolvePlanForIntent` 扩为 `Pick<Repos,"plans"|"workflows">` + `tenantId?`：先解析旧 ExecutionPlan（向后兼容），未命中则回退解析 workflow(kind=PLAN)（按 planRef.planKey latest/pin，或 planId=workflow id）；
   - `normalizePlanRef`：planId 不在 plans 时回退查 workflows，归一为 planRef(latest) 指向其 key——绑定稳健。

2. **`apps/agentcore/src/router/orchestrator.ts`**
   - 调用点 `resolvePlanForIntent(this.deps.repos, intent, task.tenantId)` 传入 tenantId（workflow 按租户列出所需）。

3. **`apps/frontend-shell/src/pages/admin/CatalogPage.tsx`**
   - 新增 `bindablePlans(plans, workflows)` = 旧 plans ∪ workflows(kind=PLAN)（前端按步骤类型过滤 kind）；
   - 列表创建按钮、编辑器绑定下拉均改用 `bindable`；
   - 引用闭合三态（裁决 #27/D-27）：选择 / **＋新建**（跳 /admin/workflows）/ **查看**（跳工作流编辑器）；空态显式"去工作流编辑器创建"，消除裸下拉死路。

4. **`apps/agentcore/test/admin-closure.test.ts`**
   - 新增回归："仅建 workflow(kind=PLAN) 不建 ExecutionPlan → 意图 planRef 绑定 → resolvePlanForIntent 解析到该工作流步骤"。

## 行为变化（修复前→后）

- 修复前：意图绑定下拉只读旧 `repos.plans`；无页面创建 plans → 下拉恒空/创建按钮禁用 → 死路。
- 修复后：意图可绑定 WorkflowsPage 创建的 workflow(kind=PLAN)；路径 A 执行时解析其步骤正常推演；旧 ExecutionPlan 仍兼容（不破坏既有种子）。

## 未触及（保持兼容）

- 未删除旧 `repos.plans` 存储与 `/plans` 端点（向后兼容，旧种子计划仍可用）；建议后续迁移作业把旧 plans 并入 workflows 后再下线（独立任务，非本修复范围）。

## 注

本修复在 v1.1 代码副本上完成并验证（typecheck + 全量测试）。这是补完团队**已开始**的裁决 #27——他们的方向完全正确，只差意图绑定/执行解析这最后一段接线。
