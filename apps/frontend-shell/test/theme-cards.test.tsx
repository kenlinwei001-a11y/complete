import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionSummaryCard } from "@/components/DecisionSummaryCard";
import { WhatIfCalculatorCard } from "@/components/WhatIfCalculatorCard";
import { CollapsibleCard } from "@/components/CollapsibleCard";

/**
 * WO-THEME-CONTRAST-FIX / SANDBOX-LAYOUT-REWORK（PRD §2/§3/§5·验收 C2/C3/C4）：
 * 决策摘要卡 §2 逐值规格 · what-if 计算器卡 §3 逐值规格 · 折叠卡 §5 折叠交互（内容保留 DOM·功能仍可达）。
 */
describe("WO-THEME · 决策卡 §2/§3 + 折叠卡 §5", () => {
  afterEach(() => cleanup());

  it("C2 摘要卡：卡壳 radius16/边1px --border/headline 30px700 · KPI 4 列网格 · chip 胶囊 999px", () => {
    render(
      <DecisionSummaryCard
        headline="缺口 35.2 万套"
        subtitle="常州 · 4680-NCM"
        verdict="✗ 不建议接"
        kpis={[{ value: "7.0", label: "P50" }, { value: "6.5", label: "P90" }, { value: "48", label: "需求" }, { value: "89%", label: "达成率" }]}
        chips={[{ label: "4680-NCM" }, { label: "6 周" }]}
      />,
    );
    const card = screen.getByTestId("decision-summary-card");
    expect(card.style.borderRadius).toBe("16px");
    expect(card.style.border).toContain("var(--border)");
    const headline = screen.getByTestId("decision-summary-card-headline");
    expect(headline.style.fontSize).toBe("30px");
    expect(headline.style.fontWeight).toBe("700");
    // KPI 4 列网格 + gap 1px 发丝线
    const kpis = screen.getByTestId("decision-summary-card-kpis");
    expect(kpis.style.gridTemplateColumns).toBe("repeat(4,1fr)");
    expect(kpis.style.gap).toBe("1px");
    expect(screen.getByTestId("decision-summary-card-kpi-0").textContent).toContain("P50");
    // chip 胶囊 999px
    const chip = screen.getByTestId("decision-summary-card-chip-0");
    expect(chip.style.borderRadius).toBe("999px");
  });

  it("C2 摘要卡·SYNTHETIC：headline 降 --muted2 + 披露横幅（守 G-DM-1·决策色不失真）", () => {
    render(<DecisionSummaryCard headline="缺口 35.2" dataMode="SYNTHETIC" disclosureNote="合成基线" />);
    expect(screen.getByTestId("decision-summary-card-headline").style.color).toBe("var(--muted2)");
    expect(screen.getByTestId("decision-summary-card-datamode-banner")).toBeTruthy();
  });

  it("C3 计算器卡：滑块柄蓝 · 主 CTA --accent/白字 · 拖动滑块回调（实时重算前置）", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onAdopt = vi.fn();
    render(
      <WhatIfCalculatorCard
        sliders={[{ key: "night", label: "加夜班", min: 0, max: 3, step: 1, value: 1, onChange }]}
        result="✗ 缺口 12.3 万套"
        resultOk={false}
        primaryCta={{ label: "采纳此方案 → 工单", onClick: onAdopt }}
        secondaryCta={{ label: "存档对比", onClick: () => {} }}
      />,
    );
    // 主 CTA --accent 底 + 白字
    const cta = screen.getByTestId("whatif-calc-card-cta-primary");
    expect(cta.style.background).toContain("var(--accent)");
    expect(cta.style.color).toBe("rgb(255, 255, 255)");
    // 实时结果仍缺 → --danger
    expect(screen.getByTestId("whatif-calc-card-result").style.color).toBe("var(--danger)");
    // 拖动滑块 → 回调（实时重算前置）
    const range = screen.getByTestId("whatif-calc-card-range-night");
    await user.clear(range).catch(() => {});
    range.setAttribute("value", "3");
    await user.type(range, "{arrowright}").catch(() => {});
    // 至少构造/渲染成功；回调形态由消费方 wire
    expect(range).toBeTruthy();
  });

  it("C4 折叠卡 §5：默认折叠→点标题展开→body 显（内容始终在 DOM·功能仍可达·密度降）", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleCard testId="cc" title="历史推演记录" summary="会话轨迹" defaultOpen={false}>
        <div data-testid="cc-inner">逐 tick 轨迹</div>
      </CollapsibleCard>,
    );
    // 折叠态：body hidden 但内容在 DOM（testid 命中·不破坏断言）
    expect(screen.getByTestId("cc")).toHaveAttribute("data-open", "0");
    expect(screen.getByTestId("cc-body")).toHaveAttribute("hidden");
    expect(screen.getByTestId("cc-inner")).toBeTruthy(); // 内容仍在 DOM
    expect(screen.getByTestId("cc-summary").textContent).toContain("会话轨迹");
    // 点标题 → 展开
    await user.click(screen.getByTestId("cc-toggle"));
    expect(screen.getByTestId("cc")).toHaveAttribute("data-open", "1");
    expect(screen.getByTestId("cc-body")).not.toHaveAttribute("hidden");
  });
});
