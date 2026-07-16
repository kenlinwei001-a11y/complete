import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/cmp";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const S = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();
await S.goto(`${APP}/login`, { waitUntil: "networkidle" });
await S.fill("#login-tenant", "demo"); await S.fill("#login-username", "admin"); await S.fill("#login-password", "demo1234");
await S.click('button[type="submit"]');
await S.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
async function go(path, name, waitMs = 4500) {
  await S.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
  await sleep(waitMs);
  await S.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`${name}: ${S.url().replace(APP, "")}`);
}
await go("/admin/modeling", "cur-modeling", 6000);   // ④建模工作台(竞品 image2/compare-4) + ②认证(compare-2)
await go("/v/sim-sandbox", "cur-sandbox", 6000);      // ①沙盘主屏(compare-1)
await go("/v/sim-init", "cur-siminit", 5000);         // ③初始化向导(compare-3)
await go("/admin/object-types", "cur-objects", 5500); // ⑤逐对象浏览器(compare-5)
await browser.close();
console.log("done");
