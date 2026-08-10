/**
 * WO-DECISION-CAUSAL-GRAPH · 因果图构图器 —— **纯投影，零发明**。
 *
 * 回答「为什么这个决策被触发」：把本仓**已经存在的**因果碎片，按契约 `causal-graph.ts` 的
 * 五段语义（Cause → Impact → Decision → Action → Result）投影成一张图。
 *
 * ══ 一条铁律：本文件不产生任何新事实 ═══════════════════════════════════════════
 * 每个节点、每条边的每一个数，都必须能指回一个**已落库的真值**：
 * `Perturbation` / `SimTickState.state` / `SimTickState.trace` / `PropagationRule` /
 * `Decision.rootRef|optionsRef|trace|outcome` / `ActionDraft`。
 * 抽不到 ⇒ **不出节点**（段级缺口写 `segmentGaps`）或 **出节点不出边**（边级缺口写 `caveats`）。
 * 绝不猜一个 `fromObjectId` 把边补上，也绝不放"占位节点"让图看起来完整 ——
 * 本仓的教训是：**一个看着完整的错图，比一个明显残缺的图危险得多**（残缺看得见，错答看不见）。
 *
 * ══ 为什么是两个构图器而不是一个 ═════════════════════════════════════════════
 * 本仓今天有**两套互不相连的因果承载**（实测，非推测）：
 *  · 沙盘宇宙：`Perturbation` → `propagateTick` → `PropagationTrace`（按 **tick** 记时）
 *  · 台账宇宙：`Decision.rootRef`(gap_attribution) → `optionsRef`(decision_play) → `actionDraftIds` → `outcome`
 *              （按 **ISO 时刻** 记时）
 * 二者之间**没有任何字段互指**：`detectChainImpediments` 只吃 `loadContext(tenantId)` 的活体对象图、
 * 不吃 session tick state（`solvers/service.ts:3126`）；`ActionDraft` 上也没有 `sessionId`
 * （`grep -n sessionId packages/contracts/src/actions.ts` = 0 命中）。
 * 硬把两边接起来就要**现编那条连接边** —— 那正是本单禁止的事。故分两支，缺口如实上报。
 *
 * R6 确定性：纯函数。无 `Date.now`、无 `Math.random`，一切遍历按 id/tick 稳定排序。
 * R14 零业务常数：不出现任何行业实体名与业务阈值。
 * R2：`tenantId` 由调用方传入并写进图。
 */
import {
  CAUSAL_SEGMENTS,
  DecisionGraphSchema,
  countCausalSegments,
  type CausalEdge,
  type CausalNode,
  type CausalSegment,
  type CausalSegmentGap,
  type Decision,
  type DecisionGraph,
  type ActionDraft,
  type Perturbation,
  type PropagationRule,
  type PropagationTrace,
  type TickState,
} from "@platform/contracts";
import {
  PERTURBATION_REVERT_TRACE_PREFIX,
  PERTURBATION_REVERT_UNRESOLVED_PREFIX,
  PERTURBATION_TRACE_PREFIX,
} from "../sim/propagation.js";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 共用小工具
// ══════════════════════════════════════════════════════════════════════════

/** trace 行里扰动落地/回退用的哨兵 `fromObjectId`（`propagation.ts` 私有常量的只读镜像）。 */
const TRACE_FROM_BEFORE = "(perturbation.before)";
const TRACE_FROM_AFTER = "(perturbation.after)";
/** 延迟贡献结算行的哨兵 `fromObjectId`（`propagation.ts` 第 1 步）。 */
const TRACE_FROM_DELAYED = "(delayed)";

/** 沙盘世界态节点 id：一个 (对象, 状态变量, tick) 格子 = 一个节点（天然去重）。 */
const cellNodeId = (objectId: string, stateVar: string, tick: number): string => `imp:${objectId}.${stateVar}@t${tick}`;

/** 读世界态某格（缺位 = `null`，**不当 0**：「没有这个数」与「这个数是 0」不是一回事）。 */
function readCell(state: TickState | undefined, objectId: string, stateVar: string): number | null {
  const v = state?.[objectId]?.[stateVar];
  return typeof v === "number" ? v : null;
}

/** 组装 + 校验（schema 的 superRefine 是本构图器的**门**，不是装饰）。 */
function assemble(args: {
  graphId: string;
  tenantId: string;
  source: DecisionGraph["source"];
  nodes: CausalNode[];
  edges: CausalEdge[];
  gaps: CausalSegmentGap[];
  caveats: string[];
}): DecisionGraph {
  const nodes = [...args.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const edges = [...args.edges].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const counts = countCausalSegments(nodes);
  // 只保留「那段真的空」的缺口条目 —— 段有节点却还挂 gap，schema superRefine ② 会抛。
  const gaps = args.gaps.filter((g) => counts[g.segment] === 0).sort((a, b) => a.segment.localeCompare(b.segment));
  return DecisionGraphSchema.parse({
    graphId: args.graphId,
    tenantId: args.tenantId,
    source: args.source,
    nodes,
    edges,
    segmentCounts: counts,
    segmentGaps: gaps,
    caveats: [...args.caveats].sort((a, b) => a.localeCompare(b)),
  });
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 沙盘宇宙 —— Perturbation + PropagationTrace → Cause/Impact
// ══════════════════════════════════════════════════════════════════════════

export interface SimCausalInput {
  tenantId: string;
  sessionId: string;
  /** 本 session 的全部扰动（`repos.sim.listPerturbations` 序：startTick↑ → 建单先后）。 */
  perturbations: readonly Perturbation[];
  /** tick 0..curTick 的逐 tick 快照（`sim_tick_state` 原样，含 `trace`）。**按 tick 升序**。 */
  ticks: readonly { tick: number; state: TickState; trace: readonly PropagationTrace[] | null }[];
  /** 本租户 PUBLISHED 传导规则 —— trace 行只带 `ruleKey`/`viaLinkKey`，**目标状态变量得靠规则解回来**。 */
  rules: readonly PropagationRule[];
}

/**
 * 从一次**真实推演**抽因果图。
 *
 * ── 每一段的取数口径（逐条可复算）────────────────────────────────────────────
 * **CAUSE** = 每条 `Perturbation` 一个节点。`label`/`value`/`anchor` 全部取自那条记录本身。
 *
 * **IMPACT** = 世界态的一个格子 `(objectId, stateVar, tick)`，`value` 取自
 * `sim_tick_state[tick].state[objectId][stateVar]` —— **唯一取数口径**。
 * 为什么不用 trace 行的 `amount` 当节点值：`amount` 是**这一条边搬运的增量**，
 * 同一格可能有多条入边（`combine: sum`）还可能被 `clamp` 夹过。拿增量冒充状态值，
 * 在多入边或有 clamp 的图上会给出一个**看着合理但对不上世界**的数。
 * 增量归增量（落在 `edge.amount`），状态归状态（落在 `node.value`），两者各有唯一来源。
 *
 * **边的时基**：`propagateTick(…, tick)` 产出的是 `producedTick = tick + 1` 那一格的世界态
 * （`propagation.ts` §0' 注释），而 `trace` 与该产出一同存到 `tick+1` 行。
 * 故一条存在第 `T` 行 trace 上的传导边，语义是 `源@(T−1) → 靶@T`。
 * 扰动落地行同理落在 `producedTick === T`。
 *
 * **DECISION / ACTION / RESULT**：session 上**没有任何承载物**（三分法之「没接线」），
 * 逐段写 `segmentGaps` 说明缺什么、要接什么。绝不拿活体对象图上的阻滞点冒充"这个 session 的决策"。
 */
export function buildCausalGraphFromSim(input: SimCausalInput): DecisionGraph {
  const nodes = new Map<string, CausalNode>();
  const edges: CausalEdge[] = [];
  const caveats = new Set<string>();

  const stateAt = new Map<number, TickState>(input.ticks.map((t) => [t.tick, t.state]));
  const ruleByKey = new Map<string, PropagationRule>(input.rules.map((r) => [r.key, r]));
  const pertById = new Map<string, Perturbation>(input.perturbations.map((p) => [p.id, p]));

  // ── CAUSE：每条扰动一个节点（真值原样投影）──────────────────────────────────
  const causeNodeId = (perturbationId: string) => `cause:${perturbationId}`;
  for (const p of input.perturbations) {
    nodes.set(causeNodeId(p.id), {
      nodeId: causeNodeId(p.id),
      segment: "CAUSE",
      label: p.label,
      anchor: { objectId: p.targetObjectId, stateVar: p.targetStateVar },
      value: p.magnitude,
      unit: null, // Perturbation 不带量纲字段 —— 不替它编一个（前端按 targetStateVar 的口径渲染）
      tick: p.startTick,
      provenance: {
        kind: "perturbation",
        refId: p.id,
        producedBy: null, // 扰动是人建的，不是任何规则/求解器算出来的
        detail:
          `扰动 ${p.kind}：${p.mode} ${p.magnitude} → ${p.targetObjectId}.${p.targetStateVar}` +
          `，自 tick ${p.startTick} 起${p.durationTicks === null ? "永久" : `持续 ${p.durationTicks} tick`}`,
      },
    });
  }

  /** 取/建一个世界态格子节点。`value` 恒取自 `sim_tick_state`（单一口径）。 */
  const cellNode = (objectId: string, stateVar: string, tick: number): CausalNode => {
    const id = cellNodeId(objectId, stateVar, tick);
    const existing = nodes.get(id);
    if (existing) return existing;
    const v = readCell(stateAt.get(tick), objectId, stateVar);
    const node: CausalNode = {
      nodeId: id,
      segment: "IMPACT",
      label: `${objectId}.${stateVar} @t${tick}`,
      anchor: { objectId, stateVar },
      value: v, // null = 该 tick 快照里根本没有这一格（诚实缺，不填 0）
      unit: null,
      tick,
      provenance: {
        kind: "tick_state",
        refId: `${input.sessionId}@t${tick}:${objectId}.${stateVar}`,
        producedBy: null, // 世界态是存下来的事实本身
        detail:
          v === null
            ? `sim_tick_state[${tick}] 中没有 ${objectId}.${stateVar} 这一格（诚实缺，未以 0 顶替）`
            : `sim_tick_state[${tick}].state["${objectId}"]["${stateVar}"] = ${v}`,
      },
    };
    nodes.set(id, node);
    return node;
  };

  // ── IMPACT + 边：逐 tick 走 trace（trace 行是唯一的"谁把多少传给谁"的真值）────
  const seenPerturbationLanding = new Set<string>();
  for (const row of input.ticks) {
    const producedTick = row.tick; // trace 与 next 一同存在这一行 ⇒ 本行 trace 描述的是"到 producedTick 为止"
    const sourceTick = producedTick - 1;
    for (const tr of row.trace ?? []) {
      // ① 扰动落地 / 回退行 —— `viaLinkKey` 是目标 stateVar，`fromObjectId` 是 before/after 哨兵。
      if (tr.ruleKey.startsWith(PERTURBATION_REVERT_UNRESOLVED_PREFIX)) {
        // 到期了却算不出「若无此扰动本应有的值」——引擎显式没动这个数。
        // 这不是一次因果传递，**不出边**；但它是一条真实的诚实缺口，登记在 caveats 里。
        const pid = tr.ruleKey.slice(PERTURBATION_REVERT_UNRESOLVED_PREFIX.length);
        caveats.add(
          `扰动 ${pid} 于 tick ${producedTick} 到期，但引擎算不出回退值（set / scale(0) 且无 preValue）⇒ ` +
            `世界态未被还原，本图不为此画边（`
            + `来源：sim_tick_state[${producedTick}].trace 上的 ${PERTURBATION_REVERT_UNRESOLVED_PREFIX} 行）`,
        );
        continue;
      }
      const isLanding = tr.ruleKey.startsWith(PERTURBATION_TRACE_PREFIX);
      const isRevert = tr.ruleKey.startsWith(PERTURBATION_REVERT_TRACE_PREFIX);
      if (isLanding || isRevert) {
        // before/after 成对，只用 after 行建边（after 的 amount = 落地后的值）。
        if (tr.fromObjectId !== TRACE_FROM_AFTER) continue;
        const prefix = isLanding ? PERTURBATION_TRACE_PREFIX : PERTURBATION_REVERT_TRACE_PREFIX;
        const pid = tr.ruleKey.slice(prefix.length);
        const cause = nodes.get(causeNodeId(pid));
        const target = cellNode(tr.toObjectId, tr.viaLinkKey, producedTick);
        if (!cause) {
          // 扰动记录已被删（`DELETE /perturbations/:pid` 只删记录、不回滚世界态）⇒ 因在图外。
          caveats.add(
            `tick ${producedTick} 的 trace 里有扰动 ${pid} 的落地行，但 sim_perturbation 里已无该记录` +
              `（删扰动不回滚世界态）⇒ 该 IMPACT 节点保留、其 CAUSE 端缺失，本图不为它编一个因`,
          );
          continue;
        }
        seenPerturbationLanding.add(pid);
        const before = (row.trace ?? []).find(
          (x) => x.ruleKey === tr.ruleKey && x.fromObjectId === TRACE_FROM_BEFORE && x.toObjectId === tr.toObjectId,
        );
        edges.push({
          edgeId: `e:${isLanding ? "pert" : "pert-revert"}:${pid}:${target.nodeId}`,
          fromNodeId: cause.nodeId,
          toNodeId: target.nodeId,
          kind: "CAUSE_TO_IMPACT",
          amount: tr.amount,
          provenance: {
            kind: "propagation_trace",
            refId: `${input.sessionId}@t${producedTick}:${tr.ruleKey}`,
            producedBy: tr.ruleKey, // `perturbation:<id>` / `perturbation-revert:<id>`（引擎写的溯源键）
            detail:
              `${isLanding ? "扰动落地" : "扰动到期回退"}：${tr.toObjectId}.${tr.viaLinkKey} ` +
              `${before ? `${before.amount} → ` : ""}${tr.amount}（tick ${producedTick}，` +
              `引擎 propagateTick 相位 0'，trace.ruleKey="${tr.ruleKey}"）`,
          },
        });
        continue;
      }

      // ② 延迟贡献结算行 —— `DelayedContribution` **不记 fromObjectId**，源头无从考证。
      if (tr.fromObjectId === TRACE_FROM_DELAYED) {
        const rule = ruleByKey.get(tr.ruleKey);
        const target = cellNode(tr.toObjectId, rule?.targetStateVar ?? tr.viaLinkKey, producedTick);
        caveats.add(
          `tick ${producedTick}：规则 ${tr.ruleKey} 的延迟贡献 ${tr.amount} 到达 ${target.anchor.objectId}.${target.anchor.stateVar}，` +
            `但 DelayedContribution 只记 {arriveTick,target*,amount,ruleKey}、**不记 fromObjectId** ⇒ ` +
            `本图出该 IMPACT 节点但**不出入边**（补边需给 DelayedContribution 加 fromObjectId 字段，属传导核改动，本单只读不改）`,
        );
        continue;
      }

      // ③ 即时传导行 —— 唯一能完整还原「源 → 靶」的一类。
      const rule = ruleByKey.get(tr.ruleKey);
      if (!rule) {
        caveats.add(
          `tick ${producedTick}：trace 行引用规则 "${tr.ruleKey}"，但本租户 PUBLISHED 规则表里查不到它` +
            `（规则被改 RETIRED / 删除，历史 trace 仍在）⇒ 该边的目标状态变量无从解回，本图不为它编一个`,
        );
        continue;
      }
      const from = cellNode(tr.fromObjectId, rule.sourceStateVar, sourceTick);
      const to = cellNode(tr.toObjectId, rule.targetStateVar, producedTick);
      edges.push({
        edgeId: `e:prop:${tr.ruleKey}:${from.nodeId}->${to.nodeId}`,
        fromNodeId: from.nodeId,
        toNodeId: to.nodeId,
        kind: "IMPACT_TO_IMPACT",
        amount: tr.amount,
        provenance: {
          kind: "propagation_trace",
          refId: `${input.sessionId}@t${producedTick}:${tr.ruleKey}:${tr.fromObjectId}->${tr.toObjectId}`,
          producedBy: rule.key, // ★ 判据②：这条边指得回**哪条传导规则**
          detail:
            `传导规则 ${rule.key}：${rule.sourceTypeKey}.${rule.sourceStateVar} --${rule.viaLinkKey}--> ` +
            `${rule.targetTypeKey}.${rule.targetStateVar}，系数 ${rule.coefficient}` +
            `${rule.coefficientRef ? `（引用 ${rule.coefficientRef.ruleKey}.params.${rule.coefficientRef.paramKey}）` : ""}` +
            `，延迟 ${rule.delayTicks} tick ⇒ 本次搬运 ${tr.amount}（tick ${sourceTick} → ${producedTick}）`,
        },
      });
    }
  }

  // ── 边级诚实缺口：路由施加的扰动在 trace 上无痕 ────────────────────────────
  for (const p of input.perturbations) {
    if (seenPerturbationLanding.has(p.id)) continue;
    caveats.add(
      `扰动 ${p.id}（${p.label}）在 sim_tick_state.trace 上没有任何落地行 ⇒ 本图出 CAUSE 节点但**不出下游边**。` +
        `两种已知来路：① 建单时已生效的扰动由路由 simApplyAtCurrentTick 直接施加，该路原样保留旧 trace、不写新 trace；` +
        `② startTick 尚未到达（当前推演还没跑到 tick ${p.startTick}）。` +
        `补边需要传导核在路由施加路径上也写 trace（属 propagateTick 调用方改动，本单只读不改）`,
    );
  }

  // ── 段级诚实缺口（三分法之「没接线」）─────────────────────────────────────
  const gaps: CausalSegmentGap[] = [
    {
      segment: "CAUSE",
      reason: "SOURCE_EMPTY",
      missing: `本 session（${input.sessionId}）一条 Perturbation 都没有 —— 承载物在（sim_perturbation 表 + 三条路由），只是这个世界没被扰动过`,
      needs: "POST /a/v1/sim/sessions/:id/perturbations 建一条扰动（或经 /act 写一条等价的 mode:set 扰动）",
    },
    {
      segment: "IMPACT",
      reason: "SOURCE_EMPTY",
      missing: "逐 tick 快照里没有任何 trace 行 —— 承载物在（SimTickState.trace），只是本 session 还没跑过带 PUBLISHED 传导规则的 tick",
      needs: "先建 PUBLISHED PropagationRule（POST /a/v1/sim/propagation-rules），再 POST /a/v1/sim/sessions/:id/tick",
    },
    {
      segment: "DECISION",
      reason: "NO_SOURCE_WIRED",
      missing:
        "沙盘 session 上没有任何承载「决策」的对象。阻滞点判定器 detectChainImpediments 存在且能产 ChainImpediment（带 evidence.ruleKey/threshold），" +
        "但它只吃 loadContext(tenantId) 的**活体对象图**，不吃本 session 的 tick state（solvers/service.ts:3126）—— 与本推演无因果关系",
      needs:
        "让 chain_impediments 能在给定 SimSession 的世界态上判定（把 SolverContext 的对象快照换成 session state），" +
        "或在 SimSession 上新增一条「本推演触发了哪些阻滞点」的承载。两者都要动 sim/ 与 solvers/，本单范围外",
    },
    {
      segment: "ACTION",
      reason: "NO_SOURCE_WIRED",
      missing:
        "ActionDraft 上没有 sessionId 字段（contracts/actions.ts 全表 0 命中），SolutionCandidate 也只挂在 ChainImpediment 上 —— " +
        "沙盘推演与动作台账之间今天没有任何字段互指",
      needs: "给 ActionDraft.origin 增加 sessionId（或建一张 session→action 关联），使「这个推演促成了哪个动作」可查",
    },
    {
      segment: "RESULT",
      reason: "NO_SOURCE_WIRED",
      missing: "沙盘只推演不写真值（R4），没有任何「实测结果」承载物；Decision.outcome 属台账宇宙，与 session 无字段互指",
      needs: "同 ACTION 段：先把 session 与 Decision/ActionDraft 接上，实测成效才谈得上归到某次推演头上",
    },
  ];

  return assemble({
    graphId: `cg_sim_${input.sessionId}`,
    tenantId: input.tenantId,
    source: { kind: "sim_session", refId: input.sessionId },
    nodes: [...nodes.values()],
    edges,
    gaps,
    caveats: [...caveats],
  });
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 台账宇宙 —— Decision → Cause/Impact/Decision/Action/Result
// ══════════════════════════════════════════════════════════════════════════

export interface DecisionCausalInput {
  tenantId: string;
  decision: Decision;
  /**
   * `decision.actionDraftIds` 解出来的真单（查不到的自动落 caveat，不编）。
   *
   * 用结构化最小子集而非整个 `ActionDraft`：`domain.ts` 的 `ActionDraft`（仓储层用）与
   * `contracts/actions.ts` 的（契约层用）字段略有出入（后者多一个可选 `actionTypeVersion`）。
   * 本构图器只读这四个字段，写死成子集就同时吃得下两边，不用在路由里做一次无意义的 cast。
   */
  actionDrafts: readonly Pick<ActionDraft, "id" | "actionTypeKey" | "status" | "approvalSteps">[];
}

/**
 * 从一条**真实决策台账**抽因果图 —— 五段各有明确取数口径。
 *
 * | 段 | 取自 | 备注 |
 * |---|---|---|
 * | CAUSE   | `decision.trace[step==="root_cause"]`（真 gap_attribution 产物快照）| 兜底 `rootRef.factorId` |
 * | IMPACT  | `decision.rootRef.rootMetric.gap`                                 | 量纲 = `rootMetric.unit` |
 * | DECISION| `decision` 本身（id/status/chosenOptionIds/decidedBy）              | `producedBy: null`（人定的） |
 * | ACTION  | 选定的 `DecisionOption` + 已派的 `ActionDraft`                       | option 的 `closesGap` 是**预言**，标在 detail 里 |
 * | RESULT  | `decision.outcome`（**外部注入的实测**）                             | `null` ⇒ `NOT_YET_REALIZED` 诚实缺 |
 *
 * ★ **预言不许冒充实测**：`DecisionOption.closesGap` 是 decision_play 的预测值，
 * 它落在 **ACTION** 节点的 `value` 上（detail 写明"预言"），**不**落进 RESULT 段。
 * RESULT 段只认 `DecisionOutcome.realizedGapClose` —— 那是运营回填的实测
 * （`decision-kernel.ts` 原文：「KILL-MOCK：系统绝不自造冒充实测」）。
 * 把预言画成结果，就是把"我们打算补 3.2 亿"渲染成"我们补了 3.2 亿"。
 */
export function buildCausalGraphFromDecision(input: DecisionCausalInput): DecisionGraph {
  const d = input.decision;
  const nodes: CausalNode[] = [];
  const edges: CausalEdge[] = [];
  const caveats: string[] = [];
  const unit = d.rootRef.rootMetric.unit === "" ? null : d.rootRef.rootMetric.unit;

  // ── CAUSE：根因（真 gap_attribution 快照，带人读 label）───────────────────
  const rootSteps = d.trace.filter((s) => s.step === "root_cause");
  const causeIds: string[] = [];
  for (const s of rootSteps) {
    const nodeId = `cause:${s.refId}`;
    if (causeIds.includes(nodeId)) continue;
    causeIds.push(nodeId);
    nodes.push({
      nodeId,
      segment: "CAUSE",
      label: s.label,
      anchor: { objectId: s.refId, stateVar: null },
      value: null, // 根因是一个因子，不是一个标量 —— 不替它编一个数
      unit: null,
      tick: null,
      provenance: {
        kind: "gap_attribution",
        refId: s.refId,
        producedBy: d.rootRef.solverKey, // "gap_attribution"
        detail: `Decision.trace[step=root_cause].refId="${s.refId}"，provId=${s.provId ?? "(无)"}；根因由求解器 ${d.rootRef.solverKey} 真推演产出（改根因颗粒→重推→变）`,
      },
    });
  }
  if (causeIds.length === 0) {
    caveats.push(
      `Decision ${d.id} 的 trace 里没有 step="root_cause" 步 —— 该字段由 DecisionKernelService.create 恒写入，` +
        `台账为空说明它是更早版本写的（或被外部改过）`,
    );
  }

  // ── IMPACT：根指标缺口（rootRef 快照·量纲取自 rootMetric.unit）──────────────
  const rm = d.rootRef.rootMetric;
  const impactId = `impact:${rm.key}`;
  nodes.push({
    nodeId: impactId,
    segment: "IMPACT",
    label: `${rm.name} 缺口 ${rm.gap}${rm.unit}`,
    anchor: { objectId: rm.key, stateVar: "gap" },
    value: rm.gap,
    unit,
    tick: null,
    provenance: {
      kind: "gap_attribution",
      refId: `${d.id}:rootMetric:${rm.key}`,
      producedBy: d.rootRef.solverKey,
      detail:
        `Decision.rootRef.rootMetric = {key:${rm.key}, gap:${rm.gap}, unit:"${rm.unit}"}` +
        `（求解器 ${d.rootRef.solverKey} 真产物快照，residualPct=${d.rootRef.residualPct ?? "(无)"}）`,
    },
  });
  for (const cid of causeIds) {
    edges.push({
      edgeId: `e:cause->impact:${cid}`,
      fromNodeId: cid,
      toNodeId: impactId,
      kind: "CAUSE_TO_IMPACT",
      // 台账只快照了根因 id 与总缺口，**没有快照该根因的分摊贡献值** ⇒ 边不搬数（不拿总缺口冒充单因子贡献）。
      amount: null,
      provenance: {
        kind: "gap_attribution",
        refId: `${d.id}:rootRef`,
        producedBy: d.rootRef.solverKey,
        detail:
          `根因 → 指标缺口，出自 ${d.rootRef.solverKey}(metricKey=${d.rootRef.metricKey}` +
          `${d.rootRef.factorId ? `, factorId=${d.rootRef.factorId}` : ""})。` +
          `本边不带数值：Decision.rootRef 只快照了 rootMetric.gap 总量与根因 id，未快照该根因的逐层分摊贡献`,
      },
    });
  }

  // ── DECISION：★ 「为什么这个决策被触发」的落点 ────────────────────────────
  const decisionId = `decision:${d.id}`;
  nodes.push({
    nodeId: decisionId,
    segment: "DECISION",
    label: `决策 ${d.id}（${d.status}·选定 ${d.chosenOptionIds.length} 个方案）`,
    anchor: { objectId: d.id, stateVar: null },
    value: null,
    unit: null,
    tick: null,
    provenance: {
      kind: "decision",
      refId: d.id,
      producedBy: null, // 决策是人定的（decidedBy），不是求解器算的
      detail:
        `Decision 台账：metricKey=${d.metricKey}，factorId=${d.factorId ?? "(无)"}，` +
        `decidedBy=${d.decidedBy}，status=${d.status}，chosenOptionIds=[${d.chosenOptionIds.join(", ")}]`,
    },
  });
  edges.push({
    edgeId: `e:impact->decision:${d.id}`,
    fromNodeId: impactId,
    toNodeId: decisionId,
    kind: "IMPACT_TO_DECISION",
    amount: rm.gap, // ★ 这个数就是"为什么被触发"的量化答案
    provenance: {
      kind: "decision",
      refId: d.id,
      producedBy: d.rootRef.solverKey,
      detail:
        `触发判据：指标 ${rm.key}（${rm.name}）缺口 ${rm.gap}${rm.unit} ⇒ 建 Decision ${d.id}。` +
        `缺口由 ${d.rootRef.solverKey} 真推演得出，摘要：${d.rootRef.summary || "(空)"}`,
    },
  });

  // ── ACTION：选定方案（预言值）+ 已派真单 ──────────────────────────────────
  const optById = new Map(d.optionsRef.options.map((o) => [o.optionId, o]));
  for (const oid of [...d.chosenOptionIds].sort((a, b) => a.localeCompare(b))) {
    const o = optById.get(oid);
    if (!o) {
      caveats.push(`chosenOptionIds 含 "${oid}"，但 optionsRef.options 里没有它 ⇒ 本图不为它出节点（拒幽灵方案）`);
      continue;
    }
    const nodeId = `action:opt:${o.optionId}`;
    nodes.push({
      nodeId,
      segment: "ACTION",
      label: o.label,
      anchor: { objectId: o.factorId, stateVar: null },
      value: o.closesGap, // ⚠ 预言值，非实测 —— detail 里写死这一点
      unit,
      tick: null,
      provenance: {
        kind: "decision_option",
        refId: o.optionId,
        producedBy: d.optionsRef.solverKey, // "decision_play"
        detail:
          `方案（求解器 ${d.optionsRef.solverKey} 真产物）：**预言**补缺口 ${o.closesGap}${rm.unit}，` +
          `代价 ${o.cost} 万元，见效 ${o.cycleDays} 天，风险 ${o.risk}，敞口 ${o.exposure}，可逆性 ${o.reversibility}；` +
          `依据 ${o.provenance.kind}／${o.provenance.basis}。**此值是预言不是实测**，实测只认 Decision.outcome`,
      },
    });
    edges.push({
      edgeId: `e:decision->action:${o.optionId}`,
      fromNodeId: decisionId,
      toNodeId: nodeId,
      kind: "DECISION_TO_ACTION",
      amount: o.closesGap,
      provenance: {
        kind: "decision_option",
        refId: o.optionId,
        producedBy: d.optionsRef.solverKey,
        detail: `Decision ${d.id} 选定方案 ${o.optionId}（⊆ optionsRef.options，建单时已校验拒幽灵）`,
      },
    });
  }
  const draftById = new Map(input.actionDrafts.map((a) => [a.id, a]));
  for (const aid of [...d.actionDraftIds].sort((a, b) => a.localeCompare(b))) {
    const a = draftById.get(aid);
    if (!a) {
      caveats.push(`Decision.actionDraftIds 含 "${aid}"，但 action_draft 表里查不到 ⇒ 本图不为它出节点`);
      continue;
    }
    const nodeId = `action:draft:${a.id}`;
    nodes.push({
      nodeId,
      segment: "ACTION",
      label: `${a.actionTypeKey}（${a.status}）`,
      anchor: { objectId: a.id, stateVar: null },
      value: null,
      unit: null,
      tick: null,
      provenance: {
        kind: "action_draft",
        refId: a.id,
        producedBy: null, // 动作单是经 ActionService 建的，不是求解器算出的数
        detail: `ActionDraft ${a.id}：actionTypeKey=${a.actionTypeKey}，status=${a.status}，审批 ${a.approvalSteps.length} 步`,
      },
    });
    edges.push({
      edgeId: `e:decision->draft:${a.id}`,
      fromNodeId: decisionId,
      toNodeId: nodeId,
      kind: "DECISION_TO_ACTION",
      amount: null,
      provenance: {
        kind: "action_draft",
        refId: a.id,
        producedBy: null,
        detail: `Decision ${d.id} commit 时经 ActionService 派出（DRAFT·执行仍走 S2 审批链）`,
      },
    });
  }
  if (d.status !== "PROPOSED" && d.actionDraftIds.length === 0) {
    caveats.push(
      `Decision ${d.id} 已 ${d.status} 但 actionDraftIds 为空 —— commit 对落不成真可执行载荷的方案**诚实不派**` +
        `（decision/kernel.ts commit 的 dryRunMitigation 判据），故 ACTION 段只有方案节点、没有真单节点`,
    );
  }

  // ── RESULT：只认实测（outcome），预言一律不进本段 ──────────────────────────
  const actionNodeIds = nodes.filter((n) => n.segment === "ACTION").map((n) => n.nodeId);
  if (d.outcome) {
    const oc = d.outcome;
    const mk = (suffix: string, label: string, value: number, u: string | null, detail: string): CausalNode => ({
      nodeId: `result:${d.id}:${suffix}`,
      segment: "RESULT",
      label,
      anchor: { objectId: rm.key, stateVar: suffix },
      value,
      unit: u,
      tick: null,
      provenance: { kind: "decision_outcome", refId: `${d.id}:outcome`, producedBy: null, detail },
    });
    const realized = mk(
      "realizedGapClose",
      `实测补缺口 ${oc.realizedGapClose}${rm.unit}`,
      oc.realizedGapClose,
      unit,
      `Decision.outcome.realizedGapClose = ${oc.realizedGapClose}（**外部注入的运营实测**，回填于 ${oc.realizedAt}${oc.note ? `，备注：${oc.note}` : ""}）`,
    );
    const eff = mk(
      "effectivenessPct",
      `效果 ${oc.effectivenessPct}%`,
      oc.effectivenessPct,
      "%",
      `Decision.outcome.effectivenessPct = realizedGapClose(${oc.realizedGapClose}) ÷ predictedGapClose(${oc.predictedGapClose}) × 100 = ${oc.effectivenessPct}`,
    );
    nodes.push(realized, eff);
    for (const an of actionNodeIds) {
      for (const rn of [realized, eff]) {
        edges.push({
          edgeId: `e:action->result:${an}->${rn.nodeId}`,
          fromNodeId: an,
          toNodeId: rn.nodeId,
          kind: "ACTION_TO_RESULT",
          // 实测是**对全体选定方案的合计**回填，无法按方案拆分 ⇒ 边不搬数，绝不按预言比例摊一个假归属。
          amount: null,
          provenance: {
            kind: "decision_outcome",
            refId: `${d.id}:outcome`,
            producedBy: null,
            detail:
              `实测成效由运营经 POST /a/v1/decisions/${d.id}/outcome 一次性回填，口径是**全体选定方案的合计**；` +
              `本边不带数值，因为台账没有逐方案的实测拆分（按 closesGap 比例摊出来的数会是一个看着合理的假归属）`,
          },
        });
      }
    }
  }

  const gaps: CausalSegmentGap[] = [
    {
      segment: "CAUSE",
      reason: "SOURCE_EMPTY",
      missing: `Decision ${d.id} 的 trace 里没有 step="root_cause" 步（正常台账恒有一条）`,
      needs: "经 POST /a/v1/decisions 重建该决策（DecisionKernelService.create 会写入真 gap_attribution 根因步）",
    },
    {
      segment: "ACTION",
      reason: "SOURCE_EMPTY",
      missing:
        `Decision ${d.id} 既无可解析的选定方案（chosenOptionIds ∩ optionsRef.options = ∅），也无已派 ActionDraft`,
      needs: "先 POST /a/v1/decisions/:id/commit 派单；若 commit 诚实不派（dryRunMitigation 跑不通），则需 decision_play 产出基地处置粒度的方案",
    },
    {
      segment: "RESULT",
      reason: "NOT_YET_REALIZED",
      missing:
        `Decision.outcome 为 null（当前 status=${d.status}）—— 实测成效尚未回填。` +
        `注意：选定方案上的 closesGap 是 decision_play 的**预言**，已挂在 ACTION 节点上，` +
        `**不会**被搬进 RESULT 段冒充实测`,
      needs: `由运营 POST /a/v1/decisions/${d.id}/outcome 注入 realizedGapClose（外部实测·系统绝不自造）`,
    },
  ];

  return assemble({
    graphId: `cg_decision_${d.id}`,
    tenantId: input.tenantId,
    source: { kind: "decision", refId: d.id },
    nodes,
    edges,
    gaps,
    caveats,
  });
}

/** 五段全集（路由/测试引用，避免各处再写一遍字面量）。 */
export const CAUSAL_GRAPH_SEGMENTS: readonly CausalSegment[] = CAUSAL_SEGMENTS;
