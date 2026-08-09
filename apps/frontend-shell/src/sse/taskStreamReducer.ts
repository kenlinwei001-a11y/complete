import type { Answer } from "@platform/contracts";

/** SSE 事件帧（事件名与 QOS-PRD §8.2 一字不差） */
export interface StreamEvent {
  id: string;
  event:
    | "task.accepted"
    | "routing.completed"
    | "clarification.required"
    | "step.started"
    | "step.completed"
    | "answer.final"
    | "action_draft.created"
    | "task.failed"
    | "task.cancelled"
    | string;
  data: Record<string, unknown>;
}

export interface ClarificationPayload {
  kind: "INTENT_CHOICE" | "SLOT_FILLING";
  options?: { intentKey: string; name: string; description: string }[];
  slots?: {
    name: string;
    type: "string" | "number" | "date" | "timeWindow" | "objectRef" | "enum";
    clarifyPrompt?: string;
    enumValues?: string[];
    objectType?: string;
    description?: string;
  }[];
  round: number;
}

/**
 * WO-FE-AGENT-TRACE · Coordinator 扇出计划（`coordinator.planned` 事件载荷，
 * 后端 `router/orchestrator.ts:2480`）。**这是"哪个角色是谁"的唯一权威来源**：
 * `dispatch_<i>` 步与 `plan.dispatches[i]` 一一对应（后端自己就是这么建映射的·同文件 :2518-2520）。
 * 此前该事件名不在 `useTaskStream` 的 KNOWN_EVENTS 里 → EventSource 具名事件无人订阅 → 整条被丢。
 */
export interface CoordinatorPlanned {
  trigger?: string;
  dispatches: { role: string; agentId?: string; subQuestion?: string }[];
}

export type StreamStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "awaiting_clarification"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskStreamState {
  status: StreamStatus;
  events: StreamEvent[];
  /** 已见事件 id（去重） */
  seenIds: Record<string, true>;
  lastEventId: string | null;
  routing?: { path: "WORKFLOW" | "AGENT"; intentKey?: string; confidence?: number };
  /** WO-FE-AGENT-TRACE：多角色会诊的扇出计划（缺 → 本任务不是 Coordinator 路径，不做任何角色归属推断）。 */
  coordinator?: CoordinatorPlanned;
  answer?: Answer;
  clarification?: ClarificationPayload;
  actionDraft?: { draftId: string; actionType: string };
  error?: { code: string; message: string; stepId?: string };
}

export const initialStreamState: TaskStreamState = {
  status: "idle",
  events: [],
  seenIds: {},
  lastEventId: null,
};

export type StreamAction =
  | { type: "connect" }
  | { type: "event"; frame: StreamEvent }
  | { type: "reset" };

export function isTerminalEvent(event: string): boolean {
  return event === "answer.final" || event === "task.failed" || event === "task.cancelled";
}

export function taskStreamReducer(state: TaskStreamState, action: StreamAction): TaskStreamState {
  switch (action.type) {
    case "reset":
      return initialStreamState;
    case "connect":
      return state.status === "idle" ? { ...state, status: "connecting" } : state;
    case "event": {
      const { frame } = action;
      // 按事件 id 去重（断线重放可能重复）
      if (frame.id && state.seenIds[frame.id]) return state;
      const next: TaskStreamState = {
        ...state,
        events: [...state.events, frame],
        seenIds: frame.id ? { ...state.seenIds, [frame.id]: true } : state.seenIds,
        lastEventId: frame.id || state.lastEventId,
        status: state.status === "connecting" || state.status === "idle" ? "streaming" : state.status,
      };
      switch (frame.event) {
        case "routing.completed":
          next.routing = frame.data as unknown as TaskStreamState["routing"];
          next.status = "streaming";
          next.clarification = undefined;
          break;
        case "clarification.required":
          next.clarification = frame.data as unknown as ClarificationPayload;
          next.status = "awaiting_clarification";
          break;
        case "coordinator.planned": {
          // 只认真数组；后端不发/发空 → 保持 undefined（不造空壳角色栏）。
          const d = frame.data as { trigger?: unknown; dispatches?: unknown };
          const list = Array.isArray(d.dispatches) ? (d.dispatches as CoordinatorPlanned["dispatches"]) : [];
          if (list.length > 0) {
            next.coordinator = {
              ...(typeof d.trigger === "string" ? { trigger: d.trigger } : {}),
              dispatches: list,
            };
          }
          break;
        }
        case "step.started":
        case "step.completed":
          next.status = "streaming";
          break;
        case "answer.final":
          next.answer = frame.data as unknown as Answer;
          next.status = "completed";
          break;
        case "action_draft.created":
          next.actionDraft = frame.data as unknown as TaskStreamState["actionDraft"];
          break;
        case "task.failed":
          next.error = frame.data as unknown as TaskStreamState["error"];
          next.status = "failed";
          break;
        case "task.cancelled":
          next.error = { code: "CANCELLED", message: String(frame.data.reason ?? "已取消") };
          next.status = "cancelled";
          break;
        default:
          break;
      }
      return next;
    }
    default:
      return state;
  }
}

/** 步骤行聚合（started/completed 配对），供时间线 UI 使用 */
export interface StepRow {
  stepId: string;
  type: string;
  outcome?: string;
  durationMs?: number;
  running: boolean;
  /** WO-REASONING-TRACE：type==="agent_narration" 时携带本轮"思考旁白"文本（建人机信任·非工具步·💭 展示）。 */
  text?: string;
  // ── WO-FE-AGENT-TRACE：后端**已在发**、此前被本函数整片丢弃的结构化字段。
  //    字段并集是**实测**的（见 docs/WO-FE-AGENT-TRACE-delivery.md「后端字段并集实测」），不是照抄 PRD：
  //    PRD-RT:503 点名 `role/roleLabel/nodeId/phase/iteration/budgetLeft`，实测 `nodeId/phase/budgetLeft`
  //    后端一处都不发（全仓 0 命中），而 PRD 未列的 `agentId` 后端在发 —— 以实测为准。
  /** 角色机器键（如 `supply_chain`）。仅 Coordinator 扇出路径有。 */
  role?: string;
  /** 角色中文名（`orchestrator.ts:2536` 的 ROLE_LABELS 查表结果）。分栏表头用的就是它。 */
  roleLabel?: string;
  /** 执行该步的 agent 注册 id（`orchestrator.ts:2537`）。 */
  agentId?: string;
  /** agent loop 第几轮（`agent/loop.ts:848`·仅 agent_narration 伪步带）。 */
  iteration?: number;
}

/** 从 step.* 载荷里抽结构化字段——**只取真有的**，缺字段不落键（下游据"有没有这个键"决定显不显示，绝不填假值）。 */
function structuredOf(src: Record<string, unknown> | Partial<StepRow> | undefined): Partial<StepRow> {
  const d = (src ?? {}) as Record<string, unknown>;
  const out: Partial<StepRow> = {};
  if (typeof d.role === "string" && d.role) out.role = d.role;
  if (typeof d.roleLabel === "string" && d.roleLabel) out.roleLabel = d.roleLabel;
  if (typeof d.agentId === "string" && d.agentId) out.agentId = d.agentId;
  if (typeof d.iteration === "number" && Number.isFinite(d.iteration)) out.iteration = d.iteration;
  return out;
}

export function selectStepRows(state: TaskStreamState): StepRow[] {
  const rows = new Map<string, StepRow>();
  for (const e of state.events) {
    if (e.event === "step.started") {
      const d = e.data as { stepId?: string; type?: string };
      if (!d.stepId) continue;
      const prev = rows.get(d.stepId);
      rows.set(d.stepId, {
        stepId: d.stepId,
        type: d.type ?? "",
        running: true,
        // started 先到、completed 后到时结构化字段可能只在其中一侧 → 两侧都收，后到的不许把先到的抹掉。
        ...structuredOf(prev),
        ...structuredOf(e.data),
      });
    } else if (e.event === "step.completed") {
      const d = e.data as { stepId?: string; type?: string; outcome?: string; durationMs?: number; text?: string };
      if (!d.stepId) continue;
      const prev = rows.get(d.stepId);
      rows.set(d.stepId, {
        stepId: d.stepId,
        type: d.type ?? prev?.type ?? "",
        outcome: d.outcome,
        durationMs: d.durationMs,
        running: false,
        ...(d.text ? { text: d.text } : prev?.text ? { text: prev.text } : {}),
        ...structuredOf(prev),
        ...structuredOf(e.data),
      });
    }
  }
  return [...rows.values()];
}

/**
 * WO-FE-AGENT-TRACE · 角色分栏模型（Timeline / taskDag 共用的唯一归属口径）。
 *
 * 归属优先级（**降级必须诚实**）：
 *  ① 载荷自带 `role`/`roleLabel`/`agentId` —— 后端 `orchestrator.ts:2530-2540` 的 `emitWithRole`
 *     只给 `type==="agent_narration"` 的伪步注入，所以只有旁白行天然带；
 *  ② `dispatch_<i>` 前缀 × `coordinator.planned` 的第 i 项 —— 这是**后端自己的同一条确定性映射**
 *     （`orchestrator.ts:2518-2520` 建的就是 `dispatch_${i} → plan.dispatches[i]`），用来把
 *     `dispatch_i` 这个 invoke_agent 步本身也归到它的角色下（载荷里没有 role，靠此对齐）；
 *  ③ 都没有 → 落 `ungrouped`，**不猜、不填「未知」**。
 *
 * `coordinator.planned` 未到达（普通单 agent / 工作流任务）→ tracks 为空 → 调用方照原样平铺渲染。
 */
export interface RoleTrack {
  roleKey: string;
  roleLabel: string;
  agentId?: string;
  subQuestion?: string;
  rows: StepRow[];
}

export interface RoleTrackModel {
  tracks: RoleTrack[];
  /** 无角色归属的步（普通工作流步 / 非 Coordinator 路径）——照旧平铺，不塞进任何角色栏。 */
  ungrouped: StepRow[];
}

/** `dispatch_3` / `dispatch_3/narration-1` → 3；不匹配 → undefined。 */
function dispatchIndexOf(stepId: string): number | undefined {
  const m = /^dispatch_(\d+)(?:\/|$)/.exec(stepId);
  if (!m) return undefined;
  const i = Number(m[1]);
  return Number.isInteger(i) ? i : undefined;
}

export function selectRoleTracks(state: TaskStreamState): RoleTrackModel {
  const rows = selectStepRows(state);
  const plan = state.coordinator?.dispatches ?? [];
  const order: string[] = [];
  const byRole = new Map<string, RoleTrack>();
  const ungrouped: StepRow[] = [];

  for (const row of rows) {
    // ① 载荷自带（权威）
    let roleKey = row.role;
    let roleLabel = row.roleLabel;
    let agentId = row.agentId;
    let subQuestion: string | undefined;
    // ② dispatch_<i> × coordinator.planned（与后端同一条映射）
    const idx = dispatchIndexOf(row.stepId);
    const d = idx !== undefined ? plan[idx] : undefined;
    if (d) {
      roleKey ??= d.role;
      roleLabel ??= d.role; // 计划里没有中文名时就用机器键本身，不编造
      agentId ??= d.agentId;
      subQuestion = d.subQuestion;
    }
    // ③ 无任何依据 → 不归属
    if (!roleKey) {
      ungrouped.push(row);
      continue;
    }
    let track = byRole.get(roleKey);
    if (!track) {
      track = { roleKey, roleLabel: roleLabel ?? roleKey, ...(agentId ? { agentId } : {}), ...(subQuestion ? { subQuestion } : {}), rows: [] };
      byRole.set(roleKey, track);
      order.push(roleKey);
    } else {
      // 后到的行补全表头信息（旁白带 roleLabel、dispatch 步带 subQuestion，互补）
      if (roleLabel && track.roleLabel === track.roleKey) track.roleLabel = roleLabel;
      if (!track.agentId && agentId) track.agentId = agentId;
      if (!track.subQuestion && subQuestion) track.subQuestion = subQuestion;
    }
    track.rows.push(row);
  }
  return { tracks: order.map((k) => byRole.get(k)!), ungrouped };
}
