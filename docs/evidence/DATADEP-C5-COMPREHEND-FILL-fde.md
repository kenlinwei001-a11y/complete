# DATADEP-C5-COMPREHEND-FILL · 站①填充引擎 · 真实测试证据

WO：站① 填充引擎（databuilder comprehend 倒推产 DataDependency 清单填 keystone durable 契约）。
真起 datacore（内存·SEED_DEMO=1·LLM mock 按项目铁律）·curl 逐值对照后端。

## 3 处升级（已落）

- **①输入换基底**：`comprehend` design-time system context 从"一句 story"扩到功能相关本体切片子图（已发布对象
  类型+链路）+ 入口 intent + 租户 state 快照（每类型 present 计数）。`ComprehendContext`/`renderComprehendContext`
  /`buildComprehendContext`。关键词地板不依赖此 context（R6·纯 design-time 增强）。
- **②输出扩形状**：倒推除产 BuildPlan 13-need，另**产 DataDependency 清单**填 durable 契约
  （`PlanSolverNeed.requires` + `BuildPlan.dataDependencies` + LLM 临时求解器 `SolverArtifact.requires`）。
  纯派生核 `databuilder/datadep-derive.ts`（无 service 依赖·避环）：输入字段→requires{roleType 抽象角色·
  minRows=1·props}·**只声明需求结构不产数值**·R6·floor 与 LLM 同结果。
- **③三消费同一引擎**：DATADEP（`registerProvisionalSolver` 填 `SolverArtifact.requires`）· INTENT reconcile
  （`assemblePlanBody` 同产 intent/workflow/agent/skill needs）· GROWTH（readiness gaps→worklist）。

## 护栏（钉死·均验）

- LLM 只 design-time·只产需求结构不产数值。
- DRAFT→R4 才 durable：SolverArtifact PROVISIONAL(=DRAFT) 非自动 durable；`promoteSolver`(R4)→GOVERNED。
- runtime 恒确定性·per-request 不调 LLM：`checkSolverReadiness` 纯计数（factory `SOLVER_DATADEP` → LLM 求解器
  `SolverArtifact.requires` → 无=ready）。
- 缺 LLM 关键词地板 R6 兜底（同口径清单）。

## 真实 curl 逐值（datacore :4077·内存·SEED_DEMO）

### ② `POST /a/v1/databuilder/runs`（floor·无 LLM）→ buildPlan 产 DataDependency 清单

请求：`{"script":"针对订单、产能做受影响订单风险推演分析","seed":42}`

```
has dataDependencies key= true
dataDependencies= {
  "affected_orders":  {"requires":[{"roleType":"order","minRows":1,"props":["due","qty"]}]},
  "capacity_forecast":{"requires":[{"roleType":"base","minRows":1,"props":["gwh","util"]}]}
}
solverNeeds[].requires= [
  {"k":"affected_orders","req":{"requires":[{"roleType":"order","minRows":1,"props":["due","qty"]}]}},
  {"k":"capacity_forecast","req":{"requires":[{"roleType":"base","minRows":1,"props":["gwh","util"]}]}}
]
```
逐值对照：`roleType` 折回抽象角色（order/base·R14·非 Order/Base 字面/非业务实例名）·`minRows=1`（结构性下限·
**无任何数值/真值**）·`props` 取被求解器用到的字段并集。

### ③runtime `POST /a/v1/solvers/affected_orders/readiness`（读 factory 清单·present-vs-needed·无 LLM）

demo 租户（已播种）：
```
ready= true
roles= [
  {"roleType":"base","resolvedType":"Base","present":24,"needed":1,"ok":true},
  {"roleType":"order","resolvedType":"Order","present":51,"needed":1,"ok":true},
  {"roleType":"model","resolvedType":"Model","present":6,"needed":1,"ok":true}
]
```
空租户（诚实空态·非假就绪）`POST /a/v1/solvers/capacity_rollup/readiness`：
```
ready= false  gapCodes= ["EMPTY_DATA","EMPTY_DATA","EMPTY_DATA","EMPTY_DATA","EMPTY_DATA"]
```

## 牙齿（revert→red）· `apps/datacore/test/datadep-comprehend-fill.test.ts`（全绿）

- comprehend 倒推产 DataDependency 清单（solverNeeds→requires·roleType/minRows/props·非数值）。
- DRAFT 非自动 durable：`registerProvisionalSolver`→PROVISIONAL+requires；`promoteSolver`(R4)→GOVERNED·requires 保留。
- runtime 无 LLM：`checkSolverReadiness` 读 `SolverArtifact.requires` 纯计数·R6 同输入同出。
- 缺 LLM 关键词地板兜底产同口径清单·R6 字节一致。
- 输入换基底：本体切片/入口/state 快照进 design-time system context（地板不依赖）。

## 交付状态

- 4 包全绿：contracts build · datacore 917 · agentcore 405 · frontend 403。
- `pnpm gates` exit 0（含 `datadep-manifest:check`：47 求解器全覆盖·`ontology-slices` 一致）。
- 本体回写 §2.E DataDependency + §8 G-8⑨ + `pnpm ontology:slices`（hash b2fdb75faa7f4325）。
