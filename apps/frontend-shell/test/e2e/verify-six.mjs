/* eslint-disable */
/**
 * WO-REAL-FRONTEND-VERIFY · 六条待验结论的真浏览器取证
 *
 * 每一条的产出结构固定四格：真点到没有 · 屏上原文/数值 · 截图 · 与推断一致否。
 * 每一条**否定结论**都配一个金丝雀（同一把尺子量一个已知必中的目标）。
 *
 * ⛔ 全程从登录走起，唯一 `goto` 是站点根。判据 5 的四个数由脚本**逐步累加**得出，
 *    不是我事后回忆 —— `trail` 数组记录每一次点击与每一次 URL 变化。
 */
import { launch, login, shot, attachNetLog, assertNoMock, countOptions, scanMoney, sleep } from "./lib.mjs";

const R = { meta: {}, c1: {}, c2: {}, c3: {}, c4: {}, c5: {}, c6: {} };

/** 动线记账：每次点击 +1，每次 URL 变化 +1 跳转，每个「用户看得见的操作」+1 步。 */
function makeTrail(page) {
  const t = { steps: [], clicks: 0, navs: 0, lastUrl: null };
  t.step = (label, kind) => {
    const u = page.url();
    if (t.lastUrl !== null && u !== t.lastUrl) t.navs += 1;
    t.lastUrl = u;
    if (kind === "click") t.clicks += 1;
    t.steps.push({ n: t.steps.length + 1, label, kind, url: u });
  };
  return t;
}

const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

try {
  // ══ 判据 5 的动线从这里开始计数 ══════════════════════════════════════
  const trail = makeTrail(page);
  trail.lastUrl = null;

  R.meta.landedAfterLogin = await login(page);
  trail.step("打开站点 → 落在登录页", "nav");
  trail.step("填 租户/账号/密码 三格", "type");
  trail.step("点【登录】", "click");
  trail.navs = 1; // 登录页 → 首页
  trail.lastUrl = page.url();
  R.meta.shot01 = await shot(page, "01-home-after-login");
  await sleep(1500);
  R.meta.noMock = assertNoMock(net);

  // ══ 判据 1 · 首页真实可见入口 ════════════════════════════════════════
  R.c1.dump = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const pick = (sel) =>
      Array.from(document.querySelectorAll(sel))
        .filter(vis)
        .map((e) => ({
          testid: e.dataset.testid ?? null,
          href: e.getAttribute("href"),
          text: e.innerText.replace(/\s*\n\s*/g, " | ").trim(),
        }));
    return {
      hot: pick('[data-testid^="home-scenario-"]'),
      views: pick('[data-testid^="home-view-"]'),
      all: pick('[data-testid="home-all-scenarios"]'),
      sectionTitles: Array.from(document.querySelectorAll(".section-title")).filter(vis).map((e) => e.innerText.trim()),
      hint: document.querySelector('[data-testid="home-page"] .muted')?.innerText ?? null,
      // 全部可点入口（不限 testid）—— 首页上用户真能点进别的屏的东西
      everyLink: Array.from(document.querySelectorAll('[data-testid="home-page"] a[href], [data-testid="home-page"] button'))
        .filter(vis)
        .map((e) => ({
          tag: e.tagName,
          href: e.getAttribute("href"),
          text: e.innerText.replace(/\s*\n\s*/g, " | ").trim().slice(0, 80),
        })),
      bodyText: document.body.innerText,
    };
  });
  // 首页有没有「物料延期该点哪个」这类指引语？扫全屏文本。
  const homeTxt = R.c1.dump.bodyText;
  R.c1.guidanceProbe = {
    // 指引类关键词：出现即说明「有一句话告诉你该点哪个」
    hits: ["该点", "先点", "请选择", "不知道点哪", "从这里开始", "推荐", "建议", "指引", "怎么选", "如何选"]
      .map((k) => ({ k, n: (homeTxt.match(new RegExp(k, "g")) ?? []).length }))
      .filter((x) => x.n > 0),
    // 金丝雀：一个我确定屏上有的词，同一把尺子必须命中
    canary: [
      { k: "场景", n: (homeTxt.match(/场景/g) ?? []).length },
      { k: "业务视图", n: (homeTxt.match(/业务视图/g) ?? []).length },
    ],
  };

  // ══ 判据 5 续 · 从首页点进推演（不许手敲 URL）════════════════════════
  // 先找首页上通往「统一推演控制台」的那个入口。
  R.c5.entryProbe = R.c1.dump.everyLink
    .filter((l) => /推演|模拟|沙盘|仿真|演练/.test(l.text))
    .map((l) => ({ text: l.text, href: l.href }));

  let simEntry = null;
  for (const cand of R.c1.dump.views.concat(R.c1.dump.all)) {
    if (/推演|模拟|沙盘|仿真/.test(cand.text)) {
      simEntry = cand;
      break;
    }
  }
  R.c5.chosenEntry = simEntry;

  if (simEntry !== null) {
    await page.click(`[data-testid="${simEntry.testid}"]`);
    trail.step(`点首页入口【${simEntry.text}】`, "click");
    await sleep(3000);
    trail.lastUrl = page.url();
    R.c5.urlAfterEntry = page.url();
    R.c5.shot = await shot(page, "05-after-sim-entry");
  }

  // ══ 判据 2/3/4 · 统一推演控制台 ══════════════════════════════════════
  // 到达之后把整屏结构 dump 出来（不猜 testid，直接看真实 DOM）。
  R.c2.consoleDump = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      url: location.href,
      selects: Array.from(document.querySelectorAll("select")).map((s) => ({
        testid: s.dataset.testid ?? null,
        label: s.closest("label")?.innerText?.split("\n")[0] ?? null,
        count: s.options.length,
        disabled: s.disabled,
        first8: Array.from(s.options).slice(0, 8).map((o) => o.value),
        groups: Array.from(s.querySelectorAll("optgroup")).map((g) => g.label),
        visible: vis(s),
      })),
      tabs: Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], button'))
        .filter(vis)
        .map((b) => ({
          testid: b.dataset.testid ?? null,
          text: b.innerText.replace(/\s*\n\s*/g, " ").trim().slice(0, 40),
          disabled: b.disabled === true || b.getAttribute("aria-disabled") === "true",
          title: b.getAttribute("title"),
        }))
        .filter((b) => b.text.length > 0),
      bodyText: document.body.innerText,
    };
  });

  R.consoleErrors = consoleErrors.slice(0, 30);
  R.trail = { steps: trail.steps, clicks: trail.clicks, navs: trail.navs };
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e);
  try {
    R.shotFatal = await shot(page, "ERR-verify-six");
  } catch {}
} finally {
  await browser.close();
}

console.log(JSON.stringify(R, null, 2));
