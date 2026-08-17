/**
 * WO-DSH-POC-S3 · dsh session.event 帧流 → 我方 Answer/SSE 的**纯重组装**（零 IO）。
 *
 * 输入是 JSON-RPC wire 上 session.event 通知里的 event 帧（已序列化过一遭的普通 JSON），
 * 输出对齐 runAgentLoop 的 Answer 组装语义（agent/loop.ts）：
 *   - final_answer 调用 ⇒ blocks/provenance 严格校验（AnswerBlockSchema 单校验点），
 *     provenance 的 toolName 从帧流里的 tool/call 记录回填（对位 loop.ts repos.toolCalls.get）；
 *   - 无 final_answer ⇒ 软收尾：最后一条 assistant/message 文本兜底（对位 lastText 分支）；
 *   - turn/end reason: completed→ANSWERED · max-tokens→BUDGET_EXHAUSTED · error/aborted→FAILED；
 *   - aborted 且 cause.kind==='stall-loop'（N3 watchdog cancel 落帧）⇒ 分类前置：
 *     BUDGET_EXHAUSTED + degraded{STALL_LOOP} + 诚实降级块（镜像 loop.ts:620-632），
 *     先于 expectsSchema/final_answer 分支（degrade 短路语义）；
 *   - expectsSchema 模式 ⇒ structured = final_answer raw input（对位 loop.ts:256）。
 *
 * WO-DSH-N2 · SSE 桥映射表（createSseMapper，既有三分支逐字节不动 + 四增补）：
 *   tool/call              → step.started  {stepId=callId, type=name}        （meta 工具 skip，见下）
 *   tool/result            → step.completed{stepId, status: OK|ERROR}        （meta 查集 skip）
 *   assistant/chunk text-delta      → step.completed{stepId:narration-<t>-<s>, type:agent_narration, text}
 *   assistant/chunk reasoning-delta → step.completed{stepId:think-<t>-<s>-<i>, type:agent_think, text}（N2·D-1 流式透传）
 *   compaction/start       → step.started  {stepId:compaction-<id>, type:compaction}（N2·D-4）
 *   compaction/summary     → step.completed{同 stepId, type:compaction, text:已压缩 N 条/约 M tokens}
 *   compaction/end         → step.completed{同 stepId, type:compaction, outcome:OK|ERROR(error 时 text=原文)}
 *   usage/finish/block-start/block-end/tool-call-delta/turn/end/assistant/message/command/* → 不逐帧映射
 *   meta 工具（final_answer/load_skill）：tool/call skip 并记 callId 集，tool/result 查集 skip（D-7·对齐 loop.ts:1146 口径）
 * 红线：finish 帧的 replayState（adapter-private）**绝不外发**——finish 不映射，stats 不含其任何字段。
 * N2·D-2：统计走 reassembleDshRun 的 additive stats 键（纯 fold，口径=dsh-session-stats/token-meter
 * 投影语义）；零 usage 帧 ⇒ stats 键整体不出（诚实缺省）。projectedTokens/contextWindow 帧流无源，不自封。
 */

import { AnswerBlockSchema, type Answer, type AnswerBlock, type ProvenanceRef } from "@platform/contracts";
import { z } from "zod";
import { scanBlocks } from "../util/numerics.js";
import { newId } from "../ids.js";

// ---- dsh 帧的窄本地类型（只声明重组装消费的字段；wire 上还有更多字段，宽容忽略） ----

export interface DshSessionEvent {
  type: string;
  /** N2 additive：帧序号/主机打戳 ms（wire 全字段帧自带；stats fold 的时间源）。 */
  seq?: number;
  time?: number;
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
      degraded?: { reason: "TIMEOUT" | "BUDGET_EXHAUSTED" | "STALL_LOOP" };
      /** N2·D-2 additive：帧流纯 fold 统计（零 usage 帧 ⇒ 键整体不出·诚实缺省）。 */
      stats?: DshRunStats;
    }
  | { ok: false; errors: string[] };

/** N2·D-2 · stats 三键（与 dsh host projections.values 同形子集；oracle 对账见 A2）。 */
export interface DshRunStats {
  /** dsh-session-stats projection 口径（lib/types/projection.d.ts：step/end 是步计数权威）。 */
  sessionStats: {
    turns: number;
    steps: number;
    llmMs: number;
    toolMs: number;
    ttftMs: number;
    ttftSteps: number;
    decodeMs: number;
    decodeTokens: number;
  };
  /** dsh-token-meter TokenUsageProjection：四桶 DISJOINT，Σ 全部 usage 块。 */
  tokenUsage: {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  /** 仅 pressureTokens（=末 usage 块 in+cacheRead+cacheWrite）；projectedTokens/contextWindow 帧流无源不出。 */
  contextPressure?: { pressureTokens: number };
}

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

// ---------------------------------------------------------------------------
// N3 · stall-loop 分类器（watchdog cancel 落帧 ⇒ STALL_LOOP 诚实降级重建）。
// 帧形实证（dsh-agent-loop index.js:575-580/592-595）：cancel(cause) → abort signal →
// turn/end data.reason = {kind:'aborted', reason:<cause 原样>}；watchdog 的 cause =
// {kind:'stall-loop', tool, count, cap}（纯 JSON，过 session lossless-JSON 校验）。
// ---------------------------------------------------------------------------

export interface StallLoopCause {
  kind: "stall-loop";
  tool?: string;
  count?: number;
  cap?: number;
}

/** 最后一个 turn/end 若为 stall-loop abort 则返回其 cause；否则 undefined（普通 aborted/error 不误吞）。 */
export function stallLoopCause(events: readonly DshSessionEvent[]): StallLoopCause | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== "turn/end") continue;
    const reason = (e.data as Record<string, unknown> | undefined)?.reason;
    if (typeof reason !== "object" || reason === null) return undefined;
    if ((reason as Record<string, unknown>).kind !== "aborted") return undefined;
    const inner = (reason as Record<string, unknown>).reason;
    if (typeof inner !== "object" || inner === null) return undefined;
    if ((inner as Record<string, unknown>).kind !== "stall-loop") return undefined;
    return inner as StallLoopCause;
  }
  return undefined;
}

/** tool/result 帧的窄提取（成功判定仅供 stall-loop 诚实块的 provenance）。 */
function successfulCallIds(events: readonly DshSessionEvent[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== "tool/result" || typeof e.data !== "object" || e.data === null) continue;
    const message = (e.data as Record<string, unknown>).message as
      | { content?: { type?: string; toolCallId?: string; isError?: boolean }[] }
      | undefined;
    for (const b of message?.content ?? []) {
      if (b?.type !== "tool-result" || typeof b.toolCallId !== "string") continue;
      if (b.isError === true || seen.has(b.toolCallId)) continue;
      seen.add(b.toolCallId);
      out.push(b.toolCallId);
    }
  }
  return out;
}

/**
 * G-9 部分发现合成 · 镜像 loop.ts:588-604 synthesizePartialFindings 同口径
 * （只复述工具查到什么，不下结论、不造数）：优先末次 assistant 文本，否则 sketch 去重复述，
 * 再退固定兜底。reassemble 侧无 rollingNotes（dsh 帧流无对应物）——该档如实缺失。
 */
function synthesizePartialFindings(
  events: readonly DshSessionEvent[],
  sketch: { toolName: string; inputSummary: string }[],
): string {
  const lastText = lastAssistantText(events);
  if (lastText.trim()) return lastText;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const s of sketch) {
    const key = `${s.toolName}｜${s.inputSummary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- 调用 ${s.toolName}（入参 ${s.inputSummary}）`);
  }
  if (lines.length === 0) return "（探索过程中未取得可复述的工具结果）";
  return `已探索线索（仅复述调用轨迹，未形成最终结论）：\n${lines.join("\n")}`;
}

/**
 * N2·D-2 · 帧流纯 fold → stats（口径与 dsh-session-stats / dsh-token-meter 投影逐条对齐，
 * hist-multihop 763 帧机器复算全等，A2 以夹具 projections.values 为独立 oracle 对账）：
 *   steps=step/end 计数（步生命周期权威）；turns=有闭合步的去重 turn 数；
 *   llmMs=Σ(message.time−step/start.time · 有 message 的步)；
 *   ttftMs=Σ(首个非空 delta.time−step/start.time)，ttftSteps=有首 token 的步数；
 *   decodeMs=Σ(message.time−首 token.time · 有 usage 的步)，decodeTokens=同域 Σ outputTokens；
 *   toolMs=Σ(result.time−call.time 按 callId 配对)；
 *   tokenUsage=Σ usage 块四桶（DISJOINT，cacheWrite 缺省 0）；
 *   contextPressure.pressureTokens=末 usage 块 in+cacheRead+cacheWrite。
 * 缺 time 的帧对应时间量不计（与 dsh cancelled step 同构）；零 usage 帧 ⇒ undefined（诚实缺省）。
 */
export function foldDshRunStats(events: readonly DshSessionEvent[]): DshRunStats | undefined {
  const stepStart = new Map<string, number>();
  const messageTime = new Map<string, number>();
  const firstTokenTime = new Map<string, number>();
  const stepOutputTokens = new Map<string, number>();
  const pendingCalls = new Map<string, number>();
  const turnsWithClosedStep = new Set<number>();
  let steps = 0;
  let toolMs = 0;
  const tokenUsage = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let lastUsage: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined;
  let sawUsage = false;

  for (const e of events) {
    const d = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
    const key = `${d.turn ?? 0}-${d.step ?? 0}`;
    switch (e.type) {
      case "step/start":
        if (typeof e.time === "number") stepStart.set(key, e.time);
        break;
      case "step/end":
        steps += 1;
        turnsWithClosedStep.add(typeof d.turn === "number" ? d.turn : 0);
        break;
      case "assistant/message":
        if (typeof e.time === "number") messageTime.set(key, e.time);
        break;
      case "assistant/chunk": {
        const chunk = d.chunk as { type?: string; text?: string; usage?: Record<string, unknown> } | undefined;
        if (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") {
          if (chunk.text && typeof e.time === "number" && !firstTokenTime.has(key)) firstTokenTime.set(key, e.time);
        } else if (chunk?.type === "usage") {
          const u = (chunk.usage ?? {}) as Record<string, unknown>;
          const num = (v: unknown): number => (typeof v === "number" ? v : 0);
          sawUsage = true;
          tokenUsage.uncachedInputTokens += num(u.inputTokens);
          tokenUsage.outputTokens += num(u.outputTokens);
          tokenUsage.cacheReadTokens += num(u.cacheReadTokens);
          tokenUsage.cacheWriteTokens += num(u.cacheWriteTokens);
          stepOutputTokens.set(key, (stepOutputTokens.get(key) ?? 0) + num(u.outputTokens));
          lastUsage = u;
        }
        break;
      }
      case "tool/call":
        if (typeof d.callId === "string" && typeof e.time === "number") pendingCalls.set(d.callId, e.time);
        break;
      case "tool/result": {
        const message = d.message as { content?: { type?: string; toolCallId?: string }[] } | undefined;
        const tr = (message?.content ?? []).find((b) => b?.type === "tool-result");
        const callId = tr?.toolCallId;
        if (callId !== undefined && pendingCalls.has(callId) && typeof e.time === "number") {
          toolMs += e.time - pendingCalls.get(callId)!;
          pendingCalls.delete(callId);
        }
        break;
      }
      default:
        break;
    }
  }

  if (!sawUsage) return undefined;

  let llmMs = 0;
  for (const [k, mt] of messageTime) {
    const st = stepStart.get(k);
    if (st !== undefined) llmMs += mt - st;
  }
  let ttftMs = 0;
  let ttftSteps = 0;
  for (const [k, ft] of firstTokenTime) {
    const st = stepStart.get(k);
    if (st !== undefined) {
      ttftMs += ft - st;
      ttftSteps += 1;
    }
  }
  let decodeMs = 0;
  let decodeTokens = 0;
  for (const [k, out] of stepOutputTokens) {
    const mt = messageTime.get(k);
    const ft = firstTokenTime.get(k);
    if (mt !== undefined && ft !== undefined) {
      decodeMs += mt - ft;
      decodeTokens += out;
    }
  }

  return {
    sessionStats: {
      turns: turnsWithClosedStep.size,
      steps,
      llmMs,
      toolMs,
      ttftMs,
      ttftSteps,
      decodeMs,
      decodeTokens,
    },
    tokenUsage,
    ...(lastUsage
      ? {
          contextPressure: {
            pressureTokens:
              (typeof lastUsage.inputTokens === "number" ? lastUsage.inputTokens : 0) +
              (typeof lastUsage.cacheReadTokens === "number" ? lastUsage.cacheReadTokens : 0) +
              (typeof lastUsage.cacheWriteTokens === "number" ? lastUsage.cacheWriteTokens : 0),
          },
        }
      : {}),
  };
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

  // N3 · stall-loop 分类前置（degrade 短路语义，先于 expectsSchema/final_answer 分支）：
  // watchdog cancel 落帧 ⇒ outcome BUDGET_EXHAUSTED + degraded{STALL_LOOP}（对位 loop.ts:1182）
  // + 诚实降级块（header 模板镜像 loop.ts:620-632，cap 从帧 cause 取——reassemble 保纯不读 env）
  // + provenance 仅成功 callId 去重 outputPath "$"（loop.ts:644-656 同口径；失败/未答调用不进）。
  const stall = stallLoopCause(events);
  if (stall) {
    const budgetNote = `反复以相同参数调用同一工具、未获新信息（环检测·loopRepeatCap=${stall.cap ?? "?"}）`;
    const header = `[预算耗尽·诚实摘要] ⚠️ 检测到无进度循环：${budgetNote}——本次深问未能完全解答（已诚实终止，未烧尽预算）。以下为已探索到的线索：`;
    const blocks: AnswerBlock[] = [
      { type: "text", markdown: header },
      { type: "text", markdown: synthesizePartialFindings(events, sketch) },
    ];
    const provenance: ProvenanceRef[] = successfulCallIds(events).map((toolCallId) => ({
      id: newProvId(),
      source: "TOOL_RESULT",
      toolCallId,
      toolName: toolNameByCallId.get(toolCallId) ?? "unknown",
      outputPath: "$",
    }));
    return {
      ok: true,
      outcome: "BUDGET_EXHAUSTED",
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: scanBlocks(blocks) },
      sketch,
      degraded: { reason: "STALL_LOOP" },
    };
  }

  // N2·D-2：stats 纯 fold（零 usage ⇒ undefined ⇒ 键不出）；失败路径（ok:false）不造。
  const stats = foldDshRunStats(events);

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
      ...(stats ? { stats } : {}),
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
    ...(stats ? { stats } : {}),
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

/** loop.ts:1146 同口径：元工具不进 sketch，也不进 SSE 桥（D-7）。 */
const META_TOOL_NAMES = new Set(["final_answer", "load_skill"]);

/**
 * N2·D-7 · SSE 桥工厂（原 mapDshEventToSse 纯函数 → 工厂持态版）。
 * 内持 meta callId 集：tool/call 遇 meta 工具（final_answer/load_skill）skip 并记集，
 * tool/result 查集 skip——meta 帧不上 SSE 面（native loop 也不为它们发 step 事件）。
 * 既有三映射分支（tool/call·tool/result·text-delta）逐字节不动（POC toEqual 锚定即闸）。
 */
export function createSseMapper(): (e: DshSessionEvent) => SseEmission | undefined {
  const metaCallIds = new Set<string>();
  return (e: DshSessionEvent): SseEmission | undefined => {
    const d = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
    switch (e.type) {
      case "tool/call": {
        // loop.ts:844 同形：stepId = toolCallId，type = 工具名
        const first = collectToolCalls([e])[0];
        if (!first) return undefined;
        if (META_TOOL_NAMES.has(first.name)) {
          metaCallIds.add(first.toolCallId);
          return undefined;
        }
        return { event: "step.started", payload: { stepId: first.toolCallId, type: first.name } };
      }
      case "tool/result": {
        const message = d.message as { content?: { type?: string; toolCallId?: string; isError?: boolean }[] } | undefined;
        const tr = (message?.content ?? []).find((b) => b?.type === "tool-result");
        if (!tr) return undefined;
        if (tr.toolCallId !== undefined && metaCallIds.has(tr.toolCallId)) return undefined;
        return { event: "step.completed", payload: { stepId: tr.toolCallId, status: tr.isError ? "ERROR" : "OK" } };
      }
      case "assistant/chunk": {
        // E6：narration 可映射 assistant/chunk 文本帧。帧形 {turn, step, chunk}，
        // chunk 是原始 LLM chunk（text-delta 才带文本）。
        const chunk = d.chunk as { type?: string; index?: number; text?: string } | undefined;
        // N2·D-1：reasoning-delta 逐 delta 流式透传（与 text-delta 同构；stepId 带 index 防多块互覆）。
        if (chunk?.type === "reasoning-delta") {
          const think = chunk.text;
          return think
            ? { event: "step.completed", payload: { stepId: `think-${d.turn ?? 0}-${d.step ?? 0}-${chunk.index ?? 0}`, type: "agent_think", text: think } }
            : undefined;
        }
        const text = chunk?.type === "text-delta" ? chunk.text : undefined;
        return text ? { event: "step.completed", payload: { stepId: `narration-${d.turn ?? 0}-${d.step ?? 0}`, type: "agent_narration", text } } : undefined;
      }
      // N2·D-4：compaction 伪步对（selectStepRows 按 stepId fold 三帧合一行）。command/run|done 不映射。
      case "compaction/start": {
        const id = typeof d.compactionId === "string" ? d.compactionId : "unknown";
        return { event: "step.started", payload: { stepId: `compaction-${id}`, type: "compaction" } };
      }
      case "compaction/summary": {
        const id = typeof d.compactionId === "string" ? d.compactionId : "unknown";
        const n = Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : 0;
        const tokens = typeof d.shadowedTokenCount === "number" ? d.shadowedTokenCount : 0;
        return { event: "step.completed", payload: { stepId: `compaction-${id}`, type: "compaction", text: `已压缩 ${n} 条/约 ${tokens} tokens` } };
      }
      case "compaction/end": {
        const id = typeof d.compactionId === "string" ? d.compactionId : "unknown";
        const error = typeof d.error === "string" && d.error ? d.error : undefined;
        // error 原文逐字透传（PRD §5.1 不顶替）；无 summary ⇒ 零「已压缩」文本。
        return {
          event: "step.completed",
          payload: { stepId: `compaction-${id}`, type: "compaction", outcome: error ? "ERROR" : "OK", ...(error ? { text: error } : {}) },
        };
      }
      default:
        return undefined;
    }
  };
}
