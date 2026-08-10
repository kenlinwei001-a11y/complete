import { z } from "zod";

/**
 * WO-ENTERPRISE-STATE · `EnterpriseState`（企业状态快照 · 一等可版本化对象）
 * —— 需求 `docs/PRD-enterprise-decision-twin.md` §3「五张 MVP 表」第一张 / §4.1 两世界物理隔离。
 *
 * ## 它回答的问题
 * 「**企业现在是什么状态**」——不是「某个求解器现在算出什么」，而是一份**可存、可版本化、可对比、
 * 可 fork 的快照**：某个世界（真实 / 仿真）在**某个逻辑时刻**上的 KPI / 产能 / 库存 / 订单数值。
 *
 * ## 三条设计判据（逐条有来历，改之前先读）
 *
 * ### 判据一：`capturedAt` 是**逻辑时钟**，不是 wall-clock（`Date.now()` 一次都不许出现）
 * 平台有 A8 模拟时钟（`apps/datacore/src/simclock.ts` · `SimulationClockRecord{t0,currentTick}`），
 * 一 tick = 一个模拟日。快照若按 wall-clock 打时间戳，则：
 *  ① 同一逻辑时刻重复取快照会得到**两份不同的 doc** ⇒ R6「同 (tenant, world, 逻辑时刻) 字节级一致」当场破；
 *  ② 回放 / reset 之后时间轴对不上（模拟时钟能回退，wall-clock 不能）。
 * 所以 `capturedAt = {tick, simulatedDate, t0}` 三件套全部**由模拟时钟派生**，doc 里**没有任何 wall-clock 字段**
 * （落库时间由 pg 的 `created_at` 列承载，不进 doc —— 那是库的元数据，不是企业状态的一部分）。
 * ⚠ 因此本对象的 id 也必须是**确定性**的（见 `enterpriseStateId`）：同一逻辑时刻重复捕获 = 幂等覆盖同一行，
 * 而不是每次生一个 `randomBytes` id 堆一堆内容相同的行（那会让"重复取快照字节级一致"这句话变得无从验证）。
 *
 * ### 判据二：两个世界**物理隔离**，靠 `worldId` + `isSimulated` + `forkedFromStateId` 三件套（PRD §4.1）
 * 禁止同一行承载两个世界。真实世界固定 `worldId = ENTERPRISE_STATE_REAL_WORLD_ID`；
 * 仿真世界的 `worldId` = 该推演会话 id（`SimSession.id`），并带 `forkedFromStateId` 指回它 fork 自哪一份真实快照。
 * fork **必须产生新行**——所以「在仿真世界里改一个数」永远碰不到真实世界那一行（世界隔离反证测试咬的就是这条）。
 *
 * ### 判据三：捕获核是**纯函数**且**跨端共用同一份实现**（治「mock 与引擎口径分家」）
 * 本仓有过真事故：前端 mock 与后端引擎各写一套形状，测试咬 mock 恒绿、上线才发现对不上。
 * 因此 `captureEnterpriseState` 放在 contracts（两侧都能 import 的唯一共享包），
 * datacore 的 `EnterpriseStateService` 与 frontend `src/mocks/handlers.ts` **调用的是同一个函数**——
 * 形状不可能分家，不是靠「两边都记得写成一样」。
 * 纯函数还顺带保证 R6：不读时钟、不读随机数、不读全局态，输入定则输出定。
 *
 * ## 零业务常数（R14）
 * 本文件**没有任何行业实体名**：分组键 `group` 取自租户本体的 `ObjectType.domain`（租户数据，不是代码常量），
 * KPI 取自 SPINE 指标库（`Metric` 对象，见 `packages/contracts/src/spine.ts`），
 * 数值属性清单取自本体的 `properties(dataType==="number") ∪ derivedProperties`。
 * 换行业 = 换本体内容，本文件一行不改。
 */

// ── 逻辑时钟坐标（A8 模拟时钟的投影 · 禁 wall-clock） ─────────────────────────
export const LogicalClockSchema = z.object({
  /** 模拟时钟 tick（`SimulationClockRecord.currentTick`）。一 tick = 一个模拟日。 */
  tick: z.number().int().min(0),
  /** 该 tick 对应的模拟日期 `YYYY-MM-DD`（= t0 + tick 天，**派生**，非 `new Date()`）。 */
  simulatedDate: z.string(),
  /** 时钟原点（`SimulationClockRecord.t0` 的日期部分）；同租户内恒定，用于校验两份快照是否同一条时间轴。 */
  t0: z.string(),
});
export type LogicalClock = z.infer<typeof LogicalClockSchema>;

/** 真实世界的 `worldId`（平台术语常量，非业务常数）。仿真世界的 worldId = 推演会话 id。 */
export const ENTERPRISE_STATE_REAL_WORLD_ID = "REAL";

/**
 * 捕获口径版本。**口径变了必须改这个数**——否则「同逻辑时刻两份快照字节级一致」这条判据
 * 会把「口径升级」误报成「确定性被破坏」，或反过来把两个口径的快照当成同一件事对比。
 */
export const ENTERPRISE_STATE_CAPTURE_VERSION = "v1";

// ── 单条快照指标 ─────────────────────────────────────────────────────────────
/** 指标来源类型（`ref` 的语义随之而定）。 */
export const EnterpriseStateMetricSourceKindSchema = z.enum([
  "SPINE_METRIC", // ref = 指标库 Metric 的 key（`packages/contracts/src/spine.ts`）
  "OBJECT_COUNT", // ref = 对象类型 key
  "OBJECT_PROP_SUM", // ref = `<typeKey>.<propKey>`
  "FORKED", // ref = 被 fork 的那份快照 id（值原样继承，未重算）
]);
export type EnterpriseStateMetricSourceKind = z.infer<typeof EnterpriseStateMetricSourceKindSchema>;

export const EnterpriseStateMetricSchema = z.object({
  /** 稳定键（快照内唯一，全序排序键）：`kpi:<k>` / `count:<typeKey>` / `sum:<typeKey>.<propKey>`。 */
  key: z.string(),
  /** 分组键 = 租户本体的域（factory/product/supply/capacity/…）或 KPI 的 category。**不是代码枚举**（R14）。 */
  group: z.string(),
  /** 人读标签（对象类型 displayName / 指标名）。 */
  label: z.string(),
  /**
   * 数值。**`null` = 诚实空**（真没有就是没有，绝不兜底编一个 0）——此时 `reason` 必须给出为什么没有。
   * 「0」与「null」在本对象里是两件不同的事：0 是真的数出来是 0，null 是数不出来。
   */
  value: z.number().nullable(),
  /** 单位（取自本体 `PropertyDef.unit` / 指标库 `Metric.unit`）；未声明则空串（不臆造）。 */
  unit: z.string(),
  /** 目标值（仅 SPINE 指标有；其余为 null）。 */
  target: z.number().nullable(),
  /** `value === null` 时的原因；有值时为 null。 */
  reason: z.string().nullable(),
  source: z.object({
    kind: EnterpriseStateMetricSourceKindSchema,
    ref: z.string(),
    /** 参与聚合的行数（`OBJECT_PROP_SUM` 时 = 有数值的行数；数到 0 行就报 0 行，不粉饰）。 */
    sampleCount: z.number().int().min(0),
  }),
});
export type EnterpriseStateMetric = z.infer<typeof EnterpriseStateMetricSchema>;

// ── 溯源（这份快照是怎么来的） ────────────────────────────────────────────────
export const EnterpriseStateProvenanceSchema = z.object({
  /** `CAPTURE` = 从对象库现场聚合；`FORK` = 从另一份快照复制（值不重算，只换世界）。 */
  mode: z.enum(["CAPTURE", "FORK"]),
  /** FORK 时 = 源快照 id；CAPTURE 时为 null。 */
  basedOnStateId: z.string().nullable(),
  /** 逻辑时刻从哪来：模拟时钟现读 / 随 fork 继承。 */
  clockSource: z.enum(["SIM_CLOCK", "FORKED"]),
  /** 口径版本（见 `ENTERPRISE_STATE_CAPTURE_VERSION`）。 */
  captureVersion: z.string(),
  /** 读了哪些输入、各几行（可核对："这个数是从几行里数出来的"）。按 ref 全序排序。 */
  inputs: z.array(
    z.object({
      kind: z.enum(["SPINE_METRIC", "OBJECT_TYPE"]),
      ref: z.string(),
      count: z.number().int().min(0),
    }),
  ),
});
export type EnterpriseStateProvenance = z.infer<typeof EnterpriseStateProvenanceSchema>;

// ── EnterpriseState 本体 ─────────────────────────────────────────────────────
export const EnterpriseStateSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R1/R2
  /** 世界标识：`REAL` 或推演会话 id。两个世界**物理隔离**（PRD §4.1）。 */
  worldId: z.string(),
  isSimulated: z.boolean(),
  /** 非空 = 本快照 fork 自那份快照（仿真世界的起点）。 */
  forkedFromStateId: z.string().nullable(),
  /** ⚠ 逻辑时钟，不是 wall-clock（见文件头判据一）。 */
  capturedAt: LogicalClockSchema,
  /** 快照指标（按 `key` 全序排序，保证 R6 字节级一致）。 */
  metrics: z.array(EnterpriseStateMetricSchema),
  provenance: EnterpriseStateProvenanceSchema,
});
export type EnterpriseState = z.infer<typeof EnterpriseStateSchema>;

// ── 确定性 id ────────────────────────────────────────────────────────────────
/**
 * 确定性 id：`estate_<tenantId>_<worldId>_t<tick>`。
 *
 * ⚠ **必须带 tenantId**：`PgStore` 的主键是 `id` 单列（见各 migration 的 `ON CONFLICT (id)`），
 * 若 id 只由 (worldId, tick) 决定，两个租户的 `estate_REAL_t0` 会在 pg 模式下**互相覆盖** ——
 * 那是 R1/R2 跨租户串数据，memory 模式（按 (tenantId,id) 建键）还测不出来。
 * 同族前例：`DomainRecord.id = dom_<tenant>_<key>`。
 */
export function enterpriseStateId(tenantId: string, worldId: string, tick: number): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "-");
  return `estate_${safe(tenantId)}_${safe(worldId)}_t${tick}`;
}

/** 逻辑时刻推算：t0（YYYY-MM-DD）+ tick 天 → YYYY-MM-DD。纯函数，不读系统时钟。 */
export function simulatedDateAt(t0: string, tick: number): string {
  const day = 86400000;
  const base = Date.parse(`${t0.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base)) return t0.slice(0, 10);
  return new Date(base + tick * day).toISOString().slice(0, 10);
}

// ── 捕获核（纯函数 · datacore 与前端 mock 共用同一份） ────────────────────────
/** 一个对象类型在捕获时刻的输入切片。 */
export interface EnterpriseStateTypeInput {
  typeKey: string;
  displayName: string;
  /** 本体域 key（`ObjectTypeDef.domain`）；缺省用 `unassigned`（本体自己的口径，不是我们编的）。 */
  domain: string;
  /** 声明的数值属性（`properties.dataType==="number"` ∪ `derivedProperties`），带单位。顺序无关，函数内部会排序。 */
  numericProps: { propKey: string; unit: string }[];
  /** 已物化对象的属性行（**不含** mergedInto 的行）。 */
  rows: Record<string, unknown>[];
}

/** SPINE 指标库一行（`Metric` 对象的 props 投影）。 */
export interface EnterpriseStateKpiInput {
  metricKey: string;
  label: string;
  unit: string;
  /** 指标分类（`Metric.category`，如 profit/scale/material/cash）；空则归入 `kpi`。 */
  category: string;
  actual: number | null;
  target: number | null;
}

export interface EnterpriseStateCaptureInput {
  tenantId: string;
  worldId: string;
  isSimulated: boolean;
  forkedFromStateId: string | null;
  clock: LogicalClock;
  kpis: EnterpriseStateKpiInput[];
  types: EnterpriseStateTypeInput[];
}

/** 六位小数定点（消除浮点累加尾差 —— 否则「重跑字节级一致」会被 1e-17 的尾巴打红）。 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 从「已读回的真数据」算出一份 `EnterpriseState`。**纯函数**：不发请求、不读时钟、不生成随机 id。
 *
 * 三条产出纪律：
 *  ① 指标按 `key` 全序排序、数值六位定点 ⇒ 同输入 `JSON.stringify` 逐字节相同（R6）；
 *  ② 数不出来的一律 `value:null` + `reason`，**不写 0 冒充**（0 = 真数出来是 0）；
 *  ③ doc 里没有任何 wall-clock。
 */
export function captureEnterpriseState(input: EnterpriseStateCaptureInput): EnterpriseState {
  const metrics: EnterpriseStateMetric[] = [];
  const inputs: EnterpriseStateProvenance["inputs"] = [];

  // ── KPI 组：SPINE 指标库（目标 vs 实际的单一出处）────────────────────────
  for (const k of input.kpis) {
    metrics.push({
      key: `kpi:${k.metricKey}`,
      group: k.category.trim() !== "" ? k.category : "kpi",
      label: k.label,
      value: k.actual === null ? null : round6(k.actual),
      unit: k.unit,
      target: k.target === null ? null : round6(k.target),
      reason: k.actual === null ? "指标库该行无 actual 值（未回采）" : null,
      source: { kind: "SPINE_METRIC", ref: k.metricKey, sampleCount: 1 },
    });
  }
  if (input.kpis.length > 0) inputs.push({ kind: "SPINE_METRIC", ref: "Metric", count: input.kpis.length });

  // ── 结构 / 产能 / 库存 / 订单组：按本体域分组的对象普查 + 数值属性合计 ────
  for (const t of input.types) {
    inputs.push({ kind: "OBJECT_TYPE", ref: t.typeKey, count: t.rows.length });
    metrics.push({
      key: `count:${t.typeKey}`,
      group: t.domain,
      label: `${t.displayName} · 对象数`,
      value: t.rows.length,
      unit: "个",
      target: null,
      reason: null,
      source: { kind: "OBJECT_COUNT", ref: t.typeKey, sampleCount: t.rows.length },
    });
    for (const p of [...t.numericProps].sort((a, b) => (a.propKey < b.propKey ? -1 : a.propKey > b.propKey ? 1 : 0))) {
      let sum = 0;
      let n = 0;
      for (const row of t.rows) {
        const v = numeric(row[p.propKey]);
        if (v === null) continue;
        sum += v;
        n += 1;
      }
      metrics.push({
        key: `sum:${t.typeKey}.${p.propKey}`,
        group: t.domain,
        label: `${t.displayName} · ${p.propKey} 合计`,
        value: n === 0 ? null : round6(sum),
        unit: p.unit,
        target: null,
        reason:
          n === 0
            ? t.rows.length === 0
              ? `该对象类型当前 0 条物化数据`
              : `${t.rows.length} 条物化数据中该属性无任何数值（全为空或非数值）`
            : null,
        source: { kind: "OBJECT_PROP_SUM", ref: `${t.typeKey}.${p.propKey}`, sampleCount: n },
      });
    }
  }

  metrics.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  inputs.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  return {
    id: enterpriseStateId(input.tenantId, input.worldId, input.clock.tick),
    tenantId: input.tenantId,
    worldId: input.worldId,
    isSimulated: input.isSimulated,
    forkedFromStateId: input.forkedFromStateId,
    capturedAt: input.clock,
    metrics,
    provenance: {
      mode: "CAPTURE",
      basedOnStateId: null,
      clockSource: "SIM_CLOCK",
      captureVersion: ENTERPRISE_STATE_CAPTURE_VERSION,
      inputs,
    },
  };
}

/**
 * 把一份快照 fork 进另一个世界（PRD §4.1）：**产生新行**，值原样继承、逻辑时刻原样继承，
 * 溯源标 `FORK` + `basedOnStateId`，每条指标的来源改标 `FORKED`（诚实：这些数**没有重算**）。
 *
 * ⚠ 为什么每条 metric 的 `source.kind` 也要翻成 `FORKED`：不翻的话，仿真世界那份快照会声称
 * 自己的数字是"从对象库现场数出来的"——那是假话，它是复制来的。世界隔离的头号风险不是数据串，
 * 是**出处串**（看到一个数以为它反映真实世界，其实是上一次 fork 的残影）。
 */
export function forkEnterpriseState(source: EnterpriseState, worldId: string): EnterpriseState {
  return {
    id: enterpriseStateId(source.tenantId, worldId, source.capturedAt.tick),
    tenantId: source.tenantId,
    worldId,
    isSimulated: true,
    forkedFromStateId: source.id,
    capturedAt: { ...source.capturedAt },
    metrics: source.metrics.map((m) => ({ ...m, source: { ...m.source, kind: "FORKED" as const, ref: source.id } })),
    provenance: {
      mode: "FORK",
      basedOnStateId: source.id,
      clockSource: "FORKED",
      captureVersion: source.provenance.captureVersion,
      inputs: source.provenance.inputs.map((i) => ({ ...i })),
    },
  };
}

/** 两份快照的指标差（U 层「两世界对比」与将来的 `StateDelta` 都从这里取同一份口径）。 */
export function diffEnterpriseStates(
  before: EnterpriseState,
  after: EnterpriseState,
): { key: string; group: string; label: string; from: number | null; to: number | null }[] {
  const byKey = new Map(before.metrics.map((m) => [m.key, m]));
  const out: { key: string; group: string; label: string; from: number | null; to: number | null }[] = [];
  for (const m of after.metrics) {
    const prev = byKey.get(m.key);
    const from = prev?.value ?? null;
    if (from === m.value) continue;
    out.push({ key: m.key, group: m.group, label: m.label, from, to: m.value });
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
