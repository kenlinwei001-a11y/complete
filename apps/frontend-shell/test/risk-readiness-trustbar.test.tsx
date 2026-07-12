import { describe, expect, it } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SANDBOX-READINESS-UX：CAPSIM 看板（/v/risk）顶部紧凑单行就绪信任条 + [查看完整体检] 抽屉。
 *
 * 守 RL3（只渲染既有 GLOBAL SimCertification·零新算）；非通栏（信任条为 header 区一行 chip 条·rk-grid 主体不动）。
 * mock GLOBAL 认证已镜像真 datacore（L4_CERTIFIED / canEnter=true / gaps []）——信任条出绿「✓ 可进入推演」。
 * 抽屉默认关（无 sim-cert-level）；点开后 L0–L4 stepper + 健康/信任双雷达出现。看板本体 testid 全在（未受注入影响）。
 */
describe("WO-SANDBOX-READINESS-UX · 看板就绪信任条 + 体检抽屉", () => {
  it("信任条常驻·data-can-enter=true·绿「可进入推演」", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    const bar = await screen.findByTestId("risk-trustbar");
    await waitFor(() => expect(bar).toHaveAttribute("data-can-enter", "true"));
    expect(screen.getByTestId("risk-trustbar-verdict")).toHaveTextContent("可进入推演");
  });

  it("抽屉默认关（无 sim-cert-level / 无双雷达）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-trustbar");
    expect(screen.queryByTestId("sim-cert-level")).toBeNull();
    expect(screen.queryByTestId("sandbox-health-radar")).toBeNull();
    expect(screen.queryByTestId("sandbox-trust-radar")).toBeNull();
  });

  it("点[查看完整体检] → 抽屉出 L0–L4 stepper + 健康/信任双雷达", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-trustbar-toggle"));
    const drawer = await screen.findByTestId("risk-trustbar-drawer");
    expect(drawer).toBeTruthy();
    await screen.findByTestId("sim-cert-level");
    expect(screen.getByTestId("sim-cert-step-L4_CERTIFIED")).toHaveAttribute("data-current", "1");
    expect(screen.getByTestId("sandbox-health-radar")).toBeTruthy();
    expect(screen.getByTestId("sandbox-trust-radar")).toBeTruthy();
  });

  it("看板本体 testid 全在（信任条非通栏·未注入 body）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    // rk-top 标题 / rk-kpi 条 / 每基地卡——board 1:1 复刻主体不受信任条影响。
    await screen.findByTestId("risk-kpi");
    await screen.findByTestId("risk-card-常州");
  });
});
