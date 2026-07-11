# WO-L1B-1 · ExecutionGraph 契约 + 线性 lift + 门（无接线）· FDE 证据

> PRD: `docs/PRD-L1B-execution-planner-workflow-runtime.md` §3 / §0.6 / §7 V10 · §8 WO-L1B-1
> 范围纪律：**纯契约 + 线性 lift + 暗发开关 + 门**·**不接线执行器/编排**（executor/orchestrator/engine 零改）。

## 1. 交付物（文件域内·未碰 apps/datacore）

| 制品 | 文件 | 说明 |
|---|---|---|
| ExecutionGraph 全契约 | `packages/contracts/src/execution-graph.ts` | §3 全 zod schema：`ExecutionGraph`/`TaskNode`（内嵌复用 `PlanStepSchema`）/`Transition`/`Gateway`/`CompensationAction`/`RetryPolicy`/`GuardExpr`/`WorkflowDagRun`/`WorkflowDagNodeState` + 纯函数 `fromLinearPlan`/`toLinearSteps`/`isLiftReversible` + 校验器 `validateExecutionGraph` |
| 契约导出 | `packages/contracts/src/index.ts` | append `export * from "./execution-graph.js"`（只加自己一行·不动 L1A） |
| 暗发双闸 | `apps/agentcore/src/config.ts` | `QOS_WORKFLOW_DAG`（=1 走 DAG 执行器·WO-2 起接线）+ `QOS_EXEC_PLANNER`（shadow/serve·WO-4 起接线）·均 `z.string().optional()` defaultOff·additive 可回退 |
| 新门 | `scripts/check-workflow-dag.mjs` | `workflow-dag:check`·牙齿自证 |
| 门串接 | `package.json` | `workflow-dag:check` alias + 并入 `pnpm gates`（`check-hidden-req-keys` 后、`build-ontology-slices --check` 前） |
| 单测 | `packages/contracts/test/execution-graph.test.ts` | 16 例 |
| 本体回写 | `docs/SYSTEM-ONTOLOGY.md` §7 + `docs/ontology/*`（`build-ontology-slices.mjs` 重生成·hash 7cbaa5d02e814400） | 登记 `workflow-dag:check` |

## 2. 契约形状（真跑核对）

- `TaskNode.step` **内嵌复用现有 `PlanStepSchema`**（qos.ts:105·9 类判别联合）——执行器整条 switch 派发零改（additive 核心）。TaskNode 解析后 `node.step` 与原 PlanStep `toEqual`（逐字节）·`node.kind` 经 `STEP_TYPE_TO_NODE_KIND` 确定性映射（invoke_solver→SOLVER_RUN 等·覆盖全 9 类）。
- `ExecutionGraph` 含 `entryNodes`（入度0 起点·Kahn 就绪集）/`transitions`/`gateways`/`compensations`/`coverageScore`/`objectiveVector`/`plannerVersion`/`generatedAt`（调用方注入·R13 `sourceGraphId`）。
- 运行态 `WorkflowDagRun`/`WorkflowDagNodeState` 镜像 build 侧 `BuildWorkflowRun`/`BuildWorkflowStep`（status/attempts/maxAttempts/checkpoint·durable 预留·本 WO 未接线）。

## 3. 线性 lift round-trip 真跑（R6 可逆）

`toLinearSteps(fromLinearPlan(plan)) ≡ plan.steps`（逐字节 `JSON.stringify` 相等）·真跑覆盖：
- **多步**（query_objects→resolve_slice→invoke_solver→render_answer）：往返 4 步逐字节一致。
- **单步**边界：单节点 `dependsOn=[]`·往返一致。
- **链结构**：`nodes[1].dependsOn=["s1"]`、`nodes[2].dependsOn=["s3"]`（前一步 id）。
- **onError 透传**：query 无 onError→FAIL·slice onError:SKIP→SKIP 保留。
- **R6 双跑字节一致**：`fromLinearPlan` 双跑 `JSON.stringify` 相等（无 `Date.now`/随机·`generatedAt` 默认 `LIFT_EPOCH`=1970 注入·可覆盖）。
- **诚实降级**：非纯链（有 gateway / 多前驱扇入）`toLinearSteps` **抛错**（不静默降级）。

单测结果：
```
 ✓ test/execution-graph.test.ts (16 tests)
 Test Files  1 passed (1) · Tests  16 passed (16)
```

## 4. 门牙齿自证（green→red·KILL-MOCK-RED）

`node scripts/check-workflow-dag.mjs` 真跑：
```
· solverKey 白名单：58 个（源 datacore SOLVER_REGISTRY·同 chain:check）
· A· 合法线性图（4 节点）→ validateExecutionGraph ok
· B· 线性 lift 往返无损（单步/多步）+ R6 双跑字节一致
· C· 牙齿自证：5 个非法图全部被逮（环/幽灵步/幽灵solver/非纯链/悬空前驱）
✓ workflow-dag:check 通过
```

**测谎实证（牙齿是真的）**：中和 `validateExecutionGraph` 的环检测（改 dist）→ 门**红** `EXIT=1`「牙齿钝：非法图「注入环」未被校验器逮住」·revert→**绿** `EXIT=0`。证明门非空转。

门内五道断言（自造合法/非法夹具·被测校验器跑）：
1. DAG 无环（Kahn·检出环→红）
2. `TaskNode.step.type` ∈ `PLAN_STEP_TYPES`（幽灵步 `teleport_data`→红）
3. 引用完整 + `invoke_solver` solverKey ∈ SOLVER_REGISTRY（幽灵 `GHOST_SOLVER_ø`→红·复用 chain:check 同源 58 键白名单）
4. 线性 lift 往返无损（非纯链扇入→`toLinearSteps` 抛错）
5. 契约漂移守（合法 lift 产物必过 `ExecutionGraphSchema.parse` + 悬空前驱→红）

## 5. R6 确定性

- `fromLinearPlan`/`toLinearSteps` 纯函数：无 `Date.now`/随机/LLM；`generatedAt`/`plannerVersion` 调用方注入（默认常量 `LIFT_EPOCH`/`LIFT_PLANNER_VERSION`）。
- 同 plan 双跑 `fromLinearPlan` 字节级一致（单测 + 门 B 段双验）。

## 6. 回归 / 可回退（additive）

- 契约字段全 additive·`execution-graph.ts` 新文件·不动旧 schema → 旧消费方零感知。
- 暗发双闸 `QOS_WORKFLOW_DAG`/`QOS_EXEC_PLANNER` 缺省 OFF = 改造前系统（本 WO 未接线执行器/编排·休眠代码）。
- 4 包 build 绿；`packages/contracts` 49 测（含新 16）绿；`agentcore` 653 测绿（config.ts 加两 optional env 零破坏）。

## 7. 门 / 本体一致性

- `ontology-writeback:check`：pnpm gates 含 46 门·§7 漏登 **0**（新门已登记）。
- `ontology-slices:check` / `ontology:check`：与母体一致（hash 7cbaa5d02e814400）。
- 完整 `pnpm gates`：所有 check-* 门绿（含新 `workflow-dag:check`）+ `pnpm -r test` 全绿 → EXIT=0。
