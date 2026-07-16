import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1150 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errs.push("PAGEERR: " + String(e).slice(0, 160)));

// ---- login ----
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(() => {});
await sleep(2000);
console.log("LOGIN →", page.url());

const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2600); };
const body = async () => (await page.locator("body").innerText().catch(() => "")) || "";
const crash = (b) => /出错了|Something went wrong|页面崩溃|ErrorBoundary|TypeError|undefined is not|Cannot read/i.test(b);
const env4 = (b) => /\{"error"|VALIDATION_ERROR|INTERNAL_ERROR|"code":/i.test(b);

const probe = async (path, label) => {
  errs.length = 0;
  await nav(path);
  const b = await body();
  const len = b.replace(/\s+/g, "").length;
  const rows = await page.locator('table tbody tr, [role="row"], li[data-testid], .card, [class*="card"]').count().catch(() => 0);
  const btns = (await page.locator("button:visible").allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
  const tag = crash(b) ? "❌崩页" : env4(b) && len < 400 ? "❌错误信封占满" : len < 80 ? "⚠️空白" : "✓渲染";
  console.log(`\n[${label}] ${path}  → ${tag} | 文本${len}字 | 行/卡${rows} | 控制台err${errs.length}`);
  console.log("   按钮:", btns.slice(0, 8).join(" · ") || "(无可见按钮)");
  if (errs.length) console.log("   ⚠️console:", errs.slice(0, 2).join(" || "));
  await page.screenshot({ path: `${OUT}/f1-${label}.png`, fullPage: true }).catch(() => {});
  return { b, rows, btns, len, tag };
};

console.log("\n========== FLOW 1: 数据接入全链 ==========");
await probe("/admin/connections", "01-连接器");
await probe("/admin/source-overview", "02-数据源总览");
await probe("/admin/rule-docs", "03-规则文档抽取");
await probe("/admin/data-builder", "04-数据构建");
const md = await probe("/admin/modeling", "05-本体建模");
const sl = await probe("/admin/slices", "06-切片库");
const ot = await probe("/admin/object-types", "07-对象类型");

// 关键端到端可见性：对象浏览器是否真有对象（数据接入的落点）
console.log("\n--- 端到端落点核对：对象浏览器 ---");
// 尝试点开第一个对象类型，看是否能进对象列表
const firstType = await page.locator('a[href*="/o/"], [data-testid^="objtype"], table tbody tr a').first();
const hasObjLink = (await firstType.count().catch(() => 0)) > 0;
console.log("   对象类型页有可点进对象的链接:", hasObjLink ? "✓" : "✗（无法从UI进对象浏览器）");

console.log("\n=== FLOW 1 汇总 ===");
console.log("切片库:", sl.tag, "行/卡", sl.rows, "| 对象类型:", ot.tag, "行/卡", ot.rows, "| 建模:", md.tag);
await browser.close();
console.log("\n截图: f1-01..07");
