/* eslint-disable */
/**
 * WO-GAP-NORMALIZE · 真浏览器取证（⛔ 禁 VITE_MOCK · ⛔ 不许手敲 URL · 必须从登录走起）
 *
 * 两条必答判据（仓主 2026-09-07 追加）：
 *  ① 经营驾驶舱 → 根因下钻，**屏上默认根因显示的是哪一条**（修前 / 修后各一句屏上原文 + 截图）。
 *  ② 指标条上「口径 · …」那一行**到底渲不渲染**（修前实测 op 6 条 / 带 basis 0 条，
 *     而 caption 承诺「点开每条看『口径』一行」）。
 *
 * ⚠ 金丝雀：报「屏上没有口径行」之前，先证明**这个量法找得到它本来该找到的东西**——
 *   同一次运行里必须数出指标条的行数 > 0。行数都是 0 ⇒ 报「量法坏了」，不许报「屏上没有」。
 *
 * 用法：TAG=before|after node apps/frontend-shell/test/e2e/gap-normalize.mjs
 */
import { launch, login, shot, attachNetLog, assertNoMock, visibleText, sleep } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const TAG = process.env.TAG ?? "after";

const out = { tag: TAG, at: new Date().toISOString(), steps: [] };
const say = (k, v) => { out[k] = v; console.log(`[${TAG}] ${k} =`, typeof v === "string" ? v : JSON.stringify(v)); };

const { browser, page, consoleErrors } = await launch();
const netLog = attachNetLog(page);

try {
  // ── 步骤 1：从登录走起（唯一允许的 goto 是站点根）──────────────────────────
  const landed = await login(page, { user: "admin" });
  out.steps.push(`登录后落在 ${landed}`);
  say("loginLandedAt", landed);
  await sleep(1500);
  say("noMock", assertNoMock(netLog));

  // ── 步骤 2：靠点导航进「经营驾驶舱」（不手敲 URL）───────────────────────────
  const navNames = await page.$$eval("a, button", (els) =>
    els.map((e) => (e.textContent ?? "").trim()).filter((t) => t && t.length < 24),
  );
  out.navSample = navNames.slice(0, 40);
  const link = await page.$('a:has-text("驾驶舱"), a:has-text("决策")');
  let clicked = null;
  for (const cand of ["经营驾驶舱", "驾驶舱", "决策驾驶舱", "总览", "首页"]) {
    const el = await page.$(`a:text-is("${cand}"), button:text-is("${cand}")`);
    if (el) { await el.click(); clicked = cand; break; }
  }
  if (!clicked) {
    // 退而求其次：找第一个 href 含 /v/dash 的链接并点它（仍是点，不是敲）
    const dash = await page.$('a[href*="/v/dash"]');
    if (dash) { await dash.click(); clicked = "(href*=/v/dash 的导航项)"; }
  }
  out.steps.push(`点了导航项「${clicked}」`);
  say("navClicked", clicked);
  await page.waitForSelector('[data-testid="dashboard-grid"]', { timeout: 30000 });
  await sleep(3500);
  say("dashUrl", page.url());
  await shot(page, `gapnorm-${TAG}-01-dashboard.png`);

  // ── 判据②：指标条行数 + 「口径 · 」行数（金丝雀 = 行数须 > 0）───────────────
  const stripRows = await page.$$eval('[data-testid="metric-strip"] button[data-testid^="metric-"]', (els) =>
    els.map((e) => ({
      testid: e.getAttribute("data-testid"),
      text: (e.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      hasBasis: !!e.querySelector('[data-testid^="metric-basis-"]'),
      basisText: (e.querySelector('[data-testid^="metric-basis-"]')?.textContent ?? "").trim().slice(0, 120),
    })),
  );
  say("stripRowCount", stripRows.length);
  say("stripRowsWithBasis", stripRows.filter((r) => r.hasBasis).length);
  out.stripRows = stripRows;
  console.log(`[${TAG}] --- 指标条逐行 ---`);
  for (const r of stripRows) console.log(`   ${r.testid.padEnd(26)} basis=${r.hasBasis ? "有" : "无"} | ${r.text}`);
  // 金丝雀：量法自证
  if (stripRows.length === 0) {
    say("CANARY", "量法坏了：指标条一行都没数到（不是「屏上没有口径」，是选择器/时序不对）");
  } else {
    say("CANARY", `量法有效：指标条数到 ${stripRows.length} 行（金丝雀命中）`);
  }
  const capEl = await page.$('[data-testid="widget-caption-metric-strip"]');
  say("stripCaption", capEl ? (await capEl.textContent()).trim() : "(无 caption)");

  // ── 判据①：根因下钻面板的**默认**根因（不点任何指标行）─────────────────────
  const rcEl = await page.$('[data-testid="widget-rootcause"]');
  const rcText = rcEl ? (await rcEl.innerText()).replace(/\s+/g, " ").trim() : "(根因下钻 widget 不在这一屏)";
  say("rootcauseWidgetText", rcText.slice(0, 400));
  const cockpit = await page.$('[data-testid="cockpit-rootcause"]');
  say("rootcauseDataMetric", cockpit ? await cockpit.getAttribute("data-metric") : "(无 cockpit-rootcause 节点)");
  await shot(page, `gapnorm-${TAG}-02-rootcause.png`);

  /**
   * ── 判据① 的真正落点：**产能推演**（route `risk`）──────────────────────────
   * 全前端只有 `RiskBoardView` 这一处调 `gap_attribution` 时**不传 metricKey**
   * （另两处都显式传），所以「缺省根指标是谁」这件事，用户唯一看得见它的地方就是这一屏。
   * 驾驶舱右侧那块未选中态走的是 `plan_rootcause`，不是本单改的那条路 —— 不能拿它当判据。
   */
  let riskClicked = null;
  for (const cand of ["产能推演", "风险板", "风险看板"]) {
    const el = await page.$(`a:text-is("${cand}"), button:text-is("${cand}")`);
    if (el) { await el.click(); riskClicked = cand; break; }
  }
  if (riskClicked) {
    await sleep(6000);
    say("riskBoardClicked", riskClicked);
    say("riskUrl", page.url());
    // 根因树挂在**展开某张基地卡**之后的详情里（不是常驻）—— 必须真点开一张卡。
    const cards = await page.$$eval('[data-testid^="risk-card-"]', (els) => els.map((e) => e.getAttribute("data-testid")));
    say("riskCards", cards);
    if (cards.length > 0) {
      await page.click(`[data-testid="${cards[0]}"]`);
      say("riskCardOpened", cards[0]);
      await sleep(7000);
      await shot(page, `gapnorm-${TAG}-04-riskcard-open.png`);
    }
    const dagCount = await page.$$eval('[data-testid="provenance-dag"]', (e) => e.length);
    say("riskBoardDagCount", dagCount);
    // 根因面板整块的**屏上原文**（有树 / 诚实灰 两态都要能引用出来）
    const rcPanel = await page.$('[data-testid^="rootcause-panel-"]');
    say("riskRootCausePanelText",
      rcPanel ? (await rcPanel.innerText()).replace(/\s+/g, " ").trim().slice(0, 520) : "(根因面板节点不在这一屏)");
    // 元素级截图：整页图太长，判据①要看的就是这一块，单独出一张便于并排对照。
    if (rcPanel) {
      await rcPanel.scrollIntoViewIfNeeded();
      await sleep(800);
      await rcPanel.screenshot({ path: `apps/frontend-shell/test/e2e/shots/gapnorm-${TAG}-05-rootcause-panel.png` });
      say("rootcausePanelShot", `gapnorm-${TAG}-05-rootcause-panel.png`);
    }
    // 缺省根指标在屏上的原文：根因树的 KPI 根节点（`dag-node-kpi:<key>`）
    const kpiRoots = await page.$$eval('[data-testid^="dag-node-kpi:"]', (els) =>
      els.map((e) => ({ testid: e.getAttribute("data-testid"), text: (e.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 120) })),
    );
    say("riskKpiRootNodes", kpiRoots);
    const body = await visibleText(page);
    const greyHits = body.match(/该基地不在结构归因[^\n]{0,60}|暂无根因[^\n]{0,40}|缺口[^\n]{0,30}/g) ?? [];
    say("riskBoardTextHits", greyHits.slice(0, 8));
    await shot(page, `gapnorm-${TAG}-03-riskboard.png`);
    // 金丝雀：这一屏上必须至少有一棵 DAG 或一句明确的诚实灰说明；两者都没有 ⇒ 量法/时序坏了
    say("riskCanary", dagCount > 0 ? `量法有效：数到 ${dagCount} 棵根因树` : "屏上零棵根因树（需人工判定是诚实灰还是量法坏）");
  } else {
    say("riskBoardClicked", "(导航里没找到产能推演入口)");
  }

  say("consoleErrors", consoleErrors.slice(0, 8));
} catch (e) {
  out.fatal = String(e && e.stack ? e.stack : e);
  console.error(`[${TAG}] FATAL`, out.fatal);
} finally {
  writeFileSync(`apps/frontend-shell/test/e2e/gapnorm-${TAG}.json`, JSON.stringify(out, null, 2));
  await browser.close();
}
