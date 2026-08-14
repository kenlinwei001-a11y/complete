#!/usr/bin/env node
/**
 * 门 `text-legibility:check` · **屏上可读性门**（WO-R9-CONTRAST）
 *
 * ══ 病因（仓主 2026-08-14 截屏实测：「推演沙盘上的文字与背景色反差太低，读不了」）════
 *
 * 真浏览器逐元素量下来（`/v/sim-sandbox`，真后端，422 个含文本元素），最刺眼的一组是：
 *
 *   `rgb(155,169,183)` on `rgb(44,61,94)` = **4.52:1** · 字号 **9 / 10 / 14px** · **16 个元素**
 *   （= `--muted2 #9ba9b7` 压在 `--panel #2c3d5e` 上）
 *
 * **这 16 个元素是"通过"WCAG AA 的**（阈值 4.5，实测 4.52 ≥ 4.5），而仓主实拍就是读不了。
 * 因为它们是 **9–10px 的中文**：WCAG 的 4.5 是给**正文尺寸的拉丁字母**定的，
 * 它**根本没有把字号写进公式**（只有一个"大字 ≥18pt 可放宽到 3:1"的单向豁免）。
 *
 * ⇒ **一道只查 WCAG 数值的门，会把这一整类全部放过去。**
 *   形态照 CLAUDE.md 铁律 0.6：**「我用『WCAG 数值达标』当作『屏上读得了』的证据，而前者并不度量后者。」**
 *   这正是本仓「纸面达标、屏上不可用」的又一实例 —— 信号是真的，只是它不指向我要断言的那个对象。
 *
 * **令牌本身不是元凶**（先量过：`--txt` 10.96 · `--muted` 6.77 · `--muted2` 5.33，对 `--bg` 都过）。
 * 元凶是 **`--muted2` × 9–10px** 这个**组合**，以及**最亮的那个面**（`--panel`，不是 `--bg`）。
 * 所以修法不是"把令牌调亮一点了事"——本门的判据必须**同时吃对比度与字号**。
 *
 * ══ 判据 A · 尺寸加权对比度（本门的公式 · **零自由参数**）══════════════════════
 *
 *     required(S, w) = max( 3.0 , 72 / S_eff )
 *     S_eff = S × (w ≥ 700 ? 24/18.66 : 1)
 *
 * **两个锚点全部来自 WCAG 2.1 自己，不是我拍的**：
 *   ① SC 1.4.3 正文阈值 **4.5:1**。它没写"正文是多大"，本门取**浏览器默认正文尺寸 16px**
 *      （CSS `font-size: medium`）—— 这是外部既成事实，不是本门的自由参数。
 *   ② 同一条 SC 的**大字**豁免：≥18pt（**24px**）常规字放宽到 **3.0:1**。
 *   由 4.5 = k/16 与 3.0 = k/24 联立 ⇒ **k = 72，且指数恰好是 1**。
 *   两式相容本身就是这条反比律的证据：若真实关系不是反比，这两点解不出同一个 k。
 *   ③ 粗体折算同样来自 WCAG：大字豁免对**粗体**只要 14pt（**18.66px**）。
 *      即"粗体 18.66px ≡ 常规 24px"⇒ 粗体等效放大 24/18.66 = **1.2862**。
 *
 * 于是本门**不与 WCAG 冲突，而是把它的阶跃函数补成连续曲线并向小字外推**：
 *   16px → 4.5（WCAG 正文，逐值相同）    24px → 3.0（WCAG 大字，逐值相同）
 *   12px → 6.0    11px → 6.55    10px → **7.2**    9px → **8.0**
 * 那 16 个 4.52@9–10px 的元素，在这条曲线下**当场判红**（需 7.2–8.0，实得 4.52）。
 *
 * ⚠ **诚实边界（本门做不到什么，不许当成"可读性已被证明"）**：
 *  · **16px 这个锚是「取」的不是「算」的**。WCAG 没写正文参照尺寸，本门取浏览器默认值 16px。
 *    若取 14px，则 k=63，整张阈值表等比下调 12.5%（10px 要 6.3 而非 7.2）。
 *    这是本公式**唯一**一处判断，写在这里让人可以直接反对它，而不是藏在代码里。
 *  · **反比律是从两点外推的**。24px→16px 区间内它是**内插**（有 WCAG 两端背书），
 *    12px 以下是**外推**，没有 WCAG 背书。外推方向与 APCA（WCAG 3 草案，把字号/字重
 *    写进查表）一致——小字要更高对比——但本门不声称复现了 APCA 的数值。
 *  · 本门算的是**颜色对比度**，不是**笔画对比度**。中文 9–10px 时笔画会与抗锯齿糊在一起，
 *    那部分损失**本公式测不到**（判据 B 就是为此存在的，见下）。
 *
 * ══ 判据 B · 字号硬底（CJK 笔画密度 · 为什么必须有第二条）════════════════════
 *
 * 判据 A 是**颜色**判据：它假定"提高对比度总能补回来"。对 9–10px 的中文，这个假定是假的——
 * 而且可以**在本仓的调色板上现算出来**（不是感觉）：
 *
 *   暗色最亮面 `--panel #2c3d5e` 上，三级文本令牌的可用窗口是 **4.52 – 9.30**。
 *   判据 A 在 10px 要 **7.2**。让三级文本（`--muted2`）达到 7.2 需要中性灰 **#d3d3d3**，
 *   而二级文本（`--muted`）当时的等效灰只有 **~#bbb** ⇒ **三级会比二级更亮，层级当场反转。**
 *
 * ⇒ **10px 及以下的中文正文，在本调色板内无解**：唯一的修法是**升字号**，不是调颜色。
 *   本门因此把它变成一条独立的硬判据：`font-size < 12px` 即计一条（FLOOR = 12px）。
 *   12px 是判据 A 与调色板的**交点**：required(12) = 6.0，而三级文本在 6.05 时
 *   仍能与二级（7.6）、一级（9.3）拉开可辨的档（等效灰 194 / 211 / 236）。
 *   **FLOOR 不是又一个自由参数，是 A 的推论**：换调色板 ⇒ 交点自己会动。
 *
 * ⚠ **诚实边界**：本门是**静态 CSS/TSX** 扫描，**看不见文字内容**，因此**分不出中文与拉丁**。
 *   于是它按尺寸一刀切 —— **比命题严**（纯数字/拉丁的微标签也被咬）。这是**刻意的保守方向**：
 *   宁可多报，也不要因为"猜不出是不是中文"而漏掉一整类。
 *
 * ══ 判据 C · 令牌矩阵（**无基线，必须绿** · 本门唯一"精确"的那一条）════════════
 *
 * A/B 是**站点级**判据，靠静态解析近似（见下"三条测不准"）。C 不靠任何近似：
 * 它把 `tokens.css` 里**声明过的**「文字令牌 × 表面令牌」逐对拿出来，
 * 在**三套主题各自的**取值下算对比度，要求 ≥ required(FLOOR)。
 * 这一条是**完全的**：没有推断、没有代理指标、没有"可能被别的规则覆盖"。
 * 它守住的正是本次事故的根 —— **调色板本身在最亮的那个面上就不够用**。
 *
 * ══ 三条测不准（A/B 的静态近似 · 必须写明，否则本门会被当成"全量证明"）════════
 *  ① **底色靠"最差面"代替真实层叠**。一个 `color` 落在哪个背景上，是渲染期的事实，
 *     源码里不存在。本门对每个文字色取**该主题所有表面令牌里最差的那一个**（min 对比度）。
 *     偏保守。真实层叠里叠了半透面的情形本门吃不到 —— 那部分靠真浏览器测量（见交付报告）。
 *  ② **只判"同一个声明块里同时写了 color 与 font-size"的单元**。只写其一的块，
 *     另一半靠继承，静态判不了。本门把这类计入 `unjudged` 并**报数**，不据此红。
 *  ③ **`currentColor` / `inherit` / 未定义 var 一律跳过**（同样进 `unjudged`）。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑 · 双向）═══════════════════════════════
 * 开扫之前先拿**内嵌样例**过一遍 `judgeUnit()` / `requiredContrast()` / `contrast()`
 * —— **与主逻辑同一份实现，不另抄一份公式**（抄一份 = 装饰品：改主公式时金丝雀拿旧的去测、
 * 照样绿。本仓 2026-08-08 实测过）。**双向**：
 *   · 合成一个「明显不可读」的样例 ⇒ **必须被咬**
 *   · 合成一个「明显可读」的样例   ⇒ **必须放行**
 * 只做前者的门会奖励"把阈值调到 0"；只做后者的门根本不会红。
 * 任一不中 ⇒ 打印「⛔ 门自己瞎了」并 **RC=2**，而**不是**安静报「代码干净」。
 *
 * ══ 退出码（三分，不许合并）════════════════════════════════════════════════
 *   0 = 干净 · 1 = 真违规（棘轮被顶高 / 令牌矩阵不达标）· 2 = **工具自己坏了**
 * **RC=1 只有一条路径：`gate()` 明确 `return 1`。** 其余一切失败（tokens.css 读不出 /
 * 基线坏了 / 主题解析不出 / 任何未预期异常）统统走 `toolBroken()` ⇒ RC=2。
 * 理由见 `docs/SOP-reviewer-claim-discipline.md` §3 与断点 `G-GATE-RC1-MASQUERADE`：
 * node 对未捕获异常一律退 1，恰好撞上「真有问题」这个码，于是「门根本没跑起来」
 * 会被读成「你的代码有问题」，方向正好相反。
 *
 * 本体登记：`docs/SYSTEM-ONTOLOGY.md` §7 / §8 断点 `G-TEXT-ILLEGIBLE-SMALL-CJK`。
 * 门账：`scripts/gate-ledger.json`（binding=GATES_CHAIN）。
 *
 * 用法：
 *   node scripts/check-text-legibility.mjs              # 门（棘轮比对）
 *   node scripts/check-text-legibility.mjs --selftest   # 只跑金丝雀 + 退出码契约双向机验
 *   node scripts/check-text-legibility.mjs --census     # 普查表
 *   node scripts/check-text-legibility.mjs --matrix     # 令牌矩阵（三套主题逐对现算）
 *   node scripts/check-text-legibility.mjs --update     # 重写基线（需人工核 why）
 *   node scripts/check-text-legibility.mjs --explain <file>
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生（`--selftest` 双向机验）。
 * 守门的门：scripts/check-gate-exit-discipline.mjs。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-text-legibility.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 文字都读得了」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SRC = "apps/frontend-shell/src";
const TOKENS = join(ROOT, SRC, "styles/tokens.css");
const BASELINE = join(ROOT, "scripts/text-legibility-baseline.json");

/** **RC=2 的唯一出口** —— 「我没能扫描」与「代码有问题」必须是两个不同的退出码。 */
function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「无违规 / 文字都读得了 / 代码干净」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 · 判据本体（三处共用这一份：门 / 金丝雀 / 真浏览器测量脚本）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** WCAG 正文阈值的参照尺寸 —— 浏览器默认正文尺寸（CSS `font-size: medium`）。 */
export const WCAG_BODY_PX = 16;
/** WCAG SC 1.4.3 正文阈值。 */
export const WCAG_BODY_RATIO = 4.5;
/** WCAG SC 1.4.3 大字阈值（≥18pt = 24px 常规 / ≥14pt = 18.66px 粗体）。 */
export const WCAG_LARGE_RATIO = 3.0;
export const WCAG_LARGE_PX = 24;
export const WCAG_LARGE_BOLD_PX = 18.66;
/** 由上面两点联立得到的常数：k = 4.5×16 = 3.0×24 = 72。**两式相容 ⇒ 指数为 1。** */
export const K = WCAG_BODY_RATIO * WCAG_BODY_PX;
/** 粗体等效放大：WCAG 自己的大字双阈值之比。 */
export const BOLD_GAIN = WCAG_LARGE_PX / WCAG_LARGE_BOLD_PX;
/** CJK 字号硬底（判据 B）。**不是自由参数**：见文件头，它是判据 A 与本仓调色板的交点。 */
export const FLOOR_PX = 12;

/**
 * **尺寸加权对比度阈值** —— 本门的判据本体。金丝雀、门、真浏览器测量脚本共用这一个函数。
 * @param {number} sizePx  CSS 像素字号
 * @param {number} weight  font-weight 数值（默认 400）
 */
export function requiredContrast(sizePx, weight = 400) {
  if (!(sizePx > 0)) return NaN;
  const eff = sizePx * (weight >= 700 ? BOLD_GAIN : 1);
  return Math.max(WCAG_LARGE_RATIO, K / eff);
}

/* ── 颜色 ────────────────────────────────────────────────────────────────── */
const NAMED = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], transparent: null,
};
/** 解析成 {r,g,b,a}；解析不了返回 null（调用方须当"判不了"处理，不许当"合格"）。 */
export function parseColor(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  if (t in NAMED) return NAMED[t] ? { r: NAMED[t][0], g: NAMED[t][1], b: NAMED[t][2], a: 1 } : null;
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4)
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 };
    if (h.length === 6 || h.length === 8)
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    return null;
  }
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
  }
  return null;
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
/** WCAG 2.x 相对亮度对比度。 */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** 半透前景叠在不透明底上。 */
export function composite(fg, bg) {
  const a = fg.a ?? 1;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/**
 * **单元判据** —— 一个「文字色 × 底色集合 × 字号 × 字重」判红/绿。
 * 单独抽出来是为了让**判据本身**也能被金丝雀咬（本仓踩过「检测器绿、判据写反」的坑）。
 * @returns {{red:boolean, got:number, need:number, worst:string}|null}  null = 判不了
 */
export function judgeUnit({ color, backgrounds, sizePx, weight = 400 }) {
  const fg = typeof color === "string" ? parseColor(color) : color;
  if (!fg || !(sizePx > 0) || !backgrounds || !backgrounds.length) return null;
  const need = requiredContrast(sizePx, weight);
  let got = Infinity, worst = "";
  for (const [name, bgRaw] of backgrounds) {
    const bg = typeof bgRaw === "string" ? parseColor(bgRaw) : bgRaw;
    if (!bg) continue;
    const solidBg = (bg.a ?? 1) >= 1 ? bg : composite(bg, { r: 255, g: 255, b: 255, a: 1 });
    const c = contrast(composite(fg, solidBg), solidBg);
    if (c < got) { got = c; worst = name; }
  }
  if (!Number.isFinite(got)) return null;
  return { red: got + 1e-9 < need, got: +got.toFixed(2), need: +need.toFixed(2), worst };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 · 主题模型 —— 从 tokens.css 现读，**不写死任何令牌值**
 *     （写死 = 改了 tokens.css 而门拿旧值去测，正是本仓反复点名的"过期的自证数字"）
 * ═══════════════════════════════════════════════════════════════════════════ */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * 从一段 CSS 里取出**选择器完全等于** `selector` 的那个块的自定义属性。
 *
 * ⚠ 这里踩过两个坑，都是本门自己的金丝雀当场抓出来的（不是人想起来的）：
 *   ① 用 `css.indexOf(":root {")` 找块 —— 写成 `:root{`（无空格）就找不到，返回 null，
 *      而 null 会被上层读成「解析不出主题」。判据必须落在**规范化后的选择器**上，不是字面串。
 *   ② `indexOf(":root")` 会先命中 `:root[data-theme="light"]` 里的 `:root` 前缀 ——
 *      于是「暗色表」实际读的是浅色块。**前缀匹配不是相等匹配。**
 */
function blockVars(css, selector) {
  const want = selector.replace(/\s+/g, "").replace(/'/g, '"');
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) return null;
    const sel = css.slice(i, open).replace(/\s+/g, "").replace(/'/g, '"');
    let depth = 0, end = -1;
    for (let j = open; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) return null;
    if (sel === want) {
      const out = new Map();
      for (const m of css.slice(open + 1, end).matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
      return out;
    }
    i = end + 1;
  }
  return null;
}

/** 三套主题的令牌表：light/warm 在 :root 之上做加性覆盖（与 tokens.css 的写法一致）。 */
export function buildThemes(tokensCss) {
  const css = stripComments(tokensCss);
  const base = blockVars(css, ":root");
  if (!base || base.size < 10) return null; // 调用方报 RC=2
  const themes = { dark: new Map(base) };
  for (const [name, sel] of [["light", ':root[data-theme="light"]'], ["warm", ':root[data-theme="warm"]']]) {
    const over = blockVars(css, sel);
    if (!over) return null;
    const m = new Map(base);
    for (const [k, v] of over) m.set(k, v);
    themes[name] = m;
  }
  return themes;
}

/** `var(--x)` / `var(--x, fb)` / 字面色 → {r,g,b,a}；解析不了返回 null。 */
export function resolveColor(expr, vars, depth = 0) {
  if (!expr || depth > 6) return null;
  const t = String(expr).trim();
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([\s\S]+))?\)$/.exec(t);
  if (m) {
    const v = vars.get(m[1]);
    if (v != null) return resolveColor(v, vars, depth + 1);
    return m[2] != null ? resolveColor(m[2], vars, depth + 1) : null;
  }
  return parseColor(t);
}

/**
 * 表面令牌 —— 文字可能落在的**不透明**面。判据 A 对每个文字色取这一组里**最差**的那个。
 * `--panel-glass` 在暗色是半透 veil（叠在 --bg 上），这里用合成后的实际面参与比较。
 */
const SURFACE_TOKENS = ["--bg", "--bg2", "--panel", "--panel2", "--popover-surface"];

/** 判据 C 的配对表 —— 哪个文字令牌该在哪些面上达标。**显式声明，可被人直接反对。** */
const TEXT_TOKENS = [
  "--txt", "--muted", "--muted2",
  "--accent-txt", "--ok-txt", "--warn-txt", "--amber-txt", "--danger-txt",
  "--c-factory-txt", "--c-product-txt", "--c-process-txt", "--c-equip-txt", "--c-people-txt",
  "--c-quality-txt", "--c-capacity-txt", "--c-forecast-txt", "--c-solver-txt", "--c-agent-txt",
];
/**
 * 特例对 —— 文字不落在"页面表面"上，而落在一块**实心色**上。
 * `over` 表示该背景本身是半透/渐变，需要先叠在某个面上。
 */
const SPECIAL_PAIRS = [
  { fg: "--on-accent", bg: "--accent-solid", why: "实心 accent 底上的白字（主按钮 / 分段控件选中态）" },
  { fg: "--nav-active-txt", bg: "--nav-active-bg", over: "--panel2", why: "活动导航项文字" },
];

/** 从可能是渐变的值里取出所有色停，逐个叠在 over 上，返回 [name, color] 数组。 */
function surfacesFromValue(name, value, vars, overColor) {
  const out = [];
  const raw = String(value ?? "");
  const stops = [...raw.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g)].map((m) => m[0]);
  const list = stops.length ? stops : [raw];
  for (const s of list) {
    const c = resolveColor(s, vars);
    if (!c) continue;
    out.push([name, (c.a ?? 1) >= 1 || !overColor ? { ...c, a: 1 } : composite(c, overColor)]);
  }
  return out;
}

/** 该主题下所有不透明表面（判据 A/B 用）。 */
export function surfacesOf(vars) {
  const out = [];
  const bg = resolveColor(vars.get("--bg"), vars) || { r: 255, g: 255, b: 255, a: 1 };
  for (const t of SURFACE_TOKENS) {
    const v = vars.get(t);
    if (v == null) continue;
    const c = resolveColor(v, vars);
    if (!c) continue;
    out.push([t, (c.a ?? 1) >= 1 ? { ...c, a: 1 } : composite(c, bg)]);
  }
  const glass = vars.get("--panel-glass");
  if (glass != null) {
    const c = resolveColor(glass, vars);
    if (c) out.push(["--panel-glass", (c.a ?? 1) >= 1 ? { ...c, a: 1 } : composite(c, bg)]);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 · 扫描面 —— CSS 声明块 + TSX 内联 style
 * ═══════════════════════════════════════════════════════════════════════════ */
/** 扫描面规模下界（金丝雀）：真实 CSS 54 个、TSX 200+；掉下界 ⇒ 枚举器坏了，不是文件没了。 */
const MIN_CSS_FILES = 30;
const MIN_TSX_FILES = 120;

function walkFiles(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkFiles(p, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(relative(ROOT, p));
  }
  return out;
}

const PX = (v) => {
  const t = String(v).trim();
  let m = /^(-?[0-9.]+)px$/.exec(t);
  if (m) return parseFloat(m[1]);
  m = /^(-?[0-9.]+)rem$/.exec(t);
  if (m) return parseFloat(m[1]) * 16;
  m = /^(-?[0-9.]+)$/.exec(t);
  if (m) return parseFloat(m[1]);
  return null;
};
const WEIGHT = (v) => {
  const t = String(v ?? "").trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (t === "bold" || t === "bolder") return 700;
  return 400;
};

/**
 * 从一段 CSS 抽出「声明块」单元。每个单元 = { file, line, sel, size, color, weight }。
 * ⚠ 只取**同一个块里同时声明了 color/fill 与 font-size** 的那些（判据 A/B 的可判单元）；
 *   只写其一的进 `unjudged`（诚实边界②）。
 */
export function scanCss(file, raw) {
  const units = [], sizes = [];
  let unjudged = 0;
  const src = stripComments(raw);
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].replace(/\s+/g, " ").trim();
    if (sel.startsWith("@") || !sel) continue; // @media / @keyframes 的外层块，内层块下一轮会被扫到
    const body = m[2];
    const grab = (prop) => {
      const r = new RegExp("(?:^|[;{\\s])" + prop + "\\s*:\\s*([^;]+)", "g");
      let last = null, mm;
      while ((mm = r.exec(body))) last = mm[1].trim();
      return last;
    };
    /*
     * ⚠ **`font:` 简写必须一起吃** —— 这一条不是想出来的，是被真数据当场抖出来的：
     * 本门第一版只认 `font-size:`，于是 `.optSub { font: 9px var(--font-mono) }` 这类
     * **一个字都扫不到**。真浏览器复测时那 22+13 个 9px 元素还在红着，而门报"这些文件干净"——
     * 又一次「我用『font-size 声明数』当作『页面上有多少字号』的证据，而前者并不度量后者」。
     * 本仓 `font:` 简写实测 72 处，全部在 CSS 里，全部带字号 ⇒ 漏掉它等于漏掉一整类。
     */
    const shorthand = grab("font");
    let shSize = null, shWeight = null;
    if (shorthand && !/^(inherit|initial|unset|caption|icon|menu|message-box|small-caption|status-bar)$/i.test(shorthand.trim())) {
      const sm = /(^|\s)([0-9.]+px)(\s*\/\s*[^\s]+)?(\s|$)/.exec(shorthand);
      if (sm) shSize = PX(sm[2]);
      const wm = /(^|\s)(bold|bolder|[1-9]00)(\s|$)/i.exec(shorthand);
      if (wm) shWeight = wm[2];
    }
    const fsRaw = grab("font-size");
    const colorRaw = grab("color") || grab("fill");
    const line = src.slice(0, m.index).split("\n").length;
    const size = fsRaw ? PX(fsRaw) : shSize;
    const weight = WEIGHT(grab("font-weight") ?? shWeight);
    if (size != null && size > 0) sizes.push({ file, line, sel, size });
    if (size != null && size > 0 && colorRaw) units.push({ file, line, sel, size, color: colorRaw, weight });
    else if ((size != null && size > 0) || colorRaw) unjudged++;
  }
  return { units, sizes, unjudged };
}

/**
 * 从 TSX 抽出内联 `style={{ ... }}` 单元。正则法（不引 typescript：本门必须能在
 * 没装依赖的 worktree 上跑；缺依赖时抛异常 ⇒ RC=1 正是 G-GATE-RC1-MASQUERADE 那个坑）。
 */
export function scanTsx(file, raw) {
  const units = [], sizes = [];
  let unjudged = 0;
  const src = raw;
  const re = /style=\{\{([\s\S]{0,600}?)\}\}/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    const line = src.slice(0, m.index).split("\n").length;
    const fs = /fontSize\s*:\s*("([^"]+)"|'([^']+)'|([0-9.]+))/.exec(body);
    const col = /(?:^|[,{\s])color\s*:\s*("([^"]*)"|'([^']*)')/.exec(body);
    const fw = /fontWeight\s*:\s*("([^"]+)"|'([^']+)'|([0-9]+))/.exec(body);
    /*
     * ⚠ 内联 `font:` **简写**同样要吃 —— 与 CSS 那条同源，但**必须单独写一遍**，
     * 因为 React 的内联样式键是 `font`（驼峰域里没有 `font-size` 这个写法）。
     * 这一条也是被真数据抖出来的：`SandboxView.tsx` 顶栏那三处
     * `style={{ font: "600 10px var(--font-mono)" }}` —— 屏上确确实实是 10px，
     * 而门只找 `fontSize`，**一处都扫不到**，于是报"这个文件干净"。
     * 同一个病在 CSS 侧刚犯过一次（`font: 9px …`），这是它的第二个马甲。
     */
    const shHand = /(?:^|[,{\s])font\s*:\s*("([^"]+)"|'([^']+)')/.exec(body);
    const shVal = shHand ? (shHand[2] ?? shHand[3]) : null;
    let shSize = null, shWeight = null;
    if (shVal) {
      const sm = /(^|\s)([0-9.]+px)(\s*\/\s*[^\s]+)?(\s|$)/.exec(shVal);
      if (sm) shSize = PX(sm[2]);
      const wm = /(^|\s)(bold|bolder|[1-9]00)(\s|$)/i.exec(shVal);
      if (wm) shWeight = wm[2];
    }
    const size = fs ? PX(fs[2] ?? fs[3] ?? fs[4]) : shSize;
    if (size != null && size > 0) sizes.push({ file, line, sel: "style={{…}}", size });
    const color = col ? (col[2] ?? col[3]) : null;
    if (size != null && size > 0 && color) units.push({ file, line, sel: "style={{…}}", size, color, weight: WEIGHT(fw ? (fw[2] ?? fw[3] ?? fw[4]) : shWeight) });
    else if ((size != null && size > 0) || color) unjudged++;
  }
  return { units, sizes, unjudged };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 · 判据 C：令牌矩阵
 * ═══════════════════════════════════════════════════════════════════════════ */
export function judgeMatrix(themes) {
  const rows = [], fails = [];
  const need = requiredContrast(FLOOR_PX, 400);
  for (const [theme, vars] of Object.entries(themes)) {
    const surfaces = surfacesOf(vars);
    for (const tk of TEXT_TOKENS) {
      const v = vars.get(tk);
      if (v == null) { fails.push(`【C 令牌矩阵】${theme}：文字令牌 ${tk} 未定义（配对表要求它存在）`); continue; }
      const r = judgeUnit({ color: resolveColor(v, vars), backgrounds: surfaces, sizePx: FLOOR_PX });
      if (!r) { fails.push(`【C 令牌矩阵】${theme}：${tk} = \`${v}\` 解析不出颜色`); continue; }
      rows.push({ theme, token: tk, ...r });
      if (r.red) fails.push(`【C 令牌矩阵】${theme} ${tk} 在最差面 ${r.worst} 上仅 ${r.got}:1，${FLOOR_PX}px 需 ${r.need}:1`);
    }
    for (const sp of SPECIAL_PAIRS) {
      const fgv = vars.get(sp.fg), bgv = vars.get(sp.bg);
      if (fgv == null || bgv == null) { fails.push(`【C 令牌矩阵】${theme}：特例对 ${sp.fg} on ${sp.bg} 缺令牌定义`); continue; }
      const overColor = sp.over ? resolveColor(vars.get(sp.over), vars) : null;
      const bgs = surfacesFromValue(sp.bg, bgv, vars, overColor);
      const r = judgeUnit({ color: resolveColor(fgv, vars), backgrounds: bgs, sizePx: FLOOR_PX });
      if (!r) { fails.push(`【C 令牌矩阵】${theme}：特例对 ${sp.fg} on ${sp.bg} 解析不出`); continue; }
      rows.push({ theme, token: `${sp.fg} on ${sp.bg}`, ...r });
      if (r.red) fails.push(`【C 令牌矩阵】${theme} ${sp.fg} 压在 ${sp.bg} 上仅 ${r.got}:1，${FLOOR_PX}px 需 ${r.need}:1（${sp.why}）`);
    }
  }
  return { rows, fails, need };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 · 全量扫描
 * ═══════════════════════════════════════════════════════════════════════════ */
function readSafe(p) {
  try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; }
}

export function analyzeAll(themes, extraSources = []) {
  const cssFiles = walkFiles(join(ROOT, SRC), [".css"]);
  const tsxFiles = walkFiles(join(ROOT, SRC), [".tsx"]);
  if (cssFiles.length < MIN_CSS_FILES || tsxFiles.length < MIN_TSX_FILES)
    return { broken: `扫描面只枚举到 css ${cssFiles.length}（下界 ${MIN_CSS_FILES}）/ tsx ${tsxFiles.length}（下界 ${MIN_TSX_FILES}）` };

  const perFile = new Map();
  const bump = (f, k, item) => {
    if (!perFile.has(f)) perFile.set(f, { site: 0, floor: 0, unjudged: 0, siteItems: [], floorItems: [] });
    const e = perFile.get(f);
    e[k]++;
    if (k === "site" && e.siteItems.length < 40) e.siteItems.push(item);
    if (k === "floor" && e.floorItems.length < 40) e.floorItems.push(item);
  };

  const sources = [
    ...cssFiles.map((f) => [f, readSafe(f), scanCss]),
    ...tsxFiles.map((f) => [f, readSafe(f), scanTsx]),
    ...extraSources.map(([f, raw]) => [f, raw, f.endsWith(".css") ? scanCss : scanTsx]),
  ];

  for (const [f, raw, scanner] of sources) {
    if (raw == null) continue;
    const { units, sizes, unjudged } = scanner(f, raw);
    if (!perFile.has(f)) perFile.set(f, { site: 0, floor: 0, unjudged: 0, siteItems: [], floorItems: [] });
    perFile.get(f).unjudged += unjudged;

    // 判据 B（字号硬底）
    for (const s of sizes) if (s.size < FLOOR_PX) bump(f, "floor", `L${s.line} ${s.sel.slice(0, 50)} = ${s.size}px`);

    // 判据 A（尺寸加权对比度）—— 三套主题各判一次，任一主题红即计一条
    for (const u of units) {
      const bad = [];
      for (const [theme, vars] of Object.entries(themes)) {
        const c = resolveColor(u.color, vars);
        if (!c) continue;
        const r = judgeUnit({ color: c, backgrounds: surfacesOf(vars), sizePx: u.size, weight: u.weight });
        if (r?.red) bad.push(`${theme} ${r.got}<${r.need}@${r.worst}`);
      }
      if (bad.length) bump(f, "site", `L${u.line} ${u.sel.slice(0, 44)} ${u.size}px/${u.weight} ${u.color.slice(0, 26)} → ${bad.join(" · ")}`);
    }
  }
  return { perFile };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 · 金丝雀 —— 双向 · 与主逻辑共用同一份实现（不另抄公式）
 * ═══════════════════════════════════════════════════════════════════════════ */
const PANEL_DARK = "#2c3d5e";
const CANARIES = [
  {
    name: "必咬-1 仓主实拍那一组：--muted2 #9ba9b7 on --panel #2c3d5e @10px = 4.52:1（WCAG「过」，本门必红）",
    run: () => judgeUnit({ color: "#9ba9b7", backgrounds: [["--panel", PANEL_DARK]], sizePx: 10 }),
    expect: (r) => r && r.red && Math.abs(r.got - 4.52) < 0.06 && Math.abs(r.need - 7.2) < 0.02,
  },
  {
    name: "必咬-2 明显不可读：近底色的灰 #33445f @9px",
    run: () => judgeUnit({ color: "#33445f", backgrounds: [["--panel", PANEL_DARK]], sizePx: 9 }),
    expect: (r) => r && r.red && r.got < 1.3,
  },
  {
    name: "必不咬-1 明显可读：纯白 @14px（12.6:1，远超 5.14 需求）",
    run: () => judgeUnit({ color: "#ffffff", backgrounds: [["--panel", PANEL_DARK]], sizePx: 14 }),
    expect: (r) => r && !r.red && r.got > 10,
  },
  {
    /** WCAG 逐值复现 ①：16px 正文阈值必须**恰好**是 4.5，否则常数 K 被人改动过。 */
    name: "必不咬-2 WCAG 锚点复现：16px 常规 ⇒ 阈值恰为 4.5",
    run: () => requiredContrast(16, 400),
    expect: (r) => Math.abs(r - 4.5) < 1e-9,
  },
  {
    /** WCAG 逐值复现 ②：24px 大字阈值必须**恰好**是 3.0 —— 这一条证明反比律与 WCAG 相容。 */
    name: "必不咬-3 WCAG 锚点复现：24px 常规 ⇒ 阈值恰为 3.0（大字豁免）",
    run: () => requiredContrast(24, 400),
    expect: (r) => Math.abs(r - 3.0) < 1e-9,
  },
  {
    /** WCAG 逐值复现 ③：粗体 18.66px 也必须落在 3.0（大字的粗体分支）。 */
    name: "必不咬-4 WCAG 锚点复现：18.66px 粗体 ⇒ 阈值恰为 3.0",
    run: () => requiredContrast(18.66, 700),
    expect: (r) => Math.abs(r - 3.0) < 1e-6,
  },
  {
    name: "必咬-3 小字外推：10px ⇒ 7.2 · 9px ⇒ 8.0（本门相对 WCAG 收紧的那一段）",
    run: () => [requiredContrast(10), requiredContrast(9)],
    expect: (r) => Math.abs(r[0] - 7.2) < 1e-9 && Math.abs(r[1] - 8.0) < 1e-9,
  },
  {
    name: "必不咬-5 下限不低于 WCAG 大字：42px 也不许降到 3.0 以下",
    run: () => requiredContrast(42),
    expect: (r) => Math.abs(r - 3.0) < 1e-9,
  },
  {
    /** 对比度算法本身（WCAG 公式）——黑白必须是 21:1，同色必须是 1:1。 */
    name: "必不咬-6 对比度公式自证：黑白 21:1 · 同色 1:1",
    run: () => [contrast(parseColor("#000"), parseColor("#fff")), contrast(parseColor("#123456"), parseColor("#123456"))],
    expect: (r) => Math.abs(r[0] - 21) < 0.01 && Math.abs(r[1] - 1) < 1e-9,
  },
  {
    /** 半透前景必须先合成 —— 不合成会把 rgba(255,255,255,.2) 当成纯白，得出"高对比"的反向结论。 */
    name: "必咬-4 半透前景必须合成后再算：rgba(255,255,255,.2) 在暗面上其实读不了",
    run: () => judgeUnit({ color: "rgba(255,255,255,0.2)", backgrounds: [["--panel", PANEL_DARK]], sizePx: 12 }),
    expect: (r) => r && r.red && r.got < 2,
  },
  {
    /** 底色取"最差面"而不是第一个面 —— 取错会让暗色下所有判断偏乐观。 */
    name: "必咬-5 多面时取最差：同一个灰在 panel2 上过、在 panel 上不过 ⇒ 必须判红",
    run: () => judgeUnit({ color: "#9ba9b7", backgrounds: [["--panel2", "#1c2942"], ["--panel", PANEL_DARK]], sizePx: 12 }),
    expect: (r) => r && r.red && r.worst === "--panel",
  },
  {
    name: "必咬-6 CSS 扫描器：同块内 color+font-size 必须被抽成可判单元",
    run: () => scanCss("c.css", ".a{ color: var(--muted2); font-size: 10px; }\n.b{ margin:0 }"),
    expect: (r) => r.units.length === 1 && r.units[0].size === 10 && r.sizes.length === 1,
  },
  {
    name: "必不咬-7 CSS 扫描器：注释里的 font-size/color 不算（本仓踩过散文被当代码的坑）",
    run: () => scanCss("c.css", "/* 纪律：font-size: 9px 且 color: var(--muted2) 不许用 */\n.a{ margin: 0 }"),
    expect: (r) => r.units.length === 0 && r.sizes.length === 0,
  },
  {
    name: "必咬-7 TSX 扫描器：内联 style={{fontSize:10,color:\"var(--muted2)\"}} 必须被抽出",
    run: () => scanTsx("c.tsx", 'const x = <b style={{ fontSize: 10, color: "var(--muted2)" }}>x</b>;'),
    expect: (r) => r.units.length === 1 && r.units[0].size === 10 && r.units[0].color === "var(--muted2)",
  },
  {
    name: "必不咬-8 var() 兜底解析：未定义令牌时回落到 fallback，不许当成「判不了」放过",
    run: () => resolveColor("var(--nope, #ffffff)", new Map()),
    expect: (r) => r && r.r === 255 && r.g === 255 && r.b === 255,
  },
  {
    name: "必咬-8 主题解析：tokens.css 三块必须各出一张表且 light 覆盖生效",
    run: () => buildThemes(':root{--bg:#223251;--txt:#e9eef5;--muted:#b1bece;--muted2:#9ba9b7;--panel:#2c3d5e;--panel2:#1c2942;--bg2:#283a5c;--popover-surface:#1c2942;--accent:#4c90f0;--ok:#62be77;}\n:root[data-theme="light"]{--bg:#f5f7fb;--txt:#14203a;}\n:root[data-theme="warm"]{--bg:#f9f9f9;--txt:#1c1c1c;}'),
    expect: (r) => r && r.dark.get("--txt") === "#e9eef5" && r.light.get("--txt") === "#14203a" && r.light.get("--muted") === "#b1bece" && r.warm.get("--bg") === "#f9f9f9",
  },
  {
    name: "必咬-9 字号硬底：11.5px < FLOOR(12) 必须计一条 floor",
    run: () => scanCss("c.css", ".a{ font-size: 11.5px }"),
    expect: (r) => r.sizes.length === 1 && r.sizes[0].size < FLOOR_PX,
  },
  {
    name: "必不咬-9 12px 不触 floor（交点本身在线上，不许把它也咬掉）",
    run: () => scanCss("c.css", ".a{ font-size: 12px }"),
    expect: (r) => r.sizes.length === 1 && !(r.sizes[0].size < FLOOR_PX),
  },
  {
    /**
     * ⚠ **回归金丝雀**，钉死一个真实发生过的漏扫（2026-08-14 本单，由真浏览器复测抖出）：
     * 门第一版只认 `font-size:`，`.optSub { font: 9px var(--font-mono) }` 一个字都扫不到 ⇒
     * 门报"这些文件干净"，而屏上那 35 个 9px 元素还红着。本仓 `font:` 简写实测 72 处。
     * 此条锁死：简写里的**字号**与**字重**都要抽出来（字重漏了会让粗体阈值算错）。
     */
    name: "必咬-10 `font:` 简写里的字号与字重必须一起抽出（漏它 = 漏掉 72 处声明）",
    run: () => [
      scanCss("c.css", ".a{ font: 9px var(--font-mono); color: var(--muted2) }"),
      scanCss("c.css", ".b{ font: 700 8px/1.5 var(--font-mono); color: var(--danger) }"),
      scanCss("c.css", ".c{ font: inherit }"),
    ],
    expect: (r) =>
      r[0].sizes.length === 1 && r[0].sizes[0].size === 9 && r[0].units.length === 1 && r[0].units[0].weight === 400 &&
      r[1].sizes.length === 1 && r[1].sizes[0].size === 8 && r[1].units[0].weight === 700 &&
      r[2].sizes.length === 0,
  },
  {
    /**
     * ⚠ **回归金丝雀**（同日第二次，同一个病换了个马甲）：React 内联样式的键是 `font`，
     * 不是 `font-size` —— 门只找 `fontSize` 时，`SandboxView.tsx` 顶栏那三处
     * `style={{ font: "600 10px var(--font-mono)" }}` **一处都扫不到**，屏上却确确实实是 10px。
     * 「CSS 侧修好了」不蕴含「TSX 侧也修好了」：两个扫描器是两份实现，各要各的金丝雀。
     */
    name: "必咬-11 TSX 内联 `font:` 简写（React 键叫 font，不叫 fontSize）也要抽出字号与字重",
    run: () => scanTsx("c.tsx", 'const x = <b style={{ display: "flex", font: "600 10px var(--font-mono)", color: "var(--muted2)" }}>x</b>;'),
    expect: (r) => r.sizes.length === 1 && r.sizes[0].size === 10 && r.units.length === 1 && r.units[0].weight === 600,
  },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let r;
    try { r = c.run(); } catch (e) { fails.push(`${c.name} —— 抛异常：${e.message}`); continue; }
    let ok = false;
    try { ok = !!c.expect(r); } catch (e) { fails.push(`${c.name} —— 断言抛异常：${e.message}`); continue; }
    if (!ok) fails.push(`${c.name} —— 实测 ${JSON.stringify(r)?.slice(0, 220)}`);
  }
  return fails;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 · 棘轮判据（判据本身也要能被咬）
 * ═══════════════════════════════════════════════════════════════════════════ */
/**
 * 单文件棘轮：`site` / `floor` 只降不升。新文件（无基线）硬上限 = 0。
 * @param {{file:string,site:number,floor:number}} r 实测
 * @param {{site:number,floor:number}|undefined} b 基线；undefined = 新文件
 */
export function judgeRatchet(r, b) {
  const fails = [];
  const bs = b?.site ?? 0, bf = b?.floor ?? 0;
  const tagNew = b ? "" : "【新文件】";
  if (r.site > bs)
    fails.push(
      `${tagNew}【A 尺寸加权对比度】${r.file} 不达标声明 ${bs} → ${r.site}（+${r.site - bs}）：` +
        (r.siteItems || []).slice(0, 3).join(" · ")
    );
  if (r.floor > bf)
    fails.push(
      `${tagNew}【B 字号硬底 <${FLOOR_PX}px】${r.file} ${bf} → ${r.floor}（+${r.floor - bf}）：` +
        (r.floorItems || []).slice(0, 3).join(" · ")
    );
  return fails;
}

const RATCHET_CANARIES = [
  { name: "棘轮必绿-1 降了：site 12→5", b: { site: 12, floor: 3 }, r: { file: "x", site: 5, floor: 3 }, red: false },
  { name: "棘轮必红-1 升了：site 5→6", b: { site: 5, floor: 3 }, r: { file: "x", site: 6, floor: 3 }, red: true },
  { name: "棘轮必红-2 字号硬底新增：floor 0→1", b: { site: 0, floor: 0 }, r: { file: "x", site: 0, floor: 1 }, red: true },
  { name: "棘轮必红-3 新文件带违规（无基线 ⇒ 硬上限 0）", b: undefined, r: { file: "x", site: 1, floor: 0 }, red: true },
  { name: "棘轮必绿-2 新文件零违规", b: undefined, r: { file: "x", site: 0, floor: 0 }, red: false },
  { name: "棘轮必绿-3 持平不红（棘轮不是「必须继续降」）", b: { site: 7, floor: 2 }, r: { file: "x", site: 7, floor: 2 }, red: false },
];
function runRatchetCanaries() {
  const fails = [];
  for (const c of RATCHET_CANARIES) {
    let out;
    try { out = judgeRatchet(c.r, c.b); } catch (e) { fails.push(`${c.name} —— judgeRatchet 抛异常：${e.message}`); continue; }
    const isRed = out.length > 0;
    if (isRed !== c.red) fails.push(`${c.name} —— 期望${c.red ? "红" : "绿"}，实得${isRed ? "红：" + out[0] : "绿"}`);
  }
  return fails;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 · 门主体
 * ═══════════════════════════════════════════════════════════════════════════ */
function loadThemes() {
  // 故障注入开关：只给 `--selftest` 的子进程用，机械验证「工具坏了 ⇒ RC=2」这条路径。
  if (process.env.TEXT_LEGIBILITY_FORCE_BROKEN === "1")
    toolBroken("（故障注入）tokens.css 不可读", "这是 --selftest 在自检「环境故障 ⇒ RC=2」这条路径。");
  let raw;
  try { raw = readFileSync(TOKENS, "utf8"); } catch (e) {
    toolBroken(`读不出 ${relative(ROOT, TOKENS)}（${e.message}）`, "多半是 cwd 不在仓根，或该文件被改名。");
  }
  const themes = buildThemes(raw);
  if (!themes) toolBroken("tokens.css 解析不出三套主题（:root / [data-theme=light] / [data-theme=warm]）", "改了主题块的选择器写法就会走到这里 —— 这是「我没查出来」，不是「令牌都达标」。");
  return themes;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) toolBroken(`基线缺失 ${relative(ROOT, BASELINE)}`, "先跑 `node scripts/check-text-legibility.mjs --update` 并人工核 why。");
  let j;
  try { j = JSON.parse(readFileSync(BASELINE, "utf8")); } catch (e) {
    toolBroken(`基线不是合法 JSON（${e.message}）`, "常见成因是合并冲突标记残留（`<<<<<<<`）。");
  }
  if (!j || typeof j.files !== "object" || j.files === null) toolBroken("基线结构不对（缺 files 字段）");
  return j;
}

/** 故障注入：往扫描面里塞一个**真违规**样例，验证顶层兜底没把 RC=1 吞成 RC=2。 */
function injectedSources() {
  if (process.env.TEXT_LEGIBILITY_INJECT_VIOLATION !== "1") return [];
  return [["apps/frontend-shell/src/__injected__.css", ".injected{ color:#33445f; font-size:8px }"]];
}

function gate() {
  const themes = loadThemes();

  // 判据 C：令牌矩阵（无基线，必须绿）
  const mx = judgeMatrix(themes);

  const res = analyzeAll(themes, injectedSources());
  if (res.broken) {
    console.error(`⛔ 门自己瞎了：${res.broken}`);
    console.error("   这是「枚举器坏了」，不是「文件没了」—— 不许据此报「代码干净」。");
    return 2;
  }
  const base = loadBaseline();

  const fails = [...mx.fails];
  const rows = [];
  for (const [file, e] of [...res.perFile].sort()) {
    const r = { file, ...e };
    rows.push(r);
    fails.push(...judgeRatchet(r, base.files[file]));
  }

  if (fails.length) {
    console.error(`❌ text-legibility:check 未通过（${fails.length} 条）\n`);
    fails.slice(0, 60).forEach((f) => console.error("  · " + f));
    if (fails.length > 60) console.error(`  …… 另有 ${fails.length - 60} 条`);
    console.error(`\n判据：required(S,w) = max(3.0, ${K}/S_eff)，S_eff = S×(w≥700 ? ${BOLD_GAIN.toFixed(4)} : 1)；字号硬底 ${FLOOR_PX}px。`);
    console.error("     两个锚点全部来自 WCAG 2.1 SC 1.4.3（16px→4.5 · 24px→3.0），指数由二者联立解出，不是自拟。");
    console.error("修法：**优先升字号**（9–10px 的中文在本调色板内无解，见门头推导），其次改用达标的文字令牌；");
    console.error("     确属合理存量 ⇒ 更新基线并逐条写 why。");
    return 1;
  }

  const tot = rows.reduce((a, r) => a + r.site, 0);
  const totF = rows.reduce((a, r) => a + r.floor, 0);
  const totU = rows.reduce((a, r) => a + r.unjudged, 0);
  console.log(`✅ text-legibility:check 通过 —— ${rows.length} 个前端源文件`);
  console.log(`   判据 C 令牌矩阵：${mx.rows.length} 对（三套主题）全部 ≥ ${mx.need.toFixed(2)}:1 @${FLOOR_PX}px`);
  console.log(`   存量（棘轮基线 ${Object.keys(base.files).length} 条）：A 不达标声明 ${tot} · B 低于 ${FLOOR_PX}px ${totF} · 静态判不了 ${totU}（诚实边界②③）`);
  return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 · CLI
 * ═══════════════════════════════════════════════════════════════════════════ */
function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

  // ── 金丝雀先跑，任何模式都跑（含 --update：不许拿一个瞎了的门去写基线）──────
  const canaryFails = [...runCanaries(), ...runRatchetCanaries()];
  if (canaryFails.length) {
    console.error("⛔ 门自己瞎了 —— 金丝雀不中，**不许**据此报「代码干净 / 文字都读得了」：");
    canaryFails.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }

  if (has("--selftest")) {
    const bite = CANARIES.filter((c) => /必咬/.test(c.name)).length;
    console.log(`✅ 判据金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必咬 ${bite} + 必不咬 ${CANARIES.length - bite}）`);
    const rRed = RATCHET_CANARIES.filter((c) => c.red).length;
    console.log(`✅ 棘轮金丝雀 ${RATCHET_CANARIES.length}/${RATCHET_CANARIES.length} 全中（必红 ${rRed} + 必绿 ${RATCHET_CANARIES.length - rRed}）`);

    const themes = loadThemes();
    const scan = analyzeAll(themes);
    if (scan.broken) { console.error("⛔ " + scan.broken); process.exit(2); }
    console.log(`✅ 扫描面 ${scan.perFile.size} 个文件（css 下界 ${MIN_CSS_FILES} / tsx 下界 ${MIN_TSX_FILES}）`);

    /* ── 退出码契约**双向**机验（只做一半的门是装饰品）────────────────────────
     * ① 注入环境故障 ⇒ RC=2（不许是 1：那会让人去改一个一个字都没被扫过的页面）
     * ② 注入真违规   ⇒ RC=1（不许被顶层兜底吞成 2：那是拿更糟的假绿换掉假红）
     */
    const self = fileURLToPath(import.meta.url);
    const p1 = spawnSync(process.execPath, [self], { cwd: ROOT, env: { ...process.env, TEXT_LEGIBILITY_FORCE_BROKEN: "1" }, encoding: "utf8" });
    if (p1.status !== 2) {
      console.error(`⛔ 退出码契约被破：注入「环境故障」后应 RC=2，实得 RC=${p1.status}。`);
      console.error("   stderr：" + (p1.stderr || "").trim().split("\n").slice(0, 3).join(" / "));
      process.exit(2);
    }
    console.log("✅ 退出码契约①：注入环境故障 ⇒ RC=2（工具坏了），未误报成 RC=1（真违规）");

    const p2 = spawnSync(process.execPath, [self], { cwd: ROOT, env: { ...process.env, TEXT_LEGIBILITY_INJECT_VIOLATION: "1" }, encoding: "utf8" });
    if (p2.status !== 1) {
      console.error(`⛔ 退出码契约被破：注入「真违规」后应 RC=1，实得 RC=${p2.status}。`);
      console.error("   兜底若把真违规也吞成 2，本门将永远不红 —— 那是拿更糟的假绿换掉假红。");
      console.error("   stdout/stderr：" + ((p2.stdout || "") + (p2.stderr || "")).trim().split("\n").slice(0, 4).join(" / "));
      process.exit(2);
    }
    console.log("✅ 退出码契约②：注入真违规 ⇒ RC=1（真违规），未被兜底吞成 RC=2");
    process.exit(0);
  }

  if (has("--matrix")) {
    const themes = loadThemes();
    const mx = judgeMatrix(themes);
    console.log(`# 令牌矩阵 · 阈值 = required(${FLOOR_PX}px) = ${mx.need.toFixed(2)}:1`);
    for (const r of mx.rows)
      console.log(`  ${r.red ? "❌" : "✅"} ${r.theme.padEnd(5)} ${r.token.padEnd(30)} ${String(r.got).padStart(6)}:1  最差面 ${r.worst}`);
    if (mx.fails.length) { console.log("\n未达标："); mx.fails.forEach((f) => console.log("  · " + f)); }
    process.exit(0);
  }

  if (has("--explain")) {
    const f = val("--explain");
    if (!f || f.startsWith("--")) toolBroken("`--explain` 没给文件路径", "用法：`--explain <file>`");
    const themes = loadThemes();
    const raw = readSafe(f);
    if (raw == null) toolBroken(`读不到 ${f}`);
    const { units, sizes, unjudged } = (f.endsWith(".css") ? scanCss : scanTsx)(f, raw);
    console.log(`# ${f}  可判单元 ${units.length} · 字号声明 ${sizes.length} · 静态判不了 ${unjudged}`);
    for (const u of units) {
      const bits = [];
      for (const [theme, vars] of Object.entries(themes)) {
        const c = resolveColor(u.color, vars);
        const r = c && judgeUnit({ color: c, backgrounds: surfacesOf(vars), sizePx: u.size, weight: u.weight });
        bits.push(`${theme}=${r ? (r.red ? "❌" : "✅") + r.got + "/" + r.need : "?"}`);
      }
      console.log(`  L${u.line} ${u.sel.slice(0, 40)}  ${u.size}px/${u.weight}  ${u.color.slice(0, 26)}  ${bits.join(" ")}`);
    }
    for (const s of sizes) if (s.size < FLOOR_PX) console.log(`  ⚠ 字号硬底 L${s.line} ${s.sel.slice(0, 40)} = ${s.size}px < ${FLOOR_PX}px`);
    process.exit(0);
  }

  if (has("--census")) {
    const themes = loadThemes();
    const res = analyzeAll(themes);
    if (res.broken) toolBroken(res.broken);
    const rows = [...res.perFile].map(([file, e]) => ({ file, site: e.site, floor: e.floor, unjudged: e.unjudged }))
      .filter((r) => r.site || r.floor).sort((a, b) => b.site + b.floor - (a.site + a.floor));
    console.log(JSON.stringify({ floorPx: FLOOR_PX, k: K, count: rows.length, rows }, null, 1));
    process.exit(0);
  }

  if (has("--update")) {
    const themes = loadThemes();
    const res = analyzeAll(themes);
    if (res.broken) toolBroken(`拒绝写基线：${res.broken}`);
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
    const files = {};
    for (const [file, e] of [...res.perFile].sort()) {
      if (!e.site && !e.floor) continue; // 零违规的文件不进基线（新增违规即红）
      const old = prev?.files?.[file];
      files[file] = { site: e.site, floor: e.floor, why: old?.why || whyFor(file, e) };
    }
    writeFileSync(
      BASELINE,
      JSON.stringify({
        note:
          `WO-R9-CONTRAST 的存量棘轮（断点 G-TEXT-ILLEGIBLE-SMALL-CJK）。` +
          `site = 判据 A（尺寸加权对比度 required=max(3, ${K}/S_eff)）不达标的声明数；` +
          `floor = 判据 B（字号硬底 <${FLOOR_PX}px）的声明数。两者只降不升；零违规的文件不进基线（新增即红）。` +
          `判据 C（令牌矩阵）无基线，必须绿。`,
        gate: "scripts/check-text-legibility.mjs",
        generatedFrom: "node scripts/check-text-legibility.mjs --update",
        criterion: { k: K, floorPx: FLOOR_PX, boldGain: +BOLD_GAIN.toFixed(4), wcagAnchors: { bodyPx: WCAG_BODY_PX, bodyRatio: WCAG_BODY_RATIO, largePx: WCAG_LARGE_PX, largeRatio: WCAG_LARGE_RATIO, largeBoldPx: WCAG_LARGE_BOLD_PX } },
        fileCount: Object.keys(files).length,
        totals: {
          site: Object.values(files).reduce((a, f) => a + f.site, 0),
          floor: Object.values(files).reduce((a, f) => a + f.floor, 0),
        },
        files,
      }, null, 1) + "\n"
    );
    console.log(`✅ 基线已写：${Object.keys(files).length} 条 → ${relative(ROOT, BASELINE)}`);
    process.exit(0);
  }

  process.exit(gate());
}

function whyFor(file, e) {
  const where = file.includes("/views/sim/") ? "推演沙盘（本单主战场之外的残留）"
    : file.includes("/views/") ? "其它决策页"
    : file.includes("/pages/admin/") ? "管理台"
    : file.includes("/components/") ? "共享组件"
    : "前端其它";
  const bits = [];
  if (e.floor) bits.push(`${e.floor} 处字号 <${FLOOR_PX}px`);
  if (e.site) bits.push(`${e.site} 处尺寸加权对比度不达标`);
  return `存量·${where}：${bits.join("；")}。本单（WO-R9-CONTRAST）只治推演沙盘那一屏与全局令牌，其余按棘轮 burn-down。`;
}

/* ── 兜底：任何未预期异常 ⇒ RC=2，绝不让它变成 RC=1 ──────────────────────────
 * ⚠ `IS_MAIN` 守卫的作用不是"优雅"，是**让判据可以被复用而不是被抄一遍**：
 *   真浏览器测量脚本要用 `requiredContrast()` 判红绿，若本文件一 import 就跑 `main()`
 *   并 `process.exit()`，测量脚本只能自己抄一份公式 —— 那份抄件就是本仓反复点名的装饰品
 *   （改了主公式，抄件拿旧的去测、照样绿）。守卫在此，判据在全仓只有这一份实现。 */
const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
try {
  if (IS_MAIN) main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
