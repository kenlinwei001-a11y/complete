import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import zh from "@/locales/zh";

/** 三处同源文案（zh.health.degradeNote 唯一来源） */
const DEGRADE_COPY = zh.health.degradeNote("4.2", "0.93", "0.9");

describe("F29 · 数据健康度（§7.22 三处同源）", () => {
  it("连接器页：健康度列 + 汇总条（IoT 延迟 → 降级影响 P90 0.93→0.90 + 受影响求解器）", async () => {
    loginAs("planner");
    renderApp("/admin/connections");

    // 健康度列：IoT 延迟 4.2h
    const iot = await screen.findByTestId("conn-health-conn-iot");
    expect(iot).toHaveTextContent("延迟");
    expect(iot).toHaveTextContent("4.2h");
    expect(screen.getByTestId("conn-health-conn-erp")).toHaveTextContent("正常");

    // 汇总条：降级影响（C09 命中）与受影响求解器列表
    const summary = screen.getByTestId("health-summary");
    expect(within(summary).getByTestId("health-degrade-conn-iot")).toHaveTextContent(DEGRADE_COPY);
    expect(summary).toHaveTextContent("受影响求解器：capacity_forecast、聚合求解器");
  });

  it("顶栏黄点：任一源延迟 → 徽章黄点；点击下拉清单 → 跳连接器页", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/dash");

    const dot = await screen.findByTestId("health-dot");
    await waitFor(() => expect(dot).toHaveAttribute("data-degraded", "true"));

    await user.click(screen.getByTestId("health-badge"));
    const dropdown = await screen.findByTestId("health-dropdown");
    expect(within(dropdown).getByTestId("health-src-conn-iot")).toHaveTextContent("延迟");
    await user.click(screen.getByTestId("health-goto-connections"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/connections"));
  });

  it("推演输出降级说明与连接器页/顶栏同一文案（同一 zh key）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 4680-LFP 命中 C09 健康度降级（mock 求解器与 data-health 同口径）
    await user.selectOptions(await screen.findByLabelText("型号"), "4680-LFP");
    await user.click(screen.getByTestId("proj-run"));
    const note = await screen.findByTestId("degrade-note");
    expect(note).toHaveTextContent(DEGRADE_COPY);

    // 同会话内顶栏黄点同时存在 → 三处（连接器页/顶栏/推演输出）同源
    expect(screen.getByTestId("health-dot")).toHaveAttribute("data-degraded", "true");
    cleanup();
  });
});
