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
import type { LlmAgentMessage, LlmClient, LlmContentBlock } from "../llm/types.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import type { BudgetTracker } from "../tools/budget.js";
import type { GuardedToolExecutor, ToolBinding } from "../tools/executor.js";
import { scanBlocks } from "../util/numerics.js";
import { checkJsonSchema } from "../util/jsonschema.js";

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
  loadSkill?: (skillId: string) => Promise<{ body: string; resources: { name: string; url: string }[] } | undefined>;
  /** WORKFLOW tool support — runs a workflow and returns its serializable result. */
  runWorkflowTool?: (workflowId: string, version: number | "latest", input: Record<string, unknown>) => Promise<unknown>;
  finalAnswerDescription?: string;
  loadSkillEnabled?: boolean;
  /** Agent scopeDeclaration.toolNames — also enforced for WORKFLOW-bound tools handled in-loop. */
  scopeToolNames?: string[];
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

/** Hand-written agent tool loop (QOS-PRD §6.3 — toolRunner is intentionally NOT used). */
export async function runAgentLoop(opts: AgentLoopOpts): Promise<AgentLoopResult> {
  const messages: LlmAgentMessage[] = [{ role: "user", content: opts.userContent }];
  const iterations: AgentIteration[] = [];
  const sketch: { toolName: string; inputSummary: string }[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let lastText = "";
  let consecutiveDenies = 0;
  let forceFinishNotified = false;

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
  });

  const degrade = (outcome: "ANSWERED" | "BUDGET_EXHAUSTED" | "FAILED"): AgentLoopResult => {
    const markdown = lastText || "（探索模式未能产出回答）";
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

  for (let i = 0; opts.budget.iterations < opts.budget.budget.maxIterations; i++) {
    if (opts.isCancelled?.()) return degrade("FAILED");
    if (opts.budget.durationExceeded()) return degrade("BUDGET_EXHAUSTED");
    opts.budget.iterations += 1;

    const response = await opts.llm.agent({
      model: opts.model,
      system: opts.system,
      tools: llmTools,
      messages,
      maxTokens: 16000,
    });
    totalInput += response.usage.inputTokens;
    totalOutput += response.usage.outputTokens;
    messages.push({ role: "assistant", content: response.content, raw: response.raw });

    const texts = response.content.filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text");
    if (texts.length > 0) lastText = texts.map((t) => t.text).join("\n");

    const toolUses = response.content.filter(
      (b): b is Extract<LlmContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );

    if (response.stopReason !== "tool_use" || toolUses.length === 0) {
      // finished without final_answer (§5.4-6 degraded text answer)
      return degrade("ANSWERED");
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

    const iteration: AgentIteration = { index: i, toolCalls: [] };
    const toolResults: { type: "tool_result"; toolUseId: string; content: string; isError: boolean }[] = [];

    for (const block of toolUses) {
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
        iteration.toolCalls.push({
          toolCallId: tcId,
          toolName: "load_skill",
          input: block.input,
          outcome: loaded ? "OK" : "ERROR",
          durationMs: Date.now() - t0,
        });
        toolResults.push({
          type: "tool_result",
          toolUseId: block.id,
          content: loaded
            ? `<tool_data>${JSON.stringify(loaded)}</tool_data>`
            : `skill not found: ${skillId}`,
          isError: !loaded,
        });
        continue;
      }

      const spec = opts.tools.find((t) => t.name === block.name);
      sketch.push({ toolName: block.name, inputSummary: JSON.stringify(block.input ?? {}).slice(0, 200) });

      if (spec && spec.binding.kind === "WORKFLOW") {
        // workflow exposed as a tool — nested invocation, shares the top budget
        if (opts.scopeToolNames && !opts.scopeToolNames.includes(block.name)) {
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
          iteration.toolCalls.push({ toolCallId: tcId, toolName: block.name, input: block.input, outcome: "DENIED", durationMs: 0 });
          toolResults.push({
            type: "tool_result",
            toolUseId: block.id,
            content: "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明",
            isError: true,
          });
          continue;
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
        iteration.toolCalls.push({
          toolCallId: tcId,
          toolName: block.name,
          input: block.input,
          outcome,
          durationMs: Date.now() - t0,
        });
        toolResults.push({
          type: "tool_result",
          toolUseId: block.id,
          content:
            outcome === "OK"
              ? `<tool_data>${JSON.stringify(payload)}</tool_data>`
              : JSON.stringify(payload),
          isError: outcome !== "OK",
        });
        continue;
      }

      const binding: ToolBinding = spec && spec.binding.kind === "MCP" ? spec.binding : { kind: "BUILTIN" };
      const r = await opts.executor.run(block.name, block.input, { binding });
      await opts.emit("step.started", { stepId: r.toolCallId, type: block.name });
      await opts.emit("step.completed", {
        stepId: r.toolCallId,
        type: block.name,
        outcome: r.outcome,
        durationMs: r.durationMs,
      });
      iteration.toolCalls.push({
        toolCallId: r.toolCallId,
        toolName: block.name,
        input: block.input,
        outcome: r.outcome,
        durationMs: r.durationMs,
      });

      if (r.outcome === "BUDGET_EXCEEDED") {
        toolResults.push({
          type: "tool_result",
          toolUseId: block.id,
          content: "预算已尽，请基于已有结果调用 final_answer 收尾",
          isError: true,
        });
      } else if (r.outcome === "DENIED") {
        consecutiveDenies += 1;
        const code = (r.payload as { error?: string } | undefined)?.error;
        toolResults.push({
          type: "tool_result",
          toolUseId: block.id,
          content: code === "AGENT_SCOPE_VIOLATION" ? "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明" : "无权访问",
          isError: true,
        });
      } else if (!r.ok) {
        toolResults.push({
          type: "tool_result",
          toolUseId: block.id,
          content: JSON.stringify(r.payload),
          isError: true,
        });
      } else {
        consecutiveDenies = 0;
        // tool_call_id is surfaced so the model can cite it in final_answer.provenance
        toolResults.push({
          type: "tool_result",
          toolUseId: block.id,
          content: `<tool_data tool_call_id="${r.toolCallId}">${JSON.stringify(r.payload)}</tool_data>`,
          isError: false,
        });
      }
    }

    iterations.push(iteration);
    messages.push({ role: "user", content: toolResults });

    // 3 consecutive permission denials → force finish (§5.4-4)
    if (consecutiveDenies >= 3) {
      if (forceFinishNotified) return degrade("ANSWERED");
      forceFinishNotified = true;
      messages.push({
        role: "user",
        content: "连续多次权限拒绝。请立即调用 final_answer，基于已有结果收尾，并明确说明哪些数据无权访问。",
      });
    }
  }

  return degrade("BUDGET_EXHAUSTED");
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
  const provenance: ProvenanceRef[] = [];
  for (const p of parsed.data.provenance) {
    const audit = await opts.repos.toolCalls.get(p.toolCallId);
    const snapshotVersion =
      audit && audit.output !== null && typeof audit.output === "object"
        ? ((audit.output as Record<string, unknown>).snapshotVersion as string | undefined)
        : undefined;
    provenance.push({
      id: newId("prov"),
      source: "TOOL_RESULT",
      toolCallId: p.toolCallId,
      toolName: audit?.toolName ?? "unknown",
      outputPath: p.outputPath,
      ...(snapshotVersion ? { snapshotVersion } : {}),
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
