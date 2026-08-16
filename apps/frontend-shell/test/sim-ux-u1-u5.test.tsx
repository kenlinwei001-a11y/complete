import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SANDBOX-53CELLS · 判据 **U5**（结论数字标出处）在 `global-sim` / `optimize-whatif` 两页的接缝测试。
 * （`what-if` 的 U1 与 U5 由 `test/what-if.test.tsx` 就地咬 —— 那里已有该页的完整桩。）
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U5）：
 *   「屏上的结论性数字带**指名道姓**的出处——求解器名 / 快照版本 / 推导链 / 依据规则，任一即可；**裸数字不算**」。
 * 用户读了能做的决定：**数不对时知道该找哪一环，而不是整屏一起怀疑**。
 *
 * ⚠ 本文件刻意**只咬 hover 之后弹出来的那一份**，理由是判据的失败模式：
 * 「屏上某处提过一次求解器名」≠「这个数字带了出处」——
 * `optimize-whatif` 改前就有一条 `ow-family-source`，但它说的是**模板清单**的出处，
 * 不是**目标值**的出处。拿它当 U5 的证据，就是「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 * 所以断言必须落在**那个数字自己**的溯源浮层上。
 */

describe("判据 U5 · global-sim 结论读数带出处", () => {
  it("U5-C1 · 按期率 / 总代价 / 被挤单 三个读数各自 hover → 弹出求解器名 + 推导 + 输入（改前全是裸数字）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");

    // 先等真求解结果出来（否则下面找不到读数会被误读成「没挂出处」）。
    const readout = await screen.findByTestId("global-sim-readout", {}, { timeout: 8000 });

    // ── 按期率 ────────────────────────────────────────────
    // 改前：`<b>{ontimeRate.toFixed(0)}%</b>` 一个裸数字，屏上没有一个字说它是谁算的。
    const ontime = within(readout).getByTestId("prov-v-gs-ontime");
    expect(screen.queryByTestId("prov-tip")).toBeNull(); // 口径进浮层，不占第一层
    await userEvent.hover(ontime);
    const tip = await screen.findByTestId("prov-tip");
    expect(tip.textContent).toContain("portfolio"); // 指名道姓的求解器
    expect(tip.textContent).toContain("按期率 ="); // 推导链
    await userEvent.unhover(ontime);

    // ── 总代价 ────────────────────────────────────────────
    const cost = within(readout).getByTestId("prov-v-gs-cost");
    await userEvent.hover(cost);
    const costTip = await screen.findByTestId("prov-tip");
    expect(costTip.textContent).toContain("portfolio");
    expect(costTip.textContent).toContain("加权求和");
    await userEvent.unhover(cost);

    // ── 被挤单 ────────────────────────────────────────────
    const disp = within(readout).getByTestId("prov-v-gs-displaced");
    await userEvent.hover(disp);
    const dispTip = await screen.findByTestId("prov-tip");
    expect(dispTip.textContent).toContain("portfolio");
    // 「数不对时该找哪一环」—— 判据的用户价值，必须真写在屏上。
    expect(dispTip.textContent).toContain("客户级影响");
  });
});

describe("判据 U5 · optimize-whatif 目标值带出处", () => {
  it("U5-C2 · Δ 目标值 hover → 求解器名 + 模板族 + seed + 扰动清单（三样缺一就复算不出同一个最优解）", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");

    // 本页仍有「推演」提交闸（U1 未闭 —— 走真 CP-SAT，撤闸的重解成本要先测，本单诚实挂账）。
    const run = await screen.findByTestId("ow-solve", {}, { timeout: 8000 });
    await userEvent.click(run);

    const banner = await screen.findByTestId(/ow-(switch|delta)-banner/, {}, { timeout: 8000 });

    // ⚠ 反向判据先跑：改前屏上唯一的出处 `ow-family-source` 说的是**模板清单**，不是目标值。
    // 它今天仍在（没删），所以「屏上出现过 optimize_whatif 几个字」不构成 U5 成立 ——
    // 断言必须落在 Δ 这个数字**自己**的浮层上。
    const delta = within(banner).getByTestId("prov-v-ow-delta");
    expect(screen.queryByTestId("prov-tip")).toBeNull();

    await userEvent.hover(delta);
    const tip = await screen.findByTestId("prov-tip");
    expect(tip.textContent).toContain("optimize_whatif"); // 求解器名
    expect(tip.textContent).toContain("seed 42"); // 复算三要素之二
    expect(tip.textContent).toContain("模板族"); // 复算三要素之一
    expect(tip.textContent).toContain("Δ ="); // 推导链

    // 第一层也留一条可见的出处行（结论数字的出处不该只活在 hover 里）。
    await waitFor(() => expect(screen.getByTestId("ow-objective-source").textContent).toContain("optimize_whatif"));
    expect(screen.getByTestId("ow-objective-source").textContent).toContain("seed 42");
  });
});
