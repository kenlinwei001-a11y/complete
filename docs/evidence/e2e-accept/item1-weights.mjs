// 验收 1+2：多目标权重、方案比对、毛利/成本/交付三轴
// 判据（铁律 1.5 对照实验）：把「营收权重」从 1.0 改到 4.0，三个目标读数与排产名单必须按可预言方向变。
//   不变 ⇒ 旋钮是装饰品。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const findings = {};

async function readObjectives() {
  return await page.evaluate(() => {
    const txt = document.body.innerText;
    const grab = (label) => {
      const re = new RegExp(label.replace(/[()（）]/g, "\\$&") + "\\s*\\n\\s*([^\\n]+)");
      const m = txt.match(re);
      return m ? m[1].trim() : null;
    };
    // 排产名单：抓「获排产线」列里非「被挤」的订单号，按表格顺序
    const rows = [...document.querySelectorAll("table tr")].map((tr) => [...tr.cells].map((c) => c.innerText.trim()));
    const orderRows = rows.filter((r) => r.length >= 6 && /^SO-/.test(r[0] ?? ""));
    return {
      revenue: grab("营收（越高越好）"),
      penalty: grab("违约金（越低越好）"),
      changeover: grab("换型成本（越低越好）"),
      dRevenue: grab("营收 Δ（相对权重 1×）"),
      dPenalty: grab("违约金 Δ（相对权重 1×）"),
      dChangeover: grab("换型成本 Δ（相对权重 1×）"),
      scheduled: orderRows.filter((r) => !/被挤/.test(r[5] ?? "") && !/被挤/.test(r.join("|"))).map((r) => r[0]),
      squeezed: orderRows.filter((r) => /被挤/.test(r.join("|"))).map((r) => r[0]),
      totalOrderRows: orderRows.length,
    };
  });
}

// 找到某个权重滑杆/输入框
async function weightControl(label) {
  return await page.evaluateHandle((lab) => {
    const all = [...document.querySelectorAll("input[type=range], input[type=number], select")];
    for (const el of all) {
      // 向上找 3 层，看祖先文本里有没有这个标签
      let p = el, hop = 0;
      while (p && hop < 4) {
        if ((p.innerText || "").includes(lab)) return el;
        p = p.parentElement; hop++;
      }
      // 也看紧邻的前一个兄弟
      const prev = el.previousElementSibling;
      if (prev && (prev.innerText || "").includes(lab)) return el;
    }
    return null;
  }, label);
}

try {
  await login(page);
  step("侧边栏点进「接单组合优选」");
  await navByText(page, "接单组合优选");
  await page.waitForTimeout(4000);

  // 金丝雀：证明我的读数抓法是好的
  const before = await readObjectives();
  rec("CANARY", "读数抓取（应非空）", before);
  if (!before.revenue) { rec("FATAL", "我的取证坏了：抓不到「营收（越高越好）」读数，不许据此报「界面没有」"); throw new Error("canary fail"); }

  await shot(page, "i1-01-before");

  // 三根轴的口径文字（item 2）
  const axisText = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("多目标 + 跨对象占用推演");
    return t.slice(i, i + 900);
  });
  fs.writeFileSync(path.join(OUT, "screens", "i2-axes.txt"), axisText);

  // 找权重控件
  const ctrls = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("input[type=range], input[type=number]").forEach((el, i) => {
      let p = el, hop = 0, ctx = "";
      while (p && hop < 4) { ctx = (p.innerText || "").slice(0, 120); if (ctx) break; p = p.parentElement; hop++; }
      out.push({ i, type: el.type, min: el.min, max: el.max, step: el.step, value: el.value, ctx: ctx.replace(/\s+/g, " ") });
    });
    return out;
  });
  fs.writeFileSync(path.join(OUT, "weight-controls.json"), JSON.stringify(ctrls, null, 2));
  rec("PROBE", `页面上数值/滑杆控件 ${ctrls.length} 个`);
  ctrls.slice(0, 30).forEach((c) => rec("CTRL", `[${c.i}] ${c.type} v=${c.value} min=${c.min} max=${c.max} :: ${c.ctx.slice(0, 90)}`));

  findings.before = before;
  findings.controls = ctrls;
} catch (e) {
  rec("FATAL", String(e).slice(0, 600));
}
fs.writeFileSync(path.join(OUT, "item1-findings.json"), JSON.stringify(findings, null, 2));
save("item1-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
