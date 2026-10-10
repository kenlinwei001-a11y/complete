// WO-CONSOLE-MODULE-DELTA · 「统一推演控制台」逐模块屏上差分探针（真浏览器 · 真后端）
// ══════════════════════════════════════════════════════════════════════════════
// 仓主 2026-10-05 令（原文）：
//   「"统一推演控制台"，你测试一次，输入一个扰动因素…你测试一下每个推演环节是什么，
//     是否有异常或降级，前端每个模块的内容是否发生变化，变化的逻辑是否与推演结果保持一致」
//
// 本探针答的就是这一句，判据是**屏上可见文本**（`innerText`，不是 `textContent`）：
//   · 页签用 `hidden={tab !== k}` 切（`Console0828.tsx:2587` 等，注释 2582 明令不许改成条件渲染）
//     ⇒ 隐藏的 pane `innerText` 为空 ⇒ **必须先点开那个页签再读**，否则读到的是「没变」的假象。
//   · 每个模块前/后各 dump 一次，逐字节比。
//
// ⛔ 纪律：每一步读数前先证元素真的在（`waitForFunction` 有界等待），
//    不许 `waitForTimeout` + `count()` 的组合（本仓该形态已累计修 9 处，见 e2e-realbackend.mjs）。
//
// 用法：
//   FRONT=http://127.0.0.1:5273 CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node docs/evidence/WO-CONSOLE-MODULE-DELTA-probe.mjs > /tmp/screen.txt 2>&1
//   echo "CAPTURED_RC=$?" > /tmp/screen.rc
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5273";
const CHROME = process.env.CHROME;
const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "demo1234";
const LONG = Number(process.env.BOUND_MS ?? 120000); // 有界等待上界

const TABS = ["board", "options", "scan", "cust", "money", "log"];
const MODULES = [
  ["结论格", "c0828-verdict"],
  ["左栏·实体计数", "c0828-entity-counts"],
  ["左栏·已添加", "c0828-staged"],
  ["左栏·空态", "c0828-staged-empty"],
  ["组标·基础数据现状", "c0828-base-status"],
  ["组标·本次推演结果", "c0828-result-status"],
  ["对策看板·基线注", "c0828-board-baseline-note"],
  ["推演助手", "c0828-ai"],
];

const say = (m) => console.log(m);
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

/** 读一个 testid 的**屏上可见**文本（隐藏元素 → ""）。元素不在 → 记 `<缺席>`。 */
async function dump(sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(`[data-testid="${s}"]`);
    if (!el) return "<缺席>";
    const t = el.innerText ?? "";
    return t;
  }, sel);
}

/** 逐个页签点开 → 读该 pane。⛔ 不点开读到的是空串，会被误读成「没变」。 */
async function dumpPanes() {
  const out = {};
  for (const k of TABS) {
    const btn = `[data-testid="c0828-tab-${k}"]`;
    const has = await page.locator(btn).count();
    if (has === 0) { out[k] = "<页签缺席>"; continue; }
    await page.locator(btn).first().click().catch(() => {});
    // 判据：点完之后这个 pane 必须真的可见（`hidden` 撤掉）
    await page
      .waitForFunction(
        (kk) => {
          const p = document.querySelector(`[data-testid="c0828-pane-${kk}"]`);
          return p && p.offsetParent !== null;
        },
        k,
        { timeout: 15000 },
      )
      .catch(() => {});
    out[k] = await dump(`c0828-pane-${k}`);
  }
  return out;
}

async function snapshot() {
  const mods = {};
  for (const [label, id] of MODULES) mods[label] = await dump(id);
  mods.__panes = await dumpPanes();
  return mods;
}

const out = [];
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  say(`登录后 URL = ${page.url()}`);

  // ⚠ 本页**不许用 `networkidle`**：控制台自带轮询/异步 mutation，网络永不 idle ⇒ goto 恒超时
  //   （实测 2026-10-05：30s 超时，探针还没读到任何东西就退出）。改 `domcontentloaded` + 有界等元素。
  await page.goto(`${FRONT}/v/sim-unified`, { waitUntil: "domcontentloaded" });
  const railOk = await page
    .waitForFunction(() => !!document.querySelector("[data-testid=c0828-rail]"), null, { timeout: LONG })
    .then(() => true).catch(() => false);
  say(`控制台挂载 c0828-rail 在位 = ${railOk}`);
  if (!railOk) throw new Error("控制台没挂上 —— 先核挂载，别核内容");

  // 等「可继续添加」目录异步到（它来自 BUSINESS_EVENTS，静态；但 rail 首帧可能还没有）
  await page.waitForFunction(() => document.querySelectorAll("[data-testid^=c0828-ev-]").length > 0, null, { timeout: LONG }).catch(() => {});
  const evCount = await page.locator("[data-testid^=c0828-ev-]").count();
  say(`可添加事件数 = ${evCount}`);
  if (evCount === 0) throw new Error("目录为空 —— 没扰动可输入，本探针什么都验不了");

  const before = await snapshot();
  say("\n════════ A · 输入扰动**之前** ════════");
  for (const [k, v] of Object.entries(before)) {
    if (k === "__panes") continue;
    say(`  [${k}] ${norm(v).slice(0, 160)}`);
  }
  for (const [k, v] of Object.entries(before.__panes)) say(`  [pane ${k}] ${norm(v).slice(0, 160)}`);

  // ── 输入一个扰动：点第一个目录事件 → 展开表单 → 点「添加」───────────────
  const evId = await page.locator("[data-testid^=c0828-ev-]").first().getAttribute("data-testid");
  const id = evId.replace("c0828-ev-", "");
  say(`\n选取扰动事件 id = ${id}`);
  await page.locator(`[data-testid="c0828-ev-${id}"]`).first().click().catch(() => {});
  await page.waitForFunction((i) => !!document.querySelector(`[data-testid="c0828-add-${i}"]`), id, { timeout: 20000 }).catch(() => {});
  await page.locator(`[data-testid="c0828-add-${id}"]`).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const staged = await dump("c0828-staged");
  say(`已添加 chips = ${norm(staged).slice(0, 200)}`);

  const goOk = await page.locator("[data-testid=c0828-go]").count();
  say(`开始推演按钮在位 = ${goOk > 0}`);
  const t0 = Date.now();
  await page.locator("[data-testid=c0828-go]").first().click().catch(() => {});

  // ── 等推演真的出结果：入口是「结论格有字」─────────────────────────────
  // ⛔ 不许固定 sleep：推演是异步 mutation，快慢都合法。
  const done = await page
    .waitForFunction(
      () => {
        const v = document.querySelector("[data-testid=c0828-verdict]");
        return !!v && (v.innerText ?? "").trim().length > 0;
      },
      null,
      { timeout: LONG },
    )
    .then(() => true).catch(() => false);
  say(`推演完成（结论格非空）= ${done} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const after = await snapshot();
  say("\n════════ B · 输入扰动**之后** ════════");
  for (const [k, v] of Object.entries(after)) {
    if (k === "__panes") continue;
    say(`  [${k}] ${norm(v).slice(0, 160)}`);
  }
  for (const [k, v] of Object.entries(after.__panes)) say(`  [pane ${k}] ${norm(v).slice(0, 160)}`);

  say("\n════════ C · 逐模块差分（前 vs 后）════════");
  let changed = 0, total = 0;
  const rows = [];
  for (const k of Object.keys(before)) {
    if (k === "__panes") continue;
    total++;
    const same = norm(before[k]) === norm(after[k]);
    if (!same) changed++;
    rows.push([`模块·${k}`, same ? "未变" : "**已变**",
      same ? norm(before[k]).slice(0, 90) : `前=${norm(before[k]).slice(0, 70)} ⟶ 后=${norm(after[k]).slice(0, 70)}`]);
  }
  for (const k of Object.keys(before.__panes)) {
    total++;
    const same = norm(before.__panes[k]) === norm(after.__panes[k]);
    if (!same) changed++;
    rows.push([`页签·${k}`, same ? "未变" : "**已变**",
      same ? norm(before.__panes[k]).slice(0, 90) : `前=${norm(before.__panes[k]).slice(0, 70)} ⟶ 后=${norm(after.__panes[k]).slice(0, 70)}`]);
  }
  for (const [a, b, c] of rows) say(`  ${a.padEnd(22)} ${b.padEnd(8)} ${c}`);
  say(`\n⇒ ${changed}/${total} 个模块在「输入扰动 + 推演」后屏上文本改变`);

  out.push({ evId: id, done, changed, total, rows });
} catch (e) {
  say(`\n❌ 探针异常：${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 3;
} finally {
  await browser.close();
}
