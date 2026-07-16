import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
let qReqRaw = null, qStatus = null, qErr = null;
page.on("request", (r) => { if (r.url().includes("/b/v1/queries") && r.method() === "POST") { qReqRaw = r.postData(); } });
page.on("response", async (r) => { if (r.url().includes("/b/v1/queries") && r.request().method() === "POST" && !r.url().includes("/events")) { qStatus = r.status(); try { qErr = await r.text(); } catch {} } });

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);
// 自由文本路径（与点卡同走 quickLaunch·同样的 packageId）
await page.locator('[data-testid="modeling-agent-input"]').fill("测试QOS提交");
await page.locator('[data-testid="modeling-agent-send"]').click();
await sleep(2500);
console.log("=== 浏览器真实 POST /b/v1/queries 载荷 ===");
let pkg = "(未解析)", pkgType = "?";
if (qReqRaw) { try { const j = JSON.parse(qReqRaw); pkg = JSON.stringify(j.packageId); pkgType = typeof j.packageId; } catch {} }
console.log("packageId 实值:", pkg, "| 类型:", pkgType);
console.log("POST 响应 HTTP:", qStatus);
console.log("响应体:", (qErr || "").slice(0, 160));
console.log("→ 判定:", pkgType === "object" ? "❌ 前端发对象 packageId(useScenarioLaunch.ts 仍没取.id)" : (pkgType === "string" ? "✓ 字符串" : "?"),
  qStatus === 400 || qStatus === 404 ? `→ 后端拒(${qStatus})·QOS未跑·端到端断` : (qStatus === 202 ? "→ 202 真通" : ""));
await browser.close();
