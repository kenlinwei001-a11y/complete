import pkg from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pkg;

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://127.0.0.1:5173";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

// 1) login
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
// fill login form — find inputs
const inputs = await page.$$("input");
console.log("LOGIN inputs count:", inputs.length);
// Try by testid / placeholder fallbacks
try {
  await page.fill('input[name="tenantId"], input[placeholder*="租户"], input[placeholder*="tenant"]', "demo").catch(()=>{});
} catch {}
// Generic: fill in order if 3 inputs (tenant, user, pass)
const all = await page.$$("input");
if (all.length >= 3) {
  await all[0].fill("demo");
  await all[1].fill("admin");
  await all[2].fill("demo1234");
} else if (all.length === 2) {
  await all[0].fill("admin");
  await all[1].fill("demo1234");
}
// click submit
await page.click('button[type="submit"], button:has-text("登录"), button:has-text("登 录")').catch(async()=>{
  const btns = await page.$$("button"); if (btns[0]) await btns[0].click();
});
await page.waitForTimeout(2500);
console.log("URL after login:", page.url());

// 2) navigate directly to quarantine deep link
await page.goto(`${BASE}/admin/quarantine`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
console.log("URL at quarantine:", page.url());

// 3) capture main content text
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
console.log("=== BODY TEXT (first 1500) ===");
console.log(bodyText);

const hasErrorBoundary = /页面出错|出错了|filter is not a function|Something went wrong|⚠/i.test(bodyText);
const hasQuarantinePage = await page.$('[data-testid="quarantine-page"]');
console.log("=== SIGNALS ===");
console.log("ErrorBoundary text present:", hasErrorBoundary);
console.log("quarantine-page testid present:", !!hasQuarantinePage);
console.log("pageErrors:", JSON.stringify(pageErrors, null, 2));
console.log("consoleErrors:", JSON.stringify(consoleErrors.slice(0,10), null, 2));

await page.screenshot({ path: "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/quarantine_render.png", fullPage: true });
await browser.close();
