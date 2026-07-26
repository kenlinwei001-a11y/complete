import type { Answer, AnswerBlock, MultiIntentPlan, ProvenanceRef } from "@platform/contracts";
import { newId } from "../ids.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import { summarizeSolverOutput } from "../workflow/executor.js"; // 统一单 步1：复用既有 solver_summary 投影（KPI/表/规则·不重造）
import { DETERMINISTIC_PREFERENCE_THRESHOLD, type DomainRoute } from "./domain-resolver.js";

/**
 * WO-DETERMINISTIC-CROSS-DOMAIN · 确定性多域分路的**判定 + 后半（并行 solver + 零 LLM 块装配 + 耦合诚实标）**。
 *
 * 定位（本体 §3 编排链·确定性多域分路节点·排在 LLM classify 之前）：`domain-resolver.ts domainResolveMulti` 出逐域
 * `DomainRoute[]` → `selectDeterministicMultiRoute` 判定是否够格走确定性多路 → `runDeterministicMultiPath` **并行**跑
 * 各域 solver（复用 path-A 的 `executor.run("invoke_solver")` 通道·**全程不经 runAgentLoop/classify**）→ **确定性块装配**
 * （零 LLM·每域独立 `⟦ref:N⟧`）。
 *
 * 不变量：
 *  - **R6**：判定 + 装配纯函数（无随机/时钟）；同问句同解 → 字节一致装配。
 *  - **R13 / KILL-MOCK-RED**：每域独立溯源；检出耦合诚实标"独立测算·未链式传导·见 L3"；**装配不造跨域新数字**
 *    （只摆放各 solver 真出的产物·业务数字经 `⟦ref:N⟧` 溯到该域 invoke_solver 审计·综合步零编造）。
 *  - **R7 / partial**：单 solver 失败该域诚实标"未计算 + 原因"·不塌其余·不 hallucinate。
 */

/** 装配上界（统一单：Q2 五域全覆盖 → 5；防扇出爆炸的确定性硬帽·非静默常态截断）。 */
const MAX_DOMAINS = 5;

/**
 * 统一单 步1b · `SOLVER_DEP_GRAPH`——solver 间**已知耦合对**静态声明表（无向·治 G-PORTFOLIO-LOCAL-ONLY 的诚实标签源）：
 * 并行独立测算对**独立**solver 安全，对**耦合**solver 仅能诚实标"独立测算·未链式传导"——真解在 L3（solve_portfolio 守恒·
 * 届时本表从"标注"升级为"路由信号"）。合并来源：det-cross-domain 原 2 对（供需/重排→交期）⊕ multi-intent-p1 donor 7 对
 * ⊕ 统一单 `*←lta_gap`（长协物料约束波及产能/交期/良率）。
 */
export const SOLVER_DEP_GRAPH: ReadonlyArray<readonly [string, string]> = [
  ["supply_demand_gap_attribution", "atp_check"],
  ["sop_reschedule", "atp_check"],
  ["outsourcing_split", "capacity_forecast"],
  ["outsourcing_split", "affected_orders"],
  ["outsourcing_split", "quarterly_gap"],
  ["outsourcing_split", "lta_gap"],
  ["affected_orders", "capacity_forecast"],
  ["lta_gap", "quarterly_gap"],
  ["quarterly_gap", "capacity_forecast"],
  // *←lta_gap：长协/物料约束对产能与交期与良率的物料侧传导（统一单 步1b）。
  ["lta_gap", "capacity_forecast"],
  ["lta_gap", "affected_orders"],
  ["lta_gap", "yield_diagnosis"],
];

/** 两 solver 是否已知耦合（无向·⑤ 判定与装配共用）。 */
export function solversCoupled(a: string, b: string): boolean {
  return SOLVER_DEP_GRAPH.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** 硬域族 → 中文分节名（装配可读·不含业务数字；route.label 优先·此表兜底）。 */
const DOMAIN_LABELS: Record<string, string> = {
  credit: "信用敞口",
  margin: "量价本利/毛利",
  supply: "供需失衡",
  atp: "交期/订单承诺",
  sop: "产销重排",
  yield: "良率诊断",
  output: "产能/有效产出",
  lta: "长协覆盖",
  delay: "交期延误/受影响订单",
  outsource: "外协/加班补缺",
};

/**
 * 确定性多路判定（R6 纯函数）：≥2 域**各自** `perDomainScore ≥ THRESHOLD`（复用单域门同尺度阈值）**且**各有对口 solver
 * → 返回入选逐域路由（截到 `MAX_DOMAINS`）；否则返回 `null`（→ 上游**逐字节沿用**现路径：先单域确定性·再 LLM）。
 *
 * **诚实边界**：任一枚举出的域**不够格**（置信 <阈值 / 无 solver·如真开放/需编排的域被 orchestration/open 惩罚压低）→
 * **整体回落 null**（不硬凑·绝不带缺格域跑出"看着全、数字不勾稽"的假组合方案）。耦合诚实标在装配层单独处理（不影响判定）。
 */
export function selectDeterministicMultiRoute(
  routes: DomainRoute[],
  threshold: number = DETERMINISTIC_PREFERENCE_THRESHOLD,
): DomainRoute[] | null {
  if (routes.length < 2) return null;
  const qualified = routes.filter((r) => r.perDomainScore >= threshold && Boolean(r.solverKey));
  if (qualified.length < 2) return null;
  // 诚实边界：任一枚举域不够格 → 整体回落（不硬凑）。
  if (qualified.length !== routes.length) return null;
  return qualified.slice(0, MAX_DOMAINS);
}

/** 检出入选路由集里的已知耦合对（诚实标源·R6·空 = 纯独立；按 solverKey 匹配·route/solverKey 同名域两可）。 */
export function detectCoupledPairs(routes: DomainRoute[]): [string, string][] {
  const present = new Set(routes.flatMap((r) => [r.route, r.solverKey]));
  const out: [string, string][] = [];
  for (const [a, b] of SOLVER_DEP_GRAPH) {
    if (present.has(a) && present.has(b)) out.push([a, b]);
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
interface DomainProduct {
  route: DomainRoute;
  toolCallId: string;
  ok: boolean;
  outcome: string;
  durationMs: number;
  data: unknown;
  snapshotVersion?: string;
}

/**
 * 确定性块装配（**零 LLM 地板**·R6 纯函数）：各域 solver 产物按域拼成**分节答案**，顶部一句总览 + 耦合诚实标；
 * 每节独立 `⟦ref:N⟧`（↔ `provenance[N]` ↔ 该域 invoke_solver 审计）。**综合步不造任何跨域新数字**——业务数值一律溯到
 * 各域产物；失败域诚实标"未计算 + 原因"（R7·partial·不 hallucinate）。
 */
export function assembleMultiDomainAnswer(
  products: DomainProduct[],
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
    `【确定性多域分路·零 LLM 块装配】以下 ${products.length} 个子域各自**独立**测算（并行 solver·每节独立溯源）：`,
  ];
  if (coupledPairs.length > 0) {
    const pairText = coupledPairs.map(([a, b]) => `${a}↔${b}`).join("、");
    overviewLines.push(
      `⚠ 检出耦合子结论（${pairText}）：本期为**独立测算·未链式传导**，完整联合方案见 L3（solve_portfolio 守恒）。`,
    );
  }

  const sectionBlocks: AnswerBlock[] = products.flatMap((p, i) => {
    const label = p.route.label ?? DOMAIN_LABELS[p.route.domain] ?? p.route.domain;
    if (!p.ok) {
      // R7 诚实 gap：该域未计算 + 原因（不 hallucinate·不占位假数）。
      return [
        {
          type: "text" as const,
          markdown: `## ${label}（${p.route.solverKey}）\n该域未计算（原因：${p.outcome}）——诚实标·不臆造。`,
        },
      ];
    }
    // 统一单 步1：**复用既有 solver_summary 投影**（KPI/表/规则块·provId 溯到本域 provenance[i]·不重造投影不写裸数）。
    // 投影里的规则依据文本带 ⟦ref:0⟧（单 solver 语境的下标假设）→ 平移为本域下标 ⟦ref:${i}⟧（provId 型 KPI/表块免平移）。
    const projected = summarizeSolverOutput(p.data, provenance[i]!.id).map((b) =>
      b.type === "text" ? { ...b, markdown: b.markdown.replace(/⟦ref:0⟧/g, `⟦ref:${i}⟧`) } : b,
    );
    return [
      {
        type: "text" as const,
        markdown: `## ${label}（${p.route.solverKey}）\n本域确定性测算完成（每值溯 ⟦ref:${i}⟧）：`,
      },
      ...projected,
    ];
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
 * 确定性多域后半（R6·零 LLM）：**并行**跑各域 solver（单失败不塌·partial 容错）→ 确定性块装配 → 产出 Answer + `multiIntentPlan`。
 * `classification.model="deterministic:multi-domain"` 由调用方（orchestrator）置。事件复用 `step.completed` 伪 step
 * （type=det_multi_domain_dispatch / _solver / _synthesis·同多意图 PRD 做法·`ontology:check` 保 51/51·不新增事件名）。
 */
export async function runDeterministicMultiPath(
  routes: DomainRoute[],
  coupledPairs: [string, string][],
  ctx: MultiRunCtx,
  routeSource: MultiIntentPlan["routeSource"] = "deterministic-multi-domain",
): Promise<MultiRunResult> {
  await ctx.emit?.("step.completed", {
    stepId: newId("det-multi-dispatch"),
    type: "det_multi_domain_dispatch",
    outcome:
      `${routeSource === "llm-multi-intent" ? "多意图并行（⑤ LLM 兜底·同一确定性后半）" : "确定性多域分路（零 LLM）"}：` +
      `${routes.map((r) => `${r.domain}→${r.solverKey}`).join("、")}` +
      (coupledPairs.length > 0 ? `｜耦合 ${coupledPairs.length} 对（诚实标·未链式传导）` : "｜纯独立"),
    durationMs: 0,
  });

  // 并行执行各域 solver（无依赖·组内并发·R7 单失败不塌）。产物顺序按 routes 声明稳定（R6·⟦ref:N⟧ 对齐）。
  const products: DomainProduct[] = await Promise.all(
    routes.map(async (route): Promise<DomainProduct> => {
      const run = await ctx.executor.run("invoke_solver", { solverKey: route.solverKey, args: route.args });
      const { data, snapshotVersion } = extractData(run.payload);
      await ctx.emit?.("step.completed", {
        stepId: newId("det-multi-solver"),
        type: "det_multi_domain_solver",
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

  const answer = assembleMultiDomainAnswer(products, coupledPairs);

  await ctx.emit?.("step.completed", {
    stepId: newId("det-multi-synth"),
    type: "det_multi_domain_synthesis",
    outcome: `确定性块装配（零 LLM·${products.length} 域·${products.filter((p) => p.ok).length} 成功）`,
    durationMs: 0,
  });

  const plan: MultiIntentPlan = {
    routeSource,
    synthesisMode: "deterministic",
    selectedIntents: products.map((p) => ({
      intentKey: p.route.domain,
      confidence: p.route.perDomainScore,
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
