import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
const apiDataModes = [];
page.on("response", async (r) => { const u=r.url(); if(u.includes("capacity_forecast")||u.includes("bottleneck_matrix")){ try{const j=await r.json(); const dm=j?.result?.dataMode??j?.dataMode??JSON.stringify(j).match(/"dataMode":"(\w+)"/)?.[1]; apiDataModes.push((u.includes("bottleneck")?"bottleneck":"capacity")+":"+dm);}catch{} } });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
await sleep(1500);
await page.evaluate(()=>{window.history.pushState({},"","/v/project-sim");window.dispatchEvent(new PopStateEvent("popstate"));});
await sleep(8000); // 等 capacity_forecast 跑完渲染六步
// 点所有 step chip 展开
const steps = page.locator('[class*="pm-step"], [data-testid^="pm-step"]');
const n = await steps.count();
for (let i=0;i<Math.min(n,6);i++){ try{ await steps.nth(i).click(); await sleep(400);}catch{} }
await sleep(1000);
// 点瓶颈矩阵按钮(看 dataMode LIVE/MOCK)
try{ const bn = page.locator('text=瓶颈').first(); if(await bn.count()) { await bn.click(); await sleep(1500);} }catch{}
const body = (await page.locator("body").textContent()) || "";
const est=(body.match(/估算/g)||[]).length, live=(body.match(/实测/g)||[]).length, dm=(body.match(/LIVE|MOCK/g)||[]).length;
const snip=[...body.matchAll(/(估算[（(]?实测?[^，。,)）]{0,8}|实测[^，。,]{0,6}\d+|dataMode\s*\w+|LIVE|MOCK)/g)].map(m=>m[0]).slice(0,10);
await page.screenshot({ path: `${OUT}/projsim2.png`, fullPage: true });
console.log("PROJECT-SIM(驱动后): 估算", est, "实测", live, "LIVE/MOCK", dm);
console.log("片段:", JSON.stringify(snip));
console.log("API dataMode:", JSON.stringify([...new Set(apiDataModes)]));
await browser.close();
