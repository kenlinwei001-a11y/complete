import { BASE_REGISTRY, type CanonicalBase, WORKSHOP_REGISTRY, EQUIPMENT_TYPE_BY_PROCESS } from "@platform/contracts";

/**
 * WO-SANDBOX-F3 · 物理拓扑（基地 × 产线 × 工序）矩阵的**纯派生层**。
 *
 * ── 单一来源（禁内联·DF.1/R14）──────────────────────────────────────────────
 *  · **基地轴** = `@platform/contracts` `BASE_REGISTRY`（实测 13 个，不是 12 个）。
 *    本模块**不**接受基地入参覆盖 —— 覆盖口子 = 手抄回潮的入口。SEAM 测靠 `vi.mock` 换掉
 *    contracts 的 `BASE_REGISTRY` 来证明"视图跟着册走"（见 test/physical-topology.seam.test.tsx）。
 *  · **工序轴** = datacore 合成种子 `apps/datacore/src/synthetic/battery.ts` 的 `WORKSHOP_DEFS`
 *    （"SA-3：10 车间定义（制浆→PACK）"）。跨 app 不许 import 源码（contracts-only-shared），
 *    故此处是**受门守护的镜像**：`WORKSHOP_DEFS_MIRROR` 与源文件逐字节比对由
 *    test/physical-topology.seam.test.tsx 的 source-parity 用例强制——改 battery.ts 不改这里 → 红。
 *    ⚠ 工单原文写的链是「涂布→…→模组→PACK」；**仓里不存在这条链**：battery.ts 只有
 *    `WORKSHOP_DEFS`（制浆→…→PACK·10）与 `STD_OPERATIONS`（混料→…→PACK·10），`模组` 全仓仅出现在
 *    `BOTTLENECKS = ["电芯","模组","PACK","化成"]`（另一个口径的瓶颈标签，不是工序链）。
 *    取真值不取工单记忆 → 本视图用 `WORKSHOP_DEFS`。
 *  · **瓶颈设备型→工序** = battery.ts:3539 的 `typeMap`（suffix→设备型）反查，同样镜像 + 比对门。
 *
 * ── 数值的诚实分层（严禁把占位伪装成实测）────────────────────────────────────
 *  `Measure.provenance` 四态，UI 逐格显式标注，不允许混同：
 *   · `registry`   —— 真值，来自 BASE_REGISTRY（基地级 util/gwh/lines/bottleneck）。
 *   · `aggregate`  —— 真值，来自 DataCore 对象聚合（EquipmentOEE / Equipment / WIPLot），
 *                     `Measure.basis` 逐条写明算式（口径不可隐身）。**WO-TOPO-REALDATA 新增**。
 *   · `placeholder`—— **占位**，seed 派生确定性伪值（同 seed 同输入字节一致）。真值取不到时**仍然是它**。
 *   · `empty`      —— 算不出来就是算不出来：`value=null` + `reason`。**不补 0、不给假默认**。
 *
 * ── 接真值的入口（三个对象/求解器都已存在，只是"没接进这张图"）──────────────
 *  见 `REAL_DATA_ENTRYPOINTS`。追过一层调用后的实情记在那里，别照 catalog 描述抄。
 */

// ───────────────────────────────────────────────────────────────────────────────
// 1. 工序轴：datacore 合成种子镜像（受 source-parity 门守护）
// ───────────────────────────────────────────────────────────────────────────────

/** 镜像源指纹：source-parity 用例据此定位并比对源文件。 */
export const PROCESS_CHAIN_SOURCE = {
  file: "apps/datacore/src/synthetic/battery.ts",
  symbol: "WORKSHOP_DEFS",
  /** 从 test 相对定位（test/ → ../../datacore/...）。 */
  relativeFromTest: "../../datacore/src/synthetic/battery.ts",
} as const;

/** 设备型映射源指纹（battery.ts 内 Equipment 生成处的 `typeMap`）。 */
export const EQUIPMENT_TYPE_SOURCE = {
  file: "apps/datacore/src/synthetic/battery.ts",
  symbol: "typeMap",
} as const;

/**
 * 工序表**从 contracts 单源派生**，不再镜像。
 *
 * 并线记录（审核方）：F3 交付时这里是一份内联镜像 + 一道 source-parity 比对门，理由是
 * 「跨 app 不许 import 源码（contracts-only-shared）」。`debattery:check` 判红：
 * **镜像加比对门治的是"漂了能发现"，治不了"两处各写一份"本身**（R14 去业务锁死）。
 * 已把 `WORKSHOP_REGISTRY` 上提到 `packages/contracts`，datacore 与本文件同源派生。
 */
const WORKSHOP_DEFS_MIRROR: { type: string; suffix: string }[] = WORKSHOP_REGISTRY.map((w) => ({
  type: w.type,
  suffix: w.suffix,
}));

/**
 * 工序 → 设备型，**从 contracts 单源派生**（并线时与工序表一并上提，见 base-registry.ts）。
 * 注意它与十车间链**键集刻意不同**：有 `aging` 无 `slurry`/`grading` —— Workshop 层与
 * Process 层两套口径的真实差异。后果是「老化库」瓶颈在本矩阵定位不到列 → 标 EMPTY
 * （见 `resolveBottleneck`），**不硬塞一列点亮**。
 */
const EQUIPMENT_TYPE_BY_PROCESS_MIRROR: Record<string, string> = { ...EQUIPMENT_TYPE_BY_PROCESS };

/** 供测试做 source-parity 比对（只读导出，不供业务使用）。 */
export const __mirrors = {
  workshopDefs: WORKSHOP_DEFS_MIRROR,
  equipmentTypeByProcess: EQUIPMENT_TYPE_BY_PROCESS_MIRROR,
} as const;

// ───────────────────────────────────────────────────────────────────────────────
// 2. 四段划分
// ───────────────────────────────────────────────────────────────────────────────

export type SegmentKey = "electrode" | "assembly" | "electrochem" | "grouping";

export interface SegmentDef {
  key: SegmentKey;
  label: string;
  /** 成员工序 suffix（必须覆盖工序链全集，缺一即抛 —— 不静默漏列）。 */
  members: string[];
}

/** 四段：前道·电极 / 中道·装配 / 后道·电化学 / 后道·成组。 */
export const SEGMENTS: SegmentDef[] = [
  { key: "electrode", label: "前道·电极", members: ["slurry", "coating", "calendering", "slitting"] },
  { key: "assembly", label: "中道·装配", members: ["winding", "assembly", "filling"] },
  { key: "electrochem", label: "后道·电化学", members: ["formation", "grading"] },
  { key: "grouping", label: "后道·成组", members: ["pack"] },
];

export interface ProcessStep {
  /** 1..N，沿工艺链。 */
  seq: number;
  /** 工序名（= WORKSHOP_DEFS.type）。 */
  name: string;
  /** 工序 suffix（= WORKSHOP_DEFS.suffix，跨端稳定键）。 */
  suffix: string;
  segment: SegmentKey;
  segmentLabel: string;
  /** 该工序的设备型（battery.ts typeMap 派生；链上有而 typeMap 无 → null，不编）。 */
  equipmentType: string | null;
}

/**
 * 工序链（工序轴单一出口）。段归属**从 SEGMENTS 反查**：
 * 链上出现了段表没登记的工序 → 直接抛，绝不静默塞进最后一段（静默兜底 = 病）。
 */
export const PROCESS_CHAIN: ProcessStep[] = WORKSHOP_DEFS_MIRROR.map((w, i) => {
  const seg = SEGMENTS.find((s) => s.members.includes(w.suffix));
  if (!seg) {
    throw new Error(
      `[physicalTopology] 工序「${w.type}(${w.suffix})」未登记到任何段（SEGMENTS）——` +
        `工序链改了就必须同步改段表，不许静默归组`,
    );
  }
  return {
    seq: i + 1,
    name: w.type,
    suffix: w.suffix,
    segment: seg.key,
    segmentLabel: seg.label,
    equipmentType: EQUIPMENT_TYPE_BY_PROCESS_MIRROR[w.suffix] ?? null,
  };
});

/** 设备型 → 工序 suffix 的反查（只含**确实在工序链上**的工序；老化库因此天然落空）。 */
export const PROCESS_BY_EQUIPMENT_TYPE: Record<string, string> = Object.fromEntries(
  PROCESS_CHAIN.filter((p) => p.equipmentType !== null).map((p) => [p.equipmentType as string, p.suffix]),
);

// ───────────────────────────────────────────────────────────────────────────────
// 3. 数值分层
// ───────────────────────────────────────────────────────────────────────────────

export type Provenance = "registry" | "aggregate" | "placeholder" | "empty";

export interface Measure {
  /** EMPTY 时恒为 null —— 不补 0、不给假默认。 */
  value: number | null;
  provenance: Provenance;
  unit: string;
  /** provenance=empty 必填 / placeholder 在"本该接真值却没接上"时必填：为什么是这个档。 */
  reason?: string;
  /**
   * provenance=aggregate 必填：**这个数是怎么算出来的**（算式 + 样本量）。
   * 存在的理由：本仓出过 `avg` 冒充 `weighted_avg` 的真事故——口径藏在代码里，屏上只有一个数，
   * 谁也发现不了它换了口径。把算式跟着值一起送到屏上，口径就无处隐身。
   */
  basis?: string;
}

const registry = (value: number, unit: string): Measure => ({ value, provenance: "registry", unit });
const placeholder = (value: number, unit: string, reason?: string): Measure =>
  reason === undefined ? { value, provenance: "placeholder", unit } : { value, provenance: "placeholder", unit, reason };
const aggregate = (value: number, unit: string, basis: string): Measure => ({ value, provenance: "aggregate", unit, basis });
const empty = (unit: string, reason: string): Measure => ({ value: null, provenance: "empty", unit, reason });

/** 人读的来源标签（UI 逐格显示，占位绝不冒充实测）。 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  registry: "真值·基地册",
  aggregate: "真值·对象聚合",
  placeholder: "占位·未接真值",
  empty: "EMPTY·无数据源",
};

/** 每格角标（比标签短；`placeholder` 仍显「占位」二字，诚实位在最小尺寸下也不许消失）。 */
export const PROVENANCE_BADGE: Record<Provenance, string> = {
  registry: "真值",
  aggregate: "真值",
  placeholder: "占位",
  empty: "空",
};

// ───────────────────────────────────────────────────────────────────────────────
// 4. 确定性占位值（同 (seed, baseId, suffix, metric) 恒同值 · R6）
// ───────────────────────────────────────────────────────────────────────────────

/** FNV-1a → [0,1)（与本仓既有 hash01 同族；纯结构哈希，无 rng、无时钟）。 */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export const PLACEHOLDER_SEED_DEFAULT = 42;

/** 占位值域（写死在一处，UI 图例直接引用，免得图例与算法各说各话）。 */
export const PLACEHOLDER_RANGES = {
  utilPct: { lo: 52, hi: 98 },
  oeePct: { lo: 55, hi: 92 },
  wipCells: { lo: 1200, hi: 26000 },
} as const;

function spread(seed: number, baseId: string, suffix: string, metric: string, lo: number, hi: number): number {
  return lo + hash01(`${seed}|${baseId}|${suffix}|${metric}`) * (hi - lo);
}

// ───────────────────────────────────────────────────────────────────────────────
// 5. 热力分档
// ───────────────────────────────────────────────────────────────────────────────

export type HeatBand = "idle" | "normal" | "tight" | "over" | "empty";

/** 分档阈值（利用率 %）。UI 图例同源引用。 */
export const HEAT_THRESHOLDS = { tight: 80, over: 92, idle: 65 } as const;

export const HEAT_BAND_LABEL: Record<HeatBand, string> = {
  idle: "低载 <65%",
  normal: "正常 65–80%",
  tight: "偏紧 80–92%",
  over: "过载 ≥92%",
  empty: "EMPTY 无数据",
};

export function heatBand(m: Measure): HeatBand {
  if (m.value === null) return "empty";
  if (m.value >= HEAT_THRESHOLDS.over) return "over";
  if (m.value >= HEAT_THRESHOLDS.tight) return "tight";
  if (m.value < HEAT_THRESHOLDS.idle) return "idle";
  return "normal";
}

/**
 * 热力强度的归一化区间。
 *
 * WO-TOPO-REALDATA 语义修正：接线前它借用的是 `PLACEHOLDER_RANGES.utilPct` —— 那时格里只有占位值，
 * 借得通；接了真值之后，**拿一个名叫"占位值域"的常数去缩放实测值**是语义错位（数值恰好一样，
 * 但下一个人会以为热力强度是占位artefact）。故拆出独立常数，取值与原先逐位相同 → 零行为变化。
 *
 * ⚠ 实测发现（写在这里免得被当成 bug 反复查）：真值口径下 130 格的计划工时利用率落在 **89.7–94.0%**，
 *   全部落进「偏紧(≥80)」与「过载(≥92)」两档，屏上只有两种颜色。这是**数据的真相**（各线可用率本来就高），
 *   不是阈值坏了；`HEAT_THRESHOLDS` 是业务刻度，改它属于业务裁决，不在本单范围内。
 */
export const UTIL_HEAT_RANGE = { lo: 52, hi: 98 } as const;

/** 热力填充强度 0–1（EMPTY 恒 0：空就是空，不许靠颜色暗示"低"）。 */
export function heatAlpha(m: Measure): number {
  if (m.value === null) return 0;
  const { lo, hi } = UTIL_HEAT_RANGE;
  const t = (m.value - lo) / (hi - lo);
  return Math.max(0.12, Math.min(1, t));
}

// ───────────────────────────────────────────────────────────────────────────────
// 5.5 真值接线（WO-TOPO-REALDATA）：DataCore 对象聚合 → 格
//
// ── 病名先说清：不是「没数据」，是「有数据没接线」──────────────────────────────
//  `EquipmentOEE` 实测 **5460 行**已物化（13 基地 × 10 车间 × 3 串行工序 × 2 台设备 × 7 天），
//  只是这张图从来没去读。修法是接线，不是造数。
//
// ── join 键的裁决：**lineId，不是 processId**（工单初判在这里是错的，实测推翻）────
//  工单原文提的链是 `EquipmentOEE.equipId → Equipment.processId`。实测 `/a/v1/objects?type=Equipment`：
//    equipId   = "LINE-WS-changzhou-assembly-assembly-E1"
//    processId = "LINE-WS-changzhou-assembly-assembly"   ← 末段 ∈ {coating, winding, assembly} **仅 3 值**
//    lineId    = "LINE-WS-changzhou-assembly"            ← 末段 = 车间 suffix，**10 值**
//  battery.ts 的生成结构是 Base → Workshop(10) → Line(1/车间) → Process(SERIAL_STEPS 3 + 化成 + 老化)
//  → Equipment(2/串行工序)。也就是说 `Equipment.processId` 属于 **Process 层**（3 道串行工序），
//  而本矩阵的列轴是 **Workshop 层**（10 车间 = `WORKSHOP_REGISTRY`）——**两层不同口径**。
//  照工单那条链接，130 格会塌成 13×3=39 格，另外 91 格永远空。**故本单按 lineId 接。**
//
// ── lineId ↔ workshopId 的换算不是我发明的字符串戏法 ─────────────────────────────
//  datacore 自己的物化代码 `apps/datacore/src/synthetic/service.ts:928` 就是这么反着算的：
//    `const workshopId = (l.lineId as string).replace("LINE-", "");`
//  本文件用它的正向：`lineId = "LINE-" + workshopId`。**只此一处**，别处不许再拼一次。
// ───────────────────────────────────────────────────────────────────────────────

/** `/a/v1/objects/aggregate` 的一行（契约见 packages/contracts `AggregateRowSchema`）。 */
export interface AggRow {
  group: Record<string, string | null>;
  metrics: Record<string, number | null>;
}

/** `/a/v1/objects?type=Workshop` 的一行 props（只取本图用得到的三个字段）。 */
export interface WorkshopRow {
  workshopId?: unknown;
  baseId?: unknown;
  processType?: unknown;
}

/** 真值载荷（= 四个只读请求的原样响应，前端不做任何预处理，口径全在下面的 `buildCellFacts`）。 */
export interface TopologyFacts {
  workshops: WorkshopRow[];
  oee: AggRow[];
  equipment: AggRow[];
  wip: AggRow[];
}

/**
 * 四个只读请求的**请求体单一来源**（视图发请求、测试造载荷都引它，免得两处 metrics 拼不一样）。
 *
 * ⚠ 为什么必须走 `/objects/aggregate` 而不是前端自己 join：
 *   `GET /a/v1/objects` 内部写死 `queryObjects(ctx, type, {}, 1000)`（`apps/datacore/src/app.ts:2369`），
 *   实测 `type=EquipmentOEE` 回 `total=1000`、`page=3` 回 0 条 —— **5460 行只能拿到 1000 行（18%）**；
 *   `POST /a/v1/objects/query` 的 `limit` 被契约夹在 ≤1000（实测传 6000 → 400 VALIDATION_ERROR）。
 *   而 `/objects/aggregate` 在服务端**全量读**（`ontology-governance.ts:721` 明写"不受 ≤1000 截断影响"），
 *   实测 130 组 / `truncated=false` / 29KB / 160ms。所以：不是"前端 join 慢"，是**前端 join 拿不全数据**。
 *
 * ⚠ `metrics` 契约上限 **5 条**（`AggregateRequestSchema`），`groupBy` 上限 2 维 —— 下面的取值是贴着上限排的，
 *   加字段前先想清楚挤掉谁。样本量不占额度：`min_planned === max_planned` 时可由 `sum/min` 反解。
 */
export const TOPOLOGY_FACT_QUERIES = {
  oee: {
    typeKey: "EquipmentOEE",
    groupBy: ["baseId", "lineId"],
    metrics: [
      { prop: "oee", fn: "avg" },
      { prop: "actualProductionTime", fn: "sum" },
      { prop: "plannedProductionTime", fn: "sum" },
      { prop: "plannedProductionTime", fn: "min" },
      { prop: "plannedProductionTime", fn: "max" },
    ],
  },
  equipment: {
    typeKey: "Equipment",
    groupBy: ["baseId", "lineId"],
    metrics: [
      { prop: "ctSeconds", fn: "max" },
      { prop: "ctSeconds", fn: "min" },
      { prop: "equipId", fn: "count" },
    ],
  },
  /** ⚠ `WIPLot` **没有 baseId 属性**（实测 props = lotId/woId/modelId/lineId/currentProcess/qty/status/…），
   *  按 baseId 分组会得到 `group.baseId === null` —— 故只按 lineId 分组，基地维经车间册回填。 */
  wip: {
    typeKey: "WIPLot",
    groupBy: ["lineId"],
    metrics: [
      { prop: "qty", fn: "sum" },
      { prop: "lotId", fn: "count" },
    ],
  },
} as const;

/** 车间 → 产线（datacore `synthetic/service.ts:928` 的正向；**全仓只此一处**）。 */
export const lineIdOfWorkshop = (workshopId: string): string => `LINE-${workshopId}`;

/** 格键（与 `TopologyCell.key` 同式，别处不许再拼一次）。 */
export const cellKeyOf = (baseId: string, suffix: string): string => `${baseId}::${suffix}`;

/** 一格的四条真值度量（缺哪条就没哪条，不补）。 */
export interface CellFacts {
  util?: Measure;
  oee?: Measure;
  wip?: Measure;
  takt?: Measure;
}

/** 接线诊断：**谁没接上、为什么**。UI 照实播报，不许悄悄吞掉。 */
export interface FactsDiagnostics {
  /** 车间册里 processType 不在 `WORKSHOP_REGISTRY` 的行数（映射不到列 → 整格放弃）。 */
  unmappedWorkshops: number;
  /** 聚合行的 lineId 落在车间册之外（孤儿事实）—— **必须丢弃，绝不摊到任意一格**。 */
  orphanRows: { oee: number; equipment: number; wip: number };
  /** OEE 因"计划工时不等权"被判 EMPTY 的格数（`avg` 不许冒充加权平均）。 */
  oeeUnweighted: number;
  /** 成功接上真值的格数（≥1 条真值度量）。 */
  cellsWithFacts: number;
}

export interface CellFactsResult {
  byCell: Map<string, CellFacts>;
  diagnostics: FactsDiagnostics;
}

/** 单位统一到 1 位小数（百分比/节拍都按这个粒度呈现；别处不许各 round 一次）。 */
const round1 = (n: number): number => Math.round(n * 10) / 10;

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * **多设备/多日 → 一格** 的聚合口径，全仓只写在这里（组件、测试都只调它，不得各写一份）。
 *
 * ── 逐指标口径与裁决理由 ───────────────────────────────────────────────────────
 *
 * ① `util` 计划工时利用率 = `Σ actualProductionTime / Σ plannedProductionTime`
 *    · **和比和，天然按计划工时加权**——不是"各设备利用率的平均"。比率类聚合的正确形态。
 *    · 名字**刻意不叫「产能利用率」**：行首 `BASE_REGISTRY.util` 才是产能利用率，两者口径不同，
 *      用同一个中文名混过去 = 制造下一次事故。
 *
 * ② `oee` = `avg(oee)`，**但带等权门**：仅当该格 `min(planned) === max(planned)` 才承认。
 *    · 理由：OEE 是比率，正确的合并是 `Σ(oeeᵢ×plannedᵢ)/Σ(plannedᵢ)`。聚合端点只有 5 种函数、
 *      没有"乘积和"能力，算不出加权分子。
 *    · 各行计划工时**全等**时（实测 130/130 格恒为 480min），等权算术平均 **恒等于** 加权平均——
 *      此时用 `avg` 不是近似，是相等。不等权时算不出来就标 EMPTY，**不拿 `avg` 冒充加权**
 *      （本仓已有 `avg` 冒充 `weighted_avg` 的真事故，这道门就是为它加的）。
 *
 * ③ `takt` 节拍 = `max(ctSeconds)`，**取最慢工位，不取平均**。
 *    · 一格 = 一条车间线上的 6 台设备。线的节拍由**最慢的那台**决定（瓶颈决定节拍），
 *      把各工位节拍平均没有物理含义（平均后的数既不是任何一台的能力，也不是线的能力）。
 *    · `basis` 里同时带出 `min`，最快/最慢差多少一眼可见（实测同基地 6 台恒等 → 差 0）。
 *
 * ④ `wip` 在制 = `Σ qty`（该车间线上的在制批次数量合计）。
 *    · **刻意不用 `WIPLot.currentProcess` 定列**：实测 260/260 行该字段恒为 `"涂布"`（种子里是字面量常数），
 *      拿它定列会把全仓在制一股脑塞进"涂布"一列 = 硬凑。工序维改走 `lineId → 车间`（与 OEE 同一把尺）。
 *
 * ── 孤儿事实的处置 ─────────────────────────────────────────────────────────────
 *  聚合行的 `lineId` 若不在车间册派生出的产线集合里（缺维 / 拼错 / null），**整行丢弃并计数**，
 *  绝不"就近"摊到任意一格 —— 摊了就等于凭空造数。
 */
export function buildCellFacts(facts: TopologyFacts): CellFactsResult {
  const suffixByProcessType = new Map(WORKSHOP_REGISTRY.map((w) => [w.type, w.suffix]));

  // 产线 → 格（车间册是唯一的桥：Workshop 同时持有 baseId 与 processType）
  const cellByLineId = new Map<string, { baseId: string; suffix: string }>();
  let unmappedWorkshops = 0;
  for (const w of facts.workshops) {
    const workshopId = typeof w.workshopId === "string" ? w.workshopId : "";
    const baseId = typeof w.baseId === "string" ? w.baseId : "";
    const processType = typeof w.processType === "string" ? w.processType : "";
    const suffix = suffixByProcessType.get(processType);
    if (!workshopId || !baseId || suffix === undefined) {
      unmappedWorkshops++;
      continue;
    }
    cellByLineId.set(lineIdOfWorkshop(workshopId), { baseId, suffix });
  }

  const byCell = new Map<string, CellFacts>();
  const orphanRows = { oee: 0, equipment: 0, wip: 0 };
  let oeeUnweighted = 0;

  /** 取该行所属格；孤儿行返回 null（调用方计数后丢弃，**不得**回落到任何一格）。 */
  const resolve = (row: AggRow): { key: string } | null => {
    const lineId = row.group["lineId"];
    if (typeof lineId !== "string") return null;
    const cell = cellByLineId.get(lineId);
    if (!cell) return null;
    return { key: cellKeyOf(cell.baseId, cell.suffix) };
  };
  const put = (key: string, patch: CellFacts): void => {
    byCell.set(key, { ...(byCell.get(key) ?? {}), ...patch });
  };

  // ── ① util（Σ/Σ 加权） + ② oee（等权门） ────────────────────────────────────
  for (const row of facts.oee) {
    const at = resolve(row);
    if (!at) {
      orphanRows.oee++;
      continue;
    }
    const sumAct = numOrNull(row.metrics["sum_actualProductionTime"]);
    const sumPlan = numOrNull(row.metrics["sum_plannedProductionTime"]);
    const minPlan = numOrNull(row.metrics["min_plannedProductionTime"]);
    const maxPlan = numOrNull(row.metrics["max_plannedProductionTime"]);
    const avgOee = numOrNull(row.metrics["avg_oee"]);
    const samples = minPlan !== null && minPlan > 0 && sumPlan !== null ? Math.round(sumPlan / minPlan) : null;

    const patch: CellFacts = {};
    if (sumAct !== null && sumPlan !== null && sumPlan > 0) {
      patch.util = aggregate(
        round1((sumAct / sumPlan) * 100),
        "%",
        `计划工时利用率 = Σ实际生产时间 ${sumAct} ÷ Σ计划生产时间 ${sumPlan}（EquipmentOEE 逐设备逐日${samples === null ? "" : ` ${samples} 条`}·和比和=按计划工时加权，非比率平均）`,
      );
    } else {
      patch.util = empty("%", "EquipmentOEE 该格 Σ计划生产时间为 0 或缺失 —— 除不出利用率，不补 0");
    }
    if (avgOee === null) {
      patch.oee = empty("%", "EquipmentOEE 该格 oee 字段全空 —— 算不出来");
    } else if (minPlan === null || maxPlan === null || minPlan !== maxPlan) {
      oeeUnweighted++;
      patch.oee = empty(
        "%",
        `该格各条计划工时不等权（min=${minPlan ?? "∅"} / max=${maxPlan ?? "∅"}），OEE 正确合并需 Σ(oee×计划工时)÷Σ计划工时；` +
          `聚合端点无乘积和能力 → 标 EMPTY，不拿简单平均冒充加权平均`,
      );
    } else {
      patch.oee = aggregate(
        round1(avgOee * 100),
        "%",
        `OEE = avg(EquipmentOEE.oee)${samples === null ? "" : ` over ${samples} 条`}；该格各条计划生产时间全等（${minPlan}）⇒ 等权算术平均恒等于按计划工时加权平均`,
      );
    }
    put(at.key, patch);
  }

  // ── ③ takt（最慢工位） ──────────────────────────────────────────────────────
  for (const row of facts.equipment) {
    const at = resolve(row);
    if (!at) {
      orphanRows.equipment++;
      continue;
    }
    const maxCt = numOrNull(row.metrics["max_ctSeconds"]);
    const minCt = numOrNull(row.metrics["min_ctSeconds"]);
    const nEquip = numOrNull(row.metrics["count_equipId"]);
    put(at.key, {
      takt:
        maxCt === null
          ? empty("s/电芯", "该格 Equipment.ctSeconds 全空 —— 标 EMPTY，不补 0")
          : aggregate(
              maxCt,
              "s/电芯",
              `节拍 = max(Equipment.ctSeconds)${nEquip === null ? "" : ` over ${nEquip} 台`}（取最慢工位：线速由瓶颈工位定，节拍不许平均）${
                minCt === null || minCt === maxCt ? "" : `；最快工位 ${minCt}`
              }`,
            ),
    });
  }

  // ── ④ wip（数量求和） ───────────────────────────────────────────────────────
  for (const row of facts.wip) {
    const at = resolve(row);
    if (!at) {
      orphanRows.wip++;
      continue;
    }
    const sumQty = numOrNull(row.metrics["sum_qty"]);
    const nLots = numOrNull(row.metrics["count_lotId"]);
    put(at.key, {
      wip:
        sumQty === null
          ? empty("电芯", "该格 WIPLot.qty 全空 —— 标 EMPTY，不补 0")
          : aggregate(
              sumQty,
              "电芯",
              // ⚠ 上屏文案里不许写 Markdown 记号：这些串直接进 DOM，`**x**` 会原样显示成星号（实拍抓到过）。
              `在制 = Σ WIPLot.qty${nLots === null ? "" : ` over ${nLots} 批`}（按 lineId 归到车间列；不用 WIPLot.currentProcess —— 该字段在种子里是常量「涂布」，拿它定列会把全部在制塞进一列）`,
            ),
    });
  }

  return {
    byCell,
    diagnostics: { unmappedWorkshops, orphanRows, oeeUnweighted, cellsWithFacts: byCell.size },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// 6. 矩阵派生
// ───────────────────────────────────────────────────────────────────────────────

export interface TopologyCell {
  key: string;
  baseId: string;
  baseName: string;
  process: ProcessStep;
  /** 计划工时利用率 %（接上 EquipmentOEE → `aggregate`；接不上 → `placeholder`）。 */
  util: Measure;
  /** OEE %（接上 → `aggregate`；等权门未过 → `empty`；没数据 → `placeholder`）。 */
  oee: Measure;
  /** 在制（电芯）（接上 WIPLot → `aggregate`；接不上 → `placeholder`）。 */
  wip: Measure;
  /** 节拍 s/电芯（接上 Equipment.ctSeconds → `aggregate`；接不上 → `empty`，不补 0）。 */
  takt: Measure;
  /** 该格是否 = 基地册登记的瓶颈工序（registry 真值派生）。 */
  isBottleneck: boolean;
  band: HeatBand;
}

export interface BottleneckLocation {
  /** 基地册登记的瓶颈设备型（真值）。 */
  equipmentType: string;
  /** 定位到的工序 suffix；定位不到 = null（老化库无对应车间列）。 */
  processSuffix: string | null;
  /** 定位不到时的原因（UI 照实说，不猜一列点亮）。 */
  reason?: string;
}

export interface TopologyRow {
  base: CanonicalBase;
  /** 基地级真值（BASE_REGISTRY）。 */
  util: Measure;
  gwh: Measure;
  lines: Measure;
  bottleneck: BottleneckLocation;
  cells: TopologyCell[];
}

export interface TopologyMatrix {
  seed: number;
  processes: ProcessStep[];
  segments: SegmentDef[];
  rows: TopologyRow[];
  /**
   * 统计：**逐条数出来的**，不是 `cellCount × 常数` 算出来的。
   * （真值/占位混排之后，"每格都是 3 占位 1 空"这个假设就不成立了；继续拿常数乘 = 屏上播报一个假数。）
   */
  stats: {
    baseCount: number;
    processCount: number;
    cellCount: number;
    /** 接上真值的格数（该格 4 条度量里至少 1 条是 `aggregate`）。 */
    realCells: number;
    /** 仍是占位的格数（4 条度量里还有 `placeholder`）。 */
    placeholderCells: number;
    realMeasures: number;
    placeholderMeasures: number;
    emptyMeasures: number;
    unlocatedBottlenecks: number;
  };
  /** 真值接线诊断（没接上就照实说；`facts` 缺席时为 null）。 */
  factsDiagnostics: FactsDiagnostics | null;
}

/** 瓶颈设备型 → 工序列。定位不到就说定位不到 —— 不许挑个"最像"的列点亮。 */
export function resolveBottleneck(equipmentType: string): BottleneckLocation {
  const suffix = PROCESS_BY_EQUIPMENT_TYPE[equipmentType];
  if (suffix) return { equipmentType, processSuffix: suffix };
  return {
    equipmentType,
    processSuffix: null,
    reason: `设备型「${equipmentType}」在十车间工序链上无对应列（${PROCESS_CHAIN_SOURCE.symbol} 无该车间）`,
  };
}

/** 真值缺席时的诚实缺口文案（**不是**"没有数据源"，是"这一格没取到"——两句话意思差很远）。 */
const NO_FACT_REASON = {
  util: "该格未取到 EquipmentOEE 聚合行（真值源存在，这一格没接上）→ 回落 seed 占位",
  oee: "该格未取到 EquipmentOEE 聚合行（真值源存在，这一格没接上）→ 回落 seed 占位",
  wip: "该格未取到 WIPLot 聚合行（真值源存在，这一格没接上）→ 回落 seed 占位",
  takt: "该格未取到 Equipment 聚合行 —— 节拍标 EMPTY，不补 0、不回落占位（占位一个假节拍会被当成排产输入）",
  offline: "未取到真值载荷（未登录 / 读取失败 / 后端无该对象）→ 全格回落 seed 占位",
} as const;

/**
 * 派生矩阵：行 = `BASE_REGISTRY` 全量（**不接受基地入参**），列 = `PROCESS_CHAIN`。
 *
 * @param seed  占位值种子（同 seed 同输出，R6）。
 * @param facts DataCore 对象聚合载荷。**缺席（null/undefined）时逐字节等于接线前的行为** ——
 *              这不是可选功能开关，是"取不到真值就老老实实回到占位"的诚实回落路径。
 */
export function buildTopology(seed: number = PLACEHOLDER_SEED_DEFAULT, facts?: TopologyFacts | null): TopologyMatrix {
  const processes = PROCESS_CHAIN;
  const factsResult = facts ? buildCellFacts(facts) : null;
  const byCell = factsResult?.byCell ?? null;

  const rows: TopologyRow[] = BASE_REGISTRY.map((base) => {
    const bottleneck = resolveBottleneck(base.bottleneck);
    const cells: TopologyCell[] = processes.map((process) => {
      const key = cellKeyOf(base.baseId, process.suffix);
      const real = byCell?.get(key);
      const gap = byCell === null ? NO_FACT_REASON.offline : null;

      const util =
        real?.util ??
        placeholder(
          Math.round(spread(seed, base.baseId, process.suffix, "util", PLACEHOLDER_RANGES.utilPct.lo, PLACEHOLDER_RANGES.utilPct.hi) * 10) / 10,
          "%",
          gap ?? NO_FACT_REASON.util,
        );
      const oee =
        real?.oee ??
        placeholder(
          Math.round(spread(seed, base.baseId, process.suffix, "oee", PLACEHOLDER_RANGES.oeePct.lo, PLACEHOLDER_RANGES.oeePct.hi) * 10) / 10,
          "%",
          gap ?? NO_FACT_REASON.oee,
        );
      const wip =
        real?.wip ??
        placeholder(
          Math.round(spread(seed, base.baseId, process.suffix, "wip", PLACEHOLDER_RANGES.wipCells.lo, PLACEHOLDER_RANGES.wipCells.hi)),
          "电芯",
          gap ?? NO_FACT_REASON.wip,
        );
      // 节拍不回落占位：一个假节拍会被当作排产输入，比空白危险。
      const takt = real?.takt ?? empty("s/电芯", gap === null ? NO_FACT_REASON.takt : `${gap}；节拍例外——不回落占位，标 EMPTY（假节拍会被当成排产输入，比空白危险）`);

      return {
        key,
        baseId: base.baseId,
        baseName: base.name,
        process,
        util,
        oee,
        wip,
        takt,
        isBottleneck: bottleneck.processSuffix === process.suffix,
        band: heatBand(util),
      };
    });
    return {
      base,
      util: registry(base.util, "%"),
      gwh: registry(base.gwh, "GWh"),
      lines: registry(base.lines, "条"),
      bottleneck,
      cells,
    };
  });

  const allCells = rows.flatMap((r) => r.cells);
  const measuresOf = (c: TopologyCell): Measure[] => [c.util, c.oee, c.wip, c.takt];
  const countProv = (p: Provenance): number => allCells.reduce((n, c) => n + measuresOf(c).filter((m) => m.provenance === p).length, 0);

  return {
    seed,
    processes,
    segments: SEGMENTS,
    rows,
    stats: {
      baseCount: rows.length,
      processCount: processes.length,
      cellCount: allCells.length,
      realCells: allCells.filter((c) => measuresOf(c).some((m) => m.provenance === "aggregate")).length,
      placeholderCells: allCells.filter((c) => measuresOf(c).some((m) => m.provenance === "placeholder")).length,
      realMeasures: countProv("aggregate"),
      placeholderMeasures: countProv("placeholder"),
      emptyMeasures: countProv("empty"),
      unlocatedBottlenecks: rows.filter((r) => r.bottleneck.processSuffix === null).length,
    },
    factsDiagnostics: factsResult?.diagnostics ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// 7. 接真值的入口（预留·照实登记，不吹）
// ───────────────────────────────────────────────────────────────────────────────

export interface RealDataEntrypoint {
  /** 度量字段（本模块 Measure 的字段名）；`—` = 该源没喂任何格。 */
  field: "util" | "oee" | "wip" | "takt" | "—";
  /** 已接线 / 仍是缺口 —— 台账要能一眼看出"哪几条今天真的通了"。 */
  status: "connected" | "gap";
  /** 真值来源对象 / 求解器 key。 */
  source: string;
  /** 该来源今天真实产出的形状（追过一层调用后的实情，不照 catalog 描述抄）。 */
  shapeToday: string;
  /** 已接线 → 口径与覆盖；仍是缺口 → 为什么接不上。 */
  gap: string;
}

/**
 * 真值接线台账。**每条都追过一层调用 / 亲手 curl 过**，不是 grep 命中就下结论。
 *
 * ── WO-TOPO-REALDATA 接上的四条（实测 130/130 格全覆盖）──────────────────────────
 *  `EquipmentOEE`（5460 行）→ util + oee；`Equipment`（780 行）→ takt；`WIPLot`（260 行）→ wip。
 *  走 `POST /a/v1/objects/aggregate`（服务端全量读，不受 ≤1000 截断）。
 *  join 键 = `lineId → 车间`，**不是** `processId`（见 §5.5 顶注：processId 属 Process 层只有 3 值）。
 *
 * ── 仍未接的两条（照实登记，不吹）─────────────────────────────────────────────
 *  · `capacity_rollup`（`apps/datacore/src/solvers/capacity.ts:computeRollup`）——
 *    输出 `bases[].processes: RollupNode[]`，**确实是逐基地逐工序的日产能**。但它读的是
 *    `Process` 对象，而 battery.ts 每条产线只生成 `SERIAL_STEPS`（涂布/卷绕/装配）+ formation + aging
 *    五类 Process；接上之后**十列里只有 ~5 列有真值**，且与本图 Workshop 层列轴不同口径。
 *  · `bottleneck_matrix`（`apps/datacore/src/solvers/risk.ts`）——catalog.ts:50 的描述写的是
 *    "按基地×工序输出瓶颈强度矩阵"，**但看输出契约 `BottleneckMatrixOutputSchema`（contracts/solvers.ts:151）
 *    实际是 基地 × 7 因素**（`tightness: Record<factor, number>`），不是基地×工序。
 *    照描述接会接错维度 —— 它能喂的是"行级紧张度"，不是格级。
 */
export const REAL_DATA_ENTRYPOINTS: RealDataEntrypoint[] = [
  {
    field: "util",
    status: "connected",
    source: "EquipmentOEE",
    shapeToday: "逐设备逐日 {availability, performance, quality, oee, plannedProductionTime, actualProductionTime, equipId, lineId, baseId}（实测 5460 行）",
    gap: "已接：Σ实际生产时间 ÷ Σ计划生产时间（和比和 = 按计划工时加权）。口径名「计划工时利用率」，与行首「产能利用率」不是一个数",
  },
  {
    field: "oee",
    status: "connected",
    source: "EquipmentOEE",
    shapeToday: "同上；每格 42 条（6 台设备 × 7 天）",
    gap: "已接：avg(oee)，**且带等权门** —— 仅当该格各条计划工时全等（实测恒 480min）才承认；不等权即标 EMPTY，不拿简单平均冒充加权",
  },
  {
    field: "takt",
    status: "connected",
    source: "Equipment.ctSeconds",
    shapeToday: "逐设备节拍 s/电芯（battery.ts 由 gwhᵢ 反解；实测 780 台，每格 6 台）",
    gap: "已接：max(ctSeconds) 取最慢工位（线速由瓶颈工位定，节拍不许平均）",
  },
  {
    field: "wip",
    status: "connected",
    source: "WIPLot",
    shapeToday: "逐批次 {lotId, woId, modelId, lineId, currentProcess, qty, status}（实测 260 行，每格 2 批；**无 baseId 属性**）",
    gap: "已接：Σqty，按 lineId 归车间列。刻意不用 currentProcess —— 实测 260/260 行恒为「涂布」，拿它定列等于把全部在制塞进一列",
  },
  {
    field: "—",
    status: "gap",
    source: "capacity_rollup",
    shapeToday: "bases[].processes[]{capacityPerDay, formula, inputs}（逐基地逐工序日产能）",
    gap: "未接：Process 对象只有 涂布/卷绕/装配/化成/老化 五类，且属 Process 层，与本图 Workshop 层十列不同口径", // debattery-allow：这是**诚实缺口说明文案**，不是驱动逻辑的业务常数。把工序名从这句里删掉，诊断就没用了（「只有五类」等于没说）。工序表本身已单源化到 contracts。
  },
  {
    field: "—",
    status: "gap",
    source: "bottleneck_matrix",
    shapeToday: "rows[]{base, tightness: 因素→0–100, primary}（基地 × 7 因素，**不是** 基地 × 工序）",
    gap: "未接：维度不匹配，只能喂行级紧张度；catalog 描述『基地×工序』与输出契约不符，照描述接会接错维度",
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// 8. 缩放/平移的纯数学（组件里只做事件绑定，数学在这里，可单测）
// ───────────────────────────────────────────────────────────────────────────────

export interface ViewTransform {
  /** 缩放倍率。 */
  k: number;
  /** 平移（画布 CSS 像素）。 */
  x: number;
  y: number;
}

export const ZOOM_LIMITS = { min: 0.4, max: 3.2 } as const;
export const ZOOM_STEP = 1.2;
export const IDENTITY_TRANSFORM: ViewTransform = { k: 1, x: 0, y: 0 };

export const clampZoom = (k: number): number => Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, k));

/**
 * 以光标为锚的缩放：光标下的那个内容点，缩放前后**停在同一屏幕位置**。
 * `cx/cy` = 光标相对画布容器左上角的坐标（CSS 像素）。
 */
export function zoomAt(t: ViewTransform, cx: number, cy: number, factor: number): ViewTransform {
  const k2 = clampZoom(t.k * factor);
  if (k2 === t.k) return t;
  // 内容坐标 u = (c - x) / k；缩放后要求 u*k2 + x2 = c ⇒ x2 = c - u*k2
  const ux = (cx - t.x) / t.k;
  const uy = (cy - t.y) / t.k;
  return { k: k2, x: cx - ux * k2, y: cy - uy * k2 };
}

/** 以画布中心为锚缩放（按钮/快捷键用）。 */
export function zoomCenter(t: ViewTransform, factor: number, viewportW: number, viewportH: number): ViewTransform {
  return zoomAt(t, viewportW / 2, viewportH / 2, factor);
}

/**
 * 适应画布：内容整体塞进视口并居中。
 * 视口/内容尺寸测不到（jsdom、未布局、display:none）时**退回单位变换**并说明——
 * 不许拿 0 去除出 Infinity 再"看起来正常地"渲染。
 */
export function fitTransform(
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
): { transform: ViewTransform; measured: boolean } {
  if (!(viewportW > 0 && viewportH > 0 && contentW > 0 && contentH > 0)) {
    return { transform: IDENTITY_TRANSFORM, measured: false };
  }
  const k = clampZoom(Math.min(viewportW / contentW, viewportH / contentH));
  return { transform: { k, x: (viewportW - contentW * k) / 2, y: (viewportH - contentH * k) / 2 }, measured: true };
}
