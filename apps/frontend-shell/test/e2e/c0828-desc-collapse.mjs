/* eslint-disable */
/**
 * WO-C0828-DESC-COLLAPSE · 描述型文本降层 —— **渲染结果判据**（不是源码 grep）。
 *
 * 判据（`docs/CONVENTION-ui-information-layering.md` §5 第 6 条：
 *「复审时不许拿源码 grep 自证，判据要落在渲染结果上」）：
 *   ① 改前 / 改后**同一探针、同一 fixture** 的屏上正文对照（原文 vs 原位现在的内容）；
 *   ② **诚实位零删除**：改前收集到的诚实位句子集合，改后每一条仍**可达**
 *      （仍在第一层，或在一个可展开的 `?` 气泡里）—— 少一条即退；
 *   ③ 对照实验：把该 `?` 触发器从 DOM 摘掉 ⇒ 那句话在屏上**彻底不可达**
 *      （证明判据咬的是真东西，不是恒绿）；
 *   ④ 一屏尺子：`scrollHeight/clientHeight` 给数；
 *   ⑤ 金丝雀：抽不到 `?` 触发器 / 抽不到气泡时，脚本报「**量法坏了**」并 RC=2，
 *      ⛔ 不许静默 PASS。
 *
 * 零安装 CDP 版（本机 playwright 包已蒸发，磁盘纪律不许 install）——
 * 骨架抄自 `console-copy-verify.mjs` / `e6-console0828-r3p.mjs`，只改驱动步骤与判据。
 *
 * 跑法（真后端 datacore 4001 / agentcore 4002 + 本 worktree 自己的 vite dev，一律 127.0.0.1）：
 *   E2E_BASE=http://127.0.0.1:5199 E2E_API_PORTS=4001|4002 E2E_SHOTS=/tmp/c0828-desc \
 *     node apps/frontend-shell/test/e2e/c0828-desc-collapse.mjs
 *
 * ⚠ **不许拿别人的 5173 当本单的量尺**：5173 上跑的是另一棵树（vite preview 服务别人的
 *   dist），本单的源码改动在它上面**一个字都不会出现**。故探针默认 5199，
 *   并强制自证「页面上确实有本单新加的 testid」才算连对了树（见 §⑤ 的 tree 判据）。
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5199";
const PORTS = (process.env.E2E_API_PORTS ?? "4001|4002").replace(/[^0-9|]/g, "");
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/c0828-desc-collapse";
const TAG = process.env.E2E_TAG ?? "state";
const CDP_PORT = Number(process.env.E2E_CDP_PORT ?? 9336); // 与别的探针（9333/9334）岔开
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/e6-chrome-profile-desc-${String(CDP_PORT)}`,
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
// 已登录（refresh cookie 在 profile 里）时不会出登录表单 —— 两种落点都收，
// ⛔ 别把「已经登录」读成「页面没起来」。
await waitFor(`!!document.querySelector('#login-username') || !!document.querySelector('[data-testid="home-page"]')`, "登录表单或首页");
await evalJs(`(() => {
  if (!document.querySelector('#login-username')) return "already-logged-in";
  const set = (sel, val) => { const el = document.querySelector(sel);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#login-tenant', 'demo'); set('#login-username', 'admin'); set('#login-password', 'demo1234');
  document.querySelector('button[type="submit"]').click(); return true; })()`);
await waitFor(`!!document.querySelector('[data-testid="home-page"]')`, "首页", 45);

console.log("== ② 不手敲 URL：点首页卡片进「统一推演控制台」 ==");
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
// 金丝雀①：data-view 必须是 console0828，否则抽到的是另一屏 ⇒ 量法坏了
const dataView = await evalJs(`document.querySelector('[data-testid="usim-shell"]')?.getAttribute('data-view')`);
if (dataView !== "console0828") bail(`量法坏了：usim-shell data-view=${String(dataView)} ≠ console0828`, 2);
// 等基础数据现状扫描落定（板子有行 / 或明说扫描中 / 或明说失败 —— 三者都算落定，别把「还没扫完」当「没有」）
await evalJs(`(async () => {
  for (let i = 0; i < 90; i++) {
    const ok = document.querySelector('[data-testid^="c0828-row-"]')
      || document.querySelector('[data-testid="c0828-board-error"]')
      || document.querySelector('[data-testid="c0828-board-loading"]');
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false; })()`);
await new Promise((r) => setTimeout(r, 2500));

console.log("== ③ 逐个基础页签：抽该页签可见的「?」触发器 + 该页签第一层正文 ==");
// 触发器 = 屏上带 aria-expanded 的 button（`HintDot` 与 `InfoPopover` 都置此属性）。
// 逐个 focus → 读同 wrap 内 role=tooltip → 再 blur；focus 是两条组件共同支持的开口
// （`onFocus` ⇒ open），不依赖 React 的 mouseenter 合成事件是否被程序化派发命中。
// ⚠ **必须逐页签抽**：`.tabPane` 用 `hidden` 切换 ⇒ 非当前页签里的触发器**focus 不动**
//   （隐藏元素收不到 focus 事件），只有切到那个页签才抽得到它的浮层。
const TABS = ["board", "options", "scan"];
const perTab = {};
const pops = { total: 0, out: [], anyTip: 0 };
for (const t of TABS) {
  await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-tab-${t}"]'); if (b) b.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 700));
  const got = await evalJs(`(async () => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const btns = [...root.querySelectorAll('button[aria-expanded]')].filter((b) => !!b.offsetParent);
  const out = [];
  const readTip = (b) => {
    const wrap = b.parentElement;
    return wrap ? wrap.querySelector('[role="tooltip"]') : null;
  };
  for (const b of btns) {
    b.focus();
    await new Promise((r) => setTimeout(r, 80));
    let tip = readTip(b);
    // focus 不开口时再走鼠标合成事件（HintDot / InfoPopover 的 onMouseEnter 挂在 wrap 上）
    if (!tip) {
      const wrap = b.parentElement;
      if (wrap) {
        wrap.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 80));
      tip = readTip(b);
    }
    out.push({
      tab: ${JSON.stringify(t)},
      trigger: b.getAttribute('data-testid'),
      aria: b.getAttribute('aria-label'),
      label: (b.textContent ?? '').trim().slice(0, 12),
      open: b.getAttribute('aria-expanded') === 'true',
      popTestId: tip ? tip.getAttribute('data-testid') : null,
      popText: tip ? (tip.textContent ?? '') : null,
    });
    b.blur();
    await new Promise((r) => setTimeout(r, 40));
  }
  const anyTip = root.querySelectorAll('[role="tooltip"]').length;
  const rootTxt = root.innerText;
  const pane = document.querySelector('[data-testid="c0828-pane-${t}"]');
  return { total: btns.length, out, anyTip, rootTxt, paneTxt: pane ? pane.innerText : null };
})()`);
  pops.total += got.total;
  pops.out.push(...got.out);
  pops.anyTip += got.anyTip;
  perTab[t] = { root: got.rootTxt, pane: got.paneTxt };
  console.log(`  页签 ${t}：可见「?」${got.total} 个 · 能抽出气泡正文的 ${got.out.filter((p) => p.popText !== null).length} 个 · 该页签第一层 ${String(got.paneTxt ?? "").length} 字节 · 全屏第一层 ${got.rootTxt.length} 字节`);
}
await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-tab-board"]'); if (b) b.click(); return true; })()`);
await new Promise((r) => setTimeout(r, 500));
writeFileSync(`${SHOTS}/${TAG}-pertab.json`, JSON.stringify(perTab, null, 1) + "\n");
console.log(`「?」触发器合计 = ${pops.total}；其中能抽出气泡正文的 = ${pops.out.filter((p) => p.popText !== null).length}`);
if (pops.total === 0) bail("量法坏了：c0828-root 里一个可见的 aria-expanded 按钮都抽不到（结构变了？）", 2);
if (pops.out.filter((p) => p.popText !== null).length === 0) {
  console.log("诊断 · 前 12 个 aria-expanded 按钮:", JSON.stringify(pops.out.slice(0, 12), null, 1));
  bail("量法坏了：触发器在，但一个气泡正文都抽不到", 2);
}

console.log("== ④ 屏上正文 / testid 清单 / 一屏尺子 ==");
const snap = await evalJs(`(() => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const main = document.querySelector('#main-content');
  const ids = [...root.querySelectorAll('[data-testid]')].map((e) => ({
    tid: e.getAttribute('data-testid'),
    text: (e.innerText ?? e.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300),
  }));
  const vis = (el) => el && el.clientHeight > 0;
  return {
    view: document.querySelector('[data-testid="usim-shell"]')?.getAttribute('data-view'),
    firstLayerText: root.innerText,
    domText: root.textContent,
    // 比对用的规范化：去所有空白（JSX 换行/缩进不该影响「那句话在不在」）。
    normFirst: root.innerText.replace(/\\s+/g, ''),
    normDom: root.textContent.replace(/\\s+/g, ''),
    testids: ids,
    metrics: {
      root: { scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
              ratio: root.clientHeight > 0 ? +(root.scrollHeight / root.clientHeight).toFixed(4) : null },
      main: main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight,
                     ratio: main.clientHeight > 0 ? +(main.scrollHeight / main.clientHeight).toFixed(4) : null } : null,
      doc: { scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight },
      win: window.innerWidth + 'x' + window.innerHeight,
    },
    tab: (() => { const on = [...root.querySelectorAll('[role="tab"][aria-selected="true"], button[aria-selected="true"]')];
                 return on.map((e) => (e.textContent ?? '').trim()).slice(0, 3); })(),
    rowCount: root.querySelectorAll('[data-testid^="c0828-row-"]').length,
  }; })()`);

writeFileSync(`${SHOTS}/${TAG}-firstlayer.txt`, snap.firstLayerText + "\n");
writeFileSync(`${SHOTS}/${TAG}-domtext.txt`, snap.domText + "\n");
writeFileSync(`${SHOTS}/${TAG}-testids.json`, JSON.stringify(snap.testids, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-pops.json`, JSON.stringify(pops.out, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-metrics.json`, JSON.stringify(snap.metrics, null, 1) + "\n");
const shot0 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${SHOTS}/${TAG}-1680x900.png`, Buffer.from(shot0.result.data, "base64"));

console.log("一屏尺子:", JSON.stringify(snap.metrics));
console.log("页签选中态:", JSON.stringify(snap.tab), "| 看板行数:", snap.rowCount);
console.log("屏上正文（第一层）长度:", snap.firstLayerText.length, "字节；已写", `${SHOTS}/${TAG}-firstlayer.txt`);
console.log("真后端自证: 命中 " + netHits.length + " 条；样例:", netHits.slice(0, 3));

console.log("== ⑤ 判据：诚实位集合（改前收的）逐条可达性 ==");
/**
 * ⚠ 集合在**改前**那一跑就收好了（`/tmp/c0828-desc/before-firstlayer.txt` 与 `before-persist`），
 * 改后一跑沿用**同一份清单**、同一台 fixture —— 清单不许按「改后屏上有什么」反推。
 * `kept` = 改前就在第一层、本单**判定留在第一层**的诚实位/空态指令；
 * `moved` = 本单搬进 `?` 的句子。两类都进这条判据：**一条都不许丢**。
 */
const DEFAULT_HONEST = [
  // ── 正线 b529113eb 已降层的两条（本单只核「没被删」）──
  { id: "正线·基线扫描整句", text: "换一个扰动重跑，这 18 处与各自的严重度、实测/红线都不会改变" },
  { id: "正线·基线扫描结论句", text: "它回答的是「现在哪里卡着」，不是「这次扰动会卡在哪」" },
  { id: "正线·左栏落不了地的理由", text: "这件事在本世界的传导图里没有落点" },
  { id: "正线·左栏理由的另一种", text: "不是取数失败" },
  { id: "正线·左栏第一层状态", text: "今天落不了地" },
  // ── 本单搬进 `?` 的四条 ──
  { id: "moved·不处置栏说明", text: "第四栏无按钮 —— 不处置无需操作，属默认发生。" },
  { id: "moved·agent 按钮说明", text: "引擎枚举已穷尽；改由 agent 读取同一份杠杆菜单重新生成。" },
  { id: "moved·右栏口径段", text: "四栏完整比较（含「不处置」那一栏）在中栏「对策方案」面板里，本栏只列出名与两维。" },
  { id: "moved·右栏口径内核", text: "系统不给推荐，决策由使用方作出。" },
  { id: "moved·②空态描述", text: "推演后在此列出，每条后面挂它的量化值。" },
  // ── 本单判定**留在第一层**的诚实位 / 空态指令（一条都不许因此消失）──
  { id: "kept·未推演诚实位", text: "下方各格为空 —— 尚未推演，不是取数失败。" },
  { id: "kept·空态操作指引", text: "在左栏添加扰动事件后，点击「开始推演」。" },
  { id: "kept·无对策是结论", text: "这 14 处当前无法给出任何对策 —— 这是推演结论，非加载失败。" },
  { id: "kept·追问入口事实", text: "本栏没有独立的对话输入框；自由提问请用屏幕底部那条全局提问条。" },
  { id: "kept·还没算诚实位", text: "还没算 —— 不是算不出来。" },
  { id: "kept·未调用 agent", text: "本次未调用 agent" },
  { id: "kept·基线分组标", text: "基础数据现状 · 与本次扰动无关" },
  { id: "kept·不属于本次推演的理由", text: "它回答的是「现在哪里卡着」（对象层当前快照），不是「这次扰动会卡在哪」" },
  { id: "kept·排序政策", text: "按严重度排序 · 系统不给推荐" },
];
const HONEST = JSON.parse(process.env.E2E_HONEST ?? "null") ?? DEFAULT_HONEST;
const nz = (s) => String(s ?? "").replace(/\s+/g, "");
const POPN = pops.out.map((p) => ({ ...p, popNorm: p.popText === null ? null : nz(p.popText) }));
const reach = HONEST.map((h) => {
  const needle = nz(h.text);
  const inFirst = snap.normFirst.includes(needle);
  const inDom = snap.normDom.includes(needle);
  const pop = POPN.find((p) => p.popNorm !== null && p.popNorm.includes(needle));
  return { id: h.id, text: h.text, inFirstLayer: inFirst, inDom, popTrigger: pop ? pop.trigger : null,
           reachable: inFirst || inDom || pop !== undefined };
});
for (const r of reach) {
  console.log(`  [${r.reachable ? "可达" : "★丢失★"}] ${r.id} · 第一层=${r.inFirstLayer} DOM=${r.inDom} 气泡=${r.popTrigger ?? "—"} :: ${r.text.slice(0, 46)}`);
}

console.log("== ⑥ 判据③ 对照实验：把 `?` 触发器摘掉 ⇒ 那句话必须彻底不可达 ==");
const DEFAULT_MOVED = [
  { id: "不处置栏说明", trigger: "info-c0828-donothing-note",
    text: "第四栏无按钮 —— 不处置无需操作，属默认发生。" },
  { id: "agent 按钮说明", trigger: "info-c0828-ask-agent-why",
    text: "引擎枚举已穷尽；改由 agent 读取同一份杠杆菜单重新生成。" },
  { id: "右栏口径段", trigger: "info-c0828-ai-actions-cal",
    text: "四栏完整比较（含「不处置」那一栏）在中栏「对策方案」面板里，本栏只列出名与两维。" },
  { id: "②空态描述", trigger: "info-c0828-ai-points-howto",
    text: "推演后在此列出，每条后面挂它的量化值。" },
];
const MOVED = JSON.parse(process.env.E2E_MOVED ?? "null") ?? DEFAULT_MOVED;
const control = await evalJs(`(async () => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const tids = ${JSON.stringify(MOVED.map((m) => m.trigger))};
  const found = tids.filter((t) => root.querySelector('[data-testid="' + t + '"]'));
  // 只摘触发器（气泡是它的兄弟节点、只有开着时才在 DOM 里；此刻都关着）
  for (const t of found) { root.querySelector('[data-testid="' + t + '"]').remove(); }
  return { removed: found.length, asked: tids.length, afterDom: root.textContent.replace(/\\s+/g, '') };
})()`);
console.log(`  摘掉的触发器: ${control.removed}/${control.asked}`);
const beforeReach = (m) => snap.normDom.includes(nz(m.text)) || POPN.some((p) => p.popNorm !== null && p.popNorm.includes(nz(m.text)));
for (const m of MOVED) {
  const before = beforeReach(m);
  const after = control.afterDom.includes(nz(m.text));
  console.log(`  ${m.id} · 摘前可达=${before} → 摘后可达=${after} ${before && !after ? "（判据有牙）" : "（★无鉴别力★）"}`);
}
const controlOk = control.removed === MOVED.length && MOVED.every((m) => beforeReach(m) && !control.afterDom.includes(nz(m.text)));

const honestOk = reach.every((r) => r.reachable) && reach.length === HONEST.length && HONEST.length > 0;
const netOk = netHits.length > 0;
console.log("判定:", JSON.stringify({ honestOk, honestCount: reach.length, controlOk, netOk, net: netHits.length }));
const pass = honestOk && controlOk && netOk;
console.log(pass ? "PASS" : "FAIL");
ws.close(); chrome.kill();
process.exit(pass ? 0 : 1);
