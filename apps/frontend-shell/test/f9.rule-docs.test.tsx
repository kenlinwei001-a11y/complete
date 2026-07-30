import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F9 · 规则文档审核台", () => {
  it("sourceQuote 高亮对照；EDIT_APPROVE 修改 expression 后提交体正确", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rule-docs");

    // 候选卡渲染（含 疑似重复 徽章与 diff 徽章）
    const card1 = await screen.findByTestId("candidate-cand-1");
    expect(within(card1).getByTestId("dup-badge")).toHaveTextContent("疑似重复");
    expect(within(card1).getByText("变更")).toBeInTheDocument();
    expect(screen.getByTestId("review-progress")).toHaveTextContent("0/3 已审");

    // 点击候选 → 左侧对应段落高亮 sourceQuote
    await user.click(card1);
    const mark = await screen.findByTestId("source-quote-highlight");
    expect(mark).toHaveTextContent("单型号需求增量超过基准产能的 50% 时，禁止直接承接");

    // 修改 expression → 按钮变为「修改后通过」→ 提交体含 patch
    const exprBox = within(card1).getByLabelText("expression");
    await user.clear(exprBox);
    await user.type(exprBox, "Order.demandDelta <= 0.4");
    await user.click(within(card1).getByRole("button", { name: "修改后通过" }));

    await waitFor(() => {
      const cand = db.candidates.find((c) => c.id === "cand-1")!;
      expect(cand.status).toBe("APPROVED");
      expect(cand.candidate.expression).toBe("Order.demandDelta <= 0.4");
    });

    // diff 模式分组
    // WO-UNIT-MEANING：分组标题此前是「新增 (1)」的裸数——label 是差异类别不是被数之物 → 点明"条规则候选"
    await user.click(screen.getByLabelText(/diff 模式/));
    expect(screen.getByText("新增（1 条规则候选）")).toBeInTheDocument();
    expect(screen.getByText("疑似删除（1 条规则候选）")).toBeInTheDocument();
  });
});
