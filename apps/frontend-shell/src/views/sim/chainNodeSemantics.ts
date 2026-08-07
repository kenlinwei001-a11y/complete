import { CHAIN_NODE_REGISTRY, type ChainNodeDef } from "@platform/contracts";

/**
 * WO-NODE-SEMANTICS · 节点语义常量表：`pos`（这环节在干什么）+ `cf`（跨节点冲突）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ **这是编辑口径，不是引擎下发** ⚠⚠
 * ══════════════════════════════════════════════════════════════════════════════
 * 本文件里没有一个字来自后端载荷。`pos` 是人写的一句白话；`cf` 是人从代码里读出来的耦合。
 * 面板必须把这件事当面说清（`SEMANTICS_ORIGIN_NOTE` 常驻上屏），
 * 绝不让它和 `chain_loss_attribution` 的 R13 证据混成"看着都是系统给的"。
 *
 * ── 为什么必须单独一个文件、且键必须 ⊆ 契约注册表（本仓栽过的坑 #99）────────────
 * S0 首版把 `nodeId` 冻成自由串且**无单源册**，D1 与 E1 两个 dev 各自发明了一套全链节点词表，
 * **交集为 0**，两边单测全绿而链路整条断开。前端再写第三套，就是把那个洞焊死。
 * 故本表：
 *  ① 键的类型 = `RegisteredChainNodeId`（**派生自 `CHAIN_NODE_REGISTRY` 的字面量联合**）——
 *     写一个不在册的键 `tsc` 当场红（编译期包含关系），不用等运行时；
 *  ② 另有运行时门 `node-semantics.seam.test.tsx` 断言 `keys ⊆ CHAIN_NODE_IDS`（双保险）；
 *  ③ 用 `Partial<…>`：注册表里有、这里没写语义的节点 → `undefined` → 面板**整块不渲染**
 *     （不是渲染一个空壳）。有另一条单正在把注册表从 12 扩到 24，扩表**不会**让本文件红，
 *     也不会在屏上多出一堆空区块 —— 这就是"优雅降级"的机器判据。
 * ④ **注释里不裸写 nodeId**：既有门会扫源码里的节点 id 字面量，连注释都算。
 *    要指某个节点时一律说它的人读名（`label`，也来自同一张册）。
 *
 * ── `cf` 的准入线（比 `pos` 严得多）─────────────────────────────────────────────
 * 每条 `cf` 必须能在代码里**指出依据**（`basis` 逐条给 `file:line`，复验方可直接翻到）。
 * 指不出依据的一条都不许写 —— 设计稿里有几条听着很对的跨节点冲突，实测查下去没有承载，
 * 那种"看着合理"正是本仓要根治的东西。已被本单**否掉**的一条记在这里备查：
 *  ✗ 「补货段的供应商周期同时决定库存目标水位」——`inventory_optimize` 的目标水位读的是
 *    `Material.leadTime`（`apps/datacore/src/solvers/extended.ts:269`），
 *    而损失归因读的是 `Supplier.leadTime`（`apps/datacore/src/solvers/chain-loss.ts:506`）。
 *    **两个对象、两个字段**，不是同一个旋钮 ⇒ 这条冲突不成立，删掉。
 */

/**
 * 在册节点 id 的字面量联合。`CHAIN_NODE_REGISTRY` 是 `as const`，故这里拿到的是
 * 12 个字面量的并（注册表一扩，这个联合自动跟着扩）—— 本表键的**编译期**包含关系判据。
 */
export type RegisteredChainNodeId = ChainNodeDef["nodeId"];

/** 一条跨节点冲突。`basis` 为空即视为无依据，由门直接判红。 */
export interface ChainNodeConflict {
  /** 稳定 id（测试与 DOM 用；与节点 id 无关，不参与任何 id 词表）。 */
  readonly conflictId: string;
  /** 改这里会连累谁（一句话讲清耦合，别只写"有影响"）。 */
  readonly text: string;
  /** 依据：`file:line` 级，逐条可翻。**指不出来就不许写这条冲突**。 */
  readonly basis: readonly string[];
}

export interface ChainNodeSemantics {
  /** 这环节在干什么，一句白话。 */
  readonly pos: string;
  /** 跨节点冲突。没有能指出依据的冲突 ⇒ **整个字段省掉**（不给空数组，空数组会渲染出一个空壳）。 */
  readonly cf?: readonly ChainNodeConflict[];
}

/** 常驻上屏的来源声明 —— 让"人写的口径"与"引擎下发的证据"在屏上永远分得开。 */
export const SEMANTICS_ORIGIN_NOTE =
  "本区块是**编辑口径**（人写的），不是引擎下发：后端今天没有节点定位与跨节点冲突这两个字段。" +
  "跨节点冲突逐条附代码依据（file:line），指不出依据的一条都没写；本节点若没写语义，本区块整块不出现，不留空壳。";

/**
 * 语义表。**只为在册节点写**——设计稿里另外那批尚未在册的节点一个都不提前写
 * （注册表真扩了再补，另立单；提前写等于又在前端立第二套词表）。
 */
export const CHAIN_NODE_SEMANTICS: Partial<Record<RegisteredChainNodeId, ChainNodeSemantics>> = {
  "demand.consensus": {
    pos: "产销财三方把「下个周期要做多少」谈拢并冻结。它是到点才办的闸门——制造的是等待，不是产出。",
    cf: [
      {
        conflictId: "cf-cashfloor-shared",
        text:
          "这里把现金垫底线（规则 C18 的命名阈值 cashFloor）调高，主计划排产那边的方案会被**同一条硬约束**打回：" +
          "一个旋钮投影到两个求解器参数路径（S&OP 版本校验的 cashOk 判据 ⊕ 计划生成的硬违约 C18），改一处即改两处判定。",
        basis: [
          "packages/contracts/src/datacore.ts:206（C18.cashFloor → solver_params `sop.cashFloor`）",
          "packages/contracts/src/datacore.ts:207（同一条 C18.cashFloor → `planGenerate.targets.cashFloor`，注释原文「两处必须同源，否则同一条规则的两个消费方各说各话」）",
          "apps/datacore/src/sop.ts:299（`const cashOk = cashCushion >= params.sop.cashFloor;`）",
          "apps/datacore/src/solvers/plan.ts:292（`if (hard.cash && outcome.cash < targets.cashFloor) hardViol.push(\"C18\");`）",
        ],
      },
    ],
  },

  "order.review": {
    pos: "对一张进来的订单做交期判、齐套判、财务判，决定接不接、承诺哪一天交。",
  },

  "order.cash": {
    pos: "货交出去之后，等客户按账期把钱付回来。这一段不动货、只动现金，全链最长的一段等待通常在这里。",
    cf: [
      {
        conflictId: "cf-termdays-not-settlement-cadence",
        text:
          "客户账期（Customer.termDays）**只承载本节点的回款等待**，不是开票对账那个节点的结算节拍。" +
          "两个节点都跟钱有关、字段看着可以互换，挪用即口径错标——开票对账的节拍今天在载荷里诚实标 EMPTY，" +
          "不是「没人填」，是仓里根本没有「这件事什么时候发生」的记录。",
        basis: [
          "apps/datacore/src/synthetic/cadence.ts:313（查财务侧四处的取证原文：termDays 口径是账期，不是开票频率）",
          "apps/datacore/src/synthetic/cadence.ts:321（原文「termDays 是本节点最容易被误用的诱饵——账期 ≠ 结算节拍，挪用即口径错标」）",
          "apps/datacore/src/solvers/chain-loss.ts:424（本节点段天数真读的就是 Customer.termDays）",
        ],
      },
    ],
  },

  "order.settlement": {
    pos: "把已交付的量与客户对账并开票，按月结节拍集中处理，不是随交随开。",
    cf: [
      {
        conflictId: "cf-settlement-cadence-empty",
        text:
          "想给本节点标一个结算周期，最顺手的那个数（客户账期）是**诱饵**：它是发票到回款的允许时长，不是开票频率。" +
          "拿它当本节点的节拍，会把回款那一段的等待在全链里算第二遍。今天本节点的节拍诚实缺席，" +
          "补它要先有「开票事件」这个记录，不是换个字段凑一个。",
        basis: [
          "apps/datacore/src/synthetic/cadence.ts:308（本节点的节拍取证条目）",
          "apps/datacore/src/synthetic/cadence.ts:313（四处取证：ARInvoice 无开票日期 / DSO 单值 / 全仓无开票事件）",
          "apps/datacore/src/synthetic/cadence.ts:321（诱饵原文）",
        ],
      },
    ],
  },

  "capacity.schedule": {
    pos: "把已承诺的订单摊到未来的产线与班次上，决定谁先做、谁后做。到点才排，所以急单最快也要等下一次排产。",
    cf: [
      {
        conflictId: "cf-cashfloor-shared",
        text:
          "本节点的计划被规则 C18 的现金垫底线硬约束住，而**同一个 cashFloor 旋钮**也是 S&OP 共识会那边版本校验的判据：" +
          "在共识会上调它，这里的方案会跟着被判硬违约。两处必须同源，否则同一条规则的两个消费方各说各话。",
        basis: [
          "packages/contracts/src/datacore.ts:206-207（同一条 C18.cashFloor 投影到两个 solver_params 路径）",
          "apps/datacore/src/solvers/plan.ts:292（本侧消费：硬违约 C18）",
          "apps/datacore/src/sop.ts:299（对侧消费：S&OP cashOk）",
        ],
      },
    ],
  },

  "capacity.qc_batch": {
    pos: "在制品攒够一批才送检。攒批本身不改变产品，只把它压在原地等——等待期望 = 攒批周期 ÷ 2。",
  },

  "capacity.quality": {
    pos: "判不合格并把它送回去重做。返工的真实成本不在返工本身，在它挤掉了谁的产能。",
  },

  "capacity.aging": {
    pos: "电芯下线后在库位上静置一段时间让性能稳定。产品形态不变，占的是库位不是工时，所以它是等待不是作业。",
    cf: [
      {
        conflictId: "cf-agingdays-two-consumers",
        text:
          "静置天数（Process.agingDays）是**同一个数的两个消费方**：一边是本节点这一段的天数（1:1 直接就是天），" +
          "另一边是老化库位的单元速率（占用天数口径 ⇒ 单元日通过量 = 1/静置天数 ⇒ 老化工序硬容量），" +
          "再被规则 C02 当作卡点判定的实测值。把静置期从 5 天压到 3 天，本节点少 2 天，" +
          "老化工序硬容量同时被抬高 5/3 倍；反过来延长静置期会**同时**制造损失与制造卡点。" +
          "这两件事今天在屏上是分开显示的，改一个数会同时动。",
        basis: [
          "packages/contracts/src/process-capacity.ts:60（老化库位规格：unitsProp=agingSlots · rateProp=agingDays · rateKind=occupancyDays）",
          "packages/contracts/src/process-capacity.ts:106（`spec.rateKind === \"occupancyDays\" ? 1 / rate : rate` —— 占用天数取倒数）",
          "packages/contracts/src/process-capacity.ts:115（`capacityPerDay: units * unitDailyThroughput * yieldFactor`）",
          "apps/datacore/src/solvers/chain-impediment.ts:107-120（C02 卡点判据的实测值 = readProcessHardCapacity().capacityPerDay）",
          "apps/datacore/src/solvers/chain-loss.ts:37（本节点这一段的天数直接取 Process.agingDays，归类 queue）",
        ],
      },
    ],
  },

  "capacity.maint": {
    pos: "按计划停机检修。这段时间产线不产出，是被主动让出去的产能。",
    cf: [
      {
        conflictId: "cf-maint-not-a-flow-gate",
        text:
          "本节点的检修周期是全表证据最硬的一条真周期（13 个基地各贡献一个等长间隔），" +
          "但它**按设计不进全链环节**：检修窗挡住的是产品、不是产品排队去等的闸门，" +
          "等待期望那套公式对它不成立。⇒ 在这里调周期**不会**改动全链前置期读数，改的是产能侧。" +
          "谁把它摊进环节，全链会凭空多出一段几十天的非增值时间，还会被归因成 Top1 损失。",
        basis: [
          "apps/datacore/src/synthetic/cadence.ts:337（`flowGate: false`）",
          "apps/datacore/src/synthetic/cadence.ts:344-348（原文「它是真周期，但不是产品流的等待，两件事必须分开」）",
        ],
      },
    ],
  },

  "material.mrp": {
    pos: "按 BOM 把成品需求展开成物料净需求，对冲在库与在途，算出到底缺多少。",
  },

  "material.replenish": {
    pos: "对算出来的缺口向供应商下单，然后等它到货。",
    cf: [
      {
        conflictId: "cf-supplier-leadtime-two-calibers",
        text:
          "本节点这一段用的是供应商**承诺**前置期（乐观口径），而采购计划那边对同一个字段还叠了准时率风险：" +
          "期望滑期 = 承诺天 × (1 − 准时率)，于是「期望齐套日」比屏上这一段更晚。" +
          "改承诺前置期两处一起动，但两处的数**本来就不相等**——拿本节点这一段去当采购承诺，会系统性乐观。",
        basis: [
          "apps/datacore/src/solvers/chain-loss.ts:506（本节点段天数：沿 material_supplied_by 读 Supplier.leadTime）",
          "apps/datacore/src/solvers/extended.ts:635（采购四段分解的供应商段：`source: { objectType: \"Supplier\", field: \"leadTime\" }`）",
          "packages/contracts/src/procurement.ts:291（`expectedSlipDays` = 供应商段承诺天 × (1 − onTimeRate)）",
          "packages/contracts/src/procurement.ts:295-297（`earliestKitDay` 承诺口径 vs `expectedKitDay` 含风险口径，刻意两个都给）",
        ],
      },
    ],
  },

  "material.shipping": {
    pos: "成品按班车/整柜的发运节拍集中发出，不是随到随发。",
  },
};

/** 取某节点的语义。不在表里 ⇒ `undefined`（调用方**必须**据此整块不渲染，不给空壳）。 */
export function chainNodeSemantics(nodeId: string): ChainNodeSemantics | undefined {
  return (CHAIN_NODE_SEMANTICS as Record<string, ChainNodeSemantics | undefined>)[nodeId];
}

/**
 * 覆盖率（门与面板同读一份，杜绝"面板说 8 个、门断言 9 个"）。
 * 分母一律取契约注册表当下的长度 —— 注册表扩到 24 时这个数自己会掉下来，那正是它该有的样子。
 */
export function chainNodeSemanticsCoverage(): { withSemantics: number; registered: number; missing: string[] } {
  const missing = CHAIN_NODE_REGISTRY.filter((n) => chainNodeSemantics(n.nodeId) === undefined).map((n) => n.label);
  return { withSemantics: CHAIN_NODE_REGISTRY.length - missing.length, registered: CHAIN_NODE_REGISTRY.length, missing };
}
