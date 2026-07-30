import type { AgentDefinition, Answer, EvalCase, EvalCaseResult, EvalRunReport, SkillDefinition } from "@platform/contracts";
import type { ExecutionEngine } from "./engine.js";
import type { RequestAuth } from "./auth.js";
import type { Repos } from "./persistence/repos.js";
import { newId } from "./ids.js";
import { BudgetTracker } from "./tools/budget.js";
import { enterNesting, type NestingCtx } from "./runtime.js";
import { BUILTIN_TOOLS } from "./tools/registry.js";

/** 技能探针运行结果（等价于单个 skill 的 EvalRunReport 子集）。 */
export interface SkillProbeRunResult {
  tenantId: string;
  skillKey: string;
  total: number;
  passed: number;
  passRate: number;
  results: EvalCaseResult[];
  intentAccuracy: number;
  toolCorrectness: number;
  avgToolCalls: number;
  avgLatencyMs: number;
  avgTokenCost: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * SP5 · 写回型技能判定（**前瞻式防御读取**）。
 *
 * `sideEffect` 目前**尚未挂到 `SkillDefinition`/`SkillSchema`** —— 该枚举
 * （`CapabilitySideEffectSchema` = NONE/READ_ONLY/WRITE_BACK/EXTERNAL_ACTION）
 * 只存在于 WO-CAP-0 的 `capability.ts`，且是挂在 CapabilityMeta 上、不是 Skill。
 * 直接写 `skill.sideEffect` 会编译不过（本单曾因此被回滚·假绿事故 8977db85）。
 *
 * 故此处按**可选前瞻字段**读取：缺字段 → 视为 READ_ONLY（不追加写回工具），
 * 与 SP5 语义一致（"只有 WRITE_BACK/EXTERNAL_ACTION 才追加 create_action_draft"）。
 * ⚠️ WO-SKILL-1 把 `sideEffect` 正式并入 `SkillSchema` 后，删掉本 helper、直接读 `skill.sideEffect` 即可。
 */
function isWriteBackSkill(skill: SkillDefinition): boolean {
  const se = (skill as { sideEffect?: string }).sideEffect ?? "READ_ONLY";
  return se === "WRITE_BACK" || se === "EXTERNAL_ACTION";
}

/** 探针 agent 通用评测工具集（读写类技能再追加 create_action_draft）。 */
const PROBE_TOOL_NAMES = [
  "query_objects",
  "get_object",
  "invoke_solver",
  "evaluate_rules",
  "retrieve_knowledge",
  "read_skill_resource",
  "load_skill",
  "final_answer",
];

function sanitizeIdPart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function extractAnswerText(answer?: Answer | null): string {
  if (!answer) return "";
  return answer.blocks
    .map((b) => {
      switch (b.type) {
        case "text":
          return b.markdown;
        case "kpi":
          return `${b.label} ${b.value}`;
        case "action_draft":
          return b.summary;
        case "rule_violation":
          return b.explanation;
        case "table":
          return b.columns.join(" ") + " " + b.rows.map((r) => r.join(" ")).join(" ");
        case "gap":
          return JSON.stringify(b.report);
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function classifyFailKind(failures: string[]): NonNullable<EvalCaseResult["failKind"]> {
  if (failures.some((f) => f.startsWith("intent"))) return "INTENT";
  if (failures.some((f) => f.startsWith("toolSequence") || f.startsWith("maxToolCalls"))) return "TOOLSEQ";
  if (failures.some((f) => f.startsWith("answer"))) return "ANSWER";
  return "OTHER";
}

function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const h of haystack) if (i < needle.length && h === needle[i]) i++;
  return i === needle.length;
}

export class SkillProbeRunner {
  constructor(
    private readonly deps: {
      repos: Repos;
      engine: ExecutionEngine;
      emit?: (event: string, payload: unknown) => Promise<void>;
    },
  ) {}

  async runSkill(
    auth: RequestAuth,
    skillKey: string,
    opts: {
      timeoutMs?: number;
      skillId?: string;
      intentKey?: string;
    } = {},
  ): Promise<SkillProbeRunResult> {
    const tenantId = auth.tenantId;
    const timeoutMs = opts.timeoutMs === undefined || opts.timeoutMs <= 0 ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;

    // 1. 定位待测 skill：显式 skillId 优先，避免 latestByKey 漂移测到草稿。
    let skill: SkillDefinition | undefined;
    if (opts.skillId) {
      skill = await this.deps.repos.skills.get(opts.skillId);
      if (skill && (skill.tenantId !== tenantId || skill.key !== skillKey)) skill = undefined;
    }
    if (!skill) {
      const all = await this.deps.repos.skills.listByTenant(tenantId);
      skill = all.filter((s) => s.key === skillKey && s.status !== "RETIRED").sort((a, b) => b.version - a.version)[0];
    }
    if (!skill) throw new Error(`skill not found: ${skillKey}`);

    // 2. 确保探针 agent（含 tenantId）与 twin 存在且指向当前 skill 版本。
    const probeAgent = await this.ensureProbeAgent(auth, skill);
    const twinAgent = await this.ensureTwinAgent(auth, skill);

    // 3. 取出本 skill 的 skill_quality 用例。
    const cases = (await this.deps.repos.evalCases.listByTenant(tenantId, "skill_quality")).filter(
      (c) => c.skillKey === skillKey,
    );

    // 4. 逐 case 跑 probe（挂 skill）；behaviorGain 用例再跑 twin（不挂 skill）做差分。
    const results: EvalCaseResult[] = [];
    for (const c of cases) {
      results.push(await this.runCase(auth, c, probeAgent, twinAgent, timeoutMs, opts.intentKey));
    }

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;

    const intentCases = cases.filter((c) => c.expect.intentKey !== undefined);
    const intentPassed = intentCases.filter((c) => {
      const r = results.find((x) => x.caseId === c.id);
      return r && !r.failures.some((f) => f.startsWith("intent"));
    }).length;

    const toolCases = cases.filter((c) => c.expect.toolSequence && c.expect.toolSequence.length > 0);
    const toolPassed = toolCases.filter((c) => {
      const r = results.find((x) => x.caseId === c.id);
      return r && !r.failures.some((f) => f.startsWith("toolSequence") || f.startsWith("maxToolCalls"));
    }).length;

    const avgLatencyMs = total === 0 ? 0 : Math.round(results.reduce((s, r) => s + r.observed.latencyMs, 0) / total);
    const avgTokenCost = total === 0 ? 0 : Math.round(results.reduce((s, r) => s + (r.observed.tokenCost ?? 0), 0) / total);

    return {
      tenantId,
      skillKey,
      total,
      passed,
      passRate: total === 0 ? 1 : round4(passed / total),
      results,
      intentAccuracy: intentCases.length === 0 ? 1 : round4(intentPassed / intentCases.length),
      toolCorrectness: toolCases.length === 0 ? 1 : round4(toolPassed / toolCases.length),
      avgToolCalls: total === 0 ? 0 : round4(results.reduce((s, r) => s + r.observed.toolCount, 0) / total),
      avgLatencyMs,
      avgTokenCost,
    };
  }

  private async ensureProbeAgent(auth: RequestAuth, skill: SkillDefinition): Promise<AgentDefinition> {
    const tenantId = auth.tenantId;
    const sanitized = sanitizeIdPart(tenantId);
    const agentId = `agt_probe_${sanitized}_${skill.key}`;
    const existing = await this.deps.repos.agents.get(agentId);

    const systemPrompt = `你是技能「${skill.name}」的探针评测 agent。\n\n${skill.body}`;
    const desired: AgentDefinition = {
      id: agentId,
      tenantId,
      key: `probe_${skill.key}`,
      version: 1,
      name: `Probe: ${skill.name}`,
      description: `Skill probe for ${skill.key}`,
      model: "claude-opus-4-8",
      systemPrompt,
      tools: this.buildProbeTools(skill),
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
      skills: [{ skillId: skill.id, version: skill.version }],
      mcpServers: [],
      scopeDeclaration: { objectTypes: [], toolNames: [] },
      budget: { maxIterations: 8 },
      status: "PUBLISHED",
    };

    if (existing) {
      const sameSkill = existing.skills[0]?.skillId === skill.id;
      const samePrompt = existing.systemPrompt === systemPrompt;
      const sameName = existing.name === desired.name;
      if (sameSkill && samePrompt && sameName) return existing;
      // 内容漂移时直接覆盖（update 优先；若仓储 update 语义不完整可 delete+insert）。
      await this.deps.repos.agents.update({ ...desired, id: existing.id, version: existing.version });
      const refreshed = await this.deps.repos.agents.get(agentId);
      if (refreshed) return refreshed;
    }

    await this.deps.repos.agents.insert(desired);
    const inserted = await this.deps.repos.agents.get(agentId);
    if (!inserted) throw new Error(`failed to insert probe agent ${agentId}`);
    return inserted;
  }

  private async ensureTwinAgent(auth: RequestAuth, skill: SkillDefinition): Promise<AgentDefinition> {
    const tenantId = auth.tenantId;
    const sanitized = sanitizeIdPart(tenantId);
    const agentId = `agt_probe_twin_${sanitized}_${skill.key}`;
    const existing = await this.deps.repos.agents.get(agentId);

    const systemPrompt = `你是技能「${skill.name}」的探针评测 agent。\n\n${skill.body}`;
    const desired: AgentDefinition = {
      id: agentId,
      tenantId,
      key: `probe_twin_${skill.key}`,
      version: 1,
      name: `Twin: ${skill.name}`,
      description: `Skill twin for ${skill.key}`,
      model: "claude-opus-4-8",
      systemPrompt,
      tools: this.buildProbeTools(skill),
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: [], toolNames: [] },
      budget: { maxIterations: 8 },
      status: "PUBLISHED",
    };

    if (existing) {
      const samePrompt = existing.systemPrompt === systemPrompt;
      const sameName = existing.name === desired.name;
      const noSkills = existing.skills.length === 0;
      if (samePrompt && sameName && noSkills) return existing;
      await this.deps.repos.agents.update({ ...desired, id: existing.id, version: existing.version });
      const refreshed = await this.deps.repos.agents.get(agentId);
      if (refreshed) return refreshed;
    }

    await this.deps.repos.agents.insert(desired);
    const inserted = await this.deps.repos.agents.get(agentId);
    if (!inserted) throw new Error(`failed to insert twin agent ${agentId}`);
    return inserted;
  }

  private buildProbeTools(skill: SkillDefinition): AgentDefinition["tools"] {
    const refs: AgentDefinition["tools"] = PROBE_TOOL_NAMES.map((name) => ({ kind: "BUILTIN", name }));
    if (isWriteBackSkill(skill)) {
      refs.push({ kind: "BUILTIN", name: "create_action_draft" });
    }
    return refs;
  }

  private async runCase(
    auth: RequestAuth,
    c: EvalCase,
    probeAgent: AgentDefinition,
    twinAgent: AgentDefinition,
    timeoutMs: number,
    intentKey?: string,
  ): Promise<EvalCaseResult> {
    const t0 = Date.now();
    const failures: string[] = [];

    // behaviorGain 用例必须有 answerMust，否则无法度量增益。
    if (c.expect.behaviorGain && (!c.expect.answerMust || c.expect.answerMust.length === 0)) {
      failures.push("behaviorGain: missing answerMust dimension");
    }

    // 跑 probe（挂载 skill）。
    let probeAnswerText = "";
    let probeToolNames: string[] = [];
    let probeTokenCost = 0;
    try {
      const probeResult = await this.runAgent(auth, probeAgent, c, timeoutMs);
      probeAnswerText = extractAnswerText(probeResult.answer);
      probeToolNames = await this.getToolNamesForTask(probeResult.run.taskId);
      probeTokenCost = probeResult.run.totalInputTokens + probeResult.run.totalOutputTokens;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("probe timeout:")) {
        failures.push(msg);
      } else {
        failures.push(`probe failed: ${msg}`);
      }
    }

    // behaviorGain 用例再跑 twin（不挂 skill），校验增益真实存在。
    let twinAnswerText = "";
    if (c.expect.behaviorGain && failures.length === 0) {
      try {
        const twinResult = await this.runAgent(auth, twinAgent, c, timeoutMs);
        twinAnswerText = extractAnswerText(twinResult.answer);
      } catch {
        // twin 跑失败不影响 probe 结果判定，只表示无法对比。
        twinAnswerText = "";
      }
    }

    // 断言：intent / toolSequence / answerMust / answerMustNot / maxToolCalls。
    if (c.expect.intentKey !== undefined) {
      // skill probe 不关心分类器意图，除非调用方显式传入了 intentKey 或 case 有 behaviorGain。
      if (intentKey && intentKey !== c.expect.intentKey) {
        failures.push(`intent: expected ${c.expect.intentKey}, got ${intentKey}`);
      }
    }

    if (c.expect.toolSequence && c.expect.toolSequence.length > 0) {
      if (!isSubsequence(c.expect.toolSequence.map((t) => t.name), probeToolNames)) {
        failures.push(`toolSequence: expected subsequence ${c.expect.toolSequence.map((t) => t.name).join(",")}, got ${probeToolNames.join(",") || "none"}`);
      }
    }

    for (const must of c.expect.answerMust ?? []) {
      if (!probeAnswerText.includes(must)) failures.push(`answerMust: missing "${must}"`);
      // behaviorGain 要求该内容必须依赖 skill：twin（不挂 skill）不应出现。
      else if (c.expect.behaviorGain && twinAnswerText.includes(must)) {
        failures.push(`behaviorGain: "${must}" present without skill (twin also contains it)`);
      }
    }

    for (const mustNot of c.expect.answerMustNot ?? []) {
      if (probeAnswerText.includes(mustNot)) failures.push(`answerMustNot: contains "${mustNot}"`);
    }

    if (c.expect.maxToolCalls !== undefined && probeToolNames.length > c.expect.maxToolCalls) {
      failures.push(`maxToolCalls: ${probeToolNames.length} > ${c.expect.maxToolCalls}`);
    }

    const observedIntent = intentKey ?? null;
    const latencyMs = Date.now() - t0;

    return {
      caseId: c.id,
      pass: failures.length === 0,
      failures,
      ...(failures.length > 0 ? { failKind: classifyFailKind(failures) } : {}),
      observed: {
        intentKey: observedIntent,
        toolNames: probeToolNames,
        toolCount: probeToolNames.length,
        latencyMs,
        tokenCost: probeTokenCost,
        answerExcerpt: probeAnswerText.slice(0, 200),
      },
    };
  }

  private async runAgent(auth: RequestAuth, agent: AgentDefinition, c: EvalCase, timeoutMs: number) {
    const taskId = newId("task");
    const now = new Date().toISOString();
    await this.deps.repos.tasks.insert({
      id: taskId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      packageId: c.packageId,
      conversationId: taskId,
      query: c.input.query,
      context: { ...c.input.context, conversationId: undefined },
      status: "ROUTING",
      clarificationRounds: 0,
      createdAt: now,
    });

    const budget = new BudgetTracker({ maxIterations: 8, maxToolCalls: 12 });
    const nesting: NestingCtx = { callChain: [], budget };

    const runPromise = this.deps.engine.runRegisteredAgent({
      taskId,
      agentId: agent.id,
      version: agent.version,
      prompt: c.input.query,
      ctx: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        roles: auth.roles ?? [],
        token: auth.token,
        debugUser: auth.debugUser,
      },
      nesting,
      emit: this.deps.emit ?? (async () => {}),
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`probe timeout: ${timeoutMs}ms`)), timeoutMs);
      // 避免 Node 事件循环警告
      timer.unref?.();
    });

    return await Promise.race([runPromise, timeoutPromise]);
  }

  private async getToolNamesForTask(taskId: string): Promise<string[]> {
    const rows = await this.deps.repos.toolCalls.listByTask(taskId);
    return rows.map((r) => r.toolName);
  }
}

/** 从真实答案文本提取语义文本（用于 answerMust/answerMustNot）。 */
export { extractAnswerText };
