import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
const api = [];
page.on("response", async (r) => { const u=r.url(); if(/capacity_forecast|bottleneck_matrix/.test(u)){ try{const t=await r.text(); const dm=t.match(/"dataMode":"(\w+)"/)?.[1]; api.push((u.includes("bottleneck")?"bottleneck":"capacity")+":"+(dm||"?"));}catch{} } });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}); await sleep(1500);
await page.evaluate(()=>{window.history.pushState({},"","/v/project-sim");window.dispatchEvent(new PopStateEvent("popstate"));});
await sleep(3000);
// 选第一张订单(左列表)
let picked=false;
for (const sel of ['[data-testid="proj-order-list"] >> text=/SO-/', '[class*="proj-order"] >> text=/SO-/', 'text=/^SO-\\d+/']) {
  try { const el=page.locator(sel).first(); if(await el.count()){ await el.click(); picked=true; break; } } catch{}
}
console.log("选订单:", picked);
await sleep(7000); // capacity_forecast 跑+六步渲染
// 展开各步 + 点瓶颈矩阵
for (const t of ["瓶颈定位","瓶颈","驱动因子","结论"]) { try{ const e=page.locator(`text=${t}`).first(); if(await e.count()){ await e.click(); await sleep(500);} }catch{} }
await sleep(1500);
const body=(await page.locator("body").textContent())||"";
const est=(body.match(/估算/g)||[]).length, live=(body.match(/实测/g)||[]).length;
const snip=[...body.matchAll(/(估算[^，。,]{0,10}|实测[^，。,]{0,8})/g)].map(m=>m[0].trim()).slice(0,8);
await page.screenshot({ path:`${OUT}/projsim3.png`, fullPage:true });
console.log("驱动后: 估算",est,"实测",live,"| 片段",JSON.stringify(snip));
console.log("API dataMode:", JSON.stringify([...new Set(api)]));
await browser.close();
