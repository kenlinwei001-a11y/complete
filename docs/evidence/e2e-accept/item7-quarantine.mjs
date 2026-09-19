// 项7：隔离区丢弃全流程（从登录走起）
// 隔离行的唯一来源 = 本体建模 materialize 时的坏行（主键缺失 / 主键重复 / 校验违规）
// ⇒ 先经「连接器与上传」造一份带坏行的数据集，再「本体建模」落库，最后到「隔离区」走丢弃。
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, netCalls, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = { path: [] };
try {
  await login(page);

  step("侧边栏 →「连接器与上传」（隔离行的上游）");
  await navByText(page, "连接器与上传");
  await page.waitForTimeout(4500);
  const t = await dump(page, "i7-connections");
  await shot(page, "i7-connections");
  const fileInputs = await page.locator('input[type=file]').count();
  const btns = await page.evaluate(() => [...new Set([...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()))].filter((x) => x && x.length < 24));
  out.path.push({ 页面: "连接器与上传", 文件上传框: fileInputs, 按钮: btns.slice(-18) });
  rec("P7", "连接器与上传", { 文件上传框: fileInputs, 按钮: btns.slice(-18).join(",") });

  step("侧边栏 →「本体建模」（materialize 才会产生隔离行）");
  await navByText(page, "本体建模");
  await page.waitForTimeout(5000);
  const m = await dump(page, "i7-modeling");
  await shot(page, "i7-modeling");
  const mbtns = await page.evaluate(() => [...new Set([...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()))].filter((x) => x && x.length < 24));
  out.path.push({ 页面: "本体建模", 按钮: mbtns.slice(-20), 有落库: mbtns.some((b) => /落库|物化|materialize|生成对象/.test(b)), 有数据集: /数据集|dataset/.test(m) });
  rec("P7", "本体建模", { 按钮: mbtns.slice(-20).join(","), 有落库: mbtns.some((b) => /落库|物化|生成对象/.test(b)) });

  step("侧边栏 →「隔离区」看现状与三个页签");
  await navByText(page, "隔离区");
  await page.waitForTimeout(4000);
  const q = await dump(page, "i7-quarantine-2");
  await shot(page, "i7-quarantine-2");
  const qbtns = await page.evaluate(() => [...new Set([...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()))].filter((x) => x && x.length < 24));
  // 三个页签各点一次
  for (const tab of ["待处理", "已重入", "已丢弃"]) {
    const l = page.locator(`button:has-text("${tab}")`).first();
    if (await l.count() > 0) { await click(l, `页签「${tab}」`); await page.waitForTimeout(2500); }
    const tt = await page.evaluate(() => document.body.innerText);
    const body = tt.slice(tt.indexOf("已丢弃") + 3).trim().slice(0, 300);
    rec("P7-TAB", tab, { 正文: body.replace(/\n/g, " | ").slice(0, 200) });
    out.path.push({ 页签: tab, 正文: body.slice(0, 300) });
  }
  out.quarantineButtons = qbtns;
  // 有没有「丢弃」按钮 / 理由输入框
  const discardBtn = await page.locator('button:has-text("丢弃")').count();
  const reasonInput = await page.locator('input[placeholder*="理由"], textarea[placeholder*="理由"], input[placeholder*="原因"], textarea').count();
  out.discardUi = { 丢弃按钮数: discardBtn, 理由框数: reasonInput, 全部按钮: qbtns };
  rec("P7", "丢弃 UI", out.discardUi);
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item7-quarantine.json"), JSON.stringify(out, null, 2));
save("item7-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
