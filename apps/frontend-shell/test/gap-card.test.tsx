import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
 *
 * FILL-BOUNDARY-GUARDRAIL：触发不再直接跑——先经三闸（B1 CLARIFY 先澄清 / B2 PREVIEW 生成计划预览人确认 / B3 越界人工正门）。
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
  it("B1 · 泛问题（无对象域/实体）→ 触发不直接跑·先出澄清卡（CLARIFY·非直接触发）[teeth]", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const onRetry = vi.fn();
    // 泛问题「本月库存水位是否可以降低」（无基地/型号/细分）→ 触发后先澄清，绝不直接 CONVERGED。
    renderCard(gapAnswer("OTHER", "本月库存水位是否可以降低"), onRetry);

    const card = await screen.findByTestId("gap-card");
    await user.click(within(card).getByTestId("gap-trigger"));
    // 先澄清（复用 Clarification 槽位表单）——非直接触发、无「继续推演」。
    await within(card).findByTestId("gap-clarify");
    expect(within(card).queryByTestId("gap-continue")).toBeNull();
    expect(within(card).queryByTestId("gap-preview")).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("B1/B2 · 已接地问句 → 触发→生成计划预览（PREVIEW）→ 人确认才跑 → CONVERGED → 继续推演", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const onRetry = vi.fn();
    // 问句含注册表实体「常州」（已接地）+「达成率」（mock 返 CONVERGED）→ 触发后出生成计划预览。
    renderCard(gapAnswer("EMPTY_DATA", "常州本月达成率为何未达成"), onRetry);

    const card = await screen.findByTestId("gap-card");
    expect(card).toHaveAttribute("data-gapcode", "EMPTY_DATA");
    await user.click(within(card).getByTestId("gap-trigger"));

    // B2 生成计划预览（人确认才跑）——不盲补。
    const preview = await within(card).findByTestId("gap-preview");
    expect(preview).toHaveTextContent("生成计划预览");
    expect(within(card).queryByTestId("gap-continue")).toBeNull();

    // 人确认 → 真跑 LOOP → CONVERGED → 续推。
    await user.click(within(card).getByTestId("gap-preview-confirm"));
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
