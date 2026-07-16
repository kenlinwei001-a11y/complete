import { chromium } from "playwright-core";

const BASE = "http://127.0.0.1:5210";

async function main() {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  const failed = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "planner");
  await page.fill("#login-password", "demo");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.locator('a[href="/v/risk"]').first().click();
  await page.waitForSelector('[data-testid="risk-kpi"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('[data-testid="risk-card-常州"]');
  await page.waitForTimeout(1000);

  console.log("FAILED_RESPONSES_START");
  console.log(JSON.stringify(failed, null, 2));
  console.log("FAILED_RESPONSES_END");
  await browser.close();
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
