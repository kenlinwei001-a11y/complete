// 项2：毛利 / 成本 / 交付三轴 —— 屏上写的是哪三根轴？单位是什么？按件成本的 BOM 口径有没有说清？
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};
const VIEWS = [["事件影响与对策", "i2-decision-console"], ["经营驾驶舱", "i2-dash"], ["接单可行性", "i2-project-sim"]];
try {
  await login(page);
  for (const [nav, tag] of VIEWS) {
    step(`侧边栏 →「${nav}」`);
    const ok = await navByText(page, nav);
    if (!ok) continue;
    await page.waitForTimeout(6000);
    // 展开 details
    for (let i = 0; i < 8; i++) {
      const n = await page.locator("details:not([open]) > summary").count();
      if (!n) break;
      try { await page.locator("details:not([open]) > summary").first().click({ timeout: 2500 }); counters.clicks++; await page.waitForTimeout(350); } catch { break; }
    }
    const t = await dump(page, tag);
    await shot(page, tag);
    out[nav] = {
      有单位成本: /单位成本/.test(t),
      单位成本读数: (t.match(/单位成本[\s\S]{0,60}/) ?? [null])[0]?.replace(/\n/g, " ").slice(0, 90),
      有毛利: /毛利/.test(t), 毛利读数: (t.match(/毛利[^\n]{0,40}\n[^\n]{0,30}/) ?? [null])[0]?.replace(/\n/g, " "),
      有交付轴: /交付率|准交|按期|交付\s*\n/.test(t),
      BOM口径说明: /BOM|只含物料|不含人工|不含制造费用/.test(t),
      三轴同屏: /毛利/.test(t) && /成本/.test(t) && /交付|按期/.test(t),
    };
    rec("P2", nav, out[nav]);
  }
  // 金丝雀：确认我的抓法在一个我确定有的串上命中
  const t2 = await page.evaluate(() => document.body.innerText);
  rec("CANARY", "金丝雀（导航词「经营驾驶舱」应命中）", { hit: t2.includes("经营驾驶舱") });
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item2-axes.json"), JSON.stringify(out, null, 2));
save("item2-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
