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
page.on("response", (r) => { const u=r.url(); if (/action-draft|\/actions|approve|reject|decision|queries/i.test(u)) net.push(`${r.request().method()} ${u.replace("http://127.0.0.1:4001","").replace("http://127.0.0.1:4002","")} → ${r.status()}`); });
const body = async () => (await page.locator("body").innerText().catch(()=>"")) || "";

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(()=>{}); await sleep(2200);

console.log("===== FLOW 4: Action 审批流（写回→草稿→审批→执行）=====");
console.log("\n--- 步骤1: 触发「处置方案采纳·写回」场景生成 Action 草稿 ---");
const card = page.locator('text=处置方案采纳').first();
console.log("找到写回场景卡:", (await card.count().catch(()=>0))?"✓":"✗");
await card.click().catch(()=>{}); await sleep(1500);
const runBtn = page.locator('button:has-text("启动"), button:has-text("▶"), button:has-text("采纳"), button:has-text("提交"), button:has-text("推演")').first();
if (await runBtn.count().catch(()=>0)) { await runBtn.click().catch(()=>{}); console.log("点启动/采纳"); }
console.log("URL:", page.url());
// 等写回完成（SSE 跑完→生成 action 草稿）
for (let i=0;i<16;i++){ await sleep(3000); const b=await body(); if (/已完成|完成|写回|草稿|待审|生成|action|审批/i.test(b) && i>=3) break; }
await page.screenshot({ path: `${OUT}/f4-01-writeback.png`, fullPage: true });
console.log("写回网络:", net.slice(0,6).join(" | "));

console.log("\n--- 步骤2: 去 Action 审批页看待审草稿 ---");
net.length=0;
await page.evaluate(() => { window.history.pushState({}, "", "/admin/actions"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3000);
let b = await body();
const rows = await page.locator('table tbody tr, li, [class*="card"]').count().catch(()=>0);
console.log("审批页 行/卡:", rows, "| 含 PENDING_APPROVAL/待审:", /PENDING_APPROVAL|待审|审批/i.test(b)?"✓":"✗");
console.log("审批页网络:", net.slice(0,4).join(" | "));
await page.screenshot({ path: `${OUT}/f4-02-actionlist.png`, fullPage: true });

console.log("\n--- 步骤3: 打开草稿 → 审批(approve) ---");
net.length=0;
// 点第一条草稿打开详情
const firstDraft = page.locator('table tbody tr, li[role="button"], [data-testid^="action"], a').first();
await firstDraft.click().catch(()=>{}); await sleep(1800);
const approveBtn = page.locator('[data-testid="approve-btn"], button:has-text("批准"), button:has-text("通过"), button:has-text("审批")').first();
const hasApprove = await approveBtn.count().catch(()=>0);
const disabled = hasApprove ? await approveBtn.isDisabled().catch(()=>false) : null;
console.log("审批按钮:", hasApprove?"✓存在":"✗", hasApprove?`(disabled=${disabled})`:"");
if (hasApprove && !disabled) {
  await approveBtn.click().catch(()=>{}); await sleep(1200);
  // 二次确认
  const confirm = page.locator('button:has-text("确认"), button:has-text("确定"), [data-testid="confirm"]').first();
  if (await confirm.count().catch(()=>0)) { await confirm.click().catch(()=>{}); console.log("二次确认"); }
  await sleep(2500);
  b = await body();
  console.log("审批后状态含 APPROVED/EXECUTED:", /APPROVED|EXECUTED|已批准|已执行|已通过/i.test(b)?"✓":"?");
}
console.log("审批网络:", net.slice(0,6).join(" | "));
await page.screenshot({ path: `${OUT}/f4-03-approved.png`, fullPage: true });
console.log("控制台err:", errs.length); errs.slice(0,3).forEach(e=>console.log("  "+e));
await browser.close();
console.log("截图: f4-01-writeback · f4-02-actionlist · f4-03-approved");
