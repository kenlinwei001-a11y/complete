/**
 * chatFlowProjection —— ChatEvent 日志 → 会话流节点投影（纯函数，零 IO，
 * 与 selectStepRows 同构的 selector 形态；reducer 维持 append-only 不动）。
 *
 * 逐函数移植自 dsh-client-ui-conversation/lib/client.js（行号=bundle 行号）：
 *  - initialState(7221-7233) → initAssistantState
 *  - compactBlocks(7234-7236)/hasVisibleContent(7237-7243)/hasInterruptionEvidence(7244-7249) → 同名
 *  - resetForRetry(7250-7256) → 同名（retry 机制保留；黄金夹具无 llm/retry 帧，生产恒不触发）
 *  - updateChunk(7257-7318) → 同名，分支逐字：block-start/text-delta/reasoning-delta/
 *    tool-call-delta/block-end/usage + firstVisibleSeq/firstTokenTime 尾段(7306-7317)
 *  - finalNode(7323-7356，含 CHAT_SYNTHETIC_SEQ_OFFSETS 7184-7189) → finalAssistantNode
 *  - fallbackState$4(7357-7379) → 本文件 selectChatFlow 的 assistant fold（增量与回放共用一条纯 fold）
 *  - projectAssistant(7380-7403) → 同名（running/settled/interrupted 三态）
 *  - 工具树族 rootCall(8293-8305)/rootResult(8306-8327)/childCall(8328-8339)/childResult(8340-8357)/
 *    acceptsEdge(8364-8391, MAX_DEPTH=256)/updateDispatch(8392-8423)/projectBlock(8424-8466)/
 *    sameReferences(8467-8469)/interruption(8470-8474)/fallbackState$1(8475-8486) → 同名族
 *  - emptyAssistantBlock/toAssistantBlock/isTokenDelta（runtime 10314-10332/6892-6917/10346-10356）→ 内联移植
 *
 * 差异声明：dsh 侧 view/location 宿主概念（callView/resultView、locationTurn/locationStep）
 * 我方无对应物，callView/resultView 恒 null、turn/step 由帧数据直取——行为差异为空集（夹具无 view 帧）。
 */
import type { ChatEvent, DshChunk, HonestyPatch, Usage, WireBlock } from "./dshFrameAdapter";

/* ============================ 块模型（runtime 移植） ============================ */

export type AssistantBlock =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; callId: string; name: string; argsRaw: string }
  | { kind: "image"; attachment: unknown }
  | { kind: "other"; block: unknown };

/** emptyAssistantBlock(runtime:10314-10332) */
export function emptyAssistantBlock(blockType: string): AssistantBlock {
  switch (blockType) {
    case "text":
      return { kind: "text", text: "" };
    case "reasoning":
      return { kind: "reasoning", text: "" };
    case "tool-call":
      return { kind: "tool-call", callId: "", name: "", argsRaw: "" };
    default:
      return { kind: "other", block: null };
  }
}

/** toAssistantBlock(runtime:6892-6917)：ToolCallBlock 字段 id/arguments → callId/argsRaw */
export function toAssistantBlock(block: WireBlock): AssistantBlock {
  switch (block.type) {
    case "text":
      return { kind: "text", text: block.text as string };
    case "reasoning":
      return { kind: "reasoning", text: block.text as string };
    case "image":
      return { kind: "image", attachment: block.attachment };
    case "tool-call":
      return { kind: "tool-call", callId: String(block.id), name: block.name as string, argsRaw: block.arguments as string };
    default:
      return { kind: "other", block };
  }
}

/** toAssistantBlocks(runtime:6884-6886) */
export function toAssistantBlocks(content: WireBlock[]): AssistantBlock[] {
  return content.map(toAssistantBlock);
}

/** isTokenDelta(runtime:10346-10356)：空 delta（心跳/空 tool-call 帧）不算首 token */
export function isTokenDelta(chunk: DshChunk): boolean {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text !== "";
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== undefined;
    default:
      return false;
  }
}

/* ========================= assistant 状态机（7257-7403 移植） ========================= */

/** CHAT_SYNTHETIC_SEQ_OFFSETS(7184-7189) */
export const CHAT_SYNTHETIC_SEQ_OFFSETS = {
  interruptedAssistant: -0.9,
  interruptedFollowup: -0.8,
  maxTokensNotice: 0.05,
  finalizedFollowup: 0.1,
} as const;

export interface AssistantState {
  turn: number;
  step: number;
  blocks: (AssistantBlock | undefined)[];
  firstVisibleSeq?: number;
  firstVisibleTime?: number;
  firstTokenTime?: number;
  hidden: boolean;
  final?: { seq: number; time: number; messageId?: string; content: WireBlock[]; usage?: Usage };
  usage?: Usage;
  /** 诚实层补丁（additive，最后到达者优先；undefined 整格不出） */
  honesty?: HonestyPatch;
  /** step/start 到达时刻（finalNode.timing.stepStartTime 数据源） */
  startTime?: number;
}

/** initialState(7221-7233) */
export function initAssistantState(turn: number, step: number): AssistantState {
  return {
    turn,
    step,
    blocks: [],
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: undefined,
    hidden: false,
    final: undefined,
    usage: undefined,
  };
}

/** compactBlocks(7234-7236) */
export function compactBlocks(blocks: (AssistantBlock | undefined)[]): AssistantBlock[] {
  return blocks.filter((block): block is AssistantBlock => block !== undefined);
}

/** hasVisibleContent(7237-7243) */
export function hasVisibleContent(blocks: AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "tool-call") return false;
    if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
    return true;
  });
}

/** hasInterruptionEvidence(7244-7249) */
export function hasInterruptionEvidence(blocks: AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
    return true;
  });
}

/** resetForRetry(7250-7256) */
export function resetForRetry(state: AssistantState): AssistantState {
  return {
    ...initAssistantState(state.turn, state.step),
    firstTokenTime: state.firstTokenTime,
    hidden: true,
  };
}

/** updateChunk(7257-7318) 逐分支移植 */
export function updateChunk(state: AssistantState, ev: Extract<ChatEvent, { kind: "chunk" }>): AssistantState {
  const chunk = ev.chunk;
  const blocks = [...state.blocks];
  const index = chunk.index ?? 0;
  switch (chunk.type) {
    case "block-start":
      blocks[index] = emptyAssistantBlock(chunk.blockType ?? "");
      break;
    case "text-delta": {
      const previous = blocks[index];
      blocks[index] = {
        kind: "text",
        text: (previous?.kind === "text" ? previous.text : "") + (chunk.text ?? ""),
      };
      break;
    }
    case "reasoning-delta": {
      const previous = blocks[index];
      blocks[index] = {
        kind: "reasoning",
        text: (previous?.kind === "reasoning" ? previous.text : "") + (chunk.text ?? ""),
      };
      break;
    }
    case "tool-call-delta": {
      const previous = blocks[index];
      const base =
        previous?.kind === "tool-call" ? previous : { kind: "tool-call" as const, callId: "", name: "", argsRaw: "" };
      blocks[index] = {
        kind: "tool-call",
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + (chunk.argumentsDelta ?? ""),
      };
      break;
    }
    case "block-end":
      blocks[index] = toAssistantBlock(chunk.block ?? {});
      break;
    case "usage":
      return { ...state, usage: chunk.usage };
    default:
      return state;
  }
  const visible = hasVisibleContent(compactBlocks(blocks));
  const firstToken = isTokenDelta(chunk);
  return {
    ...state,
    blocks,
    hidden: visible ? false : state.hidden,
    ...(visible && state.firstVisibleSeq === undefined ? { firstVisibleSeq: ev.seq, firstVisibleTime: ev.time } : {}),
    ...(firstToken && state.firstTokenTime === undefined ? { firstTokenTime: ev.time } : {}),
  };
}

export interface FinalAssistantNode {
  kind: "assistant";
  seq: number;
  messageId?: string;
  time: number;
  turn: number;
  step: number;
  blocks: AssistantBlock[];
  usage?: Usage;
  timing?: { stepStartTime: number | null; firstTokenTime: number | null; completedTime: number };
  interrupted?: true;
}

interface Boundary {
  seq: number;
  time: number;
}

/**
 * finalNode(7323-7356) → finalAssistantNode。
 * dsh 的 closedBoundary(location) 在我方 fold 中 = step/end ?? turn/end 边界（同一语义：
 * step 关闭取 step.end，否则 turn 关闭取 turn.end）。
 */
export function finalAssistantNode(state: AssistantState, boundary: Boundary | undefined): FinalAssistantNode | undefined {
  const final = state.final;
  if (final !== undefined) {
    return {
      kind: "assistant",
      seq: final.seq,
      messageId: final.messageId,
      time: final.time,
      turn: state.turn,
      step: state.step,
      blocks: toAssistantBlocks(final.content),
      usage: final.usage,
      timing: {
        stepStartTime: state.startTime ?? null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: final.time,
      },
    };
  }
  const blocks = compactBlocks(state.blocks);
  if (boundary === undefined || !hasInterruptionEvidence(blocks)) return undefined;
  return {
    kind: "assistant",
    seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true,
  };
}

export interface ProjectedAssistant {
  anchorSeq: number;
  visible: boolean;
  settled?: FinalAssistantNode;
  data: {
    status: "running" | "settled" | "interrupted";
    turn: number;
    step: number;
    blocks: AssistantBlock[];
    time: number;
    usage?: Usage;
    finalNode?: FinalAssistantNode;
    honesty?: HonestyPatch;
  };
}

/** projectAssistant(7380-7403)：running/settled/interrupted 三态 */
export function projectAssistant(
  state: AssistantState,
  boundary: Boundary | undefined,
  fallbackSeq: number,
  fallbackTime: number,
): ProjectedAssistant {
  const settled = finalAssistantNode(state, boundary);
  const blocks = settled?.blocks ?? compactBlocks(state.blocks);
  const visible = hasVisibleContent(blocks);
  const status = settled?.interrupted === true ? "interrupted" : settled === undefined ? "running" : "settled";
  const anchorSeq = settled?.seq ?? state.firstVisibleSeq ?? fallbackSeq;
  const time = settled?.time ?? state.firstVisibleTime ?? fallbackTime;
  return {
    anchorSeq,
    visible,
    settled,
    data: {
      status,
      turn: state.turn,
      step: state.step,
      blocks,
      time,
      ...(state.usage === undefined ? {} : { usage: state.usage }),
      ...(settled === undefined ? {} : { finalNode: settled }),
      ...(state.honesty === undefined ? {} : { honesty: state.honesty }),
    },
  };
}

/* ========================= 工具树族（8293-8486 移植） ========================= */

export const MAX_DEPTH = 256;

export interface ToolCallBlock {
  callId: string;
  name: string;
  argsRaw: string;
  turn: number;
  step: number;
  time: number;
  callView: null;
  subCalls: ToolBlock[];
}

export interface ToolResultBlock {
  kind: "tool-result";
  seq: number;
  time: number;
  callId: string;
  call: { name: string; argsRaw: string } | null;
  callTime: number | null;
  content: unknown[];
  isError: boolean;
  error?: unknown;
  meta?: unknown;
  callView: null;
  resultView: null;
  subCalls: ToolBlock[];
}

export type ToolBlock = ToolCallBlock | ToolResultBlock;

export interface ToolTreeState {
  root: ToolBlock;
  children: Map<string, ToolBlock[]>;
  parents: Map<string, string>;
  /** 根 call 的 (turn,step)（interruption 边界查找用；dsh 走 location，我方帧直取） */
  turn: number;
  step: number;
}

const jsonArguments = (value: unknown): string => JSON.stringify(value);

/** rootCall(8293-8305)：callId/name/argsRaw/turn/step 逐字保留 */
export function rootCall(ev: Extract<ChatEvent, { kind: "tool-call" }>): ToolCallBlock {
  return {
    callId: String(ev.callId),
    name: ev.name,
    argsRaw: ev.argsRaw,
    turn: ev.turn,
    step: ev.step,
    time: ev.time,
    callView: null,
    subCalls: [],
  };
}

/** rootResult(8306-8327)：经 message.source.callId 配对，isError 布尔 */
export function rootResult(
  ev: Extract<ChatEvent, { kind: "tool-result" }>,
  previous: ToolCallBlock | undefined,
): ToolResultBlock | undefined {
  return {
    kind: "tool-result",
    seq: ev.seq,
    time: ev.time,
    callId: String(ev.callId),
    call: previous === undefined ? null : { name: previous.name, argsRaw: previous.argsRaw },
    callTime: previous?.time ?? null,
    content: ev.content,
    isError: ev.isError === true,
    ...(ev.error === undefined ? {} : { error: ev.error }),
    ...(ev.meta === undefined ? {} : { meta: ev.meta }),
    callView: null,
    resultView: null,
    subCalls: [],
  };
}

interface DispatchData {
  parentCallId: string;
  subCallId: string;
  name: string;
  argsRaw: string;
  content?: unknown[];
  isError?: boolean;
}

/** childCall(8328-8339) */
export function childCall(ev: { time: number }, data: DispatchData, turn: number, step: number): ToolCallBlock {
  return {
    callId: data.subCallId,
    name: data.name,
    argsRaw: data.argsRaw,
    turn,
    step,
    time: ev.time,
    callView: null,
    subCalls: [],
  };
}

/** childResult(8340-8357) */
export function childResult(ev: { seq: number; time: number }, data: DispatchData, previous: ToolBlock | undefined): ToolResultBlock {
  return {
    kind: "tool-result",
    seq: ev.seq,
    time: ev.time,
    callId: data.subCallId,
    call: { name: data.name, argsRaw: data.argsRaw },
    callTime: previous?.time ?? null,
    content: data.content ?? [],
    isError: data.isError === true,
    callView: null,
    resultView: null,
    subCalls: [],
  };
}

/** acceptsEdge(8364-8391)：环检测 + MAX_DEPTH=256 */
export function acceptsEdge(state: ToolTreeState, parent: string, child: string): boolean {
  if (parent === child || state.parents.has(child)) return false;
  let cursor: string | undefined = parent;
  let parentDepth = 0;
  const ancestors = new Set<string>();
  while (cursor !== undefined) {
    if (cursor === child || ancestors.has(cursor)) return false;
    ancestors.add(cursor);
    parentDepth++;
    cursor = state.parents.get(cursor);
  }
  const pending = [{ callId: child, depth: 1 }];
  const descendants = new Set<string>();
  let subtreeDepth = 0;
  for (const candidate of pending) {
    if (descendants.has(candidate.callId)) return false;
    descendants.add(candidate.callId);
    subtreeDepth = Math.max(subtreeDepth, candidate.depth);
    for (const nested of state.children.get(candidate.callId) ?? []) {
      pending.push({ callId: nested.callId, depth: candidate.depth + 1 });
    }
  }
  return parentDepth + subtreeDepth <= MAX_DEPTH;
}

/** updateDispatch(8392-8423)：code-dispatch 子调用挂树 */
export function updateDispatch(
  state: ToolTreeState,
  ev: Extract<ChatEvent, { kind: "code-dispatch-start" | "code-dispatch" }>,
): ToolTreeState {
  const data: DispatchData = {
    parentCallId: String(ev.parentCallId),
    subCallId: String(ev.subCallId),
    name: ev.name,
    argsRaw: ev.argsRaw,
    ...(ev.kind === "code-dispatch" ? { content: ev.content, isError: ev.isError } : {}),
  };
  const siblings = state.children.get(data.parentCallId) ?? [];
  const index = siblings.findIndex((candidate) => candidate.callId === data.subCallId);
  if (ev.kind === "code-dispatch-start") {
    if (index >= 0 || !acceptsEdge(state, data.parentCallId, data.subCallId)) return state;
    const children = new Map(state.children);
    children.set(data.parentCallId, [...siblings, childCall(ev, data, state.turn, state.step)]);
    const parents = new Map(state.parents);
    parents.set(data.subCallId, data.parentCallId);
    return { ...state, children, parents };
  }
  if (index < 0 && !acceptsEdge(state, data.parentCallId, data.subCallId)) return state;
  const settled = childResult(ev, data, index < 0 ? undefined : siblings[index]);
  const children = new Map(state.children);
  children.set(data.parentCallId, index < 0 ? [...siblings, settled] : siblings.map((child, at) => (at === index ? settled : child)));
  const parents = new Map(state.parents);
  if (index < 0) parents.set(data.subCallId, data.parentCallId);
  return { ...state, children, parents };
}

/** sameReferences(8467-8469) */
export function sameReferences(left: ToolBlock[], right: ToolBlock[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** projectBlock(8424-8466)：递归子调用 + 中断时合成 isError Interrupted 结果（8440-8454） */
export function projectBlock(
  block: ToolBlock,
  state: ToolTreeState,
  interruptedAt: Boundary | undefined,
  visited: Set<string> = new Set(),
  depth = 1,
): ToolBlock {
  if (visited.has(block.callId) || depth > MAX_DEPTH) return { ...block, subCalls: [] };
  const nextVisited = new Set(visited);
  nextVisited.add(block.callId);
  const children = (state.children.get(block.callId) ?? block.subCalls).map((child) =>
    projectBlock(child, state, interruptedAt, nextVisited, depth + 1),
  );
  if ("kind" in block || interruptedAt === undefined) {
    return sameReferences(block.subCalls, children) ? block : { ...block, subCalls: children };
  }
  return {
    kind: "tool-result",
    seq: interruptedAt.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedFollowup,
    time: interruptedAt.time,
    callId: block.callId,
    call: { name: block.name, argsRaw: block.argsRaw },
    callTime: block.time,
    content: [],
    isError: true,
    error: { name: "Interrupted", code: "interrupted" },
    callView: block.callView,
    resultView: null,
    subCalls: children,
  };
}

/* ================================ 节点模型 ================================ */

export type ChatNode =
  | { key: string; kind: "user"; anchorSeq: number; time: number; text: string }
  | { key: string; kind: "assistant"; anchorSeq: number; time: number; data: ProjectedAssistant["data"] }
  | { key: string; kind: "tool-call"; anchorSeq: number; time: number; root: ToolBlock }
  | { key: string; kind: "notice"; anchorSeq: number; time: number; reason: string }
  | {
      key: string;
      kind: "compaction";
      anchorSeq: number;
      time: number;
      data: {
        commandName?: string;
        phase: "running" | "done" | "error";
        errorText?: string;
        commandDoneKind?: string;
        commandDoneText?: string;
      };
    };

export interface ChatFlowProjection {
  nodes: ChatNode[];
}

/* ============================ 顶层 fold（fallbackState$4/$1 合流） ============================ */

const assistantKey = (turn: number, step: number) => `${turn}:${step}`;

/**
 * 全量 fold：增量与回放共用一条纯 fold（dsh fallbackState$4 同款洞察——
 * 断线重放 = 对 seenIds 去重后日志重 fold）。
 * 节点排序键 = anchorSeq（稳定排序，同键保到达序）。
 */
export function selectChatFlow(events: ChatEvent[]): ChatFlowProjection {
  const assistants = new Map<string, AssistantState>();
  const assistantFirstSeq = new Map<string, { seq: number; time: number }>();
  const toolTrees = new Map<string, ToolTreeState>();
  const toolFirstSeq = new Map<string, { seq: number; time: number }>();
  const stepEnds = new Map<string, Boundary>();
  const turnEnds = new Map<number, Boundary>();
  const userNodes: ChatNode[] = [];
  const noticeNodes: ChatNode[] = [];
  const commandRuns = new Map<string, { seq: number; time: number; name: string }>();
  const commandDones = new Map<string, { doneKind: string; text?: string }>();
  const compactions = new Map<string, { startSeq: number; time: number; sourceCommandId?: string; error?: string; ended: boolean }>();

  const boundaryOf = (turn: number, step: number): Boundary | undefined =>
    stepEnds.get(assistantKey(turn, step)) ?? turnEnds.get(turn);

  for (const ev of events) {
    switch (ev.kind) {
      case "step-start": {
        const key = assistantKey(ev.turn, ev.step);
        const state = initAssistantState(ev.turn, ev.step);
        state.startTime = ev.time;
        assistants.set(key, state);
        assistantFirstSeq.set(key, { seq: ev.seq, time: ev.time });
        break;
      }
      case "step-end":
        stepEnds.set(assistantKey(ev.turn, ev.step), { seq: ev.seq, time: ev.time });
        break;
      case "turn-end":
        turnEnds.set(ev.turn, { seq: ev.seq, time: ev.time });
        break;
      case "chunk": {
        const key = assistantKey(ev.turn, ev.step);
        let state = assistants.get(key);
        if (state === undefined) {
          state = initAssistantState(ev.turn, ev.step);
          assistantFirstSeq.set(key, { seq: ev.seq, time: ev.time });
        }
        if (ev.honesty !== undefined) state = { ...state, honesty: ev.honesty };
        assistants.set(key, updateChunk(state, ev));
        break;
      }
      case "assistant-message": {
        const key = assistantKey(ev.turn, ev.step);
        let state = assistants.get(key);
        if (state === undefined) {
          state = initAssistantState(ev.turn, ev.step);
          assistantFirstSeq.set(key, { seq: ev.seq, time: ev.time });
        }
        assistants.set(key, {
          ...state,
          blocks: toAssistantBlocks(ev.content),
          hidden: false,
          final: { seq: ev.seq, time: ev.time, messageId: ev.messageId, content: ev.content, usage: ev.usage },
          usage: ev.usage,
          ...(ev.honesty === undefined ? {} : { honesty: ev.honesty }),
        });
        break;
      }
      case "llm-retry": {
        const key = assistantKey(ev.turn, ev.step);
        const state = assistants.get(key);
        if (state !== undefined) assistants.set(key, resetForRetry(state));
        break;
      }
      case "tool-call": {
        const root = rootCall(ev);
        toolTrees.set(root.callId, { root, children: new Map(), parents: new Map(), turn: ev.turn, step: ev.step });
        toolFirstSeq.set(root.callId, { seq: ev.seq, time: ev.time });
        break;
      }
      case "tool-result": {
        const existing = toolTrees.get(ev.callId);
        if (existing === undefined) {
          // fallbackState$1(8475-8486)：回放中段无 tool/call，result 自举为根
          const root = rootResult(ev, undefined);
          if (root !== undefined) {
            toolTrees.set(ev.callId, { root, children: new Map(), parents: new Map(), turn: 0, step: 0 });
            toolFirstSeq.set(ev.callId, { seq: ev.seq, time: ev.time });
          }
          break;
        }
        const result = rootResult(ev, "kind" in existing.root ? undefined : existing.root);
        if (result !== undefined) toolTrees.set(ev.callId, { ...existing, root: result });
        break;
      }
      case "code-dispatch-start":
      case "code-dispatch": {
        const tree = toolTrees.get(ev.rootCallId);
        if (tree !== undefined) toolTrees.set(ev.rootCallId, updateDispatch(tree, ev));
        break;
      }
      case "user-message":
        userNodes.push({ key: `user:${ev.seq}`, kind: "user", anchorSeq: ev.seq, time: ev.time, text: ev.text });
        break;
      case "notice":
        noticeNodes.push({ key: `notice:${ev.seq}`, kind: "notice", anchorSeq: ev.seq, time: ev.time, reason: ev.reason });
        break;
      case "command-run":
        commandRuns.set(ev.commandId, { seq: ev.seq, time: ev.time, name: ev.name });
        break;
      case "command-done":
        commandDones.set(ev.commandId, { doneKind: ev.doneKind, ...(ev.text === undefined ? {} : { text: ev.text }) });
        break;
      case "compaction-start":
        compactions.set(ev.compactionId, {
          startSeq: ev.seq,
          time: ev.time,
          ...(ev.sourceCommandId === undefined ? {} : { sourceCommandId: ev.sourceCommandId }),
          ended: false,
        });
        break;
      case "compaction-end": {
        const c = compactions.get(ev.compactionId);
        if (c !== undefined) {
          compactions.set(ev.compactionId, { ...c, ended: true, ...(ev.error === undefined ? {} : { error: ev.error }) });
        } else {
          compactions.set(ev.compactionId, {
            startSeq: ev.seq,
            time: ev.time,
            ended: true,
            ...(ev.error === undefined ? {} : { error: ev.error }),
          });
        }
        break;
      }
    }
  }

  const nodes: ChatNode[] = [];
  for (const [key, state] of assistants) {
    const first = assistantFirstSeq.get(key) ?? { seq: 0, time: 0 };
    const projected = projectAssistant(state, boundaryOf(state.turn, state.step), first.seq, first.time);
    // buildViewNode(7456-)：running 且不可见 → 不出节点
    if (projected.settled === undefined && !projected.visible) continue;
    nodes.push({ key: `assistant:${key}`, kind: "assistant", anchorSeq: projected.anchorSeq, time: projected.data.time, data: projected.data });
  }
  for (const [callId, tree] of toolTrees) {
    const interruptedAt = boundaryOf(tree.turn, tree.step);
    const root = projectBlock(tree.root, tree, interruptedAt);
    const first = toolFirstSeq.get(callId) ?? { seq: 0, time: 0 };
    const anchorSeq = "kind" in tree.root ? tree.root.seq : first.seq;
    const time = "kind" in tree.root ? tree.root.time : first.time;
    nodes.push({ key: `tool:${callId}`, kind: "tool-call", anchorSeq, time, root });
  }
  nodes.push(...userNodes, ...noticeNodes);
  for (const [compactionId, c] of compactions) {
    const command = c.sourceCommandId !== undefined ? commandRuns.get(c.sourceCommandId) : undefined;
    const done = c.sourceCommandId !== undefined ? commandDones.get(c.sourceCommandId) : undefined;
    nodes.push({
      key: `compaction:${compactionId}`,
      kind: "compaction",
      anchorSeq: command?.seq ?? c.startSeq,
      time: c.time,
      data: {
        ...(command === undefined ? {} : { commandName: command.name }),
        phase: !c.ended ? "running" : c.error !== undefined ? "error" : "done",
        ...(c.error === undefined ? {} : { errorText: c.error }),
        ...(done === undefined ? {} : { commandDoneKind: done.doneKind }),
        ...(done?.text === undefined ? {} : { commandDoneText: done.text }),
      },
    });
  }

  // 节点排序键 = anchorSeq（稳定排序：同键保到达序）
  nodes.sort((a, b) => a.anchorSeq - b.anchorSeq);
  return { nodes };
}

/* ================================ 统计透传 ================================ */

/** 夹具 projections.values / answer.final 附加字段同款形状（E3 透传位，标推断） */
export interface TurnStatsSource {
  sessionStats?: {
    turns?: number;
    steps?: number;
    llmMs?: number;
    toolMs?: number;
    ttftMs?: number;
    ttftSteps?: number;
    decodeMs?: number;
    decodeTokens?: number;
  };
  tokenUsage?: {
    uncachedInputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number };
}

export interface TurnStats {
  turns: number;
  steps: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  decodeMs?: number;
  decodeTokens?: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens?: number;
  /** dsh README billed-input 口径：cacheRead / (uncachedInput + cacheRead) */
  cacheHitRate: number;
  pressureTokens?: number;
  contextWindow?: number;
}

/** 缺统计投影 → undefined（整格不出，不填假值） */
export function selectTurnStats(source: TurnStatsSource): TurnStats | undefined {
  const s = source.sessionStats;
  const u = source.tokenUsage;
  if (s?.turns === undefined || s.steps === undefined) return undefined;
  if (u?.uncachedInputTokens === undefined || u.outputTokens === undefined || u.cacheReadTokens === undefined) return undefined;
  const billed = u.uncachedInputTokens + u.cacheReadTokens;
  return {
    turns: s.turns,
    steps: s.steps,
    ...(s.llmMs === undefined ? {} : { llmMs: s.llmMs }),
    ...(s.toolMs === undefined ? {} : { toolMs: s.toolMs }),
    ...(s.ttftMs === undefined ? {} : { ttftMs: s.ttftMs }),
    ...(s.decodeMs === undefined ? {} : { decodeMs: s.decodeMs }),
    ...(s.decodeTokens === undefined ? {} : { decodeTokens: s.decodeTokens }),
    uncachedInputTokens: u.uncachedInputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    ...(u.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: u.cacheWriteTokens }),
    cacheHitRate: billed === 0 ? 0 : u.cacheReadTokens / billed,
    ...(source.contextPressure?.pressureTokens === undefined ? {} : { pressureTokens: source.contextPressure.pressureTokens }),
    ...(source.contextPressure?.contextWindow === undefined ? {} : { contextWindow: source.contextPressure.contextWindow }),
  };
}

export function formatCacheHitRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
