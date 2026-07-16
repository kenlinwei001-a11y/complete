import pw from "/home/user/complete/node_modules/playwright-core/index.js";
import { readFileSync } from "node:fs";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const DID = readFileSync(`${OUT}/draftid.txt`, "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
const net = [];
page.on("response", (r) => { const u=r.url(); if (/action-draft|approve|decision/i.test(u)) net.push(`${r.request().method()} ${u.replace("http://127.0.0.1:4001","")} → ${r.status()}`); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}).catch(()=>{}); await sleep(2000);
console.log("UI 审批实测 draft:", DID);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/actions"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3000);

// 点该草稿行 → 打开详情
const row = page.locator(`[data-testid="draft-${DID}"]`).first();
console.log("找到草稿行:", (await row.count().catch(()=>0))?"✓":"✗");
await row.click().catch((e)=>console.log("row click err", String(e).slice(0,60)));
await sleep(1500);
const detail = page.locator('[data-testid="draft-detail"]');
console.log("详情面板打开:", (await detail.count().catch(()=>0))?"✓":"✗");

// 审批链两步：planner→admin。逐步 approve（每步：点 approve-btn → 二次确认）
for (let step=1; step<=2; step++){
  const approve = page.locator('[data-testid="approve-btn"]').first();
  const cnt = await approve.count().catch(()=>0);
  const dis = cnt ? await approve.isDisabled().catch(()=>true) : true;
  console.log(`步骤${step}: approve-btn 存在=${cnt?"✓":"✗"} disabled=${dis}`);
  if (!cnt || dis) break;
  await approve.click().catch(()=>{}); await sleep(800);
  // 二次确认：可能出现 comment 输入 + 确认按钮
  const confirmBtn = page.locator('button:has-text("确认"), button:has-text("确定"), [data-testid="confirm-approve"]').first();
  if (await confirmBtn.count().catch(()=>0)) { await confirmBtn.click().catch(()=>{}); console.log("  二次确认 ✓"); }
  await sleep(2500);
}
await page.screenshot({ path: `${OUT}/f4b-uiapprove.png`, fullPage: true });
const b = await page.locator("body").innerText().catch(()=>"");
console.log("页面含 EXECUTED/APPROVED:", /EXECUTED|APPROVED|已执行|已通过|审批已提交/i.test(b)?"✓":"?");
console.log("审批网络:", net.join(" | ") || "(无 approve/decision 调用)");
await browser.close();
console.log("截图: f4b-uiapprove");
