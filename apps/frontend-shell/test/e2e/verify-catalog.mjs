/* eslint-disable */
/** 场景目录全量 + 「打 S02 只剩 S」那个疑似输入丢字的复核。 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = {};
const { browser, page } = await launch();
try {
  await login(page);
  await sleep(1500);
  await page.keyboard.press("Control+k");
  await sleep(1200);
  const dlg = page.locator('[role="dialog"]');
  R.catalog = await dlg.innerText();
  R.catalogRows = await dlg.evaluate((d) =>
    Array.from(d.querySelectorAll("button, li, [role='option']"))
      .map((e) => (typeof e.innerText === "string" ? e.innerText.replace(/\s*\n\s*/g, " | ").trim() : ""))
      .filter((t) => t.length > 0 && t !== "✕"),
  );

  // ── 复核：打 "S02" 到底剩下什么（三种打法各试一次，排除是我打字方式的锅）──
  const input = dlg.locator("input").first();
  const trials = [];
  for (const [how, fn] of [
    ["fill 一次性灌入", async () => { await input.fill("S02"); }],
    ["type 逐字 40ms", async () => { await input.fill(""); await input.type("S02", { delay: 40 }); }],
    ["type 逐字 200ms", async () => { await input.fill(""); await input.type("S02", { delay: 200 }); }],
    ["press 逐键", async () => { await input.fill(""); await input.press("S"); await input.press("0"); await input.press("2"); }],
  ]) {
    await fn();
    await sleep(1200);
    trials.push({ how, value: await input.inputValue(), noMatch: /无匹配场景/.test(await dlg.innerText()) });
  }
  R.s02Trials = trials;
  R.shot = await shot(page, "P2-catalog");
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
