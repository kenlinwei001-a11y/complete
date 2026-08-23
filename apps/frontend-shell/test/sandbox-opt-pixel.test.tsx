import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ParetoObjective, ParetoResult, ParetoSolution } from "@platform/contracts";
import { loginAs, renderWithClient } from "./utils";
import { SandboxOpt } from "@/views/sim/console/SandboxOpt";
import {
  PARETO_GEOM,
  PLACEHOLDER_OPT_MODEL,
  frontierYAt,
  projectPareto,
  scaleX,
  scaleY,
  type OptAxis,
} from "@/views/sim/console/useParetoFrontier";
import styles from "@/views/sim/console/SandboxOpt.module.css";

/**
 * WO-SIM-FE-OPT · **像素测 + 几何测**（本单头号判据）。
 *
 * ── 这个文件在测什么 ────────────────────────────────────────────────────────
 * 规格 = `docs/ux-spec/sandbox/sandbox-opt.html`（可执行规格）。
 * 本测试**不在自己身上抄任何一个版面数** —— 每一个尺寸期望值都是**现从规格 HTML 解析**的
 * （`specDecl(".row1","height")` …）。所以：组件改歪 ⇒ 红；规格改了组件没跟 ⇒ 红；
 * 测试自己抄错一个数 ⇒ 不可能，因为它一个版面数都没抄。
 *
 * ── 五条 ───────────────────────────────────────────────────────────────────
 *  ⓪ 三把尺子先自证（铁律 0.6：扫描类结论一律先跑金丝雀）
 *  ① 关键盒子计算尺寸 == 规格声明值
 *  ② **散点几何**：每个被支配点的屏幕 y **小于**同 x 处前沿折线的 y（= 在上方）——**逐点**，不抽查
 *  ③ 色值走 token（认 `var(--X)` 或 `var(--X-txt)`）
 *  ④ 目标方向来自 `objectives[].dir`：喂一个 `dir:"max"` 的目标，坐标映射当场翻面
 *  ⑤ 变异反证：把 `scaleY` 的符号取反 ⇒ ② 当场红（红的原文贴在交单报告里）
 *
 * ── 诚实边界（免得绿灯被读成"像素级都验过了"）────────────────────────────────
 * jsdom **不做布局**：`getComputedStyle` 给的是**层叠后声明生效的值**，不是排版后的盒子。
 * 所以 ① 断言的是「这些盒子的**声明尺寸**与规格逐字节相同」，**不是**「真浏览器里排出来
 * 是这个像素」。后者由交单报告里的 headless-Chromium 逐像素比对负责，两把尺子各管一段。
 * ② / ④ / ⑤ 则与浏览器无关：它们测的是**纯函数**，jsdom 的布局盲区碰不到它们。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..", "..");
const SPEC_HTML = join(REPO_ROOT, "docs", "ux-spec", "sandbox", "sandbox-opt.html");
const SRC_DIR = join(TEST_DIR, "..", "src", "views", "sim", "console");
const MODULE_CSS = join(SRC_DIR, "SandboxOpt.module.css");
const TOKENS_CSS = join(TEST_DIR, "..", "src", "styles", "tokens.css");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 规格 HTML 的 `<style>` 正文（**唯一版面期望值来源**）。 */
function specCss(): string {
  const html = readFileSync(SPEC_HTML, "utf8");
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (m === null) throw new Error("规格 HTML 里没有 <style> —— 尺子坏了，不是组件有问题");
  return stripComments(m[1] as string);
}

/** 取「选择器 `sel` 的 `prop` 声明值」。只认逗号列表里**整项等于** `sel` 的规则。 */
function declIn(css: string, sel: string, prop: string): string | undefined {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let found: string | undefined;
  while ((m = re.exec(css)) !== null) {
    const selectors = (m[1] as string).split(",").map((s) => s.trim());
    if (!selectors.includes(sel)) continue;
    for (const d of (m[2] as string).split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      if (d.slice(0, i).trim() === prop) found = d.slice(i + 1).trim();
    }
  }
  return found;
}

const SPEC = specCss();
const MODULE = stripComments(readFileSync(MODULE_CSS, "utf8"));
const specDecl = (sel: string, prop: string) => declIn(SPEC, sel, prop);
const moduleDecl = (sel: string, prop: string) => declIn(MODULE, sel, prop);

/** 规格 `:root` 的调色板（`--ink` / `--red` …）—— 用来证明 token 真值 == 规格真值。 */
function specPalette(): Record<string, string> {
  const out: Record<string, string> = {};
  const m = /:root\{([^}]*)\}/.exec(SPEC);
  for (const d of (m?.[1] ?? "").split(";")) {
    const i = d.indexOf(":");
    if (i > 0 && d.trim().startsWith("--")) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}

/** 把 CSS Module 原文的类选择器改写成 vitest 代理给的名字，再注入 jsdom（`css:false` 下必需）。 */
function injectStyles(): { rewritten: string; classNames: string[] } {
  const names = new Set<string>();
  const rewritten = MODULE.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (whole, name: string) => {
    const mapped = (styles as Record<string, string>)[name];
    if (mapped === undefined) return whole;
    names.add(name);
    return `.${mapped}`;
  });
  const tokens = document.createElement("style");
  tokens.textContent = readFileSync(TOKENS_CSS, "utf8");
  document.head.appendChild(tokens);
  const sheet = document.createElement("style");
  sheet.textContent = rewritten;
  document.head.appendChild(sheet);
  return { rewritten, classNames: [...names] };
}

const px = (el: Element, prop: "height" | "width") => getComputedStyle(el as HTMLElement)[prop];
const cls = (k: string) => (styles as Record<string, string>)[k] as string;
const bySel = (sel: string) => document.querySelector(sel) as HTMLElement | null;

let injected: { rewritten: string; classNames: string[] };
beforeAll(() => {
  injected = injectStyles();
});
beforeEach(() => {
  loginAs("planner");
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════
// 几何测的夹具 —— **真被支配**（逐对可验），不是"看起来在上方"
// ══════════════════════════════════════════════════════════════════════════

const OBJ_MIN_MIN: ParetoObjective[] = [
  { key: "days", dir: "min", label: "全链非增值", unit: "D" },
  { key: "cost", dir: "min", label: "外协兜底成本", unit: "¥万" },
];

const sol = (id: string, days: number, cost: number): ParetoSolution => ({
  id,
  label: id,
  levers: [{ key: "lever.a", value: days }],
  metrics: { days, cost },
  bindings: [],
  feasible: true,
});

/**
 * 前沿 3 点（两两互不支配）+ 6 个**逐目标都被某个前沿点严格压住**的解。
 *
 * ⚠ 夹具刻意做成**两目标都严格更差**，而不是「一项相等一项更差」的弱支配 ——
 * 弱支配（如 `(30,0)` 被 `(22,0)` 支配）在几何上会**恰好落在前沿折线上**（y 相等），
 * 那时"在前沿之上"只能写成 `≤`。本单的验收线写的是**严格小于**，所以夹具必须给严格支配。
 * 首版夹具正是拿弱支配点去要严格不等式，被这条用例当场报红逼了回来（机器先说话）。
 */
const FRONTIER = [sol("F1", 14, 12), sol("F2", 18, 6), sol("F3", 22, 0)];
const DOMINATED = [
  sol("D1", 30, 3), // 被 F3(22,0) 严格支配
  sol("D2", 26, 4), // 被 F3 严格支配
  sol("D3", 24, 8), // 被 F2(18,6) 严格支配
  sol("D4", 20, 9), // 被 F2 严格支配
  sol("D5", 19, 13), // 被 F1(14,12) 严格支配
  sol("D6", 16, 14), // 被 F1 严格支配
];

const RESULT: ParetoResult = {
  objectives: OBJ_MIN_MIN,
  frontier: FRONTIER,
  dominated: DOMINATED,
  iterations: 9,
  residual: 0,
};

/** 独立判官：`a` 是否逐目标不劣于 `b` 且至少一项严格更优（**不复用生产实现**）。 */
function dominates(a: ParetoSolution, b: ParetoSolution, objs: readonly ParetoObjective[]): boolean {
  let strict = false;
  for (const o of objs) {
    const va = a.metrics[o.key] as number;
    const vb = b.metrics[o.key] as number;
    const better = o.dir === "min" ? va < vb : va > vb;
    const worse = o.dir === "min" ? va > vb : va < vb;
    if (worse) return false;
    if (better) strict = true;
  }
  return strict;
}

/**
 * 「每个被支配点都在前沿折线之上」的逐点判据。
 * 抽出来是为了让 ② 与 ⑤（变异反证）**咬的是同一份实现** —— 各抄一份就是装饰品。
 */
function liftReport(
  frontier: readonly { x: number; y: number }[],
  dominated: readonly { id: string; x: number; y: number }[],
): { id: string; y: number; frontY: number; lift: number }[] {
  return dominated.map((d) => {
    const fy = frontierYAt(d.x, frontier);
    return { id: d.id, y: d.y, frontY: fy, lift: fy - d.y };
  });
}

const screenOf = (s: ParetoSolution, axes: readonly [OptAxis, OptAxis]) => ({
  id: s.id,
  x: scaleX(s.metrics[axes[0].key] as number, axes[0]),
  y: scaleY(s.metrics[axes[1].key] as number, axes[1]),
});

describe("WO-SIM-FE-OPT · 规格 1:1 + 散点几何（版面期望值全部现从 sandbox-opt.html 解析）", () => {
  it("⓪ 三把尺子先自证（金丝雀不中 ⇒ 报「尺子坏了」，不许报「代码没问题」）", () => {
    // ① 规格解析器：已知必中 / 已知必不中 / 不误命中后代选择器。
    expect(specDecl(".row1", "height"), "规格里 .row1 的 height 解析不到 ⇒ 解析器坏了").toBeTruthy();
    expect(specDecl(".grid", "grid-template-columns")).toBeTruthy();
    expect(specDecl(".no-such-selector-xyz", "height")).toBeUndefined();
    expect(specDecl(".tt", "font-size")).toBeUndefined();
    expect(specDecl(".tt b", "font-size")).toBe("14px");

    // ② 类名映射：改写真的发生了，且样式表真的挂到了元素上。
    expect(injected.classNames).toContain("row1");
    expect(injected.rewritten).toContain(`.${cls("row1")}`);
    expect(injected.rewritten).not.toMatch(/(^|[\s,>])\.row1[\s{,]/);
    renderWithClient(<SandboxOpt />);
    // 已知必中：`.left` 声明 width:272px。
    expect(px(screen.getByTestId("sandbox-opt-left"), "width")).toBe("272px");
    // 已知必不中：没有规则给 `.row1` 宽度（证明不是"什么都返回 272"）。
    expect(px(screen.getByTestId("sandbox-opt-row1"), "width")).not.toBe("272px");

    // ③ 支配判官（②/④ 的前提）：夹具里 6 个被支配解**确实**各自被某个前沿解支配，
    //    且前沿 3 点两两互不支配。判官报错 ⇒ 夹具坏了，不是组件坏了。
    for (const d of DOMINATED) {
      expect(FRONTIER.some((f) => dominates(f, d, OBJ_MIN_MIN)), `夹具 ${d.id} 并没有被任何前沿解支配`).toBe(true);
    }
    for (const a of FRONTIER) for (const b of FRONTIER) if (a.id !== b.id) expect(dominates(a, b, OBJ_MIN_MIN)).toBe(false);
  });

  it("① 关键盒子的计算尺寸 == 规格声明值（.row1 / 三栏 / .bot / .grid / 行高）", () => {
    renderWithClient(<SandboxOpt />);

    expect(px(screen.getByTestId("sandbox-opt-row1"), "height")).toBe(specDecl(".row1", "height"));
    expect(px(screen.getByTestId("sandbox-opt-left"), "width")).toBe(specDecl(".left", "width"));
    expect(px(screen.getByTestId("sandbox-opt-right"), "width")).toBe(specDecl(".right", "width"));
    expect(px(screen.getByTestId("sandbox-opt-bot"), "height")).toBe(specDecl(".bot", "height"));
    expect(px(screen.getByTestId("sandbox-opt-grid"), "height")).toBe(specDecl(".grid", "height"));
    // 画布本体 1440×897（规格 `.app`）。
    expect(px(screen.getByTestId("sandbox-opt"), "width")).toBe(specDecl(".app", "width"));
    expect(px(screen.getByTestId("sandbox-opt"), "height")).toBe(specDecl(".app", "height"));

    // 行高 18：甘特的**每一行**（不是抽查一行）与表头格；约束表每一行 19。
    const rowH = specDecl(".gcell", "height");
    expect(rowH).toBe(specDecl(".gr", "height")); // 规格自身两处一致，先证明这一点
    expect(rowH).toBe(specDecl(".gcap", "height"));
    expect(rowH).toBe(specDecl(".lh", "height"));
    for (const el of document.querySelectorAll(`.${cls("gcell")}`)) expect(px(el, "height")).toBe(rowH);
    for (const el of document.querySelectorAll(`.${cls("gr")}`)) expect(px(el, "height")).toBe(rowH);
    expect(document.querySelectorAll(`.${cls("gcell")}`).length).toBeGreaterThan(0); // 反「零元素也全过」
    const cstH = specDecl(".cst .r", "height");
    for (const el of document.querySelectorAll(`.${cls("cst")} .${cls("r")}`)) expect(px(el, "height")).toBe(cstH);
    expect(document.querySelectorAll(`.${cls("cst")} .${cls("r")}`).length).toBeGreaterThan(0);
    // 段片高度（规格 `.sg`）。
    for (const el of document.querySelectorAll(`.${cls("sg")}`)) expect(px(el, "height")).toBe(specDecl(".sg", "height"));
    expect(document.querySelectorAll(`.${cls("sg")}`).length).toBeGreaterThan(0);

    // jsdom 的 cssstyle 不支持 grid/flex 简写的 computed 取值，那几条改用**声明比对**
    // （第二把尺子：值仍来自同一份规格，只是取的位置不同，不是降低标准）。
    for (const [sel, prop] of [
      [".grid", "grid-template-columns"],
      [".kv", "grid-template-columns"],
      [".kv", "gap"],
      [".cst .r", "grid-template-columns"],
      [".pc .r2", "grid-template-columns"],
      [".main", "padding"],
      [".main", "gap"],
      [".row1", "gap"],
      [".rail", "width"],
      [".rad", "height"],
      [".plist", "padding"],
      [".pc", "padding"],
      [".pc .r1", "padding-left"],
      [".abtn", "margin"],
      [".sel", "margin"],
      [".pc .bars s", "width"],
      [".pc .bars s", "height"],
    ] as const) {
      expect(moduleDecl(sel, prop), `${sel}{${prop}} 与规格不一致`).toBe(specDecl(sel, prop));
    }

    // 散点的 viewBox 与几何常量也照规格（规格 `#pf` 的 viewBox 与 `X0/X1/Y0/Y1`）。
    const specSrc = readFileSync(SPEC_HTML, "utf8");
    expect(screen.getByTestId("sandbox-opt-pareto").getAttribute("viewBox")).toBe(
      `0 0 ${PARETO_GEOM.vbW} ${PARETO_GEOM.vbH}`,
    );
    expect(specSrc, "规格里 #pf 的 viewBox 变了 ⇒ 组件几何常量要跟").toContain(
      `<svg id="pf" viewBox="0 0 ${PARETO_GEOM.vbW} ${PARETO_GEOM.vbH}">`,
    );
    expect(specSrc, "规格里 #pf 的 X0/X1/Y0/Y1 变了 ⇒ PARETO_GEOM 要跟").toContain(
      `X0=${PARETO_GEOM.X0},X1=${PARETO_GEOM.X1},Y0=${PARETO_GEOM.Y0},Y1=${PARETO_GEOM.Y1}`,
    );
  });

  it("② 散点几何：每个被支配点的屏幕 y 都 **小于** 同 x 处前沿折线的 y（逐点，不抽查）", () => {
    // ── (a) 真数据形态：端点回包 → 视图模型 → 逐点断言 ──────────────────────
    const model = projectPareto(RESULT, "multi_objective");
    const axes = model.axes as readonly [OptAxis, OptAxis];
    const fpts = FRONTIER.map((s) => screenOf(s, axes)).sort((a, b) => a.x - b.x);
    const dpts = DOMINATED.map((s) => screenOf(s, axes));
    const report = liftReport(fpts, dpts);
    expect(report.length).toBe(DOMINATED.length); // 反「零元素也全过」
    for (const r of report) {
      expect(
        r.y,
        `被支配点 ${r.id} 的屏幕 y=${r.y} 不小于同 x 处前沿的 y=${r.frontY} —— 它被画到了前沿【下方】，` +
          `那等于「比最优解还优」，是不存在的点`,
      ).toBeLessThan(r.frontY);
    }
    // 前沿点自己必须**落在**折线上（差 < 1e-9），不是"大致附近"。
    for (const f of fpts) expect(Math.abs(frontierYAt(f.x, fpts) - f.y)).toBeLessThan(1e-9);

    // ── (b) 规格占位数：同一条不变量，同一份实现，逐点再验一遍 ────────────────
    const pax = PLACEHOLDER_OPT_MODEL.axes;
    const pf = PLACEHOLDER_OPT_MODEL.frontier
      .map((c) => ({
        id: c.id,
        x: scaleX(c.metrics[pax[0].key] as number, pax[0]),
        y: scaleY(c.metrics[pax[1].key] as number, pax[1]),
      }))
      .sort((a, b) => a.x - b.x);
    const pd = PLACEHOLDER_OPT_MODEL.dominated.map((c) => ({
      id: c.id,
      x: scaleX(c.metrics[pax[0].key] as number, pax[0]),
      y: scaleY(c.metrics[pax[1].key] as number, pax[1]),
    }));
    expect(pd.length).toBeGreaterThan(0);
    for (const r of liftReport(pf, pd)) {
      expect(r.y, `占位被支配点 ${r.id} 落到了前沿下方（y=${r.y} · 前沿 y=${r.frontY}）`).toBeLessThan(r.frontY);
    }

    // ── (c) 屏上真渲染的圆点也守这条（不是只有纯函数守）─────────────────────
    renderWithClient(<SandboxOpt />);
    const doms = [...document.querySelectorAll('[data-testid^="sandbox-opt-dom-"]')];
    expect(doms.length).toBe(PLACEHOLDER_OPT_MODEL.dominated.length);
    for (const el of doms) {
      const y = Number(el.getAttribute("data-y"));
      const fy = Number(el.getAttribute("data-front-y"));
      expect(y, `屏上 ${el.getAttribute("data-testid")} 画在了前沿下方`).toBeLessThan(fy);
    }
  });

  it("③ 色值走 token：computed 拿到的是 var() 引用，且 token 真值 == 规格调色板真值", () => {
    renderWithClient(<SandboxOpt />);
    const palette = specPalette();
    const rootStyle = getComputedStyle(document.documentElement);
    const tokenValue = (t: string) => rootStyle.getPropertyValue(t).trim();

    // 金丝雀：色值扫描正则先拿已知样本跑（3 个字面色），命中数不对 ⇒ 尺子坏了。
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g;
    expect("color:#E0626C;background:rgba(0,0,0,.5);border:1px solid hsl(200 50% 50%)".match(LITERAL)).toHaveLength(3);

    // 抽查三处，三种承载方式各一个（CSS 类 / CSS 类 + 状态 / SVG inline style）。
    const samples: { el: HTMLElement | null; prop: "color" | "fill" | "stroke"; token: string; specVar: string }[] = [
      { el: bySel(`.${cls("mb")}`), prop: "color", token: "--muted", specVar: "--dim" },
      { el: bySel(`.${cls("gcell")}.${cls("dn")}`), prop: "color", token: "--ok", specVar: "--grn" },
      { el: screen.getByTestId("sandbox-opt-frontier-line"), prop: "stroke", token: "--c-capacity", specVar: "--cy" },
    ];
    // jsdom 的 cssstyle 对 SVG presentation 属性（`stroke`/`fill`）的 computed 支持不全，
    // 取不到就回落读 inline `style` —— 两条路取的都是**同一个声明**，不是换一把宽松的尺子。
    const styleOf = (el: HTMLElement, prop: string): string =>
      getComputedStyle(el).getPropertyValue(prop) || el.style.getPropertyValue(prop);
    for (const s of samples) {
      expect(s.el, `抽查元素不存在（${s.token}）`).not.toBeNull();
      const got = styleOf(s.el as HTMLElement, s.prop);
      expect(got.match(LITERAL) ?? [], `${s.token} 处写了字面色值`).toEqual([]);
      // 允许 `--X` 或其**文字安全同族** `--X-txt`（派单硬约束 ③ / 审核方 2026-08-21 裁决）：
      // `check-text-legibility` 判据 A 在本目录按 12px 判、要 6.0:1，而 `--c-capacity`
      // 当正文色在亮色主题下只有 2.06:1。故正文取 `-txt`、边框填充取本色，两者语义不同。
      const used = got.trim();
      expect([`var(${s.token})`, `var(${s.token}-txt)`], `${s.token} 处用了非同族 token：${used}`).toContain(used);
      const actualToken = used.slice(4, -1);
      expect(tokenValue(actualToken), `${actualToken} 在 :root 上解析不到`).not.toBe("");
      if (actualToken === s.token) {
        expect(tokenValue(s.token).toLowerCase()).toBe((palette[s.specVar] ?? "").toLowerCase());
      }
    }

    // 本单五个源文件里**一个字面色值都没有**（三套主题自动跟随的机械保证）。
    // 注：注释里记录色值映射表是允许的，故扫的是**剥注释后**的正文。
    for (const f of [
      "SandboxOpt.tsx",
      "SandboxOpt.module.css",
      "SandboxOptRoute.tsx",
      "ParetoChart.tsx",
      "TradeoffRadar.tsx",
      "useParetoFrontier.ts",
    ]) {
      const body = stripComments(readFileSync(join(SRC_DIR, f), "utf8")).replace(/^\s*\/\/.*$/gm, "");
      expect(body.match(LITERAL) ?? [], `${f} 里写了字面色值`).toEqual([]);
    }
    // 反向证据：这几个文件**确实**大量用了 token（不是"因为没写颜色所以没命中"）。
    expect((MODULE.match(/var\(--/g) ?? []).length).toBeGreaterThan(60);
  });

  it("④ 目标方向来自 objectives[].dir：把纵轴换成 dir:\"max\"，坐标映射当场翻面", () => {
    const axMin: OptAxis = { key: "cost", label: "成本", unit: "", dir: "min", min: 0, max: 100 };
    const axMax: OptAxis = { ...axMin, dir: "max" };

    // 同一个数值，方向一翻，屏幕坐标关于画布中线镜像（Y0+Y1 − y）。
    for (const v of [0, 25, 50, 75, 100]) {
      expect(scaleY(v, axMax)).toBeCloseTo(PARETO_GEOM.Y0 + PARETO_GEOM.Y1 - scaleY(v, axMin), 9);
      expect(scaleX(v, axMax)).toBeCloseTo(PARETO_GEOM.X0 + PARETO_GEOM.X1 - scaleX(v, axMin), 9);
    }
    // 「越好越靠下」在两种方向下都成立：min ⇒ 小值在底；max ⇒ 大值在底。
    expect(scaleY(0, axMin)).toBe(PARETO_GEOM.Y1);
    expect(scaleY(100, axMax)).toBe(PARETO_GEOM.Y1);

    // 端到端：同一批解，只把 objectives[1].dir 从 min 换成 max，整条前沿的 y 全部翻面，
    // 且几何不变量（被支配在上）**在新方向下由新的那批被支配解继续成立**。
    const flipped: ParetoResult = {
      ...RESULT,
      objectives: [OBJ_MIN_MIN[0] as ParetoObjective, { key: "cost", dir: "max", label: "外协", unit: "" }],
      // dir 一翻，「好」的定义也翻：cost 越大越好 ⇒ 前沿是「days 越小、cost 越小」的折中面，
      // 被支配 = days 更大**且** cost 更小。
      frontier: [sol("G1", 14, 0), sol("G2", 18, 6), sol("G3", 22, 12)],
      dominated: [sol("H1", 20, 3), sol("H2", 26, 1)],
    };
    const m0 = projectPareto(RESULT, "f");
    const m1 = projectPareto(flipped, "f");
    expect(m0.axes[1].dir).toBe("min");
    expect(m1.axes[1].dir).toBe("max"); // **来自回显，不是猜的**
    // 各自取值域的上界：`min` 方向下它是**最差**（画在顶），`max` 方向下它是**最好**（画在底）。
    expect(scaleY(m0.axes[1].max, m0.axes[1])).toBe(PARETO_GEOM.Y0);
    expect(scaleY(m1.axes[1].max, m1.axes[1])).toBe(PARETO_GEOM.Y1);
    const f1 = m1.frontier.map((c) => ({
      id: c.id,
      x: scaleX(c.metrics.days as number, m1.axes[0]),
      y: scaleY(c.metrics.cost as number, m1.axes[1]),
    })).sort((a, b) => a.x - b.x);
    const d1 = m1.dominated.map((c) => ({
      id: c.id,
      x: scaleX(c.metrics.days as number, m1.axes[0]),
      y: scaleY(c.metrics.cost as number, m1.axes[1]),
    }));
    for (const r of liftReport(f1, d1)) {
      expect(r.y, `dir:"max" 下被支配点 ${r.id} 落到了前沿下方`).toBeLessThan(r.frontY);
    }
    // 下拉文案也由 dir 决定（「最小」/「最大」不是写死的）。
    renderWithClient(<SandboxOpt />);
    const opts = [...screen.getByTestId("sandbox-opt-objective").querySelectorAll("option")];
    expect(opts.length).toBe(PLACEHOLDER_OPT_MODEL.objectives.length);
    for (const [i, o] of PLACEHOLDER_OPT_MODEL.objectives.entries()) {
      expect(opts[i]?.getAttribute("data-dir")).toBe(o.dir);
      expect(opts[i]?.textContent).toContain(o.dir === "min" ? "最小" : "最大");
    }
  });

  it("⑤ 变异反证：把 scaleY 的符号取反 ⇒ ② 的逐点断言当场红（证明 ② 不是摆设）", () => {
    const model = projectPareto(RESULT, "multi_objective");
    const axes = model.axes as readonly [OptAxis, OptAxis];

    /** 生产映射的**变异体**：`Y1 − t·(Y1−Y0)` → `Y0 + t·(Y1−Y0)`（唯一改动就是这个符号）。 */
    const mutantY = (v: number, ax: OptAxis): number => {
      const t = ax.dir === "min" ? (v - ax.min) / (ax.max - ax.min) : (ax.max - v) / (ax.max - ax.min);
      return PARETO_GEOM.Y0 + t * (PARETO_GEOM.Y1 - PARETO_GEOM.Y0);
    };
    const mScreen = (s: ParetoSolution) => ({
      id: s.id,
      x: scaleX(s.metrics[axes[0].key] as number, axes[0]),
      y: mutantY(s.metrics[axes[1].key] as number, axes[1]),
    });
    const mf = FRONTIER.map(mScreen).sort((a, b) => a.x - b.x);
    const md = DOMINATED.map(mScreen);

    // 变异体下，**每一个**被支配点都跑到了前沿下方（lift ≤ 0）—— 即 ② 会逐点报红。
    const bad = liftReport(mf, md).filter((r) => !(r.y < r.frontY));
    expect(bad.length, "变异体没有被 ② 的判据抓住 ⇒ ② 是装饰品，不是门").toBe(DOMINATED.length);

    // 而生产实现在同一份夹具上一个都不红（改回来即绿，两向都验）。
    const good = liftReport(FRONTIER.map((s) => screenOf(s, axes)).sort((a, b) => a.x - b.x), DOMINATED.map((s) => screenOf(s, axes)));
    expect(good.filter((r) => !(r.y < r.frontY)).length).toBe(0);
  });

  /**
   * ⑥ **传导边抽屉**（`WO-EDGE-PANEL-4PAGES` 新增）—— 规格 `docs/ux-spec/sandbox/sandbox-opt.html` 的 `.dock` 段
   * 与 CSS Module 逐值对齐。
   *
   * ⚠ **为什么本条只比几何、不比色与边框**：规格 README「唯一允许改的两件事」第 1 条写着
   * 色值移植时要换成产品 token（规格写 `var(--hair)`、组件写 `var(--line)`，同一个真值两个名字）
   * —— 拿字符串去比它们必然假红。色值那一半由本文件「零字面色值 + computed 全是 var(--…)」那条咬，
   * 两把尺子各管一段。
   *
   * ⚠ **为什么抽屉不在本文件的渲染树里**：抽屉挂在**适配层**（`Sandbox*Route.tsx`）、
   * 是画布 `.app` 的**兄弟**，而本文件渲染的是画布组件本身。抽屉真渲染 + 真拨开关那一段
   * 由 `test/edge-panel-4pages.seam.test.tsx` 咬（它真渲染 Route、真点开、真发对照请求）。
   * 本条守的是**规格与实现不许分叉**这一件事 —— 规格改了而 CSS 没跟（或反过来）即红。
   */
  it("⑥ 传导边抽屉 .dock/.dockSum：规格与 CSS Module 逐值对齐（几何口径）", () => {
    // 金丝雀：先证明这两把尺子在**新加的这段**上真的取得到东西 —— 取不到时
    // 下面的 `undefined === undefined` 会**恒绿**，那是失败危险方向的绿。
    expect(specDecl(".dock", "width"), "规格里没有 .dock{width} ⇒ 规格没跟着改，或解析器坏了").toBeTruthy();
    expect(moduleDecl(".dock", "width"), "CSS Module 里没有 .dock{width} ⇒ 实现没跟着规格改").toBeTruthy();

    for (const [sel, prop] of [
      [".dock", "width"],
      [".dock", "font-size"],
      [".dockSum", "height"],
      [".dockSum", "padding"],
      [".dockSum", "gap"],
      [".dockSum", "display"],
      [".dockSum", "align-items"],
      [".dockSum", "letter-spacing"],
      [".dockSum", "list-style"],
      [".dockSum::-webkit-details-marker", "display"],
    ] as const) {
      expect(moduleDecl(sel, prop), `${sel}{${prop}} 与规格不一致`).toBe(specDecl(sel, prop));
    }
  });
});
