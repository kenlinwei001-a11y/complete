import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F14 · 规划体检（plan-audit）", () => {
  it("happy path：输入（V7 基线）→ 体检 → 结论卡 + H/M/S 计数 + 一键应用回写表单", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    // 预填电池默认值（原型 AUDIT_PRESETS.V7）
    expect(await screen.findByTestId("audit-input-dem")).toHaveValue(132);
    expect(screen.getByTestId("audit-input-sup")).toHaveValue(131.2);
    expect(screen.getByTestId("audit-input-kitGap")).toHaveValue(654);

    await user.click(screen.getByTestId("audit-run"));

    // 结论卡：体检结论：{verdict}（评分 {score}/100）—— V7 基线确定性结果
    const verdict = await screen.findByTestId("audit-verdict");
    expect(verdict).toHaveTextContent("体检结论：有条件通过（评分 68/100）");
    expect(screen.getByTestId("audit-counts")).toHaveTextContent("0 硬矛盾 / 4 软风险 / 3 建议");

    // 软风险区块：X02 产销缺口（0.8 ∈ (0.3, 2]）带规则口径 why 文本
    const x02 = screen.getByTestId("audit-item-med-X02");
    expect(x02).toHaveTextContent("产销缺口");
    expect(x02).toHaveTextContent("缺口 0.8 万套");
    // 规则 key 徽章（C15 出现在 X03 卡上）
    expect(screen.getByTestId("audit-item-med-X03")).toHaveTextContent("C15");

    // 一键应用（act.plan-audit.apply-fix 已开通）：X02 fix → sup 回写为 132 并即时重检
    await user.click(screen.getByTestId("apply-fix-med-X02"));
    await waitFor(() => expect(screen.getByTestId("audit-input-sup")).toHaveValue(132));
    // 重检后 X02 消解 → 3 软风险，评分 76
    await waitFor(() => expect(screen.getByTestId("audit-counts")).toHaveTextContent("0 硬矛盾 / 3 软风险 / 2 建议"));

    // 时序推演展开 → risk_timeline 日条
    await user.click(screen.getAllByTestId(/tl-toggle-/)[0]!);
    await screen.findByTestId("audit-risk-timeline");
    expect((await screen.findAllByTestId("sim-heat-strip")).length).toBeGreaterThan(0);
  });

  it("feature 关闭（base_manager）：/v/plan-audit → 404（FEATURE_NOT_FOUND 语义）", async () => {
    loginAs("base_manager");
    renderApp("/v/plan-audit");
    expect(await screen.findByTestId("page-404")).toBeInTheDocument();
  });
});
