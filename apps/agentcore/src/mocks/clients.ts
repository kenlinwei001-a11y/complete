import type { ClaimVerdict, CrossValidateRequest, CrossValidateResponse, EntryReadiness, PlanSliceRequest, PlanSliceResponse, QueryTimeseriesAggInput, RuleVerdict, StoryBuildRun, ToolPayload } from "@platform/contracts";
import { newId } from "../ids.js";
import type {
  ActionClient,
  CatalogClient,
  DatabuilderClient,
  DataCoreClient,
  DataGenClient,
  IamClient,
  KbClient,
  KbHit,
  OntologyClient,
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

  async getObject(ctx: ToolAuthCtx, objectType: string, objectId: string): Promise<ToolPayload> {
    const result = await this.queryObjects(ctx, objectType, {});
    const items = (result.data as { items: Record<string, unknown>[] }).items;
    // 也匹配生产风格主键（场景目录用 baseId/modelId 如 "changzhou"/"4680-NCM"；本 mock 历史用前缀 id
    // 如 "base_changzhou"）——剥前缀对齐，使 mock 解析与生产一致（否则场景 objectRef 槽解析不到→假阴）。
    const strip = (v: unknown) => String(v ?? "").replace(/^(base_|model_|order_|line_|process_|equipment_)/, "");
    const found = items.find((i) => i.objectId === objectId || i.name === objectId || i.so === objectId || strip(i.objectId) === objectId);
    if (!found) throw new Error(`object not found: ${objectType}/${objectId}`);
    return { data: found, snapshotVersion: SNAPSHOT };
  }

  /** LAUNCHER-GROUNDED-QUESTIONS：mock 无模拟时钟 → 诚实返回 undefined（相对时间不接地，不编造 wall clock）。 */
  async getSimClock(): Promise<{ simDate: string; t0: string; currentTick: number } | undefined> {
    return undefined;
  }

  /**
   * SCENARIO-PACK-SCOPE 测试替身：据租户解析行业包。真链路（HTTP）由 DataCore loadIndustryPack 解析；
   * mock 以租户名约定映射行业（`logi*` → 物流仓配·带 2 张决策场景卡；其余 → 电池·scenarios=[]，走 SCENARIO_CATALOG）。
   * 物流两卡镜像 datacore `packs/logistics-warehouse.pack.ts` 的 logisticsScenarios（测试替身固定夹具·非真值来源）。
   */
  async getScenarioPack(ctx: ToolAuthCtx): Promise<{ industryKey: string; scenarios: import("@platform/contracts").IndustryScenario[] }> {
    if (ctx.tenantId === "logi" || ctx.tenantId.startsWith("logi-")) {
      return {
        industryKey: "logistics-warehouse",
        scenarios: [
          { key: "network-demand", title: "配送网络覆盖规模", question: "全网需覆盖多少月度配送需求量？（选址覆盖规模输入）", answer: { kind: "objects-aggregate", objectType: "Store", agg: "sum", prop: "demand", unit: "件" } },
          { key: "site-cost-profile", title: "候选配送仓成本画像", question: "各候选配送仓的开仓成本 / 服务成本 / 日吞吐如何？（选址最优化输入清单）", answer: { kind: "objects", objectType: "Warehouse", columns: ["whId", "region", "openCost", "serveCost", "capacity"], limit: 20 } },
        ],
      };
    }
    return { industryKey: "battery-manufacturing", scenarios: [] };
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
  async provisionWorld(_ctx: ToolAuthCtx, _req?: { scale?: string; seed?: number }): Promise<{ provisioned: boolean; reason?: string; industry?: string; objectCount?: number }> {
    return { provisioned: true, industry: "battery-manufacturing", objectCount: 120 };
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

  // B→A 探针：出厂本体已发布对象类型全集（覆盖 seed 的 agent scope / intent slot 引用）。
  async listObjectTypeKeys(): Promise<string[]> {
    return ["Base", "Order", "Model", "Line", "Process", "Equipment", "Shipment", "Segment", "Customer", "Material"];
  }
  async listObjectTypes(ctx: ToolAuthCtx): Promise<{ key: string; label: string; domain: string; instanceCount: number }[]> {
    // 确定性真实类型清单（key+中文标签+域+实例数）；count 取 mock 可见集，体现"空 vs 不存在"区分。
    const count = async (k: string) => ((await this.queryObjects(ctx, k, {})).data as { total: number }).total;
    return [
      { key: "Base", label: "生产基地", domain: "factory", instanceCount: await count("Base") },
      { key: "Order", label: "销售订单", domain: "sales", instanceCount: await count("Order") },
      { key: "Model", label: "产品型号", domain: "product", instanceCount: await count("Model") },
    ];
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

/**
 * WO ONTO-SCEN-RENDER-PROJ：16 张派生场景卡所用求解器的 mock 输出（与真实 DataCore 输出**同形状**——
 * 顶层键 ⊆/⊇ 覆盖 SOLVER_OUTPUT_SHAPES 登记字段与全部渲染绑定字段；结构按真实 invoke 实测输出镜像）。
 * 确定性字面量（R6）；dataMode:"MOCK" 诚实标（mock 世界产物，非真值冒充）。
 */
const MOCK_SOLVER_OUTPUTS: Record<string, Record<string, unknown>> = {
  // UPG-L0-COVERAGE-FILL 返工：causal_attribution（S03/S27 通用因果归因）mock 输出**形状对齐真实 DataCore**
  // （crossed/rootDrivers/crossedCount/totalGap/direction/valueField/driverField/summary + dataMode:MOCK 诚实标）——
  // 使路径A投影（SOLVER_RENDER_BINDINGS.causal_attribution）在 mock 侧与真后端同构（真值以真 DataCore 联调为准）。
  causal_attribution: {
    crossed: [{ id: "kpi-material", name: "物料保障率", value: 94.6, threshold: 95, gap: 0.4, gapPct: 0.42, offTarget: "是", ratio: 0.9958 }],
    rootDrivers: [
      { group: "三元正极", contribution: 654, count: 1, share: 0.7466 },
      { group: "电解液", contribution: 222, count: 1, share: 0.2534 },
    ],
    crossedCount: 1,
    totalGap: 0.4,
    direction: "below",
    valueField: "actual",
    driverField: "gapTon",
    summary: "1 项「Metric.actual」越线（最重「物料保障率」缺口 0.4）；根因主驱动「三元正极」（gapTon 654·占 74.7%）",
    dataMode: "MOCK",
  },
  plan_audit: {
    H: [{ id: "X05", title: "现金垫", ruleRef: "C18", why: "现金垫低于底线", kind: "现金" }],
    M: [
      { id: "X02", title: "产销缺口", why: "缺口处于关注区间", kind: "产销" },
      { id: "X07", title: "长协覆盖", why: "覆盖低于阈值", kind: "供给" },
    ],
    S: [{ id: "S-X05", title: "现金垫修正", ruleRef: "C18", why: "CAPEX 缩减/推后", kind: "现金" }],
    score: 50,
    verdict: "站不住",
    dataMode: "MOCK",
  },
  plan_generate: {
    schemes: [
      { no: "壹", name: "稳健方案 · 守盈利", pathKey: "A" },
      { no: "贰", name: "进取方案 · 扩份额", pathKey: "C" },
      { no: "叁", name: "平衡方案", pathKey: "D" },
    ],
    recommend: "D",
    dataMode: "MOCK",
  },
  cert_schedule: {
    schedule: [
      { model: "4680-LFP", line: "LINE-hefei", startWeek: 1, finishWeek: 3, unlockCapacity: 26.5, priority: 0.3 },
      { model: "CTP-LFP", line: "LINE-yichun", startWeek: 2, finishWeek: 5, unlockCapacity: 18.2, priority: 0.22 },
    ],
    engineerGroups: 3,
    ruleRefs: ["C26"],
    dataMode: "MOCK",
  },
  kit_readiness: {
    rows: [
      { orderId: "SO-10001", kitRatio: 48.2, shortItems: [], advice: "齐套" },
      { orderId: "SO-10002", kitRatio: 22.5, shortItems: ["三元正极"], advice: "缺料" },
    ],
    shortageCount: 1,
    ruleRefs: ["C06", "C16"],
    dataMode: "MOCK",
  },
  lta_gap: {
    material: "三元正极",
    month: "2026-07",
    netDemand: 7617.12,
    coverage: 0.52,
    gap: 3667.79,
    po: [
      { batch: 1833.9, latestOrderLeadDays: 14 },
      { batch: 1833.9, latestOrderLeadDays: 28 },
    ],
    ruleRefs: ["C16", "C27"],
    dataMode: "MOCK",
  },
  inventory_optimize: {
    over: [],
    under: [
      { matId: "cell_case", underQty: 536.32 },
      { matId: "cu_foil", underQty: 120.5 },
    ],
    idle: [{ matId: "cu_foil", idleDays: 116 }],
    releasableCash: 0,
    ruleRefs: ["C16", "C28"],
    dataMode: "MOCK",
  },
  changeover_sequence: {
    lineId: "LINE-A",
    sequence: [
      { orderId: "SO-10001", modelId: "4680-NCM", changeoverMin: 0 },
      { orderId: "SO-10004", modelId: "4680-NCM", changeoverMin: 12 },
    ],
    totalChangeoverMin: 46,
    savedVsDueMin: 0,
    infeasible: [],
    ruleRefs: ["C22", "C29"],
    dataMode: "MOCK",
  },
  yield_diagnosis: {
    breakpoint: { day: 31, drop: 0.0571 },
    candidates: [{ day: 33, kind: "换批", source: "SYNTHETIC", synthetic: true, distance: 2 }],
    ruleRefs: ["C30"],
    dataMode: "MOCK",
  },
  maintenance_stagger: {
    adjustments: [
      { base: "常州", fromWeek: 10, toWeek: 8, loadDrop: 80 },
      { base: "合肥", fromWeek: 9, toWeek: 7, loadDrop: 65 },
    ],
    unresolved: [],
    ruleRefs: ["C11"],
    dataMode: "MOCK",
  },
  outsourcing_split: {
    allocation: [
      { channel: "overtime", name: "自产加班", qty: 32000, cost: 32000 },
      { channel: "outsource", name: "外协", qty: 48000, cost: 119947.2 },
    ],
    totalCost: 151947.2,
    savedVsAllDelay: 48052.8,
    outsourceQualityGate: "C31：外协厂良率 ≥ 自产 −0.02",
    ruleRefs: ["C08", "C31"],
    dataMode: "MOCK",
  },
  quote_margin: {
    margin: 0.2565,
    floor: 0.12,
    diff: 0.1365,
    verdict: "过线",
    breakdown: { bomCost: 313.75, mfg: 50, logistics: 8, price: 500 },
    ruleRefs: ["C15", "C24"],
    dataMode: "MOCK",
  },
  credit_exposure: {
    limit: 5782,
    exposure: 2075,
    available: 3707,
    exposureBreakdown: { receivables: 1920, wipUnbilled: 155 },
    overdue: [{ invoiceId: "INV-4-0", overdueDays: 38, amount: 1120 }],
    newOrderVerdict: "冻结（存在逾期>30天）",
    ruleRefs: ["C13", "C32"],
    dataMode: "MOCK",
  },
  capex_scenario: {
    scenarioKey: "基准",
    quarters: 4,
    demand: [50, 48, 49, 51],
    s0: [45, 45, 45, 45],
    S: [45, 46, 47, 49],
    G: [5, 2, 2, 2],
    windows: [{ kind: "gap", fromQ: 0, toQ: 3 }],
    projects: [{ id: "P1", name: "扩产线", q0: 1, cap: 4, irr: 26.35, util24: 1, c23pass: true }],
    c23: { irrMin: 0.15, util24Min: 0.75 },
    dataMode: "MOCK",
  },
  mrp_netting: {
    materials: [
      { material: "三元正极", netDemand: 8180, ltaCoverPct: 92, gap: 654, earliestComplete: "2026-06-28" },
      { material: "石墨负极", netDemand: 5120, ltaCoverPct: 100, gap: 0, earliestComplete: "2026-06-20" },
      { material: "电解液", netDemand: 2400, ltaCoverPct: 80, gap: 480, earliestComplete: "2026-07-05" },
    ],
    shortageCount: 2,
    summary: "3 种物料，2 种现货缺口（C06 齐套口径）",
    dataMode: "MOCK",
  },
  quarterly_gap: {
    quarter: "2026Q2",
    combo: [],
    residualGap: 50,
    ruleRefs: ["C08", "C29"],
    dataMode: "MOCK",
  },
  carbon_footprint: {
    modelId: "4680-NCM",
    baseName: "成都",
    total: 349.62,
    breakdown: { materialCarbon: 348.31, energyCarbon: 1.3 },
    threshold: 70,
    verdict: "超标",
    maxLever: "物料:al_foil",
    ruleRefs: ["C33"],
    dataMode: "MOCK",
  },
  // QUERY30 缺口③ Q01 样板：接单挤占推演 mock 输出（形状镜像真实 DataCore `what_if_displacement`·覆盖
  // SOLVER_RENDER_BINDINGS 全字段：recommended/schemeCount/highPriDisplaceDays/schemes/displacedOrders/summary）。
  // 确定性字面量·dataMode:"MOCK" 诚实标（真值以真 DataCore invoke/FDE 为准，见 docs/evidence/QUERY30-ORCH-Q01-fde.md）。
  what_if_displacement: {
    newOrder: { model: "4680-NCM", qty: 4200, advancePct: 0.2, weeks: 6, dailyDemand: 100 },
    base: "常州",
    feasibleWithoutDisplacement: false,
    freeDaily: 20,
    shortfallDaily: 80,
    displacedOrders: [
      { so: "SO-3502", cust: "储能大客户F", pri: "低", qty: 2100, displaceDays: 21, penaltyWan: 10.5, reScheme: "延期 21 天（违约金 10.5 万）" },
      { so: "SO-3488", cust: "动力集团A", pri: "高", qty: 2100, displaceDays: 21, penaltyWan: 21, reScheme: "延期 21 天（违约金 21 万）" },
    ],
    highPriDisplaceDays: 21,
    totalDisplaced: 2,
    schemes: [
      { key: "delay", name: "延期在手单", feasible: true, displacedCount: 2, promiseDeltaDays: 21, marginPct: 13.5, outsourceRatio: 0, penaltyTotalWan: 31.5, cashOccupiedWan: 252, note: "位移 2 单" },
      { key: "outsource", name: "外协消化", feasible: false, displacedCount: 0, promiseDeltaDays: 0, marginPct: 11.5, outsourceRatio: 0, penaltyTotalWan: 0, cashOccupiedWan: 252, note: "可外协单不足" },
      { key: "split", name: "拆单分线", feasible: false, displacedCount: 0, promiseDeltaDays: 0, marginPct: 13, outsourceRatio: 0, penaltyTotalWan: 0, cashOccupiedWan: 252, note: "认证线不足 2 条" },
      { key: "downgrade", name: "降级部分承接", feasible: true, displacedCount: 0, promiseDeltaDays: 33, marginPct: 13.5, outsourceRatio: 0, penaltyTotalWan: 0, cashOccupiedWan: 50.4, note: "仅接 840/4200 套" },
    ],
    schemeCount: 2,
    recommended: "delay",
    comparison: {
      columns: ["方案", "交期影响(天)", "毛利率(%)", "挤占单数", "外协比", "现金占用(万)"],
      rows: [["延期在手单", 21, 13.5, 2, 0, 252], ["外协消化", 0, 11.5, 0, 0, 252], ["拆单分线", 0, 13, 0, 0, 252], ["降级部分承接", 33, 13.5, 0, 0, 50.4]],
    },
    ruleRefs: ["C34", "C35"],
    summary: "急单 4680-NCM ×4200（提前 20%·6 周）日产能缺口 80，需挤占 2 单（高优先级最长位移 21 天）；2 个可行方案，推荐「延期在手单」。",
    dataMode: "MOCK",
  },
  // QUERY30 缺口③ Q01 样板：多方案五维比较矩阵 mock 输出（形状镜像真实 DataCore `multi_plan_compare`·矩阵逐值溯自
  // 上 what_if_displacement mock 四型方案；毛利并列 13.5 → 挤占少者 downgrade 胜·comparedCount=2）。dataMode:"MOCK" 诚实标。
  multi_plan_compare: {
    matrix: [
      { key: "delay", name: "延期在手单", feasible: true, promiseDeltaDays: 21, marginPct: 13.5, displacedCount: 2, outsourceRatio: 0, cashOccupiedWan: 252 },
      { key: "outsource", name: "外协消化", feasible: false, promiseDeltaDays: 0, marginPct: 11.5, displacedCount: 0, outsourceRatio: 0, cashOccupiedWan: 252 },
      { key: "split", name: "拆单分线", feasible: false, promiseDeltaDays: 0, marginPct: 13, displacedCount: 0, outsourceRatio: 0, cashOccupiedWan: 252 },
      { key: "downgrade", name: "降级部分承接", feasible: true, promiseDeltaDays: 33, marginPct: 13.5, displacedCount: 0, outsourceRatio: 0, cashOccupiedWan: 50.4 },
    ],
    recommendedKey: "downgrade",
    dims: [
      { key: "promiseDeltaDays", label: "交期Δ(天)" },
      { key: "marginPct", label: "毛利(%)" },
      { key: "displacedCount", label: "挤占数" },
      { key: "outsourceRatio", label: "外协比" },
      { key: "cashOccupiedWan", label: "现金占用(万)" },
    ],
    comparedCount: 2,
    note: "2 个可行方案可比·推荐「降级部分承接」（毛利优先·可行前置）",
    dataMode: "MOCK",
  },
  // CORE-NL-SOLVER-ROUTING：5 个通用多跳求解器（route=graph）mock 输出，形状对齐 datacore 真实 invoke
  // （顶层键覆盖 SOLVER_RENDER_BINDINGS 全字段·dataMode:"MOCK" 诚实标）——使 mock 侧路径A 投影/发育验证
  // 与真后端同构（真值以真 DataCore invoke/FDE 为准）。
  shared_bottleneck: {
    bottlenecks: [
      { resourceType: "Base", resourceId: "changzhou", capacity: 260, demand: 320, sharerCount: 3 },
    ],
    contention: [{ resourceId: "changzhou", sharers: ["常州·动力线-A", "常州·动力线-B", "常州·储能线-C"] }],
    downgraded: [{ resourceId: "changzhou", sharedByType: "Line", objectId: "常州·储能线-C", reason: "需求最小" }],
    summary: "1 个共享瓶颈，3 张单争用，1 张被降级",
    dataMode: "MOCK",
  },
  concentration_risk: {
    concentrations: [
      { rootType: "Model", rootId: "4680-NCM", dependents: ["SO-10001", "SO-10004", "SO-10007"], count: 3 },
      { rootType: "Model", rootId: "方形-LFP", dependents: ["SO-10002", "SO-10005"], count: 2 },
    ],
    topExposure: { rootType: "Model", rootId: "4680-NCM", dependents: ["SO-10001", "SO-10004", "SO-10007"], count: 3 },
    summary: "2 个隐性集中单点（Model），最大敞口 3 个依赖方",
    dataMode: "MOCK",
  },
  margin_attribution: {
    inverted: [
      { id: "SO-10002", revenue: 480, totalCost: 512, margin: -32, marginRate: -0.0667, topDriver: { label: "原料成本", value: 380, share: 0.742 }, attribution: [{ label: "原料成本", value: 380, share: 0.742 }, { label: "制造费用", value: 132, share: 0.258 }] },
    ],
    rootDrivers: [{ label: "原料成本", invertedCount: 1, totalValue: 380 }],
    invertedCount: 1,
    summary: "1 个目标毛利倒挂；根因主驱动 原料成本（拉穿 1 个）",
    dataMode: "MOCK",
  },
  supplier_disruption_radius: {
    rootType: "Base",
    rootId: "changzhou",
    layers: [
      { type: "Line", viaField: "baseId", count: 3, ids: ["常州·动力线-A", "常州·动力线-B", "常州·储能线-C"] },
      { type: "Process", viaField: "lineId", count: 9, ids: [] },
      { type: "Equipment", viaField: "processId", count: 21, ids: [] },
    ],
    radius: 3,
    totalAffected: 33,
    leafType: "Equipment",
    leafCount: 21,
    summary: "断供「changzhou」影响半径 3 层、波及 33 个对象；叶层 Equipment 21 个",
    dataMode: "MOCK",
  },
  multisource_fusion: {
    role: "order",
    fused: [
      { pk: "SO-10001", verdict: "TRUSTED", confidence: 1, fields: [{ field: "due", value: "2026-07-12", conflict: false }] },
      { pk: "SO-10002", verdict: "SUSPECT", confidence: 0.4, fields: [{ field: "due", value: "2026-07-20", conflict: true }] },
    ],
    suspectCount: 1,
    conflictCount: 1,
    strategies: ["AUTHORITY"],
    summary: "2 个对象归并，1 处冲突仲裁，1 处测谎命中",
    dataMode: "MOCK",
  },
  // Q30-P2 求解器横铺 A：3 个复用求解器 mock 输出**形状对齐真实 DataCore**（同 SOLVER_OUTPUT_SHAPES 登记键 +
  // dataMode:MOCK 诚实标）——使路径A投影（SOLVER_RENDER_BINDINGS）在 mock 侧与真后端同构（真值以真 DataCore 联调为准·
  // 齿：datacore render-bindings-real-fields.test 钉「绑定字段真在真实输出中」）。
  capex_alternatives: {
    scenarioKey: "枣庄储能线",
    quarters: 4,
    comparedCount: 2,
    alternatives: [
      { key: "A", label: "小步快跑", projectCount: 1, avgIrr: 18.2, minIrr: 18.2, c23PassCount: 1, allC23Pass: true, npvSum: 6.3, peakGap: 5 },
      { key: "B", label: "一步到位", projectCount: 1, avgIrr: 15.1, minIrr: 15.1, c23PassCount: 1, allC23Pass: true, npvSum: 9.8, peakGap: 1 },
    ],
    recommendedKey: "B",
    dims: ["avgIrr", "minIrr", "c23PassCount", "npvSum", "peakGap"],
    note: "比选 2 套方案：推荐「一步到位」（全项目 C23 达标·NPV 合计 9.8 亿最优）",
    dataMode: "MOCK",
  },
  full_cost_rollup: {
    capacityWeeklyWan: 42.5,
    capacityBases: [
      { baseId: "changzhou", weeklyWan: 18.5 },
      { baseId: "chengdu", weeklyWan: 14 },
      { baseId: "zaozhuang", weeklyWan: 10 },
    ],
    revenue: 120,
    cost: 103,
    grossMargin: 17,
    marginPct: 14.2,
    pnl: [
      { subject: "收入", budget: 122, rolling: 120, diff: -2 },
      { subject: "销售成本", budget: 102, rolling: 103, diff: 1 },
      { subject: "毛利", budget: 20, rolling: 17, diff: -3 },
    ],
    gmRow: { subject: "毛利率", budgetPct: 16.4, rollPct: 14.2, diffPp: -2.2 },
    attribution: "毛利率 16.4%→14.2%（-2.2pp）：储能占比结构拉低",
    summary: "全成本卷积：产能 42.5 万套/周（3 基地）→ 收入 120/销售成本 103/毛利 17（毛利率 14.2%·C15）",
    dataMode: "MOCK",
  },
  signal_propagation: {
    signal: "产能扰动",
    rootType: "Base",
    rootId: "changzhou",
    layers: [
      { type: "Line", viaField: "baseId", count: 3, ids: ["常州·动力线-A", "常州·动力线-B", "常州·储能线-C"] },
      { type: "Process", viaField: "lineId", count: 9, ids: [] },
      { type: "Equipment", viaField: "processId", count: 21, ids: [] },
    ],
    radius: 3,
    totalAffected: 33,
    reachedType: "Equipment",
    reachedCount: 21,
    affectedSet: ["常州·动力线-A", "常州·动力线-B", "常州·储能线-C"],
    summary: "信号「产能扰动」自「changzhou」沿图传导半径 3 层、波及 33 个对象；末端触达 Equipment 21 个",
    dataMode: "MOCK",
  },
  // Q30-P3 求解器横铺 B：5 求解器 mock 输出**形状对齐真实 DataCore**（同 SOLVER_OUTPUT_SHAPES 登记键 + dataMode:MOCK 诚实标）——
  // 真值以真 DataCore 联调为准（齿：datacore render-bindings-real-fields.test + q30-p3 单测钉真值）。
  cash_projection: {
    horizonWeeks: 13,
    openingCashWan: 3_200_000,
    weeks: [
      { week: 0, weekStart: "2026-07-01", inflowWan: 0, outflowWan: 12000, netWan: -12000, endingCashWan: 3_188_000 },
      { week: 1, weekStart: "2026-07-08", inflowWan: 8000, outflowWan: 9000, netWan: -1000, endingCashWan: 3_187_000 },
    ],
    minCashWan: 3_180_000,
    minCashWeek: 5,
    totalInflowWan: 45000,
    totalOutflowWan: 62000,
    orderCount: 18,
    baseCount: 12,
    summary: "现金流投影 13 周：期初 3200000 万元·回款 45000/付款 62000 万元·安全垫最低 3180000 万元(第 5 周·18 单)",
    dataMode: "MOCK",
  },
  labor_balance: {
    laborPerWan: 1.6,
    lines: [
      { lineId: "LINE-changzhou", baseId: "changzhou", availableHeadcount: 42, shiftCount: 2, borrowableHeadcount: 22, routedDemandWan: 96, requiredManShifts: 153.6, availableManShifts: 42, gap: 111.6, skillModels: "4680-NCM|S192-LFP|L300-NCM" },
    ],
    totalHeadcount: 480,
    totalRequiredManShifts: 1200,
    totalAvailableManShifts: 480,
    totalGap: 720,
    deficitLineCount: 11,
    note: "人力需求系数 laborPerWan=1.6 人·班/万套（估算参数·非实测→dataMode=PARTIAL·不冒充实测）；编制/班次/派单需求均真读对象",
    summary: "人力平衡：12 线·编制 480 人·需求 1200 人·班/可用 480·净缺口 720（11 线欠配）",
    dataMode: "MOCK",
  },
  energy_cost_schedule: {
    horizonWeeks: 4,
    tariffAvailable: true,
    tariff: { peak: 1.2, flat: 0.7, valley: 0.35, shares: { peak: 0.3, flat: 0.4, valley: 0.3 } },
    bases: [
      { baseId: "chengdu", processKey: "涂布", energyPerUnit: 1.5, gridFactor: 0.78, plannedOutput: 640000, energyKwh: 960000, carbonKg: 748800, energyCostWan: 71.28 },
    ],
    schedule: [
      { week: 0, energyKwh: 240000, energyCostWan: 17.82 },
    ],
    totalEnergyKwh: 3_600_000,
    totalCarbonKg: 2_340_000,
    totalEnergyCostWan: 267.3,
    note: "能耗/碳排真读 EnergyMeter×需求；电价经 args.tariff 提供（按分时段占比加权计价·SEED 无 TOU 电价故须调用方供）",
    summary: "能耗成本排程 4 周：12 基地·总能耗 3600000 kWh·碳排 2340000 kg·成本 267.3 万元",
    dataMode: "MOCK",
  },
  reroute_decision: {
    disruptedLineId: "LINE-changzhou",
    disruptedModels: ["4680-NCM"],
    reroutedVolume: 62000,
    shippedVolume: 62000,
    unmetVolume: 0,
    candidates: [
      { lineId: "LINE-hefei", baseId: "hefei", spare: 40000, rerouteCostPerUnit: 0 },
      { lineId: "LINE-xian", baseId: "xian", spare: 30000, rerouteCostPerUnit: 45 },
    ],
    flows: [
      { from: "SRC", to: "LINE-hefei", flow: 40000 },
      { from: "SRC", to: "LINE-xian", flow: 22000 },
    ],
    objective: 990000,
    optimal: true,
    status: "OPTIMAL",
    subSolver: "min_cost_flow",
    note: "改道流经 min_cost_flow(CP-SAT) 真解；arc 成本=真 ChangeoverMatrix 换型分钟(非魔数)",
    summary: "改道决策：LINE-changzhou 停线 62000→改道 62000 至 2 候选线·总成本 990000（可证最优）",
    dataMode: "MOCK",
  },
  multi_constraint_schedule: {
    jointSequence: [
      { orderId: "SO-3391", model: "4680-NCM", position: 0, changeoverMin: 0, certReady: true, certFinishWeek: null },
      { orderId: "SO-3415", model: "S192-LFP", position: 1, changeoverMin: 120, certReady: false, certFinishWeek: 3 },
    ],
    sequencing: { objective: 2, changeovers: 2, optimal: true, status: "OPTIMAL", subSolver: "sequencing_optimize" },
    changeover: { lineId: "L1", totalChangeoverMin: 240, savedVsDueMin: 60, subSolver: "changeover_sequence" },
    cert: { scheduledCount: 6, engineerGroups: 3, subSolver: "cert_schedule" },
    blockedByCert: ["SO-3415"],
    subSolvers: ["sequencing_optimize", "changeover_sequence", "cert_schedule"],
    constraintsSatisfied: { sequencing: true, changeover: true, cert: true },
    note: "多约束联合排产：真调 sequencing_optimize(①排序)+changeover_sequence(②换型合计240分)+cert_schedule(③认证6项) 三子解联合·非各自为战",
    summary: "多约束联合排产：6 单·换型合计 240 分·1 单待认证阻塞（排序最优/换型/认证三约束联解）",
    dataMode: "MOCK",
  },
};

export class MockSolverClient implements SolverClient {
  async invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    if (solverKey === "capacity_forecast") {
      const rnd = prngFor({ solverKey, modelId: args.modelId, demandDelta: args.demandDelta, weeks: args.weeks });
      const model = SEED_MODELS.find((m) => m.objectId === args.modelId || m.name === args.modelId);
      const baseGwh = model
        ? SEED_BASES.filter((b) => model.bases.includes(b.name)).reduce((s, b) => s + b.gwh, 0)
        : 20;
      const delta = Number(args.demandDelta ?? 0);
      const p50 = Math.round(baseGwh * (1 + rnd() * 0.1) * 10) / 10;
      const p90 = Math.round(p50 * (0.85 + rnd() * 0.1) * 10) / 10;
      const gapPct = Math.max(0, Math.round((delta - rnd() * 0.15) * 1000) / 10);
      const bottlenecks = ["化成", "卷绕", "涂布", "装配", "注液"];
      const mainBottleneck = bottlenecks[Math.floor(rnd() * bottlenecks.length)] as string;
      return { data: { p50, p90, gapPct, mainBottleneck }, snapshotVersion: SNAPSHOT };
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
    // WO ONTO-SCEN-RENDER-PROJ ①：16 卡求解器 mock 输出**形状对齐真实 DataCore**（同 SOLVER_OUTPUT_SHAPES
    // 登记键；值为确定性演示载荷，dataMode:"MOCK" 诚实标）——渲染绑定（SOLVER_RENDER_BINDINGS）逐字段
    // 可解析，使路径A投影/发育验证在 mock 侧与真后端**同构**（真值以真 DataCore invoke/FDE 联调为准，
    // 齿：datacore render-bindings 真值测试钉「绑定字段真在真实输出中」）。
    const shaped = MOCK_SOLVER_OUTPUTS[solverKey];
    if (shaped) return { data: { ...shaped }, snapshotVersion: SNAPSHOT };
    // G-1：目录之外的其余求解器在 mock 侧返回代表性确定性载荷，使 invoke_solver 步骤完成而不抛 unknown solver；
    // 真实数值由 DataCore 求解器产出（见跨服务联调）。
    return { data: { solverKey, ok: true, args }, snapshotVersion: SNAPSHOT };
  }
  // 站③ mock 就绪探测：mock 世界视 seed 数据齐备（ready·空 gaps）——真就绪由跨服务真后端 checkReadiness 产。
  async checkReadiness(_ctx: ToolAuthCtx, solverKey: string): Promise<EntryReadiness> {
    return { entryRef: `solver:${solverKey}`, ready: true, roles: [], missingParams: [], gaps: [], generatedAt: new Date(0).toISOString() };
  }
}

export class MockRuleEngineClient implements RuleEngineClient {
  /** 引用模式增量 L5：规则「源头一改、引用方全部生效」—— 测试可改阈值/版本模拟规则发布新版。 */
  c08Threshold = 0.3;
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
      // WO ONTO-SCEN-RENDER-PROJ ②：S&OP 口径规则（S18 卡声明 rules[C18,C21,C22]，其求解器 mrp_netting
      // 不在 SOLVER_RULE_REFS → injectScenarioRuleStep 烘焙 evaluate_rules 步真评估）——mock 侧按
      // mrp_netting 输出 payload 可判字段求值（缺字段=WARN 不通过口径缺失，真裁决以真 DataCore 规则库为准）。
      C18: () => ({
        ruleId: "C18",
        passed: p.cashCushion === undefined || Number(p.cashCushion) >= 50,
        severity: "WARN",
        explanation: "现金垫底线检查（S&OP 口径）",
      }),
      C21: () => {
        const shortage = Number(p.shortageCount ?? 0);
        const passed = shortage <= 2;
        return {
          ruleId: "C21",
          passed,
          severity: "WARN",
          explanation: passed ? `物料缺口项数 ${shortage} 在平衡容忍内` : `物料缺口项数 ${shortage} 超平衡容忍（>2）`,
        };
      },
      C22: () => ({
        ruleId: "C22",
        passed: true,
        severity: "WARN",
        explanation: "产销平衡节拍检查（月度平衡口径）",
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
    // Q30-P3：补 C41(加班合规上限)/C44(谷段迁移不破交期)——datacore battery.ts 真发布规则（C34–C50 集内），S32 人力平衡 / S33 能耗排程卡引用之。
    return ["C01", "C02", "C03", "C04", "C05", "C06", "C08", "C09", "C10", "C11", "C13", "C15", "C16", "C18", "C21", "C22", "C23", "C24", "C26", "C27", "C28", "C29", "C30", "C31", "C32", "C33", "C34", "C35", "C41", "C44"];
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
    const all: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string; outputShape?: string[] }[] = [
      { key: "capacity_forecast", name: "产能推演", description: "推演产能满足度 P50/P90/缺口", argHints: { modelId: "型号 ID", qty: "需求量" }, domain: "plan", outputShape: ["p50", "p90", "gap", "mainBn", "perBaseRows"] },
      { key: "affected_orders", name: "受影响订单", description: "扰动→受影响订单清单", argHints: { baseId: "基地 ID" }, domain: "plan", outputShape: ["baseId", "count", "columns", "rows", "problems"] },
      { key: "assignment_optimize", name: "指派最优化", description: "通用指派最优化（CP-SAT 可证最优）", argHints: { items: "待指派项", bins: "容器" }, domain: "generic", outputShape: ["assignment", "objective", "optimal"] },
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
 * UPG-L0-CONSOLE-BOARD：建域运行只读 mock（tenant-scoped·R2）。测试经 `seed()` 注入 StoryBuildRun，
 * `listStoryRuns` 按 ctx.tenantId 过滤——供 boardRowFromClosure 投影 ClosureReport MISSING 段（R13）。
 */
export class MockDatabuilderClient implements DatabuilderClient {
  private readonly runs: StoryBuildRun[] = [];
  seed(...runs: StoryBuildRun[]): void { this.runs.push(...runs); }
  async listStoryRuns(ctx: ToolAuthCtx): Promise<StoryBuildRun[]> {
    return this.runs.filter((r) => r.tenantId === ctx.tenantId);
  }
}

export interface MockDataCore extends DataCoreClient {
  ontology: MockOntologyClient;
  solver: MockSolverClient;
  rules: MockRuleEngineClient;
  action: MockActionClient;
  iam: MockIamClient;
  kb: MockKbClient;
  timeseries: MockTimeseriesClient;
  catalog: MockCatalogClient;
  datagen: MockDataGenClient;
  sim: MockSimClient;
  databuilder: MockDatabuilderClient;
}

export function createMockDataCore(): MockDataCore {
  return {
    ontology: new MockOntologyClient(),
    solver: new MockSolverClient(),
    rules: new MockRuleEngineClient(),
    action: new MockActionClient(),
    iam: new MockIamClient(),
    kb: new MockKbClient(),
    timeseries: new MockTimeseriesClient(),
    catalog: new MockCatalogClient(),
    epoch: { async current() { return { epoch: 1 }; } },
    datagen: new MockDataGenClient(),
    sim: new MockSimClient(),
    databuilder: new MockDatabuilderClient(),
  };
}
