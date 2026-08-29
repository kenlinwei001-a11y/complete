import { z } from "zod";

/**
 * WO-DECISION-CAUSAL-GRAPH · 决策因果图（Decision Graph / Causal Graph）契约。
 *
 * 回答的问题是「**为什么这个决策被触发**」，不是「Agent 说了一句话」。
 * 五段语义显式建模：`Cause → Impact → Decision → Action → Result`。
 *
 * ══ 本文件的三条铁律（与 chain-sim.ts §6 / sim.ts 同源，不另立一套）═══════════════
 *
 * ① **零现编节点**。每个 `CausalNode` / `CausalEdge` 都必须带 `provenance`，指回它是从**哪一条既有真值**
 *    抽出来的（`Perturbation.id` / `PropagationTrace` 的 `ruleKey` / `Decision.id` / `ActionDraft.id` …）。
 *    构图器只做**投影**，不做发明：抽不到就不出节点，绝不放一个"占位"进去。
 *    来历：本仓已有多起「诚实位在说谎」事故 —— 一个看着完整的图比一个明显残缺的图危险得多，
 *    因为残缺看得见、错答看不见。
 *
 * ② **空段 ⟺ 必须说清缺什么**（`superRefine` ①②硬锁，不靠各处自觉）。
 *    某一段一个节点都抽不出来时，`segmentGaps` 里**必须**有对应条目写明 `missing`（缺哪个数据源）
 *    与 `needs`（补上它需要接什么线）。返回一个安静的空数组 = 把「这段没数据」渲染成「这段没问题」，
 *    正是 `chain-sim.ts` §6 `noCandidateReason` 那条 superRefine 要根治的病，此处照抄其形态。
 *    反过来：某段有节点却仍声明 gap ⇒ 自相矛盾，同样抛。
 *
 * ③ **零悬空边 + 段序不可倒流**（`superRefine` ③④）。边的两端必须都在 `nodes` 里；
 *    且 `CausalEdgeKind` 与两端节点的 `segment` 必须一致 —— 边的种类不是装饰性标签，
 *    它就是「这条边从哪段走到哪段」的**唯一**声明，由 `CAUSAL_EDGE_SEGMENTS` 单表约束。
 *    没有这条，`IMPACT → CAUSE` 这种反向边可以悄悄混进来，因果图就变成了无向关联图。
 *
 * R6 确定性：本文件是纯 schema + 纯函数，无时钟、无随机。
 * R14 零业务常数：不出现任何行业实体名 / 业务阈值。
 * R2：`DecisionGraph.tenantId` 必填。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 五段语义（Cause → Impact → Decision → Action → Result）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 因果五段。**顺序即语义**（数组序 = 因果前进方向），`causalSegmentIndex` 是唯一的序号来源。
 *
 * 需求原文（仓主）：
 * ```
 * Cause → Impact → Decision → Action → Result
 * 例：设备故障 → 产能 -120,000 → 订单风险 +18%
 *     → 跨厂生产 → 物流成本 +¥800K → 毛利 -1.2%
 * ```
 * 注意例子里「跨厂生产」之后又出现了两个数值 —— 那是 `ACTION → RESULT` 的多个结果节点，
 * 不是第六段。五段是**闭集**：新形态一律映射进这五段，不许扩表（扩表 = 前端要跟着改渲染分支，
 * 而前端渲染分支正是本仓漂移最快的地方）。
 */
export const CAUSAL_SEGMENTS = ["CAUSE", "IMPACT", "DECISION", "ACTION", "RESULT"] as const;
export const CausalSegmentSchema = z.enum(CAUSAL_SEGMENTS);
export type CausalSegment = z.infer<typeof CausalSegmentSchema>;

/** 段序号（0..4）。因果只许前进或原地（同段多跳），**不许倒流** —— 见 `CAUSAL_EDGE_SEGMENTS`。 */
export function causalSegmentIndex(seg: CausalSegment): number {
  return CAUSAL_SEGMENTS.indexOf(seg);
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 溯源（R13）—— 每个节点、每条边都必须指得回去
// ══════════════════════════════════════════════════════════════════════════

/**
 * 节点/边的真值来源类别。**每一项都对应本仓一个已存在的契约类型**（不新造承载物）：
 *
 * | kind                  | 出自                                            | 记录了什么 |
 * |-----------------------|-------------------------------------------------|-----------|
 * | `perturbation`        | `sim.ts` `Perturbation`                          | 「事情发生了」：kind/target/magnitude/mode/startTick |
 * | `propagation_trace`   | `sim.ts` `PropagationTrace`（`SimTickState.trace`）| 「哪条规则把多少量从谁传到谁」 |
 * | `propagation_rule`    | `sim.ts` `PropagationRule`                       | 传导系数/延迟/闸门的声明本身 |
 * | `tick_state`          | `sim.ts` `TickState`                             | 某 (objectId, stateVar) 在某 tick 的真值 |
 * | `gap_attribution`     | `gap-attribution.ts` `GapAttributionNode`        | 缺口沿本体反向分摊到的一个因素 |
 * | `decision`            | `decision-kernel.ts` `Decision`                  | 一等决策台账（rootRef/optionsRef/chosen） |
 * | `decision_option`     | `decision-engine.ts` `DecisionOption`            | 一个候选方案 + 六维真算分 |
 * | `action_draft`        | `actions.ts` `ActionDraft`                       | 派出去的动作 + 审批链 |
 * | `decision_outcome`    | `decision-kernel.ts` `DecisionOutcome`           | 实测成效（外部注入·非系统自造） |
 *
 * ⚠ 这张表是**封闭**的：要加一类来源，先得在本仓有一个真承载物。
 * 「先加个 kind，数据以后再说」= 给现编节点开后门。
 */
export const CAUSAL_SOURCE_KINDS = [
  "perturbation",
  "propagation_trace",
  "propagation_rule",
  "tick_state",
  "gap_attribution",
  "decision",
  "decision_option",
  "action_draft",
  "decision_outcome",
] as const;
export const CausalSourceKindSchema = z.enum(CAUSAL_SOURCE_KINDS);
export type CausalSourceKind = z.infer<typeof CausalSourceKindSchema>;

/**
 * 溯源块（R13）。判据②「每条边可溯」咬的就是这个对象：
 * **`refId` 必须是一个真产物的 id（或由真产物字段拼出的复合键），`producedBy` 必须是产它的那条规则 / 求解器 key。**
 *
 * `producedBy` 可空的唯一合法情形：这个真值**不是任何规则/求解器算出来的**
 * （如 `Perturbation` 是人建的、`DecisionOutcome` 是运营回填的）。
 * 传导边、归因边、方案边一律非空 —— 空了就说明构图器没把「凭什么」记下来。
 */
export const CausalProvenanceSchema = z.strictObject({
  kind: CausalSourceKindSchema,
  /** 真产物 id 或复合键（如 `<sessionId>@t3:objId.stateVar`）。**空串非法**。 */
  refId: z.string().min(1),
  /**
   * 产生它的那条规则 / 求解器 key：
   * 传导边 → `PropagationRule.key`；归因边 → `"gap_attribution"`；方案边 → `"decision_play"`。
   * `null` = 该真值非算出（人建 / 外部回填）。
   */
  producedBy: z.string().min(1).nullable(),
  /** 原文摘要（人读 + 可复算）：`规则 r_util: o1.risk --FEEDS--> o2.risk ×0.5 ⇒ +5`。 */
  detail: z.string().min(1),
});
export type CausalProvenance = z.infer<typeof CausalProvenanceSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 3 · CausalNode
// ══════════════════════════════════════════════════════════════════════════

/**
 * 因果图的一个节点。
 *
 * `value` / `unit` / `tick` / `anchor.*` 一律**可空**，且空的含义是「这个真值上没有这个字段」，
 * **不是**「用 0 / 空串顶上」。本仓已实测过 `0` 冒充「不知道」的代价
 * （`propagation.ts` `cadenceGate` 那条注释：把"不知道等多久"渲染成"不用等"）。
 */
export const CausalNodeSchema = z.strictObject({
  nodeId: z.string().min(1),
  segment: CausalSegmentSchema,
  /** 人读标签。由真值字段派生（`Perturbation.label` / `DecisionOption.label` / …），禁内联业务名词（R14）。 */
  label: z.string().min(1),
  /** 落点：本体上的真对象 / 真状态变量。抽不到就 `null`，**不硬凑**。 */
  anchor: z.strictObject({
    objectId: z.string().min(1).nullable(),
    stateVar: z.string().min(1).nullable(),
  }),
  /** 该节点携带的数值（传导量 / closesGap / effectivenessPct …）。抽不到 = `null`。 */
  value: z.number().nullable(),
  /** 量纲原文（存储口径，**后端不替前端换算** —— 同 `SolutionCandidate.lever.valueKind` 的教训）。 */
  unit: z.string().min(1).nullable(),
  /** 沙盘时间坐标（tick）。非沙盘来源 = `null`。 */
  tick: z.number().int().nullable(),
  provenance: CausalProvenanceSchema,
});
export type CausalNode = z.infer<typeof CausalNodeSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · CausalEdge —— 段序由单表约束，不许倒流
// ══════════════════════════════════════════════════════════════════════════

/**
 * 边的种类。名字即「从哪段到哪段」，由 `CAUSAL_EDGE_SEGMENTS` 单表落实，
 * `DecisionGraphSchema` 的 superRefine ④ 会拿它去核对两端节点的实际 `segment`。
 *
 * 为什么必须有同段边（`*_TO_SAME`）：传导是**多跳**的（o1→o2→o3），归因是**多层**的
 * （指标→基地→订单→瓶颈）。若只允许跨段边，多跳链就得压成一跳，
 * 「设备故障 → 产能 -120,000 → 订单风险 +18%」中间那一跳会被抹掉 —— 而它恰是管理层要看的那一跳。
 */
export const CAUSAL_EDGE_KINDS = [
  "CAUSE_TO_CAUSE", // 根因链多跳（`caused_by` 形态）
  "CAUSE_TO_IMPACT", // 扰动落地 → 首个受影响量
  "IMPACT_TO_IMPACT", // 传导多跳 / 归因多层
  "IMPACT_TO_DECISION", // 量越线 → 决策被触发 ★「为什么这个决策被触发」的那条边
  "DECISION_TO_ACTION", // 决策选定 → 派出动作
  "ACTION_TO_RESULT", // 动作 → 结果（预言 or 实测）
] as const;
export const CausalEdgeKindSchema = z.enum(CAUSAL_EDGE_KINDS);
export type CausalEdgeKind = z.infer<typeof CausalEdgeKindSchema>;

/** 边种类 → (起点段, 终点段)。**唯一**真相源：schema 校验与构图器都读它，不许各写一份。 */
export const CAUSAL_EDGE_SEGMENTS: Readonly<Record<CausalEdgeKind, readonly [CausalSegment, CausalSegment]>> = {
  CAUSE_TO_CAUSE: ["CAUSE", "CAUSE"],
  CAUSE_TO_IMPACT: ["CAUSE", "IMPACT"],
  IMPACT_TO_IMPACT: ["IMPACT", "IMPACT"],
  IMPACT_TO_DECISION: ["IMPACT", "DECISION"],
  DECISION_TO_ACTION: ["DECISION", "ACTION"],
  ACTION_TO_RESULT: ["ACTION", "RESULT"],
} as const;

export const CausalEdgeSchema = z.strictObject({
  edgeId: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  kind: CausalEdgeKindSchema,
  /** 这条边搬运的量（传导 amount / 分摊 contribution）。非量化边 = `null`。 */
  amount: z.number().nullable(),
  /** ★ 判据②「每条边可溯」—— 边**必须**指得回它的来源，无例外（故非 optional）。 */
  provenance: CausalProvenanceSchema,
});
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 诚实缺席（空段必须说清缺什么）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一段抽不出节点的**机器可读**原因。三态不许混为一谈（照 CLAUDE.md 铁律 0.5 的三分法）：
 *
 * | reason              | 对应三分法        | 含义 |
 * |---------------------|-------------------|------|
 * | `NO_SOURCE_WIRED`   | **没接线**        | 这段在本数据源语境下根本没有承载物（如沙盘 session 上没有任何东西承载"决策"） |
 * | `SOURCE_EMPTY`      | **接了线没数据**  | 承载物存在、构图器读了，但这次真的一条都没有（如本 session 一条扰动都没建） |
 * | `NOT_YET_REALIZED`  | **接了线还没到**  | 承载物存在且会有，只是时点未到（如 `Decision.outcome` 在 REALIZED 之前恒 null） |
 *
 * 混成一个 `EMPTY` 就会把「修法完全不同的三件事」压成一句话 —— 那正是铁律 0.5 点名的病。
 */
export const CAUSAL_GAP_REASONS = ["NO_SOURCE_WIRED", "SOURCE_EMPTY", "NOT_YET_REALIZED"] as const;
export const CausalGapReasonSchema = z.enum(CAUSAL_GAP_REASONS);
export type CausalGapReason = z.infer<typeof CausalGapReasonSchema>;

export const CausalSegmentGapSchema = z.strictObject({
  segment: CausalSegmentSchema,
  reason: CausalGapReasonSchema,
  /** **缺什么**：指名道姓缺哪个数据源 / 哪个字段。`"暂无数据"` 这种废话过不了 review。 */
  missing: z.string().min(1),
  /** **补上它需要什么**：要接哪条线 / 要跑哪个求解器 / 要谁回填。 */
  needs: z.string().min(1),
});
export type CausalSegmentGap = z.infer<typeof CausalSegmentGapSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 6 · DecisionGraph
// ══════════════════════════════════════════════════════════════════════════

/**
 * 图的数据源。**两个宇宙**（本仓今天真实存在的两套因果承载，不是一套的两个视角）：
 *  · `sim_session` —— 沙盘：`Perturbation` → `PropagationTrace`（**Cause/Impact 有真值**）
 *  · `decision`    —— 决策台账：`Decision.rootRef`(gap_attribution) → `optionsRef` → `actionDraftIds` → `outcome`
 *                     （**Cause/Impact/Decision/Action/Result 有真值**）
 *
 * 为什么不合成一个：两者的**时间轴根本不同**（沙盘按 tick，台账按 ISO 时刻），
 * 且今天**没有任何字段把二者连起来**（实测：`ChainImpediment` 扫描只吃 `loadContext(tenantId)` 的活体对象图，
 * 不吃 session tick state；`ActionDraft` 上也没有 `sessionId`）。
 * 硬合成就要现编那条连接边 —— 那正是本单禁止的事。缺口写进 `segmentGaps`，由审核方决定接不接。
 */
export const CausalGraphSourceKindSchema = z.enum(["sim_session", "decision"]);
export type CausalGraphSourceKind = z.infer<typeof CausalGraphSourceKindSchema>;

export const CausalGraphSourceSchema = z.strictObject({
  kind: CausalGraphSourceKindSchema,
  /** `SimSession.id` 或 `Decision.id`。 */
  refId: z.string().min(1),
});
export type CausalGraphSource = z.infer<typeof CausalGraphSourceSchema>;

/**
 * 决策因果图 —— 「为什么这个决策被触发」的答案本体。
 *
 * `segmentCounts` 是**冗余但必需**的：前端要在一段为空时把那一段渲染成"诚实灰"，
 * 不能靠 `nodes.filter(...).length === 0` 去反推（那样它就得知道五段全集，第二套真相源）。
 * superRefine ① 保证它与 `nodes` 一致，所以冗余不会漂。
 */
export const DecisionGraphSchema = z
  .strictObject({
    graphId: z.string().min(1),
    tenantId: z.string().min(1), // R2 tenant_id everywhere
    source: CausalGraphSourceSchema,
    nodes: z.array(CausalNodeSchema),
    edges: z.array(CausalEdgeSchema),
    /** 每段实际节点数（五段全在，含 0）。 */
    segmentCounts: z.record(CausalSegmentSchema, z.number().int().min(0)),
    /** ★ 诚实缺席：哪几段没有数据源 + 缺什么 + 需要接什么。空段必有条目（superRefine ①）。 */
    segmentGaps: z.array(CausalSegmentGapSchema),
    /**
     * **边级**诚实缺席（段级的在 `segmentGaps`）。
     *
     * 有些真值**存在**、因而节点抽得出来，但**把它接到上游的那条边所需的字段不存在**。
     * 实测两例（都写进了构图器）：
     *  · `DelayedContribution` 只记 `{arriveTick, target*, amount, ruleKey}`，**不记 `fromObjectId`**
     *    ⇒ 延迟到达的贡献知道"来自哪条规则"，但不知道"来自哪个源对象" —— 边补不出来。
     *  · `POST /perturbations` 对建单时已生效的扰动走 `simApplyAtCurrentTick`，该路**原样保留旧 trace、
     *    不写新 trace** ⇒ 这条扰动在世界上真的落了地，却没有任何 trace 行承载它的落点。
     *
     * 两例的正确处置都是「出节点、不出边、把缺口写在这里」——
     * 而**不是**猜一个 `fromObjectId` 把边补上（那是现编），也不是把节点一起丢掉（那是瞒报）。
     */
    caveats: z.array(z.string().min(1)),
  })
  .superRefine((g, ctx) => {
    // ── 前置：段计数必须与 nodes 一致，且五段齐全（否则下面两条校验都建立在假数上）──
    const actual = new Map<CausalSegment, number>(CAUSAL_SEGMENTS.map((s) => [s, 0]));
    for (const n of g.nodes) actual.set(n.segment, (actual.get(n.segment) ?? 0) + 1);
    for (const seg of CAUSAL_SEGMENTS) {
      const declared = g.segmentCounts[seg];
      if (declared === undefined) {
        ctx.addIssue({ code: "custom", path: ["segmentCounts", seg], message: `segmentCounts 必须五段齐全，缺 "${seg}"` });
        continue;
      }
      if (declared !== actual.get(seg)) {
        ctx.addIssue({
          code: "custom",
          path: ["segmentCounts", seg],
          message: `segmentCounts.${seg}=${declared} 与 nodes 实际 ${actual.get(seg)} 不符（冗余字段漂移 = 第二套真相源）`,
        });
      }
    }

    const gapSegs = new Set(g.segmentGaps.map((x) => x.segment));
    for (const [i, x] of g.segmentGaps.entries()) {
      if (g.segmentGaps.findIndex((y) => y.segment === x.segment) !== i) {
        ctx.addIssue({ code: "custom", path: ["segmentGaps", i], message: `同一段 "${x.segment}" 出现多条 gap（缺席原因必须唯一）` });
      }
    }

    for (const seg of CAUSAL_SEGMENTS) {
      const count = actual.get(seg) ?? 0;
      // ① 空段 ⇒ 必须说清缺什么（诚实缺席不许静默：空白比错答更容易被当成"没问题"）。
      if (count === 0 && !gapSegs.has(seg)) {
        ctx.addIssue({
          code: "custom",
          path: ["segmentGaps"],
          message:
            `段 "${seg}" 一个节点都没有，却没有对应的 segmentGaps 条目 —— ` +
            `返回安静的空数组 = 把「这段没数据」渲染成「这段没问题」。必须写明 missing/needs。`,
        });
      }
      // ② 有节点却仍声明 gap ⇒ 自相矛盾。
      if (count > 0 && gapSegs.has(seg)) {
        ctx.addIssue({
          code: "custom",
          path: ["segmentGaps"],
          message: `段 "${seg}" 已有 ${count} 个节点，不得同时声明 segmentGaps（自相矛盾）`,
        });
      }
    }

    // ③ 零悬空边 + ④ 边种类与两端实际段一致（段序不可倒流）。
    const bySeg = new Map(g.nodes.map((n) => [n.nodeId, n.segment]));
    if (bySeg.size !== g.nodes.length) {
      ctx.addIssue({ code: "custom", path: ["nodes"], message: "nodeId 必须唯一（重复 id ⇒ 边指向歧义）" });
    }
    for (const [i, e] of g.edges.entries()) {
      const from = bySeg.get(e.fromNodeId);
      const to = bySeg.get(e.toNodeId);
      if (from === undefined) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "fromNodeId"], message: `悬空边：起点 "${e.fromNodeId}" 不在 nodes 中` });
      }
      if (to === undefined) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "toNodeId"], message: `悬空边：终点 "${e.toNodeId}" 不在 nodes 中` });
      }
      if (from === undefined || to === undefined) continue;
      const [wantFrom, wantTo] = CAUSAL_EDGE_SEGMENTS[e.kind];
      if (from !== wantFrom || to !== wantTo) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", i, "kind"],
          message:
            `边 kind="${e.kind}" 声明 ${wantFrom}→${wantTo}，但两端实际是 ${from}→${to}。` +
            `边的种类不是装饰标签，它就是段序声明（CAUSAL_EDGE_SEGMENTS 单源）。`,
        });
      }
    }
  });
export type DecisionGraph = z.infer<typeof DecisionGraphSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 7 · 纯函数工具（构图器与前端共用，禁各写一份）
// ══════════════════════════════════════════════════════════════════════════

/** 从节点数组算五段计数（`segmentCounts` 的**唯一**产出口）。 */
export function countCausalSegments(nodes: readonly CausalNode[]): Record<CausalSegment, number> {
  const out = Object.fromEntries(CAUSAL_SEGMENTS.map((s) => [s, 0])) as Record<CausalSegment, number>;
  for (const n of nodes) out[n.segment] += 1;
  return out;
}

/**
 * 从某个节点出发，沿边前向可达的节点 id 集合（含自身）。稳定排序（R6）。
 *
 * 判据①「改因真的改果」要用它划出「受影响的分支」与「未受影响的分支」：
 * 未受影响的分支必须**逐字节不变**，而"未受影响"只能由图本身定义，不能由测试作者手点。
 */
export function causalDownstream(graph: Pick<DecisionGraph, "edges">, fromNodeId: string): string[] {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) (out.get(e.fromNodeId) ?? out.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId);
  const seen = new Set<string>([fromNodeId]);
  const stack = [fromNodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const nx of (out.get(cur) ?? []).slice().sort((a, b) => a.localeCompare(b))) {
      if (!seen.has(nx)) {
        seen.add(nx);
        stack.push(nx);
      }
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * 图上是否**每条边**都指得回一个真产物（判据②的机器判据）。
 * 返回违规边 id 列表（空 = 全可溯）。
 *
 * 注意：`provenance` 是必填字段，schema 已挡住"没有溯源块"；本函数挡的是更隐蔽的一层——
 * **溯源块在，但指的不是这张图的来源**（如 refId 里没有本图 source 的 refId、
 * 或量化边的 producedBy 是空）。「有 provenance 字段」≠「指得回去」，这正是本仓
 * 「只有 test 引用 = 已排练，不是已实现」同形态的坑。
 */
export function causalEdgesWithoutProvenance(graph: Pick<DecisionGraph, "edges">): string[] {
  return graph.edges
    .filter((e) => {
      if (e.provenance.refId.trim() === "") return true;
      // 量化边（搬运了一个数）必须说清是哪条规则/求解器算的 —— 人建/外部回填的边不搬数。
      if (e.amount !== null && e.provenance.producedBy === null) return true;
      return false;
    })
    .map((e) => e.edgeId)
    .sort((a, b) => a.localeCompare(b));
}
