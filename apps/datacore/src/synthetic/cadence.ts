/**
 * WO-SANDBOX-D1 · 节拍承载（数据半）。
 *
 * ── 本文件是什么 ──────────────────────────────────────────────────────────
 * 让 S0 冻结的 `Cadence`（`packages/contracts/src/chain-sim.ts` §2）在**数据层真实存在**：
 * 为全链上的限流环节产出节拍，**值全部从既有种子自身的发生序列里推导**，推不出来的诚实标 `EMPTY`。
 *
 * ── 施工前取证（铁律 0.5：grep 不是结论，必须再追一层）──────────────────
 * 工单 §1 写「『节拍』概念全仓不存在 · 无任何契约承载『多久处理一次』· 三分法 = 没接线」。
 * 逐条追证后，这句话**一半不成立**，与工单冲突之处以下述实测为准：
 *
 *  ① 「节拍」这个**词**在本仓已被占用，且是另一个口径 —— **设备节拍 CT**（秒/只）：
 *     `Equipment.ctSeconds`（`battery.ts:1699` 中文名"节拍"）· `ProductLineCapability.cycleTime`
 *     （`battery.ts:1767`）· agentcore `sim-planner.ts:112` 把「节拍」映到 `Process.cycle_time`/`cf-takt`。
 *     那是**单件加工时间**，不是「多久处理一次」。两者单位、语义、消费方全不同，
 *     故本文件一律用 `Cadence`/「节拍(批次)」并在此显式标注分野，**禁止**把 CT 当 Cadence 复用。
 *
 *  ② 「多久处理一次」**已有一个真承载物**，不是零：`OpsSchedule.sopCycle.openCron`
 *     （`packages/contracts/src/replay-ops.ts:109`）+ `forecasts[].cron`（同文件 :103）。
 *     它**有真消费方**（不是死代码）：`opsteam/schedule.ts:84` → `scheduler.register(…, "SOP_AUTO_OPEN", …)`
 *     → `scheduler.ts:71 cronNext()` 真的算下一次触发时刻。
 *     **但**：全仓唯一写入方是 `OpsScheduleService.put`（`opsteam/schedule.ts:52`，tenant_admin REST 写），
 *     `apps/datacore/src/synthetic/**` 里 `opsSchedules.put` **0 命中** ⇒ demo 租户恒无此配置。
 *     三分法定性 = **接了线没数据**（不是「没接线」）。且它是**作业调度**口径（触发一个 job），
 *     不是**链路建模**口径（某环节让工作等多久），挂在租户配置上、拿不到节点粒度 ⇒ 也**接错地方**。
 *     结论：修法是「补数据 + 补链路粒度承载」，而非「造机制」。本文件做后者，前者留给运营配置。
 *
 * ── 取值纪律：本文件里**没有任何一个节拍天数字面量** ────────────────────
 * 「不许拍脑袋」不是靠自觉，是靠**结构上写不进去**：
 * 每个节点只声明「去种子的哪个集合、按什么分组、读哪个时刻字段」（`CADENCE_NODES`），
 * 具体天数由**唯一一支推导函数** `deriveIntervalDays()` 从真实发生序列算出。
 * 改了种子的铺法（如 S&OP 版本从 14 天一版改成 21 天），这里的值**必须跟着变**——
 * 这正是 D1 变异反证的注入点。
 *
 * ── 诚实缺席（禁止静默兜底）─────────────────────────────────────────────
 * 推不出来的节点产出 `dataMode: "EMPTY"` + 机器可读的 `reason` + **查过什么**的取证记录，
 * 消费口 `cadenceWaitDaysOfNode()` 对 EMPTY 返回 `null`（**不是 0**）。
 * 返回 0 等于宣称「随到随办」，那是一个看着合理的假数字 —— 契约 §2 已把这个错法显式排除。
 *
 * ── R6 确定性 ─────────────────────────────────────────────────────────────
 * 纯函数：无 `Date.now`、无随机、无 I/O；遍历顺序由 `CADENCE_NODES` 常量序与排序后的时刻序决定。
 * 同 (industry, scale, seed) 的 `generateBattery` 输出 ⇒ 本文件输出字节一致。
 */
import {
  CadenceSchema,
  DerivedDataModeSchema,
  cadenceWaitStep,
  chainNodeDef,
  expectedCadenceWaitDays,
  type Cadence,
  type CadenceKind,
  type ChainStage,
  type ChainStep,
  type DerivedDataMode,
} from "@platform/contracts";
import { BATTERY_SOLVER_PARAMS, type GeneratedBattery } from "./battery.js";
import { maintWindowsFor } from "./tsgen.js";

const DAY_MS = 86400000;

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 唯一一支推导函数（不许任何地方再写第二份间隔公式）
// ══════════════════════════════════════════════════════════════════════════

/** 推不出节拍的机器可读原因。诚实缺席要说清「为什么空」，否则空和坏分不开。 */
export const CADENCE_EMPTY_REASONS = [
  /** 全仓没有任何承载该环节发生时刻的集合（连查都没得查）。 */
  "NO_CARRIER",
  /** 有集合，但凑不出哪怕一个间隔（每组少于两次发生）。 */
  "NO_INTERVAL",
  /** 有多个间隔但不等长 ⇒ 那是一串**事件**，不是一个**节拍**。 */
  "NON_UNIFORM",
] as const;
export type CadenceEmptyReason = (typeof CADENCE_EMPTY_REASONS)[number];

/**
 * 从「同一实体的连续发生时刻」推导节拍周期。**全仓唯一实现**。
 *
 * 判据（刻意保守 —— 宁可 EMPTY，不可凑数）：
 *  · 每组内按时刻**去重后升序**取相邻差；差为 0 的重复时刻不产生间隔。
 *    诚实边界：种子的时刻字段只带到**日**（`ShiftPlan` 里一天真有白/夜两班，但没有班次起始时刻），
 *    故日内节拍在今天的数据上**推不出来**，不许靠"一天两条 ⇒ 0.5 天"倒推 —— 那是在补种子没有的信息。
 *  · 所有组的间隔**汇总**后必须**全部相等且 > 0**，才认定为节拍。
 *    不等长 ⇒ `NON_UNIFORM`：那是一串发生记录，把它平均成一个数就是编数。
 *  · 一个间隔都没有 ⇒ `NO_INTERVAL`。
 *
 * 为什么允许「跨组汇总」：13 个基地各自只有 2 次检修窗（各贡献 1 个间隔），
 * 但 13 个间隔全等 ⇒ 这是同一个节拍的 13 次独立取样，比单组 3 个点的证据更强。
 */
export function deriveIntervalDays(
  groups: readonly (readonly string[])[],
): { ok: true; everyDays: number; intervalCount: number } | { ok: false; reason: CadenceEmptyReason } {
  const intervals: number[] = [];
  for (const g of groups) {
    const ms = [...new Set(g)]
      .filter((d) => d.length > 0)
      .map((d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (let i = 1; i < ms.length; i++) intervals.push((ms[i]! - ms[i - 1]!) / DAY_MS);
  }
  if (intervals.length === 0) return { ok: false, reason: "NO_INTERVAL" };
  const first = intervals[0]!;
  if (first <= 0) return { ok: false, reason: "NON_UNIFORM" };
  if (intervals.some((d) => d !== first)) return { ok: false, reason: "NON_UNIFORM" };
  return { ok: true, everyDays: first, intervalCount: intervals.length };
}

/**
 * 相位（`offsetDays`）= 首次发生相对种子纪元的周期内偏移。
 * 纪元取种子自己的 `BATTERY_SOLVER_PARAMS.forecastStart` —— 整个 battery 种子都以它为原点，
 * 不另立一个纪元（另立就会出现「同一批数据两套零点」）。
 * 数学上取非负取模，保证落在 `[0, everyDays)`（契约 §2 的硬约束）。
 */
function derivePhaseDays(groups: readonly (readonly string[])[], everyDays: number): number | undefined {
  const all = groups
    .flat()
    .filter((d) => d.length > 0)
    .map((d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`))
    .filter((n) => Number.isFinite(n));
  if (all.length === 0) return undefined;
  const t0 = Date.parse(`${String(BATTERY_SOLVER_PARAMS.forecastStart)}T00:00:00Z`);
  if (!Number.isFinite(t0)) return undefined;
  const deltaDays = (Math.min(...all) - t0) / DAY_MS;
  const phase = ((deltaDays % everyDays) + everyDays) % everyDays;
  // 取模的浮点尾差会把 offsetDays 顶到 everyDays 上（违反 schema 的 < everyDays）——夹回 0。
  return phase >= everyDays ? 0 : phase;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 节点登记表（只声明「证据在哪」，不声明「值是多少」）
// ══════════════════════════════════════════════════════════════════════════

/** 取证记录：这个节点的节拍是从哪儿来的 / 为什么查不到（R13 可溯源，EMPTY 也要可溯源）。 */
export type CadenceEvidence =
  | {
      readonly kind: "SERIES";
      /** `GeneratedBattery` 上的集合名（人读 + 可回查种子）。 */
      readonly collection: string;
      /** 用作发生时刻的字段。 */
      readonly instantField: string;
      /** 分组键；`null` = 全体构成单一序列。 */
      readonly groupField: string | null;
      /**
       * 该集合是否被 `synthetic/service.ts` 的 `putAll` 物化为可查询对象类型。
       * `null` = **只在生成器里、没落对象库** —— 这是真实的诚实边界，不许含糊过去：
       * 下游若想按对象查节拍源，这几个查不到。
       */
      readonly materializedAsObjectType: string | null;
    }
  | {
      readonly kind: "NONE";
      /** 查过什么、为什么不算承载。空态也必须留下取证痕迹，否则「没查」和「查了没有」分不开。 */
      readonly probed: string;
    };

export interface CadenceNodeDef {
  /** **必须是 `CHAIN_NODE_REGISTRY` 在册 id**；`label`/`stage` 由它经注册表派生，本表不再各存一份。 */
  readonly nodeId: string;
  readonly kind: CadenceKind;
  readonly evidence: CadenceEvidence;
  /** 从种子取该节点的发生时刻分组序列；`evidence.kind === "NONE"` 时为 `null`。 */
  readonly extract: ((g: GeneratedBattery) => string[][]) | null;
  /**
   * 这个周期是否**产品流要等的闸门**。
   *
   * ⚠ 这条不是可有可无的分类字段，是**防注入假前置期**的闸：
   * `expectedCadenceWaitDays = everyDays/2` 的推导前提是「工作到达后要等下一次开闸」。
   * 周期性**停机**（检修窗）满足「周期」却不满足这个前提 —— 产品不是在等检修开始，
   * 检修是挡住产品。把它当闸门摊进 `ChainStep`，会给全链凭空加一段
   * 「等 38.5 天」的非增值时间，然后被 E1 归因成 Top1 损失 —— 一个看着很有道理的假数字。
   * 故：`false` 的节点**照样推导、照样留证据**（它是真周期，值得被看见），
   * 但 `cadenceChainSteps()` **不为它产环节**。
   */
  readonly flowGate: boolean;
  /** 人读的口径说明（进交付说明与本体回写，别只留代码）。 */
  readonly note: string;
}

/** 从一组 `Record<string, unknown>` 按 `groupField` 分组、取 `instantField` 的字符串序列。 */
function seriesOf(rows: readonly Record<string, unknown>[], instantField: string, groupField: string | null): string[][] {
  if (groupField === null) return [rows.map((r) => String(r[instantField] ?? ""))];
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const k = String(r[groupField] ?? "");
    let bucket = by.get(k);
    if (!bucket) {
      bucket = [];
      by.set(k, bucket);
    }
    bucket.push(String(r[instantField] ?? ""));
  }
  // 组序按键排序 ⇒ R6：不依赖 Map 插入序（虽然 JS Map 有序，但显式排序才是契约）。
  return [...by.keys()].sort().map((k) => by.get(k)!);
}

/**
 * 全链限流环节登记表。**顺序即输出顺序**（R6）。
 *
 * 工单点名的 7 个环节全部在册，**含 4 个查不到证据的** —— 查不到也必须在册并标 EMPTY，
 * 否则「没做」和「做了但数据没有」在结果里长得一模一样（本仓最恨这个）。
 * 另加 `maint_window`：工单没点名，但它是种子里证据最硬的一个真周期（13 次独立取样）。
 * 它 `flowGate: false` —— 推它、留证据、**不摊进链路**，理由见 `CadenceNodeDef.flowGate`。
 */
export const CADENCE_NODES: readonly CadenceNodeDef[] = [
  {
    nodeId: "demand.consensus",
    kind: "meeting",
    evidence: {
      kind: "SERIES",
      collection: "sopVersionRows",
      instantField: "date",
      groupField: null,
      materializedAsObjectType: "SopVersionRow",
    },
    extract: (g) => seriesOf(g.sopVersionRows, "date", null),
    flowGate: true,
    note:
      "证据 = 种子里 S&OP 版本演进 V1→V7 的真实落期序列（`battery.ts` sopVersionRows，已 putAll 物化为 SopVersionRow 对象）。" +
      "⚠ 本仓 S&OP 有**两套并存的周期口径**，此处取前者。后者的真实状况如下 —— 初稿我曾判它『零实例』，" +
      "追一层后发现判错，按铁律 0.5 更正并留证：" +
      "① 【本节点采用】`SopVersionRow`：标准种子恒有 4 行且等距 ⇒ 可推。" +
      "② 【已知但推不了，不是没有】`SopVersion`（`sop.ts` 以 `month` YYYY-MM 为键，`opsteam/schedule.ts:216 nextMonth()` 按月开版）：" +
      "标准 demo 种子下确实零实例，**但** `livedin/engine.ts:640` 在出厂配置 `livedIn=true` 时会铺 12 个月版本" +
      "（`createdAt = <month>-25`）⇒ 它**有真实例**，说它是空承载是错的。之所以本节点不取它：" +
      "自然月的相邻间隔是 28/30/31 天**不等长**，而 `Cadence.everyDays` 是单个 number，" +
      "**表达不了『每月』这种日历周期**。把它平均成 30 就是编数 —— 那是 S0 契约的表达力缺口，" +
      "该由契约补（如 `everyMonths` 或 `anchor: monthly`），不该由我在种子侧糊一个平均值绕过去。",
  },
  {
    nodeId: "order.review",
    kind: "meeting",
    evidence: {
      kind: "NONE",
      probed:
        "查 Order/OrderLine/OrderPromise 三个订单侧集合：Order 只有 due(交期)/status，OrderLine 只有 lineStatus，" +
        "OrderPromise 只有 promiseDate(ATP 承诺日) 与 asOf(快照时刻，全表同值) —— 三者都是**单据自身的日期**，" +
        "没有任何『评审这件事发生在哪些时刻』的记录。另查全仓 `评审` 18 处：全是求解器/规则名与文案，无事件序列。",
    },
    extract: null,
    flowGate: true,
    note: "无承载 ⇒ EMPTY。补法不是在这里编一个周期，是先有订单评审事件对象（谁在哪天评了哪批单）。",
  },
  {
    nodeId: "capacity.schedule",
    kind: "batch",
    evidence: {
      kind: "SERIES",
      collection: "productionSchedules",
      instantField: "scheduledDate",
      groupField: "woId",
      materializedAsObjectType: null,
    },
    extract: (g) => seriesOf(g.productionSchedules, "scheduledDate", "woId"),
    flowGate: true,
    note:
      "证据 = 同一工单下相邻排产行的落期间隔（按 woId 分组）。" +
      "诚实边界：ProductionSchedule 属 `service.ts` 明列的『高量低值执行类保持模型态不物化』 ⇒ **生成器里有、对象库里没有**，下游按对象查不到源。",
  },
  {
    nodeId: "material.mrp",
    kind: "batch",
    evidence: {
      kind: "NONE",
      probed:
        "查 `mrp_netting` 求解器（`catalog.ts:83`）：按需 invoke，无任何调度登记（`scheduler.register` 的 jobType 只有 " +
        "SCHEDULED_FORECAST / SOP_AUTO_OPEN / APPROVAL_REMINDER / CONNECTOR_SYNC，无 MRP）。" +
        "再查 MaterialBalance 种子：只有 netDemandTon/ltaPct/gapTon/etaDate，etaDate 是**到货日**不是**跑批日**，且 8 条互不等距。",
    },
    extract: null,
    flowGate: true,
    note: "无承载 ⇒ EMPTY。注意 etaDate 看着像个日期序列，但口径是到货不是跑批，拿它当 MRP 节拍就是口径错标。",
  },
  {
    nodeId: "capacity.qc_batch",
    kind: "batch",
    evidence: {
      kind: "SERIES",
      collection: "wipQualityCheckpoints",
      instantField: "checkTime",
      groupField: "lotId",
      materializedAsObjectType: null,
    },
    extract: (g) => seriesOf(g.wipQualityCheckpoints, "checkTime", "lotId"),
    flowGate: true,
    note:
      "证据 = 同一在制批(lotId)相邻质检点的间隔。" +
      "诚实边界二条：① WIPQualityCheckpoint 未物化为对象；② 只有约半数批次有 ≥2 个检查点（其余只 1 个、不贡献间隔），" +
      "故这是**有间隔的那部分批次**的一致节拍，不是全体批次的。",
  },
  {
    nodeId: "material.shipping",
    kind: "shipping",
    evidence: {
      kind: "SERIES",
      collection: "interBaseTransfers",
      instantField: "dispatchDate",
      groupField: null,
      materializedAsObjectType: "InterBaseTransfer",
    },
    extract: (g) => seriesOf(g.interBaseTransfers, "dispatchDate", null),
    flowGate: true,
    note:
      "有集合但**推不出节拍**：`dispatchDay = 1 + (hash/1000 % 20)`（`battery.ts`）是哈希散布、不是周期 ⇒ 间隔不等长 ⇒ NON_UNIFORM。" +
      "另查 Shipment：只有 `etaDay = randInt(2,16)`（**在途时长**）与 `coverageDays`（在途覆盖天数），两者都不是『多久发一次』，口径不同不可挪用。",
  },
  {
    nodeId: "order.settlement",
    kind: "settlement",
    evidence: {
      kind: "NONE",
      probed:
        "查财务侧四处：① `Customer.termDays`（`battery-extended.ts:455/464`）有真值，但口径是**账期**（发票到回款的允许时长），不是开票频率；" +
        "② `ARInvoice` 只有 invoiceId/custName/amount/overdueDays，**无开票日期**；" +
        "③ `DSO.period` 只有单一取值（季度标签），单值构不成序列；" +
        "④ 全仓（除本文件外）`月结` 0 命中；`开票` 仅 3 处 = 1 处字段中文名（`Customer.wipUnbilled` 未开票在制金额）+ 2 处求解器注释，" +
        "**无任何开票事件记录**。四处合起来：财务侧有金额、有账龄、有逾期天数，就是没有『这件事什么时候发生』。",
    },
    extract: null,
    flowGate: true,
    note: "无承载 ⇒ EMPTY。特别记一笔：termDays 是本节点最容易被误用的诱饵——账期 ≠ 结算节拍，挪用即口径错标（本仓刚修过差 1e4 的同族错标）。",
  },
  {
    nodeId: "capacity.maint",
    kind: "batch",
    evidence: {
      kind: "SERIES",
      collection: "maintPlans",
      instantField: "window.start",
      groupField: "baseId",
      materializedAsObjectType: "MaintPlan",
    },
    // 复用 `tsgen.ts` 的 `maintWindowsFor` 展开两次检修窗，**不在这里重写一遍 (week-1)*7 的换算**
    // （同一支公式存两份正是本仓要根治的病）。
    extract: (g) =>
      [
        ...maintWindowsFor(
          g.maintPlans.map((m) => ({ baseId: String(m.baseId), week: Number(m.week), lastMaintStart: String(m.lastMaintStart) })),
          String(BATTERY_SOLVER_PARAMS.forecastStart),
        ).entries(),
      ]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([, windows]) => windows.map((w) => w.start)),
    flowGate: false,
    note:
      "工单未点名、但证据最硬的一条：每个基地种子里恰有两次检修窗（历史 lastMaintStart + 预测 (week-1)×7），" +
      "13 个基地各贡献 1 个间隔且**全部等长** ⇒ 13 次独立取样支持同一个周期，证据强度全表最高。" +
      "但 `flowGate: false`：检修窗是周期性**停机**（挡住产品），不是产品排队去等的**闸门**，" +
      "`everyDays/2` 的等待期望语义对它不成立 —— 摊进 ChainStep 会凭空给全链加一段『等 38.5 天』的非增值时间，" +
      "再被 E1 归因成 Top1 损失。**它是真周期，但不是产品流的等待**，两件事必须分开。",
  },
];

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 种子产出
// ══════════════════════════════════════════════════════════════════════════

/** 一个节点的节拍种子结果。判别联合 —— 消费方**必须**先分支再取值，拿不到"顺手当 0 用"的口子。 */
export type CadenceSeedRow =
  | {
      readonly nodeId: string;
      readonly label: string;
      readonly stage: ChainStage;
      /** 合成种子推导而来（非真导入）⇒ 复用派生侧诚实位单源词表，不新造第三套。 */
      readonly dataMode: Extract<DerivedDataMode, "SYNTHETIC">;
      readonly cadence: Cadence;
      /** 支撑该周期的间隔取样数（证据强度，前端可据此标"证据薄"）。 */
      readonly intervalCount: number;
      /** 是否产品流要等的闸门（见 `CadenceNodeDef.flowGate`）。`false` = 真周期但不摊进链路。 */
      readonly flowGate: boolean;
      readonly evidence: CadenceEvidence;
      readonly note: string;
    }
  | {
      readonly nodeId: string;
      readonly label: string;
      readonly stage: ChainStage;
      /** 诚实缺席。**不是 0、不是默认节拍**。 */
      readonly dataMode: Extract<DerivedDataMode, "EMPTY">;
      readonly cadence: undefined;
      readonly reason: CadenceEmptyReason;
      readonly flowGate: boolean;
      readonly evidence: CadenceEvidence;
      readonly note: string;
    };

/**
 * 从合成种子推导全链节拍。纯函数（R6）。
 *
 * 每一条 DERIVED 结果都过一遍**真 `CadenceSchema.parse`**：数据半自己先按引擎半的契约验一次，
 * 而不是等到 E4 消费时才炸——「形状对不上」要在产出侧就红。
 */
export function deriveChainCadences(g: GeneratedBattery): CadenceSeedRow[] {
  const out: CadenceSeedRow[] = [];
  for (const def of CADENCE_NODES) {
    // label/stage **一律经注册表派生**（单源）。不在册即抛：宁可炸，也不给一个自造的节点名——
    // 「两个 dev 各发明一套 nodeId」正是本模块此前零消费方的真因（见契约 §2.5）。
    const reg = chainNodeDef(def.nodeId);
    if (reg === undefined) {
      throw new Error(`CADENCE_NODES: nodeId "${def.nodeId}" 不在 CHAIN_NODE_REGISTRY 在册（禁止自由串 nodeId）`);
    }
    const base = {
      nodeId: reg.nodeId, label: reg.label, stage: reg.stage as ChainStage,
      flowGate: def.flowGate, evidence: def.evidence, note: def.note,
    } as const;
    if (def.extract === null) {
      out.push({ ...base, dataMode: DerivedDataModeSchema.enum.EMPTY, cadence: undefined, reason: "NO_CARRIER" });
      continue;
    }
    const derived = deriveIntervalDays(def.extract(g));
    if (!derived.ok) {
      out.push({ ...base, dataMode: DerivedDataModeSchema.enum.EMPTY, cadence: undefined, reason: derived.reason });
      continue;
    }
    const offsetDays = derivePhaseDays(def.extract(g), derived.everyDays);
    const cadence = CadenceSchema.parse({
      everyDays: derived.everyDays,
      ...(offsetDays === undefined ? {} : { offsetDays }),
      kind: def.kind,
    });
    out.push({
      ...base,
      dataMode: DerivedDataModeSchema.enum.SYNTHETIC,
      cadence,
      intervalCount: derived.intervalCount,
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 消费口（引擎半从这里取；EMPTY 一律拿到空，绝无兜底）
// ══════════════════════════════════════════════════════════════════════════

/** 取某节点的节拍。**EMPTY / 未登记 ⇒ `undefined`**，调用方必须自己处理缺席。 */
export function cadenceOfNode(rows: readonly CadenceSeedRow[], nodeId: string): Cadence | undefined {
  return rows.find((r) => r.nodeId === nodeId)?.cadence;
}

/**
 * 取某节点的**等待期望**（天）。
 *
 * · 有节拍 ⇒ 走契约的**唯一公式** `expectedCadenceWaitDays`（= everyDays/2），本文件不另算一遍。
 * · 无节拍 ⇒ **`null`**。这里绝不返回 0：0 的语义是「随到随办」，
 *   把「不知道」渲染成「不用等」，正是本仓要根治的静默兜底。
 */
export function cadenceWaitDaysOfNode(rows: readonly CadenceSeedRow[], nodeId: string): number | null {
  const c = cadenceOfNode(rows, nodeId);
  return c === undefined ? null : expectedCadenceWaitDays(c);
}

/**
 * 把**流闸门**节点摊成 S0 契约的等节拍环节 `ChainStep[]`（供 E4 推演 / E1 归因 / F1 线路图取用）。
 * `days` 由契约构造器 `cadenceWaitStep()` 产出，本文件**不手填**（手填就会有第二份公式）。
 *
 * 两类节点**不产环节**（都是为了不往全链塞假时间）：
 *  · `dataMode === "EMPTY"` —— 不产 `days: 0` 的占位段（下游会当成"这段不耗时"的真值）；
 *  · `flowGate === false`  —— 周期性停机不是产品在等的闸门（见 `CadenceNodeDef.flowGate`）。
 */
export function cadenceChainSteps(rows: readonly CadenceSeedRow[]): ChainStep[] {
  const steps: ChainStep[] = [];
  for (const r of rows) {
    if (r.cadence === undefined || !r.flowGate) continue;
    steps.push(cadenceWaitStep({ stepId: `${r.nodeId}__cadence`, nodeId: r.nodeId, cadence: r.cadence, label: r.label }));
  }
  return steps;
}

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 落库口 —— 让节拍**离开本模块**（此前缺的就是这一段）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 把推导结果摊平成可落库的对象行（`synthetic/service.ts` 经 `putAll("Cadence", …, "nodeId")` 物化）。
 *
 * ⚠ 本函数是**这个模块此前唯一缺的东西**，也是它此前零生产调用方的直接原因：
 * `deriveChainCadences` / `cadenceOfNode` / `cadenceChainSteps` 全都实现了、单测也全绿，
 * 但没有任何一条路径把结果**写出去**，于是运行态 `GET /a/v1/objects?type=Cadence` 恒为 0 条，
 * 而下游（E1 归因 / E4 推演 / F1 线路图）只能从对象库取数 ⇒ 整条节拍链断开。
 * 这是「实现有、测试有、且是绿的，零生产调用方」的教科书形态：**测试咬的是函数，不是链路**。
 *
 * 摊平而非存嵌套对象：与本仓其余种子对象一致（全是扁平 record），使 `Cadence` 可被
 * 对象查询/规则 DSL/派生按字段取用。消费侧重建 `Cadence` 走 `cadenceFromProps()`，不各自拼。
 *
 * **EMPTY 行照样输出**：诚实缺席要能被查询到（带 `emptyReason`），
 * 否则「查过没有」和「压根没登记」在下游分不开 —— 那正是本仓反复栽跟头的地方。
 */
export function cadenceObjectRows(rows: readonly CadenceSeedRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    nodeId: r.nodeId,
    label: r.label,
    stage: r.stage,
    dataMode: r.dataMode,
    flowGate: r.flowGate,
    note: r.note,
    ...(r.cadence === undefined
      ? { emptyReason: r.reason }
      : {
          everyDays: r.cadence.everyDays,
          ...(r.cadence.offsetDays === undefined ? {} : { offsetDays: r.cadence.offsetDays }),
          cadenceKind: r.cadence.kind,
          intervalCount: r.intervalCount,
        }),
  }));
}

/**
 * 从落库后的扁平 props 重建 `Cadence`。**消费侧唯一入口**（禁止各自 `{everyDays: p.everyDays}` 拼）。
 * 走真 `CadenceSchema.parse`：库里的行若形状坏了，在读侧就红，不带着坏值往下游跑。
 * `dataMode !== "SYNTHETIC"`（诚实缺席）⇒ `undefined`，**不是 0**。
 */
export function cadenceFromProps(props: Record<string, unknown>): Cadence | undefined {
  if (props.dataMode !== DerivedDataModeSchema.enum.SYNTHETIC) return undefined;
  if (typeof props.everyDays !== "number") return undefined;
  return CadenceSchema.parse({
    everyDays: props.everyDays,
    ...(typeof props.offsetDays === "number" ? { offsetDays: props.offsetDays } : {}),
    kind: props.cadenceKind,
  });
}
