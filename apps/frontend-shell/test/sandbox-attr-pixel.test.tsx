import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { CHAIN_NODE_REGISTRY, chainNodeDef } from "@platform/contracts";
import { loginAs, renderWithClient } from "./utils";
import { SandboxAttr } from "@/views/sim/console/SandboxAttr";
import { HeatMatrix, HEAT_EMPTY_GLYPH } from "@/views/sim/console/HeatMatrix";
import { heatCellKey, type HeatMatrixModel } from "@/views/sim/console/useLossAttribution";
import styles from "@/views/sim/console/SandboxAttr.module.css";

/**
 * WO-SIM-FE-ATTR · **像素测**（本单头号判据）。
 *
 * ── 这个文件在测什么 ────────────────────────────────────────────────────────
 * 规格 = `docs/ux-spec/sandbox/sandbox-attr.html`（可执行规格）。
 * 本测试**不在自己身上抄任何一个数** —— 每一个期望值都是**现从规格 HTML 里解析出来的**
 * （`specDecl(".row1","height")` …）。所以：
 *   · 组件的 CSS 改歪 ⇒ 红；
 *   · 规格改了而组件没跟 ⇒ 红；
 *   · **测试自己抄错一个数** ⇒ 不可能，因为它一个数都没抄。
 *
 * ── 诚实边界（写清楚，免得绿灯被读成「像素级都验过了」）─────────────────────
 * jsdom **不做布局**：`getComputedStyle` 给的是**层叠后声明生效的值**，不是排版后的盒子。
 * 所以本文件断言的是「这些盒子的**声明尺寸**与规格逐字节相同」，
 * **不是**「真浏览器里排出来是这个像素」。后者由交单报告里的 headless-Chromium
 * 逐像素比对（`ref.png` vs `got.png`）负责，两把尺子各管一段，缺一块都不叫 1:1。
 *
 * ── 工具自证（铁律 0.6：扫描类结论一律先跑金丝雀）──────────────────────────
 * 三把可能骗人的尺子，逐个先自证（用例 ⓪）：
 *   ① 规格解析器 `specDecl` —— 已知必中的选择器要中，已知不存在的要返回 undefined；
 *   ② CSS Module 类名映射 —— vitest `css:false` 下 `styles.x` 是 `_x_<hash>` 代理，
 *      必须证明改写后的样式表**真的挂在了元素上**；
 *   ③ 色值扫描正则 —— 拿一段已知含字面色的样本先跑，命中数对不上即判「尺子坏了」。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..", "..");
const SPEC_HTML = join(REPO_ROOT, "docs", "ux-spec", "sandbox", "sandbox-attr.html");
const SRC_DIR = join(TEST_DIR, "..", "src", "views", "sim", "console");
const MODULE_CSS = join(SRC_DIR, "SandboxAttr.module.css");
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

/** 把 CSS Module 原文里的类选择器改写成 vitest 代理给出的那份名字，然后注入 jsdom。 */
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
 * 三个 hook 挂载即向 DataCore 取数。不登录 ⇒ 401 ⇒ apiClient 触发全局跳登录，
 * jsdom 报一串 "Not implemented: navigation"。那是**测试没登录**造成的噪声，不是组件的行为。
 * `test/setup.ts` 的 `afterEach` 会 `tokenStore.clear()`，故必须放 `beforeEach`。
 */
beforeEach(() => {
  loginAs("planner");
});
afterEach(cleanup);

describe("WO-SIM-FE-ATTR · 规格 1:1（期望值全部现从 sandbox-attr.html 解析，测试不抄数）", () => {
  it("⓪ 三把尺子先自证（金丝雀不中 ⇒ 报「尺子坏了」，不许报「代码没问题」）", () => {
    // ① 规格解析器：已知必中 / 已知必不中。
    expect(specDecl(".row1", "height"), "规格里 .row1 的 height 解析不到 ⇒ 解析器坏了").toBeTruthy();
    expect(specDecl(".grid", "grid-template-columns")).toBeTruthy();
    expect(specDecl(".no-such-selector-xyz", "height")).toBeUndefined();
    // 且它**不会**把 `.tt b` 这类后代选择器误当成 `.tt`（规格里 `.tt b` 有 font-size，`.tt` 没有）。
    expect(specDecl(".tt", "font-size")).toBeUndefined();
    expect(specDecl(".tt b", "font-size")).toBe("14px");

    // ② 类名映射：改写真的发生了，且样式表真的挂到了元素上。
    expect(injected.classNames).toContain("row1");
    expect(injected.rewritten).toContain(`.${cls("row1")}`);
    expect(injected.rewritten).not.toMatch(/(^|[\s,>])\.row1[\s{,]/);
    renderWithClient(<SandboxAttr />);
    // 已知必中：`.left` 声明了 width:264px，注入生效就取得到。
    expect(px(screen.getByTestId("sandbox-attr-left"), "width")).toBe("264px");
    // 已知必不中：没有任何规则给 `.row1` 宽度 ⇒ 取不到 264（证明不是「什么都返回 264」）。
    expect(px(screen.getByTestId("sandbox-attr-row1"), "width")).not.toBe("264px");
  });

  it("① 关键盒子的计算尺寸 == 规格声明值（.app / .row1 / 左中右三栏 / .bot / .grid / 行高）", () => {
    renderWithClient(<SandboxAttr />);

    // 画布本体 1440×897（规格 `.app`）。
    expect(px(screen.getByTestId("sandbox-attr"), "width")).toBe(specDecl(".app", "width"));
    expect(px(screen.getByTestId("sandbox-attr"), "height")).toBe(specDecl(".app", "height"));

    // 三栏 + 上下两块：期望值 = 规格 HTML 现解析，**不是**写死在本文件里的数字。
    expect(px(screen.getByTestId("sandbox-attr-row1"), "height")).toBe(specDecl(".row1", "height"));
    expect(px(screen.getByTestId("sandbox-attr-left"), "width")).toBe(specDecl(".left", "width"));
    expect(px(screen.getByTestId("sandbox-attr-right"), "width")).toBe(specDecl(".right", "width"));
    expect(px(screen.getByTestId("sandbox-attr-bot"), "height")).toBe(specDecl(".bot", "height"));
    expect(px(screen.getByTestId("sandbox-attr-series"), "height")).toBe(specDecl(".grid", "height"));

    // 逐行（不是抽查一行）：根因树 20px · 明细 19px · 时序 18px · 热力格 20px。
    const each = (klass: string, sel: string) => {
      const nodes = document.querySelectorAll(`.${cls(klass)}`);
      expect(nodes.length, `.${klass} 一个都没渲染 ⇒ 断言等于没跑`).toBeGreaterThan(0);
      for (const n of nodes) expect(px(n, "height")).toBe(specDecl(sel, "height"));
    };
    each("tn", ".tn");
    each("dr", ".dr");
    each("gcell", ".gcell");
    each("gr", ".gr");
    each("hc", ".hc");
    each("ht", ".ht");
    each("gcap", ".gcap");
    each("lh", ".lh");

    // jsdom 的 cssstyle 不支持 grid / flex 简写的 computed 取值，那几条改用**声明比对**
    // （第二把尺子：值来自同一份规格，只是取的位置不同；不是降低标准，是换一把量得到的尺）。
    for (const [sel, prop] of [
      [".grid", "grid-template-columns"],
      [".tn", "grid-template-columns"],
      [".dr", "grid-template-columns"],
      [".hmg", "gap"],
      [".main", "padding"],
      [".main", "gap"],
      [".row1", "gap"],
      [".rail", "width"],
      [".mid", "flex"],
      [".hm", "padding"],
      [".wf", "margin"],
      [".sg", "height"],
      [".sg", "top"],
      [".dr s", "height"],
      [".dr .spk", "height"],
      [".dr .spk u", "width"],
      [".tn .bar", "height"],
      [".cw i", "width"],
      [".cw s", "width"],
      [".rbtn", "width"],
      [".logo", "width"],
      [".hole", "width"],
    ] as const) {
      expect(moduleDecl(sel, prop), `${sel}{${prop}} 与规格不一致`).toBe(specDecl(sel, prop));
    }

    // 热力网格的列模板：规格写死 `64px repeat(5,1fr)`（5 列是占位），本页列数随基地数走。
    // 故只比**行名列的固定宽**这一段，剩下的比「列数 == 渲染出来的基地数」。
    const grid = screen.getByTestId("sandbox-attr-heat-grid");
    const specHmg = /grid-template-columns:(\d+px) repeat\((\d+),1fr\)/.exec(SPEC_HTML_TEXT());
    expect(specHmg, "规格里 .hmg 的列模板解析不到 ⇒ 尺子坏了").not.toBeNull();
    const bases = document.querySelectorAll('[data-testid^="sandbox-attr-heat-base-"]');
    expect(bases.length).toBeGreaterThan(0);
    expect(grid.style.gridTemplateColumns).toBe(`${(specHmg as RegExpExecArray)[1]} repeat(${bases.length}, 1fr)`);
  });

  it("② 热力矩阵行数 == CHAIN_NODE_REGISTRY 里出现的环节数；空格子渲染「—」不是 0", () => {
    renderWithClient(<SandboxAttr />);

    // 行数 = 屏上出现的**在册**环节数（不是写死 8：占位表一改，这条自动跟）。
    const rows = [...document.querySelectorAll('[data-testid^="sandbox-attr-heat-row-"]')];
    const rowIds = rows.map((r) => r.getAttribute("data-node") ?? "");
    const registered = rowIds.filter((id) => chainNodeDef(id) !== undefined);
    expect(rows.length, "热力矩阵一行都没渲染 ⇒ 断言等于没跑").toBeGreaterThan(0);
    expect(registered.length, "热力矩阵里有不在册的环节 ⇒ 名字是编的").toBe(rows.length);
    expect(new Set(rowIds).size, "热力矩阵有重复行").toBe(rows.length);
    // 行名逐个 == 注册表 label（一个字都不许自己编）。
    for (const r of rows) {
      const id = r.getAttribute("data-node") as string;
      expect(r.textContent).toBe(chainNodeDef(id)?.label);
    }
    // 金丝雀：注册表**确实**非空且这些 id 真在册（证明上面那条不是「空集合也全过」）。
    expect(CHAIN_NODE_REGISTRY.length).toBeGreaterThan(rows.length);

    // 归因明细 / 贡献度时序两处的环节名同样走注册表。
    for (const sel of ['[data-testid^="sandbox-attr-detail-"]', '[data-testid^="sandbox-attr-tree-"]']) {
      const hits = document.querySelectorAll(sel);
      expect(hits.length).toBeGreaterThan(0);
    }

    // ── 空格子：后端 `null` + `reason` ⇒ 「—」，**不是 0** ────────────────────
    cleanup();
    const nodeId = CHAIN_NODE_REGISTRY[0]?.nodeId as string;
    const label = chainNodeDef(nodeId)?.label as string;
    const matrix: HeatMatrixModel = {
      nodes: [{ nodeId, label }],
      bases: [
        { baseId: "has-data", name: "有数据" },
        { baseId: "no-data", name: "没数据" },
      ],
      // 只给第一列的格子；第二列**根本没有键** = 后端「空列 null + reason」的形状。
      cells: new Map([[heatCellKey(nodeId, "has-data"), { pct: 0, days: 0 }]]),
      reasons: new Map([["no-data", "该基地本租户没有可锚定的 Order"]]),
      source: "endpoint",
    };
    renderWithClient(<HeatMatrix matrix={matrix} />);
    const filled = screen.getByTestId(`sandbox-attr-heat-cell-${nodeId}-has-data`);
    const empty = screen.getByTestId(`sandbox-attr-heat-cell-${nodeId}-no-data`);
    // 真 0 印 0（`pct: 0` 是**有数据且值为 0**，不许被当成没数据）。
    expect(filled.textContent).toBe("0");
    expect(filled.getAttribute("data-empty")).toBe("0");
    // 没数据印「—」，且**绝不**是 "0"。
    expect(empty.textContent).toBe(HEAT_EMPTY_GLYPH);
    expect(empty.textContent).not.toBe("0");
    expect(empty.getAttribute("data-empty")).toBe("1");
    // 原因挂在 title 上（用户悬停读得到「为什么没有」，而不是看见一个 0 以为是真的）。
    expect(empty.getAttribute("title")).toBe("该基地本租户没有可锚定的 Order");
  });

  it("③ 色值走 token：computed 拿到的是 var() 引用，且 token 真值 == 规格调色板真值", () => {
    renderWithClient(<SandboxAttr />);
    const palette = specPalette();
    const rootStyle = getComputedStyle(document.documentElement);
    const tokenValue = (t: string) => rootStyle.getPropertyValue(t).trim();

    // 金丝雀：色值扫描正则先拿已知样本跑（3 个字面色），命中数不对 ⇒ 尺子坏了。
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g;
    expect("color:#E0626C;background:rgba(0,0,0,.5);border:1px solid hsl(200 50% 50%)".match(LITERAL)).toHaveLength(3);

    // 抽查三个元素，三种承载方式各一个（CSS 类 / CSS 类 + 状态 / 组合类）。
    const samples: { el: HTMLElement | null; prop: "color"; token: string; specVar: string }[] = [
      { el: bySel(`.${cls("mb")}`), prop: "color", token: "--muted", specVar: "--dim" },
      { el: bySel(`.${cls("tn")}.${cls("hot")}`), prop: "color", token: "--danger", specVar: "--red" },
      { el: bySel(`.${cls("gcell")}.${cls("dn")}`), prop: "color", token: "--ok", specVar: "--grn" },
    ];
    for (const s of samples) {
      expect(s.el, `抽查元素不存在（${s.token}）`).not.toBeNull();
      const got = getComputedStyle(s.el as HTMLElement)[s.prop];
      // (a) 拿到的**不是字面 hex**，而是 token 引用。
      expect(got.match(LITERAL) ?? [], `${s.token} 处写了字面色值`).toEqual([]);
      // 允许 `--X` 或其**文字安全同族** `--X-txt`（照抄 `sandbox-home-pixel.test.tsx` 断言③）：
      // `check-text-legibility` 判据 A 实测 `--danger`/`--warn`/`--c-capacity` 当**正文色**
      // 在亮色主题下只有 1.66–2.06:1，而 tokens.css 本来就为这件事备了 `-txt` 变体。
      // 正文色一律取 `-txt`，边框/填充仍取本色 —— 两者语义不同，不许混。
      const used = got.trim();
      const okForms = [`var(${s.token})`, `var(${s.token}-txt)`];
      expect(okForms, `${s.token} 处用了非同族 token：${used}`).toContain(used);
      const actualToken = used.slice(4, -1);
      // (b) 该 token 在 :root 上**解析得出**；本色须与规格调色板逐字节相同。
      expect(tokenValue(actualToken), `${actualToken} 在 :root 上解析不到`).not.toBe("");
      if (actualToken === s.token) {
        expect(tokenValue(s.token).toLowerCase()).toBe((palette[s.specVar] ?? "").toLowerCase());
      }
    }

    // 组件与其 CSS 里**一个字面色值都没有**（三套主题自动跟随的机械保证）。
    // 注：注释里记录色值映射表是允许的，故扫的是**剥注释后**的正文。
    for (const f of ["SandboxAttr.tsx", "SandboxAttr.module.css", "SandboxAttrRoute.tsx", "HeatMatrix.tsx", "Waterfall.tsx", "useLossAttribution.ts"]) {
      const body = stripComments(readFileSync(join(SRC_DIR, f), "utf8")).replace(/^\s*\/\/.*$/gm, "");
      expect(body.match(LITERAL) ?? [], `${f} 里写了字面色值`).toEqual([]);
    }
    // 反向证据：这几个文件**确实**大量用了 token（不是「因为没写颜色所以没命中」）。
    expect((MODULE.match(/var\(--/g) ?? []).length).toBeGreaterThan(60);
    // 派单硬约束②：全页零 `writing-mode`（容器字体无竖排度量，竖排中文会叠成黑块）。
    expect(MODULE).not.toContain("writing-mode");
  });

  /**
   * ⑥ **传导边抽屉**（`WO-EDGE-PANEL-4PAGES` 新增）—— 规格 `docs/ux-spec/sandbox/sandbox-attr.html` 的 `.dock` 段
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

/** 规格 HTML 原文（`.hmg` 的列模板写在**内联 style** 上，不在 `<style>` 段里，故单独读一次）。 */
function SPEC_HTML_TEXT(): string {
  return readFileSync(SPEC_HTML, "utf8");
}
