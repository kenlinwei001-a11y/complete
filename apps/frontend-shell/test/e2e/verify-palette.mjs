/* eslint-disable */
/**
 * ⌘K 场景命令面板的**逐词**实测。
 *
 * ⚠ 上一版的金丝雀是坏的：用 `Control+a` 想清空输入，实际没选中，
 *   于是查的是「物料延期物料」这种拼接串 —— **两次都报「无匹配场景」当然一致，
 *   但它证明不了面板坏没坏**。本版每个词都**关掉面板重开**，从空串打起。
 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = { queries: [] };
const { browser, page } = await launch();

async function ask(word) {
  // 每次从头：Esc 关掉 → 重开 → 从空串打
  await page.keyboard.press("Escape");
  await sleep(500);
  await page.keyboard.press("Control+k");
  await sleep(1000);
  const dlg = page.locator('[role="dialog"]');
  if ((await dlg.count()) === 0) return { word, opened: false };
  const input = dlg.locator("input").first();
  await input.click();
  await input.fill("");
  await sleep(400);
  const emptyState = await dlg.innerText();
  await input.type(word, { delay: 40 });
  await sleep(1500);
  const txt = await dlg.innerText();
  const rows = await dlg.evaluate((d) =>
    Array.from(d.querySelectorAll("button, li, [role='option']"))
      .map((e) => (typeof e.innerText === "string" ? e.innerText.replace(/\s*\n\s*/g, " | ").trim() : ""))
      .filter((t) => t.length > 0 && t !== "✕"),
  );
  return {
    word,
    opened: true,
    inputValue: await input.inputValue(),
    noMatch: /无匹配场景/.test(txt),
    rowCount: rows.length,
    rows: rows.slice(0, 8),
    emptyStateHead: emptyState.slice(0, 200).replace(/\n+/g, " / "),
  };
}

try {
  await login(page);
  await sleep(1500);
  // 空串先看一眼面板默认列什么（这是判断「搜索坏了」还是「真没匹配」的基准）
  await page.keyboard.press("Control+k");
  await sleep(1200);
  R.emptyPanel = await page.locator('[role="dialog"]').innerText().catch(() => null);
  R.emptyPanelShot = await shot(page, "P0-palette-empty");

  // 金丝雀在前：这些词我**确定**在场景名/问句里出现过
  for (const w of ["物料", "订单", "交期", "齐套", "库存", "常州", "S02", "风险", "物料延期", "延期", "停机", "插单"]) {
    const res = await ask(w);
    R.queries.push(res);
  }
  R.shotFinal = await shot(page, "P1-palette-last");
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 500);
  try { R.shotFatal = await shot(page, "ERR-palette"); } catch {}
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
