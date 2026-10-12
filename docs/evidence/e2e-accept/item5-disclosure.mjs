// 项5：推演过程可披露 —— 六项逐项在屏上找一遍，缺哪项报哪项。
// 身份：以「一个看不到代码的人」读一遍，然后回答「你能判断这是真推演还是查表吗」。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, netCalls, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};
try {
  await login(page);
  step("侧边栏 →「统一推演控制台」");
  await navByText(page, "统一推演控制台");
  await page.waitForTimeout(6000);
  await shot(page, "i5-01-console");

  // 面板在扰动之后才有内容 ⇒ 先真跑一拍
  step("施加一条扰动并推演一拍（真调 A 侧 /a/v1/sim/sessions/:id/tick）");
  const apply = page.locator('button:has-text("施加并推演")').first();
  if (await apply.count() > 0) {
    const before = netCalls.length;
    await click(apply, "「施加并推演」");
    await page.waitForTimeout(12000);
    const tickCalls = netCalls.slice(before).filter((c) => /\/sim\/sessions\/.*\/tick/.test(c.path));
    out.tick = tickCalls;
    rec("P5", "tick 调用", { 条数: tickCalls.length, 明细: tickCalls.slice(0, 3) });
  } else rec("P5-MISS", "找不到「施加并推演」按钮");

  step("展开「推演过程」披露面板");
  const sum = page.locator('[data-testid="sim-disclosure-summary"]').first();
  const has = await sum.count();
  rec("CANARY", `sim-disclosure-summary 节点 ${has} 个（0 ⇒ 面板没渲染）`);
  out.panelPresent = has > 0;
  if (has > 0) {
    await click(sum, "展开「推演过程」");
    await page.waitForTimeout(2500);
    // 内部还有若干 details
    for (let i = 0; i < 10; i++) {
      const n = await page.locator('[data-testid^="sim-disclosure"] details:not([open]) > summary, details:not([open]) > summary[data-testid^="sim-disclosure"]').count();
      if (!n) break;
      try { await page.locator('details:not([open]) > summary[data-testid^="sim-disclosure"]').first().click({ timeout: 2500 }); counters.clicks++; await page.waitForTimeout(500); } catch { break; }
    }
    await page.waitForTimeout(1500);
  }
  await shot(page, "i5-02-disclosure");
  const t = await dump(page, "i5-disclosure");

  // 六项逐项判定（用屏上正文，不用源码）
  const sec = (name) => {
    const i = t.indexOf(name);
    return i < 0 ? null : t.slice(i, i + 420).split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 14);
  };
  out.六项 = {
    "①引用的数据(对象类型+条数+快照版本)": sec("引用的数据"),
    "②走过的本体切片(sliceKey+跳数+节点/边数)": sec("走过的本体切片"),
    "③命中的规则(规则key+系数+来源)": sec("命中的规则"),
    "④约束(阈值出处)": sec("约束"),
    "⑤agent是否参与": sec("agent") ?? sec("Agent") ?? sec("智能体"),
    "⑥各环节耗时": sec("耗时"),
  };
  for (const [k, v] of Object.entries(out.六项)) rec("P5-项", k, { 屏上: v ? v.slice(0, 8) : "❌ 屏上找不到" });

  // 关键词兜底
  out.关键词 = {
    快照版本: t.includes("快照版本"), 跳数: t.includes("跳数"), 切片: t.includes("切片"),
    规则表达式: t.includes("规则表达式"), 毫秒: t.includes("毫秒"),
    未调用agent: /未调用\s*agent|本次未调用/.test(t), agent字样: /agent|Agent/.test(t),
  };
  rec("P5", "关键词命中", out.关键词);
  const i = t.indexOf("推演过程 ·");
  if (i >= 0) fs.writeFileSync(path.join(OUT, "screens", "i5-disclosure-section.txt"), t.slice(i, i + 4000));
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item5-disclosure.json"), JSON.stringify(out, null, 2));
save("item5-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
