import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);
const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2800); };
const body = async () => (await page.locator("body").innerText().catch(() => "")) || "";

console.log("=== WO-12-1 真跑: 新建技能不再 400 ===");
await nav("/admin/skills");
const before = (await page.locator('table tbody tr, [data-testid^="pc-skill-"]').count().catch(() => 0));
await page.locator('[data-testid="skill-create"]').first().click().catch(() => {});
await sleep(2500);
const b1 = await body();
const has400 = /VALIDATION_ERROR|resources.*array|expected array/i.test(b1);
const hasNew = b1.includes("新技能");
const hasEditor = (await page.locator('button:has-text("保存"), button:has-text("发布")').count().catch(() => 0)) > 0;
console.log("  点 ＋新建技能 →", has400 ? "⚠️仍 400 VALIDATION_ERROR" : "✓ 无报错", "| 出现「新技能」:", hasNew ? "✓" : "?", "| 编辑区(保存/发布):", hasEditor ? "✓可编辑" : "?");
await page.screenshot({ path: `${OUT}/v12-1-skill.png`, fullPage: true });

console.log("\n=== WO-12-2 真跑: 新建本体入口文案 ===");
await nav("/admin/modeling"); await sleep(1500);
const b2 = await body();
const btns = await page.locator("button").allInnerTexts().catch(() => []);
const hasNewOntology = btns.some((t) => /新建本体/.test(t)) || /新建本体（模型）|新建本体\(模型\)/.test(b2);
const stillOnlyAi = btns.some((t) => t.trim() === "AI 建议草案") && !hasNewOntology;
console.log("  建模页按钮含「新建本体」:", hasNewOntology ? "✓ 已改名" : "✗仍叫AI建议草案", "| 顶部按钮样例:", btns.filter((t) => /新建|本体|建议|草案/.test(t)).slice(0, 4).join(" | "));

console.log("\n=== WO-12-3 真跑: 只读 Skill/MCP tab 现状 ===");
// 点 Skills tab
await page.locator('text=Skills').first().click().catch(() => {}); await sleep(1000);
const b3 = await body();
const skillActions = await page.locator('[data-testid="pc-skills"] button, [data-testid="pc-skills"] a').count().catch(() => 0);
const skillsHidden = (await page.locator('[data-testid="pc-skills"]').count().catch(() => 0)) === 0;
const hasPurposeNote = /图查询|绑定|暴露|待|§10|RESERVED|可被.*引用|前往|管理/.test(b3);
const hasLink = await page.locator('[data-testid="pc-skills"] a, [data-testid="pc-skills"] button:has-text("前往"), [data-testid="pc-skills"] button:has-text("管理")').count().catch(() => 0);
console.log("  Skills tab: 隐藏?", skillsHidden ? "✓已隐藏" : "否(仍显)", "| 动作/链接数:", skillActions, "| 有用途说明/跳转:", hasPurposeNote || hasLink ? "✓" : "✗仍裸列表");
await page.screenshot({ path: `${OUT}/v12-3-skilltab.png`, fullPage: true });
console.log("\n截图: v12-1-skill · v12-3-skilltab");
await browser.close();
