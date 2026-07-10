import type { EvalCase, EvalCaseResult, EvalGateResult, EvalGateThresholds, EvalRunReport, EvalSuite } from "@platform/contracts";
import { EvalGateThresholdsSchema } from "@platform/contracts";
import type { Repos } from "./persistence/repos.js";
import type { Orchestrator } from "./router/orchestrator.js";
import { HttpError } from "./router/orchestrator.js";
import type { RequestAuth } from "./auth.js";
import { newId } from "./ids.js";
import { SCENARIO_CATALOG } from "./scenarios-catalog.js";
import { extractNumericTokens, extractUnverifiedNumerics } from "./util/numerics.js";

/**
 * AIP Evals（运营完备性增量 §2 / 成熟度 E4）。
 *
 * 在隔离 eval 上下文逐 case 跑**真实 QOS 管线**（分类→路径 A/B），观测意图/工具序列/回答/
 * 时延/token，与期望比对，产出可量化报告并落库可对比历史。
 *
 * 诚实边界：当 LLM 为 scripted mock 时，跑出的分数证明的是**管线与断言框架正确**，不是真实
 * agent 质量；接真实模型（llmMode=REAL）后同一套用例即给真分。
 */

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"]);

export class EvalService {
  constructor(
    private readonly deps: { repos: Repos; orchestrator: Orchestrator },
  ) {}

  // -- case authoring -------------------------------------------------------

  async createCase(input: Omit<EvalCase, "id" | "createdAt">): Promise<EvalCase> {
    const c: EvalCase = { ...input, id: newId("ec"), createdAt: new Date().toISOString() };
    await this.deps.repos.evalCases.upsert(c);
    return c;
  }

  /** §2 出厂种子：从 20 场景目录派生「应触发」用例（触发问句 → 期望意图 + 主求解器）。 */
  async seedScenarioCases(tenantId: string, packageId: string): Promise<{ created: number }> {
    let created = 0;
    for (const sc of SCENARIO_CATALOG) {
      const id = `ec_scenario_${sc.sNo}`;
      if (await this.deps.repos.evalCases.get(id)) continue;
      const c: EvalCase = {
        id,
        tenantId,
        suite: "classifier",
        packageId,
        input: { query: sc.triggerQuestion, context: { view: sc.view, selectedObjects: sc.presetContext.selectedObjects, filters: {} } },
        expect: {
          intentKey: sc.intentKey,
          // 复用的求解器在工具序列中应出现（新增求解器分阶段建设，不强断言其调用）
          ...(sc.solverStatus === "REUSED" ? { toolSequence: [{ name: "invoke_solver" }] } : {}),
        },
        origin: "SCENARIO",
        createdAt: new Date().toISOString(),
      };
      await this.deps.repos.evalCases.upsert(c);
      created++;
    }
    return { created };
  }

  /** §2 FallbackTrace 一键转 EvalCase（兜底真问句沉淀为回归资产）。 */
  async fromFallback(tenantId: string, taskId: string, expectIntentKey: string): Promise<EvalCase | undefined> {
    const fb = await this.deps.repos.fallbackTraces.getByTask(taskId);
    if (!fb || fb.tenantId !== tenantId) return undefined;
    return this.createCase({
      tenantId,
      suite: "regression",
      packageId: fb.packageId,
      input: { query: fb.query, context: { view: fb.view, selectedObjects: [], filters: {} } },
      expect: { intentKey: expectIntentKey },
      origin: "FALLBACK",
    });
  }

  // -- runner ---------------------------------------------------------------

  async run(
    auth: RequestAuth,
    suite: EvalSuite,
    opts: { agentKey?: string; llmMode?: "MOCK" | "REAL"; timeoutMs?: number } = {},
  ): Promise<EvalRunReport> {
    const cases = await this.deps.repos.evalCases.listByTenant(auth.tenantId, suite);
    const startedAt = new Date().toISOString();
    const results: EvalCaseResult[] = [];
    for (const c of cases) results.push(await this.runCase(auth, c, opts.timeoutMs ?? 8000));

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    const intentCases = cases.filter((c) => c.expect.intentKey !== undefined);
    const intentPassed = intentCases.filter((c) => results.find((r) => r.caseId === c.id && !r.failures.some((f) => f.startsWith("intent")))).length;
    const toolCases = cases.filter((c) => c.expect.toolSequence && c.expect.toolSequence.length > 0);
    const toolPassed = toolCases.filter((c) => results.find((r) => r.caseId === c.id && !r.failures.some((f) => f.startsWith("toolSequence")))).length;

    const report: EvalRunReport = {
      id: newId("erun"),
      tenantId: auth.tenantId,
      suite,
      ...(opts.agentKey ? { agentKey: opts.agentKey } : {}),
      startedAt,
      finishedAt: new Date().toISOString(),
      total,
      passed,
      passRate: total === 0 ? 1 : round(passed / total),
      metrics: {
        intentAccuracy: intentCases.length === 0 ? 1 : round(intentPassed / intentCases.length),
        toolCorrectness: toolCases.length === 0 ? 1 : round(toolPassed / toolCases.length),
        avgToolCalls: total === 0 ? 0 : round(results.reduce((s, r) => s + r.observed.toolCount, 0) / total),
        avgLatencyMs: total === 0 ? 0 : Math.round(results.reduce((s, r) => s + r.observed.latencyMs, 0) / total),
        avgTokenCost: total === 0 ? 0 : Math.round(results.reduce((s, r) => s + (r.observed.tokenCost ?? 0), 0) / total),
        hallucinationRate: total === 0 ? 0 : round(results.filter((r) => r.observed.hallucination).length / total),
      },
      results,
      llmMode: opts.llmMode ?? "MOCK",
    };
    await this.deps.repos.evalRuns.insert(report);
    return report;
  }

  // -- shadow release gate (E4) --------------------------------------------

  /**
   * 影子发布门禁：候选运行需同时满足绝对阈值（意图/工具正确率下限、幻觉率上限）；
   * 若给基线运行，则还需相对基线不退化（意图/工具正确率 ≥ 基线−ε、幻觉率 ≤ 基线）。
   */
  async gate(
    auth: RequestAuth,
    input: { candidateRunId: string; baselineRunId?: string; thresholds?: Partial<EvalGateThresholds> },
  ): Promise<EvalGateResult> {
    const thresholds = EvalGateThresholdsSchema.parse(input.thresholds ?? {});
    const candidate = await this.deps.repos.evalRuns.get(input.candidateRunId);
    if (!candidate || candidate.tenantId !== auth.tenantId) {
      throw new HttpError(404, "EVAL_RUN_NOT_FOUND", `eval run not found: ${input.candidateRunId}`);
    }
    const metrics = {
      intentAccuracy: candidate.metrics.intentAccuracy,
      toolCorrectness: candidate.metrics.toolCorrectness,
      hallucinationRate: candidate.metrics.hallucinationRate ?? 0,
    };

    const failures: string[] = [];
    if (metrics.intentAccuracy < thresholds.intentAccuracy) {
      failures.push(`意图准确率 ${metrics.intentAccuracy} 低于阈值 ${thresholds.intentAccuracy}`);
    }
    if (metrics.toolCorrectness < thresholds.toolCorrectness) {
      failures.push(`工具正确率 ${metrics.toolCorrectness} 低于阈值 ${thresholds.toolCorrectness}`);
    }
    if (metrics.hallucinationRate > thresholds.maxHallucinationRate) {
      failures.push(`幻觉率 ${metrics.hallucinationRate} 高于上限 ${thresholds.maxHallucinationRate}`);
    }

    if (input.baselineRunId) {
      const baseline = await this.deps.repos.evalRuns.get(input.baselineRunId);
      if (!baseline || baseline.tenantId !== auth.tenantId) {
        throw new HttpError(404, "EVAL_RUN_NOT_FOUND", `eval run not found: ${input.baselineRunId}`);
      }
      const baseIntent = baseline.metrics.intentAccuracy;
      const baseTool = baseline.metrics.toolCorrectness;
      const baseHalluc = baseline.metrics.hallucinationRate ?? 0;
      if (metrics.intentAccuracy < baseIntent - REGRESSION_EPSILON) {
        failures.push(`意图准确率较基线退化：${metrics.intentAccuracy} < 基线 ${baseIntent}`);
      }
      if (metrics.toolCorrectness < baseTool - REGRESSION_EPSILON) {
        failures.push(`工具正确率较基线退化：${metrics.toolCorrectness} < 基线 ${baseTool}`);
      }
      if (metrics.hallucinationRate > baseHalluc + REGRESSION_EPSILON) {
        failures.push(`幻觉率较基线恶化：${metrics.hallucinationRate} > 基线 ${baseHalluc}`);
      }
    }

    return {
      pass: failures.length === 0,
      candidateRunId: input.candidateRunId,
      ...(input.baselineRunId ? { baselineRunId: input.baselineRunId } : {}),
      thresholds,
      metrics,
      failures,
    };
  }

  private async runCase(auth: RequestAuth, c: EvalCase, timeoutMs: number): Promise<EvalCaseResult> {
    const t0 = Date.now();
    const failures: string[] = [];
    const caseAuth: RequestAuth = { ...auth, tenantId: c.tenantId };
    let taskId: string;
    try {
      const sub = await this.deps.orchestrator.submitQuery(caseAuth, {
        packageId: c.packageId,
        query: c.input.query,
        context: { view: c.input.context.view, selectedObjects: c.input.context.selectedObjects, filters: c.input.context.filters },
      });
      taskId = sub.taskId;
    } catch (err) {
      return { caseId: c.id, pass: false, failures: [`submit failed: ${err instanceof Error ? err.message : String(err)}`], observed: { toolNames: [], toolCount: 0, latencyMs: Date.now() - t0 } };
    }

    const task = await this.waitForTask(taskId, timeoutMs);
    const toolRows = await this.deps.repos.toolCalls.listByTask(taskId);
    const toolNames = toolRows.map((r) => r.toolName);
    const agentRun = await this.deps.repos.agentRuns.getByTask(taskId);
    const tokenCost = agentRun ? agentRun.totalInputTokens + agentRun.totalOutputTokens : 0;
    const observedIntent = task?.matchedIntent?.intentKey ?? task?.classification?.candidates?.[0]?.intentKey ?? null;
    const outOfCatalog = task?.classification?.outOfCatalog ?? false;
    const answerText = task?.answer ? JSON.stringify(task.answer) : "";

    // —— 幻觉率（E4）：回答里出现、但无法在本 case 工具/求解器证据中溯源的数值即为「未核实」。
    // 证据 = 本次任务所有工具/求解器调用的输入与输出（invoke_solver 亦经工具调用留痕）。
    const answerBlocks = ((task?.answer?.blocks ?? []) as { type: string; markdown?: string }[]);
    const answerMarkdown = answerBlocks
      .filter((b) => b.type === "text" && typeof b.markdown === "string")
      .map((b) => b.markdown as string)
      .join("\n");
    const evidenceText = toolRows
      .map((r) => JSON.stringify(r.output ?? "") + JSON.stringify(r.input ?? ""))
      .join("\n");
    const verified = new Set(extractNumericTokens(evidenceText).map(normalizeNumeric));
    const unverifiedNumerics = [
      ...new Set(extractUnverifiedNumerics(answerMarkdown).filter((n) => !verified.has(normalizeNumeric(n)))),
    ].sort();
    const hallucination = unverifiedNumerics.length > 0;

    // —— assertions ——
    if (c.expect.intentKey !== undefined) {
      if (c.expect.intentKey === null) {
        if (!outOfCatalog && observedIntent !== null) failures.push(`intent: expected outOfCatalog, got ${observedIntent}`);
      } else if (observedIntent !== c.expect.intentKey) {
        failures.push(`intent: expected ${c.expect.intentKey}, got ${observedIntent ?? "none"}`);
      }
    }
    if (c.expect.toolSequence && c.expect.toolSequence.length > 0) {
      if (!isSubsequence(c.expect.toolSequence.map((t) => t.name), toolNames)) {
        failures.push(`toolSequence: expected subsequence ${c.expect.toolSequence.map((t) => t.name).join(",")}, got ${toolNames.join(",") || "none"}`);
      }
    }
    for (const must of c.expect.answerMust ?? []) {
      if (!answerText.includes(must)) failures.push(`answerMust: missing "${must}"`);
    }
    for (const mustNot of c.expect.answerMustNot ?? []) {
      if (answerText.includes(mustNot)) failures.push(`answerMustNot: contains "${mustNot}"`);
    }
    if (c.expect.maxToolCalls !== undefined && toolNames.length > c.expect.maxToolCalls) {
      failures.push(`maxToolCalls: ${toolNames.length} > ${c.expect.maxToolCalls}`);
    }

    return {
      caseId: c.id,
      pass: failures.length === 0,
      failures,
      observed: {
        intentKey: observedIntent,
        ...(task?.path ? { path: task.path } : {}),
        toolNames,
        toolCount: toolNames.length,
        latencyMs: Date.now() - t0,
        tokenCost,
        answerExcerpt: answerText.slice(0, 200),
        unverifiedNumerics,
        hallucination,
      },
    };
  }

  private async waitForTask(taskId: string, timeoutMs: number) {
    const start = Date.now();
    for (;;) {
      const task = await this.deps.repos.tasks.get(taskId);
      if (task && TERMINAL.has(task.status)) return task;
      if (Date.now() - start > timeoutMs) return task;
      await new Promise((r) => setTimeout(r, 15));
    }
  }
}

/** 基线相对比较容差（浮点噪声，非放宽退化判定）。 */
const REGRESSION_EPSILON = 1e-9;

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 归一化数值 token 以便证据比对：去千分位分隔符与单位/百分号后缀、末尾小数点。 */
function normalizeNumeric(tok: string): string {
  return tok
    .replace(/[,，]/g, "")
    .replace(/(%|万|亿|GWh|套|吨|天|周)$/u, "")
    .replace(/\.$/u, "");
}

/** name 子序列匹配（期望工具按序作为实际工具序列的子序列出现）。 */
function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const h of haystack) if (i < needle.length && h === needle[i]) i++;
  return i === needle.length;
}
