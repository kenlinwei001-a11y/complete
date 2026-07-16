import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").trim(); } catch { return "<缺>"; } };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-init"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(4000);
console.log("=== 轨Q 增量1 · SimInitWizard 走查 ===");
console.log("URL:", page.url().replace(APP, ""));
const errState = await cnt('[data-testid="siminit-config-error"]');
if (errState) console.log("⚠ 配置错误态:", await txt('[data-testid="siminit-config-error"]'));
await page.screenshot({ path: `${OUT}/q1-step0.png`, fullPage: true });
// 逐步点 next 直到蓝环出现（最多 5 次）
for (let i = 0; i < 5; i++) {
  if (await cnt('[data-testid="siminit-completeness-ring"]')) break;
  // 优先点带 testid 的 next；否则点文字按钮
  const nextBtns = ['[data-testid="siminit-next-range"]', '[data-testid^="siminit-next"]', 'button:has-text("预检范围")', 'button:has-text("下一步")'];
  let clicked = false;
  for (const sel of nextBtns) { const b = page.locator(sel).first(); if (await b.count()) { try { await b.click({ timeout: 1500 }); clicked = true; break; } catch {} } }
  if (!clicked) { console.log("  step", i, "无 next 按钮可点"); break; }
  await sleep(2500);
}
// RESERVED 行（在范围步）
const reservedRange = await cnt('[data-testid="siminit-range-reserved"]');
// 预检步抽取
const ring = await cnt('[data-testid="siminit-completeness-ring"]');
const ringPct = await txt('[data-testid="siminit-completeness"]');
const ringFill = await cnt('[data-testid="siminit-completeness-ring-fill"]');
const wcStatevars = await txt('[data-testid="siminit-wc-statevars"]');
const selectedTypes = await txt('[data-testid="siminit-selected-types"]');
// 4 条进度条 + 进入清单（按 SimViews 结构找 entering）
const summary = await txt('[data-testid="siminit-precheck-summary"]');
const enteringItems = await cnt('[data-testid^="siminit-entering-"]');
const body = (await page.locator("body").textContent()) || "";
const enteringHdr = (body.match(/将进入沙盘的状态变量[^）]*（?\s*(\d+)/) || body.match(/进入.{0,6}?(\d+)\s*条/) || [])[1] || "?";
await page.screenshot({ path: `${OUT}/q1-precheck.png`, fullPage: true });
console.log("蓝环存在:", ring, "| 环fill:", ringFill, "| 环%:", ringPct, "(oracle 35%)");
console.log("4条summary块:", summary.slice(0, 80));
console.log("状态变量条:", wcStatevars, "(oracle 0/11)");
console.log("已选范围:", selectedTypes);
console.log("RESERVED行(范围步):", reservedRange ? "✓存在" : "✗");
console.log("进入清单条数(testid):", enteringItems, "| 标题数:", enteringHdr, "(oracle 12)");
await browser.close();
