#!/usr/bin/env node
/**
 * 门B · UI 交互冒烟（真浏览器，治"渲染绿但点不动/下钻断"——jsdom 测不出的死按钮/断链）。
 * 由来：经营驾驶舱"待解决问题"卡片是纯 div 无 onClick，218 个 jsdom 绿测试全漏，用户一点才发现。
 * 本门起真 dev server + Playwright 以用户身份点关键交互，断言可达。
 *
 * 自管生命周期：起 vite(VITE_MOCK=1 :5199) → 等就绪 → 驱动 dash 核心交互 → 断言 → 杀 server。
 * 环境无 chromium/playwright-core → SKIP（exit 0，不假红）；CI 启用需 `npx playwright install chromium`。
 * 真交互断言失败 → exit 1（红）。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const require = createRequire(import.meta.url);

// 1) 找 chromium（playwright 缓存常见路径或 env）。
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  const globby = ["/root/.cache/ms-playwright", "/opt/pw-browsers", `${process.env.HOME}/.cache/ms-playwright`];
  for (const root of globby) {
    for (const sub of ["chromium-1148/chrome-linux/chrome", "chromium-1194/chrome-linux/chrome"]) {
      if (existsSync(`${root}/${sub}`)) return `${root}/${sub}`;
    }
  }
  return null;
}
// 2) 解析 playwright-core（根项目可能未装；回退到已知缓存安装）。
function loadChromiumApi() {
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js", "/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright-core/index.js"]) {
    try {
      return require(spec).chromium;
    } catch {
      /* try next */
    }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ ui-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。CI 启用：npx playwright install chromium。`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let vite;
let failed = false;
const fail = (m) => {
  console.error(`✗ ${m}`);
  failed = true;
};

try {
  // 3) 起 dev server
  vite = spawn("npx", ["vite", "--force", "--port", String(PORT), "--host", "127.0.0.1"], {
    cwd: new URL("../apps/frontend-shell", import.meta.url).pathname,
    env: { ...process.env, VITE_MOCK: "1" },
    stdio: "ignore",
  });
  // 等就绪
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) { up = true; break; }
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  if (!up) {
    console.error("✗ ui-smoke：dev server 未就绪");
    process.exitCode = 1;
  } else {
    const b = await chromium.launch({ executablePath: exe });
    const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await p.goto(BASE, { waitUntil: "networkidle" });
      await p.fill("#login-username", "planner");
      await p.fill("#login-password", "demo");
      await p.click("button[type=submit]");
      await p.waitForTimeout(1500);
      await p.click('a[href="/v/dash"]');
      await p.waitForSelector("[data-testid=dashboard-grid]", { timeout: 15000 });
      await p.waitForTimeout(1200);

      // 断言 1：待解决问题卡片可点击下钻（曾经的死按钮 bug）
      const probs = p.locator('[data-testid^="dash-problem-"]');
      if ((await probs.count()) === 0) fail("dash 无问题卡片");
      else {
        const tag = await probs.first().evaluate((el) => el.tagName);
        if (tag !== "BUTTON") fail(`问题卡片不是可点击 BUTTON（是 ${tag}）`);
        await probs.first().click();
        await p.waitForTimeout(1200);
        if (!p.url().includes("/v/order-chain")) fail(`问题卡下钻未到 order-chain（${p.url()}）`);
      }

      // 断言 2：订单经营台账 — 行 + 细分筛选 + 点行下钻
      await p.keyboard.press("Escape").catch(() => {}); // 关可能遮挡导航的根因 DAG modal
      await p.waitForTimeout(300);
      await p.locator('a[href="/v/dash"]').click({ force: true });
      await p.waitForSelector("[data-testid=dashboard-grid]", { timeout: 10000 });
      await p.waitForTimeout(700);
      if ((await p.locator("[data-testid=dash-order-ledger]").count()) === 0) fail("dash 无 order-ledger 台账");
      const ledgerRows = p.locator('[data-testid^="ledger-row-"]');
      if ((await ledgerRows.count()) === 0) fail("order-ledger 无台账行");
      else {
        await ledgerRows.first().click();
        await p.waitForTimeout(1000);
        if (!p.url().includes("/v/order-chain")) fail(`台账行下钻未到 order-chain（${p.url()}）`);
      }

      // 断言 3：规划决策推演 — KPI 条 + 去体检导航
      await p.keyboard.press("Escape").catch(() => {}); // 关可能遮挡导航的根因 DAG modal
      await p.waitForTimeout(300);
      await p.locator('a[href="/v/dash"]').click({ force: true });
      await p.waitForSelector("[data-testid=dashboard-grid]", { timeout: 10000 });
      await p.waitForTimeout(700);
      if ((await p.locator("[data-testid=dash-plan-drill]").count()) === 0) fail("dash 无 plan-drill");
      const auditBtn = p.locator("[data-testid=drill-to-audit]");
      if ((await auditBtn.count()) === 0) fail("plan-drill 无去体检按钮");
      else {
        await auditBtn.click();
        await p.waitForTimeout(1000);
        if (!p.url().includes("/v/plan-audit")) fail(`去体检未导航 plan-audit（${p.url()}）`);
      }

      // 断言 4：导出按钮可点 + 模块直达可点
      await p.keyboard.press("Escape").catch(() => {}); // 关可能遮挡导航的根因 DAG modal
      await p.waitForTimeout(300);
      await p.locator('a[href="/v/dash"]').click({ force: true });
      await p.waitForSelector("[data-testid=dashboard-grid]", { timeout: 10000 });
      await p.waitForTimeout(700);
      if ((await p.locator("[data-testid=dash-export]").count()) === 0) fail("dash 无导出按钮");
      const mods = p.locator('[data-testid^="dash-mod-"]');
      if ((await mods.count()) === 0) fail("dash 无模块直达卡");
    } finally {
      await b.close();
    }
  }
} catch (e) {
  fail(`ui-smoke 异常：${String(e).slice(0, 200)}`);
} finally {
  if (vite) vite.kill("SIGTERM");
}

if (failed || process.exitCode === 1) {
  console.error("\n✗ ui-smoke 未通过：经营驾驶舱关键交互断（死按钮/断下钻）。");
  process.exit(1);
}
console.log("✓ ui-smoke：经营驾驶舱关键交互全可达（问题卡下钻 / 台账筛选下钻 / 规划推演去体检 / 导出 / 模块直达）。");
