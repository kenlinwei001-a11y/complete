import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").trim(); } catch { return "<缺>"; } };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(5000);
console.log("=== 轨Q · SandboxView 走查 ===");
console.log("URL:", page.url().replace(APP, ""));
const errState = await cnt('[data-testid="siminit-config-error"], .empty-state');
// 增量4a 风险TOP3
console.log("\n[增量4a] 风险TOP3 (oracle: 洛阳人力92 MOCK/瓶颈91 LIVE/物料90 MOCK):");
console.log("  面板:", await cnt('[data-testid="sandbox-risk-top3"]') ? "✓" : "✗");
for (let i = 0; i < 3; i++) {
  const card = await txt(`[data-testid="sandbox-risk-${i}"]`);
  const dm = await txt(`[data-testid="sandbox-risk-datamode-${i}"]`);
  console.log(`  卡${i}: ${card.replace(/\s+/g, " ").slice(0, 30)} | dataMode标: ${dm}`);
}
// 增量2 运行台
console.log("\n[增量2] 运行台:");
console.log("  Schema规则面板:", await cnt('[data-testid="sandbox-schema-rules"]') ? "✓" : "✗", "| 规则条数:", await cnt('[data-testid^="sandbox-schema-rule-"]'));
console.log("  阶段标RESERVED:", await cnt('[data-testid="sandbox-schema-phase-reserved"]') ? "✓" : "✗");
console.log("  状态条 Step:", await txt('[data-testid="sandbox-runstate-step"]'), "| 诞生规则:", await txt('[data-testid="sandbox-runstate-rules"]'));
// 增量3 双雷达/评估
console.log("\n[增量3] 评估/双雷达:");
const body = (await page.locator("body").textContent()) || "";
console.log("  健康雷达字样:", /健康雷达|6\s*维|规则覆盖|可观测/.test(body) ? "✓" : "✗", "| 信任雷达:", /信任雷达|Runtime|Explainability|Reserved/.test(body) ? "✓" : "✗");
console.log("  综合分/轴值图例:", /综合分|轴值/.test(body) ? "✓" : "✗");
// 增量4b console
console.log("\n[增量4b] PlatformConsole:");
console.log("  console:", await cnt('[data-testid="platform-console"], [data-testid="sandbox-console"]') ? "✓" : "✗");
console.log("  图查询RESERVED:", /图查询.*RESERVED|RESERVED.*图查询/.test(body) ? "✓" : "✗");
console.log("  Agent场景卡:", await cnt('[data-testid^="pc-agent-card-"]'), "张");
await page.screenshot({ path: `${OUT}/q-sandbox.png`, fullPage: true });
console.log("\nconsole errors/empty:", errState);
await browser.close();
