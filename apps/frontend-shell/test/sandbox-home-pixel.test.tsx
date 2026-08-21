import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { CAPACITY_FACTOR_BINDINGS, CHAIN_NODE_REGISTRY, PerturbationKindSchema } from "@platform/contracts";
import { loginAs, renderWithClient } from "./utils";
import { SandboxHome } from "@/views/sim/console/SandboxHome";
import styles from "@/views/sim/console/SandboxHome.module.css";

/**
 * WO-SIM-FE-HOME · **像素测**（本单头号判据）。
 *
 * ── 这个文件在测什么 ────────────────────────────────────────────────────────
 * 规格 = `docs/ux-spec/sandbox/sandbox-home.html`（可执行规格）。
 * 本测试**不在自己身上抄任何一个数** —— 每一个期望值都是**现从规格 HTML 里解析出来的**
 * （`specDecl(".row1","height")` …）。所以：
 *   · 组件的 CSS 改歪 ⇒ 红；
 *   · 规格改了而组件没跟 ⇒ 红；
 *   · **测试自己抄错一个数** ⇒ 不可能，因为它一个数都没抄。
 * 这正是派单原文「从规格 HTML 里读这些数，别凭记忆写」的落法。
 *
 * ── 诚实边界（写清楚，免得绿灯被读成「像素级都验过了」）─────────────────────
 * jsdom **不做布局**：`getComputedStyle` 给的是**层叠后声明生效的值**，不是排版后的盒子。
 * 所以本文件断言的是「这些盒子的**声明尺寸**与规格逐字节相同」，
 * **不是**「真浏览器里排出来是这个像素」。后者由交单报告里的 headless-Chromium
 * 逐像素比对（`ref.png` vs `got.png`）负责，两把尺子各管一段，缺一块都不叫 1:1。
 *
 * ── 工具自证（铁律 0.6：扫描类结论一律先跑金丝雀）──────────────────────────
 * 本文件用到三把可能骗人的尺子，逐个先自证：
 *   ① 规格解析器 `specDecl` —— 已知必中的选择器要中，已知不存在的要返回 undefined；
 *   ② CSS Module 类名映射 —— vitest `css:false` 下 `styles.x` 是 `_x_<hash>` 代理，
 *      必须证明改写后的样式表**真的挂在了元素上**（否则「尺寸对不上」会被读成组件写错，
 *      实际是样式压根没注入）；
 *   ③ 色值扫描正则 —— 拿一段已知含字面色的样本先跑，命中数对不上即判「尺子坏了」。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..", "..");
const SPEC_HTML = join(REPO_ROOT, "docs", "ux-spec", "sandbox", "sandbox-home.html");
const MODULE_CSS = join(TEST_DIR, "..", "src", "views", "sim", "console", "SandboxHome.module.css");
const TOKENS_CSS = join(TEST_DIR, "..", "src", "styles", "tokens.css");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 规格 HTML 的 `<style>` 正文（**唯一期望值来源**）。 */
function specCss(): string {
  const html = readFileSync(SPEC_HTML, "utf8");
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (m === null) throw new Error("规格 HTML 里没有 <style> —— 尺子坏了，不是组件有问题");
  return stripComments(m[1] as string);
}

/**
 * 从一段 CSS 里取「选择器 `sel` 的 `prop` 声明值」。
 * 只认**逗号分隔的选择器列表里整项等于 `sel`** 的规则（`.row1` 不会误命中 `.row1 b`）。
 */
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

/**
 * 把 CSS Module 原文里的类选择器改写成 vitest 代理给出的那份名字，然后注入 jsdom。
 * `css:false` 下 `styles.row1 === "_row1_<hash>"`，而原文写的是 `.row1` —— 不改写就一条都挂不上。
 */
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
/**
 * FlowMap 挂载即向引擎取 `chain_loss_attribution`。不登录 ⇒ 401 ⇒ apiClient 触发全局跳登录，
 * jsdom 报一串 "Not implemented: navigation"。那是**测试没登录**造成的噪声，不是组件的行为。
 * 故按真实使用姿势逐例先登录 —— `test/setup.ts` 的 `afterEach` 会 `tokenStore.clear()`，
 * 所以必须放 `beforeEach`（放 `beforeAll` 只有第一条用例是登录态，后三条照旧 401，实测如此）。
 */
beforeEach(() => {
  loginAs("planner");
});
afterEach(cleanup);

describe("WO-SIM-FE-HOME · 规格 1:1（期望值全部现从 sandbox-home.html 解析，测试不抄数）", () => {
  it("⓪ 三把尺子先自证（金丝雀不中 ⇒ 报「尺子坏了」，不许报「代码没问题」）", () => {
    // ① 规格解析器：已知必中 / 已知必不中。
    expect(specDecl(".row1", "height"), "规格里 .row1 的 height 解析不到 ⇒ 解析器坏了").toBeTruthy();
    expect(specDecl(".gantt", "grid-template-columns")).toBeTruthy();
    expect(specDecl(".no-such-selector-xyz", "height")).toBeUndefined();
    // 且它**不会**把 `.row1 b` 这类后代选择器误当成 `.row1`（规格里 `.tt b` 有 font-size，`.tt` 没有）。
    expect(specDecl(".tt", "font-size")).toBeUndefined();
    expect(specDecl(".tt b", "font-size")).toBe("14px");

    // ② 类名映射：改写真的发生了，且样式表真的挂到了元素上。
    expect(injected.classNames).toContain("row1");
    expect(injected.rewritten).toContain(`.${cls("row1")}`);
    expect(injected.rewritten).not.toMatch(/(^|[\s,>])\.row1[\s{,]/);
    renderWithClient(<SandboxHome />);
    // 已知必中的样例：`.left` 声明了 width:304px，注入生效的话这里就取得到。
    expect(px(screen.getByTestId("sandbox-home-left"), "width")).toBe("304px");
    // 已知必不中的样例：没有任何规则给 `.body` 宽度 ⇒ 取不到具体像素（证明不是「什么都返回 304」）。
    expect(px(screen.getByTestId("sandbox-home-row1"), "width")).not.toBe("304px");
  });

  it("① 关键盒子的计算尺寸 == 规格声明值（.row1 / 左栏 / .bot / .gantt / 行高）", () => {
    renderWithClient(<SandboxHome />);

    // 逐条：期望值 = 规格 HTML 现解析，**不是**写死在本文件里的数字。
    expect(px(screen.getByTestId("sandbox-home-row1"), "height")).toBe(specDecl(".row1", "height"));
    expect(px(screen.getByTestId("sandbox-home-left"), "width")).toBe(specDecl(".left", "width"));
    expect(px(screen.getByTestId("sandbox-home-bot"), "height")).toBe(specDecl(".bot", "height"));
    expect(px(screen.getByTestId("sandbox-home-gantt"), "height")).toBe(specDecl(".gantt", "height"));

    // 行高 18：甘特的**每一行**（不是抽查一行），以及表头格。
    const rowH = specDecl(".gcell", "height");
    expect(rowH).toBe(specDecl(".grow", "height")); // 规格自身两处一致，先证明这一点
    for (const row of document.querySelectorAll(`.${cls("gcell")}`)) expect(px(row, "height")).toBe(rowH);
    for (const row of document.querySelectorAll(`.${cls("grow")}`)) expect(px(row, "height")).toBe(rowH);
    expect(document.querySelectorAll(`.${cls("gcell")}`).length).toBeGreaterThan(0); // 反「零元素也全过」

    // 左栏因子行 / 落点行 / 组头：同样逐行比规格。
    const itH = specDecl(".it", "height");
    for (const it of document.querySelectorAll(`.${cls("it")}`)) expect(px(it, "height")).toBe(itH);
    for (const dp of document.querySelectorAll(`.${cls("dp")}`)) expect(px(dp, "height")).toBe(specDecl(".dp", "height"));
    for (const gh of document.querySelectorAll(`.${cls("gh")}`)) expect(px(gh, "height")).toBe(specDecl(".gh", "height"));

    // 画布本体 1440×897（规格 `.app`）。
    expect(px(screen.getByTestId("sandbox-home"), "width")).toBe(specDecl(".app", "width"));
    expect(px(screen.getByTestId("sandbox-home"), "height")).toBe(specDecl(".app", "height"));

    // jsdom 的 cssstyle 不支持 grid / flex 简写的 computed 取值，那几条改用**声明比对**
    // （第二把尺子：值来自同一份规格，只是取的位置不同；不是降低标准，是换一把量得到的尺）。
    for (const [sel, prop] of [
      [".gantt", "grid-template-columns"],
      [".grid2", "grid-template-columns"],
      [".grid2", "gap"],
      [".main", "padding"],
      [".main", "gap"],
      [".row1", "gap"],
      [".rail", "width"],
      [".ctx", "left"],
      [".ctx", "top"],
      [".laneHead", "height"],
      [".gcap", "height"],
      [".seg", "height"],
      [".tick", "height"],
    ] as const) {
      expect(moduleDecl(sel, prop), `${sel}{${prop}} 与规格不一致`).toBe(specDecl(sel, prop));
    }
  });

  it("② 24 站全在屏，站名逐个 == CHAIN_NODE_REGISTRY 的 label（一个字都不许自己编）", () => {
    renderWithClient(<SandboxHome />);

    // 站数 = 注册表长度（不是写死 24：册长一变，这条自动跟）。
    const stations = document.querySelectorAll('[data-testid^="sandbox-home-station-"]:not([data-testid*="-label-"])');
    expect(stations.length).toBe(CHAIN_NODE_REGISTRY.length);

    // 站名逐个比对。规格的断行规则：>6 字断成 `slice(0,6)` + 余下，故拼回去再比。
    for (const n of CHAIN_NODE_REGISTRY) {
      const parts = [...document.querySelectorAll(`[data-testid^="sandbox-home-station-label-${n.nodeId}-"]`)];
      expect(parts.length, `站 ${n.nodeId} 的站名没上屏`).toBeGreaterThan(0);
      expect(parts.map((p) => p.textContent ?? "").join("")).toBe(n.label);
    }

    // 分段：5 段泳道齐（段名也不是自己编的，走 STAGE_LABEL）。
    const stages = new Set(CHAIN_NODE_REGISTRY.map((n) => n.stage));
    for (const s of stages) expect(screen.getByTestId(`sandbox-home-lane-${s}`)).toBeInTheDocument();

    // 左栏 20 个因子行：**每行必须有自己的身份**。
    // ⚠ 这条是逐像素比对抓出来的真 bug 的回归位：首版拿 `prop` 当行 id，而册里
    //   ⑧ 利用率 与 ⑩ 瓶颈工序 **同一个 `prop: utilization`**（20 条只有 19 个不同的 prop）
    //   ⇒ `querySelector([data-factor=…])` 两次都命中第一行 ⇒ ⑧ 画两条重叠连线、⑩ 一条没有，
    //   而当时四条用例**全绿**（「绿测试 ≠ 能用」的教科书形态）。
    const factorIds = [...document.querySelectorAll("[data-factor]")].map((e) => e.getAttribute("data-factor"));
    const dropIds = [...document.querySelectorAll("[data-drop]")].map((e) => e.getAttribute("data-drop"));
    expect(factorIds.length).toBe(CAPACITY_FACTOR_BINDINGS.length);
    expect(new Set(factorIds).size, "因子行的 data-factor 有重复 ⇒ 连线/选中都会串行").toBe(factorIds.length);
    expect(dropIds.length).toBe(CAPACITY_FACTOR_BINDINGS.length);
    expect(new Set(dropIds).size).toBe(dropIds.length);
    // 金丝雀：证明册里**确实**有重复的 prop（所以上面那条不是摆设，是真拦得住的）。
    expect(new Set(CAPACITY_FACTOR_BINDINGS.map((f) => f.prop)).size).toBeLessThan(CAPACITY_FACTOR_BINDINGS.length);
    // 选中态**有且仅有一行**（拿 prop 当 id 时这里会是 2）。
    expect(document.querySelectorAll(`.${cls("it")}.${cls("on")}`).length).toBe(1);
    // 只读行（虚线勾选框）== 册里 writable:false 的条数，不是屏上数出来的。
    expect(document.querySelectorAll(`.${cls("it")}.${cls("ro")}`).length).toBe(
      CAPACITY_FACTOR_BINDINGS.filter((f) => !f.writable).length,
    );
    // 落点中文名覆盖度：册里出现的每个 objectType 都得有显示名（少一个就会把类型名直接印到屏上）。
    const dropText = [...document.querySelectorAll("[data-drop]")].map((e) => e.textContent ?? "").join("|");
    for (const f of CAPACITY_FACTOR_BINDINGS) {
      expect(dropText, `落点 ${f.objectType} 没有中文显示名`).not.toContain(f.objectType);
    }

    // 左栏上下文菜单的词表 == 契约 PerturbationKind 的 5 类（少一类即红）。
    for (const k of PerturbationKindSchema.options) {
      expect(screen.getByTestId(`sandbox-home-ctx-${k}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("sandbox-home-ctx").querySelectorAll("[data-testid]").length).toBe(
      PerturbationKindSchema.options.length,
    );
  });

  it("③ 色值走 token：computed 拿到的是 var() 引用，且 token 真值 == 规格调色板真值", () => {
    renderWithClient(<SandboxHome />);
    const palette = specPalette();
    const rootStyle = getComputedStyle(document.documentElement);
    const tokenValue = (t: string) => rootStyle.getPropertyValue(t).trim();

    // 金丝雀：色值扫描正则先拿已知样本跑（3 个字面色），命中数不对 ⇒ 尺子坏了。
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g;
    expect("color:#E0626C;background:rgba(0,0,0,.5);border:1px solid hsl(200 50% 50%)".match(LITERAL)).toHaveLength(3);

    // 抽查三个元素，三种承载方式各一个（CSS 类 / CSS 类 + 状态 / TSX inline style）。
    const samples: { el: HTMLElement | null; prop: "color" | "fill"; token: string; specVar: string }[] = [
      { el: bySel(`.${cls("mb")}`), prop: "color", token: "--muted", specVar: "--dim" },
      { el: bySel(`.${cls("it")}.${cls("hot")}`), prop: "color", token: "--danger", specVar: "--red" },
      { el: screen.getByTestId("sandbox-home-lane-label-CAPACITY"), prop: "fill", token: "--c-capacity", specVar: "--cy" },
    ];
    for (const s of samples) {
      expect(s.el, `抽查元素不存在（${s.token}）`).not.toBeNull();
      const got = getComputedStyle(s.el as HTMLElement)[s.prop];
      // (a) 拿到的**不是字面 hex**，而是 token 引用。
      expect(got.match(LITERAL) ?? [], `${s.token} 处写了字面色值`).toEqual([]);
      // 允许 `--X` 或其**文字安全同族** `--X-txt`（2026-08-21 审核方裁决）：
      // `check-text-legibility` 判据 A 实测 `--danger`/`--warn`/`--c-capacity` 当**正文色**时
      // 在亮色主题下只有 1.66–2.06:1（红/琥珀/青压在浅面板上），而 tokens.css 本来就为这件事
      // 备了 `-txt` 变体。故正文色一律取 `-txt`，边框/填充仍取本色 —— 两者语义不同，不许混。
      // ⚠ 这不是把断言放松成「随便什么 token 都行」：只多认**同名 + `-txt`** 这一个形态，
      //   写成别的 token 照样红；且 (b) 仍逐字节比真值，只是比的是实际用的那个 token。
      const used = got.trim();
      const okForms = [`var(${s.token})`, `var(${s.token}-txt)`];
      expect(okForms, `${s.token} 处用了非同族 token：${used}`).toContain(used);
      const actualToken = used.slice(4, -1);
      // (b) 该 token 在 :root 上**解析得出**；本色须与规格调色板逐字节相同，
      //     `-txt` 变体只要求解析得出（它的值本就与本色不同，那正是换它的原因）。
      expect(tokenValue(actualToken), `${actualToken} 在 :root 上解析不到`).not.toBe("");
      if (actualToken === s.token) {
        expect(tokenValue(s.token).toLowerCase()).toBe((palette[s.specVar] ?? "").toLowerCase());
      }
    }

    // 组件与其 CSS 里**一个字面色值都没有**（三套主题自动跟随的机械保证）。
    // 注：注释里记录色值映射表是允许的，故扫的是**剥注释后**的正文。
    const SRC = join(TEST_DIR, "..", "src", "views", "sim", "console");
    for (const f of ["SandboxHome.tsx", "SandboxHome.module.css", "FlowMap.tsx", "MetricGantt.tsx", "PerturbTree.tsx", "useMetricSeries.ts"]) {
      const body = stripComments(readFileSync(join(SRC, f), "utf8")).replace(/^\s*\/\/.*$/gm, "");
      expect(body.match(LITERAL) ?? [], `${f} 里写了字面色值`).toEqual([]);
    }
    // 反向证据：这几个文件**确实**大量用了 token（不是「因为没写颜色所以没命中」）。
    expect((MODULE.match(/var\(--/g) ?? []).length).toBeGreaterThan(60);
  });
});
