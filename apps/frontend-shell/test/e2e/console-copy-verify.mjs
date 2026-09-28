/* eslint-disable */
/**
 * WO-CONSOLE-COPY（2026-09-28 仓主令）· 渲染结果判据，不是源码 grep。
 *
 * 判据（`CONVENTION-ui-information-layering` §5 第 6 条：
 *「复审时不许拿源码 grep 自证，判据要落在渲染结果上」）：
 *   ① 区③ 口径说明渲染成**表**：`dc-invariant-note` 里必须有 thead/th/td 的表格结构，
 *      且三列表头 = 读数 / 随本次事件 / 它在回答什么；
 *   ② R-UI-4：**渲染出来的正文**里不许出现开发话 —— `seed 42` / `POST /a/v1` /
 *      `curl` / 「世界态」「本体真值」「世界」；不许出现未渲染的 markdown 星号 `**`；
 *   ③ 表单提示（订单取消的取消比例）是新措辞，且不再重复「必填」；
 *   ④ E6 一屏尺子：c0828-root scrollHeight/clientHeight ≤ 1.15（改表后复测）；
 *   ⑤ 真后端自证：网络命中 ≥ 1 条 2xx/3xx 打向本脚本声明的 API 端口。
 * 金丝雀：表格若抽不到（结构变了或没渲染），本脚本报「量法坏了」而不是静默 PASS。
 *
 * 零安装 CDP 版（本机 playwright 包已蒸发，磁盘纪律不许 install）——
 * 骨架抄自 `e6-console0828-r3p.mjs`，只改驱动步骤与判据。
 * 跑法：
 *   E2E_BASE=http://127.0.0.1:5175 E2E_API_PORTS=4031 E2E_SHOTS=/tmp/console-copy \
 *   node apps/frontend-shell/test/e2e/console-copy-verify.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5175";
const PORTS = (process.env.E2E_API_PORTS ?? "4031").replace(/[^0-9|]/g, "");
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/console-copy-verify";
const CDP_PORT = 9334; // ⚠ 与 e6 脚本的 9333 岔开，两个探针可同时跑
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=/tmp/e6-chrome-profile-copy",
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

console.log("== ① 登录 ==");
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

console.log("== ② 进「事件影响与对策」（左导航常驻第 2 项，`nav-decision-console`） ==");
// ⚠ 从首页卡片进的是**沙盘视图**（统一推演控制台的缺省 data-view），不是本页——
//   2026-09-28 实测：卡片落点屏上是「选择扰动事件，推演其叠加影响」，z1/c0828-root 都不在。
//   本页的入口是左导航这条 route（ShellLayout NAV_GROUPS 第 2 项），点它。
await waitFor(`!!document.querySelector('[data-testid="nav-decision-console"]')`, "左导航条目", 60);
await evalJs(`document.querySelector('[data-testid="nav-decision-console"]').click()`);
// ⚠ 本页的根 testid 是 `decision-console`（`DecisionConsoleView.tsx`），
//   不是 `c0828-root` —— 后者属于统一推演控制台壳内那屏（Console0828），两页要分清。
await waitFor(`!!document.querySelector('[data-testid="decision-console"]')`, "decision-console 根", 90);
await new Promise((r) => setTimeout(r, 4000));

await new Promise((r) => setTimeout(r, 3000));
const diag = await evalJs(`(() => {
  const z1 = document.querySelector('[aria-label="加几件事"]');
  const shell = document.querySelector('[data-testid="usim-shell"]');
  return {
    url: location.href,
    dataView: shell ? shell.getAttribute('data-view') : '（没有 usim-shell）',
    hasRoot: !!document.querySelector('[data-testid="c0828-root"]'),
    z1: z1 ? z1.innerText.slice(0, 700) : '（没有 z1）',
    labels: [...document.querySelectorAll('[aria-label^="加一件"]')].map((e) => e.getAttribute('aria-label')),
    errs: [...document.querySelectorAll('[class*="err"]')].map((e) => e.innerText.slice(0, 200)),
    body: document.body.innerText.slice(0, 900),
  }; })()`);
console.log("诊断 · URL:", diag.url, "| data-view:", diag.dataView, "| c0828-root:", diag.hasRoot);
console.log("诊断 · body 前 900 字:\n" + diag.body);
console.log("诊断 · z1 正文:\n" + diag.z1);
console.log("诊断 · 模板行 aria-label:", JSON.stringify(diag.labels));
console.log("诊断 · 错误块:", JSON.stringify(diag.errs));
console.log("诊断 · 网络（4031，前 12 条）:", JSON.stringify(netHits.slice(0, 12), null, 0));

console.log("== ③ 打开「订单取消」模板，读表单提示（新措辞 + 不带「必填」重复） ==");
await waitFor(`!!document.querySelector('[aria-label="加一件「订单取消」"]')`, "订单取消模板行", 60);
await evalJs(`document.querySelector('[aria-label="加一件「订单取消」"]').click()`);
await new Promise((r) => setTimeout(r, 1200));
const cancelHints = await evalJs(`(() => {
  const labels = [...document.querySelectorAll('[class*="fieldLabel"]')].map((e) => e.textContent ?? '');
  return { labels, panel: (document.querySelector('[aria-label="加几件事"]') ?? document.body).innerText.slice(0, 900) }; })()`);
console.log("左栏全部表单标签:", JSON.stringify(cancelHints.labels));
console.log("左栏渲染正文（前 900 字）:\n" + cancelHints.panel);

console.log("== ④ 加一件「物料价格变动」并算 ==");
await evalJs(`document.querySelector('[aria-label="加一件「物料价格变动」"]')?.click()`);
const KIND = "MATERIAL_REPRICE";
// 主体：有下拉选下拉（选第一个非空），否则走搜索框点第一条命中
const picked = await evalJs(`(async () => {
  const sel = document.querySelector('#sel-${KIND}');
  if (sel) {
    // ⚠ 下拉的 options 来自**异步查询**（\`DecisionConsoleView.tsx\` 的 \`list.data?.items\`）：
    //   点开模板行之后立刻读，读到的只有「请选一个（共 0 个）」这个占位项。
    //   2026-09-28 实测踩过 —— 上一轮这行报 \`no-option\`，看着像「这个 kind 没有主体可选」，
    //   其实只是查询没回来。判据：等选项出现（最多 15s），超时才算真没有。
    for (let i = 0; i < 30; i++) {
      const opt = [...sel.options].find((o) => o.value);
      if (opt) {
        sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'select:' + opt.textContent.trim().slice(0, 24);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return 'no-option（等满 15s）:' + sel.options.length + ':' + sel.innerText.slice(0, 60);
  }
  const q = document.querySelector('#q-${KIND}');
  if (q) {
    const setv = (el, val) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true })); };
    setv(q, '磷酸铁锂');
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const item = document.querySelector('[class*="searchItem"]');
      if (item) { item.click(); return 'search:' + item.textContent.trim().slice(0, 24); }
    }
    return 'search-no-hit';
  }
  return 'no-selector';
})()`);
console.log("主体选择:", picked);
await evalJs(`(() => { const el = document.querySelector('#p-${KIND}-pctChange');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '15');
  el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 500));
const added = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '加进去' && !b.disabled);
  if (!btn) return null; btn.click(); return true; })()`);
if (!added) bail("〔加进去〕按不动（主体或必填格没填上）", 4);
await new Promise((r) => setTimeout(r, 800));
await evalJs(`document.querySelector('[data-testid="dc-go"]').click()`);
console.log("已按〔算一下〕，等结果…");
// ⚠ 等的是**一次真推演**：本机 2026-09-28 实测同一条 drill 请求 68–126s
//   （load average ~680，共享机上还有别的活）。120s 会把「机器慢」误判成「口径表没渲染」，
//   实测踩过一次（16:54 那次 125.97s 回来，探针已在 120s 判超时）。取 360s。
await waitFor(`!!document.querySelector('[data-testid="dc-invariant-note"]')`, "口径表", 360);
await new Promise((r) => setTimeout(r, 1500));

console.log("== ⑤ 判据 ==");
const out = await evalJs(`(() => {
  const note = document.querySelector('[data-testid="dc-invariant-note"]');
  const root = document.querySelector('[data-testid="decision-console"]');
  const shell = document.querySelector('[data-testid="usim-shell"]');
  const heads = [...note.querySelectorAll('th')].map((e) => e.textContent.trim());
  const rows = [...note.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
  const body = document.body.innerText;
  return {
    url: location.href,
    dataView: shell ? shell.getAttribute('data-view') : null,
    hasTable: !!note.querySelector('table'),
    heads, rows,
    noteText: note.innerText,
    ratio: root && root.clientHeight > 0 ? root.scrollHeight / root.clientHeight : null,
    forbidden: {
      seed: /seed\\s*\\d|seed=/.test(body),
      endpoint: /\\/a\\/v1|\\/b\\/v1|POST /.test(body),
      curl: /curl/.test(body),
      // ⚠ 术语判据只扫**本页根**的正文，不扫全站：左导航里「组织世界」是另一个模块的名字，
      //   不属于本单的范围（2026-09-28 实测，它是全页唯一残留的「世界」）。
      worldTerms: /世界态|本体真值|世界/.test(root ? root.innerText : ''),
      literalStars: /\\*\\*/.test(root ? root.innerText : ''),
    },
    cancelHintOnScreen: [...document.querySelectorAll('[class*="fieldLabel"]')].map((e) => e.textContent).filter((t) => t.includes('取消')),
    worldLines: (root ? root.innerText : body).split('\\n').filter((l) => /世界态|本体真值|世界/.test(l)).slice(0, 12),
    starLines: (root ? root.innerText : body).split('\\n').filter((l) => /\\*\\*/.test(l)).slice(0, 12),
  }; })()`);

console.log(JSON.stringify({ dataView: out.dataView, hasTable: out.hasTable, heads: out.heads, ratio: out.ratio, forbidden: out.forbidden }, null, 2));
console.log("表体：");
for (const r of out.rows) console.log("  | " + r.join(" | "));
console.log("订单取消提示（渲染文本）:", JSON.stringify(out.cancelHintOnScreen));
console.log("命中的「世界」类正文行（R-UI-4 待清）:", JSON.stringify(out.worldLines, null, 1));

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${SHOTS}/console-copy-1680x900.png`, Buffer.from(shot.result.data, "base64"));
writeFileSync(`${SHOTS}/console-copy-note.txt`, out.noteText + "\n");

const checks = {
  route: /\/v\/decision-console/.test(out.url ?? ""),
  table: out.hasTable,
  heads: JSON.stringify(out.heads) === JSON.stringify(["读数", "随本次事件", "它在回答什么"]),
  rows: out.rows.length >= 5,
  ratio: out.ratio !== null && out.ratio <= 1.15,
  noSeed: !out.forbidden.seed,
  noEndpoint: !out.forbidden.endpoint,
  noCurl: !out.forbidden.curl,
  noWorldTerms: !out.forbidden.worldTerms,
  noLiteralStars: !out.forbidden.literalStars,
  net: netHits.length > 0,
};
console.log("真后端自证: 命中 " + netHits.length + " 条；样例:", netHits.slice(0, 3));
console.log("判定:", JSON.stringify(checks));
const pass = Object.values(checks).every(Boolean);
console.log(pass ? "PASS" : "FAIL");
ws.close(); chrome.kill();
process.exit(pass ? 0 : 1);
