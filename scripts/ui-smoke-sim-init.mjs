#!/usr/bin/env node
/**
 * 门B · 增量4 渐进项（Agent G）· 推演初始化向导真浏览器 + 真后端验收。
 * 连真 datacore:4001（demo 租户 sim.sandbox 开通）。流程：admin 登录 → /v/sim-init
 * → 走三步向导（世界基准 → 推演范围 → 范围预检）→ 断言 step③ 显真 scope-precheck 数据
 *   （worldCompleteness% + entering[] 清单 + canEnter 结论），复用增量2 数据。
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
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ sim-init-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // SPA 导航到 /v/sim-init（pushState+popstate，不 goto——避免丢内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/v/sim-init"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForTimeout(1500);

  // step① 世界基准。
  if ((await p.locator("[data-testid=siminit-view]").count()) === 0) fail("向导未渲染（siminit-view 缺失）");
  if ((await p.locator("[data-testid=siminit-pane-baseline]").count()) === 0) fail("step① 世界基准面板缺失");
  else console.log("  step① 世界基准面板可见");
  await p.click("[data-testid=siminit-next-baseline]");
  await p.waitForTimeout(400);

  // step② 推演范围。
  if ((await p.locator("[data-testid=siminit-pane-range]").count()) === 0) fail("step② 推演范围面板缺失");
  else console.log("  step② 推演范围面板可见");
  await p.click("[data-testid=siminit-next-range]");
  await p.waitForTimeout(2000); // 等会话 init + scope-precheck

  // step③ 范围预检 —— 断言真后端 scope-precheck 数据。
  if ((await p.locator("[data-testid=siminit-pane-precheck]").count()) === 0) fail("step③ 范围预检面板缺失");
  const comp = p.locator("[data-testid=siminit-completeness]");
  if ((await comp.count()) === 0) fail("worldCompleteness% 未显示");
  else {
    const t = (await comp.innerText()).trim();
    console.log(`  完整度: ${t}`);
    if (!/%/.test(t)) fail("完整度非百分比");
  }
  const enteringCount = await p.locator("[data-testid^=siminit-entering-]").count();
  const enteringEmpty = await p.locator("[data-testid=siminit-entering-empty]").count();
  if (enteringCount === 0 && enteringEmpty === 0) fail("entering[] 清单未渲染（既非清单也非空态）");
  else console.log(`  将进入沙盘清单项数: ${enteringCount}${enteringEmpty ? "（诚实空态）" : ""}`);
  const canEnter = p.locator("[data-testid=siminit-canenter]");
  if ((await canEnter.count()) === 0) fail("canEnter 结论未显示");
  else console.log(`  canEnter 结论: ${(await canEnter.innerText()).trim()}`);

  // NAV 入口存在。
  if ((await p.locator("[data-testid=nav-sim-init]").count()) === 0) fail("左导航 sim-init 入口缺失");
  else console.log("  左导航推演初始化向导入口可见");
} catch (e) {
  fail(`异常：${String(e).slice(0, 200)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ sim-init-smoke 未通过。"); process.exit(1); }
console.log("\n✓ sim-init-smoke：三步向导 + step③ 真 scope-precheck 数据（worldCompleteness/entering/canEnter）可见（真后端真浏览器）。");
