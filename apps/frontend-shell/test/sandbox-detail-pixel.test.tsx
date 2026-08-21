import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithClient } from "./utils";
import { CHAIN_NODE_REGISTRY } from "@platform/contracts";
import {
  CHAIN_MAP_LANES,
  NODE_DETAIL_ENDPOINT,
  SandboxDetail,
  laneNodeLabel,
  nodeDetailPath,
} from "@/views/sim/console/SandboxDetail";
import { PLACEHOLDER_CONE, projectImpactCone } from "@/views/sim/console/ImpactCone";
import { PLACEHOLDER_STRATEGY_CARDS, projectMitigationCards } from "@/views/sim/console/StrategyCards";
import styles from "@/views/sim/console/SandboxDetail.module.css";

/**
 * WO-SIM-FE-DETAIL · 「传导识别 + 应对策略」页的**像素判据**。
 *
 * ══ 这道用例咬的是什么 ══════════════════════════════════════════════════════
 * 不是"我照着规格写了"，是"**规格现读，逐值对账**"：
 * 每一个 px / grid-template-columns 都从 `docs/ux-spec/sandbox/sandbox-detail.html`
 * 的 `<style>` 段**当场解析**出来，再和 `SandboxDetail.module.css` 的对应规则比。
 * 任何一边改了而另一边没改 ⇒ 当场红。**测试里不写死任何一个规格数字**——
 * 写死就等于把规格抄了第二份，两份迟早漂开（本仓反复点名的"过期的自证数字"）。
 *
 * ══ 金丝雀（CLAUDE.md 铁律 0.6：扫描类结论一律先自证工具）══════════════════
 * 本文件的三个解析器（`parseRules` / `decl` / `colorLiterals`）在下判据之前，
 * 各跑一个**已知必中**的样例。金丝雀不中 ⇒ 报「工具坏了」，**不许**读作「版面对了」。
 * 金丝雀与主逻辑**共用同一份实现**（直接调 `parseRules` 本体），不另抄一份正则 ——
 * 抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。
 *
 * ══ 变异反证（工单 §3 ④）═══════════════════════════════════════════════════
 * 把 `SandboxDetail.module.css` 的 `.mapbox{height}` 改成 600px，**只有判据①**当场红
 *（金丝雀⓪保持绿 —— 它验的是工具，不是版面；两者混在一起就会把"版面改了"报成"工具坏了"）：
 *   AssertionError: `.mapbox` 高与规格不一致（规格 docs/ux-spec/sandbox/sandbox-detail.html 的
 *   .mapbox{height}）: expected '600px' to be '648px' // Object.is equality
 *   Test Files 1 failed (1) · Tests 1 failed | 5 passed (6) · rc=1
 * 改回 648px 后 6/6 复绿、rc=0。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const SPEC_PATH = join(REPO, "docs", "ux-spec", "sandbox", "sandbox-detail.html");
const MODULE_PATH = join(HERE, "..", "src", "views", "sim", "console", "SandboxDetail.module.css");

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 解析器（三个，各带金丝雀）
// ══════════════════════════════════════════════════════════════════════════

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** `选择器（已归一空白）→ 声明块`。同名选择器多次出现则按出现序拼接（后写的赢，见 `decl`）。 */
function parseRules(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2] ?? "";
    for (const raw of (m[1] ?? "").split(",")) {
      const sel = raw.trim().replace(/\s+/g, " ");
      if (sel === "") continue;
      out.set(sel, `${out.get(sel) ?? ""};${body}`);
    }
  }
  return out;
}

/** 取某条属性的**最后一次**声明值（CSS 后写的赢），空白归一。 */
function decl(body: string | undefined, prop: string): string | undefined {
  if (body === undefined) return undefined;
  let v: string | undefined;
  for (const m of body.matchAll(/(?:^|;)\s*([a-zA-Z-]+)\s*:\s*([^;]+)/g)) {
    if ((m[1] ?? "").trim() === prop) v = (m[2] ?? "").trim().replace(/\s+/g, " ");
  }
  return v;
}

/** 字面色值（`#rgb` / `rgb()` / `rgba()`）—— 这类必须一个都不剩，色值一律走 `var(--…)`。 */
function colorLiterals(css: string): string[] {
  return [...stripComments(css).matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g)].map((m) => m[0]);
}

const SPEC_CSS = (() => {
  const raw = readFileSync(SPEC_PATH, "utf8");
  const m = raw.match(/<style>([\s\S]*?)<\/style>/);
  if (m === null) throw new Error(`工具坏了：${SPEC_PATH} 里没找到 <style> 段`);
  return m[1] ?? "";
})();
const MODULE_CSS = readFileSync(MODULE_PATH, "utf8");
const SPEC = parseRules(SPEC_CSS);
const MOD = parseRules(MODULE_CSS);

// ══════════════════════════════════════════════════════════════════════════
// § 0.5 · 把 CSS Module 注入 jsdom（类名按真实映射回填），供 getComputedStyle 用
// ══════════════════════════════════════════════════════════════════════════

/**
 * vitest 的 `css:false` 下 CSS Module 只回类名映射、**不注样式**，
 * 于是 `getComputedStyle` 什么都读不到 —— 直接断言就是一道假绿门（永远返回空串，永远"不是 hex"）。
 * 故这里把 `.module.css` 原文读进来，把**本地类名逐个换成映射后的真类名**再塞进 jsdom。
 * 换不出映射 ⇒ 当场判「工具坏了」，不许静默跳过。
 */
function injectModuleCss(): void {
  const raw = stripComments(MODULE_CSS);
  const locals = new Set([...raw.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1] as string));
  expect(locals.size, "从 module.css 里一个本地类名都没抽出来 ⇒ 抽取器坏了").toBeGreaterThan(30);
  let css = raw;
  for (const name of locals) {
    const scoped = (styles as unknown as Record<string, string | undefined>)[name];
    expect(scoped, `CSS Module 没给出 .${name} 的类名映射 ⇒ 工具坏了，不是版面坏了`).toBeTruthy();
    css = css.replace(new RegExp(`\\.${name}(?![\\w-])`, "g"), `.${scoped as string}`);
  }
  const el = document.createElement("style");
  el.setAttribute("data-testid", "sandbox-detail-css");
  el.textContent = css;
  document.head.appendChild(el);
}

const cls = (name: string): string => {
  const v = (styles as unknown as Record<string, string | undefined>)[name];
  if (v === undefined) throw new Error(`CSS Module 没给出 .${name} 的映射`);
  return v;
};
const pick = (root: HTMLElement, name: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`.${cls(name)}`);
  expect(el, `页面上找不到 .${name}`).not.toBeNull();
  return el as HTMLElement;
};
const pickAll = (root: HTMLElement, sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];

function mount(): HTMLElement {
  const { container } = renderWithClient(<SandboxDetail />);
  return container;
}

beforeAll(() => {
  injectModuleCss();
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-FE-DETAIL · 像素级 1:1（规格 docs/ux-spec/sandbox/sandbox-detail.html）", () => {
  it("⓪ 金丝雀：三个解析器先自证 —— 不中就报「工具坏了」，不许报「版面对了」", () => {
    // ① parseRules 必须在**规格**里抓到已知必中的规则体
    expect(SPEC.get(".mapbox"), "规格里连 .mapbox 都没抓到 ⇒ parseRules 坏了").toBeDefined();
    expect(SPEC.get(".tr"), "规格里连 .tr 都没抓到 ⇒ parseRules 坏了").toBeDefined();
    // ② decl 必须从那条规则体里取出已知必中的值
    expect(decl(SPEC.get(".mapbox"), "height"), "decl 取不出 .mapbox 的 height ⇒ decl 坏了").toBe("648px");
    // ③ 同一份实现跑合成样例（正反两向）：抓得到 + 抓不到不存在的
    const synth = parseRules("/* c */ .zz{height:1px} .yy , .xx { color : red }");
    expect(synth.get(".zz")).toBeDefined();
    expect(decl(synth.get(".zz"), "height")).toBe("1px");
    expect(decl(synth.get(".xx"), "color")).toBe("red");
    expect(synth.get(".nope")).toBeUndefined();
    // ④ colorLiterals 必须真的咬得住字面色（否则判据③是装饰品）
    expect(colorLiterals(".a{color:#e0626c;background:rgba(1,2,3,.4)}")).toEqual(["#e0626c", "rgba("]);
    expect(colorLiterals(".a{color:var(--danger)}")).toEqual([]);
    /*
     * ⑤ 注进 jsdom 的样式表真的生效了（否则 ①②③ 的 getComputedStyle 全是空串假绿）。
     * ⚠ 这里比的是「jsdom 读到的」vs「**module.css 自己写的**」，**不是**规格值 ——
     *   金丝雀只该在**工具坏了**时响。拿规格值当金丝雀判据，会在有人正常改了版面时
     *   喊「工具坏了」，喊错几次这条金丝雀就没人信了（本仓原话：把机制做成噪声）。
     */
    const probe = document.createElement("div");
    probe.className = cls("mapbox");
    document.body.appendChild(probe);
    expect(
      getComputedStyle(probe).height,
      "注入的 module.css 在 jsdom 里没生效 ⇒ 工具坏了（与规格一致与否是判据①的事）",
    ).toBe(decl(MOD.get(".mapbox"), "height"));
    probe.remove();
  });

  it("① 关键盒子的计算尺寸 == 规格（左栏 470 · mapbox 648 · gminis 204 · top 460 · 传导表行高 19）", () => {
    const root = mount();
    // 判据全部从规格现读，测试里不写死任何一个数字。
    const cases: readonly { name: string; sel: string; prop: "width" | "height"; el: HTMLElement }[] = [
      { name: "左栏 .lcol 宽", sel: ".lcol", prop: "width", el: pick(root, "lcol") },
      { name: "`.mapbox` 高", sel: ".mapbox", prop: "height", el: pick(root, "mapbox") },
      { name: "`.gminis` 高", sel: ".gminis", prop: "height", el: pick(root, "gminis") },
      { name: "`.top` 高", sel: ".top", prop: "height", el: pick(root, "top") },
      { name: "`.bot` 高", sel: ".bot", prop: "height", el: pick(root, "bot") },
      { name: "系统条 `.sysbar` 高", sel: ".sysbar", prop: "height", el: pick(root, "sysbar") },
      { name: "时间条 `.strip` 高", sel: ".strip", prop: "height", el: pick(root, "strip") },
      { name: "补货条 `.supp` 高", sel: ".supp", prop: "height", el: pick(root, "supp") },
      { name: "标尺 `.rul` 宽", sel: ".rul", prop: "width", el: pick(root, "rul") },
    ];
    for (const c of cases) {
      const want = decl(SPEC.get(c.sel), c.prop);
      expect(want, `规格里 ${c.sel} 没有 ${c.prop} ⇒ 判据取错了地方`).toBeDefined();
      expect(
        getComputedStyle(c.el)[c.prop],
        `${c.name}与规格不一致（规格 docs/ux-spec/sandbox/sandbox-detail.html 的 ${c.sel}{${c.prop}}）`,
      ).toBe(want);
    }

    // 传导识别表的**行高**：取一条真数据行（表头是 .tr.hd，不覆盖 height，两者应同高）。
    const rows = pickAll(root, `.${cls("tbl")} > .${cls("tr")}`);
    expect(rows.length, "传导识别表一行都没渲染出来").toBeGreaterThan(2);
    const dataRow = rows[1] as HTMLElement;
    expect(
      getComputedStyle(dataRow).height,
      "传导识别表行高与规格不一致（规格 .tr{height}）",
    ).toBe(decl(SPEC.get(".tr"), "height"));

    // 流转明细 / 原计划处置两张表的行高同样对账（`.rt2 .r` / `.ot .r`）。
    expect(getComputedStyle(pickAll(root, `.${cls("rt2")} .${cls("r")}`)[1] as HTMLElement).height).toBe(
      decl(SPEC.get(".rt2 .r"), "height"),
    );
    expect(getComputedStyle(pickAll(root, `.${cls("ot")} .${cls("r")}`)[1] as HTMLElement).height).toBe(
      decl(SPEC.get(".ot .r"), "height"),
    );
    expect(getComputedStyle(pickAll(root, `.${cls("gminis")} .${cls("gm")}`)[0] as HTMLElement).height).toBe(
      decl(SPEC.get(".gm"), "height"),
    );
  });

  it("② 传导识别表的列宽比例 == 规格（grid-template-columns 逐值），面板三处网格同样对账", () => {
    const root = mount();
    const rows = pickAll(root, `.${cls("tbl")} > .${cls("tr")}`);
    const specCols = decl(SPEC.get(".tr"), "grid-template-columns");
    expect(specCols, "规格 .tr 没有 grid-template-columns ⇒ 判据取错了地方").toBeDefined();
    // 逐值：`7px 42px 54px 52px 34px 30px 36px` 一个数都不许差。
    expect(
      getComputedStyle(rows[1] as HTMLElement).gridTemplateColumns,
      "传导识别表列宽与规格不一致（规格 .tr{grid-template-columns}）",
    ).toBe(specCols);
    // 表头与数据行必须同一套列 —— 否则屏上表头和数据错列（这正是"分别对了、合起来错"的老坑）。
    expect(getComputedStyle(rows[0] as HTMLElement).gridTemplateColumns).toBe(specCols);

    for (const sel of [".tb2", ".dt", ".bb", ".rt2 .r", ".ot .r", ".dcard", ".kv", ".fi", ".plat"]) {
      const want = decl(SPEC.get(sel), "grid-template-columns");
      expect(want, `规格 ${sel} 没有 grid-template-columns`).toBeDefined();
      expect(decl(MOD.get(sel), "grid-template-columns"), `${sel} 的列定义与规格不一致`).toBe(want);
    }
  });

  it("③ 色值走令牌：抽查三个元素的 getComputedStyle 全是 var(--…)，且整份 CSS 零字面色", () => {
    const root = mount();
    // 抽查一：选中的传导行（规格 `.tr.on{color:var(--amb)}`）
    const onRow = pickAll(root, `.${cls("tbl")} > .${cls("tr")}.${cls("on")}`)[0] as HTMLElement;
    expect(onRow, "传导识别表里没有选中行（`.tr.on`）").toBeDefined();
    // 抽查二：面板标题（规格写死 `#e9eef5`，移植必须换成 var(--txt)）
    const title = pick(root, "ph").querySelector("b") as HTMLElement;
    // 抽查三：应用策略按钮（规格写死 `#115dc9`，移植必须换成 var(--accent-solid)）
    const btn = pick(root, "abtn");

    /*
     * ⚠ 取的是 `background` / `outline` 这类**简写**而不是 `backgroundColor` ——
     * jsdom(cssstyle) **不展开简写**：`background: var(--x)` 下 `.backgroundColor` 恒回
     * `rgba(0, 0, 0, 0)`。照那个读会得到一个"永远不是 var()"的假信号，
     * 而真浏览器里这条底色是好的（像素比对已证）。形态照铁律 0.6：
     * 「我用『backgroundColor 读出来不是 var()』当作『没走令牌』的证据，而前者并不度量后者。」
     * 故判据落在 jsdom 真读得出的那一层，并对 `rgba(0, 0, 0, 0)` 显式判「工具坏了」。
     */
    for (const [what, el, prop] of [
      ["选中传导行 .tr.on 的 color", onRow, "color"],
      ["选中传导行 .tr.on 的 background", onRow, "background"],
      ["选中传导行 .tr.on 的 outline", onRow, "outline"],
      ["面板标题 .ph b 的 color", title, "color"],
      ["应用策略按钮 .abtn 的 background", btn, "background"],
      ["应用策略按钮 .abtn 的 color", btn, "color"],
    ] as const) {
      const v = getComputedStyle(el)[prop];
      expect(v, `${what} 读不出来 ⇒ 样式没生效（工具坏了，不是版面坏了）`).toBeTruthy();
      expect(v, `${what} 读到的是初始值 ⇒ jsdom 没吃这条声明（工具坏了）`).not.toBe("rgba(0, 0, 0, 0)");
      expect(v, `${what} 不是字面 hex/rgb，必须引用令牌：实得 ${v}`).toMatch(/var\(--/);
      expect(colorLiterals(v), `${what} 里仍有字面色值：${v}`).toEqual([]);
    }

    // 整份 CSS Module 一个字面色都不许剩（注释不算 —— 注释里记着规格原值是有意为之）。
    expect(colorLiterals(MODULE_CSS), "SandboxDetail.module.css 里仍有字面色值（应全部换成 var(--…)）").toEqual(
      [],
    );
  });

  it("④ 左侧地铁图的站名单源 CHAIN_NODE_REGISTRY —— 一个字都不许自己编", () => {
    const ids = new Map(CHAIN_NODE_REGISTRY.map((n) => [n.nodeId as string, n.label as string]));
    // 子序列判据：短名的每个字都必须按序出自注册表 label（"产能复核" ⊂ "产能与瓶颈复核"）。
    const isSub = (short: string, full: string): boolean => {
      let i = 0;
      for (const ch of full) if (i < short.length && short[i] === ch) i += 1;
      return i === short.length;
    };
    // 金丝雀（正反两向）：判据必须真的能拒掉编出来的字。
    expect(isSub("产能复核", "产能与瓶颈复核")).toBe(true);
    expect(isSub("排产计划", "主计划排产"), "子序列判据形同虚设 ⇒ 判据坏了").toBe(false);

    const rendered = mount();
    let checked = 0;
    for (const lane of CHAIN_MAP_LANES) {
      for (const nd of lane.nodes) {
        const full = ids.get(nd.nodeId);
        expect(full, `站 ${nd.nodeId} 不在 CHAIN_NODE_REGISTRY 里（自己编的 nodeId）`).toBeDefined();
        const label = laneNodeLabel(nd);
        expect(isSub(label, full as string), `站名「${label}」不是注册表 label「${full}」的子序列 ⇒ 有自己编的字`).toBe(
          true,
        );
        checked += 1;
      }
    }
    expect(checked, "一个站都没检 ⇒ 判据空转").toBe(21);
    // 真渲染到 DOM 里了（不是只测了个纯函数 —— 铁律 0.5：只有 test 引用 = 已排练，不是已实现）
    const svgText = (rendered.querySelector('[data-testid="sandbox-detail-map"]') as SVGElement).textContent ?? "";
    for (const lane of CHAIN_MAP_LANES) {
      for (const nd of lane.nodes) expect(svgText).toContain(laneNodeLabel(nd));
    }
  });

  it("⑤ 数据接线：三个真出处各自接上，没接通的那一格如实报 placeholder（不冒充真数据）", () => {
    const root = mount();
    // 节点详情端点还在做（WO-SIM-BE-DRILL）⇒ 默认无 sessionId、不发请求、如实报 placeholder。
    expect(root.querySelector('[data-testid="sandbox-detail"]')?.getAttribute("data-source")).toBe("placeholder");
    expect(NODE_DETAIL_ENDPOINT).toBe("/a/v1/sim/sessions/:sessionId/node-detail");
    expect(nodeDetailPath("s1", "capacity.aging")).toBe(
      "/a/v1/sim/sessions/s1/node-detail?nodeId=capacity.aging",
    );

    // 应对策略：没给基地/因素 ⇒ 占位；给了求解器的解 ⇒ 名字/推荐/排序换成真数据。
    expect(root.querySelector('[data-testid="sandbox-detail-strategies"]')?.getAttribute("data-source")).toBe(
      "placeholder",
    );
    const projected = projectMitigationCards(
      [
        { key: "night_shift", name: "增开夜班", eff: 11, tn: 2, cost: "中", score: 0.4 },
        { key: "cross_train", name: "跨基地借调", eff: 9, tn: 5, cost: "低", score: 0.9 },
        { key: "temp_labor", name: "临时用工", eff: 8, tn: 3, cost: "中", score: 0.2 },
      ],
      "cross_train",
    );
    expect(projected.map((c) => c.name)).toEqual(["跨基地借调", "增开夜班", "临时用工"]);
    expect(projected[0]?.recommended).toBe(true);
    expect(projected[0]?.provenance.name).toBe("solver");
    // 残差比求解器没有这一格 —— 必须仍标 placeholder，不许悄悄冒充成解出来的数。
    expect(projected[0]?.provenance.residualPct).toBe("placeholder");
    expect(projected[0]?.residualPct).toBe(PLACEHOLDER_STRATEGY_CARDS[0].residualPct);

    // 影响半径扇区：维度 available:false ⇒ 落回占位（不是渲染成 0 条）。
    expect(root.querySelector('[data-testid="sandbox-detail-cone"]')?.getAttribute("data-source")).toBe(
      "placeholder",
    );
    expect(
      projectImpactCone({
        affectedProcesses: { available: false, reason: "无承载物", missingCarrier: "ProcessInstance" },
      } as never).provenance.impacts,
    ).toBe("placeholder");
    const live = projectImpactCone({
      affectedProcesses: {
        available: true,
        count: 2,
        universe: 65,
        truncated: false,
        items: [
          { processKey: "P12", name: "齐套发料执行", domainKey: "D03" },
          { processKey: "P31", name: "主计划排产", domainKey: "D04" },
        ],
      },
    } as never);
    expect(live.impacts.map((i) => i.label)).toEqual(["齐套发料执行", "主计划排产"]);
    // 槽位（y）仍来自规格：位置照抄、内容换真。
    expect(live.impacts.map((i) => i.y)).toEqual(PLACEHOLDER_CONE.impacts.slice(0, 2).map((i) => i.y));
    expect(live.provenance.impacts).toBe("impact-analysis");
  });
});
