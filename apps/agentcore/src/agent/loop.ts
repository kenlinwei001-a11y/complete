import { z } from "zod";
import {
  AnswerBlockSchema,
  type AgentIteration,
  type AgentRunRecord,
  type Answer,
  type AnswerBlock,
  type ProvenanceRef,
} from "@platform/contracts";
import { newId } from "../ids.js";
import { isContextWindowExceededError, LlmEmptyResponseError, type LlmAgentMessage, type LlmClient, type LlmContentBlock } from "../llm/types.js";
import { COMPACTION_BETA } from "../llm/anthropic.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import type { BudgetTracker } from "../tools/budget.js";
import type { GuardedToolExecutor, ToolBinding } from "../tools/executor.js";
import { builtinTool } from "../tools/registry.js";
import { enrichProvenance } from "../tools/provenance.js";
import { scanBlocks } from "../util/numerics.js";
import { checkJsonSchema } from "../util/jsonschema.js";
import {
  CONTEXT_FULL_REMINDER,
  ContextBudgeter,
  estimateTokensChars,
  firstLineSummary,
  foldOldestFrame,
  truncateToolResultJson,
  type IterationFrame,
} from "./context.js";

/** final_answer input schema (QOS-PRD §5.4-5, strict zod validation). */
const FinalAnswerSchema = z
  .object({
    blocks: z.array(AnswerBlockSchema),
    provenance: z.array(z.object({ toolCallId: z.string(), outputPath: z.string() }).strict()),
  })
  .strict();

export interface AgentToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  binding:
    | ToolBinding
    | { kind: "WORKFLOW"; workflowId: string; version: number | "latest" }
    | { kind: "LOCAL" }; // final_answer / load_skill — handled inside the loop
}

export interface AgentLoopOpts {
  taskId: string;
  model: string;
  /** Tenant scope for multi-provider model resolution (RoutingLlmClient). */
  tenantId?: string;
  system: string;
  userContent: string;
  tools: AgentToolSpec[]; // must NOT include final_answer/load_skill (added by the loop)
  llm: LlmClient;
  executor: GuardedToolExecutor;
  budget: BudgetTracker;
  repos: Repos;
  metrics: Metrics;
  emit: (event: string, payload: unknown) => Promise<void>;
  isCancelled?: () => boolean;
  /** When set, final_answer's input_schema is replaced by this schema and the raw input is returned. */
  expectsSchema?: Record<string, unknown>;
  /** load_skill support (B1 agents). */
  loadSkill?: (skillId: string) => Promise<
    | {
        body: string;
        resources: { name: string; url: string; mime?: string; description?: string }[];
      }
    | undefined
  >;
  /** WORKFLOW tool support — runs a workflow and returns its serializable result. */
  runWorkflowTool?: (workflowId: string, version: number | "latest", input: Record<string, unknown>) => Promise<unknown>;
  finalAnswerDescription?: string;
  loadSkillEnabled?: boolean;
  /** Agent scopeDeclaration.toolNames — also enforced for WORKFLOW-bound tools handled in-loop. */
  scopeToolNames?: string[];
  /**
   * Phase7C 消息级滚动摘要器（可插拔）：把已折叠轮次的蒸馏素材压成一段「前情摘要」注入 system。
   * 生产可注入 LLM 摘要器；缺省为确定性兜底（拼接末 N 条，CI 可复现）。
   */
  summarizer?: (notes: string[]) => string | Promise<string>;
}

export interface AgentLoopResult {
  outcome: "ANSWERED" | "FAILED" | "BUDGET_EXHAUSTED";
  answer: Answer;
  /** Raw structured final_answer input when expectsSchema was provided. */
  structured?: unknown;
  run: AgentRunRecord;
  sketch: { toolName: string; inputSummary: string }[];
}

const FINAL_ANSWER_DESC =
  "终止工具：当你已收集到足够事实时调用，输出结构化回答 blocks 与 provenance。回答中的每个业务数字必须用 ⟦ref:N⟧ 标注（N 为 provenance 下标）。";

const DEFAULT_FINAL_ANSWER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    blocks: { type: "array", description: "AnswerBlock[]（text/table/kpi/rule_violation/action_draft）" },
    provenance: {
      type: "array",
      items: {
        type: "object",
        properties: { toolCallId: { type: "string" }, outputPath: { type: "string" } },
        required: ["toolCallId", "outputPath"],
      },
    },
  },
  required: ["blocks", "provenance"],
};

/** 增量 §1.2：query_timeseries_agg（桶数 ≤120）等自带输出上限的工具不受二次截断影响；
 * read_skill_resource 自带 64KB 文本上限（§3），同样豁免。 */
const TRUNCATION_EXEMPT_TOOLS = new Set(["query_timeseries_agg", "read_skill_resource"]);

/** 增量 §5：并行 READ 轮的最大并发。 */
const PARALLEL_READ_CONCURRENCY = 4;

type ToolResultBlock = { type: "tool_result"; toolUseId: string; content: string; isError: boolean };
type ToolUseBlock = Extract<LlmContentBlock, { type: "tool_use" }>;

interface BlockOutcome {
  call?: AgentIteration["toolCalls"][number];
  result: ToolResultBlock;
  /** for consecutiveDenies bookkeeping (processed in original order) */
  denyKind?: "PERMISSION" | "OTHER";
  ok?: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Hand-written agent tool loop (QOS-PRD §6.3 — toolRunner is intentionally NOT used). */
export async function runAgentLoop(opts: AgentLoopOpts): Promise<AgentLoopResult> {
  const messages: LlmAgentMessage[] = [{ role: "user", content: opts.userContent }];
  const iterations: AgentIteration[] = [];
  const sketch: { toolName: string; inputSummary: string }[] = [];
  // Phase7C 消息级滚动摘要：折叠轮次的蒸馏素材在此累积，每轮压成「前情摘要」注入 system。
  // summarizer 可插拔（Phase8 生产可注入 LLM 摘要器，返回 Promise）；缺省确定性拼接（CI 可复现）。
  const rollingNotes: string[] = [];
  const summarize = opts.summarizer ?? ((notes: string[]) => notes.slice(-12).join(" ｜ "));
  const noteOfFrame = (f: IterationFrame) => `第${f.iteration + 1}轮[${f.tools.map((t) => `${t.name}:${t.firstLine}`).join("；")}]`;
  let summaryCache = "";
  let summaryLen = -1; // 仅当折叠轮数增加时重算摘要（LLM 摘要器调用次数 ≈ 折叠次数）
  const effectiveSystem = async (): Promise<string> => {
    if (rollingNotes.length === 0) return opts.system;
    if (rollingNotes.length !== summaryLen) {
      summaryCache = await summarize(rollingNotes);
      summaryLen = rollingNotes.length;
    }
    return `${opts.system}\n\n【前情摘要（已折叠轮次蒸馏，仅供回忆；业务事实仍以工具结果为准）】\n${summaryCache}`;
  };
  const frames: IterationFrame[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let lastText = "";
  // WO-Q1 §3③ 开放式收敛：捕获模型最近一轮的推理文本（Kimi reasoning_content）——开放式深问句
  // 常烧光预算在推理上、终答 text 为空，此时不丢弃推理（见 degrade 兜底），避免「未能产出回答」死答。
  let lastReasoning = "";
  let restatedReasoning = false; // T2：§3③ 结构化重述只尝试一次
  let consecutiveDenies = 0;
  let forceFinishNotified = false;
  // 增量 §1.3 第 3 刀：收尾提醒已注入（finalizePending = 本轮就是「最后机会」轮）
  let finalizeUsed = false;
  let finalizePending = false;

  // T4：answer.delta 高频帧批量化——按累计 ~120 字或 ~80ms 合并一帧（大幅降帧数·不丢一字），
  // 每轮流式结束（agent 返回）前 flush 余量。前端 reducer 累计语义不变（合并只少帧不少内容）。
  const DELTA_FLUSH_CHARS = 120;
  const DELTA_FLUSH_MS = 80;
  let pendingDeltaText = "";
  let pendingDeltaReasoning = "";
  let deltaTimer: ReturnType<typeof setTimeout> | null = null;
  const flushDeltas = (): void => {
    if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
    if (!pendingDeltaText && !pendingDeltaReasoning) return;
    const payload: { text?: string; reasoning?: string } = {};
    if (pendingDeltaText) payload.text = pendingDeltaText;
    if (pendingDeltaReasoning) payload.reasoning = pendingDeltaReasoning;
    pendingDeltaText = "";
    pendingDeltaReasoning = "";
    void opts.emit("answer.delta", payload);
  };
  const onStreamDelta = (c: { text?: string; reasoning?: string }): void => {
    if (c.text) pendingDeltaText += c.text;
    if (c.reasoning) pendingDeltaReasoning += c.reasoning;
    if (pendingDeltaText.length + pendingDeltaReasoning.length >= DELTA_FLUSH_CHARS) flushDeltas();
    else if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS);
  };

  const budgeter = new ContextBudgeter(opts.llm, opts.model, opts.tenantId, opts.metrics);
  await budgeter.init();

  const llmTools = [
    ...opts.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    {
      name: "final_answer",
      description: opts.finalAnswerDescription ?? FINAL_ANSWER_DESC,
      inputSchema: opts.expectsSchema ?? DEFAULT_FINAL_ANSWER_SCHEMA,
    },
    ...(opts.loadSkillEnabled
      ? [
          {
            name: "load_skill",
            description: "按 skillId 加载技能全文（渐进披露）。当技能摘要与当前任务相关时调用。",
            inputSchema: {
              type: "object",
              properties: { skillId: { type: "string" } },
              required: ["skillId"],
            },
          },
        ]
      : []),
  ];

  const finishRun = (budgetExhausted: boolean): AgentRunRecord => ({
    id: newId("run"),
    taskId: opts.taskId,
    model: opts.model,
    iterations,
    budget: opts.budget.budget,
    budgetExhausted,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    ...(budgeter.ops.length > 0 ? { contextOps: [...budgeter.ops] } : {}),
  });

  /**
   * T2 §3③：把模型已产出的推理重述为一段简洁、结构化的最终答复（单次·无工具→只能出纯文本；
   * 失败/空 → 返回空串，调用方回落原始推理）。不依赖工具/预算，故 finalize 死路也能用。
   */
  const restateReasoning = async (reasoning: string): Promise<string> => {
    try {
      const resp = await opts.llm.agent({
        model: opts.model,
        system:
          "你是助手。把下面给定的「分析过程」整理成一段简洁、结构化的最终答复（纯文本，可用要点列表），" +
          "直接给结论与建议，不要复述思考过程、不要前言。只输出答复本身。",
        tools: [],
        messages: [{ role: "user", content: `分析过程：\n${reasoning}\n\n请整理成最终答复。` }],
        maxTokens: 4000,
        tenantId: opts.tenantId,
      });
      return resp?.content?.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n") ?? "";
    } catch {
      return ""; // 重述失败不致命：调用方回落原始推理（floor 保证）
    }
  };

  const degrade = async (outcome: "ANSWERED" | "BUDGET_EXHAUSTED" | "FAILED"): Promise<AgentLoopResult> => {
    // WO-Q1 §3③：终答文本为空时，若模型产出了推理（开放式深问句常如此）→ 先尝试一次「结构化重述」
    // （T2：把推理整理成简洁最终答复·单次无工具纯文本调用），重述失败/空才把原始推理作为
    // 「探索性初步结论」诚实呈现（trustLevel 已 AGENT_EXPLORATORY）；推理也空才回落最终兜底文案。
    const reasoning = lastReasoning.trim();
    let restated = "";
    if (!lastText && reasoning && !restatedReasoning && outcome !== "FAILED" && !opts.isCancelled?.()) {
      restatedReasoning = true;
      restated = (await restateReasoning(reasoning)).trim();
    }
    const markdown =
      lastText ||
      restated ||
      (reasoning ? `（探索推理·未结构化收尾，仅供参考）\n\n${reasoning}` : "") ||
      "（探索模式未能产出回答）";
    const blocks: AnswerBlock[] = [{ type: "text", markdown }];
    const unverified = scanBlocks(blocks);
    if (unverified) opts.metrics.unverifiedNumerics.inc({ path: "AGENT" });
    if (outcome === "BUDGET_EXHAUSTED") opts.metrics.agentBudgetExhausted.inc();
    return {
      outcome,
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance: [], unverifiedNumerics: unverified },
      run: finishRun(outcome === "BUDGET_EXHAUSTED"),
      sketch,
    };
  };

  /** 增量 §5：同轮 sideEffect 判定（READ 全并行；含 COMPUTE/ACTION_DRAFT/EXTERNAL 全串行）。 */
  const sideEffectOf = (name: string): "READ" | "COMPUTE" | "ACTION_DRAFT" | "EXTERNAL" => {
    if (name === "load_skill") return "READ";
    const spec = opts.tools.find((t) => t.name === name);
    if (spec?.binding.kind === "MCP") return "EXTERNAL";
    if (spec?.binding.kind === "WORKFLOW") return "COMPUTE";
    return builtinTool(name)?.sideEffect ?? "READ";
  };

  /** 单个 tool_use 块的执行（load_skill / WORKFLOW / executor 三条路径）。 */
  const runToolBlock = async (
    block: ToolUseBlock,
    budgetDecision?: { ok: true } | { ok: false; reason: string },
  ): Promise<BlockOutcome> => {
    if (block.name === "load_skill" && opts.loadSkillEnabled) {
      const skillId = String((block.input as Record<string, unknown>)?.skillId ?? "");
      const t0 = Date.now();
      const loaded = await opts.loadSkill?.(skillId);
      const tcId = newId("tc");
      await opts.repos.toolCalls.insert({
        id: tcId,
        taskId: opts.taskId,
        toolName: "load_skill",
        input: { skillId },
        outputDigest: "",
        output: loaded ? { loaded: true } : { loaded: false },
        outcome: loaded ? "OK" : "ERROR",
        durationMs: Date.now() - t0,
        createdAt: new Date().toISOString(),
      });
      opts.metrics.toolCalls.inc({ tool: "load_skill", outcome: loaded ? "OK" : "ERROR" });
      return {
        call: {
          toolCallId: tcId,
          toolName: "load_skill",
          input: block.input,
          outcome: loaded ? "OK" : "ERROR",
          durationMs: Date.now() - t0,
        },
        result: {
          type: "tool_result",
          toolUseId: block.id,
          content: loaded ? `<tool_data>${JSON.stringify(loaded)}</tool_data>` : `skill not found: ${skillId}`,
          isError: !loaded,
        },
        ok: Boolean(loaded),
      };
    }

    const spec = opts.tools.find((t) => t.name === block.name);

    if (spec && spec.binding.kind === "WORKFLOW") {
      // workflow exposed as a tool — nested invocation, shares the top budget
      // AGENT-UNIVERSAL-FALLBACK：scopeToolNames=["*"]（全域探索智能体）通配放行 workflow-as-tool。
      if (opts.scopeToolNames && !opts.scopeToolNames.includes("*") && !opts.scopeToolNames.includes(block.name)) {
        const tcId = newId("tc");
        await opts.repos.toolCalls.insert({
          id: tcId,
          taskId: opts.taskId,
          toolName: block.name,
          input: block.input,
          outputDigest: "",
          output: { error: "AGENT_SCOPE_VIOLATION" },
          outcome: "DENIED",
          durationMs: 0,
          createdAt: new Date().toISOString(),
        });
        opts.metrics.toolCalls.inc({ tool: block.name, outcome: "DENIED" });
        return {
          call: { toolCallId: tcId, toolName: block.name, input: block.input, outcome: "DENIED", durationMs: 0 },
          result: {
            type: "tool_result",
            toolUseId: block.id,
            content: "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明",
            isError: true,
          },
          denyKind: "PERMISSION",
        };
      }
      const t0 = Date.now();
      let outcome: "OK" | "ERROR" = "OK";
      let payload: unknown;
      try {
        payload = await opts.runWorkflowTool?.(
          spec.binding.workflowId,
          spec.binding.version,
          (block.input ?? {}) as Record<string, unknown>,
        );
      } catch (err) {
        outcome = "ERROR";
        payload = { error: err instanceof Error ? err.message : String(err) };
      }
      const tcId = newId("tc");
      await opts.repos.toolCalls.insert({
        id: tcId,
        taskId: opts.taskId,
        toolName: block.name,
        input: block.input,
        outputDigest: "",
        output: payload ?? null,
        outcome,
        durationMs: Date.now() - t0,
        createdAt: new Date().toISOString(),
      });
      opts.metrics.toolCalls.inc({ tool: block.name, outcome });
      const wfContent = (() => {
        if (outcome !== "OK") return JSON.stringify(payload);
        const t = truncateToolResultJson(payload);
        return `<tool_data>${t.json}</tool_data>${t.note ? `\n${t.note}` : ""}`;
      })();
      return {
        call: {
          toolCallId: tcId,
          toolName: block.name,
          input: block.input,
          outcome,
          durationMs: Date.now() - t0,
        },
        result: { type: "tool_result", toolUseId: block.id, content: wfContent, isError: outcome !== "OK" },
        ok: outcome === "OK",
      };
    }

    const binding: ToolBinding = spec && spec.binding.kind === "MCP" ? spec.binding : { kind: "BUILTIN" };
    const r = await opts.executor.run(block.name, block.input, { binding, budgetDecision });
    await opts.emit("step.started", { stepId: r.toolCallId, type: block.name });
    await opts.emit("step.completed", {
      stepId: r.toolCallId,
      type: block.name,
      outcome: r.outcome,
      durationMs: r.durationMs,
    });
    const call: AgentIteration["toolCalls"][number] = {
      toolCallId: r.toolCallId,
      toolName: block.name,
      input: block.input,
      outcome: r.outcome,
      durationMs: r.durationMs,
    };

    if (r.outcome === "BUDGET_EXCEEDED") {
      return {
        call,
        result: {
          type: "tool_result",
          toolUseId: block.id,
          content: "预算已尽，请基于已有结果调用 final_answer 收尾",
          isError: true,
        },
      };
    }
    if (r.outcome === "DENIED") {
      const code = (r.payload as { error?: string } | undefined)?.error;
      return {
        call,
        result: {
          type: "tool_result",
          toolUseId: block.id,
          content: code === "AGENT_SCOPE_VIOLATION" ? "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明" : "无权访问",
          isError: true,
        },
        denyKind: "PERMISSION",
      };
    }
    if (!r.ok) {
      return {
        call,
        result: { type: "tool_result", toolUseId: block.id, content: JSON.stringify(r.payload), isError: true },
      };
    }
    // §1.2：进入上下文前截断至 8KB（审计已全量入库）；query_timeseries_agg 等豁免二次截断
    const exempt = TRUNCATION_EXEMPT_TOOLS.has(block.name);
    const t = exempt ? { json: JSON.stringify(r.payload), truncated: false as const, note: undefined } : truncateToolResultJson(r.payload);
    return {
      call,
      result: {
        type: "tool_result",
        toolUseId: block.id,
        // tool_call_id is surfaced so the model can cite it in final_answer.provenance
        content: `<tool_data tool_call_id="${r.toolCallId}">${t.json}</tool_data>${t.note ? `\n${t.note}` : ""}`,
        isError: false,
      },
      ok: true,
    };
  };

  for (let i = 0; opts.budget.iterations < opts.budget.budget.maxIterations; i++) {
    if (opts.isCancelled?.()) return await degrade("FAILED");
    if (opts.budget.durationExceeded()) return await degrade("BUDGET_EXHAUSTED");
    opts.budget.iterations += 1;

    // -----------------------------------------------------------------------
    // 增量 §1：token 预算 + 三刀清理（按序执行直至回到阈值下）
    // -----------------------------------------------------------------------
    let contextEdits: { type: string }[] | undefined;
    let tokens = await budgeter.measure({ system: opts.system, tools: llmTools, messages });
    if (tokens > budgeter.softLimit) {
      // 第 1 刀：折叠最旧迭代的 tool_result（最近 2 轮永不折叠）
      while (tokens > budgeter.softLimit) {
        const folded = foldOldestFrame(messages, frames);
        if (!folded) break;
        rollingNotes.push(noteOfFrame(folded)); // §7C 折叠即蒸馏入滚动摘要
        budgeter.record("fold", i, `folded iteration ${folded.iteration}`);
        tokens = estimateTokensChars({ system: opts.system, tools: llmTools, messages });
      }
      // 第 2 刀：Anthropic 服务端 compaction；openai_compatible 无此能力 → 跳到第 3 刀
      if (tokens > budgeter.softLimit && budgeter.caps.compaction) {
        contextEdits = [{ type: COMPACTION_BETA }];
      }
      // 第 3 刀：硬阈值 → 注入收尾提醒，再给 1 次迭代机会
      if (tokens >= budgeter.hardLimit && !finalizePending) {
        if (finalizeUsed) return await degrade("BUDGET_EXHAUSTED");
        finalizeUsed = true;
        finalizePending = true;
        budgeter.record("force_finalize", i, "hard threshold");
        messages.push({ role: "user", content: CONTEXT_FULL_REMINDER });
      }
    }

    // §3③ 开放式收敛：「最后机会」轮（预算耗尽收尾）只暴露 final_answer 工具——逼模型结构化收尾，
    // 不再续发 tool 调用/纯推理而把预算耗光。普通轮维持全工具集（不影响既有探索行为）。
    const iterTools = finalizePending ? llmTools.filter((t) => t.name === "final_answer") : llmTools;
    let response;
    try {
      response = await opts.llm.agent({
        model: opts.model,
        system: await effectiveSystem(), // §7C 注入滚动前情摘要（Phase8 可为 LLM 摘要）
        tools: iterTools,
        messages,
        maxTokens: 16000,
        tenantId: opts.tenantId,
        ...(contextEdits ? { contextEdits } : {}),
        // WO-Q1 增量2：终答增量流式——adapter 支持(openai-compat·Kimi)时逐 token 经 SSE answer.delta
        // 实时回吐（text=答案/前情增量、reasoning=推理思考增量）。Path A 工作流不走本循环故不受影响；
        // mock/不支持流式的 adapter 忽略 onDelta（无 answer.delta·answer.final 照常）。fire-and-forget 不阻塞循环。
        // T4：onStreamDelta 批量累计 → 合并帧 emit；本轮 agent 返回后 flushDeltas() 推余量。
        onDelta: onStreamDelta,
      });
      flushDeltas(); // 本轮流式结束 → 推出未达阈值的尾帧（不丢内容）
    } catch (err) {
      flushDeltas(); // 失败/上下文超限重试前也推出已累计的分片
      // 第 3 刀（model_context_window_exceeded 形态）：折叠所有可折叠轮 + 注入收尾提醒后重试一次
      if (isContextWindowExceededError(err)) {
        if (finalizeUsed) return await degrade("BUDGET_EXHAUSTED");
        for (let f = foldOldestFrame(messages, frames); f; f = foldOldestFrame(messages, frames)) {
          rollingNotes.push(noteOfFrame(f));
          budgeter.record("fold", i, "context window exceeded");
        }
        finalizeUsed = true;
        finalizePending = true;
        budgeter.record("force_finalize", i, "model_context_window_exceeded");
        messages.push({ role: "user", content: CONTEXT_FULL_REMINDER });
        continue;
      }
      throw err;
    }
    // 空响应护栏（PRD）：agent 用途 LLM 返回 undefined/缺 usage（多因用途未绑定/key 失效/兼容网关缺 usage）→
    // 早失败为结构化错误（R7 code=LLM_EMPTY_RESPONSE），不再裸读 .usage 崩成 INTERNAL_ERROR·reading 'usage'。
    if (!response || !response.usage) {
      throw new LlmEmptyResponseError(`agent 用途 LLM 返回空响应（model=${opts.model}）——检查 LLM 用途绑定 'agent' 是否配置且 key 有效`);
    }
    totalInput += response.usage.inputTokens;
    totalOutput += response.usage.outputTokens;

    // 第 2 刀响应：compaction 块按官方语义原样回传 —— 压缩前历史由该块承载，
    // 本地仅保留首条 user 消息 + 携带 compaction 块的 assistant 消息（raw verbatim 回传）。
    if (response.content.some((b) => b.type === "compaction")) {
      messages.splice(1, messages.length - 1);
      frames.length = 0;
      rollingNotes.length = 0; // compaction 已承载压缩前历史 → 滚动摘要复位，避免重复
      budgeter.record("compact", i);
    }
    messages.push({ role: "assistant", content: response.content, raw: response.raw });

    const texts = response.content.filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text");
    if (texts.length > 0) lastText = texts.map((t) => t.text).join("\n");
    // §3③：记录最近一轮推理文本（reasoning_content），供终答为空时的收敛兜底。
    if (response.reasoningText) lastReasoning = response.reasoningText;

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (response.stopReason !== "tool_use" || toolUses.length === 0) {
      // finished without final_answer (§5.4-6 degraded text answer)
      return await degrade("ANSWERED");
    }

    // If this turn carries final_answer, accept it first and terminate (no tool_results needed).
    const finalBlock = toolUses.find((b) => b.name === "final_answer");
    if (finalBlock) {
      const accepted = await acceptFinalAnswer(finalBlock.input, opts);
      if (accepted.ok) {
        iterations.push({ index: i, toolCalls: [] });
        return {
          outcome: "ANSWERED",
          answer: accepted.answer,
          structured: accepted.structured,
          run: finishRun(false),
          sketch,
        };
      }
      // 第 3 刀「最后机会」轮给出的 final_answer 无效 → 按预算耗尽语义降级（不再续轮）
      if (finalizePending) return await degrade("BUDGET_EXHAUSTED");
      // invalid final_answer input → tell the model and continue
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: finalBlock.id,
            content: `final_answer 参数校验失败: ${accepted.errors.join("; ")}`,
            isError: true,
          },
        ],
      });
      iterations.push({ index: i, toolCalls: [] });
      continue;
    }

    // 第 3 刀「最后机会」轮未调用 final_answer → 按预算耗尽语义（QOS-PRD §5.4-6）降级收尾
    if (finalizePending) return await degrade("BUDGET_EXHAUSTED");

    for (const block of toolUses) {
      if (!(block.name === "load_skill" && opts.loadSkillEnabled)) {
        sketch.push({ toolName: block.name, inputSummary: JSON.stringify(block.input ?? {}).slice(0, 200) });
      }
    }

    // -----------------------------------------------------------------------
    // 增量 §5：全 READ 轮并行（并发 ≤4，预算先计后发，结果按 tool_use 原顺序回填）；
    // 含 COMPUTE/ACTION_DRAFT/EXTERNAL 的混合轮全部串行（审计顺序与预算计数确定性）。
    // -----------------------------------------------------------------------
    const allRead = toolUses.every((b) => sideEffectOf(b.name) === "READ");
    let outcomes: BlockOutcome[];
    if (allRead && toolUses.length > 1) {
      // 预算确定性：dispatch 前按 tool_use 顺序统一计数
      const decisions = toolUses.map((b) => {
        if (b.name === "load_skill") return undefined; // load_skill 不占工具预算（既有规则）
        const cost = builtinTool(b.name)?.costClass ?? "CHEAP";
        return opts.budget.tryConsume(cost);
      });
      outcomes = await mapLimit(toolUses, PARALLEL_READ_CONCURRENCY, (b, idx) => runToolBlock(b, decisions[idx]));
    } else {
      outcomes = [];
      for (const block of toolUses) {
        outcomes.push(await runToolBlock(block));
      }
    }

    const iteration: AgentIteration = { index: i, toolCalls: [] };
    const toolResults: ToolResultBlock[] = [];
    for (const o of outcomes) {
      if (o.call) iteration.toolCalls.push(o.call);
      toolResults.push(o.result);
      if (o.denyKind === "PERMISSION") consecutiveDenies += 1;
      else if (o.ok) consecutiveDenies = 0;
    }

    iterations.push(iteration);
    messages.push({ role: "user", content: toolResults });
    frames.push({
      iteration: i,
      toolResultMsgIndex: messages.length - 1,
      tools: outcomes.map((o, idx) => ({
        name: toolUses[idx]?.name ?? "tool",
        firstLine: firstLineSummary(o.result.content),
      })),
      folded: false,
    });

    // 3 consecutive permission denials → force finish (§5.4-4)
    if (consecutiveDenies >= 3) {
      if (forceFinishNotified) return await degrade("ANSWERED");
      forceFinishNotified = true;
      messages.push({
        role: "user",
        content: "连续多次权限拒绝。请立即调用 final_answer，基于已有结果收尾，并明确说明哪些数据无权访问。",
      });
    }
  }

  return await degrade("BUDGET_EXHAUSTED");
}

async function acceptFinalAnswer(
  input: unknown,
  opts: AgentLoopOpts,
): Promise<{ ok: true; answer: Answer; structured?: unknown } | { ok: false; errors: string[] }> {
  if (opts.expectsSchema) {
    const errors = checkJsonSchema(input, opts.expectsSchema);
    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      structured: input,
      answer: {
        trustLevel: "AGENT_EXPLORATORY",
        blocks: [{ type: "text", markdown: "已按要求返回结构化结果。" }],
        provenance: [],
        unverifiedNumerics: false,
      },
    };
  }
  const parsed = FinalAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  // Dereference provenance: each {toolCallId, outputPath} → full ProvenanceRef from the audit log.
  // tsAgg/kb metadata is populated from the AUDITED tool output (A8.3/S4.1 passthrough).
  const provenance: ProvenanceRef[] = [];
  for (const p of parsed.data.provenance) {
    const audit = await opts.repos.toolCalls.get(p.toolCallId);
    const snapshotVersion =
      audit && audit.output !== null && typeof audit.output === "object"
        ? ((audit.output as Record<string, unknown>).snapshotVersion as string | undefined)
        : undefined;
    const enriched = enrichProvenance(audit?.toolName, audit?.output ?? null, p.outputPath);
    provenance.push({
      id: newId("prov"),
      toolCallId: p.toolCallId,
      toolName: audit?.toolName ?? "unknown",
      outputPath: p.outputPath,
      ...(snapshotVersion ? { snapshotVersion } : {}),
      ...enriched,
    });
  }
  const blocks: AnswerBlock[] = parsed.data.blocks;
  const unverified = scanBlocks(blocks);
  if (unverified) opts.metrics.unverifiedNumerics.inc({ path: "AGENT" });
  return {
    ok: true,
    answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: unverified },
  };
}
