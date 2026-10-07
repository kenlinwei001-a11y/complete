/**
 * WO-FINANCE-WORLDSTATE · `finance_world_projection` —— 财务**金额**随世界态扰动的投影。
 *
 * ── 这个文件补的是哪一半（三形态判定 · 铁律 0.5 逐层追到底）────────────────────────
 * 「财务指标随扰动动态变化」由两半组成，今天只有一半在工作：
 *
 *  ✅ **压力指数那一半已通**：`seed.ts` 的 13 条 `demo_*` 传导规则里，成本/现金两条是真规则：
 *       `Material.priceShock --×0.65--> Model.costPressure --×0.9--> Order.costPressure`
 *       `Order.costPressure --×0.5--> Customer.receivablePressure --×0.4--> ARInvoice.overduePressure`
 *     `seed-demo-propagation.test.ts` 的「六方向逐条真触发」门逐条咬着它们。
 *
 *  ❌ **金额那一跳缺**：`financePnl(ctx: AuthCtx)` **零世界态入参**，读 `listByType("FinancePlan")`
 *     的本体真值 ⇒ 同一租户下施加任何扰动它都返回**逐字节相同**的一组数。
 *     全仓 `worldId`/`sessionId` 在 `solvers/` 下 **0 命中**
 *     （金丝雀：同目录同命令 `financePnl` 命中 2 ⇒ 是真零命中，不是 grep 坏了）。
 *
 * 故本文件**新增**一条通路，**不动** `finance_pnl`（它有既有调用方与金值；动签名会连坐）：
 *   `finance_pnl`               = 本体真值口径（不吃世界态，行为逐字节不变）
 *   `finance_world_projection`  = 世界态**推演投影**口径（吃 `args.worldId`）
 *
 * ── 取世界态：照抄现成先例，不自创 ────────────────────────────────────────────────
 * `sim/impact-analysis.ts:87–90` 已经把这件事做对了（`getSession` → `getTickState` → 回落
 * `baseSnapshot`），连同它那句「世界的态为空时如实说明本次实质跑在真本体当前值上」的诚实处置。
 * 本文件走同一条，**只是把结论从"没影响"改成 `available:false` + 原因** —— 因为金额面板显示
 * 一个 0 比不显示更坏（0 会被读成"扰动不影响钱"，那是静默错答）。
 *
 * ── 换算口径（可解释 · 可溯源 · 禁止写死系数而不说它从哪来）───────────────────────
 *   金额投影 = 基线 ×（1 + 压力 ÷ divisor）
 * 三个因子全部可溯：
 *   · **基线** = `FinancePlan.{budget,rolling}` / `ARInvoice.amount` 的**真值**，provenance 带真主键；
 *   · **压力** = 世界态里真承载对象上的 stateVar 真值，按**该对象的真金额加权**聚合
 *     （权重量纲在加权平均里自动相消 ⇒ `Order.qty×unitPrice` 与 `FinancePlan` 的万元口径不必同量纲）；
 *   · **divisor** = 唯一一处声明式量纲桥（压力按百分点读 ⇒ 100），**随回包下发**且可由
 *     `args.pressureUnit` 改写 —— 这就是本单对「禁止写死系数」的兑现：说清它从哪来、当场可改。
 * 另外把产生这些压力的 `PropagationRule` 的**真 id 与真系数**一并下发（`chain[]`），
 * 改种子系数 → 回包里的链跟着变，界面上"凭什么是这个数"当场可查。
 *
 * ── R4 / R6 ──────────────────────────────────────────────────────────────────
 * R4：**只读**。不写世界态、不写本体真值、不落 Action —— 沙盘只推演不写真值。
 * R6：无 `Date.now`、无随机；明细一律按稳定键排序；同 (worldId, tick, args) 两跑字节一致。
 */
import {
  FINANCE_WORLD_DEFAULT_LINE_ROLES,
  FINANCE_WORLD_PRESSURE_DIVISOR,
  MONEY_CHARGE_BASIS, // GOALLOOP-R2 · 金额摊销轴的**唯一**口径出处（contracts 声明 · battery.ts 登记）
  type FinanceWorldBasis,
  type FinanceWorldCash,
  type FinanceWorldChainHop,
  type FinanceWorldLine,
  type FinanceWorldPressure,
  type FinanceWorldProjectionOutput,
  type FinanceWorldRecon,
  type FinanceWorldStateSource,
  type FinanceWorldTurnDisclosure,
  type PropagationRule,
  type TickState,
  type TurnDynamics,
} from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import { notFound, validationError } from "../errors.js";
import type { Repos } from "../repo/repo.js";
import { round } from "../prng.js";
import { DeviationReader } from "../sim/deviation-read.js";
// GOALLOOP-R2 · 推演世界成员集合的**唯一物化入口**（`seed-world.ts` 的单一入口令）。
// ⛔ 本文件此前是**第 6 份手抄**：各来一遍 `repos.objects.listByType(...)`，而且抄漏了
//    `entersSimWorld` 过滤 ⇒ 分母把 350 张「任何扰动都改不了结果」的已完成单也摊了进去。
import { listSimWorldObjects, type SimWorldRow } from "../sim/seed-world.js";
import { deriveTurnDynamics, readWorldLine, WORLD_LINE_DEFAULT_WINDOW } from "../sim/world-line.js";
import { num, str } from "./types.js";

/** 勾稽容差（与 `GapReconCheckSchema` 同一把尺子，不另立一套）。 */
const RECON_EPS = 1e-4;

/**
 * 金额一律留**六位**（亿口径下六位 = **百元级**，0.000001 亿 = 100 元）。
 *
 * 🔴 2026-10-05 修（WO-COSTPRESSURE-IDENTITY 判据 3），病名 = **最后一跳的降级**：
 *   旧注释写「万元口径下两位 = 百元级」—— **这个换算是错的**，而它正是选两位的依据。
 *   本文件全部金额走**亿**口径（`FinancePlan.rolling` 118.9 / 581.1 即亿），
 *   故两位 = `0.01 亿` = **1,000,000 元**的粒度。
 *   **实测后果**：仓主现场那个例子「提前 1 天交付」的财务影响 = **27.5 万元**（= 0.00275 亿），
 *   「提前 3 天」= **82.7 万元**（= 0.00827 亿）—— 两位口径下两者**都显示 `0.00`**，
 *   而传导链本身是**严格线性**的（3× 输入 ⇒ 3.0002× / 2.9988× / 3.004×，三档都到）。
 *   ⇒ **链条一路正确，最后一步把量级抹平**：用户看到「提前 1 天和 3 天都没影响」。
 *   ⛔ 修法**不是**在文案里加一句「数值很小」——那等于把降级用文字盖住。
 *
 * **位数选择理由（为什么是 6 而不是 2 / 4 / 8）**：
 *   · 6 位 = 100 元分辨率，**恰好无损表达上述两个实测金额**（0.002750 / 0.008270）；
 *   · 4 位 = 1 万元分辨率，`0.00275` 会被舍成 `0.0028` —— **改的是数不是显示**（宁可多留不许编）；
 *   · 8 位无收益：double 在 1e2 量级的分辨率约 1e-14，6 位已远离浮点噪声区，
 *     而本文件最大的数（`arBaseline` ≈ 1.6e5 亿）在 6 位下仍是精确整数级；
 *   · 与全仓既有精度口径一致：`sim/world-read.ts` 的 `q()` 用 1e6、`propagation.ts` 用 `round12`，
 *     六位小数落在同一档（⛔ 不新开一套）。
 */
const money = (v: number): number => round(v, 6);

/**
 * 世界态里某个对象的某个 stateVar。
 * **区分「键不存在」与「值为 0」**：前者 `undefined`（该对象不承载这个变量），后者 `0`（承载着、正好是 0）。
 * 这两件事在 `carriers` 计数上是不同的，混了就分不清「台账空」与「查过了没中」。
 */
const stateOf = (world: TickState, objectId: string, stateVar: string): number | undefined => {
  const v = world[objectId]?.[stateVar];
  return typeof v === "number" ? v : undefined;
};

/** 金额口径只吃这三个字段（`listSimWorldObjects` 回的结构，比 `ObjectInstance` 窄 ⇒ 不必先转宽）。 */
type ChargeableObject = SimWorldRow["obj"];

/** 对象在本次金额口径下的权重（真金额；拿不到 → 0，由调用方回落等权）。 */
type WeightFn = (o: ChargeableObject) => number;

/**
 * 压力的**摊销总体**（GOALLOOP-R2）：**分子摊谁，分母就是谁**。
 *
 * ⛔ `members` 与 `universe` 的分工是**本单最容易搞错的一处**，写死在这里：
 *   · `members` = **分母**（= `MONEY_CHARGE_BASIS[...].population` 登记的那个集合）；
 *   · `universe` = **对象层总数，只用于披露**，⛔ **不参与任何除法** ——
 *     它答的是「`carriers:0` 是台账空还是查过了没中」。把披露用的总数拿去做分母，
 *     正是本单改前那个 **×2.902657 固定稀释**的来源（分子摊世界态覆盖到的 150 张、
 *     分母摊对象层全表 500 张）。
 */
interface PressurePopulation {
  /** 登记名（`MONEY_CHARGE_BASIS[...].population`）—— 随回包逐条下发，让读数自证是对哪个集合取的。 */
  readonly set: string;
  readonly members: readonly ChargeableObject[];
  readonly universe: number;
}

interface PressureAgg {
  value: number;
  carriers: number;
  universe: number;
  /**
   * 这个平均是对**哪个集合**取的（改前回包**不能**自证这一点 ⇒ 2.9 倍稀释无人发现）。
   * `n` = 参与摊销的对象数、`weightSum` = 分母（Σ权重）。
   */
  denominator: { set: string; n: number; weightSum: number };
  weighting: "VALUE" | "EQUAL";
  weightingNote: string;
  /** 承载对象里权重最大的那个（provenance 下钻落点；无承载对象 → null）。 */
  topCarrier: { id: string; pressure: number } | null;
}

/**
 * 按真金额加权聚合一个压力量。
 *
 * ── 分母 = **登记表指定的总体**（`pop.members`），不是「手边最近的那个 `listByType`」────
 * GOALLOOP-R2 裁决（全文 `docs/evidence/GOALLOOP-R2-decision.txt`）：金额摊销的分母取
 * `SIM_WORLD_MEMBERS`（推演世界成员）。三条锚**都不在金额路径上**（拿金额路径自己的输出
 * 当自己口径的根据 = 自证）：
 *   ① 业务问题原文问的是「在**这个推演世界**里、施加了那条扰动之后…变成多少钱」；
 *   ② `entersSimWorld` 的裁定理由「货已交、款已结 ⇒ 后续**任何扰动都改不了它的结果**」——
 *      350 张 COMPLETED 单的金额恒定不变，把不变量放进「扰动带来多少钱变化」的分母 = 稀释；
 *   ③ `listSimWorldObjects` 的单一物化入口令（改前本文件是**第 6 份手抄**且抄漏了过滤）。
 *
 * ⚠ 实测价格：全表 454.6433 亿 ÷ 世界成员 156.6300 亿 = **2.902657**（固定倍数）⇒
 *   「读数随不随输入变」「两者的比随不随输入比变」这两类判据**都排除不掉它**
 *   （本单第 6 次同族错就是这个形态：只排得掉"随输入变的稀释"，排不掉"固定倍数稀释"）。
 *
 * ⛔ 改前 `catalog.ts` 那句自陈「分母是全域基数不是承载集（只对承载集平均会把『10 张单里 1 张涨价』
 *   报成全域涨价）」—— 那句话本身可能对（全域摊销是一种合法口径），**但它说的分母既不是承载集
 *   也不是推演世界成员，而是「对象层全表」**：350 张改不了结果的单被摊了进去。
 *   本函数的分母是**登记表指定的总体**，与「全域摊销 vs 承载集平均」之争无关。
 */
function aggregatePressure(
  pop: PressurePopulation,
  world: TickState,
  stateVar: string,
  weightOf: WeightFn,
  /**
   * WO-COSTPRESSURE-IDENTITY · 落点 (b)：给了读器 ⇒ 逐格读的是**偏离**（世界态 − 静息值），
   * 不给 ⇒ 逐格读的是**水平**（今天的原样）。
   *
   * ⛔ **一份实现（`DeviationReader`）两个口径**，不许在这里另抄一遍减法：
   * 金额侧要偏离、披露侧（`pressures[].value` / `turnDynamics`）要水平，
   * 两者必须是同一套权重、同一遍历序、同一承载集判据 —— 否则曲线上的点与当前值对不上。
   */
  rest?: DeviationReader,
): PressureAgg {
  const { set, members, universe } = pop;
  const n = members.length;
  if (n === 0) {
    // 「台账空」(universe=0) 与「台账有、但这个摊销总体空」(universe>0) 是**两件事**，分开说：
    // 合成一句会把「这个总体里没有对象」读成「本租户没有这类对象」（静默错答的一种）。
    return {
      value: 0,
      carriers: 0,
      universe,
      denominator: { set, n: 0, weightSum: 0 },
      weighting: "EQUAL",
      weightingNote:
        universe === 0
          ? "本租户该对象类型 0 条 —— 这个 0 是「台账空」，不是「压力为 0」。"
          : `对象层有 ${universe} 条，但摊销总体「${set}」0 条 —— 这个 0 是「没有对象进这个总体」，不是「压力为 0」。`,
      topCarrier: null,
    };
  }
  let sumW = 0;
  let sumWP = 0;
  let sumP = 0;
  let carriers = 0;
  let top: { id: string; pressure: number; w: number } | null = null;
  // R6：按 id 升序遍历 —— 浮点加法不满足结合律，遍历序变则末位可能漂。
  for (const o of [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // 给了读器 ⇒ 这一格读的是偏离；读器对「世界态没这格」仍返回 undefined（不消费），
    // 对「有格但静息值取不到」也返回 undefined 但**记了账** ⇒ 两件事在上游可分辨。
    const raw = rest ? rest.deviationOf(o.id, o.type, stateVar) : stateOf(world, o.id, stateVar);
    if (raw !== undefined) carriers += 1;
    const p = raw ?? 0;
    const w = Math.max(0, weightOf(o));
    sumP += p;
    sumW += w;
    sumWP += w * p;
    if (raw !== undefined && (top === null || w > top.w || (w === top.w && o.id < top.id))) {
      top = { id: o.id, pressure: p, w };
    }
  }
  const valueWeighted = sumW > 0;
  /**
   * ★ WO-DYNAMIC-RATIO-GUARD · 分母必须与分子同源 —— 结构自检（不是门，是本函数的不变量）。
   *
   * 🔴 为什么要有这一条（2026-10-07 实测的事故形态）：
   *   修前分母取的是 `universe`（对象层**全部**该类型对象），而分子只遍历 `members`（摊销总体）
   *   ⇒ 实测 `454.6亿 ÷ 156.6亿 = 2.9025 倍` 稀释（500 张 vs 150 张，差的 350 张全是 COMPLETED）。
   *
   * ⚠ **这一族错为什么特别难发现**：`universe` 与 `members` **都是动态算的**，
   *   所以那个比值**不是常量**——它随「订单陆续完成」而漂。于是一个确定的错值，
   *   每次跑出来的偏差都不一样，**每次都读起来像「两种口径之争」，而不像一个 bug**。
   *   ⇒ 判据：**凡是分子分母各自动态取值的地方，都要问「它们取自同一个集合吗」——
   *     这个问题在常量错里一眼可见，在两个动态量之比里会消失。**
   *
   * 本断言守的就是它：分母（`sumW`）与分子（`sumWP`）**只能**出自下面那个 `members` 循环，
   * `n` 必须等于 `members.length`。谁把分母换成 `universe` 或别的集合，这里当场炸 ——
   * 而不是等到屏上一个数「看起来像口径差异」。
   */
  if (n !== members.length || (valueWeighted && sumW <= 0)) {
    throw new Error(
      `WO-DYNAMIC-RATIO-GUARD：摊销分母与分子不同源（n=${n} · members=${members.length} · sumW=${sumW}）。` +
        `分母必须与分子逐项取自同一个集合「${set}」；⛔ 不许用 universe（对象层总数，只用于披露）。`,
    );
  }
  return {
    value: valueWeighted ? sumWP / sumW : sumP / n,
    carriers,
    universe,
    denominator: { set, n, weightSum: round(sumW, 2) },
    weighting: valueWeighted ? "VALUE" : "EQUAL",
    weightingNote: valueWeighted
      ? `按承载对象真金额在总体「${set}」内加权（总体 ${n} 个对象 · Σ权重=${round(sumW, 2)}，量纲在加权平均里相消）`
      : "金额权重字段全为 0/缺失 ⇒ 回落等权平均；这不是「金额无关」，是「拿不到金额权重」，据实标注。",
    topCarrier: top ? { id: top.id, pressure: top.pressure } : null,
  };
}

export interface FinanceWorldDeps {
  repos: Repos;
}

export interface FinanceWorldArgs {
  worldId?: unknown;
  pressureUnit?: unknown;
  revenueLine?: unknown;
  costLine?: unknown;
  marginLine?: unknown;
  /** WO-TURN-LOOP · 回看几拍（缺省 `WORLD_LINE_DEFAULT_WINDOW`，上限 `WORLD_LINE_MAX_WINDOW`）。 */
  turnWindow?: unknown;
}

/**
 * 跑一次财务世界态投影。
 *
 * @throws `validationError` —— 没给 `worldId`（**不静默回落到"随便哪个世界"**：那正是
 *   "以为在看这个世界、屏上却是另一个"的路径）。
 * @throws `notFound("sim world")` —— worldId 不存在**或**属于别的租户（R2 暗发，同 impact-analysis）。
 */
export async function projectFinanceWorld(
  deps: FinanceWorldDeps,
  ctx: AuthCtx,
  args: FinanceWorldArgs,
): Promise<FinanceWorldProjectionOutput> {
  const { repos } = deps;
  const worldId = str(args.worldId);
  if (!worldId) {
    throw validationError(
      "finance_world_projection 需要 args.worldId（哪个推演世界）—— 不给就没有世界态可读。" +
        "本求解器**拒绝**回落到「本体真值口径」：那条路已经有 `finance_pnl` 了，" +
        "回落只会让调用方以为自己拿到的是随扰动变的数。",
    );
  }

  // ── ① 取世界（照抄 `sim/impact-analysis.ts:87–90`，含它的诚实处置）─────────────────
  const world = await repos.sim.getSession(ctx.tenantId, worldId);
  if (!world) throw notFound("sim world");
  const tickState = await repos.sim.getTickState(ctx.tenantId, world.id, world.curTick);
  const worldState: TickState = tickState?.state ?? world.baseSnapshot;
  const worldStateSource: FinanceWorldStateSource = tickState ? "TICK" : "BASE_SNAPSHOT";
  const worldObjectCount = Object.keys(worldState).length;

  const notes: string[] = [];
  if (worldObjectCount === 0) {
    notes.push(
      `世界 ${world.id} 的态为空（baseSnapshot/tick 态均无对象）—— 本次实质跑在真本体当前值上，` +
        "未发生世界隔离。金额投影恒等于基线，那不是「扰动不影响钱」，是「这个世界里还没有任何态」。",
    );
  }

  // ── ② 量纲桥（唯一一处除数声明，随回包下发·可由 args 改写）────────────────────────
  const unitArg = str(args.pressureUnit);
  const pressureUnit: "pp" | "ratio" = unitArg === "ratio" ? "ratio" : "pp";
  if (unitArg && unitArg !== "pp" && unitArg !== "ratio") {
    throw validationError(`pressureUnit 只认 "pp" | "ratio"，收到 ${JSON.stringify(unitArg)} —— 不静默当缺省（静默会让调用方以为口径生效了）。`);
  }
  const divisor = FINANCE_WORLD_PRESSURE_DIVISOR[pressureUnit];
  const basis: FinanceWorldBasis = {
    kind: "PROJECTION",
    pressureUnit,
    divisor,
    source: unitArg ? "ARG" : "DEFAULT_DECLARED",
    note:
      `金额 = 基线 ×（1 + 压力**偏离** ÷ ${divisor}），压力偏离 = 世界态值 − 静息值（静息值取本世界开局快照同一格）。` +
      `压力指数按${pressureUnit === "pp" ? "百分点(pp)" : "比率(ratio)"}读；` +
      "这是**推演投影**不是实测值 —— 基线取本体真值，增量由世界态压力沿传导规则折算。" +
      "压力的**摊销总体**由登记表 `MONEY_CHARGE_BASIS` 定（当前 = 推演世界成员：已完成的单不进推演世界），" +
      "逐条随 `pressures[].denominator` 下发 —— 说清「这个平均是对哪个集合取的」，不是现场挑一个 `listByType`。" +
      "⚠ 吃的是**偏离**不是水平：压力为 0 才叫「没偏」，而水平 0 的意思是「该量本身为零」（两者不是一回事，" +
      "静息值取不到的格进 `unresolvedRestPoints`，⛔ 不按 0 算）。",
  };

  // ── ③ 三个压力量（各自带 carriers / universe / denominator / 加权口径）──────────────
  /**
   * ⛔ **推演世界成员集合的唯一物化入口**（`sim/seed-world.ts` 的 `listSimWorldObjects`）。
   * 改前这里是**第 6 份手抄**（三行 `listByType`），而且**抄漏了 `entersSimWorld` 过滤**：
   * 分母把 350 张「任何扰动都改不了它的结果」的已完成单也摊了进去（实测稀释 ×2.902657）。
   * 本函数的单一入口令原文：「要写 `for (t of types) for (o of listByType) if (...)` 之前，
   * 先问一句：我要的成员集合是不是推演世界？是 ⇒ 用本函数，别再抄第 6 份。」
   */
  const worldMembers = await listSimWorldObjects(repos, ctx.tenantId);
  /**
   * 摊销总体 = 推演世界成员按类型切分。
   * · `set` 从 `MONEY_CHARGE_BASIS` 读（⛔ 不在这里写死 `"SIM_WORLD_MEMBERS"` 字面量 ——
   *   写死就等于本文件又抄了一份口径，改登记表时这里不会跟着变且不会红）；
   * · `universe` **只用于披露**（对象层该类型总数），⛔ 不参与除法。
   */
  const populationOf = async (typeKey: string, stateVar: string): Promise<PressurePopulation> => ({
    set: MONEY_CHARGE_BASIS[`${typeKey}|${stateVar}`]?.population ?? "SIM_WORLD_MEMBERS",
    members: worldMembers.filter((r) => r.typeKey === typeKey).map((r) => r.obj),
    universe: (await repos.objects.listByType(ctx.tenantId, typeKey)).length,
  });

  const orders = await populationOf("Order", "costPressure");
  const customers = await populationOf("Customer", "receivablePressure");
  const invoices = await populationOf("ARInvoice", "overduePressure");

  /** 订单金额 = 数量 × 单价（种子里没有现成的 `value` 字段，这两个是真字段·`battery.ts:3793–3794`）。 */
  /**
   * ★ WO-SLOT-MODEL · 金额口径**唯一出处**（数据槽位）。
   *
   * 🔴 改前形态（2026-10-07 实测）：同一条金额口径写在**三处**、靠注释粘着 ——
   *   · 本处：`num(qty) * num(unitPrice)` —— **只有回落那一半**
   *   · `sim/pair-weights.ts` 的 `valueOf` —— **带优先链**：优先 `props.value`，拿不到才回落
   *   · `solvers/service.ts` 的 `orderValueYuan`
   *   而 `pair-weights.ts` 的注释写着「与 `finance-world.ts` 的 `orderValue` **同一个式子**」——
   *   **那句话只对了回落那一半**，两处的**优先链不同**。
   *
   * ⚠ 为什么一直没人发现：当前数据下两者**数值相等**
   *   （`Order.value = 161135282 = qty 7259 × unitPrice 22198`，500/500 都是）
   *   ⇒ 一旦 `value` 与 `qty×unitPrice` 分家，两处金额口径就分家，**而没有任何东西会报**。
   *   **这正是本单那条「两个动态量之比」的同族形态**：两处各自取值，都"讲得通"，
   *   差值不是常量 ⇒ 读起来像口径差异，不像 bug。
   *
   * ⇒ 本处与 `pair-weights.ts` **取同一支**：优先本体真值 `props.value`，拿不到才回落乘积。
   *   改后当前数据下**数值逐位不变**（两条支路同值），但**结构上不再可能分家**。
   */
  const orderValue: WeightFn = (o) => {
    const direct = num(o.props.value);
    if (direct > 0) return direct;
    return Math.max(0, num(o.props.qty) * num(o.props.unitPrice)); // 负金额不是权重，按 0 计（与 pair-weights 同一条）
  };
  /** 客户金额权重 = 该客户名下发票金额之和（经真链路 `customer_has_invoice` 归集，见下）。 */
  const invoiceAmount: WeightFn = (o) => num(o.props.amount);

  // 发票 → 客户（经**传导规则自己走的那条边**，不另找一套映射：两套映射必然漂移）。
  const custLinks = await repos.links.list(ctx.tenantId, (l) => l.type === "customer_has_invoice");
  const custOfInvoice = new Map<string, string>();
  for (const l of [...custLinks].sort((a, b) => (a.toId < b.toId ? -1 : a.toId > b.toId ? 1 : 0))) {
    if (!custOfInvoice.has(l.toId)) custOfInvoice.set(l.toId, l.fromId);
  }
  const custWeight = new Map<string, number>();
  for (const inv of invoices.members) {
    const cid = custOfInvoice.get(inv.id);
    if (cid) custWeight.set(cid, (custWeight.get(cid) ?? 0) + invoiceAmount(inv));
  }

  const costAgg = aggregatePressure(orders, worldState, "costPressure", orderValue);
  const arAgg = aggregatePressure(customers, worldState, "receivablePressure", (o) => custWeight.get(o.id) ?? 0);
  const overdueAgg = aggregatePressure(invoices, worldState, "overduePressure", invoiceAmount);

  /**
   * ── 落点 (b)：**金额侧读「偏离」，披露侧读「水平」**（WO-COSTPRESSURE-IDENTITY）──────────
   *
   * 上面三个 `*Agg` 是**对外披露的压力读数**（`pressures[].value` / `turnDynamics`），
   * 它们报的是那个变量的**水平**，逐字节不动（面 A/B/C 靠它）。
   * 而**金额**要的是「相对静息偏了多少」——今天它拿水平直接乘，于是零扰动下
   * `成本 = 基线 ×（1 + 24.03/100）`、毛利 118.9 → −20.72 亿。
   *
   * 静息值取 `baseSnapshot` 同一格（**与生产端把静息点播成什么同源**，不另立假设）；
   * 取不到 ⇒ `DeviationReader` 记账，随回包下发，⛔ 不退回 0。
   * 一份换算实现（`sim/deviation-read.ts`），本文件与 `sim/world-read.ts` 共用。
   */
  const restReader = new DeviationReader(worldState, world.baseSnapshot);
  const costDev = aggregatePressure(orders, worldState, "costPressure", orderValue, restReader);

  const pressureRow = (
    stateVar: string,
    objectType: string,
    agg: PressureAgg,
  ): FinanceWorldPressure => ({
    stateVar,
    objectType,
    value: round(agg.value, 6),
    carriers: agg.carriers,
    universe: agg.universe,
    // GOALLOOP-R2 · 让回包**自证**「这个平均是对哪个集合取的」——
    // 改前回包里只有 `carriers/universe`，「分子摊 150 张、分母摊 500 张」在回包上**看不出来**。
    denominator: agg.denominator,
    weighting: agg.weighting,
    weightingNote: agg.weightingNote,
    provenance: {
      kind: "派生", // 世界态的值由传导引擎沿 PropagationRule 算出，不是实测录入
      drillType: objectType,
      // 聚合值 → `"*"`（契约 `GapProvenanceSchema.drillId` 既有约定）；有承载对象时给**真主键**下钻落点。
      drillId: agg.topCarrier?.id ?? "*",
      drillField: stateVar,
      drillValue: round(agg.topCarrier?.pressure ?? agg.value, 6),
    },
  });

  const pressures: FinanceWorldPressure[] = [
    pressureRow("costPressure", "Order", costAgg),
    pressureRow("receivablePressure", "Customer", arAgg),
    pressureRow("overduePressure", "ARInvoice", overdueAgg),
  ];

  // ── ③b 回合动力学（WO-TURN-LOOP）────────────────────────────────────────────────
  /**
   * 这一段就是本单的兑现物：**同一个 `aggregatePressure`**，喂**世界线上的每一帧**，
   * 于是拿到「同一读数在第 0/1/2/3 拍各是多少」——单张快照算不出来的那些量由此而来。
   *
   * ⛔ **刻意复用 `aggregatePressure` 而不是另写一个"历史版聚合"**：口径一旦分叉，
   * 曲线上的点就与当前值对不上，而两边各自都"对"—— 那正是本仓治过的
   * 「两处输入不同源 = 第二套真相源」。承载集/权重/排序全部同一份实现。
   *
   * ⛔ 世界线读不到 ⇒ `turnDynamics` 整块缺席（`undefined`），**既有字段一个都不动**
   * （R6 向后兼容：不推进的世界，读数逐字节同旧）。
   */
  const turnWindow = (() => {
    const w = num(args.turnWindow);
    return Number.isFinite(w) && w > 0 ? w : WORLD_LINE_DEFAULT_WINDOW;
  })();
  const worldLine = await readWorldLine(repos, ctx.tenantId, world.id, world.curTick, turnWindow);
  let turnDynamics: FinanceWorldTurnDisclosure | undefined;
  if (worldLine.frames.length > 0) {
    /** 逐 stateVar：沿世界线各帧跑同一个聚合，得到这一读数的轨迹。 */
    const trackOf = (
      pop: PressurePopulation,
      stateVar: string,
      weightOf: WeightFn,
    ): TurnDynamics =>
      deriveTurnDynamics(
        worldLine.frames.map((f) => ({ tick: f.tick, value: aggregatePressure(pop, f.state, stateVar, weightOf).value })),
      );
    turnDynamics = {
      curTick: world.curTick,
      ticksUsed: worldLine.ticksUsed,
      windowRequested: worldLine.windowRequested,
      truncated: worldLine.truncated,
      note: worldLine.note,
      byStateVar: {
        costPressure: trackOf(orders, "costPressure", orderValue),
        receivablePressure: trackOf(customers, "receivablePressure", (o) => custWeight.get(o.id) ?? 0),
        overduePressure: trackOf(invoices, "overduePressure", invoiceAmount),
      },
    };
  }

  // ── ④ 科目行投影（基线 = FinancePlan 真值）───────────────────────────────────────
  const roles = {
    revenueLine: str(args.revenueLine) || FINANCE_WORLD_DEFAULT_LINE_ROLES.revenueLine,
    costLine: str(args.costLine) || FINANCE_WORLD_DEFAULT_LINE_ROLES.costLine,
    marginLine: str(args.marginLine) || FINANCE_WORLD_DEFAULT_LINE_ROLES.marginLine,
  };
  // 同一条纪律：基线行也走**同一个**成员集合物化入口（此处**是第 7 份手抄**，一并删掉）。
  // FinancePlan 无终态、故过滤后集合不变 ⇒ 基线逐位不变；但它必须与压力侧同源。
  const plans = worldMembers
    .filter((r) => r.typeKey === "FinancePlan")
    .map((r) => r.obj)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const planOf = (line: string) => plans.find((o) => str(o.props.line) === line);
  const finId = (o: ChargeableObject | undefined) => (o ? str(o.props.finId) || o.id : "*");

  // 落点 (b) ①：成本因子吃的是**偏离**（世界态 − 静息值），不是水平。
  const costFactor = 1 + costDev.value / divisor;
  const revenuePlan = planOf(roles.revenueLine);
  const costPlan = planOf(roles.costLine);
  const marginPlan = planOf(roles.marginLine);

  const revRolling = num(revenuePlan?.props.rolling);
  const cogsRolling = num(costPlan?.props.rolling);
  const gmRolling = num(marginPlan?.props.rolling);
  const revProjected = revRolling; // 本链不驱动收入 —— 理由写在下面 note 里，不擅自折算
  const cogsProjected = money(cogsRolling * costFactor);
  // 毛利用**增量法**而不是恒等式重算：`毛利' = 毛利 + Δ收入 − Δ成本`。
  // 恒等式重算（收入'−成本'）会在基线本身不满足恒等式时**悄悄改掉那个残差** —— 那就是引擎在编数。
  const gmProjected = money(gmRolling + (revProjected - revRolling) - (cogsProjected - cogsRolling));

  const pct = (deltaV: number, baseV: number) => (baseV === 0 ? 0 : round((deltaV / Math.abs(baseV)) * 100, 4));

  const lines: FinanceWorldLine[] = [];
  const projectedOf = new Map<string, number>([
    ...(revenuePlan ? ([[revenuePlan.id, revProjected]] as [string, number][]) : []),
    ...(costPlan ? ([[costPlan.id, cogsProjected]] as [string, number][]) : []),
    ...(marginPlan ? ([[marginPlan.id, gmProjected]] as [string, number][]) : []),
  ]);
  const roleOf = (o: ChargeableObject): FinanceWorldLine["role"] =>
    o.id === costPlan?.id ? "COST" : o.id === revenuePlan?.id ? "REVENUE" : o.id === marginPlan?.id ? "MARGIN" : "PASSTHROUGH";

  for (const o of plans) {
    const role = roleOf(o);
    const rolling = money(num(o.props.rolling));
    const projected = money(projectedOf.get(o.id) ?? rolling);
    const delta = money(projected - rolling);
    lines.push({
      subject: str(o.props.line),
      role,
      budget: money(num(o.props.budget)),
      rolling,
      projected,
      delta,
      deltaPct: pct(delta, rolling),
      driver: role === "COST" ? "Order.costPressure" : role === "MARGIN" ? "Order.costPressure（经 收入Δ − 成本Δ 传导）" : "",
      formula:
        role === "COST"
          ? // ⚠ 这里插的必须是**金额实际吃的那个读数**（落点 (b) 之后 = 偏离 `costDev.value`）。
            // 插 `costAgg.value`（水平）会让这条公式**复算不出它自己的 projected** ——
            // 实测过：公式写 `581.1 ×（1 + 0.146429 ÷ 100）` 而 projected 是 `581.116599`，
            // 两者相差 0.83 亿。披露与读数不一致 = 另一种静默错答（本单病的同族）。
            `${rolling} ×（1 + 偏离 ${round(costDev.value, 6)} ÷ ${divisor}）= ${projected}`
          : role === "MARGIN"
            ? `${gmRolling} +（Δ收入 ${money(revProjected - revRolling)}）−（Δ成本 ${money(cogsProjected - cogsRolling)}）= ${projected}`
            : role === "REVENUE"
              ? `${rolling}（本链不驱动收入 —— 世界态需求侧变量与 FinancePlan 收入行之间今天没有传导规则）`
              : `${rolling}（本行未被任何角色认领 ⇒ 原样透传，不擅自折算）`,
      provenance: {
        kind: "实测", // FinancePlan 是本体里录入的真值对象
        drillType: "FinancePlan",
        drillId: finId(o), // 单对象 → **真主键**（不是 "*"）
        drillField: "rolling",
        drillValue: num(o.props.rolling),
      },
    });
  }
  if (!revenuePlan) notes.push(`FinancePlan 里没有 line="${roles.revenueLine}" 的收入行 ⇒ 收入侧诚实缺席（可用 args.revenueLine 指定行名）。`);
  if (!costPlan) notes.push(`FinancePlan 里没有 line="${roles.costLine}" 的成本行 ⇒ 成本压力无处落地（可用 args.costLine 指定行名）。`);
  if (!marginPlan) notes.push(`FinancePlan 里没有 line="${roles.marginLine}" 的毛利行 ⇒ 毛利侧诚实缺席（可用 args.marginLine 指定行名）。`);
  const passthrough = lines.filter((l) => l.role === "PASSTHROUGH").map((l) => l.subject);
  if (passthrough.length > 0) {
    notes.push(`${passthrough.length} 个科目行未被角色认领（${passthrough.join("/")}）⇒ 原样透传并在此点名，**不静默漏行**。`);
  }
  notes.push(
    "收入行**故意不动**：世界态的需求侧变量（demandPressure/demandLoad）与 FinancePlan 收入行之间" +
      "今天**没有任何传导规则**（`seed.ts` 13 条里六方向全查过）。凭空折算一个收入弹性" +
      "就是引擎自己发明一个系数 —— 这是诚实缺席，不是「收入不受影响」。",
  );

  // ── ⑤ 现金侧（逐张发票用真 amount，不是拿一个总额乘系数）───────────────────────────
  let arBaseline = 0;
  let arProjected = 0;
  let overdueExposure = 0;
  let invoiceCarriers = 0;
  let customerLinked = 0;
  let topInvoice: { id: string; amount: number; invoiceId: string } | null = null;
  // ⛔ 逐张发票的总体**也是登记表指定的那个**（锚①「这个推演世界里…应收变成多少钱」）——
  //    与压力侧同一个 `worldMembers`，不在这里再抄一遍成员判据。
  for (const inv of [...invoices.members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const amount = invoiceAmount(inv);
    arBaseline += amount;
    const cid = custOfInvoice.get(inv.id);
    if (cid) customerLinked += 1;
    // 落点 (b) ②③：这两格同样吃**偏离**。世界态没有这格 ⇒ 不消费（与改动前逐字节同）；
    // 有格但静息值取不到 ⇒ `deviationOf` 记账并返回 undefined ⇒ 因子退化为 1（⛔ 不是把水平当偏离）。
    const custDev = cid ? restReader.deviationOf(cid, "Customer", "receivablePressure") : undefined;
    arProjected += amount * (1 + (custDev ?? 0) / divisor);
    const odDev = restReader.deviationOf(inv.id, "ARInvoice", "overduePressure");
    if (restReader.carried(inv.id, "overduePressure")) invoiceCarriers += 1;
    overdueExposure += amount * ((odDev ?? 0) / divisor);
    // 下钻落点 = 金额最大的那张发票（平手取 id 小者 ⇒ R6 稳定）。**在循环里就把真主键 `invoiceId` 记下**，
    // 不留到下面再去 `invoices.find(...)` 回查 —— 回查那种写法既多一次 O(n) 扫描、又把"取哪张"的规则
    // 拆到两处，改一处忘一处就会静默指错发票。
    if (topInvoice === null || amount > topInvoice.amount || (amount === topInvoice.amount && inv.id < topInvoice.id)) {
      topInvoice = { id: inv.id, amount, invoiceId: str(inv.props.invoiceId) || inv.id };
    }
  }
  const cash: FinanceWorldCash = {
    available: invoices.members.length > 0,
    ...(invoices.members.length === 0
      ? {
          unavailableReason:
            invoices.universe === 0
              ? "本租户 ARInvoice 台账 0 条 —— 应收/逾期口径无承载物。这是「查不到」，不是「应收为 0」。"
              : `ARInvoice 台账有 ${invoices.universe} 条，但摊销总体「${invoices.set}」0 条 —— 这个 0 是「没有对象进这个总体」，不是「应收为 0」。`,
        }
      : {}),
    arBaseline: money(arBaseline),
    arProjected: money(arProjected),
    arDelta: money(arProjected - arBaseline),
    overdueExposure: money(overdueExposure),
    overdueSharePct: arBaseline === 0 ? 0 : round((overdueExposure / arBaseline) * 100, 4),
    // 披露的是**对象层总数**（`universe` 的既有语义），不是本次摊销的总体大小 ——
    // 前者答「台账里一共有多少」，后者在 `pressures[].denominator` 里另给。两者混淆正是本单的病。
    invoiceUniverse: invoices.universe,
    invoiceCarriers,
    customerLinked,
    formula:
      // 落点 (b)：括号里那个数是**偏离**（世界态 − 静息值），不是水平 —— 不写清就会被读成水平。
      // 「水平 0」的意思是「该量本身为零」，「偏离 0」的意思是「相对静息没动」，两者不是一回事。
      `应收投影 = Σ_发票 amount ×（1 + 该发票客户 receivablePressure **偏离**（世界态 − 开局快照静息值）÷ ${divisor}）；` +
      `逾期敞口 = Σ_发票 amount × overduePressure **偏离** ÷ ${divisor}。` +
      "客户经真链路 `customer_has_invoice` 反查（= 传导规则自己走的那条边，不另造映射）。" +
      "静息值取不到的格**按因子 1 计**（没乘）并逐格进 `unresolvedRestPoints` —— ⛔ 不是按偏离 0 计。",
    provenance: {
      kind: "实测",
      drillType: "ARInvoice",
      // 单对象 → **真主键**；无承载对象才落 `"*"`（契约 `GapProvenanceSchema.drillId` 的既有约定）。
      drillId: topInvoice?.invoiceId ?? "*",
      drillField: "amount",
      drillValue: topInvoice?.amount ?? 0,
    },
  };
  if (invoices.members.length > 0 && customerLinked === 0) {
    notes.push(
      "一张发票都没经 `customer_has_invoice` 找到客户 ⇒ 应收压力（落在 Customer 上）传不到金额侧，" +
        "应收投影恒等于基线。这是**链路缺失**，不是「客户没有回款压力」。",
    );
  }

  // ── ⑥ 传导链（真规则 id + 真系数 —— 改种子即改这里）────────────────────────────────
  const rules = await repos.sim.listPropagationRules(ctx.tenantId, true);
  const CHAIN_TARGETS = new Set(["costPressure", "receivablePressure", "overduePressure"]);
  const chain: FinanceWorldChainHop[] = [...rules]
    .filter((r: PropagationRule) => CHAIN_TARGETS.has(r.targetStateVar))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({
      ruleId: r.id,
      ruleKey: r.key,
      from: `${r.sourceTypeKey}.${r.sourceStateVar}`,
      to: `${r.targetTypeKey}.${r.targetStateVar}`,
      viaLinkKey: r.viaLinkKey,
      coefficient: r.coefficient,
      delayTicks: r.delayTicks,
      provenance: {
        kind: "派生",
        drillType: "PropagationRule",
        drillId: r.id, // 单对象 → 真主键
        drillField: "coefficient",
        drillValue: r.coefficient,
      },
    }));
  if (chain.length === 0) {
    notes.push(
      "本租户没有任何 PUBLISHED 传导规则的 target 落在 costPressure/receivablePressure/overduePressure 上 ⇒ " +
        "世界态里这三个压力**不可能被传导产生**（只能靠直接扰动写入）。这是「链没接」，不是「压力为 0」。",
    );
  }

  // ── ⑦ 勾稽：投影不许改掉「收入−成本−毛利」的既有残差 ───────────────────────────────
  const reconChecks: FinanceWorldRecon[] = [];
  if (revenuePlan && costPlan && marginPlan) {
    const baselineResidual = round(revRolling - cogsRolling - gmRolling, 6);
    const projectedResidual = round(revProjected - cogsProjected - gmProjected, 6);
    reconChecks.push({
      label: `${roles.revenueLine} − ${roles.costLine} − ${roles.marginLine}`,
      baselineResidual,
      projectedResidual,
      ok: Math.abs(projectedResidual - baselineResidual) <= RECON_EPS,
    });
  }
  const reconciled = reconChecks.length > 0 && reconChecks.every((c) => c.ok);

  // ── ⑧ 可用性判定（不可用**必须**给原因；前端据此退回诚实缺口记号，不许显示 0）──────────
  const missingPlans = !revenuePlan && !costPlan && !marginPlan;
  let available = true;
  let unavailableReason: string | undefined;
  if (plans.length === 0) {
    available = false;
    unavailableReason = "本租户 FinancePlan 台账 0 条 —— 没有金额基线，投影无从谈起（先合成/接入财务预算）。";
  } else if (missingPlans) {
    available = false;
    unavailableReason = `FinancePlan 有 ${plans.length} 行，但没有一行匹配收入/成本/毛利角色（当前找的是 ${roles.revenueLine}/${roles.costLine}/${roles.marginLine}）—— 用 args.{revenueLine,costLine,marginLine} 指定真实行名。`;
  } else if (worldObjectCount === 0) {
    available = false;
    unavailableReason = `世界 ${world.id} 的态为空（0 个对象有态）—— 金额投影会恒等于基线，摆上屏等于"看起来是财务、实际永远不动"。据实报缺，不给一个不动的数。`;
  }

  const summary = available
    ? `世界 ${world.id} @tick${world.curTick}：成本压力 ${round(costAgg.value, 3)}（偏离 ${round(costDev.value, 3)}，` +
      // 摊销总体逐字写进摘要：只说 `carriers/universe` 会让「分子摊 150 张、分母摊 500 张」看不出来。
      `${costAgg.carriers}/${costAgg.denominator.n} 张单承载（对象层共 ${costAgg.universe} 张，摊销总体=推演世界成员）；**金额吃的是偏离**）` +
      ` ⇒ ${roles.costLine} ${cogsRolling} → ${cogsProjected}（${cogsProjected - cogsRolling >= 0 ? "+" : ""}${money(cogsProjected - cogsRolling)}）、` +
      `${roles.marginLine} ${gmRolling} → ${gmProjected}；逾期敞口 ${money(overdueExposure)}。**推演投影，非实测**。`
    : `世界 ${world.id} @tick${world.curTick}：金额口径不可用 —— ${unavailableReason}`;

  // ── ⑨ 静息值诚实缺席（落点 (b) 的配套）───────────────────────────────────────────
  // 「有格但静息值取不到」的每一格都点名，随回包下发。⛔ 它**不是**「偏离 0」：
  // 这些格在金额侧按因子 1 处理（没乘），是「没算」不是「算了等于没偏」—— 两件事在屏上必须可分辨。
  const unresolvedRestPoints = restReader.unresolvedRestPoints();
  if (unresolvedRestPoints.length > 0) {
    notes.push(
      `⚠ ${unresolvedRestPoints.length} 格有世界态值但在开局快照里取不到静息值 ⇒ 本次金额投影**没有消费**它们` +
        "（按因子 1 计，不是按偏离 0 计）。逐格点名见 `unresolvedRestPoints`。",
    );
  }

  return {
    worldId: world.id,
    curTick: world.curTick,
    worldStateSource,
    worldObjectCount,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    notes,
    // 一格不差 ⇒ 整键缺席（R6：没有缺席的回包逐字节同旧）。
    ...(unresolvedRestPoints.length > 0 ? { unresolvedRestPoints } : {}),
    basis,
    pressures,
    lines,
    cash,
    chain,
    // WO-TURN-LOOP：世界线读不到时**整键缺席**（不是给个空壳）——「没有历史」与「历史为空」
    // 在屏上必须长得不一样。
    ...(turnDynamics ? { turnDynamics } : {}),
    reconChecks,
    reconciled,
    summary,
  };
}
