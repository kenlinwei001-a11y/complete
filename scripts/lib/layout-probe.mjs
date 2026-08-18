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
 * ══ 2026-08-18 扩（WO-GATE-B-BROWSER-HARNESS）：「只量几何」已过期 ════════════════
 * 本文件现在共四个能力，页面装配（登录 / SPA 内导航 / 等版面稳定）只有一份
 * （`openStablePage`），各能力共用 —— 装配抄两份就会漂移：
 *   ① `measureLayout`        单时刻几何量测（字号 / 对齐 / 溢出 / 视口占用）—— `layout-legibility:check` 在用；
 *   ② B-1 两时刻 DOM 快照比对（`probeInputReaction` + `snapshotDomInPage` 等）——
 *      改一个输入、不点任何按钮，断言结果 DOM 在 N ms 内变了（PRD §4.2 的 B-1 = U1 时延面）；
 *   ③ B-4·U8 遮挡判定（`measureOcclusionInPage` 等）——
 *      「A 盖住了 B 的哪一部分」的 z-order × 矩形相交量（PRD §4.2 的 B-4 的 U8 几何面）；
 *   ④ `openStablePage`       页面装配唯一实现。
 * ②③ 的门 = `scripts/check-harness-ux-behavior.mjs`（`harness-ux-behavior:check`）。
 *
 * 用法见 `scripts/check-layout-legibility.mjs` 与 `scripts/check-harness-ux-behavior.mjs`。
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
  // macOS 上 playwright 的默认浏览器缓存位（本仓开发机实测路径）。
  process.env.HOME ? `${process.env.HOME}/Library/Caches/ms-playwright` : null,
].filter(Boolean);

// macOS 本机没装 playwright 浏览器时的兜底：直接用系统 Chrome（本单实测可用）。
const CHROMIUM_APP_FALLBACKS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

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
  for (const p of CHROMIUM_APP_FALLBACKS) {
    if (existsSync(p)) return p;
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

  // ── 独立口径（金丝雀证明不了的那一半）────────────────────────────────────
  // 金丝雀只证明**工具没瞎**，不证明**扫描面选对了**。故另给一个与五项判据无关的总数：
  // 量到的文本元素数。少于下限 ⇒ 页面根本没渲染出来 ⇒ 调用方必须判 RC=2 而不是「合格」。
  return {
    ok: true,
    viewport: { w: VW, h: VH },
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
 * 打开一页、登录、SPA 内导航到目标路由、等版面稳定 —— **页面装配的唯一实现**。
 * `renderAndMeasure`（单时刻几何）与 B-1 行为探针（两时刻 DOM 快照比对）、
 * B-4·U8 遮挡探针（z-order × 矩形相交）都走它 —— 登录/导航/稳定判定不许抄第二份，
 * 抄了两份就会漂移（今天漂的是「等稳定」，明天漂的就是「量到的是不是同一页」）。
 *
 * ⚠ 「等版面稳定」不是 sleep 一个拍脑袋的秒数：连采两次，文本元素数**两次相同**才算稳
 *   （CLAUDE.md 铁律 1「凭一次快照下结论」的同源纪律）。超时仍不稳 ⇒ 抛 ProbeBroken ⇒ RC=2。
 *
 * 成功时返回**开着的 page**（调用方负责 close）；失败时自己先 close 再抛。
 */
export async function openStablePage(browser, spec) {
  const { baseUrl, route, viewport, rootSelector, login, settleMs = 900, stableTries = 90 } = spec;
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  try {
    // ⚠ 不用 `networkidle`：vite dev 的模块加载 + HMR 长连让它在重机上 45s 都等不到
    //   （本单在 macOS 上实测 page.goto 超时）。真正的「渲染出来了没有」由下面的
    //   稳定循环保证（textEls ≥ 下限 且 两次采样相同），goto 只要拿到文档壳就够。
    //   stableTries 默认 90（≈81s）是为 vite **冷启动**的按需编译留的 ——
    //   本单实测冷编译首渲染要 35s+（trace：39 采 textEls=1 → 第 40 采 266）；
    //   正常情况下 2–3 采就稳，默认值只在页面真不渲染时才付代价。
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
      const cur = await page.evaluate(measureLayout, { rootSelector });
      trace.push(cur.ok ? `textEls=${cur.textEls}` : `未命中(${cur.reason})`);
      if (
        cur.ok &&
        cur.textEls >= TEXT_ELS_FLOOR &&
        last?.ok &&
        last.textEls === cur.textEls &&
        last.firstScreenCtrls === cur.firstScreenCtrls
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
    return { page, stable, pageErrors };
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

/**
 * 打开一页、登录、SPA 内导航到目标路由、等版面稳定，再跑 `measureLayout`。
 * 装配逻辑在 `openStablePage`（唯一实现），本函数只多一步：量完把 page 关掉。
 */
export async function renderAndMeasure(browser, spec) {
  const { page, stable } = await openStablePage(browser, spec);
  try {
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

// ───────────────────────────────────────────────────────────────────────────────
// 四 · B-1「同一页面两个时刻的 DOM 快照比对」（WO-GATE-B-BROWSER-HARNESS）
//
// 守的是 `docs/PRD-harness-ux-adoption.md` §4.2 的 **B-1 = U1 的时延面**：
//   改一个输入、**不点任何按钮**，断言结果 DOM 在 N 毫秒内变了。
// 「改输入即重演」的失败态有两种，本探针咬的是**行为**，不是源码形状：
//   ① 存在提交闸（改完不点按钮，结果永远不变 —— 用户以为在看新结果，实际在看旧结果）；
//   ② 输入根本没进求解入参 / queryKey（改了等于没改）。
// 两者在源码里都能写得「看起来像接了」，只有渲染后改一下才知道 —— 这正是它被拆进 §4.2 的原因。
//
// ⚠ 本节所有 `*InPage` 函数都会被 `page.evaluate` **序列化后丢进浏览器**执行，
//   一律**不许**引用本模块作用域里的任何标识符（引用了就是 ReferenceError）。
// ⚠ 金丝雀与真页面**共用本节同一份实现**。不许另抄一份 —— 抄了金丝雀就是装饰品。
// ───────────────────────────────────────────────────────────────────────────────

/**
 * 浏览器侧：给扫描根内的可见 DOM 取一份**内容签名**（FNV-1a · 不是安全哈希，只为比对）。
 * 签名料（三路，缺一路就会漏一整类「结果变了」）：
 *   ① 每个「自身直接文本节点非空」的可见元素的 `序号:标签:文本`（文本截 60 字）；
 *   ② 可见元素总数（结构变了但文本恰好一样时也能咬住，如整表重排）；
 *   ③ **SVG `<path>` 的 `d` 属性**（截 80 字 × 前 40 条）—— 本仓大量「结果」是画出来的
 *      折线/雷达/传导图，改输入后**图形重画了但文本一个字母都没变**（本单实测：
 *      改 sim-sandbox 的「指标」下拉，文本签名纹丝不动，而结论区的图确实重绘了）。
 *      没有③，纯文本签名会把「图变了」误判成「什么都没变」—— 又一例
 *      「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 * 刻意**不**含输入控件自身的 value —— 我们要测的是「**结果** DOM 变没变」，
 * 把被改的那个输入自己算进签名，会把「只有输入变了、结果没动」误判成「有反应」。
 * 诚实边界：`<canvas>` 画的结果签名够不着（位图不进 DOM），真遇到只能换采样面。
 */
export function snapshotDomInPage(opts) {
  const root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document.body;
  if (!root) return { ok: false, reason: `扫描根未命中：${opts.rootSelector}` };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const entries = [];
  const paths = [];
  let visibleEls = 0;
  let i = 0;
  for (const el of root.querySelectorAll("*")) {
    if (!visible(el)) continue;
    visibleEls++;
    if (el.tagName.toLowerCase() === "path" && paths.length < 40) {
      paths.push((el.getAttribute("d") || "").slice(0, 80));
    }
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    t = t.trim();
    if (!t) continue;
    entries.push(`${i++}:${el.tagName.toLowerCase()}:${t.slice(0, 60)}`);
  }
  // FNV-1a 32bit
  const fnv = (s, h) => {
    for (let k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  const hashOf = (arr) => fnv(arr.join(""), 0x811c9dc5).toString(16);
  const textSig = hashOf(entries);
  const pathSig = hashOf(paths);
  let h = 0x811c9dc5;
  h = fnv(entries.join(""), h);
  h = fnv(paths.join(""), h);
  h = fnv(`#${visibleEls}:${paths.length}`, h);
  return {
    ok: true,
    sig: `${h.toString(16)}:${entries.length}:${visibleEls}:${paths.length}`,
    textSig,
    pathSig,
    textEls: entries.length,
    visibleEls,
    pathEls: paths.length,
    sample: entries.slice(0, 60),
    // 完整逐元素清单（带序号前缀，可按位对齐做 diff）—— 只在调用方要了才给，
    // 因为轮询路径上每次都要序列化几百条字符串，能省则省。
    entries: opts.withEntries ? entries : undefined,
  };
}

/**
 * 浏览器侧：在扫描根内挑出**至多 `max` 个**可编辑输入并逐个打上 `data-probe-target="<i>"` 标记，
 * 返回它们的身份与**各自要改成的新值**。排序：number 输入 → 其他文本输入 → select → checkbox → textarea。
 * 新值必须是**确定性的**（不许随机，不许读时钟 —— 本仓门不许依赖时钟随机性）：
 *   数字 → 旧值 + 1；文本 → 末尾追加 "1"；select → 第一个与现值不同的 option；
 *   **checkbox → 取反**（手势是 `el.click()` —— toggle 一个复选框就是「改这个输入的值」，
 *   与「点提交按钮」是两回事。本仓 sim-sandbox 的 16 个传导边开关全是 checkbox，
 *   把它排除在外，那一页就只剩一个不切数的「指标」下拉 —— 本单实测）。
 * ⚠ 为什么要多个而不是一个：一页有多个输入时，第一个可能是**不驱动重算**的
 *   （本单实测 sim-sandbox 第一个候选是「指标」下拉 —— 它切的是图不是数）。
 *   只试一个就把「这个输入不驱动」误判成「这一页有提交闸」。逐个试，
 *   「全部试过都不变」才是「提交闸/没接入参」的合格证据。
 */
export function findEditableInputInPage(opts) {
  const root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document.body;
  if (!root) return { ok: false, reason: `扫描根未命中：${opts.rootSelector}` };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const pool = [
    ...root.querySelectorAll(
      'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]):not([type=search])',
    ),
    ...root.querySelectorAll("select"),
    ...root.querySelectorAll("input[type=checkbox]"),
    ...root.querySelectorAll("textarea"),
  ].filter((el) => visible(el) && !el.disabled && !el.readOnly);
  // number 优先：改它触发重算的概率最高（业务输入大多是数字）。
  pool.sort((a, b) => {
    const na = a.tagName === "INPUT" && a.type === "number" ? 0 : 1;
    const nb = b.tagName === "INPUT" && b.type === "number" ? 0 : 1;
    return na - nb;
  });
  const max = opts.max ?? 4;
  const out = [];
  for (let idx = 0; idx < pool.length && out.length < max; idx++) {
    const el = pool[idx];
    let oldValue, newValue, gesture = "set";
    if (el.tagName === "INPUT" && el.type === "checkbox") {
      oldValue = String(el.checked);
      newValue = String(!el.checked);
      gesture = "toggle";
    } else {
      oldValue = el.value ?? "";
      if (el.tagName === "SELECT") {
        const opt = [...el.options].find((o) => o.value !== oldValue && !o.disabled);
        if (!opt) continue; // 没有可切换的选项 ⇒ 这个候选没法用，看下一个
        newValue = opt.value;
      } else if (el.tagName === "INPUT" && el.type === "number") {
        const n = Number(oldValue);
        newValue = String(Number.isFinite(n) ? n + 1 : 1);
      } else {
        newValue = `${oldValue}1`;
      }
    }
    el.setAttribute("data-probe-target", String(out.length));
    out.push({
      index: out.length,
      gesture,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      id: el.id || "",
      aria: el.getAttribute("aria-label") || "",
      cls: (el.getAttribute("class") || "").slice(0, 70),
      oldValue: String(oldValue).slice(0, 40),
      newValue: String(newValue).slice(0, 40),
    });
  }
  if (!out.length) return { ok: true, found: false };
  return { ok: true, found: true, inputs: out };
}

/**
 * 浏览器侧：把第 `index` 个打了标记的输入改成新值，**走原生 setter + 冒泡事件**。
 * ⚠ 直接 `el.value = v` 对 React 受控组件无效（React 的值跟踪器会把它吞掉），
 *   必须走原型上的 setter 再派发 `input`/`change` —— 这是 React 官方测试工具的同款手法。
 * 本函数**不点任何按钮**（B-1 的全部意义就在「不点按钮结果也该变」）。
 */
export function changeMarkedInputInPage(opts) {
  const el = document.querySelector(`[data-probe-target="${opts.index ?? 0}"]`);
  if (!el) return { ok: false, reason: `标记输入 ${opts.index ?? 0} 丢了（页面在两次 evaluate 之间重渲染了）` };
  // checkbox 的「改值」手势就是点它自己 —— toggle 复选框 ≠ 点提交按钮。
  // `el.click()` 走真实事件链（React 对 checkbox 听的正是 click/change）。
  if (el.tagName === "INPUT" && el.type === "checkbox") {
    const want = opts.newValue === "true";
    if (el.checked !== want) el.click();
    return { ok: true, applied: el.checked === want, now: String(el.checked) };
  }
  const proto =
    el.tagName === "SELECT"
      ? HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (!desc?.set) return { ok: false, reason: "拿不到原生 value setter" };
  desc.set.call(el, opts.newValue);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, applied: el.value === opts.newValue, now: el.value };
}

/** B-1 探针的默认判定时窗（毫秒）。为什么取 5000 见下方 probeInputReaction 的注释。 */
export const REACTION_TIMEOUT_MS = 5000;

/**
 * Node 侧驱动：在**已打开的页面**上跑一次 B-1 探针 ——
 * 快照 → 改一个输入（不点任何按钮）→ 轮询快照，直到签名变化或超过 `timeoutMs`。
 *
 * 返回（`status` 四态，门按态判定，不许合并）：
 *   changed    结果 DOM 在 timeoutMs 内变了（附 latencyMs 与前后样本）
 *   unchanged  超时仍没变 —— **提交闸 / 输入没接入参**的行为面证据
 *   no-input   扫描根内找不到可编辑输入 —— 本页这条判据无处落脚（对账时按「未判」处理）
 *   unstable   改输入**之前**签名就在自变（页面有自走时钟/轮询）—— 变了也没法归因，不许用来判
 *
 * ⚠ 时窗默认 5000ms 的理由：提交闸的失败态是「**永远**不变」，任何有限时窗都咬得住它；
 *   时窗的唯一风险是**冤枉**正常的重算。mock 模式重算 = 本地同步计算 + react-query 失效重取，
 *   实测全部 < 1s（见本单交单报告），取 5000 留了 5 倍以上余量，不是拍脑袋。
 */
/**
 * Node 侧纯函数：把「签名变了」归因成 **changed**（结果真变了）还是 **echo**（只是输入回显）。
 *
 * 为什么需要它（2026-08-18 实测 `optimize-whatif`）：改基线表数字 100→101，
 * 屏上唯一的变化是一个 `span.mono` 把那个数**原样照抄**了一遍 —— 求解器一下都没跑，
 * 但「DOM 变了」字面成立。把这种回显当成「改输入即重演」，会把带提交闸的页误判成
 * 「修好没回写」。**输入回显 ≠ 结果重演**，必须分开记账。
 *
 * 判法（全部用快照自己的分量，不看页面语义）：
 *   · SVG path 签名变了 / 文本元素个数变了 / 同位标签变了 ⇒ changed（结构或图变了，回显做不到）；
 *   · 逐位对齐后的**全部**文本修改都是「旧文本===旧输入值 ∧ 新文本===新输入值」⇒ echo；
 *   · 其余 ⇒ changed。
 * 证据不全（没采 entries）⇒ 保守归 changed（回显是豁免，豁免必须举证）。
 *
 * @returns {"changed"|"unchanged"|"echo"}
 */
export function classifyReaction(before, after, oldValue, newValue) {
  if (!before?.ok || !after?.ok) return "changed";
  if (after.sig === before.sig) return "unchanged";
  if (after.pathSig !== before.pathSig || (after.pathEls ?? 0) !== (before.pathEls ?? 0)) return "changed";
  const b = before.entries ?? null;
  const a = after.entries ?? null;
  if (!b || !a) return "changed"; // 没采逐元素清单 ⇒ 无法证明是回显 ⇒ 按真变化
  if (b.length !== a.length) return "changed"; // 元素增删 = 真变化
  const mods = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i] === a[i]) continue;
    const bt = b[i].split(":");
    const at = a[i].split(":");
    if (bt[1] !== at[1]) return "changed"; // 同位标签都换了 = 结构变化
    mods.push({ from: bt.slice(2).join(":"), to: at.slice(2).join(":") });
  }
  if (!mods.length) return "changed"; // 签名变了而逐位文本全同（可见计数等变化）⇒ 真变化
  const ov = String(oldValue).slice(0, 60);
  const nv = String(newValue).slice(0, 60);
  return mods.every((m) => m.from === ov && m.to === nv) ? "echo" : "changed";
}

/**
 * Node 侧纯函数：在**新扫出来的候选清单**里对回最初那份清单里的同一个输入。
 * 为什么需要它（2026-08-18 实测 order-chain）：标记是 `findEditableInputInPage` 打的
 * DOM 属性，而探针在每个候选前要做稳定化（最多 ~6s）+ 上一候选的轮询（最多 5s），
 * 期间页面一旦重渲染把节点整个换掉，标记就随旧节点一起没了 —— 拿最初的序号去查
 * `[data-probe-target]` 必落空。修法不是「当初多打几个标」，是**每次动手前用同一实现
 * 重扫重打标**，再按稳定身份对回原候选：
 *   ① 身份串（tag|type|name|id|aria）+ 旧值全等 ⇒ 最硬；
 *   ② 仅身份串全等 ⇒ 值被上一手势合法改过（checkbox toggle 后还没还原）；
 *   ③ 同序号 ⇒ 兜底（同一扫描实现同一排序，序号大概率仍对得上）。
 * @returns {object|null} 新清单里对应的那条候选（带新鲜 index/newValue/oldValue）
 */
export function matchCandidate(freshInputs, cand) {
  if (!Array.isArray(freshInputs) || !cand) return null;
  const idOf = (c) => `${c.tag}|${c.type}|${c.name}|${c.id}|${c.aria}`;
  const exact = freshInputs.find((c) => idOf(c) === idOf(cand) && c.oldValue === cand.oldValue);
  if (exact) return exact;
  const byId = freshInputs.find((c) => idOf(c) === idOf(cand));
  if (byId) return byId;
  return freshInputs[cand.index] ?? null;
}

export async function probeInputReaction(page, opts) {
  const { rootSelector, timeoutMs = REACTION_TIMEOUT_MS, pollMs = 200, baseStableTries = 15 } = opts;

  // ── 稳定化：签名**两次连续相同**才算稳（不是只采一次就改输入）────────────────
  // ⚠ 第一版只采一次基准就改输入，实测栽在 sim-sandbox 上：
  //   openStablePage 的「稳定」看的是 textEls **计数**，计数稳了内容还在到货
  //   （懒加载 chunk / react-query 后继查询），于是基准快照撞上晚到的内容 ⇒ 误报
  //   「页面自变、无法归因」。修法与 openStablePage 同源：**等它真稳**，等不到才报 unstable。
  // ⚠ **每个候选各自重新稳定化**：上一候选（尤其 checkbox toggle）可能合法地留下一个新稳态
  //   （对照结果面板还开着），不许拿最初那次基准去套它 —— 归因只看「这次改之前 vs 这次改之后」。
  const stabilize = async () => {
    let prev = null;
    for (let i = 0; i < baseStableTries; i++) {
      const cur = await page.evaluate(snapshotDomInPage, { rootSelector, withEntries: true });
      if (!cur.ok) return { error: cur.reason };
      if (prev && prev.sig === cur.sig) return { snap: cur };
      prev = cur;
      await page.waitForTimeout(400);
    }
    return {
      error: `基准快照在 ${baseStableTries} 次采样（≈${Math.round((baseStableTries * 400) / 1000)}s）内签名未稳定 —— 页面有自走时钟/轮询，变化无法归因到输入`,
    };
  };

  const base0 = await stabilize();
  if (base0.error) return { status: "unstable", reason: base0.error };

  const found = await page.evaluate(findEditableInputInPage, { rootSelector, max: opts.maxInputs ?? 4 });
  if (!found.ok) return { status: "unstable", reason: found.reason };
  if (!found.found) return { status: "no-input", reason: "扫描根内没有可编辑输入" };

  // 每次动手前重扫重打标再改：标记是最初那次 find 打的 DOM 属性，而候选与候选之间
  // 隔着稳定化（最多 ~6s）与轮询（最多 5s），页面一旦重渲染换掉节点，旧标记就落空
  // （2026-08-18 实测 order-chain 第 3 个候选）。重扫用同一实现，按稳定身份对回原候选。
  const applyFresh = async (cand, value) => {
    const refind = await page.evaluate(findEditableInputInPage, { rootSelector, max: opts.maxInputs ?? 4 });
    const fresh = refind.ok && refind.found ? matchCandidate(refind.inputs, cand) : null;
    const eff = fresh ?? cand;
    const res = await page.evaluate(changeMarkedInputInPage, {
      index: eff.index,
      newValue: value !== undefined ? value : eff.newValue,
    });
    return { res, eff };
  };

  const tried = [];
  let firstChanged = null;
  let lastSnap = base0.snap;
  let seenChanged = false;
  let seenStill = false;
  for (const input of found.inputs) {
    // 每个候选各自重新稳定化（见上 ⚠）；稳不了 = 无法归因 = RC=2 那一侧的事。
    const st = tried.length === 0 ? base0 : await stabilize();
    if (st.error) return { status: "unstable", reason: `试第 ${tried.length + 1} 个输入前：${st.error}`, tried };
    const before = st.snap;

    const { res: applied, eff } = await applyFresh(input);
    if (!applied.ok) return { status: "unstable", reason: applied.reason, tried };
    // 「改不动」（React 拒收 / min-max 钳住）≠「改了没变」（提交闸）—— 前者根本没完成
    // 这次实验，不许计入「不变」的证据，换下一个候选。
    if (!applied.applied) {
      tried.push({ ...input, outcome: "apply-failed", result: `apply-failed(现为 ${applied.now})` });
      continue;
    }
    const t0 = Date.now();
    let hit = null;
    for (;;) {
      await page.waitForTimeout(pollMs);
      const cur = await page.evaluate(snapshotDomInPage, { rootSelector, withEntries: true });
      if (cur.ok && cur.sig !== before.sig) {
        hit = cur;
        break;
      }
      if (cur.ok) lastSnap = cur;
      if (Date.now() - t0 >= timeoutMs) break;
    }
    const latencyMs = Date.now() - t0;
    // 回显（输入值被原样照抄到屏上）≠ 重演 —— 归因分三态，echo 归「没重演」那一侧。
    // 归因用**实际打进去的那对值**（eff —— 重扫后值可能已被合法改过）。
    const outcome = hit ? classifyReaction(before, hit, eff.oldValue, eff.newValue) : "unchanged";
    tried.push({
      ...input,
      outcome,
      result: hit ? `${outcome}(${latencyMs}ms)` : "unchanged",
      latencyMs: hit ? latencyMs : undefined,
    });
    if (outcome === "changed") {
      seenChanged = true;
      if (!firstChanged) firstChanged = { input, latencyMs, before, after: hit };
    } else {
      seenStill = true; // echo 与 unchanged 同属「没重演」那一侧的证据
    }
    // 还原旧值再试下一个（还原走同一条原生 setter 路径；checkbox 就是再点一次自己 —— 不点任何按钮）。
    // 同样先重扫重打标：上一手势后的轮询期间页面也可能又渲染过。
    await applyFresh(input, eff.oldValue);
    await page.waitForTimeout(pollMs);
    // 两类证据都齐了（既有真重演的、也有改了不变的）⇒ 后面的候选不影响判定，提前收。
    if (seenChanged && seenStill) break;
  }

  const appliedAny = tried.some((t) => t.outcome !== "apply-failed");
  if (!appliedAny) {
    return { status: "no-input", reason: `候选输入全部改不动（${tried.map((t) => t.result).join(" · ")}）`, tried, timeoutMs };
  }
  if (firstChanged) {
    return {
      status: "changed",
      latencyMs: firstChanged.latencyMs,
      input: firstChanged.input,
      tried,
      before: firstChanged.before.sample,
      after: firstChanged.after.sample,
      timeoutMs,
    };
  }
  return {
    status: "unchanged",
    input: found.inputs[0],
    tried,
    before: base0.snap.sample,
    after: lastSnap.sample,
    timeoutMs,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// 五 · B-4·U8「A 盖住了 B 的哪一部分」—— z-order × 矩形相交遮挡判定
//
// 守的是 `docs/PRD-harness-ux-adoption.md` §4.2 的 **B-4 的 U8 几何面**：
//   悬停/点击在**原地**展开的浮层，几何上必须成立 ——
//   它该盖住内容（这是浮层的本分），而**不许有别的东西反过来盖住它**（盖住 = 浮层白开）。
// probe 此前只量元素**自身**的矩形，没有元素之间的遮挡关系；本节补的就是这个量：
//   ① z-order：对浮层矩形内采样点逐个 `document.elementsFromPoint`，
//      最上层元素必须属于浮层子树（不是比 z-index 数值 —— 比数值在堆叠上下文嵌套时会错，
//      `elementsFromPoint` 给的是**真实绘制序**，浏览器自己算的，骗不了）；
//   ② 矩形相交：浮层与每个可见文本元素的交集面积占比 = 「A 盖住了 B 的哪一部分」。
// ───────────────────────────────────────────────────────────────────────────────

/** 浮层触发器的候选选择器（`aria-expanded`/`aria-haspopup` 是本仓浮层组件的公开契约面）。 */
export const OVERLAY_TRIGGER_SEL = "[aria-expanded], [aria-haspopup]";
/** 浮层本体的候选选择器（本仓 `InfoPopover` 用 `role="tooltip"` + `.popover-surface`）。 */
export const OVERLAY_SEL = '[role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"], .popover-surface';

/**
 * 浏览器侧：列出扫描根内的浮层触发器候选（可见、未被 `data-probe-hover` 标记过），
 * 逐个打上 `data-probe-hover="<i>"` 标记供 Node 侧 hover/click。
 */
export function findOverlayTriggersInPage(opts) {
  const root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document.body;
  if (!root) return { ok: false, reason: `扫描根未命中：${opts.rootSelector}` };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const max = opts.max ?? 8;
  const out = [];
  let i = 0;
  for (const el of root.querySelectorAll("[aria-expanded], [aria-haspopup]")) {
    if (out.length >= max) break;
    if (!visible(el)) continue;
    if (el.hasAttribute("data-probe-hover")) continue;
    el.setAttribute("data-probe-hover", String(i));
    out.push({
      sel: `[data-probe-hover="${i}"]`,
      tag: el.tagName.toLowerCase(),
      aria: (el.getAttribute("aria-label") || "").slice(0, 60),
      text: (el.textContent || "").trim().slice(0, 30),
      cls: (el.getAttribute("class") || "").slice(0, 60),
    });
    i++;
  }
  return { ok: true, triggers: out };
}

/**
 * 浏览器侧：列出**当前可见**的浮层，各打一个 `data-probe-overlay="<sig>-<i>"` 标记。
 * `sig` 由调用方传入（同一页面多次调用用不同 sig），Node 侧据此分出「新出现的浮层」。
 */
export function listVisibleOverlaysInPage(opts) {
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(
    '[role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"], .popover-surface',
  )) {
    if (!visible(el)) continue;
    const mark = `${opts.sig}-${i}`;
    el.setAttribute("data-probe-overlay", mark);
    const r = el.getBoundingClientRect();
    out.push({
      sel: `[data-probe-overlay="${mark}"]`,
      mark,
      role: el.getAttribute("role") || "",
      cls: (el.getAttribute("class") || "").slice(0, 60),
      text: (el.textContent || "").trim().slice(0, 50),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    });
    i++;
  }
  return out;
}

/**
 * 浏览器侧：量一个浮层的遮挡关系 —— **「A 盖住了 B 的哪一部分」的唯一实现**。
 * 返回：
 *   occludedBy  浮层矩形内被**别的元素**压在下面的采样点（z-order 维：浮层被盖 = 违规）
 *   covers      浮层盖住了哪些可见文本元素、各盖住百分之几（矩形相交维：信息面回答）
 *   outside     采样点落在视口外的个数（诚实位：那几个点没量，不是量了没问题）
 */
export function measureOcclusionInPage(opts) {
  const ov = document.querySelector(opts.overlaySelector);
  if (!ov) return { ok: false, reason: `浮层选择器未命中：${opts.overlaySelector}` };
  const cs = getComputedStyle(ov);
  const r = ov.getBoundingClientRect();
  const clsOf = (el) => (el.getAttribute && el.getAttribute("class")) || "";
  if (cs.display === "none" || cs.visibility === "hidden" || r.width < 1 || r.height < 1) {
    return { ok: false, reason: "浮层不可见（量遮挡之前它先得是开着的）" };
  }
  // ── ① z-order 维：3×3 采样点，最上层元素必须属于浮层子树 ─────────────────
  const occludedBy = [];
  let samples = 0;
  let outside = 0;
  for (const fx of [0.15, 0.5, 0.85]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        outside++;
        continue;
      }
      samples++;
      const stack = document.elementsFromPoint(x, y);
      const top = stack[0];
      const onTop = top && (top === ov || ov.contains(top));
      if (!onTop) {
        occludedBy.push({
          at: `${Math.round(x)},${Math.round(y)}`,
          by: `<${(top?.tagName || "?").toLowerCase()}${top ? "." + clsOf(top).slice(0, 50) : ""}>`,
          byText: (top?.textContent || "").trim().slice(0, 40),
        });
      }
    }
  }
  // ── ② 矩形相交维：浮层盖住了哪些可见文本元素（「A 盖住了 B 的哪一部分」）────────
  const root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document.body;
  const covers = [];
  if (root) {
    for (const el of root.querySelectorAll("*")) {
      if (el === ov || ov.contains(el) || el.contains(ov)) continue;
      let t = "";
      for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
      t = t.trim();
      if (!t) continue;
      const ecs = getComputedStyle(el);
      if (ecs.display === "none" || ecs.visibility === "hidden" || Number(ecs.opacity) === 0) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      const ix = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
      const iy = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
      const inter = ix * iy;
      if (inter <= 0) continue;
      const pct = Math.round((inter / (b.width * b.height)) * 1000) / 10;
      covers.push({
        tag: el.tagName.toLowerCase(),
        cls: clsOf(el).slice(0, 50),
        text: t.slice(0, 40),
        coverPct: pct,
      });
    }
  }
  covers.sort((a, b2) => b2.coverPct - a.coverPct);
  return {
    ok: true,
    overlay: {
      sel: opts.overlaySelector,
      cls: clsOf(ov).slice(0, 60),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    },
    samples,
    outside,
    occludedBy,
    covers: covers.slice(0, 10),
    coveredEls: covers.length,
  };
}
