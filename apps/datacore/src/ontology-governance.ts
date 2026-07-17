/**
 * 本体治理与检索体系（PRD-addendum-ontology-governance）服务。
 *
 *  §1 域治理：domains CRUD、归域强制（unassigned 阻断）、域开关切面。
 *  §2 演进稳定性：API 名不可变（§2.1）、弃用流程（§2.2）、发布影响门禁（§2.3）、
 *      引用反查（§2.4/§7.4）。
 *  §3 检索：关键词搜索（#3）、邻接导航（#4）、聚合查询（#6）——全部经 A6 数据层过滤。
 *  §7.1 域 owner 会签发布请求状态机。
 *  §7.2 切片契约 fixture 验证。
 */
import type { AuthzService } from "./authz.js";
import type {
  AuthCtx,
  DomainRecord,
  ElementRefRecord,
  LinkTypeDef,
  ObjectInstance,
  ObjectTypeDef,
  PublishRequestRecord,
  PublishSignoffRecord,
  Rule,
  SliceSpecRecord,
} from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OntologyService, primaryKeyProp as PkFn } from "./ontology.js";
import type { OntologyCoreService } from "./ontology-core.js";
import type { FeatureService } from "./features.js";
import type { Metrics } from "./metrics.js";
import type { OutboxService } from "./outbox.js";
import { primaryKeyProp } from "./ontology.js";
import { forbidden, invalidState, notFound, validationError } from "./errors.js";

void (null as unknown as typeof PkFn); // type-only import marker

const GRACE_DAYS = 90;
const SIGNOFF_BEHALF_HOURS = 72;
const SIGNOFF_EXPIRE_DAYS = 7;

/** 治理增量 §1 单位字典（场景包级；电池模板内置）。 */
export const UNIT_DICTIONARY = ["万套", "GWh", "%", "吨", "天", "元", "万元", "件", "秒"];

function displayProp(type: ObjectTypeDef | undefined): string {
  if (!type) return "name";
  const named = type.properties.find((p) => p.propKey === "name" || p.propKey === "displayName");
  return named?.propKey ?? primaryKeyProp(type);
}

function objectKeyOf(o: ObjectInstance, type: ObjectTypeDef | undefined): string {
  if (o.objectKey) return o.objectKey;
  const pk = type ? primaryKeyProp(type) : "id";
  return String(o.props[pk] ?? o.id);
}

/** crude trigram-ish similarity for the in-memory search path (pg uses pg_trgm). */
function similarity(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (!s || !t) return 0;
  if (t.includes(s)) return s.length === t.length ? 1 : 0.6 + 0.4 * (s.length / t.length);
  // token overlap fallback
  const grams = (x: string) => {
    const out = new Set<string>();
    for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2));
    if (x.length === 1) out.add(x);
    return out;
  };
  const ga = grams(s);
  const gb = grams(t);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

export class OntologyGovernanceService {
  constructor(
    private repos: Repos,
    private authz: AuthzService,
    private ontology: OntologyService,
    private ontologyCore: OntologyCoreService,
    private features: FeatureService,
    private metrics: Metrics,
    private outbox: OutboxService,
  ) {}

  // ===========================================================================
  // §1 域治理
  // ===========================================================================

  async listDomains(ctx: AuthCtx): Promise<DomainRecord[]> {
    return (await this.repos.domains.list(ctx.tenantId)).sort((a, b) =>
      a.domainKey < b.domainKey ? -1 : 1,
    );
  }

  async upsertDomain(
    ctx: AuthCtx,
    input: { domainKey: string; displayName: string; color?: string; ownerUserId?: string | null; description?: string },
  ): Promise<DomainRecord> {
    const existing = (await this.repos.domains.list(ctx.tenantId, (d) => d.domainKey === input.domainKey))[0];
    const rec: DomainRecord = {
      id: existing?.id ?? `dom_${ctx.tenantId}_${input.domainKey}`.replace(/[^\w-]/g, "_"),
      tenantId: ctx.tenantId,
      domainKey: input.domainKey,
      displayName: input.displayName,
      color: input.color,
      ownerUserId: input.ownerUserId ?? existing?.ownerUserId ?? null,
      description: input.description,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await this.repos.domains.put(rec);
    return rec;
  }

  private async domainKeySet(ctx: AuthCtx): Promise<Set<string>> {
    return new Set((await this.repos.domains.list(ctx.tenantId)).map((d) => d.domainKey));
  }

  /** §1.4 域开关：返回被关闭域的 key 集（feature `domain.{key}` 存在且 off）。 */
  async disabledDomains(tenantId: string): Promise<Set<string>> {
    const { features } = await this.features.resolve(tenantId);
    const registryKeys = new Set(this.features.registry().map((f) => f.key));
    const domains = await this.repos.domains.list(tenantId);
    const off = new Set<string>();
    for (const d of domains) {
      const fkey = `domain.${d.domainKey}`;
      // 仅当注册表里定义了该域开关 且 被解析为 off 才隐藏（未定义开关的域默认可见）。
      if (registryKeys.has(fkey) && !features.includes(fkey)) off.add(d.domainKey);
    }
    return off;
  }

  /** §1.4 域开关切面：过滤掉关域的类型。 */
  async visibleTypes(ctx: AuthCtx): Promise<ObjectTypeDef[]> {
    const types = await this.ontology.listTypes(ctx);
    const off = await this.disabledDomains(ctx.tenantId);
    if (off.size === 0) return types;
    return types.filter((t) => !t.domain || !off.has(t.domain));
  }

  // ===========================================================================
  // §2.1 API 名不可变 + §2.2 弃用流程
  // ===========================================================================

  /** §2.1：PUBLISHED type_key 重命名请求 → 拒绝并提示弃用流程（G3）。 */
  assertRenameAllowed(existing: ObjectTypeDef | undefined, nextKey: string): void {
    if (existing && existing.published && existing.key !== nextKey) {
      throw validationError(
        `type_key '${existing.key}' 一经 PUBLISHED 永不重命名（API 名不可变纪律）；语义变更请新建 key 并对旧 key 走弃用流程（POST /a/v1/ontology/types/${existing.key}/deprecate）`,
      );
    }
  }

  private graceUntil(now: Date): string {
    const d = new Date(now.getTime() + GRACE_DAYS * 86400_000);
    return d.toISOString();
  }

  /** §2.2 ACTIVE → DEPRECATED（type/link）。 */
  async deprecate(
    ctx: AuthCtx,
    kind: "type" | "link",
    key: string,
    opts: { supersededBy?: string } = {},
  ): Promise<{ key: string; deprecation: NonNullable<ObjectTypeDef["deprecation"]> }> {
    const now = new Date();
    const deprecation = {
      status: "DEPRECATED" as const,
      supersededBy: opts.supersededBy,
      deprecatedAt: now.toISOString(),
      graceUntil: this.graceUntil(now),
    };
    if (kind === "type") {
      const t = (await this.repos.ontologyTypes.list(ctx.tenantId, (x) => x.key === key))[0];
      if (!t) throw notFound(`type ${key}`);
      t.deprecation = deprecation;
      await this.repos.ontologyTypes.put(t);
    } else {
      const l = (await this.repos.ontologyLinks.list(ctx.tenantId, (x) => x.key === key))[0];
      if (!l) throw notFound(`link ${key}`);
      l.deprecation = deprecation;
      await this.repos.ontologyLinks.put(l);
    }
    return { key, deprecation };
  }

  /** §2.2 DEPRECATED → RETIRED（仅当 references=0，否则 409 列引用方）。 */
  async retire(ctx: AuthCtx, kind: "type" | "link", key: string): Promise<{ key: string; status: "RETIRED" }> {
    const refs = await this.references(ctx, { elementKind: kind, key });
    if (refs.total > 0) {
      throw invalidState(
        `${kind} '${key}' 仍被 ${refs.total} 处引用，无法 RETIRE：` +
          refs.refs.map((r) => `${r.refKind}:${r.key}@${r.where}`).join(", "),
      );
    }
    const now = new Date().toISOString();
    if (kind === "type") {
      const t = (await this.repos.ontologyTypes.list(ctx.tenantId, (x) => x.key === key))[0];
      if (!t) throw notFound(`type ${key}`);
      t.deprecation = { ...(t.deprecation ?? { status: "DEPRECATED" }), status: "RETIRED", retiredAt: now };
      await this.repos.ontologyTypes.put(t);
    } else {
      const l = (await this.repos.ontologyLinks.list(ctx.tenantId, (x) => x.key === key))[0];
      if (!l) throw notFound(`link ${key}`);
      l.deprecation = { ...(l.deprecation ?? { status: "DEPRECATED" }), status: "RETIRED", retiredAt: now };
      await this.repos.ontologyLinks.put(l);
    }
    return { key, status: "RETIRED" };
  }

  /** §2.2：新引用一个 DEPRECATED/RETIRED 元素被拒（VALIDATION_ERROR）。 */
  async assertNewRefAllowed(ctx: AuthCtx, kind: "type" | "link", keys: string[]): Promise<void> {
    for (const key of keys) {
      const dep =
        kind === "type"
          ? (await this.repos.ontologyTypes.list(ctx.tenantId, (x) => x.key === key))[0]?.deprecation
          : (await this.repos.ontologyLinks.list(ctx.tenantId, (x) => x.key === key))[0]?.deprecation;
      if (dep && (dep.status === "DEPRECATED" || dep.status === "RETIRED")) {
        throw validationError(
          `不能新建对已弃用元素 ${kind}:${key}（${dep.status}）的引用；请改引用其后继 ${dep.supersededBy ?? "(未声明)"}`,
        );
      }
    }
  }

  /**
   * §7.5 弃用警告：给定一组被引用的 key（type/link），返回涉及的 DEPRECATED 元素，
   * 用于响应头 X-Deprecated-Refs + 审计 deprecatedRefs[] + 指标。
   */
  async deprecationWarnings(
    tenantId: string,
    refs: { kind: "type" | "link"; key: string }[],
  ): Promise<{ tag: string; graceUntil?: string }[]> {
    const out: { tag: string; graceUntil?: string }[] = [];
    for (const r of refs) {
      const dep =
        r.kind === "type"
          ? (await this.repos.ontologyTypes.list(tenantId, (x) => x.key === r.key))[0]?.deprecation
          : (await this.repos.ontologyLinks.list(tenantId, (x) => x.key === r.key))[0]?.deprecation;
      if (dep && dep.status === "DEPRECATED") {
        out.push({ tag: `${r.kind}:${r.key}`, graceUntil: dep.graceUntil });
        this.metrics.inc("dc_deprecated_ref_calls_total", { kind: r.kind, key: r.key });
      }
    }
    return out;
  }

  // ===========================================================================
  // §7.4 引用反查（element_refs 索引查表）
  // ===========================================================================

  /** 发布物入库时调用：抽取一个 slice 的引用三元组（type/link）。 */
  async indexSliceRefs(ctx: AuthCtx, spec: SliceSpecRecord): Promise<void> {
    // 先清旧（覆盖式）
    const old = await this.repos.elementRefs.list(
      ctx.tenantId,
      (r) => r.refKind === "slice" && r.refKey === spec.sliceKey,
    );
    for (const r of old) await this.repos.elementRefs.remove(ctx.tenantId, r.id);
    const refs: ElementRefRecord[] = [];
    const add = (elementKind: ElementRefRecord["elementKind"], elementKey: string, where: string, prop?: string) => {
      refs.push({
        id: `eref_${spec.sliceKey}_${elementKind}_${elementKey}_${refs.length}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        elementKind,
        elementKey,
        prop,
        refKind: "slice",
        refKey: spec.sliceKey,
        refVersion: spec.version,
        where,
      });
    };
    add("type", spec.spec.root.typeKey, "root.typeKey");
    spec.spec.paths.forEach((path, pi) =>
      path.forEach((hop, hi) => {
        add("link", hop.linkKey, `paths[${pi}][${hi}].linkKey`);
      }),
    );
    for (const r of refs) await this.repos.elementRefs.put(r);
  }

  /** 发布物入库时调用：抽取一个 derivation spec 的 deps 引用。 */
  async indexDerivationRefs(
    ctx: AuthCtx,
    specKey: string,
    targetType: string,
    deps: { typeKey: string; prop: string; via?: string }[],
  ): Promise<void> {
    const old = await this.repos.elementRefs.list(
      ctx.tenantId,
      (r) => r.refKind === "derivation" && r.refKey === specKey,
    );
    for (const r of old) await this.repos.elementRefs.remove(ctx.tenantId, r.id);
    let i = 0;
    const put = async (elementKind: ElementRefRecord["elementKind"], elementKey: string, where: string, prop?: string) => {
      await this.repos.elementRefs.put({
        id: `eref_${specKey}_${elementKind}_${elementKey}_${i++}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        elementKind,
        elementKey,
        prop,
        refKind: "derivation",
        refKey: specKey,
        refVersion: "latest",
        where,
      });
    };
    await put("type", targetType, "targetType");
    for (let d = 0; d < deps.length; d++) {
      const dep = deps[d]!;
      await put("prop", dep.typeKey, `deps[${d}]`, dep.prop);
      if (dep.via) await put("link", dep.via, `deps[${d}].via`);
    }
  }

  /** GET /a/v1/ontology/references?elementKind=&key=&prop= */
  async references(
    ctx: AuthCtx,
    q: { elementKind: string; key: string; prop?: string },
  ): Promise<{ refs: { refKind: string; key: string; version: number | "latest"; where: string }[]; total: number }> {
    const rows = await this.repos.elementRefs.list(
      ctx.tenantId,
      (r) =>
        r.elementKind === q.elementKind &&
        r.elementKey === q.key &&
        (q.prop === undefined || r.prop === q.prop),
    );
    const refs = rows
      .map((r) => ({ refKind: r.refKind, key: r.refKey, version: r.refVersion, where: r.where }))
      .sort((a, b) => (a.refKind + a.key + a.where < b.refKind + b.key + b.where ? -1 : 1));
    return { refs, total: refs.length };
  }

  /** slice 反查（§2.4）：GET …/slices/{key}/references. refKind in plan/intent/agent via reportedRefs. */
  async sliceReferences(
    ctx: AuthCtx,
    sliceKey: string,
  ): Promise<{ refs: { refKind: string; key: string; version: number | "latest"; where: string }[]; total: number }> {
    // B→A 上报登记表里有引用 slice 的 plan/intent/agent
    const reported = await this.repos.reportedRefs.list(ctx.tenantId);
    const refs: { refKind: string; key: string; version: number | "latest"; where: string }[] = [];
    for (const r of reported) {
      for (const ref of r.refs) {
        if ((ref.kind === "slice" || ref.kind === "plan") && ref.key === sliceKey) {
          refs.push({ refKind: r.source.kind, key: r.source.key, version: ref.version, where: "reportedRefs" });
        }
      }
    }
    return { refs, total: refs.length };
  }

  // ===========================================================================
  // §2.3 发布影响门禁（编译期反查四类下游）
  // ===========================================================================

  /**
   * 对一个提议的下一版本类型/链接集做破坏性变更反查：删除/改型被引用的 key →
   * 返回受影响清单（非空 = 应阻断）。
   */
  async publishImpact(
    ctx: AuthCtx,
    next: { types: ObjectTypeDef[]; links: LinkTypeDef[] },
  ): Promise<{ breaking: { elementKind: string; key: string; refKind: string; refKey: string; where: string }[] }> {
    const nextTypeKeys = new Set(next.types.map((t) => t.key));
    const nextLinkKeys = new Set(next.links.map((l) => l.key));
    const nextProps = new Map<string, Set<string>>();
    for (const t of next.types) nextProps.set(t.key, new Set(t.properties.map((p) => p.propKey)));

    const cur = await this.ontology.listTypes(ctx);
    const curLinks = await this.repos.ontologyLinks.list(ctx.tenantId);
    const removedTypes = cur.filter((t) => !nextTypeKeys.has(t.key)).map((t) => t.key);
    const removedLinks = curLinks.filter((l) => !nextLinkKeys.has(l.key)).map((l) => l.key);
    const removedProps: { typeKey: string; prop: string }[] = [];
    for (const t of cur) {
      const np = nextProps.get(t.key);
      if (!np) continue; // type wholly removed handled above
      for (const p of t.properties) if (!np.has(p.propKey)) removedProps.push({ typeKey: t.key, prop: p.propKey });
    }

    const allRefs = await this.repos.elementRefs.list(ctx.tenantId);
    const breaking: { elementKind: string; key: string; refKind: string; refKey: string; where: string }[] = [];
    for (const r of allRefs) {
      const hit =
        (r.elementKind === "type" && removedTypes.includes(r.elementKey)) ||
        (r.elementKind === "link" && removedLinks.includes(r.elementKey)) ||
        (r.elementKind === "prop" &&
          removedProps.some((rp) => rp.typeKey === r.elementKey && rp.prop === r.prop));
      if (hit)
        breaking.push({ elementKind: r.elementKind, key: r.elementKey, refKind: r.refKind, refKey: r.refKey, where: r.where });
    }
    return { breaking };
  }

  // ===========================================================================
  // §7.2 切片契约 fixture 验证（发布门禁 + CI）
  // ===========================================================================

  /** 以系统校验账号（全量可见）跑每个 slice 的 contractFixtures，逐字段断言。 */
  async runSliceContracts(
    tenantId: string,
  ): Promise<{ sliceKey: string; fixture: string; ok: boolean; diff?: string }[]> {
    const sysCtx: AuthCtx = { tenantId, userId: "system:slice-contract", roles: ["admin"], attributes: {} };
    const allSpecs = await this.repos.sliceSpecs.list(tenantId);
    // latest version per sliceKey
    const latest = new Map<string, SliceSpecRecord>();
    for (const s of allSpecs) {
      const cur = latest.get(s.sliceKey);
      if (!cur || s.version > cur.version) latest.set(s.sliceKey, s);
    }
    // A3-SUITE-1：约束优先从一等 RuleEntry.params 解析，fixture 内联数组作冷启动 fallback。
    const rules = await this.repos.rules.list(tenantId);
    const ruleByKey = new Map(rules.map((r) => [r.key, r]));
    const resolveStringArray = (ref: { ruleKey: string; paramKey: string } | undefined, fallback: string[] | undefined): string[] => {
      if (!ref) return fallback ?? [];
      const rule = ruleByKey.get(ref.ruleKey);
      const v = rule?.params?.[ref.paramKey];
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
      return fallback ?? [];
    };
    const results: { sliceKey: string; fixture: string; ok: boolean; diff?: string }[] = [];
    for (const spec of latest.values()) {
      const fixtures = spec.spec.contractFixtures ?? [];
      for (const fx of fixtures) {
        try {
          const out = await this.ontologyCore.executeSlice(sysCtx, spec.spec, fx.args);
          const types = new Set(out.nodes.map((n) => n.typeKey));
          const linkKeys = new Set(out.edges.map((e) => e.linkKey));
          const mustIncludeTypes = resolveStringArray(
            fx.expect.ruleRef ? { ruleKey: fx.expect.ruleRef.ruleKey, paramKey: fx.expect.ruleRef.typesParam } : undefined,
            fx.expect.mustIncludeTypes,
          );
          const mustIncludeLinkKeys = resolveStringArray(
            fx.expect.ruleRef ? { ruleKey: fx.expect.ruleRef.ruleKey, paramKey: fx.expect.ruleRef.linksParam } : undefined,
            fx.expect.mustIncludeLinkKeys,
          );
          const rootOk = out.nodes.some((n) => n.typeKey === fx.expect.rootType);
          const minOk = out.nodes.length >= fx.expect.minNodes;
          const maxOk = fx.expect.maxNodes === undefined || out.nodes.length <= fx.expect.maxNodes;
          const typesOk = mustIncludeTypes.every((tk) => types.has(tk));
          const linksOk = mustIncludeLinkKeys.every((lk) => linkKeys.has(lk));
          const ok = rootOk && minOk && maxOk && typesOk && linksOk;
          results.push(
            ok
              ? { sliceKey: spec.sliceKey, fixture: fx.name, ok: true }
              : {
                  sliceKey: spec.sliceKey,
                  fixture: fx.name,
                  ok: false,
                  diff: `rootOk=${rootOk} minNodes=${out.nodes.length}>=${fx.expect.minNodes}?${minOk} maxOk=${maxOk} types=${[...types].join("/")} need=${mustIncludeTypes.join("/")} typesOk=${typesOk} linksOk=${linksOk}`,
                },
          );
        } catch (err) {
          results.push({ sliceKey: spec.sliceKey, fixture: fx.name, ok: false, diff: String(err) });
        }
      }
    }
    return results;
  }

  // ===========================================================================
  // §3.3 关键词搜索（#3）
  // ===========================================================================

  async search(
    ctx: AuthCtx,
    q: { q: string; types?: string[]; domains?: string[]; limit?: number },
  ): Promise<{ items: { typeKey: string; objectKey: string; display: string; domainKey: string; score: number }[]; tookMs: number }> {
    const started = Date.now();
    const needle = (q.q ?? "").trim();
    if (needle.length < 2) throw validationError("搜索关键词长度需 ≥2");
    const limit = Math.min(Math.max(1, q.limit ?? 20), 20);
    const visible = await this.visibleTypes(ctx); // 域开关切面
    const known = new Set(visible.map((t) => t.key));
    const domainKeys = await this.domainKeySet(ctx);
    const off = await this.disabledDomains(ctx.tenantId);

    // 未知 types/domains → 400 列未知项
    if (q.types && q.types.length) {
      const unknown = q.types.filter((t) => !known.has(t));
      if (unknown.length) throw validationError(`未知对象类型：${unknown.join(", ")}`);
    }
    if (q.domains && q.domains.length) {
      const unknown = q.domains.filter((d) => !domainKeys.has(d));
      if (unknown.length) throw validationError(`未知域：${unknown.join(", ")}`);
      const blocked = q.domains.filter((d) => off.has(d));
      if (blocked.length) throw validationError(`域已关闭，不可检索：${blocked.join(", ")}`);
    }

    const typeFilter = new Set(q.types ?? []);
    const domainFilter = new Set(q.domains ?? []);
    const items: { typeKey: string; objectKey: string; display: string; domainKey: string; score: number }[] = [];
    for (const type of visible) {
      if (typeFilter.size && !typeFilter.has(type.key)) continue;
      if (domainFilter.size && !(type.domain && domainFilter.has(type.domain))) continue;
      const dispProp = displayProp(type);
      const searchableProps = type.properties.filter((p) => p.searchable).map((p) => p.propKey);
      const pk = primaryKeyProp(type);
      // A6 数据层过滤经 queryObjects
      let rows: { id: string; props: Record<string, unknown> }[];
      try {
        rows = (await this.ontology.queryObjects(ctx, type.key, {}, 1000)).data as {
          id: string;
          props: Record<string, unknown>;
        }[];
      } catch {
        continue; // 无 READ 授权
      }
      for (const r of rows) {
        const candidates: string[] = [String(r.props[pk] ?? ""), String(r.props[dispProp] ?? "")];
        for (const sp of searchableProps) if (r.props[sp] != null) candidates.push(String(r.props[sp]));
        let best = 0;
        for (const c of candidates) best = Math.max(best, similarity(needle, c));
        if (best < 0.3) continue; // 相似度下限：滤掉偶然的 2-gram 噪声命中
        items.push({
          typeKey: type.key,
          objectKey: String(r.props[pk] ?? r.id),
          display: String(r.props[dispProp] ?? r.props[pk] ?? r.id),
          domainKey: type.domain ?? "unassigned",
          score: Math.round(best * 1000) / 1000,
        });
      }
    }
    items.sort((a, b) => b.score - a.score || (a.objectKey < b.objectKey ? -1 : 1));
    return { items: items.slice(0, limit), tookMs: Date.now() - started };
  }

  // ===========================================================================
  // §3.4 邻接导航（#4）
  // ===========================================================================

  async neighbors(
    ctx: AuthCtx,
    objectId: string,
    opts: { linkKey?: string; direction?: "out" | "in"; limit?: number },
  ): Promise<{ groups: { linkKey: string; direction: "out" | "in"; total: number; items: { id: string; typeKey: string; objectKey: string; display: string }[] }[] }> {
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 50);
    // resolve the source object id (allow business-key lookup) — verify it exists & visible
    const obj = await this.resolveObject(ctx, objectId);
    if (!obj) throw notFound("object");
    const links = await this.repos.links.list(ctx.tenantId);
    const linkTypes = await this.repos.ontologyLinks.list(ctx.tenantId);
    const linkByKey = new Map(linkTypes.map((l) => [l.key, l]));
    const off = await this.disabledDomains(ctx.tenantId);
    const types = await this.ontology.listTypes(ctx);
    const typeByKey = new Map(types.map((t) => [t.key, t]));

    const directions: ("out" | "in")[] = opts.direction ? [opts.direction] : ["out", "in"];
    // group key = linkKey|direction
    const groupsMap = new Map<string, { linkKey: string; direction: "out" | "in"; matched: { id: string; type: string }[] }>();
    for (const l of links) {
      if (opts.linkKey && l.type !== opts.linkKey) continue;
      const lt = linkByKey.get(l.type);
      if (!lt) continue;
      if (directions.includes("out") && l.fromId === obj.id) {
        const k = `${l.type}|out`;
        (groupsMap.get(k) ?? groupsMap.set(k, { linkKey: l.type, direction: "out", matched: [] }).get(k)!).matched.push({ id: l.toId, type: lt.toTypeKey });
      }
      if (directions.includes("in") && l.toId === obj.id) {
        const k = `${l.type}|in`;
        (groupsMap.get(k) ?? groupsMap.set(k, { linkKey: l.type, direction: "in", matched: [] }).get(k)!).matched.push({ id: l.fromId, type: lt.fromTypeKey });
      }
    }

    const groups: { linkKey: string; direction: "out" | "in"; total: number; items: { id: string; typeKey: string; objectKey: string; display: string }[] }[] = [];
    for (const g of [...groupsMap.values()].sort((a, b) => (a.linkKey + a.direction < b.linkKey + b.direction ? -1 : 1))) {
      // 域开关 + A6 行级过滤每个邻居
      const visibleItems: { id: string; typeKey: string; objectKey: string; display: string }[] = [];
      let total = 0;
      for (const m of g.matched) {
        const t = typeByKey.get(m.type);
        if (t?.domain && off.has(t.domain)) continue;
        const neighbor = await this.resolveObject(ctx, m.id);
        if (!neighbor) continue; // not visible / A6 denied
        total++;
        if (visibleItems.length < limit) {
          visibleItems.push({
            id: neighbor.id,
            typeKey: neighbor.type,
            objectKey: objectKeyOf(neighbor, t),
            display: String(neighbor.props[displayProp(t)] ?? objectKeyOf(neighbor, t)),
          });
        }
      }
      if (total > 0) groups.push({ linkKey: g.linkKey, direction: g.direction, total, items: visibleItems });
    }
    return { groups };
  }

  private async resolveObject(ctx: AuthCtx, idOrKey: string): Promise<ObjectInstance | undefined> {
    const raw = await this.repos.objects.get(ctx.tenantId, idOrKey);
    let target = raw;
    if (!target) {
      // try business-key across all types (cheap: linear). Find first match.
      for (const t of await this.ontology.listTypes(ctx)) {
        const pk = primaryKeyProp(t);
        const all = await this.repos.objects.listByType(ctx.tenantId, t.key);
        const m = all.find((o) => o.objectKey === idOrKey || o.props[pk] === idOrKey || o.id === idOrKey);
        if (m) {
          target = m;
          break;
        }
      }
    }
    if (!target) return undefined;
    // A6 visibility
    try {
      const rowFilters = await this.authz.require(ctx, "OBJECT_TYPE", target.type, "READ");
      if (!this.authz.rowAllowed(ctx, rowFilters, target.props)) return undefined;
    } catch {
      return undefined;
    }
    return target;
  }

  // ===========================================================================
  // §3.6 聚合查询（#6）
  // ===========================================================================

  async aggregate(
    ctx: AuthCtx,
    req: { typeKey: string; filter?: Record<string, unknown>; groupBy: string[]; metrics: { prop: string; fn: "count" | "sum" | "avg" | "min" | "max" }[] },
  ): Promise<{ rows: { group: Record<string, string | null>; metrics: Record<string, number | null> }[]; rowCount: number; truncated: boolean }> {
    const type = await this.ontology.getType(ctx, req.typeKey);
    if (!type) throw notFound(`type ${req.typeKey}`);
    const off = await this.disabledDomains(ctx.tenantId);
    if (type.domain && off.has(type.domain)) throw notFound(`type ${req.typeKey}`); // 关域不可见

    const propByKey = new Map(type.properties.map((p) => [p.propKey, p]));
    // fn 作用于非 number 属性 → 400（编译期校验），count 不要求 number。
    for (const m of req.metrics) {
      if (m.fn === "count") continue;
      const def = propByKey.get(m.prop);
      // derived props may not be in properties list; allow number-typed leniently if unknown.
      if (def && def.dataType !== "number") {
        throw validationError(`聚合函数 ${m.fn} 仅适用于 number 属性，但 ${req.typeKey}.${m.prop} 是 ${def.dataType}`);
      }
    }

    // A6 数据层过滤 + 全量读（不受 queryObjects 的 ≤1000 LLM 截断影响 —— 否则规模下聚合静默算错）
    const scan = await this.ontology.listVisibleForAggregate(ctx, req.typeKey, req.filter ?? {});
    const rows = scan.rows;

    // groupBy 基数保护：>500 → 400
    const groupKey = (props: Record<string, unknown>): string =>
      req.groupBy.map((g) => String(props[g] ?? "∅")).join("");
    const groups = new Map<string, { groupVals: (string | null)[]; rows: Record<string, unknown>[] }>();
    for (const r of rows) {
      const k = groupKey(r.props);
      let g = groups.get(k);
      if (!g) {
        g = { groupVals: req.groupBy.map((gb) => (r.props[gb] == null ? null : String(r.props[gb]))), rows: [] };
        groups.set(k, g);
      }
      g.rows.push(r.props);
    }
    if (groups.size > 500) {
      throw validationError("分组基数超过 500，请增加 filter 或减少 groupBy 维度");
    }

    const out: { group: Record<string, string | null>; metrics: Record<string, number | null> }[] = [];
    for (const g of groups.values()) {
      const group: Record<string, string | null> = {};
      req.groupBy.forEach((gb, i) => (group[gb] = g.groupVals[i] ?? null));
      const metrics: Record<string, number | null> = {};
      for (const m of req.metrics) {
        const key = `${m.fn}_${m.prop}`;
        if (m.fn === "count") {
          metrics[key] = g.rows.length;
          continue;
        }
        const vals = g.rows.map((p) => p[m.prop]).filter((v): v is number => typeof v === "number");
        if (vals.length === 0) {
          metrics[key] = null;
          continue;
        }
        switch (m.fn) {
          case "sum":
            metrics[key] = round6(vals.reduce((a, b) => a + b, 0));
            break;
          case "avg":
            metrics[key] = round6(vals.reduce((a, b) => a + b, 0) / vals.length);
            break;
          case "min":
            metrics[key] = Math.min(...vals);
            break;
          case "max":
            metrics[key] = Math.max(...vals);
            break;
        }
      }
      out.push({ group, metrics });
    }
    out.sort((a, b) => (JSON.stringify(a.group) < JSON.stringify(b.group) ? -1 : 1));
    return { rows: out, rowCount: out.length, truncated: scan.truncated };
  }

  // ===========================================================================
  // §7.1 域 owner 会签发布请求
  // ===========================================================================

  /**
   * 创建发布请求：先跑影响门禁（不过 → 创建失败），再按"本次变更触及的域"实例化
   * signoff 行（每域一行，owner 缺位回退 catalog_admin）。
   */
  async createPublishRequest(
    ctx: AuthCtx,
    opts: {
      ontologyVersion: number;
      touchedDomains: string[];
      impact?: { breaking: { elementKind: string; key: string; refKind: string; refKey: string; where: string }[] };
      force?: boolean;
    },
  ): Promise<PublishRequestRecord> {
    if (opts.impact && opts.impact.breaking.length > 0 && !opts.force) {
      throw invalidState(
        "发布影响门禁未通过（破坏性变更）：" +
          opts.impact.breaking.map((b) => `${b.elementKind}:${b.key}←${b.refKind}:${b.refKey}`).join(", "),
      );
    }
    const domains = await this.repos.domains.list(ctx.tenantId);
    const domByKey = new Map(domains.map((d) => [d.domainKey, d]));
    const signoffs: PublishSignoffRecord[] = [];
    for (const dk of [...new Set(opts.touchedDomains)].sort()) {
      const owner = domByKey.get(dk)?.ownerUserId ?? null;
      signoffs.push({ domainKey: dk, ownerUserId: owner, decision: null });
    }
    const rec: PublishRequestRecord = {
      id: `preq_${ctx.tenantId}_${Date.now()}_${signoffs.length}`.replace(/[^\w-]/g, "_"),
      tenantId: ctx.tenantId,
      ontologyVersion: opts.ontologyVersion,
      requestedBy: ctx.userId,
      status: signoffs.length === 0 ? "APPROVED" : "PENDING_SIGNOFF",
      signoffs,
      createdAt: new Date().toISOString(),
    };
    await this.repos.publishRequests.put(rec);
    await this.outbox.emit(ctx.tenantId, "ontology.publish_requested", { requestId: rec.id, ontologyVersion: rec.ontologyVersion });
    return rec;
  }

  async listPublishRequests(ctx: AuthCtx, status?: string): Promise<PublishRequestRecord[]> {
    const all = await this.repos.publishRequests.list(ctx.tenantId, (r) => !status || r.status === status);
    return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * 域 owner 会签。仅该 signoff 行的 owner 可签（403 否则）；catalog_admin 在 72h
   * 后可 onBehalf 代签。全域 APPROVE → APPROVED（调用方据此自动发布）；任一 REJECT → REJECTED。
   */
  async signoff(
    ctx: AuthCtx,
    requestId: string,
    body: { decision: "APPROVE" | "REJECT"; comment?: string },
    onBehalf = false,
  ): Promise<PublishRequestRecord> {
    const req = await this.repos.publishRequests.get(ctx.tenantId, requestId);
    if (!req) throw notFound("publish request");
    if (req.status !== "PENDING_SIGNOFF") throw invalidState(`发布请求已是终态 ${req.status}`);
    if (body.decision === "REJECT" && !body.comment) throw validationError("REJECT 必须填写 comment");

    const isCatalogAdmin = ctx.roles.some((r) => r.split(":")[0] === "catalog_admin");
    const ageHours = (Date.now() - new Date(req.createdAt).getTime()) / 3600_000;
    // pick the signoff row this caller may decide
    let targetRow: PublishSignoffRecord | undefined;
    if (onBehalf) {
      if (!isCatalogAdmin) throw forbidden("仅 catalog_admin 可代签");
      if (ageHours < SIGNOFF_BEHALF_HOURS) throw invalidState(`未满 ${SIGNOFF_BEHALF_HOURS}h，不可代签`);
      targetRow = req.signoffs.find((s) => s.decision === null);
    } else {
      targetRow = req.signoffs.find((s) => s.decision === null && s.ownerUserId === ctx.userId);
      if (!targetRow) throw forbidden("调用者不是任何未决域 signoff 行的 owner");
    }
    if (!targetRow) throw invalidState("无可签的 signoff 行");
    targetRow.decision = body.decision;
    targetRow.comment = body.comment;
    targetRow.decidedAt = new Date().toISOString();
    if (onBehalf) targetRow.onBehalfOf = ctx.userId;

    if (body.decision === "REJECT") {
      req.status = "REJECTED";
      req.decidedAt = new Date().toISOString();
    } else if (req.signoffs.every((s) => s.decision === "APPROVE")) {
      req.status = "APPROVED";
      req.decidedAt = new Date().toISOString();
    }
    await this.repos.publishRequests.put(req);
    return req;
  }

  /** 7 天未决 → EXPIRED（定时/惰性调用）。 */
  async expireStaleRequests(tenantId: string): Promise<number> {
    const now = Date.now();
    const all = await this.repos.publishRequests.list(tenantId, (r) => r.status === "PENDING_SIGNOFF");
    let n = 0;
    for (const r of all) {
      if ((now - new Date(r.createdAt).getTime()) / 86400_000 >= SIGNOFF_EXPIRE_DAYS) {
        r.status = "EXPIRED";
        r.decidedAt = new Date().toISOString();
        await this.repos.publishRequests.put(r);
        n++;
      }
    }
    return n;
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export type { Rule };
