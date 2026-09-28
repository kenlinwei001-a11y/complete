/* eslint-disable */
/**
 * WO-CONSOLE-COPY · 复验判据（**与交付自带的那份探针不同源**，2026-09-28 复验方自写）
 *
 * 交付自带的 `test/e2e/console-copy-verify.mjs` 是实现方写的 —— 只重跑它不构成复验
 * （它可能把判据写松、或把断言写成「实现干了什么就断言什么」）。本文件独立重定判据：
 *
 *   C0 金丝雀      —— 扫法必须先命中一个**确定存在**的串，否则报「量法坏了」而不是「干净」
 *   C1 结构        —— `dc-invariant-note` 里必须是 table/thead/th 三列，行数 ≥5，每行 3 格
 *   C2 对齐        —— 表第二列**逐行**与 `decisionConsoleModel.ts` 里 `SCREEN_NUMBER_PROVENANCE`
 *                     的 `consumesEvents` 对齐（跑期读模型源码配对，防「表里硬编码了状态」）
 *   C3 非空        —— 每行第三列（它在回答什么）非空
 *   C4 计数自洽    —— 标题里 N = X + Y，且 X/Y 等于表里两种状态的实际行数
 *   C5 R-UI-3      —— 口径**不点开任何东西**就在 DOM 里（且 note 内无折叠壳）
 *   C6 R-UI-4      —— 渲染正文里不许有：seed / 接口路径 / curl / pnpm / 仓库路径 /
 *                     契约类型名 / zod 标识符 / 工单号 / 「世界·世界态·本体真值」/ 字面 `**`
 *   C7 hint 原样   —— 契约里的四条 payload hint 应原样上屏；旧措辞（「砍掉三成」「百分之多少」）不许残留
 *   C8 E6 尺子     —— 本页根 scrollHeight/clientHeight ≤ 1.15
 *   C9 真后端自证  —— 网络命中 ≥1 条 2xx/3xx 打向声明的 API 端口
 *
 * 跑法：
 *   E2E_BASE=http://127.0.0.1:5175 E2E_API_PORTS=4031 E2E_SHOTS=/tmp/console-copy-verify \
 *   node docs/evidence/wo-console-copy/verify/verify-probe.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 从本文件往上找到仓库根（含 apps/ 与 packages/ 的那一层）——
 *  ⛔ 不写死 `../../../` 这种层数：写死过一次，跑出来是 docs/apps/... 的 ENOENT。 */
function repoRoot(from) {
  let d = dirname(fileURLToPath(from));
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(d, "apps")) && existsSync(resolve(d, "packages"))) return d;
    d = dirname(d);
  }
  throw new Error("找不到仓库根（从 " + fileURLToPath(from) + " 往上 8 层都没有 apps/+packages/）");
}
const ROOT = repoRoot(import.meta.url);

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5175";
const PORTS = (process.env.E2E_API_PORTS ?? "4031").replace(/[^0-9|]/g, "");
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/console-copy-verify";
const CDP_PORT = 9335; // 与交付自带探针的 9334 岔开
mkdirSync(SHOTS, { recursive: true });

// ── 复验方自己读模型源码，抽出 (label, consumesEvents) 序列（C2 的对照源）────────────
const MODEL_SRC = readFileSync(resolve(ROOT, "apps/frontend-shell/src/views/sim/decisionConsoleModel.ts"), "utf8");
const provStart = MODEL_SRC.indexOf("SCREEN_NUMBER_PROVENANCE");
const provEnd = MODEL_SRC.indexOf("];", provStart);
const provBlock = MODEL_SRC.slice(provStart, provEnd);
const modelRows = [];
{
  // 逐个对象块抽：先按 `},` 切，再各取 label / consumesEvents，保序配对
  for (const chunk of provBlock.split(/\},\s*\{/)) {
    const label = /label:\s*"([^"]+)"/.exec(chunk)?.[1];
    const consumes = /consumesEvents:\s*(true|false)/.exec(chunk)?.[1];
    if (label && consumes) modelRows.push({ label, consumesEvents: consumes === "true" });
  }
}
// 金丝雀：模型必须抽到 ≥3 行且既有 true 又有 false，否则后面 C2 的「对齐」无意义
const modelCanary = modelRows.length >= 3 && modelRows.some((r) => r.consumesEvents) && modelRows.some((r) => !r.consumesEvents);

// ── 复验方自己读契约源码，抽四条 hint（C7 的对照源）─────────────────────────────
const SPEC_SRC = readFileSync(resolve(ROOT, "packages/contracts/src/sim-drill.ts"), "utf8");
const HINTS = ["cancelPct", "movedPct", "modelId", "shortagePct"].map((key) => {
  const re = new RegExp(`key:\\s*"${key}"[^}]*hint:\\s*"([^"]+)"`);
  return { key, hint: re.exec(SPEC_SRC)?.[1] ?? null };
});
const hintCanary = HINTS.every((h) => h.hint);

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=/tmp/e6-chrome-profile-verify",
  "--window-size=1680,900", "about:blank",
], { stdio: "ignore" });
const bail = (msg, rc) => { console.log("FATAL: " + msg); chrome.kill(); process.exit(rc); };
process.on("SIGINT", () => chrome.kill());

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
    if (new RegExp(`127\\.0\\.0\\.1:(${PORTS})`).test(u) && m.params.response.status < 400) netHits.push(`${m.params.response.status} ${u.slice(0, 90)}`);
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

console.log("模型对照源: " + JSON.stringify(modelRows));
console.log("契约对照源: " + JSON.stringify(HINTS));
console.log(`金丝雀: 模型抽到 ${modelRows.length} 行（须含 true/false 两类）=${modelCanary}；契约 4 条 hint 全抽到=${hintCanary}`);
if (!modelCanary || !hintCanary) bail("对照源没抽到（工具坏了，不是代码干净）—— 先修量法", 2);

await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
console.log("== ① 登录 ==");
await send("Page.navigate", { url: BASE + "/" });
await waitFor(`!!document.querySelector('#login-username')`, "登录表单", 60);
await evalJs(`(() => {
  const set = (sel, val) => { const el = document.querySelector(sel);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#login-tenant', 'demo'); set('#login-username', 'admin'); set('#login-password', 'demo1234');
  document.querySelector('button[type="submit"]').click(); return true; })()`);
await waitFor(`!!document.querySelector('[data-testid="home-page"]')`, "首页", 90);

console.log("== ② 进「事件影响与对策」= 左导航 nav-decision-console ==");
await waitFor(`!!document.querySelector('[data-testid="nav-decision-console"]')`, "左导航条目", 90);
await evalJs(`document.querySelector('[data-testid="nav-decision-console"]').click()`);
await waitFor(`!!document.querySelector('[data-testid="decision-console"]')`, "decision-console 根", 120);
await new Promise((r) => setTimeout(r, 4000));

console.log("== ③ 读契约 hint 是否原样上屏（订单取消卡片） ==");
await waitFor(`!!document.querySelector('[aria-label="加一件「订单取消」"]')`, "订单取消模板行", 90);
await evalJs(`document.querySelector('[aria-label="加一件「订单取消」"]').click()`);
await new Promise((r) => setTimeout(r, 2500));
const cancelOnScreen = await evalJs(`(() => {
  const body = (document.querySelector('[data-testid="decision-console"]') ?? document.body).innerText;
  return { hasNew: body.includes('取消比例（%）：100 = 整单取消；30 = 取消三成'),
           hasOldA: body.includes('砍掉三成'), hasOldB: body.includes('百分之多少') }; })()`);

console.log("== ④ 加一件「物料价格变动」并算 ==");
await evalJs(`document.querySelector('[aria-label="加一件「物料价格变动」"]')?.click()`);
const picked = await evalJs(`(async () => {
  const sel = document.querySelector('#sel-MATERIAL_REPRICE');
  if (!sel) return 'no-selector';
  for (let i = 0; i < 40; i++) {              // 选项来自异步查询：轮询到有值再读
    const opt = [...sel.options].find((o) => o.value);
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return 'select:' + opt.textContent.trim().slice(0, 20); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'no-option（等满 20s）'; })()`);
console.log("主体选择:", picked);
if (String(picked).startsWith("no-")) bail("主体选不上（不是本单缺陷，是前置没就位）", 4);
await evalJs(`(() => { const el = document.querySelector('#p-MATERIAL_REPRICE-pctChange');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '15');
  el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 600));
const added = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === '加进去' && !x.disabled);
  if (!b) return null; b.click(); return true; })()`);
if (!added) bail("〔加进去〕按不动", 4);
await new Promise((r) => setTimeout(r, 900));
await evalJs(`document.querySelector('[data-testid="dc-go"]').click()`);
console.log("已按〔算一下〕，等真推演（本机实测 68–126s，故等 360s）…");
await waitFor(`!!document.querySelector('[data-testid="dc-invariant-note"]')`, "口径表", 360);
await new Promise((r) => setTimeout(r, 2000));

console.log("== ⑤ 判据 ==");
const out = await evalJs(`(() => {
  const note = document.querySelector('[data-testid="dc-invariant-note"]');
  const root = document.querySelector('[data-testid="decision-console"]');
  const text = root ? root.innerText : document.body.innerText;
  const heads = [...note.querySelectorAll('th')].map((e) => e.textContent.trim());
  const rows = [...note.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
  return {
    heads, rows,
    noteText: note.innerText,
    hasTable: !!note.querySelector('table'),
    hasThead: !!note.querySelector('thead'),
    // C5：口径默认可见 —— note 内部不许有折叠壳
    foldShells: note.querySelectorAll('details, summary, [aria-expanded="false"]').length,
    cellsComplete: rows.every((r) => r.length === 3),
    ratio: root && root.clientHeight > 0 ? root.scrollHeight / root.clientHeight : null,
    forbidden: {
      seed: /seed\\s*\\d|seed=/.test(text),
      endpoint: /\\/a\\/v1|\\/b\\/v1|POST /.test(text),
      curl: /curl/.test(text),
      pnpm: /pnpm/.test(text),
      repoPath: /apps\\/|packages\\/|src\\//.test(text),
      contractType: /DrillReport|WorldSnapshot|ScreenNumberNote|consumesEvents/.test(text),
      woId: /WO-[A-Z0-9]/.test(text),
      worldTerms: /世界态|本体真值|世界/.test(text),
      literalStars: /\\*\\*/.test(text),
    },
    // 金丝雀：这些串**必须**在页面上（否则说明我读错了根/扫法坏了）
    canary: { hasDuShu: text.includes('读数'), hasNote: text.includes('它在回答什么') },
    hintNew: text.includes('取消比例（%）：100 = 整单取消；30 = 取消三成'),
    hintOld: text.includes('砍掉三成') || text.includes('百分之多少'),
  }; })()`);

console.log("表头:", JSON.stringify(out.heads));
console.log("表体:");
for (const r of out.rows) console.log("  | " + r.join(" | "));
console.log("禁项命中:", JSON.stringify(out.forbidden));
console.log("金丝雀:", JSON.stringify(out.canary), "| E6 ratio:", out.ratio);
console.log("hint 新措辞在屏:", out.hintNew, "| 旧措辞残留:", out.hintOld);
console.log("契约对照（订单取消）:", JSON.stringify(cancelOnScreen));

// C2：渲染表 vs 模型源码逐行对齐
const rendered = out.rows.map((r) => ({ label: r[0], state: r[1] }));
const alignOk = rendered.length === modelRows.length && rendered.every((r, i) => {
  const m = modelRows[i];
  const expect = m.consumesEvents ? "随事件变 · 是" : "背景读数 · 否";
  return r.label === m.label && r.state === expect;
});
// C4：标题计数自洽
const titleLine = (out.noteText.split("\n")[0] ?? "");
const nums = titleLine.match(/(\d+)/g)?.map(Number) ?? [];
const frozenRows = rendered.filter((r) => r.state.startsWith("背景读数")).length;
const movingRows = rendered.filter((r) => r.state.startsWith("随事件变")).length;
const countOk = nums.length >= 3 && nums[0] === frozenRows + movingRows && nums[1] === frozenRows && nums[2] === movingRows;

const checks = {
  C0canary: out.canary.hasDuShu && out.canary.hasNote,
  C1table: out.hasTable && out.hasThead && JSON.stringify(out.heads) === JSON.stringify(["读数", "随本次事件", "它在回答什么"]) && out.rows.length >= 5 && out.cellsComplete,
  C2align: alignOk,
  C3answers: out.rows.every((r) => (r[2] ?? "").length > 0),
  C4count: countOk,
  C5rUi3: out.foldShells === 0,
  C6rUi4: Object.values(out.forbidden).every((v) => v === false),
  // ⚠ hint 必须在**订单取消卡片还开着的时候**读（③ 那一步）—— 到 ⑤ 时表单已经换成
  //   物料价格变动，屏上找不到它不是缺陷。2026-09-28 实测踩过：误报过一次 C7 红。
  C7hint: cancelOnScreen.hasNew && !cancelOnScreen.hasOldA && !cancelOnScreen.hasOldB && !out.hintOld,
  C8ratio: out.ratio !== null && out.ratio <= 1.15,
  C9backend: netHits.length > 0,
};
console.log("标题行:", JSON.stringify(titleLine), "| 解析出的计数:", JSON.stringify(nums), "| 表内实际 背景/随事件:", frozenRows, "/", movingRows);
console.log("判据:", JSON.stringify(checks));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${SHOTS}/verify-1680x900.png`, Buffer.from(shot.result.data, "base64"));
writeFileSync(`${SHOTS}/verify-note.txt`, out.noteText + "\n");
const pass = Object.values(checks).every(Boolean);
console.log(pass ? "VERIFY_PASS" : "VERIFY_FAIL");
ws.close(); chrome.kill();
process.exit(pass ? 0 : 1);
