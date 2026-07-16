import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
const errs = [], net = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errs.push("PAGEERR: " + String(e).slice(0, 160)));
page.on("response", (r) => { const u=r.url(); if (/\/sim\/|\/propagat|tick|certif/i.test(u)) net.push(`${r.request().method()} ${u.replace("http://127.0.0.1:4001","")} → ${r.status()}`); });
const body = async () => (await page.locator("body").innerText().catch(()=>"")) || "";

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(()=>{}); await sleep(2200);

console.log("===== FLOW 3: 沙盘推演 =====");
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);
let b = await body();
console.log("沙盘页文本", b.replace(/\s+/g,"").length, "字 | 含推演/就绪/tick:", /推演|就绪|tick|Tick|检查点|传导|curTick|可运行/i.test(b)?"✓":"✗");
console.log("崩页:", /出错了|Something went wrong|ErrorBoundary/i.test(b)?"❌":"✓否");
await page.screenshot({ path: `${OUT}/f3-01-sandbox.png`, fullPage: true });

// 找「进入推演 / Trial Tick / 运行 / 推演」按钮
const btns = (await page.locator("button:visible").allInnerTexts().catch(()=>[])).map(t=>t.trim()).filter(Boolean);
console.log("可见按钮:", btns.slice(0,12).join(" · "));

// 优先点 Trial Tick（空跑1 tick）
const tick = page.locator('[data-testid="sim-cert-trial-tick"] button, [data-testid="sim-cert-trial-tick"], button:has-text("Trial Tick"), button:has-text("空跑"), button:has-text("推演"), button:has-text("运行"), button:has-text("进入推演")').first();
if (await tick.count().catch(()=>0)) {
  console.log("点 Trial Tick / 推演 按钮…");
  await tick.click().catch((e)=>console.log("click err", String(e).slice(0,80)));
  await sleep(4000);
  b = await body();
  console.log("tick 后文本", b.replace(/\s+/g,"").length, "字 | 含 tick/Δ/传导/结果:", /tick|Δ|传导|影响|结果|完成|快照|curTick|已运行/i.test(b)?"✓":"?");
  await page.screenshot({ path: `${OUT}/f3-02-aftertick.png`, fullPage: true });
} else {
  console.log("⚠️ 未找到 Trial Tick/推演 按钮");
}
console.log("沙盘网络:", net.slice(0,8).join(" | ") || "(无 sim 调用)");
console.log("控制台err:", errs.length); errs.slice(0,3).forEach(e=>console.log("  "+e));
await browser.close();
console.log("截图: f3-01-sandbox · f3-02-aftertick");
