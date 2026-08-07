/**
 * WO-SANDBOX-S0 · 推演沙盘全链契约冻结（14 单系列的**唯一串行前置**）。
 *
 * ── 这份文件是什么 ────────────────────────────────────────────────────────
 * 后面 12 张单（数据层 D1–D4 / 引擎层 E1–E4 / 前端层 F1–F4）全部按本文件冻结的形状施工。
 * 因此本文件的纪律是「**口径定死 + 单一实现**」：凡是能被两个 dev 各写一遍并悄悄写歪的算式
 * （等待期望、损失占比分母、增值判据、排序全序），一律在这里出一份**唯一函数**，不许各处再写。
 *
 * ── 冻结的五个契约（工单原文顺序）────────────────────────────────────────
 *  1. `ChainNode` / `ChainStep`   —— 节点与其内部五段环节（前置期 = 五段之和，只有 `work` 增值）
 *  2. `Cadence`（一等公民）        —— **等待期望 = everyDays / 2**（§2·全沙盘最值钱的一条）
 *  3. `ChainImpediment`            —— 卡点/堵点/断点三类（PRD §5.1 判据）· **派生对象**，不进 R4 审批面
 *  4. `LossAttribution`            —— `pctOfChainLoss` 的分母**排除增值段**（§5·守恒 Σ==100%）
 *  5. `ChainScope`                 —— 闭「业务线维度带不下去」的口子（`businessTypes`/`baseIds`/`modelIds`）
 *
 * ── 复用的既有单源（R14 · 禁止在本文件内联任何业务线名 / 基地名）────────
 *  · 业务线枚举 = `BusinessTypeSchema`（`global-sim.ts`，`passenger|commercial|storage`），
 *    经 `BUSINESS_TYPE_LABEL` 与 `SEG_REGISTRY.seg` 对齐（桥函数 `segOfBusinessType`，**零字面量**）。
 *  · 基地枚举   = `BASE_REGISTRY.map(b => b.baseId)`（`base-registry.ts`，派生非抄写）。
 *  · 诚实位     = `DerivedDataModeSchema`（`derive-fields.ts`，LIVE/PARTIAL/SYNTHETIC/EMPTY）——
 *    `ChainImpediment` 是派生对象，复用派生侧的诚实位，不新造第三套 dataMode 词表。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────
 *  · **zod 4 strict**：全部用 `z.strictObject` —— 写错枚举值抛、**多写字段也抛**。
 *    「冻结」的含义就是多一个字段就得回到这里加，而不是各单自己在 payload 上长毛。
 *  · **禁止静默兜底**：算不出来的一律诚实缺席（函数返回 `null` / 空数组 / `undefined`），
 *    绝不返回一个看着合理的 0 或默认值。
 *  · **R6 确定性**：本文件全是纯函数与常量，无 `Date.now`、无随机、无时钟。
 *
 * ── 本单**不**冻结（留给后续单，additive 追加即可）────────────────────
 *  · `SolutionCandidate`（PRD §5.3 多方案候选）→ S3 单；本单不臆造其形状。
 *  · 采购段凭证对象（`SupplierLeadTime`/`MOQ`/`ASN`…）→ D2 单。
 *  · 阈值取值本身（利用率红线等）→ E3 单经规则 `params` 引用，**不落本文件**。
 */
import { z } from "zod";
import { BASE_REGISTRY, SEG_REGISTRY, type CanonicalSeg } from "./base-registry.js";
import { BUSINESS_TYPE_LABEL, BusinessTypeSchema, type BusinessType } from "./global-sim.js";
import { DerivedDataModeSchema } from "./derive-fields.js";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 链段（需求 → 订单 → 产能 → 物料 → 交付）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 全链五段（销售预测 → 物料采购 → 交付回款）。顺序即链路顺序，`ChainStage` 的取值集在此单一登记。
 *
 * ── WO-CHAIN-24：第 5 段 `DELIVERY` 是**末位追加**（R6：前序不动）────────────
 * 前四段（DEMAND/ORDER/CAPACITY/MATERIAL）**逐字不动** —— 动它们等于把 D1×E1 那次
 * 「两套词表交集为 0」的事故换个位置复现（§2.5 记着那笔账）。
 *
 * 主线序（`chainLineMap.ts` 的 `TRUNK_STAGES` = 本表除支线段 `MATERIAL` 外的全部）因此是
 * 需求 → 订单 → 产能 → **交付**，物料作为支线喂进产能段 —— 追加落在末位，主线序恰好仍然成立。
 *
 * **枚举变宽的连带责任**（加第 6 段时照此清点，别再靠 TS 报错碰运气）：
 *  · `Record<ChainStage, X>` 型的表会 TS 当场红（`chainLineMap.ts` / `chainImpediment.ts` 的 `STAGE_LABEL`）；
 *  · 但 `Partial<Record<…>>`、索引签名、`switch` 的 `default` 分支**不会红** —— 这几处必须人工走一遍。
 *    本单实测走过：`sandboxConsole.ts` 的 `buildStageBoard`（`CHAIN_STAGES.map`，自动多一条 lane）、
 *    `chainLineMap.ts` 的 `TRUNK_STAGES`（`filter`，自动多一段）、`sim/propagation.ts` 的
 *    `CadenceGateLookup`（`Record<string, …>`，键是 nodeId 不是 stage，不受影响）。
 */
export const CHAIN_STAGES = ["DEMAND", "ORDER", "CAPACITY", "MATERIAL", "DELIVERY"] as const;
export const ChainStageSchema = z.enum(CHAIN_STAGES);
export type ChainStage = z.infer<typeof ChainStageSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 2 · Cadence（节拍）—— 一等公民
// ══════════════════════════════════════════════════════════════════════════

/**
 * 节拍类型：会议（S&OP 共识会/订单评审）· 批处理（主计划批跑）· 结算（开票对账）· 发运（班车/整柜）。
 * 四类的共同点是「**不是随到随办，而是到点才办**」——这正是等待被制造出来的地方。
 */
export const CADENCE_KINDS = ["meeting", "batch", "settlement", "shipping"] as const;
export const CadenceKindSchema = z.enum(CADENCE_KINDS);
export type CadenceKind = z.infer<typeof CadenceKindSchema>;

/**
 * **节拍（Cadence）**：某个环节「多久处理一次」。全仓此前**没有任何契约承载这个概念**
 * （WO 系列 §1 实测：`grep` 全仓无「节拍」承载物），而实测全链 244.8 天里增值仅 48.9 天（20.0%），
 * 损失 Top3 全是「等节拍」、合计 30.7% —— 所以它必须是一等公民，不是某个 step 上的附属数字。
 *
 * - `everyDays`：周期长度（天）。必须 > 0（`0` 不是「随到随办」，随到随办是**没有** Cadence）。
 * - `offsetDays`：周期内**相位**（第几天开闸）。必须 ∈ [0, everyDays)。缺省 = 未标定相位，**不补默认值**。
 * - `kind`：节拍类型。
 */
export const CadenceSchema = z
  .strictObject({
    everyDays: z.number().positive(),
    offsetDays: z.number().nonnegative().optional(),
    kind: CadenceKindSchema,
  })
  .superRefine((c, ctx) => {
    if (c.offsetDays !== undefined && c.offsetDays >= c.everyDays) {
      ctx.addIssue({
        code: "custom",
        path: ["offsetDays"],
        message: `offsetDays 是周期内相位，必须 < everyDays（收到 offsetDays=${c.offsetDays} / everyDays=${c.everyDays}）`,
      });
    }
  });
export type Cadence = z.infer<typeof CadenceSchema>;

/**
 * ★★★ 本系列**最值钱的一条公式** ★★★
 *
 *      等待期望 E[wait] = everyDays / 2
 *
 * **推导（写清楚，免得后面有人「凭直觉」改成 everyDays）**：
 * 工作到达节拍闸门的时刻，在一个周期 `[0, everyDays)` 上**均匀分布**（无信息假设）。
 * 到达点 t 的等待 = `everyDays − t`（下一次开闸），故
 *      E[wait] = (1/everyDays) · ∫₀^everyDays (everyDays − t) dt = everyDays / 2。
 *
 * **两个常见错法，都会把全链前置期算错整整一倍**：
 *  ✗ `everyDays`     —— 那是**最坏**等待（刚好错过闸门），不是期望。
 *  ✗ `0`             —— 那是假设随到随办，等于把节拍当不存在。
 *
 * **`offsetDays` 不进公式**：相位只决定闸门开在周期内的哪一天，均匀到达假设下
 * 它移动的是每一次具体等待、**不改变期望**。谁要让期望随 offset 变，就是换了到达分布假设，
 * 那是另一个模型，必须先改本注释与锁死测试。
 *
 * 消费方判据（E4 单 SEAM）：把 S&OP 节拍 30d 改 7d → 全链前置期缩短量必须 == `Δ(everyDays)/2`，
 * 「随便变小了」不算通过。
 */
export function expectedCadenceWaitDays(cadence: Pick<Cadence, "everyDays">): number {
  return cadence.everyDays / 2;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2.5 · 全链节点注册表 —— **nodeId 的单一来源**
// ══════════════════════════════════════════════════════════════════════════

/**
 * 全链节点登记表。**本表是 `nodeId` 取值的唯一出处**，数据半 / 引擎半 / 前端一律从这里派生。
 *
 * ⚠ 本表是补一个**真实炸过的契约漏洞**，不是锦上添花：
 * S0 首版把 `ChainStepSchema.nodeId` / `ChainNodeSchema.nodeId` 冻成了 `z.string().min(1)` 自由串，
 * 没有注册表。结果 D1（数据半·节拍）与 E1（引擎半·损失归因）两个 dev **各自发明了一套全链节点词表**：
 *   · D1：`sop_consensus` / `order_review` / `master_schedule` / `mrp_run` / `settlement` …（snake_case 无前缀）
 *   · E1：`demand.consensus` / `order.cash` / `material.replenish` / `capacity.aging` …（`<stage>.<name>` 点分）
 * **交集为 0**。两边各自单测全绿，链路却整条断开：D1 推出来的节拍没有任何消费方能按 id 找到它。
 * 这正是本仓「绿测试 ≠ 能用 · 断在接缝」的教科书形态，也是「跨两半的特性必须一个 dev 整单做」的由来。
 *
 * 派生纪律与 `CANONICAL_BASE_IDS = BASE_REGISTRY.map(...)` 同族：**改册即改枚举**，
 * 任何一侧写字面量 nodeId 都是回退到出事前的状态。
 *
 * 字段：
 *  · `nodeId` —— canonical id，`<stage 小写>.<名>`，全仓唯一；
 *  · `label`  —— 人读名（前端**不另维护中文映射表**，一律取这里）；
 *  · `stage`  —— 所属阶段，必须与 `CHAIN_STAGES` 一致。
 *
 * ══ WO-CHAIN-24 · 12 → 24 条（**只在末位追加，前 12 条逐字不动**）══════════
 *
 * 前 12 条（`demand.consensus` … `material.shipping`）是 S0 冻结的原表，**一个 id 都没动**：
 * 改任何一个已在册 id = 把上面那次「交集为 0」的事故复现一遍（消费方按 id 查表，改 id 就是断链）。
 * 新增 12 条一律追加在末位 —— 因此 `CHAIN_NODE_REGISTRY[i]` 的下标语义对前 12 条保持稳定
 *（`apps/frontend-shell/test/node-inspector-reachable.test.tsx` 就按 `[4] === capacity.schedule` 取样）。
 *
 * ── 与设计稿的对照（**照实写，不圆场**）────────────────────────────────────
 * 设计稿 `sandbox-console-DESIGN-v2-with-zoom.html` 顶栏写「5 段 24 节点」，
 * 但它自己的 `N[]` 数组**实际是 27 张卡**（D1–D4 / P1–P5 / S1–S5 / M1–M7 / C1–C6）——
 * 标题与内容对不上，这是设计稿自身的不一致。本表取 **24**（= 顶栏数 = `CHAIN_STAGE_DESIGN_TARGET.nodeCount`），
 * 差出来的 3 张卡按下述**明确归属**处置，而不是硬塞成 27 条：
 *  · `M2 前道（涂布→卷绕）` / `M4 后道 PACK 组装` → **动态工序命名空间** `capacity.op.<opId>`
 *    （数量随 Routing/Operation 实例变，seed 42 下是 OP-001…OP-010，**不可能进静态表**，见 `CHAIN_OP_NODE_PREFIX`）；
 *  · `M5 工序间 WIP` → 同上：工序间纯等待今天由每道工序的 `capacity.op.<id>#setup`（`queue` 段）承载，
 *    另立静态节点会与它**重复计**同一段时间；
 *  · `M7 终检 FQC` → 并入既有 `capacity.quality`（质量与返工）—— 设计稿 M6 一张卡在本表本就拆成
 *    `capacity.qc_batch`（攒批节拍）+ `capacity.quality`（判定与返工）两条，放行闸属后者；
 *  · `P4 详细排产 APS` → 并入既有 `capacity.schedule`：今天全仓**只有一个排产承载物** `ProductionSchedule`
 *    （MPS 与 APS 共用），拆成两个节点会造出一个没有自己承载物的节点 —— 那是空壳不是建模。
 * 反向的一条：`capacity.maint`（计划检修窗）**在本表但设计稿没有这张卡** ——
 * 它是种子里证据最硬的真周期（13 基地各一个间隔且全等），`flowGate:false` 故不摊进链路，
 * 但它是真节点，不因为设计稿没画就删。
 *
 * ── 新增 12 条的段归属（为什么不按设计稿的 5 个 phase 一一对应）────────────
 * 设计稿的 phase 是**看板分组**（需求与承诺 / 计划与齐套 / 采购与到料 / 制造与质量 / 交付与回款），
 * 本表的 `stage` 是**契约枚举**，前 12 条已经把 C5/C6（开票 / 回款）钉在 `ORDER`、把 C2（发运节拍）钉在
 * `MATERIAL`。既然「前序不动」，就不能为了对齐看板把它们挪段。故：新段 `DELIVERY` 只收设计稿
 * 交付与回款 phase 里**尚无在册节点**的三张卡（C1 成品入库 / C3 运输在途 / C4 客户验收）。
 * 「同一个 phase 的节点散在两个 stage 上」是**今天的真实形态**，看板要按 phase 分组是前端的事，
 * 不是往契约里塞第二套分段。
 */
export const CHAIN_NODE_REGISTRY = [
  // ── 原表 12 条（S0 冻结·逐字不动）────────────────────────────────────────
  { nodeId: "demand.consensus", label: "S&OP 共识会", stage: "DEMAND" },
  { nodeId: "order.review", label: "订单评审", stage: "ORDER" },
  { nodeId: "order.cash", label: "订单回款", stage: "ORDER" },
  { nodeId: "order.settlement", label: "开票对账 / 月结", stage: "ORDER" },
  { nodeId: "capacity.schedule", label: "主计划排产", stage: "CAPACITY" },
  { nodeId: "capacity.qc_batch", label: "过程质检攒批", stage: "CAPACITY" },
  { nodeId: "capacity.quality", label: "质量与返工", stage: "CAPACITY" },
  { nodeId: "capacity.aging", label: "老化静置", stage: "CAPACITY" },
  { nodeId: "capacity.maint", label: "计划检修窗", stage: "CAPACITY" },
  { nodeId: "material.mrp", label: "MRP 运行", stage: "MATERIAL" },
  { nodeId: "material.replenish", label: "关键物料补货", stage: "MATERIAL" },
  { nodeId: "material.shipping", label: "发运节拍", stage: "MATERIAL" },
  // ── WO-CHAIN-24 追加 12 条 ───────────────────────────────────────────────
  // DEMAND：设计稿 D1 / D3（D2→demand.consensus、D4→order.review 已在册）
  { nodeId: "demand.forecast", label: "客户预告接收", stage: "DEMAND" },
  { nodeId: "demand.quote", label: "询报价", stage: "DEMAND" },
  // CAPACITY：设计稿 P3 / M1（P1→capacity.schedule、M3→capacity.aging、M6→qc_batch+quality 已在册）
  { nodeId: "capacity.rccp", label: "产能与瓶颈复核", stage: "CAPACITY" },
  { nodeId: "capacity.wo_release", label: "工单下达", stage: "CAPACITY" },
  // MATERIAL：设计稿 P5 / S1 / S2 / S4 / S5（P2→material.mrp、S3→material.replenish、C2→material.shipping 已在册）
  { nodeId: "material.kitting", label: "齐套发料", stage: "MATERIAL" },
  { nodeId: "material.purchase_req", label: "请购", stage: "MATERIAL" },
  { nodeId: "material.purchase_order", label: "采购下单", stage: "MATERIAL" },
  { nodeId: "material.inbound_transit", label: "入厂在途与清关", stage: "MATERIAL" },
  { nodeId: "material.iqc", label: "到货检验", stage: "MATERIAL" },
  // DELIVERY（新段）：设计稿 C1 / C3 / C4（C5→order.settlement、C6→order.cash 已在册·见上「段归属」）
  { nodeId: "delivery.fg_stock", label: "成品入库", stage: "DELIVERY" },
  { nodeId: "delivery.transit", label: "干线运输在途", stage: "DELIVERY" },
  { nodeId: "delivery.acceptance", label: "客户验收", stage: "DELIVERY" },
] as const satisfies readonly { nodeId: string; label: string; stage: ChainStage }[];

export type ChainNodeDef = (typeof CHAIN_NODE_REGISTRY)[number];
export const CHAIN_NODE_IDS: readonly string[] = CHAIN_NODE_REGISTRY.map((n) => n.nodeId);

/**
 * **逐工序节点的动态命名空间**（`capacity.op.<opId>`）。
 *
 * 工序节点数量随 Routing/Operation 实例变化（seed 42 下是 OP-001…OP-010），**不可能进静态注册表**。
 * 但前缀仍须单源 —— 否则「注册表管固定节点、工序节点各写各的」等于漏了一半。
 * 生成侧与消费侧都必须走本函数 / `CHAIN_OP_NODE_PREFIX`，不许手拼字符串。
 */
export const CHAIN_OP_NODE_PREFIX = "capacity.op." as const;
export function chainOpNodeId(opId: string): string {
  return `${CHAIN_OP_NODE_PREFIX}${opId}`;
}
export function isChainOpNodeId(nodeId: string): boolean {
  return nodeId.startsWith(CHAIN_OP_NODE_PREFIX);
}

/** 取注册表节点定义；不在册返回 `undefined`（调用方自己决定是报错还是当动态工序节点）。 */
export function chainNodeDef(nodeId: string): ChainNodeDef | undefined {
  return CHAIN_NODE_REGISTRY.find((n) => n.nodeId === nodeId);
}

/**
 * `nodeId` 合法性判据：**在册** 或 **属工序动态命名空间**。
 * 两者都不是 ⇒ 有人又在写自由串了，调用方应当红。
 */
export function isKnownChainNodeId(nodeId: string): boolean {
  return chainNodeDef(nodeId) !== undefined || isChainOpNodeId(nodeId);
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · ChainScope（范围）—— 闭「业务线维度带不下去」的口子
// ══════════════════════════════════════════════════════════════════════════

/**
 * 基地 id 取值集：**从 `BASE_REGISTRY` 派生**（不是抄一份）。改册即改枚举，`boundary-singlesource` 同族纪律。
 * 注：`baseId` 是拼音 canonical id；求解器侧还认中文名 / `obj_base_<id>` 等松散写法，
 * 那些**必须先经 `normalizeBaseRef` 归一**再构造 `ChainScope` —— `ChainScope` 是**归一后**的形态。
 */
export const CANONICAL_BASE_IDS: readonly string[] = BASE_REGISTRY.map((b) => b.baseId);
export const CanonicalBaseIdSchema = z.enum(CANONICAL_BASE_IDS);
export type CanonicalBaseId = z.infer<typeof CanonicalBaseIdSchema>;

/**
 * **业务线 → 应用细分册（`SEG_REGISTRY`）的桥**。
 *
 * 本仓同一批「三业务线」今天有**两套词表**：
 *   · `BusinessTypeSchema`（`global-sim.ts`）：`passenger | commercial | storage` —— 求解器/订单侧在用；
 *   · `SEG_REGISTRY[].seg`（`base-registry.ts`）：中文细分名 + `priceWan/marginPct/floorPct` 经济参数。
 * 二者靠 `BUSINESS_TYPE_LABEL` 对齐。本函数就是那座桥的**唯一出口**：
 * 拿业务线取它的价/利/底线（PRD §5.4「跨 seg 争用保谁」的判据来源）走这里，
 * **不许再在任何地方手写「中文细分名 → 业务线枚举」的映射表**
 * （`apps/datacore/src/solvers/portfolio.ts:709` 已有一份内联的 `CN_TO_BT`，属存量债，见交付说明）。
 *
 * 诚实缺席：两册若哪天漂了（一册加了第四条另一册没加），这里返回 `undefined` 而**不是**兜一个默认细分。
 */
export function segOfBusinessType(bt: BusinessType): CanonicalSeg | undefined {
  const label = BUSINESS_TYPE_LABEL[bt];
  return SEG_REGISTRY.find((s) => s.seg === label);
}

/**
 * **ChainScope**：一次扫描/推演的范围裁剪。这是闭「业务线维度带不下去」的契约口子——
 * WO 系列 §1 实测：`args.baseId` 有 4 处求解器读、`args.modelId` 6 处，
 * 而 `args.businessType` / `args.segment` **0 处**（三分法定性 = 「接了线接错地方」，缺的是挂载点）。
 *
 * **三个字段全 optional，全缺省 = 未限定（全域）**。用 `isChainScopeUnscoped()` 判，别自己写 `if`。
 * 空数组被 schema 拒绝：`[]` 在「全域」与「空集」之间语义两可，两可就会变成静默兜底。
 * 要表达全域就把字段**整个省掉**（诚实缺席），要表达限定就至少给一个值。
 *
 * 注（`modelIds` 的诚实边界）：型号今天**没有** contracts 级单一来源册
 * （`MODEL_BASE_MAP` 在 `apps/datacore/src/synthetic/battery.ts` 里，跨包不可依赖 R1），
 * 故只能约束为非空字符串。不臆造一份型号册——那会立刻变成第二个真相源。
 */
export const ChainScopeSchema = z.strictObject({
  /** 业务线（复用 `BusinessTypeSchema` 单源 · 经 `segOfBusinessType` 取经济参数）。 */
  businessTypes: z.array(BusinessTypeSchema).min(1).optional(),
  /** 基地 canonical id（派生自 `BASE_REGISTRY`；松散写法须先 `normalizeBaseRef` 归一）。 */
  baseIds: z.array(CanonicalBaseIdSchema).min(1).optional(),
  /** 型号 id（无 contracts 级单源册，见上注）。 */
  modelIds: z.array(z.string().min(1)).min(1).optional(),
});
export type ChainScope = z.infer<typeof ChainScopeSchema>;

/** 未限定（全域）判据的**唯一实现**：三维皆缺省。R-ARG-FIDELITY：结果回带 scope，让前端看得见「未指定→全域」。 */
export function isChainScopeUnscoped(scope: ChainScope): boolean {
  return scope.businessTypes === undefined && scope.baseIds === undefined && scope.modelIds === undefined;
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · ChainStep / ChainNode（五段环节与节点）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 环节五段。一个节点的**前置期 = 五段之和**，其中**只有 `work` 是增值**。
 *  · `queue`    排队等资源（前面有活）
 *  · `cadence`  等节拍（到点才办 —— 见 §2，损失 Top3 全在这里）
 *  · `work`     实际作业 ← **唯一增值段**
 *  · `rework`   返工（做过一遍又回来，线路图上的红弧）
 *  · `handoff`  交接/流转（换人换系统换地点）
 */
export const CHAIN_STEP_KINDS = ["queue", "cadence", "work", "rework", "handoff"] as const;
export const ChainStepKindSchema = z.enum(CHAIN_STEP_KINDS);
export type ChainStepKind = z.infer<typeof ChainStepKindSchema>;

/** 五段中**唯一**的增值段。增值判据的单一来源——各处禁止再写 `kind === "work"`，一律走 `isValueAddKind`。 */
export const VALUE_ADD_STEP_KIND = "work" as const satisfies ChainStepKind;
/** `kind` 需要挂 `Cadence` 的那一段。 */
export const CADENCE_STEP_KIND = "cadence" as const satisfies ChainStepKind;

/** 增值判据的**唯一实现**（`valueAdd` 字段的真值 oracle）。 */
export function isValueAddKind(kind: ChainStepKind): boolean {
  return kind === VALUE_ADD_STEP_KIND;
}

/**
 * **ChainStep**：节点内部的一段耗时。
 *
 * 硬约束（schema 层锁死，不靠各单自觉）：
 *  ① `valueAdd` **必须**等于 `isValueAddKind(kind)` —— 二者不一致直接抛。
 *     `valueAdd` 保留为显式字段是为了线上载荷自解释（前端瀑布图不必反查规则），
 *     但它**不是**一个可独立编辑的旋钮：谁想让某个 `work` 段不增值，得先改本注释与本 schema。
 *     （教训同族：`expression` 与 `params` 两个数各自可编辑、谁也不校验谁 = G-C08-EXPR-PARAM-SPLIT。）
 *  ② `kind === "cadence"` ⟺ 带 `cadence` 对象 —— 等节拍的段必须说清等的是哪个节拍（R13 可溯源），
 *     非节拍段不许挂节拍（挂了就是把节拍语义摊到别处，E4 的到点放行会算重）。
 *
 * `days` 的口径：**期望态**天数。对 `kind === "cadence"` 的段，
 * 它必须由 `expectedCadenceWaitDays(cadence)` 产出（= `everyDays/2`，§2），
 * 建议直接用 `cadenceWaitStep()` 构造，别手填。
 * （schema 不做硬等式校验：`offsetDays` 存在的意义正是**单次**等待可以偏离期望；
 * 锁死的是**公式**不是每一条记录 —— 见 §2 与 `chain-sim.test.ts` 的公式锁死测试。）
 */
export const ChainStepSchema = z
  .strictObject({
    stepId: z.string().min(1),
    /** 所属节点（必须与 `ChainNode.nodeId` 一致，`ChainNodeSchema` 会校验）。 */
    nodeId: z.string().min(1),
    /** 人读标签（可选；缺省由前端按 kind 显示，不在此处编一个默认名）。 */
    label: z.string().min(1).optional(),
    kind: ChainStepKindSchema,
    /** 该段耗时（天，期望态）。 */
    days: z.number().nonnegative(),
    /** 是否增值。硬绑 `isValueAddKind(kind)`，见上 ①。 */
    valueAdd: z.boolean(),
    /** 等的是哪个节拍。硬绑 `kind === "cadence"`，见上 ②。 */
    cadence: CadenceSchema.optional(),
  })
  .superRefine((s, ctx) => {
    const expected = isValueAddKind(s.kind);
    if (s.valueAdd !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["valueAdd"],
        message: `valueAdd 必须 == isValueAddKind(kind)：kind="${s.kind}" ⇒ valueAdd 应为 ${expected}，收到 ${s.valueAdd}`,
      });
    }
    if (s.kind === CADENCE_STEP_KIND && s.cadence === undefined) {
      ctx.addIssue({ code: "custom", path: ["cadence"], message: `kind="${CADENCE_STEP_KIND}" 的环节必须带 cadence（等的是哪个节拍要可溯源·R13）` });
    }
    if (s.kind !== CADENCE_STEP_KIND && s.cadence !== undefined) {
      ctx.addIssue({ code: "custom", path: ["cadence"], message: `只有 kind="${CADENCE_STEP_KIND}" 的环节可以带 cadence（收到 kind="${s.kind}"）` });
    }
  });
export type ChainStep = z.infer<typeof ChainStepSchema>;

/**
 * 构造一条**等节拍**环节：`days` 由 `expectedCadenceWaitDays` 产出，杜绝手填写歪。
 * 12 张单里凡要种/算一段等节拍，走这里。
 */
export function cadenceWaitStep(args: { stepId: string; nodeId: string; cadence: Cadence; label?: string }): ChainStep {
  return {
    stepId: args.stepId,
    nodeId: args.nodeId,
    ...(args.label === undefined ? {} : { label: args.label }),
    kind: CADENCE_STEP_KIND,
    days: expectedCadenceWaitDays(args.cadence),
    valueAdd: isValueAddKind(CADENCE_STEP_KIND),
    cadence: args.cadence,
  };
}

/**
 * **ChainNode**：全链上的一个节点（一道工序 / 一次评审 / 一段采购），内部由若干 `ChainStep` 组成。
 * 前置期 = 五段之和（`nodeLeadTimeDays`），流动效率 = 增值 / 前置期（`nodeFlowEfficiency`）。
 * **派生量不落字段**（不存 `leadTimeDays`）：存了就会和 `steps` 漂，漂了没人发现。
 */
export const ChainNodeSchema = z
  .strictObject({
    nodeId: z.string().min(1),
    label: z.string().min(1),
    stage: ChainStageSchema,
    /** 该节点归属范围（哪条业务线 / 哪个基地 / 哪些型号）。缺省 = 未限定，见 `ChainScope`。 */
    scope: ChainScopeSchema.optional(),
    steps: z.array(ChainStepSchema).min(1),
  })
  .superRefine((n, ctx) => {
    const seen = new Set<string>();
    n.steps.forEach((s, i) => {
      if (s.nodeId !== n.nodeId) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "nodeId"], message: `step.nodeId="${s.nodeId}" 与所属 node.nodeId="${n.nodeId}" 不一致` });
      }
      if (seen.has(s.stepId)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "stepId"], message: `stepId 在节点内必须唯一（重复：${s.stepId}）` });
      }
      seen.add(s.stepId);
    });
  });
export type ChainNode = z.infer<typeof ChainNodeSchema>;

/** 节点前置期 = **五段之和**（天）。 */
export function nodeLeadTimeDays(node: Pick<ChainNode, "steps">): number {
  return node.steps.reduce((sum, s) => sum + s.days, 0);
}

/** 节点增值时间（天）= 仅 `work` 段。 */
export function nodeValueAddDays(node: Pick<ChainNode, "steps">): number {
  return node.steps.reduce((sum, s) => sum + (s.valueAdd ? s.days : 0), 0);
}

/**
 * 流动效率 = 增值 / 前置期 ∈ [0, 1]。
 * **前置期为 0 时返回 `null`**（无从谈起 → 诚实缺席，绝不返回 0 或 1 冒充一个读数）。
 */
export function nodeFlowEfficiency(node: Pick<ChainNode, "steps">): number | null {
  const lead = nodeLeadTimeDays(node);
  if (lead <= 0) return null;
  return nodeValueAddDays(node) / lead;
}

// ══════════════════════════════════════════════════════════════════════════
// § 5 · LossAttribution（环节级损失归因）—— 分母排除增值段
// ══════════════════════════════════════════════════════════════════════════

/**
 * **LossAttribution**：某个环节吃掉了全链损失的百分之多少。
 *
 * ★ 口径定死（本文件最容易被写歪的第二处，仅次于 §2 的等待期望）★
 *
 *      pctOfChainLoss = 该环节非增值天数 ÷ **全链非增值总量** × 100
 *                                          ^^^^^^^^^^^^^^^^
 *                                          分母**排除增值段**
 *
 * **推论（守恒律，由测试锁死）**：全链所有**非增值**环节的 `pctOfChainLoss` 之和 **== 100%**。
 *
 * **写错分母的样子**：把增值段也塞进分母（即用「全链前置期」当分母）——
 * 那算出来的是「占总耗时的比」，不是「占**损失**的比」，Σ 会变成 `非增值/前置期`（实测口径下约 80%），
 * 守恒律当场破。E1 单的变异反证咬的就是这一条。
 */
export const LossAttributionSchema = z.strictObject({
  stepId: z.string().min(1),
  /** 该环节的非增值天数（= `ChainStep.days`，因为增值段根本不进这张表）。 */
  nonValueDays: z.number().nonnegative(),
  /** 占**全链非增值总量**的百分比（0–100）。分母排除增值段，见上。 */
  pctOfChainLoss: z.number().min(0).max(100),
});
export type LossAttribution = z.infer<typeof LossAttributionSchema>;

/** 守恒律的判定容差（百分点）。Σ pct 与 100 的偏差超过它即视为口径破了。 */
export const LOSS_CONSERVATION_TOLERANCE_PCT = 0.001;

/**
 * 全链**非增值**总量（天）= 损失归因的**分母**。
 * ⚠ 这里是整个损失口径的单点：谁把 `s.valueAdd ? 0 : s.days` 改成 `s.days`，
 * 分母就变成了含增值段，守恒测必红（这正是变异反证 ① 的注入点）。
 */
export function chainNonValueDays(steps: readonly ChainStep[]): number {
  return steps.reduce((sum, s) => sum + (s.valueAdd ? 0 : s.days), 0);
}

/** 全链增值总量（天）—— 仅供展示/流动效率用，**不进损失归因的分母**。 */
export function chainValueAddDays(steps: readonly ChainStep[]): number {
  return steps.reduce((sum, s) => sum + (s.valueAdd ? s.days : 0), 0);
}

/**
 * 损失归因的**唯一实现**（E1 求解器 / F1 线路图站圈 / 任何看板都走这一份，不许各写一遍）。
 *
 * 诚实缺席：全链**无**非增值环节（分母为 0）时返回**空数组**——不返回一堆 0，也不返回 `NaN`。
 * 「没有损失」和「损失均摊为 0」是两件事，后者会让站圈全部画成同样大小，是假数据。
 *
 * 排序：按输入 `steps` 原序输出（调用方要排名自己排；此处不偷偷排序，保 R6 可预期）。
 */
export function computeLossAttribution(steps: readonly ChainStep[]): LossAttribution[] {
  const denom = chainNonValueDays(steps);
  if (denom <= 0) return [];
  return steps
    .filter((s) => !s.valueAdd)
    .map((s) => ({ stepId: s.stepId, nonValueDays: s.days, pctOfChainLoss: (s.days / denom) * 100 }));
}

/**
 * 守恒残差 = `Σ pctOfChainLoss − 100`。合格判据：`Math.abs(residual) <= LOSS_CONSERVATION_TOLERANCE_PCT`。
 * 空表返回 `null`（无归因行时「守恒」无意义 —— 返回 0 会让门在空数据上假绿，正是本仓 7/7 空数据那族病）。
 */
export function lossConservationResidual(rows: readonly LossAttribution[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + r.pctOfChainLoss, 0) - 100;
}

// ══════════════════════════════════════════════════════════════════════════
// § 6 · ChainImpediment（卡点 / 堵点 / 断点）—— 派生对象，不进 R4 审批面
// ══════════════════════════════════════════════════════════════════════════

/**
 * 三类阻滞点（PRD §5.1 判据；**互斥**，一个环节只出一类）：
 *  · `BOTTLENECK` 卡点：能力**不够**（利用率达红线 且 是全链最小通过率环节）→ 加产能有用。
 *  · `CONGESTION` 堵点：能力够但**流不动**（排队/WIP 高、实际/理论产出低，且利用率**未**达红线）→ 加产能没用。
 *  · `BREAK`      断点：链条**接不上**（缺料 / 提前期兜不住 / 算不出来）。
 * 同时满足卡点与堵点判据时，**按「利用率是否达红线」裁决（达线 = 卡点）** —— 判据顺序写进 E3 实现注释，
 * 不许靠 `if` 顺序的巧合（教训：`wo-capacity-100pct` 的「排序契约靠 clamp 巧合」）。
 */
export const CHAIN_IMPEDIMENT_KINDS = ["BOTTLENECK", "CONGESTION", "BREAK"] as const;
export const ChainImpedimentKindSchema = z.enum(CHAIN_IMPEDIMENT_KINDS);
export type ChainImpedimentKind = z.infer<typeof ChainImpedimentKindSchema>;

/**
 * 断点三亚型（`kind === "BREAK"` 时必填）：
 *  · `MATERIAL` 物理断：缺料（`mrp_netting.shortageCount > 0`）
 *  · `LEADTIME` 时间断：上游可用日 > 下游需求日（提前期兜不住）
 *  · `DATA`     数据断：**算不出来**（`dataMode === "EMPTY"`）—— 算不出来**也是一种发现**，
 *               今天的做法是静默给 0 或不显示，那正是 `genuine-sim` 战役打过的假数据病。
 */
export const CHAIN_BREAK_SUBTYPES = ["MATERIAL", "LEADTIME", "DATA"] as const;
export const ChainBreakSubtypeSchema = z.enum(CHAIN_BREAK_SUBTYPES);
export type ChainBreakSubtype = z.infer<typeof ChainBreakSubtypeSchema>;

/** 阻滞点落在哪个**真对象**上（R13：不许只落一个字符串描述）。 */
export const ChainLocusSchema = z.strictObject({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
  label: z.string().min(1),
});
export type ChainLocus = z.infer<typeof ChainLocusSchema>;

/**
 * R13 证据：每个数字都要能回答「凭什么」。
 * `metricValue` / `threshold` **必须来自求解器输出与规则 params**，不是判定时拍的常数
 * （E3 单：阈值一律经 `params` 引用；写死回字面量 → 该单的变异反证必红）。
 */
export const ChainImpedimentEvidenceSchema = z.strictObject({
  /** 算出该结论的求解器 key（验收 A1：抓请求日志比对，须**真被调用过**）。 */
  solverKey: z.string().min(1),
  /** 阈值所属规则码（如 `C08`）。 */
  ruleKey: z.string().min(1).optional(),
  /** 阈值在该规则 `params` 里的命名键——改 params 即改推演，溯源要指到具体哪个旋钮。 */
  ruleParamKey: z.string().min(1).optional(),
  /** 派生边（本体上哪条 derivation 把上游值带到这里）。 */
  derivationEdge: z.string().min(1).optional(),
  /** 实测值。 */
  metricValue: z.number(),
  /** 触发判定的阈值。 */
  threshold: z.number(),
  /** 单位（`metricValue`/`threshold` 共用；两者不同单位就是量纲错，见 R18 教训）。 */
  unit: z.string().min(1),
});
export type ChainImpedimentEvidence = z.infer<typeof ChainImpedimentEvidenceSchema>;

/**
 * 同一根因在别的链段上的**表现**（PRD §7.2②）。
 * 一个物料断供会表现为某产线堵点、再表现为某订单交付风险 —— 逐段独立扫描会把同一个根因数成三个问题
 * （`G-EXCEPTION-SCATTER` 换个形式复发）。归并后：**1 条阻滞点 + N 个 manifestations**。
 */
export const ChainManifestationSchema = z.strictObject({
  stage: ChainStageSchema,
  nodeId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  locus: ChainLocusSchema,
});
export type ChainManifestation = z.infer<typeof ChainManifestationSchema>;

/**
 * **ChainImpediment**：全链扫描产出的阻滞点。
 *
 * **它是派生对象**（求解器算出来的，不落人工录入）→ 因此**不进 R4 Action 审批面**。
 * 沙盘只推演不写真值；方案采纳时另起 `ActionDraft` 走既有审批链（R4），阻滞点本身不是待审批的写操作。
 *
 * 硬约束（schema 层）：
 *  ① `kind === "BREAK"` ⟺ 带 `breakSubtype`（PRD §5.2「kind=BREAK 时必填」；非 BREAK 带了也抛）。
 *  ② `breakSubtype === "DATA"` ⟹ `dataMode === "EMPTY"` —— 数据断的定义就是算不出来。
 *     一个自称数据断却声称 LIVE 的阻滞点是自相矛盾的假数据，直接抛。
 *
 * `scope` **必填**：结果要回带自己是在什么范围下算出来的（R-ARG-FIDELITY —— 求解器缺过滤维不得静默返全域，
 * 结果须显式带 scope 让前端看得见「未指定→全域」）。全域就给 `{}`，不是省略。
 */
export const ChainImpedimentSchema = z
  .strictObject({
    impedimentId: z.string().min(1),
    /** R2 tenant_id everywhere。 */
    tenantId: z.string().min(1),
    /** 哪一次扫描产出的（`chain.scan_completed` 事件载荷同键）。 */
    scanId: z.string().min(1),
    kind: ChainImpedimentKindSchema,
    /** `kind === "BREAK"` 时必填，否则必缺。 */
    breakSubtype: ChainBreakSubtypeSchema.optional(),
    stage: ChainStageSchema,
    /** 本次扫描的范围（必填·回带·R-ARG-FIDELITY）。全域 = `{}`。 */
    scope: ChainScopeSchema,
    /** 落在链路的哪个节点 / 哪一段（有就给，别硬凑）。 */
    nodeId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    locus: ChainLocusSchema,
    /**
     * 严重度 0–100。**必须是算出来的**（建议 = 归一化(超阈幅度) × 归一化(下游受影响订单金额)，
     * 两个因子都来自求解器输出）。**禁止固定权重表拍脑袋** —— 那是 `G-MULTIOBJ-TOY-ORDERBOOK` 的老路。
     */
    severity: z.number().min(0).max(100),
    evidence: ChainImpedimentEvidenceSchema,
    /** 诚实位（复用派生侧单源词表）。`EMPTY` = 算不出来，须显式呈现并接生长回路（R16），不静默跳过。 */
    dataMode: DerivedDataModeSchema,
    /** 同根因在别处的表现（归并后）。 */
    manifestations: z.array(ChainManifestationSchema).optional(),
    /** 本条是被归并到哪个根因下的（仅在保留 manifestation 明细行时使用）。 */
    rootCauseImpedimentId: z.string().min(1).optional(),
  })
  .superRefine((im, ctx) => {
    const isBreak = im.kind === "BREAK";
    if (isBreak && im.breakSubtype === undefined) {
      ctx.addIssue({ code: "custom", path: ["breakSubtype"], message: 'kind="BREAK" 时 breakSubtype 必填（MATERIAL/LEADTIME/DATA）' });
    }
    if (!isBreak && im.breakSubtype !== undefined) {
      ctx.addIssue({ code: "custom", path: ["breakSubtype"], message: `breakSubtype 只属于 kind="BREAK"（收到 kind="${im.kind}"）` });
    }
    if (im.breakSubtype === "DATA" && im.dataMode !== "EMPTY") {
      ctx.addIssue({
        code: "custom",
        path: ["dataMode"],
        message: `数据断（breakSubtype="DATA"）的定义就是算不出来 ⇒ dataMode 必须为 "EMPTY"，收到 "${im.dataMode}"`,
      });
    }
  });
export type ChainImpediment = z.infer<typeof ChainImpedimentSchema>;

/**
 * 阻滞点排序的**唯一实现**：severity 降序 → `locus.objectId` 字典序 → `impedimentId` 字典序。
 *
 * 为什么要冻结这个：R6 要求同 (seed, 场景, 参数版本) 重跑**字节一致**，
 * 而 `Array#sort` 的稳定性不能替代**全序**——同 severity 的两条若无显式 tiebreaker，
 * 顺序就依赖输入顺序，输入顺序又依赖遍历顺序，最后变成「排序契约靠巧合」
 * （`wo-capacity-100pct` R7–R9 轮修的就是这个）。`impedimentId` 唯一 ⇒ 本比较器是**全序**。
 */
export function compareChainImpediment(a: ChainImpediment, b: ChainImpediment): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.locus.objectId !== b.locus.objectId) return a.locus.objectId < b.locus.objectId ? -1 : 1;
  if (a.impedimentId !== b.impedimentId) return a.impedimentId < b.impedimentId ? -1 : 1;
  return 0;
}
