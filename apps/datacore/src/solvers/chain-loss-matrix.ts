/**
 * WO-SIM-BE-MATRIX · 环节 × 基地 损失矩阵（`chain_loss_matrix`）—— 推演沙盘引擎层。
 *
 * ── 这个求解器回答什么 ────────────────────────────────────────────────────────
 * 一维版 `chain_loss_attribution` 回答「**这一条**链上，每个环节吃掉了损失的百分之多少」。
 * 本求解器把「基地」升成显式的一维，回答「**哪个基地**的**哪个环节**最吃损失」——
 * 对租户内每个 `Base` 各跑一次**同一份**归因，拼成二维格子。
 *
 * ── 今天的行为 X / 应该的行为 Y（本单的由来，实测原文见交单报告）──────────────
 * **X（今天）**：`chain-loss.ts` 里 `chainLossAttribution` 的 `const baseId = orderBases[0] ?? null` 把基地**隐式**
 *   定死成「锚点订单 `bases` 数组字典序第一个」，随后只有那个基地的 `Process(kind="aging")`
 *   进链（`agingProcess` 的过滤条件就是 `p.props.baseId === baseId`）。实测 seed 42：
 *   锚点 `SO-3391` 的 `bases` 含 `hefei`/`jinhua`，输出 `anchor.baseId === "hefei"`，
 *   `jinhua` 那条链在结果里**一维都没有**——既不是 0 也不是 EMPTY，是这一维根本不存在。
 * **Y（应该）**：基地是可枚举的一维。逐基地各跑一次既有归因拼成矩阵；
 *   某基地没有可锚定的 Order ⇒ 该列 `null` + `reason`，**不是 0**。
 *
 * ── 四条硬约束（每条都对着本仓一笔血账）────────────────────────────────────
 * ① **一份算式**：格子/列合计/行合计的每一个数都由 §5 契约的 `computeLossAttribution()` /
 *    `chainNonValueDays()` / `lossConservationResidual()` 产出。本文件**没有一个除法**。
 *    抄第二份 = 改一处时两份悄悄漂移（`gap_attribution` 差 1e4 那次就是两处口径各自演化）。
 * ② **守恒显式返回**：每列 Σpct 与残差都进输出，服务端不偷偷判掉只回一个 ok。
 * ③ **空列不许返 0**：没 Order 的基地 `days`/`sumPct`/`residual` 全 `null` + `reason`。
 *    屏上「没数据」和「值是 0」是相反的结论，返 0 会把前者读成后者。
 *    同理，行索引里有、本列链上没有的环节**不产格子**，进该列的 `missingNodeIds`。
 * ④ **`anchorBaseId` 是本文件的命门断言位**：每列跑完必须真锚在**本列**的基地上。
 *    若投影没生效，13 列会静默变成 13 份**同一个基地**的拷贝 —— 守恒照样成立、Σpct 照样 100、
 *    对拍照样通过，**除了这个字段没有任何断言看得见**。这正是本仓「假绿」的经典形态：
 *    信号本身是真的，只是它不指向我要断言的那个对象。
 *
 * ── R6 确定性 ────────────────────────────────────────────────────────────────
 * 纯函数：无 `Date.now`、无随机。列按 `baseId` 字典序；每列的锚点订单按 `so` 字典序取第一张；
 * 行索引按 (stage 在 `CHAIN_STAGES` 里的序, 首次出现序) 排 —— 全序，两跑字节一致。
 *
 * ══ WO-LOSS-ATTRIB-MONEY · 第二笔账：这张表**拆了等于没拆**，而且**没有钱** ══════
 *
 * **今天的行为 X（实测 seed 42，真起 datacore + 真回包，不是读源码猜的）**：
 *  ① **整屏零金额**：回包里 `"days"` 命中 253 次、`"pct"` 253 次，
 *     而 `"value"` / `"amount"` / `"元"` 各 **0** 次。屏上只有「订单回款 71% · 780.00D」，
 *     **没有任何一处告诉经营者这 780 天等于多少钱**。
 *  ② **13 列里 16/18 行逐列同值**：实测每列 `days` 合计**全部** = 84.194 天（去重 1 个值），
 *     订单回款每列 60 天、老化静置每列 5 天、11 道工序每列同值；
 *     只有「入厂在途与清关」「到货检验」2 行在基地间有差异（各 2 个值）。
 *     **13 列 × 84.194 = 1094.5 天，正是屏上那个「合计 1094.5D」。**
 *
 * **②的根因（四态里的第四态：接对了、跑通了、但算错了）**——
 * 三态判定逐条排除，不是感觉：
 *  · **没接线**？否。`anchorBaseId` 逐列实测 == 本列 `baseId`（13/13），
 *    `anchorAgingProcessId` 逐列不同（13 个不同的 `LINE-WS-<base>-assembly-aging`）⇒ 投影真生效了。
 *  · **接了线没数据**？否。基地维在**数据里真实存在且差得很远**：
 *    `Base.formationCapDaily` 37,924–138,973（**3.66×**）、`Base.gwh` 34.1–99.4（2.91×）、
 *    `Base.util` 70–88（13 个不同值）、`Process.agingSlots` 13 个不同值。
 *  · **接错地方**？否。挂载点是对的。
 *  · ⇒ **算错了**：**公式里没有基地项**。全链 18 行中，唯一按 `baseId` 取数的是老化静置
 *    （`chain-loss.ts:563` 按 `Process.baseId` 过滤），而它读的 `agingDays` 全库**只有 1 个值（5）**
 *    （生成侧 `battery.ts` 里写死 `const agingDays = 5`）。其余 17 行读的是
 *    客户账期 / 路由工序工时 / 供应商提前期 —— **一个都不以基地为键**。
 *    这与铁律 1.5 记的「碳酸锂与铝箔各涨 15% 得同一个数（传导公式里没有用量项）」**同形态**：
 *    **一张按 X 拆的表，公式里没有 X 项，拆了等于没拆。**
 *
 * **⚠ 老化占用率这条路实测走不通，记在这里免得下一个人再试一遍**：
 * 本想用「老化库位占用率 = requiredThroughput × agingDays ÷ agingSlots」当基地项，
 * 实测 13 个基地全是 **0.98039**（极差比 **1.0000×**）—— 因为生成侧就是
 * `agingSlots = ceil(lineTargetCells × agingDays × agingHeadroom)` 反推出来的，
 * 占用率被构造法**钉死成常数**。它看起来像个基地维，其实是个恒等式。
 *
 * **应该的行为 Y（本单落地的）**：把**订单敞口**这一真实的基地维接进来，并顺带把「天」翻成「钱」：
 *
 *      该基地订单敞口 = Σ Order.value，取遍**在手**且 `Order.bases ∋ baseId` 的订单
 *      该环节压住的金额 = 敞口 × 该环节占本列损失的百分比 ÷ 100      （§5.5 唯一实现）
 *
 * 实测这一维**真的把 13 列拉开了**：在手敞口 6.42 亿（xinyang）～60.59 亿（changzhou），
 * **9.43×**，13 个互不相同的值。而它**零编数** —— `Order.value` 是本体已登记的派生属性
 * `qty × unitPrice`（单位「元」），`Order.bases` 是订单自带的可产基地清单，
 * 「在手」判据取 `order-status.ts` 的 `isOnHandOrderStatus`（平台既有单一出处）。
 *
 * **⚠ 「在手」这道过滤是本单第二次改对的（照实记账）**：初版不看 `status`，
 * 把 **350 张 `COMPLETED`** 也算进敞口 ⇒ 订单簿总额报 454.64 亿（在手真值 **156.63 亿**，
 * **虚报 2.90×**）。这与 `order-status.ts` 记过的那笔账（驾驶舱在手卡片虚报 3.3 倍）**同一个形态**。
 * 更要命的是它**会把结论指反**：`xinyang` 按全簿 33.97 亿排第 6，按在手 6.42 亿是**倒数第 1**；
 * `meishan` 按全簿是倒数第 1（16.19 亿），按在手排第 9（11.64 亿）。
 * 已交付关闭的单货已交、款已结，**早就不在这条链上流**，压不住。
 *
 * **守恒（选这个口径的理由）**：Σpct == 100 ⇒ **Σ 列内各环节金额 == 该列敞口**，
 * 自带一条机器可查的账（`moneyOk` / `moneyResidualYuan`，容差 1 元）。
 *
 * **⚠ 列合计不可加**：一单可产多基地（实测在手 150 单里 89 单）⇒
 * Σ 13 列敞口 = 260.29 亿 = 在手订单簿 156.63 亿的 **1.66×**。这条随结果返回
 * （`money.exposureOverlapRatio`），不让读数的人自己去猜为什么加起来比订单簿还大。
 */
import {
  CHAIN_STAGES,
  chainNonValueDays,
  computeLossAttribution,
  lossConservationResidual,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  // WO-LOSS-ATTRIB-MONEY · 「天 → 钱」的唯一实现（§5.5）。本文件照样一个除法都不写。
  lossValueAtRiskYuan,
  orderExposureYuan,
  moneyConservationResidualYuan,
  MONEY_CONSERVATION_TOLERANCE_YUAN,
  LOSS_EXPOSURE_CAPTION,
  type ChainNode,
  type ChainStage,
  type ChainStep,
  type ChainLossMatrixBase,
  type ChainLossMatrixCell,
  type ChainLossMatrixColTotal,
  type ChainLossMatrixMoney,
  type ChainLossMatrixNode,
  type ChainLossMatrixResult,
  type ChainLossMatrixRowTotal,
} from "@platform/contracts";
import {
  chainLossAttribution,
  CHAIN_LOSS_SOLVER_KEY,
  type ChainLossInput,
  type ChainLossObject,
  type ChainLossResult,
} from "./chain-loss.js";

export const CHAIN_LOSS_MATRIX_SOLVER_KEY = "chain_loss_matrix";

function str(v: unknown, dflt = ""): string {
  return typeof v === "string" ? v : dflt;
}

/** `Order.bases`（可产基地清单）归一成字符串数组；不是数组就是空清单（不猜、不兜底）。 */
function orderBaseIds(order: ChainLossObject): string[] {
  return Array.isArray(order.props.bases) ? (order.props.bases as unknown[]).map((b) => String(b)).sort() : [];
}

export interface ChainLossMatrixInput {
  /**
   * 列的来源：租户内的 `Base` 对象。**不从 `BASE_REGISTRY` 抄一份**——
   * 矩阵要说的是「**本租户**有哪些基地」，硬编册子会让换了本体的租户看到一排查无对证的空列。
   */
  baseObjects: ChainLossObject[];
  /**
   * 可选锚点订单号。给了 ⇒ 每列都只用**这一张单**（该单能在哪些基地产就有哪些列有数），
   * 于是矩阵与一维求解器同锚点、可逐格对拍；不给 ⇒ 每列各自取该基地 `so` 字典序第一张单。
   */
  so?: string;
  /** 算料：与一维求解器**同一份**输入，原样透传（本文件不裁剪任何对象集合）。 */
  chain: Omit<ChainLossInput, "so">;
}

/** 单列跑完的中间态（`run === null` = 空列）。 */
interface Column {
  base: ChainLossMatrixBase;
  anchorSo: string | null;
  run: ChainLossResult | null;
  reason: string | null;
  probe: string | null;
  /** 本列**在手**订单敞口（元）。无在手可产订单 / 全部未登记 `value` ⇒ `null`，**不是 0**。 */
  exposureYuan: number | null;
  exposureOrderCount: number;
  exposureSkippedOrders: number;
  /** 本列因**已交付**（非在手态）被排除的单数 —— 不是"丢了"，是"不该在"。 */
  exposureDeliveredOrders: number;
}

/**
 * 把 `ChainLossObject` 归一成 §5.5 `orderExposureYuan` 认得的形状。
 *
 * ⚠ `value` 是本体登记的**派生属性**（`qty × unitPrice`）。仓储回来的对象上它**可能已物化、
 * 也可能没有** —— 两种都得能算，否则「敞口」会在某些部署形态下静默变 0
 * （那正是「没数据」被读成「金额是 0」的那个病）。故：`value` 是数就用它；
 * 不是数但 `qty`/`unitPrice` 都在 ⇒ **就地按本体登记的同一条公式补算**，
 * 两条都不成立才算「未登记」交给 `orderExposureYuan` 跳过并计入 `skipped`。
 *
 * ⚠ **`status` 必须原样带过去**：敞口只算在手单（§5.5）。这里漏掉 `status`，
 * `isOnHandOrderStatus(undefined)` 恒假 ⇒ **每一列敞口都会变成 0**，
 * 屏上金额整片消失 —— 而那看起来会像「这个基地没订单」，不像「字段没传」。
 */
function orderMoneyShape(o: ChainLossObject): { value?: number; bases?: unknown; status?: unknown } {
  const raw = o.props.value;
  const bases = o.props.bases;
  const status = o.props.status;
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw, bases, status };
  const qty = o.props.qty;
  const unitPrice = o.props.unitPrice;
  if (typeof qty === "number" && Number.isFinite(qty) && typeof unitPrice === "number" && Number.isFinite(unitPrice)) {
    return { value: qty * unitPrice, bases, status };
  }
  return { bases, status };
}

/**
 * 把一张订单**投影**到指定基地：`bases` 只留这一个。
 *
 * 这是本文件唯一"动数据"的地方，写明理由备查：一维求解器取基地的那一行是
 * `orderBases[0]`，**不接受入参**。要让它跑「同一张单在基地 B 上的链」，
 * 只能把这张单的可产基地收窄到 `[B]` —— 语义恰好就是本列要问的问题
 * （「这张单如果在 B 产，时间耗在哪」），不是编数：
 *   · 不新增任何字段、不改任何数值，只**收窄**一个本来就存在的集合；
 *   · 收窄的目标 B 必须是该单**原本就有**的可产基地（调用方已过滤），不会凭空造出可产关系；
 *   · 投影出的是副本，输入对象一个字节不动（纯函数 R6）。
 * 另一条路是给 `chainLossAttribution` 加一个 `baseId` 入参，那要改它的函数体 ——
 * 本单的范围边界写死「chain-loss.ts 只加导出、既有算式一字不改」，故走投影。
 */
function projectOrderToBase(order: ChainLossObject, baseId: string): ChainLossObject {
  return { id: order.id, props: { ...order.props, bases: [baseId] } };
}

/** 该基地上可当锚点的订单（按 `so` 字典序，R6 全序）。 */
function candidateOrders(chain: ChainLossMatrixInput["chain"], baseId: string, so: string | undefined): ChainLossObject[] {
  return [...chain.orders]
    .filter((o) => orderBaseIds(o).includes(baseId))
    .filter((o) => (so ? str(o.props.so) === so : true))
    .sort((a, b) => str(a.props.so).localeCompare(str(b.props.so)));
}

export function chainLossMatrix(input: ChainLossMatrixInput): ChainLossMatrixResult {
  const so = input.so;

  // ── 列：租户内 Base，按 baseId 字典序（去重：同 baseId 多行取字典序第一行的名字）────
  const seenBase = new Set<string>();
  const bases: ChainLossMatrixBase[] = [...input.baseObjects]
    .map((o) => ({ baseId: str(o.props.baseId), name: str(o.props.name) || str(o.props.baseId) }))
    .filter((b) => b.baseId !== "")
    .sort((a, b) => a.baseId.localeCompare(b.baseId))
    .filter((b) => (seenBase.has(b.baseId) ? false : (seenBase.add(b.baseId), true)));

  // ── 金额底数：每列的订单敞口（WO-LOSS-ATTRIB-MONEY）────────────────────────
  // ⚠ 敞口取遍**该基地所有可产订单**，与 `so`（锚点单）**无关**：
  //   锚点单决定「这条链的时间长什么样」，敞口决定「这个基地压着多少钱」——
  //   两件事。拿单张锚点单的金额当敞口，会让「换个锚点单」把基地的经营规模也换掉，
  //   那是把两个自变量绑成一个（本仓 `viaModelingChain` 那类路径开关的同族病）。
  const moneyOrders = input.chain.orders.map(orderMoneyShape);

  // ── 逐列跑一次既有一维归因 ──────────────────────────────────────────────
  const columns: Column[] = bases.map((base) => {
    const exp = orderExposureYuan(moneyOrders, base.baseId);
    // 一张可产订单都没有 ⇒ 敞口是 `null`（没有这一维），不是 0（"有敞口且为零"）。
    const exposure = exp.countedOrders > 0 ? { ...exp, exposureYuan: exp.exposureYuan } : { ...exp, exposureYuan: null as number | null };
    const cands = candidateOrders(input.chain, base.baseId, so);
    if (cands.length === 0) {
      // 口径③：空列，**不是 0**。两种空各给各的话，因为修法不同：
      //   · 指定了锚点单 ⇒ 这张单在结构上就不能在这个基地产（换基地要换单，不是补数据）；
      //   · 没指定     ⇒ 本租户真没有任何单排到这个基地（补订单数据才会有这一列）。
      const reason = so
        ? `锚点订单 ${so} 的可产基地清单里没有 ${base.baseId}（该单可产：${
            orderBaseIds(input.chain.orders.find((o) => str(o.props.so) === so) ?? { id: "", props: {} }).join("/") || "(空)"
          }）—— 这条链在该基地上**不存在**，不是「损失为 0」。`
        : `本租户没有任何 Order 的可产基地清单（Order.bases）里含 ${base.baseId} —— 该基地今天没有可锚定的全链，不是「损失为 0」。`;
      const probe = `读 Order.bases：过滤 bases 含 "${base.baseId}"${so ? ` 且 so === "${so}"` : ""} 的订单，实测 0 张。`;
      return {
        base,
        anchorSo: null,
        run: null,
        reason,
        probe,
        exposureYuan: exposure.exposureYuan,
        exposureOrderCount: exposure.countedOrders,
        exposureSkippedOrders: exposure.skippedOrders,
        exposureDeliveredOrders: exposure.deliveredOrders,
      };
    }
    const anchor = cands[0] as ChainLossObject;
    const anchorSo = str(anchor.props.so);
    const run = chainLossAttribution({
      ...input.chain,
      // 只喂投影后的这一张单：一维求解器的 `orders` 仅用于选锚点（`chainLossAttribution` 开头那两行排序 + find，
      // 全文再无第二处读 `input.orders` —— 亲手核过，不是 grep 到就收工），
      // 喂一张 = 锚点确定，无需再依赖它内部的排序（R6 双保险）。
      orders: [projectOrderToBase(anchor, base.baseId)],
      so: anchorSo,
    });
    return {
      base,
      anchorSo,
      run,
      reason: null,
      probe: null,
      exposureYuan: exposure.exposureYuan,
      exposureOrderCount: exposure.countedOrders,
      exposureSkippedOrders: exposure.skippedOrders,
      exposureDeliveredOrders: exposure.deliveredOrders,
    };
  });

  // ── 行索引：所有非空列出现过的节点，按 (stage 序, 首次出现序) 全序 ──────────────
  const nodeMeta = new Map<string, { stage: ChainStage; label: string; firstSeen: number }>();
  let seenSeq = 0;
  for (const col of columns) {
    for (const n of col.run?.nodes ?? []) {
      if (nodeMeta.has(n.nodeId)) continue;
      nodeMeta.set(n.nodeId, { stage: n.stage, label: n.label, firstSeen: seenSeq++ });
    }
  }
  const nodes: ChainLossMatrixNode[] = [...nodeMeta.entries()]
    .map(([nodeId, m]) => ({ nodeId, stage: m.stage, label: m.label, firstSeen: m.firstSeen }))
    .sort((a, b) => CHAIN_STAGES.indexOf(a.stage) - CHAIN_STAGES.indexOf(b.stage) || a.firstSeen - b.firstSeen)
    .map(({ nodeId, stage, label }) => ({ nodeId, stage, label }));

  // ── 格子与列合计 ────────────────────────────────────────────────────────
  const cells: ChainLossMatrixCell[] = [];
  const colTotals: ChainLossMatrixColTotal[] = [];
  const residualByBase: ChainLossMatrixResult["residual"]["byBase"] = [];

  for (const col of columns) {
    if (!col.run) {
      colTotals.push({
        baseId: col.base.baseId,
        anchorSo: null,
        anchorBaseId: null,
        anchorAgingProcessId: null,
        days: null, // ⛔ 不是 0（口径③）
        sumPct: null,
        cellCount: 0,
        missingNodeIds: nodes.map((n) => n.nodeId),
        reason: col.reason,
        probe: col.probe,
        // 空列：即便该基地**有**订单敞口（可产订单存在但都不能当锚点，如指定了别的 so），
        // 也照实返回敞口——它是该基地的经营事实，不因为"这一列没链"而消失。
        exposureYuan: col.exposureYuan,
        exposureOrderCount: col.exposureOrderCount,
        exposureSkippedOrders: col.exposureSkippedOrders,
        exposureDeliveredOrders: col.exposureDeliveredOrders,
        // 没有格子 ⇒ 守恒无从谈起（同 §5 空表返 null 的纪律）。
        moneyResidualYuan: null,
        moneyOk: false,
      });
      residualByBase.push({ baseId: col.base.baseId, residualPct: null, ok: false, reason: col.reason });
      continue;
    }
    const run = col.run;
    // stepId → 该 step 的归因行（唯一实现产出的，本文件不自算百分比）。
    const pctByStep = new Map(run.attribution.map((a) => [a.stepId, a.pctOfChainLoss] as const));
    const nodeById = new Map<string, ChainNode>(run.nodes.map((n) => [n.nodeId, n] as const));
    const present = new Set(run.nodes.map((n) => n.nodeId));

    for (const n of nodes) {
      const node = nodeById.get(n.nodeId);
      if (!node) continue; // 诚实缺席：本列链上没这个环节 ⇒ 不产格子（见 missingNodeIds）
      // 百分比只从 `computeLossAttribution` 的产出里取，本文件不做除法。
      const pct = node.steps.reduce((sum, s) => sum + (pctByStep.get(s.stepId) ?? 0), 0);
      cells.push({
        nodeId: n.nodeId,
        baseId: col.base.baseId,
        // 契约唯一实现：非增值天数（增值段自动为 0，不进矩阵）。
        days: chainNonValueDays(node.steps),
        pct,
        // 「天 → 钱」也走契约唯一实现（§5.5）。本列没敞口 ⇒ `null` 不是 0。
        valueAtRiskYuan: col.exposureYuan === null ? null : lossValueAtRiskYuan(col.exposureYuan, pct),
      });
    }

    const allSteps: ChainStep[] = run.nodes.flatMap((n) => n.steps);
    const residualPct = lossConservationResidual(run.attribution);
    // 金额守恒：Σ 本列各格金额 必须 == 本列敞口（因为 Σpct == 100）。走契约唯一实现。
    const colCellYuan = cells
      .filter((c) => c.baseId === col.base.baseId && c.valueAtRiskYuan !== null)
      .map((c) => c.valueAtRiskYuan as number);
    const moneyResidualYuan =
      col.exposureYuan === null ? null : moneyConservationResidualYuan(colCellYuan, col.exposureYuan);
    colTotals.push({
      baseId: col.base.baseId,
      anchorSo: col.anchorSo,
      // ④ 命门：这一列真锚在哪个基地上。必须 == baseId，否则整列跑的是别人的链。
      anchorBaseId: run.anchor.baseId,
      // ④ 的加固位：老化工序是一维求解器**按本列 baseId 过滤 `Process` 才拿得到**的，
      // 同单两列若共用同一个 id，基地这一维就是假的（`anchorBaseId` 单独看不出来这一点）。
      anchorAgingProcessId: run.anchor.agingProcessId,
      days: chainNonValueDays(allSteps),
      sumPct: run.attribution.reduce((sum, a) => sum + a.pctOfChainLoss, 0),
      cellCount: cells.filter((c) => c.baseId === col.base.baseId).length,
      missingNodeIds: nodes.filter((n) => !present.has(n.nodeId)).map((n) => n.nodeId),
      reason: null,
      probe: null,
      exposureYuan: col.exposureYuan,
      exposureOrderCount: col.exposureOrderCount,
      exposureSkippedOrders: col.exposureSkippedOrders,
      exposureDeliveredOrders: col.exposureDeliveredOrders,
      moneyResidualYuan,
      moneyOk: moneyResidualYuan !== null && Math.abs(moneyResidualYuan) <= MONEY_CONSERVATION_TOLERANCE_YUAN,
    });
    residualByBase.push({
      baseId: col.base.baseId,
      residualPct,
      ok: residualPct !== null && Math.abs(residualPct) <= LOSS_CONSERVATION_TOLERANCE_PCT,
      reason: null,
    });
  }

  // ── 行合计：**照样走契约的唯一实现**。把「每行的跨基地天数」当成一组非增值 step 喂给
  //    `computeLossAttribution`，拿回来的 `pctOfChainLoss` 就是「占全矩阵损失的百分之几」。
  //    这样 `pctOfGrandLoss` 与格子里的 `pct` 同源同公式，改口径只改契约那一处。
  const rowSteps: ChainStep[] = nodes.map((n) => ({
    stepId: n.nodeId,
    nodeId: n.nodeId,
    kind: "queue" as const, // 非增值（`isValueAddKind("queue") === false`），仅为借用归因实现
    days: cells.filter((c) => c.nodeId === n.nodeId).reduce((sum, c) => sum + c.days, 0),
    valueAdd: false,
  }));
  const rowAttribution = computeLossAttribution(rowSteps);
  const rowPct = new Map(rowAttribution.map((a) => [a.stepId, a.pctOfChainLoss] as const));
  const rowTotals: ChainLossMatrixRowTotal[] = nodes.map((n, i) => {
    // 行金额 = Σ 本行各格金额。一格有敞口的都没有 ⇒ `null`（不是 0）。
    const rowCells = cells.filter((c) => c.nodeId === n.nodeId);
    const priced = rowCells.filter((c) => c.valueAtRiskYuan !== null);
    return {
      nodeId: n.nodeId,
      days: (rowSteps[i] as ChainStep).days,
      // 全矩阵非增值总量为 0 时 `computeLossAttribution` 返空表 ⇒ 这里取 0：
      // 那是「所有格子都真是 0 天」的情形，不是「没数据」（没数据的列压根不产格子）。
      pctOfGrandLoss: rowPct.get(n.nodeId) ?? 0,
      baseCount: rowCells.length,
      valueAtRiskYuan:
        priced.length === 0 ? null : priced.reduce((sum, c) => sum + (c.valueAtRiskYuan as number), 0),
    };
  });
  const rowsResidual = lossConservationResidual(rowAttribution);

  const filled = colTotals.filter((c) => c.days !== null);
  const grandDays = filled.reduce((sum, c) => sum + (c.days ?? 0), 0);
  const topRow = [...rowTotals].sort((a, b) => b.days - a.days || a.nodeId.localeCompare(b.nodeId))[0];
  const topLabel = topRow ? nodes.find((n) => n.nodeId === topRow.nodeId)?.label ?? topRow.nodeId : null;

  // ── 金额对账块（WO-LOSS-ATTRIB-MONEY）─────────────────────────────────────
  // 订单簿总额：`baseId` 传 null ⇒ 不过滤基地，得整本订单簿（实测 seed 42 = 454.64 亿）。
  const book = orderExposureYuan(moneyOrders, null);
  const exposureSumYuan = colTotals.reduce((sum, c) => sum + (c.exposureYuan ?? 0), 0);
  const pricedCols = colTotals.filter((c) => c.exposureYuan !== null && c.days !== null);
  const money: ChainLossMatrixMoney = {
    orderBookTotalYuan: book.exposureYuan,
    orderBookCount: book.countedOrders,
    orderBookSkipped: book.skippedOrders,
    orderBookDelivered: book.deliveredOrders,
    // 口径措辞随结果走（§5.5 单一出处）—— 屏上印金额必须连它一起印。
    caption: LOSS_EXPOSURE_CAPTION,
    exposureSumYuan,
    // 订单簿为 0 ⇒ null（返 0 会被读成"没有重复计入"，那是相反的结论）。
    exposureOverlapRatio: book.exposureYuan > 0 ? exposureSumYuan / book.exposureYuan : null,
    // 空矩阵不算"全绿"：没有任何一列被检查过，`true` 会是假绿。
    allColumnsMoneyOk: pricedCols.length > 0 && pricedCols.every((c) => c.moneyOk),
    toleranceYuan: MONEY_CONSERVATION_TOLERANCE_YUAN,
  };
  const topRowMoney = topRow?.valueAtRiskYuan ?? null;

  return {
    nodes,
    bases,
    cells,
    rowTotals,
    colTotals,
    residual: {
      byBase: residualByBase,
      rows: rowsResidual,
      rowsOk: rowsResidual !== null && Math.abs(rowsResidual) <= LOSS_CONSERVATION_TOLERANCE_PCT,
      tolerancePct: LOSS_CONSERVATION_TOLERANCE_PCT,
    },
    money,
    summary:
      `环节×基地损失矩阵：${nodes.length} 个环节 × ${bases.length} 个基地，` +
      `${filled.length} 列有数据（合计非增值 ${grandDays.toFixed(2)} 天）、` +
      `${bases.length - filled.length} 列诚实标 null（无可锚定 Order，**未补 0**）；` +
      (topLabel
        ? `跨基地合计吃掉损失最多的环节是「${topLabel}」${topRow!.pctOfGrandLoss.toFixed(1)}%` +
          // ★ 本单的核心：这一句让「天」第一次带上「钱」。
          (topRowMoney !== null ? `，按订单敞口折合 ${yiYuan(topRowMoney)} 亿元` : "") +
          `；`
        : "") +
      `金额口径＝各基地在手订单敞口（Σ Order.value，取遍未完成态且 Order.bases 含该基地的订单）×环节损失占比：` +
      `在手订单簿合同总额 ${yiYuan(money.orderBookTotalYuan)} 亿元（${money.orderBookCount} 单，` +
      `另有 ${money.orderBookDelivered} 单已交付关闭不计入敞口），` +
      `Σ 各列敞口 ${yiYuan(money.exposureSumYuan)} 亿元` +
      (money.exposureOverlapRatio !== null
        ? `＝订单簿的 ${money.exposureOverlapRatio.toFixed(2)}×（一单可产多基地故跨列重复计入，列间可比、列合计不可加）`
        : "") +
      `；逐列归因口径与 ${CHAIN_LOSS_SOLVER_KEY} 同源（同一份 computeLossAttribution）。`,
  };
}

/** 元 → 亿元，两位小数。**只用于 `summary` 这句人读的话**，不产生任何被消费的数值字段。 */
function yiYuan(yuan: number): string {
  return (yuan / 1e8).toFixed(2);
}
