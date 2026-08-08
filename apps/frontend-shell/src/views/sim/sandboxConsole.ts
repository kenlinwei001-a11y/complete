/**
 * WO-SANDBOX-CONSOLE · 推演沙盘控制台的**纯派生层**。
 *
 * ── 这个文件是什么 ────────────────────────────────────────────────────────────
 * 把两个引擎求解器的载荷翻译成控制台三处（画布卡片 / 右侧检视 / 底部 Pareto）要用的视图模型。
 * **它不产生任何数字**：天数、占比、计数、阈值全部是引擎返回值的纯函数。
 *
 * ── 头号纪律：口径单源（本仓 #99/#110 的病根就在这里）────────────────────────
 * ① 影响率（`pctOfChainLoss`）**只能来自** `chain_loss_attribution` 的 `attribution[]`。
 *    前端**不定义分母、不算百分比**。引擎口径：分母 = 全链**非增值**天数之和（增值段不进分母，
 *    故全链非增值环节 pct 之和恒 100%，`conservation.sumPct` 就是这个守恒的自证）。
 *    节点级 `pctOfChainLoss` = 该节点各环节 pct 的**加和**（同一个分母下的求和，不是新口径）。
 * ② 节点/环节清单**只能来自**引擎载荷（`payload.nodes[]`）或 contracts 注册表
 *    （`CHAIN_NODE_REGISTRY`）。前端**不手抄词表** —— D1 与 E1 各发明一套词表、交集为 0、
 *    整条链断掉，就是这么来的（`chain-sim.ts:120` 注释里记着这笔账）。
 * ③ 三类阻滞点的中文名与含义**只能来自** `chainImpediment.ts` 的
 *    `IMPEDIMENT_KIND_LABEL` / `IMPEDIMENT_KIND_MEANING`（那两张表又抄自 PRD §5.1 / contracts）。
 *    本文件**不重写**一句判定含义 —— 设计稿的副标题与引擎判据不一致处见 §3 `IMPEDIMENT_DESIGN_GAP`。
 *
 * ── 同一份数据三处投影，三处各答一问（不重叠）─────────────────────────────
 * 设计稿把逐环节明细画了三遍（画布卡片 / 右侧检视 / 底部 Pareto，排序数值完全相同）。
 * 本层按「一处一问」拆开，**数据仍是全的，只是卡片不全画**：
 *  · 画布卡片 → 「哪个节点最该动」：节点级一个数 + 最大那条环节名 + 页脚（其余折叠为计数）；
 *  · 右侧检视 → 「这个节点为什么慢」：完整逐环节表（唯一出全表的地方）；
 *  · 底部 Pareto → 「全链哪十几个环节吃掉大部分损失」：跨节点拉平 Top-N（别处给不了的视角）。
 * 三者是**同一份响应的三种投影**，不是三次取数。
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机。
 */
import {
  CHAIN_NODE_REGISTRY,
  CHAIN_STAGES,
  CHAIN_OP_NODE_PREFIX,
  isValueAddKind,
  type ChainImpedimentKind,
  type ChainNode,
  type ChainStage,
  type ChainStep,
  type ChainStepKind,
} from "@platform/contracts";
import { STAGE_LABEL, STEP_KIND_LABEL, type ChainLossEmptyRow, type ChainLossPayload } from "./chainLineMap";
import {
  IMPEDIMENT_KIND_LABEL,
  IMPEDIMENT_KIND_MEANING,
  type ChainImpedimentModel,
  type ImpedimentVM,
} from "./chainImpediment";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 画布模式（一块画布多模式，不是多个页）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 中央画布的模式。设计稿是三个（线路图 / 物理拓扑 / 链路阶段）；
 * 第四个 `ontology` 是**旧沙盘主屏的本体 PmDag 拓扑**——它是已接线的真功能，
 * 重组时不许丢，故降为画布的第四模式而不是删掉（去处见交付报告）。
 */
export const CANVAS_MODES = ["metro", "topo", "chain", "ontology"] as const;
export type CanvasMode = (typeof CANVAS_MODES)[number];

export const CANVAS_MODE_LABEL: Record<CanvasMode, string> = {
  metro: "线路图",
  topo: "物理拓扑",
  chain: "链路阶段",
  ontology: "本体拓扑",
};

/** 画布标题（设计稿 `cvT` 那一行）。 */
export const CANVAS_MODE_TITLE: Record<CanvasMode, string> = {
  metro: "产销线路图 · 站 = 环节 · 站圈 ∝ 该环节吃掉的全链损失占比",
  topo: "物理拓扑 · 基地 × 工序热力矩阵",
  chain: "链路阶段 · 按引擎返回的节点分段铺开（5 段 · 段数/节点数以后端注册表为准）",
  ontology: "本体拓扑 · 节点 = 已发布对象类型，着色随 tick 变（推演沙盘原主屏）",
};

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 范围筛选（左栏）—— 真实性照实标，不把三个都做成能用的样子
// ══════════════════════════════════════════════════════════════════════════════

/** 一个筛选维度今天到底能不能带下去。**这不是修饰语，是三种不同的事实。** */
export type ScopeWiring = "wired" | "no-args";

export const SCOPE_WIRING_BADGE: Record<ScopeWiring, string> = {
  wired: "已接线",
  "no-args": "无 ARGS",
};

export interface ScopeDimensionSpec {
  /** `ChainScope` 上的维度名（也是求解器 args 的键）。 */
  readonly key: "baseIds" | "businessTypes" | "modelIds";
  readonly label: string;
  readonly wiring: ScopeWiring;
  /** `no-args` 时：为什么带不下去（取证原文，不是我自己的猜测）。 */
  readonly note: string;
}

/**
 * 三个范围维度的接线事实。
 *
 * ⚠ `businessTypes` / `modelIds` 的真相：`chain_impediments` 在
 * `apps/datacore/src/solvers/../service.ts:3125` 明写「暂不支持 scope.businessTypes / scope.modelIds
 * 维度过滤」，并且**显式报 400**（`ChainImpedimentView.argsFromView` 的注释记着：前端照样原样透传，
 * 引擎该报 400 就让它报 400 —— 前端悄悄吞掉一个维度才是 plausible-but-WRONG 的病根）。
 * 故本控制台的左栏：`baseIds` 可勾选并真带下去；另两维**只读展示 + 无 ARGS 徽标**，
 * 勾了也不会变成 args（不给用户一个假旋钮）。
 */
export const SCOPE_DIMENSIONS: readonly ScopeDimensionSpec[] = [
  {
    key: "businessTypes",
    label: "业务线",
    wiring: "no-args",
    note: "chain_impediments 显式拒绝 scope.businessTypes（后端 service.ts:3125「暂不支持」并报 400）——今天这一维带不下去，故此处只读不可勾。",
  },
  {
    key: "baseIds",
    label: "基地",
    wiring: "wired",
    note: "ChainScope.baseIds 取值集派生自 contracts BASE_REGISTRY（CANONICAL_BASE_IDS），勾选即进求解器 args.scope。",
  },
  {
    key: "modelIds",
    label: "产品",
    wiring: "no-args",
    note: "chain_impediments 显式拒绝 scope.modelIds（后端 service.ts:3125「暂不支持」并报 400）——今天这一维带不下去，故此处只读不可勾。",
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 阻滞点统计条（顶部四卡）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 三张阻滞点卡的定义。**标题与含义直接取 `chainImpediment.ts` 的两张表**，
 * 本文件不重写一句（那两张表抄自 PRD §5.1 / contracts `chain-sim.ts` §6）。
 */
export const IMPEDIMENT_CARDS = (["BOTTLENECK", "CONGESTION", "BREAK"] as const).map((kind) => ({
  kind,
  label: IMPEDIMENT_KIND_LABEL[kind],
  meaning: IMPEDIMENT_KIND_MEANING[kind],
}));

/**
 * **设计稿副标题与引擎判据的语义差**（实测 `chain_impediments` 在 demo 合成种子上的判据得出，
 * 不是照抄工单里的那句话）。
 *
 * 设计稿把「卡点」副标题写作「规则/审批挡着 —— 等待是规则性的（闸）」。
 * 而引擎 `BOTTLENECK` 的两条判据是：
 *   · `BOTTLENECK.CAPACITY.process-hard-capacity`（C02 · 阈值 source=field `Process.requiredThroughput`）
 *   · `BOTTLENECK.CAPACITY.line-utilization-redline`（C05 · 阈值 literal 95%，且带 SUSTAIN caveat）
 * 两条都是**产能/利用率打满**，没有一条是「等审批 / 等会议 / 等节拍」。
 * 「等规则性节拍」这件事今天由 `chain_loss_attribution` 的 `kind:"cadence"` 环节承载
 *（实测锚点单上 demand.consensus__cadence 占全链损失 8.95%），**不在阻滞点扫描里**。
 * 故控制台按引擎口径渲染，并把这条差异当成诚实位显示出来 —— 不拿设计稿的词去盖引擎的判据。
 */
export const IMPEDIMENT_DESIGN_GAP =
  "设计稿把「卡点」注为「规则/审批挡着（闸）」，但引擎 chain_impediments 的 BOTTLENECK 两条判据都是产能/利用率打满" +
  "（C02 硬容量 · C05 利用率红线 95%），没有一条判「等审批 / 等会议」。「等节拍」那类等待今天由 chain_loss_attribution 的 " +
  "cadence 环节承载，不在本扫描内。本条按引擎口径显示，不按设计稿措辞。";

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 链路阶段画布 —— 节点卡（瘦身版）
// ══════════════════════════════════════════════════════════════════════════════

/** 一条环节在检视表里的完整形态。每个字段都能指回引擎载荷。 */
export interface StepVM {
  stepId: string;
  /** 引擎给了 label 就用引擎的；没给按 kind 显示（`STEP_KIND_LABEL`），**不在前端编一个名字**。 */
  label: string;
  kind: ChainStepKind;
  kindLabel: string;
  days: number;
  valueAdd: boolean;
  /** 非增值天数（引擎 `attribution[].nonValueDays`）。增值段无归因行 → null。 */
  nonValueDays: number | null;
  /** 占全链损失（引擎 `attribution[].pctOfChainLoss`）。增值段无归因行 → null。 */
  pctOfChainLoss: number | null;
  /** 等的是哪个节拍（`kind==="cadence"` 时引擎必给）。 */
  cadenceLabel: string | null;
}

/** 一个节点在画布上的形态。**卡片只画其中三样**，其余留给右侧检视。 */
export interface NodeCardVM {
  nodeId: string;
  label: string;
  stage: ChainStage;
  /** 是否属动态工序命名空间 `capacity.op.*`（不在静态注册表里，数量随 Routing 实例变）。 */
  dynamicOp: boolean;
  /** 前置期 = 该节点各环节 days 之和（契约 `nodeLeadTimeDays` 的口径：派生量不落字段）。 */
  leadTimeDays: number;
  /** 增值天数 = `isValueAddKind` 的环节之和（判据走 contracts 单源，不写 `kind==="work"`）。 */
  valueAddDays: number;
  /** 流动效率 = 增值 / 前置期，**0–1 的分数**（与引擎 `totals.flowEfficiency` 同量纲）。前置期 0 → null。 */
  flowEfficiency: number | null;
  /** 节点级占全链损失 = 该节点各环节 `pctOfChainLoss` 之和（同一分母下求和，不是新口径）。 */
  pctOfChainLoss: number;
  /** 卡片上唯一展开的那条：非增值天数最大的环节（并列取 stepId 字典序小者 · R6 全序）。 */
  topStep: StepVM | null;
  /** 卡片折叠掉的环节数（= steps.length - (topStep ? 1 : 0)）。 */
  collapsedCount: number;
  /** 完整逐环节表（右侧检视用；卡片不画）。按非增值天数降序、并列按 stepId 字典序。 */
  steps: StepVM[];
  /** 该节点上诚实缺席的环节（引擎 `empty[]` 里 nodeId 命中的行）。 */
  emptySteps: ChainLossEmptyRow[];
}

/**
 * 一个**只有诚实缺席行、没有任何环节**的在册节点（WO-CONSOLE-CLEANUP 新增）。
 *
 * ── 为什么它必须是一张卡，而不是段尾一行小字 ──────────────────────────────────
 * 注册表 12→24 之后，新增 12 个里 10 个是 `NO_CARRIER`（`PRD-chain-24nodes.md` §3）。
 * 在这之前它们在画布上只被折成 `lane.orphanEmpty` 的**一行文字**，于是屏上读起来是
 * 「这一段有 3 个节点」而不是「这一段有 3 个能算的 + 5 个算不出来的」——
 * **「在册」与「有数据」被画成了同一件事**，正是本仓最贵的那个错觉。
 *
 * 卡形而不是行文，是为了让「这里有一个节点」这件事与有数据的节点**同级可见**；
 * 而形状（不是颜色深浅）必须分家：深浅会被读成「同一种东西弱一点」，
 * 但这两者是**有数据 / 没有承载物**两种事实（与线路图闭环段、在途三档图元同一条纪律）。
 */
export interface EmptyNodeCardVM {
  nodeId: string;
  /** 节点名取 `CHAIN_NODE_REGISTRY`（contracts 单源）；不在册则用 nodeId 原样，**不编名字**。 */
  label: string;
  /** 在不在静态注册表里（`false` = 动态工序命名空间那类，只可能来自载荷）。 */
  registered: boolean;
  stage: ChainStage;
  /** 本节点的诚实缺席行，引擎 `empty[]` 原样（`reason` / `probe` **逐字透传**，前端不改写）。 */
  rows: ChainLossEmptyRow[];
  /** 本节点上出现过的 `emptyKind`（去重 · 字典序 · R6 全序）。 */
  kinds: string[];
}

/** 一段（lane）。**空段也保留** ——「这一段本次没有节点」必须说出来，不是消失。 */
export interface StageLaneVM {
  stage: ChainStage;
  label: string;
  nodes: NodeCardVM[];
  /** 该段上诚实缺席的环节（`empty[]` 里 stage 命中、但 nodeId 不在本段任何节点上的行）。 */
  orphanEmpty: ChainLossEmptyRow[];
  /**
   * `orphanEmpty` 按 nodeId 归拢成的**灰卡片**（同一批行的另一种投影，不是第二份数据）。
   * 排序：nodeId 字典序（R6 全序）。
   */
  emptyNodes: EmptyNodeCardVM[];
  /**
   * 该段上**在册但本次载荷里既无环节也无 EMPTY 行**的节点（「在册不在场」）。
   * 实测今天恰有一个：`capacity.maint`（`flowGate:false` ⇒ 不产环节也不产 EMPTY 行，
   * `PRD-chain-24nodes.md` §6.6 记着这笔账）。屏上照实说，不当它不存在。
   */
  absentNodes: { nodeId: string; label: string }[];
}

export interface StageBoardVM {
  lanes: StageLaneVM[];
  /** 任一段里最多有几个节点（画布宽度的决定因素）。 */
  maxNodesInLane: number;
  nodeCount: number;
  stepCount: number;
  emptyCount: number;
}

/** 环节排序的**唯一**实现：非增值天数降序 → stepId 字典序（R6 全序，前端别处不许再排一套）。 */
function compareStepDesc(a: StepVM, b: StepVM): number {
  const av = a.nonValueDays ?? -1;
  const bv = b.nonValueDays ?? -1;
  if (av !== bv) return bv - av;
  return a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0;
}

function toStepVM(s: ChainStep, attr: Map<string, { nonValueDays: number; pctOfChainLoss: number }>): StepVM {
  const a = attr.get(s.stepId);
  return {
    stepId: s.stepId,
    label: s.label ?? STEP_KIND_LABEL[s.kind],
    kind: s.kind,
    kindLabel: STEP_KIND_LABEL[s.kind],
    days: s.days,
    valueAdd: s.valueAdd,
    nonValueDays: a?.nonValueDays ?? null,
    pctOfChainLoss: a?.pctOfChainLoss ?? null,
    cadenceLabel: s.cadence === undefined ? null : `${s.cadence.kind} · 每 ${s.cadence.everyDays} 天`,
  };
}

function toNodeCard(n: ChainNode, attr: Map<string, { nonValueDays: number; pctOfChainLoss: number }>, empty: ChainLossEmptyRow[]): NodeCardVM {
  const steps = n.steps.map((s) => toStepVM(s, attr)).sort(compareStepDesc);
  const leadTimeDays = n.steps.reduce((a, s) => a + s.days, 0);
  const valueAddDays = n.steps.filter((s) => isValueAddKind(s.kind)).reduce((a, s) => a + s.days, 0);
  const pctOfChainLoss = steps.reduce((a, s) => a + (s.pctOfChainLoss ?? 0), 0);
  // 卡片上展开的那条 = 排序后第一条**非增值**环节（增值段不进损失，展开它没有意义）。
  const topStep = steps.find((s) => s.pctOfChainLoss !== null) ?? null;
  return {
    nodeId: n.nodeId,
    label: n.label,
    stage: n.stage,
    dynamicOp: n.nodeId.startsWith(CHAIN_OP_NODE_PREFIX),
    leadTimeDays,
    valueAddDays,
    flowEfficiency: leadTimeDays > 0 ? valueAddDays / leadTimeDays : null,
    pctOfChainLoss,
    topStep,
    collapsedCount: steps.length - (topStep === null ? 0 : 1),
    steps,
    emptySteps: empty.filter((e) => e.nodeId === n.nodeId),
  };
}

/**
 * 载荷 → 分段板。段序 = `CHAIN_STAGES`（契约里那个顺序即链路顺序），
 * 段内节点按 `pctOfChainLoss` 降序 → nodeId 字典序（R6 全序）。
 */
/**
 * `orphanEmpty` → 灰卡片（同一批行按 nodeId 归拢，**不是第二次取数、不产生任何新数字**）。
 * 节点名走 `CHAIN_NODE_REGISTRY` 单源；不在册的用 nodeId 原样。行内一切原文透传。
 */
function toEmptyNodeCards(rows: ChainLossEmptyRow[]): EmptyNodeCardVM[] {
  const byNode = new Map<string, ChainLossEmptyRow[]>();
  for (const r of rows) {
    const bucket = byNode.get(r.nodeId);
    if (bucket === undefined) byNode.set(r.nodeId, [r]);
    else bucket.push(r);
  }
  return [...byNode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([nodeId, list]) => {
      const def = CHAIN_NODE_REGISTRY.find((d) => d.nodeId === nodeId);
      return {
        nodeId,
        label: def?.label ?? nodeId,
        registered: def !== undefined,
        stage: list[0]!.stage,
        rows: [...list].sort((x, y) => (x.stepId < y.stepId ? -1 : x.stepId > y.stepId ? 1 : 0)),
        kinds: [...new Set(list.map((r) => r.emptyKind))].sort(),
      };
    });
}

export function buildStageBoard(payload: ChainLossPayload): StageBoardVM {
  const attr = new Map(payload.attribution.map((a) => [a.stepId, { nonValueDays: a.nonValueDays, pctOfChainLoss: a.pctOfChainLoss }]));
  const empty = payload.empty ?? [];
  const cards = payload.nodes.map((n) => toNodeCard(n, attr, empty));
  const claimedNodeIds = new Set(cards.map((c) => c.nodeId));
  const emptyNodeIds = new Set(empty.map((e) => e.nodeId));
  const lanes: StageLaneVM[] = CHAIN_STAGES.map((stage) => {
    const orphanEmpty = empty.filter((e) => e.stage === stage && !claimedNodeIds.has(e.nodeId));
    return {
      stage,
      label: STAGE_LABEL[stage],
      nodes: cards
        .filter((c) => c.stage === stage)
        .sort((a, b) => (b.pctOfChainLoss !== a.pctOfChainLoss ? b.pctOfChainLoss - a.pctOfChainLoss : a.nodeId < b.nodeId ? -1 : 1)),
      orphanEmpty,
      emptyNodes: toEmptyNodeCards(orphanEmpty),
      // 在册但两处都不在场：注册表顺序（R6 全序，与注册表同序）。
      absentNodes: CHAIN_NODE_REGISTRY.filter(
        (d) => d.stage === stage && !claimedNodeIds.has(d.nodeId) && !emptyNodeIds.has(d.nodeId),
      ).map((d) => ({ nodeId: d.nodeId, label: d.label })),
    };
  });
  return {
    lanes,
    maxNodesInLane: lanes.reduce((m, l) => Math.max(m, l.nodes.length), 0),
    nodeCount: cards.length,
    stepCount: cards.reduce((a, c) => a + c.steps.length, 0),
    emptyCount: empty.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 链路阶段的**诚实边界**：设计目标 5 段 24 节点 vs 后端注册表今天有的
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 设计稿第三模式的目标形态是 **5 段 24 节点**。
 *
 * ── 状态（WO-CHAIN-24 之后）：**差额已归零** ───────────────────────────────────
 * 后端单源今天是 **5 段 24 个静态在册节点**（`packages/contracts/src/chain-sim.ts` 的
 * `CHAIN_STAGES` 与 `CHAIN_NODE_REGISTRY`）＋ 一个**动态工序命名空间** `capacity.op.*`
 * （数量随 Routing/Operation 实例变，不可能进静态注册表）。
 * 本常量**留着不删**，因为它是「屏上那句差额」的唯一出处：差额归零不等于这条诚实位没用了 ——
 * 哪天设计稿又加一段、或者有人从注册表里删了节点，它会立刻把差额显示成非零。
 *
 * ── 仍然成立的两条纪律 ──────────────────────────────────────────────────────
 *  · 本控制台**按后端真有的渲染**，不拿在册数冒充设计数；
 *  · 不在前端手抄一份 24 节点词表（那正是 D1/E1 各造一套词表、交集为 0、整条链断掉的复现）。
 *
 * ── 一条必须写下来的不一致（不圆场）────────────────────────────────────────
 * 设计稿顶栏写「5 段 24 节点」，但它自己的 `N[]` 卡片数组**实际是 27 张卡**。
 * 本处 `nodeCount` 取 **24**（顶栏数），差出的 3 张卡的归属在契约
 * `chain-sim.ts` §2.5 的注释里逐条写明（M2/M4/M5 → 动态工序命名空间、M7 → `capacity.quality`、
 * P4 → `capacity.schedule`）。**注册表那一份是主叙述，这里不复述第二遍**，免得两处漂。
 *
 * ── 「算得出」与「在册」是两件事（这才是今天真正的诚实位）─────────────────
 * 24 个节点全部在册 ≠ 24 个节点全部有数据。实测（seed 42 · 锚点 SO-3391）：
 * 新增 12 个里只有 2 个（入厂在途 / 到货检验）能算出真天数，其余 10 个走
 * `chain_loss_attribution` 的 `empty[]` 诚实缺席行。画布**照实渲染这两种形态**
 * （节点卡 vs 段内 EMPTY 行），不给算不出来的节点补 0。
 */
export const CHAIN_STAGE_DESIGN_TARGET = {
  stageCount: 5,
  nodeCount: 24,
  /** 设计稿的五段名（只用于「差在哪」的对照说明，**不作为渲染清单**）。 */
  stageNames: ["需求与承诺", "计划与齐套", "采购与到料", "制造与质量", "交付与回款"] as const,
} as const;

export interface ChainStageCoverage {
  designStageCount: number;
  designNodeCount: number;
  designStageNames: readonly string[];
  backendStageCount: number;
  /** 静态在册节点数（`CHAIN_NODE_REGISTRY.length`）。 */
  backendRegistryNodeCount: number;
  backendStageLabels: string[];
  /** 差额（设计目标 − 后端在册），> 0 表示尚未建模。 */
  missingNodeCount: number;
  missingStageCount: number;
  /** 本次载荷实际渲染了几个节点 / 其中几个是动态工序节点。 */
  renderedNodeCount: number;
  renderedDynamicOpCount: number;
}

export function chainStageCoverage(board: StageBoardVM | null): ChainStageCoverage {
  const rendered = board === null ? [] : board.lanes.flatMap((l) => l.nodes);
  return {
    designStageCount: CHAIN_STAGE_DESIGN_TARGET.stageCount,
    designNodeCount: CHAIN_STAGE_DESIGN_TARGET.nodeCount,
    designStageNames: CHAIN_STAGE_DESIGN_TARGET.stageNames,
    backendStageCount: CHAIN_STAGES.length,
    backendRegistryNodeCount: CHAIN_NODE_REGISTRY.length,
    backendStageLabels: CHAIN_STAGES.map((s) => STAGE_LABEL[s]),
    missingNodeCount: CHAIN_STAGE_DESIGN_TARGET.nodeCount - CHAIN_NODE_REGISTRY.length,
    missingStageCount: CHAIN_STAGE_DESIGN_TARGET.stageCount - CHAIN_STAGES.length,
    renderedNodeCount: rendered.length,
    renderedDynamicOpCount: rendered.filter((n) => n.dynamicOp).length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5.2 · 「在册」与「有数据」是两件事 —— 三种在场形态（WO-CONSOLE-CLEANUP）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 在册节点在**本次载荷**里的三种在场形态。差额归零之后，屏上该说的话从
 * 「差几段几个没建模」变成这个 —— **注册表补齐 ≠ 这些节点有数据**。
 *
 * 三态互斥且穷尽（判据只看载荷，前端不推断）：
 *  · `withSteps`  —— 载荷 `nodes[]` 里有它 ⇒ 有环节、能算天数；
 *  · `emptyOnly`  —— 只出现在 `empty[]` ⇒ 诚实缺席（`emptyKind` + `reason` 由引擎给）；
 *  · `absent`     —— 两处都没有 ⇒ **在册不在场**（今天恰有 `capacity.maint` 一个：
 *    `flowGate:false` ⇒ 引擎既不产环节也不产 EMPTY 行，见 `PRD-chain-24nodes.md` §6.6）。
 *
 * `emptyRowsByKind` 是 `empty[]` **行数**按 `emptyKind` 的分组计数 —— 分组计数，
 * 不是对引擎数值做加法/换算（口径单源那条红线管的是「数值」，行数是载荷自身的规模）。
 */
export interface ChainNodePresenceVM {
  /** 静态在册节点总数（`CHAIN_NODE_REGISTRY.length`）。 */
  registered: number;
  withSteps: string[];
  emptyOnly: string[];
  absent: { nodeId: string; label: string; stage: ChainStage }[];
  /** `empty[]` 行按 emptyKind 分组计数（计数降序 → kind 字典序 · R6 全序）。 */
  emptyRowsByKind: { kind: string; count: number }[];
  /** `empty[]` 总行数（= 引擎 `totals.emptyCount` 的同一批行）。 */
  emptyRowCount: number;
  /** 载荷里不在静态册内的节点数（动态工序命名空间 `capacity.op.*` 那类）。 */
  unregisteredInPayload: number;
}

export function chainNodePresence(payload: ChainLossPayload | null): ChainNodePresenceVM {
  const nodeIds = new Set((payload?.nodes ?? []).map((n) => n.nodeId));
  const empty = payload?.empty ?? [];
  const emptyIds = new Set(empty.map((e) => e.nodeId));
  const kindCount = new Map<string, number>();
  for (const e of empty) kindCount.set(e.emptyKind, (kindCount.get(e.emptyKind) ?? 0) + 1);
  return {
    registered: CHAIN_NODE_REGISTRY.length,
    withSteps: CHAIN_NODE_REGISTRY.filter((d) => nodeIds.has(d.nodeId)).map((d) => d.nodeId),
    emptyOnly: CHAIN_NODE_REGISTRY.filter((d) => !nodeIds.has(d.nodeId) && emptyIds.has(d.nodeId)).map((d) => d.nodeId),
    absent: CHAIN_NODE_REGISTRY.filter((d) => !nodeIds.has(d.nodeId) && !emptyIds.has(d.nodeId)).map((d) => ({
      nodeId: d.nodeId,
      label: d.label,
      stage: d.stage,
    })),
    emptyRowsByKind: [...kindCount.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.kind < b.kind ? -1 : 1)),
    emptyRowCount: empty.length,
    unregisteredInPayload: [...nodeIds].filter((id) => !CHAIN_NODE_REGISTRY.some((d) => d.nodeId === id)).length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5.3 · 在途图层叠加到线路图画布上的**几何**（WO-CONSOLE-CLEANUP · 纯函数）
// ══════════════════════════════════════════════════════════════════════════════

/** 一个矩形（`getBoundingClientRect` 的四个数，视口坐标）。 */
export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 叠加盒：把在途图层那张环 SVG 钉到线路图**舞台 SVG 的同一个盒子**上。
 *
 * ── 为什么钉舞台而不是钉画布 ───────────────────────────────────────────────────
 * 两张图的 `viewBox` 都是 `0 0 RING_LAYOUT.viewW RING_LAYOUT.viewH`
 * （`chainLineMap.ts` §5.1 单源，`transit-geometry` 那一单已经把坐标做成同源）。
 * SVG 把 viewBox 等比映到自己的边框盒 ⇒ **只要两个盒子逐像素重合，同一坐标就是同一屏点**，
 * 不需要在这里重算任何角度、半径或缩放 —— 这正是上一单交付语里那句
 * 「叠加时坐标即刻对得上，无需再改几何」的兑现方式。
 * 线路图舞台自己带 `translate/scale`（缩放平移），而 `getBoundingClientRect()` 返回的是
 * **变换之后**的屏上矩形，所以跟着舞台走即可，本函数不必知道 k/x/y 是多少。
 *
 * ── 裁切 ──────────────────────────────────────────────────────────────────────
 * 舞台盒子（980×680 起步）通常比画布可视区大，画布 `overflow:hidden` 只裁得住它自己的子树；
 * 叠加层是画布的**兄弟**，故必须自己按画布可视区裁（`clip-path: inset(...)`），
 * 否则放大/平移时环会溢出到整页。四个 inset 都相对叠加层自身的边框盒。
 *
 * `measured=false`（任一边为 0：jsdom / 未布局 / `display:none`）时界面**不假装已对齐**，
 * 照实标出来 —— 与线路图 `doFit` 那句「画布尺寸不可测 → 已复位」同一条纪律。
 */
export interface TransitOverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
  clipTop: number;
  clipRight: number;
  clipBottom: number;
  clipLeft: number;
  measured: boolean;
}

export function transitOverlayBox(stack: OverlayRect, stage: OverlayRect, canvas: OverlayRect): TransitOverlayBox {
  const left = stage.left - stack.left;
  const top = stage.top - stack.top;
  return {
    left,
    top,
    width: stage.width,
    height: stage.height,
    clipLeft: Math.max(0, canvas.left - stage.left),
    clipTop: Math.max(0, canvas.top - stage.top),
    clipRight: Math.max(0, stage.left + stage.width - (canvas.left + canvas.width)),
    clipBottom: Math.max(0, stage.top + stage.height - (canvas.top + canvas.height)),
    measured: stage.width > 0 && stage.height > 0 && canvas.width > 0 && canvas.height > 0,
  };
}

/** 两个叠加盒是否逐值相等（避免测量回调把同一个盒子反复写进 state 触发重渲）。 */
export function sameOverlayBox(a: TransitOverlayBox | null, b: TransitOverlayBox | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.clipTop === b.clipTop &&
    a.clipRight === b.clipRight &&
    a.clipBottom === b.clipBottom &&
    a.clipLeft === b.clipLeft &&
    a.measured === b.measured
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · 底部 Pareto（跨节点拉平 Top-N）—— 别处给不了的视角
// ══════════════════════════════════════════════════════════════════════════════

export interface ParetoRowVM {
  stepId: string;
  nodeId: string;
  nodeLabel: string;
  stepLabel: string;
  kind: ChainStepKind;
  kindLabel: string;
  nonValueDays: number;
  pctOfChainLoss: number;
}

export interface ParetoVM {
  rows: ParetoRowVM[];
  /** 展示的这 N 条一共吃掉多少（= Σ pct，引擎值加和，非重算）。 */
  topPct: number;
  /** 全链非增值总天数（引擎 `totals.nonValueDays`；载荷没给 → null，**不自己加一遍冒充**）。 */
  nonValueDays: number | null;
  /** 归因表一共几行（Top-N 之外还有多少条）。 */
  totalRows: number;
}

export const PARETO_TOP_N = 16;

/**
 * 载荷 → Pareto。行序 = `pctOfChainLoss` 降序 → stepId 字典序（R6 全序）。
 * 环节名/节点名由 `payload.nodes[]` 反查；查不到就诚实用 stepId（不编名字）。
 */
export function buildPareto(payload: ChainLossPayload, topN: number = PARETO_TOP_N): ParetoVM {
  const stepIndex = new Map<string, { node: ChainNode; step: ChainStep }>();
  for (const n of payload.nodes) for (const s of n.steps) stepIndex.set(s.stepId, { node: n, step: s });
  const rows: ParetoRowVM[] = payload.attribution
    .map((a) => {
      const hit = stepIndex.get(a.stepId);
      const kind: ChainStepKind = hit?.step.kind ?? "queue";
      return {
        stepId: a.stepId,
        nodeId: hit?.node.nodeId ?? a.stepId,
        nodeLabel: hit?.node.label ?? a.stepId,
        stepLabel: hit?.step.label ?? (hit === undefined ? a.stepId : STEP_KIND_LABEL[kind]),
        kind,
        kindLabel: STEP_KIND_LABEL[kind],
        nonValueDays: a.nonValueDays,
        pctOfChainLoss: a.pctOfChainLoss,
      };
    })
    .sort((a, b) => (b.pctOfChainLoss !== a.pctOfChainLoss ? b.pctOfChainLoss - a.pctOfChainLoss : a.stepId < b.stepId ? -1 : 1));
  const top = rows.slice(0, topN);
  return {
    rows: top,
    topPct: top.reduce((a, r) => a + r.pctOfChainLoss, 0),
    nonValueDays: payload.totals?.nonValueDays ?? null,
    totalRows: rows.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 7 · 格式化（显示层唯一出口，别处不许再写 toFixed）
// ══════════════════════════════════════════════════════════════════════════════

/** 天数。`null` → 「—」（**不显示 0**：0 天与算不出来是两回事）。 */
export function fmtDays(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** 百分比（入参已经是百分数，如 76.73）。 */
export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v < 1 && v > 0 ? v.toFixed(3) : v.toFixed(1)}%`;
}

/** 流动效率（入参是 **0–1 的分数**，与引擎 `totals.flowEfficiency` 同量纲）→ 百分数串。 */
export function fmtFlowEff(frac: number | null | undefined): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) return "—";
  return fmtPct(frac * 100);
}

// ══════════════════════════════════════════════════════════════════════════════
// § 8 · 阻滞点 → 决策推演的**那一跳**（WO-SANDBOX-IMP2PLAN）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 沙盘缺的那一跳：屏上点一条阻滞点（卡点 / 堵点 / 断点）→ 进决策推演页看方案对比。
 *
 * ── 两头都是真的，缺的只是中间那一跳 ──────────────────────────────────────────
 * **这头**：`chain_impediments` 真产出（demo 租户实测 15 条：BREAK 7 · CONGESTION 6 · BOTTLENECK 2）。
 * **那头**：`DecisionPlayView` 真取 `invokeSolver("decision_play")`，六维比对矩阵零写死。
 * **中间**：阻滞点锚在 `locus{objectType,objectId}`（真对象），决策推演锚在 `CausalFactor`
 *          —— 本体已登记的断点 `G-IMPEDIMENT-OPTION-NOJOIN`。
 *
 * ── 今天到底能不能对上：逐条追过，结论是**对不上**（不是"没去查"）──────────────
 * 三条可能的 join key 逐个查到取数处：
 *
 * ① **`evidence.ruleKey`（如 `C05` / `C06` / `C28`）** —— 规则库里的规则**对不到** `CausalFactor`。
 *    `RuleEntry` 与 `CausalFactor` 之间没有任何引用字段（阻滞点判据是「指标 vs 阈值」，
 *    因果因子是「下钻对象 vs 字段」，两套坐标系不共享键）。
 *
 * ② **`locus.{objectType,objectId}` ↔ `CausalFactor.{drillType,drillId}`** ——
 *    这一维**理论上共键**（都是「真对象类型 + 真对象 id」），但**实测撞不上**：
 *      · demo 15 条阻滞点的 locus 只有三类：`MaterialBalance`(7) · `MaterialBatch`(6) · `Line`(2)；
 *      · 合成种子 `battery-extended.ts` 的 `CAUSAL_FACTORS`（→ `synthetic/service.ts:785`
 *        `putAll("CausalFactor", ext.causalFactors, "factorId")` 落库，是**唯一**的 CausalFactor 写入口）
 *        共 18 种 `drillType`，其中 **`MaterialBatch` 与 `Line` 一条都没有** ⇒ 13/15 条当场出局；
 *      · 余下 `MaterialBalance` 只有 3 个因子承载（`cf-cathode-shortage`→mbal-2、
 *        `cf-demand-attain-gap`→mbal-2、`cf-material-short`→`DYNAMIC-MBAL` 运行期解析为
 *        `worstMbal.matBalId`），且 mbal-2 同时挂在**两个不同的 metricKey 链**上
 *        （`""` 与 `demand_attain`）—— 撞上了也定不下该进哪条链。
 *
 * ③ **`stage`** —— 粗，但**真能带**（本体 `G-IMPEDIMENT-LOSS-NOJOIN` 记的也是这一维）。
 *    故本层把 stage 带过去做粗筛，并当面说清它是段级精度、不是因子级。
 *
 * ── 为什么**不**猜一个 factorId 传过去（这一条是本单的要害）──────────────────
 * `decision_play` 拿到对不上的 `factorId` **不报错，而是静默回落**到贡献最大的默认根因
 * （`apps/datacore/src/solvers/service.ts:2882`：
 *  `(wantFactor ? [...].find(...) : undefined) ?? [...pool].sort(...)[0]`）。
 * 于是「猜一个」的代价不是"猜错了会报错"，而是**屏上出现一个看着确凿、实则与这条阻滞点无关的根因**
 * ——正是本仓明令禁止的那种"看着合理的编造"。故 `status !== "JOINED"` 时**一个 factorId 都不传**。
 *
 * ── 会红的断言（逼着把诚实位换成真跳转）────────────────────────────────────────
 * 本函数**不写死** "今天对不上"：它照常去载荷里探因子维（`factorRefOf`）。
 * 等引擎侧（WO-SANDBOX-S3）在 `ChainImpedimentSchema` 上补出因子维那天，
 * `factorRefOf` 当场返回真 id、`status` 翻成 `JOINED`，而门里那条
 * 「今天 demo 全量 15 条 status 恒为 NO_FACTOR_DIMENSION」的断言**当场红**。
 */
export const IMPEDIMENT_JOIN_STATUSES = ["JOINED", "NO_FACTOR_DIMENSION"] as const;
export type ImpedimentJoinStatus = (typeof IMPEDIMENT_JOIN_STATUSES)[number];

/** 决策推演页的目标路由（单一出处；测试与视图都从这里取，不许各写一遍字符串）。 */
export const DECISION_PLAY_PATH = "/v/decision-play";

/**
 * 从一条阻滞点载荷里探"因果因子维"。
 *
 * **今天恒为 `null`** —— 但这不是写死的 `return null`，是真去载荷里找：
 * contracts `ChainImpedimentSchema` 是 `z.strictObject`，15 个键逐个核过
 * （impedimentId / tenantId / scanId / kind / breakSubtype / stage / scope / nodeId / stepId /
 *  locus / severity / evidence / dataMode / manifestations / rootCauseImpedimentId）
 * **无一是 CausalFactor 维度**，且 strictObject 语义下引擎多给一个键会**当场抛**（不是被 strip 掉）
 * ⇒ 因子维只能等契约先开口子。开了口子之后本函数**一行都不用改**，值自动流出来。
 */
export function factorRefOf(im: ImpedimentVM): string | null {
  const probe = im as unknown as {
    factorId?: unknown;
    causalFactorId?: unknown;
    factorRef?: unknown;
    locus?: { factorId?: unknown };
    evidence?: { factorId?: unknown; causalFactorRef?: unknown };
  };
  const cands = [
    probe.factorId,
    probe.causalFactorId,
    probe.factorRef,
    probe.locus?.factorId,
    probe.evidence?.factorId,
    probe.evidence?.causalFactorRef,
  ];
  for (const c of cands) if (typeof c === "string" && c.length > 0) return c;
  return null;
}

/** 一条阻滞点跳去决策推演所携带的全部东西（**含带不过去的那一维的病因**）。 */
export interface ImpedimentHandoff {
  /** 目标 URL（`DECISION_PLAY_PATH` + query）。视图 `navigate(href)`，门断言 `href`。 */
  href: string;
  /** 逐键可断言的 query（门咬的是这个，不是任意字符串）。 */
  params: Record<string, string>;
  join: {
    status: ImpedimentJoinStatus;
    /** 真带过去的维（今天只有 stage；接通后加 factorId）。 */
    carried: string[];
    /** 带不过去的那一维（接通后为 `null`）。 */
    missing: string | null;
    /** 病因**原文**：屏上原样显示，不许概括成"暂不支持"。 */
    reason: string;
  };
  /**
   * 诚实位随行（③）：`dataMode !== "LIVE"` 的阻滞点跳过去时把限定**带上**。
   * PARTIAL 的 detail 是引擎 `caveats[]` 原文（`honestyOf`），前端一个字不改写。
   */
  caveat: { mode: string; claim: string; detail: string | null } | null;
}

/** 病因文案（单一出处；视图与门都读这里，两处各写一遍必漂）。 */
export const IMPEDIMENT_JOIN_REASON: Record<ImpedimentJoinStatus, string> = {
  JOINED: "引擎载荷已带因果因子维，本次按因子精确跳转。",
  NO_FACTOR_DIMENSION:
    "本次未能把这个阻滞点对到具体因子。原因：阻滞点锚在真对象 locus{objectType,objectId} 上，" +
    "决策推演锚在 CausalFactor 上，而今天引擎回包里没有任何承载因果因子的字段" +
    "（contracts ChainImpedimentSchema 是 strictObject，15 个键逐个核过，无 factorId / factorRef，locus 里也没有）。" +
    "前端手里唯一可能的对法是拿 locus{objectType,objectId} 去撞 CausalFactor{drillType,drillId}——实测撞不上：" +
    "demo 的 locus 只有 MaterialBalance / MaterialBatch / Line 三类，而合成种子里带 drillType=MaterialBatch 或 Line 的因子一条都没有；" +
    '余下 MaterialBalance 也只有 mbal-2 有因子承载，且它同时挂在 metricKey="" 与 demand_attain 两条链上、定不下进哪条。' +
    "更要命的是 decision_play 拿到对不上的 factorId 会静默回落到贡献最大的默认根因（solvers/service.ts:2882），" +
    "屏上会出现一个看着确凿、实则与这条阻滞点无关的根因。故本次不猜 factorId，只把 stage 带过去做粗筛（段级精度，不是因子级）。",
};

/** query 参数键（单一出处；视图写、决策推演页读、门断言，三处同源）。 */
export const IMP_PARAM = {
  from: "fromImpediment",
  stage: "impStage",
  kind: "impKind",
  rule: "impRule",
  locusType: "impLocusType",
  locusId: "impLocusId",
  locusLabel: "impLocusLabel",
  mode: "impMode",
  join: "impJoin",
  factor: "factorId",
} as const;

/**
 * 把一条阻滞点翻成「跳去决策推演」的全部入参。**纯函数**（无 `Date.now`、无随机），R6。
 *
 * 关键判据（门咬这两条）：
 *  · `status === "JOINED"` ⟺ `params.factorId` 存在。**没对上就一个 factorId 都不传** ——
 *    传了 = 让 `decision_play` 静默回落成"看着合理的编造"（见 §8 抬头）。
 *  · `dataMode !== "LIVE"` ⇒ `caveat` 非空且随 query 带走（诚实位不许在跳转时掉）。
 */
export function deriveImpedimentHandoff(im: ImpedimentVM): ImpedimentHandoff {
  const factorRef = factorRefOf(im);
  const status: ImpedimentJoinStatus = factorRef === null ? "NO_FACTOR_DIMENSION" : "JOINED";

  const params: Record<string, string> = {
    [IMP_PARAM.from]: im.impedimentId,
    [IMP_PARAM.kind]: im.kind,
    [IMP_PARAM.stage]: im.stage,
    [IMP_PARAM.locusType]: im.locus.objectType,
    [IMP_PARAM.locusId]: im.locus.objectId,
    [IMP_PARAM.locusLabel]: im.locus.label,
    [IMP_PARAM.mode]: im.honesty.mode,
    [IMP_PARAM.join]: status,
  };
  if (im.evidence.ruleKey !== null) params[IMP_PARAM.rule] = im.evidence.ruleKey;
  // ⚠ 只有真对上了才传 factorId。对不上就不传 —— 猜一个会被引擎静默回落。
  if (factorRef !== null) params[IMP_PARAM.factor] = factorRef;

  const qs = new URLSearchParams(params).toString();
  return {
    href: `${DECISION_PLAY_PATH}?${qs}`,
    params,
    join: {
      status,
      carried: factorRef === null ? ["stage"] : ["stage", "factorId"],
      missing: factorRef === null ? "factorId（CausalFactor 维）" : null,
      reason: IMPEDIMENT_JOIN_REASON[status],
    },
    caveat:
      im.honesty.mode === "LIVE"
        ? null
        : { mode: im.honesty.mode, claim: im.honesty.claim, detail: im.honesty.detail },
  };
}

/** 全量阻滞点的跳转清单（视图渲染阻滞点条用；顺序 = 引擎冻结全序，本层不重排）。 */
export function impedimentHandoffs(
  model: ChainImpedimentModel | null,
  kind: ChainImpedimentKind | null,
): { im: ImpedimentVM; handoff: ImpedimentHandoff }[] {
  if (model === null) return [];
  const groups = kind === null ? model.groups : model.groups.filter((g) => g.kind === kind);
  return groups.flatMap((g) => g.items).map((im) => ({ im, handoff: deriveImpedimentHandoff(im) }));
}
