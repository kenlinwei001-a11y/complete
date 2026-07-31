import type { ClaimVerdict, ImplementsRef, InterfaceViolation, ToolPayload, TypeSemanticsResponse } from "@platform/contracts";
import { checkInterfaceConformance, formatInterfaceViolations } from "@platform/contracts";
// WO-69 P3 · `functions` 的真实性靠 P2 的求解器本体签名注册表兑现（**只 import 纯声明模块**：
// ontology-signature.ts 的运行时依赖为零 → 不引入 ontology ↔ solvers 循环）。
import { SOLVER_ONTOLOGY_SIGNATURES } from "./solvers/ontology-signature.js";
import type {
  AuthCtx,
  DerivationRun,
  DerivedPropertyDef,
  LinkTypeDef,
  ObjectInstance,
  ObjectTypeDef,
  OntologyVersion,
  SourceBinding,
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

/** 交叉验证用：宽松等值比较（数字容差 1e-9；其余转字符串比较，避免类型/格式假阳）。 */
export function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }
  return String(a).trim() === String(b).trim();
}

function stringifyVal(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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

  /**
   * WO-QOS-ONTOLOGY-CONTEXT / WO-ONTOLOGY-CONTEXT-A · 口径语义只读投影（单一真值 = A）。
   *
   * 对请求的对象类型返回 { 属性口径(description/unit/dataType) + 派生公式(formula) + 相关已发布规则(expression/severity) }。
   * `keys` 省略/空 = 全部已发布 ACTIVE 类型；给定 `keys` 只投影这些（未知/未发布类型静默略过）。
   * 全部字段来自本租户已发布本体（listTypes）+ 规则库（PUBLISHED · 按 scopeObjectTypes 命中）——不新增/改写任何口径真值
   * （description/formula/expression 未填即诚实缺省）。R2 仅本租户（ctx 隔离）· R6 确定性字典序 · 纯读。
   *
   * **单一真值抽取**：GET /a/v1/ontology/type-semantics（喂 B 的 LLM prompt）与 A 侧内部消费者（如
   * validate-output 口径注解/scope 规则命中）经此一个方法共享同一口径来源——不留第三份拷贝，杜绝语义漂移。
   */
  async getTypeSemantics(ctx: AuthCtx, keys?: string[]): Promise<TypeSemanticsResponse> {
    const wanted = keys && keys.length > 0 ? new Set(keys) : undefined;
    const allTypes = await this.listTypes(ctx);
    const publishedRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const picked = allTypes
      .filter((t) => t.status === "ACTIVE" && (!wanted || wanted.has(t.key)))
      .sort((a, b) => byKey(a.key, b.key));
    const types = picked.map((t) => ({
      typeKey: t.key,
      displayName: t.displayName,
      props: [...t.properties]
        .sort((a, b) => byKey(a.propKey, b.propKey))
        .map((p) => ({
          propKey: p.propKey,
          ...(p.description ? { description: p.description } : {}),
          ...(p.unit ? { unit: p.unit } : {}),
          dataType: p.dataType,
        })),
      derived: [...(t.derivedProperties ?? [])]
        .sort((a, b) => byKey(a.propKey, b.propKey))
        .map((d) => ({ propKey: d.propKey, ...(d.formula ? { formula: d.formula } : {}) })),
      rules: publishedRules
        .filter((r) => r.scopeObjectTypes.includes(t.key))
        .sort((a, b) => byKey(a.key, b.key))
        .map((r) => ({ key: r.key, name: r.name, ...(r.expression ? { expression: r.expression } : {}), severity: r.severity })),
    }));
    return { types };
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
      // WO-69 P3：接口声明与行动绑定是**可选扩展**——入参给了用入参，没给则沿用既有（不因一次
      // upsert 把已声明的 implements/actions 悄悄抹掉）。两者皆无 → 字段不出现 = 逐字节沿用现状。
      ...(input.implements ?? existing?.implements
        ? { implements: input.implements ?? existing?.implements }
        : {}),
      ...(input.actions ?? existing?.actions ? { actions: input.actions ?? existing?.actions } : {}),
    };
    await this.repos.ontologyTypes.put(def);
    return def;
  }

  /**
   * WO-69 P3 · 为已存在类型设置「实现的接口 / 绑定的行动」（种子与管理台用）。只改这两个字段，
   * 其余（属性/派生/域/published/version）原样保留 —— 与 `setSourceBindings` 同型。类型不存在则略过。
   */
  async setInterfaceBindings(
    ctx: AuthCtx,
    key: string,
    input: { implements?: ImplementsRef[]; actions?: { actionTypeKey: string }[] },
  ): Promise<void> {
    const existing = await this.getType(ctx, key);
    if (!existing) return;
    await this.repos.ontologyTypes.put({
      ...existing,
      ...(input.implements ? { implements: input.implements } : {}),
      ...(input.actions ? { actions: input.actions } : {}),
    });
  }

  /**
   * WO-MODELING-INTERACTIVE：为已存在对象类型补真实来源绑定（provenance 回填），只改 sourceBindings、
   * 其余字段（属性/派生/域/published/version）原样保留。用于合成 A 路把"由某数据集物化"的类型标上其源
   * RawDataset（KILL-MOCK：真有源标真源）；类型不存在则静默略过。R2 tenant 隔离（getType 已按 ctx）。
   */
  async setSourceBindings(ctx: AuthCtx, key: string, sourceBindings: SourceBinding[]): Promise<void> {
    const existing = await this.getType(ctx, key);
    if (!existing) return;
    await this.repos.ontologyTypes.put({ ...existing, sourceBindings });
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

  /**
   * WO-69 P3 · **对象接口一致性门（发布门）**。
   *
   * 头号纪律：接口不是注释。声明了 `implements` 却没真长出要求的属性/行动/函数 → **拒绝发布**，
   * 并把缺口**逐条点名**（哪个类型、哪个接口@哪个版本、缺哪个 propKey/actionTypeKey/solverKey）。
   *
   * **零回归**：一个 `implements` 都没声明的租户，`checkInterfaceConformance` 直接空转返回 []，
   * 发布路径逐字节沿用现状（老快照、老租户不受任何影响）。
   *
   * **诚实边界**：本门在**发布时**兑现契约。已经落库的**历史 OntologyVersion 快照**不会被追溯改写——
   * 接口加要求 ⇒ 从下一次发布起全部 `latest` 实现者被要求补齐，而不是把历史快照判为失效。
   */
  async assertInterfaceConformance(ctx: AuthCtx): Promise<void> {
    const types = await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
    if (!types.some((t) => (t.implements ?? []).length > 0)) return; // 零回归快路
    const violations = await this.interfaceViolations(ctx, types);
    if (violations.length > 0) {
      throw validationError(
        `对象接口一致性校验未通过（${violations.length} 项）：${formatInterfaceViolations(violations)}`,
      );
    }
  }

  /** 一致性校验的取数 + 纯函数调用（发布门与只读的 conformance 报告共用同一把尺子）。 */
  async interfaceViolations(
    ctx: AuthCtx,
    types?: ObjectTypeDef[],
  ): Promise<InterfaceViolation[]> {
    const allTypes = types ?? (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE"));
    const interfaces = await this.repos.objectInterfaces.list(ctx.tenantId);
    const actionTypes = await this.repos.actionTypes.list(ctx.tenantId);
    return checkInterfaceConformance({
      types: allTypes.map((t) => ({
        key: t.key,
        displayName: t.displayName,
        properties: t.properties.map((p) => ({ propKey: p.propKey, dataType: p.dataType })),
        derivedPropKeys: (t.derivedProperties ?? []).map((d) => d.propKey),
        actions: t.actions,
        implements: t.implements,
      })),
      interfaces,
      actionTypeKeys: actionTypes.map((a) => a.key),
      // WO-69 P2 兑现点：`functions` 校验用的是**真求解器签名注册表**，不是一份手抄清单。
      solverSignatures: SOLVER_ONTOLOGY_SIGNATURES,
    });
  }

  /** Snapshot current types+links as a new ontology version and notify webhooks. */
  async publishVersion(ctx: AuthCtx): Promise<OntologyVersion> {
    // WO-69 P3：接口契约先于快照固化 —— 不合规不许进快照（"绿测试≠能用"靠这道门堵）。
    await this.assertInterfaceConformance(ctx);
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
    // A6：行级过滤 + 列级（属性级）投影同出一份决策（authz 单一机制）。
    const dec = await this.authz.requireDecision(ctx, "OBJECT_TYPE", objectType, "READ");
    const rowFilters = dec.rowFilters;
    const all = await this.repos.objects.listByType(ctx.tenantId, objectType);
    const visible = all
      .filter((o) => !o.mergedInto) // OC1：被并入对象不出现，只见 golden
      .filter((o) => this.authz.rowAllowed(ctx, rowFilters, o.props))
      // 行级过滤读**未投影**的 props（策略作者可用不可读字段做行筛选）；投影只作用于返回值。
      .filter((o) => this.matchFilter(o.props, filter))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, Math.min(limit, 1000));
    if (asOfEpoch === undefined) {
      return {
        data: visible.map((o) => ({ id: o.id, type: o.type, props: this.authz.projectProps(dec, o.props) })),
        snapshotVersion: await this.snapshotVersion(ctx.tenantId),
      };
    }
    const type = await this.getType(ctx, objectType);
    const temporal = new Set((type?.properties ?? []).filter((p) => p.temporal).map((p) => p.propKey));
    const data = await Promise.all(visible.map((o) => this.objectAsOf(ctx.tenantId, o, temporal, asOfEpoch)));
    // 时间回溯读同样过列级投影（否则 asOfEpoch 成为绕过列级安全的后门）。
    return {
      data: data.map((d) => ({ ...d, props: this.authz.projectProps(dec, d.props) })),
      snapshotVersion: `${await this.snapshotVersion(ctx.tenantId)}@${asOfEpoch}`,
    };
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

  /**
   * 聚合专用的 A6 行级过滤全量读（不走 queryObjects 的 LLM 上下文 ≤1000 截断 —— 那个截断是给
   * agent 返原始行用的，会让聚合在规模下静默算错）。仍套行级过滤；超安全上限才标 truncated。
   */
  async listVisibleForAggregate(
    ctx: AuthCtx,
    objectType: string,
    filter: Record<string, unknown> = {},
  ): Promise<{ rows: { props: Record<string, unknown> }[]; total: number; truncated: boolean }> {
    const CAP = 200_000; // 安全上限：超此返回 truncated=true（防 OOM；真正下推属 E2 转换引擎）
    // A6 列级：聚合同样只能看可读列 —— 否则 sum(unitPrice) 就是列级安全的算术后门。
    const dec = await this.authz.requireDecision(ctx, "OBJECT_TYPE", objectType, "READ");
    const rowFilters = dec.rowFilters;
    const all = await this.repos.objects.listByType(ctx.tenantId, objectType);
    const visible = all
      .filter((o) => !o.mergedInto) // OC1：被并入对象不出现，只见 golden
      .filter((o) => this.authz.rowAllowed(ctx, rowFilters, o.props))
      .filter((o) => this.matchFilter(o.props, filter));
    return {
      rows: visible.slice(0, CAP).map((o) => ({ props: this.authz.projectProps(dec, o.props) })),
      total: visible.length,
      truncated: visible.length > CAP,
    };
  }

  /** GET /a/v1/objects/:type/:id */
  async getObject(ctx: AuthCtx, objectType: string, objectId: string): Promise<ToolPayload> {
    const dec = await this.authz.requireDecision(ctx, "OBJECT_TYPE", objectType, "READ");
    const rowFilters = dec.rowFilters;
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
      data: { id: found.id, type: found.type, props: this.authz.projectProps(dec, found.props) },
      snapshotVersion: await this.snapshotVersion(ctx.tenantId),
    };
  }

  // -- cross-validation（推演验证痕迹 Layer 2：结论断言 vs 知识图谱已有事实）------------
  /**
   * POST /a/v1/ontology/cross-validate — 对推演结论里的断言（对象属性 / 关系）逐条
   * 反向核对知识图谱（对象库 props + 链路）已有事实，标 CONSISTENT/CONFLICT/NO_EVIDENCE。
   * 确定性（R6）、tenant 隔离（R2）、行级过滤（R6 authz）。无网络/无 LLM。
   */
  async crossValidate(
    ctx: AuthCtx,
    claims: {
      kind: "PROPERTY" | "LINK";
      subjectType: string;
      subjectId: string;
      property?: string;
      assertedValue?: unknown;
      linkType?: string;
      objectType?: string;
      objectId?: string;
    }[],
  ): Promise<{
    claims: ClaimVerdict[];
    verdict: "ALL_CONSISTENT" | "PARTIAL" | "CONFLICT" | "NO_CLAIMS";
    snapshotVersion: string;
  }> {
    const snapshotVersion = await this.snapshotVersion(ctx.tenantId);
    const verdicts: ClaimVerdict[] = [];
    for (const c of claims.slice(0, 200)) {
      verdicts.push(await this.checkClaim(ctx, c, snapshotVersion));
    }
    let verdict: "ALL_CONSISTENT" | "PARTIAL" | "CONFLICT" | "NO_CLAIMS";
    if (verdicts.length === 0) verdict = "NO_CLAIMS";
    else if (verdicts.some((v) => v.status === "CONFLICT")) verdict = "CONFLICT";
    else if (verdicts.every((v) => v.status === "CONSISTENT")) verdict = "ALL_CONSISTENT";
    else verdict = "PARTIAL";
    return { claims: verdicts, verdict, snapshotVersion };
  }

  private async checkClaim(
    ctx: AuthCtx,
    c: {
      kind: "PROPERTY" | "LINK";
      subjectType: string;
      subjectId: string;
      property?: string;
      assertedValue?: unknown;
      linkType?: string;
      objectType?: string;
      objectId?: string;
    },
    snapshotVersion: string,
  ): Promise<ClaimVerdict> {
    const base = {
      subjectType: c.subjectType,
      subjectId: c.subjectId,
      kind: c.kind,
      snapshotVersion,
    } as const;
    // resolve subject object from KG (handles pk-value lookup + row filter)
    let subject: { props: Record<string, unknown> } | undefined;
    try {
      const payload = await this.getObject(ctx, c.subjectType, c.subjectId);
      subject = payload.data as { props: Record<string, unknown> };
    } catch {
      subject = undefined;
    }

    if (c.kind === "PROPERTY") {
      const property = c.property ?? "";
      const claim = `${c.subjectType}:${c.subjectId}.${property} == ${stringifyVal(c.assertedValue)}`;
      if (!subject || !(property in subject.props)) {
        return { ...base, claim, property, assertedValue: c.assertedValue, status: "NO_EVIDENCE", detail: subject ? "知识图谱无此属性记录" : "知识图谱无此对象" };
      }
      const kgValue = subject.props[property];
      const consistent = looseEqual(kgValue, c.assertedValue);
      return {
        ...base,
        claim,
        property,
        assertedValue: c.assertedValue,
        status: consistent ? "CONSISTENT" : "CONFLICT",
        ...(consistent ? {} : { kgValue, detail: `知识图谱记录为 ${stringifyVal(kgValue)}` }),
      };
    }

    // LINK：核对 subject --linkType--> object 是否存在
    const linkType = c.linkType ?? "";
    const claim = `${c.subjectType}:${c.subjectId} -[${linkType}]-> ${c.objectType ?? "?"}:${c.objectId ?? "?"}`;
    if (!subject) {
      return { ...base, claim, linkType, objectType: c.objectType, objectId: c.objectId, status: "NO_EVIDENCE", detail: "知识图谱无此对象" };
    }
    const links = await this.repos.links.list(
      ctx.tenantId,
      (l) => l.type === linkType,
    );
    // subject/object 既可按 obj_ id 也可按业务主键匹配（getObject 已能两者解析）
    const subjId = await this.resolveObjId(ctx, c.subjectType, c.subjectId);
    const objId = c.objectId ? await this.resolveObjId(ctx, c.objectType ?? "", c.objectId) : undefined;
    const exists = links.some(
      (l) => (l.fromId === subjId || l.fromId === c.subjectId) && (objId === undefined || l.toId === objId || l.toId === c.objectId),
    );
    return {
      ...base,
      claim,
      linkType,
      objectType: c.objectType,
      objectId: c.objectId,
      status: exists ? "CONSISTENT" : "NO_EVIDENCE",
      ...(exists ? {} : { detail: "知识图谱无对应关系记录" }),
    };
  }

  /** 把业务主键值解析为 obj_ id（解析不到则原样返回，交由调用方双匹配）。 */
  private async resolveObjId(ctx: AuthCtx, objectType: string, idOrKey: string): Promise<string> {
    try {
      const payload = await this.getObject(ctx, objectType, idOrKey);
      return (payload.data as { id: string }).id;
    } catch {
      return idOrKey;
    }
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
