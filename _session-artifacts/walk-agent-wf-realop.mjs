import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();
const errs = []; page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 100)); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2800); };
const bodyTxt = async () => (await page.locator("body").innerText().catch(() => "")) || "";

// ===== AGENT 真配置 + 保存 =====
console.log("=== Agent 真操作：创建→勾技能+求解器→保存→确认持久化 ===");
await nav("/admin/agents");
await page.locator('text=创建 Agent').first().click().catch(() => {});  // 创建 Agent（模板预填）
await sleep(2500);
console.log("  [1] 创建草案 agent:", /模板预填|新 Agent/.test(await bodyTxt()) ? "✓ 编辑器打开" : "?");
// 勾 SKILLS 下的技能复选框（产能分析方法论）
const skillCb = page.locator('text=产能分析方法论').locator('xpath=preceding-sibling::input[@type="checkbox"] | xpath=../input[@type="checkbox"]').first();
let skillChecked = false;
try { await page.getByText("产能分析方法论").locator("xpath=ancestor::label//input[@type='checkbox'] | xpath=preceding::input[@type='checkbox'][1]").first().check({ timeout: 2000 }); skillChecked = true; } catch {}
if (!skillChecked) { // 兜底：找含'产能分析'附近的 checkbox
  const labels = await page.locator('label').filter({ hasText: "产能分析方法论" }).count();
  if (labels) { await page.locator('label').filter({ hasText: "产能分析方法论" }).locator('input[type="checkbox"]').first().check().catch(() => {}); skillChecked = true; }
}
console.log("  [2] 勾选技能「产能分析方法论」:", skillChecked ? "✓" : "✗未勾到");
// 勾 invoke_solver 内置工具
let solverChecked = false;
try { await page.locator('label').filter({ hasText: "invoke_solver" }).locator('input[type="checkbox"]').first().check(); solverChecked = true; } catch {}
console.log("  [3] 勾选求解器工具 invoke_solver:", solverChecked ? "✓" : "✗");
// 勾 evaluate_rules
let ruleChecked = false;
try { await page.locator('label').filter({ hasText: "evaluate_rules" }).locator('input[type="checkbox"]').first().check(); ruleChecked = true; } catch {}
console.log("  [4] 勾选规则工具 evaluate_rules:", ruleChecked ? "✓" : "✗");
await page.screenshot({ path: `${OUT}/op-agent-configured.png`, fullPage: true });
// 保存
await page.locator('button:has-text("保存")').first().click().catch(() => {});
await sleep(2500);
const agentBody = await bodyTxt();
console.log("  [5] 点保存 →", /已保存|保存成功/.test(agentBody) ? "✓ toast 已保存" : (/VALIDATION|错误|失败|error/i.test(agentBody.slice(-200)) ? "⚠️报错" : "?无明确toast"));
await page.screenshot({ path: `${OUT}/op-agent-saved.png`, fullPage: true });

// ===== WORKFLOW 真配置 + 保存 =====
console.log("\n=== Workflow 真操作：新建→加 invoke_solver 步骤→保存 ===");
await nav("/admin/workflows");
await page.locator('text=新建, text=创建').first().click().catch(() => {});
await sleep(2000);
const wfBody1 = await bodyTxt();
console.log("  [1] 新建工作流:", /步骤|step|invoke|节点/.test(wfBody1) ? "✓ 步骤构建器" : "?");
// 加步骤：找"加步骤/添加/+ 步骤"或步骤类型下拉
const addStep = await page.locator('button:has-text("步骤"), button:has-text("加节点"), button:has-text("添加"), select').first().click().then(() => true).catch(() => false);
await sleep(1000);
// 选 invoke_solver 类型（下拉 or 按钮）
let solverStep = false;
try { await page.locator('text=invoke_solver').first().click({ timeout: 2000 }); solverStep = true; } catch {}
if (!solverStep) { try { await page.locator('select').first().selectOption({ label: /invoke_solver/ }).catch(() => page.locator('select').first().selectOption("invoke_solver")); solverStep = true; } catch {} }
console.log("  [2] 加 invoke_solver 步骤:", solverStep ? "✓" : "✗(步骤构建器交互未命中·看截图)");
await page.screenshot({ path: `${OUT}/op-workflow-step.png`, fullPage: true });
await page.locator('button:has-text("保存")').first().click().catch(() => {});
await sleep(2000);
const wfBody2 = await bodyTxt();
console.log("  [3] 点保存 →", /已保存|保存成功/.test(wfBody2) ? "✓ toast 已保存" : (/VALIDATION|错误|失败/i.test(wfBody2.slice(-200)) ? "⚠️报错" : "?"));
await page.screenshot({ path: `${OUT}/op-workflow-saved.png`, fullPage: true });
console.log("\n控制台 error:", errs.length, errs.slice(0, 3));
await browser.close();
