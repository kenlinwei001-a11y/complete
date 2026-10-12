// 对照实验（铁律 1.5）：营收权重 1.0 → 2.0（滑杆上限），三个目标读数 / 排产名单必须变。
// 同时抓「方案量化多维比对」表在两种权重下的差异。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, shot, save, rec, step, counters, netPorts, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};

async function readState(tag) {
  const s = await page.evaluate(() => {
    const t = document.body.innerText;
    const grab = (label) => {
      const i = t.indexOf(label);
      if (i < 0) return null;
      return t.slice(i + label.length).split("\n").map((x) => x.trim()).filter(Boolean)[0] ?? null;
    };
    const rows = [...document.querySelectorAll("table tr")].map((tr) => [...tr.cells].map((c) => c.innerText.trim()));
    const orderRows = rows.filter((r) => r.length >= 7 && /^SO-/.test(r[0] ?? ""));
    // 「多目标」表：订单/客户/型号体系/优先级/获排产线/营收/违约金
    const multi = orderRows.filter((r) => /LINE-|被挤/.test(r[4] ?? ""));
    // 方案比对表
    const planRows = rows.filter((r) => r.length >= 8 && /最多按期|最低代价|最少换型|最小延误/.test(r[0] ?? ""));
    // 滑杆当前值
    const sliders = [...document.querySelectorAll("input[type=range]")].map((el) => {
      let p = el, hop = 0, ctx = "";
      while (p && hop < 4) { ctx = (p.innerText || "").replace(/\s+/g, " ").slice(0, 60); if (ctx) break; p = p.parentElement; hop++; }
      return { v: el.value, ctx };
    }).filter((x) => /权重/.test(x.ctx));
    return {
      revenue: grab("营收（越高越好）"),
      penalty: grab("违约金（越低越好）"),
      changeover: grab("换型成本（越低越好）"),
      dRevenue: grab("营收 Δ（相对权重 1×）"),
      dPenalty: grab("违约金 Δ（相对权重 1×）"),
      dChangeover: grab("换型成本 Δ（相对权重 1×）"),
      onTimeRate: grab("按期率（最多按期）"),
      totalCost: grab("总代价（代价单位·非货币）"),
      grossProxy: grab("毛利代理(元)"),
      squeezedCount: (t.match(/被挤\s*(\d+)\s*单/) ?? [])[1] ?? null,
      scheduledOrders: multi.filter((r) => /LINE-/.test(r[4])).map((r) => r[0]),
      squeezedOrders: multi.filter((r) => /被挤/.test(r[4])).map((r) => r[0]),
      multiRows: multi.length,
      planTable: planRows,
      sliders,
    };
  });
  fs.writeFileSync(path.join(OUT, `exp-${tag}.json`), JSON.stringify(s, null, 2));
  rec("STATE", tag, { revenue: s.revenue, penalty: s.penalty, changeover: s.changeover, sched: s.scheduledOrders.length, squeezed: s.squeezedOrders.length, sliders: s.sliders.map((x) => x.ctx + "=" + x.v).join(" | ") });
  return s;
}

async function setSlider(labelIncludes, value) {
  const ok = await page.evaluate(({ lab, val }) => {
    const els = [...document.querySelectorAll("input[type=range]")];
    for (const el of els) {
      let p = el, hop = 0, ctx = "";
      while (p && hop < 4) { ctx = (p.innerText || ""); if (ctx.trim()) break; p = p.parentElement; hop++; }
      if (ctx.includes(lab)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, String(val));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { lab: labelIncludes, val: value });
  counters.clicks++;
  rec("SLIDER", `${labelIncludes} := ${value}`, { ok });
  return ok;
}

try {
  await login(page);
  step("侧边栏 →「接单组合优选」");
  await navByText(page, "接单组合优选");
  await page.waitForTimeout(5000);

  step("读基线（全部权重 1.0）");
  out.base = await readState("base");
  if (!out.base.revenue) throw new Error("金丝雀失败：读不到营收读数 ⇒ 取证坏了");
  await shot(page, "i1-exp-base");

  step("把「营收权重」拉到滑杆上限 2.0，观察是否重解");
  await setSlider("营收权重", 2);
  await page.waitForTimeout(6000);
  out.rev2 = await readState("rev2");
  await shot(page, "i1-exp-rev2");

  step("把「违约金权重」拉到 0（只顾营收），观察排产名单是否换人");
  await setSlider("违约金权重", 0);
  await page.waitForTimeout(6000);
  out.rev2pen0 = await readState("rev2pen0");
  await shot(page, "i1-exp-rev2pen0");

  step("反向：营收权重 0 / 违约金权重 2.0（只顾少赔），名单应换回另一批");
  await setSlider("营收权重", 0);
  await setSlider("违约金权重", 2);
  await page.waitForTimeout(6000);
  out.rev0pen2 = await readState("rev0pen2");
  await shot(page, "i1-exp-rev0pen2");

  step("换另一组旋钮：把「代价 权重」从 1.0 拉到 10（求解方法旋钮）");
  await setSlider("代价 权重", 10);
  await page.waitForTimeout(7000);
  out.cost10 = await readState("cost10");
  await shot(page, "i1-exp-cost10");

  // 判定
  const diff = (a, b, keys) => keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  out.verdict = {
    "营收权重1→2 变了什么": diff(out.base, out.rev2, ["revenue", "penalty", "changeover", "dRevenue", "scheduledOrders", "squeezedOrders", "planTable", "onTimeRate", "totalCost", "grossProxy"]),
    "再把违约金权重→0 变了什么": diff(out.rev2, out.rev2pen0, ["revenue", "penalty", "changeover", "dRevenue", "scheduledOrders", "squeezedOrders", "planTable"]),
    "反向(营收0/违约2) vs 基线": diff(out.base, out.rev0pen2, ["revenue", "penalty", "changeover", "scheduledOrders", "squeezedOrders", "planTable"]),
    "代价权重1→10 变了什么": diff(out.rev0pen2, out.cost10, ["onTimeRate", "totalCost", "grossProxy", "planTable", "scheduledOrders"]),
  };
  rec("VERDICT", JSON.stringify(out.verdict));
} catch (e) {
  rec("FATAL", String(e).slice(0, 700));
}
fs.writeFileSync(path.join(OUT, "item1-experiment.json"), JSON.stringify(out, null, 2));
save("item1-exp-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
