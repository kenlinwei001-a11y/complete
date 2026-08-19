/**
 * WO-DSH-E2E · L3 降级路径穿透 前端半（node-plan-E2E.md D-3 / L3.A2 + L3.A3 屏上面）。
 * 形态：N6 A19 SEAM-GATE（SSE → 真 taskStreamReducer → adaptSseEvents → selectChatFlow →
 * ChatFlow/Timeline 一竿到底）+ AnswerCard 真渲染（answer.final 落 state.answer 后的页面层消费）。
 *
 *   A2  STALL_LOOP 落屏逐字（L3.A2）：dsh 臂降级帧链（echo ×3 → agent_degraded{STALL_LOOP}
 *       → answer.final 诚实降级块）过真 reducer ⇒ notice 节点文案 === "STALL_LOOP" 原值逐字
 *       （不顶替不改写——dshFrameAdapter :372-373 reason=outcome 原值）∧ 诚实降级块经 AnswerCard
 *       同屏（reassemble stall 模板 header 原值）。
 *   A3  deny 屏上两臂（L3.A3）：
 *       ① 规则 deny 拒绝文案：rule_violation 块经 AnswerCard ⇒ explanation E 原值逐字上屏
 *          （两臂逐字节等由后端 A3a 机器断；此处断 E 经真渲染零加工）。
 *       ② dsh isError 落屏位：tool/result isError 的 SSE 形态（step.completed status=ERROR——
 *          dsh 映射只出 status 键，D-5 键名换算在适配层消化）⇒ 工具卡 ERROR badge 上屏。
 *          注：deny 理由文本到模型面不到 SSE 面（后端 A3b 断模型面逐字），屏上位 = ERROR 徽标。
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Answer } from "@platform/contracts";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { Timeline } from "@/components/QueryDock/Timeline";
import { initialStreamState, taskStreamReducer, type StreamEvent, type TaskStreamState } from "@/sse/taskStreamReducer";

/** reassemble stall 诚实块模板（cap=3，与后端 A1 断言同源同串）。 */
const STALL_HEADER =
  "[预算耗尽·诚实摘要] ⚠️ 检测到无进度循环：反复以相同参数调用同一工具、未获新信息（环检测·loopRepeatCap=3）——本次深问未能完全解答（已诚实终止，未烧尽预算）。以下为已探索到的线索：";
/** ③a 对齐剧本 verdict 文案（与后端 RULE_EXPLANATION 同串）。 */
const RULE_EXPLANATION = "需求增量 0.9 超过产能上限约束（>0.5 触发 BLOCK）";

function feed(frames: StreamEvent[]): TaskStreamState {
  let state = initialStreamState;
  for (const frame of frames) state = taskStreamReducer(state, { type: "event", frame });
  return state;
}

function renderTimeline(state: TaskStreamState) {
  return render(
    <MemoryRouter>
      <AppProviders>
        <Timeline state={state} />
      </AppProviders>
    </MemoryRouter>,
  );
}

function renderAnswer(answer: Answer) {
  return render(
    <MemoryRouter>
      <AppProviders>
        <AnswerCard answer={answer} taskId="t1" showFeedback={false} showDetailLink={false} />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("WO-DSH-E2E · L3 降级路径穿透（前端半）", () => {
  it("A2 · agent_degraded{STALL_LOOP} 帧链过真 reducer+adapter+projection+ChatFlow ⇒ notice 文案逐字 ∧ 诚实块同屏", () => {
    const frames: StreamEvent[] = [
      { id: "1", event: "step.started", data: { stepId: "call_1", type: "mcp__fwdmock__echo" } },
      { id: "2", event: "step.completed", data: { stepId: "call_1", status: "OK" } },
      { id: "3", event: "step.started", data: { stepId: "call_2", type: "mcp__fwdmock__echo" } },
      { id: "4", event: "step.completed", data: { stepId: "call_2", status: "OK" } },
      { id: "5", event: "step.started", data: { stepId: "call_3", type: "mcp__fwdmock__echo" } },
      { id: "6", event: "step.completed", data: { stepId: "call_3", status: "OK" } },
      // G-9 伪步（必早于 answer.final——后端 A1 源码锚 + dsh-degraded-seams A1/A2 运行时锚）
      { id: "7", event: "step.completed", data: { stepId: "degrade_1", type: "agent_degraded", outcome: "STALL_LOOP" } },
      {
        id: "8",
        event: "answer.final",
        data: {
          trustLevel: "AGENT_EXPLORATORY",
          blocks: [
            { type: "text", markdown: STALL_HEADER },
            { type: "text", markdown: "已探索线索：echo ×3 均返回同文。" },
          ],
          provenance: [],
          unverifiedNumerics: false,
        },
      },
    ];
    const state = feed(frames);
    expect(state.status).toBe("completed");
    const { container } = renderTimeline(state);
    // notice 节点文案 = "STALL_LOOP" 原值逐字（textContent 全等，不是 contains）
    const notice = screen.getByTestId("chat-notice");
    expect(notice.textContent, "notice 必须逐字 = outcome 原值（不顶替不改写）").toBe("STALL_LOOP");
    // 工具调用同屏（3 次 echo 各一张卡）
    for (const c of ["call_1", "call_2", "call_3"]) {
      expect(container.querySelector(`[data-chat-anchor-key="call:${c}"]`)).not.toBeNull();
    }
    // 诚实降级块经 AnswerCard 真渲染同屏（header 原值）
    renderAnswer(state.answer as Answer);
    expect(screen.getByTestId("answer-card")).toHaveTextContent("预算耗尽·诚实摘要");
    expect(screen.getByTestId("answer-card")).toHaveTextContent("loopRepeatCap=3");
  });

  it("A3① · 规则 deny 拒绝文案：rule_violation 块过真 reducer+AnswerCard ⇒ explanation 原值逐字上屏", () => {
    const frames: StreamEvent[] = [
      {
        id: "1",
        event: "answer.final",
        data: {
          trustLevel: "AGENT_EXPLORATORY",
          blocks: [
            {
              type: "rule_violation",
              ruleId: "C03",
              severity: "BLOCK",
              explanation: RULE_EXPLANATION,
              provId: "prov_skill_rule_check",
            },
          ],
          provenance: [],
          unverifiedNumerics: false,
        },
      },
    ];
    const state = feed(frames);
    expect(state.status).toBe("completed");
    renderAnswer(state.answer as Answer);
    const card = screen.getByTestId("rule-violation");
    // explanation 渲染在独立 <p>：逐字全等（不顶替不截断不加前缀）
    const paragraph = card.querySelector("p");
    expect(paragraph?.textContent, "拒绝理由必须逐字上屏").toBe(RULE_EXPLANATION);
    expect(within(card).getByText("C03")).toBeInTheDocument();
    expect(within(card).getByText("BLOCK")).toBeInTheDocument();
  });

  it("A3② · dsh isError SSE 形态（step.completed status=ERROR 无文本）⇒ 工具卡 ERROR badge 落屏", () => {
    const frames: StreamEvent[] = [
      { id: "1", event: "step.started", data: { stepId: "call_deny", type: "mcp__fwdmock__echo" } },
      // dsh 映射真形态（reassemble createSseMapper）：status 键、零文本——D-5 键名换算在适配层消化
      { id: "2", event: "step.completed", data: { stepId: "call_deny", status: "ERROR" } },
      {
        id: "3",
        event: "answer.final",
        data: {
          trustLevel: "AGENT_EXPLORATORY",
          blocks: [{ type: "text", markdown: "l3 seam answer" }],
          provenance: [],
          unverifiedNumerics: false,
        },
      },
    ];
    const state = feed(frames);
    renderTimeline(state);
    // isError 落屏位：ERROR badge（理由文本不到 SSE 面——后端 A3b 断模型面逐字，此处只断屏上 ERROR 位）
    expect(screen.getByTestId("tool-error-call_deny")).toHaveTextContent("ERROR");
  });
});
