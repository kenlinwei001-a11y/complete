import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Answer } from "@platform/contracts";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { loginAs } from "./utils";

/**
 * CL.7 · 对话坞缺口卡（in-dialog gap-fill）。答案命中缺口 → 可点缺口卡（非干叙述）：
 * 可补码 → ▶触发生成（复用 growth/run LOOP）→ CONVERGED → 继续推演重跑；
 * 需开发码 → 诚实"不可达：断在 <码>" + 工单深链（绿测试≠能用，不假装成功）。
 */
function gapAnswer(gapCode: string, question: string, blocking = true): Answer {
  return {
    trustLevel: "AGENT_EXPLORATORY",
    provenance: [],
    blocks: [
      {
        type: "gap",
        report: {
          question,
          taskId: "t1",
          verdict: "BLOCKED",
          path: "AGENT",
          findings: [{ gapCode, evidence: `断在 ${gapCode}`, suggestedFill: "触发自成长补数据", blocking }],
          generatedAt: "2026-06-17T00:00:00Z",
        },
      },
    ],
  } as unknown as Answer;
}

function renderCard(answer: Answer, onRetry?: () => void) {
  return render(
    <AppProviders>
      <MemoryRouter>
        <AnswerCard answer={answer} taskId="t1" showFeedback={false} showDetailLink={false} onRetry={onRetry} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("CL.7 · 对话坞缺口卡", () => {
  it("可补缺口（EMPTY_DATA）→ 触发生成 → CONVERGED → 继续推演重跑原问句", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const onRetry = vi.fn();
    // 问句含"达成率" → mock growth/run 返 CONVERGED
    renderCard(gapAnswer("EMPTY_DATA", "本月达成率为何未达成"), onRetry);

    const card = await screen.findByTestId("gap-card");
    expect(card).toHaveAttribute("data-gapcode", "EMPTY_DATA");
    expect(within(card).getByTestId("gap-code")).toHaveTextContent("EMPTY_DATA");

    await user.click(within(card).getByTestId("gap-trigger"));
    // 补齐 → 续推按钮
    const cont = await within(card).findByTestId("gap-continue");
    expect(cont).toHaveTextContent("继续推演");
    await user.click(cont);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("需开发缺口（SOLVER_NOT_FOUND）→ 无触发按钮，诚实断点 + 工单深链", async () => {
    loginAs("planner");
    renderCard(gapAnswer("SOLVER_NOT_FOUND", "某需新求解器的问句"));

    const card = await screen.findByTestId("gap-card");
    expect(within(card).queryByTestId("gap-trigger")).toBeNull();
    expect(within(card).getByTestId("gap-boundary")).toHaveTextContent("不可达：断在 SOLVER_NOT_FOUND");
    expect(within(card).getByTestId("gap-ticket-link")).toHaveAttribute("href", "/admin/growth");
  });
});
