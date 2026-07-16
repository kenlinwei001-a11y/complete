import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
let authHeader = null, status = null;
page.on("request", (r) => { if (r.url().includes("/b/v1/queries") && r.method() === "POST") { authHeader = r.headers()["authorization"]; } });
page.on("response", async (r) => { if (r.url().includes("/b/v1/queries") && r.request().method() === "POST" && !r.url().includes("/events")) { status = r.status(); } });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);
await page.locator('[data-testid="modeling-agent-input"]').fill("x");
await page.locator('[data-testid="modeling-agent-send"]').click();
await sleep(2000);
// 同时在页面上下文里直接 fetch（用应用同源同 token）看是否也 404
const inPage = await page.evaluate(async () => {
  try {
    const tok = JSON.parse(localStorage.getItem("auth-token") || '""') || (window.__TOKEN__);
    const r = await fetch("http://127.0.0.1:4002/b/v1/queries", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok, "Idempotency-Key": "inpage-" + Math.floor(performance.now()) },
      body: JSON.stringify({ packageId: "pkg_battery_manufacturing", query: "x", context: { view: "dash", selectedObjects: [], filters: {}, presetSlots: {} } }),
    });
    return "in-page fetch HTTP " + r.status;
  } catch (e) { return "in-page fetch ERR " + String(e).slice(0, 80); }
});
console.log("app submitQuery POST status:", status);
console.log("浏览器 token 末12:", (authHeader || "").slice(-12));
console.log(inPage);
console.log("FULL_TOKEN=" + (authHeader || "").replace("Bearer ", ""));
await browser.close();
