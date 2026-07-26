import type {
  AgentBudget,
  Answer,
  AnswerBlock,
  CeoAgentProfile,
  ClarificationReplyBody,
  ClassificationResult,
  Decision,
  CoordinatorPlan,
  IntentDefinition,
  QueryTask,
  ResolvedRef,
  ScenarioPackage,
  SceneEntryConfig,
  SlotDef,
  SubmitQueryBody,
} from "@platform/contracts";
import { ErrorCodes } from "@platform/contracts";
import { resolvePlanForIntent } from "../catalog/service.js";
import { parseDataCoreSpec } from "../llm/providers.js";
import type { RequestAuth } from "../auth.js";
import {
  agentPriorSummary,
  buildAgentUser,
  buildClassifierSystem,
  buildClassifierUser,
  classifierConversationSummary,
  resolvePromptOverride,
  AGENT_SYSTEM_CORE,
  CEO_DEEP_QUESTION_SYSTEM,
} from "../agent/prompts.js";
import { runAgentLoop, type AgentToolSpec } from "../agent/loop.js";
import { projectNavigationSlice, renderNavigationSlice, navigationSliceSolverKeys } from "../agent/navigation-slice.js";
import { buildOntologySemanticContext } from "../agent/ontology-context.js";
import { makeLlmRollingSummarizer } from "../agent/context.js"; // WO-CONTEXT-COMPRESSION · 真 LLM 滚动摘要器（fail-open 注入 runAgentLoop.summarizer）
import { compileSolverPlan, type CompileSlots } from "./compile-plan.js"; // WO-Phase2-C-COMPLETE · 组合路径编译器（地基·消费不改）
import { executePlan } from "./execute-plan.js"; // WO-Phase2-C-COMPLETE · 组合路径执行器（服务端多步 + 一次综合·不经 runAgentLoop）
import {
  isSimComposeQuery,
  buildSimNavSlice,
  simComposeSlots,
  isCapacityWhatIfQuery,
  buildCapacityNavSlice,
  capacityComposeSlots,
  isCapacityFeasibilityQuery,
  parseCapacityFeasibilityVariant,
  buildFeasibilityNavSlice,
  feasibilityComposeSlots,
} from "../agent/sim-planner.js"; // WO-GSIM-4-AGENT 推演 NL 大脑 + WO-LIVE-NL 产能 what-if NL 意图路由 + WO-AGENT-RUNTIME-S01 产能可行性变体（均投影推演专属 navSlice 交 Phase2-C 组合器）
import type { GuardedToolExecutor } from "../tools/executor.js";
import type { ComposePlan } from "@platform/contracts";
import type { AppConfig } from "../config.js";
import type { ExecutionEngine } from "../engine.js";
import { TaskEvents } from "../events.js";
import type { FeatureGate } from "../features/gate.js";
import { intentAllowed, type FeatureSet } from "../features/registry.js";
import { newId } from "../ids.js";
import type { LlmSettings } from "../llm/providers.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import { BudgetTracker } from "../tools/budget.js";
import { BUILTIN_TOOLS, SIM_COMMANDER_TOOLS } from "../tools/registry.js";
import { pseudoEmbed } from "../util/embedding.js";
import { clarifyPromptFor, fillSlots } from "./slots.js";
import { resolveCeoRoute, isCeoQuestion, ceoIntentKeyForRoute, isCeoIntentKey, resolveBlockRoute, hasBlockContext, decisionCommitIntent, shouldUseFreeLLM } from "./ceo-route.js"; // WO-CEO-6 · CEO 深问确定性路由（闭 G-3）· WO-BLOCK-DIALOGUE 块级定向路由（闭 G-3 块级）· WO-DECISION-KERNEL-WIRE 成决策意图分档 · WO-REAL-LLM-FREE-QUERY 真 LLM 自由多跳判定
import { domainResolve, domainResolveMulti, preferDeterministicSolver, DETERMINISTIC_PREFERENCE_THRESHOLD, type DomainRoute } from "./domain-resolver.js"; // WO-QOS-1 · 确定性优先门（有对口 solver 的高置信题在 path-B 入口前拉回 path-A·闭 G-AGENT-BLIND-REACT 路由侧）· WO-DETERMINISTIC-CROSS-DOMAIN domainResolveMulti（跨域逐域枚举）
import { selectDeterministicMultiRoute, detectCoupledPairs, runDeterministicMultiPath as execDeterministicMultiPath } from "./multi-route.js"; // WO-DETERMINISTIC-CROSS-DOMAIN · 确定性多域分路（判定 + 并行 solver + 零 LLM 块装配·排在 LLM classify 之前）
import { planCoordination, buildDispatchSteps, synthesize, detectSingleRole, type RoleAnswerInput } from "./coordinator.js"; // WO-FIVE-ROLE-AI-EMPLOYEE P1 · 跨域多角色 Coordinator 编排
import { roleProfile } from "../mocks/seed.js"; // WO-FIVE-ROLE P1 · 角色画像（path-B 按 role 选 agent）
import { roleSystemFragment } from "../agent/prompts.js";
import { injectScenarioRuleStep } from "./scenario-rules.js";
import { recordOutOfDomain, recordResolutionAttempts } from "./perception-metrics.js";
import { ResourceRegistryService } from "../dril/resource-registry.js"; // WO-DRIL-P4 · Path-B 组包注入（PRD §8.3·消费 P2/P3 registry·不改真值源）
import { ResourceRouter, type ResourcePackage } from "../dril/resource-router.js"; // WO-DRIL-P4 · buildResourcePackage 组包（P3 地基·additive 消费）

const CLARIFICATION_TIMEOUT_MS = 10 * 60_000;

/**
 * 增量4 §5：AI 推演指挥台 entitlement 判定 —— sim 工具仅当 sim.commander 且 sim.sandbox 同开才对 agent 可见。
 * 这两键不在 AgentCore FeatureRegistry 里（权威集来自 DataCore），故不能用 featureEnabled（它对未注册键恒真）；
 * 显式要求两键齐备。set="ALL"（mock 默认/降级 fail-open）→ 视为全开（与现有 entitlement 语义一致）。
 */
function simCommanderEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return true;
  return set.has("sim.commander") && set.has("sim.sandbox");
}

/**
 * WO-DECISION-KERNEL-WIRE：从 workflow stepOutputs 定位真 decision_play 产物（invoke_solver 步存 ToolPayload {data,…}）。
 * 扫描各步输出，取首个 `.data.recommendedPlan.optionIds` 非空者——解耦具体 step id（不写死 "s1"）。
 */
function findDecisionPlayOutput(stepOutputs: Record<string, unknown>): {
  rootCause?: { metricKey?: string; factorId?: string };
  recommendedPlan?: { optionIds?: string[] };
} | undefined {
  for (const v of Object.values(stepOutputs)) {
    const data = (v as { data?: unknown } | null | undefined)?.data;
    if (data && typeof data === "object") {
      const rp = (data as { recommendedPlan?: { optionIds?: unknown } }).recommendedPlan;
      if (rp && Array.isArray(rp.optionIds) && rp.optionIds.length > 0) {
        return data as { rootCause?: { metricKey?: string; factorId?: string }; recommendedPlan?: { optionIds?: string[] } };
      }
    }
  }
  return undefined;
}

/** WO-DECISION-KERNEL-WIRE：把成决策结果追加为答案文本块（台账 id + 状态 + 选定方案 + ActionDraft·让"止步方案"的答案落地成决策）。 */
function appendDecisionBlock(answer: Answer, decision: Decision): Answer {
  const statusLabel =
    decision.status === "COMMITTED"
      ? "已定案（COMMITTED·已派发行动草案进 S2 审批）"
      : "已成决策（PROPOSED·待定案）";
  const draftNote = decision.actionDraftIds.length > 0 ? `·行动草案 ${decision.actionDraftIds.join("、")}` : "";
  const md = `**决策台账 ${decision.id}** — ${statusLabel}（选定方案 ${decision.chosenOptionIds.join("、")}${draftNote}）`;
  return { ...answer, blocks: [...answer.blocks, { type: "text", markdown: md }] };
}

/**
 * WO-REAL-LLM-FREE-QUERY · feature 门①：CEO/块级深问是否可走 path-B 真 LLM 自由多跳。**暗发·默认关**。
 *
 * 关键设计（字节兼容·零回归）：`set==="ALL"`（mock 默认 / DataCore 降级 fail-open）→ **返回 false**，即真 LLM 分路
 * 在 mock 默认态一律不触发（既有 CEO/block 确定性测试逐字节不变）；且生产降级态落确定性安全路径（更稳）。
 * 仅当 DataCore 解析出的**显式** Set 含 `ceo.free-llm`，或 `sim.commander`+`sim.sandbox` 同开时，真 LLM 分路才启用。
 * 与 `shouldUseFreeLLM`（问句形态②+上下文丰富③）AND 组合——三者齐备方走真 LLM，否则照走确定性/classifier。
 */
export function freeLlmEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("ceo.free-llm") || (set.has("sim.commander") && set.has("sim.sandbox"));
}

/**
 * WO-FIVE-ROLE-AI-EMPLOYEE P1 · feature 门：跨域问题是否召集 Coordinator 多角色编排。**暗发·默认关**。
 * 与 freeLlmEnabled 同款字节兼容策略：`set==="ALL"`（mock 默认 / DataCore 降级）→ **false**（既有单 agent path-B
 * 逐字节不变·C4 不劫持）；仅当**显式** Set 含 `agent.coordinator` 才启用。双注册（datacore features.ts + agentcore registry）。
 */
export function coordinatorEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("agent.coordinator");
}

/**
 * WO-Phase2-C-COMPLETE · feature 门：runPathB 内是否启用**组合路径**（多对口 solver 服务端编排 + 一次综合）。**暗发·默认关**。
 * 与 coordinatorEnabled/freeLlmEnabled 同款字节兼容策略：`set==="ALL"`（mock 默认 / DataCore 降级）→ **false**——
 * 既有 path-B（含 CEO/块级真 LLM 深问经 runCeoFreeLLM→runPathB）逐字节不变·不劫持；仅**显式** Set 含 `qos.compose-path` 才启用。
 */
function composePathEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.compose-path");
}

/**
 * WO-DRIL-P4 · feature 门：runPathB 内是否在 runAgentLoop 前注入 **DRIL 资源包**（跨 solver/slice/rule/skill/workflow
 * 一次预选，写入首轮 user prompt → agent 不再盲 discover 逐跳）。**暗发·默认关**（PRD-decision-resource-intelligence-layer §8.3）。
 * 与 composePathEnabled/coordinatorEnabled 同款字节兼容策略：`set==="ALL"`（mock 默认 / DataCore 降级）→ **false**——
 * 既有 path-B（含 CEO/块级真 LLM 深问）逐字节不变·不劫持；仅**显式** Set 含 `qos.dril-routing` 才启用（组包空亦不注入）。
 */
function drilRoutingEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.dril-routing");
}

/**
 * WO-LIGHTUP · feature 门：runPathB 收尾前是否启用**反思闭环**（reflect.ts 确定性复盘 R6 + LLM critic advisory·fail-open）。
 * **暗发·默认关**——补齐 REFLECT-LOOP 当年甩给「WO-0 领域」未做的**生产接线**（loop.ts 早支持 opts.reflect/critic，但 orchestrator
 * 从未注入 → 反思步一直是死代码）。与 composePathEnabled 同款字节兼容：`set==="ALL"`（mock 默认 / DataCore 降级）→ **false**——
 * 既有 path-B 逐字节不变·不劫持；仅**显式** Set 含 `agent.critic` 才启用（reflect 确定性主判 + critic advisory 叠加）。
 */
export function reflectEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("agent.critic");
}

/**
 * WO-REASONING-TRACE · 是否把 path-B agent 每轮"思考旁白"实时流给前端（建人机信任·暗发 `qos.reasoning-trace`）。
 * `set==="ALL"`（mock 默认/降级）→ false = 字节兼容零回归（既有 agent 测试不发旁白·事件流逐字节不变）。
 */
export function reasoningTraceEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.reasoning-trace");
}

/**
 * WO-DETERMINISTIC-CROSS-DOMAIN · feature 门：是否启用**确定性多域分路**（跨域题在确定性层逐域枚举 + 并行 solver +
 * 零 LLM 块装配·排在 LLM classify 之前）。**暗发·默认关**。与 freeLlmEnabled/coordinatorEnabled 同款字节兼容：
 * `set==="ALL"`（mock 默认 / DataCore 降级）→ **false**——既有"跨域压分→落 LLM/单域"管线逐字节不变（SEAM-5 零回归·
 * 不劫持）；仅**显式** Set 含 `qos.deterministic-multi-domain` 才启用（DataCore 侧已加入 all-on/dark-launch 排除·
 * battery「all on」也保持关）。
 */
export function deterministicMultiEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.deterministic-multi-domain");
}

/**
 * WO-DRIL-P4 · DRIL 资源包 → 首轮 user prompt 段（PRD §8.3·可解释性 §4⑤）。
 * 空包（无任何 solver/slice/rule/skill/workflow）→ 返回 ""（不注入·byte-compatible）。
 * 纯字符串投影·R6 确定性（同包同段）。资源包是**预选导航提示**（供 agent 直接对口下手·省盲选），
 * 数字溯源仍由实际 invoke_solver / query_objects 工具调用产出（⟦ref⟧ 不在此段伪造）。
 */
export function renderDrilPackage(pkg: ResourcePackage): string {
  const solverKeys = pkg.solvers.map((s) => s.key);
  if (solverKeys.length === 0 && pkg.slices.length === 0 && pkg.rules.length === 0 && pkg.skills.length === 0 && pkg.workflows.length === 0) {
    return "";
  }
  const lines: string[] = ["【DRIL 智能资源包】（已据本题跨资源检索预选，优先直接使用对口资源，无需再 discover 盲扫）："];
  if (solverKeys.length > 0) {
    const withShape = pkg.solvers.map((s) => (s.outputShape && s.outputShape.length > 0 ? `${s.key}（输出 ${s.outputShape.join("/")}）` : s.key));
    lines.push(`· 求解器（invoke_solver 首选）：${withShape.join("、")}`);
  }
  if (pkg.slices.length > 0) lines.push(`· 切片（resolve_slice）：${pkg.slices.join("、")}`);
  if (pkg.rules.length > 0) lines.push(`· 规则（evaluate_rules）：${pkg.rules.join("、")}`);
  if (pkg.skills.length > 0) lines.push(`· 技能：${pkg.skills.join("、")}`);
  if (pkg.workflows.length > 0) lines.push(`· 工作流：${pkg.workflows.join("、")}`);
  if (pkg.explanation) lines.push(`选型说明：${pkg.explanation}`);
  return lines.join("\n");
}

/**
 * WO-REAL-LLM-FREE-QUERY（AI 指挥台 NL 入口）：本查询是否为沙盘会话上下文里的 NL 指挥
 *（filters.simSessionId 存在，即前端沙盘屏 NL 框带着 sessionId 提交）。命中 + sim.commander 开
 * → 直接走 path-B（agent 拿 sim_* 工具真驱动 tick），不被 classifier/确定性 CEO 路由拦。
 */
function isSimCommanderNl(task: QueryTask): boolean {
  const sid = task.context.filters?.simSessionId;
  return typeof sid === "string" && sid.length > 0;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface PendingClarification {
  kind: "INTENT_CHOICE" | "SLOT_FILLING";
  auth: RequestAuth;
  candidates?: IntentDefinition[];
  intent?: IntentDefinition;
  slots: Record<string, unknown>;
  missing: SlotDef[];
  timer: NodeJS.Timeout;
}

export interface OrchestratorDeps {
  repos: Repos;
  metrics: Metrics;
  config: AppConfig;
  engine: ExecutionEngine;
  events: TaskEvents;
  /** Entitlement gate (PRD §4/§5): query-dock 404, candidate narrowing, agent-fallback off. */
  features: FeatureGate;
  /** Multi-provider model resolution (amends QOS-PRD §6). */
  llmSettings: LlmSettings;
}

/** §2.2：留痕去重（同 kind+key+version 只记一次，保持首次出现顺序）。 */
export function dedupeRefs(refs: ResolvedRef[]): ResolvedRef[] | undefined {
  if (refs.length === 0) return undefined;
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.kind}|${r.key}|${r.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

/**
 * WO-Phase4 §6 补全 · 从 config 派生 residual 硬预算（纯函数·可单测）。env 未设 → 空 partial → BudgetTracker
 * 用宽松 DEFAULT（既有多轮行为逐字节不变）；env 设 → 覆写对应上界。供 Orchestrator **每个** BudgetTracker 站点。
 */
export function computeResidualBudget(config: {
  QOS_AGENT_MAX_ROUND_TRIPS?: number;
  QOS_AGENT_MAX_DISCOVER_CALLS?: number;
}): Partial<AgentBudget> {
  const b: Partial<AgentBudget> = {};
  if (config.QOS_AGENT_MAX_ROUND_TRIPS !== undefined) b.maxRoundTrips = config.QOS_AGENT_MAX_ROUND_TRIPS;
  if (config.QOS_AGENT_MAX_DISCOVER_CALLS !== undefined) b.maxDiscoverCalls = config.QOS_AGENT_MAX_DISCOVER_CALLS;
  return b;
}

export class Orchestrator {
  private readonly pending = new Map<string, PendingClarification>();
  private readonly cancelled = new Set<string>();
  /** WO-DRIL-P4 · Path-B 组包用 ResourceRouter（懒建·仅 qos.dril-routing 开时首次触达才构造·消费 P2/P3 registry）。 */
  private drilRouter?: ResourceRouter;

  constructor(private readonly deps: OrchestratorDeps) {}

  /** WO-DRIL-P4 · 懒建 ResourceRouter（复用 orchestrator 已有 repos/features + engine 的 DataCore OBO 客户端·非新真值源 R13）。 */
  private getDrilRouter(): ResourceRouter {
    if (!this.drilRouter) {
      const registry = new ResourceRegistryService({
        repos: this.deps.repos,
        dataCore: this.deps.engine.deps.dataCore,
        features: this.deps.features,
      });
      this.drilRouter = new ResourceRouter(registry);
    }
    return this.drilRouter;
  }

  /**
   * WO-Phase4 §6 补全：从 config 派生 residual 硬预算——env 未设 → 空 → BudgetTracker 用宽松 DEFAULT（既有行为逐字节不变）；
   * env 设 `QOS_AGENT_MAX_ROUND_TRIPS`/`QOS_AGENT_MAX_DISCOVER_CALLS` → 覆写上界。统一供**每个** BudgetTracker 站点
   * （主 residual path-B + coordinator 子 agent + 角色 agent + 场景/工作流 path），令硬预算「同样作用于每个子 agent」（WO §6·此前只接主 runPathB）。
   */
  private residualBudgetFromConfig(): Partial<AgentBudget> {
    return computeResidualBudget(this.deps.config);
  }

  // -------------------------------------------------------------------------
  // 8.1 提交查询
  // -------------------------------------------------------------------------
  async submitQuery(
    auth: RequestAuth,
    body: SubmitQueryBody,
    idempotencyKey?: string,
    opts?: { internal?: boolean },
  ): Promise<{ taskId: string; status: string; streamUrl: string; reused: boolean }> {
    // entitlement PRD §5: shell.query-dock off → the endpoint "does not exist" (404, not 403)
    if (!(await this.deps.features.isEnabled(auth.tenantId, "shell.query-dock", auth.token))) {
      throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    }
    const pkg = await this.deps.repos.packages.get(body.packageId);
    if (!pkg || pkg.tenantId !== auth.tenantId) {
      throw new HttpError(404, ErrorCodes.PACKAGE_NOT_FOUND, `package not found: ${body.packageId}`);
    }
    // 每用户并发执行中任务上限（面向交互用户的限流；内部批量如 eval 套件逐条跑不受此节流，不应卡内部回归）。
    const MAX_ACTIVE_TASKS_PER_USER = 10;
    if (!opts?.internal) {
      const active = await this.deps.repos.tasks.countActiveByUser(auth.tenantId, auth.userId);
      if (active >= MAX_ACTIVE_TASKS_PER_USER) {
        throw new HttpError(429, ErrorCodes.RATE_LIMITED, `每用户并发执行中任务 ≤${MAX_ACTIVE_TASKS_PER_USER}`);
      }
    }

    const taskId = newId("task");
    if (idempotencyKey) {
      const key = `${auth.tenantId}|${auth.userId}|${idempotencyKey}`;
      const existing = await this.deps.repos.idempotency.putIfAbsent(key, taskId);
      if (existing !== taskId) {
        const t = await this.deps.repos.tasks.get(existing);
        if (t) {
          return { taskId: t.id, status: t.status, streamUrl: `/b/v1/queries/${t.id}/events`, reused: true };
        }
      }
    }

    const task: QueryTask = {
      id: taskId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      packageId: body.packageId,
      conversationId: body.context.conversationId ?? newId("conv"),
      query: body.query,
      context: { ...body.context, conversationId: body.context.conversationId ?? undefined },
      status: "ROUTING",
      clarificationRounds: 0,
      createdAt: new Date().toISOString(),
    };
    await this.deps.repos.tasks.insert(task);
    await this.deps.events.emit(taskId, "task.accepted", { taskId });

    // 并发一致性 §13.2：同会话新任务默认取消仍在执行的旧任务（取消优于仲裁）。
    if (body.context.conversationId && !body.keepPrevious) {
      await this.supersedeConversation(task.tenantId, task.conversationId, taskId);
    }

    // run the pipeline asynchronously
    setImmediate(() => {
      void this.runPipeline(taskId, auth).catch(async (err) => {
        await this.failFromError(taskId, err);
      });
    });

    return { taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events`, reused: false };
  }

  // -------------------------------------------------------------------------
  // Pipeline: scene-entry mode → candidate narrowing → classification → decision
  // -------------------------------------------------------------------------
  private async runPipeline(taskId: string, auth: RequestAuth): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || task.status !== "ROUTING") return;
    const pkg = (await this.deps.repos.packages.get(task.packageId)) as ScenarioPackage;
    const scene = await this.deps.repos.sceneEntries.byView(task.tenantId, task.context.view);
    const mode = scene?.mode ?? "WORKFLOW_FIRST";

    // Scene-entry mode takes precedence over threshold routing (platform PRD §8.5)
    if (mode === "AGENT_FIRST" || mode === "AGENT_ONLY") {
      if (!scene?.defaultAgentId) {
        await this.failTask(taskId, "VALIDATION_ERROR", `scene entry ${mode} missing defaultAgentId`);
        return;
      }
      await this.runSceneAgent(task, auth, scene);
      return;
    }

    // ① candidate narrowing (incl. entitlement filter — QOS-PRD §5.1-1 追加条件:
    // intents bound to disabled features are excluded from candidates AND the classifier catalog)
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth.token);
    let candidates = await this.publishedIntentsForView(task.packageId, task.context.view, enabledFeatures);
    if (scene?.intentCatalogFilter) {
      candidates = candidates.filter((i) => scene.intentCatalogFilter?.includes(i.key));
    }
    // WO-CEO-6（闭 G-3·纯 additive 门控）：CEO 专属深问意图仅在注入了 PageContext 时进候选池。
    // 无 PageContext = 普通问句 → 剔除 ceo_* 意图，平台分类与 CEO-6 前逐字节一致（不污染既有意图目录·不劫持·
    // combined-gate 血泪：seed 的 enabledViews="*" 曾污染全视图候选池，误夺 risk_root_cause/adopt_mitigation 等）。
    const hasPageContext = Boolean(task.context.pageContext);
    if (!hasPageContext) {
      candidates = candidates.filter((i) => !isCeoIntentKey(i.key));
    }

    if (candidates.length === 0) {
      const classification: ClassificationResult = {
        candidates: [],
        outOfCatalog: true,
        extractedSlots: {},
        latencyMs: 0,
        model: "none",
      };
      await this.deps.repos.tasks.patch(taskId, { classification });
      if (mode === "WORKFLOW_ONLY") {
        await this.completeWorkflowOnlyMiss(task, []);
        return;
      }
      await this.runPathB(taskId, auth, classification);
      return;
    }

    // §2.4 确定性绑定（PRD-scenario-ontogenesis）：来自场景卡的查询带 scenarioIntentKey →
    // 若该意图在候选内（已发布、entitlement 通过）且槽位可从上下文满足 → 直接绑定意图→计划，**跳过 LLM classify**。
    // 让点卡不受 classifier 死活/目录/缓存影响（卡的闭包已长成则正序确定运作，R16 应有之义）。
    const forcedKey = task.context.scenarioIntentKey;
    if (forcedKey) {
      const forced = candidates.find((c) => c.key === forcedKey);
      if (forced) {
        const probe = await fillSlots(forced, {}, task.context, this.deps.engine.deps.dataCore.ontology, auth);
        if (probe.missing.length === 0) {
          await this.deps.repos.tasks.patch(taskId, {
            classification: { candidates: [{ intentKey: forced.key, confidence: 1 }], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "deterministic:scenario-bind" },
          });
          await this.proceedWithIntent(taskId, auth, forced, {});
          return;
        }
      }
    }

    // ★ WO-AGENT-RUNTIME-S01 · 【最优先】场景变体继承意图（治「场景启动器变体问句卡死 5 分钟」·插在 Coordinator/path-B 之前）。
    // 病根：S01「订单可承接性评审」点卡带 presetSlots{modelId,demandDelta,weeks}→capacity_feasibility→capacity_forecast 秒答；
    // 改写成自由问句「4680-NCM 上浮10%、8周还能接吗」后丢了 scenarioIntentKey/presetSlots → 判开放题 → 进多角色 Coordinator
    // → 子 agent 不会把「上浮10%/8周/4680-NCM」映射成 {modelId,demandDelta,weeks} → 反复失败烧预算 ~5min 像卡死。
    // 修：新 query 无显式 scenarioIntentKey 但同会话最近任务是场景启动（scenarioKey/scenarioIntentKey 非空）且新问句仍是
    // 产能可行性变体（同业务视图）→ 继承 scenarioIntentKey + parseCapacityFeasibilityVariant 填槽 → path-A 直路 capacity_forecast
    // （秒级·不进 Coordinator/path-B）。命中即 return；未命中（无继承/非变体/槽填不满）→ 照落下游（不劫持·byte-compatible）。
    if (!forcedKey && (await this.tryInheritScenarioVariant(taskId, auth, task, candidates))) return;

    // WO-REAL-LLM-FREE-QUERY（AI 指挥台 NL 入口·先于确定性路由/classifier）：沙盘会话上下文 NL 指挥
    //（filters.simSessionId 存在=前端沙盘屏 NL 框带 sessionId 提交）+ sim.commander 开 → 直接 path-B，
    // agent 拿 sim_* 工具真驱动 tick（NL「推进两个 tick 看负载」→ 调 sim_tick）。关则不触发·照常分类（R3 暗发）。
    if (isSimCommanderNl(task) && simCommanderEnabled(enabledFeatures)) {
      await this.runPathB(taskId, auth, {
        candidates: [], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "agent:sim-commander-nl",
      });
      return;
    }

    // WO-REAL-LLM-FREE-QUERY（CEO/块级真 LLM 深问·确定性路由之外并列拦截）：feature 开(①) + 开放式/多跳问句(②) +
    // 上下文丰富(③) → 走增强版 path-B（CEO 深问 system + PageContext/BlockContext 注入 → runAgentLoop 真 LLM 自由多跳：
    // 查对象→算求解器→再查→综合）。真 LLM 失败（无 provider/超预算/异常）→ 落确定性 resolveCeoRoute/resolveBlockRoute
    // 兜底·诚实标降级。**暗发默认关**（freeLlmEnabled("ALL")=false·既有 CEO/block 确定性路径 C6/C7 逐字节不变·不劫持）。
    // ★ WO-FIVE-ROLE-AI-EMPLOYEE P1 · 跨域 Coordinator 编排（加在真 LLM 自由分路**之前**——更强的显式指派信号：
    //   命中"交付风险/多角色关键词共现"即确定性拆多角色子问，经 invoke_agent 真调对应角色 agent 扇出→汇总）。
    //   命中即 return·不落下方真 LLM/确定性 CEO 路由（二者经暗发 feature 门 agent.coordinator·defaultOn:false 天然隔离·
    //   coordinatorEnabled("ALL")=false → 既有单 agent path-B 逐字节不变·C4 不劫持）。planCoordination 单域返 undefined→照走。
    if (coordinatorEnabled(enabledFeatures)) {
      const plan = planCoordination(task.query, task.context.pageContext, []);
      if (plan) {
        await this.runCoordinator(taskId, auth, plan);
        return;
      }
    }

    // ★ WO-DETERMINISTIC-CROSS-DOMAIN · 确定性多域分路（把跨域题留在确定性层·零 LLM）——插在 A 单域确定性门 / free-LLM / classify **之前**。
    // 病根（domain-resolver.ts:80）：跨域题（≥2 硬域族）被 `domainFamilies>=2 → −0.4` **故意压到阈下** → 落慢 LLM（free-LLM/classify）。
    // 本分路让确定性层**自己**把跨域题逐域枚举 + 逐域路由（`domainResolveMulti` 复用 ceo-route 映射·R6 纯函数·perDomainScore
    // 去 −0.4 跨域惩罚）→ `selectDeterministicMultiRoute`（≥2 域各够格 + 各有 solver·任一不够格整体回落·诚实边界）→
    // `execDeterministicMultiPath` **并行** solver + **零 LLM 块装配**（每域独立 ⟦ref⟧·耦合诚实标）·秒级。
    // **暗发默认关**（deterministicMultiEnabled("ALL")=false → 既有管线逐字节不变·SEAM-5 零回归）；命中即 return（agentRequests=0·无 classify），
    // 未命中（<2 域 / 任一域不够格）→ null → **照落下方**单域确定性门 / free-LLM / classifier（不劫持·fail-safe）。
    if (deterministicMultiEnabled(enabledFeatures)) {
      const multiRoutes = selectDeterministicMultiRoute(domainResolveMulti(task.query, task.context.pageContext));
      if (multiRoutes) {
        await this.runDeterministicMulti(taskId, auth, multiRoutes);
        return;
      }
    }

    // ★ WO-QOS-1 · A 确定性优先门（治本·闭 G-AGENT-BLIND-REACT 路由侧一半）——插在 free-LLM/agent 入口**之前**。
    // 真 Kimi 20 题实测：99% 时延在 path-B 的 LLM 盲目选型推理；治本头号杠杆 = 有对口**确定性** solver 的高置信题
    // 别送进慢 agent。domainResolve（R6 纯函数·复用 ceo-route 意图模式，A 门与 WO-QOS-2 切片投影单一来源）→
    // preferDeterministicSolver → 高置信（≥THRESHOLD·用 20 题金标校准使**误降级=0**）+ 有对口 solver → 拉回 path-A
    // 求解器（一次 invoke_solver + 模板投影·秒级出答·答案口径不变）。
    // **fail-safe 铁律**：低置信 / 无匹配 / 未能绑意图 → **照落下方 free-LLM / classifier**（绝不把开放题误降级给
    // 窄 solver 出"自信错答"）。**字节兼容**：命中即走既有 tryDeterministicBind（block-route/ceo-route→proceedWithIntent·
    // 与下方原位逐字节同 model/路径），既有行为零回归——唯一新增行为 = 本会被 free-LLM 劫持的高置信定式深问改走 path-A。
    const det = preferDeterministicSolver(domainResolve(task.query, task.context.pageContext));
    if (det.confidence >= DETERMINISTIC_PREFERENCE_THRESHOLD && det.solverKey) {
      if (await this.tryDeterministicBind(taskId, auth, task, candidates)) return;
    }

    // WO-REAL-LLM-FREE-QUERY（CEO/块级真 LLM 深问·确定性路由之外并列拦截·未被 Coordinator 显式指派时的开放式深问缺省增强）。
    if (freeLlmEnabled(enabledFeatures) && shouldUseFreeLLM(task.query, task.context.pageContext)) {
      await this.runCeoFreeLLM(taskId, auth, enabledFeatures);
      return;
    }

    // WO-CEO-6（闭 G-3 深问侧）：CEO 深问确定性路由——命中意图模式（为什么/怎么补/差多少/信号）+ PageContext →
    // resolveCeoRoute（args 从 PageContext.focus 派生）→ 绑定 CEO 意图 → path A 执行 invoke_solver(CEO 求解器) → 答案+溯源。
    // 门控：仅「注入了 PageContext + CEO 深问模式命中 + 目标意图在候选内」才绑定（无 PageContext 或非 CEO 问句照常走
    // 下方 classifier·不劫持）。PageContext 是 CEO-6 语义前提：args 从 focus 派生·证同问句带/不带上下文答案不同（C2/C3）。
    // 行级 scope（A6）由 datacore OBO 依身份真过滤（CEO/admin 全域·base_manager:X 限 X），非本层强制。
    // WO-BLOCK-DIALOGUE（闭 G-3 块级）：块级定向路由——用户点某 block「深问此块」→ PageContext.block 携该块**真实数据**
    // 快照（blockData）+ 块身份 → 按 blockType 定向落对应推演求解器（不依赖问句关键词·块本身即意图锚），blockData 作
    // 强上下文（extractedSlots 留存 + pageContextSummary 进 agent prompt），答案针对性锚定该块。优先于页面级 CEO 问句路由
    // （块是更强的上下文信号）。门控：`hasBlockContext` + blockType 已登记 + 目标 CEO 意图在候选内；否则退化走下方页面级/classifier。
    if (await this.tryDeterministicBind(taskId, auth, task, candidates)) return;

    // #5 单候选短路：候选收窄后只剩 1 个意图，且其必填槽位可仅从上下文（presetContext/选中对象
    // defaultFrom）满足时，跳过 LLM 分类直接进路径 A —— 省一次分类往返。仍保留槽位填充语义：
    // 若必填槽位无法从上下文满足（需 NL 抽取），不短路、照常走分类。
    if (candidates.length === 1) {
      const only = candidates[0]!;
      const probe = await fillSlots(only, {}, task.context, this.deps.engine.deps.dataCore.ontology, auth);
      if (probe.missing.length === 0) {
        await this.deps.repos.tasks.patch(taskId, {
          classification: { candidates: [{ intentKey: only.key, confidence: 1 }], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "short-circuit:single-candidate" },
        });
        await this.proceedWithIntent(taskId, auth, only, {});
        return;
      }
    }

    // ② LLM classification (with up to 2 retries)
    const classification = await this.classify(task, pkg, candidates, auth);
    if (!classification) {
      this.deps.metrics.classifierErrors.inc();
      if (mode === "WORKFLOW_ONLY") {
        await this.completeWorkflowOnlyMiss(task, candidates);
        return;
      }
      // WO-0-NL-WIRING（急救·产出③）：classify 失败且**真无可用 LLM provider**（凭据缺）→ 诚实降级 COMPLETED，
      // 不落 runPathB→agent loop 再要 LLM→INTERNAL_ERROR 崩（用户实测的"agent 推演中断"）。
      // 有 provider（含测试 mock：classify 成功不到此分支；即便到此，绑定/env 有凭据则 true）→ 照旧 runPathB（字节兼容）。
      if (!(await this.deps.llmSettings.providerAvailable(task.tenantId, "agent", pkg.agentModel))) {
        await this.completeNoLlmDegradation(task);
        return;
      }
      await this.runPathB(taskId, auth, {
        candidates: [],
        outOfCatalog: true,
        extractedSlots: {},
        latencyMs: 0,
        model: pkg.classifierModel ?? this.deps.config.QOS_CLASSIFIER_MODEL,
      });
      return;
    }
    await this.deps.repos.tasks.patch(taskId, { classification });

    // ③ τ decision
    const tauHigh = pkg.thresholds?.high ?? this.deps.config.QOS_TAU_HIGH;
    const tauLow = pkg.thresholds?.low ?? this.deps.config.QOS_TAU_LOW;
    const top = classification.candidates[0];

    if (classification.outOfCatalog || !top || top.confidence < tauLow) {
      if (mode === "WORKFLOW_ONLY") {
        await this.completeWorkflowOnlyMiss(task, candidates);
        return;
      }
      await this.runPathB(taskId, auth, classification);
      return;
    }

    const intent = candidates.find((c) => c.key === top.intentKey);
    if (!intent) {
      if (mode === "WORKFLOW_ONLY") {
        await this.completeWorkflowOnlyMiss(task, candidates);
        return;
      }
      await this.runPathB(taskId, auth, classification);
      return;
    }

    if (top.confidence < tauHigh) {
      // mid confidence → INTENT_CHOICE clarification
      const options = classification.candidates
        .map((c) => candidates.find((x) => x.key === c.intentKey))
        .filter((x): x is IntentDefinition => Boolean(x))
        .slice(0, 3);
      await this.requestClarification(taskId, auth, {
        kind: "INTENT_CHOICE",
        candidates: options,
        slots: {},
        missing: [],
        payload: {
          kind: "INTENT_CHOICE",
          options: [
            ...options.map((o) => ({ intentKey: o.key, name: o.name, description: o.description })),
            { intentKey: null, name: "都不是", description: "以上都不是我想问的" },
          ],
        },
      });
      return;
    }

    // high confidence → slot filling → path A
    await this.proceedWithIntent(taskId, auth, intent, classification.extractedSlots);
  }

  /**
   * WO-CEO-6 / WO-BLOCK-DIALOGUE 确定性绑定（块级定向优先 → 页面级 CEO 问句意图）→ path-A invoke_solver。
   * WO-QOS-1 抽取为可复用方法：A 确定性优先门（free-LLM 入口前·高置信时）与原位（free-LLM 之后·默认路径）
   * **共用同一实现** —— 保证两处逐字节同 model（`deterministic:block-route`/`deterministic:ceo-route`）+ 同 proceedWithIntent
   * 路径（字节兼容·零回归）。命中并绑定成功 → true（调用方须 return）；未命中/意图不在候选 → false（照落下游·不劫持）。
   */
  private async tryDeterministicBind(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    candidates: IntentDefinition[],
  ): Promise<boolean> {
    // WO-BLOCK-DIALOGUE（闭 G-3 块级）：块级定向路由——用户点某 block「深问此块」→ PageContext.block 携该块**真实数据**
    // 快照（blockData）+ 块身份 → 按 blockType 定向落对应推演求解器（不依赖问句关键词·块本身即意图锚），blockData 作
    // 强上下文（extractedSlots 留存 + pageContextSummary 进 agent prompt）。优先于页面级 CEO 问句路由（块是更强上下文信号）。
    if (hasBlockContext(task.context.pageContext)) {
      const route = resolveBlockRoute(task.context.pageContext, "ceo");
      if (route) {
        const ceoIntent = candidates.find((c) => c.key === ceoIntentKeyForRoute(route.route));
        if (ceoIntent) {
          await this.deps.repos.tasks.patch(taskId, {
            classification: { candidates: [{ intentKey: ceoIntent.key, confidence: 1 }], outOfCatalog: false, extractedSlots: route.args, latencyMs: 0, model: "deterministic:block-route" },
          });
          await this.proceedWithIntent(taskId, auth, ceoIntent, route.args);
          return true;
        }
      }
    }

    // WO-CEO-6（闭 G-3 深问侧）：CEO 深问确定性路由——命中意图模式（为什么/怎么补/差多少/信号）+ PageContext →
    // resolveCeoRoute（args 从 PageContext.focus 派生）→ 绑定 CEO 意图 → path A 执行 invoke_solver(CEO 求解器) → 答案+溯源。
    // 门控：仅「注入了 PageContext + CEO 深问模式命中 + 目标意图在候选内」才绑定（无 PageContext 或非 CEO 问句照常走
    // 下游 classifier·不劫持）。行级 scope（A6）由 datacore OBO 依身份真过滤，非本层强制。
    if (Boolean(task.context.pageContext) && isCeoQuestion(task.query)) {
      const route = resolveCeoRoute(task.query, task.context.pageContext, "ceo");
      const ceoIntent = candidates.find((c) => c.key === ceoIntentKeyForRoute(route.route));
      if (ceoIntent) {
        await this.deps.repos.tasks.patch(taskId, {
          classification: { candidates: [{ intentKey: ceoIntent.key, confidence: 1 }], outOfCatalog: false, extractedSlots: route.args, latencyMs: 0, model: "deterministic:ceo-route" },
        });
        await this.proceedWithIntent(taskId, auth, ceoIntent, route.args);
        return true;
      }
    }
    return false;
  }

  /**
   * WO-DETERMINISTIC-CROSS-DOMAIN · 确定性多域分路出口：并行跑各域 solver（复用 makeExecutor = path-A invoke 通道·
   * **全程不落 runAgentLoop/classify**）+ **零 LLM 块装配**，自行完成 task 收尾（COMPLETED + answer.final）。
   * `classification.model="deterministic:multi-domain"`·`agentRequests=0`·`multiIntentPlan` 留痕（routeSource=deterministic-multi-domain·
   * synthesisMode=deterministic·coupledPairs 诚实标）。确定性 solver 产物 + 零 LLM 装配 → trustLevel=VERIFIED_WORKFLOW。
   */
  private async runDeterministicMulti(
    taskId: string,
    auth: RequestAuth,
    routes: DomainRoute[],
  ): Promise<void> {
    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // 复用硬预算站点（env 未设→宽松 DEFAULT 不变）
    const executor = this.deps.engine.makeExecutor(taskId, auth, budget);
    const coupledPairs = detectCoupledPairs(routes);

    await this.deps.repos.tasks.patch(taskId, { status: "EXECUTING_WORKFLOW", path: "WORKFLOW" });
    this.deps.metrics.recordRouting(true);
    await this.deps.events.emit(taskId, "routing.completed", {
      path: "WORKFLOW",
      note: `确定性多域分路（零 LLM·${routes.length} 域${coupledPairs.length > 0 ? `·耦合 ${coupledPairs.length} 对诚实标` : "·纯独立"}）`,
    });

    const { answer, plan } = await execDeterministicMultiPath(routes, coupledPairs, {
      executor,
      emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
    });

    if (this.cancelled.has(taskId)) {
      await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
      this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "CANCELLED" });
      return;
    }

    const classification: ClassificationResult = {
      candidates: routes.slice(0, 3).map((r) => ({ intentKey: r.domain, confidence: r.perDomainScore })),
      outOfCatalog: false,
      extractedSlots: {},
      latencyMs: 0, // 零 LLM classify（本 WO 头号证据·SEAM-2：确定性接住·分类耗时=0）
      model: "deterministic:multi-domain",
    };
    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      classification,
      answer,
      multiIntentPlan: plan,
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "COMPLETED" });
    await this.recordExperience(taskId);
  }

  /**
   * WO-AGENT-RUNTIME-S01 · 场景变体继承意图（会话继承·item 1·治病根头号杠杆）。
   * 新 query 无显式 scenarioIntentKey 时，读同会话最近的场景启动任务；若其 scenarioIntentKey 为 `capacity_feasibility`
   * （本单治的对口单一 solver 定式意图）、本问句仍是产能可行性变体（isCapacityFeasibilityQuery）→ 继承该意图 +
   * parseCapacityFeasibilityVariant 确定性填槽（型号从问句取·缺则从继承的选中对象/presetSlots 补；demandDelta/weeks 从问句）
   * → probe fillSlots 满足则 proceedWithIntent 直路 path-A（capacity_forecast·秒级·不进 Coordinator/path-B）。
   * 命中并绑定 → true（调用方 return·model=`deterministic:scenario-inherit`）；否则 false（照落下游·不劫持·byte-compatible）。
   */
  private async tryInheritScenarioVariant(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    candidates: IntentDefinition[],
  ): Promise<boolean> {
    // 只对产能可行性变体启用继承（否则不把无关追问强绑旧场景意图·narrow-safe）。
    if (!isCapacityFeasibilityQuery(task.query, task.context.pageContext)) return false;
    // 同会话最近的场景启动任务（scenarioIntentKey/scenarioKey 非空·最近优先）。
    const history = await this.previousConversationTasks(task);
    const prev = history
      .filter((t) => t.context.scenarioIntentKey || (t.context as { scenarioKey?: string }).scenarioKey)
      .sort((a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1))[0];
    if (!prev || prev.context.scenarioIntentKey !== "capacity_feasibility") return false;
    const forced = candidates.find((c) => c.key === "capacity_feasibility");
    if (!forced) return false;
    // 变体槽（型号从问句·缺则从继承的选中对象/presetSlots 补·R6 纯派生）。
    const variant = parseCapacityFeasibilityVariant(task.query);
    const prevSel = (prev.context.selectedObjects ?? [])[0];
    const prevPresetModel = typeof prev.context.presetSlots?.modelId === "string" ? (prev.context.presetSlots.modelId as string) : undefined;
    const modelId = variant.modelId ?? prevSel?.objectId ?? prevPresetModel;
    const extracted: Record<string, unknown> = {};
    if (modelId) extracted.model = modelId; // `model` 为 objectRef 槽（bare string 经 ontology 解析成 ObjectRef）
    if (variant.demandDelta !== undefined) extracted.demandDelta = variant.demandDelta;
    if (variant.weeks !== undefined) extracted.weeks = variant.weeks;
    // 探针 fillSlots（extracted 优先·继承选中对象/presetSlots 兜底）；填不满 → 不继承（照落下游·诚实不臆造）。
    const probe = await fillSlots(forced, extracted, task.context, this.deps.engine.deps.dataCore.ontology, auth);
    if (probe.missing.length > 0) return false;
    await this.deps.repos.tasks.patch(taskId, {
      classification: { candidates: [{ intentKey: forced.key, confidence: 1 }], outOfCatalog: false, extractedSlots: extracted, latencyMs: 0, model: "deterministic:scenario-inherit" },
    });
    await this.proceedWithIntent(taskId, auth, forced, extracted);
    return true;
  }

  private async publishedIntentsForView(
    packageId: string,
    view: string,
    enabledFeatures?: FeatureSet,
  ): Promise<IntentDefinition[]> {
    const all = await this.deps.repos.intents.listByPackage(packageId);
    const eligible = all.filter(
      (i) =>
        i.status === "PUBLISHED" &&
        (i.enabledViews === "*" || i.enabledViews.includes(view)) &&
        (enabledFeatures === undefined || intentAllowed(enabledFeatures, i.key)),
    );
    // max version per key
    const byKey = new Map<string, IntentDefinition>();
    for (const i of eligible) {
      const cur = byKey.get(i.key);
      if (!cur || i.version > cur.version) byKey.set(i.key, i);
    }
    return [...byKey.values()];
  }

  private async classify(
    task: QueryTask,
    pkg: ScenarioPackage,
    candidates: IntentDefinition[],
    auth: RequestAuth,
  ): Promise<ClassificationResult | undefined> {
    // resolution order (amends QOS-PRD §6): package field → tenant ModelBinding → env default
    const model = await this.deps.llmSettings.roleModel(task.tenantId, "classifier", pkg.classifierModel);
    const catalog = candidates
      .map((i) => {
        const slotDesc = i.slots.map((s) => `${s.name}(${s.type}${s.required ? ",必填" : ""}): ${s.description}`).join("; ");
        return `- ${i.key}: ${i.description}\n  示例: ${i.examples.slice(0, 3).join(" / ")}\n  槽位: ${slotDesc || "无"}`;
      })
      .join("\n");
    const historySummary = await this.conversationSummary(task);
    // WO-CEO-6（闭 G-3）：PageContext 注入分类器——focus/selection 进 contextSummary → 分类器据"用户聚焦的指标/根因/选中"
    // scope 意图（对比不带则路由可不同）。此前分类器只见 view+selectedObjects（G-3 缺口）。
    const pc = task.context.pageContext;
    const pcScope = pc
      ? [pc.focus?.metric ? `focus.metric=${pc.focus.metric}` : "", pc.focus?.factorId ? `focus.根因=${pc.focus.factorId}` : "", pc.selection.length ? `selection=${pc.selection.join("|")}` : "",
         // WO-BLOCK-DIALOGUE：活跃块进分类器上下文（块级对话锚·分类器知"用户在深问哪块"）。
         pc.block ? `block=${pc.block.blockType}:${pc.block.blockTitle}` : ""].filter(Boolean).join("; ")
      : "";
    const contextSummary = `view=${task.context.view}; selected=${task.context.selectedObjects
      .map((o) => `${o.objectType}:${o.label ?? o.objectId}`)
      .join(",")}${pcScope ? `; ${pcScope}` : ""}`;

    // WO-PROMPT-DEFAULTS-WIRING：先读 DataCore 可配 classifier 模板（OBO·TTL60s 缓存）——admin 配了 TENANT_OVERRIDE
    // 则替换硬编码指令头（灭漂移）；无配置 / A 不可达 / 非 admin 403 → undefined → 兜底硬编码（fail-open·R6·绝不阻断）。
    const promptOverride = await resolvePromptOverride(this.deps.engine.deps.dataCore.prompts, auth, "classifier");
    const system = buildClassifierSystem(catalog, promptOverride);
    const user = buildClassifierUser({ query: task.query, historySummary, contextSummary });

    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now();
      try {
        const raw = await this.deps.engine.deps.llm.classify({ model, system, user, tenantId: task.tenantId });
        const latencyMs = Date.now() - t0;
        this.deps.metrics.classifierLatency.observe(latencyMs);
        // LLM Provider 增量 §1.3：每次调用的审计记录补 {providerId, modelId}
        const dc = parseDataCoreSpec(model);
        return { ...raw, latencyMs, model, ...(dc ? { providerId: dc.providerId, modelId: dc.modelId } : {}) };
      } catch {
        // typed SDK errors retried (SDK 自带重试之外整体重试 2 次)
      }
    }
    return undefined;
  }

  /** 最近 6 轮会话摘要（增量 §1.4：与 agent 前情摘要共用 prompts.ts 的同一构建器） */
  private async conversationSummary(task: QueryTask): Promise<string> {
    const previous = await this.previousConversationTasks(task);
    return classifierConversationSummary(previous);
  }

  private async previousConversationTasks(task: QueryTask): Promise<QueryTask[]> {
    const history = await this.deps.repos.tasks.listByConversation(task.tenantId, task.conversationId);
    return history.filter((t) => t.id !== task.id);
  }

  // -------------------------------------------------------------------------
  // Clarification handling (§5.1.3 / §5.2 / §8.3)
  // -------------------------------------------------------------------------
  private async requestClarification(
    taskId: string,
    auth: RequestAuth,
    opts: {
      kind: "INTENT_CHOICE" | "SLOT_FILLING";
      candidates?: IntentDefinition[];
      intent?: IntentDefinition;
      slots: Record<string, unknown>;
      missing: SlotDef[];
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    const round = task.clarificationRounds + 1;
    await this.deps.repos.tasks.patch(taskId, { status: "AWAITING_CLARIFICATION", clarificationRounds: round });
    this.deps.metrics.clarificationRounds.inc({ kind: opts.kind });

    const timer = setTimeout(() => {
      void this.cancelForTimeout(taskId);
    }, CLARIFICATION_TIMEOUT_MS);
    timer.unref?.();

    this.pending.set(taskId, {
      kind: opts.kind,
      auth,
      candidates: opts.candidates,
      intent: opts.intent,
      slots: opts.slots,
      missing: opts.missing,
      timer,
    });

    await this.deps.events.emit(taskId, "clarification.required", { ...opts.payload, round });
  }

  private async cancelForTimeout(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
    await this.deps.events.emit(taskId, "task.cancelled", { reason: "clarification timeout (10min)" });
  }

  async handleClarification(taskId: string, auth: RequestAuth, body: ClarificationReplyBody): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== auth.tenantId) {
      throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    }
    const pending = this.pending.get(taskId);
    if (task.status !== "AWAITING_CLARIFICATION" || !pending) {
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `task 非 AWAITING_CLARIFICATION（当前 ${task.status}）`);
    }
    clearTimeout(pending.timer);
    this.pending.delete(taskId);
    await this.deps.repos.tasks.patch(taskId, { status: "ROUTING" });

    if (pending.kind === "INTENT_CHOICE") {
      if (body.none === true || !body.chosenIntentKey) {
        await this.runPathB(taskId, auth, task.classification);
        return;
      }
      const intent = pending.candidates?.find((c) => c.key === body.chosenIntentKey);
      if (!intent) {
        await this.runPathB(taskId, auth, task.classification);
        return;
      }
      setImmediate(() => {
        void this.proceedWithIntent(taskId, auth, intent, task.classification?.extractedSlots ?? {}).catch((err) =>
          this.failFromError(taskId, err),
        );
      });
      return;
    }

    // SLOT_FILLING: merge provided slot values, re-extract/validate, continue or re-ask
    const intent = pending.intent;
    if (!intent) {
      await this.runPathB(taskId, auth, task.classification);
      return;
    }
    setImmediate(() => {
      void this.continueSlotFilling(taskId, auth, intent, pending, body.slotValues ?? {}).catch((err) =>
        this.failFromError(taskId, err),
      );
    });
  }

  private async continueSlotFilling(
    taskId: string,
    auth: RequestAuth,
    intent: IntentDefinition,
    pending: PendingClarification,
    slotValues: Record<string, unknown>,
  ): Promise<void> {
    const merged = { ...pending.slots };
    const extractedPlus: Record<string, unknown> = { ...slotValues };
    // already-filled slots stay; provided values validated through the normal pipeline
    await this.proceedWithIntent(taskId, auth, intent, extractedPlus, merged);
  }

  private async proceedWithIntent(
    taskId: string,
    auth: RequestAuth,
    intent: IntentDefinition,
    extracted: Record<string, unknown>,
    presetSlots: Record<string, unknown> = {},
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;

    const { slots, missing, outOfDomain } = await fillSlots(
      intent,
      extracted,
      task.context,
      this.deps.engine.deps.dataCore.ontology,
      auth,
    );
    // A5 感知层埋点：objectRef 解析尝试（分母）+ 域外实体（分子）→ 发独立事件 + 记误触发率。
    const objectRefAttempts = intent.slots.filter(
      (s) => s.type === "objectRef" && extracted[s.name] !== undefined && extracted[s.name] !== null && extracted[s.name] !== "",
    ).length;
    recordResolutionAttempts(auth.tenantId, objectRefAttempts, outOfDomain.length);
    for (const ood of outOfDomain) {
      recordOutOfDomain({ tenantId: auth.tenantId, intentKey: intent.key, slotName: ood.slotName, value: ood.value, candidates: ood.candidates, at: new Date().toISOString() });
      await this.deps.events.emit(taskId, "entity.out_of_domain", {
        slot: ood.slotName,
        value: ood.value,
        candidates: ood.candidates,
        nearest: ood.candidates[0]?.label ?? null,
      });
    }
    const finalSlots = { ...slots };
    for (const [k, v] of Object.entries(presetSlots)) {
      if (finalSlots[k] === undefined || finalSlots[k] === null) finalSlots[k] = v;
    }
    const stillMissing = missing.filter((m) => finalSlots[m.name] === undefined || finalSlots[m.name] === null);

    if (stillMissing.length > 0) {
      if (task.clarificationRounds >= 2) {
        await this.runPathB(taskId, auth, task.classification);
        return;
      }
      await this.requestClarification(taskId, auth, {
        kind: "SLOT_FILLING",
        intent,
        slots: finalSlots,
        missing: stillMissing,
        payload: {
          kind: "SLOT_FILLING",
          slots: stillMissing.map((s) => ({ name: s.name, type: s.type, prompt: clarifyPromptFor(s) })),
        },
      });
      return;
    }

    await this.deps.repos.tasks.patch(taskId, {
      matchedIntent: { intentId: intent.id, intentKey: intent.key, version: intent.version },
      slots: finalSlots,
    });
    await this.runPathA(taskId, auth, intent, finalSlots);
  }

  // -------------------------------------------------------------------------
  // Path A: deterministic workflow (§5.3)
  // -------------------------------------------------------------------------
  private async runPathA(
    taskId: string,
    auth: RequestAuth,
    intent: IntentDefinition,
    slots: Record<string, unknown>,
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    // 引用模式增量 §2.1：意图 → 计划执行时解析（planRef latest = 当前 PUBLISHED 最新版；pin = 精确版本）
    const resolution = await resolvePlanForIntent(this.deps.repos, intent);
    if (!resolution) {
      const refDesc = intent.planRef ? `${intent.planRef.planKey}@${intent.planRef.version}` : intent.planId;
      await this.failTask(taskId, "PLAN_NOT_FOUND", `plan not found: ${refDesc}`);
      return;
    }
    const plan = resolution.plan;
    // §2.2 留痕：执行时解析到的实际版本
    const resolvedRefs: ResolvedRef[] = [{ kind: "plan", key: resolution.ref.key, version: resolution.ref.version }];

    await this.deps.repos.tasks.patch(taskId, { status: "EXECUTING_WORKFLOW", path: "WORKFLOW" });
    this.deps.metrics.recordRouting(true);
    await this.deps.events.emit(taskId, "routing.completed", {
      path: "WORKFLOW",
      intentKey: intent.key,
      confidence: task.classification?.candidates[0]?.confidence,
    });

    // O10（G-9 收尾）：来自场景卡的查询（context.scenarioKey）→ 卡声明的 rules[] 若未被既有 evaluate_rules 步 /
    // 求解器 evaluatedRules（轨E）覆盖 → 自动插一个 evaluate_rules 步，使卡规则在路径 A 真被评估透出 PASS/WARN/BLOCK。
    let steps = plan.steps;
    const scenarioKey = (task.context as { scenarioKey?: string }).scenarioKey;
    if (scenarioKey) {
      const card = await this.deps.repos.scenarios.byKey(auth.tenantId, scenarioKey);
      if (card?.rules && card.rules.length > 0) steps = injectScenarioRuleStep(steps, card.rules);
    }

    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // WO-Phase4 §6：子 agent/角色/场景/工作流 path 同受硬预算（env 未设→宽松 DEFAULT 不变）
    const result = await this.deps.engine.runWorkflowSteps({
      taskId,
      steps,
      slots,
      context: task.context,
      ctx: auth,
      nesting: { callChain: [], budget },
      emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
      trustLevel: "VERIFIED_WORKFLOW",
      onResolvedRef: (r) => resolvedRefs.push(r),
    });

    if (result.status === "FAILED") {
      await this.deps.repos.tasks.patch(taskId, {
        status: "FAILED",
        error: result.error,
        resolvedRefs: dedupeRefs(resolvedRefs),
        completedAt: new Date().toISOString(),
      });
      await this.deps.events.emit(taskId, "task.failed", result.error);
      this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "FAILED" });
      return;
    }

    // WO-DECISION-KERNEL-WIRE（闭"CEO 深问止步方案·不成决策"脑裂·本体 §3 决策链）：
    // CEO 决策类深问（intent=ceo_decision·由 decision_play/signal 路由映射）出**真方案**后，若问句表达采纳/落地意图
    // → 经 L2 内核 OBO 落一等 Decision(PROPOSED·chosenOptionIds 默认取真推演 recommendedPlan.optionIds)；「立即落地」
    // 意图再 commit → COMMITTED + 派 ActionDraft(S2 DRAFT·审批门不绕)。引擎不改（decision_play 已在上方 workflow 跑完·
    // 此处只据真推演成决策）。透出 decisionId/status/actionDraftIds：SSE(decision.created/committed·已注册) + 答案块。
    const answer = await this.maybeMakeDecision(taskId, auth, intent, slots, result.answer, result.stepOutputs);

    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      answer,
      resolvedRefs: dedupeRefs(resolvedRefs),
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "COMPLETED" });
  }

  /**
   * WO-DECISION-KERNEL-WIRE：路径 A 出方案后的「成决策」钩子（纯附加·非决策路由不触发）。
   * 门控：intent=ceo_decision（decision_play/signal 路由）+ 问句命中采纳/落地意图（decisionCommitIntent≠none）+
   * 真推演产出 recommendedPlan.optionIds。满足则 create Decision(PROPOSED)，「立即落地」再 commit(COMMITTED)。
   * 成决策失败不塌方案答案（诚实降级：附提示块·不假装成决策）。返回（可能追加决策块的）答案。
   */
  private async maybeMakeDecision(
    taskId: string,
    auth: RequestAuth,
    intent: IntentDefinition,
    slots: Record<string, unknown>,
    answer: Answer,
    stepOutputs: Record<string, unknown>,
  ): Promise<Answer> {
    const commitIntent = decisionCommitIntent((await this.deps.repos.tasks.get(taskId))?.query ?? "");
    // 仅决策类深问（ceo_decision）+ 明确采纳/落地意图才成决策（非劫持既有路径 A）。
    if (commitIntent === "none" || intent.key !== ceoIntentKeyForRoute("decision_play")) return answer;

    const play = findDecisionPlayOutput(stepOutputs);
    const optionIds = play?.recommendedPlan?.optionIds ?? [];
    const metricKey = play?.rootCause?.metricKey ?? (typeof slots.metricKey === "string" ? slots.metricKey : undefined);
    if (!metricKey || optionIds.length === 0) return answer; // 无真推演推荐组合 → 不成决策（诚实·不写死）

    const factorId = play?.rootCause?.factorId ?? (typeof slots.factorId === "string" ? slots.factorId : undefined);
    try {
      const decisionClient = this.deps.engine.deps.dataCore.decision;
      let decision = await decisionClient.create(auth, { metricKey, ...(factorId ? { factorId } : {}), chosenOptionIds: optionIds });
      await this.deps.events.emit(taskId, "decision.created", {
        decisionId: decision.id,
        status: decision.status,
        chosenOptionIds: decision.chosenOptionIds,
      });
      if (commitIntent === "commit") {
        decision = await decisionClient.commit(auth, decision.id);
        await this.deps.events.emit(taskId, "decision.committed", {
          decisionId: decision.id,
          status: decision.status,
          actionDraftIds: decision.actionDraftIds,
        });
      }
      return appendDecisionBlock(answer, decision);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...answer, blocks: [...answer.blocks, { type: "text", markdown: `_（方案已出，但决策落库未成：${message}）_` }] };
    }
  }

  // -------------------------------------------------------------------------
  // Path B: restricted agent fallback (§5.4)
  // -------------------------------------------------------------------------
  private async runPathB(
    taskId: string,
    auth: RequestAuth,
    classification?: ClassificationResult,
    opts?: {
      /** WO-REAL-LLM-FREE-QUERY：CEO/块级深问用增强 system（CEO_DEEP_QUESTION_SYSTEM）旁路 AGENT_SYSTEM_CORE。 */
      systemOverride?: string;
    },
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    const pkg = await this.deps.repos.packages.get(task.packageId);
    if (!pkg) return;

    // entitlement PRD §5: qos.agent-fallback off → every would-be path-B branch
    // returns the WORKFLOW_ONLY behavior (请换个问法 + available intents), no agent run.
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth.token);
    if (!(await this.deps.features.isEnabled(task.tenantId, "qos.agent-fallback", auth.token))) {
      const candidates = await this.publishedIntentsForView(task.packageId, task.context.view, enabledFeatures);
      await this.completeWorkflowOnlyMiss(task, candidates);
      return;
    }

    // WO-FIVE-ROLE-AI-EMPLOYEE P1 · C2：单域问题 → 按 role 选对应角色 agent（非永远 universal loop）。
    // 暗发门（agent.coordinator·defaultOn:false）后：coordinatorEnabled("ALL")=false → 既有通用 path-B 逐字节不变（C4）。
    if (coordinatorEnabled(enabledFeatures)) {
      const role = detectSingleRole(task.query);
      const prof = role ? roleProfile(role) : undefined;
      if (prof?.agentId && (await this.deps.repos.agents.get(prof.agentId))) {
        await this.runRolePathB(taskId, auth, task, prof, classification);
        return;
      }
    }

    await this.deps.repos.tasks.patch(taskId, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(taskId, "routing.completed", { path: "AGENT", note: "进入探索模式" });

    // 增量4 §5：AI 推演指挥台 —— sim 工具仅在租户开通 sim.commander(+sim.sandbox) 时对 agent 可见/可用
    // （关→工具不存在，R3 暗发）。entitlement 先于 authz；DataCore 侧每端点仍各自门控（双保险）。
    // 注意 enabledFeatures="ALL"（mock 默认/降级）→ 全开；显式 Set 时要求两键齐备。
    const simCommanderOn = simCommanderEnabled(enabledFeatures);

    // 工具集：whitelist ∩ {READ, COMPUTE} + create_action_draft（写降级出口）；final_answer 由循环追加。
    // 增量4 §5：sim 工具的可见性由 entitlement 权威决定（关→不存在，R3 暗发）——即便 package 白名单含它，
    // entitlement 关也必须剔除；故先把 sim 工具从通用白名单分支排除，仅经 simCommanderOn 分支放行。
    const simNames = SIM_COMMANDER_TOOLS as readonly string[];
    const tools: AgentToolSpec[] = BUILTIN_TOOLS.filter(
      (t) =>
        (!simNames.includes(t.name) && pkg.toolWhitelist.includes(t.name) && (t.sideEffect === "READ" || t.sideEffect === "COMPUTE")) ||
        t.name === "create_action_draft" ||
        // 能力发现 §1：discover 是元工具，始终可用（不受 package 白名单约束）
        t.name === "discover" ||
        // 增量4 §5：sim 指挥台工具——entitlement 开则可用（关则不存在），权威门，先于 package 白名单
        (simCommanderOn && simNames.includes(t.name)),
    ).map((t) => ({
      name: t.name,
      description: t.descriptionForLLM,
      inputSchema: t.inputSchema,
      binding: { kind: "BUILTIN" as const },
    }));

    // WO-Phase4：residual path-B（真开放深问·Phase1–3 都没接住的题）套用硬预算——收紧 round-trip / discover 盲扫上界，
    // 超即优雅降级（BUDGET_EXHAUSTED）。只约束这条 residual ReAct，不动确定性 path-A / 组合路径 / 角色 agent。
    // opt-in：env 未设 → 不覆写 DEFAULT（宽松）→ 既有 path-B 逐字节不变（部署态设 4/1 收紧·见 config 注释）。
    const budget = new BudgetTracker(this.residualBudgetFromConfig());
    const executor = this.deps.engine.makeExecutor(taskId, auth, budget);
    // resolution order (amends QOS-PRD §6): package field → tenant ModelBinding → env default
    const model = await this.deps.llmSettings.roleModel(task.tenantId, "agent", pkg.agentModel);

    // 增量 §1.4：同 conversationId 后续任务不复用上一任务原始 messages —— 注入前情摘要块
    const priorSummary = agentPriorSummary(await this.previousConversationTasks(task));
    // WO-QOS-2 · 导航切片注入（闭 G-AGENT-BLIND-REACT agent 侧半）：通用 path-B（含 CEO/块级真 LLM 深问）——
    // 据问句 domain + 本轮工具白名单（toolNames）确定性投影本题导航图注入首轮 user，agent 有对口 solver 就一步到位、
    // 不再逐跳盲选重编排。通用 path-B 不做对象域收窄（objectTypes 不声明·由 A6 行级过滤真隔离）。R6 纯投影·空图不注入。
    const navSlice = projectNavigationSlice(task.query, task.context.pageContext, { toolNames: tools.map((t) => t.name) });
    const sliceSection = renderNavigationSlice(navSlice);
    // ★ WO-Phase2-C-COMPLETE · 组合路径挂点（本会落 path-B 的题·在 navSlice 之后、runAgentLoop 之前插·最小 additive）。
    // 导航图有多个对口且**已登记 args schema** 的 solver 且可串时 → compileSolverPlan 出机器计划 →
    // executePlan 服务端逐步 invoke_solver（复用上方 executor = path-A invoke 通道·动态接线在服务端做·**全程不经 runAgentLoop**）→ 一次综合。
    // 编不出（无对口 / required arg 静态+上游都填不上）→ 把 why 进 trace 可诊断·**照落下方既有 runAgentLoop**（fallback-safe·绝不误降级开放题）。
    // 命门：composeCompiled.ok===true 时，本会落 path-B 的这条 runAgentLoop（下方 :runAgentLoop）**绝不被走到**。
    // 暗发门（qos.compose-path·defaultOn:false）：关（含 "ALL" 降级）→ 整条组合分支不存在 → 既有 path-B 逐字节不变·不劫持（C4）。
    if (composePathEnabled(enabledFeatures)) {
      // ★ WO-GSIM-4-AGENT · 推演 NL 大脑：推演类问句（全局联合排产/跨基地最优/递进批次）→ 用 portfolio 为中心的
      // **推演专属 navSlice**（通用 catalog 不含 portfolio）交给 Phase2-C compileSolverPlan → executePlan 服务端多步组合。
      // 非推演题照用通用 navSlice（不劫持·R6 纯投影·不碰 navigation-slice 系统级 catalog / 组合器内部）。
      // §3.2：推演题叠加多方案集 slots（portfolio 逐方案联合求解 → GlobalSimResponse.scenarios[] 供综合叙述权衡）。
      // WO-LIVE-NL · 产能 what-if NL 意图（「常州化成良率降到92%产能少多少」「哪个工序物料最卡 4680」）先于全局推演判定：
      // 因子变动 what-if → generic_inference 沿派生 DAG 真重算；因子级根因 → gap_attribution(scope)；前瞻 → capacity_forecast。
      // 结构化解析（parseCapacityWhatIf·R6·无 LLM）填 apply/scope 进 slots → 组合器纳入真算·runAgentLoop 未调（确定性 compose 秒答）。
      // WO-AGENT-RUNTIME-S01 · item 2：产能可行性变体（「型号+上浮X%+N周+能不能接」）先于 what-if/推演判定 →
      // capacity_forecast 为唯一对口 solver 的专属 navSlice + feasibilityComposeSlots 填 {modelId,demandDelta,weeks}
      // （型号从问句取·缺则从选中对象补）→ compileSolverPlan 生成 invoke_solver:capacity_forecast 服务端执行·不落 runAgentLoop。
      // 既有 isCapacityWhatIfQuery 只认「因子变动」（良率/OEE 降升）·此变体是「型号需求增量可行性」·两者互斥不劫持。
      const isFeas = isCapacityFeasibilityQuery(task.query, task.context.pageContext);
      const isCap = !isFeas && isCapacityWhatIfQuery(task.query, task.context.pageContext);
      const isSim = !isFeas && !isCap && isSimComposeQuery(task.query, task.context.pageContext);
      const feasFallbackModel = (task.context.selectedObjects ?? []).find((o) => o.objectType === "Model")?.objectId;
      const composeSlice = isFeas
        ? buildFeasibilityNavSlice()
        : isCap
          ? buildCapacityNavSlice(task.query)
          : isSim
            ? buildSimNavSlice(task.query)
            : navSlice;
      const composeSlotsForTask = isFeas
        ? { ...this.composeSlots(task), ...feasibilityComposeSlots(task.query, feasFallbackModel) }
        : isCap
          ? { ...this.composeSlots(task), ...capacityComposeSlots(task.query) }
          : isSim
            ? { ...this.composeSlots(task), ...simComposeSlots() }
            : this.composeSlots(task);
      const composeCompiled = compileSolverPlan(task.query, composeSlice, composeSlotsForTask);
      if (composeCompiled.ok) {
        await this.executePlanPath(taskId, auth, task, composeCompiled.plan, classification, executor, model);
        return; // 走组合路径·全程不落 runAgentLoop
      }
      await this.deps.events
        .emit(taskId, "step.completed", {
          stepId: newId("compose-miss"),
          type: "compose_fallback",
          outcome: composeCompiled.why,
          durationMs: 0,
        })
        .catch(() => undefined);
    }

    // WO-QOS-ONTOLOGY-CONTEXT · 口径语义锚定（缺口③文档三层投喂第二层）：紧随本题导航图 append 一层
    // 「各字段/规则的口径定义」（Metric formula/unit·派生公式·规则 expression）取自 A 单一真值（getTypeSemantics·
    // TTL60s 缓存·只列 slice 涉及项）——综合 LLM 看的是"带口径标注的数据"而非"带字段名的数据"。fail-open·纯 additive。
    // 合并注（Phase2-C 并入）：compose 命中经上方 early-return 不达此层·executePlan 自有 llm.compose 综合；此层只服务下方 runAgentLoop 路径的 userContent。
    const semanticSection = await buildOntologySemanticContext(navSlice, auth, this.deps.engine.deps.dataCore.ontology);
    const baseUser = buildAgentUser(task, priorSummary || undefined);
    // ★ WO-DRIL-P4 · Path-B Agent Loop DRIL 组包注入挂点（PRD §8.3·在 userContent 组装前、runAgentLoop 之前·**自成一格 additive**）。
    // 暗发门（qos.dril-routing·defaultOn:false）：关（含 "ALL" 降级）→ drilSection="" → userContent 逐字节等同既有 → 既有 path-B 不劫持（C4）。
    // 开 → ResourceRouter.buildResourcePackage 跨 solver/slice/rule/skill/workflow 一次组包（复用 P2 混合检索 + P3 图/质量加权·R6 确定）
    // → renderDrilPackage 成"预选导航"段 append 首轮 user；agent 有预置对口资源 → 一步对口下手·不再盲 discover 逐跳（round-trip ≤4·SEAM）。
    // 组包空（无任何资源）→ renderDrilPackage 返 ""→ 仍不注入（byte-compatible）。fail-open：组包异常吞掉不阻断既有 path-B。
    let drilSection = "";
    if (drilRoutingEnabled(enabledFeatures)) {
      try {
        const drilPkg = await this.getDrilRouter().buildResourcePackage(
          auth,
          task.query,
          task.context.pageContext as Record<string, unknown> | undefined,
        );
        drilSection = renderDrilPackage(drilPkg);
        if (drilSection) {
          await this.deps.events
            .emit(taskId, "step.completed", {
              stepId: newId("dril-inject"),
              type: "dril_package_injected",
              outcome: `DRIL 预选：solver=${drilPkg.solvers.map((s) => s.key).join(",") || "—"}｜slice=${drilPkg.slices.join(",") || "—"}｜rule=${drilPkg.rules.join(",") || "—"}`,
              durationMs: 0,
            })
            .catch(() => undefined);
        }
      } catch {
        drilSection = ""; // fail-open：不因组包异常阻断既有 path-B
      }
    }
    const userContent = [baseUser, sliceSection, semanticSection, drilSection].filter(Boolean).join("\n\n");
    const sliceSolverKeys = navigationSliceSolverKeys(navSlice);
    // WO-CONTEXT-COMPRESSION · 真 LLM 滚动摘要器注入（fail-open）：折叠轮次的前情摘要优先用 llm.compose 蒸馏，
    // compose 抛错/无 provider → 退确定性 defaultRollingSummary（既有 500 测全走此路·零回归）。providerAvailable 由 llmSettings
    // 判定；若其 providerAvailable 方法尚未落地（WO-0 领域·本单不改 providers）→ 退 false（确定性兜底），落地后自动启用真 LLM 摘要。
    const settingsForSummary = this.deps.llmSettings as unknown as {
      providerAvailable?: (tenantId: string | undefined, role: string, explicit?: string) => Promise<boolean>;
    };
    const summaryProviderAvailable =
      typeof settingsForSummary.providerAvailable === "function"
        ? await settingsForSummary.providerAvailable(task.tenantId, "compose").catch(() => false)
        : false;
    const result = await runAgentLoop({
      taskId,
      model,
      tenantId: task.tenantId,
      system: opts?.systemOverride ?? AGENT_SYSTEM_CORE,
      userContent,
      ...(sliceSolverKeys.length > 0 ? { sliceSolverKeys } : {}),
      emitNarration: reasoningTraceEnabled(enabledFeatures), // WO-REASONING-TRACE：暗发开 → 每轮思考旁白流前端（建信任）
      summarizer: makeLlmRollingSummarizer(this.deps.engine.deps.llm, model, task.tenantId, summaryProviderAvailable),
      tools,
      llm: this.deps.engine.deps.llm,
      executor,
      budget,
      repos: this.deps.repos,
      metrics: this.deps.metrics,
      emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
      isCancelled: () => this.cancelled.has(taskId),
      // WO-LIGHTUP · 反思闭环接线（暗发·仅 agent.critic 开才注入·关=既有 path-B 逐字节不变·不劫持）：
      // reflect=收尾前确定性复盘（reflect.ts·R6·补齐 REFLECT-LOOP 未做的生产接线）；critic=LLM advisory 复核（compose 单发·
      // fail-open：抛错/无 provider → 视为过关·绝不阻断循环·确定性 reflect 仍为主判）。
      ...(reflectEnabled(enabledFeatures)
        ? {
            reflect: true,
            critic: async ({ blocks, userContent: uc }: { blocks: AnswerBlock[]; userContent: string }) => {
              try {
                const out = await this.deps.engine.deps.llm.compose({
                  model,
                  instruction:
                    "你是答案质检员。判断下面的『回答』是否真正回答了『问题』、有无明显硬伤（答非所问 / 缺关键结论 / 自相矛盾 / 该调求解器却空口给数）。" +
                    "只输出一行：过关输出 PASS；否则输出简短原因（≤30字）。",
                  inputs: [{ 问题: uc, 回答: blocks }],
                });
                const s = String(out ?? "").trim();
                if (!s || /^PASS\b/i.test(s) || s === "过关") return { ok: true };
                return { ok: false, reason: s.slice(0, 60) };
              } catch {
                return { ok: true }; // fail-open：critic 抛错/无 provider → 不阻断（确定性 reflect 主判仍生效）
              }
            },
          }
        : {}),
      // G-9：per-call 有界超时（挂住时上界终止 → 优雅降级），不放松 budget 下界
      llmCallTimeoutMs: this.deps.config.QOS_AGENT_LLM_TIMEOUT_MS,
    });

    await this.deps.repos.agentRuns.insert(result.run);
    await this.deps.repos.fallbackTraces.insert({
      id: newId("fbt"),
      taskId,
      tenantId: task.tenantId,
      packageId: task.packageId,
      query: task.query,
      view: task.context.view,
      executedPlanSketch: result.sketch,
      outcome: result.outcome === "FAILED" ? "FAILED" : result.outcome,
      createdAt: new Date().toISOString(),
      normalizedQuery: normalizeQuery(task.query),
      // S4.2: deterministic pseudo-embedding for /ops/fallback-stats vector-neighbor clustering
      embedding: pseudoEmbed(normalizeQuery(task.query)),
    });

    if (this.cancelled.has(taskId)) {
      await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
      this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "CANCELLED" });
      return;
    }

    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      answer: result.answer,
      classification,
      completedAt: new Date().toISOString(),
    });
    for (const block of result.answer.blocks) {
      if (block.type === "action_draft") {
        await this.deps.events.emit(taskId, "action_draft.created", {
          draftId: block.draftId,
          actionType: block.actionType,
        });
      }
    }
    // G-9：有界终止降级 → 复用 step.completed 伪 step（不新增 PRD §8.2 事件名）区分"超时/预算降级"vs"正常探索"。
    // 必早于 answer.final（前端 TaskDetailPage 已 filter step.completed，零改）。
    if (result.degraded) {
      await this.deps.events.emit(taskId, "step.completed", {
        stepId: newId("degrade"),
        type: "agent_degraded",
        outcome: result.degraded.reason,
        durationMs: budget.elapsedMs(),
      });
    }
    await this.deps.events.emit(taskId, "answer.final", result.answer);
    this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
    await this.recordExperience(taskId);
  }

  /**
   * WO-Phase2-C-COMPLETE · 组合器静态槽位派生（从 task.query / domainResolve.args / pageContext.focus 派生可填入参）。
   * 纯派生（无 LLM/时钟/随机·R6）：domainResolve 单一来源取页面派生 args + focus 锚 + 问句里的订单/型号引用。
   * 值非空即视为可静态填该 arg（compileSolverPlan 据此判 required arg 能否满足·填不上则回退 ReAct）。
   */
  private composeSlots(task: QueryTask): CompileSlots {
    const slots: Record<string, unknown> = {};
    const q = task.query ?? "";
    const pc = task.context.pageContext;
    // ① domainResolve.args（页面上下文派生·单一来源·复用 A 门同一解析器）。
    const dr = domainResolve(q, pc);
    for (const [k, v] of Object.entries(dr.args ?? {})) if (v != null) slots[k] = v;
    // ② PageContext.focus 锚（metric/order/base/factor → 对口 arg 名）。
    const focus = pc?.focus ?? {};
    if (focus.metric != null && slots.metricKey == null) slots.metricKey = focus.metric;
    if (focus.factorId != null && slots.factorId == null) slots.factorId = focus.factorId;
    if (focus.base != null && slots.baseId == null) slots.baseId = focus.base;
    if (focus.order != null) {
      if (slots.targetOrderId == null) slots.targetOrderId = focus.order;
      if (slots.orderRef == null) slots.orderRef = focus.order;
      if (slots.so == null) slots.so = focus.order;
    }
    // ③ 问句文本里的订单引用（SO-xxxx）→ targetOrderId/orderRef/so（sop_reschedule/atp_check 定位主体）。
    const orderM = q.match(/\bSO-?\d+\b/i);
    if (orderM) {
      const so = orderM[0];
      if (slots.targetOrderId == null) slots.targetOrderId = so;
      if (slots.orderRef == null) slots.orderRef = so;
      if (slots.so == null) slots.so = so;
    }
    return slots;
  }

  /**
   * WO-Phase2-C-COMPLETE · 组合路径出口：executePlan 服务端逐步 invoke_solver + 一次综合·**全程不落 runAgentLoop**。
   * 复用 runPathB 已建的 executor（= makeExecutor 产物·path-A invoke 通道）与已解析 model；自行完成 task 收尾（COMPLETED + answer.final）。
   * 与 path-B 分水岭：组合命中题绝不进 agent 盲选多跳。含 LLM 综合 → trustLevel=AGENT_EXPLORATORY（不冒充「数据库事实」）。
   */
  private async executePlanPath(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    plan: ComposePlan,
    classification: ClassificationResult | undefined,
    executor: GuardedToolExecutor,
    model: string,
  ): Promise<void> {
    void auth; // executor 已挟带 OBO ctx（makeExecutor(taskId, auth, budget)）→ 无需二次透传
    const result = await executePlan(plan, {
      executor,
      llm: this.deps.engine.deps.llm,
      model,
      tenantId: task.tenantId,
      emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
    });

    if (this.cancelled.has(taskId)) {
      await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
      this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "CANCELLED" });
      return;
    }

    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      answer: result.answer,
      classification,
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "answer.final", result.answer);
    this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
    await this.recordExperience(taskId);
  }

  /**
   * Phase6A 语义压缩回写管线：path B 任务完成后，把本轮推演蒸馏为经验案例落入经验记忆库，
   * 供后续 search_experience 检索。approach = 工具/求解器调用轨迹的结构化蒸馏（即被折叠/丢弃
   * 上下文的留存），outcome = 结论首段。确定性 pseudoEmbed；回写失败不影响主流程。
   */
  private async recordExperience(taskId: string): Promise<void> {
    try {
      const task = await this.deps.repos.tasks.get(taskId);
      if (!task?.answer) return;
      const calls = await this.deps.repos.toolCalls.listByTask(taskId);
      const tools = [...new Set(calls.map((c) => c.toolName))];
      const solvers = [
        ...new Set(
          calls
            .filter((c) => c.toolName === "invoke_solver")
            .map((c) => (c.input as { solverKey?: string } | undefined)?.solverKey)
            .filter((s): s is string => !!s),
        ),
      ];
      const approach = `工具:${tools.join("/") || "—"}${solvers.length ? ` · 求解器:${solvers.join("/")}` : ""} · ${calls.length} 次调用`;
      const firstText = task.answer.blocks.find((b) => b.type === "text");
      const outcome = firstText && firstText.type === "text" ? firstText.markdown.slice(0, 240) : "(无文本结论)";
      const scene = String((task.context as { view?: string } | undefined)?.view ?? "agent");
      const date = (task.completedAt ?? task.createdAt ?? new Date().toISOString()).slice(0, 10);
      await this.deps.repos.experience.upsert({
        id: `exp_auto_${taskId}`.replace(/[^\w-]/g, "_"),
        tenantId: task.tenantId,
        scene,
        question: task.query,
        approach,
        outcome,
        date,
        embedding: pseudoEmbed(`${task.query} ${approach}`),
      });
    } catch {
      /* 回写失败不影响主流程 */
    }
  }

  /**
   * WO-REAL-LLM-FREE-QUERY：CEO/块级深问真 LLM 自由多跳（确定性路由之外）。
   * 增强版 path-B（CEO_DEEP_QUESTION_SYSTEM + PageContext/BlockContext 注入 → runAgentLoop 真 LLM 多跳取证）。
   * 真 LLM 失败（无 provider / LLM_EMPTY_RESPONSE / 超预算 / 异常）→ try/catch 落**确定性兜底**（resolveBlockRoute/
   * resolveCeoRoute → path A 求解器）+ 诚实标降级（routing.degraded 事件 + classification.model=deterministic:*-fallback）。
   * **绝不把真 LLM 输出标"数据库事实"**（trustLevel 由 runAgentLoop 置 AGENT_EXPLORATORY）；无 provider 诚实落确定性。
   */
  private async runCeoFreeLLM(taskId: string, auth: RequestAuth, enabledFeatures: FeatureSet): Promise<void> {
    try {
      await this.runPathB(
        taskId,
        auth,
        { candidates: [], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "agent:ceo-free-llm" },
        { systemOverride: CEO_DEEP_QUESTION_SYSTEM },
      );
    } catch (err) {
      // 真 LLM 不可用 → 确定性兜底 + 诚实标降级（不把兜底伪装成真 LLM）。
      await this.runCeoDeterministicFallback(taskId, auth, enabledFeatures, err);
    }
  }

  /**
   * WO-REAL-LLM-FREE-QUERY：真 LLM 深问失败后的确定性兜底——复用既有确定性路由（块级优先 → 页面级 CEO 问句），
   * 诚实标 `deterministic:*-fallback` + 发 `routing.degraded`（前端据此标"确定性兜底·真 LLM 不可用"·非"数据库事实"）。
   */
  private async runCeoDeterministicFallback(
    taskId: string,
    auth: RequestAuth,
    enabledFeatures: FeatureSet,
    err: unknown,
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "AGENT_ERROR";
    await this.deps.events.emit(taskId, "routing.degraded", {
      reason: "真 LLM 深问不可用，回退确定性求解（诚实标降级）",
      code,
    });
    const candidates = await this.publishedIntentsForView(task.packageId, task.context.view, enabledFeatures);

    // 块级定向兜底优先（块是更强的上下文信号）。
    if (hasBlockContext(task.context.pageContext)) {
      const route = resolveBlockRoute(task.context.pageContext, "ceo");
      const ceoIntent = route && candidates.find((c) => c.key === ceoIntentKeyForRoute(route.route));
      if (route && ceoIntent) {
        await this.deps.repos.tasks.patch(taskId, {
          classification: { candidates: [{ intentKey: ceoIntent.key, confidence: 1 }], outOfCatalog: false, extractedSlots: route.args, latencyMs: 0, model: "deterministic:block-route-fallback" },
        });
        await this.proceedWithIntent(taskId, auth, ceoIntent, route.args);
        return;
      }
    }
    // 页面级 CEO 问句兜底。
    if (task.context.pageContext && isCeoQuestion(task.query)) {
      const route = resolveCeoRoute(task.query, task.context.pageContext, "ceo");
      const ceoIntent = candidates.find((c) => c.key === ceoIntentKeyForRoute(route.route));
      if (ceoIntent) {
        await this.deps.repos.tasks.patch(taskId, {
          classification: { candidates: [{ intentKey: ceoIntent.key, confidence: 1 }], outOfCatalog: false, extractedSlots: route.args, latencyMs: 0, model: "deterministic:ceo-route-fallback" },
        });
        await this.proceedWithIntent(taskId, auth, ceoIntent, route.args);
        return;
      }
    }
    // 无确定性落点（如纯沙盘 NL 深问但无 CEO 意图）→ 换个问法兜底（诚实·不编造）。
    await this.completeWorkflowOnlyMiss(task, candidates);
  }

  /**
   * WO-FIVE-ROLE-AI-EMPLOYEE P1 · C2：单域 path-B → 选该域角色的注册 agent（非通用 loop）。
   * 经 engine.runRegisteredAgent 真调角色 agent（其自身 systemPrompt + scopeDeclaration·enforceObjectScope 真隔离），
   * 答案标 AGENT_EXPLORATORY·classification.model=`agent:role:<role>`（可区分·非"总走 universal"）。
   */
  private async runRolePathB(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    prof: CeoAgentProfile,
    classification?: ClassificationResult,
  ): Promise<void> {
    await this.deps.repos.tasks.patch(taskId, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(taskId, "routing.completed", { path: "AGENT", note: `角色 agent（${prof.role}）`, role: prof.role, agentId: prof.agentId });

    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // WO-Phase4 §6：子 agent/角色/场景/工作流 path 同受硬预算（env 未设→宽松 DEFAULT 不变）
    const priorSummary = agentPriorSummary(await this.previousConversationTasks(task));
    const prompt = [roleSystemFragment(prof.role), buildAgentUser(task, priorSummary || undefined)].filter(Boolean).join("\n");
    try {
      const resolvedRefs: ResolvedRef[] = [];
      const result = await this.deps.engine.runRegisteredAgent({
        taskId,
        agentId: prof.agentId as string,
        version: "latest",
        prompt,
        ctx: auth,
        nesting: { callChain: [], budget },
        emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
        isCancelled: () => this.cancelled.has(taskId),
        onResolvedRef: (r) => resolvedRefs.push(r),
        enforceObjectScope: true,
      });
      await this.deps.repos.agentRuns.insert(result.run);
      await this.deps.repos.tasks.patch(taskId, {
        status: "COMPLETED",
        answer: result.answer,
        classification: { ...(classification ?? { candidates: [], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "" }), model: `agent:role:${prof.role}` },
        resolvedRefs: dedupeRefs(resolvedRefs),
        completedAt: new Date().toISOString(),
      });
      await this.deps.events.emit(taskId, "answer.final", result.answer);
      this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
      await this.recordExperience(taskId);
    } catch (err) {
      await this.failFromError(taskId, err, "AGENT_ERROR");
    }
  }

  /**
   * WO-FIVE-ROLE-AI-EMPLOYEE P1 · 跨域 Coordinator 编排执行：CoordinatorPlan → 每 dispatch 一个 invoke_agent 步扇出
   *（复用 workflow invoke_agent·enforceAgentObjectScope 真隔离——各角色 agent 只能在自身 scopeDeclaration.objectTypes 内取证，
   * 越界读对象被拒）→ 收各角色答 → synthesize 结构化汇总（谁答什么 + 一致/冲突 + 综合结论 + 每角色溯源）。
   * 真跨 agent 调用（非单 agent 换 prompt 假装）：每步经 engine.runRegisteredAgent 真调对应 agentId。
   */
  private async runCoordinator(taskId: string, auth: RequestAuth, plan: CoordinatorPlan): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;

    await this.deps.repos.tasks.patch(taskId, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(taskId, "routing.completed", {
      path: "AGENT",
      note: "跨域协调（Coordinator）",
      trigger: plan.trigger,
      roles: plan.dispatches.map((d) => d.role),
    });
    await this.deps.events.emit(taskId, "coordinator.planned", {
      trigger: plan.trigger,
      dispatches: plan.dispatches.map((d) => ({ role: d.role, agentId: d.agentId, subQuestion: d.subQuestion })),
    });

    // WO-AGENT-RUNTIME-S01 · item 5：DRIL 智能资源包（对口 solver/slice 预选）传进每个角色子 agent 的 prompt——
    // 让子 agent 也优先调对口 solver·不盲扫烧预算。暗发门（qos.dril-routing·关/组包空 → drilSection="" → 子 agent
    // prompt 逐字节不变·byte-compatible）；组包异常吞掉不阻断 Coordinator 扇出（fail-open）。
    let drilSection = "";
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth.token);
    if (drilRoutingEnabled(enabledFeatures)) {
      try {
        const drilPkg = await this.getDrilRouter().buildResourcePackage(
          auth,
          task.query,
          task.context.pageContext as Record<string, unknown> | undefined,
        );
        drilSection = renderDrilPackage(drilPkg);
      } catch {
        drilSection = "";
      }
    }
    const steps = buildDispatchSteps(plan, task.context.pageContext, drilSection);
    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // WO-Phase4 §6：子 agent/角色/场景/工作流 path 同受硬预算（env 未设→宽松 DEFAULT 不变）
    const invokedAgentKeys: string[] = [];
    const result = await this.deps.engine.runWorkflowSteps({
      taskId,
      steps,
      slots: {},
      context: task.context,
      ctx: auth,
      nesting: { callChain: [], budget },
      emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
      trustLevel: "AGENT_EXPLORATORY",
      enforceAgentObjectScope: true, // 角色 scope 真隔离（越界读对象拒）
      onResolvedRef: (r) => {
        if (r.kind === "agent") invokedAgentKeys.push(r.key);
      },
    });

    // 收各角色答（invoke_agent 步 stepOutputs[dispatch_i].data.answer）→ synthesize。
    const outputs = result.stepOutputs;
    const roleAnswers: RoleAnswerInput[] = plan.dispatches.map((d, i) => {
      const out = outputs[`dispatch_${i}`] as { data?: { answer?: Answer } } | null | undefined;
      const ans = out?.data?.answer;
      const firstText = ans?.blocks.find((b) => b.type === "text");
      const answerText = firstText && firstText.type === "text" ? firstText.markdown : "";
      return { role: d.role, agentId: d.agentId, subQuestion: d.subQuestion, answerText, scope: d.scope, objectTypes: d.objectTypes };
    });

    const answer = synthesize(plan, roleAnswers);
    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      path: "AGENT",
      answer,
      classification: { candidates: [], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "coordinator" },
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
  }

  /** AGENT_FIRST / AGENT_ONLY scene-entry modes — skip classification, run the configured agent. */
  private async runSceneAgent(task: QueryTask, auth: RequestAuth, scene: SceneEntryConfig): Promise<void> {
    await this.deps.repos.tasks.patch(task.id, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(task.id, "routing.completed", { path: "AGENT", note: `场景入口模式 ${scene.mode}` });

    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // WO-Phase4 §6：子 agent/角色/场景/工作流 path 同受硬预算（env 未设→宽松 DEFAULT 不变）
    try {
      // 增量 §1.4：场景入口 agent 同样注入前情摘要（共用同一构建器）
      const priorSummary = agentPriorSummary(await this.previousConversationTasks(task));
      const resolvedRefs: ResolvedRef[] = [];
      const result = await this.deps.engine.runRegisteredAgent({
        taskId: task.id,
        agentId: scene.defaultAgentId as string,
        version: "latest",
        prompt: buildAgentUser(task, priorSummary || undefined),
        ctx: auth,
        nesting: { callChain: [], budget },
        emit: (e, p) => this.deps.events.emit(task.id, e, p).then(() => undefined),
        isCancelled: () => this.cancelled.has(task.id),
        onResolvedRef: (r) => resolvedRefs.push(r),
      });
      await this.deps.repos.agentRuns.insert(result.run);
      await this.deps.repos.tasks.patch(task.id, {
        status: "COMPLETED",
        answer: result.answer,
        resolvedRefs: dedupeRefs(resolvedRefs),
        completedAt: new Date().toISOString(),
      });
      await this.deps.events.emit(task.id, "answer.final", result.answer);
      this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
      await this.recordExperience(task.id);
    } catch (err) {
      await this.failFromError(task.id, err, "AGENT_ERROR");
    }
  }

  /** WORKFLOW_ONLY with no intent hit → "请换个问法" + intent list, no agent. */
  private async completeWorkflowOnlyMiss(task: QueryTask, candidates: IntentDefinition[]): Promise<void> {
    const list = candidates.map((c) => `- ${c.name}（${c.key}）`).join("\n");
    const answer: Answer = {
      trustLevel: "VERIFIED_WORKFLOW",
      blocks: [
        {
          type: "text",
          markdown: `请换个问法。本入口仅支持以下预设问题：\n${list || "（暂无可用意图）"}`,
        },
      ],
      provenance: [],
      unverifiedNumerics: false,
    };
    await this.deps.repos.tasks.patch(task.id, {
      status: "COMPLETED",
      path: "WORKFLOW",
      answer,
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(task.id, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "COMPLETED" });
  }

  /**
   * WO-0-NL-WIRING（急救·产出③）：无可用 LLM provider 时的诚实降级收尾（COMPLETED·非 FAILED/INTERNAL_ERROR）。
   * 对话从"崩"变"诚实说未接 LLM 并指路"——绝不静默空答，也绝不红错叙述。
   */
  private async completeNoLlmDegradation(task: QueryTask): Promise<void> {
    const answer: Answer = {
      trustLevel: "AGENT_EXPLORATORY",
      blocks: [
        {
          type: "text",
          markdown:
            "当前未接入可用的 LLM 提供商，无法对这类自由问句做开放推理。请在「设置 → LLM」绑定一个提供商后重试；" +
            "或改用场景卡/确定性入口提问（产能可行性、缺口归因等预设问题无需 LLM 即可作答）。",
        },
      ],
      provenance: [],
      unverifiedNumerics: false,
    };
    await this.deps.repos.tasks.patch(task.id, {
      status: "COMPLETED",
      path: "AGENT",
      answer,
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(task.id, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
  }

  // -------------------------------------------------------------------------
  // cancel / feedback
  // -------------------------------------------------------------------------
  async cancel(taskId: string, auth: RequestAuth): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== auth.tenantId) {
      throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    }
    this.cancelled.add(taskId);
    const pending = this.pending.get(taskId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(taskId);
      await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
    } else if (task.status === "ROUTING") {
      await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
    }
    // executing tasks: cancelled flag is checked at loop boundaries (尽力中断)
  }

  /**
   * §13.2: cancel still-running tasks of a conversation when a newer task arrives
   * (reason SUPERSEDED). Drafts already produced by cancelled tasks are kept
   * (提案并存原则); executing tasks observe the flag at their next loop boundary.
   */
  private async supersedeConversation(tenantId: string, conversationId: string, keepTaskId: string): Promise<void> {
    const ACTIVE = new Set(["ROUTING", "AWAITING_CLARIFICATION", "EXECUTING_WORKFLOW", "EXECUTING_AGENT"]);
    const siblings = await this.deps.repos.tasks.listByConversation(tenantId, conversationId);
    for (const t of siblings) {
      if (t.id === keepTaskId || !ACTIVE.has(t.status)) continue;
      this.cancelled.add(t.id);
      const pending = this.pending.get(t.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(t.id);
      }
      await this.deps.repos.tasks.patch(t.id, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(t.id, "task.cancelled", { reason: "SUPERSEDED", supersededBy: keepTaskId });
      this.deps.metrics.tasksCancelled.inc({ reason: "SUPERSEDED" });
    }
  }

  async feedback(taskId: string, auth: RequestAuth, vote: "UP" | "DOWN"): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || task.tenantId !== auth.tenantId) {
      throw new HttpError(404, "TASK_NOT_FOUND", `task not found: ${taskId}`);
    }
    const applied = await this.deps.repos.fallbackTraces.setFeedback(taskId, vote);
    if (!applied) {
      // 路径 A 仅落审计
      await this.deps.events.emit(taskId, "feedback.recorded", { vote });
    }
  }

  /**
   * R7：把抛出的错误落统一信封——错误若自带 `code`（如 LlmEmptyResponseError.code=LLM_EMPTY_RESPONSE）则用之，
   * 否则用 fallbackCode（默认 INTERNAL_ERROR）。把"神秘 TypeError"变可诊断错误码（PRD 空响应护栏）。
   */
  private async failFromError(taskId: string, err: unknown, fallbackCode = "INTERNAL_ERROR"): Promise<void> {
    const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : fallbackCode;
    await this.failTask(taskId, code, err instanceof Error ? err.message : String(err));
  }

  private async failTask(taskId: string, code: string, message: string): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return;
    // CL.7 GF.2：路径 B agent 硬失败 → 在答案流并入结构化缺口块，对话坞渲染可点缺口卡（▶触发
    // 自成长 LOOP 实诊断+补 → 续推），而非只剩红错叙述。闭 G-3 对话侧（诚实暴露断点）。其余路径（工作流/
    // 校验）维持纯 FAILED。answer.final 先于 task.failed 发出 → useTaskStream 既得 gap 答案又得失败态。
    if (task.path === "AGENT" && !task.answer) {
      const gapAnswer: Answer = {
        trustLevel: "AGENT_EXPLORATORY",
        unverifiedNumerics: false,
        provenance: [],
        blocks: [{
          type: "gap",
          report: {
            question: task.query,
            taskId,
            verdict: "BLOCKED",
            path: "AGENT",
            findings: [{ gapCode: "OTHER", evidence: `路径 B agent 推演中断（${code}）`, suggestedFill: "触发自成长 LOOP 诊断缺口并补齐后续推", blocking: true }],
            generatedAt: new Date().toISOString(),
          },
        }],
      };
      await this.deps.repos.tasks.patch(taskId, { answer: gapAnswer });
      await this.deps.events.emit(taskId, "answer.final", gapAnswer);
    }
    await this.deps.repos.tasks.patch(taskId, {
      status: "FAILED",
      error: { code, message },
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "task.failed", { code, message });
    this.deps.metrics.tasksTotal.inc({ path: task.path ?? "NONE", status: "FAILED" });
  }
}
