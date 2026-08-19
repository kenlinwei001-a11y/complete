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
// WO-R13-ONTOCHAIN-PANEL ① · 证据行 schema 复用 `inspectorModel.ts` 已导出的那一份
// （该文件本就声明 evidence/empty 且字段按求解器实物形状；单向依赖，无循环：
//  inspectorModel.ts 只 import @platform/contracts 与 zod，不回import本文件）。
import { ChainLossEvidenceRowSchema } from "./inspectorModel";

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
  /**
   * WO-R13-ONTOCHAIN-PANEL ① · **补上 `evidence[]`**（本单的官方注释点名补齐路径）。
   * 此前本 schema 没声明它 ⇒ zod strip 语义把宿主载荷的下钻证据当场剥掉
   * （`SandboxConsole.tsx` 的 InspectorEvidenceGapNote 记的就是这笔账）。
   * 行 schema 复用 `inspectorModel.ts` 的 `ChainLossEvidenceRowSchema`（同一求解器输出，
   * 两处只读各要的列）；`empty[]` 仍用本文件上面的宽松行 schema（两侧字段集不同，
   * 各自按自己用到的列声明，这是两文件一贯的做法）。
   * ⚠ 补上之后 `sandbox-console.seam.test.tsx` §9① 那条「schema 确实剥掉 evidence」的
   *   断言**按它自己的注释设计当场红**（「哪天有人把 schema 补上了，那条断言当场红，
   *   逼着把这段文案一起改掉」）—— 同单集成时已按约翻转成咬「带着走 + 条数不少」。
   */
  evidence: z.array(ChainLossEvidenceRowSchema).optional(),
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

/**
 * 站下第二行的读数文案（增值段 / 停运站位各有一套）。
 * 放在派生层是因为**标签包围盒要按它算宽度** —— 文案与几何各写一份，宽度就一定对不上。
 */
export const VALUE_ADD_TAG = "增值·不进分母";
export const SUSPENDED_TAG = "停运";
/** 停运站位方框的半高（图元是 `2a × 2a` 的空心方框，`a = 11`）。 */
export const SUSPENDED_HALF = 11;

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
  // WO-CHAIN-24：契约追加第 5 段 ⇒ 本表 TS 当场红（`Record<ChainStage, string>` 少键），照 §3 补齐。
  DELIVERY: "交付",
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
  /** 本站落在本条线的第几行（折行后；不折行恒 0）与第几列。 */
  row: number;
  col: number;
  /**
   * 站在环上的角度（弧度）。
   * ⚠ 横向布局下**恒 0** —— 保留字段只为不惊动读它的旧代码；新代码一律用 `x/y/row/col`。
   */
  angle: number;
  /** 本站属于第几条并行族线（0 = 第一条）。单族链恒 0。 */
  ringIndex: number;
  /** 图上是否标出站名（密度纪律见 `labelledStepIds`）。false 时站仍在，读数走 `data-pct` + 悬浮面板。 */
  labelled: boolean;
  /** 站名/读数的摆位（上下交替 + 同侧分层）。`labelled === false` 时为 `null`。 */
  labelPos: LabelPlacement | null;
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
  row: number;
  col: number;
  /** 见 `StationVM.angle`：横向布局下恒 0。 */
  angle: number;
  ringIndex: number;
  /** 停运站位**永远标名**（算不出来这件事必须一直看得见），故恒 true。 */
  labelled: boolean;
  labelPos: LabelPlacement | null;
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
  /**
   * `suspended` = 任一端点是停运站位（断点） ⇒ 该区间停运。
   * `closure`   = **闭环段**（链尾回指链头）——**结构推定**，不是引擎给的边，见 `ChainLineMap.closureBasis`。
   */
  state: "live" | "suspended" | "closure";
  /** 区间 path。行内是**水平直线**；折行处是贴边绕行的折线（`fold === true`）。 */
  path?: string;
  /** 该区间是否跨行（折行连接段）。视图据此画转折标记，读图人才不会以为线断了。 */
  fold?: boolean;
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
  /** 汇流母线的 path（支线出口 → 走线沟 → 抬升进主线）。几何在模型里算，视图只负责画。 */
  busPath: string;
  /** AND 闸门图元的落点（母线抬升段的正中 ⇒ 一眼看出"物料从这里被闸住"）。 */
  gateX: number;
  gateY: number;
}

export interface LineVM {
  lineId: LineId;
  label: string;
  stages: readonly ChainStage[];
  y: number;
  slotCount: number;
  /** 本条线的折行方案（几行 × 每行几个站位）。 */
  plan: MetroRowPlan;
  /** 线名贴在这条线第一行的左端（阅读起点就在这里）。 */
  labelX: number;
  labelY: number;
}

/**
 * 一条**产品族线**的身份（多族同心环时用）。
 * `anchorSo` 是这条线真实的锚点订单号 —— 三条线之所以不同，是因为**锚点不同**，
 * 不是因为前端给同一份数据画了三个颜色。
 */
export interface FamilyIdentity {
  /** 族键（= `BusinessType` 契约枚举值）。 */
  key: string;
  label: string;
  /** 该族这条链的锚点订单（引擎 `anchor.so`）。 */
  anchorSo: string | null;
  /** 该链落在哪个基地 / 哪条工艺路线（引擎 `anchor`）。 */
  anchorBaseId: string | null;
  anchorRoutingId: string | null;
  ringIndex: number;
  ringOffset: number;
  /**
   * 一共并置几条族线。横向布局按**整块下移**摆放（第 i 条族线整条线路图往下挪一个块高），
   * 所以必须知道总条数才算得出画布高度 —— 环形时代靠 `ringOffset` 缩放半径，不需要这个数。
   */
  ringCount: number;
}

export interface ChainLineMap {
  lines: LineVM[];
  stations: StationVM[];
  suspended: SuspendedVM[];
  segments: SegmentVM[];
  reworkArcs: ReworkArcVM[];
  andJoin: AndJoinVM | null;
  /** 折行处的转折标记（"没断，接下一行左端"）。不折行时为空数组。 */
  folds: FoldVM[];
  /** 闭环回流箭头（右端绕回起点）。链只有一站时为 `null`。 */
  closureReturn: ClosureReturnVM | null;
  /** 本图这一条是哪条族线（单链形态 = `null`）。 */
  family: FamilyIdentity | null;
  /**
   * 闭环段的判据。**必须原样显示**：引擎给的是有序列表不是环，
   * 「链尾回款 → 链头需求」这条边是本层的**结构推定**，与 `andJoin.basis` 同族纪律。
   */
  closureBasis: string | null;
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

/**
 * **横向线路图几何**（WO-CHAIN-MAP-LAYOUT）。
 *
 * ── 为什么从「环」改回「横线」（这不是审美反复，是三处实测代价）──────────────
 * 环形画法（本文件 2026-08-09 之前的形态）在真载荷上被实拍到三个毛病：
 *  ① **标签互相压字**：放射式摆位把标签沿半径往外发散，圆的顶/底两极必然拥挤 ——
 *     实测底部三条标签叠成一团、顶部三条叠成一团。这是**布局的固有毛病**，不是标签写太长。
 *  ② **没有阅读起点**：圆上任何一点都可以是"第一站"，读图的人不知道从哪开始。
 *  ③ **圆心整片浪费**：980×680 的画布，中心除一个 AND 门外全空。
 *
 * 根因一句话：**闭环是语义，不是形状** —— 引擎把链建模成闭环，画的人把「闭环」照字面画成了圆。
 * 新画法把闭环交给**右端一条回流箭头**表达（`state:"closure"` 的那条边照旧是结构推定），
 * 形状则回到地铁/物流线路图的通行做法：**主线一条横线，起点在左、终点在右**。
 *
 * ── 站名不再互相压字，靠的是两条可计算的规则（不是"把字写小一点"）──────────────
 *  · **上下交替**：沿线依次把标签摆到线的上方 / 下方（地铁图标准做法），
 *    同侧相邻标签因此相距 `2 × gapX` 而不是 `gapX`；
 *  · **同侧分层**：仍然撞上时把后一个标签往外推一层（`labelTierGap`）。
 *    层数**故意封顶**（`maxLabelTiers`）—— 无限分层会把「上下交替」变成可有可无的装饰，
 *    那样"标签改成同侧排列"的变异反证就再也红不了（假绿的又一形态）。
 *    封顶后仍摆不下的，**如实标成 `labelOverflow` 并写进诚实边界**，不偷偷藏一个标签。
 *
 * 几何**只算不量**：字宽用 `estimateLabelWidth` 估（纯函数、无 DOM），
 * 所以「相邻标签包围盒不重叠」这件事在**模型层**就可断言，不依赖浏览器测量。
 */
export const METRO_LAYOUT = {
  /** 左右留白。必须容得下最左/最右那个站的标签（标签会向画布内夹取，见 `clampLabelX`）。 */
  padX: 96,
  /** 顶部留白。必须 > 一个完整标签带的高度，否则第一行上方的标签会被裁掉。 */
  padTop: 108,
  padBottom: 112,
  /** 相邻站位的水平间距。必须 > `2 × STATION_RADIUS.max`，否则最大的两站会叠在一起（测试断言）。 */
  gapX: 122,
  /**
   * 一行最多摆几个站位；超出即折行，折行处画转折标记。
   *
   * ── 这个数是**量出来的**，不是拍的（2026-08-10 真浏览器 CDP 实测）────────────
   * 它决定画布长宽比，而长宽比决定「适应画布」之后有多少地方是空的 ——
   * 而「大面积空白」正是环形版被点名的第 ③ 条代价，换个形状照样会犯。
   * 实测画布 1006×772（标准页 `/v/chain-line-map` @1600×1100），本次载荷主线 35 个站位：
   *   | 一行几个 | 折成几行 | 画布 | 长宽比 | fit 缩放 | **画布利用率** |
   *   |---|---|---|---|---|---|
   *   | 18 | 2 | 2266×770  | 2.94 | 0.44× | **44%**（上下各空一大条）|
   *   | 12 | 3 | 1534×1008 | 1.52 | 0.66× | **86%** |
   *   |  9 | 4 | 1168×1246 | 0.94 | 0.62× | 72%（左右空）|
   * 取 12：利用率最高、字最大。复验：`node scripts/zz-shot-chain-line-map.mjs` 的「画布利用率(fit)」一行。
   */
  maxSlotsPerRow: 12,
  /**
   * 折行时两行主线之间的垂直距离。
   * 必须 ≥ **两条标签带 + 走线沟**（`metroLabelBandPx() × 2 + gutterH`）——
   * 少一点点就会出现「上一行下方的标签压到下一行上方的标签」，
   * 那正是环形版被实拍到的那个毛病换个地方复发。（门：`chain-line-map.seam` 逐项验算，不靠肉眼。）
   */
  rowGap: 238,
  /** 物料支线与主线**最后一行**之间的垂直距离（支线是并行的另一条线，不是主线的下挂）。同样受上式约束。 */
  branchGap: 238,
  /** 多产品族并行时，两条族线整块之间的垂直留白。 */
  familyGap: 96,
  /** 标签第一层与站圈边缘的距离。 */
  labelBase: 13,
  /** 同侧标签分层的层距（必须 ≥ `labelBoxH`，否则两层自己就叠上了）。 */
  labelTierGap: 28,
  /** 同侧最多分几层。**故意封顶**，理由见上。 */
  maxLabelTiers: 2,
  /** 标签块高度 = 站名一行 + 读数一行。 */
  labelBoxH: 26,
  labelFontPx: 11,
  /** 站名行相对标签框顶的基线偏移；读数行再往下一行。 */
  labelLineH: 13,
  /** 相邻标签之间至少留的水平空隙（小于它就算撞上）。 */
  labelGapX: 8,
  /** 折行连接线的竖向走线离画布边的距离（比任何标签都更靠边，故不会压字）。 */
  railInset: 46,
  /** 回流（闭环）竖向走线的留白，比折行走线更靠边一档，两者不重叠。 */
  closureRailInset: 22,
  /** 折线拐角的圆角半径。 */
  cornerR: 15,
  /** 两条标签带之间留给折行连接线/汇流母线的走线沟高度。 */
  gutterH: 52,
  minWidth: 720,
  height: 420,
} as const;

/**
 * 一条线**单侧**标签带的最大厚度（px）。
 * = 最大站圈半径 + 第一层让位 + 分层推开的总量 + 标签块高。
 * 行距 / 支线距 / 底部回流沟全都从它推出来 —— **写死一个"看着够"的数字就是下一次压字的种子**。
 */
export function metroLabelBandPx(): number {
  return (
    STATION_RADIUS.max +
    METRO_LAYOUT.labelBase +
    (METRO_LAYOUT.maxLabelTiers - 1) * METRO_LAYOUT.labelTierGap +
    METRO_LAYOUT.labelBoxH
  );
}

/** 一条线的折行方案：几行、每行几个站位。**行内一律左 → 右**（不是蛇形回折——那会让人反向读）。 */
export interface MetroRowPlan {
  rowCount: number;
  perRow: number;
}

/**
 * 折行方案。行数取「装得下的最少行数」，再把站位**均摊**到各行
 * （不是前几行塞满、最后一行剩两个 —— 那样最后一行会短得像断了）。
 */
export function metroRowPlan(total: number): MetroRowPlan {
  const n = Math.max(1, total);
  const rowCount = Math.max(1, Math.ceil(n / METRO_LAYOUT.maxSlotsPerRow));
  return { rowCount, perRow: Math.ceil(n / rowCount) };
}

/** 第 `index` 个站位落在哪一行第几列、画布坐标是多少。`y0` = 本条线第一行的基线。 */
export function metroSlotPoint(index: number, plan: MetroRowPlan, y0: number): { row: number; col: number; x: number; y: number } {
  const row = Math.min(plan.rowCount - 1, Math.floor(index / plan.perRow));
  const col = index - row * plan.perRow;
  return { row, col, x: METRO_LAYOUT.padX + col * METRO_LAYOUT.gapX, y: y0 + row * METRO_LAYOUT.rowGap };
}

/** 一行 `perRow` 个站位时画布该多宽。 */
export function metroCanvasWidth(perRow: number): number {
  return Math.max(METRO_LAYOUT.minWidth, METRO_LAYOUT.padX * 2 + Math.max(0, perRow - 1) * METRO_LAYOUT.gapX);
}

/**
 * 标签宽度的**估算**（px）。几何必须是纯函数 ⇒ 不量 DOM、不依赖字体加载。
 * 判据：码位 > U+00FF 的一律按**全角**（一个字号宽）算 —— 中日韩、全角括号、箭头都落在这一档；
 * 其余按 0.55 字号。估宽略偏大是刻意的：宁可多留空，不要算窄了以后真压上。
 */
export function estimateLabelWidth(text: string, fontPx: number = METRO_LAYOUT.labelFontPx): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0x00ff ? fontPx : fontPx * 0.55;
  return w;
}

/** 标签锚点（`textAnchor="middle"`）的左右夹取：整块必须留在两条竖向走线之内。 */
export function clampLabelX(x: number, boxW: number, canvasW: number): number {
  const lo = METRO_LAYOUT.closureRailInset + 12 + boxW / 2;
  const hi = canvasW - METRO_LAYOUT.closureRailInset - 12 - boxW / 2;
  if (lo > hi) return canvasW / 2;
  return Math.max(lo, Math.min(hi, x));
}

/** 一个标签的包围盒（画布坐标）。「相邻站名不许压字」这道门直接咬它。 */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 两个包围盒是否相交（留 `labelGapX` 的水平余量；纵向严格相交才算撞）。 */
export function labelBoxesOverlap(a: LabelBox, b: LabelBox, gapX: number = METRO_LAYOUT.labelGapX): boolean {
  const sepX = a.x + a.w + gapX <= b.x || b.x + b.w + gapX <= a.x;
  const sepY = a.y + a.h <= b.y || b.y + b.h <= a.y;
  return !sepX && !sepY;
}

/** 站名/读数的摆位结果（**上下交替 + 同侧分层**的产物）。 */
export interface LabelPlacement {
  side: "above" | "below";
  tier: number;
  /** `textAnchor="middle"` 的 x（已按画布边界夹取）。 */
  x: number;
  /** 站名行基线。 */
  nameY: number;
  /** 读数行基线。 */
  subY: number;
  box: LabelBox;
  /** 层数封顶后仍摆不下 ⇒ 如实标记（不藏标签，也不假装不挤）。 */
  overflow: boolean;
}

/** 折行处的转折标记（"这条线在这里换到下一行，没有断"）。 */
export interface FoldVM {
  foldId: string;
  lineId: LineId;
  fromRow: number;
  toRow: number;
  /** 标记图元的落点（折行走线沟的正中）。 */
  x: number;
  y: number;
}

/**
 * 闭环回流（链尾 → 链头）的**回流箭头**。
 * 环形画法把它画成"圆的最后一段弧"，横向画法把它单列成一条**贴边绕回去的线** ——
 * 语义（闭环）一字不改，形状不再绑架整张图。
 */
export interface ClosureReturnVM {
  fromStepId: string;
  toStepId: string;
  path: string;
  /** 注记文字的落点（底部走线沟上方）。 */
  labelX: number;
  labelY: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5.1 · **环线几何**（保留：在途/在制图层仍画在环上）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 环线几何常量。数值取自设计稿 `sandbox-console-DESIGN-v2-with-zoom.html:737`
 * （`CX=470 CY=330 RX=372 RY=252 W3=980 H3=640`），同心环偏移取 `:748` 的 `OFF=[.972,1,1.028]`。
 *
 * ⚠ **本节今天的消费方是在途/在制图层（`TransitFlowLayer.tsx`），不再是线路图本体**。
 * 线路图已按 `METRO_LAYOUT` 改成横向（WO-CHAIN-MAP-LAYOUT），理由见上；
 * 环几何原语（`ringAngle` / `ringPoint` / `ringArcPath` / `ringArcPointAt` …）**原样保留、
 * 一行未改** —— 它们是在途图层的坐标单源（§5.2），删了那一层就得自己再算一遍。
 * 两层的 `viewBox` 因此**不再相同**：`SandboxConsole.tsx` 的叠加说明（`OverlayNote`）
 * 还写着「两图 viewBox 相同 ⇒ 同一坐标即同一屏点」，那句话在本单之后**已过期**，
 * 需另派一单把在途层迁到 `METRO_LAYOUT` 上（本单范围边界外，不在此偷改）。
 */
export const RING_LAYOUT = {
  cx: 470,
  cy: 330,
  rx: 372,
  ry: 252,
  viewW: 980,
  viewH: 680,
  /** 采购支线的内圈半径系数（设计稿 `bK=.58`）。 */
  branchK: 0.58,
  /** 起始角：正上方（12 点钟），顺时针。 */
  startAngle: -Math.PI / 2,
  /**
   * 同心环偏移系数（设计稿 `OFF`）。**长度即最多能并置几条族线**；
   * 少于 3 条时取前 N 个并居中（`ringOffsets()`），不留空环。
   */
  offsets: [0.972, 1, 1.028] as readonly number[],
  /** 返工逆行弦的内缩系数（设计稿 `.93`）。 */
  reworkK: 0.93,
} as const;

/** 本图最多能并置几条族线（= 同心环个数上限）。超出即拒绝，不悄悄丢线。 */
export const MAX_FAMILY_RINGS = RING_LAYOUT.offsets.length;

/**
 * N 条族线各自的半径系数。N=1 → `[1]`（正中那一圈，与单链形态完全一致）；
 * N=2 → 取首尾；N=3 → 全取。**不会出现"画了三圈但只有一条有数据"**。
 */
export function ringOffsets(count: number): number[] {
  if (count <= 1) return [1];
  if (count >= MAX_FAMILY_RINGS) return [...RING_LAYOUT.offsets];
  // N=2：取最内与最外，避免两条线贴在一起看不出分层
  return [RING_LAYOUT.offsets[0]!, RING_LAYOUT.offsets[MAX_FAMILY_RINGS - 1]!];
}

/** 第 i 个站位在环上的角度（i/total 均分一整圈，从正上方顺时针）。 */
export function ringAngle(index: number, total: number): number {
  return RING_LAYOUT.startAngle + (index / Math.max(1, total)) * Math.PI * 2;
}

/** 极坐标 → 画布坐标。`k` = 半径系数（同心环偏移 / 支线内圈 / 返工弦内缩）。 */
export function ringPoint(angle: number, k: number): { x: number; y: number } {
  return {
    x: RING_LAYOUT.cx + RING_LAYOUT.rx * k * Math.cos(angle),
    y: RING_LAYOUT.cy + RING_LAYOUT.ry * k * Math.sin(angle),
  };
}

/**
 * 相邻两站间的**椭圆弧** path（区间画成弧，不是弦——弦会从环内穿过去，把图搅乱）。
 * `sweep=1` = 顺时针，与 `ringAngle` 的方向一致。
 */
export function ringArcPath(a0: number, a1: number, k: number): string {
  const p0 = ringPoint(a0, k);
  const p1 = ringPoint(a1, k);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${(RING_LAYOUT.rx * k).toFixed(2)} ${(RING_LAYOUT.ry * k).toFixed(2)} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/*
 * `minStationGap(total, k)` —— 环上相邻两站最小欧氏间距（`2·ry·k·sin(π/total)`），
 * **已于 WO-CHAIN-MAP-LAYOUT 删除**。它唯一的调用点在 `buildChainLineMap` 的
 * 「环上最密处间距」那条诚实边界里；主干改横向布局后该判据换成了对 `METRO_LAYOUT.gapX`
 * 的直接比较，这个函数就再没有调用点了。
 *
 * 不留成"以后可能有人用"的死代码：本仓的判据是**只有 test 引用 = 已排练不是已实现**，
 * 零引用连排练都算不上。真要迁在途图层时，从 git 历史取回三行数学比读一段"看着在用"的
 * 死导出便宜得多。（删除前已用金丝雀自证过 grep 没坏：`ringStationAnchors` 同法必中 3 个文件。）
 */

// ══════════════════════════════════════════════════════════════════════════════
// § 5.2 · **环几何的对外单源**（WO-TRANSIT-GEOMETRY）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 本节存在的唯一理由：**别的图层（今天是在途 / 在制层）要把东西落到同一个环上，
 * 而它不许自己再算一遍站点位置**。
 *
 * ── 为什么必须是「导出纯数据」而不是「把渲染搬过去」──────────────────────────
 * 在途图层此前自绘一套**直线**几何（一条 26px 高的横轨 + `left: p%` 的绝对定位方块），
 * 与线路图的环**没有任何共同坐标系**：同一个基地在两张图上不是同一个点，
 * 用户没法把「这批货在哪」与「这条链堵在哪」对起来看。修法只有一个 ——
 * 坐标**只能有一处实现**。故本节把 §5.1 的极坐标原语（`ringAngle` / `ringPoint` /
 * `ringArcPath`）包装成「给一组不透明 key，回一组锚点/弧」的纯数据出口，
 * 由 `buildChainLineMap` 与在途图层**共用**。本节不产出任何 JSX、不引任何 React。
 *
 * ── `nodeId` 仍是不透明 key ────────────────────────────────────────────────────
 * 本节对 key 只做两件事：**排在第几个**、**当 Map 的键**。零 `split`、零前缀判断。
 *
 * ── 诚实边界（必须随代码一起被读到）────────────────────────────────────────────
 * 「同一个环、同一套均分规则」**不等于**「同一个 key 在两张图上落到同一个角度」：
 * 线路图的站位来自引擎 `chain_loss_attribution` 的**链路节点**（`ChainStep`），
 * 在途图层的站来自批次数据行自带的**基地 / 工序 key**——两套 key 今天**没有共同的 id 维度**
 * （同族缺口已记在 `docs/PRD-sandbox-metro-semantics.md` §5：两个求解器的 locus 对不上）。
 * 所以本节保证的是**几何单源**（同一个椭圆、同一个 `ringAngle` 均分、同一个 `ringArcPath`），
 * 不是**实体对齐**。要做到后者，需引擎给在途层下发 `nodes[]`（图层的 `nodes` prop 已就位）。
 * 消费方必须把这句话原样显示给用户，不许让「看起来对齐了」盖过去。
 */

/** 一个站在环上的锚点（纯数据；`x/y` 已是画布坐标）。 */
export interface RingStationAnchor {
  /** 不透明 key（本模块只拿它当 Map 键与顺序标识）。 */
  nodeId: string;
  index: number;
  total: number;
  /** 极角（弧度）。 */
  angle: number;
  /** 半径系数（同心环偏移 / 支线内圈）。 */
  k: number;
  x: number;
  y: number;
}

/**
 * 一组站点 key → 环上锚点。**均分整圈**，与 `buildChainLineMap` 的主干站位同一条规则
 * （`ringAngle(index, total)` + `ringPoint`）—— 这就是「坐标只有一处实现」的落点。
 */
export function ringStationAnchors(nodeIds: readonly string[], k = 1): RingStationAnchor[] {
  const total = Math.max(1, nodeIds.length);
  return nodeIds.map((nodeId, index) => {
    const angle = ringAngle(index, total);
    const p = ringPoint(angle, k);
    return { nodeId, index, total, angle, k, x: p.x, y: p.y };
  });
}

/**
 * 顺行（顺时针）规范化：把 `a1` 抬进 `(a0, a0 + 2π]`，与 `ringArcPath` 的 `sweep=1` 同向。
 * 起终点重合（自环）⇒ 整整一圈，而不是长度 0 —— 那样才画得出来，也才算得出弧长。
 */
export function forwardAngle(a0: number, a1: number): number {
  const TWO_PI = Math.PI * 2;
  const d = (((a1 - a0) % TWO_PI) + TWO_PI) % TWO_PI;
  return a0 + (d === 0 ? TWO_PI : d);
}

/** 一个区间在环上的弧（纯数据）。`a1` 已顺行规范化，可能 > 2π。 */
export interface RingSegmentArc {
  segmentId: string;
  fromNodeId: string;
  toNodeId: string;
  a0: number;
  a1: number;
  k: number;
  /** SVG path（`ringArcPath` 生成，与线路图区间同一个生成器）。 */
  path: string;
  /** 弧长（px）—— 弧长参数化的分母。 */
  lengthPx: number;
}

/** 两个锚点之间的顺行弧。两端半径系数必须一致（同一圈上才谈得上区间）。 */
export function ringSegmentArc(from: RingStationAnchor, to: RingStationAnchor, segmentId?: string): RingSegmentArc {
  const a0 = from.angle;
  const a1 = forwardAngle(a0, to.angle);
  const k = from.k;
  return {
    segmentId: segmentId ?? `${from.nodeId}→${to.nodeId}`,
    fromNodeId: from.nodeId,
    toNodeId: to.nodeId,
    a0,
    a1,
    k,
    path: ringArcPath(a0, a1, k),
    lengthPx: ringArcLength(a0, a1, k),
  };
}

/**
 * 弧长积分的采样格数（复合 Simpson，必须偶数）。
 * 128 格在整圈上的截断误差 ~1e-4 px（被积函数光滑周期），远小于 `RING_ARC_TOLERANCE_PX`。
 */
export const RING_ARC_SAMPLES = 128;
/** 弧长反解的二分次数。40 次 ⇒ 角度分辨率 ~2π/2⁴⁰，位置误差远在浮点噪声内。 */
export const RING_ARC_BISECTIONS = 40;
/**
 * 弧长参数化的**公开容差**（px）：`|实际弧长(a0→解出的角) − t·总弧长| ≤ 此值`。
 * 实测残差 ~1e-10 px（见 `transit-geometry.seam.test.tsx`），此处留三个数量级余量；
 * 门直接引用本常数，不在测试里另写一个数（两处写数 = 迟早对不上）。
 */
export const RING_ARC_TOLERANCE_PX = 0.01;

/** 椭圆参数曲线的速度 `|dP/dθ|`（弧长微分）。 */
function ringArcSpeed(angle: number, k: number): number {
  return Math.hypot(RING_LAYOUT.rx * k * Math.sin(angle), RING_LAYOUT.ry * k * Math.cos(angle));
}

/**
 * 椭圆弧 `[a0, a1]` 的**弧长**（px）。复合 Simpson，纯函数、无随机（R6）。
 *
 * ⚠ 椭圆弧长没有初等闭式（第二类椭圆积分），所以这里是数值积分而不是 `r·Δθ`：
 *   本环 `rx=372 / ry=252`，用 `r·Δθ` 会在长短轴之间差出 ~47%。
 */
export function ringArcLength(a0: number, a1: number, k: number, samples: number = RING_ARC_SAMPLES): number {
  const n = samples % 2 === 0 ? samples : samples + 1;
  const h = (a1 - a0) / n;
  if (h === 0) return 0;
  let sum = ringArcSpeed(a0, k) + ringArcSpeed(a1, k);
  for (let i = 1; i < n; i++) sum += ringArcSpeed(a0 + i * h, k) * (i % 2 === 0 ? 2 : 4);
  return Math.abs((h / 3) * sum);
}

/**
 * ★ **弧长参数化**：`t ∈ [0,1]` 是**走完的弧长比例**，返回环上那一点。
 *
 * ── 为什么不是「弦的线性插值」（本单被点名的那条）────────────────────────────
 * 弦是两站之间的**直线**，它离开曲线往环内塌。实测（本环、整圈均分）：
 *   · 4 站时 t=0.5 的弦中点离弧上真点 **85.3px**，且椭圆残差 0.707（= 明显在环内）；
 *   · **2 站时弦中点恰好是环心** —— 车会从环心穿过去，这不是"略偏"，是画错了。
 *   · 即使 26 站，弦中点也偏 1.8px 且不在环上。
 * ── 为什么也不是「角度的线性插值」──────────────────────────────────────────
 * 角度均匀 ≠ 弧长均匀（椭圆上短轴附近走得慢）。实测 4 站时 t=0.5 两法相距 **29.8px**，
 * 表现为"车在长轴段窜、在短轴段磨" —— 而在途批次的 `progress` 是**时间比例**，
 * 时间均匀就该走得路程均匀，所以必须按弧长解。
 *
 * 实现：弧长关于 θ 严格单调（速度恒正）⇒ 二分反解，`RING_ARC_BISECTIONS` 次。
 */
export function ringArcPointAt(a0: number, a1: number, k: number, t: number): { angle: number; x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const total = ringArcLength(a0, a1, k);
  if (total === 0 || a1 === a0) {
    const p = ringPoint(a0, k);
    return { angle: a0, x: p.x, y: p.y };
  }
  const target = total * clamped;
  let lo = a0;
  let hi = a1;
  for (let i = 0; i < RING_ARC_BISECTIONS; i++) {
    const mid = (lo + hi) / 2;
    if (ringArcLength(a0, mid, k) < target) lo = mid;
    else hi = mid;
  }
  const angle = (lo + hi) / 2;
  const p = ringPoint(angle, k);
  return { angle, x: p.x, y: p.y };
}

/**
 * 沿半径把点推离环（正数 = 朝环外，负数 = 朝环内）。
 * 站上挂徽标 / 堆叠时用它 —— **它不产生"在区间上"的位置**，正是为了让
 * 「只能定位到站」的批次在几何上就不可能被读成「在路上跑」。
 * 与线路图站名摆位（`ChainLineMapView.labelAnchor`）同一个实现。
 */
export function ringRadialOffsetPoint(angle: number, k: number, outwardPx: number): { x: number; y: number } {
  const p = ringPoint(angle, k);
  return radialOffsetFrom(p.x, p.y, angle, outwardPx);
}

/**
 * 环在该角度处的**单位切向**（顺行方向）。图元要"车头朝着走的方向"时用它，
 * 免得消费方自己去写一遍 `dP/dθ`（写第二遍就会与环的半径系数脱钩）。
 */
export function ringTangent(angle: number, k: number): { dx: number; dy: number } {
  const dx = -RING_LAYOUT.rx * k * Math.sin(angle);
  const dy = RING_LAYOUT.ry * k * Math.cos(angle);
  const m = Math.hypot(dx, dy);
  return m === 0 ? { dx: 1, dy: 0 } : { dx: dx / m, dy: dy / m };
}

/**
 * 从环上任一点沿半径方向推开 —— 「离开环」的**唯一实现**。
 * 线路图的站名摆位（`labelAnchor`）与在途层的站上徽标共用它，两处不许各写一遍。
 */
export function radialOffsetFrom(x: number, y: number, angle: number, outwardPx: number): { x: number; y: number } {
  return { x: x + Math.cos(angle) * outwardPx, y: y + Math.sin(angle) * outwardPx };
}

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

/** 构图参数（多族并行线用；不传 = 单链）。 */
export interface ChainLineMapOptions {
  family?: FamilyIdentity;
}

/**
 * 一条线上最多标几个站名。
 *
 * 2026-08-10 实测（`apps/frontend-shell/test/fixtures/chain-loss-real.json`，demo seed 42 的真引擎返回）：
 * 主干 35 个站位、支线 9 个，站名 4–19 个汉字。复验：
 * `node -e "const p=require('./apps/frontend-shell/test/fixtures/chain-loss-real.json');
 *  console.log(p.nodes.flatMap(n=>n.steps).length, (p.empty||[]).length)"`。
 * 处置纪律：**减的是标签，不是站** —— 站一个不少、悬浮/右栏仍给全量读数；
 * 只把「先看哪几个」标出来。选取判据 = `pctOfChainLoss` 降序（引擎给的损失占比，前端不另定优先级），
 * 并列按 stepId 字典序（R6 全序）。停运站位**不参与减标**：断点必须一直看得见。
 */
export const MAX_LABELS_PER_RING = 9;

/**
 * 该条线上要标名字的 `stepId` 集合。纯函数，输入是已建好的站表。
 * （视图侧的同名导出是本函数的转发，两处不许各排一套顺序。）
 */
export function pickLabelledStepIds(stations: readonly StationVM[]): Set<string> {
  const ranked = [...stations]
    .sort((a, b) => {
      const av = a.pctOfChainLoss ?? -1;
      const bv = b.pctOfChainLoss ?? -1;
      return av !== bv ? bv - av : a.stepId < b.stepId ? -1 : 1;
    })
    .slice(0, MAX_LABELS_PER_RING);
  return new Set(ranked.map((s) => s.stepId));
}

/** 圆角折线：把一串正交拐点连成带圆角的 path（折行连接线 / 回流箭头 / 汇流母线共用一份实现）。 */
export function orthoRoundedPath(points: readonly { x: number; y: number }[], r: number = METRO_LAYOUT.cornerR): string {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
  const f = (n: number) => n.toFixed(2);
  let d = `M ${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const a = { x: cur.x - ((cur.x - prev.x) / (inLen || 1)) * rr, y: cur.y - ((cur.y - prev.y) / (inLen || 1)) * rr };
    const b = { x: cur.x + ((next.x - cur.x) / (outLen || 1)) * rr, y: cur.y + ((next.y - cur.y) / (outLen || 1)) * rr };
    d += ` L ${f(a.x)} ${f(a.y)} Q ${f(cur.x)} ${f(cur.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const last = pts.at(-1)!;
  d += ` L ${f(last.x)} ${f(last.y)}`;
  return d;
}

/** 待摆位的一个标签（站与停运站位共用一条摆位规则 —— 两套规则必然互相压字）。 */
interface LabelInput {
  key: string;
  x: number;
  y: number;
  /** 站圈/方框的半高，标签从这里往外让。 */
  half: number;
  row: number;
  name: string;
  sub: string;
}

/**
 * **上下交替 + 同侧分层**的摆位。逐行独立处理；行内按 x 升序，交替上/下。
 * 同侧撞上时往外推一层；层数封顶后仍撞，**如实标 `overflow`**（不藏标签）。
 */
function placeLabels(inputs: readonly LabelInput[], canvasW: number): Map<string, LabelPlacement> {
  const out = new Map<string, LabelPlacement>();
  const byRow = new Map<number, LabelInput[]>();
  for (const it of inputs) {
    const bucket = byRow.get(it.row);
    if (bucket === undefined) byRow.set(it.row, [it]);
    else bucket.push(it);
  }
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const items = byRow.get(row)!.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.key < b.key ? -1 : 1));
    /** 每一侧、每一层「已占到的最右端」。 */
    const frontier: Record<"above" | "below", number[]> = { above: [], below: [] };
    items.forEach((it, i) => {
      const side: "above" | "below" = i % 2 === 0 ? "above" : "below";
      const w = Math.max(estimateLabelWidth(it.name), estimateLabelWidth(it.sub));
      const x = clampLabelX(it.x, w, canvasW);
      const left = x - w / 2;
      const right = x + w / 2;
      const lane = frontier[side];
      let tier = -1;
      for (let t = 0; t < METRO_LAYOUT.maxLabelTiers; t++) {
        if (lane[t] === undefined || left >= lane[t]! + METRO_LAYOUT.labelGapX) {
          tier = t;
          break;
        }
      }
      const overflow = tier === -1;
      if (overflow) {
        // 层数封顶仍摆不下：挑当前最靠左的那一层放，并把「挤了」记下来（不删标签、不假装不挤）。
        let best = 0;
        for (let t = 1; t < METRO_LAYOUT.maxLabelTiers; t++) if ((lane[t] ?? -Infinity) < (lane[best] ?? -Infinity)) best = t;
        tier = best;
      }
      lane[tier] = Math.max(lane[tier] ?? -Infinity, right);
      const boxTop =
        side === "above"
          ? it.y - it.half - METRO_LAYOUT.labelBase - tier * METRO_LAYOUT.labelTierGap - METRO_LAYOUT.labelBoxH
          : it.y + it.half + METRO_LAYOUT.labelBase + tier * METRO_LAYOUT.labelTierGap;
      out.set(it.key, {
        side,
        tier,
        x,
        nameY: boxTop + METRO_LAYOUT.labelFontPx,
        subY: boxTop + METRO_LAYOUT.labelFontPx + METRO_LAYOUT.labelLineH,
        box: { x: left, y: boxTop, w, h: METRO_LAYOUT.labelBoxH },
        overflow,
      });
    });
  }
  return out;
}

/**
 * 把引擎载荷翻成**横向**线路图。**纯函数**（无 `Date.now`、无随机）——同载荷同输出，R6。
 *
 * 几何：主线一条横线，**起点在左、终点在右**，站位过多时折行（行内仍是左→右，折行处画转折标记）；
 * 物料支线在下方**平行**走一条横线，经 AND 闸门汇入主线；闭环由右端一条**回流箭头**表达。
 */
export function buildChainLineMap(payload: ChainLossPayload, opts: ChainLineMapOptions = {}): ChainLineMap {
  const pctByStep = new Map<string, LossAttribution>();
  for (const row of payload.attribution) pctByStep.set(row.stepId, row);

  const trunkSlots = orderedSlots(payload, TRUNK_STAGES);
  const branchSlots = orderedSlots(payload, [BRANCH_STAGE]);

  const family = opts.family ?? null;
  const ringIndex = family?.ringIndex ?? 0;

  const trunkPlan = metroRowPlan(trunkSlots.length);
  const branchPlan = metroRowPlan(Math.max(1, branchSlots.length));
  const width = Math.max(metroCanvasWidth(trunkPlan.perRow), metroCanvasWidth(branchPlan.perRow));

  /** 一条族线整块占多高（主线各行 + 支线 + 回流走线沟）——多族并行时按这个高度整块下移。 */
  const blockH =
    (trunkPlan.rowCount - 1) * METRO_LAYOUT.rowGap +
    METRO_LAYOUT.branchGap +
    (branchPlan.rowCount - 1) * METRO_LAYOUT.rowGap +
    METRO_LAYOUT.familyGap;
  const bandY0 = METRO_LAYOUT.padTop + ringIndex * blockH;
  const trunkY0 = bandY0;
  const branchY0 = trunkY0 + (trunkPlan.rowCount - 1) * METRO_LAYOUT.rowGap + METRO_LAYOUT.branchGap;
  const branchBottomY = branchY0 + (branchPlan.rowCount - 1) * METRO_LAYOUT.rowGap;
  /** 回流箭头的底部走线沟：让过支线下方那一整条标签带，再留半个走线沟。 */
  const closureY = branchBottomY + metroLabelBandPx() + METRO_LAYOUT.gutterH / 2;

  const stations: StationVM[] = [];
  const suspended: SuspendedVM[] = [];
  const segments: SegmentVM[] = [];
  const folds: FoldVM[] = [];
  /** 每条线上「上一站的 id + 坐标 + 行号」，用于连区间与画返工逆行弧。 */
  const lineCursor = new Map<LineId, { id: string; x: number; y: number; row: number; suspendedEnd: boolean }>();

  const railL = METRO_LAYOUT.railInset;
  const railR = width - METRO_LAYOUT.railInset;

  /** 站位定位：主线与支线用**同一条**横向规则（两套规则就会长成两张图）。 */
  const locate = (lineId: LineId, index: number) =>
    metroSlotPoint(index, lineId === TRUNK_LINE_ID ? trunkPlan : branchPlan, lineId === TRUNK_LINE_ID ? trunkY0 : branchY0);

  const place = (slots: Slot[], lineId: LineId): void => {
    slots.forEach((slot, index) => {
      const { x, y, row, col } = locate(lineId, index);
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
          row,
          col,
          angle: 0,
          ringIndex,
          labelled: false,
          labelPos: null,
        });
      } else {
        const { row: emptyRow } = slot;
        suspended.push({
          stepId: emptyRow.stepId,
          nodeId: emptyRow.nodeId,
          label: emptyRow.label,
          stage: emptyRow.stage,
          kind: emptyRow.kind,
          emptyKind: emptyRow.emptyKind,
          reason: emptyRow.reason,
          probe: emptyRow.probe ?? null,
          lineId,
          index,
          x,
          y,
          row,
          col,
          angle: 0,
          ringIndex,
          labelled: true,
          labelPos: null,
        });
      }
      const prev = lineCursor.get(lineId);
      if (prev !== undefined) {
        const isSuspended = slot.kind === "suspended" || prev.suspendedEnd;
        const fold = prev.row !== row;
        // 行内 = 一条水平直线；跨行 = 贴边绕到下一行左端（转折标记另画，见 `folds`）。
        const gutterY = (prev.y + y) / 2;
        const path = fold
          ? orthoRoundedPath([
              { x: prev.x, y: prev.y },
              { x: railR, y: prev.y },
              { x: railR, y: gutterY },
              { x: railL, y: gutterY },
              { x: railL, y },
              { x, y },
            ])
          : `M ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} L ${x.toFixed(2)} ${y.toFixed(2)}`;
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
          path,
          fold,
        });
        if (fold) folds.push({ foldId: `${lineId}:fold-${prev.row}-${row}`, lineId, fromRow: prev.row, toRow: row, x: width / 2, y: gutterY });
      }
      lineCursor.set(lineId, { id, x, y, row, suspendedEnd: slot.kind === "suspended" });
    });
  };

  place(trunkSlots, TRUNK_LINE_ID);
  place(branchSlots, BRANCH_LINE_ID);

  // ── 标签摆位：站与停运站位**一起**排（分开排必然互相压字，那正是环形版的老毛病）──
  const labelledIds = pickLabelledStepIds(stations);
  for (const s of stations) s.labelled = labelledIds.has(s.stepId);
  const labelInputs: LabelInput[] = [
    ...stations
      .filter((s) => s.labelled)
      .map((s) => ({
        key: s.stepId,
        x: s.x,
        y: s.y,
        half: s.r,
        // 支线与主线各自成行，行号加偏置避免两条线的标签被当成同一行排（它们 y 差得远）。
        row: s.lineId === TRUNK_LINE_ID ? s.row : trunkPlan.rowCount + s.row,
        name: s.label,
        sub: s.valueAdd ? VALUE_ADD_TAG : formatPct(s.pctOfChainLoss),
      })),
    ...suspended.map((s) => ({
      key: s.stepId,
      x: s.x,
      y: s.y,
      half: SUSPENDED_HALF,
      row: s.lineId === TRUNK_LINE_ID ? s.row : trunkPlan.rowCount + s.row,
      name: s.label,
      sub: SUSPENDED_TAG,
    })),
  ];
  const placements = placeLabels(labelInputs, width);
  for (const s of stations) s.labelPos = s.labelled ? (placements.get(s.stepId) ?? null) : null;
  for (const s of suspended) s.labelPos = placements.get(s.stepId) ?? null;

  // ── 闭环段：链尾 → 链头（现金周转循环）。**结构推定**，图元与实边分开 ──────────
  // 环形版把它画成"圆的最后一段弧"，横向版把它单列成右端一条**贴边绕回起点的回流箭头** ——
  // 语义一字不改（仍是 state:"closure" + closureBasis 原文），只是不再拿它绑架整张图的形状。
  let closureBasis: string | null = null;
  let closureReturn: ClosureReturnVM | null = null;
  const trunkStations = [...stations, ...suspended].filter((s) => s.lineId === TRUNK_LINE_ID).sort((a, b) => a.index - b.index);
  const head = trunkStations[0];
  const tail = trunkStations.at(-1);
  if (head !== undefined && tail !== undefined && head !== tail) {
    const outerR = width - METRO_LAYOUT.closureRailInset;
    const outerL = METRO_LAYOUT.closureRailInset;
    const path = orthoRoundedPath([
      { x: tail.x, y: tail.y },
      { x: outerR, y: tail.y },
      { x: outerR, y: closureY },
      { x: outerL, y: closureY },
      { x: outerL, y: head.y },
      { x: head.x, y: head.y },
    ]);
    segments.push({
      segmentId: `${TRUNK_LINE_ID}:closure`,
      lineId: TRUNK_LINE_ID,
      fromId: tail.stepId,
      toId: head.stepId,
      x1: tail.x,
      y1: tail.y,
      x2: head.x,
      y2: head.y,
      state: "closure",
      path,
    });
    closureReturn = { fromStepId: tail.stepId, toStepId: head.stepId, path, labelX: width / 2, labelY: closureY - 9 };
    closureBasis =
      `闭环段「${tail.label} → ${head.label}」是**结构推定**，不是引擎给的边：` +
      `引擎 chain_loss_attribution 返回的是一条**有序链**（nodes[] 按 stage 顺序），载荷里没有任何字段说"链尾回指链头"。` +
      `画成闭环的依据是现金周转循环（回款释放的资金再投入下一轮需求承接），` +
      `故本段画成一条**独立的回流箭头**（虚线 + 箭头，贴着画布外沿绕回起点），与实测区间分开；` +
      `读图时不要把它当成一条被测量过的边，也不要因为它就把整条链读成一个圆。`;
  }

  // ── 红弧 = 返工逆行：向本线上一站回指（横向下走**线下方的下凸弧**，箭头指回上一站）────
  const reworkArcs: ReworkArcVM[] = [];
  for (const st of stations) {
    if (st.kind !== "rework") continue;
    const prev = stations.filter((s) => s.lineId === st.lineId && s.index < st.index).at(-1);
    if (prev === undefined) continue; // 本线第一站就是返工 → 无处可退，不编一条弧出来
    const cx = (st.x + prev.x) / 2;
    const cy = Math.max(st.y, prev.y) + METRO_LAYOUT.rowGap * 0.22;
    reworkArcs.push({
      arcId: `rework:${st.stepId}`,
      fromStepId: st.stepId,
      toStepId: prev.stepId,
      path: `M ${st.x.toFixed(2)} ${st.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${prev.x.toFixed(2)} ${prev.y.toFixed(2)}`,
    });
  }

  // ── 合流站（齐套 AND）：支线存在 且 主线有生产段 ⇒ 在生产段第一站合流 ──────────
  const branchTail = [...stations, ...suspended]
    .filter((s) => s.lineId === BRANCH_LINE_ID)
    .sort((a, b) => a.index - b.index)
    .at(-1);
  const joinTarget = stations.find((s) => s.lineId === TRUNK_LINE_ID && s.stage === JOIN_TARGET_STAGE) ?? null;
  let andJoin: AndJoinVM | null = null;
  if (branchTail !== undefined && joinTarget !== null) {
    // 母线：支线出口 → 上抬到走线沟 → 横走到汇入站的**列间**（不压站圈）→ 竖直抬进主线。
    const corridorY = (branchY0 + trunkY0 + (trunkPlan.rowCount - 1) * METRO_LAYOUT.rowGap) / 2;
    const riserX = joinTarget.x - METRO_LAYOUT.gapX * 0.5;
    const busPath = orthoRoundedPath([
      { x: branchTail.x, y: branchTail.y },
      { x: branchTail.x, y: corridorY },
      { x: riserX, y: corridorY },
      { x: riserX, y: joinTarget.y },
      { x: joinTarget.x, y: joinTarget.y },
    ]);
    andJoin = {
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
      busPath,
      // 闸门落在母线**横走段**的正中 —— 那一段正好在两条标签带之间的走线沟里，
      // 不会压到任何站名；落在抬升段上则会撞进主线上方那条标签带（实测 y=286 恰好压中 tier-1）。
      gateX: (branchTail.x + riserX) / 2,
      gateY: corridorY,
    };
  }

  // ── 守恒（复用契约里的唯一实现，前端不自己再算一遍分母）─────────────────────
  const residual = payload.conservation?.residual ?? lossConservationResidual(payload.attribution);
  const sumPct =
    payload.conservation?.sumPct ??
    (payload.attribution.length === 0 ? null : payload.attribution.reduce((s, r) => s + r.pctOfChainLoss, 0));
  const tolerancePct = payload.conservation?.tolerancePct ?? LOSS_CONSERVATION_TOLERANCE_PCT;

  const pcts = stations.map((s) => s.pctOfChainLoss).filter((p): p is number => p !== null);

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

  // 横向几何自证：相邻站位间距必须容得下两个最大站圈，否则站会叠在一起。
  if (trunkSlots.length > 1 && METRO_LAYOUT.gapX < STATION_RADIUS.max * 2) {
    notes.push(
      `站位间距 ${METRO_LAYOUT.gapX}px < 两倍最大站圈 ${STATION_RADIUS.max * 2}px ⇒ 最大的几个站圈会相切/重叠。` +
        `站数由引擎决定，本层不删站、不缩圈冒充不挤。`,
    );
  }
  // 折行是**如实告知**的事：站位多到一行摆不下时说清楚，别让人以为线断了。
  if (trunkPlan.rowCount > 1) {
    notes.push(
      `主线 ${trunkSlots.length} 个站位，一行最多摆 ${METRO_LAYOUT.maxSlotsPerRow} 个 ⇒ 折成 ${trunkPlan.rowCount} 行` +
        `（每行 ≤ ${trunkPlan.perRow} 个）。折行处画转折标记「↩ 接下一行左端」，**这条线没有断**。`,
    );
  }
  // 标签摆位是可算的，摆不下也要说 —— 静默让两个标签压在一起就是环形版的老毛病复发。
  const overflowCount = [...stations, ...suspended].filter((s) => s.labelPos?.overflow === true).length;
  if (overflowCount > 0) {
    notes.push(
      `本次有 ${overflowCount} 个站名在上下交替 + ${METRO_LAYOUT.maxLabelTiers} 层分层之后仍摆不开 ⇒ ` +
        `这几个标签会与同侧邻居靠得很近。**标签一个没删**，挤是真的挤，此处照实说。`,
    );
  }

  return {
    lines: [
      {
        lineId: TRUNK_LINE_ID,
        label: "主线 · 需求 → 订单 → 产能 → 交付（右端回流箭头 = 闭环回需求）",
        stages: TRUNK_STAGES,
        y: trunkY0,
        slotCount: trunkSlots.length,
        plan: trunkPlan,
        labelX: METRO_LAYOUT.closureRailInset + 12,
        labelY: trunkY0 - METRO_LAYOUT.padTop * 0.52,
      },
      {
        lineId: BRANCH_LINE_ID,
        label: `支线 · ${STAGE_LABEL[BRANCH_STAGE]}（下方平行线，经齐套 AND 闸门汇入主线）`,
        stages: [BRANCH_STAGE],
        y: branchY0,
        slotCount: branchSlots.length,
        plan: branchPlan,
        labelX: METRO_LAYOUT.closureRailInset + 12,
        labelY: branchY0 - METRO_LAYOUT.branchGap * 0.5,
      },
    ],
    stations,
    suspended,
    segments,
    reworkArcs,
    andJoin,
    folds,
    closureReturn,
    family,
    closureBasis,
    bounds: { width, height: Math.max(METRO_LAYOUT.height, closureY + METRO_LAYOUT.padBottom * 0.6) },
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
