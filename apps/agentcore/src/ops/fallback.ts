import type { ExecutionPlan, IntentDefinition, PlanStep } from "@platform/contracts";
import { newId } from "../ids.js";
import type { FallbackTraceRow, Repos } from "../persistence/repos.js";
import { HttpError } from "../router/orchestrator.js";
import { centroid, cosine, pseudoEmbed } from "../util/embedding.js";

export interface FallbackStatsItem {
  querySample: string;
  count: number;
  lastSeen: string;
  outcomeBreakdown: Record<string, number>;
  topToolSketch: { toolName: string; inputSummary: string }[];
}

/** S4.2: vector-neighbor merge threshold (相似度 > 0.9 归簇). */
const MERGE_COSINE = 0.9;

/**
 * Cluster fallback traces (S4.2 upgrade): string normalization (lowercase /
 * 去标点 / 数字→#) groups exact paraphrase repeats; clusters whose centroid
 * pseudo-embeddings have cosine > 0.9 are then merged (semantic neighbors).
 */
export async function fallbackStats(
  repos: Repos,
  filter: { tenantId: string; packageId?: string; from?: string; to?: string },
): Promise<{ items: FallbackStatsItem[] }> {
  const traces = await repos.fallbackTraces.list(filter);

  // ① exact clustering on normalizedQuery
  const byNorm = new Map<string, FallbackTraceRow[]>();
  for (const t of traces) {
    const list = byNorm.get(t.normalizedQuery) ?? [];
    list.push(t);
    byNorm.set(t.normalizedQuery, list);
  }

  // ② vector-neighbor merge of the string clusters
  const merged: { emb: number[]; traces: FallbackTraceRow[] }[] = [];
  for (const list of byNorm.values()) {
    const embeddings = list.map((t) => t.embedding ?? pseudoEmbed(t.normalizedQuery));
    const emb = centroid(embeddings);
    const target = merged.find((m) => cosine(m.emb, emb) > MERGE_COSINE);
    if (target) {
      target.traces.push(...list);
      target.emb = centroid(target.traces.map((t) => t.embedding ?? pseudoEmbed(t.normalizedQuery)));
    } else {
      merged.push({ emb, traces: [...list] });
    }
  }

  const items: FallbackStatsItem[] = [];
  for (const cluster of merged) {
    const sorted = [...cluster.traces].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const newest = sorted[0] as FallbackTraceRow;
    const outcomeBreakdown: Record<string, number> = {};
    for (const t of cluster.traces) outcomeBreakdown[t.outcome] = (outcomeBreakdown[t.outcome] ?? 0) + 1;
    items.push({
      querySample: newest.query,
      count: cluster.traces.length,
      lastSeen: newest.createdAt,
      outcomeBreakdown,
      topToolSketch: newest.executedPlanSketch,
    });
  }
  items.sort((a, b) => b.count - a.count);
  return { items };
}

const SKETCH_TO_STEP: Record<string, (i: number) => PlanStep> = {
  resolve_slice: (i) => ({ id: `s${i}`, type: "resolve_slice", params: { sliceKey: "", args: {} } }),
  query_objects: (i) => ({ id: `s${i}`, type: "query_objects", params: { objectType: "", filter: {} } }),
  get_object: (i) => ({ id: `s${i}`, type: "query_objects", params: { objectType: "", filter: {} } }),
  invoke_solver: (i) => ({ id: `s${i}`, type: "invoke_solver", params: { solverKey: "", args: {} } }),
  evaluate_rules: (i) => ({ id: `s${i}`, type: "evaluate_rules", params: { ruleIds: "ALL_APPLICABLE", payload: {} } }),
  create_action_draft: (i) => ({ id: `s${i}`, type: "create_action_draft", params: { actionType: "", payload: {} } }),
};

/**
 * Promote a fallback trace to a DRAFT IntentDefinition + ExecutionPlan skeleton
 * (examples=[原问句], slots 留空待人工补全). Not auto-published.
 */
export async function promoteFallbackTrace(
  repos: Repos,
  tenantId: string,
  traceId: string,
): Promise<{ intentId: string; planId: string }> {
  const trace = await repos.fallbackTraces.get(traceId);
  if (!trace || trace.tenantId !== tenantId) {
    throw new HttpError(404, "TRACE_NOT_FOUND", `fallback trace not found: ${traceId}`);
  }

  const keySuffix = traceId.slice(-8).toLowerCase();
  const steps: PlanStep[] = [];
  let i = 1;
  for (const sketch of trace.executedPlanSketch) {
    const make = SKETCH_TO_STEP[sketch.toolName];
    if (make) steps.push(make(i++));
  }
  steps.push({
    id: "render",
    type: "render_answer",
    params: { blocks: [{ type: "text", markdown: "（待补全：回答模板）" }] },
  });

  const plan: ExecutionPlan = {
    id: newId("plan"),
    packageId: trace.packageId,
    key: `promoted_${keySuffix}`,
    version: 1,
    status: "DRAFT",
    steps,
  };
  await repos.plans.insert(plan);

  const hasActionDraft = trace.executedPlanSketch.some((s) => s.toolName === "create_action_draft");
  const hasSolver = trace.executedPlanSketch.some((s) => s.toolName === "invoke_solver");
  const now = new Date().toISOString();
  const intent: IntentDefinition = {
    id: newId("int"),
    packageId: trace.packageId,
    key: `promoted_${keySuffix}`,
    version: 1,
    status: "DRAFT",
    name: `（待命名）${trace.query.slice(0, 20)}`,
    description: `由兜底查询沉淀的意图骨架。原问句：${trace.query}`,
    examples: [trace.query],
    enabledViews: [trace.view],
    slots: [], // 留空待人工补全 —— 发布校验会拒绝
    planId: plan.id,
    riskLevel: hasActionDraft ? "ACTION_DRAFT" : hasSolver ? "COMPUTE" : "READ",
    owner: "ops-promote",
    createdAt: now,
    updatedAt: now,
  };
  await repos.intents.insert(intent);
  return { intentId: intent.id, planId: plan.id };
}
