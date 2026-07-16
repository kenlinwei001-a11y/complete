import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
const errs = []; page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 80)); });
const nav = async (p) => { await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p); await sleep(2800); };
const cnt = async (s) => await page.locator(s).count().catch(() => 0);
const clickText = async (t) => { try { await page.locator(`text=${t}`).first().click({ timeout: 3000 }); return true; } catch { return false; } };

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1500);

// ① /admin/skills — CRUD
console.log("\n=== ① /admin/skills 增改 Skill ===");
await nav("/admin/skills");
const skBefore = await cnt('[data-testid^="pc-skill-"], button:has-text("解读"), table tbody tr');
const hasCreate = await cnt('[data-testid="skill-create"]');
console.log("  ＋新建技能 按钮:", hasCreate ? "✓存在" : "✗");
await page.screenshot({ path: `${OUT}/c1-skills.png`, fullPage: true });
await page.locator('[data-testid="skill-create"]').first().click().catch(() => {});
await sleep(2500);
const bodyHasNewSkill = (await page.locator("body").innerText().catch(() => "")).includes("新技能");
console.log("  点新建后出现「新技能」:", bodyHasNewSkill ? "✓ 创建成功" : "?");
const hasSaveBtn = await cnt('button:has-text("保存"), button:has-text("发布")');
console.log("  编辑区(保存/发布)按钮:", hasSaveBtn ? "✓可编辑" : "?");
await page.screenshot({ path: `${OUT}/c1-skills-created.png`, fullPage: true });

// ② /admin/mcp — CRUD
console.log("\n=== ② /admin/mcp 增改 MCP ===");
await nav("/admin/mcp");
await page.screenshot({ path: `${OUT}/c2-mcp.png`, fullPage: true });
const mcpNew = await clickText("新建");
await sleep(2000);
const mcpFormFields = await cnt('input, select, textarea');
console.log("  点'新建'后出现表单输入项:", mcpFormFields, mcpFormFields > 1 ? "✓可新增" : "?");
const mcpHasTest = await cnt('button:has-text("测试")');
console.log("  连接测试按钮:", mcpHasTest ? "✓" : "—");
await page.screenshot({ path: `${OUT}/c2-mcp-create.png`, fullPage: true });

// ③④ /admin/modeling — 图查询 RESERVED + 只读 Skill/MCP tab + 新建草案确定性建模
console.log("\n=== ③ /admin/modeling 图查询 RESERVED + 只读 Skill/MCP ===");
await nav("/admin/modeling");
await sleep(1500);
await clickText("图查询"); await sleep(1200);
const reservedTxt = (await page.locator("body").innerText().catch(() => ""));
console.log("  图查询 tab 含 'RESERVED'+'后端未建':", /RESERVED/.test(reservedTxt) && /后端未建|§10/.test(reservedTxt) ? "✓诚实RESERVED" : "?");
await page.screenshot({ path: `${OUT}/c3-graphquery-reserved.png`, fullPage: true });
// 只读 Skill / MCP tab（回答"显示它们目的何在"）
await clickText("Skills"); await sleep(1000);
const skillReadonly = await cnt('[data-testid="pc-skills"]'); const skillActionBtns = await cnt('[data-testid="pc-skills"] button, [data-testid="pc-skills"] input');
console.log("  建模页 Skills tab: 列表", skillReadonly ? "✓" : "✗", "| 可操作按钮/输入:", skillActionBtns, skillActionBtns === 0 ? "(纯只读·无任何动作)" : "");
await page.screenshot({ path: `${OUT}/c3-modeling-skills-readonly.png`, fullPage: true });
await clickText("MCP服务"); await sleep(1000);
const mcpActionBtns = await cnt('[data-testid="pc-mcp"] button, [data-testid="pc-mcp"] input');
console.log("  建模页 MCP tab: 可操作按钮/输入:", mcpActionBtns, mcpActionBtns === 0 ? "(纯只读·无任何动作)" : "");

console.log("\n=== ④ 新建草案 → 确定性建模(全字段) 能跑通 ===");
await clickText("基本信息"); await sleep(800);
const newDraftClicked = await page.locator('[data-testid="modeling-new-draft"]').first().click().catch(() => false);
await sleep(2000);
const modalOpen = await cnt('input[type="checkbox"]');
console.log("  新建草案弹窗 数据集勾选框:", modalOpen);
// 勾前 3 个数据集
for (let i = 0; i < Math.min(3, modalOpen); i++) { await page.locator('input[type="checkbox"]').nth(i).check().catch(() => {}); }
await sleep(500);
await page.screenshot({ path: `${OUT}/c4-newdraft-modal.png`, fullPage: true });
const detClicked = await clickText("确定性建模");
console.log("  点「确定性建模（全字段）」:", detClicked ? "✓" : "✗未找到");
await sleep(4000);
const afterBody = (await page.locator("body").innerText().catch(() => ""));
const hasDraftTypes = /对象类型|属性|映射画布|字段全建模|DRAFT|草案/.test(afterBody);
const objCfgCount = await cnt('[data-testid^="pub-type-"], [data-testid^="objcfg"], [data-testid^="pp-ty-"]');
console.log("  建模后出现 类型/映射/字段全建模:", hasDraftTypes ? "✓ 草案已建" : "?", "| 类型节点数:", objCfgCount);
await page.screenshot({ path: `${OUT}/c4-draft-created.png`, fullPage: true });

console.log("\n控制台 error:", errs.length, errs.slice(0, 3));
console.log("截图: c1-skills(-created) · c2-mcp(-create) · c3-graphquery-reserved · c3-modeling-skills-readonly · c4-newdraft-modal · c4-draft-created");
await browser.close();
