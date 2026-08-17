/**
 * WO-DSH-POC-S3 · dsh session.event 帧流 → 我方 Answer/SSE 的**纯重组装**（零 IO）。
 *
 * 输入是 JSON-RPC wire 上 session.event 通知里的 event 帧（已序列化过一遭的普通 JSON），
 * 输出对齐 runAgentLoop 的 Answer 组装语义（agent/loop.ts）：
 *   - final_answer 调用 ⇒ blocks/provenance 严格校验（AnswerBlockSchema 单校验点），
 *     provenance 的 toolName 从帧流里的 tool/call 记录回填（对位 loop.ts repos.toolCalls.get）；
 *   - 无 final_answer ⇒ 软收尾：最后一条 assistant/message 文本兜底（对位 lastText 分支）；
 *   - turn/end reason: completed→ANSWERED · max-tokens→BUDGET_EXHAUSTED · error/aborted→FAILED；
 *   - STALL_LOOP 不可重建（dsh 无环检测——E6 三档 verdict 的「放弃或外壳保留」项），不出。
 *   - expectsSchema 模式 ⇒ structured = final_answer raw input（对位 loop.ts:256）。
 */

import { AnswerBlockSchema, type Answer, type AnswerBlock, type ProvenanceRef } from "@platform/contracts";
import { z } from "zod";
import { scanBlocks } from "../util/numerics.js";
import { newId } from "../ids.js";

// ---- dsh 帧的窄本地类型（只声明重组装消费的字段；wire 上还有更多字段，宽容忽略） ----

export interface DshSessionEvent {
  type: string;
  data?: unknown;
}

interface DshToolCall {
  toolCallId: string;
  name: string;
  input: unknown;
}

export interface ReassembleOptions {
  /** skillGovernance 聚合（loop.ts:451 同口径）；writeMode/provenancePolicy 校验在此执行。 */
  governance?: { writeMode: boolean; provenancePolicy: "required" | "best_effort" | "none" };
  /** expectsSchema 模式：final_answer raw input 进 structured，不按 AnswerBlock 校验。 */
  expectsSchema?: Record<string, unknown>;
  /** provenance id 生成（测试注入确定性 id；生产缺省 prov_ 前缀自增由调用方包一层）。 */
  newProvId?: () => string;
}

export type ReassembledRun =
  | {
      ok: true;
      outcome: "ANSWERED" | "FAILED" | "BUDGET_EXHAUSTED";
      answer: Answer;
      sketch: { toolName: string; inputSummary: string }[];
      structured?: Record<string, unknown>;
      degraded?: { reason: "TIMEOUT" | "BUDGET_EXHAUSTED" };
    }
  | { ok: false; errors: string[] };

const FinalAnswerInputSchema = z
  .object({
    blocks: z.array(AnswerBlockSchema),
    provenance: z.array(z.object({ toolCallId: z.string(), outputPath: z.string() }).strict()),
  })
  .strict();

/** 从帧流提取 tool/call 记录。帧形（agent-loop/src/tool-calls.ts:263 实证）：
 * {type:'tool/call', data:{turn, step, callId, name, arguments}} —— arguments 是 LLM 原始
 * JSON 字符串（mock 剧本与真模型同形），此处容错解析为对象。 */
export function collectToolCalls(events: readonly DshSessionEvent[]): DshToolCall[] {
  const out: DshToolCall[] = [];
  for (const e of events) {
    if (e.type !== "tool/call" || typeof e.data !== "object" || e.data === null) continue;
    const d = e.data as Record<string, unknown>;
    if (typeof d.callId !== "string" || typeof d.name !== "string") continue;
    let input: unknown = d.arguments;
    if (typeof input === "string") {
      try { input = JSON.parse(input); } catch { /* 保留原始字符串 */ }
    }
    out.push({ toolCallId: d.callId, name: d.name, input });
  }
  return out;
}

function lastAssistantText(events: readonly DshSessionEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type !== "assistant/message" || typeof e.data !== "object" || e.data === null) continue;
    const message = (e.data as Record<string, unknown>).message as { content?: { type?: string; text?: string }[] } | undefined;
    const t = (message?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text ?? "").join("");
    if (t) text = t;
  }
  return text;
}

function turnEndReason(events: readonly DshSessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== "turn/end") continue;
    const reason = (e.data as Record<string, unknown> | undefined)?.reason;
    if (typeof reason === "string") return reason;
    if (typeof reason === "object" && reason !== null) return String((reason as Record<string, unknown>).kind ?? "");
    return "";
  }
  return undefined;
}

/**
 * 重组装主函数。事件顺序即 wire 顺序；只读不改。
 */
export function reassembleDshRun(events: readonly DshSessionEvent[], opts: ReassembleOptions = {}): ReassembledRun {
  const newProvId = opts.newProvId ?? (() => newId("prov")); // 与 loop.ts 同一生成器（ids.ts 单源）
  const calls = collectToolCalls(events);
  const toolNameByCallId = new Map(calls.map((c) => [c.toolCallId, c.name]));
  // sketch：loop.ts:1146 同口径 —— 元工具（final_answer/load_skill）不进 sketch。
  const sketch = calls
    .filter((c) => c.name !== "final_answer" && c.name !== "load_skill")
    .map((c) => ({ toolName: c.name, inputSummary: JSON.stringify(c.input ?? {}).slice(0, 200) }));

  const reason = turnEndReason(events);
  const outcome = reason === "completed" ? "ANSWERED"
    : reason === "max-tokens" ? "BUDGET_EXHAUSTED"
    : "FAILED";

  const finalCall = [...calls].reverse().find((c) => c.name === "final_answer");

  // expectsSchema 模式：raw input 直通 structured（对位 loop.ts:147/256）。
  if (opts.expectsSchema !== undefined) {
    if (!finalCall) {
      return { ok: false, errors: ["expectsSchema 模式但帧流中无 final_answer 调用"] };
    }
    return {
      ok: true,
      outcome,
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks: [{ type: "text", markdown: lastAssistantText(events) || "（结构化回答见 structured）" }], provenance: [], unverifiedNumerics: false },
      sketch,
      structured: (typeof finalCall.input === "object" && finalCall.input !== null ? finalCall.input : {}) as Record<string, unknown>,
      ...(outcome === "BUDGET_EXHAUSTED" ? { degraded: { reason: "BUDGET_EXHAUSTED" as const } } : {}),
    };
  }

  let blocks: AnswerBlock[];
  let provenance: ProvenanceRef[] = [];
  if (finalCall) {
    const parsed = FinalAnswerInputSchema.safeParse(finalCall.input);
    if (!parsed.success) {
      return { ok: false, errors: [`final_answer 入参校验失败: ${parsed.error.issues.map((i) => i.message).join("; ")}`] };
    }
    for (const p of parsed.data.provenance) {
      provenance.push({
        id: newProvId(),
        source: "TOOL_RESULT",
        toolCallId: p.toolCallId,
        toolName: toolNameByCallId.get(p.toolCallId) ?? "unknown", // loop.ts: audit?.toolName ?? "unknown" 同口径
        outputPath: p.outputPath,
      });
    }
    blocks = parsed.data.blocks;
  } else {
    // 软收尾（无 final_answer）：最后文本兜底，provenance 空 = 诚实 NO_ANSWER 不编造溯源。
    blocks = [{ type: "text", markdown: lastAssistantText(events) || "（探索模式未能产出回答）" }];
  }

  const policy = opts.governance?.provenancePolicy ?? "best_effort";
  if (policy === "required" && provenance.length === 0) {
    return { ok: false, errors: ["Skill provenancePolicy=required：final_answer 必须包含 provenance"] };
  }
  if (opts.governance?.writeMode && !blocks.some((b) => b.type === "action_draft")) {
    return { ok: false, errors: ["挂载的 Skill 为 WRITE/审批类型，final_answer 必须包含 action_draft 块"] };
  }

  return {
    ok: true,
    outcome,
    answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: scanBlocks(blocks) },
    sketch,
    ...(outcome === "BUDGET_EXHAUSTED" ? { degraded: { reason: "BUDGET_EXHAUSTED" as const } } : {}),
  };
}

// ---------------------------------------------------------------------------
// SSE 桥（E6 三档 verdict 的可重建档）：dsh 帧 → query-task SSE 事件增量。
// 返回 undefined = 该帧不产生 SSE 事件（answer.final/task.failed 由 runner 在 turn/end 时
// 用重组装结果发，不走逐帧映射——载荷要完整 Answer）。
// ---------------------------------------------------------------------------

export interface SseEmission {
  event: string;
  payload: Record<string, unknown>;
}

export function mapDshEventToSse(e: DshSessionEvent): SseEmission | undefined {
  const d = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
  switch (e.type) {
    case "tool/call": {
      // loop.ts:844 同形：stepId = toolCallId，type = 工具名
      const first = collectToolCalls([e])[0];
      return first
        ? { event: "step.started", payload: { stepId: first.toolCallId, type: first.name } }
        : undefined;
    }
    case "tool/result": {
      const message = d.message as { content?: { type?: string; toolCallId?: string; isError?: boolean }[] } | undefined;
      const tr = (message?.content ?? []).find((b) => b?.type === "tool-result");
      if (!tr) return undefined;
      return { event: "step.completed", payload: { stepId: tr.toolCallId, status: tr.isError ? "ERROR" : "OK" } };
    }
    case "assistant/chunk": {
      // E6：narration 可映射 assistant/chunk 文本帧。帧形 {turn, step, chunk}，
      // chunk 是原始 LLM chunk（text-delta 才带文本）。
      const chunk = d.chunk as { type?: string; text?: string } | undefined;
      const text = chunk?.type === "text-delta" ? chunk.text : undefined;
      return text ? { event: "step.completed", payload: { stepId: `narration-${d.turn ?? 0}-${d.step ?? 0}`, type: "agent_narration", text } } : undefined;
    }
    default:
      return undefined;
  }
}
