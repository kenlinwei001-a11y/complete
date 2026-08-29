import { BASE_REGISTRY, type Answer, type AnswerBlock, type MultiIntentPlan, type ProvenanceRef } from "@platform/contracts";
import { newId } from "../ids.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import { summarizeSolverOutput } from "../workflow/executor.js";
import type { DomainRoute } from "./domain-resolver.js";

/**
 * PRD-multi-intent-L2L3 · **L3 耦合联合求解**（`qos.multi-intent-l3-coupled`·暗发·P2 先通「转拨→产能→延误→外协」一条链）。
 *
 * L1/L2 是「多个独立答案拼一起」（子结论不互相影响·诚实标"未链式传导"）；L3 把耦合链**映射成一次 `portfolio` 联合解**
 * ——转拨/物料/交期在同一守恒约束（Σ qty·x[i,b,t] ≤ cap[b,t]·capacityLedger 硬校验）下同时定，延误随转拨**真传导**，
 * 外协吃联合解**真残差**。**不新造 solver·不改 portfolio 数学——只做「耦合查询 → portfolio 请求」的映射层**（PRD §7 红线）。
 *
 * 诚实边界（§4.3·KILL-MOCK-RED）：
 *  - 良率↓→cap 缩：现有 `levers` 只支持**加**产能（applyLever 负 delta 为 no-op）·无实测换算系数 → **本环不入联合解·
 *    显式标「近似边界」**（绝不静默注入假换算冒充传导）。
 *  - 转拨只在问句给出**绝对量**时注入 committedBatches（百分比无基数 agentcore 侧不可得 → 标注·不臆造基数）。
 *  - portfolio coeff 缺省兜底 → 标「系数为默认估算」。
 */

/** 「给组合方案/连锁传导」型问句（L3 触发形态判·R6）。 */
export function isCombinationAsk(query: string): boolean {
  return /(组合方案|一揽子|连锁|传导|联动|一并(解|排)|整体方案|(外协|加班).{0,6}(还是|或者?|加)|怎么补|一起(解|排|定))/.test(query ?? "");
}

/** 从问句确定性解析「转拨绝对量」（如「转拨 5万套 给宜宾」「拨 30000 套到成都」）。百分比不注入（无基数·诚实标）。 */
export function parseTransfer(query: string): { base: string; qty: number } | { pctOnly: number } | null {
  const q = query ?? "";
  const abs = q.match(/[转调]?拨\s*(\d+(?:\.\d+)?)\s*(万)?套?\s*(?:给|到|至)\s*([一-龥A-Za-z]{2,6})/);
  if (abs) {
    const qty = Number(abs[1]) * (abs[2] ? 10000 : 1);
    const baseTok = abs[3]!;
    const base = BASE_REGISTRY.find((b) => baseTok.includes(b.name) || baseTok.toLowerCase().includes(b.baseId.toLowerCase()));
    if (base && qty > 0) return { base: base.baseId, qty };
  }
  const pct = q.match(/[转调]?拨\s*(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { pctOnly: Number(pct[1]) };
  return null;
}

export interface L3Mapping {
  /** 一次 portfolio 联合解的 args（globalSim 编排路·真守恒）。 */
  portfolioArgs: Record<string, unknown>;
  /** 近似/未映射环的诚实标（进答案·§4.3）。 */
  approximations: string[];
  /** 检出的耦合对（装配/plan 留痕）。 */
  coupledPairs: [string, string][];
}

/**
 * 耦合链 → 一次 portfolio 请求（R6 确定性映射·零 LLM）：
 * 转拨(绝对量)→committedBatches 预占目标基地净产能 · 长协/物料环→materialConstraint（datacore 侧自动载入 Material/BOM）·
 * 多方案→scenarios · 良率环/百分比转拨→approximations 诚实标（不假映射）。
 */
export function mapCoupledChainToPortfolio(query: string, routes: DomainRoute[], coupledPairs: [string, string][]): L3Mapping {
  const approximations: string[] = [];
  const args: Record<string, unknown> = { globalSim: true, scenarios: ["max_ontime"], seed: 42 };

  const solverSet = new Set(routes.map((r) => r.solverKey));
  if (solverSet.has("lta_gap")) {
    args.materialConstraint = true; // 长协/物料约束入联合解（datacore 自动载入 Material·真物料联合约束）
  }
  const transfer = parseTransfer(query);
  if (transfer && "base" in transfer) {
    args.committedBatches = [{ base: transfer.base, qty: transfer.qty }]; // 转拨=预占目标基地净产能（守恒内真传导）
    approximations.push("转拨预占按首窗记账（持续占用的窗口分布问句未指定·近似）");
  } else if (transfer && "pctOnly" in transfer) {
    approximations.push(`转拨 ${transfer.pctOnly}% 未注入联合解（百分比无绝对基数·不臆造）——按无转拨基线求解`);
  }
  if (solverSet.has("yield_diagnosis") || /良率|直通率/.test(query ?? "")) {
    approximations.push("良率↓→产能缩换算无实测系数（现有杠杆仅支持加产能）——本环未入联合解·近似边界·不假装精确");
  }
  approximations.push("portfolio 系数走 portfolio_optimize_coeffs 规则·未校准处为默认估算");
  return { portfolioArgs: args, approximations, coupledPairs };
}

/** GlobalSimResponse 关键量抽取（fail-soft·缺字段诚实缺席不臆造）。 */
function extractJoint(data: unknown): {
  residualQty: number;
  blockedCount: number;
  delayedCount: number;
  reconOk: boolean | undefined;
} {
  const d = (data ?? {}) as Record<string, unknown>;
  const blocked = Array.isArray(d.blocked) ? (d.blocked as Record<string, unknown>[]) : [];
  const schedule = Array.isArray(d.schedule) ? (d.schedule as Record<string, unknown>[]) : [];
  const residualQty = blocked.reduce((s, b) => s + (typeof b.qty === "number" ? b.qty : 0), 0);
  const recon = Array.isArray(d.reconChecks) ? (d.reconChecks as Record<string, unknown>[]) : undefined;
  return {
    residualQty,
    blockedCount: blocked.length,
    delayedCount: schedule.filter((r) => r.status !== "ok").length,
    reconOk: recon ? recon.every((c) => c.ok === true) : (typeof d.reconciled === "boolean" ? (d.reconciled as boolean) : undefined),
  };
}

export interface L3RunCtx {
  executor: GuardedToolExecutor;
  emit?: (event: string, payload: unknown) => Promise<void>;
}

export interface L3RunResult {
  answer: Answer;
  plan: MultiIntentPlan;
  /** portfolio 主 invoke 失败 → null（调用方回落 L1 独立并行·不塌）。 */
  ok: boolean;
}

/**
 * L3 执行（一次 portfolio 联合解 → 真残差喂 outsourcing_split → 确定性装配「真组合方案」）。
 * portfolio 失败 → ok:false（调用方回落 L1）。R13：每量 ⟦ref⟧ 溯 invoke 审计；近似环显式标。
 */
export async function runL3CoupledPath(query: string, routes: DomainRoute[], coupledPairs: [string, string][], ctx: L3RunCtx): Promise<L3RunResult> {
  const mapping = mapCoupledChainToPortfolio(query, routes, coupledPairs);
  await ctx.emit?.("step.completed", {
    stepId: newId("l3-dispatch"),
    type: "det_multi_domain_dispatch",
    outcome: `L3 耦合联合求解：一次 portfolio（${Object.keys(mapping.portfolioArgs).join("/")}）· 守恒内真传导 · 近似环 ${mapping.approximations.length} 处诚实标`,
    durationMs: 0,
  });

  const run = await ctx.executor.run("invoke_solver", { solverKey: "portfolio", args: mapping.portfolioArgs });
  if (!run.ok) {
    return { ok: false, answer: { trustLevel: "VERIFIED_WORKFLOW", blocks: [], provenance: [], unverifiedNumerics: false }, plan: emptyPlan(coupledPairs) };
  }
  const payload = (run.payload ?? {}) as Record<string, unknown>;
  const data = "data" in payload ? payload.data : payload;
  const joint = extractJoint(data);
  await ctx.emit?.("step.completed", {
    stepId: newId("l3-solver"),
    type: "det_multi_domain_solver",
    outcome: `portfolio 联合解：${run.outcome}·被挤 ${joint.blockedCount} 单·残差 ${joint.residualQty}·守恒 ${joint.reconOk === undefined ? "未报" : joint.reconOk ? "通过" : "未通过"}`,
    durationMs: run.durationMs,
  });

  const provenance: ProvenanceRef[] = [
    { id: newId("prov"), source: "TOOL_RESULT", toolCallId: run.toolCallId, toolName: "invoke_solver", outputPath: "$" },
  ];
  const blocks: AnswerBlock[] = [];
  blocks.push({
    type: "text",
    markdown:
      `【L3 耦合联合求解·真组合方案】转拨/物料/交期在**同一次 portfolio 守恒解**内联动求定` +
      `（Σ qty·x[i,b,t] ≤ cap[b,t]·capacityLedger 硬校验${joint.reconOk === undefined ? "" : joint.reconOk ? "·本次守恒校验通过" : "·⚠ 本次守恒校验未通过（见明细）"}）——非独立测算拼接。`,
  });
  blocks.push({ type: "text", markdown: `## 联合解（portfolio）\n延误传导/被挤/分配随转拨在守恒内真变（每值溯 ⟦ref:0⟧）：` });
  blocks.push(...summarizeSolverOutput(data, provenance[0]!.id).map((b) => (b.type === "text" ? { ...b, markdown: b.markdown.replace(/⟦ref:0⟧/g, "⟦ref:0⟧") } : b)));

  // 外协环：吃联合解**真残差**（残差为真——产能/转拨/物料已联合结算）。残差 0 → 诚实"无需外协"。
  const selected: MultiIntentPlan["selectedIntents"] = [
    { intentKey: "portfolio", confidence: 0, solverKey: "portfolio", slots: mapping.portfolioArgs },
  ];
  const parallelResults: MultiIntentPlan["parallelResults"] = {
    portfolio: { ok: true, durationMs: run.durationMs, summary: `portfolio:${run.outcome}` },
  };
  if (joint.residualQty > 0) {
    const os = await ctx.executor.run("invoke_solver", { solverKey: "outsourcing_split", args: { gap: joint.residualQty } });
    const osProv: ProvenanceRef = { id: newId("prov"), source: "TOOL_RESULT", toolCallId: os.toolCallId, toolName: "invoke_solver", outputPath: "$" };
    provenance.push(osProv);
    selected.push({ intentKey: "outsourcing_split", confidence: 0, solverKey: "outsourcing_split", slots: { gap: joint.residualQty } });
    parallelResults.outsourcing_split = { ok: os.ok, durationMs: os.durationMs, summary: `outsourcing_split:${os.outcome}` };
    blocks.push({
      type: "text",
      markdown: `## 外协/加班分配（吃联合解真残差 ${joint.residualQty} ⟦ref:0⟧）\n残差为真——产能/转拨/物料已在联合解内结算（每值溯 ⟦ref:1⟧）：`,
    });
    if (os.ok) {
      const osPayload = (os.payload ?? {}) as Record<string, unknown>;
      blocks.push(...summarizeSolverOutput("data" in osPayload ? osPayload.data : osPayload, osProv.id).map((b) => (b.type === "text" ? { ...b, markdown: b.markdown.replace(/⟦ref:0⟧/g, "⟦ref:1⟧") } : b)));
    } else {
      blocks.push({ type: "text", markdown: `该环未计算（原因：${os.outcome}）——诚实标·不臆造。` });
    }
  } else {
    blocks.push({ type: "text", markdown: `## 外协/加班分配\n联合解残差为 0（或未报出）——无需外协·不硬造分配。` });
  }

  // §4.3 近似环诚实标（绝不因"联合解跑通"就宣称全环精确）。
  blocks.push({ type: "text", markdown: `【近似/未映射环·诚实边界】\n${mapping.approximations.map((a) => `- ${a}`).join("\n")}` });

  await ctx.emit?.("step.completed", {
    stepId: newId("l3-synth"),
    type: "det_multi_domain_synthesis",
    outcome: `L3 确定性装配（联合解 + 真残差外协 + 近似环 ${mapping.approximations.length} 处标注）`,
    durationMs: 0,
  });

  return {
    ok: true,
    answer: { trustLevel: "VERIFIED_WORKFLOW", blocks, provenance, unverifiedNumerics: false },
    plan: {
      routeSource: "deterministic-multi-domain",
      synthesisMode: "deterministic",
      selectedIntents: selected,
      parallelResults,
      coupledPairs,
    },
  };
}

function emptyPlan(coupledPairs: [string, string][]): MultiIntentPlan {
  return { routeSource: "deterministic-multi-domain", synthesisMode: "deterministic", selectedIntents: [], parallelResults: {}, coupledPairs };
}
