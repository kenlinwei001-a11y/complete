# WO-L1A-3 · RequirementGraph 接线（观察态·暗发·可回退）· FDE 真跑证据

> PRD-L1A-requirement-graph-engine.md §2.1/§5/§7 · 铁律 0.4 真起真跑 · KILL-MOCK-RED。
> 依赖 L1A-1（parser）+ L1A-2（builder·三白名单门）已在 origin。本 WO 只做**编排接线 + 持久化 + 读端点**（additive·观察态·不改判决/路由/answer）。

## 交付物（file:line）
- `apps/agentcore/src/router/orchestrator.ts`：`runPipelineInner` classify 落库（`patch({classification})`）后、τ 决策前 additive 调 `buildRequirementGraphSideband`（暗发 `QOS_REQUIREMENT_GRAPH==="1"`·**全 try/catch 吞异常·绝不阻断主链**）；新私有方法 `buildRequirementGraphSideband`（parseQuestionAst → buildRequirementGraph → `requirementGraphs.upsert` → emit `step.started`/`step.completed{stepId:"requirement-graph"}`·失败发 `outcome:"failed"` 步帧留痕不静默）。
- `apps/agentcore/src/server.ts`：读端点 `GET /api/v1/queries/:taskId/requirement-graph`（经 `/b/v1/queries` 重写别名 → `GET /b/v1/queries/:taskId/requirement-graph`）·entitlement `growth.requirement_graph` 门（关→404 FEATURE_NOT_FOUND·R3 先于 authz）·R2 `getByTaskId` 带 tenant 谓词（跨租户 undefined→404）。
- 持久化（R9 四处·独立表·**非搭车 PreAnalysisReport 避与并发预分析 upsert lost-update**）：`persistence/repos.ts`（`requirementGraphs` 接口）+ `memory.ts`（Map 双实现）+ `pg.ts`（INSERT ON CONFLICT）+ `migrations/014_requirement_graphs.sql`（含 DOWN 段·RL9 幂等）。
- entitlement **双注册**（DataCore 是权威源·无此则功能永不可开）：`apps/agentcore/src/features/registry.ts` + `apps/datacore/src/features.ts`（同键 `growth.requirement_graph`·`defaultOn:false`·RL2）。
- 母体回写 `docs/SYSTEM-ONTOLOGY.md`：§3 中枢链「需求图旁路」节点 · §4（line 176）伪步帧复用注记 · §7 `requirement-graph:check` 门补「WO-L1A-3 已接线」 · §8 G-1「需求图结构化升级」；`node scripts/build-ontology-slices.mjs` 重生成 11 切片（母体 hash 848778abdca43eb3）。

## 真跑环境（内存模式·LLM 无 provider·R6 确定性）
- datacore `PORT=4001 SEED_DEMO=1 SERVICE_TOKEN=<svc> CREDENTIAL_KEY=<64hex>`（tenant demo·admin/demo1234 真 JWT）。
- agentcore `PORT=4152 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=<svc> QOS_REQUIREMENT_GRAPH=1`（flag-ON）；对照 `PORT=4153`（**无** `QOS_REQUIREMENT_GRAPH`·flag-OFF）。
- 认证走真 Bearer JWT（datacore 签发·agentcore JWKS 验签）；entitlement 经 `PUT /a/v1/tenants/demo/features {overrides}` 真开关。

## C1 · V5 真跑闭环（问句→AST→需求图→solverCandidates→真求解器→真答案）
问句 `影响哪些订单？`（deterministic classify 命中 `affected_orders`·`model:"deterministic:example-match"`·confidence 1·无 LLM）→ task `AWAITING_CLARIFICATION`（reach 插入点·RG 已构落库）。

`GET /b/v1/queries/<task>/requirement-graph` → **HTTP 200**：
- `problemClass=affected_scope_enumeration` · `coverageScore=1` · `builderVersion=rg-builder/1.0.0`
- `nodes=47`（question 1 / **solver 15** / **data 15** / **object 16**）· `edges=79`
- **V2 真值对照**：16 个 object 节点 `ontologyType` **全 ∈** DataCore `GET /a/v1/ontology/object-types` 的 43 个已发布类型（越界 0）。
- `solverCandidates`（15 个·全 ∈ SOLVER_REGISTRY，`requirement-graph:check` 门守）：`affected_orders,audit_timeline,capacity_forecast,capacity_rollup,cert_schedule,changeover_sequence,countermeasure_combo,mitigation_select,multi_plan_compare,outsourcing_split,plan_audit,plan_generate,quote_margin,risk_timeline,what_if_displacement`。
- `dataRequirements`（15 roleType·全 ∈ DATADEP_ROLE_CANONICAL）：base/certification/changeoverMatrix/customer/dataHealth/demandSegment/equipment/line/maintPlan/model/order/process/segment/shipment/sopVersion。
- `sliceTargets={rootType:"Base",targets:["Model","Order"]}`（deriveSliceTargetCandidates 派生）。

**V5 喂真求解器**：取 `solverCandidates[0]="affected_orders"` → `POST /a/v1/solvers/affected_orders/invoke {args:{base:"changzhou"}}` → **真答案**（真求解器·非造假）：
```
affected: SO-3391 整车厂A 4680-NCM qty 320000 due 2026-06-24 revenueWan 704000;
          SO-3445 整车厂B 方形-NCM qty 440000 revenueWan 968000;
          SO-3490 海外车企E 4680-NCM qty 520000 revenueWan 1144000; …
```
证「问句 → 需求图 → solverCandidates → 真求解器 → 真答案」全链真通（R11 闭包意义·逐值真数据）。

> 诚实边界（铁律 0.4）：真跑无 LLM provider，deterministic classify 不产 `extractedSlots` → AST `entities=0`（实体 objectId 解析 `常州基地→Base(真id)` 需 LLM 抽槽或 slots，走**单测**覆盖：`requirement-graph-builder.test.ts` + parser 单测用 mock 本体逐值对照真值）。真 E2E 证的是**结构化闭环 + 三白名单真类型/真求解器/真答案**；实体级 objectId 解析深度归单测（无 LLM 的 E2E 无法填 extractedSlots·不造假补）。

## C2 · 回退演练（被证明·非声称）
- **C2a env 闸**（flag-OFF agentcore 4153·同问句 `影响哪些订单？`）：task 同样 `AWAITING_CLARIFICATION`；events **无** `requirement-graph` 步帧（flag-ON=2 帧 started+completed·flag-OFF=0）；`GET …/requirement-graph`（feature 仍开）→ **404 REQUIREMENT_GRAPH_NOT_FOUND**（旁路根本没执行·连图都不构）。证「关 env=旁路不执行·pipeline 字节一致」。
- **C2b feature 闸**：`PUT features {growth.requirement_graph:false}` + invalidate → `GET …/requirement-graph`（flag-ON 4152·RG 已存在）→ **404 FEATURE_NOT_FOUND**（不泄漏存在性）。重开 → 200。证「关 feature=端点 404·双闸独立」。

## C3 · 观察态零回归（RG 开关不改 answer·NG6 additive）
同问句在 flag-ON(4152) vs flag-OFF(4153) 各真跑一次：**决策面**（status/path/classification/clarification/matchedIntent）**逐字节一致**（normalize 掉 taskId/generatedAt/时间戳后 `na===nb` true·len 均 215）。classification 两侧同为 `{affected_orders,confidence 1,model:deterministic:example-match}`。证 RG 是纯咨询旁路·不改判决/路由/answer。

## V7 · R2 租户隔离
`x-debug-user: tenantB:userX:admin` 取 demo 的 `<task>` 的 RG → **404 REQUIREMENT_GRAPH_NOT_FOUND**·`requirementGraph` 不泄漏（`getByTaskId` tenant 谓词）。

## C4 · 门与测试
- 4 包 `pnpm -r build` EXIT=0。
- `pnpm -r test`：agentcore **670 passed**/4 skipped · datacore **1152 passed**/15 skipped · frontend/contracts（gates 内）。
- `requirement-graph:check`：**通过**（①存在性对抗性 AST 22 节点全 ∈ 三真白名单·②测谎 green→red 有牙齿·③VALID_SOLVER_KEYS 58 全 ∈ registry·④源码守卫在位）。
- 完整 `pnpm gates`：见报告（EXIT=0 记录）。
- 母体回写 + `ontology-slices:check` 绿。

## 回退杠杆（总不变式）
关 `QOS_REQUIREMENT_GRAPH` + `growth.requirement_graph` = 改造前系统 + 休眠代码 + 空表；`migration 014` DOWN 只 drop 咨询表（业务真值零动）。RG/AST 咨询性派生·可 drop 重生。
