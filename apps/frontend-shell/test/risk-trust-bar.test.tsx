import { describe, expect, it } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SANDBOX-READINESS-UX（CAPSIM §5·就绪认证进看板信任条+抽屉·非独立沙盘页）：
 * 看板顶一行信任条，就绪结论派生自本推演真置信度（confidence 三维 + 无源缺件），
 * [查看完整体检] 抽屉出三维置信度 + 缺件清单（§4②）。守 RC-UX-DOOR-TEXT 诚实文案（未校准≠不可用）。
 */
describe("WO-SANDBOX-READINESS-UX · 看板信任条 + 完整体检抽屉", () => {
  it("看板顶信任条在场·就绪结论非空（派生真置信度·非独立页）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    const bar = await screen.findByTestId("risk-trust-bar");
    expect(within(bar).getByTestId("risk-trust-verdict").textContent?.length).toBeGreaterThan(0);
    expect(within(bar).getByTestId("risk-trust-open")).toBeInTheDocument();
    // 诚实文案：未校准/部分实测/鲜度 = warn tone 之一，或就绪 = ok——非"不可用"劝退。
    expect(bar).toHaveAttribute("data-tone");
  });

  it("点[查看完整体检]→抽屉出三维置信度 + 缺件清单·可关", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-trust-open"));
    const drawer = await screen.findByTestId("risk-trust-drawer");
    // 三维置信度区（真实↔合成 × 新鲜↔陈旧 × 实测↔估算）。
    expect(within(drawer).getByTestId("drawer-confidence")).toBeInTheDocument();
    // 缺件清单区在场（有源全→empty·无源→list·二选一·诚实不静默）。
    const gaps = within(drawer).queryByTestId("drawer-gaps") ?? within(drawer).queryByTestId("drawer-gaps-empty");
    expect(gaps).toBeTruthy();
    // 关闭。
    fireEvent.click(within(drawer).getByTestId("risk-trust-close"));
    await waitFor(() => expect(screen.queryByTestId("risk-trust-drawer")).toBeNull());
  });
});
