import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { ANSWER_A2 } from "@/mocks/fixtures";
import { db, type MockTask } from "@/mocks/db";
import { PROV_MARK_HOVER_DELAY_MS } from "@/components/Provenance/ProvTrigger";
import type { Answer } from "@platform/contracts";

/**
 * PROV-HOVER-DWELL 齿检（治理批次小注①）：叙事 ⟦ref⟧ sup 角标是小靶，旧 300ms 驻留 + 无热区扩大
 * → hover 难命中（需驻留/点按才出浮层）。治：驻留缩短至 150ms（PROV_MARK_HOVER_DELAY_MS）+
 * .mark::after 热区外扩（CSS·真浏览器证）。齿钉：
 *   ① hover 角标 → 400ms 内浮层出现（WO 验收口径原文）；
 *   ② 驻留常量 = 150ms（< 旧 300ms·复原即红）；
 *   ③ hover 移开（未钉住）→ 浮层关闭；click 钉住仍在（设计内交互不回归）。
 */

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

describe("PROV-HOVER-DWELL · 叙事 sup 角标 hover 驻留（150ms·400ms 内出浮层）", () => {
  afterEach(() => cleanup());

  it("hover 角标 400ms 内浮层出现（未点击·非钉住态无关闭按钮）", async () => {
    const user = userEvent.setup();
    renderAnswer("task-hover-dwell", ANSWER_A2);
    await user.hover(screen.getByTestId("prov-mark-prov-a2-3"));
    // WO 验收口径：hover 400ms → popover shown（驻留 150ms + 渲染余量 < 400ms 上界）。
    await waitFor(() => expect(screen.getByTestId("prov-popover")).toBeInTheDocument(), { timeout: 400 });
    // hover 态非钉住：无 ✕ 关闭按钮（钉住才有）。
    expect(screen.queryByLabelText("关闭")).toBeNull();
  });

  it("驻留常量缩短为 150ms（复原 300ms 即红）", () => {
    expect(PROV_MARK_HOVER_DELAY_MS).toBe(150);
    expect(PROV_MARK_HOVER_DELAY_MS).toBeLessThan(300);
  });

  it("hover 移开（未钉住）→ 浮层关闭；click 钉住 → 出关闭按钮（设计内交互不回归）", async () => {
    const user = userEvent.setup();
    renderAnswer("task-hover-dwell-2", ANSWER_A2);
    const mark = screen.getByTestId("prov-mark-prov-a2-3");
    await user.hover(mark);
    await waitFor(() => expect(screen.getByTestId("prov-popover")).toBeInTheDocument(), { timeout: 400 });
    await user.unhover(mark);
    await waitFor(() => expect(screen.queryByTestId("prov-popover")).toBeNull());
    // click 钉住不变（小注明确"click 钉住为设计内"）。
    await user.click(mark);
    const pop = await screen.findByTestId("prov-popover");
    expect(pop).toBeInTheDocument();
    expect(screen.getByLabelText("关闭")).toBeInTheDocument();
  });
});
