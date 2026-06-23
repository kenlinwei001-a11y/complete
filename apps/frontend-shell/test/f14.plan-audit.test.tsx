import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import zh from "@/locales/zh";

/**
 * F14（增量 §7.10 / 验收表）：plan-audit 改 cashCushion 至 45 →
 * debounce 一次重算；出现 X05 硬卡（红框 + C18 徽章）；点 fix 后字段被 patch
 * 且重算为软/消失；评分与档位色联动。基线来自 GET /a/v1/plan-versions/current。
 */
describe("F14 · 规划体检（plan-audit）改参即重算", () => {
  it("基线预填（V1 定稿）→ 改 cashCushion=45 → X05 硬卡(C18) → 一键 fix → 降为软风险；评分/档位色联动；重置回基线", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");

    // 基线预填（GET /a/v1/plan-versions/current → 2026-06 V1）+ 头部「基线：{版本号}·改任意字段即时体检」
    expect(await screen.findByTestId("audit-input-dem")).toHaveValue(132);
    expect(screen.getByTestId("audit-input-sup")).toHaveValue(131.2);
    expect(screen.getByTestId("audit-input-kitGap")).toHaveValue(654);
    expect(screen.getByTestId("audit-input-cashCushion")).toHaveValue(58);
    expect(screen.getByTestId("audit-baseline")).toHaveTextContent(zh.sim.audit.baseline("2026-06 V1"));

    // 首次自动体检（无「体检」按钮 —— 改参即重算）：V7 基线确定性结果
    const verdict = await screen.findByTestId("audit-verdict");
    await waitFor(() => expect(verdict).toHaveTextContent("体检结论：有条件通过（评分 79/100）"));
    expect(screen.getByTestId("audit-counts")).toHaveTextContent("0 硬矛盾 / 3 软风险 / 3 建议");
    expect(verdict.getAttribute("style")).toContain("var(--amber)");

    // 改 cashCushion 至 45（< C18 底线 50）→ debounce 重算 → X05 硬卡 + C18 徽章 + 档位转红
    fireEvent.change(screen.getByTestId("audit-input-cashCushion"), { target: { value: "45" } });
    const x05 = await screen.findByTestId("audit-item-hard-X05");
    expect(x05).toHaveTextContent("现金垫");
    expect(x05).toHaveTextContent("45 亿低于底线 50 亿");
    expect(screen.getByTestId("rule-badge-hard-X05")).toHaveTextContent("C18");
    expect(screen.getByTestId("audit-counts")).toHaveTextContent("1 硬矛盾 / 3 软风险 / 4 建议");
    expect(screen.getByTestId("audit-verdict")).toHaveTextContent("体检结论：不通过（评分 57/100）");
    expect(screen.getByTestId("audit-verdict").getAttribute("style")).toContain("var(--danger)");

    // 一键应用 fix → patch 回写左栏（cashCushion → 50）→ 自动重检 → X05 降为软风险
    await user.click(screen.getByTestId("apply-fix-hard-X05"));
    await waitFor(() => expect(screen.getByTestId("audit-input-cashCushion")).toHaveValue(50));
    await screen.findByTestId("audit-item-med-X05");
    expect(screen.queryByTestId("audit-item-hard-X05")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-counts")).toHaveTextContent("0 硬矛盾 / 4 软风险 / 4 建议");
    expect(screen.getByTestId("audit-verdict")).toHaveTextContent("体检结论：有条件通过（评分 72/100）");
    // fix 脚注：演示用——实际生效走 S&OP 议程与 Action 审批
    expect(screen.getAllByText(zh.sim.audit.fixFootnote).length).toBeGreaterThan(0);

    // 重置输入 → 恢复基线并重检
    await user.click(screen.getByTestId("audit-reset"));
    await waitFor(() => expect(screen.getByTestId("audit-input-cashCushion")).toHaveValue(58));
    await waitFor(() => expect(screen.getByTestId("audit-counts")).toHaveTextContent("0 硬矛盾 / 3 软风险 / 3 建议"));
  });

  it("feature 关闭（base_manager）：/v/plan-audit → 404（FEATURE_NOT_FOUND 语义）", async () => {
    loginAs("base_manager");
    renderApp("/v/plan-audit");
    expect(await screen.findByTestId("page-404")).toBeInTheDocument();
  });
});
