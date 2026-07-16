import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/user/complete/apps/frontend-shell/package.json");
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const { chromium } = require("playwright-core");
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 1440, height: 1200 } });
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 200)));
page.on("response", async (r) => {
  const u = r.url();
  if (/growth\/board|action-drafts|\/me\/workspace|auth\/login/.test(u)) {
    let body = "";
    try { body = (await r.text()).slice(0, 250); } catch {}
    console.log("RESP", r.status(), u.replace("http://127.0.0.1", ""), "=>", body);
  }
});
page.on("requestfailed", (r) => console.log("REQFAIL", r.url().replace("http://127.0.0.1",""), r.failure()?.errorText));
await page.goto("http://127.0.0.1:5221/", { waitUntil: "networkidle" });
await page.fill("#login-username", "admin");
await page.fill("#login-password", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(3000);
console.log("URL after login:", page.url());
await page.evaluate(() => { window.history.pushState({}, "", "/admin/tickets"); window.dispatchEvent(new PopStateEvent("popstate")); });
await page.waitForTimeout(4000);
console.log("URL now:", page.url());
const rows = await page.locator("[data-testid^=tc-row-]").count();
const empty = await page.locator("[data-testid=tc-empty]").count();
const emptyText = await page.locator("[data-testid=tc-empty]").textContent().catch(() => "");
console.log("rows:", rows, "empty:", empty, "emptyText:", emptyText);
await page.screenshot({ path: "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/debug.png", fullPage: true }).catch(()=>{});
await b.close();
