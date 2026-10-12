/* eslint-disable */
/**
 * ⌘K 面板输入丢字的定性 + 场景目录真值条数。
 * 判据：同一个 `type(delay)` 打法，中文串留得住、含数字的串留不住 ⇒ 锅在数字键。
 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = { typing: [], scenarios: {} };
const { browser, page } = await launch();
const net = [];
page.on("response", (res) => {
  if (/\/b\/v1\/scenarios/.test(res.url())) res.text().then((t) => net.push({ url: res.url(), body: t })).catch(() => {});
});

try {
  await login(page);
  await sleep(2000);

  // 场景目录真值：直接读**后端回包**，不数屏上那几行（屏上可能只是首屏）
  const s = net.find((e) => /scenarios/.test(e.url));
  if (s) {
    let j = null;
    try { j = JSON.parse(s.body); } catch {}
    R.scenarios.topKeys = j ? Object.keys(j) : null;
    // ⚠ 键名不一定叫 items（本轮真实教训：有人按 items 解析打印「0 条」，真键是 specs、真值 11 条）
    R.scenarios.counts = {};
    if (j) for (const [k, v] of Object.entries(j)) R.scenarios.counts[k] = Array.isArray(v) ? v.length : typeof v;
    R.scenarios.sample = j ? JSON.stringify(j).slice(0, 300) : null;
  }

  await page.keyboard.press("Control+k");
  await sleep(1200);
  const dlg = page.locator('[role="dialog"]');
  const input = dlg.locator("input").first();
  R.uiRowCount = (await dlg.evaluate((d) => Array.from(d.querySelectorAll("button, li, [role='option']")).filter((e) => /^S\d\d/.test((e.innerText ?? "").trim())).length));

  for (const w of ["物料", "S02", "abc", "a1b2", "2170", "4680", "S", "常州20"]) {
    await input.fill("");
    await sleep(300);
    await input.type(w, { delay: 60 });
    await sleep(900);
    R.typing.push({ typed: w, got: await input.inputValue(), ok: (await input.inputValue()) === w });
  }
  R.shot = await shot(page, "P3-input-bug");
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
