# WO-L1B-5 · Execution Planner SERVE 翻闸 — FDE 真跑证据

> 铁律 0.4：真起 app 真编排真求解器派发·LLM mock（R6·确定性）·绝不 stub/mock 冒充完成。
> PRD：`docs/PRD-L1B-execution-planner-workflow-runtime.md` §2.2（STAGE-0/1/2）·§9（回退杠杆 V8）·NG6（判决地位不换手）。
> 交付：orchestrator serve 分支（`QOS_EXEC_PLANNER==="serve"`）——STAGE-1 fall-through（无模板意图综合图服务）+
> STAGE-2 白名单翻闸（`QOS_PLANNER_WHITELIST`·摘除=秒级回退）·综合图 → `runWorkflowDag`（QOS_WORKFLOW_DAG 开）/
> 线性 parity 串行（关）。暗发 additive·缺省 OFF = 改造前系统（NG6·可证回退）。

## C1 · STAGE-1 serve ON 真翻闸（COMPLETED + 综合图 graphId·非模板）

**真编排真跑**（`createTestApp({env:{QOS_EXEC_PLANNER:"serve"}})`·真 Fastify·真 Orchestrator·真求解器派发·LLM mock）：
- 种一个**无模板计划**的已发布意图 `serve_ut_fallthrough`（无 planId/planRef → `resolvePlanForIntent` 返 null → STAGE-1 触发点）。
- 种高覆盖真需求图（`coverageScore=1`·`solverCandidates ∈ 真 SOLVER_REGISTRY`）。
- 提交场景绑定查询（`scenarioIntentKey`·跳过 LLM classify·确定性）。

**结果（铁证）**：
```
task.status === "COMPLETED"                       ← serve 综合图真跑到终态（关闸会 PLAN_NOT_FOUND）
task.resolvedRefs[plan].key.startsWith("eg_")     ← 留痕：服务的是【综合执行图】graphId(eg_)·非模板 plan_
                                                     （orchestrator.ts STAGE-1 写 resolvedRefs:[{kind:"plan",key:served.graphId}]）
task.answer 存在                                   ← 综合图跑到 REPORT_GENERATE 终态
```
**这是 serve 真翻闸的直接证据**：无模板意图今日必 fall-through 失败；serve 档下综合出真可执行图并服务 → 出终态答案·留痕 graphId=eg_（不是模板 plan_）。

## C2 · 关闸（serve OFF）= 改造前系统（NG6 可证回退）

`createTestApp({env:{}})`（`QOS_EXEC_PLANNER` 未置）——同意图同查询同需求图：
```
task.status === "FAILED"  ·  error.code === "PLAN_NOT_FOUND"
```
即便需求图在库·关闸**不综合·不 serve** → 无模板意图直接 fail（== 改造前 fall-through 语义）。**判决地位不换手**（NG6）·可证回退。

## C3 · shadow 档 = 不翻闸（只影子·判决地位不换手）

`QOS_EXEC_PLANNER="shadow"`——同上 → `FAILED` / `PLAN_NOT_FOUND`（shadow 只落 divergence 观察·绝不 serve）。翻闸严格限 `==="serve"`。

## 门 / 测试

- `pnpm --filter @platform/contracts build` + `pnpm --filter agentcore build` 绿。
- `execution-planner:check` EXIT=0（扩 serve-mode 线性化确定性）·`workflow-dag:check` / `requirement-graph:check` 绿。
- 齿 `apps/agentcore/test/execution-planner-serve.test.ts`（C1 serve 翻闸真engage·C2 关闸 PLAN_NOT_FOUND·C3 shadow 不翻闸·3/3 绿）+ `execution-planner.test.ts`（synthesizePlan Ch10 满配 13 齿）。
- `pnpm --filter agentcore test` 全绿（含新 serve 齿）。

## 诚实边界（不作假·明记）

- **STAGE-2 白名单翻闸**：`QOS_PLANNER_WHITELIST` 派生 Set·仅白名单 intent 用综合图替换模板（有模板则 parity·NG6）。本 FDE 以 STAGE-1（无模板·观察最干净）坐实翻闸；STAGE-2 走同一 `trySynthesizeServeGraph`·覆盖门<0.8/回落/异常→保持模板（诚实·不 degrade）。
- **synthesizePlan 只综合图结构**：solver 管线（Ch10.13）+ 并行前沿（Ch10.12）+ REPORT_GENERATE 终态（`render_answer`·`params.blocks=[]` 占位）。**rich 答案块模板**（`{{steps.*.output.data}}`）不由综合器产（归后续·Ch10 §12 注）——故综合图答案 blocks 可空·**非空壳失败·是真实现状**。
- **无 LLM E2E 边界**：自由问句无 LLM → 确定性 classify 低置信 → 澄清（非本 WO 缺陷）。故 teeth 用场景绑定跳 classify + 直接种真需求图（真 orchestrator 真 serve 决策·真求解器派发·仅 classify/LLM mock per 铁律0.4）。
