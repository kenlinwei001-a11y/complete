import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * F37 · 场景配置（B5 · PRD-scenario-launcher §3.2 模型倒置修复）：
 * Scenario 为一等主键——场景放第一列 + 选交互模式（WORKFLOW_FIRST…）+ presetContext 完整可配；
 * 出厂 20 场景全展示；创建 DRAFT → 编辑 presetContext → 发布 → 退役 状态机。
 */
describe("F37 · 场景配置（场景为一等主键）", () => {
  it("列表：场景在第一列 + 交互模式列 + presetContext 列 + 状态；出厂场景 PUBLISHED", async () => {
    loginAs("planner");
    renderApp("/admin/scenes");

    // 场景为主键：第一列是场景键，其后是 mode / presetContext / 状态
    const row = await screen.findByTestId("scenario-row-S01");
    expect(row).toHaveTextContent("S01");
    expect(screen.getByTestId("scenario-mode-S01")).toHaveTextContent("WORKFLOW_FIRST");
    expect(screen.getByTestId("scenario-preset-S01")).toHaveTextContent("项预置");
    expect(screen.getByTestId("scenario-status-S01")).toHaveTextContent("PUBLISHED");

    // 探索型场景以 AGENT_FIRST 呈现（mode 收敛语义）
    expect(screen.getByTestId("scenario-mode-SX-explore")).toHaveTextContent("AGENT_FIRST");
  });

  it("创建草稿 → 编辑 presetContext → 发布 → 退役（状态机全配）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/scenes");
    await screen.findByTestId("scenario-row-S01");

    // 新建场景：场景键 + 名称 + 落点视图 + 意图 + 触发问句 + presetContext slots
    await user.click(screen.getByTestId("scenario-new"));
    const editor = await screen.findByTestId("scenario-editor");
    fireEvent.change(within(editor).getByTestId("scenario-key-input"), { target: { value: "SX9" } });
    fireEvent.change(within(editor).getByTestId("scenario-name-input"), { target: { value: "新场景9" } });
    fireEvent.change(within(editor).getByTestId("scenario-intent-input"), { target: { value: "capacity_feasibility" } });
    fireEvent.change(within(editor).getByTestId("scenario-trigger-input"), { target: { value: "X9 能接吗？" } });
    fireEvent.change(within(editor).getByTestId("scenario-slots-input"), { target: { value: '{"modelId":"M9","weeks":6}' } });
    await user.click(within(editor).getByTestId("scenario-save"));

    // 新场景作为 DRAFT 出现
    await waitFor(() => expect(screen.getByTestId("scenario-status-SX9")).toHaveTextContent("DRAFT"));
    expect(db.scenarios.find((s) => s.scenarioKey === "SX9")?.status).toBe("DRAFT");

    // 发布 → PUBLISHED
    await user.click(screen.getByTestId("scenario-publish-SX9"));
    await waitFor(() => expect(screen.getByTestId("scenario-status-SX9")).toHaveTextContent("PUBLISHED"));

    // 退役 → RETIRED
    await user.click(screen.getByTestId("scenario-retire-SX9"));
    await waitFor(() => expect(screen.getByTestId("scenario-status-SX9")).toHaveTextContent("RETIRED"));
  });
});
