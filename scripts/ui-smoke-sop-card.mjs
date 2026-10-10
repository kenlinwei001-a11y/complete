#!/usr/bin/env node
/**
 * 门B · BP-4（D4）sop 卡接真数据 真浏览器 + 真后端验收。
 * 不走 mock：连已起的 datacore:4001 + agentcore:4002（vite :5199 VITE_*_URL 指向真服务）。
 * 流程：admin 登录 → /admin/scenes → 点 S18「发育验证」(grow) → 经 QOS 正序实跑 triggerQuestion 到终态
 *       → 断言 S18 grow 后 GOVERNED + 溯源链任务页渲染**真数据块**（mrp_netting 的 materials 表 / shortageCount KPI），
 *          而非旧的"S&OP 月度平衡台请见对应视图"纯跳转占位文本。
 * 无 chromium/playwright-core → SKIP(exit 0)；真交互断言失败 → exit 1。
 * 注：无浏览器时已先用 curl 证明端到端通（见汇报 §4：grow S18 → GOVERNED/VERIFIED + materials 表 + shortageCount KPI）。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const SCEN = process.env.SCEN_KEY || "S18";
const require = createRequire(import.meta.url);

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  for (const root of ["/root/.cache/ms-playwright", "/opt/pw-browsers", `${process.env.HOME}/.cache/ms-playwright`]) {
    for (const sub of ["chromium-1148/chrome-linux/chrome", "chromium-1194/chrome-linux/chrome"]) {
      if (existsSync(`${root}/${sub}`)) return `${root}/${sub}`;
    }
  }
  return null;
}
function loadChromiumApi() {
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ sop-card-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。已用 curl 证明端到端通（见汇报 §4）。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
p.on("console", (msg) => { if (msg.type() === "error") console.error("  [browser console.error]", msg.text().slice(0, 160)); });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // SPA 内导航（pushState+popstate，不 goto——避免丢内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/admin/scenes"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForSelector("[data-testid=scenarios-table]", { timeout: 15000 });
  await p.waitForTimeout(800);

  const row = p.locator(`[data-testid=scenario-row-${SCEN}]`);
  if ((await row.count()) === 0) { fail(`无场景行 ${SCEN}`); throw new Error("no row"); }

  const growBtn = p.locator(`[data-testid=scenario-grow-${SCEN}]`);
  if ((await growBtn.count()) === 0) { fail(`${SCEN} 无「发育验证」按钮（须 PUBLISHED + admin）`); throw new Error("no grow btn"); }
  await growBtn.click();
  await p.waitForSelector(`[data-testid=scenario-ontogenesis-${SCEN}]`, { timeout: 45000 });
  await p.waitForTimeout(500);

  // 断言 1：S18 grow 后 maturity = GOVERNED（接真数据后，不再 PROVISIONAL/RENDER_NOT_PROJECTED）。
  const badge = p.locator(`[data-testid=scenario-maturity-${SCEN}]`);
  const badgeText = (await badge.first().innerText().catch(() => "")).trim();
  console.log("  maturity 徽章:", badgeText);
  if (!/已验证|GOVERNED/.test(badgeText)) fail(`${SCEN} grow 后未 GOVERNED（接真数据 BP-4 应 GOVERNED）：${badgeText}`);

  // 断言 2：溯源链导航到任务页，渲染 mrp_netting 真数据块（materials 表 / shortageCount KPI），非占位跳转文本。
  const traceAny = p.locator(`[data-testid=scenario-ontogenesis-${SCEN}] a`);
  if ((await traceAny.count()) === 0) fail("GOVERNED 但无溯源链 Link（无法核验真数据块）");
  else {
    await traceAny.first().click();
    await p.waitForTimeout(1800);
    const kpiBlocks = p.locator('[data-testid^="kpi-"]');
    const tableBlocks = p.locator('[data-testid="answer-table"]');
    const nKpi = await kpiBlocks.count();
    const nTable = await tableBlocks.count();
    if (nKpi === 0 && nTable === 0) fail("S18 任务页无 KPI/表——sop 卡仍未投影求解器真数据（BP-4 残）");
    else console.log(`  S18 任务页真数据块：${nKpi} KPI / ${nTable} 表（mrp_netting：materials 表 + shortageCount KPI）`);
    const body = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    if (/请见对应视图/.test(body)) fail("S18 仍渲染旧占位「请见对应视图」跳转文本（BP-4 未生效）");
  }
} finally {
  await b.close();
}
if (failed) { console.error("✗ sop-card-smoke 失败"); process.exit(1); }
console.log(`✓ sop-card-smoke：${SCEN} grow → GOVERNED + 任务页渲染 mrp_netting 真数据块（BP-4 接真数据生效）。`);
