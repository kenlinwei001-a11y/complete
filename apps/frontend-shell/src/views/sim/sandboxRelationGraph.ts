/**
 * ══ WO-SANDBOX-CONFIG-UX · 本体关系的**语义分层模型**（纯函数 · 无 React 依赖）══
 *
 * 仓主给了两份参照物，本文件对的是第二份（`docs/REF-ontology-twin-ux.html`）——
 * 它比第一份更贴我们的模型，因为它把「关系」当成**有语义的分层结构**而不是一张平表：
 *   · 每个节点标明是**原生量**（你填的）还是**派生量**（规则算出来的）——实线框 / 虚线框；
 *   · 每条边给一句**人话算式**（「商机=线索×市场转化率」），而不是只把参数摆出来；
 *   · 关掉一条边 ⇒ 图**当场重画**，下游读数跟着变。
 *
 * 我们此前三样一样都没有：`sandbox-propagation-list`（`SandboxView.tsx` 的「本体派生」折叠格）
 * 把每条边渲染成 `系数 0.35 · 延迟 1 tick` —— **把公式写成了参数**，读者读不出这条边在说什么；
 * 而 `EdgeActivePanel` 有开关、有差值表，**没有图**、也没有原生/派生之分。
 *
 * ── ⛔ 算式是**还原**，不是编造（本文件最容易做错、也最要害的一处）──────────────
 * 屏上那一行算式**逐字对应引擎的真实算术**，不是前端替这条边编一句业务话。对照
 * `apps/datacore/src/sim/propagation.ts`（本单亲手读过的那一版）：
 *   · `const amount = round12(coeff * sourceVal * factor)`          ⇒ `系数 × 源量`
 *   · `factor = 1 - dist/decay.den`（源与目标在抽象图上相邻 ⇒ dist=1） ⇒ `× 衰减系数`
 *   · `applyContribution(..., combine)`：`sum` ⇒ `cur + amount`；`max` ⇒ `Math.max(cur, amount)`
 *   · `arriveTick = releaseTick + delayTicks`                        ⇒ `延迟 N 拍到达`
 *   · `§3) 应用 clamp`：按规则在其 target 上夹值                      ⇒ `再夹到 [min, max]`
 *   · `effectiveCoefficient`：`coefficientRef` 命中就用规则表参数，否则用内联 `coefficient`
 * 换句话说：**没有任何一个字是我想出来的，全部是把已声明的参数写回它本来的运算形态。**
 *
 * ⚠ 真正**编不出来**的那一半，本文件不编（诚实缺席，且屏上明写）：
 *   参照物的算式之所以是人话（「商机 = 线索 × 市场转化率」），是因为它的节点带业务名。
 *   我们的**状态变量在全仓没有任何中文名** —— 35 条规则里的 35 个量纲
 *   （`loadIndex` / `demandPressure` / …）只作为字符串存在于 `PropagationRule` 里，
 *   本体的 `properties` / `derivedProperties` 都不含它们（`EdgeActivePanel` 文件头立的同一条）。
 *   故算式里的**对象类型**用人话名（`ObjectType.displayName`，随边下发），
 *   **状态变量只能显系统键**。这是后端欠账，不是本文件偷懒 —— 前端替它编一个中文名
 *   就是造第二套真相源（R14 零业务常数 · `G-GATE-ROSTER-HANDCOPIED` 同族）。
 *
 * ── 原生量 / 派生量怎么判（判据只有一条，不查表）─────────────────────────────
 * **有没有一条「参与本次推演」的规则写它。** 有 ⇒ 派生量；没有 ⇒ 原生量。
 * 这不是本文件发明的分类：`apps/datacore/src/seed.ts` 自己就写着
 * 「三个纯源量纲（deliveryDelay/demandPressure/priceShock）无人写」，
 * 并把「只被写、不被任何规则读的终端量纲」当作一条实打实的接缝前提在用。
 *
 * ⚠ 判据里的「参与本次推演」= **关掉的边不算**。所以关掉写某个量纲的最后一条边，
 *   它会从派生量**变回原生量** —— 这正是参照物那句「下游退回报告原值」的我们这一侧对应物，
 *   也是「改边即重画」在语义上真正变了的东西（不只是少画一条线）。
 *
 * ⛔ **零业务常数（R14）**：本文件不出现任何行业实体名 / 阈值 / 业务文案。
 *   类型名、量纲名、系数、延迟、域全部来自后端下发的 `PropagationRule`。
 */
import type { PropagationRule } from "@platform/contracts";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 节点与边的展示模型
// ══════════════════════════════════════════════════════════════════════════════

/** 量纲节点的两种身份（参照物：实线框 = 原生量 / 虚线框 = 派生量）。 */
export type RelationNodeKind = "native" | "derived";

/** 图上的一个节点 = 一个**量纲**（`对象类型.状态变量`），不是一个对象实例。 */
export interface RelationNodeVM {
  /** 稳定键 `类型键.状态变量` —— 边的端点、testid、选中态全认它。 */
  key: string;
  typeKey: string;
  /** 对象类型的人话名（`ObjectType.displayName`），查不到显裸键，**不编名字**。 */
  typeName: string;
  /** 状态变量。**只有系统键**：本体里没有它的中文名（见文件头）。 */
  stateVar: string;
  /**
   * 原生量 / 派生量。判据 = 有没有**启用中的**边写它（见文件头）。
   * 关掉最后一条写它的边 ⇒ `derived` → `native`。
   */
  kind: RelationNodeKind;
  /** 写它的边（**只含启用中的**）。 */
  inbound: string[];
  /** 它写出去的边（只含启用中的）。 */
  outbound: string[];
  /**
   * 纵向层（0 = 没有任何启用入边的源头）。
   * **环安全**：租户可以建出环（`A.x→B.y→A.x`），此时环上节点一律停在已算出的最大层，
   * 不无限递归。demo 三十五条边实测无环，此路径是防将来。
   */
  layer: number;
}

/** 图上的一条边 = 一条**传导规则**（参照物的「规则边 · 派生关系」那一类）。 */
export interface RelationEdgeVM {
  /** `PropagationRule.key`（**不认 id** —— `randomBytes` 会漂，与 `edgeActiveModel` 同一条纪律）。 */
  key: string;
  /** 源节点键（`RelationNodeVM.key`）。 */
  from: string;
  /** 目标节点键。 */
  to: string;
  viaLinkKey: string;
  coefficient: number;
  delayTicks: number;
  combine: "sum" | "max";
  /** `true` = 参与本次推演。`false` = 本次推演假装它不存在（会话级反事实，不动本体真值）。 */
  active: boolean;
  domainKey: string | null;
  domainName: string | null;
  /** 人话算式 —— 由声明字段**还原**引擎算术（见文件头，零编造）。 */
  formula: string;
  /**
   * 这条边的系数是不是**引用规则表参数**得来的（`coefficientRef` 非空）。
   * 为真时屏上那个系数**不是最终值** —— 引擎会去规则表取，取不到才回落到内联值。
   * 不标出来就会让人以为屏上这个数就是算的时候用的那个数。
   */
  coefficientFromRule: boolean;
  /** 声明了节拍闸门 ⇒ 这条流要等到开闸才放行（`null` = 不过闸门）。 */
  cadenceNodeId: string | null;
}

/** 一份关系图。 */
export interface RelationGraphVM {
  nodes: RelationNodeVM[];
  edges: RelationEdgeVM[];
  /** 层数（= `max(layer) + 1`；空图为 0）。 */
  layerCount: number;
  /** 原生量个数（现算，**不另存**——与 `nodes.filter` 恒等，两个数就有两套真相）。 */
  nativeCount: number;
  /** 派生量个数（同上）。 */
  derivedCount: number;
  /** 启用中的边数。 */
  activeEdgeCount: number;
}

/** 节点键的唯一构造处（两处各拼一次字符串迟早会漂）。 */
export function relationNodeKey(typeKey: string, stateVar: string): string {
  return `${typeKey}.${stateVar}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 算式还原
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 屏上必须真渲染的**出处记号**（不是注释）。
 *
 * 为什么要有：这一行算式长得像业务规格书里的公式，而它其实是**前端按引擎实现还原**出来的。
 * 引擎哪天改了合并/衰减的算法而这里没跟，屏上就会出现一个查无对证的公式。
 * 记号把「它是还原的、依据是哪个文件」摆在脸上，让读者知道该去核对哪里。
 * （同族做法见 `edgeActiveModel.PROBE_WORLD_PROVENANCE` —— 那次门就是这么抓到「迁了实现、记号没跟」的。）
 */
export const RELATION_FORMULA_PROVENANCE = "算式由声明字段还原";

/** 出处记号的全文（屏上真渲染，收在浮层里）。 */
export const RELATION_FORMULA_PROVENANCE_DETAIL =
  "这一行不是后端下发的公式 —— 传导规则里存的是系数 / 延迟 / 合并方式 / 衰减 / 上下限这几个参数，" +
  "本页把它们写回引擎真实执行的那个算术形态（apps/datacore/src/sim/propagation.ts 的 propagateTick）。" +
  "所以它可核对、可反驳；但它也会随引擎改动而过期，核对时以引擎实现为准。" +
  "状态变量在本体里没有中文名可取，故算式里只出现系统键 —— 这是数据的实情，本页不替它编一个。";

/**
 * 一条边 → 一行算式。**每一段都对应引擎里的一行代码**（见文件头逐条对照）。
 *
 * 形态：`目标 ← 目标 + 系数 × 源`（sum）/ `目标 ← max(目标, 系数 × 源)`（max），
 * 后缀按声明依次追加「衰减 / 延迟 / 夹值」。没声明的一律不写 —— 不写 ≠ 写"无"，
 * 屏上多一个恒为空的字段只会让人以为这里有内容。
 */
export function describeEdgeFormula(rule: {
  sourceTypeKey: string;
  sourceStateVar: string;
  targetTypeKey: string;
  targetStateVar: string;
  coefficient: number;
  delayTicks: number;
  combine?: "sum" | "max";
  decay?: { window: number; den: number } | null;
  clamp?: { min: number; max: number } | null;
  coefficientRef?: { ruleKey: string; paramKey: string } | null;
}): string {
  const src = relationNodeKey(rule.sourceTypeKey, rule.sourceStateVar);
  const dst = relationNodeKey(rule.targetTypeKey, rule.targetStateVar);
  // 系数来源：引用规则表参数时**不写死那个数**（引擎会去取，屏上写死就是撒谎）。
  const coeff = rule.coefficientRef ? `规则 ${rule.coefficientRef.ruleKey}.${rule.coefficientRef.paramKey}` : String(rule.coefficient);
  let term = `${coeff} × ${src}`;
  if (rule.decay) {
    // 引擎：`factor = 1 - dist/den`，源与目标在抽象图上相邻 ⇒ `dist = 1`。
    // `window < 1` 时引擎 `continue`（超窗无贡献）—— 那是"这条边不传导"，不是"乘一个系数"。
    term = rule.decay.window < 1 ? `0（超衰减窗 ${rule.decay.window}，本边不传导）` : `${term} × (1 − 1/${rule.decay.den})`;
  }
  const combine = rule.combine ?? "sum";
  let out = combine === "max" ? `${dst} ← max(${dst}, ${term})` : `${dst} ← ${dst} + ${term}`;
  if (rule.delayTicks > 0) out += `，延迟 ${rule.delayTicks} 拍到达`;
  if (rule.clamp) out += `，再夹到 [${rule.clamp.min}, ${rule.clamp.max}]`;
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 建图
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 传导规则 + 本次关掉的边 → 关系图。
 *
 * ⚠ **关掉的边不从图上消失，只降级**（`active:false`）—— 与 `edgeActiveModel.dimmed` 同一条纪律：
 *   消失了用户就不知道自己关了什么，也就无从把它拨回来。
 *   但它**不参与** `inbound` / `outbound` / 原生派生判定 / 分层 —— 那几样问的是
 *   「这次推演实际怎么算」，关掉的边在那件事里确实不存在。
 *   这个区分就是「改边即重画」真正重画的东西：线还在（变虚），而**节点的身份和层可能变了**。
 *
 * 排序全序（R6 同输入同屏）：节点先按 layer 再按 key；边按 key。
 */
export function buildRelationGraph(
  rules: readonly PropagationRule[],
  disabledRuleKeys: readonly string[],
  typeDisplayNames: ReadonlyMap<string, string> = new Map(),
): RelationGraphVM {
  const off = new Set(disabledRuleKeys);
  const nodes = new Map<string, RelationNodeVM>();
  const touch = (typeKey: string, stateVar: string): RelationNodeVM => {
    const key = relationNodeKey(typeKey, stateVar);
    let n = nodes.get(key);
    if (!n) {
      n = {
        key,
        typeKey,
        // `displayName ?? key`：查不到显裸键，**不渲染空白、也不内联中文名映射**。
        typeName: typeDisplayNames.get(typeKey) ?? typeKey,
        stateVar,
        kind: "native", // 先当原生量，遇到启用入边再改判
        inbound: [],
        outbound: [],
        layer: 0,
      };
      nodes.set(key, n);
    }
    return n;
  };

  const edges: RelationEdgeVM[] = [...rules]
    .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
    .map((r) => {
      const from = touch(r.sourceTypeKey, r.sourceStateVar);
      const to = touch(r.targetTypeKey, r.targetStateVar);
      const active = !off.has(r.key);
      if (active) {
        from.outbound.push(r.key);
        to.inbound.push(r.key);
        to.kind = "derived"; // 有边真的写它 ⇒ 派生量
      }
      return {
        key: r.key,
        from: from.key,
        to: to.key,
        viaLinkKey: r.viaLinkKey,
        coefficient: r.coefficient,
        delayTicks: r.delayTicks,
        combine: r.combine ?? "sum",
        active,
        domainKey: r.domainKey ?? null,
        domainName: r.domainName ?? null,
        formula: describeEdgeFormula(r),
        coefficientFromRule: r.coefficientRef != null,
        cadenceNodeId: r.cadenceNodeId ?? null,
      };
    });

  assignLayers(nodes, edges);

  const list = [...nodes.values()].sort((a, b) => a.layer - b.layer || a.key.localeCompare(b.key));
  return {
    nodes: list,
    edges,
    layerCount: list.length === 0 ? 0 : Math.max(...list.map((n) => n.layer)) + 1,
    // 现算，不另存（chip 上写 7 条、点开只有 5 行的那种病，根子就是两个数分了家）。
    nativeCount: list.filter((n) => n.kind === "native").length,
    derivedCount: list.filter((n) => n.kind === "derived").length,
    activeEdgeCount: edges.filter((e) => e.active).length,
  };
}

/**
 * 纵向分层：`layer(节点) = 1 + max(layer(启用入边的源))`，原生量为 0。
 *
 * **环安全**：用「松弛 + 轮数上限」而不是递归 DFS —— 租户可以经
 * `POST /a/v1/sim/propagation-rules` 建出 `A.x→B.y→A.x`，递归会栈溢出，
 * 而栈溢出在屏上表现为整页白屏（比画错一层严重得多）。轮数上限 = 节点数，
 * 到顶仍在变化 ⇒ 有环，环上节点停在当前层（不抛、不白屏，图照画）。
 */
function assignLayers(nodes: Map<string, RelationNodeVM>, edges: readonly RelationEdgeVM[]): void {
  const active = edges.filter((e) => e.active);
  const limit = nodes.size;
  for (let round = 0; round < limit; round++) {
    let changed = false;
    for (const e of active) {
      const from = nodes.get(e.from);
      const to = nodes.get(e.to);
      if (!from || !to) continue;
      if (to.layer < from.layer + 1) {
        to.layer = from.layer + 1;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 下游可达（= 「改这里会波及什么」的读数）
// ══════════════════════════════════════════════════════════════════════════════

/** 一次下游可达的结果。 */
export interface DownstreamReachVM {
  /** 从起点沿**启用中**的边能走到的量纲（不含起点自己），已排序。 */
  nodeKeys: string[];
  /** 走过的边（已排序）。 */
  edgeKeys: string[];
  /** 起点在不在图里（不在 ⇒ 上面两个数组为空，且这个为 false —— 与"在图里但没有下游"分得开）。 */
  found: boolean;
}

/**
 * 从一个量纲出发，沿启用中的边**广度优先**走到底。
 *
 * 这是参照物「变更传播预览」在我们这一侧最接近的对应物，也是本页那个
 * 「关掉一条边 ⇒ 下游读数真变」的读数来源：关掉一条边，可达集合**当场变小**。
 *
 * ⚠ 它回答的是**结构可达**（这条链在不在），**不是**量级 ——
 *   量级要跑引擎（`POST …/counterfactual`），那是 `EdgeActivePanel` 的差值表在做的事。
 *   两个读数各答各的问，屏上必须分开说，合成一个数就会让人以为可达集变小 = 数值变小。
 */
/**
 * 只保留「焦点量纲 + 它的下游」的子图（**层号重新压紧**，焦点恒为第 0 层）。
 *
 * 为什么必须裁：demo 租户 35 条边 / 40 个量纲，全画出来是一张谁也读不完的网 ——
 * 而用户此刻真正在问的是「**我拨的这个东西**会波及什么」。裁到下游子图，
 * 图就从"系统全貌"变成"这一次推演的影响半径"，行数当场落回一屏之内。
 *
 * ⚠ 焦点不在图里（本体有这个量纲、但没有任何传导规则碰它）⇒ 返回**空图**。
 *   调用方必须把这件事**明说**（「扰动它不会沿本体链路扩散」），不能画一张空图了事 ——
 *   空图与"图没加载出来"在屏上长得一模一样。
 */
export function focusSubgraph(graph: RelationGraphVM, focusNodeKey: string): RelationGraphVM {
  const reach = downstreamReach(graph, focusNodeKey);
  if (!reach.found) return { nodes: [], edges: [], layerCount: 0, nativeCount: 0, derivedCount: 0, activeEdgeCount: 0 };
  const keep = new Set([focusNodeKey, ...reach.nodeKeys]);
  const edgeKeep = new Set(reach.edgeKeys);
  // 关掉的边若两端都在子图里也留着（它要以"虚线"出现，否则用户看不到自己关了什么）。
  const edges = graph.edges.filter((e) => edgeKeep.has(e.key) || (keep.has(e.from) && keep.has(e.to)));
  const nodes = graph.nodes.filter((n) => keep.has(n.key));
  const base = Math.min(...nodes.map((n) => n.layer));
  const shifted = nodes.map((n) => ({ ...n, layer: n.layer - base }));
  return {
    nodes: shifted,
    edges,
    layerCount: shifted.length === 0 ? 0 : Math.max(...shifted.map((n) => n.layer)) + 1,
    nativeCount: shifted.filter((n) => n.kind === "native").length,
    derivedCount: shifted.filter((n) => n.kind === "derived").length,
    activeEdgeCount: edges.filter((e) => e.active).length,
  };
}

export function downstreamReach(graph: RelationGraphVM, fromNodeKey: string): DownstreamReachVM {
  const byFrom = new Map<string, RelationEdgeVM[]>();
  for (const e of graph.edges) {
    if (!e.active) continue;
    const cur = byFrom.get(e.from);
    if (cur) cur.push(e);
    else byFrom.set(e.from, [e]);
  }
  const found = graph.nodes.some((n) => n.key === fromNodeKey);
  if (!found) return { nodeKeys: [], edgeKeys: [], found: false };

  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const queue = [fromNodeKey];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of byFrom.get(cur) ?? []) {
      seenEdges.add(e.key);
      if (seenNodes.has(e.to) || e.to === fromNodeKey) continue; // 环安全：走过就不再入队
      seenNodes.add(e.to);
      queue.push(e.to);
    }
  }
  return { nodeKeys: [...seenNodes].sort(), edgeKeys: [...seenEdges].sort(), found: true };
}
