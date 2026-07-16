import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
const reqs = [];
page.on("request", (r) => { if (r.url().includes("/solvers/") && r.url().includes("/run")) reqs.push({ url: r.url(), auth: (r.headers()["authorization"] || "NONE").slice(0, 30), method: r.method() }); });
page.on("response", async (r) => { if (r.url().includes("/solvers/") && r.url().includes("/run")) { const i = reqs.findIndex((x) => x.url === r.url() && !x.status); if (i >= 0) { reqs[i].status = r.status(); try { reqs[i].body = (await r.text()).slice(0, 120); } catch {} } } });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(3000);
// 先 dash 暖 token
await page.evaluate(() => { window.history.pushState({}, "", "/v/dash"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);
// 再 plan-audit
await page.evaluate(() => { window.history.pushState({}, "", "/v/plan-audit"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(6000);
console.log("=== 浏览器 solvers/run 请求实况 ===");
reqs.forEach((r) => console.log(`  ${r.method} ${r.url.replace("http://127.0.0.1:4002", "AC").replace("http://127.0.0.1:4001", "DC")}\n    auth=${r.auth} status=${r.status} body=${r.body || ""}`));
if (!reqs.length) console.log("  (无 solvers/run 请求被发出)");
await browser.close();
