/**
 * 传导核（增量 3 · SPEC docs/SPEC-sandbox-propagation-and-session.md §1）。
 *
 * 一支**不认识任何行业的纯函数**：只吃抽象 (typeKey, stateVar, linkKey) + 数值系数/延迟，
 * 喂任意租户本体即跑（R14 零业务常数）。同 (graph, state, rules, pending, tick) → 同输出（R6 确定性）。
 *
 * 复用而非重写：
 *  - 链路导航 = recompute 的 navIn/navOut 思路（ontology-core.ts:~374 用 "linkKey|id" 索引）；
 *    source─link→target 边 = link.fromId 是 source 对象、link.toId 是 target 对象。
 *  - 衰减公式 = risk.ts:197 amp x (1 - dist/den)（这里 dist 与 window 比，<=window 才生效）。
 *
 * 三条铁规：
 *  - R14 零业务常数：本文件不得出现任何行业实体名 / 内联业务阈值。系数全部来自 PropagationRule 字段
 *    或其引用的 rule.params（外部传入 ruleParams 查找表）。
 *  - R6 确定性：所有遍历对 id / key 稳定排序；不调 Date.now / Math.random；浮点固定精度（round12）。
 *  - Temporal Trust（§1.3-6）：tick t 只读 <=t 的 state + pending；延迟贡献只落 arriveTick > 当前 tick，
 *    绝不读未来 tick 态。
 */
import {
  applyPerturbationToState,
  expectedCadenceWaitDays,
  isPerturbationActiveAt,
  type Cadence,
  type DelayedContribution,
  type Perturbation,
  type PropagationRule,
  type PropagationTrace,
  type ResolvedSimScope,
  type TickState,
} from "@platform/contracts";

/** 传导图（抽象：仅对象 id+typeKey、链路 from/to+linkKey，零行业列）。 */
export interface PropagationGraph {
  objects: { id: string; typeKey: string }[];
  links: { fromId: string; toId: string; linkKey: string }[];
}

// ══════════════════════════════════════════════════════════════════════════
// § 推演范围裁剪（WO-SIM-SCOPE-TRIAL · 关闭欠账 #129/#130 `G-SIM-SCOPE-UNREAD`）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一次范围裁剪的**诚实回执**：这次推演到底算了哪些对象/边、丢了多少、以及（若有）为什么范围拿不到。
 * 随 tick 响应下发 —— R-ARG-FIDELITY：结果必须回带自己是在什么范围下算出来的，
 * 不许让用户从一个安静的数字里去猜筛选有没有生效。
 */
export interface ScopeReport {
  kind: "GLOBAL" | "LOCAL";
  target: string | null;
  hops: number;
  /** 裁剪后参与传导的对象数 / 边数。 */
  objects: number;
  links: number;
  /** 被裁掉的对象数 / 边数（GLOBAL 恒 0）。 */
  droppedObjects: number;
  droppedLinks: number;
  /** 非空 = 范围拿不到 ⇒ 本次传导图为空。绝不因此退回 GLOBAL。 */
  unresolved: string | null;
}

export interface ScopedPropagationGraph {
  graph: PropagationGraph;
  report: ScopeReport;
}

/**
 * 按会话范围裁出传导子图。**纯函数**（R6：同 (graph, scope) → 同输出，零时钟零随机）。
 *
 * 语义（一句话）：**LOCAL = 以 `target` 类型的全部已物化对象为根、沿链路无向展开 `hops` 跳，
 * 只保留两端都在范围内的边**。
 *
 * 三个判据，逐条写明理由（都踩过坑，别按"看着更简洁"改）：
 *
 * 1. **GLOBAL 原样返回同一引用**，不 copy、不重排。这样"没选范围的租户"逐字节维持旧行为
 *    （RL9 additive 可回退）；用 `===` 就能验，不必比内容。
 * 2. **边要求两端都在范围内**（不是"任一端"）。留一条只有一端在范围内的边，会让贡献写到
 *    范围外的对象上 —— 用户说"只推演这块"，结果范围外的数被改了，那是另一种静默错答。
 * 3. **展开无向**（`fromId`/`toId` 两个方向都走）。传导规则的方向是 `PropagationRule` 定的
 *    （`propagateTick` 的 `navOut` 只沿 `fromId→toId`），范围是"哪些对象在这块世界里"的问题，
 *    与流向无关。只沿出边展开会把"上游供给我的那些对象"整批排除在外，那不是局部世界，是半条尾巴。
 *
 * 诚实缺席（照 `unresolvedGates` 的既有范式）：
 *  · scope 自称 LOCAL 却没有根 ⇒ `report.unresolved` 写明，**图裁成空**；
 *  · 根类型在本租户**一个已物化对象都没有** ⇒ 同样报缺、图裁成空。
 * 两种都**绝不**退回 GLOBAL —— 「我算不出局部」和「局部等于全局」是两个命题。
 */
export function scopePropagationGraph(graph: PropagationGraph, scope: ResolvedSimScope): ScopedPropagationGraph {
  if (scope.kind === "GLOBAL") {
    return {
      graph, // 判据 1：同一引用返回，`===` 即可验"GLOBAL 逐字节同旧"
      report: {
        kind: "GLOBAL", target: null, hops: scope.hops,
        objects: graph.objects.length, links: graph.links.length,
        droppedObjects: 0, droppedLinks: 0, unresolved: null,
      },
    };
  }

  const empty = (unresolved: string): ScopedPropagationGraph => ({
    graph: { objects: [], links: [] },
    report: {
      kind: "LOCAL", target: scope.target, hops: scope.hops,
      objects: 0, links: 0,
      droppedObjects: graph.objects.length, droppedLinks: graph.links.length,
      unresolved,
    },
  });
  if (scope.unresolved !== null) return empty(scope.unresolved);

  const roots = graph.objects.filter((o) => o.typeKey === scope.target).map((o) => o.id);
  if (roots.length === 0) {
    return empty(
      `会话范围 LOCAL(${scope.target}) 在本租户没有任何已物化对象 ⇒ 裁不出子图。` +
      `本次推演不按全域跑——「我算不出局部」与「局部等于全局」是两个命题。`,
    );
  }

  // 无向邻接（判据 3）。id 排序保证遍历确定（R6）。
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  for (const l of graph.links) { link(l.fromId, l.toId); link(l.toId, l.fromId); }
  for (const [, v] of adj) v.sort((a, b) => a.localeCompare(b));

  const inScope = new Set<string>(roots);
  let frontier = [...roots].sort((a, b) => a.localeCompare(b));
  for (let h = 0; h < scope.hops && frontier.length > 0; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (inScope.has(nb)) continue;
        inScope.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }

  // filter 保留输入序 ⇒ 与 GLOBAL 同一份遍历序（R6：裁剪不引入新的顺序来源）。
  const objects = graph.objects.filter((o) => inScope.has(o.id));
  const links = graph.links.filter((l) => inScope.has(l.fromId) && inScope.has(l.toId));
  return {
    graph: { objects, links },
    report: {
      kind: "LOCAL", target: scope.target, hops: scope.hops,
      objects: objects.length, links: links.length,
      droppedObjects: graph.objects.length - objects.length,
      droppedLinks: graph.links.length - links.length,
      unresolved: null,
    },
  };
}

/**
 * 本次 Trial Tick / tick 里**真正产出过贡献**的传导规则 key（去重、排序）。
 *
 * 判据是**效果**不是**调用**：一条规则"被遍历到"不算触发，得真落下一条即时贡献（`trace`）
 * 或真排进延迟队列（新增 `pending`）才算。这正是「函数被调用了不算数」那条验收判据的落点。
 * 排除两类非传导行：扰动落地/回退行（`ruleKey` 带前缀）、以及**上一轮**延迟到达行（`viaLinkKey === "(pending)"`，
 * 那是历史贡献结算，不是本 tick 有规则触发）。
 */
export function firedPropagationRuleKeys(
  trace: readonly PropagationTrace[],
  newPending: readonly DelayedContribution[],
): string[] {
  const keys = new Set<string>();
  for (const t of trace) {
    if (t.viaLinkKey === "(pending)") continue;
    if (t.ruleKey.startsWith(PERTURBATION_TRACE_PREFIX)) continue;
    if (t.ruleKey.startsWith(PERTURBATION_REVERT_TRACE_PREFIX)) continue;
    if (t.ruleKey.startsWith(PERTURBATION_REVERT_UNRESOLVED_PREFIX)) continue;
    keys.add(t.ruleKey);
  }
  for (const p of newPending) keys.add(p.ruleKey);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

// ══════════════════════════════════════════════════════════════════════════
// § 节拍闸门（WO-SANDBOX-E4）—— 「到点才放行」，不是「固定等一段」
// ══════════════════════════════════════════════════════════════════════════

/**
 * 引擎侧节拍闸门。**以 tick 计**（引擎的时间单位），零业务语义：一个周期 + 一个相位。
 *
 * 与契约 `Cadence`（以**天**计）的关系：本引擎一 tick = 一天
 * （既有事实，非本单新立：D1 的 SEAM-3 就是把 `everyDays/2` 天数直接塞进 `delayTicks`
 *  —— `apps/datacore/test/sandbox-d1-cadence.test.ts` "SEAM-3 值驱动引擎"）。
 * 换算唯一出口 = `cadenceGate()`，任何地方不许再写第二支天→tick 的换算。
 */
export interface CadenceGate {
  /** 周期（tick）。正整数 —— 见 `cadenceGate()` 的诚实拒绝。 */
  everyTicks: number;
  /** 相位（tick）：周期内第几个 tick 开闸，∈ [0, everyTicks)。 */
  offsetTicks: number;
}

/** `Cadence.nodeId` → 闸门。键取 `PropagationRule.cadenceNodeId` 的取值域（`CHAIN_NODE_REGISTRY` 单源）。 */
export type CadenceGateLookup = Record<string, CadenceGate>;

/** 一条声明了闸门却拿不到闸门的流（诚实缺席出口，照 E3 `unresolved[]` 的范式）。 */
export interface UnresolvedCadenceGate {
  ruleKey: string;
  cadenceNodeId: string;
  /** 机器可读原因：闸门表里根本没有这个节点。 */
  reason: "NO_GATE";
  /** 说人话：为什么这条流本 tick 不传导。 */
  detail: string;
}

/**
 * 契约 `Cadence`（天）→ 引擎 `CadenceGate`（tick）。**不可整 tick 表示时返回 `null`**（诚实拒绝，不取整）。
 *
 * 为什么不 round：D1 的 SEAM-4 已经把这条边界摆在桌上了——
 * `capacity.schedule` 的等待期望是 0.5 天，在「一 tick = 一天」的引擎上**不可整表示**，
 * D1 明确写了「留给 E4，不在此偷偷取整」。取整就是给用户一个看着合理的假前置期，
 * 这正是本仓「禁止静默兜底」要根治的病。故：周期不是正整数 tick ⇒ 造不出闸门 ⇒ 调用方必须诚实处理。
 *
 * 注：`everyTicks === 1`（如日批）是**合法**闸门，只是在日 tick 引擎上它每个 tick 都开
 *     ⇒ 等待恒 0 tick。这是分辨率的真实结论（日批在日粒度上就是随到随办），不是兜底。
 */
export function cadenceGate(cadence: Pick<Cadence, "everyDays" | "offsetDays">): CadenceGate | null {
  const everyTicks = cadence.everyDays;
  if (!Number.isInteger(everyTicks) || everyTicks <= 0) return null;
  const offsetRaw = cadence.offsetDays ?? 0;
  if (!Number.isInteger(offsetRaw) || offsetRaw < 0 || offsetRaw >= everyTicks) return null;
  return { everyTicks, offsetTicks: offsetRaw };
}

/**
 * 本 tick 之后（含本 tick）**下一次开闸**的 tick。纯函数（R6）。
 *
 * 判据：`g >= tick` 且 `(g − offsetTicks) mod everyTicks === 0`。
 *
 * ★ 「到点才放行」与「固定等一段」的分野就在这一行 ★
 * 固定时长（`tick + everyTicks/2`）下，每个 tick 产生的量各自延后同样多 ⇒ **一个周期内每 tick 都有到达**；
 * 到点放行下，一个周期内产生的量**全部落在同一个 tick** ⇒ 这就是批量释放现象。
 * 两者的**期望等待相同**（见 `cadenceGateWaitTicks` 注释），但下游看到的形状完全不同——
 * 沙盘要演的正是这个形状（排队堆积→到点齐放），E4 的变异反证咬的就是它。
 */
export function nextGateTick(tick: number, gate: CadenceGate): number {
  const phase = ((tick - gate.offsetTicks) % gate.everyTicks + gate.everyTicks) % gate.everyTicks;
  return phase === 0 ? tick : tick + (gate.everyTicks - phase);
}

/**
 * 闸门在**一个完整周期**上的平均等待（tick）—— 引擎侧的量化真值 = `(everyTicks − 1) / 2`。
 *
 * ⚠ **诚实登记一处半 tick 量化差，别拿它糊弄自己**：
 * 契约 `expectedCadenceWaitDays = everyDays / 2`（`chain-sim.ts` §2）是**连续时间**下的期望
 * （到达时刻在周期内均匀分布）；引擎只有整 tick，到达时刻被钉在 tick 边界上，
 * 一个周期内的等待恰好取遍 `{0, 1, …, everyTicks−1}` ⇒ 均值 `(everyTicks−1)/2`。
 * 二者恒差 **0.5 tick**（`cadenceQuantizationGapTicks()` 咬死这是个**常数**、不是随周期漂的偏差），
 * 因此**任意两个节拍之间的差恒为 `Δ(everyDays)/2`** —— 这正是 E4 SEAM 判据要的那条不变量。
 * 这里绝不把 `(everyTicks−1)/2` 写成 `everyTicks/2` 去凑契约：那是拿一个算不出来的数冒充算得出来。
 */
export function cadenceGateWaitTicks(gate: CadenceGate): number {
  return (gate.everyTicks - 1) / 2;
}

/** 量化差 = 契约连续期望 − 引擎离散期望。**恒 0.5**（常数，不随周期漂）—— 由测试咬死。 */
export function cadenceQuantizationGapTicks(cadence: Pick<Cadence, "everyDays">, gate: CadenceGate): number {
  return expectedCadenceWaitDays(cadence) - cadenceGateWaitTicks(gate);
}

/**
 * 一组 `(nodeId, Cadence | undefined)` → 闸门表 + **拿不到闸门的诚实清单**。
 *
 * `cadence === undefined`（D1 标 EMPTY 的行）与「周期不可整 tick 表示」都进 `skipped[]`，
 * **绝不**在表里塞一个占位闸门 —— 塞了下游就分不清「不用等」与「不知道要等多久」。
 */
export function buildCadenceGates(
  rows: readonly { nodeId: string; cadence: Cadence | undefined }[],
): { gates: CadenceGateLookup; skipped: { nodeId: string; reason: "EMPTY" | "NOT_INTEGER_TICKS" }[] } {
  const gates: CadenceGateLookup = {};
  const skipped: { nodeId: string; reason: "EMPTY" | "NOT_INTEGER_TICKS" }[] = [];
  for (const r of [...rows].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
    if (r.cadence === undefined) {
      skipped.push({ nodeId: r.nodeId, reason: "EMPTY" });
      continue;
    }
    const g = cadenceGate(r.cadence);
    if (g === null) {
      skipped.push({ nodeId: r.nodeId, reason: "NOT_INTEGER_TICKS" });
      continue;
    }
    gates[r.nodeId] = g;
  }
  return { gates, skipped };
}

/** 规则参数查找表（ruleKey -> params）。用于解析 coefficientRef（G-10 P1「改规则即改推演」）。
 * A3-SUITE-1：params 值已放宽为 number|string|string[]，此处按 unknown 接收，
 * coefficientRef 路径仍只读数值。 */
export type RuleParamLookup = Record<string, Record<string, unknown>>;

/** 浮点固定精度（避免遍历序导致的尾差，R6 字节一致）。 */
const PRECISION = 1e12;
function round12(n: number): number {
  // 规整 -0 -> 0，避免 toEqual 边角。
  const r = Math.round(n * PRECISION) / PRECISION;
  return Object.is(r, -0) ? 0 : r;
}

/** 深拷贝 TickState（纯结构、无类方法），起步用全量快照（图小，简单确定）。 */
function cloneState(state: TickState): TickState {
  const out: TickState = {};
  for (const objId of Object.keys(state)) {
    const vars = state[objId] ?? {};
    const copy: Record<string, number> = {};
    for (const v of Object.keys(vars)) copy[v] = vars[v] ?? 0;
    out[objId] = copy;
  }
  return out;
}

/**
 * 解析一条规则的有效系数：coefficientRef 优先（读 ruleParams[ruleKey][paramKey]），
 * 空 / 未命中则退回内联 coefficient（冷启动）。**禁内联业务常数（RL5）**——两条路都来自配置。
 */
function effectiveCoefficient(rule: PropagationRule, ruleParams: RuleParamLookup): number {
  const ref = rule.coefficientRef;
  if (ref) {
    const params = ruleParams[ref.ruleKey];
    const v = params?.[ref.paramKey];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return rule.coefficient;
}

// ══════════════════════════════════════════════════════════════════════════
// § 扰动相位（WO-P2 · PRD-UPGRADE-decision-sandbox-v2 §3.1.3）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条交给引擎处理的扰动 = 契约 `Perturbation` + 调用方查得的「**落地前值**」。
 *
 * `preValue` 只在 **`set`（以及 `scale` 且 `magnitude === 0`）到期回退**时用得上 ——
 * 这两种模式**不可解析求逆**（`set` 抹掉了原值；乘 0 不可逆），非记不可；
 * `delta` / `scale(magnitude≠0)` 的逆是解析的（减 / 除），**不需要记忆**，
 * 因而也不会把「回退」退化成「把这几 tick 的演化一并抹掉」。
 *
 * ⚠ **为什么 `preValue` 由调用方给，而不是照 PRD 原文「记于生效当 tick 的 trace」**：
 * WO-P0 的 `POST /perturbations`（`app.ts:1542`）对**建单时已生效**的扰动是
 * **在路由里直接施加**的（`simApplyAtCurrentTick`），那条路**原样保留旧 trace、不写新 trace**
 * ⇒ trace 里根本不会出现这条扰动的 preValue，而它恰是最常走的一条路
 * （`startTick` 缺省 = 当前 tick）。换言之「记于 trace」在今天的接线下**恒缺**。
 * 改由调用方从**世界线快照**取（`state@(startTick-1)`）：路由施加 / 引擎施加两条路都成立，
 * 且与引擎自己施加时读到的**是同一个数**（enter 发生在 `producedTick === startTick`，
 * 其输入态正是 `state@(startTick-1)`）—— 单源、可复算、跨请求不丢。
 * 引擎仍把 preValue 写进 trace（`(perturbation.before)` 行），溯源需求照样满足。
 */
export interface PerturbationInTick extends Perturbation {
  /** 该扰动落地前、目标 stateVar 在这条世界线上最后一个未被它污染的值。缺 = 引擎不许猜。 */
  preValue?: number;
}

/** 扰动落地在 `trace.ruleKey` 上的前缀（前端据此把它与传导边分开渲染）。 */
export const PERTURBATION_TRACE_PREFIX = "perturbation:";
/** 扰动到期回退。 */
export const PERTURBATION_REVERT_TRACE_PREFIX = "perturbation-revert:";
/** 到期了、却**拿不到可用的回退值** —— 诚实报缺，照 `unresolvedGates` 的范式，绝不静默乱猜一个数。 */
export const PERTURBATION_REVERT_UNRESOLVED_PREFIX = "perturbation-revert-unresolved:";
/** trace 行的 `fromObjectId`：施加前 / 施加后（两行成对，preValue 即 before 行的 amount）。 */
const TRACE_FROM_BEFORE = "(perturbation.before)";
const TRACE_FROM_AFTER = "(perturbation.after)";

function readVar(state: TickState, objectId: string, stateVar: string): number {
  const v = state[objectId]?.[stateVar];
  return typeof v === "number" ? v : 0;
}

/**
 * 「**本 tick 首次生效**」判据 —— 用契约的 `isPerturbationActiveAt` 表达，**不另写一套**
 * （PRD §3.1.3：生效判据单源）。等价于 `p.startTick === atTick`。
 */
function entersAt(p: Perturbation, atTick: number): boolean {
  return isPerturbationActiveAt(p, atTick) && !isPerturbationActiveAt(p, atTick - 1);
}

/** 「**本 tick 到期**」判据（同上单源）。等价于 `durationTicks !== null && startTick + durationTicks === atTick`。 */
function exitsAt(p: Perturbation, atTick: number): boolean {
  return !isPerturbationActiveAt(p, atTick) && isPerturbationActiveAt(p, atTick - 1);
}

/**
 * 到期回退值 = 「若无此扰动，本应有的值」。
 * `null` = **算不出来**（`set`/`scale(0)` 且调用方没给 preValue）—— 调用方必须看见这个缺，
 * 不许在这里编一个 0 或原样留着（留着 = 把「限时停机」悄悄变成「永久停机」）。
 */
function revertValue(p: PerturbationInTick, current: number): number | null {
  if (p.mode === "delta") return current - p.magnitude;
  if (p.mode === "scale" && p.magnitude !== 0) return current / p.magnitude;
  return p.preValue ?? null; // set / scale(0)：只能靠记下来的落地前值
}

/**
 * 累加一条贡献到 next（按 combine 语义 sum/max）。amount 已含系数 x 源态 x 衰减。
 * touched 记录本 tick 已触达的 (obj,var)：max 首条以贡献为基，之后取 max；sum 在既有值上加。
 */
function applyContribution(
  next: TickState,
  targetObjectId: string,
  targetStateVar: string,
  amount: number,
  combine: "sum" | "max",
  touched: Map<string, Set<string>>,
): void {
  const bucket = (next[targetObjectId] ??= {});
  const seen = touched.get(targetObjectId) ?? touched.set(targetObjectId, new Set()).get(targetObjectId)!;
  const first = !seen.has(targetStateVar);
  const cur = bucket[targetStateVar] ?? 0;
  if (combine === "max") {
    bucket[targetStateVar] = first ? amount : Math.max(cur, amount);
  } else {
    bucket[targetStateVar] = cur + amount;
  }
  seen.add(targetStateVar);
}

/**
 * 一个 tick 的传导（§1.3）。
 *
 * @param graph    已物化对象 + 链路（从本体库读，任意行业）
 * @param state    当前 tick（t）的世界态（只读，不被改）
 * @param rules    PropagationRule[]（调用方应只传 PUBLISHED）
 * @param pending  延迟贡献队列（resume 确定性来源）
 * @param tick     当前 tick t（结算 arriveTick===t 的 pending；新延迟落 arriveTick>t）
 * @param ruleParams 可选规则参数查找表，解析 coefficientRef（"改规则即改推演"）
 * @param gates    可选节拍闸门表（`Cadence.nodeId` → 闸门，WO-SANDBOX-E4）。规则声明了
 *                 `cadenceNodeId` 时，本 tick 产生的量**排到下一次开闸**才放行（到点才办）；
 *                 表里查不到 ⇒ 该流不传导并进 `unresolvedGates`（不当作随到随办、不补默认周期）。
 * @param perturbations 本 tick **相关**的扰动（WO-P2 · PRD §3.1.3）。调用方按
 *                 `isPerturbationActiveAt` 收窄（生效判据在调用方算），并按
 *                 `listPerturbations` 的顺序（`startTick↑ → 建单先后`）传入 ——
 *                 **顺序即语义**：`delta`/`scale` 不可交换（`(10+2)×1.5=18 ≠ 10×1.5+2=17`，
 *                 `repo.ts:368`），本函数**绝不重排**。多传无关的扰动是 no-op（见下 enter/exit 判据），
 *                 少传「本 tick 到期的那条」则回退不会发生 —— 故调用方须把**刚到期**的也一并传入。
 * @returns next（t+1 态）/ pending（去掉已结算、含新延迟）/ trace（本 tick 即时贡献轨迹 + 扰动落地/回退行）
 *          / unresolvedGates（声明了闸门却拿不到闸门的流）
 *          / appliedPerturbations（本 tick **处于生效期**的扰动 id，输入序 —— 溯源：这个结果是哪几次扰动造成的）
 */
export function propagateTick(
  graph: PropagationGraph,
  state: TickState,
  rules: PropagationRule[],
  pending: DelayedContribution[],
  tick: number,
  ruleParams: RuleParamLookup = {},
  gates: CadenceGateLookup = {},
  perturbations: readonly PerturbationInTick[] = [],
): {
  next: TickState;
  pending: DelayedContribution[];
  trace: PropagationTrace[];
  unresolvedGates: UnresolvedCadenceGate[];
  appliedPerturbations: string[];
} {
  // ── 0') 扰动相位（WO-P2）：先把本 tick 的「到期回退 / 首次落地」作用到世界，再传导 ──
  //
  // 🔴 时基：`next` 由调用方存到 **tick+1**（`app.ts` 循环 `s.curTick += 1` 后 `putTickState`），
  //    所以本函数产出的是 **producedTick = tick + 1** 那一格的世界态，扰动的生效期必须按它算。
  //    ⚠ 这一格错开一位就会同时炸两头（两条都是实测踩过的形态）：
  //      · 按 `tick` 算 ⇒ 建单当 tick 已被路由施加过一次（`app.ts:1542`）的 `delta` 会在
  //        第一次 tick 时**再加一遍**（+2 变 +4）；
  //      · 为躲上面那条而"在 startTick 一律跳过" ⇒ **未来才起效**的扰动（建单时未生效、路由没施加）
  //        在它真正的 startTick 被跳过、又在之后每 tick 反复施加 ⇒ delta 无限累积。
  //    按 producedTick 算，两种来路自动各归其位：路由施加的那条 enter 在 `startTick`（引擎看不到，
  //    正好不重复）；未来起效的那条 enter 落在 `producedTick === startTick`（引擎施加，正好一次）。
  //
  // 「一次性施加 + 到期反向施加」而不是「每 tick 重新施加」：后者对 `delta`/`scale` 会逐 tick 复利，
  //    与 `label` 说的「涨价 15%」「加 200 台」不是一回事。
  const producedTick = tick + 1;
  const perturbationTrace: PropagationTrace[] = [];
  const appliedPerturbations: string[] = [];
  let effState = state; // 未被扰动改动时**保持同一引用**（无扰动 ⇒ 与本相位引入前逐字节相同·可回退）
  const writePerturbed = (p: PerturbationInTick, value: number, ruleKey: string, before: number): void => {
    const bucket = (effState[p.targetObjectId] ??= {});
    bucket[p.targetStateVar] = round12(value);
    perturbationTrace.push(
      { ruleKey, fromObjectId: TRACE_FROM_BEFORE, toObjectId: p.targetObjectId, amount: round12(before), viaLinkKey: p.targetStateVar },
      { ruleKey, fromObjectId: TRACE_FROM_AFTER, toObjectId: p.targetObjectId, amount: round12(value), viaLinkKey: p.targetStateVar },
    );
  };
  if (perturbations.length > 0) {
    // ① 先收尾**到期**的（逆输入序 = LIFO 反向解开叠加：`(v+2)×1.5` 要先除 1.5 再减 2）。
    for (let i = perturbations.length - 1; i >= 0; i--) {
      const p = perturbations[i]!;
      if (!exitsAt(p, producedTick)) continue;
      if (effState === state) effState = cloneState(state);
      const cur = readVar(effState, p.targetObjectId, p.targetStateVar);
      const restored = revertValue(p, cur);
      if (restored === null) {
        // 诚实缺席：算不出「若无此扰动本应有的值」就**不动这个数**，并把缺口亮在 trace 里，
        // 而不是留一个看着正常、其实已经永久生效的世界（那正是"绿测试≠能用"的形态）。
        perturbationTrace.push({
          ruleKey: `${PERTURBATION_REVERT_UNRESOLVED_PREFIX}${p.id}`,
          fromObjectId: TRACE_FROM_BEFORE, toObjectId: p.targetObjectId, amount: round12(cur), viaLinkKey: p.targetStateVar,
        });
        continue;
      }
      writePerturbed(p, restored, `${PERTURBATION_REVERT_TRACE_PREFIX}${p.id}`, cur);
    }
    // ② 再落地**首次生效**的（输入序 = `listPerturbations` 序 = 建单先后，顺序即语义）。
    //    施加走契约唯一实现 `applyPerturbationToState`（与 `/act`、`POST /perturbations` 同一支）。
    for (const p of perturbations) {
      if (!entersAt(p, producedTick)) continue;
      const before = readVar(effState, p.targetObjectId, p.targetStateVar);
      effState = applyPerturbationToState(effState, p); // 纯函数：返回新对象，入参不改
      writePerturbed(p, readVar(effState, p.targetObjectId, p.targetStateVar), `${PERTURBATION_TRACE_PREFIX}${p.id}`, before);
    }
    // ③ 溯源：本 tick 处于生效期的全部扰动（含早先落地、仍在持续的；**不含**本 tick 刚到期的）。
    for (const p of perturbations) if (isPerturbationActiveAt(p, producedTick)) appliedPerturbations.push(p.id);
  }

  const next = cloneState(effState);
  const touched = new Map<string, Set<string>>(); // objId -> stateVars 已触达（区分 max 首条 + 末尾规整）
  const trace: PropagationTrace[] = [];
  const nextPending: DelayedContribution[] = [];
  const unresolvedGates: UnresolvedCadenceGate[] = [];

  // ── 0) 对象类型索引 + 链路导航索引（复用 recompute 的 "linkKey|id" 思路） ──
  const typeOf = new Map<string, string>();
  for (const o of graph.objects) typeOf.set(o.id, o.typeKey);
  // navOut: "linkKey\u0000fromId" -> 该边的 toId 列表（source 视角下游 target）。用 \u0000 分隔避免 key 撞车。
  const navKey = (linkKey: string, fromId: string) => `${linkKey}\u0000${fromId}`;
  const navOut = new Map<string, string[]>();
  for (const l of graph.links) {
    const ko = navKey(l.linkKey, l.fromId);
    (navOut.get(ko) ?? navOut.set(ko, []).get(ko)!).push(l.toId);
  }
  // sourceTypeKey -> 该类型对象 id（稳定排序，遍历确定）。
  const idsByType = new Map<string, string[]>();
  for (const o of [...graph.objects].sort((a, b) => a.id.localeCompare(b.id))) {
    (idsByType.get(o.typeKey) ?? idsByType.set(o.typeKey, []).get(o.typeKey)!).push(o.id);
  }
  const targetsOf = (rule: PropagationRule, sourceId: string): string[] =>
    (navOut.get(navKey(rule.viaLinkKey, sourceId)) ?? [])
      .filter((toId) => typeOf.get(toId) === rule.targetTypeKey)
      .sort((a, b) => a.localeCompare(b));

  // ── 1) 先结算 pending 中 arriveTick === tick 的延迟贡献（确定性：稳定排序后累加） ──
  // 延迟贡献是已定型的标量，统一 sum 累加（其规则 combine 在落 pending 前已定值）。
  const arriving = pending.filter((p) => p.arriveTick === tick);
  const carry = pending.filter((p) => p.arriveTick !== tick); // 未到的留下
  arriving.sort(
    (a, b) =>
      a.targetObjectId.localeCompare(b.targetObjectId) ||
      a.targetStateVar.localeCompare(b.targetStateVar) ||
      a.ruleKey.localeCompare(b.ruleKey) ||
      a.amount - b.amount,
  );
  for (const p of arriving) {
    applyContribution(next, p.targetObjectId, p.targetStateVar, p.amount, "sum", touched);
    trace.push({ ruleKey: p.ruleKey, fromObjectId: "(delayed)", toObjectId: p.targetObjectId, amount: round12(p.amount), viaLinkKey: "(pending)" });
  }

  // ── 2) 每条规则：沿 viaLinkKey 取 source(typeKey)─link→target(typeKey) 边，算贡献 ──
  // 规则按 key 稳定排序，遍历确定性（R6）。
  const sortedRules = [...rules].sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  for (const rule of sortedRules) {
    // ── 节拍闸门（E4）：声明了就必须拿得到，拿不到诚实报缺、该流本 tick 不传导 ──
    // 反面做法（本仓要根治的病）：查不到就当没闸门 ⇒ 悄悄宣称「随到随办」，
    // 把「不知道等多久」渲染成「不用等」——契约 §2 已把 `0` 这个错法显式排除。
    let gate: CadenceGate | null = null;
    // `!= null` 而**不是** `!== null`：这里必须把 `undefined` 也算作"没声明闸门"。
    // 理由是接缝上的真实行为，不是洁癖：`repo/pg.ts:113` 读回是 `row.doc as PropagationRule`
    // ——**裸 cast、不过 zod parse**，所以契约上的 `.default(null)` 在读回路上不生效，
    // E4 之前落库的老规则读回来是 `undefined` 而非 `null`。用 `!== null` 会把这些老规则
    // 判成"声明了闸门却拿不到"⇒ 整条流停止传导（实测：老规则 15 → 0，见 E4-8）。
    // 契约 §cadenceNodeId 承诺"缺省 ⇒ 行为与本字段引入前逐字节相同（additive·可回退 RL9）"，
    // 那这条承诺就必须对 `undefined` 同样成立。
    if (rule.cadenceNodeId != null) {
      const g = gates[rule.cadenceNodeId];
      if (g === undefined) {
        unresolvedGates.push({
          ruleKey: rule.key,
          cadenceNodeId: rule.cadenceNodeId,
          reason: "NO_GATE",
          detail:
            `规则 ${rule.key} 声明过节拍闸门 Cadence(${rule.cadenceNodeId})，但本租户取不到可用节拍` +
            `（该节点 dataMode=EMPTY，或周期不可整 tick 表示，或该对象未物化）。` +
            `本条流本 tick 不传导——既不当作随到随办（那是把"不知道"说成"不用等"），也不替它编一个周期。`,
        });
        continue;
      }
      gate = g;
    }
    const coeff = effectiveCoefficient(rule, ruleParams);
    for (const sourceId of idsByType.get(rule.sourceTypeKey) ?? []) {
      const targets = targetsOf(rule, sourceId);
      if (targets.length === 0) continue;
      // 源态只读 <=t 的 state（绝不读 next/未来 = Temporal Trust）。缺位视为 0（无源即无贡献）。
      // 读 `effState` 而非 `state`：本 tick 落地的扰动**当 tick 就要往下游传**（"停机了，产能马上受影响"），
      // 否则扰动要白等一个 tick 才开始扩散。无扰动时 `effState === state`（同一引用），逐字节不变。
      const sourceVal = effState[sourceId]?.[rule.sourceStateVar] ?? 0;
      if (sourceVal === 0) continue;
      // 衰减（可选，复用 risk.ts amp x (1 - dist/den)）。源/目标在抽象图上相邻 -> dist=1。
      let factor = 1;
      if (rule.decay) {
        const dist = 1;
        if (dist > rule.decay.window) continue; // 超窗 -> 无贡献
        factor = 1 - dist / rule.decay.den;
      }
      const amount = round12(coeff * sourceVal * factor);
      if (amount === 0) continue;
      // 放行时刻：无闸门 = 本 tick 即放行（旧行为逐字节不变）；有闸门 = 等到下一次开闸。
      // 再叠加规则自身的行程延迟 delayTicks（两者是两件事：闸门是"何时准出发"，delay 是"路上走多久"）。
      const releaseTick = gate === null ? tick : nextGateTick(tick, gate);
      const arriveTick = releaseTick + rule.delayTicks;
      for (const targetId of targets) {
        if (arriveTick === tick) {
          // 即时：当 tick 累加进 next，落即时 trace。
          // （无闸门 ⇒ 等价于旧的 `delayTicks === 0` 分支；有闸门且本 tick 正好开闸且零行程 ⇒ 同样即时。）
          applyContribution(next, targetId, rule.targetStateVar, amount, rule.combine, touched);
          trace.push({ ruleKey: rule.key, fromObjectId: sourceId, toObjectId: targetId, amount, viaLinkKey: rule.viaLinkKey });
        } else {
          // 延迟：排进 pending，在 arriveTick 到达（恒 > 当前 tick，绝不落过去/现在——
          // pending 只结算 `arriveTick === tick`，落到过去就永远结算不了）。
          nextPending.push({
            arriveTick,
            targetObjectId: targetId,
            targetStateVar: rule.targetStateVar,
            amount,
            ruleKey: rule.key,
          });
        }
      }
    }
  }

  // ── 3) 应用 clamp（按规则在其 target 上夹值；稳定遍历序保证确定） ──
  for (const rule of sortedRules) {
    if (!rule.clamp) continue;
    const { min, max } = rule.clamp;
    const targetIds = new Set<string>();
    for (const sourceId of idsByType.get(rule.sourceTypeKey) ?? []) {
      for (const toId of targetsOf(rule, sourceId)) targetIds.add(toId);
    }
    for (const targetId of [...targetIds].sort((a, b) => a.localeCompare(b))) {
      const bucket = next[targetId];
      const v = bucket?.[rule.targetStateVar];
      if (bucket && typeof v === "number") {
        bucket[rule.targetStateVar] = round12(Math.min(max, Math.max(min, v)));
      }
    }
  }

  // 规整所有写过的值到固定精度（R6）。
  for (const [objId, vars] of touched) {
    const bucket = next[objId];
    if (!bucket) continue;
    for (const stateVar of vars) {
      const v = bucket[stateVar];
      if (typeof v === "number") bucket[stateVar] = round12(v);
    }
  }

  // pending：未到的 carry + 新延迟，稳定排序（resume 字节一致）。
  const outPending = [...carry, ...nextPending].sort(
    (a, b) =>
      a.arriveTick - b.arriveTick ||
      a.targetObjectId.localeCompare(b.targetObjectId) ||
      a.targetStateVar.localeCompare(b.targetStateVar) ||
      a.ruleKey.localeCompare(b.ruleKey) ||
      a.amount - b.amount,
  );

  // trace 稳定排序（可视化确定）。扰动行（落地/回退）与传导行同排一处：ruleKey 带
  // `perturbation:` / `perturbation-revert:` 前缀，前端据此分流；不另开一个数组，
  // 免得"这个数是谁改的"要去两个地方对。无扰动时本段为空 ⇒ 逐字节同旧。
  trace.push(...perturbationTrace);
  trace.sort(
    (a, b) =>
      a.ruleKey.localeCompare(b.ruleKey) ||
      a.fromObjectId.localeCompare(b.fromObjectId) ||
      a.toObjectId.localeCompare(b.toObjectId) ||
      a.amount - b.amount,
  );

  // 诚实清单也稳定排序（R6：同输入同字节，含"缺什么"这份清单）。
  unresolvedGates.sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.cadenceNodeId.localeCompare(b.cadenceNodeId));

  return { next, pending: outPending, trace, unresolvedGates, appliedPerturbations };
}
