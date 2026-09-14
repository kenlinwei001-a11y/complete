// 项7 主试：隔离区丢弃 —— ① 理由留空能不能提交 ② 填了之后理由回读得到吗
import fs from "node:fs";
import path from "node:path";
import { boot, login, navByText, dump, shot, save, rec, step, click, counters, netPorts, netCalls, OUT } from "./lib.mjs";

const { browser, page } = await boot();
const out = {};
const REASON = "E2E 验收：源系统主键重复，已在上游修正，本行作废";
try {
  await login(page);
  step("侧边栏 →「隔离区」");
  await navByText(page, "隔离区");
  await page.waitForTimeout(4500);
  const t0 = await dump(page, "i7d-01-pending");
  await shot(page, "i7d-01-pending");
  // 金丝雀：确认屏上真的看得到那 4 行
  // ⚠ 金丝雀订正：屏上把 DUP_KEY/SCHEMA_MISMATCH 译成了「主键重复」「结构不符」，
  // 用原始枚举名去匹配会得到 0 条并误报「界面没有」——上一版就是这么坏的。
  const rows = await page.evaluate(() => [...document.querySelectorAll("table tr")].map((r) => r.innerText.replace(/\s+/g, " ").trim()).filter((x) => /主键重复|结构不符|e2e_probe/.test(x)));
  rec("CANARY", `屏上隔离行 ${rows.length} 条（后端 4 条）`, { rows: rows.slice(0, 4) });
  if (rows.length === 0) { rec("FATAL", "屏上看不到隔离行 ⇒ 取证坏了"); throw new Error("canary"); }
  out.rowsOnScreen = rows;

  step("点第一行的「丢弃」，看是否弹出必填理由");
  // ⚠ 选择器订正：`has-text("丢弃")` 会先命中页签「已丢弃」（在 DOM 里更靠前），
  // 上一版就是这么点错的 —— 用行内 testid 精确定位。
  const d = page.locator('[data-testid^="q-discard-"]').first();
  const dn = await d.count();
  rec("PROBE", `行内丢弃按钮 ${dn} 个`);
  await click(d, "行内「丢弃」");
  await page.waitForTimeout(1800);
  await shot(page, "i7d-02-discard-form");
  const formTxt = await page.evaluate(() => document.body.innerText);
  const hasReason = /丢弃理由/.test(formTxt);
  const confirm = page.locator('button:has-text("确认丢弃")').first();
  const blankDisabled = await confirm.isDisabled().catch(() => null);
  out.blank = { 出现理由框: hasReason, 理由空时确认按钮禁用: blankDisabled };
  rec("P7-BLANK", "理由留空", out.blank);

  step("理由留空时强行点「确认丢弃」，看请求发不发得出去");
  const netBefore = netCalls.length;
  try { await confirm.click({ timeout: 4000, force: true }); counters.clicks++; } catch (e) { rec("CLICK", "点不动（按钮置灰）"); }
  await page.waitForTimeout(2500);
  const fired = netCalls.slice(netBefore).filter((c) => /quarantine\/discard/.test(c.path));
  out.blank.空理由发出的请求 = fired;
  rec("P7-BLANK", "空理由请求", { 发出条数: fired.length, 明细: fired });

  step("填入理由，再点「确认丢弃」");
  const ta = page.locator('textarea, input[aria-label*="理由"]').first();
  if (await ta.count() > 0) { await ta.fill(REASON); counters.clicks++; rec("FILL", "理由已填"); }
  await page.waitForTimeout(1000);
  const nb2 = netCalls.length;
  const confirm2 = page.locator('button:has-text("确认丢弃")').first();
  const dis2 = await confirm2.isDisabled().catch(() => null);
  rec("P7", "填了理由后确认按钮 disabled?", { dis2 });
  if (!dis2) { await click(confirm2, "「确认丢弃」"); await page.waitForTimeout(4500); }
  const fired2 = netCalls.slice(nb2).filter((c) => /quarantine\/discard/.test(c.path));
  out.filled = { 请求: fired2, 按钮禁用: dis2 };
  rec("P7-FILLED", "带理由请求", { 明细: fired2 });
  await shot(page, "i7d-03-after-discard");
  const afterTxt = await page.evaluate(() => document.body.innerText);
  out.filled.toast = afterTxt.split("\n").filter((l) => /已丢弃|失败|错误/.test(l)).slice(0, 5);

  step("切到「已丢弃」页签，看理由能不能回读");
  const tab = page.locator('button:has-text("已丢弃")').first();
  await click(tab, "页签「已丢弃」");
  await page.waitForTimeout(3500);
  const t2 = await dump(page, "i7d-04-discarded");
  await shot(page, "i7d-04-discarded");
  out.readback = {
    屏上找得到理由原文: t2.includes(REASON),
    "含 discarded 标记": /discarded:/.test(t2),
    相关行: t2.split("\n").filter((l) => /discarded|E2E 验收/.test(l)).slice(0, 4),
  };
  rec("P7-READBACK", "回读", out.readback);
} catch (e) { rec("FATAL", String(e).slice(0, 700)); }
fs.writeFileSync(path.join(OUT, "item7-discard.json"), JSON.stringify(out, null, 2));
save("item7-discard-log.json");
console.log("COUNTERS", JSON.stringify(counters), "PORTS", JSON.stringify(Object.fromEntries(netPorts)));
await browser.close();
