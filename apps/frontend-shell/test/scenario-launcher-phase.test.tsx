import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

/**
 * ONTO-SCEN-GROWTH-LOOP（PRD-scenario-ontogenesis §2.6 · R3 诚实分层）齿：启动器相位呈现——
 *  · GOVERNED 卡默认可用（绿「已验证」徽章 + ▶启动可点，注入 presetContext 推演）；
 *  · PROVISIONAL 卡诚实标「发育中·未审核」（amber 徽章）+ 启动 disabled（默认不可直接跑）+「查看发育」深链。
 *
 * revert 判定：去掉 ScenarioLauncherPage 的 developing 分支 / 后端不下发 maturity → PROVISIONAL 卡启动按钮
 * 变成可点、无「发育中」徽章 → 本齿变红。
 */

function twoPhaseCards() {
  return http.get("*/b/v1/scenarios", () =>
    HttpResponse.json({
      launcherEnabled: true,
      total: 2,
      items: [
        {
          sNo: "G01", name: "已验证卡", view: "project", domain: "订单", intentKey: "capacity_feasibility",
          triggerQuestion: "4680-NCM 加 20% 六周能不能接？", solver: "capacity_forecast", riskLevel: "COMPUTE",
          summary: "已亲手跑通", willProduceDraft: false, inactive: false, needsData: false, maturity: "GOVERNED",
          presetContext: { targetView: "project", selectedObjects: [{ objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" }], slotPresets: {} },
        },
        {
          sNo: "P02", name: "发育中卡", view: "project", domain: "订单", intentKey: "new_thing",
          triggerQuestion: "某新场景问句？", solver: undefined, riskLevel: "COMPUTE",
          summary: "尚未验证", willProduceDraft: false, inactive: false, needsData: false, maturity: "PROVISIONAL",
          presetContext: { targetView: "project", selectedObjects: [], slotPresets: {} },
        },
      ],
    }),
  );
}

describe("ONTO-SCEN-GROWTH-LOOP · 启动器相位呈现（诚实分层）", () => {
  it("GOVERNED 卡：绿『已验证』徽章 + ▶启动可点（真注入 presetContext 推演）", async () => {
    const user = userEvent.setup();
    server.use(twoPhaseCards());
    loginAs("planner");
    renderApp("/scenarios");

    const gov = await screen.findByTestId("launcher-card-G01");
    expect(gov).toHaveAttribute("data-maturity", "GOVERNED");
    expect(within(gov).getByTestId("launcher-maturity-G01")).toHaveTextContent("已验证");
    const launchBtn = within(gov).getByTestId("launcher-launch-G01");
    expect(launchBtn).not.toBeDisabled();

    await user.click(launchBtn);
    await waitFor(() => {
      const st = useSessionStore.getState();
      expect(st.conversation.some((c) => c.query.includes("4680-NCM"))).toBe(true);
    });
  });

  it("PROVISIONAL 卡：amber『发育中·未审核』徽章 + 启动 disabled（默认不可直接跑）+ 诚实提示", async () => {
    server.use(twoPhaseCards());
    loginAs("planner");
    renderApp("/scenarios");

    const prov = await screen.findByTestId("launcher-card-P02");
    expect(prov).toHaveAttribute("data-maturity", "PROVISIONAL");
    // 诚实标注「待验证/未审核」（非隐藏、非假可用）
    expect(within(prov).getByTestId("launcher-maturity-P02")).toHaveTextContent("待验证");
    expect(within(prov).getByTestId("launcher-developing-hint-P02")).toBeInTheDocument();
    // 默认不可直接跑：启动按钮 disabled
    expect(within(prov).getByTestId("launcher-launch-P02")).toBeDisabled();
    // 诚实降级动作：「查看验证状态」深链（非启动推演）
    expect(within(prov).getByTestId("launcher-developing-P02")).toBeInTheDocument();
  });
});
