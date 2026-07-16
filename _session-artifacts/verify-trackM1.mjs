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

// === /v/risk 风险板块 ===
await spaGoto("/v/risk");
await sleep(4000);
const body = (await page.locator("body").textContent()) || "";
const estCount = (body.match(/估算/g) || []).length;
const liveCount = (body.match(/实测当前/g) || []).length;
const dmBadges = await page.locator('[data-testid^="risk-datamode-"]').count();
// 洛阳卡上下文：抓含"洛阳"附近的披露文字
const luoyang = body.includes("洛阳");
// 抓所有 "估算（实测当前 N）" / "实测当前 N" 片段
const snippets = [...body.matchAll(/(估算（实测当前\s*\d+）|实测当前\s*\d+)/g)].map(m=>m[1]).slice(0,8);
await page.screenshot({ path: `${OUT}/trackM1-risk.png`, fullPage: true });
console.log("RISK /v/risk: '估算'出现", estCount, "次 | '实测当前'", liveCount, "次 | risk-datamode 徽章", dmBadges, "个 | 含洛阳", luoyang);
console.log("披露片段:", JSON.stringify(snippets));

// === /v/project-sim 紧张度(假2) ===
await spaGoto("/v/project-sim");
await sleep(4000);
const pbody = (body2 => body2)(await page.locator("body").textContent() || "");
const pEst = (pbody.match(/估算/g) || []).length;
const pLive = (pbody.match(/实测/g) || []).length;
await page.screenshot({ path: `${OUT}/trackM1-projsim.png`, fullPage: true });
console.log("PROJECT-SIM: '估算'", pEst, "次 | '实测'", pLive, "次");
await browser.close();
