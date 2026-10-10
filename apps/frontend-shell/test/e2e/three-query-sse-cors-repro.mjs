/* eslint-disable */
/**
 * WO-THREE-QUERY-LIVE-UI · SSE 为什么没上屏 —— 浏览器内 A/B 复现（带正向对照）。
 *
 * 待验假设：`/api/v1/queries/:id/events` 走 `reply.hijack()` + raw.writeHead 绕开了 Fastify 的 CORS 插件，
 * 响应里**没有** access-control-allow-origin ⇒ 页面（127.0.0.1:5173）到 API（127.0.0.1:4002）跨源，
 * 浏览器在 EventSource 层直接拦掉 ⇒ 前端收不到任何事件帧 ⇒ 屏上 think-row/narration/step 恒 0。
 *
 * 判据（三臂，一起看才叫证据）：
 *   A 臂 EventSource（跨源 SSE）→ 期望：error，readyState=CLOSED/2，零消息（这就是屏上空白的原因）
 *   B 臂 fetch 同一主机普通端点（跨源 JSON）→ 期望：成功（证明"网络通、源没被封"，A 的失败不是搬砖借口）
 *   C 臂 EventSource 同源路径（5173，必然 404 且非同源 API）——不设，改用 curl 头对照（见证据档）
 *
 * 跑法：TQ_TASK=<taskId> TQ_TOKEN=<access_token> node apps/frontend-shell/test/e2e/three-query-sse-cors-repro.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.TQ_OUT ?? "/tmp/tq-evidence";
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5173";
const AC = process.env.TQ_AC ?? "http://127.0.0.1:4002";
const TASK = process.env.TQ_TASK;
const TOKEN = process.env.TQ_TOKEN;
if (!TASK || !TOKEN) { console.log("FATAL: 需要 TQ_TASK 与 TQ_TOKEN"); process.exit(2); }

mkdirSync(OUT, { recursive: true });
const CDP_PORT = 9500 + ((process.pid + 7) % 400);
const PROFILE = `/tmp/tq-cors-profile-${process.pid}`;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, "--window-size=1200,800", "about:blank",
], { stdio: "ignore" });
const hardKill = () => { try { chrome.kill("SIGKILL"); } catch {} };
const bail = (m, rc) => { console.log("FATAL: " + m); hardKill(); process.exit(rc); };
process.on("SIGINT", () => { hardKill(); process.exit(130); });
process.on("uncaughtException", (e) => { console.log("FATAL(uncaught): " + (e?.stack ?? e)); hardKill(); process.exit(1); });
process.on("exit", hardKill);

let version = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch {}
}
if (!version) bail("CDP 未就绪", 2);
if (!String(version.webSocketDebuggerUrl ?? "").includes(`:${CDP_PORT}/`)) bail("端口回显不符（可能连到别的实例）", 2);
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page0 = targets.find((t) => t.type === "page");
const ws = new WebSocket(page0.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("evaluate 异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
await send("Page.enable"); await send("Runtime.enable");
// 只到站点根（同源 = 页面源），不必登录：本复现只验"页面源 → API"的 CORS 行为
await send("Page.navigate", { url: BASE + "/" });
await new Promise((r) => setTimeout(r, 8000));

const ES_URL = `${AC}/api/v1/queries/${TASK}/events?access_token=${TOKEN}`;
const JSON_URL = `${AC}/api/v1/queries/${TASK}`;
const result = await evalJs(`(async () => {
  const out = { pageOrigin: location.origin, esUrlHost: ${JSON.stringify(AC)}, taskId: ${JSON.stringify(TASK)} };
  // A 臂：跨源 SSE（被测对象）
  out.es = await new Promise((resolve) => {
    let opened = false, msgs = 0, errs = [];
    let es;
    try { es = new EventSource(${JSON.stringify(ES_URL)}); } catch (e) { resolve({ threw: String(e) }); return; }
    es.onopen = () => { opened = true; };
    es.onmessage = () => { msgs++; };
    es.onerror = (e) => { errs.push(String(e && e.type || e)); };
    setTimeout(() => {
      const rs = es.readyState; // 0 CONNECTING / 1 OPEN / 2 CLOSED
      es.close();
      resolve({ opened, readyState: rs, msgs, errorEvents: errs.length, verdict: (opened && rs === 1) ? 'STREAM-ALIVE' : 'STREAM-DEAD' });
    }, 9000);
  });
  // B 臂（正向对照）：同主机普通 JSON 端点，跨源 fetch —— 若它也失败，说明是本机网络/源头问题，A 的结论作废
  try {
    const r = await fetch(${JSON.stringify(JSON_URL)}, { headers: { authorization: "Bearer " + ${JSON.stringify(TOKEN)} } });
    out.jsonControl = { status: r.status, ok: r.ok, bodyHead: (await r.text()).slice(0, 120) };
  } catch (e) {
    out.jsonControl = { threw: String(e) };
  }
  return out;
})()`);

console.log(JSON.stringify(result, null, 2));
writeFileSync(path.join(OUT, "sse-cors-repro.json"), JSON.stringify(result, null, 2) + "\n");
const ok = result?.es?.verdict === "STREAM-DEAD" && result?.jsonControl?.ok === true;
console.log(ok ? "VERDICT: SSE 被浏览器拦（跨源降级）· 对照臂成功 ⇒ 因果关系成立" : "VERDICT: 未复现（见原始档）");
ws.close(); hardKill();
process.exit(ok ? 0 : 1);
