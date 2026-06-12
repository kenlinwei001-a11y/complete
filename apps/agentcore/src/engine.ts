import { mcpServerNameSlug, mcpToolFullName, type AgentDefinition, type Answer, type ResolvedRef, type SkillDefinition, type WorkflowDefinition } from "@platform/contracts";
import { runAgentLoop, type AgentLoopResult, type AgentToolSpec } from "./agent/loop.js";
import { AGENT_SYSTEM_CORE, buildSkillSection } from "./agent/prompts.js";
import type { AppConfig } from "./config.js";
import type { LlmSettings } from "./llm/providers.js";
import type { LlmClient } from "./llm/types.js";
import type { McpClientPort } from "./mcp/types.js";
import type { Metrics } from "./metrics.js";
import type { Repos } from "./persistence/repos.js";
import { enterNesting, type NestingCtx } from "./runtime.js";
import { BudgetTracker } from "./tools/budget.js";
import type { DataCoreClient, ToolAuthCtx } from "./tools/clients.js";
import { GuardedToolExecutor } from "./tools/executor.js";
import type { SkillResourceReader } from "./tools/skill-resources.js";
import { BUILTIN_TOOLS } from "./tools/registry.js";
import { runWorkflow, type ExtendedPlanStep, type WorkflowResult } from "./workflow/executor.js";

export interface EngineDeps {
  repos: Repos;
  metrics: Metrics;
  llm: LlmClient;
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  config: AppConfig;
  /** Multi-provider model resolution (amends QOS-PRD §6). */
  llmSettings: LlmSettings;
  /** 增量 §3：read_skill_resource 内容读取端口（缺省仅元信息）。 */
  skillResources?: SkillResourceReader;
}

export interface RunRegisteredAgentOpts {
  taskId: string;
  agentId: string;
  version: number | "latest";
  prompt: string;
  ctx: ToolAuthCtx;
  nesting: NestingCtx;
  emit: (event: string, payload: unknown) => Promise<void>;
  expectsSchema?: Record<string, unknown>;
  isCancelled?: () => boolean;
  /** 引用模式增量 §2.2：执行时解析到的实际版本留痕回调（agent/skill/rule/workflow）。 */
  onResolvedRef?: (ref: ResolvedRef) => void;
}

/** Cross-wires the agent loop and the workflow executor (mutual nesting, shared budget). */
export class ExecutionEngine {
  constructor(readonly deps: EngineDeps) {}

  makeExecutor(taskId: string, ctx: ToolAuthCtx, budget?: BudgetTracker, scopeToolNames?: string[]): GuardedToolExecutor {
    return new GuardedToolExecutor(
      {
        dataCore: this.deps.dataCore,
        mcp: this.deps.mcp,
        repos: this.deps.repos,
        metrics: this.deps.metrics,
        skillResources: this.deps.skillResources,
      },
      { taskId, ctx, budget, scopeToolNames },
    );
  }

  async resolveAgent(agentId: string, version: number | "latest"): Promise<AgentDefinition> {
    const direct = await this.deps.repos.agents.get(agentId);
    if (!direct) throw new Error(`agent not found: ${agentId}`);
    if (version === "latest") {
      const latest = await this.deps.repos.agents.latestByKey(direct.tenantId, direct.key);
      return latest ?? direct;
    }
    if (direct.version === version) return direct;
    const all = await this.deps.repos.agents.listByTenant(direct.tenantId);
    const match = all.find((a) => a.key === direct.key && a.version === version);
    if (!match) throw new Error(`agent version not found: ${direct.key} v${version}`);
    return match;
  }

  /**
   * 引用模式增量 §2.1：agent → skill 缺省 latest —— skillId 定位 key，latest 取该
   * key 当前未退役的最高版本；pin 数字版本取精确版本。
   */
  async resolveSkill(
    tenantId: string,
    skillId: string,
    version: number | "latest" = "latest",
  ): Promise<SkillDefinition | undefined> {
    const direct = await this.deps.repos.skills.get(skillId);
    if (!direct || direct.tenantId !== tenantId) return undefined;
    if (typeof version === "number") {
      if (direct.version === version) return direct;
      const all = await this.deps.repos.skills.listByTenant(tenantId);
      return all.find((s) => s.key === direct.key && s.version === version);
    }
    const all = await this.deps.repos.skills.listByTenant(tenantId);
    const latest = all
      .filter((s) => s.key === direct.key && s.status !== "RETIRED")
      .sort((a, b) => b.version - a.version)[0];
    return latest ?? direct;
  }

  /** Expand AgentToolRef[] → AgentToolSpec[] (BUILTIN / MCP discovered tools / WORKFLOW-as-tool). */
  async expandAgentTools(agent: AgentDefinition): Promise<AgentToolSpec[]> {
    const specs: AgentToolSpec[] = [];
    for (const ref of agent.tools) {
      if (ref.kind === "BUILTIN") {
        const def = BUILTIN_TOOLS.find((t) => t.name === ref.name);
        if (!def) continue;
        specs.push({
          name: def.name,
          description: def.descriptionForLLM,
          inputSchema: def.inputSchema,
          binding: { kind: "BUILTIN" },
        });
      } else if (ref.kind === "MCP") {
        if (!this.deps.mcp) continue;
        const config = await this.deps.repos.mcpConfigs.get(ref.mcpConfigId);
        if (!config) continue;
        // 增量 §4.2 命名空间：模型可见名 = mcp__{serverName}__{toolName}（防重名冲突）；
        // serverName = config.serverName（创建时校验）/ 旧数据按 name 推导。
        const serverName = config.serverName ?? mcpServerNameSlug(config.name);
        let tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
        try {
          tools = await this.deps.mcp.listTools(ref.mcpConfigId);
        } catch {
          // server ERROR/不可达 → 该 server 工具本次不可见（agent 调用会即时得 is_error）
          continue;
        }
        for (const t of tools) {
          const fullName = mcpToolFullName(serverName, t.name);
          if (ref.toolFilter && !ref.toolFilter.includes(t.name) && !ref.toolFilter.includes(fullName)) continue;
          specs.push({
            name: fullName,
            description: `[MCP·外部] ${t.description}`,
            inputSchema: t.inputSchema,
            binding: { kind: "MCP", mcpConfigId: ref.mcpConfigId },
          });
        }
      } else {
        const wf = await this.deps.repos.workflows.get(ref.workflowId);
        if (!wf) continue;
        specs.push({
          name: `workflow_${wf.key}`,
          description: `${wf.name}（这是一个多步流程，将按声明式步骤执行并返回结果）${wf.description ?? ""}`,
          inputSchema: wf.inputs,
          binding: { kind: "WORKFLOW", workflowId: ref.workflowId, version: ref.version },
        });
      }
    }
    return specs;
  }

  /** Run a registered agent (B1 executor = §6.3 loop + scope gate + skills + rule POST_CHECK). */
  async runRegisteredAgent(opts: RunRegisteredAgentOpts): Promise<AgentLoopResult> {
    const agent = await this.resolveAgent(opts.agentId, opts.version);
    const tools = await this.expandAgentTools(agent);
    // §2.2 留痕：实际执行的 agent 版本
    opts.onResolvedRef?.({ kind: "agent", key: agent.key, version: agent.version });

    const skills = [];
    for (const s of agent.skills) {
      // §2.1：skill 引用缺省 latest（执行时解析）；§2.2：留痕含 skill 版本（L8）
      const skill = await this.resolveSkill(agent.tenantId, s.skillId, s.version ?? "latest");
      if (skill) {
        skills.push(skill);
        opts.onResolvedRef?.({ kind: "skill", key: skill.key, version: skill.version });
      }
    }
    const system = `${agent.systemPrompt}\n\n${AGENT_SYSTEM_CORE}${buildSkillSection(skills)}`;

    const executor = this.makeExecutor(opts.taskId, opts.ctx, opts.nesting.budget, agent.scopeDeclaration.toolNames);

    const result = await runAgentLoop({
      taskId: opts.taskId,
      model: await this.deps.llmSettings.roleModel(agent.tenantId, "agent", agent.model || undefined),
      tenantId: agent.tenantId,
      system,
      userContent: opts.prompt,
      tools,
      llm: this.deps.llm,
      executor,
      budget: opts.nesting.budget,
      repos: this.deps.repos,
      metrics: this.deps.metrics,
      emit: opts.emit,
      isCancelled: opts.isCancelled,
      expectsSchema: opts.expectsSchema,
      loadSkillEnabled: true,
      scopeToolNames: agent.scopeDeclaration.toolNames,
      loadSkill: async (skillId: string) => {
        const pinned = agent.skills.find((x) => x.skillId === skillId)?.version ?? "latest";
        const skill = await this.resolveSkill(agent.tenantId, skillId, pinned);
        if (!skill) return undefined;
        opts.onResolvedRef?.({ kind: "skill", key: skill.key, version: skill.version });
        return {
          // 增量 §3：body 中的 {{resource:name}} 标注引用原样保留——资源清单（含 mime/description）
          // 告诉模型有哪些附件、何时用 read_skill_resource 读（渐进披露第三级）。
          body: skill.body,
          resources: skill.resources.map((r) => ({
            name: r.name,
            url: `/b/v1/skills/${skill.id}/resources/${encodeURIComponent(r.name)}`,
            ...(r.mime ? { mime: r.mime } : {}),
            ...(r.description ? { description: r.description } : {}),
          })),
        };
      },
      runWorkflowTool: async (workflowId, version, input) =>
        this.runWorkflowAsTool({
          taskId: opts.taskId,
          workflowId,
          version,
          input,
          ctx: opts.ctx,
          nesting: opts.nesting,
          emit: opts.emit,
          onResolvedRef: opts.onResolvedRef,
        }),
    });

    // ruleBindings POST_CHECK: BLOCK violation → replace answer with violation explanation
    const mode = agent.ruleBindings.mode;
    if ((mode === "POST_CHECK" || mode === "BOTH") && result.outcome === "ANSWERED") {
      const answerText = result.answer.blocks
        .map((b) => (b.type === "text" ? b.markdown : ""))
        .filter(Boolean)
        .join("\n");
      try {
        const verdicts = await this.deps.dataCore.rules.evaluate(opts.ctx, agent.ruleBindings.ruleKeys, {
          answerText,
        });
        for (const v of verdicts) {
          if (v.ruleVersion !== undefined) {
            opts.onResolvedRef?.({ kind: "rule", key: v.ruleId, version: v.ruleVersion });
          }
        }
        const blocking = verdicts.filter((v) => !v.passed && v.severity === "BLOCK");
        if (blocking.length > 0) {
          const answer: Answer = {
            trustLevel: "AGENT_EXPLORATORY",
            blocks: blocking.map((v) => ({
              type: "rule_violation",
              ruleId: v.ruleId,
              severity: v.severity,
              explanation: v.explanation,
              provId: "prov_post_check",
            })),
            provenance: [],
            unverifiedNumerics: false,
          };
          return { ...result, answer };
        }
      } catch {
        /* post-check best effort: rules engine unavailable does not break the answer */
      }
    }
    return result;
  }

  /** Workflow-as-tool execution for agents (nested; shares the top-level budget). */
  async runWorkflowAsTool(opts: {
    taskId: string;
    workflowId: string;
    version: number | "latest";
    input: Record<string, unknown>;
    ctx: ToolAuthCtx;
    nesting: NestingCtx;
    emit: (event: string, payload: unknown) => Promise<void>;
    onResolvedRef?: (ref: ResolvedRef) => void;
  }): Promise<unknown> {
    const wf = await this.resolveWorkflow(opts.workflowId, opts.version);
    // §2.2 留痕：实际执行的 workflow 版本
    opts.onResolvedRef?.({ kind: "workflow", key: wf.key, version: wf.version });
    this.deps.metrics.nestedInvocations.inc({ kind: "workflow" });
    const child = enterNesting(opts.nesting, "workflow", wf.id);
    const result = await this.runWorkflowSteps({
      taskId: opts.taskId,
      steps: wf.steps,
      slots: opts.input,
      context: {},
      ctx: opts.ctx,
      nesting: child,
      emit: opts.emit,
      trustLevel: "AGENT_EXPLORATORY",
      onResolvedRef: opts.onResolvedRef,
    });
    if (result.status === "FAILED") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    return { status: "COMPLETED", answer: result.answer, stepOutputs: result.stepOutputs };
  }

  async resolveWorkflow(workflowId: string, version: number | "latest"): Promise<WorkflowDefinition> {
    const direct = await this.deps.repos.workflows.get(workflowId);
    if (!direct) throw new Error(`workflow not found: ${workflowId}`);
    if (version === "latest") {
      const latest = await this.deps.repos.workflows.latestByKey(direct.tenantId, direct.key);
      return latest ?? direct;
    }
    if (direct.version === version) return direct;
    const all = await this.deps.repos.workflows.listByTenant(direct.tenantId);
    const match = all.find((w) => w.key === direct.key && w.version === version);
    if (!match) throw new Error(`workflow version not found: ${direct.key} v${version}`);
    return match;
  }

  /** Run plan steps with full nesting support (used by QOS path A and standalone workflows). */
  async runWorkflowSteps(opts: {
    taskId: string;
    steps: ExtendedPlanStep[];
    slots: Record<string, unknown>;
    context: unknown;
    ctx: ToolAuthCtx;
    nesting: NestingCtx;
    emit: (event: string, payload: unknown) => Promise<void>;
    trustLevel?: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
    budgetForTools?: BudgetTracker;
    onResolvedRef?: (ref: ResolvedRef) => void;
  }): Promise<WorkflowResult> {
    const executor = this.makeExecutor(opts.taskId, opts.ctx, opts.budgetForTools);
    return runWorkflow(
      {
        executor,
        llm: this.deps.llm,
        metrics: this.deps.metrics,
        composeModel: await this.deps.llmSettings.roleModel(opts.ctx.tenantId, "compose"),
        emit: opts.emit,
        onResolvedRef: opts.onResolvedRef,
        runAgentStep: async (params) => {
          const r = await this.runRegisteredAgent({
            taskId: opts.taskId,
            agentId: params.agentId,
            version: params.version,
            prompt: params.prompt,
            ctx: opts.ctx,
            nesting: params.nesting,
            emit: opts.emit,
            expectsSchema: params.expectsSchema,
            onResolvedRef: opts.onResolvedRef,
          });
          return { structured: r.structured, answer: r.answer };
        },
      },
      {
        steps: opts.steps,
        slots: opts.slots,
        context: opts.context,
        nesting: opts.nesting,
        trustLevel: opts.trustLevel,
        tenantId: opts.ctx.tenantId,
      },
    );
  }
}
