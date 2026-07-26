import type { Answer, AnswerBlock, MultiIntentPlan, ProvenanceRef } from "@platform/contracts";

/**
 * WO-MULTI-INTENT-P1 · 跨域/多意图编排（L1 独立多意图）——**纯函数核**（R6·无随机/无时钟/无 I/O）。
 *
 * 定位（本体 §3 QOS 编排链·多意图分路节点·§8 G-PORTFOLIO-LOCAL-ONLY 诚实边界）：
 *  一个复杂问句里若含**多个相互独立**的子问题，平台应**同时**跑对口的多个 solver、把各自 grounded 的结论
 *  **确定性块装配**成一份带溯源的综合答案——而不是只答置信度最高的那一个，也不是频繁反问澄清。
 *
 * 诚实边界（本模块的灵魂）：本期只做**独立**多意图（一因多果·果与果不相互影响）。**耦合**型依赖链推演
 *  （转拨→产能→延误→外协）**不在本期**——它需联合求解（L3·复用 solve_portfolio 守恒）。本模块对**检出耦合**的
 *  子意图**仍并行各自独立测算**，但综合答案**诚实标注**"独立测算·未链式传导·见 L3"，**绝不假装做了联合**
 *  （拿并行独立 solver 硬做只会得"数字各自对·合起来不勾稽"的假综合——绿测试≠能用）。
 */

// ---------------------------------------------------------------------------
// solverDepGraph（静态声明表·独立性检查的诚实标签源·治 G-PORTFOLIO-LOCAL-ONLY）
// ---------------------------------------------------------------------------
/**
 * solver 间**已知依赖**的静态声明（无向耦合对）。两 solver 之间有边 = 它们的结论**不相互独立**：
 * 后者的输入本应依赖前者的产物（残差/转拨后产能/延误集），并行各自用**原始输入**跑 → 合起来不勾稽。
 *
 * 病根锚（本体 §8 G-PORTFOLIO / Q1 依赖链）：`转拨后产能(capacity_forecast) → 延误订单(affected_orders)
 * → 外协/加班(outsourcing_split)`，外加长协/季度缺口约束。真解在 L3（联合求解 solve_portfolio 共享产能守恒）。
 */
export const SOLVER_DEP_GRAPH: ReadonlyArray<readonly [string, string]> = [
  // 外协/加班量依赖"转拨后残余产能"与"被挤延误的订单集"——链末端，耦合最重。
  ["outsourcing_split", "capacity_forecast"],
  ["outsourcing_split", "affected_orders"],
  ["outsourcing_split", "quarterly_gap"],
  ["outsourcing_split", "lta_gap"],
  // 被挤延误的订单依赖"转拨后产能"（改产能→改哪些单延误）。
  ["affected_orders", "capacity_forecast"],
  // 季度/长协缺口残差彼此串联（长协覆盖后的残差才进季度缺口/外协）。
  ["lta_gap", "quarterly_gap"],
  ["quarterly_gap", "capacity_forecast"],
];

/** 两 solver 是否已知耦合（无向查 solverDepGraph）。 */
export function solversCoupled(a: string, b: string): boolean {
  return SOLVER_DEP_GRAPH.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// ---------------------------------------------------------------------------
// 多意图判定（selectMultiIntent·纯函数 R6·插在 top-1 路由 _和_ clarification 之前）
// ---------------------------------------------------------------------------
export interface MultiIntentCandidateInput {
  intentKey: string;
  confidence: number;
  /** 该意图对口 solver（orchestrator 从 plan 首个 invoke_solver 步解析）。 */
  solverKey: string;
  /** 该意图**必填**槽位名（intent.slots.required）。 */
  requiredSlots: string[];
  /** 共享 slotBag + pageContext 实际能抽满的槽位名（orchestrator 经 fillSlots 探针求得）。 */
  filledSlots: string[];
  /** 分节标题（意图展示名·域标签）。 */
  sectionTitle: string;
}

export interface SelectedIntent {
  intentKey: string;
  confidence: number;
  solverKey: string;
  sectionTitle: string;
}

export interface MultiIntentSelection {
  selected: SelectedIntent[];
  /** 独立性检查检出的耦合对（intentKey 对·非空即综合诚实标"未链式传导·见 L3"）。 */
  coupledPairs: [string, string][];
}

export interface SelectMultiIntentOpts {
  tauMid: number;
  maxIntents: number;
}

/**
 * 判定是否走多意图并行路径。命中 → { selected(≥2), coupledPairs }；否则 null → **逐字节沿用现单意图路径**。
 *
 * 步骤（PRD §3.2）：① ≥2 候选 confidence≥tauMid ② 每入选意图**必填槽**能从共享 slotBag+pageContext 抽满
 * （抽不满即丢弃该意图·绝不带缺槽跑错答）③ 无 scope 冲突（同 solver 只保留一个·避免重复占用/歧义）
 * ④ 独立性检查（查 solverDepGraph·检出依赖对标进 coupledPairs·L1 仍并行但综合诚实标）⑤ 上界 MAX_INTENTS。
 */
export function selectMultiIntent(
  candidates: MultiIntentCandidateInput[],
  opts: SelectMultiIntentOpts,
): MultiIntentSelection | null {
  // ① 多候选高置信。
  const highConf = candidates.filter((c) => c.confidence >= opts.tauMid);
  // ② 必填槽可满足（抽不满即丢弃该意图）。
  const satisfiable = highConf.filter((c) => c.requiredSlots.every((s) => c.filledSlots.includes(s)));
  // ③ 无 scope 冲突：同一 solver 只保留第一个（置信更高者·candidates 已按置信降序）。
  const seenSolvers = new Set<string>();
  const distinct: MultiIntentCandidateInput[] = [];
  for (const c of satisfiable) {
    if (seenSolvers.has(c.solverKey)) continue;
    seenSolvers.add(c.solverKey);
    distinct.push(c);
  }
  // ⑤ 上界。
  const capped = distinct.slice(0, Math.max(0, opts.maxIntents));
  // 命中条件：≥2 个独立可满足子意图；否则 null（沿用单意图路径）。
  if (capped.length < 2) return null;

  // ④ 独立性检查：两两查 solverDepGraph，检出耦合对。
  const coupledPairs: [string, string][] = [];
  for (let i = 0; i < capped.length; i++) {
    for (let j = i + 1; j < capped.length; j++) {
      if (solversCoupled(capped[i]!.solverKey, capped[j]!.solverKey)) {
        coupledPairs.push([capped[i]!.intentKey, capped[j]!.intentKey]);
      }
    }
  }

  return {
    selected: capped.map((c) => ({
      intentKey: c.intentKey,
      confidence: c.confidence,
      solverKey: c.solverKey,
      sectionTitle: c.sectionTitle,
    })),
    coupledPairs,
  };
}

// ---------------------------------------------------------------------------
// 确定性块装配（零 LLM·<50ms·R6/R13·assembleMultiIntentAnswer·纯函数）
// ---------------------------------------------------------------------------
/** 单子意图并行执行结果（orchestrator 经 runWorkflowSteps 真跑对口 solver 得到）。 */
export interface MultiIntentSubResult {
  intentKey: string;
  confidence: number;
  solverKey: string;
  sectionTitle: string;
  /** 派入该 solver 的槽位（留痕·R13）。 */
  slots: Record<string, unknown>;
  durationMs: number;
  ok: boolean;
  /** ok 时的子答案（path-A workflow 真产物·含 solver_summary 既有投影 + provenance·**不重造**）。 */
  answer?: Answer;
  /** !ok 时的诚实原因（partial·R7·不 hallucinate）。 */
  reason?: string;
}

/** 把子答案 text 块中的 ⟦ref:k⟧ 数字下标按 offset 平移（并入综合 provenance 后仍有效·R13）。 */
function renumberRefs(markdown: string, offset: number): string {
  if (offset === 0) return markdown;
  return markdown.replace(/⟦ref:(\d+)⟧/g, (_m, n: string) => `⟦ref:${Number(n) + offset}⟧`);
}

/** 子答案首句摘要（parallelResults.summary·取首个 text 块首句或 KPI 标签·纯派生·不造数）。 */
function subSummary(sub: MultiIntentSubResult): string {
  if (!sub.ok) return `未计算：${sub.reason ?? "求解失败"}`;
  const ans = sub.answer;
  if (!ans) return "已求解";
  const firstText = ans.blocks.find((b): b is Extract<AnswerBlock, { type: "text" }> => b.type === "text");
  if (firstText) {
    const line = firstText.markdown.split(/[\n。！？!?]/)[0]?.trim();
    if (line) return line.slice(0, 80);
  }
  const kpi = ans.blocks.find((b): b is Extract<AnswerBlock, { type: "kpi" }> => b.type === "kpi");
  if (kpi) return `${kpi.label}=${kpi.value}`;
  return "已求解";
}

/**
 * **确定性块装配**（零 LLM·地板·R6）：每子 solver 的既有投影块（solver_summary·含 KPI/表/规则 + ⟦ref⟧·不重造）
 * 按域拼成分节答案（## 分节 …⟦ref:N⟧），顶部一句总览 + **诚实标签**。
 *
 * 核心洞察（PRD §3.4）：综合方法由"独立性"决定——独立子结论只需"**摆放**"，不需"跨结论推理"。装配就是布局，
 * 故零 LLM 既最快又正确（compose 推理档综合只在**耦合场景=L3**才有价值）。
 *
 * 数字红线（R13·KILL-MOCK-RED）：装配**不造跨结论的新数字**——只摆放各 solver 真出的数；子答案 ⟦ref:k⟧ 按 offset
 * 平移后仍指向并入后 provenance[k+offset]；结构化块（kpi/table/…）携 provId 字符串（并 provenance 后仍唯一有效）。
 */
export function assembleMultiIntentAnswer(
  subs: MultiIntentSubResult[],
  coupledPairs: [string, string][],
): { answer: Answer; plan: MultiIntentPlan } {
  const blocks: AnswerBlock[] = [];
  const provenance: ProvenanceRef[] = [];
  let unverified = false;
  const anyPartial = subs.some((s) => !s.ok);

  // 顶部总览（无裸业务数字·诚实标签）。含耦合 → 头号诚实标（不假综合）。
  const names = subs.map((s) => s.sectionTitle).join("、");
  const coupledNote =
    coupledPairs.length > 0
      ? "\n\n⚠ 诚实边界：本组子结论中检出**相互耦合**的对（产能→延误→外协式依赖链）——本期为各自**独立测算·未链式传导**，" +
        "以下数字各自成立，但**未**按依赖链相互修正；完整**联合方案**需联合求解（solve_portfolio 共享产能守恒），见 L3（本期不做·绝不冒充已完成联合求解）。"
      : "";
  blocks.push({
    type: "text",
    markdown:
      `本答复并行测算了以下**相互独立**的子意图，各自独立溯源（见各节 ⟦ref⟧）：${names}。` +
      "（独立多意图 L1：一因多果、果与果互不影响。）" +
      coupledNote,
  });

  for (const sub of subs) {
    const offset = provenance.length;
    if (sub.ok && sub.answer) {
      const hasProv = sub.answer.provenance.length > 0;
      const headRef = hasProv ? ` ⟦ref:${offset}⟧` : "";
      blocks.push({ type: "text", markdown: `## ${sub.sectionTitle}（求解器 ${sub.solverKey}）${headRef}` });
      provenance.push(...sub.answer.provenance);
      for (const b of sub.answer.blocks) {
        if (b.type === "text") {
          blocks.push({ type: "text", markdown: renumberRefs(b.markdown, offset) });
        } else {
          // 结构化块（table/kpi/rule_violation/action_draft/gap）携 provId 字符串 → 并 provenance 后仍唯一有效，原样并入。
          blocks.push(b);
        }
      }
      unverified = unverified || sub.answer.unverifiedNumerics;
    } else {
      // partial（R7）：该节诚实标"未计算 + 原因"，其余不受影响，无 hallucinate。
      blocks.push({ type: "text", markdown: `## ${sub.sectionTitle}（求解器 ${sub.solverKey}）` });
      blocks.push({
        type: "text",
        markdown: `本节**未计算**：${sub.reason ?? "求解失败"}。其余子结论不受影响，此处不臆造任何数字。`,
      });
    }
  }

  const plan: MultiIntentPlan = {
    selectedIntents: subs.map((s) => ({
      intentKey: s.intentKey,
      confidence: s.confidence,
      solverKey: s.solverKey,
      slots: s.slots,
    })),
    parallelResults: Object.fromEntries(
      subs.map((s) => [s.intentKey, { ok: s.ok, durationMs: s.durationMs, summary: subSummary(s) }]),
    ),
    coupledPairs,
    synthesisMode: "deterministic" as const,
  };

  // 口径：全部独立子结论且无耦合/无 partial → 各半 VERIFIED_WORKFLOW 的确定性装配仍是"数据库事实"；
  // 检出耦合或有 partial → 标 AGENT_EXPLORATORY（触发人工复核·decision-trace humanReviewRequired·诚实不冒充）。
  const trustLevel: Answer["trustLevel"] =
    coupledPairs.length > 0 || anyPartial ? "AGENT_EXPLORATORY" : "VERIFIED_WORKFLOW";

  const answer: Answer = { trustLevel, blocks, provenance, unverifiedNumerics: unverified };
  return { answer, plan };
}
