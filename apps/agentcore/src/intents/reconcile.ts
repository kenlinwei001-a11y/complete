/**
 * WO-INTENT-MATERIALIZE-BINDING-COMPLETE 治本 ③：自动补齐（reconcile·闭环·R4 草案）。
 *
 * 对每个一等 Intent 检测缺失绑定（全绑定链 6 项）→ 自动 scaffold（DRAFT/复用既有资产）→ 出补齐报告。
 * 守 R4：任何 scaffold 只落 DRAFT / 复用既有 PUBLISHED 资产、绝不自动上真值或自动发布；补齐后 Intent
 * 状态回落 DRAFT（人工审核发布）。守 R6：同输入同补齐结果确定（scaffold id/派生皆确定性）。
 * 复用点：与 GROWTH-WORKLIST-HUMAN-FILL 同 human-gated 补齐流（缺数据→认领补；此处缺配置绑定→scaffold）。
 */
import type {
  AgentDefinition,
  IntentReconcileReport,
  MaterializedIntent,
} from "@platform/contracts";
import type { Repos } from "../persistence/repos.js";
import type { CatalogService } from "../catalog/service.js";
import { scaffoldDraftPlan } from "../growth/scaffold.js";
import { SCENARIO_CATALOG } from "../scenarios-catalog.js";
import {
  INTENT_MODE,
  materializeIntents,
  planIdForIntent,
  registeredSolverKeys,
  seedIntentSlices,
  sliceKeyForIntent,
} from "./materialize.js";

type BindingStatus = "OK" | "SCAFFOLDED" | "MISSING";

/** 播种：把 20 一等 Intent + 一等切片幂等 upsert（缺失才种；boot 与懒触发共用）。 */
export async function ensureMaterializedIntents(repos: Repos, tenantId: string): Promise<void> {
  for (const s of seedIntentSlices(tenantId)) {
    if (!(await repos.intentSlices.byKey(tenantId, s.sliceKey))) await repos.intentSlices.upsert(s);
  }
  for (const i of materializeIntents(tenantId)) {
    if (!(await repos.materializedIntents.byKey(tenantId, i.key))) await repos.materializedIntents.upsert(i);
  }
}

/** 从模板 scaffold 一个 DRAFT 场景 agent（agent-first 缺 agent 且默认 agent 也不存在时）。 */
function scaffoldDraftAgent(tenantId: string, intent: MaterializedIntent, template: AgentDefinition | undefined): AgentDefinition {
  return {
    id: `agt_scaffold_${tenantId}_${intent.key}`,
    tenantId,
    key: `${intent.key}_scaffold_agent`,
    version: 1,
    name: `${intent.name}（自动补齐草稿 agent）`,
    description: `reconcile 为 agent-first 意图 ${intent.key} 自动 scaffold 的 DRAFT agent（待人工补全/发布·R4）。`,
    model: template?.model ?? "", // 空=继承 agent 用途绑定（不钉字面量·防 roleModel 旁路 LLM_PURPOSE_UNBOUND）
    systemPrompt:
      template?.systemPrompt ??
      "你是自动补齐生成的草稿 agent。回答中每个业务数字必须来自本次工具调用结果并以 ⟦ref:N⟧ 溯源，绝不凭记忆编造。",
    tools: [{ kind: "BUILTIN", name: "invoke_solver" }, { kind: "BUILTIN", name: "evaluate_rules" }],
    ruleBindings: { ruleKeys: intent.bindings.ruleKeys.length > 0 ? [...intent.bindings.ruleKeys] : "ALL_APPLICABLE", mode: "POST_CHECK" },
    skills: [{ skillId: intent.bindings.skillId, version: "latest" }],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["invoke_solver", "evaluate_rules"] },
    budget: { maxIterations: 8, maxToolCalls: 12 },
    status: "DRAFT",
  };
}

/**
 * 补齐一个租户的全部一等 Intent（幂等·可重复调用）。返回补齐报告（每 Intent 每项 ✓/scaffold/缺）。
 */
export async function reconcileIntents(
  deps: { repos: Repos; catalog: CatalogService },
  tenantId: string,
  now = new Date().toISOString(),
): Promise<IntentReconcileReport> {
  const { repos } = deps;
  await ensureMaterializedIntents(repos, tenantId);
  const solverKeys = registeredSolverKeys();
  const intents = await repos.materializedIntents.listByTenant(tenantId);
  intents.sort((a, b) => (a.key < b.key ? -1 : 1));

  const reportIntents: IntentReconcileReport["intents"] = [];
  let scaffoldedCount = 0;

  for (const intent of intents) {
    const card = SCENARIO_CATALOG.find((c) => c.intentKey === intent.key);
    const mode = INTENT_MODE[intent.key] ?? intent.mode;
    const bindings = { ...intent.bindings };
    const bindingStatus: Record<string, BindingStatus> = {};
    const scaffolded: { binding: string; detail: string; draftRef?: string }[] = [];

    // ① solver（∈ 注册表）
    if (bindings.solverKey && solverKeys.has(bindings.solverKey)) {
      bindingStatus.solver = "OK";
    } else if (card) {
      bindings.solverKey = card.solver === "sop_balance" ? "mrp_netting" : card.solver;
      bindingStatus.solver = "SCAFFOLDED";
      scaffolded.push({ binding: "solver", detail: `solver 从场景目录重绑 ${bindings.solverKey}` });
    } else {
      bindingStatus.solver = "MISSING";
    }

    // ② evaluation 规则（≥1）
    if (bindings.ruleKeys.length > 0) {
      bindingStatus.ruleKeys = "OK";
    } else if (card && card.rules.length > 0) {
      bindings.ruleKeys = [...card.rules];
      bindingStatus.ruleKeys = "SCAFFOLDED";
      scaffolded.push({ binding: "ruleKeys", detail: `evaluation 规则从 scenario.rules 补 [${card.rules.join("、")}]` });
    } else {
      bindingStatus.ruleKeys = "MISSING";
    }

    // ③ constraint 约束（可选·本 catalog 无 constraint-typed 规则；不阻断，记 OK）
    bindingStatus.constraintKeys = "OK";

    // ④ skill（存在）
    const skill = bindings.skillId ? await repos.skills.get(bindings.skillId) : undefined;
    if (skill) {
      bindingStatus.skill = "OK";
    } else {
      const tmpl = materializeIntents(tenantId).find((i) => i.key === intent.key);
      const fallbackSkill = tmpl?.bindings.skillId ?? "skl_seed_capacity";
      bindings.skillId = fallbackSkill;
      // 若默认 skill 也不存在则诚实标 MISSING（不假装补上不存在的技能）
      bindingStatus.skill = (await repos.skills.get(fallbackSkill)) ? "SCAFFOLDED" : "MISSING";
      if (bindingStatus.skill === "SCAFFOLDED") scaffolded.push({ binding: "skill", detail: `重绑对口方法论 skill ${fallbackSkill}` });
    }

    // ⑤ 本体切片（存在于注册表）
    const wantSliceKey = bindings.ontologySliceKey || sliceKeyForIntent(intent.key);
    let slice = await repos.intentSlices.byKey(tenantId, wantSliceKey);
    if (bindings.ontologySliceKey && slice) {
      bindingStatus.slice = "OK";
    } else {
      if (!slice) {
        const seedSlice = seedIntentSlices(tenantId).find((s) => s.sliceKey === wantSliceKey);
        if (seedSlice) {
          await repos.intentSlices.upsert(seedSlice);
          slice = seedSlice;
        }
      }
      bindings.ontologySliceKey = wantSliceKey;
      bindingStatus.slice = slice ? "SCAFFOLDED" : "MISSING";
      if (bindingStatus.slice === "SCAFFOLDED") scaffolded.push({ binding: "ontologySliceKey", detail: `注册一等本体切片 ${wantSliceKey}（root=${slice?.rootType}）`, draftRef: wantSliceKey });
    }

    // ⑥ {agent | workflow}（按 mode）
    if (mode === "WORKFLOW_FIRST") {
      const wfId = bindings.workflowId;
      const plan = wfId ? await repos.plans.get(wfId) : undefined;
      if (wfId && plan && plan.status === "PUBLISHED") {
        bindingStatus.workflow = "OK";
      } else {
        const planId = planIdForIntent(intent.key, tenantId);
        const existing = await repos.plans.get(planId);
        if (existing) {
          bindings.workflowId = planId;
          bindingStatus.workflow = "SCAFFOLDED";
          scaffolded.push({ binding: "workflowId", detail: `重绑执行计划 ${planId}（${existing.status}）`, draftRef: planId });
        } else {
          await scaffoldDraftPlan(deps, tenantId, `${intent.key}_scaffold`, bindings.solverKey);
          // scaffoldDraftPlan 幂等（已存在返回空）；绑规范 draft plan key。
          bindings.workflowId = `${intent.key}_scaffold`;
          bindingStatus.workflow = "SCAFFOLDED";
          scaffolded.push({ binding: "workflowId", detail: `scaffold DRAFT 执行计划 ${intent.key}_scaffold（绑 solver ${bindings.solverKey}）`, draftRef: `${intent.key}_scaffold` });
        }
      }
      delete bindings.agentId;
    } else {
      const agId = bindings.agentId;
      const ag = agId ? await repos.agents.get(agId) : undefined;
      if (agId && ag && ag.status === "PUBLISHED") {
        bindingStatus.agent = "OK";
      } else {
        const tmpl = materializeIntents(tenantId).find((i) => i.key === intent.key);
        const defaultAgentId = tmpl?.bindings.agentId;
        const defaultAgent = defaultAgentId ? await repos.agents.get(defaultAgentId) : undefined;
        if (defaultAgent && defaultAgent.status === "PUBLISHED") {
          bindings.agentId = defaultAgentId;
          bindingStatus.agent = "SCAFFOLDED";
          scaffolded.push({ binding: "agentId", detail: `重绑场景 agent ${defaultAgentId}（PUBLISHED）`, draftRef: defaultAgentId });
        } else {
          const draft = scaffoldDraftAgent(tenantId, intent, ag ?? defaultAgent);
          if (!(await repos.agents.get(draft.id))) await repos.agents.insert(draft);
          bindings.agentId = draft.id;
          bindingStatus.agent = "SCAFFOLDED";
          scaffolded.push({ binding: "agentId", detail: `scaffold DRAFT agent ${draft.id}（待人工发布·R4）`, draftRef: draft.id });
        }
      }
      delete bindings.workflowId;
    }

    // 补齐即回落 DRAFT（R4·人工审核发布）；无补齐保持原状态。
    const status: MaterializedIntent["status"] = scaffolded.length > 0 ? "DRAFT" : intent.status;
    if (scaffolded.length > 0) {
      const updated: MaterializedIntent = {
        ...intent,
        bindings,
        status,
        reconcile: { ranAt: now, scaffolded },
        updatedAt: now,
      };
      await repos.materializedIntents.upsert(updated);
      scaffoldedCount += scaffolded.length;
    }

    reportIntents.push({ key: intent.key, mode, status, bindings: bindingStatus, scaffolded });
  }

  return { ranAt: now, total: reportIntents.length, intents: reportIntents, scaffoldedCount };
}
