import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
const TO = { timeout: 2000 };
const cnt = async (sel) => await page.locator(sel).count();
const txt = async (sel) => { try { return ((await page.locator(sel).first().textContent(TO)) || "").trim(); } catch { return "<缺>"; } };

// 网络拦截：QOS 提交
let qosReq = null, qosStatus = null, qosResp = null;
page.on("request", (r) => { if (r.url().includes("/b/v1/queries") && r.method() === "POST") { try { qosReq = JSON.parse(r.postData() || "{}"); } catch {} } });
page.on("response", async (r) => { if (r.url().includes("/b/v1/queries") && r.request().method() === "POST") { qosStatus = r.status(); try { qosResp = await r.json(); } catch {} } });

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(3500);

console.log("=== 轨P 增量4 取证 ===");
const consoleExists = await cnt('[data-testid="modeling-console"]');
const tabsExist = await cnt('[data-testid="modeling-console-tabs"] button');
console.log("ModelingConsole:", consoleExists, "| tab 数:", tabsExist);

// Part A：6 tab 内容
const tabChecks = [
  ["基本信息", '[data-testid="modeling-readiness"]', "就绪认证面板"],
  ["图查询", '[data-testid="mc-graphquery-reserved"]', "RESERVED 不画假"],
  ["Skills", '[data-testid="mc-skills"],[data-testid="mc-skills-err"],[data-testid="mc-skills-empty"]', "真B4/诚实降级"],
  ["MCP服务", '[data-testid="mc-mcp"],[data-testid="mc-mcp-err"]', "真B3/诚实降级"],
  ["日志", '[data-testid="mc-logs"],[data-testid="mc-logs-err"]', "真outbox/诚实降级"],
  ["指南", '[data-testid="mc-guide"]', "静态指南"],
];
for (const [tb, sel, desc] of tabChecks) {
  try { await page.locator(`[data-testid="mc-tab-${tb}"]`).click(); await sleep(900); } catch {}
  const present = await cnt(sel);
  let extra = "";
  if (tb === "Skills") { const real = await cnt('[data-testid^="mc-skill-"]'); const err = await cnt('[data-testid="mc-skills-err"]'); extra = real ? `真技能行 ${real}` : (err ? "诚实降级(AgentCore off)" : "空"); }
  if (tb === "日志") { const rows = await cnt('[data-testid^="mc-log-"]'); const err = await cnt('[data-testid="mc-logs-err"]'); extra = rows ? `真事件行 ${rows}` : (err ? "诚实降级" : "空"); }
  if (tb === "图查询") { extra = (await txt('[data-testid="mc-graphquery-reserved"]')).slice(0, 36); }
  console.log(`  tab ${tb.padEnd(5)} → 内容存在:${present} (${desc}) ${extra}`);
}

// Part B：选对象 → 关抽屉 → Agent QOS
await page.locator('[data-testid="mc-tab-基本信息"]').click().catch(() => {});
await sleep(300);
// 展开 DAG（幂等）
const details = page.locator('[data-testid="modeling-pipeline-dag"]');
const isOpen = await details.evaluate((el) => el.open).catch(() => false);
if (!isOpen) { await page.locator('[data-testid="modeling-pipeline-dag"] summary').click().catch(() => {}); await sleep(600); }
await page.locator('[data-testid="pp-ty-Order"]').click({ force: true }); await sleep(1500);
await page.keyboard.press("Escape"); await sleep(700); // 关抽屉，selectedType 保留(增量4 解耦)
const capNode = await txt('[data-testid="mc-cap-node"]');
const nodeSummary = await txt('[data-testid="modeling-agent-nodesummary"]');
const agentInput = await cnt('[data-testid="modeling-agent-input"]');
console.log("选中后: 执行节点胶囊=", capNode, "| node摘要=", nodeSummary, "| Agent输入框:", agentInput);
await page.screenshot({ path: `${OUT}/p4-console.png`, fullPage: true });

// 发 QOS 提问
await page.locator('[data-testid="modeling-agent-input"]').fill("销售订单的产能瓶颈在哪？");
await page.locator('[data-testid="modeling-agent-send"]').click();
await sleep(3000); // 等 submitQuery + 导航
console.log("--- Agent QOS 提交(网络拦截) ---");
console.log("  POST /b/v1/queries 发出:", qosReq ? "✓ 真发" : "✗ 未发(假壳?)", "| HTTP", qosStatus);
if (qosReq) {
  const so = qosReq.context?.selectedObjects ?? [];
  console.log("  context.selectedObjects:", JSON.stringify(so));
  console.log("  注入选中对象 Order:", so.some((x) => x.objectType === "Order") ? "✓ presetContext 真注入(补G-3)" : "✗ 未注入");
  console.log("  query:", JSON.stringify(qosReq.query), "| packageId:", qosReq.packageId ? "有" : "无");
}
console.log("  QOS 响应 taskId:", qosResp?.taskId ? `✓ ${qosResp.taskId}` : "(无)", "| streamUrl:", qosResp?.streamUrl ? "✓有SSE" : "无");
const url = page.url();
console.log("  提交后导航到:", url.replace(APP, ""), url.includes("/v/dash") ? "✓ 跳对话视图" : "");
await browser.close();
