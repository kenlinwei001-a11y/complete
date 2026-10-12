import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F13 · 合成数据向导（快速合成入口）", () => {
  it("六阶段进度推进 → 校验报告（含时序段）→ 重跑二次确认文案", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/synthetic");

    // 第一步表单
    await screen.findByLabelText("行业模板");
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    // 六阶段 stepper
    const stepper = await screen.findByTestId("phase-stepper");
    expect(within(stepper).getByText("历史时序生成（90 天）")).toBeInTheDocument();
    expect(within(stepper).getAllByText(/行业模板|本体实例化|源对象生成|历史时序生成|派生计算|配套生成与校验/)).toHaveLength(6);

    // 轮询推进至报告
    const report = await screen.findByTestId("synthetic-report", undefined, { timeout: 15000 });
    expect(within(report).getByTestId("ts-report")).toBeInTheDocument();
    expect(within(report).getByText("oee:equip")).toBeInTheDocument();

    // 重跑二次确认文案
    await user.click(screen.getByTestId("rerun-btn"));
    expect(await screen.findByText("将清除该租户全部 SYNTHETIC 数据，确认重跑？")).toBeInTheDocument();

    // 统一规格收编：模拟时钟已移出本页（不再常驻合成页）
    expect(screen.queryByTestId("clock-console")).toBeNull();
  });

  it("统一规格收编：模拟时钟控制台已迁至运营自动化页（A8 §6.3 · 时序推进）", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // mock planner 账号持 admin+tenant_admin 角色（同 f40），可访问 ops-schedule
    renderApp("/admin/ops-schedule");

    const clock = await screen.findByTestId("clock-console");
    expect(within(clock).getByTestId("sim-date")).toHaveTextContent("2026-06-12");
    expect(within(clock).getByRole("button", { name: "推进 1 天" })).toBeInTheDocument();
    expect(within(clock).getByRole("button", { name: "推进 1 周" })).toBeInTheDocument();
    expect(within(clock).getByRole("button", { name: "重置" })).toBeInTheDocument();
    expect(within(clock).getByTestId("script-timeline")).toHaveTextContent("iot_delay");

    // 推进 1 天 → tick 报告卡追加 + 模拟日期 +1（时钟功能随迁移完整保留）
    await user.click(screen.getByTestId("tick-1d"));
    await waitFor(() => expect(within(clock).getByTestId("sim-date")).toHaveTextContent("2026-06-13"), { timeout: 10000 });
    await screen.findByTestId("tick-report-1");
  });
});
