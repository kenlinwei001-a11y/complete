import pkg from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pkg;

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://127.0.0.1:5173";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

// log the quarantine network response shape
let quarantineBody = null;
page.on("response", async (resp) => {
  if (resp.url().includes("/a/v1/quarantine") && resp.request().method() === "GET") {
    try { quarantineBody = await resp.text(); } catch {}
  }
});

// 1) login
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const all = await page.$$("input");
await all[0].fill("demo");
await all[1].fill("admin");
await all[2].fill("demo1234");
await page.click('button[type="submit"], button:has-text("登录")').catch(async()=>{
  const btns = await page.$$("button"); if (btns[0]) await btns[0].click();
});
await page.waitForTimeout(2500);
console.log("URL after login:", page.url());

// 2) IN-APP navigation: drive the SPA router without reload.
// Find and expand the "数据接入" nav group, then click "隔离区".
// Strategy A: click visible nav text.
let navigated = false;
try {
  // expand the data-ingestion group if collapsed
  const groupToggle = page.locator('text=数据接入').first();
  if (await groupToggle.count()) { await groupToggle.click({ timeout: 3000 }).catch(()=>{}); await page.waitForTimeout(400); }
  const quarLink = page.locator('text=隔离区').first();
  if (await quarLink.count()) {
    await quarLink.click({ timeout: 3000 });
    navigated = true;
  }
} catch (e) { console.log("nav click failed:", String(e)); }

// Strategy B fallback: use the in-app router via history API + dispatch (SPA listens to popstate / link clicks).
if (!navigated) {
  console.log("falling back to history.pushState navigation");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/admin/quarantine");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
await page.waitForTimeout(2500);
console.log("URL at quarantine:", page.url());
console.log("quarantine GET body:", quarantineBody);

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
console.log("=== BODY TEXT ===");
console.log(bodyText);

const hasErrorBoundary = /出错|filter is not a function|Something went wrong|⚠|刷新/i.test(bodyText);
const hasQuarantinePage = await page.$('[data-testid="quarantine-page"]');
const hasEmpty = await page.$('[data-testid="q-empty"]');
console.log("=== SIGNALS ===");
console.log("ErrorBoundary-ish text present:", hasErrorBoundary);
console.log("quarantine-page testid present:", !!hasQuarantinePage);
console.log("q-empty testid present:", !!hasEmpty);
console.log("pageErrors:", JSON.stringify(pageErrors, null, 2));
console.log("consoleErrors (filtered):", JSON.stringify(consoleErrors.filter(e=>!/404/.test(e)).slice(0,10), null, 2));

await page.screenshot({ path: "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/quarantine_render2.png", fullPage: true });
await browser.close();
