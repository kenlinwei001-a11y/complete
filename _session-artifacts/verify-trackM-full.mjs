import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}); await sleep(1500);
async function go(r){ await page.evaluate((x)=>{window.history.pushState({},"",x);window.dispatchEvent(new PopStateEvent("popstate"));}, r); await sleep(3500); }
const cnt = (b,re)=> (b.match(re)||[]).length;
const snip = (b,re,n=5)=> [...b.matchAll(re)].map(m=>m[0].trim().slice(0,40)).slice(0,n);

// 假1 /v/risk
await go("/v/risk");
let b = (await page.locator("body").textContent())||"";
console.log("[假1 /v/risk] 估算:",cnt(b,/估算/g)," 实测:",cnt(b,/实测/g)," 徽章:",await page.locator('[data-testid^="risk-datamode-"]').count());
await page.screenshot({path:`${OUT}/M-risk.png`,fullPage:true});

// 假3 /v/order-chain
await go("/v/order-chain");
b = (await page.locator("body").textContent())||"";
console.log("[假3 /v/order-chain] 含库存/在制/成品:",/库存|在制|成品|原料/.test(b)," 估算标:",cnt(b,/估算/g)," 片段:",JSON.stringify(snip(b,/(估算[^，。,]{0,12})/g)));
await page.screenshot({path:`${OUT}/M-orderchain.png`,fullPage:true});

// 假4 + 3a /v/plan-audit
await go("/v/plan-audit");
b = (await page.locator("body").textContent())||"";
console.log("[假4+3a /v/plan-audit] 反事实/排除:",cnt(b,/反事实|排除|已排除|反算达标/g)," 击穿/敞口:",cnt(b,/击穿|敞口/g)," 估算:",cnt(b,/估算/g)," 排除片段:",JSON.stringify(snip(b,/((已)?排除[^，。,]{0,14}|反算达标[^，。,]{0,10})/g)));
await page.screenshot({path:`${OUT}/M-planaudit.png`,fullPage:true});

// 3a /v/dashboard 问题 DAG
await go("/v/dashboard");
b = (await page.locator("body").textContent())||"";
console.log("[3a /v/dashboard] 反事实/排除:",cnt(b,/反事实|排除|已排除/g));
await page.screenshot({path:`${OUT}/M-dashboard.png`,fullPage:true});
await browser.close();
