// E2E 实测「统一推演控制台」— 真后端(4001) + 真前端(5173) + 系统 Chrome。
// 纪律：卡住/mock/降级一律记录，不绕行；findings 即写即落盘；网络全量留证。
import { chromium } from "playwright-core";
import fs from "node:fs";

const EV = "/tmp/wo-console-e2e/evidence";
fs.mkdirSync(EV, { recursive: true });
const F = `${EV}/findings.md`;
const NET = `${EV}/network.log`;
const note = (s) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`;
  fs.appendFileSync(F, line + "\n");
  console.log(line);
};
const net = (s) => fs.appendFileSync(NET, s + "\n");

fs.writeFileSync(F, `# 统一推演控制台 E2E 实测 findings（真后端 SEED_DEMO=1 @4001 · vite preview @5173 · 合并树 dist）\n\n`);
fs.writeFileSync(NET, "");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// ── 网络全量留证 ──
let apiCount = 0;
let tickSeq = 0;
let worldSeq = 0;
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("127.0.0.1:4001")) return;
  apiCount++;
  const timing = res.request().timing();
  net(`${res.request().method()} ${u} → ${res.status()} ${Math.round(timing.responseEnd ?? -1)}ms`);
  try {
    if (u.includes("/tick")) {
      tickSeq++;
      fs.writeFileSync(`${EV}/tick-response-${tickSeq}.json`, JSON.stringify(await res.json(), null, 1));
    } else if (u.match(/\/world(\?|$)/)) {
      worldSeq++;
      fs.writeFileSync(`${EV}/world-${worldSeq}.json`, JSON.stringify(await res.json()));
    } else if (u.includes("/perturbations")) {
      fs.writeFileSync(`${EV}/perturbations-latest.json`, JSON.stringify(await res.json(), null, 1));
    }
  } catch { /* 非 JSON 或竞态，网络行已留 */ }
});
page.on("requestfailed", (req) => note(`⚠ requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
page.on("response", (res) => { if (res.status() >= 400 && !res.url().includes("127.0.0.1:4001")) note(`⚠ HTTP ${res.status()}: ${res.request().method()} ${res.url()}`); });
page.on("console", (m) => { if (m.type() === "error") note(`⚠ 浏览器 console.error: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => note(`⚠ pageerror: ${String(e).slice(0, 300)}`));

const snap = (name) => page.screenshot({ path: `${EV}/${name}.png`, fullPage: true });
const dom = (name) => page.content().then((c) => fs.writeFileSync(`${EV}/${name}.html`, c));
const probe = async (testid) => (await page.getByTestId(testid).count()) > 0;
const probeAll = async (ids, label) => {
  const hits = [];
  for (const id of ids) if (await probe(id)) hits.push(id);
  note(`${label}：命中 ${hits.length === 0 ? "无" : hits.join(" · ")}`);
  return hits;
};
const step = async (name, fn) => {
  try { await fn(); } catch (e) {
    note(`🔴 步骤「${name}」异常：${String(e).slice(0, 300)}（不绕行，留 DOM 与截图后续查）`);
    await dom(`FAIL-${name.replaceAll(" ", "_")}`);
    await snap(`FAIL-${name.replaceAll(" ", "_")}`);
  }
};

// ══ 0 · 登录 ══
await step("0-登录", async () => {
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/login/, { timeout: 10000 });
  note("未登录访问根路径 ⇒ 被守卫送到 /login（符合预期）");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  note(`登录成功（demo/admin），落地 ${page.url()}`);
  await snap("01-after-login");
});

// ══ 1 · 到达控制台（先走左导航，找不到再深链，两种情况都记录）══
await step("1-到达控制台", async () => {
  await page.waitForTimeout(2500); // 等 workspace 下发与导航渲染
  const navItem = page.locator("nav, aside, [class*=nav], [class*=Nav]").getByText("统一推演控制台").first();
  const navFound = (await navItem.count()) > 0;
  if (navFound) {
    await navItem.click();
    note("左导航找到「统一推演控制台」并点击");
  } else {
    note("⚠ 左导航 2.5s 内未找到「统一推演控制台」入口文本 ⇒ 改走深链 /v/sim-unified（入口可见性另记）");
    await dom("01b-nav-missing");
    await page.goto("http://127.0.0.1:5173/v/sim-unified", { waitUntil: "domcontentloaded" });
  }
  await page.waitForSelector('[data-testid="c0828-root"], [data-testid="usim-shell"]', { timeout: 30000 });
  note(`控制台已渲染，URL=${page.url()}`);
  await snap("02-console-default");
});

// ══ 2 · 真后端自证 + mock 侦测 ══
await step("2-真后端自证", async () => {
  await page.waitForTimeout(3000);
  const sw = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    return regs.map((r) => r.active?.scriptURL ?? "?");
  });
  note(`service worker 注册：${sw.length === 0 ? "无（MSW mock 未激活）" : sw.join(" · ")}`);
  if (sw.some((s) => s.includes("mockServiceWorker"))) note("🔴 MSW mockServiceWorker 已注册 ⇒ 可能拦截请求用 mock！");
  note(`至此打到 :4001 真后端的请求数 = ${apiCount}（0 即前端没连真后端）`);
  const reason = await page.locator('[data-testid="c0828-scope-echo"], [data-testid="usim-session-reason"]').first().textContent().catch(() => "(读不到)");
  note(`会话出处行：${reason?.trim().slice(0, 120)}`);
});

// ══ 3 · 扰动目录全扫（哪些今天落得了地、哪些落了不地、为什么）══
const EVENTS = ["material-price-up", "batch-defect", "rush-order", "due-change", "order-cancel",
  "inbound-delay", "material-short", "equipment-down", "capacity-loss", "ship-to-change", "order-reprice"];
await step("3-扰动目录全扫", async () => {
  for (const ev of EVENTS) {
    const btn = page.getByTestId(`c0828-ev-${ev}`);
    if ((await btn.count()) === 0) { note(`⚠ 目录里没有 c0828-ev-${ev}（事件缺失或改名）`); continue; }
    const landable = await btn.getAttribute("data-landable");
    const hint = (await btn.textContent())?.replace(/\s+/g, " ").trim().slice(0, 100);
    note(`事件 ${ev}: landable=${landable} 「${hint}」`);
    if (landable !== "1") {
      await btn.click();
      await page.waitForTimeout(300);
      const why = await page.getByTestId(`c0828-absent-why-${ev}`).textContent().catch(() => null);
      if (why !== null) note(`  └ 落不了地的理由（屏上原文）：${why.replace(/\s+/g, " ").trim().slice(0, 200)}`);
    }
  }
  await snap("03-catalog-scan");
});

// ══ 4 · 施加多个扰动（三种不同 kind）══
const STAGE = [
  { ev: "material-price-up", mag: "20" },
  { ev: "inbound-delay", mag: "7" },
  { ev: "rush-order", mag: "30" },
  { ev: "equipment-down", mag: "2" },
];
const stagedNames = [];
await step("4-施加多扰动", async () => {
  for (const { ev, mag } of STAGE) {
    const btn = page.getByTestId(`c0828-ev-${ev}`);
    if ((await btn.count()) === 0 || (await btn.getAttribute("data-landable")) !== "1") {
      note(`⚠ ${ev} 落不了地，跳过施加（上一步已记录理由）`); continue;
    }
    await btn.click();
    const pick = page.getByTestId(`c0828-pick-${ev}`);
    await pick.waitFor({ timeout: 5000 });
    // 等落点选项真的从后端回来（fetchAllObjects）
    await page.waitForFunction(
      (tid) => document.querySelector(`[data-testid="${tid}"]`)?.options?.length > 1,
      `c0828-pick-${ev}`, { timeout: 90000 },
    );
    const options = await pick.locator("option").allTextContents();
    await pick.selectOption({ index: 1 });
    const chosen = options[1] ?? "?";
    const magInput = page.getByTestId(`c0828-mag-${ev}`);
    await magInput.fill(mag);
    await page.getByTestId(`c0828-add-${ev}`).click();
    await page.waitForTimeout(300);
    stagedNames.push(`${ev}→${chosen}(${mag})`);
    note(`已加入待施加：${ev} → 落点「${chosen}」幅度 ${mag}（候选 ${options.length - 1} 个）`);
  }
  const cnt = await page.getByTestId("c0828-staged-count").textContent().catch(() => "(无)");
  note(`待施加清单屏上回显：${cnt?.trim()}（本脚本加了 ${stagedNames.length} 件）`);
  const horizon = await page.getByTestId("c0828-horizon").inputValue();
  const echo = await page.getByTestId("c0828-horizon-echo").textContent().catch(() => "");
  note(`推演时长：${horizon}（屏上口径：${echo?.replace(/\s+/g, " ").trim().slice(0, 120)}）`);
  await snap("04-staged");
});

// ══ 5 · 开始推演（施扰→推拍→取世界→diff→求解器卡点，五步一次走完）══
await step("5-开始推演", async () => {
  const go = page.getByTestId("c0828-go");
  await go.waitFor({ timeout: 5000 });
  if (await go.isDisabled()) { note("🔴 「开始推演」按钮禁用 —— 卡住点，留证"); await dom("05-go-disabled"); return; }
  const t0 = Date.now();
  await go.click();
  note("已点「开始推演」…");
  // 结果判据：verdict 或 run-error 任一出现；running 消失
  const deadline = Date.now() + 600_000;
  let outcome = "timeout";
  while (Date.now() < deadline) {
    if (await probe("c0828-run-error")) { outcome = "run-error"; break; }
    if (await probe("c0828-verdict")) { outcome = "verdict"; break; }
    await page.waitForTimeout(1500);
  }
  const ms = Date.now() - t0;
  if (outcome === "verdict") {
    const v = await page.getByTestId("c0828-verdict").textContent();
    note(`✅ 推演完成，耗时 ${ms}ms。verdict：${v?.replace(/\s+/g, " ").trim().slice(0, 220)}`);
  } else if (outcome === "run-error") {
    const e = await page.getByTestId("c0828-run-error").textContent();
    note(`🔴 推演变成 run-error（${ms}ms）：${e?.replace(/\s+/g, " ").trim().slice(0, 300)} —— 卡住点，留证不绕行`);
    await dom("05-run-error");
  } else {
    note(`🔴 推演 600s 未出结果（既无 verdict 也无 run-error）—— 疑似卡死，留证不绕行`);
    await dom("05-stuck"); await snap("05-stuck");
  }
  await snap("05-after-run");
});

// ══ 6 · 逐环节验真：tick 披露 + 世界差 + 扰动落盘，三样对 API 真相 ══
await step("6-逐环节验真", async () => {
  const A = "http://127.0.0.1:4001/a/v1";
  const H = { headers: { "X-Debug-User": "demo:admin:admin" } };
  const sess = await (await page.request.get(`${A}/sim/sessions`, H)).json();
  const s = sess.items.find((x) => x.id === "sims_demo_seed_world") ?? sess.items[0];
  note(`API 侧会话：${s.id} status=${s.status} curTick=${s.curTick}`);
  // tick 披露（UI 那次 tick POST 的回包已被网络层存盘）
  const tickFiles = fs.readdirSync(EV).filter((f) => f.startsWith("tick-response-"));
  for (const tf of tickFiles) {
    const t = JSON.parse(fs.readFileSync(`${EV}/${tf}`, "utf8"));
    const d = t.disclosure ?? {};
    note(`${tf}: curTick=${t.curTick} 披露字段=[${Object.keys(d).join(",") || "无"}]` +
      (d.trace ? ` trace行数=${Array.isArray(d.trace) ? d.trace.length : "?"}` : "") +
      (d.totals ? ` totals=${JSON.stringify(d.totals).slice(0, 160)}` : ""));
  }
  // 扰动落盘数
  const per = await (await page.request.get(`${A}/sim/sessions/${s.id}/perturbations`, H)).json();
  note(`API 侧已施加扰动 ${per.items.length} 条（种子自带 1 条 + 本次 ${stagedNames.length} 条 ⇒ 期望 ${1 + stagedNames.length}）：` +
    per.items.map((p) => `${p.kind}@${p.targetObjectId} ${p.mode}${p.magnitude} startTick=${p.startTick}`).slice(0, 8).join(" | "));
  // 世界差（UI 抓到的 before/after 两份 world）
  const worlds = fs.readdirSync(EV).filter((f) => f.startsWith("world-")).sort();
  if (worlds.length >= 2) {
    const w0 = JSON.parse(fs.readFileSync(`${EV}/world-${worlds.length - 2}.json`, "utf8"));
    const w1 = JSON.parse(fs.readdirSync(EV).filter((f) => f.startsWith("world-")).sort().map((f) => f).at(-1) && fs.readFileSync(`${EV}/${worlds.at(-1)}`, "utf8"));
    const cells = (w) => Object.entries(w.state ?? {}).flatMap(([oid, vars]) => Object.entries(vars).map(([sv, v]) => [`${oid}.${sv}`, v]));
    const m0 = new Map(cells(w0)); const m1 = new Map(cells(w1));
    let changed = 0; const samples = [];
    for (const [k, v1] of m1) { const v0 = m0.get(k); if (v0 !== v1) { changed++; if (samples.length < 6) samples.push(`${k}: ${v0} → ${v1}`); } }
    note(`世界差（UI 取得的 before/after 两包现算）：${changed} 格变化。样例：${samples.join(" · ") || "无"}`);
    if (changed === 0) note("🔴 施了扰动推了拍而世界零格变化 —— 假推演嫌疑，留证");
  } else note(`⚠ 只抓到 ${worlds.length} 份 world 回包，无法现算世界差`);
});

// ══ 7 · 结果面板与降级面全扫 ══
await step("7-结果面板与降级面", async () => {
  await probeAll([
    "c0828-money", "c0828-cust", "c0828-board", "c0828-options", "c0828-exposure",
    "c0828-impediment", "c0828-imp-error", "c0828-agent-fallback", "c0828-agent-err",
    "c0828-agent-inapplicable", "c0828-agent-donothing", "c0828-graph-absent",
    "c0828-kpi-nospark", "c0828-board-missing-cols", "c0828-canary-broken",
    "c0828-restore-error", "c0828-restore-none", "c0828-watchonly", "c0828-honesty",
  ], "结果/降级面板 testid 扫描");
  for (const id of ["c0828-agent-fallback", "c0828-imp-error", "c0828-board-missing-cols", "c0828-canary-broken", "c0828-kpi-nospark"]) {
    if (await probe(id)) {
      const t = await page.getByTestId(id).textContent();
      note(`  └ ${id} 原文：${t?.replace(/\s+/g, " ").trim().slice(0, 220)}`);
    }
  }
  await snap("07-result-panels");
});

// ══ 8 · 专家模式：卡墙 / 检视 / 波及面 / 页签 ══
await step("8-专家模式", async () => {
  const expertBtn = page.getByTestId("c0828-expert");
  if ((await expertBtn.count()) === 0) { note("⚠ 找不到专家模式入口 c0828-expert"); return; }
  await expertBtn.click();
  await page.waitForSelector('[data-testid="usim-shell"][data-view="expert"]', { timeout: 15000 });
  note("已进入专家模式（8 档页签工作台）");
  await page.waitForTimeout(3000);
  await snap("08-expert");
  // 卡墙（卡片没有专用 testid 前缀 —— 数 wall 内可点按钮 + 截断/分组标记，先自证量法）
  const wallText = (await page.getByTestId("usim-wall").textContent().catch(() => "")) ?? "";
  const cardBtns = await page.locator('[data-testid="usim-wall"] button').count();
  const groups = await page.locator('[data-testid="usim-wall"] [data-testid^="usim-group"]').allTextContents();
  note(`指标卡墙：wall 内按钮数=${cardBtns}，分组=${groups.length}，截断标记=${await probe("usim-truncated")}，wall 文本 ${wallText.length} 字符`);
  // 状态条与出处
  for (const id of ["usim-status", "usim-origin", "usim-lifecycle"]) {
    const t = await page.getByTestId(id).textContent().catch(() => null);
    if (t !== null) note(`${id}：${t.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  // 选一张卡 → 检视 → 问波及面（卡 = wall 内第一个按钮）
  const firstCard = page.locator('[data-testid="usim-wall"] button').first();
  if ((await firstCard.count()) > 0) {
    await firstCard.click();
    await page.waitForTimeout(800);
    const ask = page.getByTestId("usim-impact-ask");
    if ((await ask.count()) > 0) {
      await ask.click();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (await probe("usim-impact-result")) break;
        if (await probe("usim-impact-error")) break;
        if (await probe("usim-impact-leaf")) break;
        await page.waitForTimeout(800);
      }
      for (const id of ["usim-impact-result", "usim-impact-buckets", "usim-impact-error", "usim-impact-leaf", "usim-impact-unresolved"]) {
        if (await probe(id)) note(`波及面 ${id}：${(await page.getByTestId(id).textContent())?.replace(/\s+/g, " ").trim().slice(0, 200)}`);
      }
    } else note("⚠ 右栏没有「看看改这一格会波及谁」按钮（卡无落点对象？）");
  }
  // 页签各点一次
  const tabs = await page.locator('[data-testid^="usim-tab-"]:not([data-testid^="usim-tab-group"])').all();
  for (const t of tabs) {
    const id = await t.getAttribute("data-testid");
    if (id?.includes("group")) continue;
    const disabled = await t.isDisabled();
    const label = (await t.textContent())?.trim();
    if (disabled) { note(`页签 ${label}：禁用`); continue; }
    await t.click();
    await page.waitForTimeout(2500);
    const panel = await page.getByTestId("usim-mode-panel").getAttribute("data-renderer").catch(() => "?");
    const unresolved = await probe("usim-mode-unresolved");
    note(`页签 ${label}：renderer=${panel}${unresolved ? " ⚠ 渲染器未注册（接线缺口）" : " 已挂载"}`);
  }
  await snap("08-expert-tabs");
});

// ══ 9 · 生命周期：暂停→世界冻结验证→恢复（放最后，免扰前面流程）══
await step("9-生命周期", async () => {
  const shell = await page.getByTestId("usim-shell").getAttribute("data-view").catch(() => null);
  if (shell !== "expert") { note("⚠ 不在专家模式，跳过生命周期实测"); return; }
  const pause = page.getByTestId("usim-status-paused");
  if ((await pause.count()) === 0) { note("⚠ 没有暂停按钮"); return; }
  await pause.click();
  await page.waitForTimeout(4000);
  const st = await page.getByTestId("usim-lifecycle").getAttribute("data-status");
  const logText = (await page.getByTestId("usim-log").textContent().catch(() => ""))?.slice(-300);
  const errText = await page.getByTestId("usim-status-error").textContent().catch(() => null);
  note(`按「暂停」后 lifecycle data-status=${st}；壳日志尾：${logText?.replace(/\s+/g, " ").trim()}${errText !== null ? `；迁移错误条：${errText.replace(/\s+/g, " ").trim().slice(0, 200)}` : ""}`);
  // 暂停态施扰应被 409 拒 —— 用 API 直接验（UI 上施扰表单在专家模式左栏 PerturbRail）
  const r = await page.request.post("http://127.0.0.1:4001/a/v1/sim/sessions/sims_demo_seed_world/tick", {
    headers: { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" },
    data: { n: 1 },
    timeout: 120000,
  });
  note(`暂停态下 POST tick ⇒ HTTP ${r.status()}${r.status() === 409 ? "（世界真的冻结，符合屏上说法）" : " ⚠ 不是 409，与屏上承诺不符"}`);
  const resume = page.getByTestId("usim-status-running");
  await resume.click();
  await page.waitForTimeout(4000);
  note(`按「恢复」后 lifecycle data-status=${await page.getByTestId("usim-lifecycle").getAttribute("data-status")}`);
});

note(`\n全程打到 :4001 真后端的请求总数 = ${apiCount}`);
note("═══ 脚本走完（各步异常已在上面逐条记录，未绕行）═══");
await browser.close();
process.exit(0);
