import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import type { Answer, ValidationTrace } from "@platform/contracts";

/**
 * F42 · 推演验证痕迹面板：用到本体切片的推演结果展示一致性 + 交叉验证痕迹，让用户信任。
 */
const TRACE: ValidationTrace = {
  slicesUsed: ["model_capacity_network"],
  consistency: {
    verdict: "ALL_PASS",
    checks: [
      { kind: "ENTITY_DEFINED", ref: "Base", status: "PASS", detail: "切片对象类型在本体中定义" },
      { kind: "AXIOM", ref: "C03", status: "PASS", detail: "C03 利用率红线: 通过" },
      { kind: "NUMERIC_PROVENANCE", ref: "answer.numerics", status: "PASS", detail: "结论数字均可溯源" },
      { kind: "VERSION_PIN", ref: "solver:capacity_forecast", status: "PASS", detail: "当时生效版本 v1" },
    ],
  },
  crossValidation: {
    verdict: "CONFLICT",
    claims: [
      { claim: "Base:常州.util == 0.88", kind: "PROPERTY", subjectType: "Base", subjectId: "常州", property: "util", assertedValue: 0.88, status: "CONSISTENT" },
      { claim: "Base:常州.bottleneck == 涂布", kind: "PROPERTY", subjectType: "Base", subjectId: "常州", property: "bottleneck", assertedValue: "涂布", status: "CONFLICT", kgValue: "卷绕" },
    ],
  },
  generatedAt: "2026-06-16T00:00:00Z",
};

const ANSWER: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  blocks: [{ type: "text", markdown: "常州基地可接单。" }],
  provenance: [],
  unverifiedNumerics: false,
  validationTrace: TRACE,
};

const ANSWER_NO_TRACE: Answer = {
  trustLevel: "AGENT_EXPLORATORY",
  blocks: [{ type: "text", markdown: "探索回答。" }],
  provenance: [],
  unverifiedNumerics: false,
};

function renderCard(answer: Answer) {
  return render(
    <AppProviders>
      <MemoryRouter>
        <AnswerCard answer={answer} taskId="t1" showFeedback={false} showDetailLink={false} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("F42 · 推演验证痕迹面板", () => {
  it("展示切片 + 一致性/交叉验证判定徽章，展开见冲突的知识图谱实际值", async () => {
    const user = userEvent.setup();
    renderCard(ANSWER);

    const panel = await screen.findByTestId("validation-trace");
    expect(panel).toHaveTextContent("model_capacity_network");
    expect(within(panel).getByTestId("consistency-verdict")).toHaveTextContent("全部通过");
    expect(within(panel).getByTestId("cross-verdict")).toHaveTextContent("存在冲突");

    // 展开 → 一致性检查项 + 交叉验证冲突（图谱实际值）
    await user.click(screen.getByTestId("validation-trace-toggle"));
    expect(screen.getByTestId("consistency-check-AXIOM")).toHaveTextContent("C03");
    const conflict = screen.getByTestId("cross-claim-CONFLICT");
    expect(conflict).toHaveTextContent("卷绕"); // 知识图谱实际值
  });

  it("无 validationTrace（未用本体切片）→ 不渲染面板", () => {
    renderCard(ANSWER_NO_TRACE);
    expect(screen.queryByTestId("validation-trace")).toBeNull();
  });
});
