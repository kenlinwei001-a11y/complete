import type { TaskStreamState } from "@/sse/taskStreamReducer";
import { selectStepRows, type StepRow } from "@/sse/taskStreamReducer";
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
