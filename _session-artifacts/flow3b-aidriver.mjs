import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
const net = [];
page.on("response", (r) => { const u=r.url(); if (/sim|tick|propagat/i.test(u) && /a\/v1/.test(u)) net.push(`${r.request().method()} ${u.replace("http://127.0.0.1:4001","")} → ${r.status()}`); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}).catch(()=>{}); await sleep(2000);
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);

// 读取「全局态 (tick N)」初值
const tickLabel = async () => { const t = await page.locator('text=/全局态.*tick/').first().innerText().catch(()=>""); return t.replace(/\s+/g," "); };
console.log("初始:", await tickLabel());

// AI 指挥台：填「推进 5 个 tick」→ 执行
const aiInput = page.locator('input[placeholder*="推进"], input[placeholder*="tick"], textarea[placeholder*="推进"]').first();
console.log("AI 指挥台输入框:", (await aiInput.count().catch(()=>0))?"✓":"✗");
await aiInput.fill("推进 5 个 tick").catch(()=>{});
const exec = page.locator('button:has-text("执行")').first();
await exec.click().catch((e)=>console.log("执行 click err", String(e).slice(0,60)));
console.log("点执行，等待确定性推进…");
for (let i=0;i<10;i++){ await sleep(1500); const lbl=await tickLabel(); if (!/tick 0/.test(lbl)) { console.log(`  推进到: ${lbl}`); break; } }
await sleep(1500);
console.log("最终:", await tickLabel());
console.log("sim 网络:", net.slice(-6).join(" | ") || "(无 sim tick 调用)");
await page.screenshot({ path: `${OUT}/f3b-aidriver.png`, fullPage: true });
await browser.close();
console.log("截图: f3b-aidriver");
