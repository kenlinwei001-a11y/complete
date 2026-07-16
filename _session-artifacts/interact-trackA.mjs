import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
const toasts = [];
page.on("console", (m)=>{});
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}); await sleep(1500);
await page.evaluate(()=>{window.history.pushState({},"","/v/sim-sandbox");window.dispatchEvent(new PopStateEvent("popstate"));});
await page.waitForSelector('[data-testid="sandbox-tick-btn"]',{timeout:10000}); await sleep(2500);

// 1) tick a few times (propagation should move KPIs)
const kpiBefore = await page.locator("body").textContent();
for (let i=0;i<3;i++){ await page.click('[data-testid="sandbox-tick-btn"]'); await sleep(900); }
console.log("ticked 3x");

// 2) 北极星: branch -> refresh compare -> compare panel appears?
let branchClicked=false, compareShown=0;
try { await page.click('[data-testid="sandbox-branch-btn"]'); branchClicked=true; await sleep(2500);
  // tick on branch a bit then refresh compare
  await page.click('[data-testid="sandbox-tick-btn"]').catch(()=>{}); await sleep(900);
  const refresh = page.locator('[data-testid="sandbox-compare-refresh-btn"]');
  if (await refresh.count()) { await refresh.click(); await sleep(2000); }
  compareShown = await page.locator('[data-testid="sandbox-compare"]').count();
} catch(e){ console.log("branch err", String(e).slice(0,100)); }
console.log("branchClicked=",branchClicked," comparePanelShown=",compareShown);

// 3) RL4: adopt -> Action draft created?
let adoptClicked=false;
try { await page.click('[data-testid="sandbox-adopt-btn"]'); adoptClicked=true; await sleep(2500); } catch(e){ console.log("adopt err",String(e).slice(0,100)); }
console.log("adoptClicked=",adoptClicked);
await page.screenshot({ path:`${OUT}/trackA-after-interact.png`, fullPage:true });
await browser.close();
