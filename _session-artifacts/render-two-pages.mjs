import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2000);

// 持久化探测：登录后 auth 落在哪
const storeInfo = await page.evaluate(() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) }));
console.log("登录后 storage keys → localStorage:", storeInfo.ls.join(","), "| sessionStorage:", storeInfo.ss.join(","));

async function snap(label, path, file) {
  // SPA 客户端导航（不整页 reload·保留内存态 auth）
  await page.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
  await sleep(2800);
  const url = page.url();
  const bounced = url.includes("/login");
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  // 关键元素探测
  const has = async (sel) => (await page.locator(sel).count().catch(() => 0)) > 0;
  const btnTexts = await page.locator("button").allInnerTexts().catch(() => []);
  const svgNodes = await page.locator("svg").count().catch(() => 0);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
  console.log(`\n=== ${label} (${path}) ===`);
  console.log("  url:", url, bounced ? "⚠️掉登录" : "✓");
  console.log("  正文长度:", body.length, "| svg数:", svgNodes, "| 按钮数:", btnTexts.length);
  console.log("  按钮文本:", btnTexts.filter(Boolean).slice(0, 20).map((t) => t.replace(/\s+/g, "")).join(" | "));
  console.log("  含'管道/Pipeline/节点图/流程':", /管道|pipeline|节点图|流程图|工作流/i.test(body) ? "✓" : "✗无");
  console.log("  含'源表→处理→实体' 流水线语义:", /源表|数据源.*处理|处理.*实体|derive|suggest/i.test(body) ? "部分" : "✗");
  console.log("  正文片段:", body.replace(/\s+/g, " ").slice(0, 260));
}
await snap("本体建模 ModelingPage", "/admin/modeling", "cur-modeling.png");
await snap("推演沙盘 SimSandbox", "/v/sim-sandbox", "cur-sandbox.png");
console.log("\n控制台 error:", errs.length, errs.slice(0, 5));
await browser.close();
