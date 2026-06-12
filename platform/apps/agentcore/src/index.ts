/** AgentCore（System B 骨架）：QOS 路由 / 求解端点 / SSE / 静态前端 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthCtx } from "@platform/contracts";
import { submitQuery, hub, qosInfo, SOLVERS_PROXY } from "./routes-helper.js";

const PORT = Number(process.env.AGENTCORE_PORT || 8082);
const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";
const __dir = dirname(fileURLToPath(import.meta.url));

function verifyJwt(token: string): any | null {
  const [h, p, sig] = (token || "").split(".");
  if (!h || !p || !sig) return null;
  const expect = createHmac("sha256", SECRET).update(h + "." + p).digest();
  const got = Buffer.from(sig, "base64url");
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  return payload.exp < Date.now() / 1000 ? null : payload;
}

const app = Fastify();
await app.register(cors, { origin: true });
await app.register(fastifyStatic, { root: join(__dir, "../../frontend/public"), prefix: "/" });

app.get("/healthz", async () => ({ ok: true, service: "agentcore", ...qosInfo() }));

function auth(req: any, reply: any): { ctx: AuthCtx; token: string } | null {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "") || (req.query as any)?.access_token || "";
  const p = verifyJwt(token);
  if (!p) { reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "无效令牌" } }); return null; }
  return { ctx: p as AuthCtx, token };
}

app.post("/b/v1/queries", async (req, reply) => {
  const a = auth(req, reply); if (!a) return;
  const { query, context } = (req.body as any) || {};
  if (!query || !context?.view) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "query 与 context.view 必填" } });
  const taskId = await submitQuery(a.ctx, a.token, { query, context: { selectedObjects: [], filters: {}, ...context } });
  return reply.code(202).send({ taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events` });
});

app.get("/b/v1/queries/:taskId/events", async (req, reply) => {
  const a = auth(req, reply); if (!a) return;
  const taskId = (req.params as any).taskId;
  const task = hub.tasks.get(taskId);
  if (!task) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "任务不存在" } });
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
  const send = (event: string, data: unknown, id?: number) => reply.raw.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const lastId = Number(req.headers["last-event-id"] || 0);
  for (const e of task.events) if (e.seq > lastId) send(e.event, e.data, e.seq);
  const terminal = ["answer.final", "task.failed", "task.cancelled"];
  if (task.events.some(e => terminal.includes(e.event))) return reply.raw.end();
  const unsub = hub.subscribe(taskId, (event, data) => {
    send(event, data, task.events.length);
    if (terminal.includes(event)) { unsub(); reply.raw.end(); }
  });
  const hb = setInterval(() => reply.raw.write(": hb\n\n"), 15000);
  req.raw.on("close", () => { clearInterval(hb); unsub(); });
});

app.get("/b/v1/queries/:taskId", async (req, reply) => {
  const a = auth(req, reply); if (!a) return;
  const t = hub.tasks.get((req.params as any).taskId);
  if (!t) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "任务不存在" } });
  const { events, audit, ...task } = t as any;
  return { ...task, audit };
});

/** 同步求解端点（四个推演视图"改参即重算"用，OBO） */
app.post("/b/v1/solvers/:key/run", async (req, reply) => {
  const a = auth(req, reply); if (!a) return;
  const key = (req.params as any).key;
  try {
    const data = await SOLVERS_PROXY(key, a.ctx, a.token, (req.body as any)?.args || {});
    return { data, snapshotVersion: "snap-seed-v1" };
  } catch (e: any) {
    return reply.code(e.code === "SOLVER_NOT_FOUND" ? 404 : 422).send({ error: { code: e.code || "SOLVER_ERROR", message: e.message } });
  }
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => console.log(`[agentcore] :${PORT}  llm=${qosInfo().llm}`));
