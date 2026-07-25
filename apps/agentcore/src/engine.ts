import { mcpServerNameSlug, mcpToolFullName, type AgentDefinition, type Answer, type ResolvedRef, type SkillDefinition, type WorkflowDefinition } from "@platform/contracts";
import { runAgentLoop, type AgentLoopResult, type AgentToolSpec } from "./agent/loop.js";
import { AGENT_SYSTEM_CORE, buildSkillSection } from "./agent/prompts.js";
import { projectNavigationSlice, renderNavigationSlice, navigationSliceSolverKeys } from "./agent/navigation-slice.js";
import { buildOntologySemanticContext } from "./agent/ontology-context.js";
import { selectMcpTools } from "./agent/mcp-router.js";
import type { Embedder } from "./agent/skill-router.js";
import { buildProviderEmbedder, llmRollingSummarizer } from "./agent/production-cognition.js";
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
import type { FeatureGate } from "./features/gate.js";
import { ResourceRegistryService } from "./dril/resource-registry.js";
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
  /** WO-DRIL-P2 · entitlement 门（DRIL 检索 registry 依赖；缺省则 retrieve_knowledge 降级空结果）。 */
  features?: FeatureGate;
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
  /**
   * WO-FIVE-ROLE-AI-EMPLOYEE P1 · opt-in：强制 agent scopeDeclaration.objectTypes（越界读对象拒）。
   * Coordinator 角色扇出置 true（scope 真隔离）；既有路径不置 = 字节兼容不强制。
   */
  enforceObjectScope?: boolean;
}

/** Cross-wires the agent loop and the workflow executor (mutual nesting, shared budget). */
export class ExecutionEngine {
  /** WO-DRIL-P2 · DRIL 检索注册表（features 存在时懒建；供 retrieve_knowledge 工具）。 */
  private readonly resourceRegistry?: ResourceRegistryService;

  constructor(readonly deps: EngineDeps) {
    if (deps.features) {
      this.resourceRegistry = new ResourceRegistryService({
        repos: deps.repos,
        dataCore: deps.dataCore,
        features: deps.features,
      });
    }
  }

  makeExecutor(
    taskId: string,
    ctx: ToolAuthCtx,
    budget?: BudgetTracker,
    scopeToolNames?: string[],
    scopeObjectTypes?: string[],
  ): GuardedToolExecutor {
    return new GuardedToolExecutor(
      {
        dataCore: this.deps.dataCore,
        mcp: this.deps.mcp,
        repos: this.deps.repos,
        metrics: this.deps.metrics,
        skillResources: this.deps.skillResources,
        ...(this.resourceRegistry
          ? { retrieveResources: (ctx2: ToolAuthCtx, req) => this.resourceRegistry!.search(ctx2, req) }
          : {}),
      },
      { taskId, ctx, budget, scopeToolNames, ...(scopeObjectTypes ? { scopeObjectTypes } : {}) },
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
    const model = await this.deps.llmSettings.roleModel(agent.tenantId, "agent", agent.model || undefined);
    const expanded = await this.expandAgentTools(agent);
    const mcpSpecs = expanded.filter((t) => t.binding.kind === "MCP");
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

    // Phase8：路由用真 embedding provider（配置时一次性批量预算 query+候选文本向量，
    // 包成同步 Embedder 喂给 skill/MCP router；未配置或失败 → 上层回退 pseudoEmbed）。
    const cfg = this.deps.config;
    let embedder: Embedder | undefined;
    if (cfg.QOS_EMBEDDING_BASE_URL && cfg.QOS_EMBEDDING_MODEL) {
      const texts = [opts.prompt, ...skills.map((s) => `${s.name ?? ""} ${s.summary ?? ""}`), ...mcpSpecs.map((t) => t.name)];
      embedder = await buildProviderEmbedder(
        { baseUrl: cfg.QOS_EMBEDDING_BASE_URL, model: cfg.QOS_EMBEDDING_MODEL, apiKey: cfg.QOS_EMBEDDING_API_KEY },
        texts,
      );
    }

    // Phase6C MCP router：MCP 工具按 query 相关性收窄到 top-k（非 MCP 工具全保留；deferred 经 discover 发现）。
    let tools = expanded;
    if (mcpSpecs.length > 0) {
      const { full } = selectMcpTools(opts.prompt, mcpSpecs, 8, embedder);
      const keep = new Set(full.map((t) => t.name));
      tools = expanded.filter((t) => t.binding.kind !== "MCP" || keep.has(t.name));
    }
    // Phase5C skill 语义路由：按 query 相关性仅注入 top-k 全文 summary（其余 load_skill 按需取）。
    const system = `${agent.systemPrompt}\n\n${AGENT_SYSTEM_CORE}${buildSkillSection(skills, { query: opts.prompt, embedder })}`;

    // WO-QOS-2 · 导航切片注入（闭 G-AGENT-BLIND-REACT agent 侧半）：据本 agent 的 scopeDeclaration（objectTypes/toolNames）
    // 确定性投影本题导航图（对口 solver + 输出形状 + 相关对象/规则）注入首轮 user——agent 有对口 solver 就一步到位、
    // 不再 discover 盲扫逐跳。R6 纯投影（无 LLM）；空图返 ""（不注入·字节兼容）。sliceSolverKeys 供 loop plan 自检。
    const navSlice = projectNavigationSlice(opts.prompt, undefined, agent.scopeDeclaration);
    const sliceSection = renderNavigationSlice(navSlice);
    // WO-QOS-ONTOLOGY-CONTEXT · 口径语义锚定（缺口③文档三层投喂第二层）：紧随导航图 append 各字段/规则口径
    //（Metric formula/unit·派生公式·规则 expression·取自 A 单一真值 getTypeSemantics·TTL60s 缓存·只列涉及项）——
    // 综合步看"带口径标注的数据"。fail-open·纯 additive（供解释·非数据源·数字仍标 ⟦ref:N⟧）。
    const semanticSection = await buildOntologySemanticContext(navSlice, opts.ctx, this.deps.dataCore.ontology);
    const userContent = [opts.prompt, sliceSection, semanticSection].filter(Boolean).join("\n\n");
    const sliceSolverKeys = navigationSliceSolverKeys(navSlice);

    const executor = this.makeExecutor(
      opts.taskId,
      opts.ctx,
      opts.nesting.budget,
      agent.scopeDeclaration.toolNames,
      opts.enforceObjectScope ? agent.scopeDeclaration.objectTypes : undefined,
    );

    // Phase8：生产可启用 LLM 滚动摘要（QOS_ROLLING_SUMMARY_LLM=1）；缺省确定性拼接。
    const summarizer = cfg.QOS_ROLLING_SUMMARY_LLM === "1" ? llmRollingSummarizer(this.deps.llm, model, agent.tenantId) : undefined;

    const result = await runAgentLoop({
      taskId: opts.taskId,
      model,
      tenantId: agent.tenantId,
      system,
      userContent,
      ...(sliceSolverKeys.length > 0 ? { sliceSolverKeys } : {}),
      tools,
      llm: this.deps.llm,
      ...(summarizer ? { summarizer } : {}),
      executor,
      budget: opts.nesting.budget,
      // G-9 转圈根因修复：runRegisteredAgent（角色 agent / CEO 深问 / 场景启动器路径）此前漏传 per-call 超时，
      // 真 LLM 某次调用挂住时只有 budget.durationExceeded（轮首查一次）能兜——单次调用卡死永远到不了下一轮，
      // 循环卡死 → 不发终结事件 → 前端 useTaskStream 无限重连 → 转圈。接上 llmCallTimeoutMs 后：挂住的调用被
      // AbortController 上界终止 → 优雅降级（TIMEOUT）→ 发 answer.final/agent_degraded 终结事件 → 前端停转。
      llmCallTimeoutMs: cfg.QOS_AGENT_LLM_TIMEOUT_MS,
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
    /** WO-FIVE-ROLE P1：本工作流内 invoke_agent 步是否强制被调 agent 的 objectTypes scope（Coordinator 扇出置 true）。 */
    enforceAgentObjectScope?: boolean;
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
        crossValidate: (req) => this.deps.dataCore.ontology.crossValidate(opts.ctx, req),
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
            // WO-FIVE-ROLE P1：Coordinator 扇出（enforceAgentObjectScope）或步显式声明 enforceObjectScope → 强制被调 agent 对象 scope。
            ...(opts.enforceAgentObjectScope || params.enforceObjectScope ? { enforceObjectScope: true } : {}),
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
