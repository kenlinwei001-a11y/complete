import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProviders } from "@/App";
import { Provenance } from "@/components/Provenance";
import { RuleRef } from "@/components/RuleRef";
import { ProvenanceDag, gapAttributionToDag, type GapAttrOutput } from "@/components/ProvenanceDag";
import { useProvenance } from "@/components/Provenance/ProvenancePopover";
import { loginAs } from "./utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WO-PROV-POPOVER-LEGIBILITY（欠账 #104）· 溯源悬浮层「看得清」门
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ── 判据为什么能代表「看得清」（本门的核心论证，不是装饰）───────────────────────
 *
 * 「看得清」= 字形像素与其**紧邻背景像素**的对比度够。而浮层里真正渲染出来的背景不是
 * 「浮层声明的那个颜色」，是 composite(浮层背景, 底下页面的像素)。于是：
 *
 *   · 浮层背景 alpha < 1（或有 backdrop-filter / opacity < 1）时，
 *     「底下的像素」由**用户滚到哪儿**决定，不由设计决定 → 对比度不是一个数，是一个区间。
 *     暗色主题 .panel（--panel-glass = rgba(255,255,255,.06)）实测这个区间是 [1.01, 9.19]：
 *       浮层压在页面空白处(--bg)  → --txt 对比 9.19:1（好看）
 *       浮层压在底层正文字形上(--txt) → --txt 对比 1.01:1（白压白，肉眼直接消失）
 *     暖砂主题被 theme-warm.css 覆写成 rgba(255,255,255,.55)，区间 [5.98, 17.04]，--muted 更掉到 1.21。
 *     **这个下限没有任何 --txt 取值能救**：调亮浮层文字，底下那行字也一起亮。
 *
 *   · 浮层背景 alpha == 1 时，composite ≡ 浮层背景色，与底下什么都无关
 *     → 对比度退化成**一个常量**。这个常量才是可以拿去校 WCAG AA 的东西。
 *
 * 所以「不透明」不是可读性的**代理指标**，它是「可读性这个量存在」的**前提**。
 * 本门因此按这条因果链分层断言：
 *
 *   ① 遮蔽性（本 WO 真正修的东西）：把浮层背景合成到 4 种对抗性底色上，
 *      结果必须**逐通道等于浮层背景本身**（Δ = 0）。这是「背景不透明」的机器定义，
 *      写成"合成后没变化"而不是"字符串里没有 rgba"，是因为前者是我们真正要的性质：
 *      **浮层区域的渲染像素与底下无关**。渐变 / color-mix / opacity / backdrop-filter
 *      这些绕过字符串检查的写法，都会在这里露馅（解析不出实色一律判红·fail-closed）。
 *   ② 常量对比：在①成立的前提下，contrast(--txt, 浮层背景) ≥ WCAG AA 4.5，三套主题各算。
 *   ③ 接缝：真渲染组件 → 浮层 DOM 节点必须真戴着①②校过的那张表面的类，且不再戴 panel。
 *      （少了这一层，①②只是在证明一条没人用的 CSS 规则 —— 本仓已知的假绿形态。）
 *   ④ 反面锚：同一套计算喂给**旧表面 .panel 的活定义**（不是我抄一份），必须判红。
 *      判据自己先被证明咬得住，才有资格当门。
 *
 * ── 本门不覆盖什么（诚实边界）───────────────────────────────────────────────────
 * ①②③只保证浮层的**背景**不再由底下的内容决定、且主文字色对该背景达 AA。它不保证
 * 每一个前景 token 在每套主题下都达 AA —— 暖砂主题的 --muted(3.45) / --muted2(1.86) 在**任何**
 * 白色面上都不达标（tokens.css [data-theme=warm]），那是全主题范围的既有欠账，不是浮层引入的，
 * 本 WO 不改（改它会波及所有白卡）。下面 §2 把这些数**算出来打印在断言消息里**，不粉饰。
 */

// ── 仓根 & 读文件（沿用本仓 seam 测试的写法）─────────────────────────────────────
const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = (() => {
  let d = dirname(TEST_FILE);
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(d, "pnpm-workspace.yaml"), "utf8");
      return d;
    } catch {
      d = dirname(d);
    }
  }
  throw new Error(`[prov-popover-legibility] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** 被门咬的表面类名 —— DOM 断言(③)与 CSS 断言(①②)共用这一个常量，两头咬的必须是同一个东西。 */
const SURFACE_CLASS = "popover-surface";

const CSS_FILES = [
  "apps/frontend-shell/src/styles/tokens.css",
  "apps/frontend-shell/src/styles/global.css",
  "apps/frontend-shell/src/styles/theme-warm.css",
  "apps/frontend-shell/src/components/Provenance/ProvenancePopover.module.css",
  "apps/frontend-shell/src/views/plan/PlanViews.module.css",
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CSS 微解析（注释先剥：注释里就写着 rgba(...)，不剥就会咬到说明书）
// ═══════════════════════════════════════════════════════════════════════════════
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selector: string;
  body: string;
  file: string;
}

/** 花括号配对扫描：@media 等 at-rule 递归展开，只吐真正的样式规则。 */
function parseRules(css: string, file: string): Rule[] {
  const out: Rule[] = [];
  let buf = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      const sel = buf.trim();
      if (sel.startsWith("@")) out.push(...parseRules(body, file));
      else if (sel) out.push({ selector: sel, body, file });
      buf = "";
      i = j;
    } else if (ch === "}") {
      buf = "";
      i++;
    } else {
      buf += ch;
      i++;
    }
  }
  return out;
}

/** 声明拆分（括号内的 `;` 不算分隔——本仓没有，但别让门在未来的写法上悄悄漏读）。 */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let cur = "";
  const flush = () => {
    const t = cur.trim();
    cur = "";
    if (!t) return;
    const k = t.indexOf(":");
    if (k < 0) return;
    out.push([t.slice(0, k).trim().toLowerCase(), t.slice(k + 1).trim()]);
  };
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === ";" && depth === 0) flush();
    else cur += ch;
  }
  flush();
  return out;
}

const ALL_RULES: Rule[] = CSS_FILES.flatMap((f) => parseRules(stripComments(readRepo(f)), f));

// ── token 表：暗色 = :root 基座；light / warm = 基座 + 各自覆盖 ────────────────────
type Theme = "dark" | "light" | "warm";
const THEMES: Theme[] = ["dark", "light", "warm"];

function tokenMap(theme: Theme): Map<string, string> {
  const m = new Map<string, string>();
  const take = (r: Rule) => {
    for (const [k, v] of declarations(r.body)) if (k.startsWith("--")) m.set(k, v);
  };
  for (const r of ALL_RULES) if (/^:root$/.test(r.selector.trim())) take(r);
  if (theme !== "dark") {
    for (const r of ALL_RULES) if (r.selector.includes(`[data-theme="${theme}"]`) && !/\s/.test(r.selector.trim())) take(r);
  }
  return m;
}
const TOKENS: Record<Theme, Map<string, string>> = { dark: tokenMap("dark"), light: tokenMap("light"), warm: tokenMap("warm") };

/** var() 递归展开（带 fallback）。展不开的留 `__UNRESOLVED__`，由 parseColor fail-closed 判红。 */
function resolveVars(value: string, tokens: Map<string, string>): string {
  let v = value;
  for (let guard = 0; guard < 24 && v.includes("var("); guard++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/, (_m, name: string, fb?: string) => {
      const t = tokens.get(name);
      if (t !== undefined) return t;
      if (fb !== undefined) return fb.trim();
      return "__UNRESOLVED__";
    });
  }
  return v.trim();
}

// ── 颜色 & WCAG ────────────────────────────────────────────────────────────────
interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 只认「单一实色」。渐变 / color-mix / 关键字 transparent / 展不开的 var → null（fail-closed）。 */
function parseColor(raw: string): RGBA | null {
  const v = raw.trim().toLowerCase();
  if (v === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (v === "black") return { r: 0, g: 0, b: 0, a: 1 };
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1]!.split(/[,/\s]+/).filter(Boolean).map((s) => s.trim());
    if (parts.length < 3) return null;
    const n = (s: string) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const [r, g, b] = [n(parts[0]!), n(parts[1]!), n(parts[2]!)];
    if ([r, g, b, a].some((x) => !Number.isFinite(x))) return null;
    return { r, g, b, a };
  }
  return null;
}

const srgb = (c: number) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const luminance = (c: RGBA) => 0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b);
function contrast(fg: RGBA, bg: RGBA): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** source-over 合成：浮层背景压在 backdrop 上，用户真正看到的像素。 */
function composite(surface: RGBA, backdrop: RGBA): RGBA {
  const a = surface.a;
  return {
    r: surface.r * a + backdrop.r * (1 - a),
    g: surface.g * a + backdrop.g * (1 - a),
    b: surface.b * a + backdrop.b * (1 - a),
    a: 1,
  };
}
const fmt = (c: RGBA) => `rgba(${c.r.toFixed(1)}, ${c.g.toFixed(1)}, ${c.b.toFixed(1)}, ${c.a})`;

// ── 表面判定 ───────────────────────────────────────────────────────────────────
interface Verdict {
  /** 浮层区域的渲染像素与底下无关（= 本 WO 要的性质）。 */
  backdropIndependent: boolean;
  /** 判红原因（人读）。 */
  reasons: string[];
  /** 通过时的实色表面（用于算对比度）。 */
  solid: RGBA | null;
}

/**
 * 判定「某个类在某套主题下，作为悬浮层表面是否遮得住底下」。
 * 收集该类在**所有**样式表里的全部背景/滤镜/透明度声明（后来的覆盖先前的），逐条判。
 */
function judgeSurface(className: string, theme: Theme): Verdict {
  const tokens = TOKENS[theme];
  const reasons: string[] = [];
  const selMatches = (sel: string) =>
    sel.split(",").some((s) => {
      const t = s.trim();
      if (!new RegExp(`\\.${className}(?![\\w-])`).test(t)) return false;
      const themed = /\[data-theme="(\w+)"\]/.exec(t);
      return themed ? themed[1] === theme : true;
    });

  const hits = ALL_RULES.filter((r) => selMatches(r.selector));
  if (hits.length === 0) return { backdropIndependent: false, reasons: [`没有任何样式规则命中 .${className}`], solid: null };

  let bgRaw: { value: string; from: string } | null = null;
  for (const r of hits) {
    for (const [prop, value] of declarations(r.body)) {
      if (prop === "background" || prop === "background-color" || prop === "background-image") {
        bgRaw = { value, from: `${r.file} :: ${r.selector.trim()} :: ${prop}` };
      } else if (prop === "backdrop-filter" || prop === "-webkit-backdrop-filter") {
        if (value.trim() !== "none") reasons.push(`${r.file} :: ${r.selector.trim()} 声明了 ${prop}: ${value}（显式采样底下的像素）`);
      } else if (prop === "opacity") {
        const o = parseFloat(value);
        if (Number.isFinite(o) && o < 1) reasons.push(`${r.file} :: ${r.selector.trim()} 声明了 opacity: ${value}（整层半透，底下照样透上来）`);
      } else if (prop === "mix-blend-mode" && value.trim() !== "normal") {
        reasons.push(`${r.file} :: ${r.selector.trim()} 声明了 mix-blend-mode: ${value}（渲染结果依赖底下的像素）`);
      }
    }
  }
  if (!bgRaw) {
    reasons.push(`.${className} 没有声明任何 background（默认 transparent → 底下全透）`);
    return { backdropIndependent: false, reasons, solid: null };
  }
  const resolved = resolveVars(bgRaw.value, tokens);
  const solid = parseColor(resolved);
  if (!solid) {
    reasons.push(`${bgRaw.from} = \`${bgRaw.value}\` → 解析为 \`${resolved}\`，不是单一实色（渐变 / color-mix / 未定义 token 一律判红·fail-closed）`);
    return { backdropIndependent: false, reasons, solid: null };
  }
  if (solid.a < 1) reasons.push(`${bgRaw.from} = \`${bgRaw.value}\` → \`${resolved}\`，alpha=${solid.a} < 1（底下的内容按 ${((1 - solid.a) * 100).toFixed(0)}% 透上来）`);
  return { backdropIndependent: reasons.length === 0, reasons, solid };
}

/** 对抗性底色：浮层可能正好压在这四种像素上（页面底 / 卡面 / 正文字形 / 次要文字字形）。 */
function backdrops(theme: Theme): [string, RGBA][] {
  const t = TOKENS[theme];
  return (["--bg", "--panel", "--txt", "--muted"] as const).map((name) => {
    const c = parseColor(resolveVars(`var(${name})`, t));
    expect(c, `[前置] ${theme} 主题的 ${name} 必须是实色，否则底色样本本身就不确定`).not.toBeNull();
    return [name, c!] as [string, RGBA];
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 遮蔽性 —— 浮层区域的渲染像素与底下无关（本 WO 真正修的东西）
// ═══════════════════════════════════════════════════════════════════════════════
describe(`#104 ①遮蔽性 · .${SURFACE_CLASS} 的渲染像素不依赖底下的内容`, () => {
  it.each(THEMES)("%s 主题：表面合成到 4 种对抗性底色上，逐通道 Δ = 0", (theme) => {
    const v = judgeSurface(SURFACE_CLASS, theme);
    expect(v.reasons, `[${theme}] .${SURFACE_CLASS} 不是一张遮得住的表面：\n  · ${v.reasons.join("\n  · ")}`).toEqual([]);
    expect(v.backdropIndependent).toBe(true);
    const surface = v.solid!;
    // 这一步才是判据本体：不是"字符串里没有 rgba"，是"压在任何东西上，出来的像素都还是它自己"。
    for (const [name, bd] of backdrops(theme)) {
      const seen = composite(surface, bd);
      const delta = Math.max(Math.abs(seen.r - surface.r), Math.abs(seen.g - surface.g), Math.abs(seen.b - surface.b));
      expect(
        delta,
        `[${theme}] 浮层压在 ${name}=${fmt(bd)} 上时，用户看到的背景是 ${fmt(seen)}，` +
          `而不是浮层自己声明的 ${fmt(surface)} —— 底下的内容参与了成像，浮层文字的对比度就不再由设计决定。`,
      ).toBe(0);
    }
  });

  it("承载浮层的几何类（.pop / .decProv）不得再自己声明背景或 backdrop-filter（否则会盖掉共享表面）", () => {
    const geometry: [string, string][] = [
      [".pop", "apps/frontend-shell/src/components/Provenance/ProvenancePopover.module.css"],
      [".decProv", "apps/frontend-shell/src/views/plan/PlanViews.module.css"],
    ];
    for (const [cls, file] of geometry) {
      const rules = ALL_RULES.filter((r) => r.file === file && r.selector.split(",").some((s) => s.trim() === cls));
      expect(rules.length, `${file} 里找不到 ${cls}`).toBeGreaterThan(0);
      for (const r of rules) {
        for (const [prop, value] of declarations(r.body)) {
          expect(
            ["background", "background-color", "background-image", "backdrop-filter", "-webkit-backdrop-filter"].includes(prop),
            `${file} 的 ${cls} 又声明了 ${prop}: ${value} —— 它会覆盖共享的 .${SURFACE_CLASS}，① 的结论对这一处就作废了`,
          ).toBe(false);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 常量对比 —— 在①成立的前提下，对比度是一个可校核的数
// ═══════════════════════════════════════════════════════════════════════════════
describe("#104 ②常量对比 · 主文字对浮层表面达 WCAG AA，且三种底色下同一个数", () => {
  it.each(THEMES)("%s 主题：contrast(--txt, 表面) ≥ 4.5 且不随底色变化", (theme) => {
    const v = judgeSurface(SURFACE_CLASS, theme);
    expect(v.backdropIndependent, `[${theme}] ① 未通过，② 无从谈起：${v.reasons.join(" / ")}`).toBe(true);
    const surface = v.solid!;
    const txt = parseColor(resolveVars("var(--txt)", TOKENS[theme]))!;

    const ratios = backdrops(theme).map(([, bd]) => contrast(txt, composite(surface, bd)));
    const spread = Math.max(...ratios) - Math.min(...ratios);
    expect(spread, `[${theme}] --txt 的对比度随底色在 ${ratios.map((r) => r.toFixed(2)).join(" / ")} 之间漂移 —— 说明底下的内容仍在参与成像`).toBeCloseTo(0, 6);

    const ratio = ratios[0]!;
    expect(ratio, `[${theme}] 浮层主文字 --txt 对表面 ${fmt(surface)} 只有 ${ratio.toFixed(2)}:1，低于 WCAG AA 4.5:1（浮层是 11–12px 小字，不能吃 3:1 的大字豁免）`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("%s 主题：浮层表面不比普通卡面 --panel 更难读（非退化）", (theme) => {
    const surface = judgeSurface(SURFACE_CLASS, theme).solid!;
    const card = parseColor(resolveVars("var(--panel)", TOKENS[theme]))!;
    for (const name of ["--txt", "--muted", "--muted2"] as const) {
      const fg = parseColor(resolveVars(`var(${name})`, TOKENS[theme]))!;
      const onPop = contrast(fg, surface);
      const onCard = contrast(fg, card);
      expect(
        onPop,
        `[${theme}] ${name} 在浮层上 ${onPop.toFixed(2)}:1，比在普通卡面上 ${onCard.toFixed(2)}:1 还差 —— 浮层不该是更难读的地方`,
      ).toBeGreaterThanOrEqual(onCard - 1e-9);
    }
  });

  // 诚实边界：把本门**不**保证的那部分数算出来摆着，不粉饰。
  it("诚实记录：次要文字 token 对浮层表面的实际比值（warm 的 muted/muted2 系全主题既有欠账，非本 WO 引入）", () => {
    const report: string[] = [];
    for (const theme of THEMES) {
      const surface = judgeSurface(SURFACE_CLASS, theme).solid!;
      const line = (["--txt", "--muted", "--muted2"] as const)
        .map((n) => `${n} ${contrast(parseColor(resolveVars(`var(${n})`, TOKENS[theme]))!, surface).toFixed(2)}`)
        .join(" · ");
      report.push(`${theme}: ${line}`);
    }
    // 断言只咬「本 WO 负责的那条」：三套主题的 --txt 都达 AA。muted/muted2 只登记不判决。
    for (const theme of THEMES) {
      const surface = judgeSurface(SURFACE_CLASS, theme).solid!;
      const txt = parseColor(resolveVars("var(--txt)", TOKENS[theme]))!;
      expect(contrast(txt, surface), `实测记录：\n  ${report.join("\n  ")}`).toBeGreaterThanOrEqual(4.5);
    }
    // warm 的 --muted2 对**任何**白面都是 1.86 —— 记在案，属 tokens.css [data-theme="warm"] 的全局欠账。
    const warmSurface = judgeSurface(SURFACE_CLASS, "warm").solid!;
    const warmMuted2 = contrast(parseColor(resolveVars("var(--muted2)", TOKENS.warm))!, warmSurface);
    expect(warmMuted2, "warm --muted2 的数值若变了，说明有人动了 warm 全局文字 token —— 那是另一张单，请同步这条记录").toBeLessThan(4.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 接缝 —— 真渲染出来的浮层节点，真戴着①②校过的那张表面
//    （少这一层，上面全是在证明一条没人用的 CSS 规则 = 本仓已知假绿形态）
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * 抽出每个 `role="tooltip"` 所在的那个 JSX **开标签**原文。
 * 为什么不整文件 grep：同一个文件里既有浮层（该换表面）也有普通卡（该继续吃 .panel），
 * 整文件 grep 会把两者混为一谈 —— 那正是"改错地方"的入口。
 */
function tooltipOpeningTags(src: string): string[] {
  const out: string[] = [];
  const MARK = 'role="tooltip"';
  let idx = src.indexOf(MARK);
  while (idx >= 0) {
    let start = idx;
    while (start > 0 && src[start] !== "<") start--;
    let depth = 0;
    let end = src.length - 1;
    for (let i = start; i < src.length; i++) {
      const ch = src[i]!;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    out.push(src.slice(start, end + 1));
    /*
     * ⚠ 必须**保证前进**（2026-08-10 实测：这里会死循环，本仓「工具坏了不是代码脏了」的又一例）。
     *
     * 病样：`components/InfoPopover.tsx` 的文档注释里写了 `SVG <title>` 这几个字（`InfoPopover.tsx:33`
     * 的规格说明就是一例），位置在同文件某句提到 `role="tooltip"` 的**前面**。于是：
     *   · 从 MARK 往回找最近的 `<` ⇒ 落到注释里那个 `<title>` 的 `<`（本函数不跳注释）；
     *   · 往前找深度 0 的 `>` ⇒ 找到 `<title>` 自己的 `>`，它**在 idx 之前**；
     *   · `idx = indexOf(MARK, end + 1)` ⇒ end+1 仍 ≤ idx ⇒ **找回同一个 idx**，永不前进。
     * 后果不是报错，是**跑满 191 秒后 `out` 撑到 2^32 抛 RangeError: Invalid array length**
     * ——一条本该 1 秒的静态扫描门，坏成了看起来像"超时/卡死"的样子；
     * 这不是断言失败，是扫描器自己不收敛，表现为整份测试文件炸掉，看上去像"浮层测试挂了"。
     *
     * 判据（照铁律 0.6）：**扫描器的游标必须单调前进，不能由被扫内容决定**。
     * 至少跳过本次命中的 MARK 自身；`end` 更靠后时按 `end` 走。
     *
     * 修法只保证**前进**，不改判据：注释里那一处照样被访问一次（切出的片段不含 `title=` 属性、
     * 自然通过），真正的 JSX（`:101`）随后照常被检查 —— 变异反证已证明它仍然有牙。
     */
    idx = src.indexOf(MARK, Math.max(end + 1, idx + MARK.length));
  }
  return out;
}

/** 递归列出目录下所有 .tsx（不进 node_modules）。 */
function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTsx(abs));
    else if (e.name.endsWith(".tsx")) out.push(abs);
  }
  return out;
}

function expectWearsSurface(el: HTMLElement, who: string) {
  expect(el.classList.contains(SURFACE_CLASS), `${who} 没戴 .${SURFACE_CLASS} —— 上面的遮蔽性/对比度结论对它不成立。实际 class="${el.className}"`).toBe(true);
  expect(el.classList.contains("panel"), `${who} 仍戴着磨砂玻璃 .panel（半透 + backdrop-blur）—— 正是 #104 的病`).toBe(false);
}

const GA: GapAttrOutput = {
  rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
  levels: [
    {
      depth: 3,
      label: "因果链（caused_by）",
      nodes: [
        {
          id: "cf:cf-upstream-cut",
          factor: "上游减供",
          contribution: 2.4,
          unit: "%",
          share: 0.44,
          provenance: { kind: "实测", drillType: "Supplier", drillId: "sup-1", drillField: "actualSupplyTon", drillValue: 820 },
        },
      ],
    },
  ],
  causalEdges: [],
  atomicLeaves: [],
};

describe("#104 ③接缝 · 五处溯源浮层的 DOM 节点真戴着这张表面", () => {
  it("<Provenance> 结论数字浮层（prov-tip）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(
      <AppProviders>
        <Provenance testId="p104" src="affected_orders" formula="缺口 = 需求 − 供给" inputs={["qty"]}>
          <b>123</b>
        </Provenance>
      </AppProviders>,
    );
    await user.hover(screen.getByTestId("prov-v-p104"));
    expectWearsSurface(await screen.findByTestId("prov-tip"), "prov-tip");
  });

  it("<RuleRef> 两跳第二跳浮层（ruleref-pop）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(
      <AppProviders>
        <RuleRef code="C13" />
      </AppProviders>,
    );
    await user.hover(screen.getByTestId("ruleref-C13"));
    expectWearsSurface(await screen.findByTestId("ruleref-pop"), "ruleref-pop");
  });

  it("<ProvenanceDag> 因果树节点浮层（prov-tip-<id>）", async () => {
    const user = userEvent.setup();
    render(<ProvenanceDag data={gapAttributionToDag(GA)} />);
    await user.hover(screen.getByTestId("prov-hover-kpi:seg_attain_ess"));
    expectWearsSurface(await screen.findByTestId("prov-tip-kpi:seg_attain_ess"), "prov-tip-kpi:seg_attain_ess");
  });

  it("全局唯一溯源弹窗（prov-popover · 走 portal 挂 body）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    function Opener() {
      const { open } = useProvenance();
      return (
        <button
          data-testid="p104-open"
          onClick={() =>
            open({ provId: "pv-1", taskId: "task-104", rect: { top: 10, left: 10, bottom: 20, right: 40 } }, true)
          }
        >
          开
        </button>
      );
    }
    render(
      <AppProviders>
        <Opener />
      </AppProviders>,
    );
    await user.click(screen.getByTestId("p104-open"));
    expectWearsSurface(await screen.findByTestId("prov-popover"), "prov-popover");
  });

  it("年度方案「决策依据」浮层（dec-prov-pop）—— 视图太重不整页渲染，改咬挂载点源码", () => {
    const tsx = readRepo("apps/frontend-shell/src/views/plan/AnnualScenarioView.tsx");
    const line = tsx.split("\n").find((l) => l.includes('data-testid="dec-prov-pop"'));
    expect(line, "AnnualScenarioView.tsx 里找不到 dec-prov-pop 挂载点").toBeTruthy();
    expect(line!, `dec-prov-pop 的挂载点没戴 ${SURFACE_CLASS}：${line}`).toContain(SURFACE_CLASS);
  });

  it("五处溯源浮层的 JSX 开标签都戴 popover-surface，且没有任何 role=\"tooltip\" 还挂在 .panel 上", () => {
    // 只咬 role="tooltip" 的那个开标签本身 —— 不能整文件 grep：
    // ProvenanceDag 里 `dag-node-*` 卡片用的就是 .panel，那是**贴在页面上的卡**，不是浮层，本来就该继续吃玻璃。
    const suspects = [
      "apps/frontend-shell/src/components/Provenance.tsx",
      "apps/frontend-shell/src/components/RuleRef.tsx",
      "apps/frontend-shell/src/components/ProvenanceDag.tsx",
      "apps/frontend-shell/src/components/Provenance/ProvenancePopover.tsx",
      "apps/frontend-shell/src/views/plan/AnnualScenarioView.tsx",
    ];
    for (const f of suspects) {
      const tags = tooltipOpeningTags(readRepo(f));
      expect(tags.length, `${f} 里找不到 role="tooltip" 的浮层开标签`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag.includes(SURFACE_CLASS), `${f} 的浮层开标签没戴 ${SURFACE_CLASS}：\n${tag}`).toBe(true);
        expect(/className="panel"/.test(tag), `${f} 的浮层开标签仍是磨砂玻璃 .panel：\n${tag}`).toBe(false);
      }
    }
  });

  it("全仓（frontend src）没有任何 role=\"tooltip\" 还直接挂 className=\"panel\"", () => {
    const files = listTsx(join(REPO_ROOT, "apps/frontend-shell/src"));
    let scanned = 0;
    for (const abs of files) {
      for (const tag of tooltipOpeningTags(readFileSync(abs, "utf8"))) {
        scanned++;
        expect(/className="panel"/.test(tag), `${abs} 的 role="tooltip" 浮层挂在磨砂玻璃 .panel 上：\n${tag}`).toBe(false);
      }
    }
    expect(scanned, "一个 role=\"tooltip\" 都没扫到 → 扫描器坏了，这条断言是哑的").toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 反面锚 —— 判据自己先被证明咬得住（喂旧表面 .panel 的**活定义**，必须判红）
// ═══════════════════════════════════════════════════════════════════════════════
describe("#104 ④反面锚 · 同一套判据喂给旧表面 .panel 必须判红", () => {
  it("暗色：.panel（--panel-glass 半透 + backdrop-filter）被判为「遮不住」", () => {
    const v = judgeSurface("panel", "dark");
    expect(
      v.backdropIndependent,
      "判据没咬住 .panel —— 那它也证明不了 .popover-surface 的通过有意义（哑门）。当前收到的理由：" + JSON.stringify(v.reasons),
    ).toBe(false);
    expect(v.reasons.join(" | ")).toMatch(/alpha=|backdrop-filter/);
  });

  it("暖砂：theme-warm.css 把 .panel 覆写成 rgba(255,255,255,.55)，同样被判红", () => {
    const v = judgeSurface("panel", "warm");
    expect(v.backdropIndependent, "warm 下的 .panel 覆盖没被判据看见（说明多表覆盖没被收集全）").toBe(false);
  });

  it("量化旧病：.panel 上 --txt 的对比度随底色从 9.19 掉到 1.01（暗色）—— 这就是「看不清」的数字形态", () => {
    // 直接用仓里 .panel 的活定义算，不抄常量。
    const bgDecl = ALL_RULES.filter((r) => r.selector.split(",").some((s) => s.trim() === ".panel"))
      .flatMap((r) => declarations(r.body))
      .filter(([p]) => p === "background" || p === "background-color")
      .at(-1)!;
    const veil = parseColor(resolveVars(bgDecl[1], TOKENS.dark))!;
    expect(veil.a).toBeLessThan(1);
    const txt = parseColor(resolveVars("var(--txt)", TOKENS.dark))!;
    const onEmpty = contrast(txt, composite(veil, parseColor(resolveVars("var(--bg)", TOKENS.dark))!));
    const onGlyph = contrast(txt, composite(veil, txt)); // 浮层正好压在底层正文的字形像素上
    expect(onEmpty).toBeGreaterThan(4.5); // 空白处看着没问题 —— 所以这病肉眼抽查很容易漏
    expect(onGlyph, `压在底层字形上应当远低于 AA，实测 ${onGlyph.toFixed(2)}:1`).toBeLessThan(1.5);
    // 同一句文字、同一套配色，只因底下是什么而差了这么多 —— 这正是"对比度不再由设计决定"。
    expect(onEmpty / onGlyph).toBeGreaterThan(5);
  });

  it("合成函数本身可信：alpha=1 恒等、alpha=0 全透（判据的地基不能是错的）", () => {
    const s = { r: 20, g: 30, b: 40, a: 1 };
    const b = { r: 200, g: 210, b: 220, a: 1 };
    expect(composite(s, b)).toEqual({ ...s, a: 1 });
    expect(composite({ ...s, a: 0 }, b)).toEqual({ ...b, a: 1 });
    // WCAG 锚点：纯黑对纯白 = 21:1
    expect(contrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(21, 5);
  });

  it("fail-closed：渐变 / 未定义 token 一律判红（绕不过去）", async () => {
    expect(parseColor("linear-gradient(165deg, #111, #222)")).toBeNull();
    expect(parseColor(resolveVars("var(--nope-not-a-token)", TOKENS.dark))).toBeNull();
    expect(parseColor("color-mix(in srgb, #fff 50%, #000)")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. token 纪律 —— 零硬编码颜色 + 用到的 token 都在 :root（三套主题都取得到值）
// ═══════════════════════════════════════════════════════════════════════════════
describe("#104 ⑤ token 纪律 · 浮层样式零硬编码颜色", () => {
  it(`.${SURFACE_CLASS} 与两个几何类里没有 hex / rgb / hsl 字面量`, () => {
    const targets = ALL_RULES.filter((r) =>
      r.selector.split(",").some((s) => [`.${SURFACE_CLASS}`, ".pop", ".decProv"].includes(s.trim())),
    );
    expect(targets.length).toBeGreaterThanOrEqual(3);
    for (const r of targets) {
      expect(r.body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${r.file} :: ${r.selector.trim()} 里有硬编码 hex`).toEqual([]);
      expect(r.body.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], `${r.file} :: ${r.selector.trim()} 里有硬编码 rgb/hsl`).toEqual([]);
    }
  });

  it("浮层组件的内联样式里不再有硬编码 boxShadow rgba（改由 --popover-shadow 随主题走）", () => {
    for (const f of [
      "apps/frontend-shell/src/components/Provenance.tsx",
      "apps/frontend-shell/src/components/RuleRef.tsx",
      "apps/frontend-shell/src/components/ProvenanceDag.tsx",
    ]) {
      const src = readRepo(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(/boxShadow:\s*"[^"]*rgba?\(/.test(src), `${f} 内联 boxShadow 里仍有硬编码 rgba`).toBe(false);
    }
  });

  it("--popover-surface / --popover-shadow 都定义在 tokens.css 的 :root（否则某套主题下取不到值）", () => {
    const tokens = stripComments(readRepo("apps/frontend-shell/src/styles/tokens.css"));
    const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)![1]!;
    const rootTokens = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
    for (const t of ["--popover-surface", "--popover-shadow"]) {
      expect(rootTokens.has(t), `${t} 不在 tokens.css 的 :root 基座里`).toBe(true);
    }
    // 三套主题各自都能解析出实色表面
    for (const theme of THEMES) {
      expect(parseColor(resolveVars("var(--popover-surface)", TOKENS[theme])), `${theme} 主题解析 --popover-surface 失败`).not.toBeNull();
    }
  });
});
