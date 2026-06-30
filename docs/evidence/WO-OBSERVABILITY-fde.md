# WO-OBSERVABILITY (OBS-2) · FDE 证据 — 全链 OTel span 树

> 在 WO-AUDIT-OBS 的 requestId spine 之上加 W3C `traceparent` 分布式 span 树（互补·非替换）。
> docker 在本环境**不可用**（`docker info` 失败）→ 按设计 §3 用 **in-memory / Console span exporter 真证 span 树**
> （这是设计允许的等价核心证明，非"留审核方"绕过）。下面证据均为亲手真跑录得。

## ① span 树真产出（核心证明·in-memory exporter）

用**真实的** `apps/datacore/src/tracing.ts` 的 `withSpan` / `annotateRequestId` / `injectTraceContext`
（编译产物 `dist/tracing.js`），挂 `InMemorySpanExporter` 跑一个**跨系统**请求形态，dump 真实 span 树：

```
出站双轨 headers: {"x-request-id":"req_FDE_obs2_demo","traceparent":"00-16adc1b5d9e2ad1b618df15d70f93d91-6e86feff33a1065b-01"}

isExporting (未配 OTLP): false
trace 数: 1 (应=1 → 一棵 trace)

=== SPAN 树 (parent→child) ===
- agentcore.http POST /api/v1/queries  [trace=16adc1b5d9e2.. span=8ee7011742f72572 parent=ROOT]  {http.route=/api/v1/queries app.request_id=req_FDE_obs2_demo}
  - obo.datacore POST /a/v1/solvers/capacity_forecast/invoke  [trace=16adc1b5d9e2.. span=6e86feff33a1065b parent=8ee7011742f72572]  {http.method=POST peer.service=datacore app.tenant_id=demo app.request_id=req_FDE_obs2_demo}
    - solver.invoke  [trace=16adc1b5d9e2.. span=0c7708a2583060cf parent=6e86feff33a1065b]  {solver.key=capacity_forecast app.tenant_id=demo solver.data_mode=LIVE}
      - outbox.emit  [trace=16adc1b5d9e2.. span=cf49b7365ed93393 parent=0c7708a2583060cf]  {messaging.destination=materialize.completed app.tenant_id=demo}
```

判读：
- **一棵 trace**（traceId `16adc1b5d9e2..` 全程一致）；
- **parent 链正确**：`root(agentcore.http) → obo.datacore → solver.invoke → outbox.emit`（每个 child 的 parent = 上一节点 spanId）；
- 与设计 §0.1 期望树 `root→child(datacore)→child(solver invoke)→child(outbox emit)` 对齐。

> 同一棵树由两服务的单测以断言形式真跑守（见⑤），此 dump 给人读直观录证。

## ② traceId ↔ requestId 关联

- root span 带 attr `app.request_id=req_FDE_obs2_demo`（= 日志/错误信封里的 `requestId`，WO-AUDIT-OBS spine）；
- 出站双轨 headers 同时含 `x-request-id`（人读关联键·不破 AUDIT-OBS）+ `traceparent`（机器读 W3C trace context）；
- 故拿日志里的 requestId 可在 trace 后端（span attr `app.request_id`）定位到该 trace。

## ③ 未配 OTLP → no-op 不导出（诚实降级·真验）

`isExporting()=false`（上面 dump 已印）——未配 `OTEL_EXPORTER_OTLP_ENDPOINT` 时 `tracing.ts` 不接 exporter、不导出，不假装。

真起服务 curl 正常（**未配 OTLP**）：
```
=== healthz (no OTLP configured) ===
{"status":"ok"}
=== server startup log ===
{"level":30,...,"msg":"datacore listening","port":4071}
```

配了 OTLP endpoint 但 collector 不在时，服务**仍正常**（exporter 后台批量、非阻塞）：
```
=== healthz (OTLP configured, collector absent) ===
{"status":"ok"}
```

## ④ span attr 无凭据明文（no-secrets-echo R5·抽查）

- 上面所有 span 的 attr 只含 `http.route` / `peer.service` / `app.tenant_id`（R2）/ `app.request_id` / `solver.key` / `solver.data_mode` / `messaging.destination`——**均为业务标量，无 token/apiKey/password/credential 明文**。
- 两服务单测各含一条断言：构造闭包内放 JWT/credential 明文，遍历**所有** span 的**所有** attr 值，断言不含该明文（`apps/datacore/test/tracing.test.ts` / `apps/agentcore/test/tracing.test.ts`）。
- `tracing.ts withSpan` 文档注释钉牢"禁带凭据明文"；`tools/datacore-http.ts` 的 OBO span attr **不带** `ctx.token`/`ctx.debugUser`（凭据只进 HTTP header，不进 span）。
- 门 `tracing:check` 静态抽查 OBO/solver/outbox span attr 不出现凭据键。

## ⑤ 四包 build & test 绿 + tracing.ts 测

- `apps/datacore/test/tracing.test.ts`：4 tests 绿——no-op 分支（exporting=false）+ in-memory span 树真证 root→solver.invoke→outbox.emit parent 链 + attr 关联 + 无凭据 + span 异常记录 ERROR + 出站 traceparent 双轨。
- `apps/agentcore/test/tracing.test.ts`：2 tests 绿——no-op（service.name=agentcore）+ root→obo.datacore parent 链 + traceparent 双轨 + 无凭据。
- `pnpm tracing:check`：18 项通过（两服务 tracing.ts no-op 分支 / bootstrap 第一个 import / OBO 双轨 / solver.invoke+outbox.emit span / 无凭据 / 本体 §7+G-15 登记）。
- 四包 `pnpm -r build` 绿；`pnpm --filter datacore test` / `pnpm --filter agentcore test` 绿（含既有 solvers / xservice-smoke 回归——OBO span 包裹 + traceparent 注入不破跨服务联调）。
- `pnpm gates` 全绿（含 ontology / ontology-writeback / audit-actor 不回潮）。

## 边界（诚实·距北极星还差什么）

- 本单只 **traces** 信号；OTel **metrics / logs** 不做（现 `Metrics` 类够用·留后续）。
- docker-compose `otel-collector`+`jaeger` 已加但 **profile-gated**（`--profile observability`）；本环境 docker 不可用，故 Jaeger 截图以 in-memory span dump 等价替代（设计 §3 允许）。生产 collector 部署拓扑留运维。
