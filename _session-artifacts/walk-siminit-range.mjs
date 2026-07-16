import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-init"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(4000);
// 点一次"下一步"到范围步（②推演范围）
const next0 = page.locator('button:has-text("下一步"), [data-testid^="siminit-next"]').first();
if (await next0.count()) { await next0.click().catch(() => {}); await sleep(2000); }
const reserved = await page.locator('[data-testid="siminit-range-reserved"]').count();
const reservedTxt = reserved ? ((await page.locator('[data-testid="siminit-range-reserved"]').textContent()) || "").trim().slice(0, 130) : "<未到范围步或缺>";
await page.screenshot({ path: `${OUT}/q1-range.png`, fullPage: true });
console.log("范围步 ③类 RESERVED 行:", reserved ? "✓存在" : "✗");
console.log("内容:", reservedTxt);
await browser.close();
