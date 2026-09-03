import { z } from "zod";
import { isKnownChainNodeId } from "./chain-sim.js";

/**
 * 推演沙盘契约（增量 1/3 · 行业无关 · 零业务常数 R14）。
 * 本体登记见 SYSTEM-ONTOLOGY.md §2.I / §3 / §4；落地规格见
 * docs/SPEC-sandbox-propagation-and-session.md（§1 传导核 / §2 会话表）。
 *
 * 关键：传导核只认抽象 (typeKey, stateVar, linkKey, 系数, 延迟)——喂任意租户本体即跑，
 * 行业是"喂进去的内容"不是代码。所有 state 为对象→状态变量→数值，零行业列。
 */

// ── 传导态（§1.2 · 纯数值，无行业语义） ───────────────────────────────────────
/** 对象 id → 状态变量名 → 数值。 */
export const TickStateSchema = z.record(z.string(), z.record(z.string(), z.number()));
export type TickState = z.infer<typeof TickStateSchema>;

/** 延迟贡献（delay>0 的传导排进队列，在 arriveTick 到达；resume 确定性）。 */
export const DelayedContributionSchema = z.object({
  arriveTick: z.number().int(),
  targetObjectId: z.string(),
  targetStateVar: z.string(),
  amount: z.number(),
  ruleKey: z.string(),
});
export type DelayedContribution = z.infer<typeof DelayedContributionSchema>;

/** 一条传导轨迹（喂前端"三级风险轨迹"可视化）。 */
export const PropagationTraceSchema = z.object({
  ruleKey: z.string(),
  fromObjectId: z.string(),
  toObjectId: z.string(),
  amount: z.number(),
  viaLinkKey: z.string(),
});
export type PropagationTrace = z.infer<typeof PropagationTraceSchema>;

// ── 逐实例分摊口径登记册（WO-COEF-FROM-BOM · `PropagationRule.weightRef.basis` 的取值域） ──
/**
 * **在册的分摊口径**。`weightRef.basis` 只能取这里的 `key`（禁自由串）——
 * 沿用 `cadenceNodeId` × `CHAIN_NODE_REGISTRY` 那条纪律：本仓出过「两个 dev 各发明一套
 * nodeId、交集为 0」的事故，口径名自由串迟早重演。
 *
 * 每条登记项声明三件事，缺一不可：
 *  · `key`        —— 契约两侧共用的稳定串；
 *  · `normalize`  —— 归一方向。**当前全部是 `IN_EDGES`**（Σ over 同一 target 的全部源 = 1）。
 *                    出边归一**故意不提供**，理由见 `weightRef` 字段注释的「口径」段（量纲 + 重复计账）。
 *  · `measure`    —— 这个口径拿什么当「计量值」，写成人话，供屏上与审计对照。
 *
 * ⚠ 口径的**实现**（怎么从本体里把计量值算出来）在 DataCore 侧
 * （`apps/datacore/src/sim/pair-weights.ts`），不在契约里：契约只定名字与语义，
 * 免得把 BOM 遍历这种行业知识塞进 `packages/contracts`（跨 app 共享层）。
 */
export const PAIR_WEIGHT_BASIS_REGISTRY = [
  {
    key: "bom_cost_share",
    normalize: "IN_EDGES",
    measure:
      "该 (源, 目标) 对在目标的**生效 BOM** 中的成本占比 = 单台用量 × 源单价 × (1+损耗率) ÷ 该 BOM 全部行之和。" +
      "分母取**整份 BOM**（不是图里现有入边之和）：占比必须是可审计的绝对量，" +
      "按现有入边重新归一会让「加一条链路」悄悄改掉其它每一条的权重。",
  },
  {
    key: "source_qty_relative",
    normalize: "IN_EDGES_MEAN",
    measure:
      "源实例的数量**相对于同组均值**的倍率 = 源.qty ÷ mean(该目标全部入边源的 qty)。" +
      "均值为 1、总和为 N（源的条数）—— 与 `bom_cost_share` 的「Σ=1」是两种不同的归一，别混用。",
  },
] as const;

/**
 * ⛔ **两种归一各配什么目标，判据是目标量纲，不是"看着差不多"**（WO-COEF-FROM-BOM 实测立此账）。
 *
 * | 目标量纲 | 例 | 该用哪种 | 用错会怎样 |
 * |---|---|---|---|
 * | **强度**（率/指数：`costPressure` 是成本压力百分点） | `Material→Model` 成本 | `IN_EDGES`（Σ=1 · 加权**平均**） | 用 MEAN 会让"物料种类越多、压力越大"，而涨价幅度根本没变 |
 * | **广延**（总量/负荷：`demandLoad` 是"需求负载"） | `Order→Model` 需求 | `IN_EDGES_MEAN`（均值=1 · 保总量） | 用 Σ=1 会把 83 张订单**塌缩成一张的平均**，"单越多负荷越大"这个信号直接消失 |
 *
 * 本单第一版把 `Order→Model` 也做成了 Σ=1，实测把 `Model.demandLoad` 从 8 打到 0.0989
 * （≈ 1/83）—— 那不是"按用量加权"，那是把负载重新定义成了平均值。
 * **判据一句话：目标格子回答的是「多快/多高」还是「多少」？**「多快」用 Σ=1，「多少」用均值=1。
 */
export type PairWeightNormalize = (typeof PAIR_WEIGHT_BASIS_REGISTRY)[number]["normalize"];

export type PairWeightBasisKey = (typeof PAIR_WEIGHT_BASIS_REGISTRY)[number]["key"];

const PAIR_WEIGHT_BASIS_KEYS: ReadonlySet<string> = new Set(PAIR_WEIGHT_BASIS_REGISTRY.map((b) => b.key));

/** `weightRef.basis` 是否在册。**唯一判据**——两侧共用这一支，不许各抄一份集合。 */
export function isKnownPairWeightBasis(key: string): boolean {
  return PAIR_WEIGHT_BASIS_KEYS.has(key);
}

/** 在册口径的归一方向（拿不到 ⇒ `null`，调用方据实处理，不补默认）。 */
export function pairWeightNormalizeOf(key: string): PairWeightNormalize | null {
  return PAIR_WEIGHT_BASIS_REGISTRY.find((b) => b.key === key)?.normalize ?? null;
}

// ── PropagationRule —— 一等类型（§1.1 · 系数/延迟优先引用 rule.params，G-10 P1） ──
export const PropagationRuleSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  key: z.string(), // 稳定键，可被 OPERATION_CATALOG/审计引用
  sourceTypeKey: z.string(), // 抽象——任意对象类型
  sourceStateVar: z.string(), // 抽象——任意状态变量（派生属性）
  viaLinkKey: z.string(), // 抽象——任意链路类型
  targetTypeKey: z.string(),
  targetStateVar: z.string(),
  coefficient: z.number(), // 配置·可编辑（竞品 0.85/0.7 在这）
  delayTicks: z.number().int().min(0), // 配置·可编辑（竞品"延迟1个时序"=1）
  /**
   * **这条边在业务上是什么意思**（WO-ONTOLOGY-EDGE-EDIT）——屏上「影响说明」那一列的落点。
   *
   * ── 为什么必须新加一个字段，而不是复用已有的 ────────────────────────────────
   * 候选只有 `key`，而 `key` 已经被占死了两个用途：它是**稳定键**（本字段上方原文
   * 「可被 OPERATION_CATALOG/审计引用」），且是 `listPropagationRules` 的**排序键**
   * （`repo/memory.ts` 按 `a.key < b.key` 排、`repo/pg.ts` 按 `doc->>'key'` 排）。
   * 把人话说明塞进 `key`，等于让「改一句解释文案」变成「改一个被审计引用的稳定标识 + 列表跳行」——
   * 两件毫不相干的事被同一个字节承载，正是本仓反复治的那个病。故新加。
   *
   * ⚠ **不入 migration**：`sim_propagation_rule` 是 `doc JSONB` 通用列
   * （`migrations/026_sim_sessions.sql` 建表处），整条 `PropagationRule` 序列化进 `doc`，
   * 加标量字段无需改表结构 —— 这与「新增表需同时改 migrations」那条约定不冲突，
   * 那条管的是**新表**，本字段落在既有表的既有 JSONB 列里。
   *
   * `null`（缺省）= 没写说明 ⇒ 与本字段引入前**逐字节相同**（additive · 可回退 R9）；
   * 屏上显 `—`，**不拿 `key` 顶替**（顶替就是在编一句作者没写过的解释）。
   */
  description: z.string().nullable().default(null),
  combine: z.enum(["sum", "max"]).default("sum"), // 多入边如何累加
  decay: z.object({ window: z.number().int(), den: z.number() }).nullable().default(null), // 复用 risk.ts 衰减，可空
  clamp: z.object({ min: z.number(), max: z.number() }).nullable().default(null),
  // 系数引用一条可编辑规则的 rule.params[paramKey]（G-10 P1 已落，"改规则即改推演"）；空=用内联 coefficient。
  coefficientRef: z.object({ ruleKey: z.string(), paramKey: z.string() }).nullable().default(null),
  /**
   * **逐实例分摊口径（WO-COEF-FROM-BOM）**：这条边的强度在**每一对 (源实例, 目标实例)** 上按什么口径分摊。
   *
   * ── 病灶（本字段引入前的真实行为，实测·不是推测）──────────────────────────────
   * `propagation.ts` 把 `effectiveCoefficient(rule, ruleParams)` 解析成**整条规则一个标量**，
   * 在 `for (const sourceId …)` 之前算完，然后对 `targetsOf(rule, sourceId)` 返回的**每一个**目标
   * 落**同一个** `amount`。公式 `coeff × sourceVal × factor` 里**没有任何用量项**。
   * 实测后果（demo 租户 · seed 42 · 方形-LFP）：
   * 磷酸铁锂正极占该型号 BOM 成本 **17.815%**、铝箔占 **0.920%**（差 19.4 倍），
   * 各涨 15% 却给出**逐字节相同**的 `Model.costPressure = 29.25`、逐单 `Order.costPressure = 26.325`。
   * 「用量」这个决定成本传导的第一因素，在引擎里一次都没被读过。
   *
   * ── ⛔ 为什么不复用 `coefficientRef`（两个字段是**相乘**关系，不是二选一）────────
   * `coefficientRef` 回答的是「**这条边的强度是多少、从哪条可编辑规则的哪个参数取**」——
   * 它的解析器 `effectiveCoefficient(): number` 返回**一个数**、在**源循环之外**求值，
   * 且它读的是 `rule.params`（G-10 P1「改规则即改推演」的**用户可编辑配置**）。
   * 本字段回答的是「**这一份强度在两个实例之间怎么分摊**」——按 (源实例,目标实例) 逐对求值，
   * 且它读的是**本体数据**（BOM 明细 / 订单数量），不是任何人手填的参数。
   * 把逐对权重塞进 `RuleParamLookup`（`Record<ruleKey, Record<paramKey, unknown>>`）意味着
   * 拿**对象 id 对**当 paramKey —— 那是把数据当配置，且会让「改规则即改推演」这条纪律
   * 指向一批没人编辑得了的键。故**新增字段**，与 `coefficient`/`coefficientRef` 相乘：
   *   `amount = 强度(coefficient|coefficientRef) × 分摊(weightRef) × sourceVal × decay`
   * 原来的 `0.65` 保留为**整条边的传导强度**，占比只负责分摊 —— 两件事，两个位置。
   *
   * ── 口径：**入边归一**（Σ over 同一 target 的全部源 = 1），不提供出边归一 ────────
   * 取值域见 `PAIR_WEIGHT_BASIS_REGISTRY`（本文件 §下，单源·禁自由串——照 `cadenceNodeId`
   * × `CHAIN_NODE_REGISTRY` 立下的同一条纪律）。两个在册口径都是入边归一，理由是**量纲**：
   * 本链上的 stateVar 全是**强度**（`priceShock`=涨价百分点、`costPressure`=成本压力 pp，
   * `finance_world_projection` 拿它当 `基线 ×(1 + 压力 ÷ divisor)` 的**率**用）。
   * 多源汇一目标时，按份额加权求和 = **加权平均率**，量纲自洽；
   * 而一源分多目标时（如 `Model --model_demanded_by_order--> Order`）目标拿到的是**同一个率**，
   * 分摊它反而是把一个率切成几块，量纲不成立 —— 且订单大小**已经**在下游被计过一次
   * （`finance-world.ts:219` `orderValue = qty × unitPrice` 做金额加权聚合），
   * 再在传导侧乘一次份额就是**同一个体量因子记两遍账**。故出边一律不加权、原样透传。
   *
   * ⚠ **入边归一有两种，选哪种看目标量纲**（Σ=1 还是均值=1）—— 见
   * `PairWeightNormalize` 上方那张表。选错的后果是实测出来的，不是理论担心。
   *
   * `null`（缺省）= 这条边不分摊、逐目标同额 ⇒ 与本字段引入前**逐字节相同**（additive·可回退 RL9）。
   *
   * ⚠ 声明了却**整张权重表都拿不到**（该口径所需的本体数据缺失/未物化）时，引擎
   * **既不退回 1、也不当作 0**：该规则本 tick 不传导，并进
   * `propagateTick(...).unresolvedWeights[]` 显式报缺 —— 照 `cadenceNodeId` 那条
   * 「读不回来一律 unresolved + 原因，没有『给个默认值』的分支」。
   * 退回 1 尤其危险：那正是**本字段要治的那个错行为**，却还挂着「已按用量分摊」的名义。
   * 反之，表在、而**某一对**查不到计量值 ⇒ 权重 **0**（这是算得出来的真值：
   * 「该物料不在该型号的 BOM 里 ⇒ 它占该型号 BOM 成本 0%」），并计入装配回执的 `zeroPairs`。
   */
  weightRef: z
    .object({ basis: z.string().refine(isKnownPairWeightBasis, { message: "weightRef.basis 必须是 PAIR_WEIGHT_BASIS_REGISTRY 在册口径（禁自由串）" }) })
    .nullable()
    .default(null),
  /**
   * **节拍闸门绑定（WO-SANDBOX-E4）**：这条流要过哪个全链节点的节拍闸门（`Cadence.nodeId`）。
   *
   * 为什么必须有这个字段：D1 把 `Cadence` 落成了对象（`nodeId` 主键），E4 要让 `propagateTick`
   * 「到节拍点才放行」——但**「哪条流在等哪个节拍」在全仓没有任何承载物**（三分法 = 没接线）。
   * 没有它，闸门只能靠猜（按 typeKey？按 stage？）——猜出来的绑定就是第二套真相源。
   * 故绑定做成规则上的一个**显式声明**：改这条声明 = 改推演，且可被审计看见。
   *
   * 取值受 `CHAIN_NODE_REGISTRY`（`chain-sim.ts` §2.5 单源）约束 —— 这正是 D1×E1
   * 「两个 dev 各发明一套 nodeId、交集为 0」那次事故立下的纪律，**不许自由串**。
   *
   * `null`（缺省）= 这条流不过节拍闸门 ⇒ 行为与本字段引入前**逐字节相同**（additive·可回退 RL9）。
   *
   * ⚠ 声明了却取不到该节点的可用 `Cadence`（EMPTY / 未物化）时，引擎**既不当作随到随办、也不偷偷补一个周期**：
   * 该条流不参与本 tick 传导，并进 `propagateTick(...).unresolvedGates[]` 显式报缺（照 E3
   * 「读不回来一律 unresolved + 原因，没有『给个默认值』的分支」）。
   */
  cadenceNodeId: z
    .string()
    .min(1)
    .refine(isKnownChainNodeId, {
      message: "cadenceNodeId 必须是 CHAIN_NODE_REGISTRY 在册节点或 capacity.op.<opId> 动态工序节点（禁自由串·契约 §2.5）",
    })
    .nullable()
    .default(null),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).default("DRAFT"),
  /**
   * **这条边落在哪个业务域**（WO-DISRUPTION-CARDS）—— 屏上把几十条扰动因素切成可浏览分片的**唯一依据**。
   *
   * ── 为什么这个字段必须存在（病灶）─────────────────────────────────────────────
   * 推演页把全部传导边**一次全倒在屏上**（demo 租户实测 35 条），无分类、无栅格、字号过小。
   * 分组的依据其实一直都在数据里 —— `DEMO_PROCESS_DEFINITIONS` 每条流程都带
   * `domainKey`(D01–D13) 与 `carrierTypeKey`（承载物对象类型），种子作者选边时就是照它挑的
   * （种子注释里逐条写着「承载物 MaterialBatch 即 P36」「承载物 MaintPlan 即 P50」）。
   * 但它**只躺在注释里、没进数据结构**，屏上一个字都拿不到。本字段就是把它搬进数据。
   *
   * ── ⛔ 为什么不许前端自己算（`G-GATE-ROSTER-HANDCOPIED`）───────────────────────
   * 前端手抄一份「哪条规则属于哪个域」的映射表，新增一条规则忘了加进去，它就**从分类里消失**，
   * 而没有任何东西会报错 —— 永远绿、永远漏。域必须由**产出这批边的那一侧**一次算清、随边下发。
   *
   * ── 口径：域 = **目标承载物**所属的域，不是源 ─────────────────────────────────
   * 这是种子自己的既有约定（不是本单发明）：`D09 设备与维护 · 检修窗：基地负载 → 计划检修窗挤压`
   * 的源是 `Base`(D10) 而节名写 D09 —— 取的是 target `MaintPlan` 的域。语义上也对：
   * 一条边**影响的是哪个域的活动**，才是用户按域找它时想找的东西。
   *
   * ── `null` 是**诚实缺席**，不是"忘了填"────────────────────────────────────────
   * 目标类型不是任何流程的承载物（如纯中间跳量纲）⇒ `null`，屏上单列一个「未归域」分片并说明原因。
   * **不许硬塞进最近的那个域** —— 塞了就是把"这条边的归属其实没定义"这句话抹掉。
   *
   * 缺省 `null` ⇒ 与本字段引入前**逐字节相同**（additive · 可回退 RL9）：
   * 租户经 `POST /a/v1/sim/propagation-rules` 自建的边不带域，一律进「未归域」分片。
   */
  domainKey: z.string().nullable().default(null),
  /**
   * 域的人话名（如「采购与供应」）。与 `domainKey` **在同一个函数里、从同一份登记册**派生
   * （`seed.ts` 的 `resolveRuleDomain`），不是第二套真相源；两者要么同时有、要么同时为 `null`。
   *
   * 为什么随边下发而不是让前端再取一次域登记册：面板挂在 8 个推演页上，
   * 为了 13 个域名多打一次请求不划算；更要紧的是**「屏上这条边属于哪个域」与「那个域叫什么」
   * 必须是同一次判断的产物** —— 分两处取，就有了"key 归 A 域、名字显示 B 域"的漂移空间。
   */
  domainName: z.string().nullable().default(null),
  /**
   * 源对象类型的**人话名**（`Base` → 「生产基地」），供屏上「人话名在上、系统键在下」那两级用。
   *
   * ⚠ **读时投影，不是入库字段**：`GET /a/v1/sim/propagation-rules` 每次从**本租户当下的本体**
   * （`ObjectType.displayName`）现 join 后填上。种子/`POST` 存进去的恒是 `null`，读出来的才有值 ——
   * 存一份进 doc 就会在类型改名后变成一个查无对证的旧名字（本仓治了多次的「第二套真相源」）。
   *
   * 为什么随边下发而不是让前端另取一次本体：本面板挂在 8 个推演页上，而**全仓 29 个前端测试
   * 对 `@/api/endpoints` 做部分 mock** —— 给共享面板加一个 endpoint 依赖会把它们全部打红。
   * 让这个面板只依赖一个响应，是结构上的减法，不只是省一次请求。
   *
   * `null` = 本体里查不到该类型（或本体尚未物化）⇒ 屏上**显裸键**，不渲染空白、不编名字。
   */
  sourceTypeName: z.string().nullable().default(null),
  /** 目标对象类型的人话名（口径与 `sourceTypeName` 逐条相同）。 */
  targetTypeName: z.string().nullable().default(null),
});
export type PropagationRule = z.infer<typeof PropagationRuleSchema>;

// ── 状态量的声明取值域与衰减（WO-PROP-CLAMP）───────────────────────────────────
//
// ── 病灶（实测·真后端 SEED_DEMO=1 · 零扰动空转 6 拍）────────────────────────────
// 传导核是 `next = clone(current)` + 贡献 `+=` ⇒ 每个状态量都是一支**无泄漏的纯积分器**
// `x(t+1) = x(t) + inflow(t)`。常量入流下 x 线性增长；链上第 d 跳是 d 重积分 ⇒ **O(t^d) 多项式发散**，
// 再乘上扇入（~25 张订单汇进 1 个型号）。实测：t0 全部 7204 格都在 0–100 内，
// 空转 6 拍后 **5290 格（73.4%）越界**，`loadIndex` 最大 69,134、`receivablePressure` 408,305。
// 用户扰动因此被世界自身的漂移淹没 —— 屏上那个 Δ 说明不了「有多少是我扰出来的」。
//
// ── 为什么这两件事必须一起声明，不能只加 clamp ─────────────────────────────────
// 只夹值 = 把发散**藏起来**：读数全部顶在上界、彼此不可区分，扰动再也推不动它
// （`risk.ts` 的 `saturateTension` 段头记着这个病的实测样本：硬截断让「30 个点里 8 天零信息量」）。
// 衰减才是纯积分器的**对因治疗**：`x(t+1) = rest + (1−λ)(x(t) − rest) + inflow`
// 收敛到有限稳态 `rest + inflow/λ`；夹值只负责把稳态压回量纲内、且**保序**。
//
// ⚠ **本类型只承载"声明"，不承载"默认值"**：没有声明的状态量**不夹、不衰减**，
//    并在 tick 回执里点名（`undeclaredStateVars`）。这是本仓一贯的诚实缺席 ——
//    替 40 个状态量各拍一个取值域，等于替租户下建模判断，那是另一种静默错答。
export const StateVarDomainSchema = z.object({
  /** 取值域下界（含）。 */
  min: z.number(),
  /** 取值域上界（含）。 */
  max: z.number(),
  /**
   * **静息点** —— 无入流时状态量回落到的那个值，必须 ∈ [min,max]。
   *
   * 为什么不一律取 0：`forecastBias` 是本平台唯一**带方向**的量纲（正=高估 / 负=低估，
   * 见 `STATE_VAR_DISPLAY_NAMES` 该行注释），它的静息点是 0 而下界是负数；
   * 而压力/风险类量纲的静息点就是下界 0。两者混成一个常数就会把方向量纲的负半轴整段抹掉。
   */
  restPoint: z.number(),
  /**
   * 衰减率 λ 的**引用**（照 `PropagationRule.coefficientRef` 同一范式：ruleKey + paramKey）。
   *
   * ⚠ 刻意**不允许内联一个 λ 字面量**：本仓 42 条传导边的 `coefficientRef` 实测 **0 条在用**、
   *   全部回落内联 —— 引用机制形同虚设正是这条纪律要治的病。衰减率是**可编辑的经营口径**
   *   （"一次冲击几天散掉"），必须落在规则库里改一处即改推演。
   *
   * `null`（或引用解析不到 / 取值不在 [0,1) ）⇒ **不衰减**，并在回执里点名
   * （`decayUnresolved`）。绝不偷偷补一个默认 λ：那会让"没配衰减"与"配了 0"在屏上一模一样。
   */
  decayRef: z.object({ ruleKey: z.string(), paramKey: z.string() }).nullable().default(null),
  /** 量纲单位（"0–100 压力指数" / "天" / "件"）—— 披露层原样打给用户看。 */
  unit: z.string(),
  /** 这个取值域的**出处**（哪一句注释、哪个生成式定的）。写不出出处就不许声明。 */
  source: z.string(),
});
export type StateVarDomain = z.infer<typeof StateVarDomainSchema>;

/** 状态量裸键 → 声明取值域。**查不到 = 未声明**（不夹不衰减，回执里点名）。 */
export type StateVarDomainLookup = Record<string, StateVarDomain>;

/**
 * 一次**饱和**（读数越过声明取值域、被保序压回）的记录。
 *
 * ⚠ 存在的理由：本单明确禁止**静默夹住** —— 夹了却不说，屏上看着正常、信息其实已经丢了，
 * 那是把一个病换成另一个更难查的病。每一次饱和都必须能在披露层看到。
 */
export const SaturationEventSchema = z.object({
  objectId: z.string(),
  stateVar: z.string(),
  /** 压缩前的原始值（发散有多远，看这个数）。 */
  raw: z.number(),
  /** 压缩后的读数（恒在 (min,max) 开区间内）。 */
  value: z.number(),
  /** 顶到了哪一侧。 */
  bound: z.enum(["min", "max"]),
});
export type SaturationEvent = z.infer<typeof SaturationEventSchema>;

// ── SimSession 会话状态机（§2.1 sim_session 表） ──────────────────────────────
export const SimSessionStatusSchema = z.enum(["DRAFT", "READY", "RUNNING", "PAUSED", "ENDED"]);
export type SimSessionStatus = z.infer<typeof SimSessionStatusSchema>;

export const SimSessionSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  baseSnapshot: TickStateSchema, // tick0 世界态（合成/连接器/切片物化而来，走正门）
  /**
   * 范围裁剪（§2.1 原文「复用 slice-planner 子图」）。**故意保持 `record`**：
   * 本列同时被 `WO-LIVE-ENDPOINTS` 的活方案快照借用（`snapshotKind`/`label`/`page`/`baseId` …），
   * 收窄成强类型对象会当场打断那条链。推演范围语义走 `resolveSimScope()` 这一支解释器（见下），
   * 不认识的键一律读作 GLOBAL —— 于是快照那批 bag 逐字节维持旧行为（RL9 additive 可回退）。
   */
  scope: z.record(z.string(), z.unknown()),
  status: SimSessionStatusSchema.default("DRAFT"),
  curTick: z.number().int().default(0),
  parentCheckpointId: z.string().nullable().default(null), // 非空 = 本会话是某检查点的分支
  /**
   * **会话级反事实：这次推演假装哪几条传导边不存在**（WO-ACTIVE-EDGE-UX）。
   *
   * ⛔ **与 `PropagationRule.status` 正交，两个字段都要，不许合并**（本单最容易做错的地方）：
   *  · `status: DRAFT|PUBLISHED|RETIRED` = **这条边在不在世界里**——对全租户生效的**持久发布态**。
   *    改它是**本体真值写入**，必须经 Action 审批（R4）；且一改，"改之前"就没了，无从对照。
   *  · `disabledRuleKeys` = **这次推演假装它不在**——`SimSession` 自己的**世界态**，
   *    只影响本会话、可随时拨回、"开/关两版"能同时算出来放在一起看（对照才是本单的核心产出）。
   *
   * 拿 `status` 当这个开关会同时炸三头：① 顶 R4（用户点一下"关掉看看"就永久改了全租户本体）；
   * ② 顶 R2 的精神（一个人的假设污染同租户所有人的推演）；③ 不可对照（"改之前"没了）。
   * 写本字段**不需要** Action 审批，其依据是 R4-sim：仿真世界的写入不是真值写入
   * （`SimSession` 的世界态 ≠ 本体真值），豁免边界见 SYSTEM-ONTOLOGY §5 R4-sim。
   *
   * 用 **`key` 不用 `id`**：契约里 `key` 写明是「稳定键，可被 OPERATION_CATALOG/审计引用」，
   * 而 `id` 是 `newId()` 的 randomBytes，跨重建即漂。
   *
   * 缺省/缺失 ⇒ 一律读作 `[]`（消费方一律写 `?? []`），与本字段引入前**逐字节相同**（additive · 可回退 RL9）。
   *
   * ⚠ **刻意 optional 而非 required**（沿用本文件 `SimCertification.trialTick.derivationNodes`
   * 立下的同一条理由，别推翻）：`SimSession` 在前端被当**字面量**构造 7 处
   * （`apps/frontend-shell/test/` 下 sandbox-p0 / sandbox-view / sandbox-declutter /
   * sandbox-three-zone / sandbox-kpi-layer / sandbox-finance-worldstate 等 fixture），
   * 置为必填会把整包前端打成编译红 —— 而那些文件属于并行在跑的另几张单，不该被本单牵动。
   * DataCore 侧**恒填**（`app.ts` 三处 `SimSession` 字面量 + `repo/pg.ts rowToSession` 的 `?? []`），
   * 故服务端答复里它总在。
   */
  disabledRuleKeys: z.array(z.string()).optional(),
  /**
   * **一个 tick 等于几天**（WO-SIM-DRILL-P12 · G-DRILL-1 · PRD-sim-drill-parallel-world §4.5）。
   *
   * ══ 今天的行为是 X，应该是 Y ═══════════════════════════════════════════════
   * **X（今天）**：全仓**没有任何东西**声明 tick 与天的换算关系（实测
   * `grep -rn tickDays` 全仓 **0 命中**；金丝雀：同目录 `durationTicks` 在
   * `packages/contracts/src` 命中 **7** ⇒ 工具没坏，是真的没有）。于是屏上「推进 tick」
   * 与求解器侧吃天的 `risk_timeline.horizon`（原文「推演天数·默认 30」）、
   * `sop_reschedule.advanceDays` **锚在两个互不相干的刻度上** ——
   * 「第 12 天越线」和「第 12 个 tick 越线」会是两个不同的日子，而屏上看不出来。
   * **Y（应该）**：一个显式的换算基准跟着**世界**走，两条路（传导 tick / 求解器 day）
   * 都从它换算，于是同一次演习里的「天」只有一个意思。
   *
   * ══ 为什么挂在 `SimSession` 上，而不是塞进沙盘组件 state ═══════════════════
   * 因为**下游四页要读它**。`views/sim/console/**` 的会话单源是 `useConsoleSession`，
   * 它经 `pickLatestRunningSession` 从 `GET /a/v1/sim/sessions` 的 `SimSessionListItem`
   * 里挑一条整个返回 —— 而 `SimSessionListItemSchema = SimSessionSchema.omit({baseSnapshot})`，
   * 故**本字段一加，四页立刻够得着，零改动**。
   * 反过来若只存在沙盘自己的 `useState` 里，四页永远拿不到：
   * `MetricGantt.tsx` 的横轴至今直接渲染 `series.ticks` 的裸序号（`0 1 2 …`），
   * 用户在沙盘输「30 天」、切到指控台看到的还是 tick —— 两半各自绿、合起来对不上，
   * 正是本仓「绿测试≠能用·断在接缝」的老形态。
   * ⚠ 本单只保证**四页够得着**；四页真的按天显示是 `WO-SIM-CONSOLE-DAYS` 的事，别在这里改它们。
   *
   * 缺省 `1`（一 tick = 一天，与 A8 模拟时钟「一 tick = 一个模拟日」同口径）⇒
   * 本字段引入前建的世界读出来恒 `1`，行为逐字节不变（additive · 可回退 RL9）。
   *
   * ⚠ **刻意 optional 而非 required** —— 沿用正上方 `disabledRuleKeys` 立下的同一条理由，
   * 别推翻：`SimSession` 在前端被当**字面量**构造 7 处（`apps/frontend-shell/test/` 下
   * sandbox-p0 / sandbox-view / sandbox-declutter / sandbox-three-zone / sandbox-kpi-layer /
   * sandbox-finance-worldstate 等 fixture），置为必填会把整包前端打成编译红 ——
   * 而那些文件属于**并行在跑的另几张单**，不该被本单牵动。实测确有其事：
   * 改成必填时 `pnpm --filter datacore typecheck` 当场报 6 处（app.ts×2 · repo/memory · repo/pg×2 ·
   * 两个既有测试），全部是与本单无关的字面量。
   * DataCore 侧**恒填**（`app.ts` 的 `createSimSessionWorld` + `repo/pg.ts rowToSession` 的 `?? 1`），
   * 故服务端答复里它总在；消费方一律写 `?? 1`（缺失与 1 同义，见 `ticksForDays` 自己也兜底）。
   */
  tickDays: z.number().int().min(1).optional(),
  createdAt: z.string(),
});
export type SimSession = z.infer<typeof SimSessionSchema>;

/**
 * 「推演 N 天」→ 要推几个 tick（PRD §4.5 的 `ceil(N / tickDays)`）。
 *
 * 放契约里的理由与 `isPerturbationActiveAt` 逐条相同：**UI 与引擎必须用同一份判据**。
 * 各写一份 = 第二套真相源 —— 屏上说推 30 天、引擎推了 30 个 tick（而一 tick 是 7 天），
 * 这种错不会崩、只会静默算错 210 天。
 */
export function ticksForDays(days: number, tickDays: number): number {
  const d = Math.max(0, Math.floor(days));
  const td = Math.max(1, Math.floor(tickDays));
  return Math.ceil(d / td);
}

/** 反向：第 `tick` 个 tick 对应第几天（屏上横轴换算的唯一实现）。 */
export function daysForTicks(ticks: number, tickDays: number): number {
  return Math.max(0, Math.floor(ticks)) * Math.max(1, Math.floor(tickDays));
}

// ── 会话**列表**投影（WO-SIM-SESSIONS-PROJECTION · 列表不带世界内容） ───────────────────
/**
 * 一个世界有多大 —— **列表投影的诚实位**。
 *
 * 存在的唯一理由：`SimSessionListItem` 把 `baseSnapshot` 整个拿掉了，
 * 而「**我没给你**」与「**它就是空的**」是两个不同的命题。
 * 不给规模摘要，调用方只能在这两句话之间猜；给了，它就知道那边有多少东西、值不值得再打一跳。
 *
 * 两个分项的口径（与 `SeedWorldSnapshotOrigin.objects/cells`、
 * 与 `sim-seed-world.seam.test.ts` 的 `cellCount()` **逐字同口径**，别另立一套）：
 *  · `objects` = `Object.keys(baseSnapshot).length` —— 世界里有几个对象；
 *  · `cells`   = `Σ Object.keys(baseSnapshot[oid]).length` —— 几个「对象 × 状态变量」格。
 * ⚠ 只数 `objects` 会把「11,348 个对象 × 36 个变量」读成「11,348」，差 36 倍。两个都要。
 */
export const SimSessionScaleSchema = z.object({
  objects: z.number().int().nonnegative(),
  cells: z.number().int().nonnegative(),
});
export type SimSessionScale = z.infer<typeof SimSessionScaleSchema>;

/**
 * `GET /a/v1/sim/sessions` 的**列表项**：`SimSession` 减去 `baseSnapshot`，加一个规模摘要。
 *
 * ── 病灶（2026-08-22 真 PostgreSQL 实测原文，不是推测）────────────────────────────
 * **今天的行为 X**：一个「列出我有哪些世界」的端点，把每个世界的**全部内容**都塞进回包。
 * 库里 35 条会话（每条 `baseSnapshot` = 11,348 对象 × 36 状态变量 = 408,528 格 ≈ 8.4MB）时：
 *   `GET /a/v1/sim/sessions` → `http=200 size=298,834,924 time=8.99s` = **285 MB / 9 秒**。
 * 前端三处消费方共用缓存键 `["a","sim-sessions"]` 打这一跳，285MB 的 JSON 解析成 JS 对象后
 * 再翻几倍 ⇒ **渲染进程 OOM 崩溃**。规模是 O(N × 世界规模)：会话越多越大。
 * **应该的 Y**：列表回列表该有的东西（id / status / curTick / scope / 规模摘要…），
 * 要世界内容的**按 id 单取**（`GET /a/v1/sim/sessions/:id` 回完整 `SimSession`）。
 *
 * ── 为什么是一个**新类型**而不是把 `SimSession.baseSnapshot` 改成 optional ────────────
 * 改 optional 会让**所有**读 `baseSnapshot` 的地方（建会话 201 回包、`finance-world.ts:184`、
 * `impact-analysis.ts:90`、`metric-series` 的 seed 回落）同时失去类型保护 ——
 * 那些地方拿到的**确实是**完整会话，收窄它们等于用一个真实的类型谎去换列表的安全。
 * 分成两个类型，「这个响应有没有世界内容」这件事就落在**类型**上，而不是落在注释里。
 *
 * ⚠ 本类型**刻意不带** `baseSnapshot: never` 之类的占位键：多一个恒 `undefined` 的键，
 * 只会让 `if ("baseSnapshot" in s)` 这种探测读出错误答案。没有就是没有。
 */
export const SimSessionListItemSchema = SimSessionSchema.omit({ baseSnapshot: true }).extend({
  /** 被拿掉的那份世界内容有多大（诚实位·口径见 `SimSessionScaleSchema`）。 */
  baseSnapshotScale: SimSessionScaleSchema,
});
export type SimSessionListItem = z.infer<typeof SimSessionListItemSchema>;

/** `baseSnapshot` → 规模摘要的**唯一实现**（服务端投影与任何复算都走它，别各写一套 reduce）。 */
export function simSessionScaleOf(baseSnapshot: TickState): SimSessionScale {
  let cells = 0;
  for (const row of Object.values(baseSnapshot)) cells += Object.keys(row ?? {}).length;
  return { objects: Object.keys(baseSnapshot).length, cells };
}

// ── 会话级反事实：过滤 / 对照（WO-ACTIVE-EDGE-UX · 契约唯一实现，引擎与前端共用） ──────
/**
 * 把「本会话屏蔽了哪几条边」作用到一组传导规则上（**纯函数** R6：不改入参）。
 *
 * 放契约里的理由与 `isPerturbationActiveAt` 同族：**写端在前端（拨开关）、读端在引擎（过滤规则）**，
 * 两边各写一套 `rules.filter(r => !disabled.includes(r.key))` 就是第二套真相源 ——
 * 前端预览的"关掉后"与后端真跑的"关掉后"一旦漂移，用户看到的差值就是假的。
 *
 * 返回 `{ active, suppressed }` 而不是只返回 `active`：**被关掉的那几条必须还拿得到**，
 * 因为 §3.3 要求「关掉的边在图上可见地降级（虚线/灰化），不是从图上消失」——
 * 消失了用户就不知道自己关了什么。
 */
export function partitionPropagationRules<T extends { key: string }>(
  rules: readonly T[],
  disabledRuleKeys: readonly string[] | null | undefined,
): { active: T[]; suppressed: T[] } {
  const off = new Set(disabledRuleKeys ?? []);
  if (off.size === 0) return { active: [...rules], suppressed: [] };
  const active: T[] = [];
  const suppressed: T[] = [];
  for (const r of rules) (off.has(r.key) ? suppressed : active).push(r);
  return { active, suppressed };
}

/**
 * 传入的 `ruleKeys` 里，哪些在已知规则集合里查不到（**显式报错用**，不是给"静默忽略"打掩护）。
 *
 * 静默忽略未知 key = 用户以为关掉了、其实没关 —— 这正是「绿测试≠能用」的温床，
 * 故路由必须据此 400，不许悄悄吞掉（WO §3.1.2）。
 */
export function unknownPropagationRuleKeys(
  requested: readonly string[],
  known: readonly { key: string }[],
): string[] {
  const have = new Set(known.map((r) => r.key));
  return [...new Set(requested.filter((k) => !have.has(k)))].sort();
}

/** 一格世界态差异（开/关两版对照的最小单元）。`delta = counterfactual − baseline`。 */
export const SimStateDiffCellSchema = z.object({
  objectId: z.string(),
  stateVar: z.string(),
  /**
   * 全规则跑出来的值（"边开着"）。该格在那一版世界里**根本不存在** ⇒ `null`
   * （诚实缺：`null` 与 `0` 在屏上必须分得开——「这个世界里没有这一格」不等于「这一格是 0」）。
   */
  baseline: z.number().nullable(),
  /** 屏蔽掉 `disabledRuleKeys` 后跑出来的值（"边关掉"）。语义同上。 */
  counterfactual: z.number().nullable(),
  /**
   * 两者之差。
   *
   * ⚠ **缺格按 0 参与相减，这不是"拿 0 冒充没变"，是照抄引擎自己的读数约定**：
   * `propagation.ts:367 readVar` 原文 `return typeof v === "number" ? v : 0` —— 引擎读一个
   * 不存在的状态变量，读到的就是 0。差值若不照这个约定算，就会出现最常见的那个病样：
   * 关掉一条边导致目标格**整个消失**（本仓实测：`Line.utilPressure` 由 10 → 该键不存在），
   * 屏上却显示"算不出"，用户看不到它其实**降到了 0**。
   * **两侧都缺** ⇒ `null`（那才是真的算不出，且这种格根本不会上桌）。
   * 显示层仍能分辨：`baseline`/`counterfactual` 保留 `null`，只有 `delta` 用引擎约定。
   */
  delta: z.number().nullable(),
  /** 方向：`up`/`down`/`flat`；`delta` 为 `null` 时是 `unknown`。§3.3「一眼看出方向和量级」。 */
  direction: z.enum(["up", "down", "flat", "unknown"]),
});
export type SimStateDiffCell = z.infer<typeof SimStateDiffCellSchema>;

/** 数值比较的容差：`round12` 之后的浮点尾差不算"变了"（引擎自己就按 12 位定点写入）。 */
const DIFF_EPSILON = 1e-9;

/**
 * 逐格对照两份 `TickState`（**纯函数** R6，确定性排序）。契约唯一实现 ——
 * 后端算差值、前端渲染差值走**同一支**，否则"面板上写涨了 3.2"与"引擎认为涨了 3.19"这种
 * 无从追查的漂移必然出现。
 *
 * `onlyChanged` 缺省 `true`：对照面板要回答的是「关掉这条边，什么变了」，
 * 把几百格没动的一起端上去等于什么都没说。
 */
export function diffTickStates(
  baseline: TickState,
  counterfactual: TickState,
  onlyChanged = true,
): SimStateDiffCell[] {
  const cells: SimStateDiffCell[] = [];
  const objectIds = [...new Set([...Object.keys(baseline), ...Object.keys(counterfactual)])].sort();
  for (const objectId of objectIds) {
    const b = baseline[objectId] ?? {};
    const cf = counterfactual[objectId] ?? {};
    const vars = [...new Set([...Object.keys(b), ...Object.keys(cf)])].sort();
    for (const stateVar of vars) {
      const bv = typeof b[stateVar] === "number" ? (b[stateVar] as number) : null;
      const cv = typeof cf[stateVar] === "number" ? (cf[stateVar] as number) : null;
      // 缺格按 0 参与相减 —— 与引擎 `readVar`（`propagation.ts:367`）同一约定，见 `delta` 字段注释。
      // 两侧都缺才是真的算不出（那种格也不会上桌，因为它没变）。
      const delta = bv === null && cv === null ? null : (cv ?? 0) - (bv ?? 0);
      const changed = delta === null ? false : Math.abs(delta) > DIFF_EPSILON;
      if (onlyChanged && !changed) continue;
      cells.push({
        objectId,
        stateVar,
        baseline: bv,
        counterfactual: cv,
        delta,
        direction: delta === null ? "unknown" : delta > DIFF_EPSILON ? "up" : delta < -DIFF_EPSILON ? "down" : "flat",
      });
    }
  }
  return cells;
}

/**
 * 「开/关两版各跑一遍」的对照回包（`POST /a/v1/sim/sessions/:id/counterfactual`）。
 *
 * ⚠ **这一趟不写世界态**：`putTickState` 一次都不调，会话的 `curTick` 一格不动 ——
 * 否则用户点一下"看看"就把真会话推进了一格，而"看看"本该是零副作用的。
 * 这条约束由 `apps/datacore/test/edge-active-counterfactual.test.ts` **用测试咬死**（不是注释保证）。
 */
export const SimCounterfactualResultSchema = z.object({
  /** 对照的起点 tick（= 会话当前 tick，**不推进**）。 */
  fromTick: z.number().int(),
  /** 两版各跑了几格。 */
  ticks: z.number().int(),
  /** 本次对照屏蔽掉的规则 key（已按字典序去重；未传时 = 会话上的持久集合）。 */
  disabledRuleKeys: z.array(z.string()),
  /** 屏蔽掉的那几条规则的结构（前端据此把边"降级显示"而不是让它消失）。 */
  suppressedRules: z.array(PropagationRuleSchema),
  /** 全规则跑出来的世界态。 */
  baselineState: TickStateSchema,
  /** 屏蔽后跑出来的世界态。 */
  counterfactualState: TickStateSchema,
  /** 逐格差异（仅变了的格；确定性排序）。空数组 = 关掉这条边什么都没变（这也是结论）。 */
  diffs: z.array(SimStateDiffCellSchema),
  /**
   * 本次对照里，被屏蔽的规则在**基线**那一版真的触发了吗。
   * `false` ⇒ 差值为空是**因为这条边本来就没在动**（源态为 0 / 无匹配边 / 被闸门挡），
   * 不是"关了它没影响"。两者在屏上长得一样，必须显式分开（同族戒律：一个数盖住两个事实）。
   */
  suppressedRulesFiredInBaseline: z.array(z.string()),
});
export type SimCounterfactualResult = z.infer<typeof SimCounterfactualResultSchema>;

// ── 推演范围 SimScope（WO-SIM-SCOPE-TRIAL · 关闭欠账 #129/#130 `G-SIM-SCOPE-UNREAD`） ──
/**
 * 全局整本体 / 局部子图。前端 `SandboxView` 建会话时写 `{kind, target}`（`target` = 对象类型 key）。
 *
 * 为什么判据放契约里：`SimSession.scope` 的**写端在前端、读端在引擎**，中间隔着一个
 * `record<string, unknown>` 的松口袋。两边各写一套 `if (scope.kind === "LOCAL")` 就是第二套真相源
 * —— 正是 `isPerturbationActiveAt` 当初被提到契约里的同一个理由。
 */
export const SimScopeKindSchema = z.enum(["GLOBAL", "LOCAL"]);
export type SimScopeKind = z.infer<typeof SimScopeKindSchema>;

/**
 * LOCAL 默认展开跳数 = **1**，不是 0。
 *
 * 这不是随手拍的：`target` 是**单个对象类型**，而一条 `PropagationRule` 是
 * `sourceTypeKey ─viaLinkKey→ targetTypeKey` 的**跨类型**边（demo 三条全是跨类型：
 * Order→Model / Model→Base / Line→Base）。0 跳的子图里只有一种类型的对象
 * ⇒ 一条跨类型边都成立不了 ⇒ LOCAL 恒等于「什么都不动」。
 * 那是把「局部推演」实现成「不推演」，属于另一种静默错答。
 * 1 跳 = `docs/PRD-enterprise-decision-twin.md §4.3` Slice Expansion Engine 策略表的第一档
 * （`1-hop → 2-hop → 决策相关 → …`），有出处、非发明。
 */
export const SIM_SCOPE_DEFAULT_HOPS = 1;

/** `SimSession.scope` 解释后的推演范围（引擎与认证共用一份）。 */
export interface ResolvedSimScope {
  kind: SimScopeKind;
  /** LOCAL 的根对象类型 key；GLOBAL 恒 `null`。 */
  target: string | null;
  /** 从根沿链路（无向）展开的跳数。 */
  hops: number;
  /**
   * **诚实缺席**：自称 LOCAL 却给不出根（`target` 缺/空）时，这里写明原因，且**绝不退回 GLOBAL**
   * —— 拿全域数字冒充局部正是本单要根治的病（`G-SIM-SCOPE-LOCAL-DEGRADE` 同族）。
   * `null` = 范围可用。
   */
  unresolved: string | null;
}

/**
 * 把 `SimSession.scope` 这个松口袋解释成推演范围。**唯一实现**（引擎 tick 路与就绪认证共用）。
 *
 * 判据（逐条有来历，别改成"看着更合理"的写法）：
 *  · `kind` 不是字面量 `"LOCAL"` ⇒ GLOBAL。空对象 `{}`、活方案快照 bag（`{snapshotKind:…}`）、
 *    历史遗留会话**全部**落在这里 ⇒ 与本函数引入前逐字节同行为（RL9）。
 *  · LOCAL 且 `target` 是非空串 ⇒ 可用范围。
 *  · LOCAL 但 `target` 缺/空 ⇒ `unresolved` 非空。调用方必须把它当"范围拿不到"处理，
 *    **不许**当 GLOBAL 跑（那正是 `#129` 的病样：屏上写「局部」、数字是「全局」）。
 */
export function resolveSimScope(raw: Record<string, unknown> | null | undefined): ResolvedSimScope {
  const bag = raw ?? {};
  const hopsRaw = bag.hops;
  const hops = typeof hopsRaw === "number" && Number.isInteger(hopsRaw) && hopsRaw >= 0 ? hopsRaw : SIM_SCOPE_DEFAULT_HOPS;
  if (bag.kind !== "LOCAL") return { kind: "GLOBAL", target: null, hops, unresolved: null };
  const t = typeof bag.target === "string" && bag.target.length > 0 ? bag.target : null;
  return {
    kind: "LOCAL",
    target: t,
    hops,
    unresolved: t === null
      ? "会话范围自称 LOCAL 却没有根对象类型（scope.target 缺失或为空）⇒ 无法裁出子图。" +
        "本次推演不按全域跑——拿全域结果冒充局部正是本项要根治的静默错答。"
      : null,
  };
}

// ── SimTickState 逐 tick 态快照（§2.1 sim_tick_state · 复合主键 session+tick） ──
export const SimTickStateSchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(), // R2
  tick: z.number().int(),
  state: TickStateSchema,
  pending: z.array(DelayedContributionSchema).default([]),
  trace: z.array(PropagationTraceSchema).nullable().default(null),
});
export type SimTickState = z.infer<typeof SimTickStateSchema>;

// ── 指标时序（WO-SIM-BE-SERIES · `GET /a/v1/sim/sessions/:id/metric-series`）──────────
//
// 🔴 病灶（实测原文，非转述）：沙盘只有**当前一格**。
//  · `app.ts` 的 `GET …/:id/world` 回 `{ tick: s.curTick, state: await simCurrent(c, s) }` —— 一格；
//  · 前端 `views/sim/ProcessCanvasView.tsx` 头注写着「『上一拍』必须由本档自己留存，
//    **不能问后端要**：`GET …/:id/world` 只回当前态」—— 前端在自己攒历史，攒的是屏幕上的残留，
//    刷新即失、跨档不共享，且它攒不出「不施加扰动本该是什么样」的那条线。
//  · 唯一带 tick 序列的既有端点是 `GET /a/v1/sim/compare?a=&b=`，但它比的是**两个会话** ——
//    正是下面 `baselineOrigin` 要禁掉的那种基线（两条线种子不同源，差值是噪声不是扰动效果）。
//
// ── 基线的定义（本契约最容易被做错的地方，写死在这里）───────────────────────────────
// 基线 **不是**「另开一个会话重算一遍」，而是「**同一个世界**、同一 tick0 种子、同一套传导规则，
// 只把扰动集清空」的那条线。这与 `SimCounterfactualResult` 是**同一条纪律的两个投影**：
// 那边「两版只差 `disabledRuleKeys`」，这边「两版只差扰动集」，两边都由**同一支算法**跑出来。
// 另起会话 ⇒ 新会话的 `baseSnapshot` 拿不到本世界 tick0 行上累积的东西（`/act` 直写、
// 分支继承的屏蔽集…），分叉点会**提前到 tick 0**，屏上就是一个从头就存在的假分叉。
// 故回包必须带 `baselineOrigin`：把「基线是从哪个世界、哪一格种出来的」写在脸上，可被测试咬死。

/**
 * 一段「这个指标在这几格归属哪个环节」。
 *
 * ⚠ **由后端给，前端不许自己切**（同 `PropagationRule.domainKey` 那条纪律）：前端手抄一份
 * 「哪条规则属于哪个环节」的映射表，新增一条规则忘了加进去它就从分段里消失，而没有任何东西会报错
 * —— 屏上的分段与归因从此对不上，且永远绿。
 *
 * 归属**只从真跑过的 trace 反查**（`SimTickState.trace` 的 `ruleKey` → 该规则），不猜、不按类型硬派。
 * 查不到环节的 tick **不产生分段**（诚实留白），绝不塞进相邻那一段 —— 塞了就是把
 * 「这一格其实没有归属」这句话抹掉。
 */
export const SimMetricSegmentSchema = z.object({
  /** 闭区间起点 tick。 */
  fromTick: z.number().int(),
  /** 闭区间终点 tick（单格分段 `fromTick === toTick`）。 */
  toTick: z.number().int(),
  /** 环节 id。`source` 决定它的取值域，见下 —— **不许**把两个取值域混读成一个裸串。 */
  nodeId: z.string(),
  /** 环节人话名。查不到登记名时回落 `nodeId` 裸串（不编名字）。 */
  label: z.string(),
  /**
   * 🔴 **归属是怎么算出来的（诚实位·两者不是一回事，绝不合并）**：
   *  · `cadence` —— 规则声明的节拍节点 `PropagationRule.cadenceNodeId`，取值域 = `CHAIN_NODE_REGISTRY`
   *    在册 id（`chain-sim.ts` §2.5 单源）。这是**建模方显式绑定**的全链环节，最强的一档。
   *  · `domain`  —— 规则落域 `PropagationRule.domainKey`（`seed.ts resolveRuleDomain`，D01–D13），
   *    取值域 = 业务域登记册。这是**回落档**：出厂 35 条种子规则的 `cadenceNodeId` **全为 `null`**
   *    （实测 `grep -c "cadenceNodeId: null" apps/datacore/src/seed.ts` = 35，
   *    种子注释原文「具体哪条流绑哪个节拍留给建模/运营去配」）⇒ 只认 `cadence` 的话，
   *    demo 世界的分段会**恒为空**，功能等于没做（"接了线没数据"）。
   * 两者混成一个裸 `nodeId` 会让屏上分不出「这是建模方绑的节拍点」与「这是按落域推的」——
   * 同族戒律：一个字段盖住两个不同事实。
   */
  source: z.enum(["cadence", "domain"]),
  /**
   * 本段内**逐格主导贡献者**的规则 key（去重升序）。
   * 有它，用户才能从"屏上这一段归 D06"追回"是哪条边把这个数写上去的"；
   * 只给结论不给出处，就又是一个查无对证的数字。
   */
  ruleKeys: z.array(z.string()),
});
export type SimMetricSegment = z.infer<typeof SimMetricSegmentSchema>;

/** 一条指标的两条线 + 环节分段。`baseline`/`actual` 与响应的 `ticks` **逐位对齐**（等长）。 */
export const SimMetricSeriesItemSchema = z.object({
  /** `${objectId}.${stateVar}` —— 与 `TickState` / `SimStateDiffCell` 同一粒度（对象×状态变量）。 */
  key: z.string(),
  objectId: z.string(),
  /**
   * 状态变量裸键。**本单不新造指标名**：取值域 = 已发布传导规则的
   * `sourceStateVar ∪ targetStateVar`（与 `SandboxViewConfig.stateVars` 同一口径、同一去重）。
   */
  stateVar: z.string(),
  /** 人话名，取自后端单源表 `STATE_VAR_DISPLAY_NAMES`（`synthetic/battery.ts`）；未登记 ⇒ 回落裸键。 */
  label: z.string(),
  /**
   * 诚实位：`label` 是不是回落的裸键。
   * 没有它，屏上分不出「名字恰好等于键」与「压根没登记名字」
   * —— 这正是 `stateVarDisplayNames` 当初"未登记就不进字典"的同一条理由。
   */
  labelIsFallback: z.boolean(),
  /**
   * 单位。**恒 `null`，这是诚实缺席不是没做**：全仓没有任何"状态变量 → 单位"的登记册
   * （`unit` 只登记在**对象类型属性**上，而 `loadIndex`/`demandPressure` 这些状态变量
   * 在 `apps/datacore/src/synthetic/` 里一次都不出现 —— `battery.ts` 头注已实测记过这笔账）。
   * 编一个「%」或「指数」出来就是新造口径（破 R13/R14）。前端据 `null` 显示无单位，别自己补。
   */
  unit: z.string().nullable(),
  /** **不施加任何扰动**的那条线。缺格 = `null`（「这个世界里没有这一格」≠「这一格是 0」）。 */
  baseline: z.array(z.number().nullable()),
  /** 施加了本会话全部扰动的那条线（= 屏上真跑出来的世界线）。缺格语义同上。 */
  actual: z.array(z.number().nullable()),
  /** 环节分段（按 tick 升序、互不重叠；无归属的 tick 处留空档，不跨越、不填补）。 */
  segments: z.array(SimMetricSegmentSchema),
});
export type SimMetricSeriesItem = z.infer<typeof SimMetricSeriesItemSchema>;

// ── 规模闸（WO-SIM-SERIES-SCALE）─────────────────────────────────────────────────
//
// 🔴 病灶（实测原文，非转述 —— 真 datacore `SEED_DEMO=1` + 真浏览器路径）：
// 前端 `deriveBaseSnapshot(view-config)` 建的**生产量级**世界是 **11,348 对象 × 36 状态变量**，
// 而本端点原先**零筛选入参**（query 只有 `from`/`to`）⇒ 无条件回全量：
//   `GET …/metric-series` → 200 · **bytes = 116,859,540** · **metrics = 408,528 条** · ticks=[0,1] · **21.8 秒**
// 屏上那张指标甘特**只画 12 行**（`useMetricSeries.ts` 的 `SPEC_ROWS`）。
// 后果是**静默错答**：请求 20 秒回不来 ⇒ `[data-testid=sandbox-home-gantt]` 的 `data-source`
// 恒为 `placeholder`，用户永远看不到自己的数，**且屏上不报错**。
//
// **为什么以前没发现**（照本仓 0.5 判据 6 的句式）：
// > 「我用『1 对象手造世界回包 17 条』当作『这个端点回包规模可控』的证据，而前者并不度量后者。」
// 当初的真后端实测用的是 `baseSnapshot={obj_base_changzhou:{loadIndex:42}}` —— **一个对象**。
// **生产实参与测试实参交集为空**，于是三周来验的是一个生产从没走过的规模。
//
// ── 闸的三条纪律（缺一条就还是今天这个病）────────────────────────────────────────
//  ① **不传任何参数也不许回全量** —— 默认 `limit` 就是版面量级，任何调用方从此都打不爆服务；
//  ② **硬上限**在服务端，客户端要多少都压得住（`limit` 超上限 ⇒ 静默降到上限，`appliedLimit` 亮出来）；
//  ③ **不许静默截断** —— 回包必须读得出「一共多少条 / 回了多少条 / 被裁了没有」。
//     「我没给你」和「一共就这么多」是两个不同的命题，一个 `metrics.length` 盖不住两件事。

/**
 * 不传 `limit` 时的默认条数。**取值 = 12，理由写死在这里**：
 * 四页规格里最大的那张指标表就是 12 行 —— 首页指标甘特 `SPEC_ROWS` 12 行、
 * 页3 贡献度时序 11 环节 + 1「其余」= 12 行（`PLACEHOLDER_SERIES_NODES` + `PLACEHOLDER_SERIES_REST`，
 * 竖排组名 6+6 也是 12）、页4 执行对比 `metrics.slice(0,4)` 只要 4。
 * 故 12 = **版面量级本身**，不是一个拍脑袋的整数。
 *
 * ⚠ 这个数还有第二重作用，改它之前先读懂：三个消费方
 * （`useMetricSeries` / `useContributionSeries` / `useExecutionCompare`）**共用同一个
 * React Query 缓存键** `["a","sim-metric-series",id]`，而只有第一个会带 `limit`/`order`。
 * 把服务端默认值取成**与前端所带的那一组相同**，三者拿到的回包才逐字节一致 ——
 * 否则谁先发请求谁定这份缓存，屏上行数会随进场顺序变。
 */
export const SIM_METRIC_SERIES_DEFAULT_LIMIT = 12;

/**
 * `limit` 的**硬上限**。请求要得再多也只回这么多（不报错、只在 `appliedLimit` 里亮出来）。
 *
 * ⚠ **这个数是被测出来的，不是拍出来的** —— 首版取 200，被 `metric-series.seam.test.ts`
 * 的金丝雀当场顶回来：那个世界（battery 种子 + 6 拍）的**全目录实测 204 条**，
 * 原文 `expected 200 to be 204`。一个连**小 demo 世界的全目录都装不下**的上限，
 * 会让白名单下钻这条路当场废掉（筛完了还是被截）。故按实测抬到 500。
 *
 * 500 的量纲：实测每条指标在 2 格窗口下约 **286 字节**（116,859,540 ÷ 408,528），
 * 500 条 ≈ 143KB；窗口拉到 100 格也在数百 KB 量级，**且与世界里有多少对象无关** ——
 * 这正是本闸要的性质：**回包规模由请求决定，不由世界规模决定**。
 *
 * ⚠ 别把这个数当成"保护"本身：真正挡住浏览器那一跳的是**默认值**
 * （上面的 `SIM_METRIC_SERIES_DEFAULT_LIMIT` = 12），因为页3/页4 那两条请求根本不传 `limit`。
 * 硬上限挡的是"有人手写了个大数"，两道闸各挡一种，缺一道都留缺口。
 */
export const SIM_METRIC_SERIES_MAX_LIMIT = 500;

/**
 * 指标排序档。
 *  · `magnitude` —— 按**变化幅度**降序：每条取 `|actual 末值 − baseline 首值|`。
 *    这两个数**正是屏上那两列**（甘特的「基线」列 = `baseline` 首个有效读数、
 *    「扰动后」列 = `actual` 末个有效读数）⇒ 排的就是「屏上这两个数差得最多的那些行」，
 *    而不是另编一个内部指标。任一端缺格（`null`）⇒ 幅度记 0（屏上是 `—`，最不值得占版面）。
 *  · `key` —— 按 `key` 字典序升序（本端点的**历史行为**，下钻/对账时要可复现的稳定序）。
 * 两档都以 `key` 升序作**稳定 tiebreaker** ⇒ 全序 ⇒ R6：同 (session, 窗口, limit, order) 重跑字节级一致。
 */
export const SimMetricSeriesOrderSchema = z.enum(["magnitude", "key"]);
export type SimMetricSeriesOrder = z.infer<typeof SimMetricSeriesOrderSchema>;

/** 逗号分隔串 / 重复 query 键 / 数组 —— 三种写法都收成 `string[]`（去空白、去空串）。 */
const csvList = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const raw = Array.isArray(v) ? v : [v];
    const out = raw.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter((x) => x !== "");
    return out.length > 0 ? out : undefined;
  },
  z.array(z.string()).min(1).optional(),
);

/**
 * `GET /a/v1/sim/sessions/:id/metric-series` 的 **query 契约**（单源：路由与前端都读这一份）。
 *
 * ⚠ `objectIds` / `stateVars` 是**白名单**（给下钻用），不是"排除表"：给了就只回名单里的，
 * 名单外的连**目录**都不进。两者都不给 ⇒ 全目录参与排序，再由 `limit` 截。
 */
export const SimMetricSeriesQuerySchema = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  /** 正整数；不给 ⇒ `SIM_METRIC_SERIES_DEFAULT_LIMIT`；超 `SIM_METRIC_SERIES_MAX_LIMIT` ⇒ 压到上限。 */
  limit: z.coerce.number().int().min(1).optional(),
  order: SimMetricSeriesOrderSchema.optional(),
  objectIds: csvList,
  stateVars: csvList,
});
export type SimMetricSeriesQuery = z.infer<typeof SimMetricSeriesQuerySchema>;

/** `GET /a/v1/sim/sessions/:id/metric-series?from=&to=&limit=&order=&objectIds=&stateVars=` 的响应。 */
export const SimMetricSeriesResponseSchema = z.object({
  sessionId: z.string(),
  /** 实际返回的窗口（已按世界线可用范围收敛，见 `clamped`）。 */
  fromTick: z.number().int(),
  toTick: z.number().int(),
  /** 窗口内逐格 tick（升序连续）。`metrics[*].baseline/actual` 与它**同长同序**。 */
  ticks: z.array(z.number().int()),
  /**
   * **这条时间轴的刻度单位**：一格 `ticks` 等于几天（WO-SIM-DRILL-P12 · 见 `SimSession.tickDays`）。
   *
   * ══ 为什么回包自带口径（方案 A），而不是让消费方从 session 另取（方案 B）══════════
   * 消费方 `views/sim/console/MetricGantt.tsx` 的横轴**直接渲染 `series.ticks` 的裸序号**，
   * 它手上只有这一个响应。走 B 就得让每个消费方各自再拼一次 `useConsoleSession` ——
   * 而「换算口径从哪来」这件事一旦有两个出处，迟早漂（本仓治过多次的第二套真相源）。
   *
   * ⚠ **体积顾虑已实测排除，不是拍脑袋**：本端点历史上曾 116MB → 4.8KB
   * （病根是 `baseSnapshot` 那种 **O(N × 世界规模)** 的负载），而本字段是**一个标量**。
   * 真测（4071 · seed 42 · 6 格窗口）：回包 `289 → 302` 字节，**增量恒 13 字节**，
   * 与世界规模、窗口长度、指标条数**全部无关**（O(1)）。两种形状不是一回事，不构成回潮。
   *
   * 缺省 `1` ⇒ 本字段引入前的响应照旧解析、读出来恒 `1`（additive · 可回退）。
   */
  tickDays: z.number().int().min(1).optional(),
  /**
   * 本页指标，序由 `appliedOrder` 决定（`key` 档 = 字典序升序 = 历史行为；
   * `magnitude` 档 = 变化幅度降序 + key 升序 tiebreak）。两档都是全序 ⇒ R6 字节级可复现。
   * **长度 ≤ `appliedLimit`**，且 `< totalMetrics` 时 `truncated` 为真。
   */
  metrics: z.array(SimMetricSeriesItemSchema),
  /**
   * 🔴 **诚实位（不许静默截断）**：本窗口内**一共**有多少条指标
   * （已应用 `objectIds`/`stateVars` 白名单，**未**应用 `limit`）。
   * 有它，「我没给你剩下的」与「一共就这么多」才分得开 —— 只给 `metrics.length` 的话，
   * 一个数盖住两个不同事实，正是本仓反复记账的那个病。
   */
  totalMetrics: z.number().int(),
  /** 诚实位：`metrics.length < totalMetrics`。屏上据此决定要不要标"还有更多"（**不许**默默少回）。 */
  truncated: z.boolean(),
  /** 回执：**真正生效**的条数上限（= min(请求 limit ?? 默认, 硬上限)）。要多了被压过，从这里看得出来。 */
  appliedLimit: z.number().int(),
  /** 回执：真正生效的排序档（不给 ⇒ `magnitude`）。 */
  appliedOrder: SimMetricSeriesOrderSchema,
  /**
   * 🔴 **基线出处回执** —— 本端点最容易被悄悄做错的那件事，摊开在回包里让测试咬。
   * `sessionId` 必须**等于本会话 id**：不等 = 基线来自另一个世界 = 上面禁掉的那种假分叉。
   */
  baselineOrigin: z.object({
    /** 基线种子取自哪个会话。**恒 = 请求的那个会话**。 */
    sessionId: z.string(),
    /** 基线从哪一格种起（世界线起点）。 */
    seedTick: z.number().int(),
    /** 基线里被清掉的扰动 id（= 本会话全部扰动，升序）。空 ⇒ 本世界没有扰动 ⇒ 两条线必然重合。 */
    excludedPerturbationIds: z.array(z.string()),
  }),
  /**
   * 诚实位：请求的 `to` 是否超出了世界线（`curTick`）而被收敛。
   * **本端点不预测未来** —— 超出部分不补 `null` 格、更不外推，直接把窗口截到 `curTick` 并在此声明。
   */
  clamped: z.boolean(),
});
export type SimMetricSeriesResponse = z.infer<typeof SimMetricSeriesResponseSchema>;

// ── SimCheckpoint 命名存档（§2.1 sim_checkpoint 表） ──────────────────────────
export const SimCheckpointSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  tenantId: z.string(), // R2
  tick: z.number().int(),
  label: z.string(),
  createdAt: z.string(),
});
export type SimCheckpoint = z.infer<typeof SimCheckpointSchema>;

// ── Perturbation 扰动一等公民（WO-P0 · PRD-UPGRADE-decision-sandbox-v2 §3.1.2 · 关闭 #150/#151/REQ060） ──
/**
 * 扰动语义类型：决定前端怎么分类展示、以及默认落在哪个 stateVar 上。
 *
 * ⚠ 设计判据 3（PRD §3.1.2）：**`kind` 不进传导规则**。它只管展示分类与默认落点，
 * 传导仍由 `PropagationRule` 决定。两者混起来 = 把「发生了什么」和「它怎么扩散」焊死，
 * 换行业就要改代码（破 R14 零业务常数）。
 */
export const PerturbationKindSchema = z.enum([
  "demand_shift", // 需求突变（追加订单 / 砍单）
  "supply_disruption", // 供应中断（供应商断供 / 到货延迟）
  "capacity_loss", // 产能损失（设备停机 / 人员缺勤）
  "cost_shock", // 成本冲击（原料涨价 / 汇率）
  "quality_event", // 质量事件（批次不良 / 召回）
]);
export type PerturbationKind = z.infer<typeof PerturbationKindSchema>;

/**
 * 一次「事情发生了」——沙盘此前只有 `/act` 一个裸标量写入（`{objectId, stateVar, value}`），
 * 扰动不是实体、无 id、无时序、无法列举「这个世界受过哪些扰动」（欠账 #150 · PRD §2.2①②）。
 *
 * 四条设计判据（PRD §3.1.2，逐条有来历）：
 * 1. **`durationTicks` 可空**：`null` = 永久，等价于今天 `/act` 的行为 ⇒ additive 可回退
 *    （不填时间维的老调用逐字节同旧行为）。
 * 2. **`mode` 三选一而非只有 `set`**：「涨价 15%」是 `scale`，「加 200 台」是 `delta`，
 *    「停机」是 `set 0`。只给 `set` 会逼前端自己算，那就是第二套真相源。
 * 3. **`kind` 不进传导规则**（见上）。
 * 4. **不新建行业列**：走 `sim_perturbation` 的 doc-jsonb（`migrations/028_perturbations.sql`），
 *    换行业不改表（R14）。
 *
 * 生效判据（PRD §3.1.3，由调用方算以保 `propagateTick` 纯函数 R6）：
 *   `active(p, t) ⇔ t >= p.startTick 且 (p.durationTicks === null 或 t < p.startTick + p.durationTicks)`
 */
export const PerturbationSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  sessionId: z.string(), // 属于哪个世界
  kind: PerturbationKindSchema,
  targetObjectId: z.string(),
  targetStateVar: z.string(),

  // ── REQ060 的三个时序字段（此前全缺）──
  startTick: z.number().int().min(0), // 何时开始
  durationTicks: z.number().int().min(1).nullable().default(null), // 持续多久；null = 永久
  magnitude: z.number(), // 幅度
  mode: z.enum(["set", "delta", "scale"]).default("set"), // 设为 / 增减 / 乘以

  label: z.string().max(200), // 人话（「常州 A 线停机 72h」）
  createdAt: z.string(),
});
export type Perturbation = z.infer<typeof PerturbationSchema>;

/**
 * 扰动在某个 tick 是否生效（PRD §3.1.3 的 `active(p, t)`，纯函数 R6）。
 * 放契约里是因为**引擎（WO-P2 的 propagateTick 调用方）与路由（WO-P0）必须用同一份判据** ——
 * 各写一份就是第二套真相源，正是「两个 dev 各发明一套」那类事故的形态。
 */
export function isPerturbationActiveAt(p: Pick<Perturbation, "startTick" | "durationTicks">, tick: number): boolean {
  if (tick < p.startTick) return false;
  return p.durationTicks === null || tick < p.startTick + p.durationTicks;
}

/**
 * 把一条扰动施加到一份 `TickState` 上（**纯函数**：不改入参，返回新对象；R6 确定性）。
 *
 * ⚠ 这是 `/act` 与 `POST /perturbations` 的**唯一施加实现** —— `/act` 已改为
 * 「构造 `mode:"set"` / `durationTicks:null` 的等价扰动再走本函数」，
 * 故 PRD §7.2「`durationTicks: null` 与今天 `/act` 逐字节同结果」是**结构上成立**的，
 * 不是靠两处代码碰巧写得一样（那种「同结果」下一次改动就会漂移）。
 */
export function applyPerturbationToState(
  state: TickState,
  p: Pick<Perturbation, "targetObjectId" | "targetStateVar" | "magnitude" | "mode">,
): TickState {
  const next: TickState = JSON.parse(JSON.stringify(state)) as TickState;
  const bucket = (next[p.targetObjectId] ??= {});
  const cur = Number(bucket[p.targetStateVar] ?? 0);
  const m = Number(p.magnitude);
  bucket[p.targetStateVar] = p.mode === "delta" ? cur + m : p.mode === "scale" ? cur * m : m;
  return next;
}

// ── SimCertification 就绪认证（增量 2 · 派生投影对象·RL3 投影既有 closure 零新校验） ──
// schema 见 docs/SPEC-sandbox-readiness-certification.md §1。每个数字可溯回具体 closure finding（R13）。
export const SimCertLevelSchema = z.enum([
  "L0_INVALID", // 类型未定义/未发布
  "L1_CONFIGURED", // 已定义+归域，未发布/未跑派生
  "L2_RUNNABLE", // 已发布，能跑派生/求解器
  "L3_VERIFIED", // closure.gatePassed 且 Trial Tick PASS
  "L4_CERTIFIED", // L3 + L4 三元组全真
]);
export type SimCertLevel = z.infer<typeof SimCertLevelSchema>;

export const SimCertificationSchema = z.object({
  scope: z.enum(["GLOBAL", "LOCAL"]), // 全局整本体 / 局部逐对象
  targetRef: z.string().nullable(), // LOCAL 时 = objectId 或 typeKey
  level: SimCertLevelSchema,
  dims: z.object({ // 三维准备度 0-100（投影，非新算）
    structure: z.number(), // 结构 ← OBJECT 维
    knowledge: z.number(), // 知识 ← DATA 维 + 利用率
    behavior: z.number(), // 行为 ← FORWARD 维 + Action
    composite: z.number(), // 综合 = 加权
  }),
  l4Checks: z.object({ // L4 三元组（竞品 L4 Certified 的三子项）
    fanoutSafe: z.boolean(), // 无高风险扇出
    writebackComplete: z.boolean(), // writeback 行动已配置
    observabilityMet: z.boolean(), // 图查询/切片达标
  }),
  // ── Trial Tick（空跑 1 tick）· 两条 WO 的**合成**（WO-CERT-CONTRACT-RECONCILE 裁决）────────
  //
  // 这块字段曾有两种设计各执一词，**裁决结果是两边各对一半，都保留**：
  //
  //  ① WO-CERT-HONESTY ③ 主张「`rulesFired` 这个名字本身就是错的」——**成立，已实测复验**。
  //     实测（`apps/datacore/test/sim-cert-contract-reconcile.seam.test.ts` ③）：对同一份本体
  //     调用两次 `recompute`，一次 `changes=[]`（认证路的实参）、一次喂真变更集，
  //     `order.length` **两次同为 2**，而 `updatedObjects` 分别是 0 与 1。
  //     ⇒ `order.length` 度量的是**派生依赖图的节点数（规模）**，与"本次触发了几条"完全无关；
  //       空变更集下 dirty 集为空 ⇒ 逐节点 `continue` ⇒ **零条派生公式被求值**。
  //     故派生那个数改名 `derivationNodes`（名副其实：它就是规模）。
  //
  //  ② WO-SIM-SCOPE-TRIAL 主张「传导相今天真的在跑、真的在数触发」——**同样成立，必须保留**。
  //     装配方 `app.ts` 确实调 `propagateTick` 并用 `firedPropagationRuleKeys` 计数，
  //     该函数只数「落下了即时贡献 或 排进了延迟队列」的规则 key（遍历到但源态为 0 /
  //     无匹配边 / 闸门拿不到 **都不算触发**）⇒ 它是**真·触发计数**，与①的规模数性质不同。
  //     ⚠ 因此 WO-CERT-HONESTY 原文「传导一条都没跑 / `propagationCovered` 今天恒 false」
  //       是对**它自己那条分支**的如实描述，合流到本线后**已不再成立** —— 这里据实翻正。
  //
  //  ③ 两条合起来正好判掉旧字段 `rulesFired = order.length + propFired`：
  //     **它把一个规模数加到一个触发数上**，量纲不成立，任何解读都是错的。故弃用（见下）。
  trialTick: z.object({
    /** 空跑**未抛异常** ⇒ 派生依赖图无环（`topoSort` 有环抛 `CyclicDerivationError`）。
     *  ⚠ 它证明的是「重算没崩」，**不是**「这个世界推得动」。 */
    passed: z.boolean(),
    /**
     * ⚠ 追加一条来自 WO-SIM-ACT-CLOSE 的独立论据（**不是重复上面那条，别删**）：
     * 立这些拆账字段还有第二个理由 —— 一次真实的静默错答。旧 `rulesFired` 恒等于派生 topo 长度，
     * 而 `worldCompleteness.propagationRules` 那一栏照样按"声明了几条"计入完整度
     * ⇒ **一个传导一条都跑不动的世界，认证也能报出漂亮的数字**。
     * 合成一个数恰好把这件事盖住（同族戒律：一个笼统数字盖住两个不同事实），所以两相必须拆开报。
     */
    /**
     * 派生依赖图的**规模** = 拓扑排序出的派生规格节点数（`recompute` 的 `order.length`）。
     * ⚠ **不是触发数**：认证路以 `changes=[]` 调用，本次求值恒 0 条。名字即口径，别再当"触发"读。
     *
     * ⚠ 本字段与以下三个新字段**刻意 optional 而非 required**（沿用 canonical 侧既定理由，
     * 别推翻）：`SimCertification` 在前端被当**字面量**构造 7 处
     * （`apps/frontend-shell/test/sandbox-p0.test.tsx` 的 `const CERT_GLOBAL: SimCertification = {…}` 等
     * 6 个测试 + `src/mocks/handlers.ts`），置为必填会把整包前端打成编译红。
     * DataCore 侧**恒填**（`app.ts assembleCertification`），故服务端答复里它们总在
     * （由 `sim-cert-contract-reconcile.seam.test.ts` ③ 端到端咬住"恒填"这件事）。
     */
    derivationNodes: z.number().int().optional(),
    /** 传导相本次 Trial Tick **真正产出贡献**的规则数（真·触发计数，来源 `firedPropagationRuleKeys`）。 */
    propagationRulesFired: z.number().int().optional(),
    /**
     * 本次 Trial Tick **范围内已发布**的传导规则数 = `propagationRulesFired` 的**分母**。
     * 有了它，`declared > 0 && fired === 0`（"规则声明了一堆，一条都没触发"）这个病样才**看得见**；
     * 只报 fired 的话，"没有规则"与"有规则但全哑火"在屏上都是 0，无法分辨。
     */
    propagationRulesDeclared: z.number().int().optional(),
    /**
     * 本次空跑**是否真的覆盖了传导相**。合流后由 `app.ts` 恒传 `true`（它确实调了 `propagateTick`）；
     * 若将来把传导相摘掉/短路，这里必须翻 `false` —— 它是这条路**真实覆盖面**的声明，
     * 不是 UI 文案开关。前端据此标注，别在 UI 里硬写"传导已/未纳入"这句话。
     */
    propagationCovered: z.boolean().optional(),
    /**
     * @deprecated 口径不成立，勿用于新代码。曾定义为「两栈合计」= 派生 `order.length` + 传导 fired，
     * 即**规模数 + 触发数**，量纲不通（见本块头 ③）。为**过渡可回退**保留并继续下发原值，
     * 消费方请改读 `derivationNodes` / `propagationRulesFired` / `propagationRulesDeclared`。
     * **可删条件**：全仓无读端（判据 `grep -rn "rulesFired" apps packages --include=*.ts --include=*.tsx`
     * 只剩本契约定义与 `app.ts` 的写入点）时即可连同 `derivationRulesFired` 一并删除。
     */
    rulesFired: z.number().int().optional(),
    /** @deprecated 已改名 `derivationNodes`（同值）。保留仅为过渡，删除条件同 `rulesFired`。 */
    derivationRulesFired: z.number().int().optional(),
    at: z.string().nullable(),
    error: z.string().nullable(),
  }),
  worldCompleteness: z.object({ // 世界完整度（范围预检 = init step③）
    pct: z.number(), // 0-100 = 100 × Σpresent / Σneeded（下列**三**对比值，不含已弃用的 stateVars）
    /**
     * @deprecated 不再下发、**不再参与 `pct`**（WO-CERT-HONESTY ①，本单复验成立）。
     * 理由：它**两半都是复制品** —— `present` 取自 `presentDerivations`（与 `derivationRules`
     * 同一个变量），`needed` 在 `app.ts` 是与 `derivationRules` **逐字节相同**的表达式
     * （两行都是 `types.reduce((a, t) => a + t.derivedProperties.length, 0)`，已实测比对）。
     * ⇒ 它不度量任何独立事实：屏上「状态变量 N/M」与「派生规则 N/M」恒等，
     *   且把派生在 `pct` 的分子与分母里**各数了两遍**（系统性把 pct 拉向派生那个比值）。
     * 本平台真正的「状态变量」= 传导规则 source/target stateVar 的去重集
     * （同 `SandboxViewConfig.stateVars`），但**没有任何承载物声明「这个世界应该有几个」**
     * ⇒ 做不出诚实的 `needed` ⇒ 不做成比值，改由 `stateVarKeys` 列真名。
     * 保留为 optional 仅为**过渡可回退**（前端 7 处字面量仍在供它）；删除条件同 `trialTick.rulesFired`。
     */
    stateVars: z.object({ present: z.number().int(), needed: z.number().int() }).optional(),
    derivationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    actions: z.object({ present: z.number().int(), needed: z.number().int() }),
    propagationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    /** 这个世界**将承载的状态变量名**（去重升序）。定义与 `SandboxViewConfig.stateVars` 单源一致：
     *  scope 内传导规则的 `sourceStateVar ∪ targetStateVar`。是**清单不是比值**（无 needed 承载物）。
     *  optional 之由同 `trialTick.derivationNodes`（前端 7 处字面量）；DataCore 侧恒填。 */
    stateVarKeys: z.array(z.string()).optional(),
    /** 将进入沙盘的**要素**清单。⚠ 不叫「状态变量」：三种 kind 里只有 DERIVATION 是属性，
     *  ACTION 是写回动作、PROPAGATION 是传导规则 —— 前端必须按 kind 分组显示，别拿一个名词盖三样东西。 */
    entering: z.array(z.object({
      key: z.string(),
      kind: z.enum(["DERIVATION", "ACTION", "PROPAGATION"]),
      source: z.string(),
      /** ACTION 条目的归因键（WO-ACTIONTYPE-TARGET）：本动作的主目标对象类型。
       *  `null` = 不可静态归因（≠ 无目标；三情形见 `ActionTypeSchema.targetTypeKey` 注释），
       *  前端**不许**把 null 渲染成「无目标」。optional 之由同 `trialTick.derivationNodes`
       *  （前端 7 处字面量构造）；非 ACTION 条目不下发。 */
      targetTypeKey: z.string().nullable().optional(),
    })),
    /** scope 内**不可静态归因**的 ActionType 数（`targetTypeKey` 缺省 · WO-ACTIONTYPE-TARGET）。
     *  LOCAL 认证里它们不计入 `actions.present`（计入就是冒充可归因），但必须作为不可归因**可见**——
     *  「这个类型上 0 个可归因动作」与「这个类型没问题」在屏上必须分得出。optional 之由同上。 */
    unattributedActions: z.number().int().optional(),
  }),
  canEnterSimulation: z.boolean(), // = L4 ∧ trialTick.passed ∧ closure.gatePassed
  gaps: z.array(z.object({ gapCode: z.string(), ref: z.string(), detail: z.string() })), // 缺件诚实清单
  computedAt: z.string(),
});
export type SimCertification = z.infer<typeof SimCertificationSchema>;

// ── SandboxViewConfig 沙盘视图配置（增量 4 · 配置驱动 5 屏·零业务常数 R14） ──────────
// 由租户本体 + 传导规则**派生**（GET /a/v1/sim/view-config），换租户/行业=换本体内容不改代码。
// 前端 5 屏(数据管道/逐实体/就绪/初始化/沙盘主屏)全从本配置渲染节点/边/状态变量/雷达维。
export const SandboxViewConfigSchema = z.object({
  tenantId: z.string(),
  nodeTypes: z.array(z.string()), // 拓扑节点 = 已发布对象类型 key（任意行业）
  linkTypes: z.array(z.string()), // 传导边 = 已发布链路 key
  stateVars: z.array(z.string()), // 状态变量（KPI/雷达维，派生自传导规则 source/target stateVar）
  radarDims: z.array(z.object({ key: z.string(), label: z.string() })), // 就绪雷达维（结构/知识/行为 + 可扩）
  screens: z.array(z.enum(["pipeline", "entity", "readiness", "init", "sandbox"])),
  propagationCount: z.number().int(), // 本租户已发布传导规则数（0=纯建模态）
  // P0 修（评审打回·UI tick 传导哑）：每 nodeType → 真物化对象 id 列表（= propagateTick 引擎 idsByType 同源，
  // repos.objects.listByType 非 mergedInto，稳定排序）。UI 据此把 tick0 快照键 = 真对象 id（不再 ${type}#0），
  // 使 state[sourceId] 真命中 → tick 真传导 → 节点真变色。空世界时该类型列表为空（页面退占位仍可跑）。
  nodeObjectIds: z.record(z.string(), z.array(z.string())).optional(),
  /**
   * WO-STATEVAR-DISPLAYNAME · **状态变量裸键 → 中文业务名**（`loadIndex` → 「负载指数」）。
   *
   * 病灶是三分法的**没接线**：`stateVars` 一直只有裸键，全链**没有任何字段**承载它们的名字，
   * 于是沙盘 KPI / 扰动落点下拉 / 导出表一律显示 `loadIndex` 这种接线名，没参与建模的人读不懂。
   *
   * ⚠ **读时投影，不是入库字段**：由 `GET /a/v1/sim/view-config` 每次从**后端单源表**
   * （`synthetic/battery.ts` 的 `STATE_VAR_DISPLAY_NAMES`）现查后填。真值源在后端、前端只消费 ——
   * 前端自建一份中文映射就是第二套真相源（本仓治过多次）。
   *
   * ⚠ **只收登记过的键**：查不到的变量**不出现在本字典里**，而不是填裸键或空串。
   * 字典里出现 `loadIndex: "loadIndex"` 会让前端分不出「名字恰好等于键」与「压根没名字」，
   * 屏上也就无从把"这是回落"如实标出来。缺席 = 明确的"没有名字"。
   *
   * ⚠ **`.optional()` 而不是 `.default({})`**：本字段与它上面的 `nodeObjectIds` 是同一类**后补的投影**，
   * 必填会逼着改全仓 **17 个**构造本配置字面量的前端测试（实测 `tsc` 报 17 处 TS2741）——
   * 那些改动与本单要治的病一行关系都没有，纯属把契约的形状变化转嫁成无关返工。
   * 缺省 `undefined` ⇒ 与本字段引入前**逐字节同屏**（additive · 可回退 RL9）：全部回落裸键，页面照常可用。
   */
  stateVarNames: z.record(z.string(), z.string()).optional(),
});
export type SandboxViewConfig = z.infer<typeof SandboxViewConfigSchema>;

/**
 * `GET /a/v1/sim/propagation-rules` 的响应信封。
 *
 * ── 为什么状态变量名走**信封上的字典**，而不是像 `sourceTypeName` 那样挂在每条规则上 ──────
 *  · **字典的键就是变量名本身** —— 挂到规则上要存两份（source/target），35 条边重复 70 次，
 *    还得防两处写出不同的名字；字典天然只有一份，不给漂移留空间。
 *  · **沙盘那一屏拿不到类型** —— `SandboxViewConfig.stateVars` 是跨类型去重后的 `string[]`，
 *    两个端点用**同一种形状**（`stateVarNames`）前端才能共用一条消费路径，不写两套。
 *  · **不碰 `PropagationRuleSchema`** —— 该 schema 被 `seed.ts` 的 35 条字面量以
 *    `Omit<PropagationRule, …>` 引用，加必填字段会逼着改那 35 条种子（本单范围外）。
 */
export const PropagationRulesResponseSchema = z.object({
  items: z.array(PropagationRuleSchema),
  /**
   * 口径与 `SandboxViewConfig.stateVarNames` **逐条相同**（同一张后端单源表，同一个投影函数）。
   * 同样取 `.optional()`：前端 mock 里大量 `{ items: [...] }` 的桩响应不必为此逐个补字段。
   */
  stateVarNames: z.record(z.string(), z.string()).optional(),
});
export type PropagationRulesResponse = z.infer<typeof PropagationRulesResponseSchema>;

// ── ChangeImpactPreview 变更传播预览（WO-CHANGE-IMPACT-PREVIEW）────────────────────
// 病灶：用户改扰动/关传导边/改派生公式，按下去之前看不到波及面（G-LEVER-SNAPSHOT-UNIT-LIE 同源）。
// POST /a/v1/sim/change-impact-preview：纯只读预览，按关系类型分桶 + 逐跳计数 + 诚实位。
// 模型层实现 = apps/datacore/src/sim/change-impact.ts（语义依据见其头注）。
export const ChangeFocusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stateVar"), objectId: z.string(), stateVar: z.string() }),
  z.object({ kind: z.literal("prop"), objectId: z.string(), propKey: z.string() }),
  z.object({ kind: z.literal("propagationRule"), ruleKey: z.string() }),
  z.object({ kind: z.literal("link"), linkKey: z.string(), fromId: z.string(), toId: z.string() }),
  z.object({ kind: z.literal("derivedProp"), typeKey: z.string(), propKey: z.string() }),
]);
export type ChangeFocus = z.infer<typeof ChangeFocusSchema>;

export const ChangeImpactItemSchema = z.object({
  /** recompute=传导重算（sv:obj.var）· rederive=派生重算（op:obj.prop）· rejudge=规则重判（rule:key）· rewire=结构改写（pr:/spec:）。 */
  bucket: z.enum(["recompute", "rederive", "rejudge", "rewire"]),
  target: z.string(),
  hops: z.number().int().min(1), // 焦点不计，每经一条边 +1（BFS 首达最短跳数）
  via: z.string(), // 经由：传导规则 key / derived:{type}.{prop} / spec:{key} / linkKey / "expression"
});
export type ChangeImpactItem = z.infer<typeof ChangeImpactItemSchema>;

export const ChangeImpactPreviewSchema = z.object({
  focus: ChangeFocusSchema,
  /** 稳定排序 (hops, bucket, target)（R6）。 */
  items: z.array(ChangeImpactItemSchema),
  /** 诚实位：追不到的明说「什么追不到、缺什么」。⛔ 空集不许冒充「没有波及」——
   *  items 空 + unresolved 空 = 焦点确为叶子；unresolved 非空 = 有算不出来的部分。 */
  unresolved: z.array(z.object({ what: z.string(), missing: z.string() })),
  truncated: z.boolean(), // MAX_HOPS 保险丝触发（触发必伴随 unresolved 点名）
  maxHops: z.number().int(),
});
export type ChangeImpactPreview = z.infer<typeof ChangeImpactPreviewSchema>;

export const ChangeImpactPreviewRequestSchema = z.object({ focus: ChangeFocusSchema });
export type ChangeImpactPreviewRequest = z.infer<typeof ChangeImpactPreviewRequestSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// WO-SIM-BE-PARETO · 帕累托解集（多目标权衡的**解集**，不是 80/20 排行）
// ══════════════════════════════════════════════════════════════════════════════
//
// ⚠️ **命名撞车预警（这不是客套，本单开工第一件事就撞上了）**：
//    本仓已有一个 `buildPareto`（`frontend-shell/src/views/sim/sandboxConsoleModel.ts`），
//    那是**帕累托图**——把环节按 `pctOfChainLoss` 降序取 Top-N，单指标排行，无目标、无支配关系。
//    本节是**帕累托前沿**——多目标下互不支配的**解集**。两者同名不同物，
//    谁把它们当成一回事，谁就会得出「解集能力已经有了」这个恰好相反的结论。
//
// 为什么沙盘需要它：`optimize_whatif` 今天一次只回**两个**解（`baselineSolution` /
// `perturbedSolution`）——同一条扰动路径上的前后快照。决策者真正要问的
// 「少花钱和快交付之间有哪些不吃亏的折中」，两个点答不了，要的是一条前沿。

/**
 * 目标方向。**必须显式声明**，不许由代码按目标名猜。
 * （把方向写死在代码里，下次新增一个「最大化准时率」就会被静默算反——
 *  而算反的前沿看起来完全正常：它仍然是一条曲线，只是选出来的是最差的那批解。）
 */
export const ParetoObjectiveDirSchema = z.enum(["min", "max"]);
export type ParetoObjectiveDir = z.infer<typeof ParetoObjectiveDirSchema>;

export const ParetoObjectiveSchema = z.strictObject({
  /** 目标键，须能在解的 `metrics` 里取到同名数值（取不到 ⇒ 该解判不可行，**不补 0**）。 */
  key: z.string().min(1),
  dir: ParetoObjectiveDirSchema,
  /** 人读名与量纲（前端只格式化，不另维护映射表·R14）。 */
  label: z.string().min(1).optional(),
  unit: z.string().optional(),
});
export type ParetoObjective = z.infer<typeof ParetoObjectiveSchema>;

/**
 * 一条绑定约束的裕度读数。
 *
 * `tight` 的判据**写在这里，不让前端猜阈值**：`slack <= PARETO_TIGHT_EPS`。
 * 取绝对 eps 而非相对百分比，是因为链上所有数值都已按 `1e-6` 量化
 * （与 `opt-whatif.ts` 的 `Math.round(x*1e6)/1e6` 同一口径）——
 * eps 正好等于这条链的数值分辨率，比它小的差已经不是「差」而是量化噪声。
 */
export const ParetoBindingSchema = z.strictObject({
  key: z.string().min(1),
  /** 该解在这条约束上的实际取值。 */
  value: z.number(),
  /** 上限（调用方声明；本层不编造上限）。 */
  limit: z.number(),
  /** `limit - value`。负数 = 越界 ⇒ 该解 `feasible:false`。 */
  slack: z.number(),
  /** 是否顶到边（判据见本 schema 注释，唯一声明处）。 */
  tight: z.boolean(),
});
export type ParetoBinding = z.infer<typeof ParetoBindingSchema>;

/** 一个杠杆档位（`key` = 扰动 target，与 `optimize_whatif` 的 DF.8 接地语法同一套）。 */
export const ParetoLeverSettingSchema = z.strictObject({
  key: z.string().min(1),
  value: z.number(),
});
export type ParetoLeverSetting = z.infer<typeof ParetoLeverSettingSchema>;

/** 解集里的一个解 = 「一组杠杆档位 → 各目标读数 + 各约束裕度」。 */
export const ParetoSolutionSchema = z.strictObject({
  /** 稳定 id，**由杠杆档位派生**（`paretoSolutionId`），故可从公开字段重建。 */
  id: z.string().min(1),
  label: z.string().min(1),
  levers: z.array(ParetoLeverSettingSchema).min(1),
  /** 目标读数（键含全部 `objectives[].key`）。 */
  metrics: z.record(z.string(), z.number()),
  bindings: z.array(ParetoBindingSchema),
  /** 求解可行 **且** 全部绑定约束不越界。`false` 的解不参与前沿竞争。 */
  feasible: z.boolean(),
});
export type ParetoSolution = z.infer<typeof ParetoSolutionSchema>;

/**
 * 帕累托解集结果。
 *
 * **账必须是平的**：`iterations === frontier.length + dominated.length + residual`。
 * `residual` = 因不可行（求解 INFEASIBLE / 越界 / 目标读数缺失）被剔出竞争的候选数。
 * 这条恒等式让「解去哪了」可被机器核 —— 不平就是有解被静默吞掉了。
 */
export const ParetoResultSchema = z.strictObject({
  /** 原样回显，前端画轴要用（方向也在里面，不许前端自己猜）。 */
  objectives: z.array(ParetoObjectiveSchema).min(2),
  /** 互不支配的解（**已做逐对支配剔除**，被支配者绝不出现在这里）。 */
  frontier: z.array(ParetoSolutionSchema),
  /** 被支配的可行解（前端散点画灰点用）。与 `frontier` 交集恒为空。 */
  dominated: z.array(ParetoSolutionSchema),
  /** 枚举并求解的候选总数（= 杠杆网格笛卡尔积大小）。 */
  iterations: z.number().int().nonnegative(),
  /** 守恒残差（见本 schema 注释）。 */
  residual: z.number().int().nonnegative(),
});
export type ParetoResult = z.infer<typeof ParetoResultSchema>;

/** 单根杠杆的候选档位（网格的一维）。 */
export const ParetoLeverGridSchema = z.strictObject({
  /** 扰动 target，如 `facilities.F1.openCost`（DF.8 接地，语法同 `optimize_whatif`）。 */
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  /** 候选取值；内部会去重 + 升序，故请求里的顺序不影响结果（R6）。 */
  values: z.array(z.number()).min(1),
});
export type ParetoLeverGrid = z.infer<typeof ParetoLeverGridSchema>;

/**
 * 请求体。
 *
 * `objectives` 至少两个 —— 单目标下「前沿」退化成「最优解」，那是 `optimize_whatif` 的活；
 * 允许 1 个目标只会让调用方以为自己在做权衡分析，而其实没有。
 */
export const ParetoRequestSchema = z.strictObject({
  /** 推演会话 id（R6 确定性键的一部分：同 session + 同杠杆集 + 同参数版本 ⇒ 字节级一致）。 */
  sessionId: z.string().min(1).optional(),
  /** 优化模板族（5 核心之一，与 `optimize_whatif` 同一套）。 */
  family: z.string().min(1),
  /** 基线 args（杠杆扰动施加在它的克隆上，R4 不落真值）。 */
  args: z.record(z.string(), z.unknown()).optional(),
  objectives: z.array(ParetoObjectiveSchema).min(2),
  levers: z.array(ParetoLeverGridSchema).min(1),
  /** 绑定约束上限（不给 ⇒ 该解 `bindings` 为空数组，**不是**「没有约束」的断言）。 */
  constraints: z.array(z.strictObject({ key: z.string().min(1), limit: z.number() })).optional(),
});
export type ParetoRequest = z.infer<typeof ParetoRequestSchema>;

// ── WO-SIM-PARETO-MODEL-EXIT · 模型装配出口（`POST /a/v1/sim/optimize-pareto/assemble`）──
//
// ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
// **X**：`ParetoRequest` 的必填三件套（`family` + `objectives(≥2)` + `levers(≥1)`）是**建模产物**，
//   而本仓唯一能从租户本体自动装配它的两段代码**都没有出口**：
//   `solvers/opt-binding.ts` 的 `bindToSolverArgs`/`bindCrossObjectOccupancy` 要一份现成的
//   `OntologyBinding`（role→本体映射，谁来写？），`solvers/service.ts` 的
//   `assembleBaselineFromSelection` 是 `private`、只在 `optimize_whatif` 的 `autoBind` 分支里走，
//   且**只回 Δ目标不回 args**。于是调用方永远拿不到「一份可解的模型」⇒ 页4 前沿图恒占位。
// **Y**：本对请求/响应就是那个出口 —— 调用方只说「要优化什么范围」，
//   服务端从**本租户已发布本体**装配出完整模型并**原样回显成一份可直接 POST 的 `ParetoRequest`**。
//
// ══ 为什么是「单开只读装配口」而不是「给求解口加 autoBind 分支」════════════════
//  ① **装配失败必须是零求解**：契约要求「装配不出 ⇒ 前端不发 pareto 请求、保留占位」。
//     若装配长在求解口里，那一次请求**就是** pareto 请求 —— 「零 pareto 请求」这句话
//     字面上不可能成立，也就无从被测试咬住。
//  ② **可追溯**：装配结果是一份**可复制、可重放**的 `ParetoRequest`，屏上那条前沿对应的
//     请求体就是它本身；求解口回显的话，模型只活在响应里，重放要靠人抄。
//  ③ `ParetoRequestSchema` 是 `strictObject` 且三件套必填 —— 给它加 autoBind 分支
//     等于把必填改成条件必填，契约的拒绝力当场下降一档。
export const ParetoAssembleRequestSchema = z.strictObject({
  /** 推演会话 id：原样写进装配出的 `ParetoRequest.sessionId`（R6 确定性键，本层不解释它）。 */
  sessionId: z.string().min(1).optional(),
  /** 想要的模板族。不给 ⇒ 服务端按「今天真能装配且真能求解」的族挑（确定性顺序）。 */
  family: z.string().min(1).optional(),
  /**
   * 优化范围：选中的决策对象。**收窄的是资源侧那一类**（产能承载类型）——
   * 不给 ⇒ 全租户。给了 ⇒ 只有这些 id 参与，于是「产能真的不够用」这件事才可能发生。
   */
  selection: z.array(z.strictObject({
    objectType: z.string().min(1),
    objectId: z.string().min(1),
    label: z.string().optional(),
  })).optional(),
  /** 求解种子（R6）；不给由绑定层取默认。 */
  seed: z.number().optional(),
});
export type ParetoAssembleRequest = z.infer<typeof ParetoAssembleRequestSchema>;

/** 一条 role→本体 绑定的溯源行（屏上那条前沿「是从哪个类型的哪个字段来的」）。 */
export const ParetoAssembleRoleSchema = z.strictObject({
  role: z.string().min(1),
  kind: z.enum(["objectType", "property", "link"]),
  ref: z.string().min(1),
});
export type ParetoAssembleRole = z.infer<typeof ParetoAssembleRoleSchema>;

/**
 * 装配结果。
 *
 * **`applicable:false` 不是错误**（不是 4xx/5xx）：本租户本体撑不起这个模型是一个**结论**，
 * 不是服务端故障。故走 200 + 诚实位，理由与 `optimize_whatif` 的装配报缺同一条 ——
 * 报 400 会让调用方以为「我请求写错了」，于是去改请求，而真相是「本体里没有这一格」。
 * ⛔ 绝不兜一个假模型：缺角色就报缺，缺到只剩一个真目标也报缺（帕累托前沿需要两个真目标，
 *    补一个恒为 0 的第二目标会让屏上那条"前沿"是假的）。
 */
export const ParetoAssembleResultSchema = z.discriminatedUnion("applicable", [
  z.strictObject({
    applicable: z.literal(true),
    /** **可直接 POST 到 `/a/v1/sim/optimize-pareto` 的完整请求**（调用方不需要再拼任何一格）。 */
    request: ParetoRequestSchema,
    /** role→本体 溯源（R13/R14：换租户换本体，这张表跟着变，代码一行不动）。 */
    roles: z.array(ParetoAssembleRoleSchema),
    /** 装配过程中**诚实缺席**的可选角色（绑不到 ⇒ 该维度不参与，绝不伪造）。 */
    unboundRoles: z.array(z.string()),
    note: z.string(),
  }),
  z.strictObject({
    applicable: z.literal(false),
    /** 缺哪几格（原文点名类型/字段，供调用方去补本体而不是去改请求）。 */
    missingRoles: z.array(z.string()).min(1),
    note: z.string(),
  }),
]);
export type ParetoAssembleResult = z.infer<typeof ParetoAssembleResultSchema>;
