import { HttpError } from "./router/orchestrator.js";
import type { RequestAuth } from "./auth.js";
import type { Repos } from "./persistence/repos.js";
import type { DataCoreClient, ToolAuthCtx } from "./tools/clients.js";

/** 探针查询的注册表切面（错误信息里要指名道姓说清是哪一步失败，不许笼统"探针失败"）。 */
export type ProbeScope = "solvers" | "rules" | "objectTypes";

/**
 * 探针不可用的**成因**。两种，**修法完全不同，不许合成一句**：
 *
 * | reason | 观测到的事实 | 运维该去查什么 |
 * |---|---|---|
 * | `REGISTRY_ERROR` | 读取这一步**抛错**了 | 看 `detail` 原文——可能是不可达，也可能是鉴权失败 / 上游 5xx / 响应解析失败 |
 * | `REGISTRY_EMPTY` | 注册表**答了**，答的是 0 条已知 key | 查 A 侧种子/注册表为何空，网络是通的 |
 *
 * ⚠️ `REGISTRY_ERROR` **不等于**「网络不可达」：`DataCoreUnavailableError` 的默认报文
 * （`tools/clients.ts` 的 `"DataCore is unreachable"`）是**任何 fetch 拒绝**都会抛的那一句，
 * 它是**证据**不是**结论**。把它当结论播报出去，运维会照着去查网络，查一整天查不到东西。
 */
export type RefProbeUnavailableReason = "REGISTRY_ERROR" | "REGISTRY_EMPTY";

const PROBE_SOURCE: Record<ProbeScope, string> = {
  solvers: "求解器目录（DataCore catalog.discover(\"solvers\")）",
  rules: "已发布规则库（DataCore rules.listPublishedRuleKeys）",
  objectTypes: "本体对象类型（DataCore ontology.listObjectTypeKeys）",
};

/**
 * 门不可用 → **红**（503），而不是"无法判定 → 放行"。
 *
 * 这正是本仓一直在猎的形态：**「我没找到」和「它不存在」是两个不同的命题。**
 * 注册表读不出来（抛错）或读回空集时，探针**没有任何证据**说这些引用是合法的；
 * 旧实现在这两种情形下都静默放行，于是门整体失效**且没有任何信号**。
 */
function probeUnavailable(scope: ProbeScope, reason: "REGISTRY_ERROR" | "REGISTRY_EMPTY", detail: string): HttpError {
  // ⚠️ 措辞只许说**观测到的那一件事**：抛错就说「读取抛错」并把上游原文当证据附上，
  //    **不许**替它下「不可达」这个结论（那是 detail 里那句话的内容，不是我们的观测）。
  const what = reason === "REGISTRY_ERROR" ? `读取抛错（上游原始错误原文：${detail}）` : `返回空集（${detail}）`;
  return new RefProbeUnavailableError(
    scope,
    reason,
    detail,
    `引用可校验门不可用：${PROBE_SOURCE[scope]} ${what}——门在此状态下无法判定引用是否存在，` +
      `按「我没找到 ≠ 它不存在」一律拒绝发布（旧实现在此静默放行，门整体失效且无信号）。` +
      `请恢复 DataCore 该注册表后重试发布。`,
  );
}

/**
 * WO-SEEDGATE-FRESHNESS · 缺陷 B · **成因结构化**出口。
 *
 * 病：`reason` 原本只活在 `probeUnavailable` 的局部变量里，一拼进 message 就化成了自由文本——
 * 上层（种子门审计）只能拿到一个笼统的「门不可用」，于是把两种成因合并播报成一句
 * **「DataCore is unreachable」**。而「我读不出来」和「它不可达」是两个不同的命题。
 *
 * 修法：把成因作为**字段**随异常上抛。`extends HttpError` 是刻意的——`statusCode:503` /
 * `code:"REF_PROBE_UNAVAILABLE"` / message 三者一字不变，三条发布路（agent / workflow / skill）
 * 的既有 `instanceof HttpError` 处置与错误信封**字节兼容**，新增能力只对想读 `reason` 的调用方可见。
 */
export class RefProbeUnavailableError extends HttpError {
  constructor(
    /** 哪个注册表切面读不出（solvers / rules / objectTypes）。 */
    readonly scope: ProbeScope,
    /** 成因：抛错 vs 空集。上层据此分出两个可区分的状态，不许再二选一。 */
    readonly reason: RefProbeUnavailableReason,
    /** 上游原始错误原文（证据；`REGISTRY_EMPTY` 时是"0 条已知 key"这类事实描述）。 */
    readonly detail: string,
    message: string,
  ) {
    super(503, "REF_PROBE_UNAVAILABLE", message);
    this.name = "RefProbeUnavailableError";
  }
}

/**
 * 读一个注册表的已知 key 全集。**两层 fail-open 在此一并关死**：
 *  ① `catch` 不再静默吞——抛错即 503，并说清是哪一步（scope）失败、原始错误是什么；
 *  ② 空集不再当作"没有已知项所以都合法"——空集 = 门不可用 = 红。
 */
async function knownKeys(scope: ProbeScope, load: () => Promise<string[]>): Promise<Set<string>> {
  let keys: string[];
  try {
    keys = await load();
  } catch (e) {
    throw probeUnavailable(scope, "REGISTRY_ERROR", e instanceof Error ? e.message : String(e));
  }
  const known = new Set(keys);
  if (known.size === 0) throw probeUnavailable(scope, "REGISTRY_EMPTY", "0 条已知 key");
  return known;
}

/**
 * B→A 存在性探针（引用闭合「无死路」跨系统校验）：发布前确认 AgentCore 资源引用的
 * DataCore 制品（求解器/规则/对象类型）真实存在。
 *
 * **fail-closed（2026-08-09 起，WO-SKILL-REFCLOSURE-A）**：注册表读不出来 / 读回空集 → 抛
 * `HttpError(503, "REF_PROBE_UNAVAILABLE")`，调用方无需（也无法）自行判别可用性——
 * 抛出是刻意的 API 设计：返回一个"不可用"字段可以被下一个 dev 忽略，抛出不能。
 *
 * 旧口径（已废）：「A 不可达或返回空集时视为『无法判定 → 放行』」。那句话把两层 fail-open
 * 写成了特性，实测后果 = 注册表一读不出东西门就整体失效、且无任何信号。
 *
 * 返回形状**不变**（`{solvers, rules, objectTypes}` = 确凿不存在的 key），故三个发布路调用点
 * （agent `server.ts` / workflow `server.ts` / skill `server.ts`）的既有判缺分支一字不用改。
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
    const known = await knownKeys("solvers", async () => (await dataCore.catalog.discover(ctx, "solvers")).items.map((i) => i.key));
    missing.solvers = want.solverKeys.filter((k) => !known.has(k));
  }
  if (want.ruleKeys.length > 0) {
    // WO-REFGATE-ENT · N-01：判据是「可不可以被引用」，不是「库里有没有这条记录」——
    // 故读的是**已发布**规则集（DRAFT 规则不在其中 ⇒ 引用它的资源发布被拒）。
    const known = await knownKeys("rules", () => dataCore.rules.listPublishedRuleKeys(ctx));
    missing.rules = want.ruleKeys.filter((k) => !known.has(k));
  }
  if (want.objectTypes.length > 0) {
    const known = await knownKeys("objectTypes", () => dataCore.ontology.listObjectTypeKeys(ctx));
    missing.objectTypes = want.objectTypes.filter((k) => !known.has(k));
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
