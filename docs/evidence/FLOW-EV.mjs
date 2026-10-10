#!/usr/bin/env node
/** 通用全流探针：任意事件（按 label 点名）走完 展开 → 选主体(三分支) → 填 number → 加进去
 *  → 算一下 → dump 财务三行/口径/dc-money/dc-plans/出边回执。
 *  主体三分支：① 单级 select ② 两级 select（sel- + sel2-）③ 搜索（填词等 [aria-pressed] 候选）
 *  用法: FF_LABEL='设备故障' FF_PAY=7 FF_OUT=/path.txt node FLOW-EV.mjs
 *  飞行前自检同 FLOW-MAT：页面跑的模块必须 hasFinance 且无 canary，否则判废本跑。 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const BASE = process.env.FF_BASE ?? "http://127.0.0.1:5294";
const LABEL = process.env.FF_LABEL ?? "订单改交期";
const PAY = process.env.FF_PAY ?? "10";
const SEARCH_TEXT = process.env.FF_SEARCH ?? "SO-3391";
const OUT = process.env.FF_OUT ?? "/tmp/wt-ab/docs/evidence/FLOW-EV.txt";
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

  // 飞行前自检（同 FLOW-MAT）：证页面在跑的模块里有 finance 且无 canary
  const pre = await p.evaluate(async () => {
    const urls = performance.getEntriesByType("resource").map(e => e.name).filter(n => n.includes("DecisionConsoleView.tsx"));
    const last = urls[urls.length - 1] ?? "/src/views/sim/DecisionConsoleView.tsx";
    const t = await (await fetch(last)).text();
    return { url: last, hasFinance: /dc-finance"/.test(t), hasCanary: t.includes("dc-finance-canary") };
  });
  say(`1b 飞行前自检: hasFinance=${pre.hasFinance} hasCanary=${pre.hasCanary}`);
  if (!pre.hasFinance || pre.hasCanary) { say("1c ⛔ 页面在跑的不是本次要验的代码 ⇒ 判废（重起 vite 清缓存）"); throw new Error("stale module served"); }

  const target = p.locator(`#z1 button[aria-label="加一件「${LABEL}」"]`);
  if (await target.count() !== 1) throw new Error(`event button ${LABEL} count=${await target.count()}`);
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: 20000 });
  await p.waitForTimeout(2500);
  const form = target.locator("xpath=following-sibling::div[1]");
  say(`2 已展开「${LABEL}」 · tplOpen=${await form.count()}`);

  // ── 主体：三分支 ──────────────────────────────────────────────
  const firstNonEmpty = async (selEl) => {
    const opts = selEl.locator("option"); const n = await opts.count();
    for (let i = 1; i < n; i++) { const v = await opts.nth(i).getAttribute("value"); if (v) return v; }
    return null;
  };
  const sels = form.locator("select");
  if (await sels.count() > 0) {
    const s1 = sels.first();
    const v1 = await firstNonEmpty(s1);
    if (!v1) throw new Error("一级 select 无任何非空 option");
    await s1.selectOption(v1);
    say(`3a (select分支) 一级选了 value=${v1}`);
    // 两级探测：sel2- 出现（最多等 12s）
    const s2 = form.locator('select[id^="sel2-"]');
    let two = false;
    try { await s2.first().waitFor({ state: "attached", timeout: 12000 }); two = true; } catch { two = false; }
    if (two) {
      const c2 = s2.first();
      for (let i = 0; i < 15; i++) { if (await c2.locator("option").count() > 1) break; await p.waitForTimeout(1000); }
      const c2n = await c2.locator("option").count();
      const hintBefore = ((await form.locator("span").allTextContents()).filter(x => x.includes("还需") || x.includes("不够")).join(" | ")).trim() || "—（未出现缺二级提示）";
      say(`3b (两级) 缺二级时 hint="${hintBefore}" · child option 数=${c2n - 1}`);
      const v2 = await firstNonEmpty(c2);
      if (!v2) throw new Error("二级 select 无非空 option");
      await c2.selectOption(v2);
      say(`3c 二级选了 value=${v2}`);
    }
  } else if (await form.locator('input[id^="q-"]').count() > 0 || await form.locator('input:not([type])').count() > 0) {
    // ⚠ 搜索框是 <input>（**无 type 属性**）—— `input[type="text"]` 匹配不到它，
    //    只匹配到 payload 里带 type="text" 的可选框（新交期），曾把词填错框（2026-10-10 实咬）。
    const q = (await form.locator('input[id^="q-"]').count()) ? form.locator('input[id^="q-"]').first() : form.locator('input:not([type])').first();
    const qid = await q.getAttribute("id").catch(() => "?");
    await q.fill(SEARCH_TEXT); await p.waitForTimeout(1500);
    const qval = await q.inputValue().catch(() => "?");
    say(`3 (搜索分支) 填了 id=${qid} 现值="${qval}"（自证填对框）`);
    let cn = 0;
    for (let i = 0; i < 20; i++) { cn = await form.locator("[aria-pressed]").count(); if (cn > 0) break; await p.waitForTimeout(1000); }
    say(`3c 等候选 ≤20s ⇒ 候选=${cn}`);
    if (cn > 0) {
      const c1 = form.locator("[aria-pressed]").first();
      say(`3d 点了候选「${((await c1.textContent()) || "").trim().slice(0, 44)}」`);
      await c1.click();
    } else {
      say(`3e ⚠ 零候选（若本是手填兜底路，所填值即主体；否则判废）`);
    }
  } else { say("3 ⚠ 无任何主体控件 ⇒ 停"); throw new Error("no subject control"); }

  // ── payload：所有 number 输入填 PAY ────────────────────────────
  const nums = form.locator('input[type="number"]');
  const nn = await nums.count();
  if (nn === 0) throw new Error("无 number payload");
  for (let i = 0; i < nn; i++) await nums.nth(i).fill(PAY);
  say(`4 payload: number 输入数=${nn}，全填 ${PAY}`);

  // ── 加进去 ──────────────────────────────────────────────────
  const addBtn = form.locator("button", { hasText: "加进去" });
  const dis = await addBtn.isDisabled().catch(() => "?");
  say(`5 「加进去」disabled? ${dis}`);
  if (dis !== false) {
    const hint = ((await form.locator("span").allTextContents()).filter(x => x.includes("填齐") || x.includes("还需") || x.includes("请选择")).join(" | ")).trim();
    say(`5b hint="${hint.slice(0, 160)}" ⇒ 停`);
    throw new Error("add disabled");
  }
  await addBtn.click(); await p.waitForTimeout(1200);
  const chip = await p.locator(`text=已经加了`).first().textContent().catch(() => "—");
  say(`6 已加进去 · ${String(chip ?? "").replace(/\s+/g, " ").slice(0, 70)}`);

  // ── 算一下 → 谓词等待 dc-finance 容器 ────────────────────────
  await p.locator('[data-testid="dc-go"]').click();
  const WAIT_MS = Number(process.env.FF_WAIT ?? 240000);
  say(`7 已点「算一下」，等 dc-finance（≤${WAIT_MS / 1000}s）…`);
  let ok = false;
  try { await p.locator('[data-testid="dc-finance"]').first().waitFor({ state: "visible", timeout: WAIT_MS }); ok = true; }
  catch { say(`7b ⚠ ${WAIT_MS / 1000}s 内 dc-finance 未出现`); }
  await p.waitForTimeout(1500);

  const dump = async () => (await p.locator('[data-testid^="dc-finance"]').evaluateAll(es => es.map(e => ({ tid: e.getAttribute("data-testid"), txt: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220) }))));
  const d1 = await dump(); await p.waitForTimeout(2000); const d2 = await dump();
  say(`8 dc-finance 命中 ${d2.length} 处（稳态 ${JSON.stringify(d1) === JSON.stringify(d2) ? "✓" : "⚠ 不一致，取第二次"}）：`);
  for (const f of d2) say(`   [${f.tid}] ${f.txt}`);
  const money = await p.locator('[data-testid="dc-money"]').textContent().catch(() => "—");
  say(`9 dc-money="${String(money ?? "").replace(/\s+/g, " ").slice(0, 60)}"`);
  say(`9b dc-plans 命中=${await p.locator('[data-testid="dc-plans"]').count()} · dc-invariant-note=${await p.locator('[data-testid="dc-invariant-note"]').count()}`);
  const bodyTxt = await p.evaluate(() => document.body.innerText);
  const edge = (bodyTxt.match(/这一格的出边（顺着往下推的第一跳）：[^\n]*/) ?? [])[0]
    ?? (bodyTxt.match(/⚠ 这一格在本租户的关系图上[^\n]*/) ?? [])[0] ?? "—（两形态都没找到）";
  say(`9d 出边回执: ${edge}`);
  say(`10 结论=${ok ? "财务段已上屏" : "未见 dc-finance"}`);
  await p.screenshot({ path: OUT.replace(/\.txt$/, "-shot.png") });
} catch (e) {
  say("FATAL: " + String(e).slice(0, 300));
} finally {
  fs.writeFileSync(OUT, L.join("\n") + "\n");
  await b.close();
  console.log("WROTE " + OUT);
}
