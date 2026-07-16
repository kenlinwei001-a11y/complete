import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();

// 网络拦截：QOS 提交 + SSE
let qReq = null, qStatus = null, qResp = null, sseUrl = null, sseStatus = null;
page.on("request", (r) => { if (r.url().includes("/b/v1/queries") && r.method() === "POST") { try { qReq = JSON.parse(r.postData() || "{}"); } catch {} } });
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/b/v1/queries") && r.request().method() === "POST" && !u.includes("/events")) { qStatus = r.status(); try { qResp = await r.json(); } catch {} }
  if (u.includes("/events")) { sseUrl = u; sseStatus = r.status(); }
});

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3800);

console.log("=== 轨P 增量4 复修(06605ff) 端到端取证 ===");
const cards = await page.locator('[data-testid^="modeling-agent-card-"]').count();
console.log("Agent台 真场景卡数:", cards);
const cardPa = page.locator('[data-testid="modeling-agent-card-plan_audit_q"]');
const paExists = await cardPa.count();
console.log("plan_audit_q 卡存在:", paExists);

if (paExists) {
  await cardPa.click();
  // 等导航 /v/dash + SSE 出答案
  await page.waitForURL((u) => u.pathname.includes("/v/"), { timeout: 8000 }).catch(() => {});
  // 轮询对话坞出现答案关键词（dev 称 score=50/verdict=站不住/X05/评估规则）
  let answerText = "", hit = "";
  for (let i = 0; i < 24; i++) {
    await sleep(800);
    const body = (await page.locator("body").textContent().catch(() => "")) || "";
    if (/站不住|站得住|score|评分|规则|违例|X05|已验证|verdict|分值|工作流/.test(body)) {
      answerText = body; hit = (body.match(/站不住|站得住|X05|评分\s*\d+|score\s*\d+|评估规则|已验证/g) || []).slice(0, 6).join(" / ");
      if (/站不住|站得住|X05|已验证/.test(body)) break;
    }
  }
  await page.screenshot({ path: `${OUT}/p4-qos-answer.png`, fullPage: true });
  console.log("--- QOS 提交(拦截) ---");
  console.log("  POST /b/v1/queries:", qReq ? "✓发出" : "✗未发", "| HTTP", qStatus, qStatus === 202 ? "✓(非404!)" : (qStatus === 404 ? "✗仍404" : ""));
  console.log("  packageId 实值:", JSON.stringify(qReq?.packageId), "| 类型", typeof qReq?.packageId);
  console.log("  scenarioIntentKey:", JSON.stringify(qReq?.context?.scenarioIntentKey ?? qReq?.scenarioIntentKey ?? "(无)"));
  console.log("  taskId:", qResp?.taskId ? `✓ ${qResp.taskId}` : "(无)", "| streamUrl:", qResp?.streamUrl ?? "(无)");
  console.log("  SSE /events:", sseUrl ? `✓ HTTP ${sseStatus}` : "✗ 未建立(CORS拦?)");
  console.log("  当前 URL:", page.url().replace(APP, ""));
  console.log("  对话坞答案命中:", hit || "(未出答案)");
} else {
  console.log("plan_audit_q 卡缺，列出现有卡:");
  const ids = await page.locator('[data-testid^="modeling-agent-card-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  console.log(" ", JSON.stringify(ids));
}
await browser.close();
