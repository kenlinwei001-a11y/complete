/* eslint-disable */
/**
 * 判据 1 的后半句 · 「无一句指引说『物料延期该点哪个』」。
 *
 * 光扫首页文本不够 —— 用户真遇到物料延期时会做两件事：
 *  ① 在首页顶上那个搜索框 / ⌘K 里打「物料延期」
 *  ② 挨个看高频场景卡的触发问句
 * 两条都真走一遍，再下结论。
 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = { palette: {}, cards: {}, searchBox: {}, landing: {} };
const { browser, page } = await launch();

try {
  await login(page);
  await sleep(1500);

  // ── 高频场景卡的触发问句原文 ──────────────────────────────────────
  R.cards.list = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="home-scenario-"]')).map((e) => e.innerText.replace(/\n+/g, " | ").trim()),
  );
  R.cards.mentionsDelay = R.cards.list.filter((t) => /延期|延误|晚到|到货推迟|物料.*迟/.test(t));
  R.cards.mentionsMaterial = R.cards.list.filter((t) => /物料|缺料|齐套|长协|库存/.test(t));

  // ── 顶部全局搜索框：真打「物料延期」──────────────────────────────
  const box = page.locator('input[placeholder*="搜索"]').first();
  R.searchBox.present = (await box.count()) > 0;
  if (R.searchBox.present) {
    R.searchBox.placeholder = await box.getAttribute("placeholder");
    await box.click();
    await box.fill("物料延期");
    await sleep(2500);
    R.searchBox.shot = await shot(page, "G1-search-material-delay");
    R.searchBox.results = await page.evaluate(() => {
      const t = document.body.innerText;
      return { textTail: t.slice(-1500), hasNoResult: /没有|无结果|未找到|暂无/.test(t) };
    });
  }

  // ── ⌘K 命令面板：真按一次，真打「物料延期」───────────────────────
  await page.keyboard.press("Escape");
  await sleep(600);
  await page.keyboard.press("Meta+k");
  await sleep(1200);
  let opened = await page.evaluate(() => /场景|command|palette/i.test(document.body.innerText.slice(0, 200)) || document.querySelectorAll('[role="dialog"]').length > 0);
  if (!opened) {
    await page.keyboard.press("Control+k");
    await sleep(1200);
    opened = (await page.locator('[role="dialog"]').count()) > 0;
  }
  R.palette.opened = opened;
  R.palette.dialogCount = await page.locator('[role="dialog"]').count();
  if (opened) {
    R.palette.shotOpen = await shot(page, "G2-palette-open");
    await page.keyboard.type("物料延期");
    await sleep(1800);
    R.palette.shotQuery = await shot(page, "G3-palette-material-delay");
    R.palette.afterQuery = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return (dlg ? dlg.innerText : document.body.innerText).slice(0, 1200);
    });
    // 金丝雀：换一个**我确定有**的词，同一个面板必须给出结果
    await page.keyboard.press("Control+a");
    await page.keyboard.type("物料");
    await sleep(1800);
    R.palette.canaryQuery = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return (dlg ? dlg.innerText : document.body.innerText).slice(0, 1200);
    });
    R.palette.shotCanary = await shot(page, "G4-palette-canary");
  }
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 500);
  try { R.shotFatal = await shot(page, "ERR-guidance"); } catch {}
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
