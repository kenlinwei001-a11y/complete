import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-LIVE-DISPOSITION · 产能风险看板「活推演→重算行动计划」端到端（前端）。
 * 齿：拖动 DynamicLeverPanel 杠杆 → liveState.apply 上抛 → 点击「生成/重算行动计划」→
 * risk_timeline 携带 apply overlay 重新 invoke → 返回差异化 planRows（含 DispositionStep）。
 * 再点击 plan row 展开 DispositionDetailPanel，断言 rationale / triggerValue / closesGap / provenance 渲染。
 */

describe("WO-LIVE-DISPOSITION · 活推演重算行动计划", () => {
  it("调整杠杆 → 重算 → planRows 更新；点击行展开 disposition 明细", async () => {
    loginAs("planner");
    renderApp("/v/risk");

    // 初始行动计划表渲染（默认 4 行）。
    const planPanel = await screen.findByTestId("risk-plan-panel");
    expect(planPanel).toBeInTheDocument();
    const row0 = await screen.findByTestId("risk-plan-row-0");
    expect(row0).toHaveTextContent("关键正极提前备料（常州）");
    expect(row0).toHaveTextContent("消解≈12·2天起效");

    // 打开常州卡片，露出 DynamicLeverPanel。
    fireEvent.click(await screen.findByTestId("risk-card-常州"));
    const leverPanel = await screen.findByTestId("dynamic-lever-panel");
    expect(leverPanel).toBeInTheDocument();

    // 等待杠杆发现完成并出现滑杆（产能瓶颈 → Equipment.oee_current）。
    const slider = await screen.findByTestId("lever-slider-oee_current");
    expect(slider).toBeInTheDocument();

    // 拖动杠杆改变值（currentValue 0.82 → 0.95），触发 activeApply 与 generic_inference 重算。
    fireEvent.change(slider, { target: { value: "0.95" } });

    // 等待重算结果上屏（deltas 表格出现，影响面 > 0）。
    await waitFor(() => expect(screen.getByTestId("lever-affected-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("lever-deltas")).toBeInTheDocument();

    // 点击「生成/重算行动计划」：应携带 liveApply 重新请求 risk_timeline。
    const regenBtn = screen.getByTestId("risk-plan-regenerate");
    fireEvent.click(regenBtn);

    // planRows 应更新：首行 act 加后缀、eff 变为 18、steps 触发值 92/闭 gap 18。
    await waitFor(() => expect(screen.getByTestId("risk-plan-row-0")).toHaveTextContent("已应用活推演"));
    expect(screen.getByTestId("risk-plan-row-0")).toHaveTextContent("消解≈18·1天起效");

    // 点击首行展开 DispositionDetailPanel。
    fireEvent.click(screen.getByTestId("risk-plan-row-0"));
    const detailPanel = await screen.findByTestId("disposition-detail-panel");
    expect(detailPanel).toBeInTheDocument();

    // 断言 DispositionStep 字段。
    expect(screen.getByTestId("disposition-step-0")).toHaveTextContent("触发提前备料（重算）");
    expect(screen.getByTestId("disposition-step-trigger-0")).toHaveTextContent("92");
    expect(screen.getByTestId("disposition-step-gap-0")).toHaveTextContent("18");
    expect(screen.getByTestId("disposition-step-prov-0")).toHaveTextContent("来源与推导");
  });

  it("无活推演态时重算 → planRows 保持原始不变", async () => {
    loginAs("planner");
    renderApp("/v/risk");

    await screen.findByTestId("risk-plan-panel");
    expect(screen.getByTestId("risk-plan-row-0")).toHaveTextContent("关键正极提前备料（常州）");

    fireEvent.click(screen.getByTestId("risk-plan-regenerate"));

    // liveApply 为空 → apply=[] → 后端视为无 overlay，planRows 不变。
    await waitFor(() => expect(screen.getByTestId("risk-plan-row-0")).toHaveTextContent("关键正极提前备料（常州）"));
    expect(screen.getByTestId("risk-plan-row-0")).toHaveTextContent("消解≈12·2天起效");
  });
});
