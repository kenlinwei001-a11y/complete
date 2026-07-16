import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
let scenStatus = null, scenLen = null, qStatus = null, qReq = null;
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/b/v1/scenarios") && !u.includes("/queries")) { scenStatus = r.status(); try { const j = await r.json(); scenLen = (j.items || []).length; } catch {} }
  if (u.includes("/b/v1/queries") && r.request().method() === "POST" && !u.includes("/events")) { qStatus = r.status(); }
});
page.on("request", (r) => { if (r.url().includes("/b/v1/queries") && r.method() === "POST") { try { qReq = JSON.parse(r.postData() || "{}"); } catch {} } });

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(5000); // 多等卡查询

const cardsBox = ((await page.locator('[data-testid="modeling-agent-cards"]').textContent().catch(() => "")) || "").slice(0, 80);
const cardN = await page.locator('[data-testid^="modeling-agent-card-"]').count();
console.log("=== 增量4 浏览器端到端诊断 ===");
console.log("浏览器看 /b/v1/scenarios: HTTP", scenStatus, "| items", scenLen);
console.log("Agent台 卡按钮数:", cardN, "| 容器文本:", JSON.stringify(cardsBox));
console.log("console errors:", errs.length, errs.slice(0, 4).join(" || "));

if (cardN > 0) {
  const pa = page.locator('[data-testid="modeling-agent-card-plan_audit_q"]');
  if (await pa.count()) {
    await pa.click();
    await page.waitForURL((u) => u.pathname.includes("/v/"), { timeout: 8000 }).catch(() => {});
    let hit = "";
    for (let i = 0; i < 20; i++) {
      await sleep(800);
      const body = (await page.locator("body").textContent().catch(() => "")) || "";
      const m = body.match(/站不住|站得住|score|50|X05|已验证|VERIFIED|规则|verdict/g);
      if (m && /站不住|X05|已验证|VERIFIED/.test(body)) { hit = [...new Set(m)].slice(0, 8).join(" / "); break; }
    }
    await page.screenshot({ path: `${OUT}/p4-qos-dock.png`, fullPage: true });
    console.log("点 plan_audit_q → POST /b/v1/queries HTTP", qStatus, qStatus === 202 ? "✓" : "");
    console.log("  scenarioIntentKey 发出:", JSON.stringify(qReq?.context?.scenarioIntentKey ?? "(无)"));
    console.log("  URL:", page.url().replace(APP, ""), "| 对话坞答案命中:", hit || "(未出)");
  }
} else {
  console.log("→ 卡未加载，无法点；但 API 级已证确定性绑定真出答案");
}
await browser.close();
