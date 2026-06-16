import { HttpError } from "./router/orchestrator.js";
import type { RequestAuth } from "./auth.js";
import type { Repos } from "./persistence/repos.js";

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
  kind: "agent" | "workflow" | "scene-entry" | "intent" | "scenario";
  id: string;
  name: string;
  via: string; // 引用途径说明（tools / skills / mcpServers / defaultAgentId / plan step …）
}

export type ResourceKind = "agent" | "workflow" | "skill" | "mcp-config" | "scene-entry";

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
