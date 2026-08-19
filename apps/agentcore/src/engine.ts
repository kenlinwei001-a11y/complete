import { isWriteModeSkill, mcpServerNameSlug, mcpToolFullName, type AgentDefinition, type AgentRunKernel, type AgentRunRecord, type Answer, type ProvenanceRef, type ResolvedRef, type RuleVerdict, type SkillDefinition, type WorkflowDefinition, ErrorCodes } from "@platform/contracts";
import {
  attributionFields,
  originFields,
  runAgentLoop,
  skillGovernance,
  type AgentLoopResult,
  type AgentRunAttributionInput,
  type AgentRunPlacementInput,
  type AgentToolSpec,
} from "./agent/loop.js";
import { AGENT_SYSTEM_CORE, buildSkillSection } from "./agent/prompts.js";
import { projectNavigationSlice, renderNavigationSlice, navigationSliceSolverKeys, scopeCanInvokeSolvers } from "./agent/navigation-slice.js";
// WO-CAPMAP-LIVE · 能力地图注入源：活资源目录（替掉手写镜像）。
import { fetchLiveSolverCatalog, type CapabilityMapSource } from "./agent/live-capability-map.js";
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
import { newId } from "./ids.js";

// ---------------------------------------------------------------------------
// WO-SKILL-2 · Skill 运行时辅助（provenance 策略 / 写模式 / 规则引用预检后验）
// ---------------------------------------------------------------------------

function skillProvenancePolicy(skills: SkillDefinition[]): "required" | "best_effort" | "none" {
  if (skills.some((s) => s.provenancePolicy === "required")) return "required";
  if (skills.some((s) => s.provenancePolicy === "best_effort" || s.provenancePolicy === undefined)) return "best_effort";
  return "none";
}

function skillWriteMode(skills: SkillDefinition[]): boolean {
  // 判定单源在 contracts（见 isWriteModeSkill 注释：探针曾只判 sideEffect 半 → 在更小工具集上发合格证）
  return skills.some((s) => isWriteModeSkill(s));
}

/**
 * WO-S05（欠账 #154）· **强制执行型引用槽位登记表** —— 运行时真正会执行的 (kind, role) 组合单一来源。
 *
 * 病根不是「配错了一个字段」，是**配错了没人吭声**：契约词表允许 8 种 kind × 4 种 role = 32 种组合
 * （`SKILL_REFERENCE_KINDS` × `SKILL_REFERENCE_ROLES`），schema 一律放行；而 `precondition`/`postcheck`
 * 这两个**带强制语义**的 role，运行时只对少数 kind 真的做事。出厂唯一的 precondition 声明
 * （`capacity_action_draft` → `{kind:"solver", key:"capacity_forecast", role:"precondition"}`）
 * 恰好落在差集里：声明在、消费方在、两者对不上 —— 被 `kind === "rule"` 一行静默滤掉，不报错不告警。
 *
 * 本表是**消费方自己取值用的那一份**（下面 `skillRefKeys` 按它过滤，`skill-lint` 也 import 它），
 * 不是给 lint 抄的第二份清单 —— 抄一份就是装饰品：改了这边、lint 拿旧的去测、照样绿
 * （CLAUDE.md 铁律 0.6「金丝雀必须与主逻辑共用同一份实现」）。
 * 谁删掉一个消费方就得从本表删条目，lint 立刻开始报「声明了运行时不会执行的前置/后验」——
 * **机器先说话，而不是等下一个 dev 再踩一次**。
 *
 * `context` / `fallback` 两个 role 不在本表：它们是**告知性**的（由 `dril/resource-projector.ts:322`
 * 投影进资源图供检索），本就不承诺执行，不该被判为「没人消费」。
 */
export const ENFORCED_SKILL_REF_SLOTS: readonly { kind: string; role: "precondition" | "postcheck" }[] = [
  // engine 预检：BLOCK 即拦下，不调 LLM（见 runRegisteredAgent「Skill 规则引用预检」）
  { kind: "rule", role: "precondition" },
  // engine 后验：BLOCK 即把答案替换为 rule_violation
  { kind: "rule", role: "postcheck" },
  // WO-S05 新增：跑该技能前必须先成功调用该求解器（见 unmetSolverPreconditions / loadSkill 门）
  { kind: "solver", role: "precondition" },
];

/** 某 (kind, role) 组合运行时是否真的会被执行（lint 与 engine 共用同一判据）。 */
export function isEnforcedSkillRefSlot(kind: string, role: string): boolean {
  return ENFORCED_SKILL_REF_SLOTS.some((s) => s.kind === kind && s.role === role);
}

/**
 * 按 (kind, role) 抽取 skill 引用的 key 集合。
 *
 * 原 `skillRuleRefs` 把 `kind === "rule"` 硬编码在判据里，于是 `kind==="solver"` 的 precondition
 * 连「被看见」的机会都没有（#154）。这里把 kind 提成形参：rule 路径逐字节沿用既有语义，
 * solver 路径走下面 `unmetSolverPreconditions` 的另一套判据。
 */
function skillRefKeys(skills: SkillDefinition[], kind: string, role: "precondition" | "postcheck"): string[] {
  const keys: string[] = [];
  for (const s of skills) {
    for (const r of s.references ?? []) {
      if (r.kind === kind && r.role === role && (r.required === undefined || r.required)) {
        keys.push(r.key);
      }
    }
  }
  return [...new Set(keys)];
}

function skillRuleRefs(skills: SkillDefinition[], role: "precondition" | "postcheck"): string[] {
  return skillRefKeys(skills, "rule", role);
}

/**
 * WO-S05 · solver 类 precondition 的判据 —— 与 rule 类**不是同一种问题**，不能混进 `rules.evaluate`：
 * rule 问的是「当前是否违规」（规则引擎答），solver 问的是「这个求解器**跑过没有**」（本任务工具调用史答）。
 * 把 solver key 当规则 id 送进规则引擎，只会查无此规则并 fail-open —— 那是把一次静默丢弃换成另一次。
 *
 * 判「跑过」= 本任务里存在一条 `invoke_solver` 且 `outcome==="OK"` 且 `input.solverKey` 命中。
 * （MCP 形态 `mcp__solvers__{key}` 已在 `tools/executor.ts:164-168` 归一成同样的 toolName/input，故一并覆盖。）
 *
 * @returns 尚未满足的 solver key（空数组 = 全部满足）
 */
async function unmetSolverPreconditions(
  repos: Repos,
  taskId: string,
  solverKeys: string[],
): Promise<string[]> {
  if (solverKeys.length === 0) return [];
  const calls = await repos.toolCalls.listByTask(taskId);
  const succeeded = new Set<string>();
  for (const c of calls) {
    if (c.toolName !== "invoke_solver" || c.outcome !== "OK") continue;
    const key = (c.input as Record<string, unknown> | undefined)?.solverKey;
    if (typeof key === "string") succeeded.add(key);
  }
  return solverKeys.filter((k) => !succeeded.has(k));
}

/**
 * WO-S05 · precondition 未满足时**替代技能正文**下发的门禁说明。
 *
 * 为何不直接返回 undefined：loop 侧会把它渲染成 `skill not found`（`agent/loop.ts:579`）——
 * 那是**假信息**，模型会以为技能不存在而放弃，而不是「先去跑推演」。本文案照该技能 body 自己写的
 * 失败处理（「无结论则先跑推演」）给出可执行的下一步。
 */
function unmetPreconditionBody(skillKey: string, missingSolverKeys: string[]): string {
  const list = missingSolverKeys.map((k) => `\`${k}\``).join("、");
  return [
    `## 技能「${skillKey}」的前置条件尚未满足（平台门禁）`,
    "",
    `本技能声明了 precondition：必须**先成功调用**求解器 ${list}，拿到推演结论后才能使用。`,
    "本任务的工具调用记录里还没有这些求解器的成功调用，因此技能正文暂不下发。",
    "",
    "## 下一步",
    `1. 先调 \`invoke_solver\`（${list}）并拿到结果；`,
    "2. 再次 `load_skill` 加载本技能，届时会下发正文。",
    "",
    "不要在缺推演结论的情况下臆造数字或直接拟稿。",
  ].join("\n");
}

function ruleViolationAnswer(verdicts: RuleVerdict[]): Answer {
  const blocking = verdicts.filter((v) => !v.passed && v.severity === "BLOCK");
  return {
    trustLevel: "AGENT_EXPLORATORY",
    blocks: blocking.map((v) => ({
      type: "rule_violation" as const,
      ruleId: v.ruleId,
      severity: v.severity,
      explanation: v.explanation,
      provId: "prov_skill_rule_check",
    })),
    provenance: [],
    unverifiedNumerics: false,
  };
}

function emptyAgentRunRecord(
  taskId: string,
  model: string,
  budget: BudgetTracker,
  // WO-AGENTRUN-ATTRIBUTION：规则预检 BLOCK 的早退出口也是**这个 agent 的**一次运行（零迭代但确有归属），
  // 归属经同一个 `attributionFields` 投影 —— 不许在这里另抄一份字段拼装（抄了就会与 finishRun 漂）。
  attribution?: AgentRunAttributionInput,
  // WO-AGENTRUN-FANOUT-PERSIST：同理——被会诊扇出的子 agent 若在规则预检就被 BLOCK，那也是**它真跑过一次**
  // （零迭代但确有位置），照样得带上 FANOUT 落库，否则「这个 Agent 跑了几次」会漏掉被拦下的那些。
  placement?: AgentRunPlacementInput,
  // WO-DSH-P2-UX（N5）：内核标识。dsh 分叉两点恒 "EXTERNAL"；分叉前 BLOCK 早退点传 flag 态值
  // （`DSH_HARNESS === "1" ? "EXTERNAL" : "NATIVE"`，与分叉同一表达式）——标的是「本会走哪个内核」，
  // 该 run 未真执行任何循环，**不许**读成「真在 dsh 上跑过」（R13 不造数纪律）。
  kernel?: AgentRunKernel,
): AgentRunRecord {
  return {
    id: newId("run"),
    taskId,
    model,
    iterations: [],
    budget: budget.budget,
    budgetExhausted: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    ...attributionFields(attribution),
    ...originFields(placement),
    ...(kernel ? { kernel } : {}),
  };
}

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
  /**
   * WO-ROUTE-1（闭 E9·旁白在多角色路径上结构性不可达）· **纯透传**：`qos.reasoning-trace` 开时把每轮思考旁白
   * 经 `step.completed`(type=agent_narration) 流给前端。此前 `emitNarration` 全仓唯一调用点是 orchestrator
   * `runPathB` → `runCoordinator → runWorkflowSteps → runAgentStep → runRegisteredAgent` 这条链上一次都没传，
   * 默认 false → 多角色扇出（实测 6 次 agent 往返）一条旁白都发不出。缺省 undefined = 逐字节沿用既有行为。
   */
  emitNarration?: boolean;
  /**
   * WO-AGENTRUN-FANOUT-PERSIST（additive·可选）· 本次运行在编排结构里的位置。
   * 调用方是唯一知情人（loop/engine 都看不出自己是顶层还是被扇出的——taskId 是同一个）。
   * 不传 = 不写位置字段（既有调用方逐字节兼容）。
   */
  placement?: AgentRunPlacementInput;
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

  /**
   * WO-CAPMAP-LIVE · 活资源目录检索面（**单一实例**·orchestrator 与本引擎共用，不各建一个）。
   * 供能力地图注入源（`fetchLiveSolverCatalog`）与 `retrieve_knowledge` 复用同一份投影/检索实现。
   * `features` 缺省 → `undefined` → 注入方 fail-open 退降级镜像。
   */
  capabilityMapSource(): CapabilityMapSource | undefined {
    return this.resourceRegistry;
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

    // WO-AGENTRUN-ATTRIBUTION · 归属取自**刚刚真解析出来的这一版** agent（`resolveAgent` 已按 latest/固定版落定），
    // 不是调用方传进来的 `opts.agentId`——后者可能是 key/latest 之类的间接说法，拿它当归属就会把
    // 「跑的是 v3」记成「跑的是 latest」，换版之后再也对不上。同一份 agent 也用于 tenantId（越租户绝不混）。
    const attribution: AgentRunAttributionInput = {
      tenantId: agent.tenantId,
      agentId: agent.id,
      agentKey: agent.key,
      agentVersion: agent.version,
    };

    const skills = [];
    for (const s of agent.skills) {
      // §2.1：skill 引用缺省 latest（执行时解析）；§2.2：留痕含 skill 版本（L8）
      const skill = await this.resolveSkill(agent.tenantId, s.skillId, s.version ?? "latest");
      if (skill) {
        skills.push(skill);
        opts.onResolvedRef?.({ kind: "skill", key: skill.key, version: skill.version });
      }
    }

    // WO-SKILL-2 · Skill 运行时策略聚合
    const effectiveProvenancePolicy = skillProvenancePolicy(skills);
    const writeMode = skillWriteMode(skills);

    // WO-SKILL-2 · Skill 规则引用预检：任一 precondition BLOCK → 立即返回 rule_violation，不调用 LLM
    const preRuleKeys = skillRuleRefs(skills, "precondition");
    if (preRuleKeys.length > 0) {
      try {
        const verdicts = await this.deps.dataCore.rules.evaluate(opts.ctx, preRuleKeys, { queryText: opts.prompt });
        for (const v of verdicts) {
          if (v.ruleVersion !== undefined) {
            opts.onResolvedRef?.({ kind: "rule", key: v.ruleId, version: v.ruleVersion });
          }
        }
        if (verdicts.some((v) => !v.passed && v.severity === "BLOCK")) {
          return {
            outcome: "ANSWERED",
            answer: ruleViolationAnswer(verdicts),
            // WO-DSH-P2-UX（N5）：此早退点在 dsh 分叉**之前**——标「本会走哪个内核」（flag 态值，
            // 与下方分叉同一表达式），该 run 未真执行任何循环，不许读成「真在 dsh 上跑过」。
            run: emptyAgentRunRecord(opts.taskId, model, opts.nesting.budget, attribution, opts.placement, process.env.DSH_HARNESS === "1" ? "EXTERNAL" : "NATIVE"),
            sketch: [],
          };
        }
      } catch {
        // fail-open：规则引擎不可用时，预检不阻断主流程
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
    // WO-AGENT-RUNTIME-S01 · item 6（治 workflow_capacity_check DENIED）：scopeToolNames = 声明白名单 ∪ **本 agent 实际
    // 被授予的工具名**（expanded：BUILTIN/workflow_<key>/mcp__…）。根因——seed 给 agt_capacity_planner 配了 workflow_capacity_check
    // 工具，但其 scopeDeclaration.toolNames 漏列该名 → 调用即 AGENT_SCOPE_VIOLATION DENIED（子 agent 盲扫烧预算的一环）。
    // 一个 agent 被显式配置的工具**绝不应被自身 scope 门拒**（「给它该工具」）；并集**只加不减**（声明已覆盖者 = 原集·byte-compatible），
    // 越界工具（未配置给该 agent）仍被拒（安全语义不变）。此处修 scope 派生，不动 seed（seed.ts 禁碰）。
    const effectiveScopeToolNames = [...new Set([...agent.scopeDeclaration.toolNames, ...tools.map((t) => t.name)])];
    // Phase5C skill 语义路由：按 query 相关性仅注入 top-k 全文 summary（其余 load_skill 按需取）。
    const system = `${agent.systemPrompt}\n\n${AGENT_SYSTEM_CORE}${buildSkillSection(skills, { query: opts.prompt, embedder })}`;

    // WO-QOS-2 · 导航切片注入（闭 G-AGENT-BLIND-REACT agent 侧半）：据本 agent 的 scopeDeclaration（objectTypes/toolNames）
    // 确定性投影本题导航图（对口 solver + 输出形状 + 相关对象/规则）注入首轮 user——agent 有对口 solver 就一步到位。
    // R6 纯投影（无 LLM）；空图返 ""（不注入·字节兼容）。sliceSolverKeys 供 loop plan 自检。
    // ★ WO-CAPMAP-LIVE · 注入源 = **活资源目录**（59 solver）现取 top-N 相关候选，不再是那份 19 条手写镜像；
    //   取不到（registry 未装配 / A 不可达 / 未开通）→ liveCatalog=undefined → 退降级镜像（fail-open·不阻断）。
    //   跳过条件：本 agent 根本调不了 solver（scope 工具白名单无 invoke_solver / mcp 求解器工具）——
    //   那样投影出的图里一条 solver 都不会列，取目录纯属白花一次 A 侧往返。
    const liveCatalog = scopeCanInvokeSolvers(agent.scopeDeclaration.toolNames)
      ? await fetchLiveSolverCatalog(this.capabilityMapSource(), opts.ctx, opts.prompt)
      : undefined;
    const navSlice = projectNavigationSlice(opts.prompt, undefined, agent.scopeDeclaration, liveCatalog);
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
      effectiveScopeToolNames,
      opts.enforceObjectScope ? agent.scopeDeclaration.objectTypes : undefined,
    );

    // Phase8：生产可启用 LLM 滚动摘要（QOS_ROLLING_SUMMARY_LLM=1）；缺省确定性拼接。
    const summarizer = cfg.QOS_ROLLING_SUMMARY_LLM === "1" ? llmRollingSummarizer(this.deps.llm, model, agent.tenantId) : undefined;

    // -----------------------------------------------------------------------
    // WO-DSH-POC-S4 · 路 B（dsh harness）**休眠分叉**：仅 DSH_HARNESS=1 时走 JSON-RPC
    // 子进程路径（packages/dsh-harness），缺省关闭 = 下方 runAgentLoop 逐字节旧行为。
    // 动态 import：flag 关时 dsh 模块根本不加载。POC 验收专用；postcheck 规则后验
    // （下方 POST_CHECK 段）在此路径不外挂——验收对照的是 loop 本体语义。
    // 守卫必须直读 process.env.DSH_HARNESS：check-dsh-dormancy.mjs D3 判据只认
    // 「条件里提到 process.env.DSH_HARNESS」的包裹块（cfg 转发会被判裸入口，门红）。
    if (process.env.DSH_HARNESS === "1") {
      const { buildSessionSetup, mapMcpConfig, mapSkill, runDshAgent } = await import("./dsh-runtime/index.js");
      // WO-MCP-FORWARD · additive 转发（静默丢字段同族病第四例）：agent.mcpServers 非空时
      // 经 mapMcpConfig 逐个映射进 setup——serverName 白名单校验 + 映射期解密注入（安全注记
      // 同 setup-spec.ts mapMcpConfig：明文仅过本机父子进程 stdio wire，不落日志）；凭据行缺失/
      // 解不出 = fail-closed 抛错（mapMcpConfig credentialRef unresolvable），不静默降级为无凭据
      // 连接。空/缺省 = 零 mcpServers 键（既有 `...(x ? {...} : {})` 散布形态），逐字节旧行为。
      // 解密件在块内动态取：全部改动收在本分叉块，flag 关时零加载。
      const mcpServers: ReturnType<typeof mapMcpConfig>[] = [];
      if (agent.mcpServers.length > 0) {
        const { decryptSecret } = await import("./crypto.js");
        for (const ref of agent.mcpServers) {
          const mcpConfig = await this.deps.repos.mcpConfigs.get(ref.mcpConfigId);
          if (!mcpConfig) throw new Error(`dsh mcp forward: mcp config not found: ${ref.mcpConfigId}`);
          const credRow = mcpConfig.credentialRef ? await this.deps.repos.credentials.get(mcpConfig.credentialRef) : undefined;
          const secret = credRow ? decryptSecret(credRow.ciphertext, cfg.CREDENTIAL_KEY) : undefined;
          mcpServers.push(mapMcpConfig(mcpConfig, () => secret));
        }
      }
      const setup = buildSessionSetup({
        agent,
        agentSystemCore: AGENT_SYSTEM_CORE,
        grantedToolNames: tools.map((t) => t.name),
        skills: skills.map((s) => mapSkill(s)),
        ...(mcpServers.length ? { mcpServers } : {}),
        ...(opts.expectsSchema ? { expectsSchema: opts.expectsSchema } : {}),
      });
      // WO-DSH-N1-PROVIDER：model spec（dcp:{providerId}:{modelId}）不再原样当 wire model——
      // 经绑定矩阵解析出连接事实（modelId 剥前缀/kind/baseUrl/apiKey），env 缝注入子进程；
      // provider 路由取 cfg.DSH_HARNESS_PROVIDER（生产值单源 = PRODUCTION_DSH_HARNESS_PROVIDER，
      // 无 mock 回退）。非 dcp / custom_http ⇒ resolveConnectionFacts 诚实抛错。
      const facts = await this.deps.llmSettings.resolveConnectionFacts(model, agent.tenantId);
      const dsh = await runDshAgent(
        {
          prompt: userContent,
          setup,
          provider: cfg.DSH_HARNESS_PROVIDER,
          model: facts.modelId,
          reassemble: {
            governance: { writeMode, provenancePolicy: effectiveProvenancePolicy },
            ...(opts.expectsSchema ? { expectsSchema: opts.expectsSchema } : {}),
          },
          onSse: (e) => { void opts.emit(e.event, e.payload); },
        },
        {
          env: {
            PLATFORM_LLM_API: facts.kind === "anthropic" ? "anthropic-messages" : "openai-completions",
            ...(facts.baseUrl ? { PLATFORM_LLM_BASE_URL: facts.baseUrl } : {}),
            PLATFORM_LLM_MODEL: facts.modelId,
            ...(facts.apiKey ? { PLATFORM_LLM_API_KEY: facts.apiKey } : {}),
            ...(facts.contextWindow ? { PLATFORM_LLM_CONTEXT_WINDOW: String(facts.contextWindow) } : {}),
          },
        },
      );
      if (!dsh.result.ok) {
        return {
          outcome: "FAILED",
          answer: {
            trustLevel: "AGENT_EXPLORATORY",
            blocks: [{ type: "text", markdown: `dsh 重组装拒绝：${dsh.result.errors.join("; ")}` }],
            provenance: [],
            unverifiedNumerics: false,
          },
          run: emptyAgentRunRecord(opts.taskId, model, opts.nesting.budget, attribution, opts.placement, "EXTERNAL"),
          sketch: [],
        };
      }
      // N2·D-2：dsh.result.stats 并入 answer 交叉类型（additive 运行时键；orchestrator:2187
      // answer.final 整对象直发即自动带上，reducer :129 整对象落 state 零渲染副作用）。
      // 失败路径（上方 :517-529）不造 stats；零 usage 帧时 reassemble 侧键整体不出。
      // 类型从上方已动态 import 的 runDshAgent 派生（dormancy D3：全仓只许一处 dsh-runtime 入口，
      // 类型位 import("./dsh-runtime/reassemble.js") 会被判第二入口）。
      type DshOkResult = Extract<Awaited<ReturnType<typeof runDshAgent>>["result"], { ok: true }>;
      const answer: AgentLoopResult["answer"] & { stats?: DshOkResult["stats"] } = {
        ...dsh.result.answer,
        ...(dsh.result.stats ? { stats: dsh.result.stats } : {}),
      };
      if (dsh.result.degraded?.reason === "STALL_LOOP") this.deps.metrics.agentLoopRepeat.inc(); // N3：对位 loop.ts:641（两 fork 互斥无双计）
      return {
        outcome: dsh.result.outcome,
        answer,
        run: emptyAgentRunRecord(opts.taskId, model, opts.nesting.budget, attribution, opts.placement, "EXTERNAL"),
        sketch: dsh.result.sketch,
        ...(dsh.result.structured ? { structured: dsh.result.structured } : {}),
        ...(dsh.result.degraded ? { degraded: dsh.result.degraded } : {}),
      };
    }

    const result = await runAgentLoop({
      taskId: opts.taskId,
      model,
      tenantId: agent.tenantId,
      attribution, // WO-AGENTRUN-ATTRIBUTION：注册 agent 路 ⇒ REGISTERED（agentId/Key/Version 三件套齐）
      // WO-AGENTRUN-FANOUT-PERSIST：纯透传（不传 = 不写位置字段·既有调用方字节兼容）。
      ...(opts.placement ? { placement: opts.placement } : {}),
      system,
      userContent,
      ...(sliceSolverKeys.length > 0 ? { sliceSolverKeys } : {}),
      tools,
      llm: this.deps.llm,
      ...(summarizer ? { summarizer } : {}),
      // WO-ROUTE-1（E9）· 纯透传：不传 = 逐字节沿用既有（loop 侧 `opts.emitNarration` 缺省 false → 不发）。
      ...(opts.emitNarration ? { emitNarration: true } : {}),
      executor,
      budget: opts.nesting.budget,
      llmCallTimeoutMs: cfg.QOS_AGENT_LLM_TIMEOUT_MS,
      loopRepeatCap: cfg.QOS_AGENT_LOOP_REPEAT_CAP,
      repos: this.deps.repos,
      metrics: this.deps.metrics,
      emit: opts.emit,
      isCancelled: opts.isCancelled,
      expectsSchema: opts.expectsSchema,
      provenancePolicy: effectiveProvenancePolicy,
      writeMode,
      loadSkillEnabled: true,
      scopeToolNames: effectiveScopeToolNames,
      loadSkill: async (skillId: string) => {
        const pinned = agent.skills.find((x) => x.skillId === skillId)?.version ?? "latest";
        const skill = await this.resolveSkill(agent.tenantId, skillId, pinned);
        if (!skill) return undefined;
        opts.onResolvedRef?.({ kind: "skill", key: skill.key, version: skill.version });
        // WO-S05（#154）· solver 类 precondition 在**使用点**求值，而不是 runRegisteredAgent 开跑时。
        // 为何不放在上面那条预检里：开跑那一刻求解器**必然还没跑**（agent 要在 loop 里先调 invoke_solver
        // 才拿得到推演结论），开跑即拦 = 该技能永远用不了。本技能 body 写的正是「无结论则先跑推演」——
        // 前置条件是在 loop 内由 unmet 翻成 met 的，所以门必须落在「模型来取正文」这一刻。
        const missingSolvers = await unmetSolverPreconditions(
          this.deps.repos,
          opts.taskId,
          skillRefKeys([skill], "solver", "precondition"),
        );
        if (missingSolvers.length > 0) {
          // 下发的是门禁说明而非技能正文；治理位仍按**该技能真实声明**回报（只收紧不放宽的方向），
          // 不因「这次没给正文」而放松闸门。
          return { body: unmetPreconditionBody(skill.key, missingSolvers), resources: [], ...skillGovernance(skill) };
        }
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
          // WO-R4-FREEQA-GATE · 逐技能治理位回报（R4）。本路径本已有开跑静态聚合位，这里回报是**单调冗余**
          // （只收紧不放宽 ⇒ 对本路径行为零改变），目的是让两条 loadSkill 路径**回报同一份口径**——
          // 不允许「一条路报、另一条路不报」再次分叉。判定单源仍是契约 `isWriteModeSkill`。
          ...skillGovernance(skill),
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

    // WO-SKILL-2 · Skill 规则引用后验：postcheck BLOCK → 替换为 rule_violation（在 agent.ruleBindings POST_CHECK 之前）
    const postRuleKeys = skillRuleRefs(skills, "postcheck");
    if (postRuleKeys.length > 0 && result.outcome === "ANSWERED") {
      const answerText = result.answer.blocks
        .map((b) => (b.type === "text" ? b.markdown : ""))
        .filter(Boolean)
        .join("\n");
      try {
        const verdicts = await this.deps.dataCore.rules.evaluate(opts.ctx, postRuleKeys, { answerText });
        for (const v of verdicts) {
          if (v.ruleVersion !== undefined) {
            opts.onResolvedRef?.({ kind: "rule", key: v.ruleId, version: v.ruleVersion });
          }
        }
        if (verdicts.some((v) => !v.passed && v.severity === "BLOCK")) {
          return { ...result, answer: ruleViolationAnswer(verdicts) };
        }
      } catch {
        // fail-open
      }
    }

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
    // WO-SCENARIO-INPUT-PHASE0：嵌套 workflow 必须先消耗共享预算，防止无限烧。
    const budgetOk = child.budget.tryConsumeWorkflow();
    if (!budgetOk.ok) {
      throw new Error(`${ErrorCodes.BUDGET_EXCEEDED}: ${budgetOk.reason}`);
    }
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
    if (result.status === "CANCELLED") {
      throw new Error(`CANCELLED: ${result.reason}`);
    }
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
    /**
     * WO-ROUTE-1（闭 E9）· **纯透传**：本工作流内 invoke_agent 步启动的子 agent 是否发思考旁白
     * （Coordinator 多角色扇出据 `qos.reasoning-trace` 置 true）。缺省不传 = 既有行为逐字节不变。
     */
    emitNarration?: boolean;
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
          const agentStepT0 = Date.now(); // WO77：降级帧 durationMs 计时起点（仅审计时长·不入答案/溯源）
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
            // WO-ROUTE-1（E9）· 纯透传：多角色扇出的每个子 agent 都发旁白（不传 = 既有行为字节不变）。
            ...(opts.emitNarration ? { emitNarration: true } : {}),
            // WO-AGENTRUN-FANOUT-PERSIST：这一步跑出来的是**子** agent 的运行（父任务的 taskId，但不是父任务那条）。
            placement: { origin: "FANOUT", stepId: params.stepId },
          });
          // ★★ WO-AGENTRUN-FANOUT-PERSIST · 缺口就在这一行原本不存在 ★★
          // 此前这里只 `return { structured, answer }` —— `r.run`（这个子 agent 整整一轮循环的迭代、
          // 工具调用、token、预算、上下文清理留痕）被**整个丢掉**，一个字节都没落库。
          // 后果不是抽象的：多角色会诊真跑三个角色 agent，而 Agent 管理台「本 Agent 的运行」
          // 里那三个角色一条都不在 —— 用户看到的是"这个 Agent 从没跑过"。
          //
          // 为什么落在 engine 而不是 orchestrator：`invoke_agent` 步可以出现在**任何**工作流里
          // （多角色会诊只是其中一种），挂在 orchestrator 的 Coordinator 分支上就只补了这一条路，
          // path-A 工作流里的 agent 步照样漏。这里是这类子运行的唯一必经之地。
          //
          // 不吞异常：与编排层三处顶层 insert（`orchestrator.ts` 的 runPathB / runRolePathB / runSceneAgent）同姿势。写失败就让它响，
          // 静默 catch 会把「落库坏了」伪装成「这个 Agent 没跑过」——正是本单要修的那种病。
          await this.deps.repos.agentRuns.insert(r.run);
          // ★★ WO77 · 静默丢字段族第三例（G-9 降级冒泡）★★
          // 此前这里只 `return { structured, answer }` —— `r.degraded`（子 run 有界终止降级置位·loop.ts degrade
          // 唯一诚实出口）被**整个丢弃**：计量说降级了（agentLoopRepeat 已 +1）、汇总答案里带着子 agent 的诚实
          // 降级块，唯独 SSE 帧流缺 step.completed{type:"agent_degraded"} 伪帧（前端/审计无感知）。
          // 同族先例：orchestrator.ts runPathB 的 G-9 发射块（result.degraded → agent_degraded 伪 step）。
          // 归属子 agentId + 扇出 stepId 原值（前端分栏/审计认 agent·非 newId 匿名）；outcome 取 reason 原值逐字。
          // 发射点=子 run 完成即帧 ⇒ 必早于 executor 对父步的 step.completed{type:"invoke_agent"}
          //（executor.ts 在 runAgentStep 返回后才 emitDone）与 answer.final（G-9 硬次序）。
          // 纯增量：非降级子 run 零帧·流逐字节不变；不 inc 计量（loop.ts degrade 已计·不双计）；
          // 不改 structured/answer 一个字节；不抛异常（emit 失败随调用链上抛·与 insert 同姿势不静默 catch）。
          if (r.degraded) {
            await opts.emit("step.completed", {
              stepId: params.stepId,
              agentId: params.agentId,
              type: "agent_degraded",
              outcome: r.degraded.reason,
              durationMs: Date.now() - agentStepT0,
            });
          }
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
