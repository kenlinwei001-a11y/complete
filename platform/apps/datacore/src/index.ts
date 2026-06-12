/** DataCore（System A 骨架）：IAM / Workspace / 本体对象 / 规则引擎 / Action 草稿
 *  存储=内存仓库（团队任务：替换为 PostgreSQL 适配器，接口已隔离在本文件 Store 区）*/
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BASES, MODELS, ORDERS, RULES, USERS, TENANT } from "./seed.js";
import type { AuthCtx, RuleVerdict } from "@platform/contracts";

const PORT = Number(process.env.DATACORE_PORT || 8081);
const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";
const SNAP = "snap-seed-v1";

/* ---------------- JWT（HMAC-SHA256，骨架版；生产换 JWKS） ---------------- */
const b64u = (s: Buffer | string) => Buffer.from(s).toString("base64url");
function signJwt(payload: object, ttlSec = 8 * 3600): string {
  const body = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." +
    b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return body + "." + createHmac("sha256", SECRET).update(body).digest("base64url");
}
export function verifyJwt(token: string): any | null {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  const expect = createHmac("sha256", SECRET).update(h + "." + p).digest();
  const got = Buffer.from(sig, "base64url");
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp < Date.now() / 1000) return null;
  return payload;
}

/* ---------------- Store（内存仓库；行级权限在此层强制） ---------------- */
const actionDrafts: any[] = [];
function visibleBases(ctx: AuthCtx) {
  const scope = ctx.attributes?.baseScope as string[] | undefined;
  return scope?.length ? BASES.filter(b => scope.includes(b.name)) : BASES;
}
function queryObjects(ctx: AuthCtx, objectType: string, filter: Record<string, any>, limit = 200) {
  let rows: any[];
  if (objectType === "Base") rows = visibleBases(ctx);
  else if (objectType === "Model") rows = MODELS;
  else if (objectType === "Order") {
    const vb = new Set(visibleBases(ctx).map(b => b.name));
    rows = ORDERS.filter(o => MODELS.find(m => m.id === o.model)!.bases.some(b => vb.has(b)));
  } else rows = [];
  for (const [k, v] of Object.entries(filter || {})) rows = rows.filter((r: any) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v);
  return rows.slice(0, Math.min(limit, 200));
}

/* ---------------- 规则引擎（骨架：注册表 + 显式判定函数） ---------------- */
function evaluateRules(ruleIds: string[], payload: any): RuleVerdict[] {
  const out: RuleVerdict[] = [];
  for (const r of RULES) {
    if (ruleIds.length && !ruleIds.includes(r.id)) continue;
    let passed = true;
    if (r.id === "C03") passed = (payload.demandDelta ?? 0) <= 0.5;
    if (r.id === "C08") passed = (payload.outsourceRatio ?? 0) <= 0.2;
    if (r.id === "C15") passed = (payload.gmTarget ?? 0) <= (payload.gmStruct ?? 99) + 0.3;
    if (r.id === "C18") passed = (payload.cashCushion ?? 99) >= 50;
    out.push({ ruleId: r.id, passed, severity: r.severity, explanation: passed ? `${r.name}：通过` : r.explain(payload) });
  }
  return out;
}

/* ---------------- 场景入口 / Workspace 配置（按角色解析） ---------------- */
const SCENES = [
  { viewKey: "dash", name: "经营驾驶舱", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问问经营数据，如：影响哪些订单？", suggestedQuestions: ["4680-NCM 加 20% 六周能不能接？", "常州基地影响哪些订单？"] } },
  { viewKey: "risk", name: "产能推演", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "针对风险点提问", suggestedQuestions: ["影响哪些订单？", "为什么这天越线？"] } },
  { viewKey: "project", name: "项目推演", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "型号产能可承接性", suggestedQuestions: ["4680-NCM 加 20% 六周能不能接？"] } },
  { viewKey: "audit", name: "规划体检", mode: "WORKFLOW_ONLY", uiHints: { placeholder: "仅支持预设体检问答", suggestedQuestions: ["现金垫 45 亿过得了体检吗？"] } },
  { viewKey: "generate", name: "规划建议", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "目标与方案", suggestedQuestions: ["推荐哪个经营方案？"] } },
  { viewKey: "explore", name: "自由探索 · AI", mode: "AGENT_FIRST", defaultAgentKey: "analyst", uiHints: { placeholder: "任意业务问题，AI 自由编排工具回答", suggestedQuestions: ["对比储能基地和动力基地的平均利用率", "哪个基地利用率最高？瓶颈是什么？"] } },
] as const;

function workspaceFor(ctx: AuthCtx) {
  const isAdmin = ctx.roles.includes("tenant_admin");
  return {
    tenant: TENANT,
    user: { id: ctx.userId, roles: ctx.roles, attributes: ctx.attributes },
    features: ["view.dash", "view.risk", "view.project", "view.audit", "view.generate", "view.explore", "shell.query-dock", "qos.agent-fallback"],
    navigation: SCENES.map(s => ({ viewKey: s.viewKey, name: s.name })),
    scenes: SCENES,
    admin: isAdmin ? ["users", "scenes", "rules", "actions"] : [],
    configVersion: 1,
  };
}

/* ---------------- HTTP ---------------- */
const app = Fastify();
await app.register(cors, { origin: true });

app.get("/healthz", async () => ({ ok: true, service: "datacore" }));

app.post("/a/v1/auth/login", async (req, reply) => {
  const { username, password } = (req.body as any) || {};
  const u = USERS.find(x => x.username === username && x.password === password);
  if (!u) return reply.code(401).send({ error: { code: "BAD_CREDENTIALS", message: "用户名或密码错误" } });
  const ctx: AuthCtx = { tenantId: TENANT.id, userId: u.id, roles: u.roles, attributes: u.attributes };
  return { token: signJwt(ctx), user: { id: u.id, username: u.username, roles: u.roles } };
});

function auth(req: any, reply: any): AuthCtx | null {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  const p = verifyJwt(t);
  if (!p) { reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "无效或过期的令牌" } }); return null; }
  return p as AuthCtx;
}

app.get("/a/v1/me/workspace", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  return workspaceFor(ctx);
});

app.post("/a/v1/objects/query", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  const { objectType, filter, limit } = (req.body as any) || {};
  return { data: queryObjects(ctx, objectType, filter || {}, limit), snapshotVersion: SNAP };
});

app.post("/a/v1/rules/evaluate", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  const { ruleIds, payload } = (req.body as any) || {};
  return { verdicts: evaluateRules(ruleIds || [], payload || {}), snapshotVersion: SNAP };
});

app.post("/a/v1/action-drafts", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  const { actionType, payload, origin } = (req.body as any) || {};
  const d = { id: "act_" + randomUUID().slice(0, 8), tenantId: ctx.tenantId, actionType, payload, origin: { ...origin, userId: ctx.userId }, status: "PENDING_APPROVAL", createdAt: new Date().toISOString() };
  actionDrafts.push(d);
  return d;
});
app.get("/a/v1/action-drafts", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  return { items: actionDrafts };
});
app.post("/a/v1/action-drafts/:id/approve", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  if (!ctx.roles.includes("tenant_admin")) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "需要审批角色" } });
  const d = actionDrafts.find(x => x.id === (req.params as any).id);
  if (!d) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "草稿不存在" } });
  d.status = "EXECUTED"; d.executionResult = { ok: true, targetRef: "MO-2026-" + Math.floor(Math.random() * 9000 + 1000) };
  return d;
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => console.log(`[datacore] :${PORT}`));
