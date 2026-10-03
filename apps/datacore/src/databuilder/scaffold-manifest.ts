// A7 · ScaffoldManifest 持久记录构建（DataCore 侧单机可见 + B 上线对账）。
// 把 BuildPlan 倒推的 B 栈需求**无条件**展平成持久清单：单机/未配 AGENTCORE_BASE_URL 时全 PENDING_BSTACK
// （看得到倒推出的 agent/plan/scene 定义、但诚实标"待 B 对账生效"）；A→B 下发成功的回执覆盖为 SCAFFOLDED/REUSED/MISSING。
import type { BuildPlan, ScaffoldKind, ScaffoldManifestItem, ScaffoldManifestRecord, ScaffoldReceipt } from "@platform/contracts";

const nowIso = (): string => new Date().toISOString();

/** 从 BuildPlan 的 7 类 B 栈需求展平出 {module,key,definition}（顺序确定，R6）。 */
function flattenNeeds(plan: BuildPlan): { module: ScaffoldKind; key: string; definition: Record<string, unknown> }[] {
  const out: { module: ScaffoldKind; key: string; definition: Record<string, unknown> }[] = [];
  for (const n of plan.intentNeeds) out.push({ module: "intent", key: n.intentKey, definition: { triggers: n.triggers, slots: n.slots, planRef: n.planRef, riskLevel: n.riskLevel } });
  for (const n of plan.planNeeds) out.push({ module: "plan", key: n.planKey, definition: { steps: n.steps, solverKey: n.solverKey, args: n.args, renderBindings: n.renderBindings } });
  for (const n of plan.workflowNeeds) out.push({ module: "workflow", key: n.workflowKey, definition: { kind: n.kind, steps: n.steps } });
  for (const n of plan.skillNeeds) out.push({ module: "skill", key: n.skillKey, definition: { capability: n.capability, resources: n.resources } });
  for (const n of plan.agentNeeds) out.push({ module: "agent", key: n.agentKey, definition: { systemPrompt: n.systemPrompt, tools: n.tools, skills: n.skills, ruleBindings: n.ruleBindings, scopeObjectTypes: n.scopeObjectTypes } });
  for (const n of plan.mcpNeeds) out.push({ module: "mcp", key: n.serverName, definition: { tools: n.tools, credentialRef: n.credentialRef } });
  for (const n of plan.sceneNeeds) out.push({ module: "scene", key: n.scenarioKey, definition: { targetView: n.targetView, intentKey: n.intentKey, mode: n.mode, defaultAgentId: n.defaultAgentId } });
  return out;
}

/**
 * 构建持久 scaffold 清单（确定性）。
 * - receipt 缺省（单机/未配 B）→ 每项 PENDING_BSTACK；
 * - receipt 在线 → 按 (kind,key) 覆盖为 REUSED/SCAFFOLDED/MISSING（未在回执中的项保持 PENDING_BSTACK）。
 * 无 B 栈需求 → undefined（无清单可记）。
 */
export function buildScaffoldManifestRecord(runId: string, plan: BuildPlan | undefined, receipt?: ScaffoldReceipt): ScaffoldManifestRecord | undefined {
  if (!plan) return undefined;
  const flat = flattenNeeds(plan);
  if (flat.length === 0) return undefined;
  const byKey = new Map<string, ScaffoldReceipt["items"][number]>();
  for (const it of receipt?.items ?? []) byKey.set(`${it.kind}/${it.key}`, it);
  const items: ScaffoldManifestItem[] = flat.map((f) => {
    const r = byKey.get(`${f.module}/${f.key}`);
    return {
      module: f.module,
      key: f.key,
      status: r ? r.status : "PENDING_BSTACK",
      definition: f.definition,
      ...(r?.missingRefs ? { missingRefs: r.missingRefs } : {}),
    };
  });
  const pendingBstack = items.some((i) => i.status === "PENDING_BSTACK");
  const fullChainOk = items.every((i) => i.status === "SCAFFOLDED" || i.status === "REUSED");
  return {
    runId,
    items,
    fullChainOk,
    pendingBstack,
    ...(receipt && !pendingBstack ? { reconciledAt: nowIso() } : {}),
    recordedAt: nowIso(),
  };
}
