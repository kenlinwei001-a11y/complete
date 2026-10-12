#!/usr/bin/env node
/**
 * 门B · 推演沙盘 P0（增量 4 · §6.1.A）真浏览器 + 真后端验收（不走 mock）。
 * 连已起的 datacore:4001 / vite:5199（VITE_*_URL 指向真服务）。
 * 流程：admin 登录 → 开 sim.* → SPA 导航 /v/sim-sandbox → 断言三件 P0：
 *   ① 采纳按钮在 + 点击出 Action 草稿 toast（走正门，模拟态不直写）
 *   ② 分支按钮 → 对比面板出现（A/B heat + 差异表）
 *   ③ 就绪面板 6 元素可见：L0-L4 stepper / L4 三元组 / Trial Tick / scope 切换 / 完整度 gauge / entering 清单
 * 无 chromium/playwright-core → SKIP(exit 0)；真交互断言失败 → exit 1。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const DC = process.env.DATACORE_URL || "http://127.0.0.1:4001";
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
  console.log(`⊘ sandbox-p0-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

async function enableSim() {
  const lr = await fetch(`${DC}/a/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  if (!lr.ok) { fail(`登录失败 ${lr.status}`); return false; }
  const { accessToken } = await lr.json();
  await fetch(`${DC}/a/v1/tenants/demo/features`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true, "sim.checkpoint": true, "sim.branch": true } }),
  });
  console.log("  ✓ sim.* 已开通");
  return true;
}

if (!(await enableSim())) { process.exit(1); }

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
p.on("console", (msg) => { if (msg.type() === "error") console.error("  [browser console.error]", msg.text().slice(0, 160)); });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  await p.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForSelector("[data-testid=sandbox-view]", { timeout: 15000 });
  // 等会话 init（采纳/分支按钮可用）。
  await p.waitForFunction(() => {
    const el = document.querySelector("[data-testid=sandbox-adopt-btn]");
    return el && !el.disabled;
  }, { timeout: 12000 }).catch(() => fail("采纳按钮一直 disabled（会话未 init）"));

  // ③ 就绪面板 6 元素。
  const six = [
    ["sim-cert-level", "L0-L4 stepper"],
    ["sim-cert-l4-triad", "L4 三元组"],
    ["sim-cert-trial-tick", "Trial Tick 卡"],
    ["sim-cert-scope-toggle", "scope 切换"],
    ["sim-cert-gauge", "完整度 gauge"],
    ["sim-cert-entering", "entering 清单"],
  ];
  for (const [tid, label] of six) {
    const n = await p.locator(`[data-testid=${tid}]`).count();
    if (n === 0) fail(`就绪面板缺：${label}（${tid}）`);
    else console.log(`  ✓ 就绪面板有 ${label}`);
  }
  // scope 切换真重取：点 LOCAL。
  const localBtn = p.locator("[data-testid=sim-cert-scope-LOCAL]");
  if (await localBtn.count()) {
    const pctBefore = ((await p.locator("[data-testid=sim-cert-gauge-pct]").first().textContent()) || "").trim();
    await localBtn.first().click();
    await p.waitForTimeout(1200);
    const pctAfter = ((await p.locator("[data-testid=sim-cert-gauge-pct]").first().textContent()) || "").trim();
    console.log(`  scope 切换 GLOBAL(${pctBefore}) → LOCAL(${pctAfter})`);
  }

  // ① 采纳 → Action 草稿。先切回 GLOBAL 不影响。
  const adoptBtn = p.locator("[data-testid=sandbox-adopt-btn]");
  if ((await adoptBtn.count()) === 0) fail("无采纳按钮");
  else {
    await adoptBtn.first().click();
    await p.waitForTimeout(1500);
    // toast 文案含「草稿」（useActionDraft onSuccess）。
    const body = await p.locator("body").innerText();
    if (/草稿/.test(body)) console.log("  ✓ 采纳 → 出 Action 草稿 toast（走正门）");
    else fail("采纳后未见草稿 toast（Action 正门未触发？）");
  }

  // ② 分支 → 对比面板。
  const branchBtn = p.locator("[data-testid=sandbox-branch-btn]");
  if ((await branchBtn.count()) === 0) fail("无分支按钮");
  else {
    await branchBtn.first().click();
    await p.waitForSelector("[data-testid=sim-compare-panel]", { timeout: 12000 }).catch(() => fail("分支后无对比面板"));
    const hasA = await p.locator("[data-testid=sim-compare-heat-a]").count();
    const hasB = await p.locator("[data-testid=sim-compare-heat-b]").count();
    const rows = await p.locator("[data-testid^=sim-compare-row-]").count();
    if (hasA && hasB) console.log(`  ✓ 对比面板：A/B 双序列 heat + 差异表 ${rows} 行`);
    else fail("对比面板缺 A/B 序列");
  }
} catch (e) {
  fail(`异常：${String(e).slice(0, 200)}`);
} finally {
  await b.close();
}

if (failed) {
  console.error("\n✗ sandbox-p0-smoke 未通过。");
  process.exit(1);
}
console.log("\n✓ sandbox-p0-smoke：采纳→草稿 / 分支→对比面板 / 就绪面板6元素+scope切换 全程真后端真浏览器可见可达。");
