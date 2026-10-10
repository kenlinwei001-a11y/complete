/* eslint-disable */
/** 把推演回包里「元」与金额字段的**上下文原文**挖出来，判断它们到底是不是钱。 */
import { launch, login, attachNetLog, sleep, shot } from "./lib.mjs";

const R = { hits: [], fields: {}, screen: {} };
const { browser, page } = await launch();
const net = attachNetLog(page);

async function clickNav(t) {
  const l = page.locator("nav a, aside a").filter({ hasText: t }).first();
  await l.waitFor({ state: "visible", timeout: 15000 });
  await l.click();
  await sleep(3000);
}

try {
  await login(page);
  await sleep(1500);
  await clickNav("统一推演控制台");
  await sleep(4000);
  try {
    const b = page.locator("button").filter({ hasText: "施加并推演" }).first();
    if (await b.isEnabled()) { await b.click(); await sleep(9000); }
  } catch {}
  for (const t of ["方案寻优"]) {
    await page.locator("button").filter({ hasText: t }).first().click({ timeout: 8000 });
    await sleep(8000);
    R.screen.optimizeShot = await shot(page, "12-tab-optimize");
    const txt = await page.evaluate(() => document.body.innerText);
    R.screen.optimizeYuan = (txt.match(/元/g) ?? []).length;
    R.screen.optimizeYi = (txt.match(/亿/g) ?? []).length;
    R.screen.optimizeWan = (txt.match(/万/g) ?? []).length;
    R.screen.optimizeMoneyHits = (txt.match(/[^\n]{0,40}(?:亿元|万元|亿|元)[^\n]{0,12}/g) ?? []).slice(0, 25);
    R.screen.optimizeTextSample = txt.slice(0, 2200);
  }
  await sleep(1500);

  for (const e of net) {
    if (!/\/a\/v1\/sim\//.test(e.url) || typeof e.body !== "string") continue;
    const ctx = e.body.match(/.{0,60}元.{0,25}/g) ?? [];
    if (ctx.length) R.hits.push({ url: e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "").slice(0, 90), ctx: ctx.slice(0, 6) });
    // 金额字段的**取值样例**（判断量纲）
    for (const k of ["revenue", "cost", "amount", "value"]) {
      const m = e.body.match(new RegExp('"' + k + '"\\s*:\\s*(-?[0-9.eE+-]+)', "g")) ?? [];
      if (m.length) {
        const key = e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "").slice(0, 60) + " :: " + k;
        R.fields[key] = { n: m.length, sample: m.slice(0, 6) };
      }
    }
    // 有没有显式的单位/量纲声明
    const units = e.body.match(/"unit"\s*:\s*"[^"]{0,12}"/g) ?? [];
    if (units.length) {
      const u = e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "").slice(0, 60);
      R.fields[u + " :: units"] = { n: units.length, sample: Array.from(new Set(units)).slice(0, 12) };
    }
  }
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
