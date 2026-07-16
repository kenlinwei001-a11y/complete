import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2800); };
const bodyHas = async (re) => re.test((await page.locator("body").innerText().catch(() => "")) || "");

// Q3a Agent 配置页
console.log("=== Q3a /admin/agents 能配 skill/MCP/规则/求解器? ===");
await nav("/admin/agents");
await sleep(1000);
// 点第一个 agent 进编辑
await page.locator('button, [role="button"], li, tr').filter({ hasText: /经营|助手|Agent|agent|决策/ }).first().click().catch(() => {});
await sleep(2000);
for (const [lab, re] of [["技能/skill", /技能|skill|load_skill/i], ["MCP", /MCP|mcp/], ["规则/rule", /规则|rule|evaluate_rules|ruleBinding/i], ["求解器/solver", /求解器|solver|invoke_solver/i], ["工具/tools", /工具|tools|scope/i]]) {
  console.log(`  配置含「${lab}」:`, await bodyHas(re) ? "✓出现" : "✗未见");
}
await page.screenshot({ path: `${OUT}/q3-agent-config.png`, fullPage: true });

// Q3b Workflow 配置页（步骤构建器）
console.log("\n=== Q3b /admin/workflows 步骤能配 solver/rule/agent/mcp? ===");
await nav("/admin/workflows");
await sleep(1000);
await page.locator('button, [role="button"], li, tr').filter({ hasText: /工作流|workflow|新建|产能|流程/ }).first().click().catch(() => {});
await sleep(2000);
for (const [lab, re] of [["invoke_solver/求解器", /invoke_solver|求解器|solver/i], ["evaluate_rules/规则", /evaluate_rules|规则|rule/i], ["invoke_agent", /invoke_agent|agent|智能体/i], ["invoke_mcp/MCP", /invoke_mcp|mcp|MCP/i], ["加步骤/step", /步骤|step|加节点|添加/i]]) {
  console.log(`  步骤含「${lab}」:`, await bodyHas(re) ? "✓出现" : "✗未见");
}
await page.screenshot({ path: `${OUT}/q3-workflow-config.png`, fullPage: true });

// Q4 二级页回退：随便几个 admin 详情页看有没有"返回"
console.log("\n=== Q4 二级页是否有'返回/回退' ===");
for (const p of ["/admin/object-types", "/admin/rules", "/admin/solvers", "/admin/calibration", "/admin/agents"]) {
  await nav(p);
  const hasBack = await bodyHas(/返回|‹ 返回|← 返回|回退|goBack/);
  const hasBackBtn = await page.locator('button:has-text("返回"), a:has-text("返回")').count().catch(() => 0);
  console.log(`  ${p}: 返回按钮 ${hasBack || hasBackBtn ? "✓有" : "✗无"}`);
}
await page.screenshot({ path: `${OUT}/q4-noback-sample.png`, fullPage: true });
console.log("\n截图: q3-agent-config · q3-workflow-config · q4-noback-sample");
await browser.close();
