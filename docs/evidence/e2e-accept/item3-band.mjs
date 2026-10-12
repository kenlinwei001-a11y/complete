// 项3：需求区间 P10/P50/P90 —— 屏上看得见区间条吗？三个数分别是多少？
// ⚠ 上一版找不到是因为三个分位藏在 Provenance 悬浮里，屏上正文只有「└ 预测区间」+ 一个数。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};
try {
  await login(page);
  step("侧边栏 →「产能推演」");
  await navByText(page, "产能推演");
  await page.waitForTimeout(5000);

  step("展开第一张基地卡（BaseOutlookPanel 在卡内）");
  // 卡片可点区域
  const cards = await page.locator('[class*="card"], article, section').filter({ hasText: "最早越线" }).count();
  rec("PROBE", `含「最早越线」的卡片容器 ${cards} 个`);
  const cz = page.locator('text=常州').first();
  await click(cz, "点「常州」卡");
  await page.waitForTimeout(4000);
  // 展开所有 details
  for (let i = 0; i < 14; i++) {
    const n = await page.locator("details:not([open]) > summary").count();
    if (!n) break;
    try { await page.locator("details:not([open]) > summary").first().click({ timeout: 3000 }); counters.clicks++; await page.waitForTimeout(400); } catch { break; }
  }
  await page.waitForTimeout(3000);

  // 金丝雀：先证明 BaseOutlookPanel 真的渲染出来了
  const canary = await page.locator('[data-testid^="outlook-"]').count();
  rec("CANARY", `outlook-* testid 元素 ${canary} 个（0 ⇒ 面板没渲染，取证坏了）`);
  out.canaryOutlookNodes = canary;

  const band = await page.locator('[data-testid="outlook-forecast-band"]').count();
  const bandVal = await page.locator('[data-testid="outlook-forecast-band-value"]').count();
  out.band = { 区间条节点数: band, 区间数值节点数: bandVal };
  rec("P3", "区间条", out.band);

  if (bandVal > 0) {
    const v = await page.locator('[data-testid="outlook-forecast-band-value"]').first().innerText();
    out.band.屏上数值 = v.trim();
    rec("P3", "区间条屏上数值", { v: v.trim() });
    step("悬停区间条，读 P10 / P50 / P90 三个数");
    const prov = page.locator('[data-testid="outlook-forecast-band-prov"]').first();
    if (await prov.count() > 0) {
      await prov.hover(); counters.clicks++;
      await page.waitForTimeout(1800);
      const tip = await page.evaluate(() => document.body.innerText);
      const m = tip.match(/保守 P90[^\n]*|基准 P50[^\n]*|乐观 P10[^\n]*/g);
      out.band.悬浮三分位 = m;
      rec("P3", "悬浮读数", { m });
      await shot(page, "i3-band-hover");
      // 也把 title 属性抓下来（Provenance 常用 title）
      const attrs = await prov.evaluate((el) => ({ title: el.getAttribute("title"), aria: el.getAttribute("aria-label"), text: el.innerText }));
      out.band.节点属性 = attrs;
      rec("P3", "节点属性", attrs);
    } else rec("P3", "找不到 outlook-forecast-band-prov");
  }
  const t = await dump(page, "i3-band-final");
  await shot(page, "i3-band-final");
  out.屏上有预测区间字样 = t.includes("预测区间");
  out.屏上有P字样 = { P10: t.includes("P10"), P50: t.includes("P50"), P90: t.includes("P90") };
  rec("P3", "正文字样", { 预测区间: out.屏上有预测区间字样, ...out.屏上有P字样 });
  // 把「预测区间」附近的正文抓出来
  const idx = t.indexOf("预测区间");
  if (idx >= 0) { out.附近正文 = t.slice(Math.max(0, idx - 500), idx + 400); fs.writeFileSync(path.join(OUT, "screens", "i3-band-context.txt"), out.附近正文); }
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item3-band.json"), JSON.stringify(out, null, 2));
save("item3-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
