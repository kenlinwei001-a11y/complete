// WO-CAPSIM-REPLICA-V2 真浏览器复验：产能推演看板剥皮后与参照 HTML 并排对照 + DOM 级真断言（非仅截图）。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://localhost:5230";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/replica-v2-shots";

const results = [];
const ok = (m) => { results.push(1); console.log("PASS", m); };
const bad = (m) => { results.push(0); console.log("FAIL", m); };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-username", { timeout: 15000 });
  const tenantVal = await page.inputValue("#login-tenant");
  await page.fill("#login-username", "planner");
  await page.fill("#login-password", "demo");
  await page.click("button[type=submit]");
  // access token 仅存内存（PRD §4.1·非 localStorage）——之后一律走客户端路由(点击/NavLink)，禁 page.goto 硬刷新掉登录态。
  await page.waitForSelector("[data-testid=nav-business]", { timeout: 15000 });
  page.url().includes("/login") ? bad(`登录失败：仍在 ${page.url()}`) : ok(`真登录成功（tenant=${tenantVal}·planner/demo）→ ${page.url()}`);

  await page.locator('[data-testid=nav-business]').getByText("产能推演", { exact: true }).click();
  await page.waitForSelector("[data-testid=risk-kpi]", { timeout: 15000 });
  await page.waitForTimeout(500);
  page.url().includes("/v/risk") ? ok(`客户端路由跳转到产能推演看板 → ${page.url()}`) : bad(`未落到 /v/risk：${page.url()}`);

  // ---- 剥掉层：应为 0 ----
  const trustBar = await page.locator("[data-testid=risk-trust-bar]").count();
  trustBar === 0 ? ok("信任条 risk-trust-bar 已删（count=0）") : bad(`信任条仍在：count=${trustBar}`);

  const confBanner = await page.locator("[data-testid=risk-confidence-banner]").count();
  confBanner === 0 ? ok("置信度条 risk-confidence-banner 已删（count=0）") : bad(`置信度条仍在：count=${confBanner}`);

  // 网格上方图例：未展开任何卡时，risk-legend 不应存在（现在只在详情态渲染）
  const topLegend = await page.locator("[data-testid=risk-legend]").count();
  topLegend === 0 ? ok("网格上方三档图例已删（未展开卡时 risk-legend count=0）") : bad(`网格图例仍在：count=${topLegend}`);

  const dmRows = await page.locator('[data-testid^="risk-datamode-"]').count();
  dmRows === 0 ? ok("卡内「实测当前 N」行已删（risk-datamode-* count=0）") : bad(`实测当前行仍在：count=${dmRows}`);

  // ---- 必须保留：应 > 0 或存在 ----
  const kpiCount = await page.locator('[data-testid^="risk-kpi-"][data-testid$="-value"]').count();
  kpiCount >= 5 ? ok(`KPI 5 指标在场（${kpiCount} 个数值节点）`) : bad(`KPI 数值节点不足：${kpiCount}`);

  const cardCount = await page.locator('[data-testid^="risk-card-"]').count();
  cardCount > 0 ? ok(`风险卡网格在场（${cardCount} 张卡）`) : bad("风险卡网格缺失");

  const luoyang = await page.locator('[data-testid="risk-nodata-洛阳"]').count();
  luoyang > 0 ? ok("洛阳无源诚实空态卡在场（risk-nodata-洛阳）") : bad("洛阳无源诚实空态卡缺失（禁伪造/禁误删）");

  const planPanel = await page.locator('[data-testid=risk-plan-panel]').count();
  planPanel > 0 ? ok("处置计划表在场（risk-plan-panel）") : bad("处置计划表缺失");

  const healthBanner = await page.locator('[data-testid=risk-kpi-health]').count();
  console.log(healthBanner > 0
    ? `INFO KPI健康横幅本次渲染出现（count=${healthBanner}·当前 mock fixture 提供了 confidence.note）`
    : "INFO KPI健康横幅本次未渲染（VITE_MOCK 默认 RISK_TIMELINE fixture 未设置 confidence.note——代码块本身未删，未改动，条件为假属 fixture 数据缺口，非本次改动引入）");

  await page.screenshot({ path: `${OUT}/B-mock-collapsed-full.png`, fullPage: true });
  ok(`截图（全部卡收起·全页）→ ${OUT}/B-mock-collapsed-full.png`);
  await page.screenshot({ path: `${OUT}/B-mock-collapsed-viewport.png`, fullPage: false });
  ok(`截图（全部卡收起·首屏viewport 1600x1000，对齐参照框取）→ ${OUT}/B-mock-collapsed-viewport.png`);

  // ---- 点开一张卡：详情态图例应带 risk-legend testid 出现 ----
  const firstCard = page.locator('[data-testid^="risk-card-"]').first();
  const firstCardTestId = await firstCard.getAttribute("data-testid");
  await firstCard.click();
  await page.waitForTimeout(400);
  const detailLegend = await page.locator('[data-testid=risk-legend]').count();
  detailLegend > 0 ? ok(`点开卡（${firstCardTestId}）→ 详情态三档图例出现（risk-legend count=${detailLegend}）`) : bad("详情态图例未出现");

  await page.screenshot({ path: `${OUT}/B-mock-detail-open.png`, fullPage: true });
  ok(`截图（展开详情态·全页）→ ${OUT}/B-mock-detail-open.png`);

} catch (e) {
  bad("异常：" + (e?.message ?? e));
} finally {
  await browser.close();
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass === results.length ? "ALL_PASS" : "HAS_FAIL"}: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
