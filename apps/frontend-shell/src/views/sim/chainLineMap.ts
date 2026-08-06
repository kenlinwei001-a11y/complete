/**
 * WO-SANDBOX-F1 · 线路图（地铁图隐喻）的**纯派生层**。
 *
 * ── 这个文件是什么 ────────────────────────────────────────────────────────────
 * 把引擎 `chain_loss_attribution`（WO-SANDBOX-E1）返回的载荷，翻译成一张线路图的几何与图元。
 * **它不产生任何数字**：站圈半径、百分比、停运、红弧，全部是引擎返回值的纯函数。
 * 这样「引擎返回的 `LossAttribution` 变化 → 站圈大小与百分比跟着变」才是**结构性成立**，
 * 而不是靠一条测试碰巧咬住（SEAM 判据见 `test/chain-line-map.seam.test.tsx`）。
 *
 * ── 三条硬纪律（审核方 2026-08-05 补充约束，违反即退单）──────────────────────
 * ① **前端不许写死任何全链节点清单 / 节点 ID / 站点列表**。站点完全由引擎 `nodes[].nodeId` 驱动，
 *    `nodeId` 一律当**不透明 key** 用 —— 本文件**零** `split(".")`、零前缀判断、零 ID 白名单。
 *    由来：S0 把 `nodeId` 冻成自由串、没有单源注册表，D1 与 E1 两个 dev 已各发明了一套全链节点 ID
 *    （下划线派 vs 点号派，互相看不见）。谁在前端按 ID 分组，谁就把第三套发明进来了。
 *    本文件因此**连注释里都不写任何具体节点 ID**——写了就会被人抄成"清单"
 *    （门：`chain-line-map.seam.test.tsx` 拿真载荷里的全部 ID 逐个反查源码，命中即红）。
 * ② **分组一律用引擎给的 `stage`**（`ChainStage` 契约枚举），不是 ID 语义。
 * ③ **站名一律用引擎给的 `label`**，前端不维护任何名称映射表。
 *
 * ── 隐喻映射（WO 原文 → 本文件的落法）────────────────────────────────────────
 *  · **站 = 环节**（`ChainStep`）；站圈大小 ∝ 该站 `pctOfChainLoss` → `stationRadius()`。
 *  · **换乘站 = 共用工序（共享瓶颈）** → `sharedBasis`：节点 `scope` 在任一维覆盖 ≥2 个取值
 *    （册面明写共用），或 `scope` 未限定（= 全域，被所有业务线共用）。两者用不同 `kind` 标注，
 *    因为「明写共用」与「没限定所以全域」证据强度不同，混成一个就是又一次静默兜底。
 *  · **合流站 = 齐套 AND** → `AndJoin`。⚠ 这是隐喻**唯一撑不住**的地方：
 *    地铁并线是 **OR**（任一列车到站即可续行），齐套是 **AND**（上游全部到齐才放行）。
 *    因此本图**不把它画成普通合并**：换乘站是「双环圆」，合流站是「AND 闸门 + 汇流母线」，
 *    图元、`data-station-kind`、图例文案三处都分开（见 `ChainLineMapView.tsx` 的 `<AndGate>`）。
 *  · **停运区间 = 断点** → 引擎 `empty[]` 的每一行（`dataMode:"EMPTY"`）落成一个**停运站位**，
 *    与它相邻的区间标 `suspended`。算不出来**也是一种发现**，不许静默隐掉、更不许补 0。
 *  · **红弧 = 返工逆行** → `kind === "rework"` 的站，向本线上一站画一条逆行弧。
 *
 * ── 诚实边界（实测，非推测）─────────────────────────────────────────────────
 * 2026-08-05 拿 E1 分支起内存态 datacore（SEED_DEMO=1·seed 42）真调一次
 * `POST /a/v1/solvers/chain_loss_attribution/invoke` 的结果：
 *  · `kind:"rework"` 的环节 **0 个** —— 返工天数本体无承载（引擎把它放进了 `empty[]`），
 *    所以**真实数据上今天看不到红弧**。本文件仍实现红弧（引擎一旦有 rework 段即自动出现），
 *    但视图必须在图例上说明「当前载荷 0 条返工段」，不许画一条示意用的假红弧。
 *  · `kind:"cadence"` 的环节同样 0 个（节拍无数据承载，D1 单在做）。
 *  · 损失分布**极端不均**：单个环节吃掉 85.5%，最小的 0.0049%。故半径**必须非线性**
 *    （面积 ∝ 占比 ⇒ 半径 ∝ √占比）**且上下夹取**，否则就是「一个巨圈 + 十二个看不见的点」。
 */
import {
  CHAIN_STAGES,
  ChainNodeSchema,
  isChainScopeUnscoped,
  LossAttributionSchema,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  lossConservationResidual,
  type ChainNode,
  type ChainStage,
  type ChainStep,
  type ChainStepKind,
  type LossAttribution,
} from "@platform/contracts";
import { z } from "zod";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 引擎载荷的解析（形状照 S0 冻结契约，不另发明一套）
// ══════════════════════════════════════════════════════════════════════════════

/** 引擎求解器 key。视图只认这一个数据源，没有第二条取数路径。 */
export const CHAIN_LOSS_SOLVER_KEY = "chain_loss_attribution";

/**
 * `empty[]` 行（诚实缺席清单）。
 * ⚠ S0 只冻结了 `ChainNode`/`ChainStep`/`LossAttribution`/`ChainImpediment`/`ChainScope` 五个契约，
 *   **没有**冻结 `empty[]` 的形状（它在 E1 求解器里）。故此处是前端侧的**宽松读取**：
 *   只声明本图真用到的字段，多余字段一律放行（zod `object` 默认剥离未知键）。
 *   等它进 contracts 那天，把这个 schema 换成契约 schema 即可，视图代码一行不用改。
 */
export const ChainLossEmptyRowSchema = z.object({
  stepId: z.string().min(1),
  nodeId: z.string().min(1),
  stage: z.enum(CHAIN_STAGES),
  label: z.string().min(1),
  kind: z.string().min(1),
  dataMode: z.literal("EMPTY"),
  emptyKind: z.string().min(1),
  reason: z.string().min(1),
  probe: z.string().optional(),
});
export type ChainLossEmptyRow = z.infer<typeof ChainLossEmptyRowSchema>;

/** 引擎载荷。`nodes`/`attribution` 直接用 S0 契约 schema 校验 —— 形状不合当场抛，不猜。 */
export const ChainLossPayloadSchema = z.object({
  nodes: z.array(ChainNodeSchema),
  attribution: z.array(LossAttributionSchema),
  empty: z.array(ChainLossEmptyRowSchema).optional(),
  totals: z
    .object({
      leadTimeDays: z.number(),
      valueAddDays: z.number(),
      nonValueDays: z.number(),
      flowEfficiency: z.number().nullable(),
      stepCount: z.number(),
      emptyCount: z.number(),
    })
    .optional(),
  conservation: z
    .object({
      sumPct: z.number(),
      residual: z.number().nullable(),
      tolerancePct: z.number(),
      ok: z.boolean(),
    })
    .optional(),
  anchor: z.object({ so: z.string().optional(), selection: z.string().optional() }).optional(),
  summary: z.string().optional(),
});
export type ChainLossPayload = z.infer<typeof ChainLossPayloadSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 站圈半径（SEAM 的命门：这里是「站圈大小 ∝ pctOfChainLoss」的唯一实现）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 站圈半径的上下夹取（px）。
 *  · `min` —— **最小可见半径**。实测最小环节占 0.0049%，线性映射下它是 0.001px（= 看不见）。
 *    夹到 `min` 保证「有这个环节」这件事一定看得见；具体多小由站旁的数字负责说清楚。
 *  · `max` —— 最大半径。必须 < `LAYOUT.gapX / 2`（相邻站不重叠）且 < `LAYOUT.padY`（不溢出画布），
 *    由 `chain-line-map.seam.test.tsx` 断言，不靠肉眼。
 */
export const STATION_RADIUS = { min: 7, max: 26 } as const;

/**
 * **站圈大小 ∝ 该站 `pctOfChainLoss`** 的唯一实现。
 *
 * 映射：**面积 ∝ 占比 ⇒ 半径 ∝ √占比**（圆的视觉量是面积，用半径直接线性映射会把差距夸大成平方）。
 * 再叠上下夹取。为什么必须非线性 + 夹取（审核方实测给的数）：
 *
 *   | 环节 | pct | 线性半径(0→26) | 本函数 |
 *   |---|---|---|---|
 *   | 最大 | 85.48% | 22.2 | 24.6 |
 *   | 中位 |  7.12% |  1.9 | 12.1 |
 *   | 最小 |  0.0049% | 0.0013（**看不见**） | 7.0（夹到 min·可见） |
 *
 * 增值段（`work`）**不进损失归因表**（S0 §5：分母排除增值段），故没有 `pctOfChainLoss`。
 * 传 `null` ⇒ 返回 `min`：**基准尺寸，不是 0% 的意思**。视图必须另用图元/文案把
 * 「增值段·不计入损失分母」与「损失占比≈0」区分开 —— 两者是不同的事实，画成同一个圈就是撒谎。
 */
export function stationRadius(pctOfChainLoss: number | null): number {
  if (pctOfChainLoss === null) return STATION_RADIUS.min;
  const clamped = Math.max(0, Math.min(100, pctOfChainLoss));
  const r = STATION_RADIUS.min + (STATION_RADIUS.max - STATION_RADIUS.min) * Math.sqrt(clamped / 100);
  return Math.max(STATION_RADIUS.min, Math.min(STATION_RADIUS.max, r));
}

/**
 * 百分比文案。`0.0049%` 直接 `toFixed(2)` 会显示成 `0.00%`（读作"零"，但它不是零）——
 * 小于两位精度的一律显示 `<0.01%`，把「极小」与「没有」分开。
 */
export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

/** 天数文案（小于 0.01 天的走三位小数，避免把换型准备显示成 0.00 天）。 */
export function formatDays(days: number): string {
  if (days > 0 && days < 0.01) return `${days.toFixed(3)} 天`;
  return `${days.toFixed(2)} 天`;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 线路划分（**只用 stage，不碰 nodeId 语义**）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 支线段：这一段在图上画成一条**独立支线**（物料是"喂进来"的，不是主线上顺次经过的一站）。
 * `satisfies ChainStage` ⇒ 契约枚举一改，这里当场 TS 红，不会静默失配。
 */
export const BRANCH_STAGE = "MATERIAL" as const satisfies ChainStage;
/** 支线汇入的主线段：齐套语义 = 物料**全部**到齐，这一段才能开工。 */
export const JOIN_TARGET_STAGE = "CAPACITY" as const satisfies ChainStage;
/** 主线段 = 契约里除支线段以外的全部段（**派生**，不是抄一份清单）。 */
export const TRUNK_STAGES: readonly ChainStage[] = CHAIN_STAGES.filter((s) => s !== BRANCH_STAGE);

export const TRUNK_LINE_ID = "trunk";
export const BRANCH_LINE_ID = "branch";
export type LineId = typeof TRUNK_LINE_ID | typeof BRANCH_LINE_ID;

/** 段的人读名（stage 是契约枚举，这里只是它的中文显示名，与任何租户/行业实体无关）。 */
export const STAGE_LABEL: Record<ChainStage, string> = {
  DEMAND: "需求",
  ORDER: "订单",
  CAPACITY: "产能",
  MATERIAL: "物料",
};

/** 五段环节的人读名（`ChainStepKind` 是契约枚举，此处仅显示名）。 */
export const STEP_KIND_LABEL: Record<ChainStepKind, string> = {
  queue: "排队",
  cadence: "等节拍",
  work: "作业（增值）",
  rework: "返工",
  handoff: "交接",
};

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 图元模型
// ══════════════════════════════════════════════════════════════════════════════

/** 换乘站（共用工序 = 共享瓶颈）的判据与证据强度。两种强度**必须分开**，不许混成一个 bool。 */
export type SharedBasis =
  /** 册面**明写**共用：节点 `scope` 的某一维覆盖 ≥2 个取值。 */
  | { kind: "explicit"; dim: "businessTypes" | "baseIds" | "modelIds"; values: readonly string[] }
  /** 范围**未限定** ⇒ 按契约 `isChainScopeUnscoped` 读作全域，即被所有业务线共用。证据弱于 explicit。 */
  | { kind: "unscoped" };

export const SHARED_BASIS_LABEL: Record<SharedBasis["kind"], string> = {
  explicit: "换乘站 · 册面明写共用（scope 覆盖多值）",
  unscoped: "换乘站 · 范围未限定 ⇒ 全域共用（非册面明写）",
};

export type StationGlyph =
  /** 普通站：非增值环节，圈大小 ∝ 损失占比。 */
  | "stop"
  /** 换乘站：共用工序（共享瓶颈）。双环空心。 */
  | "interchange"
  /** 增值站：`work` 段。不进损失分母 ⇒ 不参与圈大小比较，另给图元。 */
  | "value-add";

export interface StationVM {
  /** 引擎 `ChainStep.stepId`，**不透明 key**。 */
  stepId: string;
  /** 引擎 `ChainNode.nodeId`，**不透明 key**（本文件不解析它的字符串结构）。 */
  nodeId: string;
  /** 站名 = 引擎 `label`（前端无名称映射表）。 */
  label: string;
  nodeLabel: string;
  stage: ChainStage;
  kind: ChainStepKind;
  valueAdd: boolean;
  days: number;
  /** 引擎 `LossAttribution.pctOfChainLoss`；增值段无归因行 ⇒ `null`（诚实缺席，不补 0）。 */
  pctOfChainLoss: number | null;
  /** 引擎 `LossAttribution.nonValueDays`；同上。 */
  nonValueDays: number | null;
  /** = `stationRadius(pctOfChainLoss)`。SEAM 的被观测量。 */
  r: number;
  glyph: StationGlyph;
  sharedBasis: SharedBasis | null;
  /** `kind==="cadence"` 时引擎带的节拍周期（天）；否则 `null`。 */
  cadenceEveryDays: number | null;
  lineId: LineId;
  index: number;
  x: number;
  y: number;
}

/** 停运站位 = 断点（引擎 `empty[]` 的一行）。**它不是一个 0% 的站，是一个算不出来的站。** */
export interface SuspendedVM {
  stepId: string;
  nodeId: string;
  label: string;
  stage: ChainStage;
  kind: string;
  emptyKind: string;
  reason: string;
  probe: string | null;
  lineId: LineId;
  index: number;
  x: number;
  y: number;
}

export interface SegmentVM {
  segmentId: string;
  lineId: LineId;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** `suspended` = 任一端点是停运站位（断点） ⇒ 该区间停运。 */
  state: "live" | "suspended";
}

/** 红弧 = 返工逆行：从本站**回指**本线上一站。 */
export interface ReworkArcVM {
  arcId: string;
  fromStepId: string;
  toStepId: string;
  /** SVG path（一条向上凸的逆行弧，箭头在终点 = 回到上一站）。 */
  path: string;
}

/**
 * 合流站（齐套 AND）。
 *
 * ⚠ **隐喻在此处撑不住，必须显式区分**：
 *   地铁并线 = **OR**（任一列车进站即可续行）；齐套 = **AND**（上游**全部**到齐才放行）。
 * 因此本模型不复用换乘站的图元，另给 `AndJoin` —— 视图用「AND 闸门 + 汇流母线」画它。
 *
 * **诚实边界**：S0 契约**没有** `joinSemantics` 字段可读，所以 AND 语义是**结构推定**：
 * 支线段（物料）与主线的生产段并存 ⇒ 生产段开工需要物料到齐 ⇒ AND。
 * `basis` 字段把这句话原样带到 UI 上，不假装它是从字段里读出来的。
 */
export interface AndJoinVM {
  semantics: "AND";
  /** 汇入点（主线上的这一站）。 */
  targetStepId: string;
  targetX: number;
  targetY: number;
  /** 支线出口（支线最后一个站位）。 */
  sourceX: number;
  sourceY: number;
  inputLineIds: LineId[];
  /** 判据说明（推定 vs 字段，必须让用户看得见）。 */
  basis: string;
}

export interface LineVM {
  lineId: LineId;
  label: string;
  stages: readonly ChainStage[];
  y: number;
  slotCount: number;
}

export interface ChainLineMap {
  lines: LineVM[];
  stations: StationVM[];
  suspended: SuspendedVM[];
  segments: SegmentVM[];
  reworkArcs: ReworkArcVM[];
  andJoin: AndJoinVM | null;
  bounds: { width: number; height: number };
  conservation: { sumPct: number | null; residual: number | null; tolerancePct: number; ok: boolean };
  stats: {
    stationCount: number;
    suspendedCount: number;
    interchangeCount: number;
    valueAddCount: number;
    reworkCount: number;
    cadenceCount: number;
    /** 归因表覆盖到的站数（= 有 `pctOfChainLoss` 的站）。 */
    attributedCount: number;
    maxPct: number | null;
    minPct: number | null;
  };
  /** 诚实边界：本次载荷下哪些图元**没有数据**。视图必须原样显示，不许省略。 */
  notes: string[];
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 几何常量
// ══════════════════════════════════════════════════════════════════════════════

export const LAYOUT = {
  padX: 96,
  /** 上下留白。必须 > `STATION_RADIUS.max`，否则最大站圈溢出画布（测试断言）。 */
  padY: 64,
  /** 相邻站位间距。必须 > `2 × STATION_RADIUS.max`，否则最大的两站会叠在一起（测试断言）。 */
  gapX: 118,
  trunkY: 132,
  branchY: 300,
  minWidth: 720,
  height: 400,
} as const;

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · 构建
// ══════════════════════════════════════════════════════════════════════════════

/** 一个「站位」：要么是真站，要么是停运站位。顺序由引擎输出决定，本文件不重排。 */
type Slot = { kind: "station"; step: ChainStep; node: ChainNode } | { kind: "suspended"; row: ChainLossEmptyRow };

/**
 * 换乘站判据：节点 `scope` 在任一维覆盖 ≥2 个取值（明写共用），或未限定（全域共用）。
 * 维序固定 `businessTypes → baseIds → modelIds`（R6：结论不许依赖对象键遍历顺序）。
 */
export function sharedBasisOf(node: Pick<ChainNode, "scope">): SharedBasis | null {
  const scope = node.scope;
  if (scope === undefined || isChainScopeUnscoped(scope)) return { kind: "unscoped" };
  const dims = ["businessTypes", "baseIds", "modelIds"] as const;
  for (const dim of dims) {
    const values = scope[dim];
    if (values !== undefined && values.length >= 2) return { kind: "explicit", dim, values };
  }
  return null;
}

function glyphOf(step: ChainStep, sharedBasis: SharedBasis | null): StationGlyph {
  // 判据顺序显式写死在这里（不许靠 if 的巧合 —— `wo-capacity-100pct` 排序靠 clamp 巧合的同族教训）：
  // ① 增值段优先：它根本不在损失归因表里，圈大小无从谈起，必须先分流；
  // ② 其次换乘：共用工序是站的**属性**，压过普通站。
  if (step.valueAdd) return "value-add";
  if (sharedBasis !== null) return "interchange";
  return "stop";
}

/** 按 `stage` 分组排序（**只用 stage，绝不解析 nodeId**），组内保持引擎给的顺序。 */
function orderedSlots(payload: ChainLossPayload, stages: readonly ChainStage[]): Slot[] {
  const emptyRows = payload.empty ?? [];
  const out: Slot[] = [];
  for (const stage of stages) {
    const nodesHere = payload.nodes.filter((n) => n.stage === stage);
    const nodeIds = new Set(nodesHere.map((n) => n.nodeId));
    for (const node of nodesHere) {
      for (const step of node.steps) out.push({ kind: "station", step, node });
      // 同一节点上算不出来的段，紧跟该节点的真站之后（停运站位就在它本该在的位置上）。
      for (const row of emptyRows.filter((e) => e.stage === stage && e.nodeId === node.nodeId)) {
        out.push({ kind: "suspended", row });
      }
    }
    // 整个节点都没长出来的（引擎连 node 都没产出）——挂在本段末尾，仍然要看得见。
    for (const row of emptyRows.filter((e) => e.stage === stage && !nodeIds.has(e.nodeId))) {
      out.push({ kind: "suspended", row });
    }
  }
  return out;
}

/**
 * 把引擎载荷翻成线路图。**纯函数**（无 `Date.now`、无随机）——同载荷同输出，R6。
 */
export function buildChainLineMap(payload: ChainLossPayload): ChainLineMap {
  const pctByStep = new Map<string, LossAttribution>();
  for (const row of payload.attribution) pctByStep.set(row.stepId, row);

  const trunkSlots = orderedSlots(payload, TRUNK_STAGES);
  const branchSlots = orderedSlots(payload, [BRANCH_STAGE]);

  const stations: StationVM[] = [];
  const suspended: SuspendedVM[] = [];
  const segments: SegmentVM[] = [];
  /** 每条线上「上一站的 id + 坐标」，用于连区间与画返工逆行弧。 */
  const lineCursor = new Map<LineId, { id: string; x: number; y: number; suspendedEnd: boolean }>();

  const place = (slots: Slot[], lineId: LineId, y: number): void => {
    slots.forEach((slot, index) => {
      const x = LAYOUT.padX + index * LAYOUT.gapX;
      const id = slot.kind === "station" ? slot.step.stepId : slot.row.stepId;
      if (slot.kind === "station") {
        const { step, node } = slot;
        const attr = pctByStep.get(step.stepId) ?? null;
        const sharedBasis = sharedBasisOf(node);
        const pct = attr === null ? null : attr.pctOfChainLoss;
        stations.push({
          stepId: step.stepId,
          nodeId: step.nodeId,
          label: step.label ?? STEP_KIND_LABEL[step.kind],
          nodeLabel: node.label,
          stage: node.stage,
          kind: step.kind,
          valueAdd: step.valueAdd,
          days: step.days,
          pctOfChainLoss: pct,
          nonValueDays: attr === null ? null : attr.nonValueDays,
          r: stationRadius(pct),
          glyph: glyphOf(step, sharedBasis),
          sharedBasis,
          cadenceEveryDays: step.cadence?.everyDays ?? null,
          lineId,
          index,
          x,
          y,
        });
      } else {
        const { row } = slot;
        suspended.push({
          stepId: row.stepId,
          nodeId: row.nodeId,
          label: row.label,
          stage: row.stage,
          kind: row.kind,
          emptyKind: row.emptyKind,
          reason: row.reason,
          probe: row.probe ?? null,
          lineId,
          index,
          x,
          y,
        });
      }
      const prev = lineCursor.get(lineId);
      if (prev !== undefined) {
        const isSuspended = slot.kind === "suspended" || prev.suspendedEnd;
        segments.push({
          segmentId: `${lineId}:${prev.id}->${id}`,
          lineId,
          fromId: prev.id,
          toId: id,
          x1: prev.x,
          y1: prev.y,
          x2: x,
          y2: y,
          state: isSuspended ? "suspended" : "live",
        });
      }
      lineCursor.set(lineId, { id, x, y, suspendedEnd: slot.kind === "suspended" });
    });
  };

  place(trunkSlots, TRUNK_LINE_ID, LAYOUT.trunkY);
  place(branchSlots, BRANCH_LINE_ID, LAYOUT.branchY);

  // ── 红弧 = 返工逆行：向本线上一站回指 ────────────────────────────────────────
  const reworkArcs: ReworkArcVM[] = [];
  for (const st of stations) {
    if (st.kind !== "rework") continue;
    const prev = stations.filter((s) => s.lineId === st.lineId && s.index < st.index).at(-1);
    if (prev === undefined) continue; // 本线第一站就是返工 → 无处可退，不编一条弧出来
    const lift = 44;
    const midX = (st.x + prev.x) / 2;
    reworkArcs.push({
      arcId: `rework:${st.stepId}`,
      fromStepId: st.stepId,
      toStepId: prev.stepId,
      path: `M ${st.x} ${st.y - st.r} Q ${midX} ${st.y - st.r - lift} ${prev.x} ${prev.y - prev.r}`,
    });
  }

  // ── 合流站（齐套 AND）：支线存在 且 主线有生产段 ⇒ 在生产段第一站合流 ──────────
  const branchTail = [...stations, ...suspended]
    .filter((s) => s.lineId === BRANCH_LINE_ID)
    .sort((a, b) => a.index - b.index)
    .at(-1);
  const joinTarget = stations.find((s) => s.lineId === TRUNK_LINE_ID && s.stage === JOIN_TARGET_STAGE) ?? null;
  const andJoin: AndJoinVM | null =
    branchTail !== undefined && joinTarget !== null
      ? {
          semantics: "AND",
          targetStepId: joinTarget.stepId,
          targetX: joinTarget.x,
          targetY: joinTarget.y,
          sourceX: branchTail.x,
          sourceY: branchTail.y,
          inputLineIds: [BRANCH_LINE_ID, TRUNK_LINE_ID],
          basis:
            `齐套 AND（非地铁式 OR）：${STAGE_LABEL[BRANCH_STAGE]}支线与${STAGE_LABEL[JOIN_TARGET_STAGE]}段并存 ⇒ ` +
            `${STAGE_LABEL[JOIN_TARGET_STAGE]}段开工要求上游全部到齐。` +
            `⚠ 这是**结构推定**：S0 契约无 joinSemantics 字段可读，不是从字段里读出来的。`,
        }
      : null;

  // ── 守恒（复用契约里的唯一实现，前端不自己再算一遍分母）─────────────────────
  const residual = payload.conservation?.residual ?? lossConservationResidual(payload.attribution);
  const sumPct =
    payload.conservation?.sumPct ??
    (payload.attribution.length === 0 ? null : payload.attribution.reduce((s, r) => s + r.pctOfChainLoss, 0));
  const tolerancePct = payload.conservation?.tolerancePct ?? LOSS_CONSERVATION_TOLERANCE_PCT;

  const pcts = stations.map((s) => s.pctOfChainLoss).filter((p): p is number => p !== null);
  const slotMax = Math.max(trunkSlots.length, branchSlots.length, 1);

  const notes: string[] = [];
  const reworkStations = stations.filter((s) => s.kind === "rework").length;
  if (reworkStations === 0) notes.push("本次载荷 0 条 kind=\"rework\" 环节 ⇒ 图上无红弧（返工逆行）。不画示意弧。");
  if (stations.filter((s) => s.kind === "cadence").length === 0) {
    notes.push("本次载荷 0 条 kind=\"cadence\" 环节 ⇒ 站上无节拍读数（等待期望 everyDays/2 无值可算）。");
  }
  if (branchSlots.length === 0) notes.push(`本次载荷无 ${STAGE_LABEL[BRANCH_STAGE]} 段 ⇒ 无支线、无齐套合流站。`);
  if (andJoin === null && branchSlots.length > 0) {
    notes.push(`有 ${STAGE_LABEL[BRANCH_STAGE]} 支线但无 ${STAGE_LABEL[JOIN_TARGET_STAGE]} 段真站 ⇒ 合流站无处可落，不画。`);
  }
  if (stations.length > 0 && payload.attribution.length === 0) {
    notes.push("引擎归因表为空（全链无非增值环节，或分母为 0）⇒ 所有站圈退到最小半径，不是「都占 0%」。");
  }

  return {
    lines: [
      { lineId: TRUNK_LINE_ID, label: "主线 · 需求→订单→产能", stages: TRUNK_STAGES, y: LAYOUT.trunkY, slotCount: trunkSlots.length },
      { lineId: BRANCH_LINE_ID, label: `支线 · ${STAGE_LABEL[BRANCH_STAGE]}`, stages: [BRANCH_STAGE], y: LAYOUT.branchY, slotCount: branchSlots.length },
    ],
    stations,
    suspended,
    segments,
    reworkArcs,
    andJoin,
    bounds: {
      width: Math.max(LAYOUT.minWidth, LAYOUT.padX * 2 + (slotMax - 1) * LAYOUT.gapX),
      height: LAYOUT.height,
    },
    conservation: {
      sumPct,
      residual,
      tolerancePct,
      ok: payload.conservation?.ok ?? (residual === null ? false : Math.abs(residual) <= tolerancePct),
    },
    stats: {
      stationCount: stations.length,
      suspendedCount: suspended.length,
      interchangeCount: stations.filter((s) => s.sharedBasis !== null).length,
      valueAddCount: stations.filter((s) => s.valueAdd).length,
      reworkCount: reworkStations,
      cadenceCount: stations.filter((s) => s.kind === "cadence").length,
      attributedCount: pcts.length,
      maxPct: pcts.length === 0 ? null : Math.max(...pcts),
      minPct: pcts.length === 0 ? null : Math.min(...pcts),
    },
    notes,
  };
}
