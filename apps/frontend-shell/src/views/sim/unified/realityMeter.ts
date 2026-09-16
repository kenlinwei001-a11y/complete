/**
 * ══ WO-SIM-REALITY-METER · 「这次推演有多少是真业务数」的**纯派生层** ═══════════════
 *
 * 零 JSX · 零颜色 · 零副作用 · 零时钟 —— 与同目录 `metricWallModel.ts` 同一条纪律：
 * 换算/派生一律在纯函数层，组件只排版。同入参逐字节同出参（R6）。
 *
 * ── 这一层要答的是哪一个问题 ─────────────────────────────────────────────────
 * 屏上那些读数**长得和真值一模一样**（有量纲感、有小数位、随对象变化），用户分辨不了。
 * 后端把分辨所需的事实写进了 `SimSession.scope.baseSnapshotOrigin`
 * （`apps/datacore/src/sim/seed-world.ts` 的 `SeedWorldSnapshotOrigin`），
 * 而此前屏上只把它揉进一句话里（「实测格 450/6363」）——**没有比例、没有覆盖面、
 * 也没有任何办法自己看一眼「那 450 格到底改变了什么」**。
 *
 * 本层给两样：
 *  ① **读数**：真业务数占比（现算，⛔ 不写死）——每收编一个类型它自己往上走；
 *  ② **对照实验的算料**：同一份世界态的「纯占位孪生」，以及两臂读数的并排与差值。
 *
 * ── ⛔ 三条不许 ─────────────────────────────────────────────────────────────
 *  ① **不许用 `kind` 分真假**。`seed-world.ts` 里 `kind` 是**字面量类型 `"DERIVED"`**，
 *    不是 union —— 注释提到 `MEASURED` 但代码只有一个取值。拿它当判据永远得到「全是假的」，
 *    而真相是 `measuredCells / cells`（今天 450/6363）。
 *    （历史：旧沙盘曾给哈希占位盖 `MEASURED` 章，被发现后类型被收窄。别把那个错再犯一遍。）
 *  ② **不许反算覆盖对象数**。`measuredCells / 3` 要假设「每个对象恰好 3 格」——
 *    本体一变就错，而且不会红。后端今天**没有这个字段** ⇒ 屏上写「—」并说明取不到。
 *  ③ **不许把两档说成「真实 vs 模拟」**。含真值那一档今天也有 92.9% 是占位，
 *    两档的差别是 **7.1% vs 0%**，不是「真 vs 假」。
 */
import type { TickState } from "@platform/contracts";
import type { SnapshotOrigin } from "./metricWallModel";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 真实度读数（第一层常显的那三个数）
// ══════════════════════════════════════════════════════════════════════════════

/** 进度条的格数。纯排版常量，不承载业务口径。 */
const BAR_SLOTS = 10;

/**
 * 「实测格落在哪些 `类型.属性` 上」的三态。**互斥，不许合并**：
 *  · `none`       后端说 `measuredCells === 0` ⇒ 真的一格都没有（这是结论）；
 *  · `known`      抽出来了，且每一条都在本租户的边集里对得上；
 *  · `unreadable` 后端说有实测格，但本屏的抽取器对不上它那句话的结构
 *                 ⇒ **报「工具坏了」，⛔ 不许报「没有」**（铁律 0.6 的那条机制）。
 */
export type MeasuredKeys =
  | { readonly kind: "none" }
  | { readonly kind: "known"; readonly pairs: readonly MeasuredPair[] }
  | { readonly kind: "unreadable"; readonly why: string };

export interface MeasuredPair {
  readonly typeKey: string;
  readonly stateVar: string;
}

/**
 * 从出处记号的 `formula` 里把「本次命中的 `类型.属性`」抽出来。
 *
 * ── 为什么抽的是这句话，而不是另有一个字段 ────────────────────────────────────
 * 实测（2026-09-16 真后端 `SEED_DEMO=1`）：`SeedWorldSnapshotOrigin` 的字段只有
 * `kind / formula / note / types / objects / cells / measuredCells / derivedCells` ——
 * **命中的那几个 `类型.属性` 只存在于 `formula` 这句话里**（后端 `measuredVarKeys` 现算后 join）。
 * 本单⛔一行后端都不许碰 ⇒ 只能从这句话里读。
 *
 * ⚠ 正因为它是**散文**，抽取器必须自证：见下面 `measuredKeysCanary()`。
 *   抽不到时报的是「**抽取器对不上结构**」，不是「没有实测格」——
 *   （协调方本轮就踩过一次：正则对不上 `Object.fromEntries([...].map())`，
 *    差点把「抽不出来」报成「不存在」。）
 */
const PAIR_RE = /(?<![A-Za-z0-9_.])([A-Z][A-Za-z0-9_]*)\.([a-z][A-Za-z0-9_]*)(?![A-Za-z0-9_])/g;

/** 唯一实现 —— 金丝雀与主逻辑**共用它**，⛔ 不许各抄一份正则（抄了金丝雀就是装饰品）。 */
export function extractTypeVarPairs(text: string): readonly MeasuredPair[] {
  const out: MeasuredPair[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(PAIR_RE)) {
    const typeKey = m[1];
    const stateVar = m[2];
    // 两个捕获组都是必填的（正则里没有可选段），但 `noUncheckedIndexedAccess` 看不出这一点 ——
    // 与其 `!` 断言，不如把「抽不出来」当一种真实可能：抽不全的那一条直接不要。
    if (typeKey === undefined || stateVar === undefined) continue;
    const key = `${typeKey}.${stateVar}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ typeKey, stateVar });
  }
  return out;
}

/**
 * 金丝雀样例：**一段已知必中的文字**，逐字取自后端 `seed-world.ts` 那句 `formula` 的骨架。
 * ⚠ 它走的是上面**同一个** `extractTypeVarPairs`，不是另抄一遍正则。
 */
export const MEASURED_KEYS_CANARY_TEXT =
  "两档取值。① 真读数：……本次命中 Order.leadDays、Order.qty。② 派生占位：其余格子 round(hash01(`${objectId}|${stateVar}`) × 100)。";

/** 金丝雀命中数（应为 2）。不中 ⇒ 抽取器坏了，任何「没抽到」都不许读作「没有」。 */
export function measuredKeysCanary(): number {
  return extractTypeVarPairs(MEASURED_KEYS_CANARY_TEXT).length;
}

/**
 * 把 `formula` 抽出的 `类型.属性` 与**本租户真实边集**求交。
 *
 * ⚠ 这一步不是装饰：散文里可能混进别的大写点小写串（如未来加一句
 * `Model.costPressure` 的举例）。只有真的在边集里存在的对，才算「实测格落在这里」。
 * ⚠ 交集为空 ⇒ **仍然报 `unreadable`**（抽到了但对不上边集 = 我读不懂这句话），
 *   ⛔ 不许悄悄退成 `none`。
 */
export function readMeasuredKeys(
  origin: SnapshotOrigin | null,
  varsByType: ReadonlyMap<string, ReadonlySet<string>>,
): MeasuredKeys {
  if (origin === null || origin.measuredCells === null) {
    return { kind: "unreadable", why: "这条会话没有带出处记号 ⇒ 不知道有没有实测格（这和「没有实测格」是两件事）" };
  }
  if (origin.measuredCells === 0) return { kind: "none" };
  if (measuredKeysCanary() !== 2) {
    return { kind: "unreadable", why: "本屏的抽取器自检没通过（已知必中的样例也抽不出来）⇒ 是量法坏了，不是没有实测格" };
  }
  const formula = origin.formula;
  if (formula === null) {
    return { kind: "unreadable", why: "出处记号里没有派生公式这一格 ⇒ 说不出实测格落在哪几个属性上" };
  }
  const pairs = extractTypeVarPairs(formula).filter((p) => varsByType.get(p.typeKey)?.has(p.stateVar) === true);
  if (pairs.length === 0) {
    return {
      kind: "unreadable",
      why: `出处记号说有 ${String(origin.measuredCells)} 格实测，但本屏没能从它的派生公式里认出任何一个「类型.属性」⇒ 是量法坏了，不是没有实测格`,
    };
  }
  return { kind: "known", pairs };
}

/** 第一层那条读数。**每一格都现算**，`null` 一律读作「取不到」而不是 0。 */
export interface RealityMeter {
  readonly measuredCells: number | null;
  readonly cells: number | null;
  readonly derivedCells: number | null;
  readonly objects: number | null;
  readonly types: number | null;
  /** `measuredCells / cells`，`null` = 任一端取不到（⛔ 不补 0）。 */
  readonly share: number | null;
  /** 十格进度条。取不到时给十个空格 —— 它只是 `share` 的复读，不承载第二份口径。 */
  readonly bar: string;
  /** 取不到读数时**说明是哪一种取不到**（三态，见 `absenceOf`）。 */
  readonly absence: string | null;
  /**
   * 覆盖对象数。**今天恒 `null`** —— 后端出处记号里没有这个字段（实测：只有
   * `types/objects/cells/measuredCells/derivedCells` 五个数）。
   * ⛔ 刻意不用 `measuredCells / 属性数` 反算：那要假设每个对象恰好命中全部属性，
   *    本体一变就错，而且不会红。
   */
  readonly coveredObjects: null;
  readonly coveredObjectsWhy: string;
}

export function barOf(share: number | null): string {
  if (share === null) return "▱".repeat(BAR_SLOTS);
  const filled = Math.max(0, Math.min(BAR_SLOTS, Math.round(share * BAR_SLOTS)));
  return "▰".repeat(filled) + "▱".repeat(BAR_SLOTS - filled);
}

export function buildRealityMeter(origin: SnapshotOrigin | null, absence: string | null): RealityMeter {
  const m = origin?.measuredCells ?? null;
  const c = origin?.cells ?? null;
  const share = m === null || c === null || c === 0 ? null : m / c;
  return {
    measuredCells: m,
    cells: c,
    derivedCells: origin?.derivedCells ?? null,
    objects: origin?.objects ?? null,
    types: origin?.types ?? null,
    share,
    bar: barOf(share),
    absence: origin === null ? absence : m === null || c === null ? "出处记号里没有格数这两项 ⇒ 算不出占比" : null,
    coveredObjects: null,
    coveredObjectsWhy:
      "覆盖到几个对象这一项**后端没有下发**（出处记号只给类型数 / 对象数 / 总格数 / 实测格数 / 派生格数五个数）。" +
      "⛔ 不拿「实测格数 ÷ 属性个数」反算 —— 那要假设每个对象恰好命中全部属性，本体一变就错，而且不会报错。",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 纯占位孪生世界（对照实验的右臂）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把一份世界态**逐格换成哈希占位**，键集合一个字节不动。
 *
 * ── 为什么不是直接用 `deriveBaseSnapshot(cfg)` 的整份产物 ────────────────────
 * `deriveBaseSnapshot` 铺的是 `nodeTypes × 全部 stateVars`（实测 100 类型 × 47 量 ×
 * 12,499 对象 = **587,453 格**），而种子世界只铺**规则真触及**的那一份
 * （实测 32 类型 × 4,425 对象 = **6,363 格**）。两份形状不同 ⇒ 拿它当右臂，
 * 两臂的差别里就混进了「世界形状不一样」这一项，而那**不是**本实验要问的东西。
 * ⇒ 本函数用**同一个** `hash01`（`views/sim/edgeActiveModel.ts` 导出的那一个，
 *   `deriveBaseSnapshot` 自己也是用它算每一格），只把它铺在左臂的键集合上：
 *   **两臂唯一的差别就是那些实测格**。这才叫对照实验（铁律 1.5 判据一）。
 *
 * @param hash01 由调用方注入（本层零依赖、可单测）；生产实参恒为 `edgeActiveModel.hash01`。
 */
export interface PlaceholderTwin {
  readonly snapshot: TickState;
  readonly objects: number;
  readonly cells: number;
  /**
   * 与左臂逐格比对，**值不同**的格数。
   *
   * 🐤 这是本实验的金丝雀，两头都要看：
   *  · 报 **0** ⇒ 孪生世界与真值世界逐字节相同 ⇒ 要么前端哈希式与后端漂了、
   *    要么这份世界压根没有实测格 ⇒ **报「量法坏了」，⛔ 不许报「差 0」**；
   *  · 它**不等于** `measuredCells` 是正常的：真值恰好等于哈希值的格会被算成「相同」
   *    （实测 450 格实测值里有 **2** 格撞上了哈希值 ⇒ 本项 448）。
   *    ⛔ 所以屏上的占比一律用 `measuredCells`（权威计数），本项只当金丝雀。
   */
  readonly differingCells: number;
  readonly differingByVar: readonly { readonly stateVar: string; readonly n: number }[];
}

export function buildPlaceholderTwin(real: TickState, hash01: (s: string) => number): PlaceholderTwin {
  const snapshot: TickState = {};
  let objects = 0;
  let cells = 0;
  let differingCells = 0;
  const byVar = new Map<string, number>();
  for (const [oid, row] of Object.entries(real)) {
    const twinRow: Record<string, number> = {};
    for (const [v, val] of Object.entries(row ?? {})) {
      // 与 `deriveBaseSnapshot` 逐字同式（同一个 `hash01`、同一个 `round(×100)`）。
      const h = Math.round(hash01(`${oid}|${v}`) * 100);
      twinRow[v] = h;
      cells += 1;
      if (val !== h) {
        differingCells += 1;
        byVar.set(v, (byVar.get(v) ?? 0) + 1);
      }
    }
    snapshot[oid] = twinRow;
    objects += 1;
  }
  return {
    snapshot,
    objects,
    cells,
    differingCells,
    differingByVar: [...byVar.entries()]
      .map(([stateVar, n]) => ({ stateVar, n }))
      .sort((a, b) => b.n - a.n || a.stateVar.localeCompare(b.stateVar)),
  };
}

/**
 * 孪生世界的出处记号（写进新会话的 `scope.baseSnapshotOrigin`，随 `GET …/sessions` 原样回来）。
 *
 * ⚠ `measuredCells: 0` **不是拍脑袋填的**：这份快照的每一格都由上面那个循环用 `hash01` 现算，
 *   循环里没有任何一支会读对象属性 ⇒ 真读数恒 0。写进 scope 的好处是
 *   **复审可以用与左臂完全相同的那条读法**（`readSnapshotOrigin`）去核它，
 *   而不是听前端自称（验收判据②要的就是这个）。
 */
export function twinOriginScope(twin: PlaceholderTwin, label: string): Record<string, unknown> {
  return {
    label,
    baseSnapshotOrigin: {
      kind: "DERIVED",
      formula: "round(hash01(`${objectId}|${stateVar}`) × 100)（FNV-1a · 与 deriveBaseSnapshot 同式）",
      note:
        "对照臂：这份世界态的每一格都是结构派生的确定性占位，实测格 0 格 —— " +
        "它与左臂的唯一差别就是左臂那些真读数格。",
      types: 0,
      objects: twin.objects,
      cells: twin.cells,
      measuredCells: 0,
      derivedCells: twin.cells,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 两臂并排
// ══════════════════════════════════════════════════════════════════════════════

/** 一臂跑完之后，屏上要并排的那几个读数。**全部取自既有模型层**，本层不新算业务量。 */
export interface ArmReadings {
  readonly sessionId: string;
  /** 会话回包自称的出处记号（验收判据②：右臂必须是 `measuredCells === 0`）。 */
  readonly measuredCells: number | null;
  readonly cells: number | null;
  readonly deltaCells: number;
  readonly movedOrders: number;
  readonly exposure: number;
  readonly deltaP50: number | null;
  readonly deltaMax: number | null;
}

export type CompareFormat = "int" | "money" | "num2";

export interface CompareRow {
  readonly key: string;
  readonly label: string;
  readonly a: number | null;
  readonly b: number | null;
  /** `null` = 两端任一取不到 ⇒ 差值**算不出来**（⛔ 不写 0：那是另一个命题）。 */
  readonly diff: number | null;
  readonly fmt: CompareFormat;
}

export function buildComparisonRows(a: ArmReadings, b: ArmReadings): readonly CompareRow[] {
  const row = (key: string, label: string, x: number | null, y: number | null, fmt: CompareFormat): CompareRow => ({
    key,
    label,
    a: x,
    b: y,
    diff: x === null || y === null ? null : x - y,
    fmt,
  });
  return [
    row("cells", "读数发生变化的格数", a.deltaCells, b.deltaCells, "int"),
    row("orders", "被推动的订单张数", a.movedOrders, b.movedOrders, "int"),
    row("exposure", "被推动订单的敞口金额（元）", a.exposure, b.exposure, "money"),
    row("p50", "各单变化幅度中位数（0–100 压力标度）", a.deltaP50, b.deltaP50, "num2"),
    row("max", "各单变化幅度最大值（0–100 压力标度）", a.deltaMax, b.deltaMax, "num2"),
  ];
}

/** 两臂**终态**逐格比对 —— 「那些真值格到底推动了什么」的直接证据。 */
export interface Divergence {
  readonly cells: number;
  readonly byVar: readonly { readonly stateVar: string; readonly n: number }[];
}

export function diffEndStates(a: TickState, b: TickState, eps = 1e-9): Divergence {
  let cells = 0;
  const byVar = new Map<string, number>();
  for (const [oid, row] of Object.entries(a)) {
    const other = b[oid];
    if (other === undefined) continue;
    for (const [v, val] of Object.entries(row ?? {})) {
      const o = other[v];
      if (typeof o !== "number" || typeof val !== "number") continue;
      if (Math.abs(val - o) <= eps) continue;
      cells += 1;
      byVar.set(v, (byVar.get(v) ?? 0) + 1);
    }
  }
  return {
    cells,
    byVar: [...byVar.entries()]
      .map(([stateVar, n]) => ({ stateVar, n }))
      .sort((x, y) => y.n - x.n || x.stateVar.localeCompare(y.stateVar)),
  };
}

/**
 * 「差值全为 0」这件事的**屏上说法**。
 *
 * ⚠ 仓主要这个功能，要的就是**能自己看见这件事** —— 差 0 是交付物，不是 bug。
 *   ⛔ 不许因为差 0 就去调参数、换口径、或把这块屏藏起来。
 * ⚠ 反过来，差非 0 时也必须如实给数（它与「真值撑不动聚合量」这个既有认知相反）。
 */
export function verdictOf(rows: readonly CompareRow[], div: Divergence): string {
  const comparable = rows.filter((r) => r.diff !== null);
  if (comparable.length === 0) {
    return "两臂都没跑出可比的读数 —— 这是「没测出来」，不是「没有差别」。";
  }
  const moved = comparable.filter((r) => r.diff !== 0);
  if (moved.length === 0) {
    return (
      `上面每一项的差值都是 0：那些真读数格**没有改变这几个聚合读数**。` +
      `两臂终态真正不同的只有 ${String(div.cells)} 格` +
      (div.byVar.length === 0 ? "" : `（落在 ${div.byVar.map((x) => x.stateVar).join("、")} 上）`) +
      `，它们没有再往下推动任何别的量。`
    );
  }
  return (
    `有 ${String(moved.length)} 项读数被那些真读数格改变了（${moved.map((r) => r.label).join("、")}）；` +
    `两臂终态不同的格共 ${String(div.cells)} 格。`
  );
}
