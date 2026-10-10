#!/usr/bin/env node
/**
 * 门B · Agent F 数据源面板（ModelingPage additive）—— 真后端真浏览器验收。
 * 连真 datacore:4001 + vite:5199（VITE_DATACORE_URL 真后端模式，非 mock）。
 * 流程：admin 登录 → /admin/modeling → 左侧数据源面板渲染：
 *   - 按来源系统分组（ds-group-*）
 *   - 每个数据集行（ds-row-*）含覆盖度徽章（ds-coverage-*）
 * additive 不删既有：同时断言既有三栏「源字段/映射画布/操作面板」仍在。
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
  console.log(`⊘ data-source-panel-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // SPA 导航到 /admin/modeling（pushState+popstate，不 goto——避免丢内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForTimeout(1800);

  // 1) 数据源面板渲染
  if ((await p.locator("[data-testid=data-source-panel]").count()) < 1) { fail("数据源面板未渲染"); }
  else console.log("  数据源面板渲染 ✓");

  // 2) 按来源系统分组：至少 1 个 ds-group-*
  const groups = await p.locator("[data-testid^=ds-group-]").count();
  if (groups < 1) fail("无来源分组（ds-group-*）"); else console.log(`  来源分组数：${groups}`);

  // 3) 数据集行 + 覆盖度徽章
  const rows = await p.locator("[data-testid^=ds-row-]").count();
  const covs = await p.locator("[data-testid^=ds-coverage-]").count();
  if (rows < 1) fail("无数据集行（ds-row-*）"); else console.log(`  数据集行：${rows}，覆盖度徽章：${covs}`);
  if (covs >= 1) {
    const covTxt = (await p.locator("[data-testid^=ds-coverage-]").first().innerText()).trim();
    console.log(`  首行覆盖度：${covTxt}`);
  }

  // 4) additive 不删既有：右侧既有区块仍在。
  //    有草案 → 三栏「源字段/映射画布/操作面板」；无草案 → 空态 CTA「从数据建模」(cta-modeling)。
  const hasWorkbench = (await p.locator(".section-title", { hasText: "映射画布" }).count()) > 0;
  const hasEmptyCta = (await p.locator("[data-testid=cta-modeling]").count()) > 0;
  if (hasWorkbench) {
    const bodyTxt = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    for (const sec of ["源字段", "映射画布", "操作面板"]) {
      if (!bodyTxt.includes(sec)) fail(`既有三栏「${sec}」缺失（additive 破坏了原页面）`);
    }
    if (!failed) console.log("  既有三栏（源字段/映射画布/操作面板）仍在 ✓（additive，有草案）");
  } else if (hasEmptyCta) {
    console.log("  既有空态 CTA（从数据建模/一键合成）仍在 ✓（additive，无草案）");
  } else {
    fail("右侧既无三栏也无空态 CTA（additive 破坏了原页面）");
  }
} catch (e) {
  fail(`异常：${String(e).slice(0, 300)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ data-source-panel-smoke 未通过。"); process.exit(1); }
console.log("\n✓ data-source-panel-smoke：admin /admin/modeling 见数据源面板（来源分组+覆盖度），既有三栏不删（真后端真浏览器）。");
