import type { ClaimVerdict, CrossValidateRequest, CrossValidateResponse, QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";
import { newId } from "../ids.js";
import type {
  ActionClient,
  CatalogClient,
  DataCoreClient,
  IamClient,
  KbClient,
  KbHit,
  OntologyClient,
  RuleEngineClient,
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

  // B→A 探针：出厂本体已发布对象类型全集（覆盖 seed 的 agent scope / intent slot 引用）。
  async listObjectTypeKeys(): Promise<string[]> {
    return ["Base", "Order", "Model", "Line", "Process", "Equipment", "Shipment", "Segment", "Customer", "Material"];
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
    // G-1：20 场景目录的其余求解器（cert_schedule/kit_readiness/… 见 SOLVER_KEYS）在 mock 侧
    // 返回代表性确定性载荷，使路径A 工作流的 invoke_solver 步骤完成而不抛 unknown solver；
    // 真实数值由 DataCore 求解器产出（见跨服务联调）。种子计划用静态 text 渲染，不解引用此处特定键。
    return { data: { solverKey, ok: true, args }, snapshotVersion: SNAPSHOT };
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
  };
}
