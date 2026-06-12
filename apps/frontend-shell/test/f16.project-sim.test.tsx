import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

describe("F16 · 项目推演（project-sim）", () => {
  it("单批模式：KPI 渲染 + 逐基地下钻 + what-if 重算与 C08 外协超限", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 订单列表（objects 查询）→ 点击写入 selectedObjects
    const order = await screen.findByTestId("proj-order-SO-10001");
    await user.click(order);
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Order", label: "SO-10001" }),
    ]);

    // 回到默认输入（4680-NCM · 40 万套 · 6 周）→ 推演
    fireEvent.change(screen.getByLabelText("需求(万套)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("交期(周)"), { target: { value: "6" } });
    await user.click(screen.getByTestId("proj-run"));

    // KPI：P50 = Σ基地 Σ周（周产能×爬坡×检修×认证）= 42.0；P90 = ×0.93
    const p50 = await screen.findByTestId("kpi-p50");
    expect(p50).toHaveTextContent("42.0");
    expect(screen.getByTestId("kpi-p90")).toHaveTextContent("39.0");
    expect(screen.getByTestId("proj-verdict-bar")).toHaveTextContent("✗ P90 缺口");
    expect(screen.getByTestId("snapshot-badge")).toHaveTextContent("ov-12");

    // 逐基地下钻：合肥 B 线认证中 ×0.6 徽章 + 检修周 + 紧张度
    const table = screen.getByTestId("per-base-table");
    expect(within(table).getByText("常州")).toBeInTheDocument();
    expect(screen.getByTestId("cert-pending-合肥")).toHaveTextContent("认证中 ×0.6");
    expect(screen.getByTestId("pending-cert")).toHaveTextContent("认证中");

    // what-if：夜班 +1 → 调整后 P50 = 42.0 × 1.06 = 44.5，并排显示调整前/后
    await user.click(screen.getByTestId("night-1"));
    await user.click(screen.getByTestId("whatif-run"));
    const cmp = await screen.findByTestId("whatif-compare");
    expect(within(cmp).getByTestId("whatif-before")).toHaveTextContent("42.0");
    expect(within(cmp).getByTestId("whatif-after")).toHaveTextContent("44.5");

    // 外协比例 25%（>20% 红线）→ C08 拒绝该参数组合
    fireEvent.change(screen.getByLabelText("外协比例"), { target: { value: "25" } });
    await user.click(screen.getByTestId("whatif-run"));
    const rejected = await screen.findByTestId("whatif-rejected");
    expect(rejected).toHaveTextContent("C08");
    expect(rejected).toHaveTextContent("25%");
  });

  it("分批模式：每批 净窗口/累计需求 vs 累计P90 校验表（✓/✗ 混合）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    await user.click(await screen.findByTestId("mode-batch"));
    expect(screen.getByTestId("batch-editor")).toBeInTheDocument();
    await user.click(screen.getByTestId("proj-run"));

    const table = await screen.findByTestId("batch-result-table");
    // 第 1 批（18 万套 @07-13 上海，净窗口 3 周）：18 ≤ 19.4 → ✓ 按期
    expect(within(table).getByTestId("batch-ok-0")).toHaveTextContent("✓ 按期");
    // 第 2 批（22 万套 @08-10 海外，物流 14 天 → 净窗口 6 周）：累计 40 > 39.0 → ✗
    expect(within(table).getByTestId("batch-ok-1")).toHaveTextContent("✗ 缺");
    await waitFor(() => expect(screen.getByTestId("proj-verdict-bar")).toHaveTextContent("有批次越线"));
  });
});
