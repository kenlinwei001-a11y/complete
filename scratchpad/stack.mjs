#!/usr/bin/env node
/**
 * E6 · 一屏预算尺。
 *
 * 用法：node scratchpad/stack.mjs [scenario-id] [vite-port]
 * 默认：scenario-id = material-price-up，port = 5173
 *
 * 在 1680×900 视口下打开 http://127.0.0.1:<port>/v/sim-unified，
 * 尽量复现一个带对策的页签状态，然后量「对策方案」页签内容区的
 * scrollHeight / clientHeight，判 ≤ 1.15。
 */

const SCENARIO = process.argv[2] ?? "material-price-up";
const PORT = process.argv[3] ?? "5173";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TARGET_RATIO = 1.15;

async function main() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (e) {
    console.error(`本脚本依赖 Playwright（npm i -D playwright），当前未安装。`);
    console.error(`也可装系统 chromium 后设 CHROME_PATH 环境变量再试。`);
    console.error(e.message);
    process.exit(2);
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ "X-Debug-User": "demo:admin:admin" });

  console.log(`→ ${BASE_URL}/v/sim-unified  (viewport 1680×900)`);
  await page.goto(`${BASE_URL}/v/sim-unified`, { waitUntil: "networkidle" });

  // 尽量把 scenario 加进去并跑一遍推演，让对策区有真实内容。
  // 任何一步失败都不退出——可能只是当前状态已经够了——继续量。
  try {
    const evBtn = `[data-testid="c0828-ev-${SCENARIO}"]`;
    await page.click(evBtn, { timeout: 5000 });
    const form = `[data-testid="c0828-form-${SCENARIO}"]`;
    await page.waitForSelector(form, { timeout: 5000 });

    // 选落点下拉第一个真实选项（跳过占位 option）。
    const pickSel = `[data-testid="c0828-pick-${SCENARIO}"]`;
    const firstOption = await page.$eval(`${pickSel} option:nth-of-type(2)`, (el) => (el as HTMLOptionElement).value);
    if (firstOption) await page.selectOption(pickSel, firstOption);

    await page.click(`[data-testid="c0828-add-${SCENARIO}"]`, { timeout: 5000 });
    await page.click('text=开始推演', { timeout: 5000 });
    await page.waitForSelector('[data-testid="c0828-run-badge"]', { timeout: 30000 });
  } catch (e) {
    console.log(`注：自动加场景未完全成功（${(e as Error).message}），继续量当前状态。`);
  }

  // 切到「对策方案」页签。
  try {
    await page.click('[data-testid="c0828-tab-options"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="c0828-opt-grid"]', { timeout: 10000 });
  } catch (e) {
    await browser.close();
    console.error(`未能打开「对策方案」页签：${(e as Error).message}`);
    process.exit(2);
  }

  // 给一点渲染余量。
  await page.waitForTimeout(300);

  const measure = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="c0828-tabbody"]');
    if (!body) return null;
    return {
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });

  await browser.close();

  if (measure === null) {
    console.error("未找到 [data-testid=\"c0828-tabbody\"] 量高节点");
    process.exit(2);
  }

  const { scrollHeight, clientHeight } = measure;
  const ratio = clientHeight > 0 ? scrollHeight / clientHeight : 0;
  const pass = ratio <= TARGET_RATIO;

  console.log(`scrollHeight=${scrollHeight} clientHeight=${clientHeight} ratio=${ratio.toFixed(3)}`);
  console.log(pass ? `PASS (≤ ${TARGET_RATIO})` : `FAIL (> ${TARGET_RATIO})`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
