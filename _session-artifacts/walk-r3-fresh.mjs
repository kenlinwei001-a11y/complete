import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.locator('text=经营驾驶舱').first().click().catch(()=>{});
await sleep(4500);
// 长等待 hover gwh，确认新鲜度即便 health 加载后也不渲染（排除计时假阴性）
const prov = page.locator('[data-testid="widget-prov-gwh"]').first();
await prov.scrollIntoViewIfNeeded().catch(()=>{});
await prov.locator(".badge, span").first().hover({force:true}).catch(()=>{});
await sleep(3000); // 给 fetchDataHealth 充分时间
const fresh = await page.locator('[data-testid="prov-fresh"]').count();
const tip = ((await page.locator('[data-testid="prov-tip"]').first().textContent().catch(()=>"" ))||"").replace(/\s+/g," ").trim();
console.log("长等3s后 gwh 新鲜度(prov-fresh)渲染:", fresh? "✓出现" : "✗仍无");
console.log("tip 是否含'同步'/'延迟'/'min'(新鲜度文案):", /同步|延迟|min前|分钟前/.test(tip)?"✓有":"✗无");
console.log("tip:", tip.slice(0,180));
await browser.close();
