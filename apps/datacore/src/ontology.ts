import type { ToolPayload } from "@platform/contracts";
import type {
  AuthCtx,
  DerivationRun,
  DerivedPropertyDef,
  LinkTypeDef,
  ObjectInstance,
  ObjectTypeDef,
  OntologyVersion,
} from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { AuthzService } from "./authz.js";
import type { SolverService } from "./solvers/service.js";
import { newId } from "./ids.js";
import { notFound, validationError } from "./errors.js";
import { round } from "./prng.js";
import type { OutboxService } from "./outbox.js";

interface AggregateFormula {
  fn: "SUM" | "COUNT" | "MIN" | "MAX" | "AVG";
  sourceType: string;
  sourceProp: string;
  byField: string;
}

/** Parse "SUM(Order.qty BY model)" style aggregate formulas. */
export function parseAggregate(formula: string): AggregateFormula | null {
  const m = /^\s*(SUM|COUNT|MIN|MAX|AVG)\(\s*([A-Za-z_][\w]*)\.([\w]+)\s+BY\s+([\w]+)\s*\)\s*$/i.exec(
    formula,
  );
  if (!m) return null;
  return {
    fn: (m[1] as string).toUpperCase() as AggregateFormula["fn"],
    sourceType: m[2] as string,
    sourceProp: m[3] as string,
    byField: m[4] as string,
  };
}

/** Tiny arithmetic evaluator over own props: identifiers, numbers, + - * / ( ). */
export function evalArithmetic(expr: string, props: Record<string, unknown>): number {
  const tokens = expr.match(/\d+(?:\.\d+)?|[A-Za-z_][\w]*|[+\-*/()]/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parsePrimary(): number {
    const t = next();
    if (t === undefined) throw validationError("bad formula");
    if (t === "(") {
      const v = parseAdd();
      if (next() !== ")") throw validationError("bad formula: expected )");
      return v;
    }
    if (t === "-") return -parsePrimary();
    if (/^\d/.test(t)) return Number(t);
    const v = props[t];
    return typeof v === "number" ? v : 0;
  }
  function parseMul(): number {
    let v = parsePrimary();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const r = parsePrimary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function parseAdd(): number {
    let v = parseMul();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = parseMul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const result = parseAdd();
  if (pos !== tokens.length) throw validationError("bad formula: trailing tokens");
  return result;
}

function primaryKeyProp(type: ObjectTypeDef): string {
  return type.properties.find((p) => p.isPrimaryKey)?.propKey ?? "id";
}

/**
 * A4 ontology service: ObjectType/LinkType CRUD with versioning, object/link
 * storage, the query endpoints used by AgentCore (all A6-filtered, all returning
 * { data, snapshotVersion }), deterministic solvers, the derivation pipeline and
 * action drafts.
 */
export class OntologyService {
  constructor(
    private repos: Repos,
    private authz: AuthzService,
    private outbox: OutboxService,
    private solvers?: SolverService,
    private metrics?: import("./metrics.js").Metrics,
  ) {}

  setSolvers(solvers: SolverService): void {
    this.solvers = solvers;
  }

  // -- type management ------------------------------------------------------

  async listTypes(ctx: AuthCtx): Promise<ObjectTypeDef[]> {
    return this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
  }

  async getType(ctx: AuthCtx, key: string): Promise<ObjectTypeDef | undefined> {
    const types = await this.repos.ontologyTypes.list(
      ctx.tenantId,
      (t) => t.key === key && t.status === "ACTIVE",
    );
    return types[0];
  }

  async upsertType(
    ctx: AuthCtx,
    input: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> & { status?: "ACTIVE" },
  ): Promise<ObjectTypeDef> {
    const existing = await this.getType(ctx, input.key);
    const def: ObjectTypeDef = {
      id: existing?.id ?? newId("otype"),
      tenantId: ctx.tenantId,
      key: input.key,
      displayName: input.displayName,
      domain: input.domain ?? existing?.domain,
      properties: input.properties,
      derivedProperties: input.derivedProperties ?? [],
      sourceBindings: input.sourceBindings ?? [],
      version: (existing?.version ?? 0) + 1,
      status: "ACTIVE",
      published: existing?.published,
      deprecation: existing?.deprecation,
    };
    await this.repos.ontologyTypes.put(def);
    return def;
  }

  async upsertLinkType(
    ctx: AuthCtx,
    input: Omit<LinkTypeDef, "id" | "tenantId" | "version">,
  ): Promise<LinkTypeDef> {
    const existing = (
      await this.repos.ontologyLinks.list(ctx.tenantId, (l) => l.key === input.key)
    )[0];
    const def: LinkTypeDef = {
      id: existing?.id ?? newId("ltype"),
      tenantId: ctx.tenantId,
      version: (existing?.version ?? 0) + 1,
      ...input,
    };
    await this.repos.ontologyLinks.put(def);
    return def;
  }

  /** Snapshot current types+links as a new ontology version and notify webhooks. */
  async publishVersion(ctx: AuthCtx): Promise<OntologyVersion> {
    const versions = await this.repos.ontologyVersions.list(ctx.tenantId);
    const version = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;
    // 治理增量 §2.1：发布即固化 API 名（published=true → 此后 key 不可重命名/复用）。
    const types = await this.repos.ontologyTypes.list(ctx.tenantId);
    for (const t of types) {
      if (!t.published) {
        t.published = true;
        await this.repos.ontologyTypes.put(t);
      }
    }
    const links = await this.repos.ontologyLinks.list(ctx.tenantId);
    for (const l of links) {
      if (!l.published) {
        l.published = true;
        await this.repos.ontologyLinks.put(l);
      }
    }
    const snapshot = {
      objectTypes: await this.repos.ontologyTypes.list(ctx.tenantId),
      linkTypes: await this.repos.ontologyLinks.list(ctx.tenantId),
    };
    const rec: OntologyVersion = {
      id: newId("over"),
      tenantId: ctx.tenantId,
      version,
      snapshot,
      createdAt: new Date().toISOString(),
    };
    await this.repos.ontologyVersions.put(rec);
    await this.outbox.emit(ctx.tenantId, "ontology.published", { version });
    return rec;
  }

  async currentVersion(tenantId: string): Promise<number> {
    const versions = await this.repos.ontologyVersions.list(tenantId);
    return versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
  }

  /**
   * 本体原子规格 §1：snapshotVersion = "{ontology_version}.{epoch}"。epoch 为租户级
   * 单调序列（每写入批次 +1）。读路径取当前 epoch。
   */
  async snapshotVersion(tenantId: string): Promise<string> {
    const ov = await this.currentVersion(tenantId);
    const epoch = await this.repos.epochs.current(tenantId);
    return `${ov}.${epoch}`;
  }

  // -- object queries (A6 enforced in the data layer) ------------------------

  private matchFilter(props: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(filter)) {
      const actual = props[k];
      if (Array.isArray(v)) {
        if (Array.isArray(actual)) {
          if (!actual.some((a) => v.includes(a))) return false;
        } else if (!v.includes(actual)) return false;
      } else if (Array.isArray(actual)) {
        if (!actual.includes(v)) return false;
      } else if (actual !== v) return false;
    }
    return true;
  }

  /**
   * POST /a/v1/objects/query — tenant filter + resource grants + rowFilter BEFORE returning.
   *
   * 并发一致性 §13.1（CC1/CC2）：`asOfEpoch` 给出任务级快照读（近似 MVCC）——
   * temporal 属性按 prop_history 回溯到 ≤asOfEpoch 的值（任务内一致）；非 temporal 属性
   * 在快照后被改写的，按当前值返回并标记 `epochApprox:true`（指标 dc_epoch_approx_reads_total）。
   */
  async queryObjects(
    ctx: AuthCtx,
    objectType: string,
    filter: Record<string, unknown> = {},
    limit = 100,
    asOfEpoch?: number,
  ): Promise<ToolPayload> {
    const rowFilters = await this.authz.require(ctx, "OBJECT_TYPE", objectType, "READ");
    const all = await this.repos.objects.listByType(ctx.tenantId, objectType);
    const visible = all
      .filter((o) => this.authz.rowAllowed(ctx, rowFilters, o.props))
      .filter((o) => this.matchFilter(o.props, filter))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, Math.min(limit, 1000));
    if (asOfEpoch === undefined) {
      return {
        data: visible.map((o) => ({ id: o.id, type: o.type, props: o.props })),
        snapshotVersion: await this.snapshotVersion(ctx.tenantId),
      };
    }
    const type = await this.getType(ctx, objectType);
    const temporal = new Set((type?.properties ?? []).filter((p) => p.temporal).map((p) => p.propKey));
    const data = await Promise.all(visible.map((o) => this.objectAsOf(ctx.tenantId, o, temporal, asOfEpoch)));
    return { data, snapshotVersion: `${await this.snapshotVersion(ctx.tenantId)}@${asOfEpoch}` };
  }

  /** §13.1: reconstruct an object's value as of `asOfEpoch` (temporal rollback + approx flag). */
  private async objectAsOf(
    tenantId: string,
    o: ObjectInstance,
    temporal: Set<string>,
    asOfEpoch: number,
  ): Promise<{ id: string; type: string; props: Record<string, unknown>; epochApprox?: boolean }> {
    const objEpoch = o.epoch ?? 0;
    if (objEpoch <= asOfEpoch) {
      // not written since the snapshot → current value is exact
      return { id: o.id, type: o.type, props: o.props };
    }
    const props = { ...o.props };
    let maxTemporalEpoch = 0;
    if (temporal.size > 0) {
      const hist = await this.repos.objectPropHistory.list(tenantId, (h) => h.objectId === o.id);
      for (const p of temporal) {
        const entries = hist.filter((h) => h.prop === p);
        for (const e of entries) maxTemporalEpoch = Math.max(maxTemporalEpoch, e.epoch);
        const asOf = entries
          .filter((h) => h.epoch <= asOfEpoch)
          .sort((a, b) => b.epoch - a.epoch)[0];
        if (asOf) props[p] = asOf.value;
        else delete props[p]; // prop had no value at snapshot time
      }
    }
    // a non-temporal write happened after the snapshot iff the latest object write epoch
    // exceeds the latest temporal-history epoch (which we could roll back exactly).
    const epochApprox = objEpoch > maxTemporalEpoch;
    if (epochApprox) this.metrics?.inc("dc_epoch_approx_reads_total", { type: o.type });
    return epochApprox
      ? { id: o.id, type: o.type, props, epochApprox: true }
      : { id: o.id, type: o.type, props };
  }

  /** GET /a/v1/objects/:type/:id */
  async getObject(ctx: AuthCtx, objectType: string, objectId: string): Promise<ToolPayload> {
    const rowFilters = await this.authz.require(ctx, "OBJECT_TYPE", objectType, "READ");
    const obj = await this.repos.objects.get(ctx.tenantId, objectId);
    let found: ObjectInstance | undefined = obj && obj.type === objectType ? obj : undefined;
    if (!found) {
      // Allow lookup by primary-key value too (e.g. baseId "changzhou").
      const type = await this.getType(ctx, objectType);
      const pk = type ? primaryKeyProp(type) : "id";
      const all = await this.repos.objects.listByType(ctx.tenantId, objectType);
      found = all.find((o) => o.props[pk] === objectId);
    }
    if (!found || !this.authz.rowAllowed(ctx, rowFilters, found.props)) throw notFound("object");
    return {
      data: { id: found.id, type: found.type, props: found.props },
      snapshotVersion: await this.snapshotVersion(ctx.tenantId),
    };
  }

  // -- slices (QOS-PRD §7.6) --------------------------------------------------

  /** POST /a/v1/slices/:sliceKey/resolve */
  async resolveSlice(
    ctx: AuthCtx,
    sliceKey: string,
    args: Record<string, unknown>,
  ): Promise<ToolPayload> {
    const snapshotVersion = await this.snapshotVersion(ctx.tenantId);
    if (sliceKey === "model_capacity_network") {
      const modelId = String(args.modelId ?? "");
      if (!modelId) throw validationError("modelId required");
      const model = (await this.queryObjects(ctx, "Model", { modelId }, 1)).data as {
        id: string;
        props: Record<string, unknown>;
      }[];
      if (model.length === 0) throw notFound("model");
      const m = model[0] as { id: string; props: Record<string, unknown> };
      const baseIds = Array.isArray(m.props.bases) ? (m.props.bases as string[]) : [];
      const bases = (await this.queryObjects(ctx, "Base", { baseId: baseIds }, 100)).data;
      return {
        data: {
          model: m,
          bases,
          edges: (bases as { props: Record<string, unknown> }[]).map((b) => ({
            from: modelId,
            to: b.props.baseId,
            kind: "PRODUCIBLE_AT",
          })),
        },
        snapshotVersion,
      };
    }
    if (sliceKey === "base_risk_profile") {
      const baseId = String(args.baseId ?? "");
      if (!baseId) throw validationError("baseId required");
      const bases = (await this.queryObjects(ctx, "Base", { baseId }, 1)).data as {
        props: Record<string, unknown>;
      }[];
      if (bases.length === 0) throw notFound("base");
      const base = bases[0] as { props: Record<string, unknown> };
      const orders = (await this.queryObjects(ctx, "Order", { bases: baseId }, 200)).data;
      const util = typeof base.props.util === "number" ? base.props.util : 0;
      return {
        data: {
          base,
          orders,
          risk: {
            level: util > 0.92 ? "HIGH" : util > 0.8 ? "MEDIUM" : "LOW",
            utilization: util,
            bottleneck: base.props.bottleneck ?? null,
          },
        },
        snapshotVersion,
      };
    }
    throw notFound(`slice ${sliceKey}`);
  }

  // -- deterministic solvers (S1 real algorithms in solvers/) ---------------------

  /** POST /a/v1/solvers/:solverKey/invoke — delegates to the S1 solver engine. */
  async invokeSolver(
    ctx: AuthCtx,
    solverKey: string,
    args: Record<string, unknown>,
  ): Promise<ToolPayload> {
    const snapshotVersion = await this.snapshotVersion(ctx.tenantId);
    if (!this.solvers) throw notFound(`solver ${solverKey}`);
    // Orders flow through the A6-filtered query path so row policies apply inside solvers.
    let visibleOrders: ObjectInstance[] | undefined;
    try {
      const rows = (await this.queryObjects(ctx, "Order", {}, 1000)).data as {
        id: string;
        type: string;
        props: Record<string, unknown>;
      }[];
      visibleOrders = rows.map((r) => ({
        id: r.id,
        tenantId: ctx.tenantId,
        type: "Order",
        props: r.props,
        origin: { type: "MANUAL" as const },
      }));
    } catch {
      visibleOrders = []; // no READ grant on Order → solvers see no orders
    }
    const data = await this.solvers.invoke(ctx, solverKey, args, visibleOrders);
    return { data, snapshotVersion };
  }

  // -- derivation pipeline ------------------------------------------------------

  /** Topo order: a type whose formulas aggregate another type comes after it. */
  private topoOrder(types: ObjectTypeDef[]): string[] {
    const deps = new Map<string, Set<string>>();
    for (const t of types) {
      const set = new Set<string>();
      for (const d of t.derivedProperties) {
        const agg = parseAggregate(d.formula);
        if (agg && agg.sourceType !== t.key) set.add(agg.sourceType);
      }
      deps.set(t.key, set);
    }
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string) => {
      if (visited.has(key)) return;
      if (visiting.has(key)) throw validationError(`derivation cycle at ${key}`);
      visiting.add(key);
      for (const dep of deps.get(key) ?? []) if (deps.has(dep)) visit(dep);
      visiting.delete(key);
      visited.add(key);
      order.push(key);
    };
    for (const t of types) visit(t.key);
    return order;
  }

  private applyAggregate(
    agg: AggregateFormula,
    target: ObjectInstance,
    targetPk: string,
    sources: ObjectInstance[],
  ): number {
    const key = target.props[targetPk];
    const values: number[] = [];
    let count = 0;
    for (const src of sources) {
      const by = src.props[agg.byField];
      const matches = Array.isArray(by) ? by.includes(key) : by === key;
      if (!matches) continue;
      count++;
      const v = src.props[agg.sourceProp];
      if (typeof v === "number") values.push(v);
    }
    switch (agg.fn) {
      case "COUNT":
        return count;
      case "SUM":
        return values.reduce((a, b) => a + b, 0);
      case "MIN":
        return values.length ? Math.min(...values) : 0;
      case "MAX":
        return values.length ? Math.max(...values) : 0;
      case "AVG":
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }
  }

  /** POST /a/v1/derivations/run — declarative formulas recomputed in topo order. */
  async runDerivations(ctx: AuthCtx): Promise<DerivationRun> {
    const startedAt = new Date().toISOString();
    const types = await this.listTypes(ctx);
    const byKey = new Map(types.map((t) => [t.key, t]));
    let updated = 0;
    let order: string[] = [];
    // 本体原子规格 §1：一次派生运行 = 一个写入批次，推进租户 epoch（snapshotVersion 锚点）。
    await this.repos.epochs.next(ctx.tenantId);
    try {
      order = this.topoOrder(types);
      for (const typeKey of order) {
        const type = byKey.get(typeKey);
        if (!type || type.derivedProperties.length === 0) continue;
        const pk = primaryKeyProp(type);
        const objects = await this.repos.objects.listByType(ctx.tenantId, typeKey);
        const sourceCache = new Map<string, ObjectInstance[]>();
        for (const obj of objects) {
          let changed = false;
          for (const d of type.derivedProperties) {
            const agg = parseAggregate(d.formula);
            let value: number;
            if (agg) {
              let sources = sourceCache.get(agg.sourceType);
              if (!sources) {
                sources = await this.repos.objects.listByType(ctx.tenantId, agg.sourceType);
                sourceCache.set(agg.sourceType, sources);
              }
              value = this.applyAggregate(agg, obj, pk, sources);
            } else {
              value = evalArithmetic(d.formula, obj.props);
            }
            value = round(value, 6);
            if (obj.props[d.propKey] !== value) {
              obj.props[d.propKey] = value;
              changed = true;
            }
          }
          if (changed) {
            // NB: do not stamp epoch/updatedAt onto the object record here — the SY1
            // byte-equality contract compares full ObjectInstances across reruns. The
            // tenant epoch counter still advances (snapshotVersion), but per-object
            // epoch stamping is reserved for the atomic-spec write paths (OntologyCore).
            await this.repos.objects.put(obj);
            updated++;
          }
        }
      }
      const run: DerivationRun = {
        id: newId("drun"),
        tenantId: ctx.tenantId,
        startedAt,
        finishedAt: new Date().toISOString(),
        updatedObjects: updated,
        order,
        status: "SUCCEEDED",
      };
      await this.repos.derivationRuns.put(run);
      return run;
    } catch (err) {
      const run: DerivationRun = {
        id: newId("drun"),
        tenantId: ctx.tenantId,
        startedAt,
        finishedAt: new Date().toISOString(),
        updatedObjects: updated,
        order,
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      };
      await this.repos.derivationRuns.put(run);
      throw err;
    }
  }

}

export { primaryKeyProp };
export type { DerivedPropertyDef };
