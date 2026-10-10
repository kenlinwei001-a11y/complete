import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProviders } from "@/App";
import { RuleRef } from "@/components/RuleRef";
import { loginAs } from "./utils";

/**
 * 活数据可溯 · 收尾#3（R13 两跳溯源 · 参考原型 linkRules/showRulePop）：
 * 规则编号悬浮 → 弹规则完整定义（表达式/作用域/严重级/版本），形成"数字→规则→规则详情"两跳。
 */
describe("RuleRef · 规则锚点两跳", () => {
  it("悬浮规则编号 C13 → 弹出表达式/严重级/作用域", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(
      <AppProviders>
        <RuleRef code="C13" />
      </AppProviders>,
    );
    expect(screen.queryByTestId("ruleref-pop")).toBeNull();
    await user.hover(screen.getByTestId("ruleref-C13"));
    await waitFor(() => expect(screen.getByTestId("ruleref-pop").textContent).toContain("信用额度")); // 规则名
    const pop = screen.getByTestId("ruleref-pop");
    // WO-RULE-EXPR-PARAMS（#78）：C13 表达式改回与真后端同口径的**违规谓词** `Order.creditUsedRatio > 1`。
    // 原断言咬的是 mock 独有的约束式 `Order.credit <= Customer.creditLimit` —— 那个 `creditLimit` 字段
    // 真后端从来没有；断言绿只证明"mock 自己和自己一致"，正是 #78 那类假绿。
    expect(pop.textContent).toContain("Order.creditUsedRatio"); // 表达式（违规谓词口径）
    expect(pop.textContent).not.toContain("creditLimit"); // 旧的 mock 独有字段不该回潮
    expect(pop.textContent).toContain("BLOCK"); // 严重级
  });

  it("规则即引用 P1：曾'未找到定义'的 C09 现弹出真定义 + 命名阈值 params（非'未找到定义'）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(
      <AppProviders>
        <RuleRef code="C09" />
      </AppProviders>,
    );
    await user.hover(screen.getByTestId("ruleref-C09"));
    await waitFor(() => expect(screen.getByTestId("ruleref-pop").textContent).toContain("数据时延临时降级"));
    const pop = screen.getByTestId("ruleref-pop");
    expect(pop.textContent).not.toContain("未找到定义"); // 病灶文案消失
    expect(pop.textContent).toContain("DataSourceHealth"); // 真 expression
    expect(screen.getByTestId("ruleref-params-C09").textContent).toContain("staleHours=2"); // 命名阈值可见
  });
});
