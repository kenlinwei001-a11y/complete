import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").trim(); } catch { return "<缺>"; } };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
// 导航驾驶舱
await page.evaluate(() => { window.history.pushState({}, "", "/v/dash"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(4000);
const url = page.url();
const grid = await cnt('[data-testid="dashboard-grid"]');
console.log("=== 经营驾驶舱走查 ===");
console.log("URL:", url.replace(APP, ""), "| dashboard-grid:", grid);
// 2b AI栏
console.log("[2b] AI对话栏 dash-ai-bar:", await cnt('[data-testid="dash-ai-bar"]') ? "✓存在" : "✗无");
// #1 八根因
const probN = await cnt('[data-testid^="dash-problem-"]');
const probCats = await page.locator('[data-testid^="dash-problem-"]').evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") || "").replace("dash-problem-", "")));
console.log("[#1] 八根因 问题卡数:", probN, "(母版=8) 类目:", JSON.stringify(probCats));
// 2a 毛利勾稽
const ledger = await cnt('[data-testid="dash-order-ledger"]');
const ledgerTxt = await txt('[data-testid="dash-order-ledger"]');
const gmMatch = ledgerTxt.match(/综合毛利率[^%]*?(-?\d+\.?\d*)\s*%/) || ledgerTxt.match(/(-?\d+\.\d+)\s*pct/);
console.log("[2a] 订单台账:", ledger ? "✓" : "✗", "| 综合毛利率串:", gmMatch ? gmMatch[0] : "(未找到明显勾稽值)");
// KPI 卡数
const kpiCards = await cnt('[data-testid="dashboard-grid"] > *');
console.log("[#2] KPI 卡数:", kpiCards, "(母版=8)");
await page.screenshot({ path: `${OUT}/walk-dash.png`, fullPage: true });
// #2 悬停首个 KPI 看 provenance
let hoverTip = "<无>";
try {
  const firstKpi = page.locator('[data-testid="dashboard-grid"] > *').first();
  await firstKpi.hover(); await sleep(800);
  const body = (await page.locator("body").textContent()) || "";
  const m = body.match(/公式|来源系统|新鲜度|规则\s*C\d|provenance|provId/g);
  hoverTip = m ? [...new Set(m)].join(",") : "<悬停无 provenance 字样>";
} catch (e) { hoverTip = "hover err"; }
console.log("[#2] KPI 悬停 provenance 富度:", hoverTip);
// #3 点首个问题卡 → 下钻 DAG
let dagInfo = "<未点>";
try {
  const p0 = page.locator('[data-testid^="dash-problem-"]').first();
  if (await p0.count()) { await p0.click(); await sleep(3500); const body = (await page.locator("body").textContent()) || ""; const layers = (body.match(/驱动事件|event|反事实|排除|受影响订单|rootcause|根因/g) || []); dagInfo = "URL=" + page.url().replace(APP, "") + " 层字样:" + [...new Set(layers)].slice(0, 8).join(","); await page.screenshot({ path: `${OUT}/walk-dash-dag.png`, fullPage: true }); }
} catch (e) { dagInfo = "click err " + String(e).slice(0, 50); }
console.log("[#3] 问题卡下钻 DAG:", dagInfo);
await browser.close();
