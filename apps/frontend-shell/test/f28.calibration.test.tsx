import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";
import { CALIBRATION_PROPOSALS } from "@/mocks/planFixtures";

describe("F28 · 校准报告页（/admin/calibration，M11 增量）", () => {
  it("MAPE 趋势含 C12 阈值线（8%）与触发标记点 + 切片徽章（INSUFFICIENT_SAMPLES）+ 三级筛选", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    expect(await screen.findByTestId("calib-threshold-line")).toHaveTextContent("C12 阈值线 8%");
    const mark = screen.getByTestId("calib-trigger-mark");
    expect(mark).toHaveTextContent("2026-04-17");
    expect(mark).toHaveTextContent("C12");

    // M11 §2 切片：solverKey×基地×型号；样本不足切片只报告（INSUFFICIENT_SAMPLES）
    expect(screen.getByTestId("calib-slice-capacity_forecast|all|4680-NCM")).toHaveTextContent("42 对");
    expect(screen.getByTestId("calib-slice-capacity_forecast|changzhou|4680-NCM")).toHaveTextContent("样本不足");

    // 三级下钻筛选（对象类型/基地/求解器）联动重查（确定性 mock，仍渲染阈值与标记）
    await user.selectOptions(screen.getByTestId("calib-filter-objectType"), "产能预测");
    await user.selectOptions(screen.getByTestId("calib-filter-base"), "常州");
    await user.selectOptions(screen.getByTestId("calib-filter-solver"), "capacity_forecast");
    expect(await screen.findByTestId("calib-trigger-mark")).toBeInTheDocument();
  });

  it("提案行：方法徽章（EMA/重放归因/分位数）+ 回测证据弹层 + HOLD/REJECTED 状态与标记", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    // 方法徽章（M11 §4 三方法）
    const row = await screen.findByTestId("calib-proposal-prop-1");
    expect(row).toHaveTextContent("化成节拍");
    expect(row).toHaveTextContent("5.2 → 5.6");
    expect(screen.getByTestId("calib-method-prop-1")).toHaveTextContent("重放归因");
    expect(screen.getByTestId("calib-method-prop-2")).toHaveTextContent("EMA");
    expect(screen.getByTestId("calib-method-prop-4")).toHaveTextContent("分位数");

    // 回测证据弹层：窗口/nPairs/mapeBefore→simulatedMapeAfter/bias（§5 出闸硬条件留痕）
    await user.click(screen.getByTestId("calib-basis-prop-1"));
    expect(screen.getByTestId("calib-basis-detail-prop-1")).toHaveTextContent("1840 对配对样本");
    expect(screen.getByTestId("calib-evidence-prop-1")).toHaveTextContent("MAPE 9.40% → 6.80%（模拟）");
    expect(screen.getByTestId("calib-evidence-prop-1")).toHaveTextContent("Bias 0.062");

    // 新状态：REJECTED（NO_IMPROVEMENT）与 HOLD（STRUCTURAL_SHIFT）
    expect(screen.getByTestId("calib-status-prop-4")).toHaveTextContent("REJECTED");
    await user.click(screen.getByTestId("calib-basis-prop-4"));
    expect(screen.getByTestId("calib-flag-prop-4-NO_IMPROVEMENT")).toBeInTheDocument();
    expect(screen.getByTestId("calib-status-prop-5")).toHaveTextContent("HOLD");
    await user.click(screen.getByTestId("calib-basis-prop-5"));
    expect(screen.getByTestId("calib-flag-prop-5-STRUCTURAL_SHIFT")).toBeInTheDocument();
    // HOLD/REJECTED 不提供批准按钮（仅 PENDING 可批准、APPLIED 可回滚）
    expect(screen.queryByTestId("calib-approve-prop-4")).toBeNull();
    expect(screen.queryByTestId("calib-approve-prop-5")).toBeNull();
  });

  it("提案批准走 Action 审批草稿（无直改参数 API）：状态仍 PENDING + 草稿入库", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    await screen.findByTestId("calib-proposal-prop-1");
    const before = db.actionDrafts.length;
    await user.click(screen.getByTestId("calib-approve-prop-1"));
    await waitFor(() => expect(screen.getByTestId("calib-draft-link")).toHaveTextContent("已生成审批草稿"));

    // 走 Action（actionType=校准参数变更），且未直改：提案状态仍 PENDING
    expect(db.actionDrafts.length).toBe(before + 1);
    const draft = db.actionDrafts[0]!;
    expect(draft.actionTypeKey).toBe("校准参数变更");
    expect(draft.status).toBe("PENDING_APPROVAL");
    expect(draft.payload).toMatchObject({ proposalId: "prop-1", decision: "approve" });
    expect(CALIBRATION_PROPOSALS.find((p) => p.id === "prop-1")!.status).toBe("PENDING");
    expect(screen.getByTestId("calib-status-prop-1")).toHaveTextContent("PENDING");

    // 已应用提案提供「回滚」（同样走审批）
    expect(screen.getByTestId("calib-rollback-prop-2")).toBeInTheDocument();
  });

  it("「立即校准」按钮（M11 §3 手动触发）：POST /calibration/run → 运行摘要 toast", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // mock planner 兼具 catalog_admin
    renderApp("/admin/calibration");

    const btn = await screen.findByTestId("calib-run-btn");
    await user.click(btn);
    await waitFor(() => expect(screen.getByText(/校准完成：配对 36/)).toBeInTheDocument());
    expect(screen.getByText(/新提案 1/)).toBeInTheDocument();
  });

  it("校准历史时间线：触发原因 / 变更参数集 / 前后 MAPE + 预言 vs 实现（元闭环）", async () => {
    loginAs("planner");
    renderApp("/admin/calibration");

    const first = await screen.findByTestId("calib-history-0");
    expect(first).toHaveTextContent("C12");
    expect(first).toHaveTextContent("化成节拍、良率基线");
    expect(first).toHaveTextContent("MAPE 9.4% → 6.4%");
    // §6 元闭环：simulatedMapeAfter（预言）vs realizedMape（实现）
    expect(screen.getByTestId("calib-history-meta-0")).toHaveTextContent("预言 6.4%（回测） vs 实现 6.9%（生效后 14 日实测）");
    const second = screen.getByTestId("calib-history-1");
    expect(second).toHaveTextContent("手动");
    expect(screen.getByTestId("calib-history-meta-1")).toHaveTextContent("待元闭环回写");
  });
});
