/**
 * WO-DSH-POC-S3 · Answer 重组装 kill 条件单测：3 类 block（text / tool_use 引用 / structured）
 * + 治理拒证 + turn/end→outcome 映射 + SSE 桥映射。帧形按 dsh agent-loop 源码实证
 * （tool-calls.ts:263 扁平 tool/call；agent.ts:349/382 chunk/message 包 message）。
 */
import { describe, expect, it } from "vitest";
import {
  collectToolCalls,
  mapDshEventToSse,
  reassembleDshRun,
  type DshSessionEvent,
} from "../src/dsh-runtime/reassemble.js";

const toolCall = (callId: string, name: string, args: unknown): DshSessionEvent => ({
  type: "tool/call",
  data: { turn: 1, step: 1, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const assistantMessage = (text: string): DshSessionEvent => ({
  type: "assistant/message",
  data: { turn: 1, step: 2, message: { content: [{ type: "text", text }], source: { provider: "mock", model: "mock" } } },
});
const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });

const provIds = (() => { let n = 0; return () => `prov_t${++n}`; })();

describe("reassemble · block 类型 ① text", () => {
  it("final_answer text blocks → Answer 原样出，provenance 空", () => {
    const events = [
      toolCall("c1", "final_answer", { blocks: [{ type: "text", markdown: "结论" }], provenance: [] }),
      assistantMessage("收尾"),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { newProvId: provIds });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("ANSWERED");
    expect(r.answer.trustLevel).toBe("AGENT_EXPLORATORY");
    expect(r.answer.blocks).toEqual([{ type: "text", markdown: "结论" }]);
    expect(r.answer.provenance).toEqual([]);
  });

  it("无 final_answer → 软收尾兜底最后 assistant 文本（诚实 NO_ANSWER 不造溯源）", () => {
    const r = reassembleDshRun([assistantMessage("只有文本"), turnEnd("completed")]);
    expect(r.ok && r.answer.blocks).toEqual([{ type: "text", markdown: "只有文本" }]);
    expect(r.ok && r.answer.provenance).toEqual([]);
  });
});

describe("reassemble · block 类型 ② tool_use 引用（provenance 回填）", () => {
  it("provenance.toolCallId 从帧流 tool/call 回填 toolName；kpi/table 块带 provId 直通", () => {
    const events = [
      toolCall("call_9", "query_objects", { type: "Model" }),
      toolCall("c2", "final_answer", {
        blocks: [
          { type: "kpi", label: "产能", value: "⟦ref:1⟧ 92", unit: "%", provId: "x" },
          { type: "table", columns: ["a"], rows: [[1]], provId: "x" },
        ],
        provenance: [{ toolCallId: "call_9", outputPath: "$" }],
      }),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { newProvId: provIds });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.provenance).toHaveLength(1);
    expect(r.answer.provenance[0]).toMatchObject({
      source: "TOOL_RESULT", toolCallId: "call_9", toolName: "query_objects", outputPath: "$",
    });
    expect(r.answer.blocks.map((b) => b.type)).toEqual(["kpi", "table"]);
    // sketch：元工具 final_answer 不进，query_objects 进（loop.ts:1146 同口径）
    expect(r.sketch).toEqual([{ toolName: "query_objects", inputSummary: '{"type":"Model"}' }]);
  });

  it("provenance 引用未知 toolCallId → toolName unknown（loop.ts audit 缺失同口径）", () => {
    const events = [
      toolCall("c3", "final_answer", {
        blocks: [{ type: "text", markdown: "x" }],
        provenance: [{ toolCallId: "ghost", outputPath: "$.a" }],
      }),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { newProvId: provIds });
    expect(r.ok && r.answer.provenance[0]?.toolName).toBe("unknown");
  });
});

describe("reassemble · block 类型 ③ structured（expectsSchema）", () => {
  it("expectsSchema 模式：final_answer raw input 直通 structured，不走 AnswerBlock 校验", () => {
    const raw = { rows: [{ sku: "A", qty: 3 }], note: "任意形状" };
    const events = [toolCall("c4", "final_answer", raw), turnEnd("completed")];
    const r = reassembleDshRun(events, { expectsSchema: { type: "object" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.structured).toEqual(raw);
  });

  it("expectsSchema 但无 final_answer → ok:false 显式错误", () => {
    const r = reassembleDshRun([assistantMessage("t"), turnEnd("completed")], { expectsSchema: {} });
    expect(r.ok).toBe(false);
  });
});

describe("reassemble · 治理拒证（loop.ts acceptFinalAnswer 同口径）", () => {
  it("provenancePolicy=required 且 provenance 空 → ok:false", () => {
    const events = [toolCall("c5", "final_answer", { blocks: [{ type: "text", markdown: "x" }], provenance: [] }), turnEnd("completed")];
    const r = reassembleDshRun(events, { governance: { writeMode: false, provenancePolicy: "required" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/provenancePolicy=required/);
  });

  it("writeMode 且 blocks 无 action_draft → ok:false；含则放行", () => {
    const mk = (blocks: unknown[]) => [toolCall("c6", "final_answer", { blocks, provenance: [] }), turnEnd("completed")];
    const gov = { writeMode: true, provenancePolicy: "best_effort" as const };
    expect(reassembleDshRun(mk([{ type: "text", markdown: "x" }]), { governance: gov }).ok).toBe(false);
    const okRun = reassembleDshRun(mk([{ type: "action_draft", draftId: "d1", actionType: "t", summary: "s" }]), { governance: gov });
    expect(okRun.ok).toBe(true);
  });

  it("final_answer 入参畸形 → ok:false（单校验点严校验）", () => {
    const events = [toolCall("c7", "final_answer", { blocks: [{ type: "nonsense" }] }), turnEnd("completed")];
    expect(reassembleDshRun(events).ok).toBe(false);
  });
});

describe("reassemble · turn/end → outcome", () => {
  it("max-tokens → BUDGET_EXHAUSTED + degraded", () => {
    const r = reassembleDshRun([assistantMessage("半"), turnEnd("max-tokens")]);
    expect(r.ok && r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.ok && r.degraded).toEqual({ reason: "BUDGET_EXHAUSTED" });
  });
  it("error → FAILED；aborted → FAILED", () => {
    expect(reassembleDshRun([turnEnd("error")]).ok && (reassembleDshRun([turnEnd("error")]) as { outcome: string }).outcome).toBe("FAILED");
    const r = reassembleDshRun([turnEnd("aborted")]);
    expect(r.ok && r.outcome).toBe("FAILED");
  });
});

describe("reassemble · N3 stall-loop 分类（C1-C3）", () => {
  // N3 watchdog 的 turn/end abort cause 帧形（dsh-agent-loop index.js:575-580 实证）：
  // data.reason = {kind:'aborted', reason:{kind:'stall-loop', tool, count, cap}}。
  const stallTurnEnd = (cap: number): DshSessionEvent => ({
    type: "turn/end",
    data: { turn: 1, reason: { kind: "aborted", reason: { kind: "stall-loop", tool: "echo_tool", count: cap, cap } } },
  });
  const toolResult = (toolCallId: string, isError: boolean, text = "ok"): DshSessionEvent => ({
    type: "tool/result",
    data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId, content: [{ type: "text", text }], isError }] } },
  });
  const stallFrames = (cap: number) => [
    toolCall("c1", "echo_tool", { text: "same" }),
    toolResult("c1", false, "echo-1"),
    toolCall("c2", "echo_tool", { text: "same" }),
    toolResult("c2", true, "boom"), // 失败调用不进 provenance（loop.ts:644-656 仅 OK 调用同口径）
    toolCall("c3", "echo_tool", { text: "same" }),
    toolResult("c3", false, "echo-3"),
    stallTurnEnd(cap),
  ];

  it("C1 合成帧流 → ok:true ∧ BUDGET_EXHAUSTED ∧ degraded STALL_LOOP ∧ 诚实块含 cap ∧ provenance 仅成功 callId", () => {
    const r = reassembleDshRun(stallFrames(3), { newProvId: provIds });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.degraded).toEqual({ reason: "STALL_LOOP" });
    expect(r.answer.blocks[0]).toMatchObject({ type: "text" });
    const header = (r.answer.blocks[0] as { markdown: string }).markdown;
    expect(header).toContain("检测到无进度循环"); // 镜像 loop.ts:620-632 诚实头
    expect(header).toContain("loopRepeatCap=3"); // cap 从帧 cause 取（reassemble 保纯不读 env）
    expect(r.answer.provenance.map((p) => p.toolCallId)).toEqual(["c1", "c3"]); // c2 isError 排除
    for (const p of r.answer.provenance) {
      expect(p.outputPath).toBe("$");
      expect(p.toolName).toBe("echo_tool");
    }
  });

  it("C2 expectsSchema + stall-loop 帧流 → 仍 STALL_LOOP 降级（分类前置，非 ok:false 重组装拒绝）", () => {
    const r = reassembleDshRun(stallFrames(3), { expectsSchema: { type: "object" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.degraded).toEqual({ reason: "STALL_LOOP" });
  });

  it("C3 普通 aborted（cause.kind≠stall-loop）→ 仍 FAILED（分类不误吞）", () => {
    const disposed: DshSessionEvent = {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "aborted", reason: { kind: "disposed" } } },
    };
    const r = reassembleDshRun([toolCall("c1", "echo_tool", {}), disposed]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("FAILED");
    expect(r.degraded).toBeUndefined();
  });
});

describe("SSE 桥 mapDshEventToSse", () => {
  it("tool/call → step.started {stepId=callId, type=name}（loop.ts:844 同形）", () => {
    expect(mapDshEventToSse(toolCall("call_1", "echo_tool", { a: 1 }))).toEqual({
      event: "step.started", payload: { stepId: "call_1", type: "echo_tool" },
    });
  });
  it("tool/result → step.completed status OK/ERROR", () => {
    const frame: DshSessionEvent = {
      type: "tool/result",
      data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "call_1", content: [], isError: true }] } },
    };
    expect(mapDshEventToSse(frame)).toEqual({ event: "step.completed", payload: { stepId: "call_1", status: "ERROR" } });
  });
  it("assistant/chunk text-delta → agent_narration 伪 step；非文本 chunk → undefined", () => {
    expect(mapDshEventToSse({ type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "text-delta", text: "想" } } }))
      .toEqual({ event: "step.completed", payload: { stepId: "narration-1-2", type: "agent_narration", text: "想" } });
    expect(mapDshEventToSse({ type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "block-start", index: 0 } } })).toBeUndefined();
  });
  it("turn/end、assistant/message 等不逐帧出 SSE（answer.final 由 runner 发）", () => {
    expect(mapDshEventToSse(turnEnd("completed"))).toBeUndefined();
    expect(mapDshEventToSse(assistantMessage("x"))).toBeUndefined();
  });
});

describe("collectToolCalls 容错", () => {
  it("arguments 为不可解析字符串时保留原文不炸", () => {
    const calls = collectToolCalls([{ type: "tool/call", data: { callId: "c", name: "n", arguments: "{broken" } }]);
    expect(calls[0]?.input).toBe("{broken");
  });
});
