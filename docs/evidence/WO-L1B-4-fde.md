# WO-L1B-4 · Execution Planner `synthesizePlan`(Ch10 满配) + 影子接线(shadow only) — FDE 真跑证据

> 铁律 0.4：真起服务·真数据·真跑·真看结果；LLM 分类 mock（R6·项目明定"LLM 一律 mock"）；绝不合成/兜底/哈希冒充真值。
> 分支基线 `origin/claude/vigilant-knuth-b1nmxn @ ed60cf0`（L1A-3 + L1B-3 已落）。

## 交付物
- `apps/agentcore/src/growth/execution-planner.ts` —— 纯函数 `synthesizePlan(reqGraph, registries, opts) → ExecutionGraph`（R6·无 Date.now/Math.random/LLM/IO）。满配 Ch10.6 Task Graph 生成 / 10.7 Task Mapping / 10.8 Skill Match（历史因子中性 1.0·NG5 不伪造） / 10.9 Agent Assign / 10.11 Dependency Resolution（Kahn 拓扑） / 10.12 Parallel / 10.13 Solver Orchestration（管线） / 10.14 Multi-Objective。覆盖门 <0.8 或综合非法 → 诚实回落模板（`fromLinearPlan`·绝不产非法图）。
- `apps/agentcore/src/router/orchestrator.ts` —— `runPathA` 内 `resolvePlanForIntent` 后 / `runWorkflowSteps` 前影子段（`QOS_EXEC_PLANNER`·**STAGE-0 shadow ONLY**·全 try/catch·不发 SSE 帧·不设 graph=synthesized）；`runPlannerShadow` / `recordPlannerShadow` / `getPlannerShadow`（in-process sideband + best-effort `PreAnalysisReport.planner`）。
- `packages/contracts/src/execution-graph.ts` —— `PlannerDivergence` / `PlannerShadowRecord` schema（additive）；`databuilder.ts` `PreAnalysisReport.planner` optional（零迁移）。
- `scripts/check-execution-planner.mjs` —— 门 `execution-planner:check`（并入 `pnpm gates`）。
- `apps/agentcore/test/execution-planner.test.ts` —— 13 齿。

## C1 · 真需求图 → synthesizePlan（真起 live datacore·真本体图·真注册表·真纯函数）

真起 datacore（内存 `SEED_DEMO=1`·端口 4001·`SERVICE_TOKEN=svc-l1b4`）+ agentcore（端口 4002·`QOS_REQUIREMENT_GRAPH=1 QOS_EXEC_PLANNER=shadow`）。
harness（`scratchpad/fde-planner.mjs`）拉 **live datacore `/a/v1/ontology/graph` 真本体图**（64 类型 / 64 边）→ 真 `buildRequirementGraph` → 真 `synthesizePlan`（真 `VALID_SOLVER_KEYS`）：

```
[live] datacore 本体图 nodes=64 edges=64
[RG]  solverCandidates=[affected_orders,audit_timeline,bottleneck_matrix,capacity_forecast,capacity_rollup,
        maintenance_stagger,mitigation_select,multi_plan_compare,outsourcing_split,quote_margin,
        shared_bottleneck,what_if_displacement,yield_diagnosis]  (13)
      sliceTargets={rootType:"Base", targets:["Equipment","Line","Process"]}  coverage=1  nodes=38
[SYNTH] graphId=eg_task_fde  fallback=false  nodes=17  objectiveVector=["MIN:成本"]
        entryNodes=[node_slice_Equipment, node_slice_Line, node_slice_Process]   ← Ch10.12 并行前沿(入度0)
        node_slice_{Equipment,Line,Process} [DATA_QUERY resolve_slice]  dependsOn=[]          ← 并行数据获取
        node_solver_affected_orders [SOLVER_RUN] dependsOn=[3 个 slice]                        ← Ch10.11 扇入
        node_solver_audit_timeline → bottleneck_matrix → capacity_forecast → … → yield_diagnosis ← Ch10.13 管线链
        node_render [REPORT_GENERATE render_answer] dependsOn=[node_solver_yield_diagnosis]     ← 终态扇入
```

**逐值断言（对账真注册表·真拓扑）**：
```
[ASSERT] 每 invoke_solver.solverKey ∈ datacore REGISTRY_SOLVER_KEYS : PASS  (13/13 节点)
[ASSERT] validateExecutionGraph(DAG 无环 + 节点∈registry)           : PASS
[ASSERT] R6 双跑字节一致（同 reqGraph+注册表+generatedAt→同 JSON）  : PASS   (C2)
[DIVERGENCE] templateStepCount=1 synthesizedNodeCount=17 maxParallelWidth=3 fellBack=false
```
Skill/Agent 择优（Ch10.8/10.9）逐值对账见单测 D 组（历史/成本因子 `=1.0`·bound skill 胜出·Agent 能力交集匹配·双跑同选）。

## C2 · R6 确定性双跑字节一致
上 harness `R6 双跑字节一致: PASS` + 门 `execution-planner:check` B 组 + 单测 `C2`（三处独立证）。

## C3 · 影子期零用户可见变化（NG6 additive）
单测 `execution-planner.test.ts` C3：真起测试 app 两实例——baseline（`QOS_REQUIREMENT_GRAPH=1`）vs shadow（`+QOS_EXEC_PLANNER=shadow`），同问句"影响哪些订单？"（affected_orders·真 Path A 工作流·真求解器答出 7 行订单表）→ **answer 逐字节一致**（归一每实例随机 ULID `prov_/tc_` 后·`norm(shadow.answer)===norm(base.answer)`）；shadow 实例 `getPlannerShadow` 有记录（证影子确实跑）。
真起 live 服务 in-vivo：flags ON 提交真问句 → 任务达 clean 终态（`AWAITING_CLARIFICATION·error:none`·无 LLM 凭据故分类走澄清·符合预期）· agentcore 日志**零 planner/shadow 异常**（影子 try/catch 未触发·未破坏主链）。

## C4 · parity 报告按 intent 聚合 divergence
`diffPlannerShadow` 产 `PlannerDivergence{templateStepCount,synthesizedNodeCount,entryNodeCount,maxParallelWidth,addedStepTypes,removedStepTypes,sameStepTypeMultiset,fellBackToTemplate}`；`buildPlannerShadowRecord` 带 `intentKey`（聚合键）。单测 C4：shadow 期 `getPlannerShadow(taskId)` 返 `{taskId,intentKey:"affected_orders",divergence{...}}`。

## 覆盖门回落（诚实·绝不产非法图）
门 C 组 + 单测：`coverageScore=0.5 → isFallbackGraph=true`（`fromLinearPlan`·合法图·往返无损·`fellBackToTemplate=true`）；无可综合节点（无 slice 无 solver）→ 回落（非非法空图）。

## 门禁牙齿（green→red→green·实证有牙）
```
拔牙：删 synthesizePlan 的 `.filter(k => validSolverKeys.has(k))`（模拟回归）→ rebuild
  → execution-planner:check RED：「牙齿钝：幽灵 solverKey 剔除 未如预期」
revert → rebuild → execution-planner:check GREEN ✓
```

## 回退演练
- `QOS_EXEC_PLANNER` 未置 → 影子段不执行 → 单测「关 env 无影子记录（`getPlannerShadow`=undefined）」PASS；同问句 answer 与改造前逐字节一致（C3）。
- 旧 `resolvePlanForIntent`/`runWorkflowSteps` 判决地位不换手·永不删（NG6）。契约字段全 optional（additive·零迁移）。

## 门 / 测试结果
```
pnpm --filter @platform/contracts build : GREEN
pnpm --filter agentcore build           : GREEN
execution-planner:check                 : EXIT 0（A 综合合法+管线+并行 / B R6 / C 覆盖门回落 / D Skill·Agent 择优 / E 牙齿）
workflow-dag:check                      : EXIT 0
requirement-graph:check                 : EXIT 0
ontology-writeback:check                : EXIT 0（pnpm gates 50 门 §7 漏登 0）
ontology-slices:check                   : EXIT 0（11 切片 hash 一致）
pnpm --filter agentcore test            : 697 passed | 4 skipped（含新 execution-planner.test.ts 13 齿）
```

## 本体回写
`docs/SYSTEM-ONTOLOGY.md` §2.H（Execution Planner + PlannerShadowRecord 对象）· §3/§10.3 中枢链（计划综合影子链）· §7（`execution-planner:check` 登记）→ `node scripts/build-ontology-slices.mjs` 重生 11 切片（hash 一致）。

## 诚实边界
- 真起 datacore 服务真本体图 + 真注册表 + 真纯函数是**真数据真跑**；LLM 分类 mock 属项目明定红线内（R6·"LLM 一律 mock"）。
- 13 求解器串成管线（Ch10.13·docx battery Forecast→MILP→… 范式）——问题类目 `SOLVER_COVERAGE` 全候选串链·确定性·非并行择一（serve 期择优/剪枝可演进·本 WO shadow 只观察不服务）。
- HistoricalSuccess/Cost 因子中性 1.0（无学习层·诚实标注·NG5·绝不伪造历史分）。
- 覆盖门 `coverageScore` 咨询非判决·永不误红（NG6）。
```
