import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F3 · 澄清流", () => {
  it("INTENT_CHOICE：选项卡 + 都不是；选中后继续到回答", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-常州");

    const input = screen.getAllByLabelText("查询输入")[0]!;
    await user.type(input, "风险怎么样{Enter}");

    const clar = await screen.findByTestId("clarification");
    expect(screen.getByTestId("clarify-round")).toHaveTextContent("第 1/2 次确认");
    expect(screen.getByTestId("intent-none")).toHaveTextContent("都不是");
    const opt = screen.getByTestId("intent-option-affected_orders");
    expect(opt).toHaveTextContent("受影响订单查询");
    expect(clar).toBeInTheDocument();

    await user.click(opt);
    // 答复后继续执行 → 最终回答
    await screen.findByTestId("answer-card");
  });

  it("SLOT_FILLING：内联表单按 SlotDef.type 渲染（objectRef 搜索 + 双日期）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order");
    await screen.findByTestId("ledger");

    const input = screen.getAllByLabelText("查询输入")[0]!;
    await user.type(input, "影响哪些订单？{Enter}");

    const form = await screen.findByTestId("slot-form");
    expect(screen.getByTestId("clarify-round")).toHaveTextContent("第 1/2 次确认");
    // objectRef → 搜索选择器
    const combo = screen.getByRole("combobox");
    await user.click(combo);
    const option = await screen.findByRole("option", { name: "常州" });
    await user.click(option);
    // timeWindow → 双日期
    expect(screen.getByLabelText("开始日期")).toBeInTheDocument();
    expect(screen.getByLabelText("结束日期")).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "提交" }));
    await screen.findByTestId("answer-card");
  });
});
