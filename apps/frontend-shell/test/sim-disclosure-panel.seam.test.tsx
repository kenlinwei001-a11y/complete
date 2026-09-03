/**
 * WO-SIM-DISCLOSURE 接缝门（前端半）—— 披露面板 × **真后端回包**。
 *
 * ⛔ **它咬的是链路不是函数**（SEAM-GATE）：后端装配（`datacore/src/sim/disclosure.ts`）与
 * 前端渲染（`views/sim/unified/rail/DisclosurePanel.tsx`）是两半。本文件喂给面板的
 * **不是手写夹具，是真后端一次真跑的原样回包**：
 *
 *   `fixtures/sim-disclosure.real.json` = 2026-09-03 起内存态 datacore（`SEED_DEMO=1`·seed 42·
 *   demo 租户 `sims_demo_seed_world`）经 `POST /a/v1/sim/sessions/{id}/tick` 带 `disclose:true`
 *   拿到的 `disclosure` 段，一个字节没改。规模：46 条规则 / 32 条取值域 / 87 个对象类型。
 *
 * ⇒ 后端哪天改了字段名或少给一项，这里当场红；而**手写夹具做不到这一点**
 *   （手写的会跟着前端一起改，两边一起漂还一起绿）。
 *
 * ── 本文件存在的第二个理由：文体约束只能机器验 ────────────────────────────────
 * 仓主对这块屏定了三条硬约束，**三条都是「屏上不许出现 X」** ——
 * 这类约束靠人眼看截图是查不全的（46 条规则 × 每条 8 个字段），必须扫渲染后的文本：
 *   ① 不许出现 Markdown 字面量（`**` / 反引号）——本仓刚修掉两处泄漏；
 *   ② 不许打源码文件名 / 行号（R-UI-4）；
 *   ③ 只给「标签 + 值 + 状态」，不许出现描述性句子。
 * ⚠ 每条断言都先跑**金丝雀**（拿一个已知必中的样例证明扫法是好的），
 *   否则「扫不出来」与「真的没有」在屏上一模一样（铁律 0.6 已落地的机制）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SimRunDisclosure } from "@platform/contracts";
import DisclosurePanel from "@/views/sim/unified/rail/DisclosurePanel";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(
  readFileSync(join(TEST_DIR, "fixtures/sim-disclosure.real.json"), "utf8"),
) as SimRunDisclosure;

/** 把面板整块渲染开（含所有二层 `<details>`），返回屏上的**全部可见文本**。 */
function screenText(d: SimRunDisclosure = REAL): string {
  const { container } = render(<DisclosurePanel disclosure={d} />);
  // `<details>` 默认收起 —— jsdom 不做 CSS，`textContent` 本来就拿得到里面的字。
  // 但为了让"展开后长什么样"这件事显式化，这里把它们全打开再取。
  container.querySelectorAll("details").forEach((el) => el.setAttribute("open", ""));
  return container.textContent ?? "";
}

describe("§1 六项都在屏上（铁律 1.5 判据二逐项）", () => {
  it("六个小节一节不缺", () => {
    render(<DisclosurePanel disclosure={REAL} />);
    for (const id of ["data", "slice", "rules", "constraints", "agent", "timings"]) {
      expect(screen.getByTestId(`sim-disclosure-${id}`), `屏上缺了「${id}」这一节`).toBeTruthy();
    }
  });

  it("⛔ agent 那一栏恒写，不留白", () => {
    // 铁律 1.5 原文：「今天推演路零 LLM ⇒ 必须明写『本次未调用 agent』，不许留白让人以为调了」。
    expect(screenText()).toContain("未调用 agent");
    // 反向：真调了 agent 时必须照实写，不是恒印一句"未调用"。
    const invoked: SimRunDisclosure = {
      ...REAL,
      agent: { invoked: true, calls: 2, provider: "anthropic", model: "some-model" },
    };
    const t = screenText(invoked);
    expect(t).toContain("调用了 agent");
    expect(t).toContain("2 次");
  });

  it("真后端的读数**原样**上屏（不是写死的展示）", () => {
    const t = screenText();
    // 这些数全部来自真跑：46 条规则、12,745 个对象、12,192 条边、快照版本串。
    expect(t).toContain(String(REAL.rules.declared));
    expect(t).toContain(REAL.data.snapshotVersion);
    expect(t).toContain(REAL.slice.sliceKey);
    expect(t).toContain((12745).toLocaleString("zh-CN")); // 千分位，与屏上一致
  });

  it("「没取到披露」与「取到了但是零」不许长成同一个样子", () => {
    const { container } = render(<DisclosurePanel disclosure={undefined} />);
    expect(container.textContent).toBe(""); // 整块不渲染
    // 而"取到了、但世界是空的"要照常出六节（0 是真值，不是缺席）。
    const empty: SimRunDisclosure = {
      ...REAL,
      rules: { ...REAL.rules, declared: 0, fired: 0, items: [], contributions: 0 },
    };
    expect(screenText(empty)).toContain("未调用 agent");
  });
});

describe("§2 文体三条硬约束（每条先跑金丝雀证明扫法是好的）", () => {
  it("⛔ 屏上不许出现 Markdown 字面量（`**` 与反引号）", () => {
    const canary = "带 **粗体** 与 `反引号` 的串";
    expect(/\*\*|`/.test(canary), "金丝雀不中 ⇒ 扫法坏了，不许报『屏上很干净』").toBe(true);

    const t = screenText();
    expect(t.includes("**"), "屏上出现了 Markdown 粗体字面量").toBe(false);
    expect(t.includes("`"), "屏上出现了反引号").toBe(false);
  });

  it("⛔ 屏上不许出现源码文件名 / 行号（R-UI-4）", () => {
    // 真后端的 `constraints.stateVarBounds[].source` 里**确实带**源码文件名
    // （实测每条 6 个反引号 + 形如 `sim/drill-scan.ts` 的坐标）——
    // 金丝雀先证明：那个串真的在回包里，且我的扫法抓得住它。
    const rawSource = REAL.constraints.stateVarBounds[0]?.source ?? "";
    const SRC_RE = /[A-Za-z0-9_./-]+\.(ts|tsx|mjs|js|json)(:\d+)?/;
    expect(rawSource.length > 0, "夹具里没有 source 字段 ⇒ 这条断言什么都没在验").toBe(true);
    expect(SRC_RE.test(rawSource), "金丝雀不中 ⇒ 扫法坏了").toBe(true);

    // 而屏上必须一个都没有。
    const t = screenText();
    expect(SRC_RE.test(t), `屏上出现了源码坐标：${t.match(SRC_RE)?.[0] ?? ""}`).toBe(false);
  });

  it("⛔ 屏上只给「标签 + 值 + 状态」，不出现描述性句子", () => {
    // 判据取**成句的标点**：句号 / 分号 / 「…」引述 —— 标签值对里不会出现这些。
    // 分隔用的 `·` 与单位里的连字号不算。
    const canary = "本次推演沿供应链核心切片走了三跳，共涉及 32 个节点。";
    const SENTENCE_RE = /[。；]|，[^·]{6,}/;
    expect(SENTENCE_RE.test(canary), "金丝雀不中 ⇒ 扫法坏了").toBe(true);

    const t = screenText();
    expect(SENTENCE_RE.test(t), `屏上出现了描述性句子：${t.match(SENTENCE_RE)?.[0] ?? ""}`).toBe(false);
  });
});

describe("§3 逐规则那张表把「系数打哪来」讲清楚", () => {
  it("46 条规则逐条上屏，命中与未命中用**词**分开（不靠颜色单独承载语义）", () => {
    const t = screenText();
    expect(REAL.rules.items.length).toBe(46);
    for (const r of REAL.rules.items.slice(0, 5)) expect(t).toContain(r.ruleKey);
    expect(t).toContain("命中");
  });

  it("⛔ 系数来源按解析结果显示 —— 真后端这一跑 46 条全是内联，屏上就得这么写", () => {
    // 这正是铁律 1.5 判据四那笔账的读数：注释写着「两条路都来自配置」，
    // 实测走 `coefficientRef` 的是 **0 条**。屏上必须照实测写，不照注释写。
    expect(REAL.rules.withCoefficientRef, "真后端实测：走 coefficientRef 的规则条数").toBe(0);
    render(<DisclosurePanel disclosure={REAL} />);
    // ⚠ 判据落在**逐规则那张表**上，不是整块面板：汇总行里有一对
    // 「系数来自配置 0」的标签+值，那是**如实报 0**，不是给某条规则贴错标。
    // 拿整块面板的文本去断言，会把那个正确的 0 读成违规 —— 这条断言第一版就是这么写错的，
    // 形态正是「我用一个看起来相关的串当判据，而它并不度量我要度量的东西」。
    const rows = screen.getByTestId("sim-disclosure-rule-items").textContent ?? "";
    expect(rows).toContain("内联常数");
    expect(rows, "这一跑 46 条全是内联，规则行里不许出现「来自配置」这个记号").not.toContain("来自配置");
  });

  it("权重口径与归一方式都上屏（真后端这一跑 3 条带分摊）", () => {
    expect(REAL.rules.withWeightRef).toBe(3);
    const t = screenText();
    expect(t).toContain("bom_cost_share");
    expect(t).toContain("IN_EDGES");
    expect(t).toContain("source_qty_relative");
  });
});

describe("§4 约束那一节回答「阈值来自哪条规则表达式」", () => {
  it("逐量纲给边界 + 衰减出处 + 规则表达式原文", () => {
    const t = screenText();
    const b = REAL.constraints.stateVarBounds[0]!;
    expect(t).toContain(b.stateVar);
    expect(t).toContain(b.decayRef ?? "");
    expect(t).toContain(b.decayRuleExpression ?? "");
    // 真后端这一跑：32 条取值域、9 个量纲没声明、饱和 4,000+ 次 —— 三个数都要在屏上。
    expect(t).toContain(REAL.constraints.saturations.toLocaleString("zh-CN"));
  });
});
