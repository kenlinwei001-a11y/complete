import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

/**
 * F39 · 场景启动器（PRD-scenario-launcher §3.5）：按域目录墙 + ⌘K 命令面板 →
 * 一键注入 presetContext 启动 → 对话坞看推演（复用 QOS 管线）。
 */
describe("F39 · 场景启动器（目录墙 + ⌘K）", () => {
  it("目录墙：按域分组卡片，▶启动 → 注入 presetContext + 展开对话坞", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");

    // 按域分组 + 卡片（出厂场景）
    await screen.findByTestId("scenario-launcher");
    const card = await screen.findByTestId("launcher-card-S01");
    expect(card).toHaveTextContent("订单可承接性评审");

    // ▶启动 → 触发问句进对话、selectedObjects 注入、dock 展开
    await user.click(within(card).getByTestId("launcher-launch-S01"));
    await waitFor(() => {
      const st = useSessionStore.getState();
      expect(st.dockExpanded).toBe(true);
      expect(st.conversation.some((c) => c.query.includes("4680-NCM"))).toBe(true);
      expect(st.selectedObjects.some((o) => o.objectId === "4680-NCM")).toBe(true);
    });
  });

  it("⌘K 命令面板：快捷键唤起 → 搜索 → 选中启动", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");

    // Cmd+K 唤起面板
    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByTestId("command-palette");
    await user.type(within(palette).getByTestId("command-palette-input"), "齐套");
    const item = await screen.findByTestId("command-palette-item-S08");
    expect(item).toHaveTextContent("物料齐套分析");
    await user.click(item);
    await waitFor(() => expect(useSessionStore.getState().conversation.some((c) => c.query.includes("缺料"))).toBe(true));
  });
});
