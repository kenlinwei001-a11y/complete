# WO-A · PLATFORM-AGENT-SURFACE — 真起真跑证据（不作假）

平台自身作为对外 **MCP/A2A 服务端**（投影层·零新执行逻辑）。真起 datacore(4001)+agentcore(4002) 内存模式，
外部调用方经 `X-Debug-User: demo:user-admin:admin|planner|catalog_admin`（OBO）打对外表面，逐值对照 DataCore 既有 REST。

## C2 · 工具集从 SOLVER_REGISTRY descriptor 自动派生（R14·计数随注册表同步）

```
DataCore /a/v1/solvers/registry 求解器数（entitlement 过滤后） = 47
GET /b/v1/mcp-server → solverToolCount = 47   ← 逐个 platform__solver__{key}，与注册表 1:1
                       operationToolCount = 13 ← OPERATION_CATALOG 只读项（r4=false）
                       toolCount = 60
```
样本工具（descriptor 派生·执行路径=既有 invoke·outputShape 投影自 SOLVER_OUTPUT_SHAPES）：
```json
{ "name": "platform__solver__affected_orders",
  "restPath": "/a/v1/solvers/affected_orders/invoke", "executable": true,
  "outputShape": ["baseId","affected","total","count","columns","rows","fallback","problems","summary","dataMode","confidence"] }
```
新增/晋升求解器进注册表即自动多一个工具，无逐工具代码（R14）。

## C1 · tools/call 求解器 → 归一到既有 REST invoke 路径·逐值==真求解器输出（非新路径·非合成值）

对外 MCP `tools/call platform__solver__cockpit_kpi`：
```json
{ "result": { "isError": false,
  "structuredContent": { "data": { "supplyV7":130,"revAttainPct":102,"utilPeak":90,"aopBaseRev":13.9,"cashCushion":58,
                                    "dataMode":"SYNTHETIC","confidence":{...} }, "snapshotVersion":"1.2" },
  "_platform": { "routedTo": "/a/v1/solvers/cockpit_kpi/invoke", "projection": true } } }
```
直接调 DataCore 既有 REST `POST /a/v1/solvers/cockpit_kpi/invoke` 得**字节相同** payload：
```
MCP tools/call structuredContent === DataCore REST invoke payload : true
routedTo = /a/v1/solvers/cockpit_kpi/invoke
```
错误也逐字透传既有 REST 信封（capacity_forecast 缺认证线 → 两侧同为
`{"error":{"code":"VALIDATION_ERROR","message":"model 麒麟 has no certified lines"}}`），证明执行确实落在既有求解器路径、非投影层自造逻辑。

## C3 · A2A task ≈ QueryTask，提交映射既有 POST /api/v1/queries

```
POST /b/v1/a2a/tasks {packageId:pkg_battery_manufacturing, query:"4680-NCM 加 20% 六周能不能接？"}
→ 202 { taskId:"task_01KWPY3K…", state:"ROUTING", _platform:{ routedTo:"/api/v1/queries", projection:true } }
GET  /b/v1/a2a/tasks/{id} (本租户) → 200 { id, state:"AWAITING_CLARIFICATION", task:{…QueryTask} }
```
agent-card 技能从注册表派生：`skillCount = 47`，`capabilities.mcp.toolCount = 60`，`authentication.schemes=[bearer,x-debug-user]`。

## 鉴权/租户/OBO 门（无匿名面·R2/R3）

```
GET  /b/v1/mcp-server        无凭据 → 401 UNAUTHENTICATED
POST /b/v1/mcp-server        无凭据 → 401 UNAUTHENTICATED
GET  /b/v1/a2a/agent-card    无凭据 → 401 UNAUTHENTICATED
GET  /b/v1/a2a/tasks/{id}    跨租户(othertenant) → 404（tenant 隔离）
GET  /b/v1/a2a/tasks/{id}    本租户 → 200
```
求解器 invoke 的行级过滤/entitlement 由 DataCore 单一执行点权威裁决（OBO 透传用户身份），
对外表面不新增第二套 authz——与内部 agent 走 `/a/v1/solvers/*/invoke` 同源。

## 齿检（apps/agentcore/test/platform-agent-surface.test.ts · 12 tests 全绿）

- 工具名集合 === registry key 集合投影（硬编码/漏派生即红）；R14 加一求解器 → 工具+1。
- inputSchema 从 argHints 派生；`_platform.restPath === /a/v1/solvers/{key}/invoke`（执行=既有路径·非新路径）。
- 运维工具只投影 r4=false 只读项·executable=false（零新执行逻辑）；写真值 op（approve/rule）不出现。
- 真端点：GET mcp-server solverToolCount==真 registry；tools/call 逐值==`dataCore.solver.invoke`；A2A routedTo=/api/v1/queries。
- unauth→401×4；跨租户 a2a/tasks→404；unknown tool→-32601。

`pnpm --filter agentcore test` → 84 files / 423 passed | 1 skipped。四包 build 通过。
