import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/cmp";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
const neterr = [], cerr = [];
page.on("console", (m) => { if (m.type() === "error") cerr.push(m.text().slice(0, 120)); });
page.on("requestfailed", (r) => neterr.push(`${r.method()} ${r.url().split("/").slice(3).join("/").slice(0,50)} ${r.failure()?.errorText||""}`));
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/v1/")) neterr.push(`HTTP${r.status()} ${r.url().split("/v1/")[1]?.slice(0,40)}`); });
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").replace(/\s+/g, " ").trim(); } catch { return "<缺>"; } };
const clickFirst = async (sels) => { for (const s of sels) { try { const l = page.locator(s).first(); if (await l.count()) { await l.scrollIntoViewIfNeeded().catch(()=>{}); await l.click({ timeout: 2500 }); return s; } } catch {} } return null; };

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(5500);
console.log("=== FDE 走查：亲手用本体建模建一个本体 ===");
console.log("STEP0 进入建模页:", page.url().replace(APP, ""));
console.log("  数据流DAG:", await cnt('[data-testid="modeling-pipeline-dag"], [data-testid*="pipeline"]') ? "✓" : "?", "| 新建草案按钮:", await cnt('[data-testid="modeling-new-draft"]') ? "✓" : "✗", "| 字段全建模门:", (await txt('text=/\\d+\\/\\d+/')).slice(0,20));

// STEP1 点新建草案 → SuggestModal
const s1 = await clickFirst(['[data-testid="modeling-new-draft"]', 'text=新建草案']);
await sleep(2500);
await page.screenshot({ path: `${OUT}/fde-1-suggest-modal.png`, fullPage: true });
console.log("\nSTEP1 点新建草案:", s1 ? "✓" : "✗");
// dump modal 内容: 可选数据集 + 按钮
const modalBtns = await page.evaluate(() => [...document.querySelectorAll('.modal button, [role=dialog] button, .panel button')].map(b=>b.textContent.trim()).filter(t=>t&&t.length<16).slice(0,20));
const datasetRows = await cnt('[data-testid*="dataset"], .modal input[type=checkbox], [role=dialog] input[type=checkbox], .modal li, [role=dialog] tr');
console.log("  Modal 按钮:", JSON.stringify([...new Set(modalBtns)]));
console.log("  可选数据集行/勾选框:", datasetRows);

// STEP2 选一个数据集 + derive(建模/生成)
await clickFirst(['.modal input[type=checkbox]', '[role=dialog] input[type=checkbox]', '[data-testid*="dataset"]', '.modal li', '[role=dialog] tr:has-text("Base")', '[role=dialog] li:has-text("Order")']);
await sleep(800);
const s2 = await clickFirst(['button:has-text("建模")', 'button:has-text("生成草案")', 'button:has-text("生成")', 'button:has-text("derive")', 'button:has-text("确定")', 'button:has-text("下一步")', 'button:has-text("创建")', '.modal button.primary', '[role=dialog] button.primary']);
console.log("\nSTEP2 选数据集+点derive/建模:", s2 || "✗(没找到derive按钮)");
await sleep(5000); // 等 deriveModeling
await page.screenshot({ path: `${OUT}/fde-2-after-derive.png`, fullPage: true });
// 检查草案工作台是否出现
const wb = await cnt('text=/源字段|映射画布|操作面板/');
const draftSel = await txt('[data-testid="modeling-draft-select"], select');
console.log("  derive后: 草案工作台(源字段/映射画布/操作面板):", wb ? "✓出现" : "✗未出现", "| 草案选择器:", draftSel.slice(0,40));

// STEP3 找发布按钮
const pubBtn = await cnt('button:has-text("发布")');
console.log("\nSTEP3 发布按钮存在:", pubBtn ? "✓" : "✗");

console.log("\n=== 错误捕获 ===");
console.log("network 4xx/失败:", JSON.stringify([...new Set(neterr)].slice(0, 8)));
console.log("console errors:", JSON.stringify([...new Set(cerr)].slice(0, 5)));
await browser.close();
