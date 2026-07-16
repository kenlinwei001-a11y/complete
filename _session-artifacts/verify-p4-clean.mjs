import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
let qStatus = null, qReq = null;
page.on("request", (r) => { if (r.url().includes("/b/v1/queries") && r.method() === "POST") { try { qReq = JSON.parse(r.postData() || "{}"); } catch {} } });
page.on("response", async (r) => { if (r.url().includes("/b/v1/queries") && r.request().method() === "POST" && !r.url().includes("/events")) { qStatus = r.status(); } });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500); // 多等 token 就绪
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });

// 轮询直到场景卡渲染（=token就绪+卡拉到），最多 ~18s
let cardN = 0;
for (let i = 0; i < 36; i++) { await sleep(500); cardN = await page.locator('[data-testid^="modeling-agent-card-"]').count(); if (cardN > 0) break; }
console.log("=== 增量4 干净自证(等 token 就绪) ===");
console.log("场景卡渲染数:", cardN, cardN > 0 ? "✓(token就绪·卡拉到)" : "✗仍空");

if (cardN > 0) {
  const pa = page.locator('[data-testid="modeling-agent-card-plan_audit_q"]');
  const target = (await pa.count()) ? pa : page.locator('[data-testid^="modeling-agent-card-"]').first();
  await target.click();
  await page.waitForURL((u) => u.pathname.includes("/v/"), { timeout: 8000 }).catch(() => {});
  let hit = "";
  for (let i = 0; i < 24; i++) {
    await sleep(800);
    const body = (await page.locator("body").textContent().catch(() => "")) || "";
    if (/站不住|站得住|已验证|VERIFIED|X05|score|评分/.test(body)) { hit = [...new Set(body.match(/站不住|站得住|已验证|工作流|X05|50|命中工作流|invoke_solver|plan_audit/g) || [])].slice(0, 8).join(" / "); if (/站不住|已验证|X05/.test(body)) break; }
  }
  await page.screenshot({ path: `${OUT}/p4-clean-answer.png`, fullPage: true });
  console.log("点卡 → POST /b/v1/queries HTTP:", qStatus, qStatus === 202 ? "✓真发真受理" : "");
  console.log("  scenarioIntentKey:", JSON.stringify(qReq?.context?.scenarioIntentKey ?? "(无)"), "| packageId类型:", typeof qReq?.packageId, "实值:", JSON.stringify(qReq?.packageId));
  console.log("  URL:", page.url().replace(APP, ""));
  console.log("  对话坞真答案命中:", hit || "(未出答案)");
} else {
  console.log("卡仍未渲染——token/查询竞态未解，转据 API 证据 + dev 截图");
}
await browser.close();
