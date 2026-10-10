/* eslint-disable */
/**
 * WO-THREE-QUERY-LIVE-UI · 三条复杂 query 的**活 UI 取证**（取证单·零产品码改动）。
 *
 * 目标：仓主原话「测试 3 次，3 个复杂的 query 输入，检测是否意图判断对，分类对，react 模式生效，
 * 调用了正确的资源。列出每个测试的输入，过程，结果。」
 *
 * 本脚本只做**驱动 + 读屏**，全部原始读数落盘；判据由人读原始档后给。
 *
 * 硬纪律（抄自 console-copy-verify.mjs / lib.mjs 的既有纪律）：
 *  1. ⛔ 从**登录页**走起，不许手敲 URL 直达（手敲会让"找不到入口"这类问题整个消失）。
 *  2. ⛔ 提问走**屏幕底部的全局提问条**（`[data-testid="query-dock-bar"] input`），
 *     不用场景启动器那张卡（它跑确定性推演、不调 agent）。
 *  3. ⛔ 不许拿 `[data-testid*="c0828"]` 判到达（会匹到 shell 容器）。
 *  4. 报"屏上没有 X"之前先跑**已知必中**的金丝雀（本脚本 canary 段：task-run 计数 > 0 才算量法活着）。
 *  5. 真后端自证：网络记录里必须有打到 4001/4002 的 2xx/3xx 回包（MSW mock 态不会有）。
 *
 * 跑法（本机无 playwright，走零安装 CDP）：
 *   E2E_BASE=http://127.0.0.1:5173 TQ_OUT=/tmp/tq-evidence \
 *   node apps/frontend-shell/test/e2e/three-query-ui.mjs
 * 输出：TQ_OUT/taskids.json + 每条 query 的屏上读数 JSON + 截图；API 侧原始档由 three-query-collect.mjs 补齐。
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5173";
const OUT = process.env.TQ_OUT ?? "/tmp/tq-evidence";
const CDP_PORT = Number(process.env.TQ_CDP_PORT ?? 9441);
const PROFILE = process.env.TQ_PROFILE ?? "/tmp/tq-chrome-profile";
const PORTS = (process.env.E2E_API_PORTS ?? "4001|4002").replace(/[^0-9|]/g, "");
const MAX_WAIT_MS = Number(process.env.TQ_MAX_WAIT_MS ?? 900_000); // 单条 query 最长等待（默认 15 分钟）

const QUERIES = [
  { id: "q1", kind: "无域·开放式", text: process.env.TQ_Q1 ?? "把所有能查的都翻一遍，给我一个关于常州基地经营状况的综合自由结论" },
  { id: "q2", kind: "有域·生产", text: process.env.TQ_Q2 ?? "常州基地产能瓶颈在哪道工序？各产线的利用率和硬产能上限分别是多少？" },
  { id: "q3", kind: "有域·供应", text: process.env.TQ_Q3 ?? "长协和现货的齐套缺口差在哪？哪几张订单最先受影响？" },
];

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
  "--window-size=1680,900", "about:blank",
], { stdio: "ignore" });
const bail = (msg, rc) => { console.log("FATAL: " + msg); chrome.kill(); process.exit(rc); };
process.on("SIGINT", () => { chrome.kill(); process.exit(130); });

let version = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch {}
}
if (!version) bail("Chrome CDP 40×500ms 未就绪", 2);
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page0 = targets.find((t) => t.type === "page");
if (!page0) bail("没有 page target", 2);

const ws = new WebSocket(page0.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
const netHits = [];      // 全部 API 回包（含 4xx/5xx，⛔ 不筛掉失败——只记失败会被读成"没有请求"）
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Network.responseReceived") {
    const u = m.params.response.url;
    if (new RegExp(`127\\.0\\.0\\.1:(${PORTS})`).test(u)) netHits.push(`${m.params.response.status} ${m.params.response.mimeType ?? ""} ${u.slice(0, 160)}`);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    consoleErrors.push((m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  }
  if (m.method === "Runtime.exceptionThrown") {
    consoleErrors.push("PAGEERROR " + String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").slice(0, 300));
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("evaluate 异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
  return name;
};

await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");

const waitFor = async (expr, label, tries) => {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(expr).catch(() => null)) return true;
    await sleep(1000);
  }
  // 现场 dump：报"没等到"之前先给屏上真实内容（否则「没等到」与「量法坏了」不可区分）
  const dump = await evalJs(`({ href: location.href, readyState: document.readyState, text: document.body ? document.body.innerText.slice(0, 300) : '(no body)' })`).catch((e) => ({ err: String(e).slice(0, 200) }));
  console.log(`⛔ 等待超时: ${label}（${tries}s）· 现场: ${JSON.stringify(dump)}`);
  return false;
};

console.log("== ① 登录（从登录页走起） ==");
await send("Page.navigate", { url: BASE + "/" });
// 本机负载高时冷启动可达 30s+（实测 12s 未起、30s 起），等待放宽到 180s
if (!(await waitFor(`!!document.querySelector('#login-username')`, "登录表单", 180))) bail("登录表单未出现", 3);
await evalJs(`(() => {
  const set = (sel, val) => { const el = document.querySelector(sel);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#login-tenant', 'demo'); set('#login-username', 'admin'); set('#login-password', 'demo1234');
  document.querySelector('button[type="submit"]').click(); return true; })()`);
let ok = false;
for (let i = 0; i < 180; i++) {
  if (await evalJs(`!!document.querySelector('[data-testid="home-page"]')`).catch(() => null)) { ok = true; break; }
  // 登录页可能报错（如 toast）——把现场带出来
  const err = await evalJs(`(document.querySelector('[class*="toast"],[class*="error"]') ?? { innerText: '' }).innerText`).catch(() => "");
  if (err && i % 15 === 14) console.log("  登录中…现场提示:", String(err).slice(0, 200));
  await sleep(1000);
}
if (!ok) bail("登录后未落首页", 3);
const landingUrl = await evalJs("location.href");
console.log("登录落点:", landingUrl, "| 真实后端回包:", netHits.length, "条");

// 金丝雀 · 量法活着：查询组件挂载证明（ShellLayout 在所有 /v/ 路径常驻）
await waitFor(`!!(document.querySelector('[data-testid="query-dock-bar"]') || document.querySelector('[data-testid="query-dock-panel"]'))`, "提问条挂载", 60);
const dockCanary = await evalJs(`(() => ({
  dockBar: !!document.querySelector('[data-testid="query-dock-bar"]'),
  dockPanel: !!document.querySelector('[data-testid="query-dock-panel"]'),
  home: !!document.querySelector('[data-testid="home-page"]'),
}))()`);
console.log("金丝雀(dock):", JSON.stringify(dockCanary));
if (!dockCanary.dockBar && !dockCanary.dockPanel) bail("提问条不在屏上（金丝雀未中 ⇒ 量法坏了，不报'没有'）", 4);

await shot("00-login-landing.png");

const results = [];
for (const q of QUERIES) {
  console.log(`\n== ② ${q.id} 输入：${q.text} ==`);
  // 条/面板两种形态都可能：先条后面板（首次提交后面板常驻）
  const before = await evalJs(`document.querySelectorAll('[data-testid^="task-run-"]').length`);
  const typed = await evalJs(`(() => {
    const el = document.querySelector('[data-testid="query-dock-bar"] input') ?? document.querySelector('[data-testid="query-dock-panel"] input');
    if (!el) return { ok: false, reason: 'input 不在' };
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(q.text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, mode: el.closest('[data-testid="query-dock-panel"]') ? 'panel' : 'bar', value: el.value };
  })()`);
  console.log("  输入框:", JSON.stringify(typed));
  if (!typed?.ok) { results.push({ ...q, submitError: "input 不在屏上" }); continue; }
  // 真键盘 Enter（CDP 可信事件）
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(1500);
  let after = await evalJs(`document.querySelectorAll('[data-testid^="task-run-"]').length`);
  if (after <= before) {
    console.log("  ⚠ 真 Enter 未起任务 → 落回合成 KeyboardEvent 再试一次");
    await evalJs(`(() => {
      const el = document.querySelector('[data-testid="query-dock-bar"] input') ?? document.querySelector('[data-testid="query-dock-panel"] input');
      if (!el) return null;
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(q.text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      return el.value; })()`);
    await sleep(1500);
    after = await evalJs(`document.querySelectorAll('[data-testid^="task-run-"]').length`);
  }
  // 等新 task-run 出现并取 taskId
  let taskId = null;
  for (let i = 0; i < 60 && !taskId; i++) {
    taskId = await evalJs(`(() => { const els = document.querySelectorAll('[data-testid^="task-run-"]'); const last = els[els.length - 1]; return last ? last.getAttribute('data-testid').replace('task-run-','') : null; })()`);
    if (!taskId || after <= before) { taskId = null; await sleep(1000); }
  }
  if (!taskId) { console.log("  ⛔ 提交后 30s 未出现 task-run（提交没走出去）"); results.push({ ...q, submitError: "no task-run after submit" }); await shot(`${q.id}-nosubmit.png`); continue; }
  console.log("  taskId:", taskId);
  const sel = `[data-testid="task-run-${taskId}"]`;

  // 等终态：答案卡 / 失败块（屏上真实出现才算），最长 MAX_WAIT_MS
  const t0 = Date.now();
  let terminal = null;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    const st = await evalJs(`(() => {
      const root = document.querySelector(${JSON.stringify(sel)});
      if (!root) return { root: false };
      const ans = root.querySelector('[data-testid="answer-card"]');
      const fail = root.querySelector('[data-testid="task-failed"]');
      const running = root.querySelector('[data-testid="still-running"]');
      return { root: true, answer: !!ans, fail: fail ? fail.innerText : null, running: !!running,
               steps: root.querySelectorAll('[data-testid^="step-"]').length,
               thinks: root.querySelectorAll('[data-testid="think-row"]').length };
    })()`);
    if (!st.root) { terminal = "root-gone"; break; }
    if (st.answer) { terminal = "answer"; break; }
    if (st.fail) { terminal = "failed"; break; }
    const el = Math.round((Date.now() - t0) / 1000);
    if (el % 30 < 4) console.log(`  … ${el}s（steps=${st.steps} thinks=${st.thinks} running=${st.running}）`);
    await sleep(3000);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`  终态: ${terminal} · ${elapsed}s`);
  await sleep(2500); // 让末帧渲染完
  await shot(`${q.id}-${terminal}.png`);

  // 读屏（全部原始读数）
  const screen = await evalJs(`(() => {
    const root = document.querySelector(${JSON.stringify(sel)});
    const panel = document.querySelector('[data-testid="query-dock-panel"]');
    const q = (s, r = root) => r ? r.querySelectorAll(s).length : null;
    const ans = root ? root.querySelector('[data-testid="answer-card"]') : null;
    const txt = (n) => n ? n.innerText : null;
    const canaryAll = document.querySelectorAll('[data-testid]').length;
    return {
      url: location.href,
      taskId: ${JSON.stringify(taskId)},
      // 金丝雀（已知必中）：本屏 data-testid 元素总数 + 本任务根存在
      canary: { testidElements: canaryAll, taskRoot: !!root },
      thinkRow: q('[data-testid="think-row"]'),
      thinkToggle: q('[data-testid="think-toggle"]'),
      thinkSummary: q('[data-testid="think-summary"]'),
      thinkBody: q('[data-testid="think-body"]'),
      narration: q('[data-testid="agent-narration"]'),
      narrationIteration: q('[data-testid="narration-iteration"]'),
      roleTracks: q('[data-testid^="role-track-"]'),
      steps: q('[data-testid^="step-"]'),
      stepIteration: q('[data-testid^="step-iteration-"]'),
      routingBadge: txt(root ? root.querySelector('[data-testid="routing-badge"]') : null),
      trustBadge: txt(ans ? ans.querySelector('[data-testid="trust-badge"]') : null),
      reasoningMode: txt(ans ? ans.querySelector('[data-testid="answer-reasoning-mode"]') : null),
      unverifiedStrip: txt(ans ? ans.querySelector('[data-testid="unverified-strip"]') : null),
      taskFailed: txt(root ? root.querySelector('[data-testid="task-failed"]') : null),
      taskInterrupted: txt(root ? root.querySelector('[data-testid="task-interrupted"]') : null),
      answerText: txt(ans),
      taskRootText: txt(root),
      panelText: txt(panel),
      // 思考段屏上原文（折叠态 summary 亦算"出现"）
      thinkSummaries: root ? [...root.querySelectorAll('[data-testid="think-summary"]')].map((e) => e.innerText).slice(0, 10) : [],
      narrations: root ? [...root.querySelectorAll('[data-testid="agent-narration"]')].map((e) => e.innerText.slice(0, 400)).slice(0, 12) : [],
    };
  })()`);
  results.push({ ...q, taskId, terminal, elapsedS: elapsed, screen });
  // 每完成一条立刻落盘（铁律 1：别攒）
  writeFileSync(path.join(OUT, "taskids.json"), JSON.stringify(results.map((r) => ({ id: r.id, kind: r.kind, text: r.text, taskId: r.taskId, terminal: r.terminal, elapsedS: r.elapsedS, submitError: r.submitError ?? null })), null, 2));
  writeFileSync(path.join(OUT, `${q.id}-screen.json`), JSON.stringify(screen, null, 2));
  console.log(`  屏上：think-row=${screen.thinkRow} narration=${screen.narration} steps=${screen.steps} 答案卡=${screen.answerText ? "有" : "无"}（${(screen.answerText ?? "").length} 字）`);
}

writeFileSync(path.join(OUT, "net-hits.txt"), netHits.join("\n") + "\n");
writeFileSync(path.join(OUT, "console-errors.txt"), (consoleErrors.join("\n") || "(none)") + "\n");
writeFileSync(path.join(OUT, "run-summary.json"), JSON.stringify({
  base: BASE, landingUrl, realBackendHits: netHits.length, dockCanary,
  queries: results.map((r) => ({ id: r.id, kind: r.kind, text: r.text, taskId: r.taskId, terminal: r.terminal, elapsedS: r.elapsedS, submitError: r.submitError ?? null })),
  consoleErrors,
}, null, 2));
console.log("\n== ③ 收尾 ===");
console.log("真实后端回包:", netHits.length, "条；console 错误:", consoleErrors.length, "条");
console.log("产物:", OUT);
ws.close(); chrome.kill();
process.exit(0);
