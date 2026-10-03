// 项6 补追一层（铁律 0.5）：订单台账没露工单，那「订单进展与卡因」露不露？
// 金丝雀：SO-3391 后端确有 1 张工单（fulfills-coverage.json 实测）—— 屏上若也没有，才是真没有。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, netCalls, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};
try {
  await login(page);
  step("侧边栏 →「订单进展与卡因」");
  await navByText(page, "订单进展与卡因");
  await page.waitForTimeout(5000);
  const t = await dump(page, "i6-order-chain");
  await shot(page, "i6-order-chain");
  out.chain = {
    hasWorkOrder: /工单/.test(t), hasFulfills: /fulfills/.test(t),
    hasWoId: /WO-LINE|MO-WO/.test(t),
    coverage: (t.match(/覆盖率[^\n]{0,80}/g) ?? []).slice(0, 5),
    anchor: (t.match(/SO-\d+/g) ?? []).slice(0, 5),
  };
  rec("P6-CHAIN", "订单进展与卡因", out.chain);

  // 展开所有 details 再看
  const n = await page.locator("details:not([open]) > summary").count();
  for (let i = 0; i < Math.min(n, 15); i++) {
    try { await page.locator("details:not([open]) > summary").first().click({ timeout: 3000 }); counters.clicks++; await page.waitForTimeout(350); } catch { break; }
  }
  await page.waitForTimeout(2000);
  const t2 = await dump(page, "i6-order-chain-expanded");
  out.chainExpanded = { hasWorkOrder: /工单/.test(t2), hasWoId: /WO-LINE|MO-WO/.test(t2) };
  rec("P6-CHAIN", "展开后", out.chainExpanded);

  // 全站兜底：本体图谱里 fulfills 边露不露
  step("侧边栏 →「本体图谱」查 fulfills 边");
  await navByText(page, "本体图谱");
  await page.waitForTimeout(6000);
  const g = await dump(page, "i6-graph");
  out.graph = { hasFulfills: /fulfills|兑现/.test(g), hasWorkOrderType: /WorkOrder|工单/.test(g) };
  rec("P6-GRAPH", "本体图谱", out.graph);
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item6-orderchain.json"), JSON.stringify(out, null, 2));
save("item6-chain-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
