# WO-L1B-3 · durable checkpoint 续跑 + 补偿反向序 — FDE 真跑证据

> 铁律 0.4：真起服务真跑真数据真看结果·LLM/工具 mock（R6·确定性）·绝不合成/兜底冒充真值。
> PRD：`docs/PRD-L1B-execution-planner-workflow-runtime.md` §2.3/§4.4/§4.6/§7（V3/V5/V8/V9）。
> 交付：durable checkpoint 续跑（移植 build 侧 `BuildWorkflowEngine`·G-8⑤/G-11）+ 补偿反向序（R4·经 S2）
> + `workflow_dag_runs` 表（migration 015·R9 四处）+ 续跑/读端点（`qos.workflow_dag` 暗发门）。

## C1 · 真崩溃续跑逐字节等价（V3·`stopAfterNode` 真停·resumedCount·跳过 DONE 不重跑）

**执行器级真跑**（真 `DurableWorkflowCheckpointStore` over `createMemoryRepos` + 真 `runWorkflowDag`/`resumeWorkflowDag`）：
图 `a(query_objects) → b(invoke_solver) → render`，`stopAfterNode="b"`。

- 崩溃阶段真跑了 `a`+`b`（真工具调用 `["query_objects","invoke_solver"]`），抛 `WorkflowDagInterrupted`，run 落库 `status=RUNNING`、`b.status=DONE`、`render.status=PENDING`。
- 续跑阶段 **零工具调用**（`a`/`b` 从 checkpoint 回灌·`render` 无工具）→ 跳过 DONE 节点不重跑坐实。
- 续跑答案 `norm(resumed) === norm(uninterrupted)`（归一随机 provId·系统固有）→ **逐字节等价**；KPI 值 `118.6` 来自 solver 真 payload。
- 续跑后 run `status=COMPLETED`、`resumedCount=1`（真 +1）。

齿：`apps/agentcore/test/workflow-dag-durable.test.ts` C1 ✓。

**真起服务 HTTP 续跑**（`PORT=4144 QOS_WORKFLOW_DAG=1 node apps/agentcore/dist/main.js`·内存态·mock datacore）：

```
POST /b/v1/workflows/wf_seed_capacity/run  → runId=wfr_01KX88XSSM07CEEXNVW4C0X4PW  status=COMPLETED
GET  /b/v1/workflow-dag/runs/{runId}        → run.status=COMPLETED
       nodes[s1].status=DONE  attempts=1  checkpoint={setOutput:true, output:{data:{items:[真 solver 模型对象…]}}}
POST /b/v1/workflow-dag/runs/{runId}/resume → status=COMPLETED  resumedCount=1   ← 真续跑·resumedCount++
```
持久化 checkpoint 承载**真求解器/切片输出**（非合成）——node.checkpoint.output 即执行侧真值快照。

## C2 · 补偿反向序·出站经 S2（R4）·不可逆诚实 COMPENSATED=false

图 `q(read) → act(create_action_draft·出站) → boom(失败)`，`rollbackOnFailure:true`。
补偿声明 `[{forNode:q,kind:NOOP},{forNode:act,kind:REVERSING_ACTION,step:create_action_draft(revert_plan)}]`。

- **反向拓扑序**：q 先完成、act 后完成 → 补偿反向 = `act` 先于 `q`；`workflow_dag.compensated` 事件序 `["act","q"]`。
- **出站经 S2（R4）**：`act` 反向步 `action.step.type==="create_action_draft"` → 经补偿钩子提交 S2 审批流（EXECUTED 才落·非静默反转）；`compensated=true`；run→`COMPENSATED`，节点 `act.status=COMPENSATED`。
- **NOOP 只读跳过**：`q`（read）补偿 kind=NOOP·不入钩子·`compensated=true`（无副作用）。
- **不可逆诚实 false**：同图不提供 compensate 钩子（不可逆）→ `act` 事件 `compensated=false`（不伪装已补偿）·run→`FAILED`（有不可逆步·非 COMPENSATED）。

齿：`workflow-dag-durable.test.ts` C2（两例）✓。engine.ts 派发处的真补偿钩子把反向 `create_action_draft` 经 `GuardedToolExecutor` → S2 草案（审批门·R4）。

## C3 · 回退演练两态（V8·被证明非声称）

- **关闸 NoopStore**：`NoopWorkflowDagCheckpointStore.save/load` 皆 no-op → `load` 恒 `undefined`（无 durable run·无从续跑·崩溃回退现状 `INTERRUPTED_BY_RESTART` 启动扫描语义不变）。`ops/sweep.ts sweepResumableDagRuns` flag 关 → `workflow_dag_runs` 空表 → listResumable=[] → 无操作。
- **端点关闸 404**（真 inject·`workflow-dag-endpoints.test.ts`）：`deps.features.mock.disable("qos.workflow_dag")` → `GET/POST /b/v1/workflow-dag/runs/:runId` → **404 `FEATURE_NOT_FOUND`**（entitlement 先于 authz·R3）。HTTP 层同证（feature ON·mock ALL → 200）。
- **migration 015 down→up 幂等**：`015_workflow_dag_runs.sql` 全 `CREATE TABLE/INDEX IF NOT EXISTS`；down 段 `DROP … IF EXISTS`（运维回滚脚本）——down→up→down→up 由构造幂等（**沿用已落地 `013_pre_analyses.sql` 同款约定**·pnpm migrate 运行器只跑 up 段）。沙箱无 pg，**由构造 + 013 模式对等** 保证；审核方 real-pg 复验（PRD §7 V8④）。

## C4 · 契约对账（镜像 `BuildWorkflowStep`·status/attempts/checkpoint 同形）

落库 run 经 `WorkflowDagRunSchema.parse` 通过；每 node 态经 `WorkflowDagNodeStateSchema.parse`（`status/attempts/maxAttempts/checkpoint` 齐·同形 `BuildWorkflowStep`）；DONE 节点带 `checkpoint`（步产出快照·续跑基线）。齿：`workflow-dag-durable.test.ts` C4 ✓。

## R2 租户隔离（V9）

- 执行器级：`store.load("tenantB", runOfTenantA) === undefined`（跨租户不可见）。
- HTTP：`GET /b/v1/workflow-dag/runs/{demoRun}` with `X-Debug-User: other:bob:admin` → **404**。
- inject：other 租户读 demo run → 404。齿 C3/endpoints ✓。

## 门 / 测试

- `pnpm -r build` 4 包绿。`workflow-dag:check` EXIT=0·`repo-pg-notnull:check` 绿（94 表）·`ontology-slices:check` 绿（母体回写 §2.H WorkflowDagRun + §7 WO-L1B-3 + 切片重生成 hash 一致）。
- agentcore 全量测试绿（含新 `workflow-dag-durable.test.ts` C1–C4 + `workflow-dag-endpoints.test.ts` 真 inject）。

## 诚实边界

- **续跑 OBO token**：手动续跑端点用请求者鲜活 token（忠实 A6 行级过滤）；启动扫描用落库 `authCtx`（tenant/user/roles·**无 token**·no-secrets）——dev/mock 忠实，prod OBO token 过期则剩余节点 DataCore 调用**诚实失败**（run 留 FAILED·不伪装）。跨系统 Saga（外部幂等/对账）单列 WO-L1B-SAGA·延后（NG2）。
- **内部 `workflow_dag.*` 事件**：非 SSE（守 QOS §8.2 零新 SSE 事件名）·经 outbox（engine 派发处本单未接线 emitDag·留 no-op·后续 outbox 接线）。
