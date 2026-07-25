import type { IntelligenceResource } from "@platform/contracts";
import type { Repos, IntelligenceResourceRow, ResourceRelationRow } from "../persistence/repos.js";
import type { DataCoreClient, ToolAuthCtx } from "../tools/clients.js";
import type { FeatureGate } from "../features/gate.js";
import { featureEnabled, intentAllowed, solverAllowed, type FeatureSet } from "../features/registry.js";
import {
  extractRelations,
  projectAgents,
  projectIntents,
  projectMcp,
  projectRules,
  projectSkills,
  projectSlices,
  projectSolvers,
  projectWorkflows,
  type CatalogItem,
} from "./resource-projector.js";

/**
 * WO-DRIL-P1 · ResourceRegistryService（PRD-decision-resource-intelligence-layer §6）。
 *
 * 统一注册表：把 7+ 类可发现资源投影为 `IntelligenceResource` 并落 intelligence_resources 三表，
 * 供 agent 一次 `GET /b/v1/resources` 发现全量资源。
 *
 * 关键纪律：
 * - R13 派生投影：注册表非新真值源——每次 list/get **请求态全量重投影**（replaceForTenant 幂等换新），
 *   元数据始终反映各模块当前真值（solver/slice/rule←DataCore OBO·workflow/intent/skill/agent←本地 repo·mcp←配置）。
 * - R3 entitlement 先于 authz：未开通 feature 的资源不出现（solver 走 solverAllowed·intent 走 intentAllowed·
 *   任意 kind 的 featureKey 走 featureEnabled）。DataCore 资源另在 OBO 上游二次过滤。
 * - R2 tenant：三表 PK 含 tenant_id；投影/读取一律带 tenantId。
 */

export interface ResourceListFilter {
  kind?: string;
  tag?: string;
}

export interface RegistryDeps {
  repos: Repos;
  dataCore: DataCoreClient;
  features: FeatureGate;
}

interface ProjectedWithSource {
  source: string;
  res: IntelligenceResource;
}

export class ResourceRegistryService {
  constructor(private readonly deps: RegistryDeps) {}

  /** 全量重投影本租户资源到三表（R13·幂等换新）。返回 per-kind 计数。 */
  async projectTenant(ctx: ToolAuthCtx): Promise<{ counts: Record<string, number>; total: number }> {
    const tenantId = ctx.tenantId;
    const now = new Date().toISOString();
    const enabled = await this.deps.features.enabledSet(tenantId, ctx.token);

    // --- 供给侧采集（best-effort per source·某源不可达不拖垮整体发现，G-DRIL-1 fail-open）。 ---
    let solverItems: CatalogItem[] = [];
    let sliceItems: CatalogItem[] = [];
    let ruleSummaries: import("../tools/clients.js").RuleSummary[] = [];
    try {
      solverItems = (await this.deps.dataCore.catalog.solverRegistry(ctx)).items;
    } catch {
      /* fail-open */
    }
    try {
      sliceItems = (await this.deps.dataCore.catalog.discover(ctx, "slices")).items;
    } catch {
      /* fail-open */
    }
    try {
      ruleSummaries = this.deps.dataCore.rules.listRules
        ? await this.deps.dataCore.rules.listRules(ctx)
        : (await this.deps.dataCore.rules.listRuleKeys(ctx)).map((key) => ({ key }));
    } catch {
      /* fail-open */
    }

    const workflows = await this.deps.repos.workflows.listByTenant(tenantId);
    const skills = await this.deps.repos.skills.listByTenant(tenantId);
    const agents = await this.deps.repos.agents.listByTenant(tenantId);
    const mcpConfigs = await this.deps.repos.mcpConfigs.listByTenant(tenantId);
    const packages = await this.deps.repos.packages.listByTenant(tenantId);
    const intents = (
      await Promise.all(packages.map((p) => this.deps.repos.intents.listByPackage(p.id)))
    ).flat();

    // --- 投影 + R3 entitlement 过滤。 ---
    const projected: ProjectedWithSource[] = [];
    for (const r of projectSolvers(solverItems)) {
      if (solverAllowed(enabled, r.key)) projected.push({ source: "datacore", res: r });
    }
    for (const r of projectSlices(sliceItems)) projected.push({ source: "datacore", res: r });
    for (const r of projectRules(ruleSummaries)) projected.push({ source: "datacore", res: r });
    for (const r of projectWorkflows(workflows)) projected.push({ source: "agentcore", res: r });
    for (const r of projectIntents(intents)) {
      if (intentAllowed(enabled, r.key)) projected.push({ source: "agentcore", res: r });
    }
    for (const r of projectSkills(skills)) projected.push({ source: "agentcore", res: r });
    for (const r of projectAgents(agents)) projected.push({ source: "agentcore", res: r });
    for (const r of projectMcp(mcpConfigs)) projected.push({ source: "mcp", res: r });

    // 通用 featureKey 门（R3）：任一 kind 带 featureKey 且未开通 → 丢弃。
    const entitled = projected.filter((p) => featureKeyOk(enabled, p.res.featureKey));

    // 去重 (kind,key)：同 key 多版本（workflow/agent/skill/intent）保留最高 version。
    const byPk = new Map<string, ProjectedWithSource>();
    for (const p of entitled) {
      const pk = `${p.res.kind}|${p.res.key}`;
      const prev = byPk.get(pk);
      if (!prev || versionOf(p.res) >= versionOf(prev.res)) byPk.set(pk, p);
    }

    const rows: IntelligenceResourceRow[] = [...byPk.values()].map((p) => ({
      tenantId,
      kind: p.res.kind,
      key: p.res.key,
      source: p.source,
      resource: p.res,
      indexedAt: now,
      updatedAt: now,
    }));
    await this.deps.repos.intelligenceResources.replaceForTenant(tenantId, rows);

    // 派生关系（resource_relations）。仅保留两端资源均在册的边（无死路）。
    const present = new Set(rows.map((r) => `${r.kind}|${r.key}`));
    const rels: ResourceRelationRow[] = extractRelations({ workflows, agents, skills, rules: ruleSummaries })
      .filter((r) => present.has(`${r.fromKind}|${r.fromKey}`) && present.has(`${r.toKind}|${r.toKey}`))
      .map((r) => ({ tenantId, ...r }));
    await this.deps.repos.resourceRelations.replaceForTenant(tenantId, rels);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return { counts, total: rows.length };
  }

  /** 列表（kind/tag/entitlement 过滤）。先全量重投影（R13），再从表读回。 */
  async list(ctx: ToolAuthCtx, filter: ResourceListFilter = {}): Promise<IntelligenceResource[]> {
    await this.projectTenant(ctx);
    let rows = await this.deps.repos.intelligenceResources.listByTenant(ctx.tenantId);
    if (filter.kind) rows = rows.filter((r) => r.kind === filter.kind);
    if (filter.tag) {
      const tag = filter.tag;
      rows = rows.filter((r) => matchesTag(r.resource, tag));
    }
    return rows
      .sort((a, b) => (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind.localeCompare(b.kind)))
      .map((r) => r.resource);
  }

  /** 单资源详情。 */
  async get(ctx: ToolAuthCtx, kind: string, key: string): Promise<IntelligenceResource | undefined> {
    await this.projectTenant(ctx);
    const row = await this.deps.repos.intelligenceResources.get(ctx.tenantId, kind, key);
    return row?.resource;
  }
}

function featureKeyOk(enabled: FeatureSet, featureKey?: string): boolean {
  return !featureKey || featureEnabled(enabled, featureKey);
}

function versionOf(res: IntelligenceResource): number {
  const gov = (res as { governance?: { version?: number } }).governance;
  return gov?.version ?? 0;
}

function matchesTag(res: IntelligenceResource, tag: string): boolean {
  if ((res.tags ?? []).includes(tag)) return true;
  const t = res.tieredTags;
  if (!t) return false;
  return [t.l1_domain, t.l2_decisionType, t.l3_scenario, t.l4_object, t.l5_algorithm].some((arr) =>
    (arr ?? []).includes(tag),
  );
}
