import type { Answer, SessionContext } from "@platform/contracts";
import type { ScriptFrame } from "./mockEventSource";
import {
  ANSWER_A1,
  ANSWER_A2,
  ANSWER_B1,
  ANSWER_ADOPT,
  ANSWER_UNVERIFIED,
} from "./fixtures";

export interface TaskScriptPlan {
  segments: ScriptFrame[][];
  finalAnswer?: Answer;
  intentKey?: string;
  path: "WORKFLOW" | "AGENT";
}

const step = (stepId: string, type: string, durationMs: number): ScriptFrame[] => [
  { event: "step.started", data: { stepId, type } },
  { event: "step.completed", data: { stepId, type, outcome: "OK", durationMs } },
];

/**
 * 按问句选择脚本（四套：正常流 / 澄清两种 / 失败流 / 断线重放流 + 探索流）。
 */
export function scriptForQuery(taskId: string, query: string, context: SessionContext): TaskScriptPlan {
  const accepted: ScriptFrame = { event: "task.accepted", data: { taskId } };

  // WO-Q1 增量3 演示流：哨兵问句「逐字流」走 Path B 终答增量流式——逐帧 reasoning/text answer.delta
  // （拉开间隔 + 延迟 answer.final），用于真浏览器实拍逐字流预览（不影响既有测试·其问句不含此词）。
  if (query.includes("逐字流")) {
    return {
      path: "AGENT",
      intentKey: undefined,
      finalAnswer: ANSWER_B1,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "AGENT", classification: { intentKey: null, confidence: 0 } }, delayMs: 200 },
          { event: "answer.delta", data: { reasoning: "先梳理供应链各环节风险敞口…" }, delayMs: 400 },
          { event: "answer.delta", data: { reasoning: "再对照库存与产能数据…" }, delayMs: 400 },
          { event: "answer.delta", data: { text: "供应链韧性评估：\n" }, delayMs: 500 },
          { event: "answer.delta", data: { text: "① 多源采购降低单点风险；" }, delayMs: 500 },
          { event: "answer.delta", data: { text: "② 关键物料安全库存；" }, delayMs: 500 },
          { event: "answer.delta", data: { text: "③ 本地化产能布局。" }, delayMs: 500 },
          { event: "answer.final", data: ANSWER_B1 as unknown as Record<string, unknown>, delayMs: 1800 },
        ],
      ],
    };
  }

  // 断线重放流（F6 / D1）
  if (query.includes("断线")) {
    return {
      path: "WORKFLOW",
      intentKey: "affected_orders",
      finalAnswer: ANSWER_A1,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "affected_orders", confidence: 0.94 } },
          ...step("s1", "resolve_slice", 120),
          { event: "step.started", data: { stepId: "s2", type: "invoke_solver" }, disconnectAfter: true },
          { event: "step.completed", data: { stepId: "s2", type: "invoke_solver", outcome: "OK", durationMs: 800 } },
          ...step("s3", "render_answer", 40),
          { event: "answer.final", data: ANSWER_A1 as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // 失败流
  if (query.includes("失败")) {
    return {
      path: "WORKFLOW",
      intentKey: "capacity_feasibility",
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "capacity_feasibility", confidence: 0.9 } },
          ...step("s1", "resolve_slice", 100),
          { event: "step.started", data: { stepId: "s2", type: "invoke_solver" } },
          { event: "step.completed", data: { stepId: "s2", type: "invoke_solver", outcome: "ERROR", durationMs: 30000 } },
          { event: "task.failed", data: { code: "DATACORE_UNAVAILABLE", message: "求解器超时", stepId: "s2" } },
        ],
      ],
    };
  }

  // 澄清 · INTENT_CHOICE（中置信多候选）
  if (query.includes("风险") && !query.includes("订单")) {
    return {
      path: "WORKFLOW",
      intentKey: "risk_root_cause",
      finalAnswer: ANSWER_A1,
      segments: [
        [
          accepted,
          {
            event: "clarification.required",
            data: {
              kind: "INTENT_CHOICE",
              round: 1,
              options: [
                { intentKey: "affected_orders", name: "受影响订单查询", description: "查询风险窗口内受影响的订单" },
                { intentKey: "risk_root_cause", name: "越线归因", description: "解释某基地某天为什么越线" },
              ],
            },
          },
        ],
        [
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "affected_orders", confidence: 1 } },
          ...step("s1", "invoke_solver", 600),
          ...step("s2", "render_answer", 30),
          { event: "answer.final", data: ANSWER_A1 as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // 澄清 · SLOT_FILLING（无选中对象时问"影响哪些订单"）
  if (query.includes("影响哪些订单") && context.selectedObjects.length === 0) {
    return {
      path: "WORKFLOW",
      intentKey: "affected_orders",
      finalAnswer: ANSWER_A1,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "affected_orders", confidence: 0.91 } },
          {
            event: "clarification.required",
            data: {
              kind: "SLOT_FILLING",
              round: 1,
              slots: [
                { name: "base", type: "objectRef", objectType: "Base", clarifyPrompt: "请选择基地", description: "目标基地" },
                { name: "timeWindow", type: "timeWindow", clarifyPrompt: "请提供时间窗（可选）", description: "时间窗" },
              ],
            },
          },
        ],
        [
          ...step("s1", "invoke_solver", 540),
          ...step("s2", "render_answer", 25),
          { event: "answer.final", data: ANSWER_A1 as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // A1 正常流（带选中对象）
  if (query.includes("影响哪些订单") || query.includes("受影响订单")) {
    return {
      path: "WORKFLOW",
      intentKey: "affected_orders",
      finalAnswer: ANSWER_A1,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "affected_orders", confidence: 0.95 } },
          ...step("s1", "resolve_slice", 130),
          ...step("s2", "invoke_solver", 740),
          ...step("s3", "render_answer", 35),
          { event: "answer.final", data: ANSWER_A1 as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // A2：产能可行性（kpi×3 + TS_AGGREGATE 溯源）
  if (query.includes("能不能接") || query.includes("能否承接") || query.includes("加 20%") || query.includes("加20%")) {
    return {
      path: "WORKFLOW",
      intentKey: "capacity_feasibility",
      finalAnswer: ANSWER_A2,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "capacity_feasibility", confidence: 0.92 } },
          ...step("s1", "resolve_slice", 110),
          ...step("s2", "invoke_solver", 1200),
          ...step("s3", "evaluate_rules", 90),
          ...step("s4", "render_answer", 30),
          { event: "answer.final", data: ANSWER_A2 as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // 采纳处置方案 → action_draft
  if (query.includes("采纳")) {
    return {
      path: "WORKFLOW",
      intentKey: "adopt_mitigation",
      finalAnswer: ANSWER_ADOPT,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "WORKFLOW", intentKey: "adopt_mitigation", confidence: 0.9 } },
          ...step("s1", "evaluate_rules", 130),
          ...step("s2", "create_action_draft", 210),
          { event: "action_draft.created", data: { draftId: "act-001", actionType: "shift_plan_change" } },
          ...step("s3", "render_answer", 25),
          { event: "answer.final", data: ANSWER_ADOPT as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // unverifiedNumerics 样例
  if (query.includes("爬坡") || query.includes("估算")) {
    return {
      path: "AGENT",
      finalAnswer: ANSWER_UNVERIFIED,
      segments: [
        [
          accepted,
          { event: "routing.completed", data: { path: "AGENT" } },
          ...step("tc-uv-1", "tool_call", 410),
          { event: "answer.final", data: ANSWER_UNVERIFIED as unknown as Record<string, unknown> },
        ],
      ],
    };
  }

  // B1：目录外 → 探索模式
  return {
    path: "AGENT",
    finalAnswer: ANSWER_B1,
    segments: [
      [
        accepted,
        { event: "routing.completed", data: { path: "AGENT" } },
        ...step("tc-b1-1", "tool_call", 380),
        ...step("tc-b1-2", "tool_call", 290),
        { event: "answer.final", data: ANSWER_B1 as unknown as Record<string, unknown> },
      ],
    ],
  };
}
