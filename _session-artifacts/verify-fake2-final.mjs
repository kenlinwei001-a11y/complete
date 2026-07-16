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
await page.evaluate(()=>{window.history.pushState({},"","/v/project-sim");window.dispatchEvent(new PopStateEvent("popstate"));});
await sleep(3000);
// 切"型号产能推演"模式(若有 chip)
for (const t of ["型号产能推演","型号产能","产能推演"]) { try{ const e=page.locator(`text=${t}`).first(); if(await e.count()){ await e.click(); await sleep(1500); break;} }catch{} }
await sleep(4000); // capacity_forecast 自动跑
// 点步骤⑤瓶颈定位 chip
for (const sel of ['[data-testid="pm-step5"]','text=瓶颈定位','text=瓶颈']) { try{ const e=page.locator(sel).first(); if(await e.count()){ await e.click(); await sleep(800);} }catch{} }
await sleep(1500);
const tightBadges = await page.locator('[data-testid^="pm-tight-mode-"]').count();
let tightTexts = [];
try { tightTexts = await page.locator('[data-testid^="pm-tight-mode-"]').allTextContents(); } catch {}
const b=(await page.locator("body").textContent())||"";
const est=(b.match(/估算/g)||[]).length, live=(b.match(/实测/g)||[]).length;
// 开瓶颈矩阵弹窗看 dataMode
try{ const m=page.locator('[data-testid="bn-matrix-open"], text=因素矩阵, text=瓶颈矩阵').first(); if(await m.count()){ await m.click(); await sleep(1500);} }catch{}
const b2=(await page.locator("body").textContent())||"";
const dm=(b2.match(/LIVE|MOCK/g)||[]);
await page.screenshot({path:`${OUT}/fake2-step5.png`,fullPage:true});
console.log("假2 步骤⑤: pm-tight-mode 徽章", tightBadges, "| 文本", JSON.stringify(tightTexts.slice(0,6)));
console.log("全页 估算", est, "实测", live, "| 矩阵弹窗 dataMode", JSON.stringify([...new Set(dm)]));
await browser.close();
