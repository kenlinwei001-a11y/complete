#!/usr/bin/env node
/**
 * 门 `audit-actor:check`（WO-AUDIT-OBS · 守不变量 R-AUDIT + append-only + 跨服务 requestId 透传）。
 *
 * 保守静态哨兵——把"统一审计 + 跨服务追踪"的结构性约束钉牢，防回潮：
 *  ①【R-AUDIT·actor】adminplatform.ts 的每条 admin 变更（写仓储后）都经统一 `audit(c, ...)` 写入器，
 *     且写入器经 AuditService.record（带 actor=ctx.userId）；features.ts saveConfig 经 auditSvc.record。
 *  ②【append-only】审计日志只读：路由层仅 `GET /a/v1/audit-log`，无 PUT/DELETE/PATCH 该路径（结构性 R13）。
 *  ③【R9 双仓储四处】audit_log 表四处同改：migration + repo.ts 接口 + memory.ts + pg.ts。
 *  ④【跨服务追踪】agentcore 出站 call() 透传 `x-request-id`；DataCore genReqId 优先取入站 `x-request-id`。
 *
 * 不重算业务逻辑（运行期由 datacore/agentcore 测试守）；只机械守上述接线不被悄悄拆掉。
 */
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const fails = [];
const ok = [];

// ---- ① R-AUDIT：adminplatform.ts admin 变更经统一 audit(c,...) + AuditService.record ---------
const admin = read("apps/datacore/src/adminplatform.ts");
// 写入器定义：audit(c, action, target, tenantOverride?) → auditSvc.record(c, { action, ...target })
if (!/const audit\s*=\s*\(\s*c\s*:\s*AuthCtx/.test(admin) || !/auditSvc\.record\(\s*c\s*,/.test(admin)) {
  fails.push("adminplatform.ts 的统一 audit 写入器须为 audit(c: AuthCtx, ...) 且经 auditSvc.record(c, …)（actor=c.userId·R-AUDIT）");
} else ok.push("adminplatform.ts audit 写入器经 AuditService.record（带 actor）");
// 每个变更动作都带 actor：审计调用须以 ctx `c` 为首参（杜绝退回旧 audit(tenantId,event,payload) 无 actor 形态）。
const auditCalls = [...admin.matchAll(/await audit\(([^,]+),/g)].map((m) => m[1].trim());
const badActor = auditCalls.filter((first) => first !== "c");
if (badActor.length > 0) {
  fails.push(`adminplatform.ts 有 ${badActor.length} 处 audit() 调用首参非 ctx（无 actor）：${badActor.join(", ")}`);
} else ok.push(`adminplatform.ts ${auditCalls.length} 处 audit() 调用均带 actor(ctx)`);
// 旧"裸 outbox.emit"审计形态不得复活（审计须经统一写入器）。
if (/outbox\.emit\(\s*tenantId\s*,\s*event\s*,/.test(admin)) {
  fails.push("adminplatform.ts 残留旧 outbox.emit(tenantId,event,payload) 审计形态——须改经统一 audit()（落 audit_log + actor）");
} else ok.push("adminplatform.ts 无旧裸 outbox.emit 审计形态");

// features.ts feature 变更经审计
const feats = read("apps/datacore/src/features.ts");
if (!/this\.auditSvc\.record\(\s*ctx\s*,/.test(feats)) {
  fails.push("features.ts saveConfig 须经 this.auditSvc.record(ctx, …)（feature 变更带 actor·R-AUDIT）");
} else ok.push("features.ts feature 变更经 auditSvc.record（带 actor）");

// AuditService 落 append-only audit_log + 仍发 outbox（向后兼容）
const auditSvc = read("apps/datacore/src/audit.ts");
if (!/this\.repos\.auditLog\.put\(/.test(auditSvc) || !/this\.outbox\.emit\(/.test(auditSvc)) {
  fails.push("audit.ts AuditService.record 须既 auditLog.put（append-only）又 outbox.emit（向后兼容）");
} else ok.push("audit.ts 同时写 audit_log + 发 outbox");

// ---- ② append-only：仅 GET /a/v1/audit-log，无写路由 -----------------------------------------
if (!/app\.get\(\s*["'`]\/a\/v1\/audit-log/.test(admin)) {
  fails.push("缺只读路由 GET /a/v1/audit-log");
} else ok.push("GET /a/v1/audit-log 只读路由在位");
for (const verb of ["put", "delete", "patch", "post"]) {
  const re = new RegExp(`app\\.${verb}\\(\\s*["'\`]/a/v1/audit-log`);
  if (re.test(admin)) fails.push(`审计日志须 append-only：发现写路由 app.${verb}(/a/v1/audit-log …)`);
}
if (!fails.some((f) => f.includes("append-only：发现写路由"))) ok.push("审计日志无 PUT/DELETE/PATCH/POST 写路由（append-only）");

// ---- ③ R9 双仓储四处：audit_log -----------------------------------------------------------
const r9 = [
  ["migration", "apps/datacore/migrations/032_audit_log.sql", /CREATE TABLE IF NOT EXISTS audit_log/],
  ["repo.ts 接口", "apps/datacore/src/repo/repo.ts", /auditLog:\s*Store<AuditLogRecord>/],
  ["memory.ts", "apps/datacore/src/repo/memory.ts", /auditLog:\s*new MemStore\(\)/],
  ["pg.ts", "apps/datacore/src/repo/pg.ts", /auditLog:\s*new PgStore\(pool,\s*["']audit_log["']\)/],
];
for (const [label, file, re] of r9) {
  let body = "";
  try { body = read(file); } catch { fails.push(`R9 ${label} 文件缺失：${file}`); continue; }
  if (!re.test(body)) fails.push(`R9 audit_log 四处之一缺失：${label}（${file}）`);
  else ok.push(`R9 audit_log ${label} 在位`);
}

// ---- ④ 跨服务 requestId 透传 ---------------------------------------------------------------
const dchttp = read("apps/agentcore/src/tools/datacore-http.ts");
if (!/"x-request-id":\s*ctx\.requestId/.test(dchttp)) {
  fails.push("agentcore tools/datacore-http.ts call() 须透传 x-request-id: ctx.requestId（跨服务追踪）");
} else ok.push("agentcore 出站透传 x-request-id");
const dcapp = read("apps/datacore/src/app.ts");
if (!/genReqId:\s*\(req\)\s*=>/.test(dcapp) || !/req\.headers\["x-request-id"\]/.test(dcapp)) {
  fails.push("datacore app.ts genReqId 须优先取入站 x-request-id 再回退 newId");
} else ok.push("datacore genReqId 优先取入站 x-request-id");

// ---- 报告 ---------------------------------------------------------------------------------
console.log(`· audit-actor:check · 通过 ${ok.length} 项 · 失败 ${fails.length} 项`);
if (fails.length > 0) {
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("✓ audit-actor:check：统一审计(R-AUDIT/append-only/R9) + 跨服务 requestId 透传 接线完整。");
