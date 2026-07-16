import { chromium } from "playwright-core";
const FRONT = "http://localhost:5174";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 300)); });
page.on("pageerror", (e) => errs.push("PAGEERROR: " + (e?.message ?? String(e)).slice(0, 300)));
const reqfail = [];
page.on("requestfailed", (r) => reqfail.push(r.url() + " :: " + (r.failure()?.errorText ?? "")));
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  console.log("after login url:", page.url());
  await page.goto(`${FRONT}/v/sim-sandbox`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  console.log("sandbox url:", page.url());
  console.log("sandbox-view count:", await page.locator("[data-testid=sandbox-view]").count());
  console.log("tick-calendar count:", await page.locator("[data-testid=sandbox-tick-calendar]").count());
  console.log("cur-tick count:", await page.locator("[data-testid=sandbox-cur-tick]").count());
  // dump visible headings / text
  const bodyText = (await page.locator("body").innerText()).slice(0, 800);
  console.log("=== BODY TEXT (first 800) ===\n" + bodyText);
  console.log("=== console errors ===\n" + (errs.join("\n") || "(none)"));
  console.log("=== request failures ===\n" + (reqfail.join("\n") || "(none)"));
  await page.screenshot({ path: "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/debug-shot.png", fullPage: false });
} catch (e) {
  console.log("ERR:", e?.message ?? String(e));
} finally { await browser.close(); }
