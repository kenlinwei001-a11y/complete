import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

describe("F22 · 季度规划（quarterly-rolling）", () => {
  it("缺口徽章三档色：>4 红 / >0 黄 / ≤0 绿", async () => {
    loginAs("planner");
    renderApp("/v/quarterly-rolling");

    // 2026-Q4 缺 8 → 红
    const red = await screen.findByTestId("qgap-2026-Q4");
    expect(red).toHaveAttribute("data-tier", "red");
    expect(red).toHaveTextContent("缺 8");
    // 2027-Q4 缺 4 → 黄（>0 且 ≤4）
    const amber = screen.getByTestId("qgap-2027-Q4");
    expect(amber).toHaveAttribute("data-tier", "amber");
    // 2027-Q1 冗余 20 → 绿
    const green = screen.getByTestId("qgap-2027-Q1");
    expect(green).toHaveAttribute("data-tier", "green");
    expect(green).toHaveTextContent("冗余 20");
  });

  it("事件注释行规则 chip 可点开 expression", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/quarterly-rolling");

    await user.click(await screen.findByTestId("qrule-2027-Q2-C08"));
    expect(await screen.findByTestId("qrule-expression")).toHaveTextContent("Outsource.ratio <= 0.2");
  });

  it("长协 −8% 行红色 + 升级供应风险标记 + 行尾链接跳 risk-board 并写入对应基地", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/quarterly-rolling");

    const dev = await screen.findByTestId("lta-dev-三元正极");
    expect(dev).toHaveTextContent("-8.0%");
    expect(screen.getByTestId("lta-三元正极")).toHaveAttribute("data-breach", "true");
    expect(screen.getByTestId("lta-escalate-三元正极")).toHaveTextContent("升级供应风险");
    // 正常行不红标
    expect(screen.getByTestId("lta-隔膜")).toHaveAttribute("data-breach", "false");
    // PRD-IND-quarter §4.5(F)：LTA 脚注去硬编码（i18n 下发，R14），与到货间隙/S&OP 决议同源
    expect(screen.getByTestId("quarter-lta-footnote")).toHaveTextContent("到货间隙");

    // 行尾链接 → /v/risk + 基地写入 selectedObjects（到货间隙事件同源基地：合肥）
    await user.click(screen.getByTestId("lta-goto-risk-三元正极"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/risk"));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Base", objectId: "base-合肥", label: "合肥" }),
    ]);
    // risk-board 渲染出对应基地卡
    expect(await screen.findByTestId("risk-card-合肥")).toBeInTheDocument();
  });
});
