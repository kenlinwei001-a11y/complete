import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").replace(/\s+/g, " ").trim(); } catch { return "<缺>"; } };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.locator('text=经营驾驶舱').first().click().catch(() => {});
await sleep(4500);
console.log("=== M1/M2/M7 真浏览器复验 ===");
// M1 BoardHeader 统计条
console.log("\n[M1] 页头统计条:");
console.log("  board-header 存在:", await cnt('[data-testid="board-header"]') ? "✓" : "✗");
for (const lab of ["对象", "关系", "求解器", "智能体", "数据域"]) {
  console.log(`  ${lab}:`, await txt(`[data-testid="board-stat-${lab}"]`));
}
console.log("  周期:", await txt('[data-testid="board-period"]'), "| 版本徽:", await cnt('[data-testid="board-version"]') ? "✓" : "✗");
// M7 利用率(应 ~77.6% 非 0.78%)
console.log("\n[M7] 利用率格式:");
const body = (await page.locator("body").textContent()) || "";
const utilMatch = body.match(/平均利用率[\s\S]{0,40}?([\d.]+)\s*%/);
const hasOld = /0\.7\d\s*%|0\.9\d(?!\d)/.test(body);
console.log("  body 含 '77.' 或 '78%':", /77\.|78\s*%|7\d\.\d\s*%/.test(body) ? "✓(已×100)" : "?", "| 含旧 '0.78%'/'0.91':", hasOld ? "⚠️仍有" : "✓无");
// 直接读 util KPI 卡
const utilKpi = await txt('[data-testid="widget-util"], [data-testid*="util"]');
console.log("  平均利用率卡:", utilKpi.slice(0, 40));
// M2 DomainLegend
console.log("\n[M2] 14数据域图例:");
const toggled = await page.locator('[data-testid="board-domain-toggle"]').first().click().catch(() => false);
await sleep(1200);
const legend = await cnt('[data-testid="domain-legend"]');
const domains = await cnt('[data-testid^="domain-legend-"]');
console.log("  点数据域toggle → domain-legend:", legend ? "✓展开" : "✗", "| 域块数:", domains, "(oracle 14)");
console.log("  首个域块文本:", await txt('[data-testid^="domain-legend-"]'));
await page.screenshot({ path: `${OUT}/m-verify.png`, fullPage: false });
console.log("\n截图 m-verify.png");
await browser.close();
