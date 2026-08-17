import type { SolverStep } from "./SolverStepBar";
import type { DagNodeFacts } from "./DagNodeInspector";
import type { DagEdgeDef, DagNodeDef } from "@/components/Dag/LayeredDag";

/**
 * ══ U2 与 U3 的**同一份结构**（WO-U3-DAG-DESIGN · 设计裁决落地件）══
 *
 * 判据 U2（分步标口径）与 U3（过程图点节点）在 `docs/PRD-harness-ux-adoption.md` §2 里
 * 是两条判据，但它们问的是**同一件事的两个面**：
 *   · U2 问「这个数分几步算出来的，每步的 数据·求解器·规则 是什么」——把推演**排成一条线**；
 *   · U3 问「这一环凭什么，点开看得到来源与规则」——把推演**摊成一张网**。
 * 两者要的事实**逐字相同**（数据 / 求解器 / 规则），只是画法不同。
 *
 * ⛔ **所以它们必须共用一份结构，不许各建一套**（RL3 单一真相源）。
 * 分两单做会造出两套互不相认的结构：改了步骤条的口径、图上的口径不跟着变，
 * 屏上两处对同一环给出两种说法 —— 那比没有更糟（用户不知道该信哪个）。
 * 本文件就是那份唯一结构；`SolverStepBar` / `LayeredDag` / `DagNodeInspector` 三个**渲染件**
 * 全部从它派生，各自**不再**持有自己的事实。
 *
 * ── 为什么不直接拿 `SolverStep[]` 当共享结构（复用判定，写清理由）─────────────
 * `SolverStep`（WO-U2-STEPWISE-1 建）是**平铺列表**：没有 `layer`、没有边。
 * 它表达不了**分叉与汇合**，而分叉恰是 U3 存在的理由：
 *   `optimize_whatif` 的真实链是「入参 →（baseline 解 ∥ perturbed 解）→ 比对 → 解读」，
 *   步骤条把并列的两次求解压成一格「两次求解」⇒ **屏上看不出它是两次独立求解**。
 * ⇒ 判定：**`SolverStepBar` 组件复用（它把步骤态与口径行做对了，且 `upto` 分段闸已被测试咬死），
 *   但它的类型 `SolverStep` 不够当共享结构** —— 本文件在它之上加一层带 `layer` + `edges` 的结构，
 *   再把 `SolverStep[]` **投影**出来。存量两页（plan-generate / optimize-whatif）的步骤条
 *   因此一个字节都不用改（投影结果与手写值逐字相同即零回归）。
 *
 * ── 步骤条是图的**有损**投影，这件事必须写在脸上 ───────────────────────────
 * 一层有多个并列节点时，`toSolverSteps` 只能给出**一格**——逐节点的规则各不相同，
 * 压成一句话就会说谎。故投影在这种层上**明说「本层 N 个并列节点，逐节点规则见过程图」**，
 * 而不是挑第一个节点的规则冒充全层。**「损失了什么」比「看起来完整」重要。**
 *
 * ── `data` 为什么必须写字段名（沿用 WO-U2-STEPWISE-1 的对冲机制，不另起一套）──
 * 求解器输出今天**没有** `steps[]` 这层结构（真改 = 求解器分步计算大改，超前端边界；
 * 服务端重排 = 同一投影做两遍，违 RL3）。前端按**已有分段字段**推导，残余风险是
 * 「求解器内部阶段语义变了，前端按字段名推导的步骤语义悄悄漂移」。
 * 对冲照旧：**每个节点强制声明它读的是哪个字段**（`data`）——字段没了/改名了，引用当场断、
 * 屏上当场看得出来。跨页统一的后端 `steps[]`（带逐段哈希）仍挂账 `WO-U2-SOLVER-STEPS`。
 */

/** 一个推演节点 = 链上的一环。三要素（数据·求解器·规则）是 U2 与 U3 共同要的那三样。 */
export interface ReasoningNode {
  /** 稳定键（testid / 边的端点用）。 */
  key: string;
  /** 屏上名。 */
  label: string;
  /** 第几层（0-based）。线性化成步骤条时的序；画成图时的纵向泳道。 */
  layer: number;
  /** 图上节点副标题（该环的读数，有则给）。 */
  sub?: string;
  /** 该环的结论（面板最前，无则省略——不编）。 */
  verdict?: string;
  /**
   * **数据**：这一环读求解器输出的哪个字段（或入参面板）。
   * ⚠ 写**字段名**，不写白话——字段漂移时引用当场断，这是本结构唯一的防漂移机制。
   */
  data: string;
  /** **求解器**：这一环的数是哪次调用产出的（求解器键，或「页面入参·未求解」）。 */
  solver: string;
  /** **规则**：这一环的判定口径（规则键 / 确定性投影规则原文）。 */
  rule: string;
  /**
   * 规则性质（诚实位，缺省按业务规则键处理）。
   * `ruleKey` = 规则库里查得到、改得动、有版本；`projection` = 代码里逐字实现的确定性判定逻辑。
   * 混成一个字会把用户支去规则库找一个根本不存在的键（见 `DagNodeInspector` 头注）。
   */
  ruleKind?: "ruleKey" | "projection";
  /** 推导公式（有则给）。 */
  formula?: string;
  /** 该环真实读到的输入。 */
  inputs?: { label: string; value: string }[];
  /** 诚实位 / 限定条件。 */
  note?: string;
  /** 图上着色语义。 */
  state?: "fail" | "warn" | "dim";
}

/** 一条边 = 「谁推出谁」。 */
export interface ReasoningEdge {
  from: string;
  to: string;
}

/** 一页的推演结构。**一页一份**，U2 与 U3 都从它派生。 */
export interface ReasoningGraph {
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
  /** 每层的名字（= 步骤条上那一步的名字；两处共用一份，改一处两处同变）。 */
  layerTitles: string[];
}

/** 层号 → 该层节点（按 `nodes` 原序）。 */
function byLayer(g: ReasoningGraph): Map<number, ReasoningNode[]> {
  const m = new Map<number, ReasoningNode[]>();
  for (const n of g.nodes) {
    if (!m.has(n.layer)) m.set(n.layer, []);
    m.get(n.layer)!.push(n);
  }
  return m;
}

/**
 * 结构自检 —— 在**生产入口**抛，不只写在测试里。
 * 与 `assertDagNodeFacts` 同一处理：U2/U3 的失败模式（口径缺一半 / 边指向不存在的节点）
 * **在屏上看不出来**（步骤条照样渲、图照样画），只有真去核对的人才发现无从下手。
 */
export function assertReasoningGraph(g: ReasoningGraph): ReasoningGraph {
  const keys = new Set<string>();
  for (const n of g.nodes) {
    if (keys.has(n.key)) throw new Error(`ReasoningGraph：节点键「${n.key}」重复——边会连到错误的那一个。`);
    keys.add(n.key);
    const miss: string[] = [];
    if (!n.data.trim()) miss.push("data(数据)");
    if (!n.solver.trim()) miss.push("solver(求解器)");
    if (!n.rule.trim()) miss.push("rule(规则)");
    if (miss.length > 0) {
      throw new Error(
        `ReasoningGraph：节点「${n.label}」缺 ${miss.join(" / ")}——` +
          `步骤条会渲出一格空口径、图上点开是个只有标题的面板，用户无法定位是哪一环坏了（判据 U2/U3）。`,
      );
    }
    if (n.layer < 0 || n.layer >= g.layerTitles.length) {
      throw new Error(`ReasoningGraph：节点「${n.label}」的 layer=${n.layer} 超出 layerTitles（${g.layerTitles.length} 层）。`);
    }
  }
  for (const e of g.edges) {
    if (!keys.has(e.from) || !keys.has(e.to)) {
      throw new Error(`ReasoningGraph：边 ${e.from}→${e.to} 指向不存在的节点——图上会画成一条断线，且静默。`);
    }
  }
  return g;
}

/**
 * 判「这一页该画图还是画步骤条」——**给论据，不替产品拍板**。
 * 判据只有一个：**有没有分叉/汇合**。
 *  · 每层恰好 1 个节点（纯线性）⇒ 步骤条足够，画图是无谓的装饰；
 *  · 任何一层 ≥2 个节点（分叉）⇒ 步骤条会把并列压成一格 ⇒ 必须画图，否则那一层的信息屏上看不见。
 */
export function isLinearChain(g: ReasoningGraph): boolean {
  for (const list of byLayer(g).values()) if (list.length > 1) return false;
  return true;
}

/**
 * 投影① · U2 步骤条：**一层 = 一步**。
 *
 * 层内多节点时**明说损失**（见文件头注）：不许挑第一个节点的规则冒充全层。
 */
export function toSolverSteps(g: ReasoningGraph): SolverStep[] {
  const m = byLayer(g);
  const steps: SolverStep[] = [];
  for (let layer = 0; layer < g.layerTitles.length; layer++) {
    const list = m.get(layer) ?? [];
    if (list.length === 0) continue;
    const uniq = (xs: string[]): string[] => [...new Set(xs)];
    const solvers = uniq(list.map((n) => n.solver));
    if (list.length === 1) {
      const n = list[0]!;
      steps.push({ key: `l${layer}`, label: g.layerTitles[layer]!, data: n.data, solver: n.solver, rule: n.rule });
    } else {
      // 并列层：数据逐节点列全（字段名不许省，防漂移机制靠它）；规则**不合并**，明说去图上逐个看。
      steps.push({
        key: `l${layer}`,
        label: g.layerTitles[layer]!,
        data: uniq(list.map((n) => n.data)).join(" ∥ "),
        solver: solvers.join(" ∥ "),
        rule: `本层 ${list.length} 个并列环，规则逐环不同 ⇒ 在过程图上点各环看（步骤条压不进一句话）`,
      });
    }
  }
  return steps;
}

/** 投影② · U3 过程图的节点（喂 `LayeredDag`）。 */
export function toDagNodes(g: ReasoningGraph): DagNodeDef[] {
  return g.nodes.map((n) => ({
    id: n.key,
    layer: n.layer,
    label: n.label,
    ...(n.sub === undefined ? {} : { sub: n.sub }),
    ...(n.state === undefined ? {} : { state: n.state }),
  }));
}

/** 投影② · U3 过程图的边（喂 `LayeredDag`）。 */
export function toDagEdges(g: ReasoningGraph): DagEdgeDef[] {
  return g.edges.map((e) => ({ from: e.from, to: e.to }));
}

/**
 * 投影③ · U3 点节点面板（喂 `DagNodeInspector`）。
 *
 * **来源 = 求解器 + 它读的字段**（两样合一行）：只写求解器名，用户仍不知道该去看哪个字段；
 * 只写字段名，用户不知道是谁算的。判据 U3 要的「定位到哪一环坏了」需要两样都在。
 */
export function toDagNodeFacts(n: ReasoningNode): DagNodeFacts {
  return {
    title: n.label,
    ...(n.verdict === undefined ? {} : { verdict: n.verdict }),
    src: `${n.solver} · ${n.data}`,
    rule: n.rule,
    ruleKind: n.ruleKind ?? "projection",
    ...(n.formula === undefined ? {} : { formula: n.formula }),
    ...(n.inputs === undefined ? {} : { inputs: n.inputs }),
    ...(n.note === undefined ? {} : { note: n.note }),
  };
}

/** 按键取节点（点击回调里用；找不到返回 null，不抛——点了个不存在的键是渲染 bug，不该炸用户的屏）。 */
export function findNode(g: ReasoningGraph, key: string): ReasoningNode | null {
  return g.nodes.find((n) => n.key === key) ?? null;
}
