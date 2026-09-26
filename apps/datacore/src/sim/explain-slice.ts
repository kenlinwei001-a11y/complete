/**
 * 解释切片（explain slice）—— 把一次推演的因果链收敛成**人和模型都吃得下**的一张小图。
 *
 * ## 为什么要这东西
 *
 * 推演跑完，披露层给的切片是 **`GLOBAL · hops=1` · 12,499 节点 / 13,533 边**。
 * 那不是切片，那是整个世界：人看不懂，也塞不进任何模型的上下文。
 * 而「为什么这一格变成这样」的答案，其实只牵涉其中极少数几个节点。
 *
 * ⚠ **和计算范围不是一回事，别混**（两者都被叫「切片」，这正是本仓反复炸的那个形态）：
 *  · **计算范围**（`propagation-inputs.ts:108 scopePropagationGraph`）—— 传导必须走到的子图。
 *    ⛔ **不能卡 20**：铝箔涨价一路传到 5 个型号的 `costPressure`，这条真实链本身就超过 20 个节点，
 *    卡死会直接切断传导，得出的不是「小切片」而是**错的推演**。
 *  · **解释切片**（本文件）—— 事后从已经算完的 trace 里收敛出来的**只读投影**。
 *    ⛔ 它不参与计算，不影响任何读数；**大小只影响看得懂多少，不影响算得对不对**。
 *
 * ## 原料是现成的
 *
 * `PropagationTrace = { ruleKey, fromObjectId, toObjectId, amount, viaLinkKey }` 本身就是
 * 一张带权有向边表（实测一次推演 6,770 行）。本文件是它上面的一个纯函数，
 * 零引擎改动、零新增采集。
 *
 * ## ⛔ 最要紧的一条：截断必须说出来
 *
 * 一张 20 节点的图去解释一条 6,770 边的链，**必然是残缺的**。
 * 若不把「丢了多少」报出来，它就变成又一个「看起来完整、其实是编的」——
 * 那正是本仓今天刚清理掉的那类东西（45 个推演格 hash 占位 / `COALESCE(…,0)` 静默落 0）。
 * 所以 {@link ExplainSlice.coverage} 是**必填**，且调用方有义务把它显示出来。
 */

import type { PropagationTrace, SimExplainNode, SimExplainEdge, SimExplainSlice } from "@platform/contracts";

/**
 * ⚠ **2026-09-21：形状搬进契约（`packages/contracts/src/sim.ts`），本文件不再另写一份。**
 *
 * 搬家的理由是前端要消费它。留在这里只有两条路给前端，两条都是本仓明令禁止的：
 * `as` 硬转（运行期零检查，本仓实测过它让沙盘整页白屏）或前端另抄一份类型（第二套真相源）。
 * 下面三个名字是**别名不是定义** —— 存量引用（本文件 + `app.ts`）照旧可用，真相只有契约那一份。
 */
export type ExplainNode = SimExplainNode;
export type ExplainEdge = SimExplainEdge;
export type ExplainSlice = SimExplainSlice;

/**
 * ── 为什么 `target` 必须带量纲（病因留在这里，契约那边只留结论）────────────────
 *
 * ⚠ **2026-09-21 补上 `stateVar`：此前只有 `objectId`，于是本切片答非所问。**
 * 病灶不是排序写错了，是**问题问错了** —— 一个对象同时承载多个量纲，
 * 而它们的单位互不可比。实测 `Model.方形-LFP` 七个量纲：
 *   `backlogQtyTop`(件 ~21,777) · `backlogPriceTop`(元 ~14,420) · `backlogHorizonDays`(天)
 *   · `costPressure` / `demandLoad` / `forecastBias` / `supplyRisk`（压力点，0–100 域）
 * 把它们的入边混在一起按 |amount| 排序，**件/元 以 ~10⁶ 倍碾过压力点**。
 *
 * 真机实测（磷酸铁锂正极 `priceShock +30`，推 3 拍，问「解释 方形-LFP」）：
 *   该拍打向它的边 297 条 → 切片保留 92 条 → **其中成本链 0 条**，
 *   而它的 `costPressure` 确实动了（7.654358560825），trace 里 cost 边有 602 条。
 *   ⇒ 用户问「成本压力为什么变了」，它回答「因为订单有数量」。
 *
 * 形态：**「我用『|amount| 更大』当作『它对这个结果更重要』的证据，
 * 而前者并不度量后者 —— 不同量纲的数不能比大小。」**
 *
 * ⚠ 这条裂缝**本文件自己早就写下了**：`ExplainNode` 的注释「一个节点 = 一个对象
 * （不是一个格；一个对象可能有多个状态变量参与）」，而 target 的注释一直写着「那一格」。
 * 文档说格、类型给对象 —— 写下来了，没当成问题。
 */

/**
 * 从 trace 反向收敛出目标对象的因果子图。
 *
 * 取舍规则（确定性，同输入同输出）：
 *  1. 从目标出发沿**入边**逐跳倒推（BFS，跳数递增）。
 *  2. 同一跳内按 |amount| 从大到小取——先要贡献大的，这样截断丢掉的是最不重要的那批。
 *  3. |amount| 相同时按 `fromObjectId` 字典序，**不留任何非确定性**
 *     （本仓有「同种子重跑必须字节一致」的不变量，解释层不许成为第一个破例的）。
 *  4. 节点数达到 `maxNodes` 即停，把丢掉的量记进 `coverage`。
 *
 * ⚠ 环：传导图允许有环（本仓实测全图长度 ≤5 的环有 5 个）。已访问的节点不再展开，
 *    但**指向它的边照收**——否则环上的贡献会凭空消失，而那是真实存在的量。
 */
export function buildExplainSlice(
  trace: readonly PropagationTrace[],
  targetObjectId: string,
  targetStateVar: string,
  /** `ruleKey → targetStateVar`。⚠ trace 行里**没有**目标量纲，只能经规则表还原（唯一出处）。 */
  ruleTargetVar: ReadonlyMap<string, string>,
  maxNodes = 20,
): ExplainSlice {
  if (maxNodes < 1) throw new Error("maxNodes 必须 ≥1");

  const CELL_SEP = "\u0001";
  /** 这条边写的是哪一格。规则表查不到 ⇒ 判不出格，返回 null（⛔ 不猜、不落默认量纲）。 */
  const cellOf = (t: { ruleKey: string; toObjectId: string }): string | null => {
    const v = ruleTargetVar.get(t.ruleKey);
    return v === undefined ? null : `${t.toObjectId}${CELL_SEP}${v}`;
  };
  const targetCell = `${targetObjectId}${CELL_SEP}${targetStateVar}`;

  // 按 toObjectId 建入边索引（一次 O(n)，避免逐跳重扫 6,770 行）；顺带累出每一格的入流合计。
  const inEdges = new Map<string, PropagationTrace[]>();
  const cellTotal = new Map<string, number>();
  for (const t of trace) {
    const arr = inEdges.get(t.toObjectId);
    if (arr) arr.push(t);
    else inEdges.set(t.toObjectId, [t]);
    const c = cellOf(t);
    if (c !== null) cellTotal.set(c, (cellTotal.get(c) ?? 0) + Math.abs(t.amount));
  }

  /**
   * 排序判据 = **这条边占它自己那一格入流的比例**（无量纲，∈[0,1]）。
   *
   * ⛔ 不用原始 `|amount|`：跨量纲不可比。实测同一张切片里 |amount| 从 0.0049 到 21,777，
   *    跨度 440 万倍 —— 件/元 恒压过压力点，于是**任何压力族的传导都必然被截断掉**，
   *    无论扰动多大。归一到「占本格几成」之后，两边才在同一把尺子上。
   */
  const share = (t: PropagationTrace): number => {
    const c = cellOf(t);
    if (c === null) return 0;
    const tot = cellTotal.get(c) ?? 0;
    return tot === 0 ? 0 : Math.abs(t.amount) / tot;
  };

  // 目标那一格的入边 —— coverage 的分母。
  // ⚠ 只取**写这一格**的边，不是该对象的全部入边：问的是「这一格为什么变成这样」。
  const targetIn = (inEdges.get(targetObjectId) ?? []).filter((t) => cellOf(t) === targetCell);
  const totalTargetAmount = targetIn.reduce((s, e) => s + Math.abs(e.amount), 0);

  const nodes = new Map<string, ExplainNode>();
  nodes.set(targetObjectId, { objectId: targetObjectId, hop: 0, contribution: 0 });
  const keptEdges: ExplainEdge[] = [];
  const keptEdgeKeys = new Set<string>();
  let droppedEdges = 0;
  const droppedNodeIds = new Set<string>();

  let frontier = [targetObjectId];
  const expanded = new Set<string>();
  let hop = 0;

  while (frontier.length > 0 && nodes.size < maxNodes) {
    hop += 1;
    const next: string[] = [];
    // 本跳的候选边：确定性排序（|amount| 降序 → fromObjectId 字典序）。
    const cand: PropagationTrace[] = [];
    for (const n of frontier) {
      if (expanded.has(n)) continue;
      expanded.add(n);
      const all = inEdges.get(n) ?? [];
      // 第 1 跳只收**写目标那一格**的边；再往上游走时，节点已在因果祖先里，全收。
      cand.push(...(hop === 1 && n === targetObjectId ? all.filter((t) => cellOf(t) === targetCell) : all));
    }
    cand.sort((a, b) => share(b) - share(a) || a.fromObjectId.localeCompare(b.fromObjectId));

    for (const e of cand) {
      const isNewNode = !nodes.has(e.fromObjectId);
      if (isNewNode && nodes.size >= maxNodes) {
        droppedEdges += 1;
        droppedNodeIds.add(e.fromObjectId);
        continue;
      }
      if (isNewNode) {
        nodes.set(e.fromObjectId, { objectId: e.fromObjectId, hop, contribution: 0 });
        next.push(e.fromObjectId);
      }
      const k = `${e.fromObjectId} ${e.toObjectId} ${e.ruleKey} ${e.viaLinkKey}`;
      if (keptEdgeKeys.has(k)) continue;
      keptEdgeKeys.add(k);
      keptEdges.push({
        fromObjectId: e.fromObjectId,
        toObjectId: e.toObjectId,
        ruleKey: e.ruleKey,
        viaLinkKey: e.viaLinkKey,
        amount: e.amount,
      });
      const src = nodes.get(e.fromObjectId);
      if (src) src.contribution += Math.abs(e.amount);
    }
    frontier = next;
  }

  // coverage 分子：**目标自己**那些入边里被保留下来的部分。
  const keptTargetAmount = keptEdges
    .filter((e) => cellOf(e) === targetCell)
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const pct = totalTargetAmount === 0 ? 100 : (keptTargetAmount / totalTargetAmount) * 100;

  return {
    target: { objectId: targetObjectId, stateVar: targetStateVar },
    nodes: [...nodes.values()].sort((a, b) => a.hop - b.hop || b.contribution - a.contribution || a.objectId.localeCompare(b.objectId)),
    edges: keptEdges,
    coverage: {
      maxNodes,
      truncated: droppedNodeIds.size > 0 || droppedEdges > 0,
      droppedNodes: droppedNodeIds.size,
      droppedEdges,
      targetInEdges: targetIn.length,
      amountCoveredPct: Math.round(pct * 100) / 100,
    },
  };
}
