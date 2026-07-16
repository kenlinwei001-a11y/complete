#!/usr/bin/env node
// Capture ACTUAL system UI. Token is in-memory only (tokenStore.ts) -> a full page.goto wipes it
// and bounces to /login. So: log in ONCE, then navigate via SPA client-side routing (pushState+popstate)
// which preserves the in-memory token.
import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";

const PAGES = [
  ["/v/sim-sandbox", "actual-sandbox.png"],
  ["/admin/modeling", "actual-modeling.png"],
  ["/admin/object-types", "actual-objecttypes.png"],
  ["/admin/slices", "actual-slices.png"],
  ["/admin/domains", "actual-domains.png"],
  ["/v/risk-board", "actual-riskboard.png"],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });

// ---- login (single full load) ----
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
await sleep(2000);
console.log("post-login url:", page.url(), " bodyLen:", ((await page.locator("body").textContent()) || "").length);

// ---- SPA navigation helper (no reload -> keeps in-memory token) ----
async function spaGoto(route) {
  await page.evaluate((r) => {
    window.history.pushState({}, "", r);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
}

const report = [];
for (const [route, file] of PAGES) {
  try {
    await spaGoto(route);
    // wait until content area is non-trivial or 12s
    let bodyLen = 0;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      bodyLen = ((await page.locator("body").textContent()) || "").length;
      const onLogin = page.url().includes("/login");
      if (onLogin) { console.log(`  ${route}: bounced to /login!`); break; }
      if (bodyLen > 200) break;
    }
    await sleep(1500); // settle charts/queries
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
    const heads = await page.locator("h1,h2,h3").allTextContents().catch(() => []);
    report.push({ route, file, ok: true, bodyLen, url: page.url(), heads: heads.slice(0, 5).map((s) => s.trim().slice(0, 30)) });
    console.log(`OK ${route} -> ${file} | bodyLen=${bodyLen} url=${page.url()}`);
  } catch (e) {
    report.push({ route, file, ok: false, err: String(e).slice(0, 140) });
    console.log(`FAIL ${route}: ${String(e).slice(0, 140)}`);
  }
}

console.log("\n=== console errors (unique, first 12) ===");
console.log([...new Set(errs)].slice(0, 12).join("\n") || "(none)");
console.log("\n=== report ===");
console.log(JSON.stringify(report, null, 2));
await browser.close();
