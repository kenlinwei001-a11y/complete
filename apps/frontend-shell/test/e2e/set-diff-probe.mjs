/* eslint-disable */
/**
 * WO-HOME-ENTRY-FLOW · **反向差集**：首页有、侧栏没有的是哪些？
 *
 * 本单修的是「侧栏有、首页没有」（三个 `kind:"route"` 项）。修完之后我在截图上看见了
 * **反方向**的一批：首页列着 `推演指控台 / 传导识别 / 损失归因 / 方案寻优`，
 * 而侧栏「推演」组里**一个都没有** —— 因为 `UnifiedNav` 对 `kind:"view"` 项还跑了一层
 * `consolidatedWhen` 收编过滤（ShellLayout 的 `conditionalConsolidation`），
 * 而 `HomePage` 只做了 `n.group !== "admin"`，那层过滤一次都没跑。
 *
 * ⚠ 这条**本单不修**：修法是从首页拿掉条目，而工单判据③ 写死「首页原有 33 项一项都不许丢」。
 *   故只取证、只写进建议段。**取证不是修，别把这两件事混起来。**
 *
 * ⚠ 金丝雀：两个集合都必须非空，且 `dash`（经营驾驶舱）必须**两边都在**。
 *   它若只在一边 ⇒ 报「量法坏了」，不许报「两边对不上」。
 */
import { launch, login, sleep } from "./lib.mjs";

const R = { at: new Date().toISOString() };
const { browser, page } = await launch();

try {
  R.landed = await login(page);
  await sleep(1800);

  R.sets = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const homeKeys = Array.from(document.querySelectorAll('[data-testid^="home-view-"]'))
      .filter(vis)
      .map((e) => e.dataset.testid.replace(/^home-view-/, ""));
    // 侧栏：取 /v/<key> 形态的链接（route 与 view 两种 kind 渲染出来都是这个形态）
    const navKeys = Array.from(document.querySelectorAll("nav a, aside a"))
      .filter(vis)
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.startsWith("/v/"))
      .map((h) => h.slice(3));
    const uniq = (a) => [...new Set(a)];
    const H = uniq(homeKeys);
    const N = uniq(navKeys);
    return {
      homeN: H.length,
      navN: N.length,
      // 侧栏是否有滚动条（若有，说明「可见项数」这把尺子要小心：本 probe 不靠可见性，靠 DOM）
      navScrollable: (() => {
        const el = document.querySelector("nav") ?? document.querySelector("aside");
        return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight, scrolls: el.scrollHeight > el.clientHeight + 2 } : null;
      })(),
      onlyOnHome: H.filter((k) => !N.includes(k)),
      onlyInNav: N.filter((k) => !H.includes(k)),
      // 金丝雀：确定两边都该有的那个
      canaryBothSides: H.includes("dash") && N.includes("dash"),
    };
  });

  R.verdict = !R.sets.canaryBothSides
    ? "量法坏了：金丝雀 dash 没有同时出现在两侧，本次差集作废"
    : `量法可信。首页独有 ${R.sets.onlyOnHome.length} 项，侧栏独有 ${R.sets.onlyInNav.length} 项`;
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 900);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
