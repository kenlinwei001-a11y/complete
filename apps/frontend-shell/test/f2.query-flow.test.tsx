import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F2 · risk 视图选中基地后提问", () => {
  it("SessionContext 含 selectedObject；时间线渲染；table + VERIFIED 徽章", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");

    // 风险卡渲染并选中常州
    const card = await screen.findByTestId("risk-card-常州");
    await user.click(card);
    // 关闭弹出的详情 Modal
    await user.keyboard("{Escape}");

    // Dock 输入提问
    const input = screen.getAllByLabelText("查询输入")[0]!;
    await user.type(input, "影响哪些订单？{Enter}");

    // 请求体 SessionContext 断言（mock db 中留存）
    await waitFor(() => expect(db.tasks.size).toBe(1));
    const task = [...db.tasks.values()][0]!;
    const ctx = task.context as { view: string; selectedObjects: { objectType: string; label?: string }[] };
    expect(ctx.view).toBe("risk");
    expect(ctx.selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Base", label: "常州" }),
    ]);

    // 流式时间线：routing 徽章 + 步骤行
    await screen.findByTestId("routing-badge");
    expect(screen.getByText(/命中工作流/)).toBeInTheDocument();
    // WO-UNIT-MEANING：此前渲染成「conf 0.94」——既没说是什么、也没说满分是 1 还是 100。
    // 量纲＝分类置信度 0–1（QOS routing.completed 的 confidence·契约无 unit 字段），故写成「置信度 0.94/1」。
    const conf = await screen.findByTestId("routing-confidence");
    expect(conf.textContent ?? "").toMatch(/^置信度 \d\.\d{2}\/1$/);
    await screen.findByTestId("step-s2");

    // 最终 table 回答 + VERIFIED 徽章
    const answer = await screen.findByTestId("answer-card");
    expect(within(answer).getByTestId("trust-badge")).toHaveTextContent("已验证 · 工作流");
    expect(answer).toHaveAttribute("data-trust", "VERIFIED_WORKFLOW");
    const table = within(answer).getByTestId("answer-table");
    expect(within(table).getByText("SO-10001")).toBeInTheDocument();
  });
});
