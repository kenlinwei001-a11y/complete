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

    // 引用闭合（无死路）：S01 意图已配置 → 就绪
    expect(screen.getByTestId("scenario-closure-S01")).toHaveTextContent("就绪");
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
    // 未命中意图 → 警示（命中校验 #2）
    fireEvent.change(within(editor).getByTestId("scenario-intent-input"), { target: { value: "no_such_intent" } });
    await waitFor(() => expect(within(editor).getByTestId("scenario-intent-warn")).toBeInTheDocument());
    // 命中真实意图 → 警示消失
    fireEvent.change(within(editor).getByTestId("scenario-intent-input"), { target: { value: "capacity_feasibility" } });
    await waitFor(() => expect(within(editor).queryByTestId("scenario-intent-warn")).not.toBeInTheDocument());
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

  it("PRD-ontogenesis：发育验证 → maturity 徽章 + 留痕面板（三环/验证/答案来源前端可见）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/scenes");
    await screen.findByTestId("scenario-row-S01");
    // 发育验证（经 QOS 跑通触发问句 → GOVERNED + 留痕）
    await user.click(screen.getByTestId("scenario-grow-S01"));
    await waitFor(() => expect(screen.getByTestId("scenario-maturity-S01")).toHaveTextContent("已验证·可用"));
    // 留痕面板自动展开：三环 + 验证 + 答案预览（数据来源可见）
    const ont = await screen.findByTestId("scenario-ontogenesis-S01");
    expect(ont).toHaveTextContent("数据环 ✓");
    expect(ont).toHaveTextContent("本体环 ✓");
    expect(within(ont).getByTestId("scenario-verif-S01")).toHaveTextContent("VERIFIED");
    expect(ont).toHaveTextContent("答案预览");
  });

  it("已发布场景：「查看配置」只读展示真实后端配置 + 退役转草稿后可编辑（非前端写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/scenes");
    await screen.findByTestId("scenario-row-S01");

    // 已发布场景无「编辑」，但有「查看配置」（只读看真实后端配置，回应"是否假页面"）
    expect(screen.queryByTestId("scenario-edit-S01")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("scenario-view-S01"));
    const editor = await screen.findByTestId("scenario-editor");
    // 只读提示 + 名称取自后端真实数据 + 输入禁用 + 无保存按钮
    expect(within(editor).getByTestId("scenario-readonly-hint")).toBeInTheDocument();
    expect((within(editor).getByTestId("scenario-name-input") as HTMLInputElement).value.length).toBeGreaterThan(0);
    expect(within(editor).getByTestId("scenario-name-input")).toBeDisabled();
    expect(within(editor).queryByTestId("scenario-save")).not.toBeInTheDocument();

    // 退役 → 转为可编辑（编辑按钮出现）
    await user.click(screen.getByTestId("scenario-retire-S01"));
    await waitFor(() => expect(screen.getByTestId("scenario-edit-S01")).toBeInTheDocument());
  });
});
