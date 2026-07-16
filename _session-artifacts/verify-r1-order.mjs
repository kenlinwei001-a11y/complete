import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").trim().replace(/\s+/g, " "); } catch { return "<缺>"; } };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.evaluate(() => { window.history.pushState({}, "", "/v/project-sim"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(4500);
console.log("=== 轨R 增量1 #7 · 订单驱动三关联判 走查 ===");
// 型号六步 additive 未破坏
const sixStep = /场景解析|可产基地|驱动因子|逐级聚合|瓶颈定位|结论与对策/.test((await page.locator("body").textContent()) || "");
console.log("型号六步(additive未破坏):", sixStep ? "✓在" : "✗缺");
// 选订单 SO-3391
let clicked = false;
for (const sel of [`text=SO-3391`, `[data-testid*="SO-3391"]`, `tr:has-text("SO-3391")`, `:has-text("SO-3391")`]) {
  try { const l = page.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 2000 }); clicked = true; break; } } catch {}
}
console.log("点 SO-3391:", clicked ? "✓" : "✗");
await sleep(3500); // 等 order_fullchain 求解
const panel = await cnt('[data-testid="proj-order-verdict"]');
const bar = await txt('[data-testid="proj-order-verdict-bar"]');
const capV = await txt('[data-testid="proj-judge-cap-verdict"]');
const kitV = await txt('[data-testid="proj-judge-kit-verdict"]');
const finV = await txt('[data-testid="proj-judge-fin-verdict"]');
const body = (await page.locator('[data-testid="proj-order-verdict"]').textContent().catch(() => "")) || "";
const rules = [...new Set((body.match(/C\d{2}/g) || []))];
const has = (s) => body.includes(s);
await page.screenshot({ path: `${OUT}/r1-order-verdict.png`, fullPage: true });
console.log("\nOrderVerdictPanel:", panel ? "✓" : "✗");
console.log("裁决 bar:", bar, "(oracle 不建议接)");
console.log("①交期判 verdict:", capV, "(oracle 可达) | P50 2100:", has("2100") ? "✓" : "✗", "| P90 1890:", has("1890") ? "✓" : "✗");
console.log("②齐套判 verdict:", kitV, "(oracle 缺料) | 654吨:", has("654") ? "✓" : "✗", "| 三元正极:", has("三元正极") ? "✓" : "✗", "| 2026-06-28:", has("2026-06-28") ? "✓" : "✗");
console.log("③财务判 verdict:", finV, "(oracle 信用阻断) | 占用1.15:", has("1.15") ? "✓" : "✗");
console.log("RuleRef 芯片(去重):", JSON.stringify(rules), "(oracle 7: C02/C03/C06/C16/C15/C13/C18)");
console.log("对冲条数文字:", has("对冲") ? "✓有对冲块" : "✗", "| conds命中:", [has("信用占用超限"), has("缺口 654")].filter(Boolean).length);
await browser.close();
