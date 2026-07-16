import { chromium } from "playwright-core";
import fs from "node:fs";

const EV = "/home/user/complete/docs/evidence";
const BASE = "http://127.0.0.1:5205";
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
const page = await ctx.newPage();

const consoleErrors = [];
const failedReqs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));
page.on("requestfailed", (r) => failedReqs.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));

// 1. LOGIN
log("=== navigating to app ===");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForSelector("#login-username", { timeout: 15000 });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("#login-password", "demo1234");
await page.screenshot({ path: `${EV}/usability-realrun-00-login.png` });
await page.click("button[type=submit]");
await page.waitForTimeout(3500);
log("after login url:", page.url());

// 2. GO TO SANDBOX
log("=== navigating to /v/sim-sandbox ===");
await page.goto(BASE + "/v/sim-sandbox", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
await page.waitForSelector('[data-testid="sandbox-tick-btn"]', { timeout: 20000 }).catch(()=>log("!! tick btn not found"));

// 3. SCREENSHOT open state
await page.screenshot({ path: `${EV}/usability-realrun-01-sandbox-open.png`, fullPage: true });

// 4. Extract cert / gate text
const bodyText1 = await page.evaluate(() => document.body.innerText);
const findLines = (txt, kw) => [...new Set(txt.split("\n").map(s=>s.trim()).filter(s => s && kw.some(k=>s.includes(k))))];
log("\n=== GATE / CERT text on open ===");
for (const l of findLines(bodyText1, ["暂不可进入","可进入推演","未就绪","L1_CONFIGURED","L0_","L2_","L3_","L4_","就绪认证","缺件","缺口","forward","FORWARD","scope 类型"])) log("  |", l);

const canEnterTxt = await page.locator('[data-testid="sim-cert-canenter"]').first().innerText().catch(()=>"(not found)");
log("sim-cert-canenter =>", JSON.stringify(canEnterTxt));

const tickBtn = page.locator('[data-testid="sandbox-tick-btn"]');
const tickDisabled = await tickBtn.isDisabled().catch(()=>"(n/a)");
const tickLabel = await tickBtn.innerText().catch(()=>"(n/a)");
log("TICK BUTTON: disabled=", tickDisabled, " label=", JSON.stringify(tickLabel));

const knowTxt = await page.locator('[data-testid="sandbox-knowledge-status"]').first().innerText().catch(()=>"(not found)");
log("knowledge-status (open) =>", JSON.stringify(knowTxt));

const nodeSubs = async () => page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const subs = []; let n; while ((n = walker.nextNode())) { const t=(n.textContent||"").trim(); if (t.startsWith("Σ")) subs.push(t); }
  return subs;
});
log("DAG Σ node values (open):", JSON.stringify((await nodeSubs()).slice(0,50)));

const baseCardsText = await page.locator('[data-testid="sandbox-base-cards"]').first().innerText().catch(()=>"(no base cards)");
log("\n=== BASE STATUS CARDS (real object props) ===\n" + baseCardsText.slice(0, 500));

// capture KPI / time-axis text
log("\n=== KPI/global text (open) ===");
for (const l of findLines(bodyText1, ["全局","KPI","Step","负荷","loadIndex","热度","均值"])) log("  |", l);

// 5. CLICK TICK
log("\n=== CLICKING 推进 tick x3 ===");
let clicks = 0;
for (let i=0;i<3;i++){
  const disabled = await tickBtn.isDisabled().catch(()=>true);
  if (disabled) { log(`  tick ${i+1}: button DISABLED, cannot click`); break; }
  await tickBtn.click();
  clicks++;
  await page.waitForTimeout(2200);
  const kt = await page.locator('[data-testid="sandbox-knowledge-status"]').first().innerText().catch(()=>"?");
  log(`  tick ${i+1} clicked -> knowledge-status: ${JSON.stringify(kt)}`);
}

await page.waitForTimeout(1500);

// 6. Post-tick extraction
log("\nDAG Σ node values (after " + clicks + " ticks):", JSON.stringify((await nodeSubs()).slice(0,50)));
const knowTxt2 = await page.locator('[data-testid="sandbox-knowledge-status"]').first().innerText().catch(()=>"(not found)");
log("knowledge-status (after) =>", JSON.stringify(knowTxt2));
const bodyText2 = await page.evaluate(() => document.body.innerText);
log("\n=== step/tick indicators after ===");
for (const l of findLines(bodyText2, ["已推进","Step","ACTIVE","DORMANT","运行中","未就绪"])) log("  |", l);

await page.screenshot({ path: `${EV}/usability-realrun-02-after-tick.png`, fullPage: true });

// 7. Try to expand the readiness card to capture gaps if collapsed
try {
  const readinessCard = page.locator('[data-testid="sandbox-readiness-card"]');
  if (await readinessCard.count() > 0) {
    await readinessCard.click().catch(()=>{});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${EV}/usability-realrun-03-readiness-gaps.png`, fullPage: true });
    const rtext = await readinessCard.innerText().catch(()=>"");
    log("\n=== readiness card text ===\n" + rtext.slice(0, 1200));
  }
} catch(e) { log("readiness card err", e.message); }

log("\n=== CONSOLE ERRORS (" + consoleErrors.length + ") ===");
for (const e of consoleErrors.slice(0,20)) log("  x", e);
log("=== FAILED REQUESTS (" + failedReqs.length + ") ===");
for (const e of failedReqs.slice(0,20)) log("  x", e);

fs.writeFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/rv-body-open.txt", bodyText1);
fs.writeFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/rv-body-after.txt", bodyText2);

await browser.close();
log("\n=== DONE ===");
