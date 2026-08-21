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
 */
import {
  CHAIN_STAGES,
  chainNonValueDays,
  computeLossAttribution,
  lossConservationResidual,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  type ChainNode,
  type ChainStage,
  type ChainStep,
  type ChainLossMatrixBase,
  type ChainLossMatrixCell,
  type ChainLossMatrixColTotal,
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

  // ── 逐列跑一次既有一维归因 ──────────────────────────────────────────────
  const columns: Column[] = bases.map((base) => {
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
      return { base, anchorSo: null, run: null, reason, probe };
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
    return { base, anchorSo, run, reason: null, probe: null };
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
      cells.push({
        nodeId: n.nodeId,
        baseId: col.base.baseId,
        // 契约唯一实现：非增值天数（增值段自动为 0，不进矩阵）。
        days: chainNonValueDays(node.steps),
        // 百分比同样只从 `computeLossAttribution` 的产出里取，本文件不做除法。
        pct: node.steps.reduce((sum, s) => sum + (pctByStep.get(s.stepId) ?? 0), 0),
      });
    }

    const allSteps: ChainStep[] = run.nodes.flatMap((n) => n.steps);
    const residualPct = lossConservationResidual(run.attribution);
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
  const rowTotals: ChainLossMatrixRowTotal[] = nodes.map((n, i) => ({
    nodeId: n.nodeId,
    days: (rowSteps[i] as ChainStep).days,
    // 全矩阵非增值总量为 0 时 `computeLossAttribution` 返空表 ⇒ 这里取 0：
    // 那是「所有格子都真是 0 天」的情形，不是「没数据」（没数据的列压根不产格子）。
    pctOfGrandLoss: rowPct.get(n.nodeId) ?? 0,
    baseCount: cells.filter((c) => c.nodeId === n.nodeId).length,
  }));
  const rowsResidual = lossConservationResidual(rowAttribution);

  const filled = colTotals.filter((c) => c.days !== null);
  const grandDays = filled.reduce((sum, c) => sum + (c.days ?? 0), 0);
  const topRow = [...rowTotals].sort((a, b) => b.days - a.days || a.nodeId.localeCompare(b.nodeId))[0];
  const topLabel = topRow ? nodes.find((n) => n.nodeId === topRow.nodeId)?.label ?? topRow.nodeId : null;

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
    summary:
      `环节×基地损失矩阵：${nodes.length} 个环节 × ${bases.length} 个基地，` +
      `${filled.length} 列有数据（合计非增值 ${grandDays.toFixed(2)} 天）、` +
      `${bases.length - filled.length} 列诚实标 null（无可锚定 Order，**未补 0**）；` +
      (topLabel ? `跨基地合计吃掉损失最多的环节是「${topLabel}」${topRow!.pctOfGrandLoss.toFixed(1)}%；` : "") +
      `逐列归因口径与 ${CHAIN_LOSS_SOLVER_KEY} 同源（同一份 computeLossAttribution）。`,
  };
}
