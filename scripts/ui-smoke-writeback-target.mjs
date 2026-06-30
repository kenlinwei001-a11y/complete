#!/usr/bin/env node
/**
 * WO-ACTUATE 门B · 写回目标徽标真浏览器验收。
 * 连真 datacore（默认 4051·内存 SEED_DEMO=1·已有一条 EXECUTED 的 MOCK 写回 Action）。
 * 流程：admin 登录 → /admin/actions → 状态筛选 EXECUTED → 点首行 → Action 详情见
 *   「写回目标：MOCK（确定性·非真 ERP）」徽标（data-testid=writeback-target-MOCK）→ 截图。
 * 无 chromium/playwright-core → SKIP(exit 0)；断言失败 → exit 1。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5211;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOT = process.env.SHOT || "docs/evidence/WO-ACTUATE-writeback-badge.png";
const require = createRequire(import.meta.url);

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  for (const root of ["/opt/pw-browsers", "/root/.cache/ms-playwright", `${process.env.HOME}/.cache/ms-playwright`]) {
    for (const sub of ["chromium-1194/chrome-linux/chrome", "chromium-1148/chrome-linux/chrome", "chromium/chrome-linux/chrome"]) {
      if (existsSync(`${root}/${sub}`)) return `${root}/${sub}`;
    }
  }
  return null;
}
function loadChromiumApi() {
  for (const spec of ["playwright-core"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ writeback-target-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // SPA 导航到 /admin/actions（pushState+popstate，保内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/admin/actions"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForTimeout(1500);

  // 状态筛选切 EXECUTED。
  await p.selectOption("select[aria-label=状态筛选]", "EXECUTED").catch(() => {});
  await p.waitForTimeout(1500);

  const rows = await p.locator("[data-testid^=draft-]").count();
  if (rows === 0) fail("EXECUTED 列表无行（需先建一条 MOCK 写回 Action）");
  else {
    console.log(`  EXECUTED Action 行数: ${rows}`);
    await p.locator("[data-testid^=draft-]").first().click();
    await p.waitForTimeout(800);
    const badge = p.locator("[data-testid=writeback-target-MOCK]");
    if ((await badge.count()) === 0) fail("「写回目标 MOCK」徽标缺失");
    else console.log(`  徽标文本: ${(await badge.innerText()).trim()}`);
  }

  await p.screenshot({ path: SHOT, fullPage: false });
  console.log(`  截图: ${SHOT}`);
} catch (e) {
  fail(`异常：${String(e).slice(0, 300)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ writeback-target-smoke 未通过。"); process.exit(1); }
console.log("\n✓ writeback-target-smoke：Action 详情「写回目标 MOCK（确定性·非真 ERP）」徽标真浏览器可见（真后端）。");
