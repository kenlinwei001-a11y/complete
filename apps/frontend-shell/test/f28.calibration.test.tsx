import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";
import { CALIBRATION_PROPOSALS } from "@/mocks/planFixtures";

describe("F28 · 校准报告页（/admin/calibration）", () => {
  it("MAPE 趋势含 C12 阈值线（8%）与触发标记点 + 三级筛选", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    expect(await screen.findByTestId("calib-threshold-line")).toHaveTextContent("C12 阈值线 8%");
    const mark = screen.getByTestId("calib-trigger-mark");
    expect(mark).toHaveTextContent("2026-04-17");
    expect(mark).toHaveTextContent("C12");

    // 三级下钻筛选（对象类型/基地/求解器）联动重查（确定性 mock，仍渲染阈值与标记）
    await user.selectOptions(screen.getByTestId("calib-filter-objectType"), "产能预测");
    await user.selectOptions(screen.getByTestId("calib-filter-base"), "常州");
    await user.selectOptions(screen.getByTestId("calib-filter-solver"), "capacity_forecast");
    expect(await screen.findByTestId("calib-trigger-mark")).toBeInTheDocument();
  });

  it("提案批准走 Action 审批草稿（无直改参数 API）：状态仍 PENDING + 草稿入库", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    // 提案列表：参数 / 当前→建议 / 依据可点开溯源 / 状态徽章
    const row = await screen.findByTestId("calib-proposal-prop-1");
    expect(row).toHaveTextContent("化成节拍");
    expect(row).toHaveTextContent("5.2 → 5.6");
    await user.click(screen.getByTestId("calib-basis-prop-1"));
    expect(screen.getByTestId("calib-basis-detail-prop-1")).toHaveTextContent("1840 条 ts_agg_runs 实际样本");

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

  it("校准历史时间线：触发原因 / 变更参数集 / 前后 MAPE 对比", async () => {
    loginAs("planner");
    renderApp("/admin/calibration");

    const first = await screen.findByTestId("calib-history-0");
    expect(first).toHaveTextContent("C12");
    expect(first).toHaveTextContent("化成节拍、良率基线");
    expect(first).toHaveTextContent("MAPE 9.4% → 6.4%");
    const second = screen.getByTestId("calib-history-1");
    expect(second).toHaveTextContent("手动");
  });
});
