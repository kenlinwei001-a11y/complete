#!/usr/bin/env node
/** 全流（select 感知版）：真前端 → /v/decision-console → 物料价格变动·电芯壳体 → pctChange=MAG
 *  → 加进去 → 算一下 → dump dc-finance 三行 + 口径 + dc-money。
 *  ── 与旧 FULLFLOW.mjs 的差异（旧版对本题假阴性，两处）──────────────────────
 *   ① 旧版只找 [aria-pressed] 搜索候选与 text 输入 ⇒ LIST 档的 <select> 对它不可见，
 *      误判「没有主体选择器」。本版三分支都走：select / 搜索候选 / 手填。
 *   ② 旧版按 nth 下标点事件 ⇒ 序变即错点。本版用 aria-label 精确点名。
 *  用法: FF_MAG=30 node FLOW-MAT.mjs   （FF_OUT 指定输出 txt）
 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const BASE = process.env.FF_BASE ?? "http://127.0.0.1:5294";
const MAG = process.env.FF_MAG ?? "30";
const LABEL = process.env.FF_LABEL ?? "物料价格变动";
const SUBJ = process.env.FF_SUBJ ?? "obj_material_cell_case"; // 电芯壳体
const OUT = process.env.FF_OUT ?? "/tmp/wt-ab/docs/evidence/FLOW-MAT.txt";
const DU = "demo:admin:admin|planner|catalog_admin";
const L = []; const say = (s = "") => { L.push(s); console.log(s); };
const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, extraHTTPHeaders: { "x-debug-user": DU } });
const p = await ctx.newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.fill("#login-tenant", "demo"); await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click('form button[type="submit"]'); await p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 60000 });
  say("0 登录 OK");
  await p.goto(`${BASE}/v/decision-console`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(3500);
  say(`1 dc 外壳=${await p.locator('[data-testid="decision-console"]').count()} · 金丝雀 dc-go=${await p.locator('[data-testid="dc-go"]').count()}`);

  // ★ 飞行前自检：证「页面跑的模块」里真有本次要验的代码 —— 不带这一条，旧 transform 档
  //    会让「0 处」既读成「代码没上屏」又读成「数据没到」，2026-10-10 已两次踩中（vite 内存缓存）。
  const pre = await p.evaluate(async () => {
    const urls = performance.getEntriesByType("resource").map(e => e.name).filter(n => n.includes("DecisionConsoleView.tsx"));
    const last = urls[urls.length - 1] ?? "/src/views/sim/DecisionConsoleView.tsx";
    const t = await (await fetch(last)).text();
    return { url: last, hasFinance: /dc-finance"/.test(t), hasCanary: t.includes("dc-finance-canary") };
  });
  say(`1b 飞行前自检: 模块=${pre.url.split("/src/")[1] ?? pre.url} hasFinance=${pre.hasFinance} hasCanary=${pre.hasCanary}`);
  if (!pre.hasFinance || pre.hasCanary) { say("1c ⛔ 页面在跑的不是本次要验的代码 ⇒ 本跑判废（先重起 vite 清缓存）"); throw new Error("stale module served"); }

  // ① 精确点名展开
  const target = p.locator(`#z1 button[aria-label="加一件「${LABEL}」"]`);
  if (await target.count() !== 1) throw new Error(`event button ${LABEL} count=${await target.count()}`);
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: 20000 });
  await p.waitForTimeout(2500);
  const form = target.locator("xpath=following-sibling::div[1]");
  say(`2 已展开「${LABEL}」 · tplOpen=${await form.count()}`);

  // ② 主体：三分支都试
  const sel = form.locator("select").first();
  const cand = form.locator("[aria-pressed]");
  const in0 = form.locator("input").first();
  if (await sel.count() > 0) {
    await sel.selectOption(SUBJ);
    say(`3 主体=select 选了 ${SUBJ}（现在值="${await sel.inputValue()}"）`);
  } else if (await cand.count() > 0) {
    await cand.first().click();
    say(`3 主体=点了首个候选`);
  } else if (await in0.count() > 0 && (await in0.getAttribute("type")) === "text") {
    await in0.fill(SUBJ);
    say(`3 主体=手填 ${SUBJ}`);
  } else {
    say(`3 ⚠ 没有找到任何主体控件 ⇒ 停`);
    throw new Error("no subject control");
  }

  // ③ payload number
  const num = form.locator('input[type="number"]').first();
  if (await num.count() === 0) throw new Error("no number payload input");
  await num.fill(MAG);
  say(`4 payload 填 ${MAG}（id=${await num.getAttribute("id")}）`);

  // ④ 加进去
  const addBtn = form.locator("button", { hasText: "加进去" });
  const dis = await addBtn.isDisabled().catch(() => "?");
  say(`5 「加进去」disabled? ${dis}`);
  if (dis !== false) {
    const hint = await form.locator("span").last().textContent().catch(() => "?");
    say(`5b hint="${String(hint ?? "").trim().slice(0, 120)}" ⇒ 停`);
    throw new Error("add disabled");
  }
  await addBtn.click(); await p.waitForTimeout(1200);
  const addedChip = await p.locator('text=已经加了').first().textContent().catch(() => "—");
  say(`6 已加进去 · ${String(addedChip ?? "").replace(/\s+/g, " ").slice(0, 60)}`);

  // ⑤ 算一下 → 等 dc-finance-COST 出现（谓词等待，不一刀切 sleep）
  await p.locator('[data-testid="dc-go"]').click();
  say(`7 已点「算一下」，等 dc-finance-COST…`);
  // 240s：共享机负载下 drill POST 实测到过 157s（4052 日志 responseTime=157343ms，HTTP 200）
  const WAIT_MS = Number(process.env.FF_WAIT ?? 240000);
  let ok = false;
  try { await p.locator('[data-testid="dc-finance-COST"]').first().waitFor({ state: "visible", timeout: WAIT_MS }); ok = true; }
  catch { say(`7b ⚠ ${WAIT_MS / 1000}s 内 dc-finance-COST 未出现`); }
  await p.waitForTimeout(1500);

  // ⑥ dump（稳态：两采样，取第二次；差异则并列）
  const dump = async () => (await p.locator('[data-testid^="dc-finance"]').evaluateAll(es => es.map(e => ({ tid: e.getAttribute("data-testid"), txt: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) }))));
  const d1 = await dump(); await p.waitForTimeout(2000); const d2 = await dump();
  say(`8 dc-finance 命中 ${d2.length} 处（稳态 ${d1.length === d2.length && JSON.stringify(d1) === JSON.stringify(d2) ? "✓ 两采样一致" : "⚠ 两采样不一致，取第二次"}）：`);
  for (const f of d2) say(`   [${f.tid}] ${f.txt}`);
  const money = await p.locator('[data-testid="dc-money"]').textContent().catch(() => "—");
  say(`9 dc-money="${String(money ?? "").replace(/\s+/g, " ").slice(0, 80)}"`);
  // 旁证：推演结果的其他两段（确认结果区整体在，不止财务段）
  const plans = await p.locator('[data-testid="dc-plans"]').textContent().catch(() => null);
  say(`9b dc-plans=${plans === null ? "—（未命中）" : `命中，前 100 字 "${String(plans).replace(/\s+/g, " ").slice(0, 100)}"`}`);
  say(`9c dc-invariant-note=${await p.locator('[data-testid="dc-invariant-note"]').count()} 处`);
  // 出边回执（字符串判定）：修复后应出「这一格的出边（顺着往下推的第一跳）：…」
  const bodyTxt = await p.evaluate(() => document.body.innerText);
  const edge = (bodyTxt.match(/这一格的出边（顺着往下推的第一跳）：[^\n]*/) ?? [])[0]
    ?? (bodyTxt.match(/⚠ 这一格在本租户的关系图上[^\n]*/) ?? [])[0] ?? "—（两形态都没找到）";
  say(`9d 出边回执: ${edge}`);
  say(`10 结论=${ok ? "财务三行已上屏" : "未见 dc-finance-COST"}`);
  await p.screenshot({ path: OUT.replace(/\.txt$/, "-shot.png") });
} catch (e) {
  say("FATAL: " + String(e).slice(0, 300));
} finally {
  fs.writeFileSync(OUT, L.join("\n") + "\n");
  await b.close();
  console.log("WROTE " + OUT);
}
