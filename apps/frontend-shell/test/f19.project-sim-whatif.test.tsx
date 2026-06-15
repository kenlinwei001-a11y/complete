import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * F19（增量 §7.13 / 验收表）：what-if 夜班2+通道4 → gap 文案按 S1.2-7 公式实时变化；
 * 外协滑到 20% 截止并提示 C08；采纳按钮产生 action_draft（payload 含参数组合）。
 */
describe("F19 · 项目推演 what-if 三滑杆 + 采纳产能保障方案", () => {
  it("夜班2+通道4 → 缺口归零·富余 x（物理上限封顶）；外协 20% 截止 + C08；采纳 → Action 草稿 payload 含参数组合", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // ⑥ 结论与对策：P50 42.0 / P90 39.0（×0.93）/ 需求 40 → 初始缺口 1.0
    await screen.findByTestId("pm-stepper");
    await user.click(screen.getByTestId("pm-step-chip-6"));
    expect(await screen.findByTestId("kpi-p50")).toHaveTextContent("42.0");
    expect(screen.getByTestId("kpi-p90")).toHaveTextContent("39.0");
    expect(screen.getByTestId("proj-verdict-bar")).toHaveTextContent("✗ 缺口");
    expect(screen.getByTestId("whatif-gap")).toHaveTextContent("缺口 1.0 万套");

    // 夜班 +2（×(1+0.06×2)）→ 拖动即重算 → 缺口归零·富余 3.7
    fireEvent.change(screen.getByTestId("whatif-night"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByTestId("whatif-gap")).toHaveTextContent("缺口归零 · 富余 3.7 万套"));

    // 通道 +4（×(1+0.12+0.20)=1.32 → 触及物理上限 52.2 封顶）→ 富余 8.5
    fireEvent.change(screen.getByTestId("whatif-channels"), { target: { value: "4" } });
    await waitFor(() => expect(screen.getByTestId("whatif-gap")).toHaveTextContent("缺口归零 · 富余 8.5 万套"));
    const cmp = screen.getByTestId("whatif-compare");
    expect(within(cmp).getByTestId("whatif-before")).toHaveTextContent("42.0");
    expect(within(cmp).getByTestId("whatif-after")).toHaveTextContent("52.2"); // C03 物理上限封顶
    expect(screen.getByText(/物理上限/)).toBeInTheDocument();

    // 外协滑杆 0–20% step5：滑到 20% 即截止（max=20，旧上限 25 已按 PRD 收紧）+ C08 提示
    const outsource = screen.getByTestId("whatif-outsource");
    expect(outsource).toHaveAttribute("max", "20");
    expect(outsource).toHaveAttribute("step", "5");
    fireEvent.change(outsource, { target: { value: "20" } });
    expect(await screen.findByTestId("whatif-c08")).toHaveTextContent("C08 红线 20%");
    // 20% 仍是合法组合（C08 拒绝的是 >20%）→ 不出现拒绝条
    await waitFor(() => expect(screen.queryByTestId("whatif-rejected")).not.toBeInTheDocument());

    // 采纳产能保障方案 → Action 草稿（payload = 参数组合 + 推演快照）
    await user.click(screen.getByTestId("proj-adopt"));
    expect(await screen.findByText(/草稿已创建，待审批/)).toBeInTheDocument();
    const draft = db.actionDrafts[0]!;
    expect(draft.actionTypeKey).toBe("采纳产能保障方案");
    expect(draft.status).toBe("PENDING_APPROVAL");
    const payload = draft.payload as {
      modelId: string;
      whatIf: { nightShifts: number; extraChannels: number; outsourcePct: number };
      snapshot: { p50: number; mainBn: string };
    };
    expect(payload.modelId).toBe("4680-NCM");
    expect(payload.whatIf).toEqual({ nightShifts: 2, extraChannels: 4, outsourcePct: 20 });
    expect(payload.snapshot.p50).toBe(41.9809);
    expect(payload.snapshot.mainBn).toBe("化成通道");
  });
});
