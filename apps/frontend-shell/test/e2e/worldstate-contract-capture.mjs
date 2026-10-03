/* eslint-disable */
/**
 * WO-WORLDSTATE-CONTRACT · 单次读屏取证（新开浏览器 ⇒ 无前端缓存干扰）。
 * 用法：`WSC_SHOT=wsc-05-after node …/worldstate-contract-capture.mjs`
 */
import { launch, shot, login, sleep } from "./lib.mjs";

const main = async () => {
  const { browser, page } = await launch();
  await login(page);
  await page.getByRole("link", { name: /统一推演控制台/ }).first().click();
  await sleep(1500);
  await page.getByText("方案寻优", { exact: true }).first().click();
  await page.waitForSelector('[data-testid="sandbox-opt"]', { timeout: 30000 });
  await sleep(5000);

  const cards = await page.$$('[data-testid^="sandbox-opt-card-"]');
  const first = cards[0] ? (await cards[0].innerText()).replace(/\s+/g, " ").trim() : null;
  const detail = await page.$eval('[data-testid="sandbox-opt-detail"]', (n) => n.innerText.replace(/\s+/g, " ").trim()).catch(() => null);
  const source = await page.$eval('[data-testid="sandbox-opt"]', (n) => n.getAttribute("data-source")).catch(() => null);
  const file = await shot(page, process.env.WSC_SHOT ?? "wsc-capture");
  console.log(JSON.stringify({ 方案条数: cards.length, dataSource: source, 首条方案: first, 右栏明细: detail, 截图: file }, null, 2));
  await browser.close();
};
main().catch((e) => { console.error("E2E FAILED:", e.stack || String(e)); process.exit(1); });
