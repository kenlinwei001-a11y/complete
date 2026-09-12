/* eslint-disable */
/**
 * 侦察跑：真登录 → 落首页 → 把首页**真实可见**的入口全量 dump 出来。
 *
 * 为什么先侦察再断言：判据 1 要数的是「首页真实可见入口数」，**不是路由表里的数**。
 * 这两个数在本仓大概率不同（路由表 60+ 条，首页只渲染 workspace.navigation 下发的那批）。
 * 先把真实那批打出来，再谈「12 个推演类入口」这个推断对不对。
 */
import { launch, login, shot, attachNetLog, assertNoMock } from "./lib.mjs";

const out = {};

const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

try {
  const landed = await login(page);
  out.landedAfterLogin = landed;
  out.shotLogin = await shot(page, "01-home-after-login");

  // 判据：这一屏真打了后端（禁 mock 的实证，不是「我没设那个变量」）
  await page.waitForTimeout(1500);
  out.noMock = assertNoMock(net);

  // ── 首页真实可见入口全量 dump ─────────────────────────────────────────
  out.home = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const hot = Array.from(document.querySelectorAll('[data-testid^="home-scenario-"]'))
      .filter(vis)
      .map((e) => ({ testid: e.dataset.testid, text: e.innerText.replace(/\n+/g, " | ") }));
    const views = Array.from(document.querySelectorAll('[data-testid^="home-view-"]'))
      .filter(vis)
      .map((e) => ({ testid: e.dataset.testid, href: e.getAttribute("href"), text: e.innerText.trim() }));
    const allScenarios = Array.from(document.querySelectorAll('[data-testid="home-all-scenarios"]'))
      .filter(vis)
      .map((e) => ({ testid: "home-all-scenarios", href: e.getAttribute("href"), text: e.innerText.trim() }));
    return {
      hint: document.querySelector('[data-testid="home-page"] .muted')?.innerText ?? null,
      sectionTitles: Array.from(document.querySelectorAll(".section-title")).filter(vis).map((e) => e.innerText.trim()),
      hot,
      views,
      allScenarios,
      bodyText: document.body.innerText,
    };
  });

  // ── 左侧/顶部导航（首页之外的入口来源）─────────────────────────────
  out.nav = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(document.querySelectorAll("nav a, aside a, header a"))
      .filter(vis)
      .map((a) => ({ href: a.getAttribute("href"), text: a.innerText.trim() }));
  });

  // ── workspace 回包原文（导航的真相源）──────────────────────────────
  const ws = net.find((e) => /\/a\/v1\/me\/workspace/.test(e.url));
  out.workspaceRaw = ws?.body ? ws.body.slice(0, 20000) : null;

  out.consoleErrors = consoleErrors.slice(0, 20);
} catch (e) {
  out.FATAL = String(e && e.stack ? e.stack : e);
  try {
    out.shotFatal = await shot(page, "ERR-recon");
  } catch {}
} finally {
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
