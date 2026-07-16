import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errs.push("PAGEERR: " + String(e).slice(0, 200)));
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/\/v1\/queries/.test(u)) {
    let extra = "";
    try { if (r.request().method() === "POST") { const j = await r.json(); extra = JSON.stringify(j).slice(0, 160); } } catch {}
    net.push(`${r.request().method()} ${u.replace("http://127.0.0.1:4002","").replace(APP,"")} → ${r.status()} ${extra}`);
  }
});
const bodyText = async () => (await page.locator("body").innerText().catch(()=>"")) || "";

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(()=>{}); await sleep(2500);
console.log("LOGIN →", page.url());

// ===== A) 场景卡路径（G-3 启动器·preset 触发问句）=====
console.log("\n===== A) 高频场景卡: 交期风险与受影响订单（问句: 常州基地影响哪些订单？）=====");
const card = page.locator('text=交期风险与受影响订单').first();
console.log("找到场景卡:", (await card.count().catch(()=>0)) ? "✓" : "✗");
await card.click().catch((e)=>console.log("card click err", String(e).slice(0,80)));
await sleep(1500);
// 卡片点开后可能出现 ▶启动 按钮
const runBtn = page.locator('button:has-text("启动"), button:has-text("▶"), button:has-text("推演"), button:has-text("提交")').first();
if (await runBtn.count().catch(()=>0)) { console.log("点 ▶启动…"); await runBtn.click().catch(()=>{}); }
console.log("提交后 URL:", page.url());

let final = "", lastLen = 0;
for (let i = 0; i < 28; i++) {  // ~84s
  await sleep(3000);
  final = await bodyText();
  const len = final.replace(/\s+/g,"").length;
  if (len !== lastLen) {
    const sig = /已完成|完成|结论|建议|证据|来源|失败|错误|分类|路径|工作流|步骤|思考|生成中|运行中/i.test(final);
    console.log(`  [t+${(i+1)*3}s] ${len}字 ${sig?"(状态/答案词)":""}`);
    lastLen = len;
  }
  if (/出错了|Something went wrong|ErrorBoundary|页面崩溃/i.test(final)) { console.log("  ❌ 崩页!"); break; }
  if (i>=4 && /已完成|完成|失败|错误|结论|采纳|证据链/i.test(final)) { /* likely done, keep a couple more ticks */ if (i>=8) break; }
}
await page.screenshot({ path: `${OUT}/f2-A-scenario.png`, fullPage: true });
console.log("场景卡网络:", net.slice(0,5).join(" | ") || "(无 queries 调用!)");
console.log("崩页:", /出错了|Something went wrong|ErrorBoundary/i.test(final)?"❌":"✓否", "| 控制台err:", errs.length);

// ===== B) 自由问句（进业务视图→QueryDock bar→真 Kimi）=====
console.log("\n===== B) 自由真问句（经营驾驶舱视图内 QueryDock → 真 Kimi）=====");
net.length = 0; errs.length = 0;
await page.evaluate(() => { window.history.pushState({}, "", "/v/dashboard"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3000);
const dock = page.locator('[data-testid="query-dock-bar"] input, input[aria-label="查询输入"]').first();
console.log("视图内找到 QueryDock 输入:", (await dock.count().catch(()=>0)) ? "✓" : "✗");
const Q = "常州基地在途批次库存覆盖天数偏低，哪些设备检修计划会加剧交付风险？";
await dock.click().catch(()=>{}); await dock.fill(Q).catch(()=>{}); await dock.press("Enter").catch(()=>{});
console.log("自由问句已提交:", Q);
lastLen = 0; final = "";
for (let i = 0; i < 28; i++) {
  await sleep(3000);
  final = await bodyText();
  const len = final.replace(/\s+/g,"").length;
  if (len !== lastLen) { console.log(`  [t+${(i+1)*3}s] ${len}字`); lastLen = len; }
  if (/出错了|Something went wrong|ErrorBoundary/i.test(final)) { console.log("  ❌ 崩页!"); break; }
  if (i>=5 && /已完成|完成|失败|错误|结论|证据/i.test(final) && i>=9) break;
}
await page.screenshot({ path: `${OUT}/f2-B-freeform.png`, fullPage: true });
console.log("自由问句网络:", net.slice(0,6).join(" | ") || "(无 queries 调用!)");
console.log("崩页:", /出错了|Something went wrong|ErrorBoundary/i.test(final)?"❌":"✓否", "| 控制台err:", errs.length);
errs.slice(0,3).forEach(e=>console.log("   "+e));
await browser.close();
console.log("\n截图: f2-A-scenario · f2-B-freeform");
