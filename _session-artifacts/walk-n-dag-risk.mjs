import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1500 } })).newPage();
const cnt = async (s) => await page.locator(s).count();
const txt = async (s) => { try { return ((await page.locator(s).first().textContent({ timeout: 1500 })) || "").replace(/\s+/g, " ").trim(); } catch { return "<缺>"; } };
const click = async (sels) => { for (const s of sels) { try { const l = page.locator(s).first(); if (await l.count()) { await l.click({ timeout: 2000 }); return s; } } catch {} } return null; };
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);

// ===== 增量1 U3: 经营驾驶舱 根因 DAG 节点点穿 → DagNodeDrawer(去死路) =====
await click(['text=经营驾驶舱', 'a:has-text("经营驾驶舱")']);
await sleep(4000);
console.log("=== 增量1·U3 · 经营驾驶舱 根因DAG 点穿 → DagNodeDrawer ===");
// 点一个问题卡展开归因 DAG
const pc = await click(['[data-testid^="dash-problem-"]', '[data-testid="widget-summary-problems"] *', 'text=/根因|归因|待解决/']);
await sleep(2500);
// 点一个 DAG 节点(title=点穿溯源 或 dag-node-*)
const nodeSel = await click(['[title="点穿溯源"]', '[data-testid^="dag-node-"]:not([data-testid="dag-node-drawer"])']);
await sleep(1500);
const drawer = await cnt('[data-testid="dag-node-drawer"]');
console.log("点问题卡:", pc ? "✓" : "✗", "| 点DAG节点:", nodeSel || "✗");
console.log("DagNodeDrawer 抽屉打开:", drawer ? "✓" : "✗", "| 溯源src:", await txt('[data-testid="dag-node-src"]'));
const closeBtn = await cnt('[data-testid="dag-node-drawer"] button, [data-testid="dag-node-drawer"] [class*="close"]');
console.log("抽屉可关(去死路·非navigate跳走):", drawer ? "✓抽屉保上下文" : "?", "| 面包屑返回:", await cnt('text=/← *返回|‹ *返回|返回/') ? "✓页面有返回" : "?");
await page.screenshot({ path: `${OUT}/n-dag-drawer.png`, fullPage: true });

// ===== 增量3 U6: 预判推演看板 风险点 → 详情弹窗(bottleneck_matrix) =====
await click(['text=预判推演看板', 'a:has-text("预判推演")', '[href*="/v/risk"]']);
await sleep(4500);
console.log("\n=== 增量3·U6 · 预判推演看板 风险点详情(bottleneck_matrix) ===");
console.log("URL:", page.url().replace(APP, ""));
// 点一个风险卡/点触发 detail
const rc = await click(['[data-testid^="risk-card-"]', '[data-testid^="risk-cell-"]', '[data-testid^="riskcard"]', '.riskCard', 'text=/瓶颈|越线|张力/']);
await sleep(3000);
const panel = await cnt('[data-testid="bottleneck-detail-panel"]');
const factors = await cnt('[data-testid^="bottleneck-factor-"]');
const dm = await txt('[data-testid="bottleneck-detail-datamode"]');
console.log("点风险点:", rc || "✗", "| 详情面板(bottleneck-detail-panel):", panel ? "✓" : "✗");
console.log("逐因素行数:", factors, "(oracle 7维) | dataMode诚实标:", dm);
console.log("详情表:", await cnt('[data-testid="bottleneck-detail-table"]') ? "✓" : "✗");
await page.screenshot({ path: `${OUT}/n-risk-detail.png`, fullPage: true });
console.log("\n截图 n-dag-drawer.png / n-risk-detail.png");
await browser.close();
