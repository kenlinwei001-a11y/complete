import type { EvalCase, EvalCaseResult, EvalFailKind, EvalRunReport, EvalSuite } from "@platform/contracts";
import type { Repos } from "./persistence/repos.js";
import type { Orchestrator } from "./router/orchestrator.js";
import type { RequestAuth } from "./auth.js";
import type { ExecutionEngine } from "./engine.js";
import { newId } from "./ids.js";
import { SCENARIO_CATALOG } from "./scenarios-catalog.js";
import { ResourceQualityService } from "./dril/quality.js";
import { extractAnswerText, SkillProbeRunner } from "./skill-probe.js";

function sanitizeIdPart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** A14：把失败信息归类为 parity 失因（首要项；意图>工具序列>答案>其它）。 */
export function classifyFailKind(failures: string[]): EvalFailKind {
  if (failures.some((f) => f.startsWith("intent"))) return "INTENT";
  if (failures.some((f) => f.startsWith("toolSequence") || f.startsWith("maxToolCalls"))) return "TOOLSEQ";
  if (failures.some((f) => f.startsWith("answer"))) return "ANSWER";
  return "OTHER";
}

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
  private readonly probeRunner: SkillProbeRunner;

  constructor(
    private readonly deps: { repos: Repos; orchestrator: Orchestrator; engine: ExecutionEngine },
  ) {
    this.probeRunner = new SkillProbeRunner({ repos: deps.repos, engine: deps.engine });
  }

  // -- case authoring -------------------------------------------------------

  async createCase(input: Omit<EvalCase, "id" | "createdAt">): Promise<EvalCase> {
    const c: EvalCase = { ...input, id: newId("ec"), createdAt: new Date().toISOString() };
    await this.deps.repos.evalCases.upsert(c);
    return c;
  }

  /**
   * WO-1 · SkillProbeRunner 生产化：针对单个 skill 跑 skill_quality 用例，探针 agent 显式挂载待发布 skill。
   */
  async runSkillProbe(
    auth: RequestAuth,
    skillKey: string,
    opts?: { timeoutMs?: number; skillId?: string; intentKey?: string },
  ): Promise<import("./skill-probe.js").SkillProbeRunResult> {
    return this.probeRunner.runSkill(auth, skillKey, opts ?? {});
  }

  /** §2 出厂种子：从 20 场景目录派生「应触发」用例（触发问句 → 期望意图 + 主求解器）。 */
  async seedScenarioCases(tenantId: string, packageId: string): Promise<{ created: number }> {
    const sanitized = sanitizeIdPart(tenantId);
    let created = 0;
    for (const sc of SCENARIO_CATALOG) {
      const id = `ec_scenario_${sanitized}_${sc.sNo}`;
      if (await this.deps.repos.evalCases.get(id)) continue;
      const c: EvalCase = {
        id,
        tenantId,
        suite: "classifier",
        packageId,
        // slotPresets 搭车进 context → 必填槽满足 → 工作流"打开即可推演"，不触发反问澄清。
        input: { query: sc.triggerQuestion, context: { view: sc.view, selectedObjects: sc.presetContext.selectedObjects, filters: {}, presetSlots: sc.presetContext.slotPresets } },
        // 仅断言意图。"是否真计算"不用一刀切 invoke_solver——不同场景计划合法地走 invoke_solver / resolve_slice /
        // S&OP 工作流；强求 invoke_solver 会对 resolve_slice 类场景（如风险根因）假阴。计算性由 hand-run 套件按"产出真答案"校验。
        expect: { intentKey: sc.intentKey },
        origin: "SCENARIO",
        createdAt: new Date().toISOString(),
      };
      await this.deps.repos.evalCases.upsert(c);
      created++;
    }
    return { created };
  }

  /**
   * A14 PRD 期望用例库：从 20 场景目录派生**带行为期望**的 parity 用例（期望 intent + 工具序列 + 答案断言）。
   * 与 seedScenarioCases（仅 intent）互补——这套表达"PRD 说该走的工具/该出现的答案"，真 Kimi 实跑后由
   * parity 报告标出哪些场景与 PRD 不符（INTENT/TOOLSEQ/ANSWER）。env-gated 真跑；mock 仅证框架。
   */
  async seedParityCases(tenantId: string, packageId: string): Promise<{ created: number }> {
    const sanitized = sanitizeIdPart(tenantId);
    let created = 0;
    for (const sc of SCENARIO_CATALOG) {
      const id = `ec_parity_${sanitized}_${sc.sNo}`;
      if (await this.deps.repos.evalCases.get(id)) continue;
      const c: EvalCase = {
        id,
        tenantId,
        suite: "agent_quality",
        packageId,
        input: { query: sc.triggerQuestion, context: { view: sc.view, selectedObjects: sc.presetContext.selectedObjects, filters: {}, presetSlots: sc.presetContext.slotPresets } },
        // PRD 期望三元：意图 + 工具序列（COMPUTE 场景应调求解器 invoke_solver）+ 答案断言（解读类不强求关键词，留空 → 由真跑观测）。
        expect: {
          intentKey: sc.intentKey,
          toolSequence: [{ name: "invoke_solver" }],
        },
        origin: "SCENARIO",
        createdAt: new Date().toISOString(),
      };
      await this.deps.repos.evalCases.upsert(c);
      created++;
    }
    return { created };
  }

  /** A14：组装 parity 报告（按失因聚合 + 逐 case 偏差），供 /admin/evals 可视、下钻。 */
  private buildParity(cases: EvalCase[], results: EvalCaseResult[]): EvalRunReport["parity"] {
    const byFailKind = { INTENT: 0, TOOLSEQ: 0, ANSWER: 0, OTHER: 0 };
    const caseById = new Map(cases.map((c) => [c.id, c]));
    const byCase = results.map((r) => {
      if (r.failKind) byFailKind[r.failKind] += 1;
      const c = caseById.get(r.caseId);
      return {
        caseId: r.caseId,
        ...(c?.expect.intentKey !== undefined ? { expectIntent: c.expect.intentKey } : {}),
        pass: r.pass,
        ...(r.failKind ? { failKind: r.failKind } : {}),
      };
    });
    return { byFailKind, byCase };
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
    const toolPassed = toolCases.filter((c) => results.find((r) => r.caseId === c.id && !r.failures.some((f) => f.startsWith("toolSequence") || f.startsWith("maxToolCalls")))).length;

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
      },
      results,
      llmMode: opts.llmMode ?? "MOCK",
      parity: this.buildParity(cases, results),
    };
    await this.deps.repos.evalRuns.insert(report);
    return report;
  }

  /**
   * WO-DRIL-P3 · 质量分 parity 回灌钩子（PRD-DRIL §5.4·姊妹篇 evals 接缝）。
   * 把一次 eval run 的每 case 观测（pass=成功收敛 / latencyMs）回灌到其命中 intent 资源的运行时质量分
   * （EWMA·§5.4）→ 低通过率 intent 的 successRate 随之下降 → DRIL 检索 history 子分随真实 parity 移动。
   *
   * **opt-in**（不在 run() 自动触发·避免污染确定性用例状态）；nowIso 取 report.finishedAt（不引 Date.now·可复现）。
   * 返回回灌条数。fail-open：无 intentKey 的 case 跳过。
   */
  async feedbackQuality(auth: RequestAuth, report: EvalRunReport): Promise<{ updated: number }> {
    if (auth.tenantId !== report.tenantId) {
      throw new Error(`feedbackQuality tenant mismatch: caller=${auth.tenantId}, report=${report.tenantId}`);
    }
    const quality = new ResourceQualityService(this.deps.repos);
    let updated = 0;
    for (const r of report.results) {
      const intentKey = r.observed.intentKey;
      if (!intentKey) continue; // fail-open：未命中意图不回灌
      await quality.record(auth, "intent", intentKey, { success: r.pass, latencyMs: r.observed.latencyMs }, report.finishedAt);
      updated++;
    }
    return { updated };
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
        context: { view: c.input.context.view, selectedObjects: c.input.context.selectedObjects, filters: c.input.context.filters, ...(c.input.context.presetSlots ? { presetSlots: c.input.context.presetSlots } : {}) },
      }, undefined, { internal: true });
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
    const answerText = task?.answer ? extractAnswerText(task.answer) : "";

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
      ...(failures.length > 0 ? { failKind: classifyFailKind(failures) } : {}),
      observed: {
        intentKey: observedIntent,
        ...(task?.path ? { path: task.path } : {}),
        toolNames,
        toolCount: toolNames.length,
        latencyMs: Date.now() - t0,
        tokenCost,
        answerExcerpt: answerText.slice(0, 200),
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

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** name 子序列匹配（期望工具按序作为实际工具序列的子序列出现）。 */
function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const h of haystack) if (i < needle.length && h === needle[i]) i++;
  return i === needle.length;
}
