/**
 * 本体服务原子规格引擎（PRD-addendum-ontology-core）。
 *
 * 与早期 OntologyService 并存、additive：
 *  §1 epoch/snapshotVersion、temporal 历史、本体版本演进校验（迁移声明）。
 *  §2 派生公式 DSL 编译（解析→deps 缓存）、依赖图 Kahn 拓扑 + 环拒绝、增量重算
 *      （沿 to_id 反向导航定受影响对象集）、求值语义（null 传播/COALESCE/除零/decimal）。
 *  §3 resolveSlice 声明式切片执行（批量 IN 展开、每跳后 A6 行级过滤剪枝、去重、截断）。
 */
import type { AuthzService } from "./authz.js";
import type {
  AuthCtx,
  DerivationSpecRecord,
  LinkInstance,
  LinkTypeDef,
  ObjectInstance,
  ObjectTypeDef,
  PropertyDef,
  SliceSpecRecord,
} from "./domain.js";
import { newId } from "./ids.js";
import { AppError } from "./errors.js";

/** §2.3 环拒绝错误：携带环路径供 O3 断言。 */
export class CyclicDerivationError extends AppError {
  constructor(public readonly cycle: string[]) {
    super("CYCLIC_DERIVATION", `派生公式存在环：${cycle.join(" → ")}`, 400);
  }
}
import type { Repos } from "./repo/repo.js";
import {
  evaluate,
  extractDeps,
  parseFormula,
  type Ast,
  type Dep,
  type NavNode,
} from "./ontology-dsl.js";

export interface PublishOptions {
  /** 迁移声明：被删除/改型且有数据的属性，必须显式声明 dropData 或 rename。 */
  migrations?: { typeKey: string; prop: string; dropData?: boolean; renameTo?: string }[];
}

export interface ChangeSet {
  typeKey: string;
  prop: string;
  objectIds: string[];
}

export interface RecomputeResult {
  updatedObjects: number;
  affectedObjectIds: string[];
  order: string[]; // (typeKey.prop) in topo order
  epoch: number;
  /** generic-inference dryRun：受影响派生属性的 before/after（不持久化时返回）。 */
  dryRunDeltas?: { objId: string; type: string; prop: string; before: unknown; after: unknown }[];
}

/** PropertyDef extended with the atomic-spec fields carried in props metadata. */
function pkOf(type: ObjectTypeDef): string {
  return type.properties.find((p) => p.isPrimaryKey)?.propKey ?? "id";
}

function temporalProps(type: ObjectTypeDef): Set<string> {
  const out = new Set<string>();
  for (const p of type.properties) if (p.temporal) out.add(p.propKey);
  return out;
}

export class OntologyCoreService {
  constructor(
    private repos: Repos,
    private authz: AuthzService,
  ) {}

  // -- §1 epoch / snapshotVersion -------------------------------------------

  /** snapshotVersion = "{ontology_version}.{epoch}". */
  async snapshotVersion(tenantId: string): Promise<string> {
    const versions = await this.repos.ontologyVersions.list(tenantId);
    const ov = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
    const epoch = await this.repos.epochs.current(tenantId);
    return `${ov}.${epoch}`;
  }

  /** Open a write batch: allocate a fresh tenant epoch (all rows in the batch share it). */
  async beginEpoch(tenantId: string): Promise<number> {
    return this.repos.epochs.next(tenantId);
  }

  // -- §1 instance writes (upsert by business key, temporal history) ---------

  /**
   * Upsert an object by its business key (objectKey). Same (tenant, type, objectKey)
   * → byte-identical id → upsert semantics (O1). temporal props append to history.
   */
  async upsertObject(
    ctx: AuthCtx,
    typeKey: string,
    objectKey: string,
    props: Record<string, unknown>,
    opts: { epoch: number; origin?: ObjectInstance["origin"]; provenance?: Record<string, unknown> },
  ): Promise<ObjectInstance> {
    const id = `obj_${typeKey}_${objectKey}`.replace(/[^\w-]/g, "_");
    const type = await this.getActiveType(ctx, typeKey);
    const temporal = type ? temporalProps(type) : new Set<string>();
    const existing = await this.repos.objects.get(ctx.tenantId, id);
    const nowIso = new Date().toISOString();
    // temporal history: append on change of any temporal prop.
    if (existing) {
      for (const p of temporal) {
        if (p in props && props[p] !== existing.props[p]) {
          await this.appendHistory(ctx.tenantId, id, p, props[p], opts.epoch, nowIso, opts.provenance);
        }
      }
    } else {
      for (const p of temporal) {
        if (p in props) await this.appendHistory(ctx.tenantId, id, p, props[p], opts.epoch, nowIso, opts.provenance);
      }
    }
    const rec: ObjectInstance = {
      id,
      tenantId: ctx.tenantId,
      type: typeKey,
      objectKey,
      props: { ...(existing?.props ?? {}), ...props },
      origin: opts.origin ?? existing?.origin ?? { type: "MANUAL" },
      epoch: opts.epoch,
      updatedAt: nowIso,
    };
    await this.repos.objects.put(rec);
    return rec;
  }

  private async appendHistory(
    tenantId: string,
    objectId: string,
    prop: string,
    value: unknown,
    epoch: number,
    validFrom: string,
    provenance?: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.objectPropHistory.put({
      id: newId("ophist"),
      tenantId,
      objectId,
      prop,
      value,
      epoch,
      validFrom,
      recordedAt: validFrom,
      ...(provenance ? { provenance } : {}),
    });
  }

  private async getActiveType(ctx: AuthCtx, key: string): Promise<ObjectTypeDef | undefined> {
    const types = await this.repos.ontologyTypes.list(
      ctx.tenantId,
      (t) => t.key === key && t.status === "ACTIVE",
    );
    return types[0];
  }

  // -- §1 version evolution validation --------------------------------------

  /**
   * Validate a proposed next ontology version against live instance data.
   * Removing/retyping a property that has instance data requires a migration
   * declaration (dropData:true or renameTo); otherwise reject (O7).
   * Returns the list of errors (empty = OK).
   */
  async validateEvolution(
    ctx: AuthCtx,
    nextTypes: ObjectTypeDef[],
    opts: PublishOptions = {},
  ): Promise<{ typeKey: string; prop: string; message: string }[]> {
    const errors: { typeKey: string; prop: string; message: string }[] = [];
    const current = await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
    const nextByKey = new Map(nextTypes.map((t) => [t.key, t]));
    const declared = new Map(
      (opts.migrations ?? []).map((m) => [`${m.typeKey}|${m.prop}`, m]),
    );
    for (const cur of current) {
      const next = nextByKey.get(cur.key);
      const curProps = new Map(cur.properties.map((p) => [p.propKey, p]));
      const nextProps = next ? new Map(next.properties.map((p) => [p.propKey, p])) : new Map();
      for (const [propKey, curDef] of curProps) {
        const nextDef = nextProps.get(propKey) as PropertyDef | undefined;
        const removed = !next || !nextDef;
        const retyped = nextDef && nextDef.dataType !== curDef.dataType;
        if (!removed && !retyped) continue;
        const objects = await this.repos.objects.listByType(ctx.tenantId, cur.key);
        const hasData = objects.some((o) => o.props[propKey] !== undefined && o.props[propKey] !== null);
        if (!hasData) continue;
        const m = declared.get(`${cur.key}|${propKey}`);
        if (m && (m.dropData || m.renameTo)) continue;
        errors.push({
          typeKey: cur.key,
          prop: propKey,
          message: removed
            ? `属性 ${cur.key}.${propKey} 有实例数据，删除需迁移声明（dropData:true 或 renameTo）`
            : `属性 ${cur.key}.${propKey} 有实例数据，改型需迁移声明`,
        });
      }
    }
    return errors;
  }

  // -- §2.3 compile derivation specs (parse → deps → cycle check) -----------

  /**
   * Compile a set of derivation specs for an ontology version: parse each formula,
   * extract deps, build the (typeKey,prop) dependency graph, Kahn topo-sort, and
   * reject cycles with CYCLIC_DERIVATION (including the cycle path). Persists the
   * compiled specs (with cached deps) on success and returns the topo order.
   */
  async compileSpecs(
    ctx: AuthCtx,
    ontologyVersion: number,
    specs: { specKey: string; targetType: string; targetProp: string; formula: string }[],
  ): Promise<{ order: { typeKey: string; prop: string }[]; specs: DerivationSpecRecord[] }> {
    const linkTypes = await this.repos.ontologyLinks.list(ctx.tenantId);
    const linkResolve = this.makeLinkResolver(linkTypes);
    const compiled: { rec: DerivationSpecRecord; ast: Ast }[] = [];
    for (const s of specs) {
      const ast = parseFormula(s.formula);
      const deps = extractDeps(ast, s.targetType, linkResolve);
      compiled.push({
        ast,
        rec: {
          id: `dspec_${s.specKey}`.replace(/[^\w-]/g, "_"),
          tenantId: ctx.tenantId,
          ontologyVersion,
          specKey: s.specKey,
          targetType: s.targetType,
          targetProp: s.targetProp,
          formula: s.formula,
          deps,
          status: "ACTIVE",
        },
      });
    }
    const order = this.topoSort(compiled.map((c) => c.rec));
    for (const c of compiled) await this.repos.derivationSpecs.put(c.rec);
    return { order, specs: compiled.map((c) => c.rec) };
  }

  private makeLinkResolver(
    linkTypes: LinkTypeDef[],
  ): (linkKey: string, direction: "out" | "in") => string | undefined {
    const byKey = new Map(linkTypes.map((l) => [l.key, l]));
    return (linkKey, direction) => {
      const lt = byKey.get(linkKey);
      if (!lt) return undefined;
      // out = from → to: navigated objects are the to-side type; in = to → from.
      return direction === "out" ? lt.toTypeKey : lt.fromTypeKey;
    };
  }

  /**
   * Kahn topological sort over the (typeKey,prop) dependency graph built from spec
   * deps. Nodes that are derivation targets depend on the nodes they read. Throws
   * CYCLIC_DERIVATION with the cycle path on a cycle.
   */
  topoSort(specs: DerivationSpecRecord[]): { typeKey: string; prop: string }[] {
    const node = (t: string, p: string) => `${t}.${p}`;
    const specNodes = new Set(specs.map((s) => node(s.targetType, s.targetProp)));
    // edges: dep → target (target depends on dep). Only edges between derived nodes
    // matter for ordering; leaf deps (non-derived props) impose no ordering constraint.
    const adj = new Map<string, Set<string>>(); // dep → set(targets)
    const indeg = new Map<string, number>();
    for (const n of specNodes) indeg.set(n, 0);
    for (const s of specs) {
      const target = node(s.targetType, s.targetProp);
      for (const d of s.deps) {
        const depNode = node(d.typeKey, d.prop);
        if (!specNodes.has(depNode)) continue; // leaf dependency, no ordering edge
        if (!adj.has(depNode)) adj.set(depNode, new Set());
        if (!adj.get(depNode)!.has(target)) {
          adj.get(depNode)!.add(target);
          indeg.set(target, (indeg.get(target) ?? 0) + 1);
        }
      }
    }
    const queue: string[] = [];
    for (const [n, d] of indeg) if (d === 0) queue.push(n);
    queue.sort();
    const order: string[] = [];
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(n);
      const nexts = [...(adj.get(n) ?? [])].sort();
      for (const m of nexts) {
        indeg.set(m, (indeg.get(m) ?? 0) - 1);
        if (indeg.get(m) === 0) queue.push(m);
      }
    }
    if (order.length !== specNodes.size) {
      const cyclePath = this.findCycle(specNodes, adj);
      throw new CyclicDerivationError(cyclePath.length ? cyclePath : [...specNodes]);
    }
    return order.map((n) => {
      const idx = n.lastIndexOf(".");
      return { typeKey: n.slice(0, idx), prop: n.slice(idx + 1) };
    });
  }

  private findCycle(nodes: Set<string>, adj: Map<string, Set<string>>): string[] {
    const color = new Map<string, number>(); // 0 white,1 gray,2 black
    const stack: string[] = [];
    let cycle: string[] = [];
    const dfs = (n: string): boolean => {
      color.set(n, 1);
      stack.push(n);
      for (const m of adj.get(n) ?? []) {
        if (color.get(m) === 1) {
          const i = stack.indexOf(m);
          cycle = stack.slice(i).concat(m);
          return true;
        }
        if ((color.get(m) ?? 0) === 0 && dfs(m)) return true;
      }
      stack.pop();
      color.set(n, 2);
      return false;
    };
    for (const n of nodes) if ((color.get(n) ?? 0) === 0) if (dfs(n)) break;
    return cycle;
  }

  // -- §2.4 incremental recompute -------------------------------------------

  /**
   * Recompute derived values affected by a change set. Determines affected specs by
   * reverse dependency closure, resolves affected target objects by reverse link
   * navigation (to_id index), recomputes only those objects in topo order, writes
   * values + temporal history + a derivation_value_run (inputs snapshot + epoch).
   */
  async recompute(
    ctx: AuthCtx,
    changes: ChangeSet[],
    opts?: { epoch?: number; dryRun?: boolean; apply?: { objectId: string; prop: string; value: unknown }[] },
  ): Promise<RecomputeResult> {
    // generic-inference 通用 what-if（PRD-generic-inference §3.1 / R4 不写真值）：
    // dryRun 时在克隆图上前向重算，绝不持久化、绝不 mutate 原对象，返回派生 before/after。
    const dryRun = opts?.dryRun ?? false;
    const dryRunDeltas: { objId: string; type: string; prop: string; before: unknown; after: unknown }[] = [];
    const epoch = dryRun ? 0 : (opts?.epoch ?? (await this.beginEpoch(ctx.tenantId)));
    const allSpecs = await this.repos.derivationSpecs.list(
      ctx.tenantId,
      (s) => s.status === "ACTIVE",
    );
    const topo = this.topoSort(allSpecs);
    const specByNode = new Map(allSpecs.map((s) => [`${s.targetType}.${s.targetProp}`, s]));
    const types = await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
    const links = await this.repos.links.list(ctx.tenantId);
    const linkTypes = await this.repos.ontologyLinks.list(ctx.tenantId);
    const linkByKey = new Map(linkTypes.map((l) => [l.key, l]));

    // Index objects by id and links by (linkKey, fromId)/(linkKey, toId) for navigation.
    const objectIndex = new Map<string, ObjectInstance>();
    for (const t of types) {
      for (const o of await this.repos.objects.listByType(ctx.tenantId, t.key)) objectIndex.set(o.id, dryRun ? structuredClone(o) : o);
    }
    // generic-inference what-if：把假设的源属性值套到克隆对象上（仅 dryRun），再前向重算下游派生。
    if (dryRun && opts?.apply) {
      for (const a of opts.apply) {
        const o = objectIndex.get(a.objectId);
        if (o) o.props[a.prop] = a.value;
      }
    }
    const navOut = new Map<string, LinkInstance[]>(); // `${linkKey}|${fromId}`
    const navIn = new Map<string, LinkInstance[]>(); // `${linkKey}|${toId}`
    for (const l of links) {
      const ko = `${l.type}|${l.fromId}`;
      const ki = `${l.type}|${l.toId}`;
      (navOut.get(ko) ?? navOut.set(ko, []).get(ko)!).push(l);
      (navIn.get(ki) ?? navIn.set(ki, []).get(ki)!).push(l);
    }

    // Seed dirty set: (specNode) → set of affected object ids.
    const dirty = new Map<string, Set<string>>();
    const markDirty = (specNode: string, objId: string) => {
      if (!dirty.has(specNode)) dirty.set(specNode, new Set());
      dirty.get(specNode)!.add(objId);
    };

    // For each change, find specs that depend on (typeKey, prop) and the affected targets.
    const propToSpecs = new Map<string, DerivationSpecRecord[]>();
    for (const s of allSpecs) {
      for (const d of s.deps) {
        const key = `${d.typeKey}.${d.prop}`;
        (propToSpecs.get(key) ?? propToSpecs.set(key, []).get(key)!).push(s);
        // COUNT/* deps also react to any prop change of the navigated type — handled via "*".
      }
    }

    const resolveAffectedTargets = (spec: DerivationSpecRecord, changedObjIds: string[]): string[] => {
      // Self dep (this.x on same type): the changed object is itself the target.
      const out = new Set<string>();
      const selfDeps = spec.deps.filter((d) => d.typeKey === spec.targetType && !d.via);
      const navDeps = spec.deps.filter((d) => d.via);
      for (const objId of changedObjIds) {
        const obj = objectIndex.get(objId);
        if (!obj) continue;
        if (selfDeps.length > 0 && obj.type === spec.targetType) out.add(objId);
        for (const d of navDeps) {
          // The changed object is a navigated source; reverse the link to find targets.
          const lt = linkByKey.get(d.via!);
          if (!lt) continue;
          // target navigates d.direction to reach changed object → reverse direction.
          if (d.direction === "out") {
            // target --out(link)--> changed ⇒ link.toId == changed, target == link.fromId
            for (const l of navIn.get(`${d.via}|${objId}`) ?? []) {
              const cand = objectIndex.get(l.fromId);
              if (cand && cand.type === spec.targetType) out.add(l.fromId);
            }
          } else {
            // target --in(link)--> changed means changed --out(link)--> ... ; target == link.toId where link.fromId == changed
            for (const l of navOut.get(`${d.via}|${objId}`) ?? []) {
              const cand = objectIndex.get(l.toId);
              if (cand && cand.type === spec.targetType) out.add(l.toId);
            }
          }
        }
      }
      return [...out];
    };

    for (const ch of changes) {
      const direct = propToSpecs.get(`${ch.typeKey}.${ch.prop}`) ?? [];
      const wildcard = propToSpecs.get(`${ch.typeKey}.*`) ?? [];
      for (const s of [...direct, ...wildcard]) {
        for (const tid of resolveAffectedTargets(s, ch.objectIds)) {
          markDirty(`${s.targetType}.${s.targetProp}`, tid);
        }
      }
    }

    // Propagate along the topo order: once a derived prop changes, downstream specs
    // that depend on it must recompute for the targets reachable from the changed objects.
    const affected = new Set<string>();
    const valueRuns: { spec: DerivationSpecRecord; objId: string; value: unknown; inputs: { objectId: string; prop: string; value: unknown }[]; warnings: string[] }[] = [];

    for (const tnode of topo) {
      const specNode = `${tnode.typeKey}.${tnode.prop}`;
      const spec = specByNode.get(specNode);
      if (!spec) continue;
      const targets = dirty.get(specNode);
      if (!targets || targets.size === 0) continue;
      const ast = parseFormula(spec.formula);
      for (const objId of [...targets].sort()) {
        const obj = objectIndex.get(objId);
        if (!obj) continue;
        const inputs: { objectId: string; prop: string; value: unknown }[] = [];
        const warnings: string[] = [];
        const navigate = (nav: NavNode): Record<string, unknown>[] => {
          const lt = linkByKey.get(nav.linkKey);
          if (!lt) return [];
          const navLinks =
            nav.direction === "out"
              ? navOut.get(`${nav.linkKey}|${obj.id}`) ?? []
              : navIn.get(`${nav.linkKey}|${obj.id}`) ?? [];
          const result: Record<string, unknown>[] = [];
          for (const l of navLinks) {
            const otherId = nav.direction === "out" ? l.toId : l.fromId;
            const other = objectIndex.get(otherId);
            if (other) result.push(other.props);
          }
          return result;
        };
        // capture inputs (own deps + navigated deps) for provenance (溯源弹窗数据源)
        for (const d of spec.deps) {
          if (!d.via) {
            inputs.push({ objectId: obj.id, prop: d.prop, value: obj.props[d.prop] });
          } else if (d.prop !== "*") {
            const lt = linkByKey.get(d.via);
            const navLinks =
              d.direction === "out"
                ? navOut.get(`${d.via}|${obj.id}`) ?? []
                : navIn.get(`${d.via}|${obj.id}`) ?? [];
            for (const l of navLinks) {
              const otherId = d.direction === "out" ? l.toId : l.fromId;
              const other = objectIndex.get(otherId);
              if (lt && other) inputs.push({ objectId: other.id, prop: d.prop, value: other.props[d.prop] });
            }
          }
        }
        const value = evaluate(ast, { self: obj.props, navigate, warn: (m) => warnings.push(m) });
        const prev = obj.props[spec.targetProp];
        const changed = prev !== value;
        obj.props[spec.targetProp] = value;
        obj.epoch = epoch;
        if (dryRun) {
          if (changed) dryRunDeltas.push({ objId: obj.id, type: obj.type, prop: spec.targetProp, before: prev, after: value });
        } else {
          await this.repos.objects.put(obj);
        }
        objectIndex.set(obj.id, obj);
        valueRuns.push({ spec, objId: obj.id, value, inputs, warnings });
        affected.add(obj.id);
        if (changed) {
          // cascade: downstream specs depending on (targetType, targetProp)
          const downstream = (propToSpecs.get(`${spec.targetType}.${spec.targetProp}`) ?? []).concat(
            propToSpecs.get(`${spec.targetType}.*`) ?? [],
          );
          for (const ds of downstream) {
            for (const tid of resolveAffectedTargets(ds, [obj.id])) {
              markDirty(`${ds.targetType}.${ds.targetProp}`, tid);
            }
          }
        }
      }
    }

    const ranAt = new Date().toISOString();
    for (const vr of dryRun ? [] : valueRuns) {
      await this.repos.derivationValueRuns.put({
        id: newId("dvrun"),
        tenantId: ctx.tenantId,
        specId: vr.spec.id,
        specKey: vr.spec.specKey,
        objectId: vr.objId,
        targetProp: vr.spec.targetProp,
        value: vr.value,
        inputs: vr.inputs,
        epoch,
        ranAt,
        ...(vr.warnings.length ? { warnings: vr.warnings } : {}),
      });
    }

    return {
      updatedObjects: affected.size,
      affectedObjectIds: [...affected].sort(),
      order: topo.map((t) => `${t.typeKey}.${t.prop}`),
      epoch,
      ...(dryRun ? { dryRunDeltas } : {}),
    };
  }

  // -- §3 resolveSlice ------------------------------------------------------

  /**
   * Execute a declarative slice spec: select root, expand each path hop-by-hop via
   * batch IN, apply A6 row filtering after each hop (pruning invisible subtrees),
   * dedupe by id across paths, truncate at maxNodes. {{args.x}} only ever flows in
   * as a literal filter value (parameterised — no injection surface, O10).
   */
  async executeSlice(
    ctx: AuthCtx,
    spec: SliceSpecRecord["spec"],
    args: Record<string, unknown>,
  ): Promise<{
    nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }[];
    edges: { linkKey: string; from: string; to: string }[];
    truncated: boolean;
    snapshotVersion: string;
  }> {
    const snapshotVersion = await this.snapshotVersion(ctx.tenantId);
    const maxNodes = Math.min(spec.maxNodes ?? 500, 1000);
    const links = await this.repos.links.list(ctx.tenantId);
    const linkTypes = await this.repos.ontologyLinks.list(ctx.tenantId);
    const linkByKey = new Map(linkTypes.map((l) => [l.key, l]));

    // Row-filter cache per type: a type is visible per A6 grants + rowFilter.
    const visibleCache = new Map<string, (o: ObjectInstance) => boolean>();
    const visibilityFor = async (typeKey: string): Promise<(o: ObjectInstance) => boolean> => {
      if (visibleCache.has(typeKey)) return visibleCache.get(typeKey)!;
      let rowFilters: string[] = [];
      let denied = false;
      try {
        rowFilters = await this.authz.require(ctx, "OBJECT_TYPE", typeKey, "READ");
      } catch {
        denied = true;
      }
      const fn = denied ? () => false : (o: ObjectInstance) => this.authz.rowAllowed(ctx, rowFilters, o.props);
      visibleCache.set(typeKey, fn);
      return fn;
    };

    const objCache = new Map<string, ObjectInstance[]>();
    const objectsOfType = async (typeKey: string): Promise<ObjectInstance[]> => {
      if (!objCache.has(typeKey)) objCache.set(typeKey, await this.repos.objects.listByType(ctx.tenantId, typeKey));
      return objCache.get(typeKey)!;
    };

    const resolveTemplate = (v: unknown): unknown => {
      if (typeof v !== "string") return v;
      const m = /^\{\{\s*args\.([\w]+)\s*\}\}$/.exec(v);
      if (m) return args[m[1] as string];
      return v;
    };
    const matchFilter = (props: Record<string, unknown>, filter?: Record<string, unknown>): boolean => {
      if (!filter) return true;
      for (const [k, raw] of Object.entries(filter)) {
        const want = resolveTemplate(raw);
        const actual = props[k];
        if (Array.isArray(actual)) {
          if (!actual.includes(want)) return false;
        } else if (actual !== want) return false;
      }
      return true;
    };

    // --- root selection (A6 filtered) ---
    const rootVisible = await visibilityFor(spec.root.typeKey);
    const rootType = await this.getActiveType(ctx, spec.root.typeKey);
    const rootPk = rootType ? pkOf(rootType) : "id";
    let roots = (await objectsOfType(spec.root.typeKey)).filter(rootVisible);
    if (spec.root.selector.byKey !== undefined) {
      const byKey = resolveTemplate(spec.root.selector.byKey);
      roots = roots.filter((o) => (o.objectKey ?? o.props[rootPk] ?? o.id) === byKey || o.props[rootPk] === byKey || o.id === byKey);
    }
    if (spec.root.selector.filter) {
      roots = roots.filter((o) => matchFilter(o.props, spec.root.selector.filter));
    }

    const nodes = new Map<string, { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }>();
    const edges = new Map<string, { linkKey: string; from: string; to: string }>();
    let truncated = false;
    const typeCache = new Map<string, ObjectTypeDef | undefined>();
    const objectKeyOf = async (o: ObjectInstance): Promise<string> => {
      if (o.objectKey) return o.objectKey;
      if (!typeCache.has(o.type)) typeCache.set(o.type, await this.getActiveType(ctx, o.type));
      const t = typeCache.get(o.type);
      const pk = t ? pkOf(t) : "id";
      return String(o.props[pk] ?? o.id);
    };
    const addNode = async (o: ObjectInstance, project?: string[]): Promise<boolean> => {
      if (nodes.has(o.id)) return true;
      if (nodes.size >= maxNodes) {
        truncated = true;
        return false;
      }
      const props = project
        ? Object.fromEntries(project.filter((p) => p in o.props).map((p) => [p, o.props[p]]))
        : o.props;
      nodes.set(o.id, { id: o.id, typeKey: o.type, objectKey: await objectKeyOf(o), props });
      return true;
    };

    for (const r of roots) {
      if (!(await addNode(r))) break;
    }

    // --- path expansion (BFS per path, A6 pruning per hop) ---
    const linkIndexOut = new Map<string, LinkInstance[]>();
    const linkIndexIn = new Map<string, LinkInstance[]>();
    for (const l of links) {
      (linkIndexOut.get(`${l.type}|${l.fromId}`) ?? linkIndexOut.set(`${l.type}|${l.fromId}`, []).get(`${l.type}|${l.fromId}`)!).push(l);
      (linkIndexIn.get(`${l.type}|${l.toId}`) ?? linkIndexIn.set(`${l.type}|${l.toId}`, []).get(`${l.type}|${l.toId}`)!).push(l);
    }

    for (const path of spec.paths) {
      let frontier = roots.map((r) => r.id).filter((id) => nodes.has(id));
      for (const hop of path) {
        const lt = linkByKey.get(hop.linkKey);
        if (!lt) break; // unknown link key → path yields nothing further
        const nextTypeKey = hop.direction === "out" ? lt.toTypeKey : lt.fromTypeKey;
        const vis = await visibilityFor(nextTypeKey);
        const objsById = new Map((await objectsOfType(nextTypeKey)).map((o) => [o.id, o]));
        const perParentLimit = hop.limitPerNode ?? 50;
        const nextFrontier: string[] = [];
        for (const parentId of frontier) {
          let count = 0;
          const candidates = hop.direction === "out" ? linkIndexOut.get(`${hop.linkKey}|${parentId}`) ?? [] : linkIndexIn.get(`${hop.linkKey}|${parentId}`) ?? [];
          for (const l of candidates) {
            if (count >= perParentLimit) break;
            const childId = hop.direction === "out" ? l.toId : l.fromId;
            const child = objsById.get(childId);
            if (!child) continue;
            // A6 prune: invisible node + its subtree (we just don't expand it / add it).
            if (!vis(child)) continue;
            if (!matchFilter(child.props, hop.filter)) continue;
            count++;
            const ok = await addNode(child, hop.project);
            if (!ok) break;
            const from = hop.direction === "out" ? parentId : childId;
            const to = hop.direction === "out" ? childId : parentId;
            edges.set(`${hop.linkKey}|${from}|${to}`, { linkKey: hop.linkKey, from, to });
            nextFrontier.push(child.id);
          }
        }
        frontier = nextFrontier;
        if (truncated) break;
      }
      if (truncated) break;
    }

    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      truncated,
      snapshotVersion,
    };
  }

  // -- slice spec persistence ----------------------------------------------

  async putSliceSpec(ctx: AuthCtx, sliceKey: string, version: number, spec: SliceSpecRecord["spec"]): Promise<SliceSpecRecord> {
    const rec: SliceSpecRecord = {
      id: `slice_${sliceKey}`.replace(/[^\w-]/g, "_"),
      tenantId: ctx.tenantId,
      sliceKey,
      version,
      spec,
    };
    await this.repos.sliceSpecs.put(rec);
    return rec;
  }

  async getSliceSpec(ctx: AuthCtx, sliceKey: string): Promise<SliceSpecRecord | undefined> {
    const all = await this.repos.sliceSpecs.list(ctx.tenantId, (s) => s.sliceKey === sliceKey);
    return all.sort((a, b) => b.version - a.version)[0];
  }
}

export type { Dep };
