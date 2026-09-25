import { createHash } from "node:crypto";
import {
  adversaryMoveNameOf,
  pairWeightNormalizeOf,
  simSliceKey,
  type PropagationRule,
  type SimDisclosureRule,
  type SimDisclosureTiming,
  type SimRunDisclosure,
  type StateVarDomainLookup,
} from "@platform/contracts";
import type { PropagationTrace } from "@platform/contracts";
import type { PairWeightReport } from "./pair-weights.js";
import { PERTURBATION_TRACE_PREFIX } from "./propagation.js";
import type {
  CadenceGateLookup,
  PropagationGraph,
  RuleParamLookup,
  ScopeReport,
  StateVarDisclosure,
  UnresolvedCadenceGate,
  UnresolvedPairWeight,
} from "./propagation.js";

/**
 * 推演过程披露层的**装配处**（WO-SIM-DISCLOSURE · 铁律 1.5 判据二）。
 *
 * 🔴 **本文件一行都不参与计算**：它只吃同一次 tick 里**已经产生**的中间量
 * （裁剪后的图 / 范围回执 / 规则表 / 参数表 / 闸门表 / 分摊回执 / 量纲登记册 / 引擎状态量回执 / 计时），
 * 换个形状讲出来。求解器算法与任何数值一行未动 —— 「把已经发生的事讲出来」，不是「改变发生了什么」。
 *
 * 为什么装配在**引擎之外**而不是塞进 `propagateTick`：引擎是纯函数（R6/R14 零业务常数），
 * 往里塞一个「顺便记一下你都做了什么」的出参，等于让度量装置骑在算法上 ——
 * 下一个改算法的人就必须同时维护披露口径，两件事迟早漂开。故披露层在外面按既有回执重组。
 */

/** 计时器：一个 phase 一次 `mark()`，同名累加（多拍循环里 engine 会 mark 多次）。 */
export class PhaseTimer {
  private readonly acc = new Map<string, number>();
  private readonly now: () => number;
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }
  /** 起一个计时，返回「停」的闭包。忘了停 = 这个 phase 不计入（不会记成 0 冒充"很快"）。 */
  start(phase: string): () => void {
    const t0 = this.now();
    return () => this.acc.set(phase, (this.acc.get(phase) ?? 0) + (this.now() - t0));
  }
  /** 直接记一笔（已知毫秒数时用）。 */
  add(phase: string, ms: number): void {
    this.acc.set(phase, (this.acc.get(phase) ?? 0) + ms);
  }
  /** 固定环节序输出（`total` 恒排最后）—— 屏上顺序不随 Map 插入序漂。 */
  timings(order: readonly string[]): SimDisclosureTiming[] {
    const out: SimDisclosureTiming[] = [];
    for (const p of order) {
      const v = this.acc.get(p);
      if (v !== undefined) out.push({ phase: p, ms: Math.round(v * 1000) / 1000 });
    }
    for (const [p, v] of [...this.acc].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!order.includes(p)) out.push({ phase: p, ms: Math.round(v * 1000) / 1000 });
    }
    return out;
  }
}

/**
 * 环节的展示序（入参装配 → 影子线 → 传导 → 落盘 → 合计）。
 *
 * ⚠ 这里**故意没有** `weights` 这一格：分摊表是在 `graph`（`buildPropagationInputs`）**里面**算的，
 * 摆成并列项会被读成"再花了这么多"，把同一段时间记两遍。逐规则那笔账在
 * `rules.items[].weightElapsedMs` 上，位置对了，也不会重复计。
 */
export const DISCLOSURE_PHASE_ORDER = ["graph", "shadow", "engine", "persist", "total"] as const;

/**
 * 参与传导的这张图的稳定指纹。**同图 ⇒ 同串**（R6：零时钟、零随机、与遍历序无关）。
 *
 * 判据来自铁律 1.5 的对照实验：「换一个扰动再跑一次，**引用的数据快照版本必须不变**」。
 * 因此指纹只咬**数据本身**（对象 id+类型、链路 from/to+类型），不含扰动、不含 tick、不含规则 ——
 * 掺进任何一样，两次跑的版本串就会不同，那条判据当场失效。
 *
 * 排序后再哈希：`listByType` 的返回序不是契约的一部分，靠它会让同一份数据在两次进程里得出两个版本。
 */
export function graphSnapshotVersion(graph: PropagationGraph): string {
  const objs = graph.objects.map((o) => `${o.typeKey}\u0000${o.id}`).sort();
  const lnks = graph.links.map((l) => `${l.linkKey}\u0000${l.fromId}\u0000${l.toId}`).sort();
  const h = createHash("sha256");
  h.update(`objects:${objs.length}\n`);
  for (const s of objs) h.update(`${s}\n`);
  h.update(`links:${lnks.length}\n`);
  for (const s of lnks) h.update(`${s}\n`);
  return h.digest("hex").slice(0, 12);
}

/** 逐键计数 → 按「条数降序 → 键升序」排（R6 全序，避免同数时顺序随输入漂）。 */
function countBy<T>(rows: readonly T[], key: (r: T) => string): { k: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m]
    .map(([k, count]) => ({ k, count }))
    .sort((a, b) => b.count - a.count || a.k.localeCompare(b.k));
}

/**
 * 一条规则的**有效系数与其来源** —— 语义所有者是 `propagation.ts` 的 `effectiveCoefficient`
 * （那是私有函数，导不出来；这里是它的镜像）。
 *
 * ⛔ **判据是解析结果，不是声明**：`pair-weights.ts` 现行写法是
 * `rule.coefficientRef ? "CONFIG_REF" : "INLINE"` —— 那把「声明了引用」当成了「系数来自配置」的证据，
 * 而引擎在引用取不到有限数值时**会回落内联**。两者在"引用坏了"这一档上给出相反的答案，
 * 而屏上恰恰是那一档最需要说实话。故这里按引擎的真实分支判，并额外标 `refUnresolved`。
 *
 * 这个镜像与引擎的一致性由接缝测试咬死（`sim-disclosure.seam.test.ts` §2：
 * 单边图 sourceVal=1 跑 `propagateTick`，断言 `trace[0].amount === 本函数返回的 coefficient`）。
 */
export function disclosedCoefficient(
  rule: PropagationRule,
  ruleParams: RuleParamLookup,
): { coefficient: number; source: "INLINE" | "CONFIG_REF"; ref: string | null; refUnresolved: boolean } {
  const ref = rule.coefficientRef;
  if (!ref) return { coefficient: rule.coefficient, source: "INLINE", ref: null, refUnresolved: false };
  const refStr = `${ref.ruleKey}.${ref.paramKey}`;
  const v = ruleParams[ref.ruleKey]?.[ref.paramKey];
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n)) return { coefficient: n, source: "CONFIG_REF", ref: refStr, refUnresolved: false };
  // 引用在、值取不到 ⇒ 引擎用的是内联那个数。说成 CONFIG_REF 就是替它编了一个出处。
  return { coefficient: rule.coefficient, source: "INLINE", ref: refStr, refUnresolved: true };
}

export interface BuildDisclosureInput {
  fromTick: number;
  toTick: number;
  /** 范围裁剪之后、真正喂进引擎的那张图。 */
  graph: PropagationGraph;
  scopeReport: ScopeReport;
  /** 本次喂进引擎的规则（= 已发布 − 本会话屏蔽）。 */
  rules: readonly PropagationRule[];
  /** 本次真的产出过贡献的规则 key（引擎 `firedPropagationRuleKeys` 的结果）。 */
  firedRuleKeys: readonly string[];
  /** 最后一拍的传导轨迹（用来数「这一拍走了几条边」）。无传导规则的世界 = null。 */
  trace: readonly PropagationTrace[] | null;
  ruleParams: RuleParamLookup;
  /** A5 规则表达式原文（ruleKey → expression），用于「阈值来自哪条规则表达式」。取不到 = 不编。 */
  ruleExpressions: Readonly<Record<string, string>>;
  pairWeightReport: PairWeightReport;
  unresolvedWeights: readonly UnresolvedPairWeight[];
  cadenceGates: CadenceGateLookup;
  cadenceSkipped: readonly { nodeId: string; reason: string }[];
  unresolvedGates: readonly UnresolvedCadenceGate[];
  stateVarDomains: StateVarDomainLookup;
  /** 引擎的状态量回执（最后一拍）。`null` = 本次没走引擎。 */
  stateVarReport: StateVarDisclosure | null;
  timings: SimDisclosureTiming[];
  /** 本租户对抗方开关（`ADVERSARY_FEATURE_KEY`）。WO-ADVERSARY-REACTION。 */
  adversaryEnabled: boolean;
  /** 因对抗方关闭而**没参与**本次推演的还手规则 key。开着时为空。 */
  adversarySuppressedRuleKeys: readonly string[];
  /** 引擎回带的还手方清单（最后一拍）。没走引擎 = null。 */
  reactionActors: readonly { ruleKey: string; actorObjectId: string }[] | null;
}

/**
 * 把一次推进的六项披露组装出来。**纯函数**：同输入同输出（`timings` 由调用方带进来，
 * 因而本函数自身不读时钟 —— 计时是外面测的，不是这里现测的）。
 */
export function buildSimRunDisclosure(inp: BuildDisclosureInput): SimRunDisclosure {
  // ── ① 引用的数据 ──────────────────────────────────────────────────────────
  const types = countBy(inp.graph.objects, (o) => o.typeKey).map((r) => ({ typeKey: r.k, count: r.count }));
  const linkTypes = countBy(inp.graph.links, (l) => l.linkKey).map((r) => ({ linkKey: r.k, count: r.count }));

  // ── ③ 命中的规则 ──────────────────────────────────────────────────────────
  const fired = new Set(inp.firedRuleKeys);
  // 还手触发计数：引擎回带的是结构化的 (ruleKey, actorObjectId)，这里按规则聚合成"几个对手还手了"。
  // ⛔ 不解析串 —— 第一版拿分隔符切串，切分恒失败而汇总数仍对，
  //    屏上出现「汇总 1 个客户还手 / 该规则触发 0 个客户」这种自相矛盾且不报错的读数。
  const triggeredByRule = new Map<string, number>();
  for (const a of inp.reactionActors ?? []) {
    triggeredByRule.set(a.ruleKey, (triggeredByRule.get(a.ruleKey) ?? 0) + 1);
  }
  const weightByRule = new Map(inp.pairWeightReport.pairs.map((p) => [p.ruleKey, p]));
  const items: SimDisclosureRule[] = [...inp.rules]
    .map((r): SimDisclosureRule => {
      const co = disclosedCoefficient(r, inp.ruleParams);
      const w = weightByRule.get(r.key);
      // 归一方式：优先取分摊回执里那一份（它是这一跑真用的）；没铺表时按登记册回答"这个口径是什么归一"。
      const normalize = w?.normalize ?? (r.weightRef ? pairWeightNormalizeOf(r.weightRef.basis) : null);
      return {
        ruleKey: r.key,
        fired: fired.has(r.key),
        coefficient: co.coefficient,
        coefficientSource: co.source,
        coefficientRef: co.ref,
        refUnresolved: co.refUnresolved,
        weightBasis: w?.basis ?? r.weightRef?.basis ?? null,
        weightNormalize: normalize,
        weightPairs: w?.pairs ?? null,
        weightZeroPairs: w?.zeroPairs ?? null,
        weightElapsedMs: w?.elapsedMs ?? null,
        delayTicks: r.delayTicks,
        combine: r.combine,
        via: `${r.sourceTypeKey}.${r.sourceStateVar} --${r.viaLinkKey}--> ${r.targetTypeKey}.${r.targetStateVar}`,
        // ── 对手方还手（WO-ADVERSARY-REACTION · 铁律 1.5 判据二）────────────────
        // 「物理传导」与「某个客户在跟我博弈」必须在屏上分得开 —— 这是业务事实不是实现细节。
        isReaction: r.reaction != null,
        reactionActorTypeKey: r.reaction?.actorTypeKey ?? null,
        reactionMove: r.reaction?.move ?? null,
        reactionMoveName: r.reaction ? adversaryMoveNameOf(r.reaction.move) : null,
        reactionTolerance: r.reaction?.tolerance ?? null,
        // 真的越过容忍线的还手方实例数。**不是** `fired` —— 延迟到货也算 fired，
        // 而这里数的是"这一拍有几个客户被惹毛了"。非还手边 = null（不是 0，两者含义不同）。
        reactionTriggeredActors: r.reaction != null ? (triggeredByRule.get(r.key) ?? 0) : null,
      };
    })
    // 命中的排前面（屏上第一眼就是"这一拍谁动了"），其次按 key 升序（R6 全序）。
    .sort((a, b) => Number(b.fired) - Number(a.fired) || a.ruleKey.localeCompare(b.ruleKey));

  // ── ④ 约束 ────────────────────────────────────────────────────────────────
  const declared = inp.stateVarReport?.declaredStateVars ?? [];
  const decayApplied = inp.stateVarReport?.decayApplied ?? {};
  const stateVarBounds = declared
    .map((sv) => {
      const d = inp.stateVarDomains[sv];
      if (!d) return null;
      const ref = d.decayRef;
      const lambda = decayApplied[sv];
      return {
        stateVar: sv,
        min: d.min,
        max: d.max,
        restPoint: d.restPoint,
        unit: d.unit,
        source: d.source,
        decayLambda: typeof lambda === "number" ? lambda : null,
        decayRef: ref ? `${ref.ruleKey}.${ref.paramKey}` : null,
        decayRuleExpression: ref ? (inp.ruleExpressions[ref.ruleKey] ?? null) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.stateVar.localeCompare(b.stateVar));

  const cadence = [
    ...inp.rules
      .filter((r) => r.cadenceNodeId)
      .map((r) => {
        const nodeId = String(r.cadenceNodeId);
        const g = inp.cadenceGates[nodeId];
        const u = inp.unresolvedGates.find((x) => x.ruleKey === r.key);
        return g
          ? {
              ruleKey: r.key,
              nodeId,
              everyTicks: g.everyTicks,
              offsetTicks: g.offsetTicks,
              source: "CADENCE_OBJECT" as const,
              detail: null,
            }
          : {
              ruleKey: r.key,
              nodeId,
              everyTicks: null,
              offsetTicks: null,
              source: "UNRESOLVED" as const,
              detail: u?.detail ?? "闸门表里没有这个节点",
            };
      }),
  ].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));

  return {
    fromTick: inp.fromTick,
    toTick: inp.toTick,
    data: {
      objects: inp.graph.objects.length,
      links: inp.graph.links.length,
      types,
      linkTypes,
      snapshotVersion: graphSnapshotVersion(inp.graph),
    },
    slice: {
      sliceKey: simSliceKey(inp.scopeReport.kind, inp.scopeReport.target, inp.scopeReport.unresolved),
      kind: inp.scopeReport.kind,
      target: inp.scopeReport.target,
      hops: inp.scopeReport.hops,
      nodes: inp.scopeReport.objects,
      edges: inp.scopeReport.links,
      droppedNodes: inp.scopeReport.droppedObjects,
      droppedEdges: inp.scopeReport.droppedLinks,
      unresolved: inp.scopeReport.unresolved,
    },
    rules: {
      declared: inp.rules.length,
      fired: items.filter((i) => i.fired).length,
      withCoefficientRef: items.filter((i) => i.coefficientRef !== null).length,
      refUnresolved: items.filter((i) => i.refUnresolved).length,
      withWeightRef: items.filter((i) => i.weightBasis !== null).length,
      // 「这一拍走了几条边」——扰动自己写的那几行按前缀剔出去，两个数分开计。
      contributions: (inp.trace ?? []).filter((t) => !t.ruleKey.startsWith(PERTURBATION_TRACE_PREFIX)).length,
      perturbationWrites: (inp.trace ?? []).filter((t) => t.ruleKey.startsWith(PERTURBATION_TRACE_PREFIX)).length,
      items,
      unresolvedWeights: [
        ...inp.pairWeightReport.unresolved,
        ...inp.unresolvedWeights.map((u) => ({ ruleKey: u.ruleKey, basis: u.basis, reason: u.detail })),
      ].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.basis.localeCompare(b.basis)),
      // ── 对抗方这一栏（WO-ADVERSARY-REACTION）───────────────────────────────────
      // ⛔ **关闭态也必须给**，照本层「agent 是否参与」那条同源纪律：
      //   零参与就明写零参与，不许留白让读者以为"对手确实没反应"。
      //   `enabled:false` + `suppressed:N` 读起来就是一句话：**这是一次单方推演**。
      adversary: {
        enabled: inp.adversaryEnabled,
        declared: items.filter((i) => i.isReaction).length,
        suppressed: inp.adversarySuppressedRuleKeys.length,
        fired: items.filter((i) => i.isReaction && i.fired).length,
        triggeredActors: (inp.reactionActors ?? []).length,
        moves: [...new Set(items.filter((i) => i.isReaction).map((i) => String(i.reactionMove)))].sort(),
      },
    },
    constraints: {
      stateVarBounds,
      undeclaredStateVars: [...(inp.stateVarReport?.undeclaredStateVars ?? [])].sort(),
      decayUnresolved: [...(inp.stateVarReport?.decayUnresolved ?? [])].sort((a, b) =>
        a.stateVar.localeCompare(b.stateVar),
      ),
      ruleClamps: inp.rules
        .filter((r) => r.clamp)
        .map((r) => ({ ruleKey: r.key, min: r.clamp!.min, max: r.clamp!.max }))
        .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey)),
      saturations: inp.stateVarReport?.saturations.length ?? 0,
      cadence,
      cadenceSkipped: [...inp.cadenceSkipped].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    },
    // ── ⑤ agent 是否参与 ────────────────────────────────────────────────────
    //
    // 🔴 **这里写死 false 是当前接线的事实，不是偷懒的缺省**：
    // 本条推演路（`POST …/tick` → `simAdvanceTicks` → `buildPropagationInputs` → `propagateTick`）
    // 的整条依赖闭包里没有任何 LLM 调用 —— 金丝雀：同三个文件里 `coefficient` 命中 8 次
    // （证明扫得动），`agent|llm|LLM` 命中 0 次。
    // 哪天这条路真接了 agent，改这一行的人必须同时把 `calls/provider/model` 填成真值；
    // 留 optional 让人"忘了填"正是本条判据禁止的那种留白。
    agent: { invoked: false, calls: 0, provider: null, model: null },
    timings: inp.timings,
  };
}
