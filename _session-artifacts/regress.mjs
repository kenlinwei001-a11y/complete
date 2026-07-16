import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(3000);

async function checkConsole(label) {
  // 等卡片(token门)出现，最多 ~12s
  let cards = 0;
  for (let i = 0; i < 24; i++) { cards = await cnt('[data-testid^="pc-agent-card-"]'); if (cards > 0) break; await sleep(500); }
  const consoleN = await cnt('[data-testid="platform-console"]');
  const tabs = await cnt('[data-testid^="platform-console-tab-"]');
  // 点图查询 tab 看 RESERVED
  let graphReserved = 0;
  try { await page.locator('[data-testid="platform-console-tab-图查询"]').click({ timeout: 2000 }); await sleep(800); graphReserved = await cnt('[data-testid="pc-graphquery-reserved"]'); } catch {}
  // Skills tab
  let skills = "?";
  try { await page.locator('[data-testid="platform-console-tab-Skills"]').click({ timeout: 2000 }); await sleep(1000); const real = await cnt('[data-testid^="pc-skill-"]'); const err = await cnt('[data-testid="pc-skills-err"]'); skills = real ? `真技能${real}` : (err ? "诚实降级" : "空/加载"); } catch {}
  console.log(`[${label}] PlatformConsole:${consoleN} | 6tab:${tabs} | Agent卡(token门):${cards} | 图查询RESERVED:${graphReserved?"✓":"✗"} | Skills:${skills}`);
  return { consoleN, tabs, cards, graphReserved };
}

// 轨P ModelingPage 回归
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(4000);
console.log("=== 回归复验（PlatformConsole 去重后）===");
console.log("[轨P ModelingPage] DAG:", await cnt('[data-testid="modeling-pipeline-dag"]') ? "✓" : "✗", "| 就绪认证:", await cnt('[data-testid="modeling-readiness"]') ? "✓" : "✗");
await checkConsole("轨P ModelingPage");
await page.screenshot({ path: `${OUT}/regress-modeling.png`, fullPage: true });

// 轨Q SandboxView 回归
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(5000);
console.log("[轨Q SandboxView] 风险TOP3:", await cnt('[data-testid="sandbox-risk-top3"]') ? "✓" : "✗", "| Schema规则:", await cnt('[data-testid="sandbox-schema-rules"]') ? "✓" : "✗", "| 评估清单(就绪认证):", await cnt('[data-testid="sandbox-runstate-step"]') ? "✓" : "✗");
await checkConsole("轨Q SandboxView");
await page.screenshot({ path: `${OUT}/regress-sandbox.png`, fullPage: true });
await browser.close();
