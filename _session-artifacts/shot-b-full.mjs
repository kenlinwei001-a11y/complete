// Render platform frontend -> login planner/demo -> /v/risk -> FULL content screenshots (unclip inner scroll).
import { chromium } from "/home/user/complete/node_modules/playwright-core/index.mjs";
import path from "node:path";

const OUT_DIR = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/compare-shots";
const BASE_URL = "http://localhost:5222";

const UNCLIP = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { ok: false };
  let node = el;
  while (node) {
    node.style.overflow = "visible";
    node.style.overflowY = "visible";
    node = node.parentElement;
  }
  document.documentElement.style.overflow = "visible";
  document.body.style.overflow = "visible";
  return { ok: true, scrollHeightAfter: document.documentElement.scrollHeight };
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

async function loginAndGoRisk() {
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(500);
  if (page.url().includes("/login")) {
    await page.waitForSelector("#login-username", { timeout: 15000 });
    await page.fill("#login-username", "planner");
    await page.fill("#login-password", "demo");
    await page.click("button[type=submit]");
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('[data-testid="left-nav"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  if (!page.url().includes("/v/risk")) {
    await page.click('a[href="/v/risk"]');
  }
  await page.waitForSelector('[data-testid="risk-kpi"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
}

await loginAndGoRisk();
const cardCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="risk-card-"]').length);
console.log("risk card count:", cardCount);

const r1 = await page.evaluate(UNCLIP, "main");
console.log("unclip main:", JSON.stringify(r1));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT_DIR, "B-platform.png"), fullPage: true });
console.log("Saved B-platform.png (full content)");

// Fresh reload for detail state (avoid compounded layout mutation from unclip).
await loginAndGoRisk();
const firstCardTestId = await page.evaluate(() => {
  const el = document.querySelector('[data-testid^="risk-card-"]');
  return el ? el.getAttribute("data-testid") : null;
});
console.log("firstCardTestId:", firstCardTestId);
await page.click(`[data-testid="${firstCardTestId}"]`);
await page.waitForTimeout(1500);
const detailShown = await page.evaluate(() => !!document.querySelector('[data-testid^="risk-detail-"]'));
console.log("detail shown:", detailShown);

const r2 = await page.evaluate(UNCLIP, "main");
console.log("unclip main (detail):", JSON.stringify(r2));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT_DIR, "B-platform-detail.png"), fullPage: true });
console.log("Saved B-platform-detail.png (full content)");

await browser.close();
