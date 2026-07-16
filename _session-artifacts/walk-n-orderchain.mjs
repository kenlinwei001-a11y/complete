import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1500 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").replace(/\s+/g, " ").trim(); } catch { return "<缺>"; } };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
// 进 订单全链聚合
let nav = false;
for (const sel of ['text=订单全链聚合', 'a:has-text("订单全链")', '[href*="order-chain"]']) {
  try { const l = page.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 2500 }); nav = true; break; } } catch {}
}
await sleep(4500);
console.log("=== 轨N · 订单全链聚合(OrderChainView) 走查 ===");
console.log("点导航:", nav ? "✓" : "✗", "| URL:", page.url().replace(APP, ""));
// 若三判表未出，点一个订单行触发 order_fullchain
const hasJudge = (await page.locator('body').textContent() || "").match(/①交期|交期·产能/);
if (!hasJudge) {
  for (const sel of ['tr:has-text("SO-")', 'text=/SO-\\d+/', '[data-testid*="SO-"]']) {
    try { const l = page.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 2000 }); console.log("点订单行触发三判"); break; } } catch {}
  }
  await sleep(3500);
}
// 增量1: 三判规则号是否 RuleRef(非裸文本)
const body = (await page.locator("body").textContent()) || "";
console.log("\n[增量1·C02铁证] 三判表:", /①交期|交期·产能/.test(body) ? "✓在" : "✗缺");
const rulerefAnchors = await cnt('[data-testid^="ruleref-"]');
console.log("  RuleRef 锚点数(ruleref-*):", rulerefAnchors, rulerefAnchors > 0 ? "✓(非裸文本)" : "✗");
// Provenance on judges (增量1 N-N1)
for (const j of ["cap", "kit", "fin"]) {
  const prov = await cnt(`[data-testid="prov-v-ofc-judge-${j}"]`);
  console.log(`  判[${j}] Provenance(ofc-judge-${j}):`, prov ? "✓" : "✗");
}
// 增量1+2: 悬浮第一个 RuleRef → 真定义 + 谁设定/时间/边界
const rr = page.locator('[data-testid^="ruleref-"]').first();
if (await rr.count()) {
  const code = await rr.getAttribute("data-testid");
  await rr.scrollIntoViewIfNeeded().catch(()=>{});
  await rr.hover({ force: true }); await sleep(900);
  const pop = (await txt('[data-testid="ruleref-pop"]'));
  console.log("\n[增量1] 悬", code, "→ ruleref-pop:", pop.slice(0, 120));
  console.log("  含真定义(表达式/severity/作用域):", /BLOCK|WARN|作用域|阈值|>|</.test(pop) ? "✓" : "✗", "| 未找到定义(造假征兆):", /未找到定义/.test(pop) ? "⚠️有" : "无");
  // 增量2 谁设定/时间/边界
  const provN = await cnt('[data-testid^="ruleref-prov-"]');
  const provTxt = await txt('[data-testid^="ruleref-prov-"]');
  console.log("[增量2·U4] ruleref-prov-*:", provN ? "✓" : "✗", "|", provTxt.slice(0, 120));
  console.log("  谁设定(系统治理基线·不编造人名):", /系统治理基线/.test(provTxt) ? "✓" : "✗", "| 有效区间:", /有效区间/.test(provTxt) ? "✓" : "✗", "| 依据:", /依据/.test(provTxt) ? "✓" : "✗");
}
await page.screenshot({ path: `${OUT}/n-orderchain.png`, fullPage: true });
console.log("\n截图 n-orderchain.png");
await browser.close();
