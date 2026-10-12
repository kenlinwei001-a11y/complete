// 复核求解方法旋钮（上一版抽取器错位：这一片是「值在上、标签在下」）
// 判据：① 修正抽取器并跑金丝雀 ② 拉旋钮后**点「发起联合求解」**再读，区分「旋钮死」与「旋钮要按钮才生效」
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, save, rec, step, click, counters, netPorts, netCalls, OUT, shot } from "./lib.mjs";

const { browser, page } = await boot();
const out = { rows: [] };

// 正确抽取：标签在下 ⇒ 取标签**前面**那一行
async function snap() {
  return await page.evaluate(() => {
    const lines = document.body.innerText.split("\n").map((s) => s.trim());
    const before = (label) => { const i = lines.findIndex((l) => l === label); return i > 0 ? lines[i - 1] : null; };
    const rows = [...document.querySelectorAll("table tr")].map((tr) => [...tr.cells].map((c) => c.innerText.trim()));
    const planRows = rows.filter((r) => r.length >= 8 && /最多按期|最低代价|最少换型|最小延误|最少库存/.test(r[0] ?? ""));
    const sliders = {};
    document.querySelectorAll("input[type=range]").forEach((el) => {
      let p = el, hop = 0, ctx = "";
      while (p && hop < 4) { ctx = (p.innerText || "").replace(/\s+/g, " "); if (ctx.trim()) break; p = p.parentElement; hop++; }
      if (/权重/.test(ctx)) sliders[ctx.replace(/[\d.]+×?$/, "").trim()] = el.value;
    });
    return {
      onTimeRate: before("按期率（最多按期）"),
      totalCost: before("总代价（代价单位·非货币）"),
      squeezed: before("被挤单"),
      pinned: before("固定单"),
      inTransit: before("在途库存(套·天)"),
      changeoverHrs: before("换型(全链小时)"),
      freight: before("在途运费(元)"),
      grossProxy: before("毛利代理(元)"),
      planTable: planRows,
      sliders,
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
  counters.clicks++; rec("SLIDER", `${lab} := ${val}`, { ok }); return ok;
}
async function resolveClick(label) {
  const l = page.locator(`button:has-text("${label}")`).first();
  if (await l.count() === 0) { rec("BTN-MISS", label); return false; }
  await click(l, `点「${label}」`);
  await page.waitForTimeout(8000);
  return true;
}

try {
  await login(page);
  step("→「接单组合优选」");
  await navByText(page, "接单组合优选");
  await page.waitForTimeout(5000);

  const base = await snap();
  rec("CANARY", "修正后抽取器（应全部非空且像数）", base);
  const nonEmpty = Object.entries(base).filter(([k, v]) => typeof v === "string" && v).length;
  if (nonEmpty < 6) { rec("FATAL", "取证坏了：抽取器仍抓不到读数，不许据此下结论"); throw new Error("canary fail"); }
  out.base = base;

  step("拉「按期 权重」到 10（不点按钮），读一次");
  await setSlider("按期 权重", 10);
  await page.waitForTimeout(6000);
  const noBtn = await snap();
  out.ontime10_noclick = noBtn;
  const d1 = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(noBtn[k]) && k !== "sliders");
  rec("RESULT", "按期权重=10 · 未点按钮", { 变了: d1.join(",") || "(什么都没变)", 按期率: noBtn.onTimeRate, 总代价: noBtn.totalCost, 毛利代理: noBtn.grossProxy });

  step("同一状态下点「发起联合求解」，再读一次（区分：旋钮死 vs 要按钮才生效）");
  const clicked = await resolveClick("发起联合求解");
  const afterBtn = await snap();
  out.ontime10_clicked = afterBtn;
  const d2 = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(afterBtn[k]) && k !== "sliders");
  rec("RESULT", `按期权重=10 · 已点按钮(${clicked})`, { 相对基线变了: d2.join(",") || "(什么都没变)", 按期率: afterBtn.onTimeRate, 总代价: afterBtn.totalCost, 毛利代理: afterBtn.grossProxy });
  await shot(page, "i1-knob-after-resolve");
  const txt = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(OUT, "screens", "i1-after-resolve.txt"), txt);

  step("再拉「代价 权重」到 10 并点按钮");
  await setSlider("代价 权重", 10);
  await page.waitForTimeout(3000);
  await resolveClick("发起联合求解");
  const c10 = await snap();
  out.cost10_clicked = c10;
  const d3 = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(c10[k]) && k !== "sliders");
  rec("RESULT", "代价权重=10 · 已点按钮", { 相对基线变了: d3.join(",") || "(什么都没变)", 按期率: c10.onTimeRate, 总代价: c10.totalCost });
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }

fs.writeFileSync(path.join(OUT, "item1-knobs2.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(OUT, "item1-knobs2-netcalls.json"), JSON.stringify(netCalls, null, 2));
save("item1-knobs2-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
