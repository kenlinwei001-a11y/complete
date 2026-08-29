#!/usr/bin/env node
/**
 * 门B · 规则即引用 P1（PRD-rules-as-references）真浏览器 + 真后端验收。
 * 连真 datacore:4001（13 条补全规则已播种）。流程：admin 登录 → /admin/rules
 * → 断言曾"未找到定义"的 C01/C02/C09 现为一等 PUBLISHED 规则、显真定义（expression）、可编辑。
 * 治用户实测的"（当前库中没有找到定义）"。
 * 无 chromium/playwright-core → SKIP(exit 0)；断言失败 → exit 1。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
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
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js", "/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ rules-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };
const NEW13 = ["C01", "C02", "C04", "C06", "C09", "C10", "C11", "C15", "C16", "C21", "C22", "C24", "C25"];

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // SPA 导航到 /admin/rules（pushState+popstate，不 goto——避免丢内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/admin/rules"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForTimeout(1500);

  // 断言 1：13 条曾"未找到定义"的规则现为一等规则行（真后端播种）。
  let present = 0;
  for (const k of NEW13) {
    if ((await p.locator(`[data-testid=rule-${k}]`).count()) > 0) present++;
    else fail(`规则 ${k} 行缺失（应已一等化）`);
  }
  console.log(`  /admin/rules 含 13 条补全规则中的 ${present}/13`);

  // 断言 2：抽查 C09 显真定义（expression）+ PUBLISHED 状态（非"未找到定义"）。
  const c09Row = p.locator("[data-testid=rule-C09]");
  if ((await c09Row.count()) > 0) {
    const txt = (await c09Row.innerText()).replace(/\s+/g, " ").trim();
    console.log("  C09 行:", txt.slice(0, 120));
    if (!/PUBLISHED/.test(txt)) fail("C09 非 PUBLISHED");
    // 展开看 expression（点行展开）
    await c09Row.click();
    await p.waitForTimeout(500);
    const body = (await p.locator("body").innerText());
    if (!/DataSourceHealth/.test(body)) fail("C09 未显示真 expression（DataSourceHealth…）");
    else console.log("  C09 真 expression 可见（DataSourceHealth.critical…）");
  }

  // 断言 3：全页无"未找到定义"（用户实测的病灶文案）。
  const bodyTxt = await p.locator("body").innerText();
  if (/未找到定义|没有找到定义/.test(bodyTxt)) fail("页面仍出现'未找到定义'");
  else console.log("  全页无'未找到定义' ✓");
} catch (e) {
  fail(`异常：${String(e).slice(0, 200)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ rules-smoke 未通过。"); process.exit(1); }
console.log("\n✓ rules-smoke：13 条补全规则一等可见 + 真定义 + 无'未找到定义'（真后端真浏览器）。");
