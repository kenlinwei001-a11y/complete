import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
await sleep(1500);
async function spaGoto(r){ await page.evaluate((x)=>{window.history.pushState({},"",x);window.dispatchEvent(new PopStateEvent("popstate"));}, r); }

// === ① ModelingPage 真值闭合 ===
await spaGoto("/admin/modeling");
await sleep(3500);
const body = (await page.locator("body").textContent()) || "";
const hasEmpty = body.includes("暂无本体");
const modeledCount = (body.match(/已建模|个对象类型/g) || []).length;
const unmodeledCount = (body.match(/未建模/g) || []).length;
await page.screenshot({ path: `${OUT}/trackL-modeling.png`, fullPage: true });
console.log("MODELING: 含'暂无本体'=", hasEmpty, "(应 false) | '已建模/N个对象类型'出现", modeledCount, "次 | '未建模'出现", unmodeledCount, "次(应 0)");

// === ② 回归:沙盘 tick 节点仍变色 ===
await spaGoto("/v/sim-sandbox");
try { await page.waitForSelector('[data-testid="sandbox-tick-btn"]', { timeout: 10000 }); } catch {}
await sleep(2500);
const sig = async () => (await page.evaluate(() => [...(document.body.innerText||"").matchAll(/Σ\s*(\d+)/g)].map(x=>Number(x[1]))));
const before = await sig();
for (let i=0;i<3;i++){ await page.click('[data-testid="sandbox-tick-btn"]').catch(()=>{}); await sleep(1000); }
const after = await sig();
const changed = before.length===after.length ? before.map((b,i)=>b!==after[i]).filter(Boolean).length : -1;
await page.screenshot({ path: `${OUT}/trackL-sandbox.png`, fullPage: true });
console.log("SANDBOX tick: before", JSON.stringify(before.slice(0,6)), "after", JSON.stringify(after.slice(0,6)), "| changed", changed, "(>0=传导没被改坏)");
await browser.close();
