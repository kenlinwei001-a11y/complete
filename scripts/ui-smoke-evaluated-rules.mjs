#!/usr/bin/env node
/**
 * 门B · 规则即引用 P2（PRD-rules-as-references §8-#2）真浏览器 + 真后端：项目推演（project-sim）
 * → capacity_forecast 经 QOS/OBO 真跑 → 「规则闸门」面板显**真评估** PASS/WARN/BLOCK（C03/C09…），
 * ruleSetVersion 可见。治"关联规则只装饰不评估"。无 chromium → SKIP(exit 0)；断言失败 → exit 1。
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
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) { console.log(`⊘ evaluated-rules-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`); process.exit(0); }

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);
  await p.evaluate(() => { window.history.pushState({}, "", "/v/project-sim"); window.dispatchEvent(new PopStateEvent("popstate")); });
  // 默认整单 4680-NCM 首次重算完成 → 六步 stepper；跳到 ⑥结论步（规则闸门面板挂此）。
  await p.waitForSelector("[data-testid=pm-stepper]", { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.locator("[data-testid=pm-step-chip-6]").click({ force: true }).catch(() => {});
  await p.waitForSelector("[data-testid=evaluated-rules]", { timeout: 20000 });
  await p.waitForTimeout(500);

  const rows = p.locator('[data-testid^="evalrule-outcome-"]');
  const n = await rows.count();
  if (n === 0) fail("规则闸门面板无规则行");
  else {
    const panelText = (await p.locator("[data-testid=evaluated-rules]").innerText()).replace(/\s+/g, " ").trim();
    console.log("  规则闸门面板:", panelText.slice(0, 200));
    if (!/规则集 rsv_/.test(panelText)) fail("无 ruleSetVersion");
    // 至少含一个真评估结果（通过/预警/拦截），非全"未找到定义"
    const outcomes = [];
    for (let i = 0; i < n; i++) outcomes.push((await rows.nth(i).innerText()).trim());
    console.log("  评估结果:", outcomes.join(" / "));
    if (!outcomes.some((o) => ["通过", "预警", "拦截"].includes(o))) fail("无任何真评估结果（PASS/WARN/BLOCK）");
    const body = await p.locator("body").innerText();
    if (/未找到定义|没有找到定义/.test(body)) fail("页面仍出现'未找到定义'");
  }
} catch (e) {
  fail(`异常：${String(e).slice(0, 200)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ evaluated-rules-smoke 未通过。"); process.exit(1); }
console.log("\n✓ evaluated-rules-smoke：项目推演规则闸门显真评估（PASS/WARN/BLOCK）+ ruleSetVersion，真后端真浏览器。");
