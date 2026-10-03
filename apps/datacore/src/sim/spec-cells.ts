/**
 * WO-3ROOT-P2 · 规格格**运行期索引**（「归属」与「时效」两条关系的单一来源）。
 *
 * ── 病灶（实测定稿见 `docs/PRD-WO-3ROOT-P2-runtime-rederive.md` §一）──────────────────────
 * 世界态里「规格格」的基值是建会话时从对象库**一次性采样**的（`seed-world.ts` 那条
 * `o.props[v]`），此后运行期再也无人回读对象库；而对象库 props 在会话存活期内**确实会被改**
 * （采纳杠杆 `app.ts:692` / 模拟时钟 `simclock.ts:107` / 建模 `modeling.ts:554`）。
 * 于是「这份基值取自哪一版源、现在还等不等于源」**机器不可判**，会话数据模型里也无处可查。
 *
 * ── 本模块做两件事（都不补值边）────────────────────────────────────────────────
 * ① **归属**：这格归哪条规格所有、式子是什么 —— 由 ACTIVE `DerivationSpecRecord` 派生（**不是**登记表）。
 * ② **时效**：`baseValue` vs 今天从对象 props 重算的 `today(c)` 逐格比对（`round(...,6)`，
 *    与 `ontology.ts` 的 `runDerivations` 写回**同一算路、同一舍入口径**）。
 *
 * ── ⛔ 三条不许（违反即返工）────────────────────────────────────────────────────
 *  · ⛔ **不许变成第三份登记表**：本模块是**派生**（ACTIVE 规格 → 索引），不新增任何一份
 *    「(类型,变量) → 规格」的人工清单。`STATE_VAR_VALUE_REFS` 角色不变（specKey 绑定 + 出处章），
 *    本模块只给它加一条**对账**（见 `specRefDiffs`），差集非空沿用既有的「绑定断裂」抛错路径。
 *  · ⛔ **不许在 tick 核内读对象库**：索引在核**之外**装配后注入（`app.ts` 装配点）。
 *  · ⛔ **不许用容差**：`round(...,6)` 之后**逐位**比，不设 epsilon —— 用容差把差异压掉
 *    就是「把真过期一起压掉」（PRD §八 第 1 条）。
 *
 * ── ⚠ **索引为什么要吃 `universe`（世界量纲空间）**（实测，别照抄 PRD 的简化签名）──────────
 * demo 租户 ACTIVE 规格 **28** 条，而世界态规格格是 **25** 条 —— 差的三条
 * （`Order|value`、`FinishedGoodsInventory|qtyAvailable`、`InterBaseTransfer|etaDay`）
 * 的落点**根本不是推演世界的量纲**（不在任何已发布传导规则的 `(类型,量纲)` 里）。
 * 若索引只按规格库建，它会比 `STATE_VAR_VALUE_REFS` **多出 3 个键** ⇒ 那 3 格会被
 * 无中生有地锚定（**widening**，正是 C2 头注「坑 1」那个病的形态）。
 * ⇒ 索引 =「ACTIVE 规格」∩「世界量纲空间」，两侧都是既有单源，**不新增登记表**。
 * 实测（2026-10-03，活规则集 55 条）：这个交集与 `STATE_VAR_VALUE_REFS` **双向差集为空、25/25 逐键相等**。
 */
import type { PropagationRule, TickState } from "@platform/contracts";
import type { DerivationSpecRecord } from "../domain.js";
import { STATE_VAR_VALUE_REFS } from "../synthetic/battery.js";
import { evalArithmetic, translateSpecFormula } from "../ontology.js";
import { round } from "../prng.js";

/** 索引键：`类型|量纲`（与 `STATE_VAR_VALUE_REFS`、`seed-world.ts` 的 `measuredVarKeys` 同式）。 */
export function specCellKey(typeKey: string, stateVar: string): string {
  return `${typeKey}|${stateVar}`;
}

/** 一格规格格的归属与式子（全部来自 ACTIVE 规格本身，无第二处声明）。 */
export interface SpecCell {
  specKey: string;
  targetType: string;
  targetProp: string;
  formula: string;
}

export type SpecCellIndex = ReadonlyMap<string, SpecCell>;

/**
 * 世界态的量纲空间 = 已发布传导规则里出现过的 `(类型,量纲)` 全集。
 * 与 `seed-world.ts` 的 `varsByType` **同一口径**（那边从同一份规则集算），不另立一份。
 */
export function worldCellKeys(rules: readonly PropagationRule[]): Set<string> {
  const out = new Set<string>();
  for (const r of rules) {
    out.add(specCellKey(r.sourceTypeKey, r.sourceStateVar));
    out.add(specCellKey(r.targetTypeKey, r.targetStateVar));
  }
  return out;
}

/**
 * `ACTIVE 规格 ∩ 世界量纲空间` → 索引。**纯函数**（同输入同输出，R6）。
 * `universe` 缺省为 `undefined` ⇒ 不做空间过滤（调用方必须知道自己要哪一档；
 * 世界路一律传 `worldCellKeys(rules)`，理由见头注）。
 */
export function specCellIndex(
  specs: readonly DerivationSpecRecord[],
  universe?: ReadonlySet<string>,
): SpecCellIndex {
  const out = new Map<string, SpecCell>();
  // 规格按 specKey 排序后写入 ⇒ 同一集合两次装配得到**逐键相同**的 Map（R6：列表序全序）。
  const ordered = [...specs].sort((a, b) => a.specKey.localeCompare(b.specKey));
  for (const s of ordered) {
    if (s.status !== "ACTIVE") continue;
    const k = specCellKey(s.targetType, s.targetProp);
    if (universe !== undefined && !universe.has(k)) continue;
    out.set(k, { specKey: s.specKey, targetType: s.targetType, targetProp: s.targetProp, formula: s.formula });
  }
  return out;
}

/**
 * 读侧装配入口（仓里 `DerivationSpecRecord` 单源）。
 * ⚠ 只读 `ACTIVE`：**不是**「顺手把 RETIRED 也读进来」—— 规格退役 ⇒ 该格离开锚定集，
 * 这正是 D1 要的活体行为（E3）。
 */
export async function specCellIndexFor(
  repos: { derivationSpecs: { list(tenantId: string, pred: (s: DerivationSpecRecord) => boolean): Promise<DerivationSpecRecord[]> } },
  tenantId: string,
  universe?: ReadonlySet<string>,
): Promise<SpecCellIndex> {
  const active = await repos.derivationSpecs.list(tenantId, (s) => s.status === "ACTIVE");
  return specCellIndex(active, universe);
}

/**
 * refs 对账（**不是新门**，复用 `seed-world.ts` 既有的 `brokenRefs` 抛错路径）。
 *
 * 判据：`STATE_VAR_VALUE_REFS` 的每个键必须**在索引里**、且 `specKey` **一致** ——
 * 差集非空 ⇒ 调用方沿用既有「绑定断裂」抛错（⛔ 不许静默回落哈希）。
 * 返回差集（空数组 = 无断裂）。
 */
export function specRefDiffs(index: SpecCellIndex): string[] {
  const out: string[] = [];
  for (const key of Object.keys(STATE_VAR_VALUE_REFS).sort((a, b) => a.localeCompare(b))) {
    const ref = STATE_VAR_VALUE_REFS[key]!;
    const cell = index.get(key);
    if (cell === undefined) {
      out.push(`${key} → specKey "${ref.specKey}"（不在 ACTIVE 规格索引里：规格已退役/未编译/落点不在世界量纲空间）`);
    } else if (cell.specKey !== ref.specKey) {
      out.push(`${key} → specKey "${ref.specKey}"（索引里是 "${cell.specKey}"，两处指向不同规格）`);
    }
  }
  return out;
}

// ── D2 · 源指纹（`baseSnapshotSource`）─────────────────────────────────────────

/** 一格规格格在建会话那一刻的基值（`baseSnapshotSource.specCells` 的一条）。 */
export interface SpecCellSourceEntry {
  objectId: string;
  stateVar: string;
  specKey: string;
  baseValue: number;
}

/**
 * 会话文档里的**源指纹**：这份基值取自哪一版对象库、播种于何时、覆盖哪些格。
 * 记的是**播种那一刻的事实**，此后不重写（与 `baseSnapshot` 同一条冻结纪律）。
 */
export interface BaseSnapshotSource {
  /** `repos.objects.revision(tenantId)`；pg 模式回 `null` ⇒ 允许，诚实降级到逐格比对（R9）。 */
  revision: number | null;
  /** 播种时刻（ISO）。**与会话 `createdAt` 同一口径**（播种路径传同值 ⇒ 重播字节一致，R6）。 */
  asOf: string;
  /** 规格格全集（逐对象逐量纲）。**只随单条会话下发**，列表投影里被 omit（不许撑爆列表）。 */
  specCells: SpecCellSourceEntry[];
  /** FNV-1a(sorted `objectId|stateVar|value`)。**只做留痕**，判据本体永远是逐格比对。 */
  digest: string;
}

/** FNV-1a 32 位（纯函数：无时钟、无随机 ⇒ 同输入同输出，R6）。 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // ×16777619（FNV 素数），用移位加法避免 32 位溢出误差
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** `specCells` 的规范序（objectId → stateVar，全序）与摘要指纹。 */
export function digestSpecCells(cells: readonly SpecCellSourceEntry[]): string {
  const sorted = [...cells].sort((a, b) =>
    a.objectId === b.objectId ? a.stateVar.localeCompare(b.stateVar) : a.objectId.localeCompare(b.objectId));
  return fnv1a(sorted.map((c) => `${c.objectId}|${c.stateVar}|${c.baseValue}`).join("\n"));
}

// ── D2 · 读侧新鲜度（三态）──────────────────────────────────────────────────────

export type BaseFreshnessState = "FRESH" | "STALE" | "UNKNOWN";

/** 逐格过期明细（可下钻到具体对象）。 */
export interface StaleSpecCell {
  objectId: string;
  stateVar: string;
  specKey: string;
  baseValue: number;
  currentValue: number;
}

export interface BaseFreshness {
  state: BaseFreshnessState;
  sourceRevision: number | null;
  currentRevision: number | null;
  asOf: string | null;
  staleCells: StaleSpecCell[];
  /** 逐对象过期格数（= `staleCells.length`）—— 可下钻的那一份。 */
  staleCellCount: number;
  /**
   * 本次判据**负责的量纲键数**（`(类型,量纲)` 对，= 索引大小；RETIRE 一条规格 ⇒ 25→24）。
   * ⚠ 与 `staleCellCount` **口径不同、刻意不合**：前者是「规则空间有多大」，
   *   后者是「有几格真的过期」。分母不给 ⇒ 「1 格过期」不知是真 1 还是只查了 1。
   */
  evaluatedCellCount: number;
  /** `UNKNOWN` 的理由（缺 `baseSnapshotSource` 的老会话 / 外层自带世界 / 占位路）。 */
  reason: string | null;
}

export interface BaseFreshnessInput {
  /** 会话文档里的源指纹；`undefined`/`null` ⇒ 三态里的 `UNKNOWN`（⛔ 不许读作 FRESH）。 */
  source: BaseSnapshotSource | null | undefined;
  baseSnapshot: TickState;
  index: SpecCellIndex;
  /** 对象 id → 类型（世界量纲空间的 16 类）。取不到 ⇒ 该格判不了，跳过（如实不算过期）。 */
  typeOf: ReadonlyMap<string, string>;
  /** 对象 id → 今天的 props。取不到（对象已删）⇒ 该格判不了，跳过。 */
  propsOf: ReadonlyMap<string, Record<string, unknown>>;
  currentRevision: number | null;
}

/**
 * 新鲜度判据。**纯函数**：对象库的读取由调用方（`app.ts`，核之外）做完后喂进来。
 *
 * 判据口径（**只此一个，不许在实现里再挑一个**）：逐格比
 * `baseValue` vs `round(evalArithmetic(translateSpecFormula(formula).inner, props), 6)`。
 *  · `revision` 相等**只做短路**（省一次扫描）—— 判据本体永远落在逐格值比对上；
 *  · `revision` 为 `null`（pg 模式，R9）⇒ **退化成逐格比对**：慢，但一定对；
 *  · 式子译不出 / 求值抛错 / 非有限 ⇒ 该格**跳过**（不报过期 —— 判不了的事不许说成过期，
 *    与 `runDerivations` 的三条约束同源：聚合 DSL 不译跳过、坏式子跳过不炸整批）。
 */
export function computeBaseFreshness(input: BaseFreshnessInput): BaseFreshness {
  const evaluatedCellCount = input.index.size;
  const base: Pick<BaseFreshness, "sourceRevision" | "currentRevision" | "asOf" | "staleCells" | "staleCellCount" | "evaluatedCellCount"> = {
    sourceRevision: input.source?.revision ?? null,
    currentRevision: input.currentRevision,
    asOf: input.source?.asOf ?? null,
    staleCells: [],
    staleCellCount: 0,
    evaluatedCellCount,
  };
  if (input.source === null || input.source === undefined) {
    return {
      ...base,
      state: "UNKNOWN",
      reason: "本会话没有 baseSnapshotSource（老会话 / 调用方自带世界 / 占位路）⇒「基值还等不等于源」不可判；⛔ 不许读作 FRESH",
    };
  }
  // revision 短路：两侧都拿得到且相等 ⇒ 播种以来对象库一次都没写过 ⇒ 逐格不可能有差。
  if (input.source.revision !== null && input.currentRevision !== null && input.source.revision === input.currentRevision) {
    return { ...base, state: "FRESH", reason: null };
  }
  return { ...base, ...scanStaleCells(input), reason: null };
}

/** 逐格扫描（短路未命中 / `revision` 不可用时走这里）。
 *
 * ⚠ 扫的是 **`source.specCells`**（播种那一刻记下的清单），不是「今天索引里的全集」：
 *  · 它天然排除了**没读到真属性**（哈希占位）的格 —— 那种格的基值不是源的真值，
 *    拿它跟今天的 props 比会**恒报过期**（假阳性）；
 *  · 判据本体仍是逐格值比对：`baseValue`（冻结世界那一格）vs `today(c)`（今天 props 重算）。
 */
function scanStaleCells(input: BaseFreshnessInput): { state: BaseFreshnessState; staleCells: StaleSpecCell[]; staleCellCount: number } {
  const staleCells: StaleSpecCell[] = [];
  const index = input.index;
  const src = input.source;
  if (src === null || src === undefined) return { state: "FRESH", staleCells, staleCellCount: 0 };
  const entries = [...src.specCells].sort((x, y) =>
    x.objectId === y.objectId ? x.stateVar.localeCompare(y.stateVar) : x.objectId.localeCompare(y.objectId));
  for (const entry of entries) {
    const typeKey = input.typeOf.get(entry.objectId);
    if (typeKey === undefined) continue;
    // 公式取**今天**的归属（规格退役/改式 ⇒ 该格不再锚定，也就不再判「过期」）。
    const cell = index.get(specCellKey(typeKey, entry.stateVar));
    if (cell === undefined) continue;
    const props = input.propsOf.get(entry.objectId);
    if (props === undefined) continue; // 对象已不在库里 ⇒ 判不了，跳过（不许猜）
    const frozen = input.baseSnapshot?.[entry.objectId]?.[entry.stateVar];
    const baseValue = typeof frozen === "number" ? frozen : entry.baseValue;
    const currentValue = todayOfSpecCell(cell.formula, props);
    if (currentValue === undefined) continue; // 译不出/算不了 ⇒ 跳过，不许当过期
    if (baseValue !== currentValue) {
      staleCells.push({ objectId: entry.objectId, stateVar: entry.stateVar, specKey: cell.specKey, baseValue, currentValue });
    }
  }
  return staleCells.length > 0
    ? { state: "STALE", staleCells, staleCellCount: staleCells.length }
    : { state: "FRESH", staleCells, staleCellCount: 0 };
}

/**
 * `today(c)` —— 用**今天**的对象 props 重算这一格的规格真值。
 * 与 `ontology.ts` `runDerivations` 的规格层**同一算路、同一舍入口径**（`round(value, 6)`），
 * 本模块**不新增算法**。译不出 / 抛错 / 非有限 ⇒ `undefined`（判不了，不是 0）。
 */
export function todayOfSpecCell(formula: string, props: Record<string, unknown>): number | undefined {
  const translated = translateSpecFormula(formula);
  if (translated === null) return undefined;
  let value: number;
  try {
    value = evalArithmetic(translated.inner, props);
  } catch {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    if (translated.fallback === undefined) return undefined;
    value = translated.fallback;
  }
  return round(value, 6);
}
