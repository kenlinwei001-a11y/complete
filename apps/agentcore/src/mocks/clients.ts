import type { ClaimVerdict, CreateDecisionInput, CrossValidateRequest, CrossValidateResponse, Decision, ObjectRefAttempt, ObjectRefHit, ObjectRefResolution, ObjectRefResolveRequest, PlanSliceRequest, PlanSliceResponse, PromptKey, QueryTimeseriesAggInput, ResolvedPrompt, RuleVerdict, ToolPayload, TypeSemanticsResponse } from "@platform/contracts";
import { PLATFORM_PROMPT_DEFAULTS } from "@platform/contracts";
// WO-SLOT-ENTITY-RESOLVE：匹配规则唯一出处（mock 与 DataCore 调同一个纯核心，勿自写第二套）。
import { matchObjectRefInType, objectRefDeclaredType, pickObjectRefResolution } from "@platform/contracts";
// DF.13 外协红线单一来源（C08）：mock DataCore 的 C08 阈值必须与真 DataCore 同源，禁内联裸阈值。
import { OUTSOURCE_REDLINE } from "@platform/contracts";
import { newId } from "../ids.js";
import type {
  ActionClient,
  CatalogClient,
  DataCoreClient,
  DataGenClient,
  DecisionClient,
  IamClient,
  KbClient,
  KbHit,
  ObjectTypeDefSummary,
  OntologyClient,
  PromptClient,
  RuleEngineClient,
  SimClient,
  SolverClient,
  TimeseriesClient,
  ToolAuthCtx,
} from "../tools/clients.js";
import { cosine, pseudoEmbed } from "../util/embedding.js";
import { hashSeed, prngFor } from "./prng.js";
import { SEED_BASES, SEED_MODELS, SEED_ORDERS, type SeedBase, type SeedOrder } from "./seed.js";

const SNAPSHOT = "ont-snap-001";

/**
 * WO-RESOURCE-CATALOG-ONTOLOGY · mock 本体对象类型定义（object_type/field 投影供给侧）。
 * 取真实本体核心类型子集（Process/Equipment/WorkOrder/MaterialBalance/OrderLine 等），
 * 属性带 unit/dataType（SEAM③ 量纲透出）；WIPLot 故意缺类型级 description（SEAM §4 兜底合成探针）。
 * mock listObjectTypeDefs/listObjectTypes/getTypeSemantics 三者同源于此（防漂移）。
 */
/**
 * query_objects UNKNOWN_TYPE 守卫的历史基线 key：seed 的 agent scope / intent slot 引用了
 * Line/Shipment/Segment/Customer/Material 等目录投影之外的类型（discover-real-types.test 依赖
 * Material「已知但 0 实例」语义）——守卫清单须为其并集，见 listObjectTypeKeys。
 */
const MOCK_GUARD_LEGACY_TYPE_KEYS = ["Base", "Order", "Model", "Line", "Process", "Equipment", "Shipment", "Segment", "Customer", "Material"];
const MOCK_OBJECT_TYPE_DEFS: ObjectTypeDefSummary[] = [
  {
    key: "Base", displayName: "生产基地", domain: "factory", description: "生产基地主数据", status: "ACTIVE",
    properties: [
      { propKey: "baseId", dataType: "string", isPrimaryKey: true, description: "基地编号" },
      { propKey: "name", dataType: "string", searchable: true, description: "基地名称" },
    ],
  },
  {
    // WO-SLOT-ENTITY-RESOLVE · mock 保真：主键改 `so`（= 生产 Order 的真主键，且 mock 行本来就带 so；
    // 旧值 `orderId` 是**行里根本不存在的属性**，元数据与数据对不上 → 解析核心按元数据一查即空）。
    key: "Order", displayName: "销售订单", domain: "sales", description: "客户销售订单", status: "ACTIVE",
    properties: [
      { propKey: "so", dataType: "string", isPrimaryKey: true, searchable: true, description: "订单编号" },
      { propKey: "qty", dataType: "number", unit: "套", description: "订单数量" },
      { propKey: "dueDate", dataType: "date", description: "交期" },
    ],
  },
  {
    // WO-SLOT-ENTITY-RESOLVE · mock 保真：补 `name`（生产 Model 的 name 就是 searchable 的；
    // mock 行一直有 name 却没在元数据里声明 → 型号名解析不到）。
    key: "Model", displayName: "产品型号", domain: "product", description: "产品型号主数据", status: "ACTIVE",
    properties: [
      { propKey: "modelId", dataType: "string", isPrimaryKey: true, description: "型号编号" },
      { propKey: "name", dataType: "string", searchable: true, description: "型号名称" },
    ],
  },
  {
    key: "Process", displayName: "工序", domain: "factory", description: "制造工序定义", status: "ACTIVE",
    properties: [
      { propKey: "processId", dataType: "string", isPrimaryKey: true, description: "工序编号" },
      { propKey: "changeoverHours", dataType: "number", unit: "小时", description: "换型时长" },
    ],
  },
  {
    key: "Equipment", displayName: "设备", domain: "factory", description: "生产设备台账", status: "ACTIVE",
    properties: [
      { propKey: "equipmentId", dataType: "string", isPrimaryKey: true, description: "设备编号" },
      { propKey: "oee", dataType: "number", unit: "%", description: "设备综合效率" },
    ],
  },
  {
    key: "WorkOrder", displayName: "生产工单", domain: "factory", description: "生产执行工单", status: "ACTIVE",
    properties: [
      { propKey: "woId", dataType: "string", isPrimaryKey: true, description: "工单编号" },
      { propKey: "plannedQty", dataType: "number", unit: "套", description: "计划数量" },
    ],
  },
  {
    key: "MaterialBalance", displayName: "物料平衡", domain: "factory", description: "投入产出物料平衡", status: "ACTIVE",
    properties: [{ propKey: "yieldRate", dataType: "number", unit: "%", description: "良率" }],
  },
  {
    key: "OrderLine", displayName: "订单明细行", domain: "sales", description: "订单行项目", status: "ACTIVE",
    properties: [{ propKey: "lineQty", dataType: "number", unit: "套", description: "行数量" }],
  },
  {
    // 故意缺类型级 description：WO §4 兜底合成（descriptionSynthesized: true）探针。
    key: "WIPLot", displayName: "在制批次", domain: "factory", status: "ACTIVE",
    properties: [{ propKey: "lotQty", dataType: "number", unit: "批", description: "批次数量" }],
  },
];

/**
 * Row-level permission semantics live INSIDE the mock data layer (QOS-PRD §7.2/§7.6):
 * role `planner` sees all bases; role `base_manager:<名>` only sees objects related to that base.
 */
function baseScope(ctx: ToolAuthCtx): string[] | "ALL" {
  if (ctx.roles.some((r) => r === "planner" || r === "admin" || r === "catalog_admin")) return "ALL";
  const scoped = ctx.roles.filter((r) => r.startsWith("base_manager:")).map((r) => r.split(":")[1] as string);
  if (scoped.length > 0) return scoped;
  return "ALL";
}

function visibleBases(ctx: ToolAuthCtx): SeedBase[] {
  const scope = baseScope(ctx);
  if (scope === "ALL") return SEED_BASES;
  return SEED_BASES.filter((b) => scope.includes(b.name));
}

function visibleOrders(ctx: ToolAuthCtx): SeedOrder[] {
  const scope = baseScope(ctx);
  if (scope === "ALL") return SEED_ORDERS;
  return SEED_ORDERS.filter((o) => o.bases.some((b) => scope.includes(b)));
}

function matchFilter(obj: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === "") continue;
    const actual = obj[k];
    if (Array.isArray(v)) {
      if (!v.includes(actual)) return false;
    } else if (actual !== v) {
      return false;
    }
  }
  return true;
}

export class MockOntologyClient implements OntologyClient {
  /**
   * WO-RESOURCE-CATALOG-ONTOLOGY · 实例级可变本体定义（SEAM② 活投影探针：测试 push 新类型后
   * 下次 list/project 即可见——镜像 A 侧"建类型→已发布"语义）。每实例深拷贝，跨测试不串。
   */
  readonly objectTypeDefs: ObjectTypeDefSummary[] = JSON.parse(JSON.stringify(MOCK_OBJECT_TYPE_DEFS)) as ObjectTypeDefSummary[];

  /** ACTIVE 子集（镜像 A 侧 listTypes 服务端过滤）。 */
  private activeTypeDefs(): ObjectTypeDefSummary[] {
    return this.objectTypeDefs.filter((t) => t.status === undefined || t.status === "ACTIVE");
  }

  async resolveSlice(ctx: ToolAuthCtx, sliceKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    if (sliceKey === "model_capacity_network") {
      const model = SEED_MODELS.find((m) => m.objectId === args.modelId || m.name === args.modelId);
      if (!model) return { data: { nodes: [], edges: [] }, snapshotVersion: SNAPSHOT };
      const bases = visibleBases(ctx).filter((b) => model.bases.includes(b.name));
      return {
        data: {
          model: model.name,
          nodes: bases.map((b) => ({ base: b.name, util: b.util, gwh: b.gwh })),
          edges: bases.map((b) => ({ from: model.name, to: b.name, kind: "producible_at" })),
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    if (sliceKey === "base_risk_profile") {
      const base = visibleBases(ctx).find((b) => b.objectId === args.baseId || b.name === args.baseId);
      if (!base) {
        return { data: { summary: "未找到可见的基地风险画像（可能无权访问）。", factors: [] }, snapshotVersion: SNAPSHOT };
      }
      return {
        data: {
          base: base.name,
          summary: `${base.name}基地当前利用率 ${Math.round(base.util * 100)}%，瓶颈工序为${base.bottleneck}，叠加排产高峰导致风险越线`,
          factors: [
            { name: "利用率", value: base.util },
            { name: "瓶颈", value: base.bottleneck },
          ],
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    if (sliceKey.startsWith("biz.")) {
      // A3.3 动态切片 mock：plan_slice 产出的 biz.<root>.<targets> 切片，按 key 解析返回通用子图。
      const parts = sliceKey.split(".");
      const rootType = parts[1] ?? "Unknown";
      const targets = parts.slice(2);
      return {
        data: {
          rootType,
          targets,
          nodes: targets.map((t) => ({ type: t, id: `${rootType}_to_${t}` })),
          edges: targets.map((t) => ({ from: rootType, to: t, kind: `${rootType}_to_${t}` })),
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    throw new Error(`unknown slice: ${sliceKey}`);
  }

  // P3 O11：切片规划 mock——确定性派生 SlicePlan（rootType+targets），可达即 ok。
  // unreachable 约定：target 含 "__unreachable" → 模拟 maxHops 内不可达（诚实出 NO_SLICE 那一路用）。
  async planSlice(_ctx: ToolAuthCtx, req: PlanSliceRequest): Promise<PlanSliceResponse> {
    const unreachable = req.targets.filter((t) => t.includes("__unreachable"));
    const reachable = req.targets.filter((t) => !t.includes("__unreachable"));
    if (reachable.length === 0) {
      return { ok: false, reason: { code: "NO_PATH", rootType: req.rootType, unreachable } };
    }
    return {
      ok: true,
      plan: {
        sliceKey: `biz.${req.rootType}.${reachable.join("_")}`,
        rootType: req.rootType,
        paths: reachable.map((t) => ({ target: t, hops: [{ linkKey: `${req.rootType}_to_${t}`, direction: "out" as const, toType: t }] })),
        pathEvidence: reachable.map((t) => `${req.rootType} -[${req.rootType}_to_${t}:out]-> ${t}`),
        spannedDomains: ["mock"],
        reused: false,
      },
    };
  }

  /** A3-SUITE-2：动态切片持久化 mock——规划器产出即视为一等 SliceSpec，供后续 resolve_slice 消费。 */
  async putSliceSpec(
    _ctx: ToolAuthCtx,
    sliceKey: string,
    _spec: {
      root: { typeKey: string; selector: { byKey?: string; filter?: Record<string, unknown> } };
      paths: { linkKey: string; direction: "out" | "in"; filter?: Record<string, unknown>; limitPerNode?: number; project?: string[] }[][];
      maxNodes?: number;
    },
  ): Promise<{ sliceKey: string; version: number }> {
    return { sliceKey, version: 1 };
  }

  async queryObjects(
    ctx: ToolAuthCtx,
    objectType: string,
    filter: Record<string, unknown>,
    limit?: number,
  ): Promise<ToolPayload> {
    let rows: Record<string, unknown>[];
    if (objectType === "Base") {
      rows = visibleBases(ctx).map((b) => ({ ...b }));
    } else if (objectType === "Model") {
      const scope = baseScope(ctx);
      rows = SEED_MODELS.filter((m) => scope === "ALL" || m.bases.some((b) => scope.includes(b))).map((m) => ({
        ...m,
      }));
    } else if (objectType === "Order") {
      rows = visibleOrders(ctx).map((o) => ({ ...o }));
    } else {
      rows = [];
    }
    rows = rows.filter((r) => matchFilter(r, filter));
    if (limit !== undefined) rows = rows.slice(0, Math.min(limit, 200));
    return { data: { items: rows, total: rows.length }, snapshotVersion: SNAPSHOT };
  }

  /**
   * WO-SLOT-ENTITY-RESOLVE · 取一个类型下的「可匹配行」（内部 id + props），供解析核心比对。
   * mock 的行本身带 `objectId` 作为内部 id（生产是 `obj_<type>_<key>`），归一规则同源，无需 mock 专属剥前缀表。
   */
  private async refRows(ctx: ToolAuthCtx, objectType: string): Promise<{ id: string; props: Record<string, unknown> }[]> {
    const result = await this.queryObjects(ctx, objectType, {});
    const items = (result.data as { items: Record<string, unknown>[] }).items;
    return items.map((i) => ({ id: String(i.objectId ?? i.so ?? ""), props: i }));
  }

  /**
   * WO-SLOT-ENTITY-RESOLVE · **mock 保真（关键）**：与生产 `datacore/src/ontology.ts getObject` 同语义
   * —— 只按**内部 id / 主键**取（`accept:["id"]`），中文名解析不到就是解析不到。
   *
   * ⚠ 改前这里是 `i.name === objectId` 也认名字 —— 比生产宽松，正是它把「槽位填充按 id 查、中文名必 404」
   * 这个真病**盖了整整一轮**（agentcore 全绿、真绑 Kimi 一跑 10/35 反问）。假绿温床，勿回潮。
   * 按名解析请走 `resolveObjectRef`（与生产同一条正门）。
   */
  async getObject(ctx: ToolAuthCtx, objectType: string, objectId: string): Promise<ToolPayload> {
    const typeDef = this.objectTypeDefs.find((t) => t.key === objectType);
    const { hits } = matchObjectRefInType({ ref: objectId, objectType, typeDef, rows: await this.refRows(ctx, objectType), accept: ["id"] });
    const found = hits[0];
    if (!found) throw new Error(`object not found: ${objectType}/${objectId}`);
    const row = (await this.refRows(ctx, objectType)).find((r) => r.id === found.internalId);
    return { data: row?.props ?? {}, snapshotVersion: SNAPSHOT };
  }

  /**
   * WO-SLOT-ENTITY-RESOLVE · 「实体文本 → 对象引用」解析 mock —— **规则不自写**，
   * 与 DataCore 调用 contracts 里**同一个** `matchObjectRefInType` / `pickObjectRefResolution`。
   * mock 只负责「取哪些行」（角色可见性 = 它的行级过滤），匹配语义单一出处。
   */
  async resolveObjectRef(ctx: ToolAuthCtx, req: ObjectRefResolveRequest): Promise<ObjectRefResolution> {
    const accept = req.accept ?? ["id", "name", "alias"];
    const declared = objectRefDeclaredType(req.ref);
    const typeKeys = req.types?.length ? [...new Set(req.types)] : declared ? [declared] : await this.listObjectTypeKeys();
    const hits: ObjectRefHit[] = [];
    const attempts: ObjectRefAttempt[] = [];
    for (const objectType of [...typeKeys].sort()) {
      const typeDef = this.objectTypeDefs.find((t) => t.key === objectType);
      const r = matchObjectRefInType({ ref: req.ref, objectType, typeDef, rows: await this.refRows(ctx, objectType), accept });
      hits.push(...r.hits);
      attempts.push(r.attempt);
    }
    return pickObjectRefResolution(req.ref, hits, attempts, { maxCandidates: req.maxCandidates });
  }

  /** 治理增量 §3.6：聚合下推 mock —— 返回分组行集（绝不返回全量原始行），供 G8 审计断言。 */
  async aggregateObjects(
    ctx: ToolAuthCtx,
    req: { typeKey: string; filter?: Record<string, unknown>; groupBy?: string[]; metrics: { prop: string; fn: "count" | "sum" | "avg" | "min" | "max" }[] },
  ): Promise<ToolPayload> {
    const result = await this.queryObjects(ctx, req.typeKey, req.filter ?? {});
    const items = (result.data as { items: Record<string, unknown>[] }).items;
    const groupBy = req.groupBy ?? [];
    const groups = new Map<string, { group: Record<string, string | null>; rows: Record<string, unknown>[] }>();
    for (const r of items) {
      const k = groupBy.map((g) => String(r[g] ?? "∅")).join("");
      let g = groups.get(k);
      if (!g) {
        const group: Record<string, string | null> = {};
        for (const gb of groupBy) group[gb] = r[gb] == null ? null : String(r[gb]);
        g = { group, rows: [] };
        groups.set(k, g);
      }
      g.rows.push(r);
    }
    const rows = [...groups.values()].map((g) => {
      const metrics: Record<string, number | null> = {};
      for (const m of req.metrics) {
        const key = `${m.fn}_${m.prop}`;
        if (m.fn === "count") {
          metrics[key] = g.rows.length;
          continue;
        }
        const vals = g.rows.map((p) => p[m.prop]).filter((v): v is number => typeof v === "number");
        if (!vals.length) metrics[key] = null;
        else if (m.fn === "sum") metrics[key] = vals.reduce((a, b) => a + b, 0);
        else if (m.fn === "avg") metrics[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
        else if (m.fn === "min") metrics[key] = Math.min(...vals);
        else metrics[key] = Math.max(...vals);
      }
      return { group: g.group, metrics };
    });
    return { data: { rows, rowCount: rows.length, truncated: false }, snapshotVersion: SNAPSHOT };
  }
  async fillData(_ctx: ToolAuthCtx, req: { typeKey: string; fields: string[]; rows?: number; seed?: number }): Promise<{ connId: string; rowCount: number }> {
    return { connId: `conn_growth_${req.typeKey}`, rowCount: req.rows ?? 6 };
  }

  // stage3②：轻量本体校验 mock——行含 `__invalid` 标记字段即判不符（供执行器关卡测试）。
  async validateOutput(_ctx: ToolAuthCtx, _objectType: string, rows: Record<string, unknown>[]): Promise<{ ok: boolean; violations: { field: string; kind: string; detail: string }[] }> {
    const violations = rows.flatMap((r, i) => ("__invalid" in r ? [{ field: "__invalid", kind: "DOMAIN", detail: `row ${i} 违反本体值域` }] : []));
    return { ok: violations.length === 0, violations };
  }

  // Dogfooding P3：meta 问系统自己（mock）。
  async queryMetaOntology(): Promise<{ total: number; byKind: Record<string, number> }> {
    return { total: 64, byKind: { SystemInvariant: 14, SystemBreakpoint: 8, SystemEvent: 27 } };
  }
  async getMetaBreakpoint(_ctx: ToolAuthCtx, id: string): Promise<unknown> {
    return { type: "SystemBreakpoint", props: { id, status: "PARTIAL", relatedInvariants: ["R11"], relatedPRDs: ["PRD-fullstack-story-build-g8.md"] } };
  }
  async metaImpact(_ctx: ToolAuthCtx, node: string): Promise<{ node: string; affected: { id: string; via: string }[] }> {
    return { node: `meta_SystemInvariant_${node}`, affected: [{ id: "PRD:PRD-platform-foundry-aip.md", via: "covered_by" }] };
  }

  // B→A 探针：守卫已知类型全集 = 出厂基线（seed 引用面）∪ 目录投影同源 ACTIVE 集。
  // WO-RESOURCE-CATALOG-ONTOLOGY F1：discover 可见的类型（WorkOrder/MaterialBalance/OrderLine/WIPLot）
  // 必须过 query_objects UNKNOWN_TYPE 守卫，否则「看到 → 照名查被拒」断在接缝。排序保 R6 稳定输出。
  async listObjectTypeKeys(): Promise<string[]> {
    return [...new Set([...MOCK_GUARD_LEGACY_TYPE_KEYS, ...this.activeTypeDefs().map((t) => t.key)])].sort();
  }
  async listObjectTypes(ctx: ToolAuthCtx): Promise<{ key: string; label: string; domain: string; instanceCount: number }[]> {
    // 与 listObjectTypeDefs 同源（MOCK_OBJECT_TYPE_DEFS·ACTIVE 子集）；count 取 mock 可见集，体现"空 vs 不存在"区分。
    const count = async (k: string) => ((await this.queryObjects(ctx, k, {})).data as { total: number }).total;
    const out: { key: string; label: string; domain: string; instanceCount: number }[] = [];
    for (const t of this.activeTypeDefs()) {
      out.push({ key: t.key, label: t.displayName ?? t.key, domain: t.domain ?? "unassigned", instanceCount: await count(t.key) });
    }
    return out;
  }

  /** WO-RESOURCE-CATALOG-ONTOLOGY · 对象类型全量定义 mock（object_type/field 投影供给侧·ACTIVE 过滤镜像 A 侧）。 */
  async listObjectTypeDefs(): Promise<ObjectTypeDefSummary[]> {
    return this.activeTypeDefs();
  }

  /** WO-RESOURCE-CATALOG-ONTOLOGY · type-semantics mock（field 投影的属性口径源·description/unit/dataType）。 */
  async getTypeSemantics(_ctx: ToolAuthCtx, typeKeys: string[]): Promise<TypeSemanticsResponse> {
    const want = new Set(typeKeys);
    return {
      types: this.activeTypeDefs()
        .filter((t) => want.has(t.key))
        .map((t) => ({
          typeKey: t.key,
          displayName: t.displayName ?? t.key,
          props: (t.properties ?? []).map((p) => ({
            propKey: p.propKey,
            description: p.description,
            unit: p.unit,
            dataType: p.dataType,
          })),
          derived: [],
          rules: [],
        })),
    };
  }

  // 推演验证痕迹 Layer 2：对照 mock 知识图谱事实核对断言（确定性，与 mock 对象一致）。
  async crossValidate(ctx: ToolAuthCtx, req: CrossValidateRequest): Promise<CrossValidateResponse> {
    const eq = (a: unknown, b: unknown): boolean => {
      if (a === b) return true;
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
      return String(a).trim() === String(b).trim();
    };
    const verdicts: ClaimVerdict[] = [];
    for (const c of req.claims) {
      let subject: Record<string, unknown> | undefined;
      try {
        subject = (await this.getObject(ctx, c.subjectType, c.subjectId)).data as Record<string, unknown>;
      } catch {
        subject = undefined;
      }
      const property = c.property ?? "";
      const claim = `${c.subjectType}:${c.subjectId}.${property}`;
      if (!subject || !(property in subject)) {
        verdicts.push({ claim, kind: c.kind, subjectType: c.subjectType, subjectId: c.subjectId, property, assertedValue: c.assertedValue, status: "NO_EVIDENCE", snapshotVersion: SNAPSHOT });
        continue;
      }
      const kgValue = subject[property];
      const consistent = eq(kgValue, c.assertedValue);
      verdicts.push({ claim, kind: c.kind, subjectType: c.subjectType, subjectId: c.subjectId, property, assertedValue: c.assertedValue, status: consistent ? "CONSISTENT" : "CONFLICT", ...(consistent ? {} : { kgValue }), snapshotVersion: SNAPSHOT });
    }
    let verdict: "ALL_CONSISTENT" | "PARTIAL" | "CONFLICT" | "NO_CLAIMS";
    if (verdicts.length === 0) verdict = "NO_CLAIMS";
    else if (verdicts.some((v) => v.status === "CONFLICT")) verdict = "CONFLICT";
    else if (verdicts.every((v) => v.status === "CONSISTENT")) verdict = "ALL_CONSISTENT";
    else verdict = "PARTIAL";
    return { claims: verdicts, verdict, snapshotVersion: SNAPSHOT };
  }
}

export class MockSolverClient implements SolverClient {
  async invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    // WO-Phase3-B §3.2：本体查询引擎（mock 镜像真 datacore 输出形状·带逐行 provenance{typeKey,objId,linkPath}）。
    if (solverKey === "ontology_query") {
      const rootType = String(args.rootType ?? "Base");
      const select = Array.isArray(args.select) ? (args.select as { type: string; fields: string[] }[]) : [{ type: "Order", fields: ["so", "qty"] }];
      const sel = select[0]!;
      const linkPath = rootType === sel.type ? [] : ["model_producible_at:in", "order_for_model:in"];
      const orders = [
        { so: "SO-0001", qty: 1200 },
        { so: "SO-0002", qty: 800 },
      ];
      const rows = orders.map((o) => Object.fromEntries(sel.fields.map((f) => [`${sel.type}.${f}`, (o as Record<string, unknown>)[f]])));
      return {
        data: {
          rows,
          columns: sel.fields.map((f) => `${sel.type}.${f}`),
          provenance: orders.map((o) => ({ typeKey: sel.type, objId: `obj_order_${o.so}`, linkPath })),
          queryPlan: { usedSliceKeys: [`biz.plan.${rootType.toLowerCase()}__${sel.type.toLowerCase()}`], hops: linkPath.map((h) => ({ linkKey: h.split(":")[0], direction: "backward", toType: sel.type })), aggregation: [] },
          summary: `${rootType} 遍历 → ${rows.length} 行`,
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    if (solverKey === "capacity_forecast") {
      const rnd = prngFor({ solverKey, modelId: args.modelId, demandDelta: args.demandDelta, weeks: args.weeks });
      const model = SEED_MODELS.find((m) => m.objectId === args.modelId || m.name === args.modelId);
      // WO-SCENARIO-FORCED-EXTRACT：mock 尊重 base 作用域（与真 solver scope:BASE/ALL 同语义）——此前无视 base 恒全网，
      // 导致单测环境断言不了「常州基地 ≠ 全网」语义差（参数到达了、结果却没变=假绿温床）。
      const baseArg = typeof args.base === "string" && args.base ? args.base.toLowerCase().replace(/^obj_base_/, "").replace(/^base_/, "") : undefined;
      const baseGwh = model
        ? SEED_BASES.filter(
            (b) =>
              model.bases.includes(b.name) &&
              (!baseArg || b.objectId.toLowerCase().includes(baseArg) || b.name.toLowerCase().includes(baseArg)),
          ).reduce((s, b) => s + b.gwh, 0)
        : 20;
      const delta = Number(args.demandDelta ?? 0);
      const p50 = Math.round(baseGwh * (1 + rnd() * 0.1) * 10) / 10;
      const p90 = Math.round(p50 * (0.85 + rnd() * 0.1) * 10) / 10;
      // PRD-CAP-DEMANDDELTA mock：effectiveDemand 由 demandDelta 驱动，缺口比例分母随其走。
      const effectiveDemand = Math.round(p50 * (1 + delta) * 10) / 10;
      const gap = Math.max(0, Math.round((effectiveDemand - p90) * 10) / 10);
      const gapPct = effectiveDemand > 0 ? Math.round((gap / effectiveDemand) * 1000) / 10 : 0;
      const baselineDemand = Math.round((effectiveDemand / Math.max(0.01, 1 + delta)) * 10) / 10;
      const bottlenecks = ["化成", "卷绕", "涂布", "装配", "注液"];
      const mainBottleneck = bottlenecks[Math.floor(rnd() * bottlenecks.length)] as string;
      return {
        data: {
          p50,
          p90,
          effectiveDemand,
          baselineDemand,
          demandDelta: delta,
          gap,
          gapPct,
          mainBottleneck,
          mainBn: mainBottleneck,
          ok: gap <= 0,
          dataMode: "MOCK",
          // PRD-CAP-DEMANDDELTA：per-field provenance 供 executor  richer provenance。
          provenance: {
            p50: { formula: "Σ_base weeklyCap × certFactor × curveMult(周)", valueLabel: "P50 产能（万套/窗口）" },
            p90: { formula: "p50 × healthFactor", valueLabel: "P90 产能（万套/窗口）" },
            effectiveDemand: { formula: "baseline × (1 + demandDelta)", valueLabel: "有效需求（万套/窗口）" },
            gap: { formula: "max(0, effectiveDemand − p90) / effectiveDemand", valueLabel: "缺口比例" },
          },
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    if (solverKey === "affected_orders") {
      const base = SEED_BASES.find((b) => b.objectId === args.baseId || b.name === args.baseId);
      const orders = visibleOrders(ctx).filter((o) => (base ? o.bases.includes(base.name) : false));
      // §S1.5 修订（剩余视图增量）：problems[] 分组 + 逐单 4 层根因链（mock 形态与 DataCore 输出对齐）
      const problems =
        orders.length > 0
          ? [
              {
                category: "DELIVERY",
                title: "交期风险订单",
                orderCount: orders.length,
                financeImpact: Math.round(orders.reduce((s, o) => s + o.qty, 0) * 0.6) / 100,
                rootCauseSummary: `${orders.length} 单交期落入 ${base?.name ?? ""} 风险窗口`,
                rootChains: orders.map((o) => ({
                  orderId: o.so,
                  layers: [
                    { kind: "order", label: `订单 ${o.so} · ${o.cust}` },
                    { kind: "judgement", label: `交期判定：${o.due} 落入越线窗口（规则 C03）` },
                    { kind: "rootCause", label: `根因：${base?.name ?? ""} 瓶颈工序紧张` },
                    { kind: "remedy", label: "对策：瓶颈工序扩容（T+6 生效）" },
                  ],
                })),
              },
            ]
          : [];
      return {
        data: {
          baseId: args.baseId,
          count: orders.length,
          columns: ["so", "cust", "model", "qty", "due"],
          rows: orders.map((o) => [o.so, o.cust, o.model, o.qty, o.due]),
          orders,
          problems,
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    // WO-DECISION-KERNEL-WIRE：decision_play 出**推荐组合**（recommendedPlan.optionIds）——orchestrator 决策钩子据此
    // 成一等 Decision（chosenOptionIds 默认取真推演推荐组合）。形状对齐 DecisionPlayOutputSchema（rootCause/options/
    // recommendedPlan），metricKey/factorId 从 args 派生（证 PageContext 真达求解器·同问句不同上下文→不同 Decision）。
    if (solverKey === "decision_play") {
      const metricKey = typeof args.metricKey === "string" && args.metricKey ? args.metricKey : "seg_attain_ess";
      const factorId = typeof args.factorId === "string" && args.factorId ? args.factorId : "cf-cathode-shortage";
      const rnd = prngFor({ solverKey, metricKey, factorId });
      const round1 = (n: number) => Math.round(n * 10) / 10;
      const options = [
        { optionId: `opt-${factorId}-a`, factorId, label: "扩备份供应池", sourceKind: "solver" as const, closesGap: round1(8 + rnd() * 6), cost: 120, cycleDays: 30, risk: 0.3, exposure: 0.4, reversibility: 0.7, provenance: { kind: "求解器" as const, basis: "mitigation_select" } },
        { optionId: `opt-${factorId}-b`, factorId, label: "长协提量", sourceKind: "solver" as const, closesGap: round1(5 + rnd() * 5), cost: 80, cycleDays: 45, risk: 0.4, exposure: 0.3, reversibility: 0.6, provenance: { kind: "求解器" as const, basis: "mitigation_select" } },
      ];
      const recommendedPlan = {
        planId: `plan-${factorId}`,
        optionIds: options.map((o) => o.optionId),
        steps: options.map((o, i) => ({ phase: (i === 0 ? "即刻" : "本季") as "即刻" | "本季" | "半年", action: o.label, optionRef: o.optionId })),
        totalClosesGap: round1(options.reduce((s, o) => s + o.closesGap, 0)),
        totalCost: options.reduce((s, o) => s + o.cost, 0),
      };
      return {
        data: {
          rootCause: { factorId, label: "上游正极材料减供", metricKey, gap: 27.8, unit: "%" },
          options,
          matrix: options.map((o) => ({ optionId: o.optionId, label: o.label, dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility } })),
          triggers: [],
          recommendedPlan,
          sandboxNarrowing: { beforeGap: 27.8, afterGap: round1(27.8 - recommendedPlan.totalClosesGap), narrowedPct: round1((recommendedPlan.totalClosesGap / 27.8) * 100), ticks: 3 },
          summary: `根因「${factorId}」的 ${options.length} 个方案与推荐组合`,
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    // WO-OPTWHATIF-NL-WIRING · optimize_whatif（会话路由 SEAM 用）：MockDataCore 无真本体，故据 selection 派生
    // 决策承载对象 + **真做 argmin 重解**（施加扰动后重算最优）——**决策方案切换是重解的真结果·非返回同一方案的桩**
    // （KILL-MOCK）。真本体绑定 × 真 CP-SAT 的「数据装配×引擎」接缝由 DataCore `test/opt-whatif.test.ts` 装配器 SEAM
    // 坐实（真 assembleBaselineFromSelection + bindToSolverArgs + MockFive 真重解·f1→f2）；此处只证「会话路由 × 决策切换传导」。
    if (solverKey === "optimize_whatif") {
      const family = String(args.family ?? "facility_location");
      const selection = Array.isArray(args.selection) ? (args.selection as { objectId: string }[]) : [];
      const perts = Array.isArray(args.perturbations) ? (args.perturbations as { target: string; value: number | string }[]) : [];
      // 决策承载对象 → openCost（选中序确定性 10/20/30…·真会重优化的口径·不同扰动→不同最优）。
      const baseFac = selection.map((s, i) => ({ id: s.objectId, openCost: (i + 1) * 10 }));
      if (family === "facility_location" && baseFac.length > 0) {
        const argmin = (facs: { id: string; openCost: number }[]) =>
          [...facs].sort((a, b) => a.openCost - b.openCost || a.id.localeCompare(b.id))[0]!;
        const applyPerts = (facs: { id: string; openCost: number }[]) =>
          facs.map((f) => {
            const p = perts.find((x) => x.target === `facilities.${f.id}.openCost`);
            return p ? { ...f, openCost: Number(p.value) } : { ...f };
          });
        const baseWin = argmin(baseFac);
        const pertFac = applyPerts(baseFac);
        const pertWin = argmin(pertFac);
        const baselineObjective = baseWin.openCost;
        const perturbedObjective = pertWin.openCost;
        const deltaObjective = Math.round((perturbedObjective - baselineObjective) * 1e6) / 1e6;
        return {
          data: {
            baselineObjective, perturbedObjective, deltaObjective,
            feasible: true, conflictConstraints: [],
            explanation: `扰动 ${perts.length} 条 → 目标 ${baselineObjective} → ${perturbedObjective}（Δ=${deltaObjective}）`,
            baselineSolution: { openFacilities: [baseWin.id], objective: baselineObjective, optimal: true },
            perturbedSolution: { openFacilities: [pertWin.id], objective: perturbedObjective, optimal: true },
            summary: `基线 ${baselineObjective} → 扰动后 ${perturbedObjective}（Δ=${deltaObjective}，可行）`,
          },
          snapshotVersion: SNAPSHOT,
        };
      }
      // 装配不出（无选中/未支持族）→ 诚实报缺（orchestrator 落回 path-B·不伪造）。
      return { data: { applicable: false, missingRoles: ["selection（无选中决策对象）"], feasible: false, baselineObjective: null, perturbedObjective: null, deltaObjective: null, conflictConstraints: [], summary: "optimize_whatif 装配报缺——诚实落回" }, snapshotVersion: SNAPSHOT };
    }
    // G-1：20 场景目录的其余求解器（cert_schedule/kit_readiness/… 见 SOLVER_KEYS）在 mock 侧
    // 返回代表性确定性载荷，使路径A 工作流的 invoke_solver 步骤完成而不抛 unknown solver；
    // 真实数值由 DataCore 求解器产出（见跨服务联调）。种子计划用静态 text 渲染，不解引用此处特定键。
    return { data: { solverKey, ok: true, args }, snapshotVersion: SNAPSHOT };
  }
}

export class MockRuleEngineClient implements RuleEngineClient {
  /**
   * 引用模式增量 L5：规则「源头一改、引用方全部生效」—— 测试可改阈值/版本模拟规则发布新版。
   * DF.13：初值必须 = 真 DataCore 的 C08 现行红线（`OUTSOURCE_REDLINE.maxRatio`）。此前写死了一个与真值不同的常数 —— mock
   * 与被 mock 者对同一业务事实各执一词，正是"绿测试≠能用"的温床：agentcore 全绿但接上真 A 行为就变。
   */
  c08Threshold: number = OUTSOURCE_REDLINE.maxRatio;
  versions: Record<string, number> = { C03: 1, C08: 1, C13: 1 };

  /** 模拟规则 C08 发布新版（阈值变更）：下一次求值即用新阈值 + 新版本号。 */
  publishC08(threshold: number): void {
    this.c08Threshold = threshold;
    this.versions.C08 = (this.versions.C08 ?? 1) + 1;
  }

  async evaluate(_ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const all: Record<string, () => RuleVerdict> = {
      C03: () => {
        const delta = Number(p.demandDelta ?? 0);
        const passed = !(delta > 0.5);
        return {
          ruleId: "C03",
          passed,
          severity: "BLOCK",
          explanation: passed
            ? "需求增量在产能上限之内"
            : `需求增量 ${delta} 超过产能上限约束（>0.5 触发 BLOCK）`,
        };
      },
      C08: () => ({
        ruleId: "C08",
        passed: !(Number(p.outsourceRatio ?? 0) > this.c08Threshold),
        severity: "WARN",
        explanation: `外协比例红线检查（阈值 ${this.c08Threshold}）`,
      }),
      C13: () => {
        const passed = p.creditExceeded !== true;
        return {
          ruleId: "C13",
          passed,
          severity: "BLOCK",
          explanation: passed ? "信用额度检查通过" : "客户信用额度已超限",
        };
      },
    };
    const ids = ruleIds === "ALL_APPLICABLE" ? Object.keys(all) : ruleIds;
    return ids
      .filter((id) => all[id])
      .map((id) => ({ ...(all[id] as () => RuleVerdict)(), ruleVersion: this.versions[id] ?? 1 }));
  }
  // B→A 探针：出厂规则库已发布 key 全集（覆盖 seed workflow evaluate_rules 的 C03/C13 等）。
  async listRuleKeys(): Promise<string[]> {
    return ["C01", "C02", "C03", "C04", "C05", "C06", "C08", "C09", "C10", "C11", "C13", "C15", "C16", "C18", "C21", "C22", "C23", "C24", "C26", "C27", "C28", "C29", "C30", "C31", "C32", "C33"];
  }
  // WO-DRIL-P1 · 规则元数据投影供给侧（mock）：已知规则给真描述，其余按 key 合成（description 非空门达标）。
  async listRules(): Promise<import("../tools/clients.js").RuleSummary[]> {
    const known: Record<string, { name: string; description: string; scope: string[]; severity: string; expression: string }> = {
      C03: { name: "产能上限约束", description: "需求增量超过产能上限（demandDelta>0.5）触发 BLOCK。", scope: ["Order", "Model"], severity: "BLOCK", expression: "Order.demandDelta > 0.5" },
      C08: { name: "外协比例红线", description: "外协比例超过阈值触发 WARN（保交付但提示风险）。", scope: ["Base"], severity: "WARN", expression: "outsourceRatio > threshold" },
      C13: { name: "客户信用额度", description: "客户信用额度已超限触发 BLOCK（禁止继续接单）。", scope: ["Customer", "Order"], severity: "BLOCK", expression: "creditExceeded == true" },
    };
    const keys = await this.listRuleKeys();
    return keys.map((key) => {
      const k = known[key];
      return k
        ? { key, name: k.name, description: k.description, scopeObjectTypes: k.scope, severity: k.severity, expression: k.expression }
        : { key, name: key, description: undefined, scopeObjectTypes: [], severity: "WARN" };
    });
  }
}

export class MockActionClient implements ActionClient {
  readonly drafts: { draftId: string; actionType: string; payload: unknown; status: "PENDING_APPROVAL" }[] = [];

  async createDraft(
    _ctx: ToolAuthCtx,
    actionType: string,
    payload: unknown,
  ): Promise<{ draftId: string; status: "PENDING_APPROVAL" }> {
    const draftId = newId("draft");
    this.drafts.push({ draftId, actionType, payload, status: "PENDING_APPROVAL" });
    return { draftId, status: "PENDING_APPROVAL" };
  }
}

/**
 * WO-DECISION-KERNEL-WIRE：L2 决策内核 mock（DataCore kernel 的测试替身）。
 * 记录 create/commit 调用（`created`/`committed`）供 orchestrator 决策钩子的接缝断言（成决策入参=真推演推荐组合·
 * 立即落地才 commit）。commit 派 ActionDraft id（对齐真 kernel：每选定方案一 DRAFT·走 S2）。真 HTTP·非 mock 的
 * POST /a/v1/decisions 由 datacore 侧 seam 测试（decision-wire-seam）证；此 mock 只固化 agentcore 侧钩子逻辑。
 */
export class MockDecisionClient implements DecisionClient {
  readonly created: { input: CreateDecisionInput; decision: Decision }[] = [];
  readonly committed: string[] = [];
  private readonly store = new Map<string, Decision>();

  async create(ctx: ToolAuthCtx, input: CreateDecisionInput): Promise<Decision> {
    const id = newId("dec");
    const now = "2024-01-01T00:00:00.000Z";
    const options = input.chosenOptionIds.map((optionId) => ({
      optionId,
      factorId: input.factorId ?? "cf-root",
      label: `方案 ${optionId}`,
      sourceKind: "solver" as const,
      closesGap: 5,
      cost: 100,
      cycleDays: 30,
      risk: 0.3,
      exposure: 0.3,
      reversibility: 0.7,
      provenance: { kind: "求解器" as const, basis: "mitigation_select" },
    }));
    const decision: Decision = {
      id,
      tenantId: ctx.tenantId,
      metricKey: input.metricKey,
      factorId: input.factorId ?? null,
      rootRef: {
        solverKey: "gap_attribution",
        metricKey: input.metricKey,
        factorId: input.factorId ?? null,
        rootMetric: { key: input.metricKey, name: input.metricKey, unit: "%", gap: 27.8 },
        residualPct: null,
        topBase: null,
        summary: `根因快照 ${input.metricKey}`,
      },
      optionsRef: {
        solverKey: "decision_play",
        options,
        recommendedPlan: { planId: `plan-${id}`, optionIds: input.chosenOptionIds, steps: [], totalClosesGap: 0, totalCost: 0 },
      },
      chosenOptionIds: input.chosenOptionIds,
      actionDraftIds: [],
      status: "PROPOSED",
      trace: [],
      decidedBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      outcome: null, // WO-LEARNING-LOOP-FEEDBACK：Decision.outcome 必填可空（嫁接 WO8×学习闭环调和）
    };
    this.store.set(id, decision);
    this.created.push({ input, decision });
    return decision;
  }

  async commit(ctx: ToolAuthCtx, decisionId: string): Promise<Decision> {
    const d = this.store.get(decisionId);
    if (!d || d.tenantId !== ctx.tenantId) throw new Error(`decision not found: ${decisionId}`);
    const committed: Decision = {
      ...d,
      status: "COMMITTED",
      actionDraftIds: d.chosenOptionIds.map(() => newId("draft")), // 每选定方案派一 ActionDraft（DRAFT·S2）
      updatedAt: "2024-01-01T00:00:01.000Z",
    };
    this.store.set(decisionId, committed);
    this.committed.push(decisionId);
    return committed;
  }
}

/** S4.1 mock KB: 3 seeded doc chunks, scored via the deterministic pseudo-embedding. */
export const SEED_KB_CHUNKS: { docId: string; connId: string; source: string; span: { start: number; end: number }; text: string }[] = [
  {
    docId: "doc_sop_huacheng",
    connId: "conn_kb_default",
    source: "工艺SOP-化成工序.md",
    span: { start: 0, end: 132 },
    text: "化成工序产能由化成柜通道数与单通道产出决定；扩通道需设备部审批。通道利用率超过 95% 持续三日应升级瓶颈告警（C05），并评估老化库位余量。",
  },
  {
    docId: "doc_logistics_south",
    connId: "conn_kb_default",
    source: "物流手册-华南区.md",
    span: { start: 210, end: 338 },
    text: "华南地区整车物流时长平均 5 天，紧急订单可申请航空件（48 小时达），需在交付评审中扣减净生产窗口（wkEff）后再做逐批校验。",
  },
  {
    docId: "doc_quality_8d",
    connId: "conn_kb_default",
    source: "质量管理-8D流程.md",
    span: { start: 64, end: 190 },
    text: "良率波动超过 2 个百分点须启动 8D 分析；涂布/卷绕工序的良率基线每周由时序聚合作业回写至本体快照属性 yield_baseline。",
  },
];

export class MockKbClient implements KbClient {
  async search(
    _ctx: ToolAuthCtx,
    input: { query: string; topK?: number; connId?: string },
  ): Promise<ToolPayload> {
    const topK = Math.min(Math.max(1, input.topK ?? 5), 10);
    const qv = pseudoEmbed(input.query);
    const hits: KbHit[] = SEED_KB_CHUNKS.filter((c) => !input.connId || c.connId === input.connId)
      .map((c) => ({
        text: c.text,
        score: Math.round(cosine(qv, pseudoEmbed(c.text)) * 1000) / 1000,
        docId: c.docId,
        span: c.span,
        source: c.source,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return { data: { hits }, snapshotVersion: SNAPSHOT };
  }
}

const MAX_BUCKETS = 120;
const DAY_MS = 24 * 3600_000;

/**
 * A8.4 mock: deterministic aggregate buckets for seed entities.
 * LLM 隔离红线：只产出聚合桶（≤120），永不返回 ts_points 原始行；
 * base_manager 行级过滤与本体对象同口径（常州管理员仅得常州实体）。
 */
export class MockTimeseriesClient implements TimeseriesClient {
  async aggQuery(ctx: ToolAuthCtx, input: QueryTimeseriesAggInput): Promise<ToolPayload> {
    const visible = new Set(visibleBases(ctx).flatMap((b) => [b.objectId, b.name]));
    const entityIds = input.entityIds.filter((e) => visible.has(e));

    const from = Date.parse(input.window.from);
    const to = Date.parse(input.window.to);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
      throw new Error(`invalid window: ${input.window.from} ~ ${input.window.to}`);
    }
    const days = Math.floor((to - from) / DAY_MS) + 1;
    const perDay = input.window.grain === "shift" ? 3 : input.window.grain === "day" ? 1 : 1 / 7;
    const bucketCount = Math.max(1, Math.ceil(days * perDay));
    if (bucketCount > MAX_BUCKETS) {
      throw new Error(`BUCKET_LIMIT_EXCEEDED: 该窗口在 grain=${input.window.grain} 下共 ${bucketCount} 桶（上限 ${MAX_BUCKETS}），请加大 grain`);
    }

    const stepMs = input.window.grain === "week" ? 7 * DAY_MS : DAY_MS;
    const points: { entityId: string; bucket: string; value: number }[] = [];
    for (const entityId of entityIds) {
      for (let i = 0; i < bucketCount; i++) {
        const dayIdx = input.window.grain === "shift" ? Math.floor(i / 3) : i;
        const t = new Date(from + dayIdx * stepMs).toISOString().slice(0, 10);
        const bucket = input.window.grain === "shift" ? `${t}#S${(i % 3) + 1}` : t;
        const rnd = prngFor({ seriesKey: input.seriesKey, entityId, bucket, agg: input.agg });
        points.push({ entityId, bucket, value: Math.round((0.55 + rnd() * 0.4) * 1000) / 10 });
      }
    }
    // tsAgg = A8.3 窗口级溯源载体（aggRunId/window/rowsIn），下游 enrich 为 TS_AGGREGATE ProvenanceRef
    return {
      data: {
        points,
        tsAgg: {
          aggRunId: `aggrun_${hashSeed(input).toString(16)}`,
          specKey: `${input.seriesKey}@v1`,
          window: { start: input.window.from, end: input.window.to },
          rowsIn: points.length * 96,
        },
      },
      snapshotVersion: SNAPSHOT,
    };
  }
}

export class MockIamClient implements IamClient {
  /** Optional per-test overrides: toolName -> allowed */
  readonly denyTools = new Set<string>();

  async check(ctx: ToolAuthCtx, toolName: string, _args: unknown): Promise<{ allowed: boolean; reason?: string }> {
    if (this.denyTools.has(toolName)) return { allowed: false, reason: `工具 ${toolName} 被策略拒绝` };
    // Coarse-grained: action drafts require a non-viewer role; everything else allowed.
    if (toolName === "create_action_draft" && ctx.roles.includes("viewer")) {
      return { allowed: false, reason: "viewer 角色不可发起 Action 草稿" };
    }
    return { allowed: true };
  }
}

/** 能力发现与路由 §1：mock 目录（CR1/CR5 测试用，描述齐备）。 */
class MockCatalogClient implements CatalogClient {
  async discover(_ctx: ToolAuthCtx, kind: "slices" | "solvers", query?: string) {
    const slices: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] = [
      { key: "model_capacity_network", name: "型号可产基地网络", description: "型号→可产基地子图", argHints: { modelId: "型号 ID" }, domain: "product" },
      { key: "base_risk_profile", name: "基地风险画像", description: "基地风险画像子图", argHints: { baseId: "基地 ID" }, domain: "plan" },
    ];
    const solvers: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] = [
      { key: "capacity_forecast", name: "产能推演", description: "推演产能满足度 P50/P90/缺口", argHints: { modelId: "型号 ID", qty: "需求量" }, domain: "plan" },
      { key: "affected_orders", name: "受影响订单", description: "扰动→受影响订单清单", argHints: { baseId: "基地 ID" }, domain: "plan" },
    ];
    const items = (kind === "slices" ? slices : solvers).filter(
      (it) => !query || it.key.includes(query) || it.name.includes(query) || it.description.includes(query),
    );
    return { items: items.slice(0, 20) };
  }
  /** A1 求解器全集注册表（mock：场景 2 + 通用 1，含 A8 CP-SAT 代表 assignment_optimize 供 MCP 工具构建）。 */
  async solverRegistry(_ctx: ToolAuthCtx, query?: string) {
    const all: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] = [
      { key: "capacity_forecast", name: "产能推演", description: "推演产能满足度 P50/P90/缺口", argHints: { modelId: "型号 ID", qty: "需求量" }, domain: "plan" },
      { key: "affected_orders", name: "受影响订单", description: "扰动→受影响订单清单", argHints: { baseId: "基地 ID" }, domain: "plan" },
      { key: "assignment_optimize", name: "指派最优化", description: "通用指派最优化（CP-SAT 可证最优）", argHints: { items: "待指派项", bins: "容器" }, domain: "generic" },
    ];
    const items = all.filter((it) => !query || it.key.includes(query) || it.name.includes(query) || it.description.includes(query));
    return { items };
  }
}

/** CL.2 合规数据生成 mock：确定性元信息回执（不产业务数字），R6 同入参字节一致。 */
export class MockDataGenClient implements DataGenClient {
  async runSynthetic(_ctx: ToolAuthCtx, req: { industry: string; scale: string; seed?: number; livedIn?: boolean }): Promise<Record<string, unknown>> {
    const seed = req.seed ?? 42;
    return {
      jobId: `synjob-${req.industry}-${req.scale}-${seed}`,
      status: "DONE",
      producedSeriesKeys: ["attainment:line", "oee:base"],
      objectCounts: { PlanTarget: 17, AnnualScenario: 3, SopVersion: 1 },
    };
  }
  async buildDomain(_ctx: ToolAuthCtx, req: { story: string; seed?: number }): Promise<Record<string, unknown>> {
    return {
      runId: `sbr-${hashSeed(req.story) % 100000}`,
      producedArtifacts: [{ module: "ontology", kind: "object_type", action: "CREATED", status: "DRAFT" }],
      gapReport: { gaps: [] },
    };
  }
}

/**
 * 增量4 §5：沙盘指挥台 mock —— 有状态 in-memory 会话，使 init→tick→world 在测试中连贯
 * （tenant 隔离；模拟态不写真值：act/tick 只动会话 TickState，回执仅会话态元信息）。
 * 行为镜像 DataCore /a/v1/sim/*：恒等 tick 进位（无传导规则桩），certify 回轻量就绪摘要。
 */
export class MockSimClient implements SimClient {
  private readonly sessions = new Map<string, { tenantId: string; curTick: number; state: Record<string, unknown>; scope: Record<string, unknown> }>();

  async init(ctx: ToolAuthCtx, req: { baseSnapshot?: Record<string, unknown>; scope?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const id = newId("sims");
    const base = req.baseSnapshot ?? {};
    const status = Object.keys(base).length > 0 ? "READY" : "DRAFT";
    this.sessions.set(id, { tenantId: ctx.tenantId, curTick: 0, state: { ...base }, scope: req.scope ?? {} });
    return { id, status, curTick: 0, _note: "沙盘会话（模拟态，不写真值）。" };
  }
  async tick(ctx: ToolAuthCtx, sessionId: string, n: number): Promise<Record<string, unknown>> {
    const s = this.get(ctx, sessionId);
    const steps = Math.max(1, Math.floor(n || 1));
    s.curTick += steps; // 恒等桩进位（无 PUBLISHED 传导规则；确定性 R6）
    return { curTick: s.curTick, state: s.state, _note: "tick 为模拟态推进，未写真值（R4）。" };
  }
  async world(ctx: ToolAuthCtx, sessionId: string): Promise<Record<string, unknown>> {
    const s = this.get(ctx, sessionId);
    return { tick: s.curTick, state: s.state };
  }
  async certify(ctx: ToolAuthCtx, sessionId: string, scope?: string, target?: string): Promise<Record<string, unknown>> {
    this.get(ctx, sessionId); // 404 隔离（R2 租户）
    const scopeKind = scope === "LOCAL" ? "LOCAL" : "GLOBAL";
    return { scope: scopeKind, targetRef: target ?? null, worldCompleteness: 1, canEnterSimulation: true, level: "L0", gaps: [] };
  }
  private get(ctx: ToolAuthCtx, sessionId: string): { tenantId: string; curTick: number; state: Record<string, unknown>; scope: Record<string, unknown> } {
    const s = this.sessions.get(sessionId);
    if (!s || s.tenantId !== ctx.tenantId) throw new Error(`sim session not found: ${sessionId}`);
    return s;
  }
}

/**
 * WO-PROMPT-DEFAULTS-WIRING · 提示词模板 mock（测试替身）。默认无 override → 返 PLATFORM_DEFAULT
 * （消费方 resolvePromptOverride 只采纳 TENANT_OVERRIDE → 行为 = 兜底硬编码·R6 字节兼容·既有测试零回归）。
 * 测试可 setOverride(tid,key,tmpl) 注入租户 override，驱动"改模板 → 分类 prompt 变"的取值逻辑；
 * 真 HTTP 驱动的灭漂移接缝由 datacore-http SEAM 测（起真源 + createHttpDataCore）证。
 */
export class MockPromptClient implements PromptClient {
  private readonly overrides = new Map<string, { template: string; version: number }>();

  /** 测试注入：为 (tenantId,key) 设租户 override（模拟 admin PUT /a/v1/prompt-templates/:key）。 */
  setOverride(tenantId: string, key: PromptKey, template: string): void {
    const cur = this.overrides.get(`${tenantId}::${key}`);
    this.overrides.set(`${tenantId}::${key}`, { template, version: (cur?.version ?? 0) + 1 });
  }
  /** 测试清除：删 (tenantId,key) override（回落 PLATFORM_DEFAULT）。 */
  clearOverride(tenantId: string, key: PromptKey): void {
    this.overrides.delete(`${tenantId}::${key}`);
  }

  async getPromptTemplate(ctx: ToolAuthCtx, key: PromptKey): Promise<ResolvedPrompt | undefined> {
    const ov = this.overrides.get(`${ctx.tenantId ?? ""}::${key}`);
    return ov
      ? { key, template: ov.template, source: "TENANT_OVERRIDE", version: ov.version }
      : { key, template: PLATFORM_PROMPT_DEFAULTS[key], source: "PLATFORM_DEFAULT", version: 0 };
  }
  /** mock 无缓存（每次直读 overrides）；失效为 no-op（幂等无害·满足接口）。 */
  invalidatePromptTemplate(): void {}
}

export interface MockDataCore extends DataCoreClient {
  ontology: MockOntologyClient;
  solver: MockSolverClient;
  rules: MockRuleEngineClient;
  action: MockActionClient;
  decision: MockDecisionClient;
  iam: MockIamClient;
  kb: MockKbClient;
  timeseries: MockTimeseriesClient;
  catalog: MockCatalogClient;
  datagen: MockDataGenClient;
  sim: MockSimClient;
  prompts: MockPromptClient;
}

export function createMockDataCore(): MockDataCore {
  return {
    ontology: new MockOntologyClient(),
    solver: new MockSolverClient(),
    rules: new MockRuleEngineClient(),
    action: new MockActionClient(),
    decision: new MockDecisionClient(),
    iam: new MockIamClient(),
    kb: new MockKbClient(),
    timeseries: new MockTimeseriesClient(),
    catalog: new MockCatalogClient(),
    epoch: { async current() { return { epoch: 1 }; } },
    datagen: new MockDataGenClient(),
    sim: new MockSimClient(),
    prompts: new MockPromptClient(),
  };
}
