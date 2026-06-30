# WO-AUDIT-OBS · FDE 真跑证据（统一 append-only 审计 + requestId 跨两系统透传）

> 真跑环境：内存模式双服务（无数据库）。
> `PORT=4001 SEED_DEMO=1 ... node apps/datacore/dist/server.js`（LOG_LEVEL=info）
> `PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 ... node apps/agentcore/dist/main.js`（LOG_LEVEL=info）
> 演示账号 demo/admin/demo1234。

## 落点

- **审计写入器单一来源** `apps/datacore/src/audit.ts` `AuditService.record(ctx, input, tenantOverride?)`：每条 admin/写路径变更
  **既**写专用 append-only `audit_log`（`{id,tenantId,actorId,action,targetKind,targetId,before?,after?,at,requestId}`·只插不改不删·R13），
  **又**仍发同名 outbox 领域事件（向后兼容 F1 全局通道/管理台缓存失效）。
- **adminplatform.ts** 统一 `audit(c, action, target, tenantOverride?)` → `auditSvc.record`；全 10 处变更（租户/用户/视图配置/场景包）首参均为 ctx（actor=c.userId）。
- **features.ts** `saveConfig` 经 `this.auditSvc.record(ctx, …)`（feature 变更带 actor + before/after diff）。
- **只读端点** `GET /a/v1/audit-log?since=&actor=&target=`（platform_admin / 新增 `auditor` 只读角色·无 PUT/DELETE/PATCH/POST 写路由 → append-only 结构性成立·R2 租户隔离·不破 A6 行级）。
- **跨服务追踪**：agentcore 出站 `tools/datacore-http.ts call()` 透传 `x-request-id: ctx.requestId`（无则生成）；
  agentcore `server.ts` `auth()` 把 `req.id` 挂上 ctx；
  datacore `app.ts` `genReqId` 优先取入站 `x-request-id` 再回退 `newId("req")`；两系统日志 + 错误信封（R7）同源。
- **R9 双仓储四处**：migration `029_audit_log.sql` + `repo.ts auditLog: Store<AuditLogRecord>` + `memory.ts` + `pg.ts (PgStore audit_log)`。

## FDE 判据 ① 真改一项配置 → 审计现该条带 actor + before/after + requestId

真改：`PUT /a/v1/tenants/demo/features {"overrides":{"view.plan-audit":false}}`（带 `x-request-id: req-fde-feat-1782826589`）。
`GET /a/v1/audit-log?actor=admin&target=feature_config` 返回该条：

```json
{
  "id": "aud_6ah9g0kchq6asw80",
  "tenantId": "demo",
  "actorId": "admin",
  "action": "features.updated",
  "targetKind": "feature_config",
  "targetId": "fcfg_demo",
  "before": { "overrides": { "opt.solver-pool": true, "opt.whatif": true } },
  "after": { "overrides": { "view.plan-audit": false }, "configVersion": 2, "role": null },
  "at": "2026-06-30T13:36:29.145Z",
  "requestId": "req-fde-feat-1782826589"
}
```

→ actor=admin ✅ · before/after ✅ · requestId == 入站 x-request-id ✅。

## FDE 判据 ② 审计日志只增不可改（无写路由）+ 角色

```
PUT    /a/v1/audit-log -> 404 {"error":{"code":"NOT_FOUND","message":"route not found","requestId":"req_cthqx9px7nbcsb63"}}
DELETE /a/v1/audit-log -> 404 {"error":{"code":"NOT_FOUND",...}}
PATCH  /a/v1/audit-log -> 404 {"error":{"code":"NOT_FOUND",...}}
POST   /a/v1/audit-log -> 404 {"error":{"code":"NOT_FOUND",...}}

auditor GET /a/v1/audit-log -> 200   （新增审计员只读角色可读）
planner GET /a/v1/audit-log -> 403   （非审计/非 admin 被拒）
```

→ append-only：无任何写路由（尝试改报 404）✅ · auditor 只读 200 ✅ · planner 403 ✅。

## FDE 判据 ③ 同一 requestId 贯穿 agentcore → DataCore → 错误信封

真跑：经 agentcore `GET /b/v1/solvers`（QOS 管理面·确定性 OBO 调 DataCore catalog，无需 LLM），
带入站 `x-request-id: req-xsvc-qos-1782826966`。**同一 requestId 两跳实拍**：

```
######## AgentCore 日志（入站）########
{"reqId":"req-xsvc-qos-1782826966","req":{"method":"GET","url":"/b/v1/solvers",...},"msg":"incoming request"}
{"reqId":"req-xsvc-qos-1782826966","requestId":"req-xsvc-qos-1782826966","method":"GET","url":"/b/v1/solvers","msg":"request completed"}

######## DataCore 日志（同一 requestId · OBO 透传 x-request-id）########
{"component":"http","reqId":"req-xsvc-qos-1782826966","req":{"method":"GET","url":"/a/v1/catalog?kind=solvers",...},"msg":"incoming request"}
{"component":"http","reqId":"req-xsvc-qos-1782826966","requestId":"req-xsvc-qos-1782826966","tenantId":"demo","method":"GET","url":"/a/v1/catalog?kind=solvers","msg":"request completed"}
```

错误信封同源（DataCore 对 `x-request-id: req-xsvc-trace-12345` 的 404）：

```
GET /a/v1/objects/NoSuchType/nope (x-request-id: req-xsvc-trace-12345)
-> {"error":{"code":"NOT_FOUND","message":"object not found","requestId":"req-xsvc-trace-12345"}}
```

→ 同一 requestId 在 AgentCore 日志 → DataCore 日志 → 错误信封一线可追 ✅。

> 说明：`POST /api/v1/queries` 的 path-B Agent 推演需配置 LLM provider，本地无 LLM 的内存 dev 环境下该任务在 OBO 求解器调用前即 FAILED（环境限制，非代码缺口）。
> 故以 QOS 同族、确定性 OBO 的 `GET /b/v1/solvers` 取得真实两跳 requestId 贯穿日志（机制完全一致：agentcore `call()` 透传 → datacore `genReqId` 采纳）。

## 门 / 测试

- 新门 `audit-actor:check`（`scripts/check-audit-actor.mjs`·已并入 `pnpm gates`）：静态守 R-AUDIT(每写路径带 actor) + append-only(无写路由) + R9 audit_log 四处 + 跨服务 x-request-id 透传。
- 运行期 `apps/datacore/test/audit-log.test.ts`（6 测全绿）：改 feature→审计现该条带 actor+before/after+requestId · append-only(404/405) · auditor 只读/planner 403 · 过滤 since/actor/target · 仍发 outbox 向后兼容 · R2 租户隔离。
- `ontology:check` / `ontology-writeback:check` 绿（§4 审计事件 + §5 R-AUDIT + §7 audit-actor:check 已回写本体）。
