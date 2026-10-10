import type { TaskStreamState } from "@/sse/taskStreamReducer";
import { selectRoleTracks, selectStepRows, type StepRow } from "@/sse/taskStreamReducer";
import type { DagEdgeDef, DagNodeDef } from "./LayeredDag";
import zh from "@/locales/zh";

/**
 * §7.19 任务详情编排 DAG —— 完全由已有 query_events（SSE 回放）推导，无新后端契约。
 * 路径 A：意图解析 → 槽位 → 各计划步骤（type 着色）→ 回答
 * 路径 B：意图分类(OUT_OF_CATALOG) → 各迭代工具调用 → final_answer
 */

/** step type 着色：取数青 / 求解品红 / 规则紫 / 渲染灰 */
export function stepColor(type: string): string {
  if (type === "invoke_solver") return "#C470B8";
  if (type === "evaluate_rules") return "#9D8BF0";
  if (type === "render_answer") return "#67737F";
  // resolve_slice / query_objects / query_timeseries_agg / tool_call → 取数
  return "#43B7D7";
}

/**
 * 节点副标题：耗时 · 结果。WO-FE-AGENT-TRACE 追加 `第 n 轮`（后端 agent/loop.ts:848 的 iteration）——
 * **只在真有 iteration 时追加**，没有就不追（不填「第 ? 轮」这类假值）。
 */
function stepSub(row: StepRow): string | undefined {
  const base = row.durationMs != null ? `${row.durationMs}ms · ${row.outcome ?? "…"}` : row.outcome;
  if (row.iteration == null) return base;
  const iter = `第 ${row.iteration + 1} 轮`;
  return base ? `${iter} · ${base}` : iter;
}

function stepState(row: StepRow, failedStepId?: string): DagNodeDef["state"] {
  if (row.outcome === "ERROR" || row.stepId === failedStepId) return "fail";
  if (row.outcome === "REJECTED" || row.outcome === "BUDGET_EXCEEDED" || row.outcome === "BUDGET_EXHAUSTED") return "warn";
  return undefined;
}

export interface TaskDagModel {
  nodes: DagNodeDef[];
  edges: DagEdgeDef[];
}

export function buildTaskDag(state: TaskStreamState, clarificationRounds = 0): TaskDagModel | null {
  const path = state.routing?.path;
  if (!path) return null;
  const steps = selectStepRows(state);
  const failedStepId = state.error?.stepId;
  const nodes: DagNodeDef[] = [];
  const edges: DagEdgeDef[] = [];
  const link = (from: string, to: string) => edges.push({ from, to });

  if (path === "WORKFLOW") {
    nodes.push({
      id: "intent",
      layer: 0,
      label: zh.taskDag.intent,
      sub: state.routing?.intentKey ? `${state.routing.intentKey}${state.routing.confidence != null ? ` ·${state.routing.confidence.toFixed(2)}` : ""}` : undefined,
      color: "var(--accent)",
    });
    nodes.push({
      id: "slots",
      layer: 1,
      label: zh.taskDag.slots,
      sub: clarificationRounds > 0 ? zh.taskDag.clarifyRounds(clarificationRounds) : zh.taskDag.noClarify,
      color: "var(--accent)",
    });
    link("intent", "slots");
    let prev = "slots";
    steps.forEach((s, i) => {
      nodes.push({
        id: s.stepId,
        layer: 2 + i,
        label: s.type || s.stepId,
        sub: s.durationMs != null ? `${s.durationMs}ms · ${s.outcome ?? "…"}` : s.outcome,
        color: stepColor(s.type),
        state: stepState(s, failedStepId),
      });
      link(prev, s.stepId);
      prev = s.stepId;
    });
    const lastLayer = 2 + steps.length;
    if (state.status === "failed") {
      nodes.push({ id: "answer", layer: lastLayer, label: zh.taskDag.failed, sub: state.error?.code, color: "var(--danger)", state: "fail" });
    } else {
      nodes.push({ id: "answer", layer: lastLayer, label: zh.taskDag.answer, sub: state.answer ? state.answer.trustLevel : undefined, color: "#67737F" });
    }
    link(prev, "answer");
    return { nodes, edges };
  }

  // —— 路径 B（AGENT）——
  nodes.push({ id: "classify", layer: 0, label: zh.taskDag.classify, sub: zh.taskDag.outOfCatalog, color: "var(--accent)" });

  // WO-FE-AGENT-TRACE · 多角色会诊：每个角色一条独立分支（classify ⇒ 该角色的步链 ⇒ answer），
  // 而不是把所有角色的步串成一条假的顺序链。复用同一个 LayeredDag（PRD-RT:625 不造新可视化框架）：
  // layer = 1 + 该角色链内序号，同层多角色天然并排 → 视觉上就是分栏。
  // `coordinator.planned` 未到达（普通单 agent 任务）→ tracks 为空 → 下方既有串行链逐字节不变。
  const { tracks, ungrouped } = selectRoleTracks(state);
  if (tracks.length > 0) {
    let maxLen = 0;
    for (const t of tracks) {
      let prevInRole = "classify";
      t.rows.forEach((s, i) => {
        nodes.push({
          id: s.stepId,
          layer: 1 + i,
          // 标签带角色名 → 每个节点自己说明"我属于谁"（sub 里再补耗时/结果）
          label: t.roleLabel,
          sub: stepSub(s),
          color: stepColor(s.type),
          state: stepState(s, failedStepId),
        });
        link(prevInRole, s.stepId);
        prevInRole = s.stepId;
      });
      maxLen = Math.max(maxLen, t.rows.length);
      if (t.rows.length > 0) link(prevInRole, "answer");
    }
    // 无角色归属的步（若有）接在 classify 之后自成一层，不塞进任何角色分支
    ungrouped.forEach((s, i) => {
      nodes.push({
        id: s.stepId,
        layer: 1 + i,
        label: s.type === "tool_call" ? s.stepId : s.type,
        sub: stepSub(s),
        color: stepColor(s.type),
        state: stepState(s, failedStepId),
      });
      link("classify", s.stepId);
      link(s.stepId, "answer");
    });
    const answerLayer = 1 + Math.max(maxLen, ungrouped.length);
    if (state.status === "failed") {
      nodes.push({ id: "answer", layer: answerLayer, label: zh.taskDag.failed, sub: state.error?.code, color: "var(--danger)", state: "fail" });
    } else {
      nodes.push({ id: "answer", layer: answerLayer, label: zh.taskDag.finalAnswer, color: "#67737F" });
    }
    return { nodes, edges };
  }

  let prev = "classify";
  steps.forEach((s, i) => {
    // 每迭代一层（事件未携带迭代号时按工具调用顺序逐层排布）
    nodes.push({
      id: s.stepId,
      layer: 1 + i,
      label: s.type === "tool_call" ? s.stepId : s.type,
      sub: s.durationMs != null ? `${s.durationMs}ms · ${s.outcome ?? "…"}` : s.outcome,
      color: stepColor(s.type),
      state: stepState(s, failedStepId),
    });
    link(prev, s.stepId);
    prev = s.stepId;
  });
  const lastLayer = 1 + steps.length;
  if (state.status === "failed") {
    nodes.push({ id: "answer", layer: lastLayer, label: zh.taskDag.failed, sub: state.error?.code, color: "var(--danger)", state: "fail" });
  } else {
    nodes.push({ id: "answer", layer: lastLayer, label: zh.taskDag.finalAnswer, color: "#67737F" });
  }
  link(prev, "answer");
  return { nodes, edges };
}
