import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const cnt = (p, s) => p.locator(s).count();
const txt = async (p, s) => { try { return ((await p.locator(s).first().textContent({ timeout: 1500 })) || "").replace(/\s+/g, " ").trim(); } catch { return "<缺>"; } };
async function login(p) {
  await p.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo"); await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(2500);
}
const click = async (p, sels) => { for (const s of sels) { try { const l = p.locator(s).first(); if (await l.count()) { await l.scrollIntoViewIfNeeded().catch(()=>{}); await l.click({ timeout: 2000 }); return s; } } catch {} } return null; };

// ===== A · 增量1 U3: 经营驾驶舱 DAG 节点点穿 → DagNodeDrawer(去死路) =====
{
  const p = await (await browser.newContext({ viewport: { width: 1700, height: 1500 } })).newPage();
  await login(p);
  await click(p, ['text=经营驾驶舱', 'a:has-text("经营驾驶舱")']);
  await sleep(4500);
  console.log("=== A · 增量1·U3 · 经营驾驶舱 DAG点穿→DagNodeDrawer ===");
  const nodes = await cnt(p, '[title="点穿溯源"]');
  console.log("DAG 可点穿节点(title=点穿溯源):", nodes);
  const clicked = await click(p, ['[title="点穿溯源"]']);
  await sleep(1800);
  const drawer = await cnt(p, '[data-testid="dag-node-drawer"]');
  console.log("点节点:", clicked ? "✓" : "✗", "| DagNodeDrawer 抽屉:", drawer ? "✓打开" : "✗");
  console.log("  抽屉 溯源src:", await txt(p, '[data-testid="dag-node-src"]'));
  console.log("  抽屉 规则(dag-node-rule):", (await txt(p, '[data-testid="dag-node-rule"]')).slice(0,40));
  // 去死路:抽屉可关回原页(非 navigate 跳走)
  const closed = await click(p, ['[data-testid="dag-node-drawer"] button:has-text("关")', '[data-testid="dag-node-drawer"] [aria-label="close"]', '[data-testid="dag-node-drawer"] .close', '[data-testid="dag-node-drawer"] button']);
  await sleep(800);
  const stillCockpit = !p.url().includes("order-chain");
  console.log("  抽屉关闭后留在驾驶舱(非跳走=去死路):", stillCockpit ? "✓" : "✗", "| URL:", p.url().replace(APP,""));
  await p.screenshot({ path: `${OUT}/n-dag-drawer.png`, fullPage: true });
}

// ===== B · 增量3 U6: 预判推演看板 风险卡 → Modal → BottleneckDetailPanel =====
{
  const p = await (await browser.newContext({ viewport: { width: 1700, height: 1500 } })).newPage();
  await login(p);
  await click(p, ['text=预判推演看板', 'a:has-text("预判推演")', '[href*="/v/risk"]']);
  await sleep(4500);
  console.log("\n=== B · 增量3·U6 · 预判推演看板 风险详情(bottleneck_matrix) ===");
  console.log("URL:", p.url().replace(APP, ""));
  const rc = await click(p, ['[data-testid^="risk-card-"]']);
  await sleep(3000);
  const panel = await cnt(p, '[data-testid="bottleneck-detail-panel"]');
  const factors = await cnt(p, '[data-testid^="bottleneck-factor-"]');
  console.log("点风险卡:", rc || "✗", "| Modal详情面板(bottleneck-detail-panel):", panel ? "✓" : "✗");
  console.log("逐因素行(oracle 7维):", factors, "| dataMode诚实标:", await txt(p, '[data-testid="bottleneck-detail-datamode"]'));
  console.log("详情表 bottleneck-detail-table:", await cnt(p, '[data-testid="bottleneck-detail-table"]') ? "✓" : "✗");
  await p.screenshot({ path: `${OUT}/n-risk-detail.png`, fullPage: true });
}
await browser.close();
console.log("\n截图 n-dag-drawer.png / n-risk-detail.png");
