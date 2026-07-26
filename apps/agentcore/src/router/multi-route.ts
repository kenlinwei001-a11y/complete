import type { Answer, AnswerBlock, MultiIntentPlan, ProvenanceRef } from "@platform/contracts";
import { newId } from "../ids.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import type { DomainRoute } from "./domain-resolver.js";

/**
 * WO-QOS-CROSS-DOMAIN-UNIFIED · **共享后半**（②确定性多域 + ⑤LLM 多意图 **共用一份**·§3.4）——
 * 并行 solver（barrier·单失败不塌·R7）→ **确定性块装配**（零 LLM·每域独立 `⟦ref:N⟧`·R6）→ **耦合诚实标**
 * （查 `SOLVER_DEP_GRAPH`·检出依赖对→顶部标"独立测算·未链式传导·见 L3"·R13）→ 发 `step.completed` 伪 step
 * （不新增 §8.2 事件名·`ontology:check` 保 51/51）。
 *
 * 定位（本体 §3 编排链·多路分路节点）：
 *   ②：`domain-resolver.domainResolveMulti → selectDeterministicMultiRoute`（排在 Coordinator 之前·零 LLM 前半）→ 本后半。
 *   ⑤：`orchestrator.classify → selectMultiIntent`（classify 后 clarification 前·LLM 多候选前半）→ 同本后半。
 * `routeSource` 区分前半 trigger；后半（并行 + 装配 + 诚实标）**逐字节同款**。
 *
 * 不变量：
 *  - **R6**：判定 + 装配纯函数（无随机/时钟）；同问句同解 → 字节一致装配。
 *  - **R13 / KILL-MOCK-RED**：每域独立溯源；检出耦合诚实标；**装配不造跨域新数字**（只摆放各 solver 真产物·业务数字
 *    经 `⟦ref:N⟧` 溯到该域 invoke_solver 审计·综合步零编造·**绝不假装耦合综合**）。
 *  - **R7 / partial**：单 solver 失败该域诚实标"未计算 + 原因"·不塌其余·不 hallucinate。
 */

/** 装配上界（env QOS_MULTI_INTENT_MAX_INTENTS 语义·默认 4·由调用方截断后传入）。 */
export const MAX_ROUTES = 4;

/**
 * `SOLVER_DEP_GRAPH`（静态声明·**耦合诚实标签源**·治 G-PORTFOLIO-LOCAL-ONLY / 本体 §8）：两 solver 有边 = 结论
 * **不相互独立**（后者输入本应依赖前者产物：残差/转拨后产能/延误集），并行各自用**原始输入**跑 → 合起来不勾稽。
 * 真解在 L3（`solve_portfolio` 守恒·转拨→产能→延误→外协真传导）。**只用于诚实标**（L1 不真做耦合=L3·步3）。
 *
 * 病根锚（Q1/Q2 依赖链）：`转拨后产能(capacity_forecast) → 延误订单(affected_orders) → 外协/加班(outsourcing_split)`，
 * 外加长协/季度缺口物料约束（`*←lta_gap`）。
 */
export const SOLVER_DEP_GRAPH: ReadonlyArray<readonly [string, string]> = [
  // 外协/加班量依赖"转拨后残余产能"与"被挤延误的订单集"——链末端·耦合最重。
  ["outsourcing_split", "capacity_forecast"],
  ["outsourcing_split", "affected_orders"],
  ["outsourcing_split", "quarterly_gap"],
  ["outsourcing_split", "lta_gap"],
  // 被挤延误的订单依赖"转拨后产能"（改产能 → 改哪些单延误）。
  ["affected_orders", "capacity_forecast"],
  // 季度/长协缺口残差彼此串联（长协覆盖后残差才进季度缺口/外协）·物料约束。
  ["lta_gap", "quarterly_gap"],
  ["quarterly_gap", "capacity_forecast"],
  // 供需↔交期（既有独立多域例的耦合对·SEAM-4）。
  ["supply_demand_gap_attribution", "affected_orders"],
];

/** 两 solver 是否已知耦合（无向查 SOLVER_DEP_GRAPH）。 */
export function solversCoupled(a: string, b: string): boolean {
  return SOLVER_DEP_GRAPH.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** RouteSpec：并行后半的统一输入（② DomainRoute 与 ⑤ 多意图候选都投影成它）。 */
export interface RouteSpec {
  /** 分节 key（域名 ② / 意图 key ⑤·审计/装配用）。 */
  domain: string;
  /** 落地确定性路由（沿用既有 route 名）。 */
  route: string;
  /** 对口确定性求解器 key（金库真名）。 */
  solverKey: string;
  /** 中文分节标题（装配可读·不含业务数字）。 */
  sectionTitle: string;
  /** 派入该 solver 的 args（留痕·R13）。 */
  args: Record<string, unknown>;
  /** 该路置信（② perDomainScore / ⑤ candidate confidence）。 */
  confidence: number;
}

/** DomainRoute[]（② 前半产物）→ RouteSpec[]（后半输入）。 */
export function domainRoutesToSpecs(routes: DomainRoute[]): RouteSpec[] {
  return routes.map((r) => ({
    domain: r.domain,
    route: r.route,
    solverKey: r.solverKey,
    sectionTitle: r.sectionTitle,
    args: r.args,
    confidence: r.perDomainScore,
  }));
}

/** 检出入选路由集里的已知耦合对（按 **solverKey** 两两查·诚实标源·R6·空 = 纯独立）。返回 [domain,domain] 对。 */
export function detectCoupledPairs(routes: RouteSpec[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      if (solversCoupled(routes[i]!.solverKey, routes[j]!.solverKey)) {
        out.push([routes[i]!.domain, routes[j]!.domain]);
      }
    }
  }
  return out;
}

/** ToolPayload 一般为 {data, snapshotVersion}；取其 data 作为求解器业务产物（无 data 字段则退回整体）。 */
function extractData(payload: unknown): { data: unknown; snapshotVersion?: string } {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    const p = payload as Record<string, unknown>;
    const snap = typeof p.snapshotVersion === "string" ? p.snapshotVersion : undefined;
    return snap ? { data: p.data, snapshotVersion: snap } : { data: p.data };
  }
  return { data: payload };
}

/** 单域并行执行产物（留痕·装配输入）。 */
interface RouteProduct {
  route: RouteSpec;
  toolCallId: string;
  ok: boolean;
  outcome: string;
  durationMs: number;
  data: unknown;
  snapshotVersion?: string;
}

/** 从 solver 产物**确定性**提取一句 KPI 摘要（**不造数**·只摆放 solver 真出的字段·缺则空）。 */
function projectSummaryLine(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const s = d.summary;
  if (typeof s === "string" && s.length > 0) return s.split(/[\n。！？!?]/)[0]!.slice(0, 80);
  return "";
}

/**
 * 确定性块装配（**零 LLM 地板**·R6 纯函数·§3.4）：各域 solver 产物按域拼成**分节答案**，顶部一句总览 + 耦合诚实标；
 * 每节独立 `⟦ref:N⟧`（↔ `provenance[N]` ↔ 该域 invoke_solver 审计）。**综合步不造任何跨域新数字**——业务数值一律溯到
 * 各域产物；失败域诚实标"未计算 + 原因"（R7·partial·不 hallucinate）。**绝不出现"已给联合/组合方案"措辞**（防假综合）。
 */
export function assembleMultiRouteAnswer(
  products: RouteProduct[],
  coupledPairs: [string, string][],
): Answer {
  // R13：每域一条 provenance（source=TOOL_RESULT·指向该域 invoke_solver 审计）·⟦ref:N⟧ ↔ provenance[N]。
  const provenance: ProvenanceRef[] = products.map((p) => ({
    id: newId("prov"),
    source: "TOOL_RESULT" as const,
    toolCallId: p.toolCallId,
    toolName: "invoke_solver",
    outputPath: "$",
    ...(p.snapshotVersion ? { snapshotVersion: p.snapshotVersion } : {}),
  }));

  const overviewLines = [
    `【跨域多路·零 LLM 块装配】以下 ${products.length} 个子域各自**独立**测算（并行 solver·每节独立溯源）：`,
  ];
  if (coupledPairs.length > 0) {
    const pairText = coupledPairs.map(([a, b]) => `${a}↔${b}`).join("、");
    overviewLines.push(
      `⚠ 检出耦合子结论（${pairText}）：本期为**各子结论独立测算·未链式传导**（如转拨对延误/外协影响未计），` +
        `完整联合方案见 L3（solve_portfolio 守恒）。`,
    );
  }

  const sectionBlocks: AnswerBlock[] = products.map((p, i) => {
    const label = p.route.sectionTitle || p.route.domain;
    if (!p.ok) {
      // R7 诚实 gap：该域未计算 + 原因（不 hallucinate·不占位假数）。
      return {
        type: "text" as const,
        markdown: `## ${label}（${p.route.solverKey}）\n该域未计算（原因：${p.outcome}）——诚实标·不臆造。`,
      };
    }
    const kpiLine = projectSummaryLine(p.data);
    // 零 LLM 装配：只"摆放"该域 solver 真产物的溯源指针；业务数字经 ⟦ref:${i}⟧ 溯到该域产物（本步不写任何裸数）。
    return {
      type: "text" as const,
      markdown:
        `## ${label}（${p.route.solverKey}）\n本域确定性测算完成，结论与数值见 ⟦ref:${i}⟧。` +
        (kpiLine ? `\n> ${kpiLine} ⟦ref:${i}⟧` : ""),
    };
  });

  const blocks: AnswerBlock[] = [{ type: "text", markdown: overviewLines.join("\n") }, ...sectionBlocks];

  return {
    trustLevel: "VERIFIED_WORKFLOW", // 确定性 solver 产物 + 零 LLM 装配（非 agent 探索·不冒充也不降格）
    blocks,
    provenance,
    unverifiedNumerics: false, // 装配不写裸业务数字（一律 ⟦ref⟧ 溯源）→ 无未溯源数
  };
}

export interface MultiRunCtx {
  /** path-A invoke 通道（makeExecutor 产物）——多路复用之·绝不另起 runAgentLoop（分水岭：确定性多路绝不落 agent 盲选）。 */
  executor: GuardedToolExecutor;
  /** 逐步/诊断事件（复用既有 `step.completed` 伪 step·不新增 §8.2 事件名）。 */
  emit?: (event: string, payload: unknown) => Promise<void>;
}

export interface MultiRunResult {
  answer: Answer;
  plan: MultiIntentPlan;
}

/**
 * **共享后半**（R6·零 LLM·②⑤ 共用）：**并行**跑各路 solver（单失败不塌·partial 容错·R7）→ 确定性块装配 → 产出
 * Answer + `multiIntentPlan`。`classification.model` 由调用方（orchestrator）置。事件复用 `step.completed` 伪 step
 * （type=multi_route_dispatch / _solver / _synth·不新增 §8.2 事件名·`ontology:check` 保 51/51）。
 *
 * @param routeSource `deterministic-multi-domain`（②）或 `llm-multi-intent`（⑤）——**仅前半 trigger 不同·后半同款**。
 */
export async function runParallelRoutes(
  routes: RouteSpec[],
  coupledPairs: [string, string][],
  routeSource: MultiIntentPlan["routeSource"],
  ctx: MultiRunCtx,
): Promise<MultiRunResult> {
  const capped = routes.slice(0, MAX_ROUTES);
  await ctx.emit?.("step.completed", {
    stepId: newId("multi-route-dispatch"),
    type: "multi_route_dispatch",
    outcome:
      `跨域多路（${routeSource}·零 LLM）：${capped.map((r) => `${r.domain}→${r.solverKey}`).join("、")}` +
      (coupledPairs.length > 0 ? `｜耦合 ${coupledPairs.length} 对（诚实标·未链式传导）` : "｜纯独立"),
    durationMs: 0,
  });

  // 并行执行各路 solver（无依赖·组内并发·R7 单失败不塌）。产物顺序按 routes 声明稳定（R6·⟦ref:N⟧ 对齐）。
  const products: RouteProduct[] = await Promise.all(
    capped.map(async (route): Promise<RouteProduct> => {
      const run = await ctx.executor.run("invoke_solver", { solverKey: route.solverKey, args: route.args });
      const { data, snapshotVersion } = extractData(run.payload);
      await ctx.emit?.("step.completed", {
        stepId: newId("multi-route-solver"),
        type: "multi_route_solver",
        outcome: `${route.domain}·${route.solverKey}:${run.outcome}`,
        durationMs: run.durationMs,
      });
      return {
        route,
        toolCallId: run.toolCallId,
        ok: run.ok,
        outcome: run.outcome,
        durationMs: run.durationMs,
        data,
        ...(snapshotVersion ? { snapshotVersion } : {}),
      };
    }),
  );

  const answer = assembleMultiRouteAnswer(products, coupledPairs);

  await ctx.emit?.("step.completed", {
    stepId: newId("multi-route-synth"),
    type: "multi_route_synth",
    outcome: `确定性块装配（零 LLM·${products.length} 域·${products.filter((p) => p.ok).length} 成功）`,
    durationMs: 0,
  });

  const plan: MultiIntentPlan = {
    routeSource,
    synthesisMode: "deterministic",
    selectedIntents: products.map((p) => ({
      intentKey: p.route.domain,
      confidence: p.route.confidence,
      solverKey: p.route.solverKey,
      slots: p.route.args,
    })),
    parallelResults: Object.fromEntries(
      products.map((p) => [p.route.domain, { ok: p.ok, durationMs: p.durationMs, summary: `${p.route.solverKey}:${p.outcome}` }]),
    ),
    coupledPairs,
  };

  return { answer, plan };
}
