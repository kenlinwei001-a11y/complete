// 验收 3 · 需求区间 P10/P50/P90（产能推演 → 展开基地卡 → BaseOutlookPanel）
// 验收 6 · 订单 → 工单 fulfills（订单台账 → 点一张单）
// 验收 7 · 隔离区丢弃（理由留空能否提交 / 填了能否回读）
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, netCalls, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};

async function expandAll() {
  // <details> 要发 toggle；受控组件不认 details.open=true ⇒ 优先点 summary
  const n = await page.locator("details:not([open]) > summary").count();
  for (let i = 0; i < Math.min(n, 12); i++) {
    try { await page.locator("details:not([open]) > summary").first().click({ timeout: 3000 }); counters.clicks++; await page.waitForTimeout(400); } catch { break; }
  }
  return n;
}

try {
  await login(page);

  // ───────── 3. 需求区间 P10/P50/P90 ─────────
  rec("SECTION", "=== 项3 需求区间 P10/P50/P90 ===");
  step("侧边栏 →「产能推演」");
  await navByText(page, "产能推演");
  await page.waitForTimeout(4000);
  const t0 = await page.evaluate(() => document.body.innerText);
  rec("P3", "落地页有无 P10/P90", { hasP10: t0.includes("P10"), hasP90: t0.includes("P90"), hasP50: t0.includes("P50") });

  step("点第一张基地风险卡展开（P10–P90 带在展开层里）");
  // 卡片：找含「最早越线」的可点元素
  const card = page.locator('text=常州').first();
  if (await card.count() > 0) { await click(card, "点「常州」基地卡"); await page.waitForTimeout(3500); }
  await expandAll();
  await page.waitForTimeout(2500);
  const t1 = await dump(page, "i3-risk-expanded");
  await shot(page, "i3-risk-expanded");
  const band = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("P10");
    return i < 0 ? null : t.slice(Math.max(0, i - 700), i + 700);
  });
  out.p3 = { hasP10: t1.includes("P10"), hasP90: t1.includes("P90"), hasP50: t1.includes("P50"), band };
  rec("P3", "展开后", { hasP10: t1.includes("P10"), hasP90: t1.includes("P90"), hasP50: t1.includes("P50") });
  if (band) fs.writeFileSync(path.join(OUT, "screens", "i3-band.txt"), band);

  // ───────── 6. 订单 → 工单 fulfills ─────────
  rec("SECTION", "=== 项6 订单→工单 fulfills ===");
  step("侧边栏 →「订单台账」");
  await navByText(page, "订单台账");
  await page.waitForTimeout(4000);
  const o0 = await dump(page, "i6-order-list");
  await shot(page, "i6-order-list");
  out.p6 = { listHasFulfills: /fulfills|兑现|工单/.test(o0) };
  rec("P6", "台账页", { 有工单字样: out.p6.listHasFulfills, 覆盖率字样: /覆盖率/.test(o0) });

  step("点第一张订单（看能不能看到兑现它的工单）");
  const soLink = page.locator('a:has-text("SO-"), td:has-text("SO-"), button:has-text("SO-")').first();
  if (await soLink.count() > 0) {
    const label = (await soLink.innerText()).trim().slice(0, 30);
    await click(soLink, `点订单「${label}」`);
    await page.waitForTimeout(4000);
  } else { rec("P6-MISS", "台账上找不到可点的 SO- 元素"); }
  await expandAll();
  await page.waitForTimeout(2500);
  const o1 = await dump(page, "i6-order-detail");
  await shot(page, "i6-order-detail");
  out.p6.detail = {
    hasFulfills: /fulfills/.test(o1), hasWorkOrder: /工单/.test(o1),
    coverage: (o1.match(/覆盖率[^\n]{0,60}/g) ?? []).slice(0, 6),
    woIds: (o1.match(/WO-[A-Za-z0-9_-]+/g) ?? []).slice(0, 8),
  };
  rec("P6", "订单详情", out.p6.detail);

  // ───────── 7. 隔离区丢弃 ─────────
  rec("SECTION", "=== 项7 隔离区丢弃 ===");
  step("侧边栏 →「隔离区」");
  await navByText(page, "隔离区");
  await page.waitForTimeout(4000);
  const q0 = await dump(page, "i7-quarantine");
  await shot(page, "i7-quarantine");
  out.p7 = { pageText: q0.slice(q0.indexOf("隔离区", 400)).slice(0, 800) };
  const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter((x) => x && x.length < 30));
  out.p7.buttons = btns;
  rec("P7", "隔离区按钮", { btns: btns.join(" | ").slice(0, 300) });
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }

fs.writeFileSync(path.join(OUT, "items3to7.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(OUT, "items3to7-netcalls.json"), JSON.stringify(netCalls, null, 2));
save("items3to7-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
