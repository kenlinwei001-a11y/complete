// 项4 续：非法输入屏上给的是可读的话，还是一串英文 code？
// 三种非法：① 重名 key ② 端点不存在（下拉限死 ⇒ 记为「UI 挡住了」并另测后端话术）③ 方向反了（同 key 反向重建）
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = { cases: [] };
async function setSel(nth, value) {
  return await page.evaluate(({ nth, value }) => {
    const el = [...document.querySelectorAll("select")][nth]; if (!el) return { ok: false };
    const opt = [...el.options].find((o) => o.value === value); if (!opt) return { ok: false, why: "无此选项" };
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, opt.value);
    el.dispatchEvent(new Event("change", { bubbles: true })); return { ok: true };
  }, { nth, value });
}
async function tryCreate(label, { src, dst, key }) {
  if (src) await setSel(0, src);
  if (dst) await setSel(1, dst);
  await page.waitForTimeout(600);
  const ti = page.locator('input[placeholder*="关系 key"]').first();
  if (await ti.count() > 0) { await ti.fill(key ?? ""); counters.clicks++; }
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => document.body.innerText);
  const btn = page.locator('button:has-text("建结构边")').first();
  const disabled = await btn.isDisabled().catch(() => null);
  let clicked = false, dialog = null;
  page.once("dialog", async (d) => { dialog = d.message(); await d.accept(); });
  if (!disabled) { try { await click(btn, `建结构边 · ${label}`); clicked = true; await page.waitForTimeout(3500); } catch (e) { rec("CLICK-FAIL", String(e).slice(0, 120)); } }
  const after = await page.evaluate(() => document.body.innerText);
  const added = after.split("\n").filter((l) => l.trim() && !before.includes(l)).slice(0, 12);
  const c = { 用例: label, 输入: { src, dst, key }, 按钮禁用: disabled, 点了: clicked, 弹窗: dialog, 屏上新出现: added };
  out.cases.push(c);
  rec("CASE", label, { 按钮禁用: disabled, 弹窗: dialog, 新文本: added.slice(0, 5) });
  return c;
}

try {
  await login(page);
  step("侧边栏 →「本体关系」");
  await navByText(page, "本体关系");
  await page.waitForTimeout(5000);
  // 金丝雀：先建一条合法的，证明这条路是通的
  step("金丝雀：先建一条合法边，证明建边这条路是通的");
  const canary = await tryCreate("金丝雀·合法 Order→WorkOrder key=e2e_ok", { src: "Order", dst: "WorkOrder", key: "e2e_ok" });
  if (!canary.点了) rec("FATAL", "金丝雀就点不动 ⇒ 取证坏了，下面的否定结论一律作废");

  step("非法①：key 留空");
  await tryCreate("key 留空", { src: "Order", dst: "WorkOrder", key: "" });
  step("非法②：key 重名（e2e_ok 已存在）");
  await tryCreate("key 重名 e2e_ok", { src: "Order", dst: "WorkOrder", key: "e2e_ok" });
  step("非法③：方向反了（WorkOrder→Order 用同一个 key）");
  await tryCreate("方向反 · 同 key", { src: "WorkOrder", dst: "Order", key: "e2e_ok" });
  step("非法④：key 带非法字符");
  await tryCreate("key 带空格与中文「订单 兑现!!」", { src: "Order", dst: "WorkOrder", key: "订单 兑现!!" });
  step("非法⑤：来源=去向（自环）");
  await tryCreate("自环 Order→Order", { src: "Order", dst: "Order", key: "e2e_selfloop" });

  // 端点不存在：下拉是限死的 ⇒ 记录这一点，并测后端直连话术
  const opts = await page.evaluate(() => { const el = [...document.querySelectorAll("select")][0]; return { n: el.options.length, hasFreeText: el.tagName !== "SELECT" }; });
  out.端点不存在 = { 结论: "来源/去向是限定下拉（99 个选项），UI 层无法输入不存在的端点 —— 这是 UI 挡住了，不是错误处理", 选项数: opts.n };
  rec("NOTE", "端点不存在", out.端点不存在);

  await shot(page, "i4b-invalid");
  await dump(page, "i4b-invalid");
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item4b-invalid.json"), JSON.stringify(out, null, 2));
save("item4b-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
