/**
 * dshFrameAdapter —— dsh 帧 / QOS SSE 帧 → 内部 ChatEvent 的适配层（纯函数，零 IO）。
 *
 * 移植自：
 *  - isSurfaceEvent / isAppendSurfaceEvent：dsh-client-runtime/lib/client.js:10235-10252
 *    （SURFACE_EVENT_TYPES = user/message、assistant/message、tool/result 三类，
 *      表面类事件须 surfaceOp==='append' 才进转写面；replace 复本只服务模型视角，丢弃）
 *  - 其余帧型（chunk、tool/call、step/* 等）无 surfaceOp 字段、无条件放行
 *    （夹具实证：multihop 763 帧中 748 帧无 surfaceOp、15 帧 append、0 帧 replace）
 *
 * 双入口：
 *  - adaptDshFrame(s)：原始 dsh 帧（黄金流直喂）
 *  - adaptSseEvent(s)：QOS SSE 伪步流（POC reassemble.ts:187-205 映射的逆运算：
 *    tool/call→step.started{stepId=callId,type=name}、tool/result→step.completed、
 *    text-delta→step.completed{type:agent_narration}；agent_degraded/compaction 走
 *    orchestrator.ts:2177-2184 既有 G-9 伪步逃生舱，不新增事件名）
 *
 * N2→N6 跨单契约（n2-plan-full.md D-1/D-2/D-4/D-5，wire 字节级示例见其 29-33 行）：
 *  - D-1 agent_think：step.completed{stepId:"think-<turn>-<step>-<chunk.index>",type:"agent_think",text}
 *    → reasoning-delta chunk（index 从 stepId 解析，多块不互覆）；
 *  - D-4 compaction 伪步对：step.started{type:"compaction"} → compaction-start；
 *    step.completed{text:"已压缩 N 条/约 M tokens"}（无 outcome）→ compaction-summary；
 *    step.completed{outcome:OK|ERROR,error时text=error原文} → compaction-end；
 *  - D-5 键名换算：POC tool/result 映射用 status 键（selectStepRows 读 outcome 的现存缺陷），
 *    isError 判定 outcome/status 双键都认，在本适配层消化；
 *  - narration 落位：wire stepId=narration-<turn>-<step> 无 index（POC 简化），
 *    夹具实证每步布局 reasoning@0/text@1，硬编码 index 0 会覆写 reasoning——
 *    adaptSseEvents 按「该 (turn,step) 已见 max think index + 1」赋位（适配层推断，标注）。
 */
import type { StreamEvent } from "@/sse/taskStreamReducer";

/** 原始 dsh 帧包络（hist-*.json events[].event 实证键） */
export interface DshFrame {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  surfaceOp?: string;
}

/** dsh chunk 子型（assistant/chunk data.chunk 实证） */
export interface DshChunk {
  type: string;
  index?: number;
  blockType?: string;
  text?: string;
  id?: string | number;
  name?: string;
  argumentsDelta?: string;
  block?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  reason?: unknown;
}

/** 线侧 content 块（assistant/message content / block-end chunk.block） */
export type WireBlock = Record<string, unknown>;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * 内部归一事件（chatFlowProjection 的 fold 输入）。
 * 两种入口产出同一 union，投影函数不感知来源（A16 双粒度兼容的结构基础）。
 */
export type ChatEvent =
  | { kind: "step-start"; turn: number; step: number; seq: number; time: number }
  | { kind: "step-end"; turn: number; step: number; seq: number; time: number }
  | { kind: "turn-end"; turn: number; seq: number; time: number; reasonKind?: string }
  | { kind: "chunk"; turn: number; step: number; seq: number; time: number; chunk: DshChunk; honesty?: HonestyPatch }
  | {
      kind: "assistant-message";
      turn: number;
      step: number;
      seq: number;
      time: number;
      messageId?: string;
      content: WireBlock[];
      usage?: Usage;
      honesty?: HonestyPatch;
    }
  | { kind: "llm-retry"; turn: number; step: number; seq: number; time: number }
  | { kind: "tool-call"; callId: string; name: string; argsRaw: string; turn: number; step: number; seq: number; time: number }
  | {
      kind: "tool-result";
      callId: string;
      seq: number;
      time: number;
      content: unknown[];
      isError: boolean;
      meta?: unknown;
      error?: unknown;
    }
  | {
      kind: "code-dispatch-start";
      rootCallId: string;
      parentCallId: string;
      subCallId: string;
      name: string;
      argsRaw: string;
      seq: number;
      time: number;
    }
  | {
      kind: "code-dispatch";
      rootCallId: string;
      parentCallId: string;
      subCallId: string;
      name: string;
      argsRaw: string;
      content: unknown[];
      isError: boolean;
      seq: number;
      time: number;
    }
  | { kind: "user-message"; seq: number; time: number; text: string }
  | { kind: "notice"; seq: number; time: number; reason: string }
  | { kind: "command-run"; seq: number; time: number; commandId: string; name: string }
  | { kind: "command-done"; seq: number; time: number; commandId: string; doneKind: string; text?: string }
  | { kind: "compaction-start"; seq: number; time: number; compactionId: string; sourceCommandId?: string }
  | { kind: "compaction-summary"; seq: number; time: number; compactionId: string; text: string }
  | { kind: "compaction-end"; seq: number; time: number; compactionId: string; error?: string };

/** 诚实层补丁（additive；undefined 整格不出，照 Timeline「有才显示」成例） */
export interface HonestyPatch {
  scope?: string;
  degradedReason?: string;
  provenance?: unknown;
}

/* ------------------------------ surface 分流 ------------------------------ */

/** 与 dsh SURFACE_EVENT_TYPES 逐字一致（runtime client.js:10225-10229） */
export const SURFACE_EVENT_TYPES: ReadonlySet<string> = new Set(["user/message", "assistant/message", "tool/result"]);

export function isSurfaceEvent(frame: DshFrame): boolean {
  if (!SURFACE_EVENT_TYPES.has(frame.type)) return false;
  return frame.surfaceOp !== undefined;
}

/**
 * 仅 append 起源的表面事件进转写面：replace 复本是模型视角的遮蔽拷贝，
 * 进转写面会抹掉用户已见过的对话（dsh 原注释语义保留）。
 */
export function isAppendSurfaceEvent(frame: DshFrame): boolean {
  return isSurfaceEvent(frame) && frame.surfaceOp === "append";
}

/** 转写面门槛：表面类事件须 append；其余帧型无条件放行 */
export function isTranscriptFrame(frame: DshFrame): boolean {
  if (SURFACE_EVENT_TYPES.has(frame.type)) return isAppendSurfaceEvent(frame);
  return true;
}

/* ------------------------------ dsh 帧入口 ------------------------------ */

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/** dsh 帧 → 内部事件；不映射（观测帧/被分流丢弃）返回 null */
export function adaptDshFrame(frame: DshFrame): ChatEvent | null {
  if (!isTranscriptFrame(frame)) return null;
  const { seq, time } = frame;
  const d = frame.data;
  switch (frame.type) {
    case "step/start":
      return { kind: "step-start", turn: num(d.turn), step: num(d.step), seq, time };
    case "step/end":
      return { kind: "step-end", turn: num(d.turn), step: num(d.step), seq, time };
    case "turn/end":
      return { kind: "turn-end", turn: num(d.turn), seq, time, reasonKind: (d.reason as { kind?: string } | undefined)?.kind };
    case "assistant/chunk":
      return { kind: "chunk", turn: num(d.turn), step: num(d.step), seq, time, chunk: d.chunk as DshChunk };
    case "assistant/message": {
      const message = d.message as { id?: string; content?: WireBlock[] };
      return {
        kind: "assistant-message",
        turn: num(d.turn),
        step: num(d.step),
        seq,
        time,
        messageId: message.id,
        content: message.content ?? [],
        usage: d.usage as Usage | undefined,
      };
    }
    case "llm/retry":
      return { kind: "llm-retry", turn: num(d.turn), step: num(d.step), seq, time };
    case "tool/call":
      return {
        kind: "tool-call",
        callId: String(d.callId),
        name: String(d.name),
        argsRaw: String(d.arguments ?? ""),
        turn: num(d.turn),
        step: num(d.step),
        seq,
        time,
      };
    case "tool/result": {
      const message = d.message as { source?: { callId?: unknown }; content?: { content?: unknown[]; isError?: boolean }[] };
      const result = message.content?.[0];
      return {
        kind: "tool-result",
        callId: String(message.source?.callId ?? ""),
        seq,
        time,
        content: result?.content ?? [],
        isError: result?.isError === true,
        ...(d.error === undefined ? {} : { error: d.error }),
        ...(d.meta === undefined ? {} : { meta: d.meta }),
      };
    }
    case "tool/code-dispatch-start":
    case "tool/code-dispatch": {
      // 与 toolDefinition.match 一致：rootCallId 须为非空字符串，否则不挂树
      const rootCallId = d.rootCallId;
      if (typeof rootCallId !== "string" || rootCallId === "") return null;
      const base = {
        rootCallId,
        parentCallId: String(d.parentCallId),
        subCallId: String(d.subCallId),
        name: String(d.name),
        argsRaw: JSON.stringify(d.arguments),
        seq,
        time,
      };
      if (frame.type === "tool/code-dispatch-start") return { kind: "code-dispatch-start", ...base };
      return { kind: "code-dispatch", ...base, content: (d.content as unknown[]) ?? [], isError: d.isError === true };
    }
    case "user/message": {
      const content = (d.content as { type?: string; text?: string }[] | undefined) ?? [];
      const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      return { kind: "user-message", seq, time, text };
    }
    case "command/run":
      return { kind: "command-run", seq, time, commandId: String(d.commandId), name: String(d.name) };
    case "command/done":
      return {
        kind: "command-done",
        seq,
        time,
        commandId: String(d.commandId),
        doneKind: String(d.kind),
        ...(d.text === undefined ? {} : { text: String(d.text) }),
      };
    case "compaction/start":
      return {
        kind: "compaction-start",
        seq,
        time,
        compactionId: String(d.compactionId),
        ...(d.sourceCommandId === undefined ? {} : { sourceCommandId: String(d.sourceCommandId) }),
      };
    case "compaction/end":
      return {
        kind: "compaction-end",
        seq,
        time,
        compactionId: String(d.compactionId),
        ...(d.error === undefined ? {} : { error: String(d.error) }),
      };
    default:
      // 观测帧（session/*、request/*、permission/*、sandbox/*、approval/*、agent/inbox/* 等）不映射
      return null;
  }
}

export function adaptDshFrames(frames: DshFrame[]): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const f of frames) {
    const ev = adaptDshFrame(f);
    if (ev !== null) out.push(ev);
  }
  return out;
}

/* ------------------------------ QOS SSE 入口 ------------------------------ */

/**
 * 我方 WORKFLOW 路径既有步骤类型（Timeline.tsx STEP_ICONS 同款清单）：
 * 这些 step.started/completed 是工作流行，不进会话流；其余 stepId=callId 的
 * 伪步按 POC 映射逆运算还原为 tool-call/tool-result。
 */
const WORKFLOW_STEP_TYPES: ReadonlySet<string> = new Set([
  "resolve_slice",
  "query_objects",
  "invoke_solver",
  "evaluate_rules",
  "llm_compose",
  "render_answer",
  "create_action_draft",
  "invoke_agent",
  "invoke_mcp_tool",
  "tool_call",
]);

/** WORKFLOW 路径既有步骤类型判定（Timeline 分栏与适配器共用同一清单） */
export function isWorkflowStepType(type: string): boolean {
  return WORKFLOW_STEP_TYPES.has(type);
}

const NARRATION_RE = /^narration-(\d+)-(\d+)$/;
/** N2 D-1：think-<turn>-<step>-<chunk.index>（index 在 stepId 内，协议允许多 reasoning 块/步） */
const THINK_RE = /^think-(\d+)-(\d+)-(\d+)$/;

/** compaction 伪步 stepId="compaction-<id>" → 内部 compactionId（前缀剥离） */
const compactionIdOf = (stepId: unknown): string => {
  const s = String(stepId ?? "");
  return s.startsWith("compaction-") ? s.slice("compaction-".length) : s;
};

/**
 * QOS SSE 事件 → 内部事件（不映射返回 null）。
 * SSE 帧无 seq：按到达序赋递增序号，投影排序键同源一致。
 * narrationIndex：agent_narration 落位（wire 无 index，调用方按 max think index + 1 赋）。
 */
export function adaptSseEvent(frame: StreamEvent, seq: number, narrationIndex?: number): ChatEvent | null {
  const d = frame.data;
  const time = seq;
  switch (frame.event) {
    case "step.started": {
      const type = String(d.type ?? "");
      if (type === "compaction") return { kind: "compaction-start", seq, time, compactionId: compactionIdOf(d.stepId) };
      if (type === "" || WORKFLOW_STEP_TYPES.has(type)) return null;
      return {
        kind: "tool-call",
        callId: String(d.stepId),
        name: type,
        argsRaw: typeof d.arguments === "string" ? d.arguments : d.arguments === undefined ? "" : JSON.stringify(d.arguments),
        turn: 0,
        step: 0,
        seq,
        time,
      };
    }
    case "step.completed": {
      const type = String(d.type ?? "");
      if (type === "agent_think") {
        // N2 D-1：逐 delta 透传，index 从 stepId 解析（多块 reasoning 不互覆）
        const m = THINK_RE.exec(String(d.stepId ?? ""));
        const turn = m ? Number(m[1]) : 0;
        const step = m ? Number(m[2]) : 0;
        const index = m ? Number(m[3]) : 0;
        return {
          kind: "chunk",
          turn,
          step,
          seq,
          time,
          chunk: { type: "reasoning-delta", index, text: String(d.text ?? "") },
          ...(d.honesty === undefined ? {} : { honesty: d.honesty as HonestyPatch }),
        };
      }
      if (type === "agent_narration") {
        // 逐 delta 与整块两种粒度都正确：统一按 text-delta 累积（单块即整文）
        const m = NARRATION_RE.exec(String(d.stepId ?? ""));
        const turn = m ? Number(m[1]) : 0;
        const step = m ? Number(m[2]) : 0;
        return {
          kind: "chunk",
          turn,
          step,
          seq,
          time,
          chunk: { type: "text-delta", index: narrationIndex ?? 0, text: String(d.text ?? "") },
          ...(d.honesty === undefined ? {} : { honesty: d.honesty as HonestyPatch }),
        };
      }
      if (type === "agent_degraded") {
        // G-9 逃生舱伪步：reason=outcome 原值逐字，不顶替不改写
        return { kind: "notice", seq, time, reason: String(d.outcome ?? "") };
      }
      if (type === "compaction") {
        // N2 D-4：summary 文本帧（无 outcome）与 outcome 收尾帧分离
        const compactionId = compactionIdOf(d.stepId);
        if (d.outcome === undefined) {
          return { kind: "compaction-summary", seq, time, compactionId, text: String(d.text ?? "") };
        }
        const failed = d.outcome === "ERROR" || d.outcome === "FAILED";
        return {
          kind: "compaction-end",
          seq,
          time,
          compactionId,
          ...(failed ? { error: String(d.text ?? "") } : {}),
        };
      }
      if (type === "" || WORKFLOW_STEP_TYPES.has(type)) return null;
      return {
        kind: "tool-result",
        callId: String(d.stepId),
        seq,
        time,
        content: d.text === undefined ? [] : [{ type: "text", text: String(d.text) }],
        // D-5 键名换算：POC 用 status、native 用 outcome，双键都认（登记缺陷在适配层消化）
        isError: d.outcome === "ERROR" || d.outcome === "FAILED" || d.status === "ERROR" || d.status === "FAILED",
      };
    }
    default:
      return null;
  }
}

export function adaptSseEvents(events: StreamEvent[]): ChatEvent[] {
  const out: ChatEvent[] = [];
  // narration 落位状态：每 (turn,step) 已见 max think index（wire narration 无 index，见头注）
  const thinkMaxIndex = new Map<string, number>();
  let seq = 0;
  for (const e of events) {
    const d = e.data;
    let narrationIndex: number | undefined;
    if (e.event === "step.completed" && d.type === "agent_narration") {
      const m = NARRATION_RE.exec(String(d.stepId ?? ""));
      const key = `${m ? m[1] : "0"}:${m ? m[2] : "0"}`;
      narrationIndex = (thinkMaxIndex.get(key) ?? -1) + 1;
    }
    const ev = adaptSseEvent(e, ++seq, narrationIndex);
    if (ev !== null) {
      if (ev.kind === "chunk" && ev.chunk.type === "reasoning-delta") {
        const key = `${ev.turn}:${ev.step}`;
        thinkMaxIndex.set(key, Math.max(thinkMaxIndex.get(key) ?? -1, ev.chunk.index ?? 0));
      }
      out.push(ev);
    }
  }
  return out;
}
