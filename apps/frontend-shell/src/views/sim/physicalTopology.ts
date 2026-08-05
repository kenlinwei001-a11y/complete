import { BASE_REGISTRY, type CanonicalBase } from "@platform/contracts";

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
 *  `Measure.provenance` 三态，UI 逐格显式标注，不允许混同：
 *   · `registry`   —— 真值，来自 BASE_REGISTRY（基地级 util/gwh/lines/bottleneck）。
 *   · `placeholder`—— **占位**，seed 派生确定性伪值（同 seed 同输入字节一致），今天没有真数据接口。
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
 * `WORKSHOP_DEFS` 镜像（顺序 = 工艺先后，逐字节对齐源文件的 `{ type, suffix }`）。
 * 改动源文件必须同步改这里，否则 source-parity 用例红。
 */
const WORKSHOP_DEFS_MIRROR: { type: string; suffix: string }[] = [
  { type: "制浆", suffix: "slurry" },
  { type: "涂布", suffix: "coating" },
  { type: "辊压", suffix: "calendering" },
  { type: "分切", suffix: "slitting" },
  { type: "卷绕", suffix: "winding" },
  { type: "装配", suffix: "assembly" },
  { type: "注液", suffix: "filling" },
  { type: "化成", suffix: "formation" },
  { type: "分容", suffix: "grading" },
  { type: "PACK", suffix: "pack" },
];

/**
 * battery.ts:3539 `typeMap` 镜像（工序 suffix → 设备型）。
 * 注意它**只有 9 条**：没有 `slurry`、没有 `grading`，却有 `aging`（老化）——
 * 而 `aging` 根本不在十车间链里。这不是笔误，是两层建模口径不同（Workshop 层 vs Process 层），
 * 后果就是"老化库"这个瓶颈在本矩阵里定位不到列 → 只能标 EMPTY（见 `resolveBottleneck`）。
 */
const EQUIPMENT_TYPE_BY_PROCESS_MIRROR: Record<string, string> = {
  coating: "涂布机",
  calendering: "辊压机",
  slitting: "分切机",
  winding: "卷绕机",
  assembly: "装配线",
  filling: "注液机",
  formation: "化成柜",
  aging: "老化库",
  pack: "PACK线",
};

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

export type Provenance = "registry" | "placeholder" | "empty";

export interface Measure {
  /** EMPTY 时恒为 null —— 不补 0、不给假默认。 */
  value: number | null;
  provenance: Provenance;
  unit: string;
  /** provenance=empty 时必填：为什么算不出来。 */
  reason?: string;
}

const registry = (value: number, unit: string): Measure => ({ value, provenance: "registry", unit });
const placeholder = (value: number, unit: string): Measure => ({ value, provenance: "placeholder", unit });
const empty = (unit: string, reason: string): Measure => ({ value: null, provenance: "empty", unit, reason });

/** 人读的来源标签（UI 逐格显示，占位绝不冒充实测）。 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  registry: "真值·基地册",
  placeholder: "占位·未接真值",
  empty: "EMPTY·无数据源",
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

/** 热力填充强度 0–1（EMPTY 恒 0：空就是空，不许靠颜色暗示"低"）。 */
export function heatAlpha(m: Measure): number {
  if (m.value === null) return 0;
  const { lo, hi } = PLACEHOLDER_RANGES.utilPct;
  const t = (m.value - lo) / (hi - lo);
  return Math.max(0.12, Math.min(1, t));
}

// ───────────────────────────────────────────────────────────────────────────────
// 6. 矩阵派生
// ───────────────────────────────────────────────────────────────────────────────

export interface TopologyCell {
  key: string;
  baseId: string;
  baseName: string;
  process: ProcessStep;
  /** 占位：产能利用率 %。 */
  util: Measure;
  /** 占位：OEE %。 */
  oee: Measure;
  /** 占位：在制（电芯）。 */
  wip: Measure;
  /** EMPTY：节拍 s/电芯 —— 前端无 Equipment.ctSeconds 接口，标空不补 0。 */
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
  /** 统计：占位格数 / EMPTY 度量数 / 定位不到的瓶颈数（UI 横幅照实播报）。 */
  stats: { baseCount: number; processCount: number; cellCount: number; placeholderMeasures: number; emptyMeasures: number; unlocatedBottlenecks: number };
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

/**
 * 派生矩阵：行 = `BASE_REGISTRY` 全量（**不接受基地入参**），列 = `PROCESS_CHAIN`。
 * @param seed 占位值种子（同 seed 同输出，R6）。
 */
export function buildTopology(seed: number = PLACEHOLDER_SEED_DEFAULT): TopologyMatrix {
  const processes = PROCESS_CHAIN;
  const rows: TopologyRow[] = BASE_REGISTRY.map((base) => {
    const bottleneck = resolveBottleneck(base.bottleneck);
    const cells: TopologyCell[] = processes.map((process) => {
      const util = placeholder(
        Math.round(spread(seed, base.baseId, process.suffix, "util", PLACEHOLDER_RANGES.utilPct.lo, PLACEHOLDER_RANGES.utilPct.hi) * 10) / 10,
        "%",
      );
      const oee = placeholder(
        Math.round(spread(seed, base.baseId, process.suffix, "oee", PLACEHOLDER_RANGES.oeePct.lo, PLACEHOLDER_RANGES.oeePct.hi) * 10) / 10,
        "%",
      );
      const wip = placeholder(
        Math.round(spread(seed, base.baseId, process.suffix, "wip", PLACEHOLDER_RANGES.wipCells.lo, PLACEHOLDER_RANGES.wipCells.hi)),
        "电芯",
      );
      const takt = empty("s/电芯", "前端无 Equipment.ctSeconds 接口（节拍真值在 DataCore Equipment 对象上，未接进本图）");
      return {
        key: `${base.baseId}::${process.suffix}`,
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

  const cellCount = rows.reduce((n, r) => n + r.cells.length, 0);
  return {
    seed,
    processes,
    segments: SEGMENTS,
    rows,
    stats: {
      baseCount: rows.length,
      processCount: processes.length,
      cellCount,
      placeholderMeasures: cellCount * 3, // util / oee / wip
      emptyMeasures: cellCount * 1, // takt
      unlocatedBottlenecks: rows.filter((r) => r.bottleneck.processSuffix === null).length,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// 7. 接真值的入口（预留·照实登记，不吹）
// ───────────────────────────────────────────────────────────────────────────────

export interface RealDataEntrypoint {
  /** 度量字段（本模块 Measure 的字段名）。 */
  field: "util" | "oee" | "wip" | "takt";
  /** 真值来源对象 / 求解器 key。 */
  source: string;
  /** 该来源今天真实产出的形状（追过一层调用后的实情，不照 catalog 描述抄）。 */
  shapeToday: string;
  /** 接线缺口：为什么今天还接不上 / 接上后能覆盖多少。 */
  gap: string;
}

/**
 * 三个"已存在但没接进这张图"的真值源。**每条都追过一层调用**，不是 grep 命中就下结论：
 *
 *  · `capacity_rollup`（`apps/datacore/src/solvers/capacity.ts:computeRollup`）——
 *    输出 `bases[].processes: RollupNode[]`，**确实是逐基地逐工序的日产能**。但它读的是
 *    `Process` 对象，而 battery.ts 每条产线只生成 `SERIAL_STEPS`（涂布/卷绕/装配）+ formation + aging
 *    五类 Process；也就是说接上之后**十列里只有 ~5 列有真值，其余列必须留 EMPTY**（不许补 0 凑满）。
 *  · `bottleneck_matrix`（`apps/datacore/src/solvers/risk.ts`）——catalog.ts:50 的描述写的是
 *    "按基地×工序输出瓶颈强度矩阵"，**但看输出契约 `BottleneckMatrixOutputSchema`（contracts/solvers.ts:151）
 *    实际是 基地 × 7 因素**（`tightness: Record<factor, number>`），不是基地×工序。
 *    照描述接会接错维度 —— 它能喂的是"行级紧张度"，不是格级。
 *  · `EquipmentOEE`（对象类型，battery.ts:2182 注册 / synthetic/service.ts:803 物化）——
 *    含 availability/performance/quality/oee + `lineId`/`baseId`，逐设备逐日快照（近 7 天）。
 *    经 Equipment→Process→Line 三跳可聚到工序格，今天前端无该聚合接口。
 */
export const REAL_DATA_ENTRYPOINTS: RealDataEntrypoint[] = [
  {
    field: "util",
    source: "capacity_rollup",
    shapeToday: "bases[].processes[]{capacityPerDay, formula, inputs}（逐基地逐工序日产能）",
    gap: "Process 对象只有 涂布/卷绕/装配/化成/老化 五类 → 十列约五列可填，其余保持 EMPTY",
  },
  {
    field: "wip",
    source: "bottleneck_matrix",
    shapeToday: "rows[]{base, tightness: 因素→0–100, primary}（基地 × 7 因素，**不是** 基地 × 工序）",
    gap: "维度不匹配：只能喂行级紧张度；catalog 描述『基地×工序』与输出契约不符，照描述接会接错维度",
  },
  {
    field: "oee",
    source: "EquipmentOEE",
    shapeToday: "逐设备逐日 {availability, performance, quality, oee, equipId, lineId, baseId}",
    gap: "需 Equipment→Process→Line 三跳聚合到工序格，前端今天无此聚合接口",
  },
  {
    field: "takt",
    source: "Equipment.ctSeconds",
    shapeToday: "逐设备节拍 s/电芯（battery.ts 生成，gwhᵢ 派生）",
    gap: "前端无逐设备读取接口 → 本图节拍恒 EMPTY",
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
