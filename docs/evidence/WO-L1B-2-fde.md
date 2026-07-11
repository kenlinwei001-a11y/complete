# WO-L1B-2 · DAG 执行器（拓扑并行 + 条件 Gateway + 步级重试）· FDE 交付证据

> PRD: `docs/PRD-L1B-execution-planner-workflow-runtime.md` §2.5/§4.2/§4.3/§4.5 · WO §8「WO-L1B-2」
> 铁律 0.4：真起 datacore(SEED_DEMO)+agentcore 真跑真求解器真答案·逐值对照·暗发 defaultOff·可证回退。
> dep：WO-L1B-1（`packages/contracts/src/execution-graph.ts` + `fromLinearPlan/toLinearSteps` + `QOS_WORKFLOW_DAG` 暗发开关）已在 origin·本 WO 基其上。

## 落点（只碰 apps/agentcore + packages/contracts·未碰 datacore）

- `apps/agentcore/src/workflow/dag-executor.ts`（新）：`runWorkflowDag`——Kahn 拓扑并行 + 条件 Gateway 确定性择支 + 步级重试幂等守卫；`liftStepsToDagGraph`（纯线性 lift·parity 路径）。
- `apps/agentcore/src/workflow/executor.ts`（重构·additive）：抽出共享执行核 `executeStep` / `finalizeAnswer` / `finalizeFailed` / `mergeStepEffects` / `initWorkflowState`——串行 `runWorkflow` 与 DAG `runWorkflowDag` **同一步派发/render 投影/规则拦截代码**（parity 基石·不重造）。旧 `runWorkflow` 行为逐字节不变（永不删·RL9）。
- `apps/agentcore/src/engine.ts`：`runWorkflowSteps` 加执行器派发（`QOS_WORKFLOW_DAG=1` → `runWorkflowDag`·缺省 OFF → 旧串行 `runWorkflow`·§2.1）。
- `docs/SYSTEM-ONTOLOGY.md` §7 `workflow-dag:check` 词条回写「WO-L1B-2 已落」+ `node scripts/build-ontology-slices.mjs`（hash ba0577f425a04e00·slices:check 绿）。
- `apps/agentcore/test/workflow-dag.test.ts`（新·C1-C4 齿）。

## C1 · 真拓扑并行 + 扇入（真求解器真答案）

真起服务真跑（datacore 4001 SEED_DEMO + agentcore 4102 `QOS_WORKFLOW_DAG=1`）：
`capacity_feasibility` 意图（scenarioIntentKey 确定性绑定·presetSlots model=4680-NCM demandDelta=0.2）→ Path A workflow → `runWorkflowDag` → 真 `invoke_solver capacity_forecast` →
```
verdict ANSWERABLE · path WORKFLOW
P50 产能 = 5.0079 GWh · P90 产能 = 4.6982 GWh · 缺口比例 = 0% · 主要瓶颈=设备OEE
```
数字来自真求解器输出（非造假·⟦ref:prov_…⟧ 溯源 3 条）。单测 `workflow-dag.test.ts` C1：两独立 DATA_QUERY 分支扇入 SOLVER——前两帧均 `step.started`（并发起手·串行则 started→completed→started），扇入 `solve.step.started` 在两前驱 `step.completed` 之后，KPI 值来自 solver payload。

## C2 · 条件 Gateway 确定性择支 + 步级重试幂等守卫

- EXCLUSIVE gateway 守卫 `residualGap>0`：命中→hi 支跑·lo 支 SKIPPED（未出站）；改守卫输入 residualGap=0→default lo 支跑·hi SKIPPED（确定性·同输入同支）。
- 步级重试：可重试读工具（`query_objects`·`retryableErrors` 未声明=默认可重试）失败一次后成功→ `attempts=2`·节点 DONE·非失败。
- **幂等守卫（R4）**：`create_action_draft`（出站非幂等）即便声明 `maxAttempts:3` 失败**只调 1 次·不二次出站**（`runToolWithRetry` 对 create_action_draft/idempotent:false 一律不重试）。

## C3 · 影子对照·纯线性 lift 逐字节 parity

- 单测：同 steps 分别经旧串行 `runWorkflow` 与 `runWorkflowDag(liftStepsToDagGraph(steps))` → `answer`+`stepOutputs` JSON **逐字节一致**（唯一差异=`newId("prov")` 随机 provId·系统固有非确定性·归一后全等）。
- **真服务对照**：同一 `capacity_feasibility` 真问句分别打 DAG-on(4102) 与 DAG-off/串行(4103)：
```
DAG-on  answer 长 12275 · DAG-off answer 长 12275
BYTE PARITY (归一 prov/tc/task/ts): True
DAG-on KPIs  = [(P50,5.0079,GWh),(P90,4.6982,GWh),(缺口,0,%)]
DAG-off KPIs = [(P50,5.0079,GWh),(P90,4.6982,GWh),(缺口,0,%)]   ← 逐值一致
```

## C4/R6 · 并行双跑字节一致 + 回退演练

- **R6**：同 (graph, inputs) 双跑（打乱各节点 microtask 完成时序）→ 结果 JSON 字节一致；`stepOutputs` 键序恒按 nodeId 稳定序（alpha<mid<zeta·与并行交错时序无关）。effects 按 nodeId 稳定序合并保证键序确定。
- **回退（V8①）**：关 `QOS_WORKFLOW_DAG` → `runWorkflowSteps` 永走旧串行 `runWorkflow`；agentcore 全测（117 文件·669 passed / 4 skipped·含 workflow-dag.test.ts 7）默认 flag OFF 全绿——改造前系统。真服务 DAG-off(4103) 答案与 DAG-on 逐字节一致坐实回退等价。

## gates（EXIT=0）

- `pnpm -r build` 4 包绿 · `pnpm -r typecheck`（agentcore 绿）。
- 46 个 `check-*.mjs` 门 + `workflow-dag:check`（合法图过/环·幽灵步·幽灵solver·非纯链·悬空前驱 5 牙齿全逮）+ `ontology-slices:check`（hash ba0577f·母体↔切片一致）全绿。
- 分包测（沙箱 4 核·分包限并发避 OOM·非失败）：contracts 49 · agentcore 669(+4 skip·含 workflow-dag.test.ts 7) · datacore 1152(+15 skip·未碰·基线绿) · frontend 553 —— 4 包全绿。

## 诚实边界

- durable checkpoint 续跑 / 补偿回滚 **留 WO-L1B-3**（本 WO 只做内存态并行执行器·`checkpoint.ts` NoopStore 保留·未接线续跑）。
- 规划器 `synthesizePlan` 综合图产出留 WO-L1B-4/5；本 WO 的 DAG 执行器暗发路径经**纯线性 lift** 消费现模板计划（显式综合图接口 `opts.graph` 已备·待规划器喂）。
- parity 的「逐字节」是 **modulo `newId("prov")` 随机铸造 + toolCallId + taskId + 时间戳**——这些在改造前串行执行器自身即非确定性，非本 WO 引入。
