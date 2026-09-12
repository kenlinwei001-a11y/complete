/**
 * `scripts/lib/layout-probe.mjs` · **版面量测 harness（真浏览器渲染 + 五项几何量测）**
 *
 * ══ 为什么要有这个文件 ═══════════════════════════════════════════════════════════
 * 本仓 62 道门**全部在守「信息诚实」**（数从哪来 · 有没有假绿 · 承诺有没有撑），
 * **一道都不守「版面」**。于是「字太小 / 一屏塞 35 行 / 控件不对齐 / 视口利用率低」
 * 这些**用户第一眼就看见的问题**，在机器眼里完全不存在 —— 没有任何信号会红。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『62 道门全绿』当作『这一屏能看』的证据，而前者并不度量后者。」**
 *
 * `docs/PRD-harness-ux-adoption.md` §4.2.1 的 B-1 / B-4 两条账挂着的
 * 「差一个能渲染真页面的 harness」，指的就是这个文件。
 *
 * ⚠ **诚实订正（本单实测，不许再照旧文写）**：仓里**不是零 harness**。
 *   `scripts/ui-smoke-*.mjs` 共 12 个脚本早就用 playwright 渲染真页面。
 *   真实缺口是**两条**，不是「没有」：
 *   ① 它们**一律 `exit 0` SKIP**（`ui-smoke-sandbox.mjs:38`「无 chromium/playwright-core → SKIP(exit 0)」）
 *      —— 渲染不出来时报「通过」，正是本仓最恨的假绿；
 *   ② 它们断言的是**行为**（点 tick、值变没变），**没有一个量几何**
 *      （字号 / 对齐 / 溢出 / 视口占用），故 U8 那类「浮层贴不贴边、抽屉挡不挡」
 *      的判据至今**判不了**。
 *   本文件就是补这两条：**渲染失败 ⇒ RC=2（工具坏了）**，且**只量几何**。
 *
 * ══ 量测口径（五项 · 每项都写清「这个数怎么来的」）═════════════════════════════
 * 见 `measureLayout()` 内每项上方的注释。五项全部在**真 Chromium 布局后**取，
 * 没有一项是从源码正则推出来的 —— 这是本门与 `check-ui-first-layer.mjs`（静态 AST）
 * 的分工：那道门数「源码里有几个信息块」，本门量「浏览器把它排成了什么样」。
 *
 * ══ 扫描根（诚实边界 · 本门量不到什么）════════════════════════════════════════
 * 除「横向溢出」外，各项都在 **`rootSelector` 指定的内容区**内量，**不含外壳导航**。
 * 理由是归属：外壳导航属 `pages/ShellLayout.tsx`，与被测页不是同一个交付单元，
 * 把它算进来会让「换一个页面」和「改一次导航」在同一个数上互相污染。
 * ⇒ **本门绿不代表整屏没问题**，只代表内容区那部分没变坏。
 *
 * 用法见 `scripts/check-layout-legibility.mjs`。
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** 本文件的调用方一律用它抛错：任何环境/工具问题都必须变成 RC=2，绝不能变成 RC=1。 */
export class ProbeBroken extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ProbeBroken";
    this.probeBroken = true;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// 一 · Chromium 与 playwright 的定位
//   ⚠ 找不到**不是** SKIP。见文件头「诚实订正 ①」。
// ───────────────────────────────────────────────────────────────────────────────

const CHROMIUM_ROOTS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  "/opt/pw-browsers",
  "/root/.cache/ms-playwright",
  process.env.HOME ? `${process.env.HOME}/.cache/ms-playwright` : null,
].filter(Boolean);

const CHROMIUM_SUBS = [
  "chromium", // /opt/pw-browsers/chromium 是本容器预置的软链
  "chromium-1194/chrome-linux/chrome",
  "chromium-1181/chrome-linux/chrome",
  "chromium-1148/chrome-linux/chrome",
];

export function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) {
    return process.env.PLAYWRIGHT_CHROMIUM;
  }
  for (const root of CHROMIUM_ROOTS) {
    for (const sub of CHROMIUM_SUBS) {
      const p = `${root}/${sub}`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * playwright-core 本仓**没有**装进 workspace（`apps/frontend-shell/package.json` 无此依赖，
 * 本单实测 `require.resolve("playwright-core")` 抛 MODULE_NOT_FOUND）。
 * 容器里有一份全局安装，故按「本地 → 全局」顺序找。
 * ⚠ 一律**不许**去跑 `playwright install`（会去外网拉重复的一份）。
 */
const PW_SPECS = [
  "playwright-core",
  "playwright",
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js",
  "/opt/node22/lib/node_modules/playwright-core/index.js",
];

export function loadChromiumApi() {
  for (const spec of PW_SPECS) {
    try {
      const mod = require(spec);
      if (mod?.chromium) return mod.chromium;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────────
// 二 · 量测函数本体
//   ⚠ 这个函数会被 `page.evaluate` **序列化后丢进浏览器**执行，
//     因此它**不许**引用本模块作用域里的任何标识符（引用了就是 ReferenceError）。
//   ⚠ 金丝雀与真页面**共用这一份**。不许另抄一份正则/逻辑 ——
//     抄了金丝雀就是装饰品（CLAUDE.md 铁律 0.6 实测过）。
// ───────────────────────────────────────────────────────────────────────────────

export function measureLayout(opts) {
  const rootSel = opts.rootSelector;
  const VW = window.innerWidth;
  const VH = window.innerHeight;

  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return { ok: false, reason: `扫描根未命中：${rootSel}` };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const ownText = (el) => {
    let s = "";
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
    return s.trim();
  };
  /**
   * 元素的类名 —— **必须走 `getAttribute("class")`，不许用 `el.className`**。
   *
   * ⚠ 这一条是 WO-U10-THREE-PAGES 实测抓出来的真缺陷（不是风格问题）：
   *   HTML 元素的 `className` 是字符串，而 **SVG 元素的 `className` 是 `SVGAnimatedString` 对象**，
   *   `String(...)` 出来是字面的 `"[object SVGAnimatedString]"`。
   *   于是本仓那三页最小字号的现场（雷达轴标签 / DAG 节点副标签，**全是 SVG `<text>`**）
   *   在报文里一律打成 `<text.[object SVGAnimatedString]>` —— **门指不出是哪个选择器**，
   *   人拿到报文还得自己去翻源码。
   *   形态（CLAUDE.md 铁律 0.6 句式）：
   *     > 「我用『报文里有个 cls 字段』当作『门点得出选择器』的证据，而前者并不度量后者。」
   *   `getAttribute("class")` 对 HTML 与 SVG **是同一个语义**，两边都对。
   */
  const clsOf = (el) => (el.getAttribute && el.getAttribute("class")) || "";

  // ── M1 最小可见字号 ────────────────────────────────────────────────────────
  // 取数：遍历扫描根内**自身直接文本节点非空**的元素（不是 innerText —— 否则容器会替
  // 子孙背锅、最小值全被容器的大字号盖住），可见者取 `getComputedStyle().fontSize` 最小值。
  // 为什么是版面问题不是审美：小于某个值就是**读不了**，与好不好看无关。
  const texts = [];
  for (const el of root.querySelectorAll("*")) {
    const t = ownText(el);
    if (!t) continue;
    if (!visible(el)) continue;
    texts.push({ el, t, fs: parseFloat(getComputedStyle(el).fontSize) });
  }
  let minFontPx = Infinity;
  const smallest = [];
  for (const x of texts) if (x.fs < minFontPx) minFontPx = x.fs;

  // ── M6 正文字号（众数）──────────────────────────────────────────────────────
  // 取数：同一批元素的 `fontSize` **众数**（出现次数最多的那个值；并列时取较小者，偏保守）。
  // 为什么要有它、而 M1 不够：本单实测沙盘主页 602 个文本元素里 **560 个是 12px**（93%），
  // 最小值 10px 只有 12 个。只盯最小值会得出「把那 12 个 small 调大就好了」——
  // 而仓主说的「字太小」指的是**那 93%**。参照物正文是 13.5px。
  // ⇒ 「最小值」与「正文值」是两个不同的病，必须拆开量（CLAUDE.md 铁律 0.5 判据 1 同源）。
  const fontHist = {};
  for (const x of texts) {
    const k = Math.round(x.fs * 100) / 100;
    fontHist[k] = (fontHist[k] || 0) + 1;
  }
  let bodyFontPx = null;
  let bodyFontCount = -1;
  for (const k of Object.keys(fontHist).map(Number).sort((a, b) => a - b)) {
    if (fontHist[k] > bodyFontCount) {
      bodyFontCount = fontHist[k];
      bodyFontPx = k;
    }
  }
  if (texts.length) {
    const lim = Math.round(minFontPx * 100) / 100;
    for (const x of texts) {
      if (x.fs <= lim + 0.01 && smallest.length < 12) {
        const r = x.el.getBoundingClientRect();
        smallest.push({
          fs: Math.round(x.fs * 100) / 100,
          tag: x.el.tagName.toLowerCase(),
          cls: clsOf(x.el).slice(0, 70),
          text: x.t.slice(0, 28),
          at: `${Math.round(r.x)},${Math.round(r.y)}`,
        });
      }
    }
  }

  // ── M2 单屏可见交互行数 ────────────────────────────────────────────────────
  // 取数：扫描根内**可见且与第一屏相交**（top < 视口高 且 bottom > 0）的可交互控件个数。
  // 为什么是版面问题：一次全倒几十行 = 找不到重点（仓主原话「信息太多，第一层看不到重点」）。
  const CTRL = "button,a[href],input,select,textarea,summary,[role=button],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[role=option]";
  let firstScreenCtrls = 0;
  for (const el of root.querySelectorAll(CTRL)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top < VH && r.bottom > 0) firstScreenCtrls++;
  }

  // ── M3 视口利用率 ──────────────────────────────────────────────────────────
  // 取数：第一屏内**所有可见内容元素**的最左/最右边缘之差 ÷ 视口宽 ×100。
  // 为什么不直接量容器宽：容器可以是 100% 宽而内容全挤在中间一条 —— 那时容器宽度会说谎。
  // 量墨迹范围才咬得到「两侧大片空白」。
  let inkL = Infinity;
  let inkR = -Infinity;
  for (const x of texts) {
    const r = x.el.getBoundingClientRect();
    if (r.top >= VH || r.bottom <= 0) continue;
    if (r.left < inkL) inkL = r.left;
    if (r.right > inkR) inkR = r.right;
  }
  const inkWidth = inkR > inkL ? inkR - inkL : 0;
  const viewportUsePct = Math.round((inkWidth / VW) * 1000) / 10;

  // ── M4 同组控件左边缘对齐 ──────────────────────────────────────────────────
  // 取数：找「行组」= 同一父元素下、**className 相同**的 ≥3 个可见直接子元素，且它们
  // **纵向堆叠**（top 两两不同）。取每行**第一个可见控件**（该行无控件则取该行自身，
  // 前提是它有直接文本）的 `getBoundingClientRect().left`，四舍五入到整数后数**不同值个数**。
  // > 1 即该组未对齐。
  //
  // ⚠ 为什么必须按 className 分桶（这条是本单实测改过来的）：
  //   先前版本只要求「父元素下 ≥3 个纵向堆叠的子元素」，于是把「标题 + 一段说明 + 一个嵌套列表」
  //   这种**天然就不该对齐**的结构也算成一组，28/45 里混着噪声。
  //   参照物的 `.nrow` 是**重复行**（同一个类反复出现），只有重复行才谈得上「同一条竖线」。
  //   按类分桶后量的才是「同一组」。
  const groups = [];
  for (const parent of root.querySelectorAll("*")) {
    const kids = [...parent.children].filter(visible);
    if (kids.length < 3) continue;
    const buckets = new Map();
    for (const k of kids) {
      const key = `${k.tagName}.${clsOf(k)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(k);
    }
    for (const [key, members] of buckets) {
      if (members.length < 3) continue;
      // 「纵向堆叠」判据：按 top 排序后**互不重叠**（下一行的 top ≥ 上一行的 bottom − 1）。
      // 用它而不是「tops 两两不同」，是为了把**并排换行的 chip 组**排除掉 ——
      // 那种组的行内元素本来就该有不同的 left，拿对齐去要求它是误报。
      const sorted = [...members].sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      );
      let stacked = true;
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1].getBoundingClientRect();
        const cur = sorted[i].getBoundingClientRect();
        if (cur.top < prev.bottom - 1) { stacked = false; break; }
      }
      if (!stacked) continue;
      // 「行锚点」= 这一行**在文档序上最先出现的可见墨迹**（控件 或 有直接文本的元素），
      // 即「这一行的内容从哪个 x 开始」。参照物 `.nrow` 的三段栅格保证的正是这条竖线。
      //
      // ⚠ 这里踩过一次，记下来免得改回去：先前版本写的是「**优先找控件**，没控件才退到文本」。
      //   实测 `_dimGroup` 那 4 行被判成 4 个不同 left（717/604/703/695）——
      //   但那 4 行的**标签 `<b>` 明明都在 604**，参差的是各行标签后面那个 `?` 按钮的位置，
      //   而按钮跟在长短不一的标签后面本来就该不同 x。
      //   ⇒ 「优先找控件」量的不是「行内容起点」，是「第一个控件被文字推到哪」，
      //     那是**另一个量**，拿它当对齐判据会报一整类假红。
      // ⚠ 三个候选缺一不可（缺哪个都会让扫描面漏掉一整类行）：
      //   ① `k` **自己**就是墨迹（行即按钮，如 `BUTTON._impCard`）—— `querySelectorAll` 只找后代，找不到自己；
      //   ② 后代里的第一个墨迹（实测 `DIV.panel` 5 行的文字在孙节点，只看 `k` 自己会整组漏掉）；
      //   ③ 都没有 ⇒ 这一行没有可见内容，不参与对齐判定。
      const isInk = (el) => visible(el) && (el.matches(CTRL) || !!ownText(el));
      const anchorOf = (k) => {
        if (isInk(k)) return k;
        for (const d of k.querySelectorAll("*")) if (isInk(d)) return d;
        return null;
      };
      const lefts = [];
      for (const k of members) {
        const anchor = anchorOf(k);
        if (!anchor) continue;
        lefts.push(Math.round(anchor.getBoundingClientRect().left));
      }
      if (lefts.length < 3) continue;
      const distinct = [...new Set(lefts)];
      groups.push({
        group: key.slice(0, 70),
        rows: lefts.length,
        distinct: distinct.length,
        lefts: distinct.slice(0, 6),
      });
    }
  }
  const misalignedGroups = groups.filter((g) => g.distinct > 1);

  // ── M5 横向溢出 ────────────────────────────────────────────────────────────
  // 取数：`document.documentElement.scrollWidth - clientWidth`（页面级，故**不**限扫描根）。
  // 为什么是版面问题：页面出现横向滚动条 = 版面破了，硬判据无争议。
  const de = document.documentElement;
  const overflowPx = Math.max(0, de.scrollWidth - de.clientWidth);

  // ── M7/M8 溢出视口的元素 —— **两个数，永远分开报** ──────────────────────────
  // ⚠ 这两个数**必须拆开**，合成一个就会骗人（本单的直接来历）：
  //   前任量到「415 个元素溢出视口」并报了这一个数。读者极易把 415 读成「415 个坏点」，
  //   而其中**真够不着的是 0** —— 全都躺在可横滚容器里。
  //   反过来，只报「够不着=0」也是骗人：**「够得着」不等于「好用」** ——
  //   一屏塞不下、要横滚才看得见的内容，正是仓主说的「信息太多，第一层看不到重点」。
  //   ⇒ 故：`overflowEls`（总数）进棘轮**只许降**，`overflowUnreachable`（真够不着）设**绝对上限 0**。
  //   形态（CLAUDE.md 铁律 0.6 句式）：
  //     > 「我用『够得着』当作『好用』的证据，而前者并不度量后者。」
  //
  // 「够得着」的判据（沿祖先链走，走到根为止 —— grep 一层看不见的正是这条链）：
  //   · 祖先里有 `overflow-x: auto|scroll` **且它自己真的能滚**（scrollWidth > clientWidth）⇒ 够得着；
  //   · 先遇到 `overflow-x: hidden|clip` ⇒ 这一层把它**裁死**了 ⇒ 够不着；
  //   · 一路到根都没有滚动容器 ⇒ 看**页面自己**能不能横滚。
  // ⚠ 诚实边界：`hidden` 在规范上仍可**程序化**滚动，但用户滚不动。本门站在用户那侧判「够不着」。
  const reachable = (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === "auto" || ox === "scroll") {
        if (node.scrollWidth - node.clientWidth > 1) return true;
      }
      if (ox === "hidden" || ox === "clip") return false;
    }
    return de.scrollWidth - de.clientWidth > 1;
  };
  const overflowEls = [];
  const overflowUnreachableEls = [];
  for (const el of root.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > VW + 1 && r.width > 1) {
      const rec = {
        tag: el.tagName.toLowerCase(),
        cls: clsOf(el).slice(0, 70),
        right: Math.round(r.right),
      };
      overflowEls.push(rec);
      if (!reachable(el)) overflowUnreachableEls.push(rec);
    }
  }

  // ── M9 首屏锚点：**这一屏的主角到底在不在第一屏** ──────────────────────────
  // 取数：`opts.anchorSelector` 命中的元素的 `getBoundingClientRect().top`（相对视口，可为负）。
  //
  // ⚠ 为什么必须**单独量它**，而不能拿上面任何一项代替（这是本项存在的全部理由）：
  //   `firstScreenCtrls` 降了**不度量**「主角回到第一屏了」—— 把一块内容折叠起来，
  //   控件数当场变好，而被它挤下去的那块画布仍然在折线以下。两者是两个命题：
  //     > 「我用『第一屏控件数变少』当作『主画布回到第一屏』的证据，而前者并不度量后者。」
  //   （CLAUDE.md 铁律 0.6 句式。WO-SANDBOX-CONFIG-UX 实测过这个形态：控件 36→25 而画布落到折线以下。）
  //
  // ⚠ **`found` 与 `top` 必须分开报，不许合成一个数**（同 overflowEls / overflowUnreachable 那条）：
  //   选择器没命中时若回一个 `top = Infinity`，调用方会把「画布被删了」读成「画布太靠下」——
  //   两者处置方向相反（前者是回归/工具坏了，后者是版面问题）。故命中与否是**独立的布尔**。
  //   这正是变异反证要求「红在 top 超视口、不是红在组件不见了」的机器侧保障。
  let anchor = null;
  if (opts.anchorSelector) {
    const el = root.querySelector(opts.anchorSelector) || document.querySelector(opts.anchorSelector);
    if (!el) {
      anchor = { found: false, selector: opts.anchorSelector };
    } else {
      const r = el.getBoundingClientRect();
      anchor = {
        found: true,
        selector: opts.anchorSelector,
        // 与本文件其它各项共用同一个 `visible()`，不另抄一份判据。
        visible: visible(el),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        // 判据本体：**顶边落在第一屏之内**。`top < VH` 就是工单那句话，一字不改。
        inFirstScreen: r.top < VH,
      };
    }
  }

  // ── 独立口径（金丝雀证明不了的那一半）────────────────────────────────────
  // 金丝雀只证明**工具没瞎**，不证明**扫描面选对了**。故另给一个与五项判据无关的总数：
  // 量到的文本元素数。少于下限 ⇒ 页面根本没渲染出来 ⇒ 调用方必须判 RC=2 而不是「合格」。
  return {
    ok: true,
    viewport: { w: VW, h: VH },
    anchor,
    anchorTop: anchor && anchor.found ? anchor.top : null,
    textEls: texts.length,
    minFontPx: texts.length ? Math.round(minFontPx * 100) / 100 : null,
    bodyFontPx,
    bodyFontShare: texts.length ? Math.round((bodyFontCount / texts.length) * 1000) / 10 : 0,
    fontHist,
    smallest,
    firstScreenCtrls,
    viewportUsePct,
    ink: { left: Math.round(inkL), right: Math.round(inkR), width: Math.round(inkWidth) },
    rowGroups: groups.length,
    misalignedGroups: misalignedGroups.length,
    misalignedSamples: misalignedGroups
      .sort((a, b) => b.distinct - a.distinct)
      .slice(0, 8),
    overflowPx,
    overflowEls: overflowEls.length,
    overflowSamples: overflowEls.slice(0, 6),
    // ⚠ 与 overflowEls **分开报**，不许合成一个数。见上 M7/M8 的注释。
    overflowUnreachable: overflowUnreachableEls.length,
    overflowUnreachableSamples: overflowUnreachableEls.slice(0, 6),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// 三 · 渲染 harness
// ───────────────────────────────────────────────────────────────────────────────

/** 各项判据的方向：`up` = 只许升（越大越好）· `down` = 只许降（越小越好）。 */
export const METRICS = [
  { key: "minFontPx", dir: "up", label: "最小可见字号(px)" },
  { key: "bodyFontPx", dir: "up", label: "正文字号·众数(px)" },
  { key: "firstScreenCtrls", dir: "down", label: "单屏可见交互控件数" },
  { key: "viewportUsePct", dir: "up", label: "视口利用率(%)" },
  { key: "misalignedGroups", dir: "down", label: "左边缘未对齐的行组数" },
  { key: "overflowPx", dir: "down", label: "横向溢出(px)" },
  // ⚠ 这一项是前任量到「415 个」之后主张纳入棘轮的，**照做**。
  //   它与 `overflowUnreachable` 是**两个数**，报告里永远分开印：
  //   总数只许降（横滚才看得见 ≠ 好用），真够不着的另有绝对上限 0。
  { key: "overflowEls", dir: "down", label: "溢出视口的元素数(总)" },
  // ⚠ 只对**声明了锚点的页**产出（其余页该键为 null ⇒ 棘轮与基线写入两处都会跳过，
  //   见调用方 `typeof !== "number" → continue`）。方向 `down` = 主角只许离首屏顶更近。
  { key: "anchorTop", dir: "down", label: "首屏锚点距视口顶(px)" },
];

/**
 * 独立口径下限：量到的文本元素少于它 ⇒ 判「没渲染出来」⇒ RC=2。
 *
 * ⚠ **它是「空壳探测器」，不是「内容完整性检查」** —— 这句话决定了它该取多大。
 *   它只回答「这个路由到底挂上了没有」，**不**回答「这一页内容全不全」。
 *   后者由每页各自的棘轮基线（`textEls` + 守恒判据 C2）管。
 *
 * ── 标定实测（2026-08-17，本单亲手量的，不是沿用注释里的传说）───────────────────
 *   **真空态**（这才是它要咬的）：
 *     · 登录后跳一个不存在的路由 `/v/__nope__` ······ textEls = **4**
 *     · 未登录停在 `/login`（`main` 根本不存在） ····· 扫描根未命中（另一条路径处理，不走本下限）
 *   **稀疏但正常的真实页**（这些一个都不许咬）：
 *     · `sop-balance` **25** · `disruption-radius` 32 · `cleanroom-attr` 34 · `what-if` 34
 *     · `optimize-whatif` 64 · `sim-sandbox` 601 · `global-sim` 884
 *   ⇒ 分界必须落在 **4 与 25 之间**。取 **12**：约为空态的 3 倍、最稀真实页的一半，两侧都有余量。
 *
 * ⚠ **本值 2026-08-17 从 60 下调到 12，理由是「原值标定错了」，不是「为了消红」** ——
 *   这两者必须分清（本仓最恨 `--update` 买绿）。证据：原值 60 把 **4 个页**
 *   （`what-if` / `cleanroom-attr` / `disruption-radius` / `sop-balance`）判成「没渲染出来」，
 *   而逐页 `innerText` 实测它们**都渲染了真内容**（850 / 318 / 279 / 383 字，含完整表单与列表）。
 *   形态（CLAUDE.md 铁律 0.6 句式）：
 *     > 「我用『文本元素 < 60』当作『页面没渲染』的证据，而前者并不度量后者 ——
 *     >   它度量的是**这一页稠不稠**，而稀疏的页天生就稀疏。」
 *   原值是拿 `sim-sandbox`（601）一页的手感定的，**一页的手感不是全仓的判据**。
 *
 * ⚠ 标定时踩到一个坑，记下来免得下次又被它骗：另试过「把 `main.innerHTML` 清空」当空态样例，
 *   量到 **47**（比真实页还高）—— 因为清空后 React 在等待期内**又把内容渲染回来了**。
 *   那不是空态，是「空了一瞬又回来」。**用它标定会得出恰好相反的下限。**
 */
export const TEXT_ELS_FLOOR = 12;

export async function launchBrowser() {
  const exe = findChromium();
  const chromium = loadChromiumApi();
  if (!exe) {
    throw new ProbeBroken(
      `未找到 Chromium（查过：${CHROMIUM_ROOTS.join(" / ")}）。容器预置在 /opt/pw-browsers；` +
        `不许跑 playwright install，用 PLAYWRIGHT_CHROMIUM=<路径> 直接指过去。`,
    );
  }
  if (!chromium) {
    throw new ProbeBroken(`未找到 playwright 的 chromium API（查过：${PW_SPECS.join(" / ")}）。`);
  }
  return chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

/**
 * 打开一页、登录、SPA 内导航到目标路由、等版面稳定，再跑 `measureLayout`。
 *
 * ⚠ 「等版面稳定」不是 sleep 一个拍脑袋的秒数：连采两次，文本元素数**两次相同**才算稳
 *   （CLAUDE.md 铁律 1「凭一次快照下结论」的同源纪律）。超时仍不稳 ⇒ 抛 ProbeBroken ⇒ RC=2。
 */
export async function renderAndMeasure(browser, spec) {
  const { baseUrl, route, viewport, rootSelector, anchorSelector = null, login, settleMs = 900, stableTries = 20 } = spec;
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 45_000 });
    if (login) {
      await page.fill("#login-tenant", login.tenant).catch(() => {});
      await page.fill("#login-username", login.username);
      await page.fill("#login-password", login.password);
      await page.click("button[type=submit]");
      await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 30_000 }).catch(() => {});
      if (page.url().includes("/login")) {
        throw new ProbeBroken(`登录未通过（仍停在 ${page.url()}）—— 无法渲染 ${route}，判「工具坏了」。`);
      }
    }
    if (route) {
      await page.evaluate((r) => {
        window.history.pushState({}, "", r);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, route);
    }
    await page.waitForTimeout(settleMs);

    // ⚠ 「两次采样相同」**不足以**判稳（本单实测栽过一次）：
    //   页面在懒加载/工作台数据还没回来时会先渲一个几乎空的壳，那个壳**本身就是静止的** ——
    //   于是两次采样当然相同，量到 `textEls=1` 却被判成「稳定」，差一点就拿一个空壳的数当基线。
    //   救回来的是**独立口径**（textEls 下限），不是稳定性判据。
    //   故这里把两条合成一条：**既要 ≥ 下限、又要与上一次相同**才算稳。
    let last = null;
    let stable = null;
    const trace = [];
    for (let i = 0; i < stableTries; i++) {
      const cur = await page.evaluate(measureLayout, { rootSelector, anchorSelector });
      trace.push(cur.ok ? `textEls=${cur.textEls}` : `未命中(${cur.reason})`);
      if (
        cur.ok &&
        cur.textEls >= TEXT_ELS_FLOOR &&
        last?.ok &&
        last.textEls === cur.textEls &&
        last.firstScreenCtrls === cur.firstScreenCtrls &&
        // 锚点还在移动 ⇒ 版面没停稳。少了这一条，`anchorTop` 可能量在某个中间态上
        //（本项的判据是「顶边落没落进第一屏」，差几十像素就换结论，不能拿中间态定案）。
        last.anchorTop === cur.anchorTop
      ) {
        stable = cur;
        break;
      }
      last = cur;
      await page.waitForTimeout(settleMs);
    }
    if (!stable) {
      const why =
        last?.ok && last.textEls < TEXT_ELS_FLOOR
          ? `独立口径不过：量到文本元素 ${last.textEls} < 下限 ${TEXT_ELS_FLOOR} ⇒ 页面没真渲染出来。` +
            `此时报「版面合格」正是假绿，故判「工具坏了」。`
          : `版面在 ${stableTries} 次采样内未稳定。`;
      throw new ProbeBroken(
        `${why}\n   采样轨迹：${trace.join(" → ")}` +
          `${pageErrors.length ? `\n   页面异常：${pageErrors[0]}` : ""}`,
      );
    }
    stable.pageErrors = pageErrors.slice(0, 3);
    return stable;
  } finally {
    await page.close().catch(() => {});
  }
}

/** 金丝雀专用：直接给一段 HTML 渲染并量，走**同一份** `measureLayout`。 */
export async function measureHtml(browser, html, viewport, rootSelector = "body") {
  const page = await browser.newPage({ viewport });
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.evaluate(measureLayout, { rootSelector });
  } finally {
    await page.close().catch(() => {});
  }
}
