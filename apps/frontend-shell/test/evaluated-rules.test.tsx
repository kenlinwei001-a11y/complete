import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvaluatedRules } from "@/components/EvaluatedRules";

/**
 * 规则即引用 P2（PRD-rules-as-references §8-#2）：关联规则显**真评估** PASS/WARN/BLOCK，
 * NOT_APPLICABLE 诚实标（非装饰标签、非"未找到定义"）。
 */
describe("EvaluatedRules · 规则闸门真评估面板", () => {
  it("逐条渲染 PASS/WARN/BLOCK/NOT_APPLICABLE 徽章 + 规则集版本", () => {
    render(
      <EvaluatedRules
        ruleSetVersion="rsv_abc123"
        rules={[
          { key: "C03", name: "产能上限约束", outcome: "BLOCK", expression: "Order.demandDelta > 0.5", evidence: "命中违规" },
          { key: "C09", name: "数据时延临时降级", outcome: "PASS", expression: "x", evidence: "通过" },
          { key: "C02", name: "口径", outcome: "WARN", expression: "y" },
          { key: "C01", name: "上限", outcome: "NOT_APPLICABLE", expression: "z", evidence: "未含字段" },
        ]}
      />,
    );
    expect(screen.getByTestId("evaluated-rules").textContent).toContain("rsv_abc123");
    expect(screen.getByTestId("evalrule-outcome-C03").textContent).toBe("拦截");
    expect(screen.getByTestId("evalrule-outcome-C09").textContent).toBe("通过");
    expect(screen.getByTestId("evalrule-outcome-C02").textContent).toBe("预警");
    expect(screen.getByTestId("evalrule-outcome-C01").textContent).toBe("不适用");
    // 不出现"未找到定义"
    expect(screen.getByTestId("evaluated-rules").textContent).not.toContain("未找到定义");
  });

  it("无规则 → 不渲染", () => {
    const { container } = render(<EvaluatedRules rules={[]} />);
    expect(container.querySelector("[data-testid=evaluated-rules]")).toBeNull();
  });
});
