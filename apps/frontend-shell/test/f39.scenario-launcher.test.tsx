import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    // WO-UNIT-MEANING：域分组标题此前是「{域} · 6」的纯裸数（6 是卡数还是编号？）→ 现点明"个场景"
    const domainTitles = screen.getAllByTestId(/^launcher-domain-/);
    expect(domainTitles.length).toBeGreaterThanOrEqual(1);
    for (const t of domainTitles) expect(t.textContent).toMatch(/· \d+ 个场景$/);

    // ▶启动 → 触发问句进对话、selectedObjects 注入、dock 展开
    await user.click(within(card).getByTestId("launcher-launch-S01"));
    await waitFor(() => {
      const st = useSessionStore.getState();
      expect(st.dockExpanded).toBe(true);
      expect(st.conversation.some((c) => c.query.includes("4680-NCM"))).toBe(true);
      expect(st.selectedObjects.some((o) => o.objectId === "4680-NCM")).toBe(true);
    });
  });

  it("首页高频区：高频场景卡 + 一键启动 + 业务视图快捷入口", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/");

    await screen.findByTestId("home-page");
    const hot = await screen.findByTestId("home-hot-scenarios");
    expect(within(hot).getByTestId("home-scenario-S01")).toBeInTheDocument();
    // 业务视图快捷 + 全部场景入口
    expect(screen.getByTestId("home-all-scenarios")).toBeInTheDocument();
    // 点高频卡 → 启动注入
    await user.click(within(hot).getByTestId("home-scenario-S01"));
    await waitFor(() => expect(useSessionStore.getState().conversation.some((c) => c.query.includes("4680-NCM"))).toBe(true));
  });

  it("⌘K 命令面板：快捷键唤起 → 搜索 → 选中启动", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");

    // Cmd+K 唤起面板
    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByTestId("command-palette");
    // WO-SCENARIO-FORCED-EXTRACT：CJK 走 IME 上屏=一次 change 交付整串（userEvent 逐键在受控 input 下丢键），
    // fireEvent.change 更贴近真浏览器的中文输入路径
    fireEvent.change(within(palette).getByTestId("command-palette-input"), { target: { value: "齐套" } });
    const item = await screen.findByTestId("command-palette-item-S08");
    expect(item).toHaveTextContent("物料齐套分析");
    await user.click(item);
    // WO-SCENARIO-FORCED-EXTRACT：⌘K 搜索文本作为 userQuery 透传进对话（此前被吞、回落触发问句）
    await waitFor(() => expect(useSessionStore.getState().conversation.some((c) => c.query.includes("齐套"))).toBe(true));
  });
});
