import { HttpError } from "./router/orchestrator.js";
import type { RequestAuth } from "./auth.js";
import type { Repos } from "./persistence/repos.js";
import type { DataCoreClient, ToolAuthCtx } from "./tools/clients.js";

/**
 * B→A 存在性探针（引用闭合「无死路」跨系统校验）：发布前确认 AgentCore 资源引用的
 * DataCore 制品（求解器/规则/对象类型）真实存在。**fail-open**：A 不可达或返回空集时
 * 视为"无法判定 → 放行"（不因 A 临时不可用而挡配置发布），仅在确凿"不存在"时报缺失。
 */
export async function probeMissingRefs(
  dataCore: DataCoreClient,
  ctx: ToolAuthCtx,
  refs: { solverKeys?: string[]; ruleKeys?: string[]; objectTypes?: string[] },
): Promise<{ solvers: string[]; rules: string[]; objectTypes: string[] }> {
  const missing = { solvers: [] as string[], rules: [] as string[], objectTypes: [] as string[] };
  const want = {
    solverKeys: [...new Set(refs.solverKeys ?? [])],
    ruleKeys: [...new Set(refs.ruleKeys ?? [])],
    objectTypes: [...new Set(refs.objectTypes ?? [])],
  };
  if (want.solverKeys.length > 0) {
    try {
      const { items } = await dataCore.catalog.discover(ctx, "solvers");
      const known = new Set(items.map((i) => i.key));
      if (known.size > 0) missing.solvers = want.solverKeys.filter((k) => !known.has(k));
    } catch {
      /* fail-open */
    }
  }
  if (want.ruleKeys.length > 0) {
    try {
      const known = new Set(await dataCore.rules.listRuleKeys(ctx));
      if (known.size > 0) missing.rules = want.ruleKeys.filter((k) => !known.has(k));
    } catch {
      /* fail-open */
    }
  }
  if (want.objectTypes.length > 0) {
    try {
      const known = new Set(await dataCore.ontology.listObjectTypeKeys(ctx));
      if (known.size > 0) missing.objectTypes = want.objectTypes.filter((k) => !known.has(k));
    } catch {
      /* fail-open */
    }
  }
  return missing;
}

/**
 * 管理平台增量 §4：AgentCore 资源 CRUD 统一资源模式辅助
 * （agents / workflows / skills / mcp-configs / scene-entries，与 QOS §8.4 意图目录同模式）。
 */

/** 写操作统一要求 catalog_admin（admin 超级角色 / platform_admin 平台运维放行 —— stdio 红线另有专门校验）。 */
export function requireCatalogAdmin(a: RequestAuth): void {
  const bases = a.roles.map((r) => r.split(":")[0] as string);
  if (!bases.some((r) => ["catalog_admin", "admin", "platform_admin"].includes(r))) {
    throw new HttpError(403, "FORBIDDEN", "资源管理需要 catalog_admin 角色");
  }
}

export interface ListQuery {
  status?: string;
  q?: string;
  page?: string;
}

export const RESOURCE_PAGE_SIZE = 50;

/** 列表统一过滤：?status=&q=（name/key 模糊）+ 分页 50（缺省第 1 页；响应仍为数组，total 走 x-total-count）。 */
export function applyListQuery<T extends { status?: string; lifecycle?: string; name?: string; key?: string; id: string }>(
  items: T[],
  query: ListQuery,
): { items: T[]; total: number } {
  let out = items;
  if (query.status) {
    out = out.filter((x) => x.status === query.status || x.lifecycle === query.status);
  }
  if (query.q) {
    const needle = query.q.toLowerCase();
    out = out.filter((x) =>
      [x.name, x.key, x.id].some((v) => typeof v === "string" && v.toLowerCase().includes(needle)),
    );
  }
  const total = out.length;
  const page = Math.max(1, Number(query.page ?? "1") || 1);
  return { items: out.slice((page - 1) * RESOURCE_PAGE_SIZE, page * RESOURCE_PAGE_SIZE), total };
}

export interface ResourceReference {
  kind: "agent" | "workflow" | "scene-entry" | "intent" | "scenario" | "plan";
  id: string;
  name: string;
  via: string; // 引用途径说明（tools / skills / mcpServers / defaultAgentId / plan step …）
}

export type ResourceKind = "agent" | "workflow" | "skill" | "mcp-config" | "scene-entry" | "rule" | "solver";

/** 被引用清单（删除 / 退役前置检查）：哪些 agent 用此 workflow/skill/mcp、哪些场景入口/计划步骤引用。 */
export async function computeReferences(
  repos: Repos,
  tenantId: string,
  kind: ResourceKind,
  id: string,
): Promise<ResourceReference[]> {
  const refs: ResourceReference[] = [];
  const agents = await repos.agents.listByTenant(tenantId);
  const workflows = await repos.workflows.listByTenant(tenantId);
  const sceneEntries = await repos.sceneEntries.listByTenant(tenantId);
  // 场景升一等对象后，也是引用源：scenario --defaultAgentId--> Agent（编排链可见性）。
  const scenarios = await repos.scenarios.listByTenant(tenantId);

  const stepRefs = (params: Record<string, unknown>, key: string): boolean => params[key] === id;

  if (kind === "agent") {
    for (const s of sceneEntries) {
      if (s.defaultAgentId === id) refs.push({ kind: "scene-entry", id: s.id, name: s.viewKey, via: "defaultAgentId" });
    }
    for (const sc of scenarios) {
      if (sc.defaultAgentId === id) refs.push({ kind: "scenario", id: sc.id, name: `${sc.scenarioKey}·${sc.name}`, via: "scenario.defaultAgentId" });
    }
    for (const w of workflows) {
      if (w.steps.some((st) => st.type === "invoke_agent" && stepRefs(st.params as Record<string, unknown>, "agentId"))) {
        refs.push({ kind: "workflow", id: w.id, name: w.name, via: "steps.invoke_agent" });
      }
    }
  }
  if (kind === "workflow") {
    for (const a of agents) {
      if (a.tools.some((t) => t.kind === "WORKFLOW" && t.workflowId === id)) {
        refs.push({ kind: "agent", id: a.id, name: a.name, via: "tools[kind=WORKFLOW]" });
      }
    }
  }
  if (kind === "skill") {
    for (const a of agents) {
      if (a.skills.some((s) => s.skillId === id)) refs.push({ kind: "agent", id: a.id, name: a.name, via: "skills" });
    }
  }
  if (kind === "mcp-config") {
    for (const a of agents) {
      if (a.mcpServers.some((m) => m.mcpConfigId === id) || a.tools.some((t) => t.kind === "MCP" && t.mcpConfigId === id)) {
        refs.push({ kind: "agent", id: a.id, name: a.name, via: "mcpServers/tools[kind=MCP]" });
      }
    }
    for (const w of workflows) {
      if (w.steps.some((st) => st.type === "invoke_mcp_tool" && stepRefs(st.params as Record<string, unknown>, "mcpConfigId"))) {
        refs.push({ kind: "workflow", id: w.id, name: w.name, via: "steps.invoke_mcp_tool" });
      }
    }
  }
  // rule/solver 反查（响应式失效环可见性）：改了规则/求解器 → 谁引用它（agent/workflow/plan/scenario）。
  // 规则/求解器定义在 DataCore，但其 KEY 被 AgentCore 资源引用——本反查回答"改这影响哪些编排资源"。
  if (kind === "rule" || kind === "solver") {
    const packages = await repos.packages.listByTenant(tenantId);
    const plans = (await Promise.all(packages.map((p) => repos.plans.listByPackage(p.id)))).flat();
    const refsAll = (v: string[] | "ALL_APPLICABLE"): boolean => v === "ALL_APPLICABLE";
    const hasKey = (v: string[] | "ALL_APPLICABLE"): boolean => v === "ALL_APPLICABLE" || v.includes(id);

    if (kind === "rule") {
      for (const a of agents) {
        if (hasKey(a.ruleBindings.ruleKeys)) {
          refs.push({ kind: "agent", id: a.id, name: a.name, via: refsAll(a.ruleBindings.ruleKeys) ? "ruleBindings=ALL_APPLICABLE" : "ruleBindings.ruleKeys" });
        }
      }
      for (const sc of scenarios) {
        if (sc.rules.includes(id)) refs.push({ kind: "scenario", id: sc.id, name: `${sc.scenarioKey}·${sc.name}`, via: "scenario.rules" });
      }
      for (const w of workflows) {
        if (w.steps.some((st) => st.type === "evaluate_rules" && hasKey((st.params as { ruleIds: string[] | "ALL_APPLICABLE" }).ruleIds))) {
          refs.push({ kind: "workflow", id: w.id, name: w.name, via: "steps.evaluate_rules" });
        }
      }
      for (const pl of plans) {
        if (pl.steps.some((st) => st.type === "evaluate_rules" && hasKey((st.params as { ruleIds: string[] | "ALL_APPLICABLE" }).ruleIds))) {
          refs.push({ kind: "plan", id: pl.id, name: `${pl.key}@v${pl.version}`, via: "steps.evaluate_rules" });
        }
      }
    } else {
      // solver：编排步骤显式指名 solverKey（plan/workflow 的 invoke_solver）。
      for (const w of workflows) {
        if (w.steps.some((st) => st.type === "invoke_solver" && (st.params as { solverKey?: string }).solverKey === id)) {
          refs.push({ kind: "workflow", id: w.id, name: w.name, via: "steps.invoke_solver" });
        }
      }
      for (const pl of plans) {
        if (pl.steps.some((st) => st.type === "invoke_solver" && (st.params as { solverKey?: string }).solverKey === id)) {
          refs.push({ kind: "plan", id: pl.id, name: `${pl.key}@v${pl.version}`, via: "steps.invoke_solver" });
        }
      }
    }
  }
  // scene-entry：无被引用方（入口本身是叶子）→ 恒空数组。
  return refs;
}

/** 退役：有引用必须 confirm；删除：有引用一律拒绝。 */
export function assertRetireOrDelete(
  op: "retire" | "delete",
  refs: ResourceReference[],
  confirm: boolean,
): void {
  if (refs.length === 0) return;
  const listing = refs.map((r) => `${r.kind}:${r.name}(${r.via})`).join("、");
  if (op === "delete") {
    throw new HttpError(409, "REFERENCED", `存在引用，禁止删除（请先解除或退役）：${listing}`);
  }
  if (!confirm) {
    throw new HttpError(409, "RETIRE_REQUIRES_CONFIRM", `存在引用，退役需确认（confirm=true）：${listing}`);
  }
}
