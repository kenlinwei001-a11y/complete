import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

// SANDBOX-DAG-NODE-LAYOUT 真浏览器齿检：真登录 → in-app 导航沙盘 → 主视觉 DAG 的 35 对象节点
// 现分层/网格排布（非单行）+ 标签真渲染 getBoundingClientRect 两两不叠（同 geo-map 口径·真像素测量）
// + 超密聚合切换可读。before/after 由 --tag 参数区分（before = git stash 掉修复后重建）。
const EXE = process.env.PW_CHROME || "/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
const BASE = process.env.BASE || "http://127.0.0.1:4173";
const OUT = process.argv[2] || "/tmp/out";
const TAG = process.argv[3] || "after";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[evidence]", ...a);

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
// 暗发 entitlement sim.sandbox（等价 tenant-admin 勾选·非伪造数据）：patch /me/workspace features。
await ctx.addInitScript(() => {
  const orig = window.fetch;
  window.fetch = async (...args) => {
    const res = await orig(...args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (url.includes("/me/workspace") && res.ok) {
        const j = await res.clone().json();
        const feats = Array.isArray(j.features) ? j.features : [];
        if (!feats.includes("sim.sandbox")) j.features = [...feats, "sim.sandbox"];
        return new Response(JSON.stringify(j), { status: res.status, headers: { "content-type": "application/json" } });
      }
    } catch { /* passthrough */ }
    return res;
  };
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

// 真渲染标签框两两重叠检测（getBoundingClientRect·真像素·同 geo-map 齿检口径）。
const measure = () => page.evaluate(() => {
  const labels = [...document.querySelectorAll('[data-testid^="sandbox-dag-label-"]')];
  const boxes = labels.map((t) => {
    const r = t.getBoundingClientRect();
    const g = t.closest("g");
    return { full: t.getAttribute("data-full"), text: t.textContent, x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, cy: Number(g?.getAttribute("data-y")) };
  }).filter((b) => b.x2 > b.x1 && b.y2 > b.y1);
  const ov = (a, b) => !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
  const collisions = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (ov(boxes[i], boxes[j])) collisions.push(`${boxes[i].full}×${boxes[j].full}`);
  const rows = new Set(boxes.map((b) => Math.round(b.cy)));
  const wrap = document.querySelector('[data-testid="sandbox-dag-wrap"]');
  return {
    nodeCount: document.querySelectorAll('[data-testid^="sandbox-dag-node-"]').length,
    labelCount: boxes.length,
    distinctRows: rows.size,
    collisionCount: collisions.length,
    collisionsSample: collisions.slice(0, 8),
    dagMode: wrap?.getAttribute("data-dag-mode"),
    layerCount: wrap?.getAttribute("data-layer-count"),
    densityToggle: !!document.querySelector('[data-testid="sandbox-dag-density"]'),
  };
});

try {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "planner");
  await page.fill('input[type="password"]', "demo");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  log("logged in:", page.url());

  await page.waitForSelector('[data-testid="nav-sim-sandbox"]', { timeout: 15000 });
  await page.locator('[data-testid="nav-sim-sandbox"]').click();
  await page.waitForSelector('[data-testid="sandbox-view"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="sandbox-dag"]', { timeout: 20000 });
  await page.waitForTimeout(1200);

  const full = await measure();
  log(`${TAG} full-mode measure:`, JSON.stringify(full, null, 2));
  await page.screenshot({ path: `${OUT}/SANDBOX-DAG-NODE-LAYOUT-${TAG}-full.png`, fullPage: true });

  let aggregate = null;
  if (TAG === "after" && full.densityToggle) {
    await page.locator('[data-testid="sandbox-dag-mode-aggregate"]').click();
    await page.waitForTimeout(800);
    aggregate = await measure();
    log("after aggregate-mode measure:", JSON.stringify(aggregate, null, 2));
    await page.screenshot({ path: `${OUT}/SANDBOX-DAG-NODE-LAYOUT-after-aggregate.png`, fullPage: true });
  }

  console.log("\n===EVIDENCE_JSON_START===");
  console.log(JSON.stringify({ tag: TAG, full, aggregate }, null, 2));
  console.log("===EVIDENCE_JSON_END===");
} catch (e) {
  console.log("[FATAL]", e.message);
  await page.screenshot({ path: `${OUT}/SANDBOX-DAG-NODE-LAYOUT-${TAG}-ERROR.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
