import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F45 · 自成长发动机驾驶舱（P6）：运行 LOOP → GapReport 逐轮 + 收敛终态；成长账本 + 工单看板 + 量化指标。
 */
describe("F45 · 自成长发动机驾驶舱", () => {
  it("账本/工单/指标加载 + 运行一轮见收敛终态与逐轮缺口", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/growth");
    await screen.findByTestId("growth-cockpit-page");

    // 量化指标（账本 2 条、1 条 CONVERGED → 可答率 50%）
    expect(await screen.findByTestId("metric-answer-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("metric-open-tickets")).toHaveTextContent("1");
    // WO-UNIT-MEANING：三个指标此前都是裸数——补量纲后锁死
    //（可答率括号内说明是「次数比」而非第二个百分数；工单计"张"；累计运行计"次"）
    expect(screen.getByTestId("metric-answer-rate")).toHaveTextContent("(可答 1 次 / 共 2 次)");
    expect(screen.getByTestId("metric-open-tickets").parentElement!.textContent).toMatch(/开放工单\s*1\s*张/);
    expect(screen.getByText(/累计运行/).textContent).toMatch(/累计运行\s*2\s*次/);
    // 成长账本列头：格内是 length 计数，列头必须点明单位（此前「工单」易被读成工单号）
    const ledger = screen.getByTestId("growth-ledger");
    expect(within(ledger).getByText("轮数(轮)")).toBeTruthy();
    expect(within(ledger).getByText("开放工单数(张)")).toBeTruthy();

    // 成长账本列出历史运行
    expect(await screen.findByTestId("ledger-glr_1")).toHaveTextContent("常州影响哪些订单");
    expect(screen.getByTestId("ledger-glr_2")).toHaveTextContent("BOUNDARY");

    // 工单看板 + 认领
    const tk = await screen.findByTestId("ticket-gtk_1");
    expect(tk).toHaveTextContent("NO_CAPABILITY");
    await user.click(within(tk).getByTestId("claim-gtk_1"));
    await screen.findByText("已认领");

    // 运行一轮 → 终态 + 逐轮缺口
    await user.click(screen.getByTestId("growth-run"));
    const report = await screen.findByTestId("growth-report");
    expect(within(report).getByTestId("growth-terminal")).toHaveTextContent("边界");
    // WO-UNIT-MEANING：`K=8` 此前是无解释的裸参数 → 点明 K 即最大轮数上限（同单位：轮）
    expect(report.textContent).toMatch(/已跑 \d+ 轮 \/ 上限 K=\d+ 轮/);
    expect(within(report).getByTestId("growth-round-1")).toHaveTextContent("NO_INTENT");
  });
});
