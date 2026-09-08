/* eslint-disable */
/**
 * WO-HOME-ENTRY-FLOW · 补一个**真的会动**的数：首屏可见性与滚动距离。
 *
 * ══ 为什么要补这个数（诚实记账，别让读的人以为我在凑数）════════════════════════════
 *
 * 工单的对照实验 ① 要「修前修后两个**总点击数**」。我照做了，两个数是 **2 和 2**——
 * **一样**。原因不是本单没起作用，是那把尺子量不到本单改的东西：
 * 侧栏在 1680×1050 下**本来就常驻可见**，所以「走到统一推演控制台」修前修后都是
 * 「点一次登录 + 点一次入口」= 2 次点击。
 *
 * **形态（照铁律 0.6 句式，这次是我自己差点犯）**：
 *   「我用『总点击数没变』当作『本单没起作用』的证据，而前者并不度量后者。」
 *   反过来同样不许：也不能拿『我加了卡片』当作『用户找得到了』的证据。
 *
 * ⇒ 需要一把**真的对准这个病**的尺子。本单治的病是「用户在首页**扫不到**它，
 *   得把视线切到另一栏」，那就量：**它在不在首页、在第几个、要不要滚屏**。
 *
 * ══ 为什么单开一个文件，不改 `measure-entry-flow.mjs` ══════════════════════════════
 *
 * 那个文件头注自己写着「一个字都不许因为『改完了』而改 —— 改了就得两边重跑」。
 * 修前那次取证已经跑完（`before-output.json`），改它就等于让修前修后**用了两把尺子**，
 * 那正是它要防的事。故新数落在新文件里，修前的值由 `before-output.json` 已有字段给：
 *   `g1.foundOnHome: false` + `missingFromHome: ["统一推演控制台","推演沙盘","事件影响与对策"]`
 *   ⇒ 修前「首页第几个 / 要滚多远」这两个问题**没有值**，因为那张卡根本不存在。
 *   报告里就照这么写，不许把「不存在」粉饰成一个好看的数。
 *
 * ⚠ 金丝雀：同一把尺子必须量得到「经营驾驶舱」（首页确定有的那个）。
 *   它若也报 present:false ⇒ 结论是「量法坏了」，不许报「首页没有统一推演控制台」。
 */
import { launch, login, shot, sleep, attachNetLog, assertNoMock } from "./lib.mjs";

const R = { at: new Date().toISOString(), note: "修前无对应值：那三张卡在首页不存在（见 before-output.json 的 foundOnHome:false）" };

const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

/** 一个首页入口在首屏里的位置。`present:false` 时其余字段一律 null —— 不许拿 0 冒充。 */
const PROBE = (keys) => {
  const all = Array.from(document.querySelectorAll('[data-testid^="home-view-"]'));
  const vh = window.innerHeight;
  return keys.map((k) => {
    const el = document.querySelector(`[data-testid="home-view-${k}"]`);
    if (el === null) {
      return { key: k, present: false, orderOnHome: null, topPx: null, inFirstScreen: null, scrollNeededPx: null, text: null };
    }
    const r = el.getBoundingClientRect();
    const absTop = r.top + window.scrollY;
    return {
      key: k,
      present: true,
      // 首页 home-view-* 里排第几（1 起）——「排在 33 项之后」和「排在最前」是两种体验
      orderOnHome: all.indexOf(el) + 1,
      totalHomeViews: all.length,
      topPx: Math.round(absTop),
      // 首屏 = 不滚动就看得见（元素顶边落在视口高度内）
      inFirstScreen: absTop < vh,
      scrollNeededPx: absTop < vh ? 0 : Math.round(absTop - vh + r.height),
      text: el.innerText.trim(),
    };
  });
};

try {
  R.landed = await login(page);
  await sleep(1800);
  R.noMock = assertNoMock(net);
  R.viewportH = await page.evaluate(() => window.innerHeight);

  // 靶子 + 金丝雀用**同一次调用、同一把尺子**（不许各抄一份，否则金丝雀是装饰品）
  R.probes = await page.evaluate(PROBE, ["sim-unified", "sim-sandbox", "decision-console", "dash"]);
  R.canary = R.probes.find((p) => p.key === "dash");
  R.verdict = !R.canary?.present
    ? "量法坏了：金丝雀『经营驾驶舱』(dash) 都没量到，本次全部结论作废"
    : "量法可信（金丝雀命中），下面的数可用";

  // 遇事指引区也量一下：它要是被推到第三屏，等于没做
  R.guidance = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="home-event-guidance"]');
    if (el === null) return { present: false };
    const r = el.getBoundingClientRect();
    const absTop = r.top + window.scrollY;
    return { present: true, topPx: Math.round(absTop), inFirstScreen: absTop < window.innerHeight, chips: el.querySelectorAll("button").length };
  });

  R.shot = await shot(page, "F-firstscreen-home");
  R.consoleErrors = consoleErrors.slice(0, 6);
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 900);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
