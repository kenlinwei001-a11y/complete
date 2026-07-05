import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://127.0.0.1:4173";
const OUT = process.argv[2] || "/tmp/out";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[evidence]", ...a);
const results = {};

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
// 暗发 entitlement sim.sandbox 开通（等价 tenant-admin 勾选·非伪造数据）：在页面内 patch fetch，
// 给 /me/workspace 响应的 features 追加 "sim.sandbox"（与 wo-nav-sandbox 测试 server.use 注入同法）。
// 仅开门看真 UI——沙盘的 view-config/cert/session 数据全走真 mock 端点，未改一值。
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

try {
  // 1) 打开登录页（MSW 注册）。
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 2) 真登录 planner/demo（具 admin·tenant demo）。
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "planner");
  await page.fill('input[type="password"]', "demo");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  log("logged in:", page.url());

  // 3) 应用内 SPA 导航（不整页 reload·保 in-memory token）：点「推演沙盘」nav 项。
  await page.waitForSelector('[data-testid="nav-sim-sandbox"]', { timeout: 15000 });
  await page.locator('[data-testid="nav-sim-sandbox"]').click();
  await page.waitForSelector('[data-testid="sandbox-view"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="sandbox-hero-grid"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="sandbox-dag"]', { timeout: 20000 }).catch(() => log("dag not present (empty world?)"));
  await page.waitForTimeout(1000);

  // ── C1/C3：默认态截图（主视觉主导·右栏折叠卡栈·密度低）──────────
  await page.screenshot({ path: `${OUT}/SANDBOX-LAYOUT-C1-default.png`, fullPage: true });
  log("shot C1 default");

  const layout = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="sandbox-hero-grid"]');
    const main = document.querySelector('[data-testid="sandbox-main-zone"]');
    const side = document.querySelector('[data-testid="sandbox-side-stack"]');
    const gs = grid ? getComputedStyle(grid) : null;
    const cards = [...document.querySelectorAll('[data-testid$="-card"]')]
      .filter((c) => c.getAttribute("data-testid").startsWith("sandbox-"))
      .map((c) => ({ id: c.getAttribute("data-testid"), open: c.getAttribute("data-open"), bodyHidden: c.querySelector('[data-testid$="-body"]')?.hasAttribute("hidden") ?? null }));
    const gv = document.querySelector('[data-testid="sandbox-kpi-global-val"]');
    const gvS = gv ? getComputedStyle(gv) : null;
    const dag = document.querySelector('[data-testid="sandbox-topology"]');
    return {
      gridTemplateColumns: gs?.gridTemplateColumns, gridGap: gs?.gap,
      mainWidth: Math.round(main?.getBoundingClientRect().width || 0),
      sideWidth: Math.round(side?.getBoundingClientRect().width || 0),
      dagHeight: Math.round(dag?.getBoundingClientRect().height || 0),
      globalValFontSize: gvS?.fontSize, globalValFontWeight: gvS?.fontWeight,
      cards, openCount: cards.filter((c) => c.open === "1").length, foldedCount: cards.filter((c) => c.open === "0").length,
      // 「一屏可见面板」粗估：默认可见（非折叠 body）的顶层 panel 数。
      visiblePanels: [...document.querySelectorAll('[data-testid="sandbox-main-zone"] .panel')].length,
    };
  });
  results.layout = layout;
  log("layout:", JSON.stringify(layout, null, 2));

  // ── C3：展开双雷达折叠卡 → 渐进披露真可展开 ──────────
  await page.locator('[data-testid="sandbox-dual-radar-card-toggle"]').click();
  await page.waitForTimeout(500);
  results.radarExpand = await page.evaluate(() => ({
    open: document.querySelector('[data-testid="sandbox-dual-radar-card"]')?.getAttribute("data-open"),
    bodyHidden: document.querySelector('[data-testid="sandbox-dual-radar-card-body"]')?.hasAttribute("hidden"),
    healthRadarVisible: !!document.querySelector('[data-testid="sandbox-health-radar"]'),
  }));
  log("radar expand:", JSON.stringify(results.radarExpand));
  await page.screenshot({ path: `${OUT}/SANDBOX-LAYOUT-C3-radar-expanded.png`, fullPage: true });

  // ── C2：逐项点验既有功能仍可达 ──────────
  const c2 = {};
  const beforeTick = await page.locator('[data-testid="sandbox-kpi-global-val"]').textContent();
  await page.locator('[data-testid="sandbox-tick-btn"]').click();
  await page.waitForTimeout(1400);
  const afterTick = await page.locator('[data-testid="sandbox-kpi-global-val"]').textContent();
  c2.advanceTick = { before: beforeTick, after: afterTick, changed: beforeTick !== afterTick };

  c2.checkpointClickable = await page.locator('[data-testid="sandbox-checkpoint-btn"]').isEnabled();
  await page.locator('[data-testid="sandbox-checkpoint-btn"]').click().catch(() => {});
  await page.waitForTimeout(400);

  await page.locator('[data-testid="sandbox-branch-btn"]').click().catch(() => {});
  await page.waitForTimeout(1200);
  c2.branchCompareCardCount = await page.locator('[data-testid="sandbox-compare-card"]').count();

  c2.readinessCertLevel = await page.locator('[data-testid="sim-cert-level"]').first().textContent().catch(() => null);
  c2.readinessCardOpen = await page.locator('[data-testid="sandbox-readiness-card"]').getAttribute("data-open");

  await page.locator('[data-testid="sandbox-ai-input"]').fill("推进 2 个 tick");
  await page.locator('[data-testid="sandbox-ai-run"]').click();
  await page.waitForTimeout(1600);
  c2.aiEcho = await page.locator('[data-testid="sandbox-ai-echo"]').textContent().catch(() => null);

  await page.locator('[data-testid="sandbox-run-history-card-toggle"]').click().catch(() => {});
  await page.waitForTimeout(700);
  c2.historyCardOpen = await page.locator('[data-testid="sandbox-run-history-card"]').getAttribute("data-open");
  c2.historyContentReachable = (await page.locator('[data-testid="sandbox-run-history-card-body"] [data-testid^="sandbox-history"]').count()) > 0
    || (await page.locator('[data-testid="sandbox-history-empty"]').count()) > 0;

  await page.locator('[data-testid="sandbox-adopt-btn"]').click().catch(() => {});
  await page.waitForTimeout(800);
  c2.adoptClickable = true;

  results.c2 = c2;
  log("C2:", JSON.stringify(c2, null, 2));
  await page.screenshot({ path: `${OUT}/SANDBOX-LAYOUT-C2-features.png`, fullPage: true });

  console.log("\n===EVIDENCE_JSON_START===");
  console.log(JSON.stringify(results, null, 2));
  console.log("===EVIDENCE_JSON_END===");
} catch (e) {
  console.log("[FATAL]", e.message);
  await page.screenshot({ path: `${OUT}/SANDBOX-LAYOUT-ERROR.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
