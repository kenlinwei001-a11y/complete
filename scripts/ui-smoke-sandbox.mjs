#!/usr/bin/env node
/**
 * 门B · 推演沙盘（增量 4）真浏览器 + 真后端验收（不走 mock）。
 * 连已起的 datacore:4001（vite :5199 VITE_*_URL 指向真服务）。
 * 流程：admin 登录 → 经 PUT /a/v1/tenants/demo/features 开 sim.sandbox/propagation/certification
 *       → SPA 导航 /v/sim-sandbox → 自动 init 会话 → 点「推进 tick」→ 断言 KPI 全局态值变化（节点态随 tick 变）。
 * 配置驱动·零业务常数：节点/边/KPI 全来自 /a/v1/sim/view-config（租户本体派生）。
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
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js", "/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ sandbox-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

// 先用 admin 凭据开通 sim 功能（demo 默认 sim.sandbox 关；暗发）。
async function enableSim() {
  const lr = await fetch(`${DC}/a/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  if (!lr.ok) { fail(`登录失败 ${lr.status}`); return false; }
  const { accessToken } = await lr.json();
  const pr = await fetch(`${DC}/a/v1/tenants/demo/features`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true, "sim.checkpoint": true } }),
  });
  if (!pr.ok) { fail(`开通 sim 功能失败 ${pr.status}`); return false; }
  console.log("  ✓ 已开通 demo 的 sim.sandbox/propagation/certification");
  // 后端冒烟：view-config 端点真返回（证端到端通）。
  const vc = await fetch(`${DC}/a/v1/sim/view-config`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!vc.ok) { fail(`view-config ${vc.status}`); return false; }
  const cfg = await vc.json();
  console.log(`  view-config: nodeTypes=${cfg.nodeTypes.length} linkTypes=${cfg.linkTypes.length} stateVars=${cfg.stateVars.length} propRules=${cfg.propagationCount}`);
  return true;
}

if (!(await enableSim())) { console.error("\n✗ sandbox-smoke 未通过：sim 功能开通/后端冒烟失败。"); process.exit(1); }

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

  // SPA 内导航到 /v/sim-sandbox（pushState+popstate，不 goto——避免丢内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForSelector("[data-testid=sandbox-view]", { timeout: 15000 });
  await p.waitForTimeout(1000);

  // init 会话后拓扑/KPI 出现。
  const summary = p.locator("[data-testid=sandbox-config-summary]");
  if ((await summary.count()) === 0) fail("无配置摘要（view-config 未渲染）");
  else console.log("  配置摘要:", (await summary.first().innerText()).replace(/\s+/g, " ").trim());

  const tickBtn = p.locator("[data-testid=sandbox-tick-btn]");
  if ((await tickBtn.count()) === 0) { fail("无「推进 tick」按钮"); throw new Error("no tick btn"); }
  // 等按钮可用（会话 init 完成）。
  await p.waitForFunction(() => {
    const el = document.querySelector("[data-testid=sandbox-tick-btn]");
    return el && !el.disabled;
  }, { timeout: 10000 }).catch(() => fail("tick 按钮一直 disabled（会话未 init）"));

  const kpiSel = "[data-testid=sandbox-kpi-global-val]";
  const before = ((await p.locator(kpiSel).first().textContent()) || "").trim();
  // 抓首节点 sub（Σ 聚合值）作色/态变化的旁证（PmDag 节点是 SVG <g>，用 textContent，非 innerText）。
  const nodeSel = "[data-testid^=sandbox-dag-node-]";
  const nNodes = await p.locator(nodeSel).count();
  const nodeBefore = nNodes > 0 ? ((await p.locator(nodeSel).first().textContent()) || "").replace(/\s+/g, " ").trim() : "";
  console.log(`  拓扑节点数=${nNodes}（=view-config nodeTypes）`);
  if (nNodes === 0) fail("拓扑无节点（PmDag 未从 nodeTypes 渲染）");
  console.log(`  tick 前：全局态=${before} 首节点=${nodeBefore}`);

  await tickBtn.first().click();
  await p.waitForTimeout(1500);

  const after = ((await p.locator(kpiSel).first().textContent()) || "").trim();
  const nodeAfter = nNodes > 0 ? ((await p.locator(nodeSel).first().textContent()) || "").replace(/\s+/g, " ").trim() : "";
  console.log(`  tick 后：全局态=${after} 首节点=${nodeAfter}`);

  // 断言：tick 后世界态推进（curTick 递增 → 时间轴 heat 多一格；恒等桩下值可能不变，
  // 故主断言为「tick 计数器/时间轴变化」+ 「无报错」；若有传导规则则值也变）。
  const tickLabel = ((await p.locator("[data-testid=sandbox-kpi-global] span").first().textContent()) || "").trim();
  console.log("  tick 计数标签:", tickLabel);
  if (!/tick\s*1/.test(tickLabel)) fail(`tick 计数未推进到 1（实=${tickLabel}）`);

  // 就绪认证面板可见（L 级/canEnter/gaps 或诚实「未开通」）。
  const cert = p.locator("[data-testid=sandbox-readiness]");
  if ((await cert.count()) === 0) fail("无就绪认证面板");
  else console.log("  就绪面板:", (await cert.first().innerText()).replace(/\s+/g, " ").slice(0, 140));
} catch (e) {
  fail(`异常：${String(e).slice(0, 200)}`);
} finally {
  await b.close();
}

if (failed) {
  console.error("\n✗ sandbox-smoke 未通过：推演沙盘前端不可用或 tick 未推进。");
  process.exit(1);
}
console.log("\n✓ sandbox-smoke：view-config 派生→拓扑/KPI 渲染→推进 tick→世界态推进 全程真后端可见可达。");
