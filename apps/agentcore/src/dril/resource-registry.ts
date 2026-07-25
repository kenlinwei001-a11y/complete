import type {
  IntelligenceResource,
  ResourceSearchRequest,
  ResourceSearchResponse,
} from "@platform/contracts";
import type { Repos, IntelligenceResourceRow, ResourceRelationRow } from "../persistence/repos.js";
import type { DataCoreClient, ToolAuthCtx } from "../tools/clients.js";
import type { FeatureGate } from "../features/gate.js";
import { featureEnabled, intentAllowed, solverAllowed, type FeatureSet } from "../features/registry.js";
import {
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
import { extractTieredTags } from "./tag-taxonomy.js";
import { ResourceSearchEngine, extractContextObjectTypes, type Embedder } from "./search-engine.js";
import { extractResourceRelations, relationsOf } from "./relations.js";
import { overlayQuality } from "./quality.js";

type OntologyType = { key: string; label?: string };

/** 组装资源全文（tieredTags 派生用）。 */
function resourceText(r: IntelligenceResource): string {
  const parts = [r.label, r.description, r.capability ?? "", ...(r.answersQuestions ?? []), ...(r.tags ?? [])];
  if (r.argHints) parts.push(...Object.values(r.argHints));
  return parts.join(" ");
}

/** 资源显式声明的对象类型（L4 派生候选）。 */
function resourceObjectTypes(r: IntelligenceResource): string[] {
  const anyR = r as { scopeObjectTypes?: string[]; includedTypes?: string[]; inputSpec?: { objectTypes?: string[] } };
  return [...(anyR.scopeObjectTypes ?? []), ...(anyR.includedTypes ?? []), ...(anyR.inputSpec?.objectTypes ?? [])];
}

/**
 * WO-DRIL-P2 · 投影期回填五级标签（R14：L4 从已发布 OntologyType 派生·无手写业务对象名）。
 * 纯投影 additive：不改真值源，仅在资源上补 tieredTags 供检索加权。
 */
function enrichTieredTags(res: IntelligenceResource, ontologyTypes: OntologyType[]): IntelligenceResource {
  const tieredTags = extractTieredTags(resourceText(res), {
    domain: res.domain,
    candidateTypes: resourceObjectTypes(res),
    ontologyTypes,
  });
  return { ...res, tieredTags } as IntelligenceResource;
}

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
  /** WO-DRIL-P2 · 检索语义层向量器（缺省 pseudoEmbed；显式 null → 词法回退·fail-open）。 */
  embedder?: Embedder;
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
    const ontologyTypes = await this.collectOntologyTypes(ctx);

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
      // WO-DRIL-P2 · 投影期回填五级标签（L4 派生自已发布 OntologyType·R14）。
      resource: enrichTieredTags(p.res, ontologyTypes),
      indexedAt: now,
      updatedAt: now,
    }));

    // WO-DRIL-P3 · 派生关系（resource_relations）。仅保留两端资源均在册的边（无死路·R13）。
    const present = new Set(rows.map((r) => `${r.kind}|${r.key}`));
    const rels: ResourceRelationRow[] = extractResourceRelations({ workflows, agents, skills, rules: ruleSummaries })
      .filter((r) => present.has(`${r.fromKind}|${r.fromKey}`) && present.has(`${r.toKind}|${r.toKey}`))
      .map((r) => ({ tenantId, ...r }));

    // WO-DRIL-P3 · 回填 resource.relations（出边·供 relationStrength 打分 + /relations 端点·R6 确定序）。
    for (const row of rows) {
      const outEdges = relationsOf(rels, row.kind, row.key);
      if (outEdges.length > 0) row.resource = { ...row.resource, relations: outEdges } as IntelligenceResource;
    }

    await this.deps.repos.intelligenceResources.replaceForTenant(tenantId, rows);
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

  /** 单资源详情（P3 叠加运行时质量分·R13）。 */
  async get(ctx: ToolAuthCtx, kind: string, key: string): Promise<IntelligenceResource | undefined> {
    await this.projectTenant(ctx);
    const row = await this.deps.repos.intelligenceResources.get(ctx.tenantId, kind, key);
    if (!row) return undefined;
    const q = await this.deps.repos.resourceQualityScores.get(ctx.tenantId, kind, key);
    return overlayQuality(row.resource, q);
  }

  /**
   * WO-DRIL-P2/P3 · 混合检索（§7）。先全量重投影（R13·entitlement 前置 R3·L4 回填 R14），再交
   * ResourceSearchEngine 做 structured filter + embedding + graph traversal + 确定性加权排序。检索面 = 已开通资源全集。
   *
   * P3 补：① 叠加运行时质量分（resource_quality_scores → resource.quality·history 子分随 EWMA 移动）；
   * ② graphDistance：从 req.context 焦点类型经 DataCore planSlice BFS 求最短跳数（复用非重写·R6）；
   * ③ relationStrength：opts.selectedKeys（组包场景）→ resource.relations 指向已选中资源占比。
   */
  async search(
    ctx: ToolAuthCtx,
    req: ResourceSearchRequest,
    opts: { selectedKeys?: Set<string> } = {},
  ): Promise<ResourceSearchResponse> {
    await this.projectTenant(ctx);
    const rows = await this.deps.repos.intelligenceResources.listByTenant(ctx.tenantId);
    // ① 叠加运行时质量分（R13 派生·无分行 → 原样）。
    const qRows = await this.deps.repos.resourceQualityScores.listByTenant(ctx.tenantId);
    const qByPk = new Map(qRows.map((q) => [`${q.kind}|${q.key}`, q] as const));
    const resources = rows.map((r) => overlayQuality(r.resource, qByPk.get(`${r.kind}|${r.key}`)));

    const ontologyTypes = await this.collectOntologyTypes(ctx);
    // ② graphDistance 图：焦点类型 → 各对象类型最短跳数（planSlice BFS·fail-open 空图）。
    const focusTypes = extractContextObjectTypes(req.context);
    const hopsFromFocus = await this.buildHopsFromFocus(ctx, focusTypes, ontologyTypes);

    const engine = new ResourceSearchEngine({
      ...(this.deps.embedder !== undefined ? { embedder: this.deps.embedder } : {}),
      ontologyTypes,
      ...(hopsFromFocus.size > 0 ? { hopsFromFocus } : {}),
      ...(opts.selectedKeys ? { selectedKeys: opts.selectedKeys } : {}),
    });
    const { query, ...rest } = req;
    return engine.search(query, resources, rest);
  }

  /**
   * WO-DRIL-P3 · 焦点类型→各对象类型最短跳数（复用 DataCore `planSlice` BFS·R6·非重写）。
   * 每个焦点自身跳数 0；对全类型求最短路，取多焦点最小。fail-open：planSlice 不可达/异常 → 跳过（该类型不进图）。
   */
  private async buildHopsFromFocus(
    ctx: ToolAuthCtx,
    focusTypes: string[],
    ontologyTypes: OntologyType[],
  ): Promise<Map<string, number>> {
    const hops = new Map<string, number>();
    if (focusTypes.length === 0) return hops;
    const allKeys = ontologyTypes.map((t) => t.key);
    const relax = (target: string, d: number): void => {
      const cur = hops.get(target);
      if (cur === undefined || d < cur) hops.set(target, d);
    };
    for (const focus of focusTypes) {
      relax(focus, 0);
      const targets = allKeys.filter((k) => k !== focus);
      if (targets.length === 0) continue;
      try {
        let res = await this.deps.dataCore.ontology.planSlice(ctx, { rootType: focus, targets, maxHops: 6 });
        if (!res.ok) {
          // 部分不可达 → 只对可达目标重规划（镜像 comprehend.ts 容错·非一枝断整体退空）。
          const unreachable = new Set(res.reason.unreachable);
          const reachable = targets.filter((k) => !unreachable.has(k));
          if (reachable.length === 0) continue;
          res = await this.deps.dataCore.ontology.planSlice(ctx, { rootType: focus, targets: reachable, maxHops: 6 });
        }
        if (res.ok) for (const p of res.plan.paths) relax(p.target, p.hops.length);
      } catch {
        /* fail-open */
      }
    }
    return hops;
  }

  /** 已发布本体对象类型（best-effort·fail-open）：listObjectTypes(带中文 label)优先，退化到 listObjectTypeKeys。 */
  private async collectOntologyTypes(ctx: ToolAuthCtx): Promise<OntologyType[]> {
    try {
      const types = await this.deps.dataCore.ontology.listObjectTypes(ctx);
      if (types.length > 0) return types.map((t) => ({ key: t.key, label: t.label }));
    } catch {
      /* fail-open */
    }
    try {
      return (await this.deps.dataCore.ontology.listObjectTypeKeys(ctx)).map((k) => ({ key: k }));
    } catch {
      return [];
    }
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
