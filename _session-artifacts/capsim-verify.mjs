// 真起前端 + 真 Chromium 渲染核验脚本（产能推演看板 1:1 复刻·截图取证）
import { chromium } from "playwright-core";
import fs from "node:fs";

const SHOT_DIR = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/capsim-replica-shots";
const BASE = "http://127.0.0.1:5210";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const log = (...a) => console.log(...a);

async function main() {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));
  page.on("requestfailed", (req) => {
    // ignore devtools/HMR noise, keep real failures
    if (!req.url().includes("/@")) consoleErrors.push(`REQUEST_FAILED ${req.url()} ${req.failure()?.errorText}`);
  });

  // ---- 登录 demo/planner (mock 密码 demo) ----
  log("STEP login: goto /login");
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "planner");
  await page.fill("#login-password", "demo");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/", { timeout: 15000 });
  log("STEP login: OK, landed on", page.url());
  await page.waitForTimeout(600);

  // ---- 导航到 /v/risk（客户端路由点击导航，保住内存态 access token）----
  log("STEP nav: click risk nav link");
  const navLink = page.locator('a[href="/v/risk"]');
  await navLink.first().waitFor({ timeout: 10000 });
  await navLink.first().click();
  await page.waitForSelector('[data-testid="risk-kpi"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  // ==== 1. 主看板 ====
  await page.screenshot({ path: `${SHOT_DIR}/01-main-board.png`, fullPage: true });
  const kpiText = await page.locator('[data-testid="risk-kpi"]').innerText();
  log("KPI_TEXT_START");
  log(kpiText);
  log("KPI_TEXT_END");
  const title = await page.locator("h3").first().innerText();
  log("TITLE:", title);
  const cardCount = await page.locator('[data-testid^="risk-card-"]').count();
  log("CARD_COUNT:", cardCount);

  // decision-mode 诚信侧查（G-DM-1）：全卡 data-decision-mode
  const cardEls = await page.locator('[data-testid^="risk-card-"]').all();
  const decisionModes = [];
  for (const c of cardEls) {
    const testId = await c.getAttribute("data-testid");
    const mode = await c.getAttribute("data-decision-mode");
    const hasNoData = (await c.locator('[data-testid^="risk-nodata-"]').count()) > 0;
    decisionModes.push({ testId, mode, hasNoData });
  }
  log("DECISION_MODES_START");
  log(JSON.stringify(decisionModes, null, 2));
  log("DECISION_MODES_END");

  // ==== 2. 点开常州卡内联详情 ====
  log("STEP: click risk-card-常州");
  await page.click('[data-testid="risk-card-常州"]');
  await page.waitForSelector('[data-testid="risk-detail-常州"]', { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/02-card-detail-常州.png`, fullPage: true });
  const hasTimeline = (await page.locator('[data-testid="risk-timeline"]').count()) > 0;
  const timelineRows = await page.locator('[data-testid^="risk-frow-"]').count();
  const dotCount30 = await page.locator('[data-testid^="risk-dot-"]').count();
  const mitigationCards = await page.locator('[data-testid^="mitigation-plan-"]').count();
  log("HAS_TIMELINE:", hasTimeline, "TIMELINE_ROWS:", timelineRows, "DOT_COUNT@30d:", dotCount30, "MITIGATION_CARDS:", mitigationCards);
  const qaChipCount = await page.locator('[data-testid^="qa-chip-"]').count();
  log("QA_CHIP_COUNT:", qaChipCount);

  // ==== 3. 对话态真源：点「影响哪些客户？」====
  log("STEP: click qa-chip 影响哪些客户？");
  await page.click('[data-testid="qa-chip-影响哪些客户？"]');
  await page.waitForTimeout(250);
  const qaAnswer = await page.locator('[data-testid="risk-qa-answer"]').innerText();
  log("QA_ANSWER_START");
  log(qaAnswer);
  log("QA_ANSWER_END");
  await page.screenshot({ path: `${SHOT_DIR}/03-qa-answer.png`, fullPage: true });

  // ==== 4. 时间轴点日 -> 受影响订单弹窗 ====
  log("STEP: click risk-dot-4 (D+5, 常州越线日)");
  const dot = page.locator('[data-testid="risk-dot-4"]').first();
  await dot.click();
  await page.waitForSelector('[data-testid="affected-orders-table"]', { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT_DIR}/04-affected-orders-modal.png`, fullPage: true });
  const ordersTableText = await page.locator('[data-testid="affected-orders-table"]').innerText();
  log("AFFECTED_ORDERS_TABLE_START");
  log(ordersTableText);
  log("AFFECTED_ORDERS_TABLE_END");
  // 关闭弹窗
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // ==== 5. 切 60 天窗口 ====
  log("STEP: click risk-window-60");
  await page.click('[data-testid="risk-window-60"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOT_DIR}/05-window-60.png`, fullPage: true });
  const kpiText60 = await page.locator('[data-testid="risk-kpi"]').innerText();
  log("KPI_TEXT_60_START");
  log(kpiText60);
  log("KPI_TEXT_60_END");
  const dotCount60 = await page.locator('[data-testid^="risk-dot-"]').count();
  log("DOT_COUNT@60d:", dotCount60);

  // ==== 6. 处置计划表 ====
  log("STEP: scroll to risk-plan-table");
  const planTable = page.locator('[data-testid="risk-plan-table"]');
  const planTableExists = (await planTable.count()) > 0;
  log("PLAN_TABLE_EXISTS:", planTableExists);
  if (planTableExists) {
    await planTable.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/06-plan-table.png`, fullPage: true });
    const planText = await planTable.innerText();
    log("PLAN_TABLE_START");
    log(planText);
    log("PLAN_TABLE_END");
  }

  await browser.close();

  fs.writeFileSync(
    `${SHOT_DIR}/console-log.json`,
    JSON.stringify({ consoleErrors, pageErrors }, null, 2),
  );
  log("CONSOLE_ERRORS_COUNT:", consoleErrors.length);
  log("PAGE_ERRORS_COUNT:", pageErrors.length);
  if (consoleErrors.length) log("CONSOLE_ERRORS_SAMPLE:", JSON.stringify(consoleErrors.slice(0, 20), null, 2));
  if (pageErrors.length) log("PAGE_ERRORS_SAMPLE:", JSON.stringify(pageErrors.slice(0, 20), null, 2));
  log("SCRIPT_DONE_OK");
}

main().catch((e) => {
  console.error("SCRIPT_FAILED", e);
  process.exit(1);
});
