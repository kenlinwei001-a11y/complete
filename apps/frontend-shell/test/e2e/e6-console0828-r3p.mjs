/* eslint-disable */
/**
 * WO-C0828-P1 R3′ · E6 修后实测：统一推演控制台 1680×900 一屏判定（零安装 CDP 版）。
 *
 * 本机 playwright 包已随 /tmp worktree 蒸发（lib.mjs 硬编码的 /opt/node22 路径不存在），
 * 磁盘纪律不许 playwright install ⇒ 直接用系统 Chrome + 裸 CDP（node 24 内建 WebSocket/fetch）。
 * 判据不变：c0828-root scrollHeight/clientHeight ≤ 1.15 · 真后端自证（4011/4002 有 2xx/3xx 回包）。
 * 金丝雀：usim-shell data-view 必须 = "console0828"，否则报「量法坏了」。
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5174";
const PORTS = (process.env.E2E_API_PORTS ?? "4011|4002").replace(/[^0-9|]/g, "");
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/wo-dsh-migration-evidence/shots";
const CDP_PORT = 9333;
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=/tmp/e6-chrome-profile",
  "--window-size=1680,900", "about:blank",
], { stdio: "ignore" });
const bail = (msg, rc) => { console.log("FATAL: " + msg); chrome.kill(); process.exit(rc); };
process.on("SIGINT", () => chrome.kill());

// 等 CDP 起来
let version = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch {}
}
if (!version) bail("Chrome CDP 30×500ms 未就绪", 2);
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page0 = targets.find((t) => t.type === "page");
if (!page0) bail("没有 page target", 2);

const ws = new WebSocket(page0.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
const netHits = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Network.responseReceived") {
    const u = m.params.response.url;
    if (new RegExp(`127\\.0\\.0\\.1:(${PORTS})`).test(u) && m.params.response.status < 400) netHits.push(`${m.params.response.status} ${u.slice(0, 110)}`);
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("evaluate 异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const waitFor = async (expr, label, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const v = await evalJs(expr).catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  bail(`等待超时: ${label}（${tries}s）`, 3);
};

await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
console.log("== ① 从登录走起 ==");
await send("Page.navigate", { url: BASE + "/" });
await waitFor(`!!document.querySelector('#login-username')`, "登录表单");
await evalJs(`(() => {
  const set = (sel, val) => { const el = document.querySelector(sel);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#login-tenant', 'demo'); set('#login-username', 'admin'); set('#login-password', 'demo1234');
  document.querySelector('button[type="submit"]').click(); return true; })()`);
await waitFor(`!!document.querySelector('[data-testid="home-page"]')`, "首页", 45);
console.log("登录落点:", await evalJs("location.href"));

console.log("== ② 点进「统一推演控制台」（不手敲 URL）==");
const clicked = await evalJs(`(() => {
  const card = document.querySelector('[data-testid="home-view-unified-sim"], [data-testid="home-view-sim-unified"]');
  if (card) { card.click(); return "home-card"; }
  const els = [...document.querySelectorAll('a,button,span,div')];
  const t = els.find((e) => e.childElementCount === 0 && (e.textContent ?? '').trim() === '统一推演控制台');
  if (!t) return null;
  (t.closest('a,button,[role="button"]') ?? t).click(); return "nav-text"; })()`);
if (!clicked) bail("首页/导航都找不到「统一推演控制台」入口", 4);
console.log("入口点击方式:", clicked);
await waitFor(`!!document.querySelector('[data-testid="usim-shell"]')`, "usim-shell", 90);
await waitFor(`!!document.querySelector('[data-testid="c0828-root"]')`, "c0828-root", 90);
await new Promise((r) => setTimeout(r, 6000)); // 数据沉降

console.log("== ③ 量测 ==");
const m = await evalJs(`(() => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const shell = document.querySelector('[data-testid="usim-shell"]');
  return {
    dataView: shell ? shell.getAttribute('data-view') : null,
    rootScroll: root.scrollHeight, rootClient: root.clientHeight,
    ratio: root.clientHeight > 0 ? root.scrollHeight / root.clientHeight : null,
    docRatio: document.documentElement.scrollHeight / window.innerHeight,
    winInner: window.innerWidth + 'x' + window.innerHeight,
  }; })()`);
console.log(JSON.stringify(m, null, 2));
console.log("真后端自证: 命中 " + netHits.length + " 条；样例:", netHits.slice(0, 3));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${SHOTS}/e6-r3p-console0828-1680x900.png`, Buffer.from(shot.result.data, "base64"));

const pass = m.ratio !== null && m.ratio <= 1.15 && m.dataView === "console0828" && netHits.length > 0;
console.log(`E6 判定: ratio=${m.ratio === null ? "null" : m.ratio.toFixed(4)} ≤1.15 ? ${pass ? "PASS" : "FAIL"}`);
ws.close(); chrome.kill();
process.exit(pass ? 0 : 1);
