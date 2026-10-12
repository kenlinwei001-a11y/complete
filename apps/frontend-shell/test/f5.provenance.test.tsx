import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { ANSWER_A1, ANSWER_A2 } from "@/mocks/fixtures";
import { db, type MockTask } from "@/mocks/db";
import type { Answer } from "@platform/contracts";

function seedTask(taskId: string, answer: Answer): void {
  db.tasks.set(taskId, {
    id: taskId,
    query: "q",
    context: {},
    plan: { segments: [], path: "WORKFLOW", finalAnswer: answer },
    status: "COMPLETED",
    clarificationRounds: 0,
    createdAt: "",
  } as MockTask);
}

function renderAnswer(taskId: string, answer: Answer) {
  seedTask(taskId, answer);
  return render(
    <AppProviders>
      <MemoryRouter>
        <AnswerCard answer={answer} taskId={taskId} />
      </MemoryRouter>
    </AppProviders>,
  );
}

const SECTION_TITLES = ["值与口径", "来源", "计算", "规则"];

describe("F5 · 溯源弹窗（全局唯一组件）", () => {
  it("text 角标点击打开，四段内容齐全", async () => {
    const user = userEvent.setup();
    renderAnswer("task-f5a", ANSWER_A2);
    await user.click(screen.getByTestId("prov-mark-prov-a2-3"));
    const pop = await screen.findByTestId("prov-popover");
    for (const title of SECTION_TITLES) {
      expect(within(pop).getByText(title)).toBeInTheDocument();
    }
    // 规则段统一用共享 <RuleRef>（收尾#4）：悬浮规则编号 → 弹活规则定义（含 expression）
    await user.hover(within(pop).getByTestId("ruleref-C03"));
    // WO-RULE-EXPR-PARAMS（#78）：规则库 mock 改回与真后端同口径的**违规谓词**（`> 0.5`，为真 ⇒ 不通过）。
    // 原断言咬的是 mock 独有的约束式 `<= 0.5` —— 极性与真后端相反，用户在溯源弹窗里看到的是反的那句。
    await waitFor(() => expect(screen.getByTestId("ruleref-pop").textContent).toContain("Order.demandDelta > 0.5"));
  });

  it("kpi 卡点击打开（含 TS_AGGREGATE 形态文案）", async () => {
    const user = userEvent.setup();
    renderAnswer("task-f5b", ANSWER_A2);
    await user.click(screen.getByTestId("kpi-prov-a2-2"));
    const pop = await screen.findByTestId("prov-popover");
    for (const title of SECTION_TITLES) {
      expect(within(pop).getByText(title)).toBeInTheDocument();
    }
    // A8 §3 文案：来自窗口 + rowsIn + 规约
    expect(within(pop).getByText(/来自 2026-06-01~2026-06-07 共 84,213 条实绩/)).toBeInTheDocument();
    expect(within(pop).getByText(/规约 oee_daily@v2/)).toBeInTheDocument();
    // 趋势小图（聚合查询，不出原始行）
    await user.click(within(pop).getByRole("button", { name: "聚合趋势" }));
    expect(await within(pop).findByTestId("ts-trend")).toBeInTheDocument();
  });

  it("table 表头角标点击打开", async () => {
    const user = userEvent.setup();
    renderAnswer("task-f5c", ANSWER_A1);
    // 同一 provId 在 text 与 table 表头都有角标；取 table 内的那个
    const table = screen.getByTestId("answer-table");
    await user.click(within(table).getByTestId("prov-mark-prov-a1-1"));
    const pop = await screen.findByTestId("prov-popover");
    for (const title of SECTION_TITLES) {
      expect(within(pop).getByText(title)).toBeInTheDocument();
    }
  });
});
