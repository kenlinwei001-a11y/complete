import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-U2-STEPWISE-2 · 判据 **U2**（推演过程分步可见 · 每步标 数据·求解器·规则）——剩余 9 页。
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U2）：
 *   「页内有推演过程的步骤态（同一份结果按步展开），且每步能看到它的 数据·求解器·规则。
 *    **业务流程步骤（评审→平衡→定稿）与行动计划步骤不算**」
 *
 * ⚠ **验收判据不是「步骤条渲染出来了」，是「步骤态真正驱动结果分段」**（WO 原文）：
 * **点第 N 步 ⇒ 屏上的数只显示到第 N 步为止。** 所以本文件每页的核心断言形态一律是
 * 「切步前**这个具体的数**在 → 切步后它**不在** → 切回末步它**回来**」，
 * ⛔ 不许只咬「组件在不在」——那咬不出装饰件与真闸的区别。
 *
 * ⚠ **变异反证**（WO 硬要求）：把 `views/sim/SolverStepBar.tsx` 里 `useSolverStep` 的
 * `upto` 改成恒真（`upto: () => true`），本文件用例**必须红**，且红在
 * 「切到第 N 步后那个数**还在**」，**不是**红在「步骤条不见了」。实测原文见交单报告。
 */

/** 断言一组「具体的数」此刻**不在屏上**（按 testid 前缀取，避免咬到别处同名文字）。 */
function expectNoneByPrefix(prefix: RegExp): void {
  expect(screen.queryAllByTestId(prefix)).toHaveLength(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// what-if（假设推演）：步骤 = WI_GRAPH 四层（设定假设 → 两条推演路 → 读数 → 逐行明细）
// ══════════════════════════════════════════════════════════════════════════════

/** 选类型 → 选第一个真对象 → 选属性 → 填假设值（本页无提交闸，填完即重演·判据 U1）。 */
async function fillHypothesis(propKey: string, value: string): Promise<void> {
  fireEvent.change(await screen.findByTestId("wi-type-select"), { target: { value: "Base" } });
  const objSelect = await screen.findByTestId("wi-object-select");
  await waitFor(() => {
    const opts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
    expect(opts.length).toBeGreaterThan(0);
  });
  const realOpts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
  fireEvent.change(objSelect, { target: { value: realOpts[0]!.value } });
  fireEvent.change(screen.getByTestId("wi-prop-select"), { target: { value: propKey } });
  fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value } });
}

describe("WO-U2-STEPWISE-2 · what-if：步骤态真正驱动结果分段", () => {
  it("U2-WI-1 · 四步齐 + 当前步能看到 数据·求解器·规则；默认末步 = 完整结果（改前屏面）", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    await screen.findByTestId("wi-result");

    // 步骤条四步（= 图的四层，不是业务流程步骤）。
    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`wi-steps-step-${n}`)).toBeInTheDocument();

    // 末步口径行三要素齐全（缺一 U2 不成立）——逐字来自 WI_GRAPH 的 `deltas` 节点。
    expect(screen.getByTestId("wi-steps-meta-data")).toHaveTextContent("rows[]");
    expect(screen.getByTestId("wi-steps-meta-solver")).toHaveTextContent("generic_inference");
    expect(screen.getByTestId("wi-steps-meta-rule")).toHaveTextContent("量纲");

    // 默认末步 = 完整结果：影响面计数 2/2 + 逐行 after 真值 200 / 1100 全在。
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId(/^wi-after-/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1100").length).toBeGreaterThan(0);

    // 切第 2 步 → 口径行跟着换成**并列层**的三要素（如实写「本层 2 个并列环」，不挑一个冒充全层）。
    fireEvent.click(screen.getByTestId("wi-steps-step-2"));
    expect(screen.getByTestId("wi-steps-meta-solver")).toHaveTextContent("∥");
    expect(screen.getByTestId("wi-steps-meta-rule")).toHaveTextContent("并列环");
  });

  it("U2-WI-2 · 切步 ⇒ 数真的不在了：第 3 步没有逐行 1100、第 2 步连影响面 2 都没有；切回末步全回来", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    await screen.findByTestId("wi-result");
    expect(screen.getAllByText("1100").length).toBeGreaterThan(0);

    // ── 第 3 步「读数」：影响面计数在，逐行明细（第 4 步）退场 ──
    fireEvent.click(screen.getByTestId("wi-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("wi-deltas")).toBeNull());
    expectNoneByPrefix(/^wi-after-/);
    expect(screen.queryAllByText("1100")).toHaveLength(0); // ← 具体的数不在了（变异时它还在 ⇒ 本条红）
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");

    // ── 第 2 步「两条推演路」：连影响面读数也退场，只剩求解基准回执 ──
    fireEvent.click(screen.getByTestId("wi-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("wi-affected-count")).toBeNull());
    expect(screen.queryByTestId("wi-impact-panel")).toBeNull();
    expect(screen.getByTestId("wi-step-solve")).toHaveTextContent("generic_inference");

    // ── 第 1 步「设定假设」：连求解基准都退场，只剩入参回执（假设本身） ──
    fireEvent.click(screen.getByTestId("wi-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("wi-step-solve")).toBeNull());
    expect(screen.getByTestId("wi-step-inputs")).toHaveTextContent("util");

    // ── 切回末步：全部回来（步骤态双向，不是一次性藏掉） ──
    fireEvent.click(screen.getByTestId("wi-steps-step-4"));
    await screen.findByTestId("wi-deltas");
    expect(screen.getAllByText("1100").length).toBeGreaterThan(0);
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// global-sim（全局项目推演）：步骤 = GS_GRAPH 四层
//   入参与杠杆 → 联合求解 → 解的三个面（获排∥被挤∥台账）→ 读数与结论
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U2-STEPWISE-2 · global-sim：步骤态真正驱动结果分段", () => {
  it("U2-GS-1 · 四步齐 + 末步口径行三要素；默认末步 = 完整结果（占用矩阵/读数/台账全在）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-ledger");

    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`gs-steps-step-${n}`)).toBeInTheDocument();
    // 末步（读数与结论）是**并列层**（按期率 ∥ 占用矩阵 ∥ 客户级影响）⇒ 如实写「本层 3 个并列环」。
    expect(screen.getByTestId("gs-steps-meta-data")).toHaveTextContent("objectiveValues.ontime");
    expect(screen.getByTestId("gs-steps-meta-solver")).toHaveTextContent("portfolio");
    expect(screen.getByTestId("gs-steps-meta-rule")).toHaveTextContent("并列环");

    // 默认末步 = 完整结果。
    expect(screen.getByTestId("global-sim-readout")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^global-sim-heat-/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/^global-sim-ledger-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("global-sim-verdict")).toHaveTextContent("守恒");

    // 第 2 步「联合求解」的口径行 = 单节点三要素（status/feasible/optimal · portfolio）。
    fireEvent.click(screen.getByTestId("gs-steps-step-2"));
    expect(screen.getByTestId("gs-steps-meta-data")).toHaveTextContent("feasible");
    expect(screen.getByTestId("gs-steps-meta-solver")).toHaveTextContent("portfolio");
  });

  it("U2-GS-2 · 切步 ⇒ 数真的不在了：第 3 步没有占用率格与按期率、第 2 步连守恒台账也没有；切回末步全回来", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-ledger");

    // 末步先记下两个**具体的数**：占用率格数 与 守恒台账行数。
    const heatCount = screen.getAllByTestId(/^global-sim-heat-/).length;
    const ledgerCount = screen.getAllByTestId(/^global-sim-ledger-/).length;
    expect(heatCount).toBeGreaterThan(0);
    expect(ledgerCount).toBeGreaterThan(0);

    // ── 第 3 步「解的三个面」：台账/分配还在，读数与占用矩阵退场 ──
    fireEvent.click(screen.getByTestId("gs-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-readout")).toBeNull());
    expectNoneByPrefix(/^global-sim-heat-/); // ← 占用率的数全不在了（变异时它们还在 ⇒ 本条红）
    expect(screen.queryByTestId("global-sim-results")).toBeNull();
    expect(screen.getAllByTestId(/^global-sim-ledger-/)).toHaveLength(ledgerCount);
    expect(screen.getByTestId("global-sim-verdict")).toBeInTheDocument();

    // ── 第 2 步「联合求解」：三个面全退场，只剩判定（可行/最优/守恒） ──
    fireEvent.click(screen.getByTestId("gs-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-ledger")).toBeNull());
    expectNoneByPrefix(/^global-sim-ledger-/);
    expect(screen.queryByTestId("global-sim-alloc")).toBeNull();
    expect(screen.getByTestId("global-sim-verdict")).toHaveTextContent("守恒");

    // ── 第 1 步「入参与杠杆」：判定也退场，只剩这次求解读进去的那组入参 ──
    fireEvent.click(screen.getByTestId("gs-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-verdict")).toBeNull());
    expect(screen.queryByTestId("global-sim-feasible")).toBeNull();
    expect(screen.getByTestId("gs-step-inputs")).toHaveTextContent("max_ontime");

    // ── 切回末步：全部回来，且**数量逐个对得上**（不是渲了个空壳） ──
    fireEvent.click(screen.getByTestId("gs-steps-step-4"));
    await screen.findByTestId("global-sim-readout");
    expect(screen.getAllByTestId(/^global-sim-heat-/)).toHaveLength(heatCount);
    expect(screen.getAllByTestId(/^global-sim-ledger-/)).toHaveLength(ledgerCount);
  });
});
