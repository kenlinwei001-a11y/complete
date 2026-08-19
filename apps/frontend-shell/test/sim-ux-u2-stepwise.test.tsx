import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { mockPlanGenerate } from "@/mocks/simSolvers";

/**
 * WO-U2-STEPWISE-1 · 判据 **U2**（推演过程分步可见·每步标 数据·求解器·规则）的接缝测试。
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U2）：
 *   「页内有推演过程的步骤态（同一份结果按步展开），且每步能看到它的 数据·求解器·规则。
 *    **业务流程步骤（评审→平衡→定稿）与行动计划步骤不算**」
 *
 * ⚠ **验收判据不是「步骤条渲染出来了」，是「步骤态真正驱动结果分段」**（WO 原文）。
 * 所以本文件的核心断言形态是：**点第 N 步 ⇒ 结果区的数变了（只显示到第 N 步为止）**——
 * 每页都按「切步前在的数 → 切步后不在 / 切回后回来」咬具体的数（综合分、Δ、目标值），
 * 不是咬组件在不在。
 *
 * ⚠ 变异反证（WO 要求）：把 `SolverStepBar.tsx` 里 `useSolverStep` 的 `upto` 改成恒真
 * （`upto: () => true`，分段逻辑拆掉）→ 本文件 C1/C2/C3/C4 全部必须红，且红在
 * 「切到第 N 步后那个数**还在**」（数没变），不是红在「步骤条不见了」。
 * 实测原文见交单报告（变异已真跑过·非推演）。
 */

const EXP = mockPlanGenerate({}) as {
  schemes: { no: string; pathKey: string; hardViol: string[]; scores: { total: number } }[];
  recommend: string;
};
const REC_NO = EXP.schemes.find((s) => s.pathKey === EXP.recommend && s.hardViol.length === 0)!.no;

describe("WO-U2-STEPWISE-1 · plan-generate：步骤态真正驱动结果分段", () => {
  it("U2-C1 · 步骤条在 + 当前步能看到 数据·求解器·规则（U2 判据第二半）；默认末步=完整结果", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");

    // 步骤条五步齐全（求解链：入参 → 路径推演 → 评分 → 校验 → 推荐——不是业务流程步骤）。
    const bar = screen.getByTestId("gen-steps");
    expect(bar).toBeInTheDocument();
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`gen-steps-step-${n}`)).toBeInTheDocument();

    // 默认末步：口径行显示第 5 步的 数据·求解器·规则（三样齐全，缺一 U2 不成立）。
    expect(screen.getByTestId("gen-steps-meta-data")).toHaveTextContent("recommend");
    expect(screen.getByTestId("gen-steps-meta-solver")).toHaveTextContent("plan_generate");
    expect(screen.getByTestId("gen-steps-meta-rule")).toHaveTextContent("scores.total");

    // 默认末步 = 完整结果（与改前屏面一致）：综合分 / 推荐徽标 / 达成行都在。
    expect(screen.getByTestId(`scheme-score-${REC_NO}`)).toBeInTheDocument();
    expect(screen.getByTestId(`recommend-badge-${REC_NO}`)).toBeInTheDocument();
    expect(screen.getByTestId(`meet-${REC_NO}-meetGm`)).toBeInTheDocument();

    // 切到第 2 步 → 口径行跟着换（第 2 步的三要素：outcome 字段 / plan_generate / 路径骨架收敛）。
    fireEvent.click(screen.getByTestId("gen-steps-step-2"));
    expect(screen.getByTestId("gen-steps-meta-data")).toHaveTextContent("outcome");
    expect(screen.getByTestId("gen-steps-meta-solver")).toHaveTextContent("plan_generate");
    expect(screen.getByTestId("gen-steps-meta-rule")).toHaveTextContent("路径骨架");
  });

  it("U2-C2 · 切到第 2 步 ⇒ 结果区的数真变：综合分/推荐/达成消失，outcome 六维与入参回执仍在；切回末步全回来", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");
    // 推荐方案默认展开（useEffect 异步）——先等达成行出来，确保展开态就位再切步。
    await screen.findByTestId(`meet-${REC_NO}-meetGm`);

    // 切第 2 步「路径推演」。
    fireEvent.click(screen.getByTestId("gen-steps-step-2"));

    // ── 核心断言：数变了，且方向是「只显示到第 2 步为止」────────────────
    // 第 3 步的数（综合分）必须消失——变异（upto 恒真）时它还在 ⇒ 本条红在「数没变」。
    await waitFor(() => expect(screen.queryByTestId(`scheme-score-${REC_NO}`)).toBeNull());
    // 第 4 步（达成行）/ 第 5 步（推荐徽标 + 推荐口径行）同样退场。
    expect(screen.queryByTestId(`meet-${REC_NO}-meetGm`)).toBeNull();
    expect(screen.queryByTestId(`recommend-badge-${REC_NO}`)).toBeNull();
    expect(screen.queryByTestId("gen-recommend-line")).toBeNull();
    // 第 2 步的数（outcome 六维）与第 1 步的入参回执**仍在**——不是一键清空。
    expect(screen.getByTestId(`gen-outcome-${REC_NO}`)).toHaveTextContent("毛利率");
    expect(screen.getByTestId("gen-step-inputs")).toHaveTextContent("求解器回显基线");
    // 方案卡本身（schemes[]）是第 2 步产物——三张卡都还在。
    expect(screen.getByTestId(`scheme-${REC_NO}`)).toBeInTheDocument();

    // 切第 1 步：连方案卡都退场，只剩入参回执。
    fireEvent.click(screen.getByTestId("gen-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId(`scheme-${REC_NO}`)).toBeNull());
    expect(screen.getByTestId("gen-step-inputs")).toBeInTheDocument();

    // 切回末步：全部回来（步骤态是双向的，不是一次性藏掉）。
    fireEvent.click(screen.getByTestId("gen-steps-step-5"));
    await screen.findByTestId(`scheme-score-${REC_NO}`);
    expect(screen.getByTestId(`recommend-badge-${REC_NO}`)).toBeInTheDocument();
  });

  it("U2-C3 · 中间步精确：第 3 步有综合分、无达成/推荐（分段不是「全有或全无」两档）", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");
    await screen.findByTestId(`meet-${REC_NO}-meetGm`);

    fireEvent.click(screen.getByTestId("gen-steps-step-3"));

    // 第 3 步的数在（综合分 + 雷达），第 4/5 步的数不在。
    expect(screen.getByTestId(`scheme-score-${REC_NO}`)).toBeInTheDocument();
    expect(screen.getByTestId(`radar-${REC_NO}-polygon`)).toBeInTheDocument();
    expect(screen.queryByTestId(`meet-${REC_NO}-meetGm`)).toBeNull();
    expect(screen.queryByTestId(`recommend-badge-${REC_NO}`)).toBeNull();
    // 第 2 步的数仍在（outcome 六维）。
    expect(screen.getByTestId(`gen-outcome-${REC_NO}`)).toBeInTheDocument();
  });
});

describe("WO-U2-STEPWISE-1 · optimize-whatif：步骤态真正驱动结果分段", () => {
  it("U2-C4 · 推演后切步：第 1 步只剩入参回执；第 2 步两次求解（方案卡）出现、Δ 未出；第 3 步 Δ/可行性出现、解读未出", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    // WO-U4B-U1-U8 · 判据 U1：`ow-solve` 提交闸已撤 ⇒ 不点按钮，预置扰动就位即自动求解。
    // 默认末步 = 完整结果（与改前屏面一致）：决策切换横幅 + Δ+18 + 双卡 + 可行性 + 解读全在。
    await screen.findByTestId("ow-switch-banner", {}, { timeout: 8000 });
    expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+18");
    expect(screen.getByTestId("ow-baseline-card")).toHaveTextContent("114");
    expect(screen.getByTestId("ow-explanation")).toBeInTheDocument();

    // 步骤条四步 + 当前步口径行（数据·求解器·规则）。
    const bar = screen.getByTestId("ow-steps");
    expect(bar).toBeInTheDocument();
    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`ow-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("ow-steps-meta-data")).toHaveTextContent("explanation");
    expect(screen.getByTestId("ow-steps-meta-solver")).toHaveTextContent("optimize_whatif");

    // ── 切第 1 步：只剩入参回执，Δ/方案卡/可行性/解读全退场（数真变了）──
    fireEvent.click(screen.getByTestId("ow-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("ow-delta-obj")).toBeNull());
    expect(screen.queryByTestId("ow-baseline-card")).toBeNull();
    expect(screen.queryByTestId("ow-perturbed-card")).toBeNull();
    expect(screen.queryByTestId("ow-feasibility")).toBeNull();
    expect(screen.queryByTestId("ow-explanation")).toBeNull();
    expect(screen.getByTestId("ow-step-inputs")).toHaveTextContent("模板族 facility_location");
    expect(screen.getByTestId("ow-step-inputs")).toHaveTextContent("seed 42");

    // ── 切第 2 步：两次求解的方案卡出现（真目标值 114/132），Δ 判定未出 ──
    fireEvent.click(screen.getByTestId("ow-steps-step-2"));
    await screen.findByTestId("ow-baseline-card");
    expect(screen.getByTestId("ow-baseline-card")).toHaveTextContent("114");
    expect(screen.getByTestId("ow-perturbed-card")).toHaveTextContent("132");
    expect(screen.queryByTestId("ow-delta-obj")).toBeNull(); // Δ 是第 3 步「比对判定」
    expect(screen.queryByTestId("ow-explanation")).toBeNull();

    // ── 切第 3 步：Δ + 决策切换 + 可行性出现，解读仍未出 ──
    fireEvent.click(screen.getByTestId("ow-steps-step-3"));
    await screen.findByTestId("ow-switch-banner");
    expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+18");
    expect(screen.getByTestId("ow-feasible")).toHaveAttribute("data-feasible", "1");
    expect(screen.queryByTestId("ow-explanation")).toBeNull();

    // 切回末步：解读回来（步骤态双向）。
    fireEvent.click(screen.getByTestId("ow-steps-step-4"));
    await screen.findByTestId("ow-explanation");
  });
});
