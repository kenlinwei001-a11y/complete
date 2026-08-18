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
 * ══ 2026-08-18 增量（WO-GATE-B-BROWSER-HARNESS）：两条**时序/遮挡**能力 ════════
 * 本体断点 `G-SPLITACCOUNT-PROMISE-ONLY` 复核订正后的真实缺口（「差 harness」已过期，
 * harness 就是本文件）。在本文件上加的，不是新造 harness：
 *
 *  · **B-1 两时刻 DOM 快照比对** —— `snapshotDom`（浏览器内取快照）+
 *    `diffDomSnapshots`（纯函数逐行比对）+ `probeDomChange`（改一个输入、
 *    **不点任何按钮**，轮询断言「结果 DOM 在 N ms 内变了/没变」）。
 *    快照口径：文档序逐元素一行 `深度|tag#testid.cls|状态属性|直接文本`；
 *    状态属性 = 表单元素的 value/checked + 一小撮 ARIA/data 状态位（见函数内清单）。
 *    ⚠ 比对是**多重集合**语义：两行完全相同的内容互换顺序判「没变」——
 *    用户眼里那本来就不是变化；要咬「顺序」的门请另立口径，别把它塞进这里。
 *    ⚠ 快照根必须选**结果区**（如「影响带」），避开时钟/动画区 ——
 *    含时钟的根每次采样都不同，「变了」恒真，判据失效。
 *
 *  · **B-4·U8 「A 盖住了 B 的哪一部分」** —— `measureOcclusion`（浏览器内）+
 *    `probeOcclusion`（Node 侧包装）。判定走 `document.elementsFromPoint`：
 *    它原生就是「z-order × 命中测试」，不是拿两个矩形算相交 ——
 *    矩形相交答的是「有没有重叠」，本探针答的是「**目标矩形上哪些采样点的
 *    最上层元素不是目标自己**」，并按遮挡者分组报出：盖住百分之几、
 *    盖住的是哪块区域（九宫格方位 + coverRect 像素框）、是谁盖的。
 *    ⚠ 口径边界（写死，免得改回去）：`pointer-events:none` 的浮层
 *    `elementsFromPoint` 打不到 ⇒ 判「没盖住」。这不是漏洞是定义：
 *    点都点不穿的层不挡交互；纯视觉遮挡（透明遮罩）不在本探针射程。
 *
 * 两条能力的金丝雀与真页面接线**共用这几个函数本尊**（金丝雀走 `probeHtml`
 * 喂一段 HTML 进同一个浏览器、跑同一个函数），不许另抄一份判定逻辑。
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
 * 打开一页、登录、SPA 内导航到目标路由、等版面稳定 —— **然后把活着的 page 交给调用方**。
 *
 * ⚠ 「等版面稳定」不是 sleep 一个拍脑袋的秒数：连采两次，文本元素数**两次相同**才算稳
 *   （CLAUDE.md 铁律 1「凭一次快照下结论」的同源纪律）。超时仍不稳 ⇒ 抛 ProbeBroken ⇒ RC=2。
 *
 * 拆出本函数的来历（WO-GATE-B-BROWSER-HARNESS）：B-1/B-4·U8 两条探针要在**同一个
 * 已稳定的页面会话**上接着操作（改输入 / 采遮挡点），而 `renderAndMeasure` 量完就关页。
 * 调用方拿 `ctx.page` 跑完自己的探针后**必须自己 `ctx.page.close()`**。
 */
export async function openStablePage(browser, spec) {
  const { baseUrl, route, viewport, rootSelector, login, settleMs = 900, stableTries = 20 } = spec;
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  // 在飞请求台账 —— 「版面稳定」的第三条判据（见下「三次采样相同」段）。
  // 用 Set 尺寸做真相源（不用 started/finished 计数差：监听器挂在 goto 之前，
  // 早于此的请求会让计数差失真，Set 不会）。
  const inflight = new Set();
  page.on("request", (r) => inflight.add(r.url()));
  page.on("requestfinished", (r) => inflight.delete(r.url()));
  page.on("requestfailed", (r) => inflight.delete(r.url()));
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
    //
    // ⚠ 2026-08-18 再加第三条：**在飞请求必须为 0**（WO-GATE-B-BROWSER-HARNESS 实测）。
    //   「空壳静止」还有一个一层楼上的版本：sim-sandbox 在 1280×800 下分**两波**到达 ——
    //   t≈4s 先到 266 个文本元素（静止、且 ≥ 下限 12 ⇒ 旧两条全过），t≈6s 第二波才到 630。
    //   高载机器上两波间隔 > 1 个采样间隔时，旧判据把 266 当稳定态收下，整页量数全是错的
    //   （bodyFontPx 12/13 错、C2 守恒误报「疑似删内容」）。
    //   实测同一条轨迹的在飞请求数：266 期间恒 ≥2，真稳定（630）后恒 0 ——
    //   「在飞=0」把这个陷阱**确定性**地堵死，不靠加采样次数赌波间隔。
    let last = null;
    let stable = null;
    const trace = [];
    for (let i = 0; i < stableTries; i++) {
      const cur = await page.evaluate(measureLayout, { rootSelector });
      trace.push(cur.ok ? `textEls=${cur.textEls}/在飞${inflight.size}` : `未命中(${cur.reason})`);
      if (
        cur.ok &&
        cur.textEls >= TEXT_ELS_FLOOR &&
        last?.ok &&
        last.textEls === cur.textEls &&
        last.firstScreenCtrls === cur.firstScreenCtrls &&
        inflight.size === 0
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
          : inflight.size > 0
            ? `版面在 ${stableTries} 次采样内未稳定（末次仍有 ${inflight.size} 个请求在飞 —— 内容还在路上，不是页面坏了就是机器太慢）。`
            : `版面在 ${stableTries} 次采样内未稳定。`;
      throw new ProbeBroken(
        `${why}\n   采样轨迹：${trace.join(" → ")}` +
          `${pageErrors.length ? `\n   页面异常：${pageErrors[0]}` : ""}`,
      );
    }
    stable.pageErrors = pageErrors.slice(0, 3);
    return { page, measurement: stable };
  } catch (e) {
    // 打开/稳定化失败时 page 是本函数的私有资源，自己关；成功后归调用方关。
    await page.close().catch(() => {});
    throw e;
  }
}

/**
 * 打开一页、登录、SPA 内导航到目标路由、等版面稳定，再跑 `measureLayout`。
 * 行为与 `openStablePage` 完全同源（它就是 `openStablePage` + 量完关页）。
 */
export async function renderAndMeasure(browser, spec) {
  const ctx = await openStablePage(browser, spec);
  try {
    return ctx.measurement;
  } finally {
    await ctx.page.close().catch(() => {});
  }
}

/** 金丝雀专用：直接给一段 HTML 渲染并量，走**同一份** `measureLayout`。 */
export async function measureHtml(browser, html, viewport, rootSelector = "body") {
  return probeHtml(browser, html, viewport, (page) => page.evaluate(measureLayout, { rootSelector }));
}

// ───────────────────────────────────────────────────────────────────────────────
// 四 · B-1 两时刻 DOM 快照比对（WO-GATE-B-BROWSER-HARNESS）
// ───────────────────────────────────────────────────────────────────────────────

/**
 * 浏览器内：把 `rootSelector` 下的 DOM 拍成一组**确定性文本行**（文档序、逐元素一行）。
 *
 * ⚠ 这个函数会被 `page.evaluate` 序列化进浏览器，**不许引用模块作用域标识符**。
 *
 * 每行格式：`深度|tag#data-testid.class|状态属性|直接文本`。
 *   · 「直接文本」= 元素自己的文本节点（不替子孙背锅，与 measureLayout 的 ownText 同口径）；
 *   · 「状态属性」= 表单元素的 value/checked + 下方 STATE_ATTRS 清单里存在的位 ——
 *     没有它，「复选框被勾掉」这种**属性态**变化在快照里不可见；
 *   · 类名走 `getAttribute("class")`（SVG 的 className 是 SVGAnimatedString 对象，
 *     见 measureLayout 里 clsOf 的注释，同一坑不踩第二次）。
 *
 * 比对语义见 `diffDomSnapshots`：多重集合，**行序不参与**。
 */
export function snapshotDom(opts) {
  const rootSel = opts?.rootSelector;
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return { ok: false, reason: `快照根未命中：${rootSel}` };
  // 状态位清单（只记**存在**的）：折叠开合 / 按压选中 / 计数徽标 / 禁用态。
  // 清单刻意短 —— 每加一个属性都要能说出「哪类真实变化没它就漏」。
  const STATE_ATTRS = ["open", "aria-expanded", "aria-pressed", "aria-selected", "data-open", "data-count", "disabled"];
  const clsOf = (el) => (el.getAttribute && el.getAttribute("class")) || "";
  const ownText = (el) => {
    let s = "";
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
    return s.trim();
  };
  const lines = [];
  const walk = (el, depth) => {
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute && el.getAttribute("data-testid");
    const cls = clsOf(el).slice(0, 40);
    let state = "";
    if (tag === "input") state = `type=${el.getAttribute("type") || ""},checked=${el.checked},value=${el.value}`;
    else if (tag === "select" || tag === "textarea") state = `value=${el.value}`;
    const attrs = [];
    for (const a of STATE_ATTRS) if (el.hasAttribute && el.hasAttribute(a)) attrs.push(`${a}=${el.getAttribute(a)}`);
    if (attrs.length) state = `${state}${state ? "," : ""}${attrs.join(",")}`;
    const t = ownText(el).slice(0, 60);
    lines.push(
      `${depth}|${tag}${testid ? `#${testid}` : ""}${cls ? `.${cls}` : ""}` +
        `${state ? `|${state}` : ""}${t ? `|${t}` : ""}`,
    );
    for (const k of el.children) walk(k, depth + 1);
  };
  walk(root, 0);
  return { ok: true, count: lines.length, lines };
}

/**
 * 纯函数（Node 侧，可进 vitest）：比两份 `snapshotDom` 的结果。
 *
 * 多重集合语义：逐行计次数，两边次数不同的行就是变化。⚠ **行序不参与** ——
 * 两行完全相同的内容互换位置判「没变」（用户眼里那本来就不是变化）；
 * 但「新增一行与既有行逐字相同的内容」会因为**次数**变了而被咬住。
 * 任一侧快照 `!ok` ⇒ `degraded:true` 且 `changed:true`（比不了不许说「没变」，
 * 那正是「我没找到 ⇒ 它不存在」的病；调用方应先把 `!ok` 升级成 ProbeBroken）。
 */
export function diffDomSnapshots(a, b) {
  if (!a?.ok || !b?.ok) {
    return {
      changed: true,
      degraded: true,
      reason: `有一侧快照不可用（before.ok=${!!a?.ok} after.ok=${!!b?.ok}）——比不了，不许读作「没变」。`,
      added: [],
      removed: [],
    };
  }
  const tally = new Map();
  for (const l of a.lines) tally.set(l, (tally.get(l) || 0) + 1);
  const added = [];
  for (const l of b.lines) {
    const c = tally.get(l) || 0;
    if (c === 0) added.push(l);
    else tally.set(l, c - 1);
  }
  const removed = [];
  for (const [l, c] of tally) for (let i = 0; i < c; i++) removed.push(l);
  return { changed: added.length > 0 || removed.length > 0, degraded: false, added, removed, beforeCount: a.count, afterCount: b.count };
}

/**
 * Node 侧驱动：**改一个输入（不点任何按钮），断言结果 DOM 在 `timeoutMs` 内变了/没变**。
 *
 *   · `act(page)` 由调用方给（改输入的动作；本函数不规定怎么改）；
 *   · 轮询用同一份 `snapshotDom` + `diffDomSnapshots`，命中即返回 `elapsedMs`；
 *   · 快照根未命中 / act 抛错 ⇒ `ProbeBroken`（门找不到它要操作的东西 = 工具坏了，
 *     与「扫描根未命中」同一条处置线），**绝不**读作「页面没变」。
 *
 * 返回 `{ changed, elapsedMs, diff, before, after }` —— `diff.added/removed`
 * 就是「哪里变了」的行级证据，报文不许只说「变了/没变」。
 */
export async function probeDomChange(page, spec) {
  const { rootSelector, act, timeoutMs = 5000, pollMs = 100 } = spec;
  if (typeof act !== "function") throw new ProbeBroken("probeDomChange 缺 act(page) —— 门没说清要改哪个输入。");
  const before = await page.evaluate(snapshotDom, { rootSelector });
  if (!before.ok) throw new ProbeBroken(`B-1 快照根未命中（动作前）：${before.reason}`);
  let after = before;
  try {
    await act(page);
  } catch (e) {
    throw new ProbeBroken(`B-1 改输入的动作执行失败（门够不到它要改的输入）：${String(e?.message || e).split("\n")[0]}`);
  }
  // ⚠ 时钟从「输入改完」起算，不从「act 开始」起算：act 自身的耗时（高载机器上
  //   playwright 的可操作性等待实测可到 3s+）不是页面的反应时间，算进去会把
  //   「机器慢」误判成「页面不响应」（本单实测栽到过一次，10s 动作超时撞线）。
  const t0 = Date.now();
  for (;;) {
    after = await page.evaluate(snapshotDom, { rootSelector });
    if (!after.ok) throw new ProbeBroken(`B-1 快照根未命中（动作后）：${after.reason}`);
    const diff = diffDomSnapshots(before, after);
    const elapsedMs = Date.now() - t0;
    if (diff.changed) return { changed: true, elapsedMs, diff, before, after };
    if (elapsedMs >= timeoutMs) return { changed: false, elapsedMs, diff, before, after };
    await page.waitForTimeout(pollMs);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// 五 · B-4·U8 遮挡判定：「A 盖住了 B 的哪一部分」（WO-GATE-B-BROWSER-HARNESS）
// ───────────────────────────────────────────────────────────────────────────────

/**
 * 浏览器内：量「`targetSelector` 这个目标**被谁、盖住了哪一块**」。
 *
 * 判定不走「两个矩形算相交」—— 那只能答「有没有重叠」，答不了「谁在上面」。
 * 走 `document.elementsFromPoint(x, y)`：它原生就是 **z-order × 命中测试**，
 * 返回该点上**从最顶层往下**的元素栈。目标矩形上撒采样网格，
 * 逐点问「最上层是不是目标自己（或目标的子孙）」：不是 ⇒ 这一点被盖住了，
 * 盖住它的就是栈顶那个元素。按遮挡者分组汇总：
 *   · `pct` —— 该遮挡者盖住的采样点占比；
 *   · `cells` —— 盖在目标的哪个**九宫格方位**（上/中/下 × 左/中/右）；
 *   · `coverRect` —— 被盖采样点的像素包围盒（相对视口）。
 *
 * ⚠ 口径边界（见文件头）：`pointer-events:none` 的层打不到 ⇒ 不算盖（点不穿 = 不挡交互）。
 * ⚠ 采样是离散的：比网格步长还细的遮挡条会漏。步长 ≈ 目标宽/40、高/30（≥4px），
 *   对「浮层/抽屉挡不挡」这个量级的问题足够；要审 1px 描边请换工具。
 */
export function measureOcclusion(opts) {
  const targetSel = opts?.targetSelector;
  const el = targetSel ? document.querySelector(targetSel) : null;
  if (!el) return { ok: false, reason: `遮挡目标未命中：${targetSel}` };
  // 先把目标**瞬时**滚进视口（behavior 默认 auto，无动画、不等待）。
  // 不做这一步，「目标在视口外 ⇒ 采样 0 点」会与「没被盖」混为一谈 ——
  // 而「在视口外」根本不是「没遮挡」的证据（本单实测：sim-sandbox 主画布在
  // 1440×900 下位于 y=1454，不滚一下连问都问不了）。
  el.scrollIntoView({ block: "center", inline: "nearest" });
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) {
    return { ok: false, reason: `遮挡目标不可见（矩形 ${Math.round(r.width)}×${Math.round(r.height)}）：${targetSel}` };
  }
  const clsOf = (n) => (n.getAttribute && n.getAttribute("class")) || "";
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const stepX = Math.max(4, r.width / 40);
  const stepY = Math.max(4, r.height / 30);
  const ROWS = ["上", "中", "下"];
  const COLS = ["左", "中", "右"];
  const byOccluder = new Map();
  let sampled = 0;
  let skipped = 0;
  for (let y = r.top + stepY / 2; y < r.bottom; y += stepY) {
    for (let x = r.left + stepX / 2; x < r.right; x += stepX) {
      if (x < 0 || y < 0 || x >= VW || y >= VH) {
        skipped++;
        continue;
      }
      sampled++;
      const stack = document.elementsFromPoint(x, y);
      const top = stack && stack[0];
      if (!top) continue;
      if (top === el || el.contains(top)) continue; // 最上层是目标自己/其子孙 ⇒ 没被盖
      const cy = Math.min(2, Math.floor(((y - r.top) / r.height) * 3));
      const cx = Math.min(2, Math.floor(((x - r.left) / r.width) * 3));
      // 存「行×3+列」的序号而不是标签 —— 标签按码点排序会出「上/下/中」这种错序
      // （本单实测被金丝雀当场咬住：上右/下右/中右），按序号排才是阅读序。
      const cellIdx = cy * 3 + cx;
      let rec = byOccluder.get(top);
      if (!rec) {
        const or = top.getBoundingClientRect();
        rec = {
          tag: top.tagName.toLowerCase(),
          id: top.id || "",
          testid: (top.getAttribute && top.getAttribute("data-testid")) || "",
          cls: clsOf(top).slice(0, 60),
          rect: { x: Math.round(or.x), y: Math.round(or.y), w: Math.round(or.width), h: Math.round(or.height) },
          pts: 0,
          cells: new Set(),
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
        };
        byOccluder.set(top, rec);
      }
      rec.pts++;
      rec.cells.add(cellIdx);
      if (x < rec.minX) rec.minX = x;
      if (y < rec.minY) rec.minY = y;
      if (x > rec.maxX) rec.maxX = x;
      if (y > rec.maxY) rec.maxY = y;
    }
  }
  if (sampled === 0) return { ok: false, reason: `遮挡目标完全在视口外（采样 0 点）：${targetSel}` };
  let covered = 0;
  const occluders = [...byOccluder.values()]
    .map((o) => {
      covered += o.pts;
      return {
        tag: o.tag,
        id: o.id,
        testid: o.testid,
        cls: o.cls,
        rect: o.rect,
        pts: o.pts,
        pct: Math.round((o.pts / sampled) * 1000) / 10,
        cells: [...o.cells]
          .sort((a, b) => a - b)
          .map((i) => {
            const cy = Math.floor(i / 3);
            const cx = i % 3;
            return cx === 1 && cy === 1 ? "正中" : `${ROWS[cy]}${COLS[cx]}`;
          }),
        coverRect: {
          x: Math.round(o.minX),
          y: Math.round(o.minY),
          w: Math.round(o.maxX - o.minX),
          h: Math.round(o.maxY - o.minY),
        },
      };
    })
    .sort((a, b) => b.pts - a.pts);
  return {
    ok: true,
    target: {
      selector: targetSel,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    },
    sampled,
    skipped,
    coveredPts: covered,
    coverPct: Math.round((covered / sampled) * 1000) / 10,
    occluders,
  };
}

/** Node 侧包装：在活着的 page 上跑 `measureOcclusion`，目标未命中 ⇒ ProbeBroken。 */
export async function probeOcclusion(page, spec) {
  const m = await page.evaluate(measureOcclusion, { targetSelector: spec.targetSelector });
  if (!m.ok) throw new ProbeBroken(`B-4·U8 遮挡探针：${m.reason}`);
  return m;
}

/**
 * 金丝雀共用入口：喂一段 HTML 进同一个浏览器，把活着的 page 交给 `fn(page)` 跑探针。
 * 金丝雀与真页面**走同一批 probe 函数**（probeDomChange / probeOcclusion / measureLayout），
 * 靠的就是这个入口 —— 不许在金丝雀里另抄判定逻辑（抄了就是装饰品，CLAUDE.md 铁律 0.6）。
 */
export async function probeHtml(browser, html, viewport, fn) {
  const page = await browser.newPage({ viewport });
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}
