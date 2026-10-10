// 项4：本体关系「建 / 改 / 停 / 删」各走一遍 + 非法输入看屏上给什么话
// 写的是本 worktree 自起的内存态 datacore(:4051)，不碰任何共享环境。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, netCalls, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = { actions: [] };

async function setSelectByLabelish(nth, value) {
  // <select> 要发 change，不是 click
  return await page.evaluate(({ nth, value }) => {
    const sels = [...document.querySelectorAll("select")];
    const el = sels[nth];
    if (!el) return { ok: false, why: `没有第 ${nth} 个 select（共 ${sels.length}）` };
    const opt = [...el.options].find((o) => o.value === value || o.text === value);
    if (!opt) return { ok: false, why: `选项里没有 ${value}`, sample: [...el.options].slice(0, 5).map((o) => o.value) };
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, opt.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.text };
  }, { nth, value });
}
async function selectsInfo() {
  return await page.evaluate(() => [...document.querySelectorAll("select")].map((el, i) => {
    let p = el, hop = 0, ctx = "";
    while (p && hop < 3) { ctx = (p.innerText || "").replace(/\s+/g, " ").slice(0, 70); if (ctx.trim()) break; p = p.parentElement; hop++; }
    return { i, value: el.value, n: el.options.length, first: [...el.options].slice(0, 3).map((o) => o.value), ctx };
  }));
}
// 抓「屏上出现的话」——toast / 报错条 / 校验文案
async function screenMessage(prev) {
  const t = await page.evaluate(() => document.body.innerText);
  const added = t.split("\n").filter((l) => l.trim() && !prev.includes(l));
  return added.slice(0, 25);
}

try {
  await login(page);
  step("侧边栏 →「本体关系」");
  await navByText(page, "本体关系");
  await page.waitForTimeout(5000);
  const t0 = await page.evaluate(() => document.body.innerText);
  const base = await page.evaluate(() => {
    const t = document.body.innerText;
    const g = (l) => { const i = t.indexOf(l); return i < 0 ? null : t.slice(i + l.length).split("\n").map((x) => x.trim()).filter(Boolean)[0]; };
    return { 结构边: g("结构边"), 状态变量: g("状态变量"), 生效因果边: g("生效因果边"), rowCount: document.querySelectorAll("table tr").length };
  });
  rec("CANARY", "关系页基线读数（应非空）", base);
  if (!base.rowCount) throw new Error("取证坏了：页面没有表格行");
  out.base = base;

  const sels = await selectsInfo();
  fs.writeFileSync(path.join(OUT, "i4-selects.json"), JSON.stringify(sels, null, 2));
  rec("PROBE", `页面 select 数=${sels.length}`);
  sels.slice(0, 8).forEach((s) => rec("SEL", `[${s.i}] n=${s.n} v=${s.value} :: ${s.ctx}`));

  const btnTexts = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter((x) => x && x.length < 20));
  const uniq = [...new Set(btnTexts)];
  out.buttonVocab = uniq;
  rec("PROBE", "按钮词表", { 有建: uniq.some((b) => /建/.test(b)), 有改编辑: uniq.some((b) => /改|编辑/.test(b)), 有停用: uniq.includes("停用"), 有下线删除: uniq.some((b) => /下线|删除/.test(b)), 全部: uniq.slice(0, 25).join(",") });

  // ── 动作 A：建（合法）
  step("动作【建】：选来源=Order、去向=WorkOrder，点「建结构边」");
  const s1 = await setSelectByLabelish(0, "Order");
  const s2 = await setSelectByLabelish(1, "WorkOrder");
  rec("SET", "来源/去向", { s1, s2 });
  await page.waitForTimeout(1200);
  // 关系 key 输入框
  const keyInputs = await page.evaluate(() => [...document.querySelectorAll("input[type=text], input:not([type])")].map((el, i) => ({ i, ph: el.placeholder, v: el.value })));
  fs.writeFileSync(path.join(OUT, "i4-inputs.json"), JSON.stringify(keyInputs, null, 2));
  rec("PROBE", "文本框", keyInputs.slice(0, 6));
  const KEY = "e2e_probe_edge";
  const ti = page.locator('input[placeholder*="关系 key"]').first();
  if (await ti.count() > 0) { await ti.fill(KEY); counters.clicks++; rec("FILL", `关系 key := ${KEY}`); }
  else rec("FILL-MISS", "找不到「关系 key」输入框");
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => document.body.innerText);
  const mk = page.locator('button:has-text("建结构边")').first();
  const mkDisabled = await mk.isDisabled().catch(() => null);
  rec("BTN", "建结构边 disabled?", { mkDisabled });
  if (await mk.count() > 0 && !mkDisabled) { await click(mk, "点「建结构边」"); await page.waitForTimeout(4000); }
  else rec("BTN", "建结构边 不可点 —— 记为卡点");
  const msgA = await screenMessage(before);
  const afterA = await page.evaluate(() => document.body.innerText);
  out.actions.push({ act: "建(合法)", key: KEY, 新出现文本: msgA, 表里出现: afterA.includes(KEY), 结构边数: (afterA.match(/结构边\s*\n?\s*(\d+)/) ?? [])[1] });
  rec("ACT-建", "结果", { 表里出现: afterA.includes(KEY), 新文本: msgA.slice(0, 8) });
  await shot(page, "i4-after-create");
  await dump(page, "i4-after-create");

  // ── 动作 B：非法输入 —— 端点不存在
  step("非法【端点不存在】：直接打后端 —— 屏上路径先试 UI，再核后端回包话术");
  // ── 动作 C：停
  step("动作【停】：点新建那条边的「停用」");
  const rowStop = page.locator(`tr:has-text("${KEY}") button:has-text("停用")`).first();
  let stopOk = false;
  if (await rowStop.count() > 0) { const b4 = await page.evaluate(() => document.body.innerText); await click(rowStop, "「停用」"); await page.waitForTimeout(3500); stopOk = true; out.actions.push({ act: "停", 新出现文本: await screenMessage(b4) }); }
  else { rec("ACT-停", "找不到该行的停用按钮"); out.actions.push({ act: "停", 结果: "找不到按钮" }); }
  const afterC = await page.evaluate(() => document.body.innerText);
  const rowState = afterC.split("\n").findIndex((l) => l.includes(KEY));
  out.actions.push({ act: "停·行状态", 附近: afterC.split("\n").slice(Math.max(0, rowState - 1), rowState + 6) });
  rec("ACT-停", "行状态", { 附近: afterC.split("\n").slice(Math.max(0, rowState - 1), rowState + 6).join(" / ") });
  await shot(page, "i4-after-stop");

  // ── 动作 D：改
  step("动作【改】：找这条边的编辑入口");
  const editBtn = page.locator(`tr:has-text("${KEY}") button:has-text("改"), tr:has-text("${KEY}") button:has-text("编辑")`).first();
  const editCount = await editBtn.count();
  const rowBtns = await page.evaluate((k) => {
    const tr = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(k));
    return tr ? [...tr.querySelectorAll("button")].map((b) => b.innerText.trim()) : null;
  }, KEY);
  out.actions.push({ act: "改", 该行按钮: rowBtns, 有编辑按钮: editCount > 0 });
  rec("ACT-改", "该行按钮", { rowBtns, 有编辑: editCount > 0 });

  // ── 动作 E：删
  step("动作【删】：点「下线」");
  const delBtn = page.locator(`tr:has-text("${KEY}") button:has-text("下线"), tr:has-text("${KEY}") button:has-text("删除")`).first();
  if (await delBtn.count() > 0) {
    const b4 = await page.evaluate(() => document.body.innerText);
    page.once("dialog", async (d) => { rec("DIALOG", d.message().slice(0, 200)); await d.accept(); });
    await click(delBtn, "「下线」");
    await page.waitForTimeout(4000);
    const afterE = await page.evaluate(() => document.body.innerText);
    out.actions.push({ act: "删", 新出现文本: await screenMessage(b4), 表里还在: afterE.includes(KEY) });
    rec("ACT-删", "结果", { 表里还在: afterE.includes(KEY) });
  } else { rec("ACT-删", "找不到下线按钮"); out.actions.push({ act: "删", 结果: "找不到按钮" }); }
  await shot(page, "i4-after-delete");
  await dump(page, "i4-final");
} catch (e) { rec("FATAL", String(e).slice(0, 800)); }

fs.writeFileSync(path.join(OUT, "item4-relations.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(OUT, "item4-netcalls.json"), JSON.stringify(netCalls, null, 2));
save("item4-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
