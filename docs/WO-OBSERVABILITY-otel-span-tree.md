# WO-OBSERVABILITY (OBS-2) · 全链 OTel span 树（在 requestId spine 上加分布式追踪）

> 审核方自包含设计（铁律0.5·先设计再派 dev）。**诚实定性**：现状**零 OTel（无依赖、无 span）**，但 **requestId 跨系统 spine 刚落**（WO-AUDIT-OBS）+ **metrics histogram 层在**。OBS-2 = **在这条已有 spine 上加分布式 span 树**，不重造关联层。

## §0 目标 + DoD-as-experience
**目标**：一个请求（前端→AgentCore→DataCore→求解器/repo/outbox）产出一棵**分布式 span 树**，可在 OTLP collector（Jaeger/Tempo）里看到完整调用链 + 逐段时延 + 错误定位，**与现有 requestId / Metrics 共存、不替换**。

**完成定义（亲手走一遍·= 用户动作证据，非测试绿）**：
1. 起两服务 + 一个 OTLP collector（docker）→ 发一个**跨系统**查询（QOS path 经 OBO 调 DataCore）→ Jaeger 里看到**一棵 trace**：`root(agentcore HTTP) → child(datacore HTTP·经传播) → child(solver invoke) → child(repo pg) → child(outbox emit)`，每段时延/错误可见。**截图录证**。
2. trace 能与既有 `requestId` 关联（日志里的 requestId 可定位到 trace）。
3. **没配 OTLP endpoint → spans no-op**（不假装导出·诚实降级），服务照常。
4. 抽查 span attributes **无凭据明文泄露**。

## §1 现状盘点（钉 file:line·✅已在/🔴缺）
| 维度 | 现状 | 证据 | 判定 |
|---|---|---|---|
| requestId 跨系统 spine | `genReqId` 复用入站 `x-request-id`，无则生成；AgentCore 出站透传 | datacore `app.ts:677-684` · agentcore `server.ts:101,147,153` · `tools/datacore-http.ts` | ✅ 关联层在 |
| 错误信封带 requestId | `{error:{code,message,requestId}}` | `app.ts:696-700` | ✅ |
| 逐请求日志 | `req.log.info({requestId,method,url,statusCode})` | agentcore `server.ts:153` · datacore `app.ts:756` | ✅ |
| metrics 层 | `Metrics` 类 + `dc_*_duration_ms` histogram | `metrics.ts:11` | ✅ 指标在·**非 trace** |
| **OTel 分布式 span** | 无依赖、无 instrument | grep `@opentelemetry` = 0 | 🔴 **缺（本单）** |
| **W3C traceparent 传播** | 仅 `x-request-id`（非标准 trace context） | — | 🔴 **缺（本单桥接）** |

## §2 施工范围（dev 可直接照做）
- **A. 依赖**（两服务各装）：`@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`（自动 instrument http/fastify/pg）+ `@opentelemetry/exporter-trace-otlp-http`。
- **B. 初始化 `tracing.ts`（app 构建前 require）**：`NodeSDK` + `OTLPTraceExporter`，endpoint 取 `OTEL_EXPORTER_OTLP_ENDPOINT`——**未配 → NoopSpanProcessor 不导出（诚实，不假装）**。`service.name` = `datacore`/`agentcore`。
- **C. 传播桥接（x-request-id ↔ W3C traceparent）**：
  - 入站：有 `traceparent` → OTel 自动续 trace；只有 `x-request-id` → span 加 attribute `app.request_id=reqId`（使既有日志 requestId 与 trace 关联）。
  - 出站（AgentCore→DataCore OBO·`tools/datacore-http.ts`）：注入 `traceparent`（OTel propagator）**+ 保留 `x-request-id` 透传**（双轨不破既有 AUDIT-OBS）。
- **D. 自定义 span（auto-instrument 之外的业务节点）**：求解器 `invoke`（`solvers/service.ts`·attr `solverKey`/`dataMode`）、`outbox.emit`、跨服务 OBO 调用、optimizer-client sidecar 调用。**span attr 带 `tenantId`（R2 隔离）；禁带凭据/明文（no-secrets-echo）**。
- **E. 与 Metrics 共存**：现 `Metrics` 类**不动**；OTel metrics 信号本单不做（留后续）。
- **F. 采样**：dev `ParentBased(AlwaysOn)`；生产可配 ratio（env）。
- **G. docker-compose 可选 collector**：加 `otel-collector` + `jaeger`（**profile-gated**·不影响默认 `up`），给本地看 trace 用。

## §3 验收（FDE 亲手·用户动作证据）
1. 起两服务 + collector → 跨系统查询 → **Jaeger 见一棵 trace**（root→datacore→solver→pg→outbox），逐段时延/错误可见（截图）。
2. **traceId ↔ requestId 关联**：拿日志里的 requestId 能在 Jaeger 定位到 trace。
3. **未配 OTLP → no-op 不导出、服务正常**（诚实降级·curl 正常）。
4. **span 无凭据泄露**（抽查 attr·no-secrets-echo）。
5. **回归**：四包 `build && test` 绿 + `tracing.ts` 测（no-op 分支 + span 产出 smoke）。

## §4 不在本次范围（诚实边界）
- OTel **metrics / logs** 信号（本单只 **traces**；指标现 `Metrics` 类够用）。
- APM 告警 / dashboard（collector 侧·非本单）。
- 生产 collector 部署拓扑（给 compose 样例·生产留运维）。

## 本体引用与影响
- **链路**：横切——`HTTP(root span)→OBO 跨服务(传播 traceparent)→solver invoke(span)→repo pg(span)→outbox emit(span)`，沿既有 requestId spine（本体§4 requestId 透传·WO-AUDIT-OBS）。
- **不变量**：R2（span attr 带 `tenantId` 隔离）· no-secrets-echo（span 禁明文凭据）· 诚实（未配 OTLP → no-op 不假装导出）。
- **断点**：补"分布式 trace"·与 AUDIT-OBS 的 requestId spine **互补**（关联 → 全链可视化）·建议登记 **G-15「可观测性 span 树」**。
- **回写**：dev 落地后回写 §3（横切 trace 边）+ §7（`tracing.ts` 初始化 / no-op 门）+ §8（G-15）。

---
*审核方自包含施工单（design+review·铁律0.5·钉真实 file:line·非真起 collector 实拍——验收 §3 由 dev 亲手 FDE）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
