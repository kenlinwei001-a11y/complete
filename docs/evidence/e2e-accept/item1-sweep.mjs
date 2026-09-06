// 单调性扫描 + 求解方法旋钮复核（铁律 0.5：不许拿一次观测下「无效」结论）
// A. 营收权重 0→2.0 逐档，其余固定 1.0，记录营收/违约金/换型/排产单数
// B. 求解方法旋钮（按期/代价/换型/延误/成品库存）逐个拉到 0 与 10，看「方案量化多维比对」表与四个读数动不动；
//    并检查是否存在必须点的「重解」按钮。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, save, rec, step, counters, netPorts, netCalls, OUT, shot } from "./lib.mjs";

const { browser, page } = await boot();
const out = { sweepA: [], sweepB: [], buttons: [] };

async function snap() {
  return await page.evaluate(() => {
    const t = document.body.innerText;
    const grab = (label) => { const i = t.indexOf(label); if (i < 0) return null; return t.slice(i + label.length).split("\n").map((x) => x.trim()).filter(Boolean)[0] ?? null; };
    const rows = [...document.querySelectorAll("table tr")].map((tr) => [...tr.cells].map((c) => c.innerText.trim()));
    const multi = rows.filter((r) => r.length >= 7 && /^SO-/.test(r[0] ?? "") && /LINE-|被挤/.test(r[4] ?? ""));
    const planRows = rows.filter((r) => r.length >= 8 && /最多按期|最低代价|最少换型|最小延误|最少库存/.test(r[0] ?? ""));
    return {
      revenue: grab("营收（越高越好）"), penalty: grab("违约金（越低越好）"), changeover: grab("换型成本（越低越好）"),
      onTimeRate: grab("按期率（最多按期）"), totalCost: grab("总代价（代价单位·非货币）"),
      grossProxy: grab("毛利代理(元)"), changeoverHrs: grab("换型(全链小时)"), inTransit: grab("在途库存(套·天)"),
      sched: multi.filter((r) => /LINE-/.test(r[4])).map((r) => r[0]).join(","),
      planTable: JSON.stringify(planRows),
    };
  });
}
async function setSlider(lab, val) {
  const ok = await page.evaluate(({ lab, val }) => {
    for (const el of document.querySelectorAll("input[type=range]")) {
      let p = el, hop = 0, ctx = "";
      while (p && hop < 4) { ctx = (p.innerText || ""); if (ctx.trim()) break; p = p.parentElement; hop++; }
      if (ctx.includes(lab)) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(val));
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    } return false;
  }, { lab, val });
  counters.clicks++;
  return ok;
}

try {
  await login(page);
  step("→「接单组合优选」");
  await navByText(page, "接单组合优选");
  await page.waitForTimeout(5000);

  // 先记录页面上所有按钮（找「重解」入口）
  out.buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim().replace(/\s+/g, " ")).filter((x) => x && x.length < 40));
  rec("BUTTONS", out.buttons.filter((b) => /求解|重解|计算|应用|刷新|重算/.test(b)).join(" | ") || "(无 求解/重解/应用 类按钮)");

  // ── A. 营收权重单调性
  step("A · 营收权重 0→2.0 逐档扫描（其余权重固定 1.0）");
  for (const v of [0, 0.5, 1.0, 1.5, 2.0]) {
    await setSlider("营收权重", v);
    await page.waitForTimeout(5500);
    const s = await snap();
    out.sweepA.push({ w: v, ...s });
    rec("SWEEP-A", `营收权重=${v}`, { 营收: s.revenue, 违约金: s.penalty, 换型: s.changeover, 排产数: s.sched.split(",").filter(Boolean).length });
  }
  await setSlider("营收权重", 1); await page.waitForTimeout(4000);

  // ── B. 求解方法旋钮
  step("B · 求解方法旋钮逐个拉到极值，看读数与方案比对表动不动");
  const baseB = await snap();
  out.sweepB.push({ knob: "(基线 全1.0)", v: 1, ...baseB });
  rec("SWEEP-B", "基线", { 按期率: baseB.onTimeRate, 总代价: baseB.totalCost, 毛利代理: baseB.grossProxy, 换型小时: baseB.changeoverHrs });
  for (const knob of ["按期 权重", "代价 权重", "换型 权重", "延误 权重", "成品库存 权重"]) {
    for (const v of [10, 0]) {
      await setSlider(knob, v);
      await page.waitForTimeout(5500);
      const s = await snap();
      const changed = ["onTimeRate", "totalCost", "grossProxy", "changeoverHrs", "inTransit", "planTable", "sched"].filter((k) => s[k] !== baseB[k]);
      out.sweepB.push({ knob, v, changed, ...s });
      rec("SWEEP-B", `${knob}=${v}`, { 变了: changed.join(",") || "(什么都没变)", 按期率: s.onTimeRate, 总代价: s.totalCost });
    }
    await setSlider(knob, 1); await page.waitForTimeout(3000);
  }
  await shot(page, "i1-sweep-end");
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }

fs.writeFileSync(path.join(OUT, "item1-sweep.json"), JSON.stringify(out, null, 2));
// 求解相关的后端调用
fs.writeFileSync(path.join(OUT, "item1-sweep-netcalls.json"), JSON.stringify(netCalls, null, 2));
save("item1-sweep-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
