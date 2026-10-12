/**
 * WO-REF-BADGE-UNRESOLVED · **「有个角标」不度量「这个数字指得出出处」。**
 *
 * ── 病灶（2026-10-06 活服务实测，不是假想）─────────────────────────────────────
 * 一次真跑出的答案是：正文带 `⟦ref:0⟧`…`⟦ref:18⟧`，而 `answer.provenance` 是**空数组**。
 * 前端 `AnswerCard` 的 `provIndex(provId)` 对**找不到**的 id 返回 `0`（`indexOf` 未命中的哨兵），
 * 而 `ProvMark` 原先**无条件**印 `[{index}]` ⇒ **满屏 `[0]`**，每条点出来都是空的，
 * 读者却当它们各自有出处。诚实位那边是对的（`unverifiedNumerics=true` 亮着），但角标在撒谎。
 *
 * 形态（铁律 0.6 句式）：
 * > 「我用『那儿有个角标』当作『这个数字指得出出处』的证据，而前者并不度量后者。」
 *
 * ── 判据（两条必须**同时**成立）───────────────────────────────────────────────
 * 只报 ① 不报 ② 就是把「判据变严」（该印的不印了）和「判据变瞎」（不该印的还印着）混为一谈。
 *   ① 指不出出处 ⇒ **不印数字角标**，印可分辨的「?」且**不可点**（没有出处可弹）
 *   ② 指得出出处 ⇒ 照常印 `[n]` 且可点，**不出现**「?」
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { db, type MockTask } from "@/mocks/db";
import type { Answer, ProvenanceRef } from "@platform/contracts";

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

const provRef = (id: string): ProvenanceRef => ({
  id,
  source: "TOOL_RESULT",
  toolCallId: `tc_${id}`,
  toolName: "query_objects",
  outputPath: "$",
});

const answerWith = (markdown: string, provenance: ProvenanceRef[]): Answer =>
  ({
    trustLevel: "AGENT_EXPLORATORY",
    blocks: [{ type: "text", markdown }],
    provenance,
    unverifiedNumerics: provenance.length === 0,
  }) as unknown as Answer;

describe("WO-REF-BADGE-UNRESOLVED · 角标不许替不存在的出处背书", () => {
  it("① 指不出出处（provenance 为空）⇒ 印「?」且不可点，⛔ 不印 [0]", () => {
    renderAnswer("task-refbad-1", answerWith("产能缺口 1200 万套⟦ref:0⟧，另见⟦ref:9⟧。", []));

    // ① 不许再出现「指得出出处」的数字角标
    expect(screen.queryByTestId("prov-mark-0")).toBeNull();
    expect(screen.queryByTestId("prov-mark-9")).toBeNull();
    // ① 也不许把哨兵值当编号印出来（满屏 [0] 那一幕）
    expect(screen.queryByText("[0]")).toBeNull();

    // ① 印可分辨的「?」，且**不可点**（没有出处可弹 ⇒ 有交互就是骗人）
    const u0 = screen.getByTestId("prov-mark-unresolved-0");
    const u9 = screen.getByTestId("prov-mark-unresolved-9");
    expect(u0.textContent).toBe("?");
    expect(u9.textContent).toBe("?");
    expect(u0.getAttribute("role")).toBeNull(); // 不是 button
    expect(u0.getAttribute("tabindex")).toBeNull(); // 不进 tab 序
    expect(u0.getAttribute("aria-label")).toBe("该数字未注明出处");
  });

  it("② 指得出出处 ⇒ 照常印 [n] 且可点，⚠ 不出现「?」（反向对照）", () => {
    renderAnswer("task-refbad-2", answerWith("产能缺口 1200 万套⟦ref:prov_x⟧。", [provRef("prov_x")]));

    const ok = screen.getByTestId("prov-mark-prov_x");
    expect(ok.textContent).toBe("[1]"); // 第 1 条出处（1-based）
    expect(ok.getAttribute("role")).toBe("button"); // 可点
    expect(screen.queryByTestId("prov-mark-unresolved-prov_x")).toBeNull();
  });

  it("③ 金丝雀：混合场景逐条判 —— 指得出的印数字、指不出的印「?」，同屏并存且互不串味", () => {
    renderAnswer(
      "task-refbad-3",
      answerWith("甲 1⟦ref:prov_a⟧、乙 2⟦ref:ghost⟧、丙 3⟦ref:prov_b⟧。", [provRef("prov_a"), provRef("prov_b")]),
    );

    expect(screen.getByTestId("prov-mark-prov_a").textContent).toBe("[1]");
    expect(screen.getByTestId("prov-mark-prov_b").textContent).toBe("[2]");
    expect(screen.getByTestId("prov-mark-unresolved-ghost").textContent).toBe("?");
    // 三个标记都在（证明解析器真把三个 ⟦ref:…⟧ 都切出来了 —— 否则上面三条各自都可能恒真）
    expect(screen.queryByText(/⟦/)).toBeNull(); // 原始记号不许漏到屏上
  });
});
