import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { dslSuggestions, type DslSchema } from "@/pages/admin/DslTextarea";

/**
 * 轨 G · C11 DSL 输入辅助（addendum §7 · D-28）。
 * ① 纯逻辑：dslSuggestions —— `Type.` 联想属性、裸前缀联想对象类型/阈值。
 * ② UI：规则编辑器 expression 框输入"Order."弹出属性补全候选（数据源=本体元模型）。
 */
const SCHEMA: DslSchema = {
  objectTypes: [
    { key: "Order", props: ["qty", "demandDelta", "marginPct"] },
    { key: "Base", props: ["name", "utilization"] },
  ],
  paramKeys: ["maxQty", "floorPct"],
  ruleCodes: ["C03", "C15"],
};

describe("C11 · DSL 输入辅助（补全）", () => {
  it("dslSuggestions：Order. → 联想属性", () => {
    const s = dslSuggestions(SCHEMA, "Order.");
    const labels = s.map((x) => x.label);
    expect(labels).toContain("Order.qty");
    expect(labels).toContain("Order.demandDelta");
  });

  it("dslSuggestions：Order.de → 前缀过滤", () => {
    const s = dslSuggestions(SCHEMA, "Order.de");
    expect(s.map((x) => x.label)).toEqual(["Order.demandDelta"]);
  });

  it("dslSuggestions：裸前缀 → 对象类型 + 命名阈值键", () => {
    const s = dslSuggestions(SCHEMA, "ma");
    const labels = s.map((x) => x.label);
    // maxQty（阈值），无对象类型以 ma 开头
    expect(labels).toContain("maxQty");
  });

  it("规则编辑器：expression 输入 Order. → 弹属性补全（D-28 非裸文本框）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    // 新建规则进编辑器（DSL 框可编辑）
    await user.click(await screen.findByTestId("rule-create"));
    const expr = await screen.findByTestId("rule-expression");
    await user.click(expr);
    await user.type(expr, "Order.");
    await waitFor(() => expect(screen.getByTestId("rule-expression-suggest")).toBeTruthy());
    const list = screen.getByTestId("rule-expression-suggest");
    // 候选含真实本体属性（demo 本体 Order.* ）
    expect(within(list).getAllByRole("option").length).toBeGreaterThan(0);
  });
});
