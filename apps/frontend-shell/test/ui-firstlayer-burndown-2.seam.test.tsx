import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InspectorNodePanel } from "@/views/sim/InspectorNodePanel";
import { buildPlaceholderInspectorInput, type InspectorInput } from "@/views/sim/inspectorModel";

/**
 * WO-UI-FIRSTLAYER-BURNDOWN-2 · **接缝测试**：第一层降载不是「少写点字」，
 * 是**同一段字搬到了浮层，而且真的调得出来**。
 *
 * ══ 为什么每条都必须**两向都咬** ═══════════════════════════════════════════════
 * 规范 `docs/CONVENTION-ui-information-layering.md` §1 的红线是
 * 「诚实位**允许降层、绝不允许删除**；静默降层等于删除」。
 * 只咬**一向**都会被同一种作弊姿势骗过去：
 *   · 只咬「第一层不含」  ⇒ **把整段删掉**也变绿（那正是红线禁的事）；
 *   · 只咬「浮层里含」    ⇒ **两层都印一遍**也变绿（第一层根本没降载）。
 * 故本文件每一条口径都同时断言：
 *   ① 不 hover 时**第一层不含**该原文 ② `?` 记号**可见且是真 button**
 *   ③ hover 之后**浮层里逐字含**该原文。
 * 三条缺一，这次降层就不算数。
 *
 * ══ 为什么判据落在**可见性/渲染结果**，不落在「在不在 DOM」═══════════════════
 * `InfoPopover` 关着时是**真的不渲染**（`open === false` ⇒ 不进 DOM），
 * 所以「查 DOM 存在」会把「没搬」读成「搬好了」。
 * ⚠ 同源的坑，规范与本单派单都点名过：**不许用 `<details>` 折叠买绿** ——
 * Chromium 141 实测，闭合 `<details>` 的子节点 `checkVisibility()` 为 false，
 * 但 `getBoundingClientRect()` **仍返回非零旧矩形**，版面门照样把它们当第一屏控件在数：
 * 屏上看不见、数上不降，两头落空。本单一处 `<details>` 都没有新增。
 *
 * ══ 变异反证（亲手跑过，红的原文见 `docs/HANDOFF-WO-UI-FIRSTLAYER-BURNDOWN-2.md`）══
 * 把任一条浮层正文**删掉**（而不是搬走）⇒ 本文件 §1 对应那一条当场红，
 * 且红在「浮层里没有该原文」这一句上 —— 正是要证明的那件事，
 * 不是「组件不见了」那种只证明了代码被删的红。
 */

/* ── 仓根：自**本文件**向上找 pnpm-workspace.yaml ──────────────────────────────
 * 刻意不用 `process.cwd()`：隔离 worktree 里跑时 cwd 仍可能指向主 checkout，
 * 本仓曾据此读错文件造成假绿。 */
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[ui-firstlayer-burndown-2] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** 第一层 = 不点、不悬停就看得见的那一屏。 */
const visibleText = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

/**
 * 本单在 `InspectorNodePanel` 上降层的**六段口径**。
 * `text` 是**降层前第一层上的原文**（逐字抄自改前的 `<small className={styles.sectionSub}>`）——
 * 断言用它，才能证明"搬走了"而不是"改写了一段差不多的话"。
 */
const DEMOTED = [
  { id: "insp-wf-caliber", text: "五段与\"哪种算增值\"均由 S0 契约冻结，前端不另立口径" },
  { id: "insp-fe-caliber", text: "流动效率 = 增值 ÷ 前置期（制造业典型 5–15%，读数低是正常的）" },
  { id: "insp-kpi-caliber", text: "全部由引擎算出并下发" },
  { id: "insp-ev-caliber", text: "每个天数指回一个真对象的真字段" },
  { id: "insp-var-caliber", text: "七类推演机理不同 ⇒ 控件不同。S 类是离散分支换拓扑，不是滑杆" },
] as const;

/** ⑤ 跨节点冲突整块只在「该节点写了语义」时才渲染，故单独用一个**在册**节点验。 */
const CF_NODE = "capacity.schedule";
const CF_DEMOTED = { id: "insp-cf-caliber", text: "编辑口径（人写的，非引擎下发）" };

const mkInput = (nodeId = "wo.f4/opaque::key.with.dots", over: Partial<InspectorInput> = {}): InspectorInput => ({
  ...buildPlaceholderInspectorInput({ nodeId, label: "被检视节点", stage: "CAPACITY", seed: 42 }),
  ...over,
});

describe("§1 · 节点检视面板：六段口径**两向都咬**（浮层里有 ∧ 第一层没有）", () => {
  it("① 不 hover 时第一层**逐条都不含**这六段口径原文（只咬这一向的话，整段删掉也会绿）", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const firstLayer = visibleText(document.body);
    for (const d of DEMOTED) {
      expect(firstLayer, `「${d.text}」仍留在第一层 ⇒ 这一条根本没降层`).not.toContain(d.text);
    }
    cleanup();

    render(<InspectorNodePanel input={mkInput(CF_NODE)} />);
    expect(visibleText(document.body), `「${CF_DEMOTED.text}」仍留在第一层`).not.toContain(CF_DEMOTED.text);
  });

  it("② 第一层留着**可见的 `?` 记号**（真 button · 有字），静默降层等于删除", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    for (const d of DEMOTED) {
      const mark = screen.getByTestId(`info-${d.id}`);
      expect(mark, `「${d.id}」降了层却没留记号`).toBeVisible();
      // 真 <button>：Tab 到得了、读屏念得到，不是只在 hover 时才显形的花活。
      expect(mark.tagName).toBe("BUTTON");
      expect((mark.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    cleanup();

    render(<InspectorNodePanel input={mkInput(CF_NODE)} />);
    const cfMark = screen.getByTestId(`info-${CF_DEMOTED.id}`);
    expect(cfMark).toBeVisible();
    expect(cfMark.tagName).toBe("BUTTON");
  });

  it("③ hover 之后浮层里**逐字含**该原文（这一向单独也不够，见 ① —— 两条合起来才算数）", async () => {
    const user = userEvent.setup();
    render(<InspectorNodePanel input={mkInput()} />);

    for (const d of DEMOTED) {
      // 关着时浮层正文**根本不在 DOM 里**（不是 hidden）——查存在会把"没搬"读成"搬好了"
      expect(screen.queryByTestId(`info-body-${d.id}`)).toBeNull();
      await user.hover(screen.getByTestId(`info-wrap-${d.id}`));
      const body = await screen.findByTestId(`info-body-${d.id}`);
      expect(body).toBeVisible();
      expect(visibleText(body), `浮层「${d.id}」里没有那段原文 ⇒ 这是删除，不是降层`).toContain(d.text);
      await user.unhover(screen.getByTestId(`info-wrap-${d.id}`));
    }
    cleanup();

    render(<InspectorNodePanel input={mkInput(CF_NODE)} />);
    expect(screen.queryByTestId(`info-body-${CF_DEMOTED.id}`)).toBeNull();
    await user.hover(screen.getByTestId(`info-wrap-${CF_DEMOTED.id}`));
    const cfBody = await screen.findByTestId(`info-body-${CF_DEMOTED.id}`);
    expect(visibleText(cfBody)).toContain(CF_DEMOTED.text);
  }, 30000);

  it("④ ② 流动效率：算式降进浮层，但两个**天数本身仍在第一层**（规范 §1：浮层不许放结论性数字）", () => {
    render(<InspectorNodePanel input={mkInput()} />);
    const box = screen.getByTestId("insp-flow-eff");
    const t = visibleText(box);

    // 运算符没了（`= A ÷ B` 是算式 ⇒ R-UI-3 属浮层）
    expect(t, "第一层仍印着除法算式").not.toContain("÷");
    // 但值一个都没少：标签 + 天数都还在，且 data-* 原样（改的是排版，不是数）
    expect(t).toContain("增值");
    expect(t).toContain("前置期");
    expect(box.getAttribute("data-lead-days")).toBeTruthy();
    expect(box.getAttribute("data-value-days")).toBeTruthy();
  });
});

describe("§2 · 内容守恒（反「删内容冒充变好」）", () => {
  /**
   * 规范 §1 的红线只有一句话：**允许降层、绝不允许删除**。
   * 分数变好有两条成因，一好一坏，**光看第一层的数分不出来**：
   *   · 真降层：内容从第一层**搬到**浮层 ⇒ first ↓ 且 deferred ↑，**总量不变或上涨**
   *   · 假降层：内容被**删掉**          ⇒ first ↓ 而 deferred 不涨，**总量下跌**
   * 故这里咬**总量**：把面板整棵树上带字的元素数一遍，不许塌掉。
   */
  it("面板文本元素总数不塌（把六段口径搬进浮层，总量只增不减）", async () => {
    const user = userEvent.setup();
    const { container } = render(<InspectorNodePanel input={mkInput()} />);

    const textEls = () =>
      Array.from(container.querySelectorAll("*")).filter((el) =>
        Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0)
      ).length;

    const closed = textEls();
    // 面板本身内容很多；这个下界只用来挡「整块塌掉」，不是精确金值（精确计数由门的棘轮管）。
    expect(closed).toBeGreaterThan(40);

    // 逐个打开浮层 ⇒ 总量必须**涨**（搬进去的东西真在里面，不是空壳）
    for (const d of DEMOTED) {
      await user.hover(screen.getByTestId(`info-wrap-${d.id}`));
      await screen.findByTestId(`info-body-${d.id}`);
      expect(textEls(), `打开「${d.id}」后总量没涨 ⇒ 浮层是空的`).toBeGreaterThan(closed);
      await user.unhover(screen.getByTestId(`info-wrap-${d.id}`));
    }
  }, 30000);
});

describe("§3 · 字号：R-UI-2 三级上限 + 12px 硬底（判据落在源码实测，不落在「我改过了」）", () => {
  /** 抽出一个 CSS module 里所有 `font-size` 的**像素**取值。 */
  const pxSizes = (css: string): number[] =>
    Array.from(css.matchAll(/font-size\s*:\s*([\d.]+)px/g))
      .map((m) => Number(m[1]))
      .filter((n) => n > 0); // `font-size:0` 是折叠 inline-block 空白的排版手法，不是一级正文字号

  /** 金丝雀：先证明抽取器没瞎 —— 一个已知必中的样例抽不出来，就是**工具坏了**，不是"代码干净"。 */
  it("金丝雀：抽取器对已知样例必中（报 0 命中之前先自证工具是对的）", () => {
    expect(pxSizes(".a{font-size: 12.5px}.b{font-size:26px}.c{font-size:0}")).toEqual([12.5, 26]);
    // 必不咬一侧：没有 font-size 就该是空集，而不是乱抓别的数字
    expect(pxSizes(".a{line-height: 1.5; padding: 14px}")).toEqual([]);
  });

  const TOUCHED = [
    "apps/frontend-shell/src/views/sim/InspectorNodePanel.module.css",
    "apps/frontend-shell/src/views/sim/SimViews.module.css",
  ] as const;

  it("本单改过的两个 CSS module：**一处都没有低于 12px 的字号**（版面门硬底）", () => {
    for (const f of TOUCHED) {
      const sizes = pxSizes(readRepo(f));
      expect(sizes.length, `${f} 一个 font-size 都没抽到 ⇒ 抽取器或路径坏了`).toBeGreaterThan(0);
      const under = sizes.filter((n) => n < 12);
      expect(under, `${f} 有低于 12px 的字号：${under.join(" / ")}`).toEqual([]);
    }
  });

  /**
   * 取一条 CSS 规则**自己那一对花括号之间**的声明。
   *
   * ⚠ 这个 `indexOf("}")` 不是洁癖，是**变异反证当场逼出来的**：第一版写的是
   * `css.slice(idx).slice(0, 260)`（固定窗口 260 字），把 `.audHead` 故意改回 12.5px 之后
   * 这条断言**照样绿** —— 因为 260 字的窗口越过了闭合花括号，扫进了**隔壁** `.audWhy` 的
   * `font-size: 12px` 并拿它当成命中。形态照 CLAUDE.md 铁律 0.6：
   * **「我用『这段文本里出现了 12px』当作『这条类是 12px』的证据，而前者并不度量后者。」**
   * 本仓 2026-08-08 记的第 4 个坑（120 字窗口把 `G-NO-FREIGHT-COST` 截成 `-CO`）是同一个病。
   */
  const ruleBody = (css: string, name: string): string => {
    const start = css.indexOf(`.${name} {`);
    if (start < 0) throw new Error(`CSS 里找不到 .${name} —— 类被删/改名了，不是"通过"`);
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    if (close < 0) throw new Error(`.${name} 的规则没有闭合花括号 ⇒ CSS 解析不了，判工具坏了`);
    return css.slice(open + 1, close);
  };

  it("金丝雀：`ruleBody` 只取本条类的声明，**不许**串到隔壁类（固定窗口切法会串，已实测）", () => {
    const sample = ".a {\n  font-size: 12.5px;\n}\n.b {\n  font-size: 12px;\n}";
    expect(ruleBody(sample, "a")).toContain("12.5px");
    expect(ruleBody(sample, "a"), "串到隔壁 .b 了 ⇒ 这个抽取器会制造假绿").not.toMatch(/font-size:\s*12px\b/);
    expect(ruleBody(sample, "b")).toMatch(/font-size:\s*12px/);
  });

  it("半档字号已归并：`.audHead` 不再是 12.5px、`.okBar` 不再是 13px（它们各占掉一整级配额）", () => {
    const css = readRepo("apps/frontend-shell/src/views/sim/SimViews.module.css");
    for (const name of ["audHead", "okBar"]) {
      const body = ruleBody(css, name); // 类被删掉会在这里抛，不会静静变绿
      expect(body, `.${name} 的字号不是 12px，实际声明：${body.replace(/\s+/g, " ").trim()}`).toMatch(
        /font-size:\s*12px\s*;/
      );
    }
  });

  it("`InspectorNodePanel.module.css` 的字号档位收敛到三级（26 主数值 / 13 标题标签 / 12 辅助说明）", () => {
    const levels = [...new Set(pxSizes(readRepo("apps/frontend-shell/src/views/sim/InspectorNodePanel.module.css")))].sort(
      (a, b) => a - b
    );
    expect(levels, `实际档位：${levels.join(" / ")}`).toEqual([12, 13, 26]);
  });
});
