/* eslint-disable */
/**
 * 两问收口：
 *  ① ASCII 打第二个字符就丢 —— 是不是因为**焦点被抢走**？（查 activeElement）
 *  ② 后端 `items` 20 条，⌘K 面板只列 8 行 —— 是截断还是要滚动？
 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = {};
const { browser, page } = await launch();
try {
  await login(page);
  await sleep(1800);
  await page.keyboard.press("Control+k");
  await sleep(1200);
  const dlg = page.locator('[role="dialog"]');
  const input = dlg.locator("input").first();

  // ① 焦点追踪
  await input.click();
  R.focusBefore = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, type: a?.getAttribute("type"), placeholder: a?.getAttribute("placeholder") };
  });
  await page.keyboard.press("a");
  await sleep(400);
  R.focusAfter1 = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, placeholder: a?.getAttribute("placeholder"), value: a?.value ?? null };
  });
  await page.keyboard.press("b");
  await sleep(400);
  R.focusAfter2 = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, placeholder: a?.getAttribute("placeholder"), value: a?.value ?? null };
  });
  R.inputValueAfterAB = await input.inputValue();
  // 重新点回输入框再打一个，看是不是「点一次只能打一个」
  await input.click();
  await page.keyboard.press("c");
  await sleep(400);
  R.afterRefocusC = await input.inputValue();

  // ② 面板里到底列了几条、能不能滚
  R.panel = await dlg.evaluate((d) => {
    const rows = Array.from(d.querySelectorAll("button, li, [role='option']")).filter((e) => /^S\d\d/.test((e.innerText ?? "").trim()));
    const list = rows.length ? rows[0].parentElement : null;
    return {
      rowCount: rows.length,
      firstRow: rows[0]?.innerText.replace(/\n+/g, " | ").trim() ?? null,
      lastRow: rows[rows.length - 1]?.innerText.replace(/\n+/g, " | ").trim() ?? null,
      listScrollHeight: list?.scrollHeight ?? null,
      listClientHeight: list?.clientHeight ?? null,
      scrollable: list ? list.scrollHeight > list.clientHeight + 2 : null,
      dialogText: d.innerText.slice(0, 120),
    };
  });
  // 清空后再看（有查询词会过滤，空串才是全量）
  await input.fill("");
  await sleep(900);
  R.panelEmptyQuery = await dlg.evaluate((d) => {
    const rows = Array.from(d.querySelectorAll("button, li, [role='option']")).filter((e) => /^S\d\d/.test((e.innerText ?? "").trim()));
    const list = rows.length ? rows[0].parentElement : null;
    return {
      rowCount: rows.length,
      ids: rows.map((r) => (r.innerText.trim().match(/^S\d\d/) ?? [""])[0]),
      scrollable: list ? list.scrollHeight > list.clientHeight + 2 : null,
      scrollH: list?.scrollHeight ?? null,
      clientH: list?.clientHeight ?? null,
    };
  });
  R.shot = await shot(page, "P4-focus-and-rows");
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
