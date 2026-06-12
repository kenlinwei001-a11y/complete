import type { QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";
import { newId } from "../ids.js";
import type {
  ActionClient,
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
    const found = items.find((i) => i.objectId === objectId || i.name === objectId || i.so === objectId);
    if (!found) throw new Error(`object not found: ${objectType}/${objectId}`);
    return { data: found, snapshotVersion: SNAPSHOT };
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
      return {
        data: {
          baseId: args.baseId,
          count: orders.length,
          columns: ["so", "cust", "model", "qty", "due"],
          rows: orders.map((o) => [o.so, o.cust, o.model, o.qty, o.due]),
          orders,
        },
        snapshotVersion: SNAPSHOT,
      };
    }
    throw new Error(`unknown solver: ${solverKey}`);
  }
}

export class MockRuleEngineClient implements RuleEngineClient {
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
        passed: !(Number(p.outsourceRatio ?? 0) > 0.3),
        severity: "WARN",
        explanation: "外协比例红线检查",
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
    return ids.filter((id) => all[id]).map((id) => (all[id] as () => RuleVerdict)());
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

export interface MockDataCore extends DataCoreClient {
  ontology: MockOntologyClient;
  solver: MockSolverClient;
  rules: MockRuleEngineClient;
  action: MockActionClient;
  iam: MockIamClient;
  kb: MockKbClient;
  timeseries: MockTimeseriesClient;
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
  };
}
