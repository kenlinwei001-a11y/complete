/* eslint-disable */
/**
 * WO-C0828-REALSIM-POPOVERS · **真推演一次之后**那一屏上的 `?` 气泡取证。
 *
 * ── 为什么要另起一个探针（而不是沿用 `c0828-desc-collapse.mjs`）────────────────
 * `c0828-desc-collapse.mjs` 只读**未推演态**。那一态下屏上自己的文本就写着
 * 「下方各格为空 —— 尚未推演，不是取数失败。」⇒ 对策看板 / 对策方案 / 右栏「可选行动」
 * 那几块**根本不渲染**（它们门在 `result` / `picked` 上），于是挂在它们里面的三个 `?`
 * 打不开 —— 而旧探针把「本状态下不渲染」读成了「★被删了★」。
 * 那是**量法的盲区**，不是缺陷。本探针把「真推演一次」这一步补上，再回答同一批问题：
 *
 *   ① 三个目标气泡（`c0828-donothing-note` / `c0828-agent-regen` / `c0828-ai-actions-cal`）
 *      testid · 打开成功与否 · **气泡正文原文**（逐字）；
 *   ② 该屏第一层可见正文（降层之后原位还剩什么记号）；
 *   ③ 「?」触发器总数 / 能抽出正文的个数 —— 与未推演态对照；
 *   ④ **金丝雀**：一个气泡都抽不到 ⇒ 报「量法坏了」并 RC=2，⛔ 不许静默 PASS；
 *   ⑤ **推演真跑过的自证**：点「开始推演」那一刻起，打向 4001/4002 的成功请求条数与样例。
 *
 * 零安装 CDP（骨架抄自 `c0828-desc-collapse.mjs` / `e6-console0828-r3p.mjs`）。
 * 跑法（对**活部署**；本单探的是线上 5173 那棵树的 dist）：
 *   E2E_BASE=http://127.0.0.1:5173 E2E_API_PORTS=4001|4002 E2E_SHOTS=/tmp/c0828-realsim \
 *     node apps/frontend-shell/test/e2e/c0828-realsim-popovers.mjs
 *
 * ⏱ 本机一次真推演 68–126s ⇒ 结果等待给 360 tries（≈6 分钟），⛔ 别用默认 60。
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5173";
const PORTS = (process.env.E2E_API_PORTS ?? "4001|4002").replace(/[^0-9|]/g, "");
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/c0828-realsim";
const TAG = process.env.E2E_TAG ?? "realsim";
const CDP_PORT = Number(process.env.E2E_CDP_PORT ?? 9338);
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/e6-chrome-profile-realsim-${String(CDP_PORT)}`,
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
const targets0 = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page0 = targets0.find((t) => t.type === "page");
if (!page0) bail("没有 page target", 2);

const ws = new WebSocket(page0.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
/** 网络证据：每条 = {t, method, status, url}。⛔ 只记 4xx 以下（成功）的。 */
const netHits = [];
const reqMeta = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Network.requestWillBeSent") {
    reqMeta.set(m.params.requestId, { method: m.params.request.method, url: m.params.request.url });
  }
  if (m.method === "Network.responseReceived") {
    const st = m.params.response.status;
    const u = m.params.response.url;
    if (new RegExp(`127\\.0\\.0\\.1:(${PORTS})`).test(u) && st < 400) {
      const meta = reqMeta.get(m.params.requestId) ?? { method: "?", url: u };
      netHits.push({ t: Date.now(), method: meta.method, status: st, url: meta.url });
    }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 抽「?」触发器的公共实现：focus 开 → 读同 wrap 内 role=tooltip → blur 关。
 * ⚠ 与 `c0828-desc-collapse.mjs` **同一条实现**（focus 不开口时补鼠标合成事件；
 *   补出来的浮层只认真实 mouseout 才关，所以必须补那一下，否则浮层滞留会让后续判据失真）。
 */
const EXTRACT_JS = (tabKey) => `(async () => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const btns = [...root.querySelectorAll('button[aria-expanded]')].filter((b) => !!b.offsetParent);
  const out = [];
  const readTip = (b) => { const wrap = b.parentElement; return wrap ? wrap.querySelector('[role="tooltip"]') : null; };
  for (const b of btns) {
    b.focus();
    await new Promise((r) => setTimeout(r, 90));
    let tip = readTip(b);
    if (!tip) {
      const wrap = b.parentElement;
      if (wrap) {
        wrap.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 90));
      tip = readTip(b);
    }
    out.push({
      tab: ${JSON.stringify(tabKey)},
      trigger: b.getAttribute('data-testid'),
      aria: b.getAttribute('aria-label'),
      open: b.getAttribute('aria-expanded') === 'true',
      popTestId: tip ? tip.getAttribute('data-testid') : null,
      popText: tip ? (tip.textContent ?? '') : null,
    });
    b.blur();
    const w = b.parentElement;
    if (w) w.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await new Promise((r) => setTimeout(r, 45));
  }
  const pane = document.querySelector('[data-testid="c0828-pane-${tabKey}"]');
  return { total: btns.length, out, leftoverTips: root.querySelectorAll('[role="tooltip"]').length,
           rootTxt: root.innerText, paneTxt: pane ? pane.innerText : null,
           paneVisible: pane ? pane.offsetParent !== null : null,
           aiState: root.getAttribute('data-ai') };
})()`;

/** 逐页签抽「?」+ 该页签第一层正文。`keys` 里不存在的页签自动跳过（未推演态只有 3 个基础页签）。 */
const sweepTabs = async (keys, label) => {
  const agg = { total: 0, out: [], perTab: {} };
  console.log(`  ── ${label} ──`);
  for (const t of keys) {
    const has = await evalJs(`!!document.querySelector('[data-testid="c0828-tab-${t}"]')`);
    if (!has) { console.log(`  页签 ${t}：本态不存在，跳过`); continue; }
    await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-tab-${t}"]'); if (b) b.click(); return true; })()`);
    await sleep(800);
    const got = await evalJs(EXTRACT_JS(t));
    const nText = got.out.filter((p) => p.popText !== null).length;
    agg.total += got.total;
    agg.out.push(...got.out);
    agg.perTab[t] = { root: got.rootTxt, pane: got.paneTxt, paneVisible: got.paneVisible,
                      triggers: got.total, extractable: nText, aiState: got.aiState };
    console.log(`  页签 ${t}：可见「?」${got.total} 个 · 能抽出气泡正文的 ${nText} 个 · 收完仍开着的浮层 ${got.leftoverTips}（必须 0）· 该页签第一层 ${String(got.paneTxt ?? "").length} 字节 · 右栏 data-ai=${String(got.aiState)}`);
    if (got.leftoverTips !== 0) bail(`量法坏了：抽完「?」后还有 ${got.leftoverTips} 个浮层挂在 DOM 里`, 2);
  }
  console.log(`  「?」触发器合计 = ${agg.total}；其中能抽出气泡正文的 = ${agg.out.filter((p) => p.popText !== null).length}`);
  return agg;
};

await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");

console.log("== ① 登录（不手敲 URL）==");
await send("Page.navigate", { url: BASE + "/" });
await waitFor(`!!document.querySelector('#login-username') || !!document.querySelector('[data-testid="home-page"]')`, "登录表单或首页");
await evalJs(`(() => {
  if (!document.querySelector('#login-username')) return "already-logged-in";
  const set = (sel, val) => { const el = document.querySelector(sel);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#login-tenant', 'demo'); set('#login-username', 'admin'); set('#login-password', 'demo1234');
  document.querySelector('button[type="submit"]').click(); return true; })()`);
await waitFor(`!!document.querySelector('[data-testid="home-page"]')`, "首页", 45);

console.log("== ② 点首页卡片进「统一推演控制台」 ==");
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

console.log("== ③ 记「未推演态」基线读数（与推演后对照用）==");
// 等落点判定落定：至少一个事件按钮 data-landable="1"（可落地）
await waitFor(`!!document.querySelector('[data-testid^="c0828-ev-"][data-landable="1"]')`, "至少一件可落地扰动事件", 120);
await sleep(2500);
const beforeSnap = await evalJs(`(() => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  return {
    idle: !!document.querySelector('[data-testid="c0828-idle"]'),
    verdict: !!document.querySelector('[data-testid="c0828-verdict"]'),
    triggers: root.querySelectorAll('button[aria-expanded]').length,
    tips: root.querySelectorAll('[role="tooltip"]').length,
    evLandable: [...root.querySelectorAll('[data-testid^="c0828-ev-"]')].filter((b) => b.getAttribute('data-landable') === '1').map((b) => b.getAttribute('data-testid')),
    evAll: [...root.querySelectorAll('[data-testid^="c0828-ev-"]')].map((b) => ({ id: b.getAttribute('data-testid'), landable: b.getAttribute('data-landable') })),
  }; })()`);
console.log("  未推演态: idle=" + beforeSnap.idle + " verdict=" + beforeSnap.verdict
  + " · 全屏 aria-expanded 触发器 " + beforeSnap.triggers + " 个");
console.log("  可落地事件: " + JSON.stringify(beforeSnap.evLandable));
console.log("  全部事件: " + JSON.stringify(beforeSnap.evAll));

// 同一台机器、同一棵树、同一把尺子先量一遍**未推演态** —— 这就是判据③要的那个对照数。
const beforeSweep = await sweepTabs(["board", "options", "scan"], "未推演态（同一把尺子先量）");
if (beforeSweep.total === 0 || beforeSweep.out.filter((p) => p.popText !== null).length === 0) {
  bail("量法坏了：未推演态就一个气泡正文都抽不到 ⇒ 尺子有问题，后面的对照不成立", 2);
}
writeFileSync(`${SHOTS}/${TAG}-pertab-before.json`, JSON.stringify(beforeSweep.perTab, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-pops-before.json`, JSON.stringify(beforeSweep.out, null, 1) + "\n");

console.log("== ④ 左栏加一件**可落地**的扰动事件（走屏上默认值）==");
const addRes = await evalJs(`(async () => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const btns = [...root.querySelectorAll('[data-testid^="c0828-ev-"][data-landable="1"]')];
  const log = [];
  for (const b of btns) {
    const id = b.getAttribute('data-testid').replace('c0828-ev-', '');
    b.click();
    await new Promise((r) => setTimeout(r, 900));
    const form = document.querySelector('[data-testid="c0828-form-' + id + '"]');
    if (!form) { log.push(id + ':无表单'); continue; }
    // 有下拉就选第一个非空项（默认「请选择」是空的，不选则「加入」按钮 disabled）
    const sel = document.querySelector('[data-testid="c0828-pick-' + id + '"]');
    let picked = null;
    if (sel) {
      const opt = [...sel.options].find((o) => o.value !== '');
      if (!opt) { log.push(id + ':下拉无选项'); continue; }
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      picked = opt.textContent;
      await new Promise((r) => setTimeout(r, 400));
    }
    const addBtn = document.querySelector('[data-testid="c0828-add-' + id + '"]');
    if (!addBtn) { log.push(id + ':无加入按钮'); continue; }
    if (addBtn.disabled) { log.push(id + ':加入按钮仍 disabled（picked=' + String(picked) + '）'); continue; }
    const mag = document.querySelector('[data-testid="c0828-mag-' + id + '"]');
    addBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    const cnt = document.querySelector('[data-testid="c0828-staged-count"]');
    log.push(id + ':已加入（落点=' + String(picked) + '·幅度=' + String(mag ? mag.value : '?') + '）→ ' + String(cnt ? cnt.textContent.trim() : '?'));
    return { ok: true, id, picked, log };
  }
  return { ok: false, log };
})()`);
console.log("  " + JSON.stringify(addRes, null, 1));
if (!addRes || addRes.ok !== true) bail("没有一个可落地事件能加进待施加清单（表单填不动）⇒ 本状态不可达，缺的是「表单可提交」", 5);
await sleep(600);

console.log("== ⑤ 点「开始推演」并等真出结果 ==");
const netMark = netHits.length;
const goState = await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-go"]');
  if (!b) return { found: false }; const disabled = b.disabled; b.click(); return { found: true, disabled, text: b.textContent.trim() }; })()`);
console.log("  按钮: " + JSON.stringify(goState));
if (!goState.found || goState.disabled) bail("「开始推演」按钮不存在或仍是 disabled", 5);
await sleep(2000);
const runningSeen = await evalJs(`!!document.querySelector('[data-testid="c0828-running"]')`);
console.log("  推演中指示器 c0828-running 出现过: " + runningSeen);
const t0 = Date.now();
await waitFor(`!!document.querySelector('[data-testid="c0828-verdict"]') && !document.querySelector('[data-testid="c0828-running"]')`, "推演结果 c0828-verdict", 360);
console.log("  推演耗时约 " + Math.round((Date.now() - t0) / 1000) + "s");
const netRun = netHits.slice(netMark);
console.log("== ⑤ 网络证据：点「开始推演」之后打向 4001/4002 的成功请求 ==");
console.log("  条数 = " + netRun.length);
for (const h of netRun.slice(0, 24)) console.log(`    ${h.method} ${h.status} ${h.url.slice(0, 130)}`);
writeFileSync(`${SHOTS}/${TAG}-net-run.txt`, netRun.map((h) => `${h.method} ${h.status} ${h.url}`).join("\n") + "\n");
writeFileSync(`${SHOTS}/${TAG}-net-all.txt`, netHits.map((h) => `${h.method} ${h.status} ${h.url}`).join("\n") + "\n");

if (await evalJs(`!!document.querySelector('[data-testid="c0828-run-error"]')`)) {
  bail("推演报错（c0828-run-error 在场）—— 结果态没到，后面的气泡判据不成立", 6);
}

const TARGETS = [
  { key: "donothing-note", trigger: "info-c0828-donothing-note", tab: "options",
    where: "对策方案页签 · 四栏卡片下方（不处置栏说明）",
    expect: "第四栏无按钮 —— 不处置无需操作，属默认发生。" },
  { key: "agent-regen", trigger: "info-c0828-agent-regen", tab: "scan",
    where: "全流程扫描页签 · 「交由 agent 生成对策」按钮旁",
    expect: "系统已把这一处能走的路枚举穷尽" },
  { key: "ai-actions-cal", trigger: "info-c0828-ai-actions-cal", tab: null, ensureAiOpen: true,
    where: "右栏 ③ 可选行动（本栏与中栏的关系）· 右栏在 options/scan 两个宽页签下按设计**自动收起**（`data-ai=collapsed`），收起态第一层留 28px 竖边 + 展开按钮",
    expect: "四栏完整比较（含「不处置」那一栏）在中栏「对策方案」面板里" },
];

console.log("== ⑥ 逐个页签抽「?」+ 第一层正文（推演后态）==");
const TAB_KEYS = ["board", "options", "scan", "cust", "money", "log"];
const afterSweep = await sweepTabs(TAB_KEYS, "推演后态（六个页签）");
const perTab = afterSweep.perTab;
const pops = { total: afterSweep.total, out: afterSweep.out };
const extractable = pops.out.filter((p) => p.popText !== null).length;
const beforeText = beforeSweep.out.filter((p) => p.popText !== null).length;
console.log(`  ── 同一把尺子对照：未推演态 ${beforeSweep.total} 个触发器 / ${beforeText} 个可抽正文 → 推演后 ${pops.total} / ${extractable}`);
if (pops.total === 0) bail("量法坏了：c0828-root 里一个可见的 aria-expanded 按钮都抽不到（结构变了？）", 2);
if (extractable === 0) {
  console.log("诊断 · 前 12 个 aria-expanded 按钮:", JSON.stringify(pops.out.slice(0, 12), null, 1));
  bail("量法坏了：触发器在，但一个气泡正文都抽不到 ⇒ 本次「抽不到气泡」不构成任何关于产品的结论", 2);
}

console.log("== ⑦ 三个目标气泡：逐个打开 + dump 正文原文 ==");
const targetRes = [];
for (const T of TARGETS) {
  if (T.tab) {
    await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-tab-${T.tab}"]'); if (b) b.click(); return true; })()`);
    await sleep(700);
  }
  // 右栏（推演助手）在宽页签下按设计自动收起 ⇒ 触发器整个不在 DOM 里。
  // 这不是「被删了」：收起态第一层留着 28px 竖边 + 展开按钮（同一个 `c0828-ai-expand`，
  // 就是给用户按的那一个）。要量它里面的 `?`，先走用户那一步把栏展开，并**记录这一步**。
  const aiBefore = await evalJs(`document.querySelector('[data-testid="c0828-root"]')?.getAttribute('data-ai')`);
  let expandedBy = null;
  let collapsedStrip = null;
  if (T.ensureAiOpen && aiBefore === "collapsed") {
    // 「静默降层等于删除」的反面证据：收起后第一层还剩什么
    collapsedStrip = await evalJs(`document.querySelector('[data-testid="c0828-ai-collapsed"]')?.innerText ?? null`);
  }
  if (T.ensureAiOpen && aiBefore === "collapsed") {
    await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-ai-expand"]'); if (b) b.click(); return true; })()`);
    await sleep(600);
    expandedBy = "c0828-ai-expand";
  }
  const aiAfter = await evalJs(`document.querySelector('[data-testid="c0828-root"]')?.getAttribute('data-ai')`);
  if (T.ensureAiOpen) {
    console.log(`  右栏收起态: 探前 data-ai=${String(aiBefore)} → 探时 data-ai=${String(aiAfter)}${expandedBy ? "（点了一次 c0828-ai-expand 展开）" : ""}`);
    if (collapsedStrip !== null) console.log(`  收起态第一层剩下的记号（c0828-ai-collapsed）: ${JSON.stringify(collapsedStrip)}`);
  }
  const r = await evalJs(`(async () => {
    const root = document.querySelector('[data-testid="c0828-root"]');
    const b = root.querySelector('[data-testid="${T.trigger}"]');
    if (!b) return { found: false };
    const scope = b.closest('[data-testid="c0828-pane-options"], [data-testid="c0828-pane-scan"], [data-testid^="c0828-pane-"], [data-testid="c0828-ai-actions"], [data-testid="c0828-root"]');
    const anchorText = scope ? scope.innerText : null;
    const anchorTextCompact = (() => {
      // 「原位还剩什么记号」：取触发器所在的那一小块（最近的 p / li / div 容器，限 3 层上溯）
      let el = b, best = b;
      for (let i = 0; i < 3 && el; i++) { best = el; el = el.parentElement; }
      return (best?.innerText ?? '').replace(/\\n+/g, ' | ').trim();
    })();
    b.focus();
    await new Promise((r) => setTimeout(r, 120));
    let tip = b.parentElement ? b.parentElement.querySelector('[role="tooltip"]') : null;
    if (!tip) {
      const w = b.parentElement;
      if (w) { w.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
               w.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); }
      await new Promise((r) => setTimeout(r, 120));
      tip = b.parentElement ? b.parentElement.querySelector('[role="tooltip"]') : null;
    }
    const res = {
      found: true, trigger: "${T.trigger}",
      visible: !!b.offsetParent,
      open: b.getAttribute('aria-expanded') === 'true',
      ariaLabel: b.getAttribute('aria-label'),
      triggerText: (b.textContent ?? '').trim(),
      popTestId: tip ? tip.getAttribute('data-testid') : null,
      popText: tip ? (tip.textContent ?? '') : null,
      popInnerText: tip ? (tip.innerText ?? '') : null,
      pane: scope ? scope.getAttribute('data-testid') : null,
      anchorTextCompact,
    };
    b.blur();
    const w2 = b.parentElement;
    if (w2) w2.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await new Promise((r) => setTimeout(r, 120));
    res.leftoverAfter = document.querySelectorAll('[role="tooltip"]').length;
    return res;
  })()`);
  targetRes.push({ ...T, ...r });
  if (!r.found) {
    console.log(`  ✗ ${T.trigger} —— 不在 DOM 里（${T.where}）`);
  } else {
    console.log(`  ✓ ${T.trigger} —— 可见=${r.visible} 打开=${r.open} 气泡testid=${String(r.popTestId)}`);
    console.log(`      aria-label: ${String(r.ariaLabel)}`);
    console.log(`      气泡正文原文: ${JSON.stringify(r.popText)}`);
    console.log(`      原位（触发器所在容器）第一层文本: ${JSON.stringify(r.anchorTextCompact)}`);
  }
}

console.log("== ⑧ 第一层正文 / testid 清单 / 一屏尺子 ==");
await evalJs(`(() => { const b = document.querySelector('[data-testid="c0828-tab-board"]'); if (b) b.click(); return true; })()`);
await sleep(600);
const snap = await evalJs(`(() => {
  const root = document.querySelector('[data-testid="c0828-root"]');
  const ids = [...root.querySelectorAll('[data-testid]')].map((e) => ({
    tid: e.getAttribute('data-testid'),
    text: (e.innerText ?? e.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300),
  }));
  return {
    view: document.querySelector('[data-testid="usim-shell"]')?.getAttribute('data-view'),
    firstLayerText: root.innerText,
    verdict: document.querySelector('[data-testid="c0828-run-badge"]')?.innerText ?? null,
    rowCount: root.querySelectorAll('[data-testid^="c0828-row-"]').length,
    optsRowCount: root.querySelectorAll('[data-testid^="c0828-ai-option-"], [data-testid^="c0828-cand-"]').length,
    metrics: { doc: { scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight },
               win: window.innerWidth + 'x' + window.innerHeight },
  }; })()`);
writeFileSync(`${SHOTS}/${TAG}-firstlayer.txt`, snap.firstLayerText + "\n");
writeFileSync(`${SHOTS}/${TAG}-testids.json`, JSON.stringify(snap.testids, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-pops.json`, JSON.stringify(pops.out, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-pertab.json`, JSON.stringify(perTab, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-targets.json`, JSON.stringify(targetRes, null, 1) + "\n");
writeFileSync(`${SHOTS}/${TAG}-before.json`, JSON.stringify(beforeSnap, null, 1) + "\n");
const shot0 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${SHOTS}/${TAG}-1680x900.png`, Buffer.from(shot0.result.data, "base64"));
console.log("  本次推演徽标: " + JSON.stringify(snap.verdict));
console.log("  看板行数: " + snap.rowCount + " · 对策候选条数: " + snap.optsRowCount);
console.log("  第一层正文长度: " + snap.firstLayerText.length + " 字节；已写 " + SHOTS + "/" + TAG + "-firstlayer.txt");
console.log("  网络命中合计: " + netHits.length + " 条（其中推演段 " + netRun.length + " 条）");

console.log("== ⑨ 判定 ==");
const found3 = targetRes.filter((t) => t.found).length;
const open3 = targetRes.filter((t) => t.found && t.open && t.popText !== null).length;
const netOk = netRun.length > 0;
const BASE3 = new Set(["board", "options", "scan"]);
const afterBase3 = afterSweep.out.filter((p) => BASE3.has(p.tab));
console.log(JSON.stringify({ 目标气泡: 3, 在DOM里: found3, 打开并抽出正文: open3,
  推演后_全部页签: { 触发器: pops.total, 能抽出正文: extractable },
  推演后_基线3页签: { 触发器: afterBase3.length, 能抽出正文: afterBase3.filter((p) => p.popText !== null).length },
  未推演态_基线3页签: { 触发器: beforeSweep.total, 能抽出正文: beforeText },
  推演段网络成功请求: netRun.length, 网络判据: netOk }, null, 1));
// 金丝雀（判据④）：一个都抽不到已在上文 bail；这里再兜「网络自证」——不许拿「按钮变灰」当证据
if (!netOk) { console.log("FAIL：推演段一条打向 4001/4002 的成功请求都没有 ⇒ 推演真跑过这件事没有自证"); }
const pass = netOk && found3 === 3 && open3 === 3;
console.log(pass ? "PASS（三个目标气泡全部找到、打开、抽出正文，且有真推演网络自证）" : "FAIL（见上，未凑齐）");
ws.close(); chrome.kill();
process.exit(pass ? 0 : 1);
