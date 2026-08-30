/**
 * ══ WO-SIM-UNIFIED-SHELL · 统一推演控制台的**纯派生层** ═══════════════════════════
 *
 * 零 JSX · 零颜色 · 零副作用 · 零时钟 —— 与 `views/sim/inspectorModel.ts` 同一条纪律：
 * 换算/派生一律在纯函数层，组件只排版。同入参逐字节同出参（R6）。
 *
 * ── 为什么**没有**复用 `inspectorModel.ts`（2026-08-26 的复用裁决，写在这里备查）──────
 * `inspectorModel.ts`（1184 行）派生的主体是 **`ChainNode`** —— 一个价值流节点，
 * 由五种 `ChainStepKind`（排队/等节拍/作业/返工/交接）组成，产出**前置期 / 增值天数 /
 * 流动效率 / 五段瀑布桶**。它的 `InspectorInput` 把 `node: ChainNode` 列为**必填**。
 * 本单检视的主体是**状态变量格**（`objectId × stateVar`）—— 它没有段、没有天数、没有增值/非增值之分，
 * 要答的是「变了多少 / 凭什么 / 谁推的 / 推坏谁」。
 * 两者**主体不同、量纲不同、问题不同**：要复用就得给每个状态变量编一个 `ChainNode` 和五个段，
 * 而那正是本仓反复禁止的「为了对上形状而编一个数」。故本层另写，但**继承它的三条纪律**：
 *   ① 诚实缺席带 `reason`，不补 0；② 出处三态互斥、不合并；③ 算术不进 JSX。
 * （可复用的那一部分**真的复用了**：状态变量名走 `views/sim/stateVarLabel.ts` 这条唯一消费路径，
 *  本文件一个中文业务名都不内联。）
 *
 * ── 层级为什么**不在这里算**（本单最重要的一条订正）──────────────────────────────
 * 派单原文要求「前端按 `propagation-rules` 的入度/出度现算层级」。**照做就是第二套真相源**：
 * 后端 `apps/datacore/src/sim/drill-scan.ts:290 layerOfStateVars` 已经是全平台唯一实现，
 * 并经 `GET /a/v1/sim/drill/state-var-layers`（`app.ts:2901`）下发；
 * 前端 `views/sim/DrillPanel.tsx:125` 白纸黑字写着「前端再算一份，度数口径一漂两边就各说各话」。
 * 故本层**消费**后端算好的层级，前端零度数计算。
 * 「层级不是手工登记的」这条性质仍然被门咬死 —— 判据是**改边集 ⇒ 屏上层级跟着变**，
 * 而不是「前端有没有一段求度数的代码」。
 */
import type { PropagationRule, SimMetricSeriesItem, SimMetricSeriesResponse } from "@platform/contracts";
import { daysForTicks } from "@platform/contracts";
import { stateVarLabel, type StateVarLabel } from "../stateVarLabel";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 出处三态（诚实位）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一个读数的出处。**三态互斥，不许合并**（派单 §2 的那张表）：
 *  · `MEASURED`  真从世界态里读到的数；
 *  · `PROJECTED` 推演投影 / 结构派生的占位 —— **长得和真值一模一样**，不标就会被当实测；
 *  · `EMPTY`     算不出来（诚实缺席·**不补 0、不兜底编一个**）。
 *
 * ⚠ 为什么**不复用** `inspectorModel.ts` 的 `PROVENANCES`：那一套的 `PLACEHOLDER`
 * 屏上写作「占位·未接真值」，而本单的占位**恰恰是接了真值的**（后端真回了数，
 * 只是那个数是 `round(hash01(objectId|stateVar)×100)` 结构派生出来的）。
 * 套用那个标签会在屏上说一句假话 —— 出处标注写错比没有更危险。
 */
export type CellProvenance = "MEASURED" | "PROJECTED" | "EMPTY";

/** 三态的屏上措辞。**跟着数字走**（派单 §2：不许只写在页脚）。 */
export const CELL_PROVENANCE_LABEL: Readonly<Record<CellProvenance, string>> = {
  MEASURED: "实测",
  PROJECTED: "推演投影·非实测",
  EMPTY: "算不出来",
};

/**
 * `SimSession.scope.baseSnapshotOrigin` 的前端读法。
 *
 * ⚠ 契约里 `scope` 是 `z.record(z.string(), z.unknown())` 的松口袋（`sim.ts:150`），
 * 故这里**逐字段防御性读**，读不出来一律 `null` ——「没有这个记号」与「记号说是派生的」
 * 是两个不同的命题，不许把前者静默当成后者（反过来更不许）。
 *
 * 真值源：`apps/datacore/src/sim/seed-world.ts:190 SeedWorldSnapshotOrigin`。
 * `note` 是后端特意准备的「一句人话的出处说明（供任何消费方直接展示，不必各自编）」——
 * 本层**原样承接**，不在前端另写一句措辞。
 */
export interface SnapshotOrigin {
  readonly kind: string;
  readonly formula: string | null;
  readonly note: string | null;
  readonly cells: number | null;
  readonly measuredCells: number | null;
  readonly derivedCells: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 从会话 `scope` 里把出处记号读出来。取不到 ⇒ `null`（**不造一个"实测"出来**）。 */
export function readSnapshotOrigin(scope: unknown): SnapshotOrigin | null {
  if (typeof scope !== "object" || scope === null) return null;
  const raw = (scope as Record<string, unknown>).baseSnapshotOrigin;
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const kind = str(o.kind);
  if (kind === null) return null;
  return {
    kind,
    formula: str(o.formula),
    note: str(o.note),
    cells: num(o.cells),
    measuredCells: num(o.measuredCells),
    derivedCells: num(o.derivedCells),
  };
}

/**
 * 整份世界态的出处 ⇒ 单格读数的默认出处。
 *
 * `kind !== "MEASURED"`（今天恒为 `"DERIVED"`）⇒ 这一格是**结构派生的占位**。
 * 记号缺席 ⇒ 仍判 `PROJECTED` 而**不是** `MEASURED`：不知道出处时把它说成实测，
 * 正是派单 §2 要堵的那件事（「用户会把占位当实测」）。
 */
export function provenanceOfOrigin(origin: SnapshotOrigin | null): CellProvenance {
  return origin !== null && origin.kind === "MEASURED" ? "MEASURED" : "PROJECTED";
}

/** 出处标注的屏上全文：三态措辞 + 后端那句人话（有就带上，没有就只有措辞）。 */
export function calibreTextOf(p: CellProvenance, origin: SnapshotOrigin | null, absenceReason: string | null): string {
  if (p === "EMPTY") return `${CELL_PROVENANCE_LABEL.EMPTY}：${absenceReason ?? "缺席原因未下发"}`;
  const note = origin?.note ?? origin?.formula ?? null;
  return note === null ? CELL_PROVENANCE_LABEL[p] : `${CELL_PROVENANCE_LABEL[p]}（${note}）`;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 「被推动」的阈值
// ══════════════════════════════════════════════════════════════════════════════

export interface MovedThreshold {
  /** 判「被推动」的 |Δ| 下限。 */
  readonly value: number;
  /** 这个数**凭什么是这个数** —— 屏上要读得到（口径不许只活在代码注释里）。 */
  readonly basis: string;
}

/**
 * 阈值口径。**刻意不是业务常数**（不是「涨 5% 才算被推动」那种）。
 *
 * ── 为什么默认口径是「浮点噪声底」而不是某个百分比（2026-08-26 裁决）───────────────
 * 复验：`apps/frontend-shell/test/sim-unified-shell.seam.test.tsx` 的「只铺变化」臂 ——
 * 变异「未变化的卡直接删掉」当场红，证明该口径真被咬住，不是注释里的说法。
 * 「被推动」这件事的**原始事实**是：引擎在这一格上算出了与基线不同的数。
 * 任何 `|Δ| ≥ 5%` 之类的门槛都在替用户做一个**业务判断**（「小于 5% 不值得看」），
 * 而这个判断的正确值随指标、随行业、随场景变 —— 写死一个就是凭空造一条业务口径（破 R13/R14），
 * 而且屏上没有任何东西能解释它凭什么是 5。
 * 故默认只滤掉 **IEEE-754 的加减法残渣**（`0.1+0.2-0.3` 那一类）：
 * 相对 epsilon `1e-9 × max(1, |baseline|, |actual|)` —— 它度量的是**数值噪声**，不是业务显著性。
 *
 * ── 留了一个 config 口子，但默认不开 ────────────────────────────────────────────
 * 调用方确实想按业务口径收窄时传 `absolute`（绝对下限）或 `quantile`（按本屏 |Δ| 分布现算的分位）。
 * 两者都会**改写 `basis` 文案**，于是屏上永远说得出这一屏用的是哪一条口径 ——
 * 「换了口径而屏上不说」才是真正要防的那件事。
 */
export interface MetricWallConfig {
  /** 绝对下限（业务口径，调用方显式给才生效）。 */
  readonly absolute?: number;
  /** 按本屏 |Δ| 分布现算的分位（0–1）。与 `absolute` 同时给 ⇒ 取两者较大者。 */
  readonly quantile?: number;
}

/** 浮点噪声底：只滤加减法残渣，不含任何业务含义。 */
export function noiseFloor(baseline: number, actual: number): number {
  return 1e-9 * Math.max(1, Math.abs(baseline), Math.abs(actual));
}

/**
 * 现算本屏阈值。`absDeltas` = 本屏全部**算得出来**的 |Δ|（`null` 格不进来 —— 缺席不是 0）。
 */
export function movedThresholdOf(absDeltas: readonly number[], config?: MetricWallConfig): MovedThreshold {
  const parts: string[] = ["浮点噪声底 1e-9×max(1,|基线|,|当前|)"];
  let value = 0;
  if (typeof config?.absolute === "number" && Number.isFinite(config.absolute) && config.absolute > 0) {
    value = Math.max(value, config.absolute);
    parts.push(`调用方给的绝对下限 ${config.absolute}`);
  }
  const q = config?.quantile;
  if (typeof q === "number" && Number.isFinite(q) && q > 0 && q < 1 && absDeltas.length > 0) {
    const sorted = [...absDeltas].sort((a, b) => a - b);
    // 分位用**最近秩**（不插值）：插值会造出一个数据里不存在的数当门槛，屏上就解释不清了。
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    value = Math.max(value, sorted[idx] ?? 0);
    parts.push(`本屏 |Δ| 的 ${Math.round(q * 100)} 分位（最近秩，${sorted.length} 个样本）`);
  }
  return { value, basis: parts.join(" · ") };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 层级（后端现算，前端只承接）
// ══════════════════════════════════════════════════════════════════════════════

/** `GET /a/v1/sim/drill/state-var-layers` 的一行。`layer` 是**后端的词**，前端不翻译。 */
export interface StateVarLayerRow {
  readonly stateVar: string;
  readonly layer: string;
  readonly label: string;
}

/**
 * 层级分组的**排序**用这张表（只管顺序，**不管屏上显示什么字**）。
 *
 * 屏上那几个字一律取回包里的 `layer` 原文 ⇒ 后端改词、屏上跟着改，前端零翻译表。
 * 这里的常量只回答「哪一层排前面」这一个问题：源头在上、结果在下，读起来才是一条链。
 * 不在表里的层名**不丢**（排到末尾，按字典序）—— 后端将来加一层，屏上立刻看得见。
 */
const LAYER_RANK: Readonly<Record<string, number>> = { 根源: 0, 枢纽: 1, 末端: 2 };

/**
 * 层级取不到时的兜底桶键。
 *
 * ⚠ 这**不是**「末端」：后端 `layerOfStateVars` 对入度出度皆 0 的变量**刻意不下发层级**
 * （drill-scan.ts:296「`null` = 这个变量不在传导图里，与它是末端是两个不同的命题」）。
 * 把它并进「末端」就是把两个命题合并成一个 —— 本仓反复记账的那个病。
 */
export const UNLAYERED = "未在传导图中";

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 指标卡
// ══════════════════════════════════════════════════════════════════════════════

export interface CardSeries {
  readonly ticks: readonly number[];
  readonly baseline: readonly (number | null)[];
  readonly actual: readonly (number | null)[];
}

export interface MetricCard {
  readonly stateVar: string;
  /** 屏上标签（后端下发的业务名，或**回落的裸键本身**）。 */
  readonly label: StateVarLabel;
  /** 层级：后端下发的原文，或 `UNLAYERED`。 */
  readonly layer: string;
  /** 层级是不是真下发了（`false` ⇒ 屏上落 `UNLAYERED` 桶，不冒充末端）。 */
  readonly layerKnown: boolean;
  /** 单位。今天全平台恒 `null`（契约 `SimMetricSeriesItem.unit` 记过这笔账）⇒ 屏上不带单位，别自己补。 */
  readonly unit: string | null;
  /** 这个变量下一共有几格（对象 × 变量）。 */
  readonly cellCount: number;
  /** 代表格来自哪个对象（`null` = 这个变量在本会话里一格都没有）。 */
  readonly objectId: string | null;
  readonly baseline: number | null;
  readonly current: number | null;
  readonly delta: number | null;
  readonly absDelta: number | null;
  /** `|Δ| ≥ 阈值`。**算不出来的格恒 `false`**（缺席不是"没被推动"，见 `absenceReason`）。 */
  readonly moved: boolean;
  readonly provenance: CellProvenance;
  /** 出处标注全文 —— 组件把它挂在数字**同屏**处。 */
  readonly calibre: string;
  /** `provenance === "EMPTY"` 时**必有**：为什么算不出来（具体到缺什么，不是"暂无数据"）。 */
  readonly absenceReason: string | null;
  /** 最早越线：第一格 `|actual−baseline| ≥ 阈值` 的 tick / 天。 */
  readonly firstCrossTick: number | null;
  readonly firstCrossDays: number | null;
  /** 越线日算不出来的原因（`null` = 真的算出来了）。 */
  readonly crossReason: string | null;
  readonly series: CardSeries | null;
}

/** 代表格的挑法：**|Δ| 最大的那一格**。 */
function pickRepresentative(rows: readonly SimMetricSeriesItem[]): SimMetricSeriesItem | null {
  let best: SimMetricSeriesItem | null = null;
  let bestAbs = -1;
  for (const r of rows) {
    const d = lastDelta(r);
    const a = d === null ? -1 : Math.abs(d);
    // 平手取 key 小的那条 ⇒ 全序、可复现（R6）。
    if (best === null || a > bestAbs || (a === bestAbs && r.key < best.key)) {
      best = r;
      bestAbs = a;
    }
  }
  return best;
}

/** 末格（= 当前）的两条线。缺格 = `null`（**不插值、不向前填充**）。 */
function lastPair(r: SimMetricSeriesItem): { baseline: number | null; actual: number | null } {
  const at = (arr: readonly (number | null)[]): number | null =>
    arr.length === 0 ? null : (arr[arr.length - 1] ?? null);
  return { baseline: at(r.baseline), actual: at(r.actual) };
}

function lastDelta(r: SimMetricSeriesItem): number | null {
  const { baseline, actual } = lastPair(r);
  return baseline === null || actual === null ? null : actual - baseline;
}

/**
 * 最早越线格。两条线**任一缺格就跳过那一格**（不插值）——
 * 返回 `{ tick: null, reason }` 时 `reason` 说清是「没越过」还是「没得比」，两者不合并。
 */
function firstCrossOf(
  r: SimMetricSeriesItem,
  ticks: readonly number[],
  threshold: number,
): { tick: number | null; reason: string | null } {
  let comparable = 0;
  for (let i = 0; i < ticks.length; i += 1) {
    const b = r.baseline[i] ?? null;
    const a = r.actual[i] ?? null;
    const t = ticks[i];
    if (b === null || a === null || t === undefined) continue;
    comparable += 1;
    const gap = Math.abs(a - b);
    if (gap >= Math.max(threshold, noiseFloor(b, a))) return { tick: t, reason: null };
  }
  if (comparable === 0) return { tick: null, reason: "两条线在本窗口内没有一格可比（基线或推演值缺格）" };
  return { tick: null, reason: `本窗口 ${comparable} 格可比，没有一格越过阈值` };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 卡墙
// ══════════════════════════════════════════════════════════════════════════════

export interface WallGroup {
  readonly layer: string;
  /** 被推动的（上第一层）。按 |Δ| 降序、key 升序 tiebreak ⇒ 全序可复现。 */
  readonly moved: readonly MetricCard[];
  /**
   * 未被推动的（收进「未变化 N 项 ▾」展开块）。
   * ⚠ **不许删掉** —— 用户看不到「什么没被影响」也是信息损失（派单 §3.1 第 3 臂咬这条）。
   */
  readonly unmoved: readonly MetricCard[];
}

export interface MetricWall {
  readonly groups: readonly WallGroup[];
  readonly cards: readonly MetricCard[];
  readonly threshold: MovedThreshold;
  readonly origin: SnapshotOrigin | null;
  /** 指标时序这一跳有没有回来。`false` ⇒ 全部卡片落 `EMPTY` 并带缺席原因。 */
  readonly seriesAvailable: boolean;
  readonly seriesAbsenceReason: string | null;
  /** 一格 tick 等于几天（回包自带口径；缺省 1）。 */
  readonly tickDays: number;
  readonly totalCards: number;
  readonly movedCards: number;
  /** 诚实位：`metrics.length < totalMetrics` ⇒ 后端截断了，屏上要说。 */
  readonly truncated: boolean;
}

export interface MetricWallInput {
  /** 卡片的**名字与个数**的唯一来源：`GET /a/v1/sim/view-config` 的 `stateVars`。 */
  readonly stateVars: readonly string[];
  /** 后端单源的状态变量业务名字典（同一端点下发）。 */
  readonly stateVarNames?: Readonly<Record<string, string>>;
  /** `GET /a/v1/sim/drill/state-var-layers` 的 `layers`。`null` = 这一跳没回来。 */
  readonly layers: readonly StateVarLayerRow[] | null;
  /** `GET /a/v1/sim/sessions/:id/metric-series` 回包。`null` = 没会话 / 这一跳失败。 */
  readonly series: SimMetricSeriesResponse | null;
  /** 没有 series 时的**具体**原因（会话态五分法的措辞由调用方给，本层不猜）。 */
  readonly seriesAbsenceReason?: string | null;
  /** `SimSession.scope.baseSnapshotOrigin`。 */
  readonly origin: SnapshotOrigin | null;
  readonly config?: MetricWallConfig;
}

/** 卡墙的全部派生。**纯函数**：同入参逐字节同出参。 */
export function buildMetricWall(input: MetricWallInput): MetricWall {
  const { stateVars, stateVarNames, layers, series, origin, config } = input;

  const layerOf = new Map<string, string>();
  for (const row of layers ?? []) layerOf.set(row.stateVar, row.layer);

  const rowsByVar = new Map<string, SimMetricSeriesItem[]>();
  for (const m of series?.metrics ?? []) {
    const list = rowsByVar.get(m.stateVar);
    if (list === undefined) rowsByVar.set(m.stateVar, [m]);
    else list.push(m);
  }

  const ticks = series?.ticks ?? [];
  const tickDays = series?.tickDays ?? 1;
  const seriesAvailable = series !== null;
  const seriesAbsenceReason = seriesAvailable
    ? null
    : (input.seriesAbsenceReason ?? "指标时序这一跳没有回来（没有会话，或该请求失败）");

  // 阈值先算：它要吃本屏全部**算得出来**的 |Δ|。
  const absDeltas: number[] = [];
  for (const sv of stateVars) {
    const rep = pickRepresentative(rowsByVar.get(sv) ?? []);
    const d = rep === null ? null : lastDelta(rep);
    if (d !== null) absDeltas.push(Math.abs(d));
  }
  const threshold = movedThresholdOf(absDeltas, config);
  const baseProvenance = provenanceOfOrigin(origin);

  const cards: MetricCard[] = stateVars.map((sv) => {
    const rows = rowsByVar.get(sv) ?? [];
    const rep = pickRepresentative(rows);
    const layer = layerOf.get(sv);
    const label = stateVarLabel(sv, stateVarNames);

    if (rep === null) {
      const reason = seriesAvailable
        ? "本会话的指标时序里没有这个状态变量的格子（世界态未承载它）"
        : (seriesAbsenceReason as string);
      return {
        stateVar: sv,
        label,
        layer: layer ?? UNLAYERED,
        layerKnown: layer !== undefined,
        unit: null,
        cellCount: 0,
        objectId: null,
        baseline: null,
        current: null,
        delta: null,
        absDelta: null,
        moved: false,
        provenance: "EMPTY",
        calibre: calibreTextOf("EMPTY", origin, reason),
        absenceReason: reason,
        firstCrossTick: null,
        firstCrossDays: null,
        crossReason: reason,
        series: null,
      } satisfies MetricCard;
    }

    const { baseline, actual } = lastPair(rep);
    const delta = baseline === null || actual === null ? null : actual - baseline;
    const empty = delta === null;
    const absenceReason = empty
      ? "基线或推演值在当前这一格缺席（`null` = 这个世界里没有这一格，不是 0）"
      : null;
    const provenance: CellProvenance = empty ? "EMPTY" : baseProvenance;
    const cross = firstCrossOf(rep, ticks, threshold.value);

    return {
      stateVar: sv,
      label,
      layer: layer ?? UNLAYERED,
      layerKnown: layer !== undefined,
      unit: rep.unit,
      cellCount: rows.length,
      objectId: rep.objectId,
      baseline,
      current: actual,
      delta,
      absDelta: delta === null ? null : Math.abs(delta),
      moved:
        delta !== null &&
        baseline !== null &&
        actual !== null &&
        Math.abs(delta) >= Math.max(threshold.value, noiseFloor(baseline, actual)),
      provenance,
      calibre: calibreTextOf(provenance, origin, absenceReason),
      absenceReason,
      firstCrossTick: cross.tick,
      firstCrossDays: cross.tick === null ? null : daysForTicks(cross.tick, tickDays),
      crossReason: cross.reason,
      series: { ticks, baseline: rep.baseline, actual: rep.actual },
    } satisfies MetricCard;
  });

  const byMagnitude = (a: MetricCard, b: MetricCard): number => {
    const d = (b.absDelta ?? -1) - (a.absDelta ?? -1);
    return d !== 0 ? d : a.stateVar < b.stateVar ? -1 : a.stateVar > b.stateVar ? 1 : 0;
  };
  const byKey = (a: MetricCard, b: MetricCard): number =>
    a.stateVar < b.stateVar ? -1 : a.stateVar > b.stateVar ? 1 : 0;

  const seen = new Map<string, MetricCard[]>();
  for (const c of cards) {
    const list = seen.get(c.layer);
    if (list === undefined) seen.set(c.layer, [c]);
    else list.push(c);
  }
  const groups: WallGroup[] = [...seen.entries()]
    .sort(([a], [b]) => {
      const ra = LAYER_RANK[a] ?? Number.MAX_SAFE_INTEGER;
      const rb = LAYER_RANK[b] ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
    })
    .map(([layer, list]) => ({
      layer,
      moved: list.filter((c) => c.moved).sort(byMagnitude),
      unmoved: list.filter((c) => !c.moved).sort(byKey),
    }));

  return {
    groups,
    cards,
    threshold,
    origin,
    seriesAvailable,
    seriesAbsenceReason,
    tickDays,
    totalCards: cards.length,
    movedCards: cards.filter((c) => c.moved).length,
    truncated: series?.truncated ?? false,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · 右栏检视：谁推的 / 推坏谁 / 最严重的落点
// ══════════════════════════════════════════════════════════════════════════════

export interface EdgeRef {
  readonly ruleKey: string;
  /** 对侧状态变量（上游 = 谁推的；下游 = 推坏谁）。 */
  readonly peerStateVar: string;
  readonly peerLabel: StateVarLabel;
  readonly coefficient: number;
  readonly delayTicks: number;
  readonly delayDays: number;
  readonly sourceTypeKey: string;
  readonly targetTypeKey: string;
  /** 系数是不是引用了一条可编辑规则（`coefficientRef` 非空 ⇒ 屏上那个数不是最终值）。 */
  readonly coefficientIsRef: boolean;
}

export interface LandingRow {
  readonly stateVar: string;
  readonly label: StateVarLabel;
  readonly objectId: string;
  readonly delta: number;
  readonly absDelta: number;
  readonly hops: number;
}

export interface InspectorView {
  readonly card: MetricCard;
  readonly upstream: readonly EdgeRef[];
  readonly downstream: readonly EdgeRef[];
  /** 最严重的 N 个落点（按 |Δ| 降序）。 */
  readonly landings: readonly LandingRow[];
  /**
   * 🔴 **「没有落点」与「算不出来」是两个态**（派单 §2 末句）。
   *  · `"none"`      —— 真的一个落点都没有（下游算得出来，只是都没被推动）；
   *  · `"unknown"`   —— 算不出来（没有时序 / 下游格子缺席）；
   *  · `"ok"`        —— 有落点。
   */
  readonly landingsState: "ok" | "none" | "unknown";
  readonly landingsReason: string | null;
}

const edgeOf = (
  r: PropagationRule,
  peer: string,
  names: Readonly<Record<string, string>> | undefined,
  tickDays: number,
): EdgeRef => ({
  ruleKey: r.key,
  peerStateVar: peer,
  peerLabel: stateVarLabel(peer, names),
  coefficient: r.coefficient,
  delayTicks: r.delayTicks,
  delayDays: daysForTicks(r.delayTicks, tickDays),
  sourceTypeKey: r.sourceTypeKey,
  targetTypeKey: r.targetTypeKey,
  coefficientIsRef: r.coefficientRef !== null && r.coefficientRef !== undefined,
});

export interface InspectorInputArgs {
  readonly card: MetricCard;
  readonly wall: MetricWall;
  readonly rules: readonly PropagationRule[];
  readonly stateVarNames?: Readonly<Record<string, string>>;
  /** 最多列几个落点。 */
  readonly landingLimit?: number;
}

/**
 * 右栏检视的全部派生。**纯函数**。
 *
 * 「谁推的 / 推坏谁」直接读传导边目录（`GET /a/v1/sim/propagation-rules`）——
 * 边是**一跳**的事实，不外推、不做多跳闭包：多跳要的是引擎（`propagateTick`），
 * 在前端拿边集自己走闭包就是第二套传导算法。故 `hops` 恒 1，并如实标在行上。
 */
export function buildInspectorView(args: InspectorInputArgs): InspectorView {
  const { card, wall, rules, stateVarNames, landingLimit = 5 } = args;
  const sv = card.stateVar;
  const td = wall.tickDays;

  const upstream = rules
    .filter((r) => r.targetStateVar === sv)
    .map((r) => edgeOf(r, r.sourceStateVar, stateVarNames, td))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient) || (a.ruleKey < b.ruleKey ? -1 : 1));
  const downstream = rules
    .filter((r) => r.sourceStateVar === sv)
    .map((r) => edgeOf(r, r.targetStateVar, stateVarNames, td))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient) || (a.ruleKey < b.ruleKey ? -1 : 1));

  const byVar = new Map(wall.cards.map((c) => [c.stateVar, c] as const));
  const targets = [...new Set(downstream.map((e) => e.peerStateVar))];

  if (!wall.seriesAvailable) {
    return {
      card,
      upstream,
      downstream,
      landings: [],
      landingsState: "unknown",
      landingsReason: wall.seriesAbsenceReason,
    };
  }
  if (targets.length === 0) {
    return {
      card,
      upstream,
      downstream,
      landings: [],
      landingsState: "none",
      landingsReason: "这个变量在传导图里没有出边 —— 它不推任何人（这是结论，不是缺数据）",
    };
  }

  const rowsOut: LandingRow[] = [];
  let unknown = 0;
  for (const t of targets) {
    const c = byVar.get(t);
    if (c === undefined || c.delta === null || c.objectId === null) {
      unknown += 1;
      continue;
    }
    if (!c.moved) continue;
    rowsOut.push({
      stateVar: t,
      label: c.label,
      objectId: c.objectId,
      delta: c.delta,
      absDelta: Math.abs(c.delta),
      hops: 1,
    });
  }
  rowsOut.sort((a, b) => b.absDelta - a.absDelta || (a.stateVar < b.stateVar ? -1 : 1));

  if (rowsOut.length > 0) {
    return { card, upstream, downstream, landings: rowsOut.slice(0, landingLimit), landingsState: "ok", landingsReason: null };
  }
  if (unknown === targets.length) {
    return {
      card,
      upstream,
      downstream,
      landings: [],
      landingsState: "unknown",
      landingsReason: `下游 ${targets.length} 个变量在本会话里一格都算不出来 ⇒ 不知道有没有落点`,
    };
  }
  return {
    card,
    upstream,
    downstream,
    landings: [],
    landingsState: "none",
    landingsReason:
      unknown === 0
        ? `下游 ${targets.length} 个变量全部算得出来，且都没越过阈值 ⇒ 真的没有落点`
        : `下游 ${targets.length} 个变量里 ${targets.length - unknown} 个算得出来且都没越过阈值，另 ${unknown} 个算不出来`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 7 · 左栏收起后的摘要条
// ══════════════════════════════════════════════════════════════════════════════

export interface PerturbationBrief {
  readonly id: string;
  readonly label: string;
  readonly targetStateVar: string;
  readonly targetLabel: StateVarLabel;
  readonly magnitude: number;
  readonly mode: string;
}

export interface RailSummary {
  /** 已施加了什么（收起后这一行必须说得出来）。 */
  readonly applied: readonly PerturbationBrief[];
  readonly appliedText: string;
  /** 结果读数：被推动了几张 / 一共几张。 */
  readonly resultText: string;
}

/** 摘要条文案的**唯一**出处（组件不拼字符串）。 */
export function buildRailSummary(applied: readonly PerturbationBrief[], wall: MetricWall): RailSummary {
  const appliedText =
    applied.length === 0
      ? "尚未施加任何扰动"
      : applied.map((p) => `${p.targetLabel.text} ${p.magnitude > 0 ? "+" : ""}${p.magnitude}（${p.mode}）`).join("、");
  const resultText = wall.seriesAvailable
    ? `${wall.movedCards}/${wall.totalCards} 个状态变量被推动`
    : `结果读不出来：${wall.seriesAbsenceReason ?? "指标时序缺席"}`;
  return { applied, appliedText, resultText };
}
