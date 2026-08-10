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
  PendingClarification,
  ProvenanceRef,
  QueryTask,
  ResolvedRef,
  RoleDispatch,
  ScenarioPackage,
  SceneEntryConfig,
  SlotDef,
  SubmitQueryBody,
} from "@platform/contracts";
import { ErrorCodes } from "@platform/contracts";
import type { SkillDefinition } from "@platform/contracts";
import type { LlmBudgetPort } from "../ops/llm-budget.js";
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
  buildSkillSection,
} from "../agent/prompts.js";
import { runAgentLoop, type AgentToolSpec, type AgentLoopResult } from "../agent/loop.js";
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
import type { ComposePlan, MultiIntentPlan } from "@platform/contracts";
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
import { selectDeterministicMultiRoute, detectCoupledPairs, runParallelRoutes, selectMultiIntent, type MultiIntentCandidate, type MultiIntentSelection } from "./multi-route.js"; // WO-QOS-CROSS-DOMAIN-UNIFIED · ②确定性多域 + ⑤LLM 多意图 **共享后半** runParallelRoutes（并行 solver + 零 LLM 块装配）
import { planCoordination, planStalledCoordination, buildDispatchSteps, synthesize, detectSingleRole, ROLE_LABELS, type RoleAnswerInput } from "./coordinator.js"; // WO-FIVE-ROLE-AI-EMPLOYEE P1 · 跨域多角色 Coordinator 编排 + WO-LOOP-CONTROL-P2.5 rung② 反应式停滞兜底拆解 + WO-ROUTE-1 旁白角色标识
import { resolveOptWhatifRoute, extractOptWhatifData, assembleOptWhatifAnswer, type OptWhatifRoute } from "./opt-whatif-route.js"; // WO-OPTWHATIF-NL-WIRING · 结构化优化 what-if 会话路由抽取 + 决策切换答案装配（R6·leaf 模块）
import { buildL2Prompt, parseSolverPlan, buildSlotBag, validateSolverPlan, deterministicSlotFloor, mergeSlotFloor } from "./l2-decompose.js"; // WO-L2-DECOMPOSE · L2 真分解（LLM 产 solver 计划 → 纯校验层验真 → 接同一后半 runParallelRoutes·复用不新造）；WO-SLOT-HARVEST · 主链路确定性槽位底座（同一份确定性抽取器·单源）
import { isCombinationAsk, runL3CoupledPath } from "./l3-coupled.js"; // PRD-multi-intent-L2L3 P2 · L3 耦合联合求解（一次 portfolio 守恒解·真传导·真残差外协·升格判挂 runMultiRoute）
import { roleProfile } from "../mocks/seed.js"; // WO-FIVE-ROLE P1 · 角色画像（path-B 按 role 选 agent）
import { roleSystemFragment } from "../agent/prompts.js";
import { injectScenarioRuleStep } from "./scenario-rules.js";
import { recordOutOfDomain, recordResolutionAttempts } from "./perception-metrics.js";
import { ResourceRegistryService } from "../dril/resource-registry.js"; // WO-DRIL-P4 · Path-B 组包注入（PRD §8.3·消费 P2/P3 registry·不改真值源）
import { ResourceRouter, type ResourcePackage } from "../dril/resource-router.js"; // WO-DRIL-P4 · buildResourcePackage 组包（P3 地基·additive 消费）

const CLARIFICATION_TIMEOUT_MS = 10 * 60_000;

/**
 * ★ WO-COORD-YIELD-AND-TERMINAL · D2（闭 §8 `G-TASK-NO-TERMINAL`）· 终态看门狗默认阈值。
 *
 * **180s 的依据（对决策者有意义，不是拍脑袋）**：这是给**人**看的问答坞，等答案的人不会等 3 分钟以上——
 * 超过就已经是"这系统坏了"的体验，此时给一句诚实的"未收敛，已中止 + 已完成到哪一步"远胜于转圈到天荒地老。
 * 实测事故里那条 task 是 **19 分钟**仍 `EXECUTING_AGENT`、`completedAt` 为空、token 计数早已冻结、进程 CPU 0.5%
 * ——它不是在慢慢算，是已经不算了，只是没人给它落终态。180s 也宽于既有各层内部上界
 * （`QOS_AGENT_LLM_TIMEOUT_MS` 默认 60s per-call），故它只在**那些上界全都没兜住**时才开火 = 真·最后一道兜底。
 */
const DEFAULT_TASK_TERMINAL_TIMEOUT_MS = 180_000;

/** 终态状态集（单一来源）——看门狗与 `failTask` 共用，避免两处各写一份字符串数组。 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * 终态看门狗阈值（ms）。env `QOS_TASK_TERMINAL_TIMEOUT_MS` 可配；**每次读取**（而非模块加载时定格），
 * 让 SEAM 测能把阈值压到毫秒级越线，而不必真等 3 分钟。非法/非正数 → 回落默认值（fail-safe：绝不因配错而关掉看门狗）。
 * 注：本单 🚦范围边界不含 `config.ts`，故走 env 直读而非新增 AppConfig 键（形态与 `MCP_STDIO_ENABLED` 同源·可后续收编）。
 */
export function taskTerminalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.QOS_TASK_TERMINAL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TASK_TERMINAL_TIMEOUT_MS;
}

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
 * WO-LOOP-CONTROL-P2 · feature 门：path-B `runAgentLoop` 停滞时是否启用**升级阶梯**（Escalation Ladder：rung① 换策略再试一轮
 * → rung③ 诚实降级）。**WO-LOOP-CONTROL-P2.5 起同门控 rung② orchestrator 层反应式重路由**（loop 上抛 result.stalled → runPathB
 * `maybeRerouteToCoordinator` 拆多角色扇出·早于 degrade 兜底·防双 Coordinator·一次性）——本门关 → 停滞既不 rung① 也不 rung②·
 * 直接 degrade。**暗发·默认关**。与 reflectEnabled 同款字节兼容：`set==="ALL"`（mock 默认 / DataCore 降级）→ **false**——既有
 * path-B 停滞直接 degrade（P1/S01 逐字节不变·不劫持）；仅**显式** Set 含 `agent.escalation` 才启用。双注册（datacore features.ts + agentcore registry）。
 */
export function escalationEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("agent.escalation");
}

/**
 * #90 · feature 门：默认自由问答（泛化 path-B）是否挂载**租户级已发布 Skill**。
 * 病灶：`buildSkillSection` 全仓只有一个调用方 `engine.ts runRegisteredAgent`（skill 绑在 `agent.skills` 上），
 * 泛化 path-B 用裸 `AGENT_SYSTEM_CORE` 且不传 `loadSkillEnabled`/`loadSkill` → 整套 Skill 子系统
 *（发布双门禁 / evals / 语义路由 / embedding 旋钮）对默认路径**完全不可达**——不是"忘传一个 flag"，
 * 是泛化路径根本没有 agent，需要一条**租户级**技能来源。**暗发·默认关**：`set==="ALL"`（mock 默认 /
 * DataCore 降级）→ false → 既有 path-B system prompt 与工具集逐字节不变（不劫持）。双注册（datacore + agentcore）。
 */
export function skillOnFreeQaEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("agent.skill-on-free-qa");
}

/**
 * OC7 / #92 · feature 门：租户 LLM token 配额**执行**（硬线耗尽 → 拒新 QOS 任务）。
 * 病灶：`/a/v1/llm-budgets` 状态机完整且有测试坐实，但 agentcore/frontend **零命中** —— 账本记得对，
 * 没有任何调用方写它或读它。**记账侧无条件接**（先让账本有真数据），**执行侧才门控**——
 * 顺序反了就成了拿脏账拦人。关 = `set==="ALL"` 或未含该键 → 只记账不拦（既有行为字节不变）。
 */
export function llmBudgetEnforceEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.llm-budget-enforce");
}

/**
 * #90 · 租户级技能池（R6 确定性）：只取 **PUBLISHED**（DRAFT/RETIRED 不进自由问答），
 * 同 key 保留最高版本，按 key 字典序排——同租户同输入的 system prompt 字节一致。
 * 注入量由 `buildSkillSection` 的语义路由收窄（top-k 全文 + 其余降级为 id/名·仍可 load_skill 取全文）。
 */
export function selectTenantSkills(all: SkillDefinition[]): SkillDefinition[] {
  const latest = new Map<string, SkillDefinition>();
  for (const s of all) {
    if (s.status !== "PUBLISHED") continue;
    const cur = latest.get(s.key);
    if (!cur || s.version > cur.version) latest.set(s.key, s);
  }
  return [...latest.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
 * WO-QOS-CROSS-DOMAIN-UNIFIED · ⑤ feature 门：LLM classify 后是否启用**多意图兜底**（确定性没覆盖的跨域题·分类器多候选并行）。
 * **暗发·默认关**·同款字节兼容（`set==="ALL"`→false·既有单意图/澄清路径逐字节不变·SEAM 零回归·不劫持）；仅**显式** Set 含
 * `qos.multi-intent-orchestration` 才启用。双注册（datacore features.ts + agentcore registry·同列 QOS_DARK_LAUNCH_FEATURES）。
 */
export function multiIntentEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.multi-intent-orchestration");
}

/**
 * WO-OPTWHATIF-NL-WIRING · feature 门：是否启用**结构化优化 what-if 会话路由**（NL「改一系数→CP-SAT 重解→最优决策
 * 切换」→ path-A optimize_whatif）。**暗发·默认关**·同款字节兼容（`set==="ALL"`→false·关=既有管线逐字节不变·不劫持）；
 * 仅**显式** Set 含 `qos.opt-whatif-route` 才启用（双注册：datacore features.ts + agentcore registry·权威集来自 DataCore）。
 */
export function optWhatifRouteEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.opt-whatif-route");
}

/**
 * WO-L2-DECOMPOSE · feature 门：free-LLM 门前是否启用**L2 多意图真分解**（LLM 产 solver 执行计划 → 确定性校验 →
 * 接共享后半 runParallelRoutes·补 novel 措辞被 free-LLM 长度门劫持的确定题）。**暗发·默认关**·同款字节兼容
 * （`set==="ALL"`→false·既有 free-LLM 长度门逐字节不变·SEAM-零回归·不劫持）；仅**显式** Set 含 `qos.multi-intent-l2-decompose`
 * 才启用。双注册（datacore features.ts + agentcore registry·同列 QOS_DARK_LAUNCH_FEATURES）。
 */
export function l2DecomposeEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.multi-intent-l2-decompose");
}

/**
 * PRD-multi-intent-L2L3 P2 · L3 耦合联合求解门（暗发·默认关）。关 → L1 独立并行 + 耦合诚实标（现状·零回归）。
 */
export function l3CoupledEnabled(set: FeatureSet): boolean {
  if (set === "ALL") return false;
  return set.has("qos.multi-intent-l3-coupled");
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
  if (pkg.skills.length > 0) {
    const skillLine = pkg.skills.map((s) => (s.capability ? `${s.key}（${s.capability}）` : s.key)).join("、");
    lines.push(`· 技能（相关时可参考其策略）：${skillLine}`);
  }
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

/**
 * ★ WO-COORD-YIELD-AND-TERMINAL · D2 · 进程内"执行中"看门狗态（非契约）。
 * `phase` 是给用户看的人话阶段名（"三角色会诊" / "探索模式" / "工作流执行"…），会**原样**进中止答案，
 * 好让那句"未收敛已中止"说得出**是哪一步**没收敛——而不是又一句笼统 INTERNAL_ERROR。
 */
interface ExecutionWatchdogState {
  timer: NodeJS.Timeout;
  startedAt: number;
  phase: string;
}

/** 进程内澄清等待态（含 auth/timer，非契约）；落在 task 上的契约形态是 contracts `PendingClarification`。 */
interface PendingClarificationState {
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
  /** OC7（#92）：租户 LLM token 配额账本（记账无条件·执行门控于 qos.llm-budget-enforce）。 */
  llmBudget: LlmBudgetPort;
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
  private readonly pending = new Map<string, PendingClarificationState>();
  private readonly cancelled = new Set<string>();
  /**
   * ★ WO-COORD-YIELD-AND-TERMINAL · D2 · 非终态执行中任务的**终态责任人**登记表（taskId → 看门狗）。
   * 与 `pending`（AWAITING_CLARIFICATION 的 setTimeout+unref 形态）**同一套机制**，不另造：
   * 差别只在触发条件（等用户 vs 等自己）与落的终态（CANCELLED vs FAILED+诚实答案）。
   */
  private readonly executing = new Map<string, ExecutionWatchdogState>();
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
    if (!(await this.deps.features.isEnabled(auth.tenantId, "shell.query-dock", auth))) {
      throw new HttpError(404, "FEATURE_NOT_FOUND", "not found");
    }
    // OC7 / #92 · 硬线耗尽拒新任务（暗发·关则只记账不拦）。放在 entitlement 之后、建任务之前：
    // 预算是"能不能再花钱"，不是"这个功能存不存在"——不得抢在 R3 的 404 前面改变功能可见性。
    // 账本不可用 → status() 返 undefined → 视为无约束（fail-open：一次 DataCore 抖动不该让用户不能提问）。
    if (llmBudgetEnforceEnabled(await this.deps.features.enabledSet(auth.tenantId, auth))) {
      const st = await this.deps.llmBudget.status(auth.tenantId);
      if (st?.state === "HARD_EXCEEDED") {
        throw new HttpError(
          429,
          ErrorCodes.LLM_BUDGET_EXCEEDED,
          `本租户 LLM token 配额已耗尽（已用 ${st.usedTokens} / 硬线 ${st.hardLimitTokens}）——请联系管理员调整配额或等待下个计费周期`,
        );
      }
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
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth);
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
        // WO-SCENARIO-FORCED-EXTRACT：forced 分支同样解析自由文本——此前 extracted 恒 {}，而 fillSlots 内建
        // 「extracted > presetSlots」优先级（slots.ts），等于解析器被传空参：卡输入框/CLI/对话坞直打 /api/v1/queries
        // 带 presetSlots 时自由文本被吞（「常州基地能不能接」与「能不能接」同答案·都是全网合计）。
        // 守卫 forcedKey === "capacity_feasibility"：parseCapacityFeasibilityVariant 是产能专用解析器，
        // 无条件套任意 forced 意图是错分层；其他场景卡 extracted 仍 {} → 逐字节不变。
        const variant = forcedKey === "capacity_feasibility" ? parseCapacityFeasibilityVariant(task.query) : undefined;
        const extracted: Record<string, unknown> = {};
        if (variant?.modelId) extracted.model = variant.modelId; // `model` 为 objectRef 槽（bare string 经 ontology 解析）
        if (variant?.demandDelta !== undefined) extracted.demandDelta = variant.demandDelta;
        if (variant?.weeks !== undefined) extracted.weeks = variant.weeks;
        if (variant?.baseId) extracted.base = variant.baseId; // 基地作用域（缺省 → 全网合计·scope:ALL 诚实标）
        const probe = await fillSlots(forced, extracted, task.context, this.deps.engine.deps.dataCore.ontology, auth);
        if (probe.missing.length === 0) {
          await this.deps.repos.tasks.patch(taskId, {
            classification: { candidates: [{ intentKey: forced.key, confidence: 1 }], outOfCatalog: false, extractedSlots: extracted, latencyMs: 0, model: "deterministic:scenario-bind" },
          });
          await this.proceedWithIntent(taskId, auth, forced, extracted);
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
    // ★ WO-QOS-CROSS-DOMAIN-UNIFIED · ②确定性多域分路（把跨域题留在确定性层·零 LLM）——**排在 Coordinator 门之前**（治 Q2 5min）。
    // Q2 铁证：`orchestrator` 的 Coordinator 门在 domainResolve 之前开火，Q2 三角色关键词共现（长协/涂布/良率）被 Coordinator
    // 先抢走 → 扇出 3 角色 agent 烧 300s 无结论。**先试 ②**：`domainResolveMulti`（逐域枚举·扩域覆盖 Q2·R6 纯函数·去 −0.4 跨域惩罚）
    // → `selectDeterministicMultiRoute`（≥2 域各够格 + 各有金库 solver + **槽可填硬门**·任一不够格整体回落·诚实边界）→
    // `runParallelRoutes` **并行** solver + **零 LLM 块装配**（每域独立 ⟦ref⟧·耦合诚实标）·秒级。**② 命中就走 ②·根本不进 Coordinator。**
    // **暗发默认关**（deterministicMultiEnabled("ALL")=false → 既有管线逐字节不变·SEAM-6 零回归·含 Coordinator 行为不变）；命中即 return
    //（agentRequests=0·无 classify），未命中（<2 域 / 任一域不够格 / 槽填不满）→ null → 照落下方 Coordinator / 单域 / free-LLM / classifier（fail-safe）。
    if (deterministicMultiEnabled(enabledFeatures)) {
      const multiRoutes = selectDeterministicMultiRoute(domainResolveMulti(task.query, task.context.pageContext));
      if (multiRoutes) {
        await this.runMultiRoute(taskId, auth, multiRoutes, "deterministic-multi-domain", { query: task.query, enabledFeatures });
        return;
      }
    }

    // ★ WO-COORD-YIELD-AND-TERMINAL · D1【门序变更·闭 G-COORD-PHRASE-HIJACK】跨域 Coordinator 门**已从此处移到 classify 之后**
    //   （见下方 `maybeRunCoordinator` 调用点 + 方法长注释）。此处只留这条路标，防第三次有人把它挪回来。
    //   病根：Coordinator 的触发判据是「问句里有没有多角色关键词」，而不是「确定性层/分类器能不能直接答」——摆在分类器
    //   **之前**，等于在"还没人试过能不能好好答"的时候就抢走了题。实测同义句对：
    //     「常州工厂 交期风险波及哪些在手单」→ planCoordination 非 null → 三角会诊 → 永久 EXECUTING_AGENT；
    //     「常州这边有哪些单要被拖累」      → planCoordination null   → 12s COMPLETED（affected_orders 确定性路）。
    //   换个说法就死机 = **同义问句被不同判据对待**。前两次的修法都是「在它前面再加一道让位」（S01 直路 / ②确定性多路），
    //   而单域够格的题正是从②的「≥2 域」门槛下面漏过去的 —— 继续往前加让位 = 打补丁，第三次还会漏。
    //   根治 = 让 Coordinator 降级为**兜底**：判断"有没有 solver 锚"的权威是确定性路由 + 分类器，不是关键词表。

    // ★ WO-OPTWHATIF-NL-WIRING · 结构化优化 what-if 暗发门（闭 §8 G-WHATIF-NL-UNREACHABLE）——**排在 L3 耦合检测(②)之后·
    //   与 generic_inference/capacity_forecast 同层**（置于 WO-QOS-1 A 门之前）。判据与 ②(耦合依赖对) **不同不劫持**：
    //   opt_whatif = 优化决策族词 ∧ 可抽取「目标参数+数值」∧（选中决策对象 或 问句点名）——单命名决策+值（非耦合对）。
    //   命中 + flag 开 → path-A `optimize_whatif`（OBO 真打 datacore invoke·据 selection 从已发布本体真装配基线 + 真扰动重解·
    //   model=deterministic:opt-whatif·classify=0·agentRequests=0）。**暗发默认关**（optWhatifRouteEnabled("ALL")=false →
    //   既有管线逐字节不变·不劫持）；未命中/诚实落回 → 照落下方（A 门对 optimize_whatif route 加 guard 跳过·避免被 decision_play 劫持·落 path-B）。
    if (optWhatifRouteEnabled(enabledFeatures)) {
      const optRoute = resolveOptWhatifRoute(task.query, task.context.selectedObjects ?? [], task.context.pageContext);
      if (optRoute.applicable) {
        await this.runOptWhatifRoute(taskId, auth, optRoute);
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
    // WO-OPTWHATIF-NL-WIRING · guard：optimize_whatif route 无对口 CEO 意图（tryDeterministicBind 会 fall to resolveCeoRoute
    // 误绑 decision_play）。故 A 门对 optimize_whatif route **跳过**——flag 开时上方暗发门已接走；flag 关时诚实落 path-B
    //（不被 decision_play 劫持成"自信错答"·SEAM④ 字节兼容：暗发关→同问句落 path-B·无 optimize_whatif 路由）。
    if (det.route !== "optimize_whatif" && det.confidence >= DETERMINISTIC_PREFERENCE_THRESHOLD && det.solverKey) {
      if (await this.tryDeterministicBind(taskId, auth, task, candidates)) return;
    }

    // ★ WO-L2-DECOMPOSE · L2 多意图**真分解**门（**排在 free-LLM `runCeoFreeLLM` 之前**·治病根：novel 措辞
    //   「接不接得住」不含"产能"字面 → ②域族/⑤候选都漏意图 → 落 free-LLM 的**长度门**（q.length≥24）被 agent:ceo-free-llm
    //   慢路接走·绕过确定性 solver。**长≠开放**——这题其实高度确定）。触发面 = 与 free-LLM 同一 `shouldUseFreeLLM` 群体
    //   （复合/长问句·上下文丰富）·但**先试真分解**：LLM 产一份 solver 执行计划 → 逐条确定性验真（solverKey 已注册 +
    //   必填槽可从共享 slotBag/pageContext 抽满 + 无 scope 冲突）→ 命中(≥1)即接 canonical `runParallelRoutes`（复用后半·
    //   零 LLM 块装配·⟦ref⟧ 溯源）；一条都映射不到 solver（真开放）→ 落下方 free-LLM（不劫持）。命中即 return。
    //   **暗发默认关**（l2DecomposeEnabled("ALL")=false → 既有 free-LLM 长度门逐字节不变·SEAM-零回归·不劫持）。
    // ★ WO-DELIVER-VERB-SEAM · **定式题不是开放深问**（治「说『交付』永远答不出」的第二道门）。
    //   `shouldUseFreeLLM` 的开放性判据里有一条**纯长度门**（q.length ≥ 24·见 ceo-route.ts），而中文里把话说清楚
    //   （补上基地/型号/动词）天然更长——于是「说得越具体 → 越被判为开放深问 → 越绕开确定性求解器」，因果正好反了。
    //   仓主实测原句 27 字即栽在此门（Coordinator 那道修好后它就露出来接盘）。**长≠开放**：带「型号+增量%+周数」
    //   结构签名的产能可行性题高度确定、有唯一对口 solver（capacity_forecast），两道慢路（L2 真分解 / free-LLM
    //   自由多跳）**都让位**，落下方确定性绑定/分类器——真 Kimi 实测该类问句分类命中 capacity_feasibility@0.95 且四槽全对。
    const feasibilityFormula = isCapacityFeasibilityQuery(task.query, task.context.pageContext);

    if (!feasibilityFormula && l2DecomposeEnabled(enabledFeatures) && shouldUseFreeLLM(task.query, task.context.pageContext)) {
      if (await this.tryL2Decompose(taskId, auth, task, pkg)) return;
    }

    // WO-REAL-LLM-FREE-QUERY（CEO/块级真 LLM 深问·确定性路由之外并列拦截·未被 Coordinator 显式指派时的开放式深问缺省增强）。
    if (!feasibilityFormula && freeLlmEnabled(enabledFeatures) && shouldUseFreeLLM(task.query, task.context.pageContext)) {
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
      // ⛔ 此前这里记的是 `pkg.classifierModel ?? config.QOS_CLASSIFIER_MODEL` —— **配置默认值**，
      //    而不是刚才真正尝试并失败的那个模型。于是审计里出现一个从没被调用过的模型名
      //    （实测：租户绑了 kimi，classify 因模型名不存在而失败，字段却显示 `claude-haiku-4-5`），
      //    排查的人照它去查一个根本没参与的模型。改为记**真实解析结果**（与 classify() 内同一支 roleModel）。
      const attemptedModel = await this.deps.llmSettings.roleModel(task.tenantId, "classifier", pkg.classifierModel);
      await this.runPathB(taskId, auth, {
        candidates: [],
        outOfCatalog: true,
        extractedSlots: {},
        latencyMs: 0,
        model: attemptedModel,
      });
      return;
    }
    await this.deps.repos.tasks.patch(taskId, { classification });

    // ★ WO-QOS-CROSS-DOMAIN-UNIFIED · ⑤ LLM 多意图兜底（②确定性没覆盖的跨域题·分类器多候选并行·**排在 clarification 之前**·
    //   否则中置信澄清会把多意图逼成单选）。selectMultiIntent（≥2 候选 ≥tauMid + 各有对口 solver + 各槽可填 + 无 solver 冲突）→
    //   接同一份 `runParallelRoutes`（routeSource="llm-multi-intent"）并行·确定性块装配·不反问。未命中 → null → 照走下方 τ 决策/澄清（byte-compat）。
    //   **暗发默认关**（multiIntentEnabled("ALL")=false → 既有单意图/澄清路径逐字节不变·不劫持）。
    if (multiIntentEnabled(enabledFeatures)) {
      const selection = await this.trySelectMultiIntent(task, auth, classification, candidates);
      if (selection) {
        await this.runMultiRoute(taskId, auth, selection.routes, "llm-multi-intent", { query: task.query, enabledFeatures, classification });
        return;
      }
    }

    // ③ τ decision
    const tauHigh = pkg.thresholds?.high ?? this.deps.config.QOS_TAU_HIGH;
    const tauLow = pkg.thresholds?.low ?? this.deps.config.QOS_TAU_LOW;
    const top = classification.candidates[0];

    // ★ WO-COORD-YIELD-AND-TERMINAL · D1【Coordinator 兜底门·新位置】——**必须在 classify 与 ⑤多意图之后、path-B 之前**。
    //   与下面那行 path-B 判据**共用同一个 τ 谓词**（域外 / 无候选 / 最高候选 < tauLow）：Coordinator 从此就是
    //   「path-B 的多角色变体」——同一个入口条件，只是扇出给多个角色而不是一个 agent。分类器能给出够格意图 → 走
    //   path-A 确定性求解器，Coordinator 一步都插不进来（这正是同义句 A/B 被同等对待的机制保证）。
    if (await this.maybeRunCoordinator(taskId, auth, task, classification, enabledFeatures, tauLow)) return;

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
      // WO-SLOT-ENTITY-RESOLVE §6：不再在调用点手搓 SSE payload —— 澄清内容由 requestClarification
      // 构造**一次**（写 task.pendingClarification）再派生出 SSE 载荷，杜绝"task 一套、SSE 另一套"。
      await this.requestClarification(taskId, auth, {
        kind: "INTENT_CHOICE",
        candidates: options,
        slots: {},
        missing: [],
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
   * WO-QOS-CROSS-DOMAIN-UNIFIED · **共享多路出口**（②确定性多域 + ⑤LLM 多意图共用）：并行跑各路 solver（复用 makeExecutor =
   * path-A invoke 通道·**全程不落 runAgentLoop**）+ **零 LLM 块装配**，自行完成 task 收尾（COMPLETED + answer.final）。
   * `routeSource="deterministic-multi-domain"`（②·model=`deterministic:multi-domain`·classify 耗时=0·agentRequests=0·SEAM-Q2/2 头号证据）
   * 或 `"llm-multi-intent"`（⑤·model=`llm-multi-intent`·保留真 classify 留痕）。`multiIntentPlan` 留痕（区分 routeSource·coupledPairs 诚实标）。
   */
  private async runMultiRoute(
    taskId: string,
    auth: RequestAuth,
    routes: DomainRoute[],
    routeSource: MultiIntentPlan["routeSource"],
    // PRD-multi-intent-L2L3 P2 · L3 升格线程（可选）：仅 ②/⑤ 传 `query`+`enabledFeatures` 时判 L3 耦合联合解；
    // 关门 / 无耦合对 / 非组合方案问句 / portfolio 失败 → 照走下方 L1 独立并行（runParallelRoutes·零回归）。
    opts?: {
      query?: string;
      enabledFeatures?: FeatureSet;
      classification?: ClassificationResult;
    },
  ): Promise<void> {
    const isDet = routeSource === "deterministic-multi-domain";
    const prior = isDet ? undefined : (await this.deps.repos.tasks.get(taskId))?.classification;
    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // 复用硬预算站点（env 未设→宽松 DEFAULT 不变）
    const executor = this.deps.engine.makeExecutor(taskId, auth, budget);
    const coupledPairs = detectCoupledPairs(routes);

    await this.enterExecuting(taskId, { status: "EXECUTING_WORKFLOW", path: "WORKFLOW" }, "多路并行求解"); // D2 · 进门即挂终态看门狗
    this.deps.metrics.recordRouting(true);
    await this.deps.events.emit(taskId, "routing.completed", {
      path: "WORKFLOW",
      note: `${isDet ? "确定性多域分路" : routeSource === "llm-l2-decompose" ? "L2 真分解并行" : "LLM 多意图并行"}（零 LLM 装配·${routes.length} 路${coupledPairs.length > 0 ? `·耦合 ${coupledPairs.length} 对诚实标` : "·纯独立"}）`,
    });

    const emit = (e: string, p: unknown) => this.deps.events.emit(taskId, e, p).then(() => undefined);
    // ★ PRD-multi-intent-L2L3 P2 · L3 升格（暗发 qos.multi-intent-l3-coupled）：选中集含依赖对（SOLVER_DEP_GRAPH
    //   从"标注"升级为"路由信号"）∧ 问句是「给组合方案/连锁传导」型 → **不走 L1 独立并行**·改一次 portfolio 联合解
    //  （守恒内真传导·真残差喂外协·近似环诚实标）。portfolio 失败/关门 → 照走 L1（独立并行 + 耦合诚实标·零回归）。
    if (
      opts?.enabledFeatures !== undefined &&
      l3CoupledEnabled(opts.enabledFeatures) &&
      coupledPairs.length > 0 &&
      isCombinationAsk(opts?.query ?? "")
    ) {
      const l3 = await runL3CoupledPath(opts?.query ?? "", routes, coupledPairs, { executor, emit });
      if (l3.ok) {
        if (this.cancelled.has(taskId)) {
          await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
          await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
          this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "CANCELLED" });
          return;
        }
        const classification: ClassificationResult = opts?.classification ?? {
          candidates: routes.slice(0, 3).map((r) => ({ intentKey: r.domain, confidence: r.perDomainScore })),
          outOfCatalog: false,
          extractedSlots: {},
          latencyMs: 0,
          model: "deterministic:multi-domain",
        };
        await this.deps.repos.tasks.patch(taskId, {
          status: "COMPLETED",
          classification,
          answer: l3.answer,
          multiIntentPlan: l3.plan,
          completedAt: new Date().toISOString(),
        });
        await this.deps.events.emit(taskId, "answer.final", l3.answer);
        this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "COMPLETED" });
        await this.recordExperience(taskId);
        return;
      }
      // portfolio 失败 → fail-open 落 L1 独立并行（下方·不塌）。
    }

    const { answer, plan } = await runParallelRoutes(routes, coupledPairs, { executor, emit }, routeSource);

    if (this.cancelled.has(taskId)) {
      await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: "user cancelled" });
      this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "CANCELLED" });
      return;
    }

    const classification: ClassificationResult = isDet
      ? {
          candidates: routes.slice(0, 3).map((r) => ({ intentKey: r.domain, confidence: r.perDomainScore })),
          outOfCatalog: false,
          extractedSlots: {},
          latencyMs: 0, // 零 LLM classify（②头号证据·SEAM-Q2/2：确定性接住·分类耗时=0）
          model: "deterministic:multi-domain",
        }
      : {
          // ⑤：保留真 classify 候选/耗时留痕（分类器已跑）·model=llm-multi-intent。
          // L2（llm-l2-decompose·free-LLM 门前·**未经** classify）：prior 恒 undefined → 候选回退 routes·latencyMs=0·model=llm-l2-decompose。
          candidates: (prior?.candidates ?? routes.slice(0, 3).map((r) => ({ intentKey: r.domain, confidence: r.perDomainScore }))),
          outOfCatalog: false,
          extractedSlots: prior?.extractedSlots ?? {},
          latencyMs: prior?.latencyMs ?? 0,
          model: routeSource === "llm-l2-decompose" ? "llm-l2-decompose" : "llm-multi-intent",
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
   * WO-OPTWHATIF-NL-WIRING · 结构化优化 what-if 专属 path-A 出口（闭 §8 G-WHATIF-NL-UNREACHABLE）：
   * 复用 path-A invoke 通道（makeExecutor → `invoke_solver("optimize_whatif", {family, selection, autoBind:true, perturbations})`）
   * **全程不落 runAgentLoop/classify**；OBO 真打 datacore invoke（据 selection 从已发布本体真装配基线 + 真扰动重解）→
   * 装配「最优决策方案切换」答案（baselineSolution→perturbedSolution + Δ目标 + 可行性/冲突约束 + 每业务数字 ⟦ref:0⟧ 溯源）。
   * model=`deterministic:opt-whatif`·classify=0·agentRequests=0（SEAM 头号证据）。
   * 诚实边界：invoke 失败（如 opt.whatif 未开→404 FEATURE_NOT_FOUND）或装配报缺（applicable:false·role 支撑属性不存在）
   * → 落回 path-B（不伪造系数/方案·KILL-MOCK）。
   */
  private async runOptWhatifRoute(taskId: string, auth: RequestAuth, route: Extract<OptWhatifRoute, { applicable: true }>): Promise<void> {
    const budget = new BudgetTracker(this.residualBudgetFromConfig());
    const executor = this.deps.engine.makeExecutor(taskId, auth, budget);
    await this.enterExecuting(taskId, { status: "EXECUTING_WORKFLOW", path: "WORKFLOW" }, "优化 what-if 重解"); // D2 · 进门即挂终态看门狗
    this.deps.metrics.recordRouting(true);
    await this.deps.events.emit(taskId, "routing.completed", {
      path: "WORKFLOW",
      note: `优化目标级 what-if（确定性路由·零 LLM）：${route.family}·扰动 ${route.perturbations.length} 条 → CP-SAT 重解`,
    });

    const args = { family: route.family, selection: route.selection, autoBind: true, perturbations: route.perturbations };
    await this.deps.events.emit(taskId, "step.completed", {
      stepId: newId("optwhatif-invoke"), type: "opt_whatif_invoke",
      outcome: `invoke_solver optimize_whatif（${route.family}·selection ${route.selection.length}·扰动 ${route.perturbations.map((p) => `${p.target}=${p.value}`).join("、")}）`,
      durationMs: 0,
    });
    const run = await executor.run("invoke_solver", { solverKey: "optimize_whatif", args });
    const { data, snapshotVersion } = extractOptWhatifData(run.payload);

    // 诚实边界：invoke 失败 / 装配报缺（applicable:false）→ 落回 path-B（不伪造·KILL-MOCK）。
    if (!run.ok || !data || data.applicable === false) {
      await this.deps.events.emit(taskId, "routing.degraded", {
        reason: !run.ok ? `optimize_whatif 未接入/被门（${run.outcome}）` : `装配报缺（缺角色支撑：${(data?.missingRoles ?? []).join("、") || "—"}）`,
        fallback: "path-B",
      });
      await this.runPathB(taskId, auth, { candidates: [], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "agent:opt-whatif-fallback" });
      return;
    }

    const answer = assembleOptWhatifAnswer(route, data, run.toolCallId, snapshotVersion);
    const classification: ClassificationResult = {
      candidates: [{ intentKey: "opt_whatif", confidence: 1 }],
      outOfCatalog: false,
      extractedSlots: args,
      latencyMs: 0, // 零 LLM classify（SEAM 头号证据）
      model: "deterministic:opt-whatif",
    };
    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      classification,
      answer,
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "COMPLETED" });
    await this.recordExperience(taskId);
  }

  /**
   * WO-QOS-CROSS-DOMAIN-UNIFIED · ⑤ 判定的 IO 胶水（把纯判定 `selectMultiIntent` 需要的 solverKey/args/槽可填**在此解析**·保判定纯 R6）：
   * 逐候选（≥tauMid·在候选目录内）→ 解析对口 solverKey（从意图 plan 的首个 invoke_solver 步）+ fillSlots（extractedSlots⊕上下文·
   * missing.length===0 = 槽可填）→ 交 `selectMultiIntent`（≥2 · 无 solver 冲突 · 截 maxIntents）。env：QOS_MULTI_INTENT_TAU_MID(0.80)/_MAX_INTENTS(4)。
   */
  private async trySelectMultiIntent(
    task: QueryTask,
    auth: RequestAuth,
    classification: ClassificationResult,
    candidates: IntentDefinition[],
  ): Promise<MultiIntentSelection | null> {
    const tauMid = Number(process.env.QOS_MULTI_INTENT_TAU_MID ?? 0.8);
    const maxIntents = Number(process.env.QOS_MULTI_INTENT_MAX_INTENTS ?? 4);
    const resolved: MultiIntentCandidate[] = [];
    for (const cand of classification.candidates) {
      if (cand.confidence < tauMid) continue;
      const intent = candidates.find((c) => c.key === cand.intentKey);
      if (!intent) continue;
      const solverKey = await this.solverKeyForIntent(intent);
      // ★ WO-SLOT-HARVEST · 确定性槽位底座（**接线点之二 · ⑤ LLM 多意图**）。这条路自己调 fillSlots 判
      //   "槽可填"，不经 proceedWithIntent —— 只接主路 = 又一次「接错地方」（多意图题照样被 LLM 抖动打掉）。
      // #108：底座**原值**另传一份 —— 预合并只能填空白，填不了「LLM 给了但用不了」那一格。
      const floor5 = deterministicSlotFloor(task.query, intent);
      const { slots, missing } = await fillSlots(
        intent,
        mergeSlotFloor(floor5, classification.extractedSlots),
        task.context,
        this.deps.engine.deps.dataCore.ontology,
        auth,
        floor5,
      );
      resolved.push({ intentKey: intent.key, confidence: cand.confidence, solverKey, args: slots, slotsFillable: missing.length === 0 });
    }
    return selectMultiIntent(resolved, { tauMid, maxIntents });
  }

  /** 意图 → 对口 solver 真名（从其 plan 的首个 invoke_solver 步取·无 plan/无 solver 步 → undefined·该候选不入⑤）。 */
  private async solverKeyForIntent(intent: IntentDefinition): Promise<string | undefined> {
    const resolution = await resolvePlanForIntent(this.deps.repos, intent);
    if (!resolution) return undefined;
    for (const step of resolution.plan.steps) {
      if (step.type === "invoke_solver") return step.params.solverKey;
    }
    return undefined;
  }

  /**
   * WO-L2-DECOMPOSE · L2 真分解（free-LLM 门前·治 novel 措辞被长度门劫持）：**LLM 只做分解/选型**——`compose` 产一份
   * solver 执行计划 → `parseSolverPlan` 解析 → `validateSolverPlan` **逐条确定性验真**（solverKey 已注册 + 必填槽可从
   * **确定性 slotBag**（`buildSlotBag`·非 LLM 数值·KILL-MOCK-RED）抽满 + 无 scope 冲突）→ 命中(≥1)即接**共享后半**
   * `runMultiRoute`（复用 `runParallelRoutes`·并行 solver + 零 LLM 块装配·⟦ref⟧ 溯源）·model=`llm-l2-decompose`。
   *
   * 命中并接住 → `true`（调用方 return）；一条都验不过 / LLM 不可用（无 provider/异常）/ 计划空 → `false`
   *（照落下方 free-LLM·**不劫持**·诚实：真开放题就该走自由推理）。LLM 失败**吞掉**（fail-open 到 free-LLM·再由其兜底）。
   */
  private async tryL2Decompose(taskId: string, auth: RequestAuth, task: QueryTask, pkg: ScenarioPackage): Promise<boolean> {
    // L2 是**结构化分解/选型**（非推理·非算数·§3 D-模型分层）→ 用 classifier 档（可经 QOS_L2_DECOMPOSE_MODEL 覆写）。
    const explicit = this.deps.config.QOS_L2_DECOMPOSE_MODEL ?? pkg.classifierModel;
    let raw: string;
    try {
      const model = await this.deps.llmSettings.roleModel(task.tenantId, "classifier", explicit);
      const { instruction, inputs } = buildL2Prompt(task.query, task.context.pageContext);
      raw = await this.deps.engine.deps.llm.compose({ model, instruction, inputs, tenantId: task.tenantId });
    } catch {
      return false; // 真 LLM 不可用（无 provider/异常）→ 落 free-LLM（不劫持·诚实降级）
    }

    const entries = parseSolverPlan(raw);
    if (entries.length === 0) return false;
    const slotBag = buildSlotBag(task.query, task.context.pageContext);
    const { routes, rejected } = validateSolverPlan(entries, slotBag);
    if (routes.length === 0) return false; // 一条都映射不到 solver（真开放）→ 落 free-LLM

    // 诊断留痕（复用 step.completed 伪 step·**不新增 §8.2 事件名**·保 ontology:check 51/51）。
    await this.deps.events.emit(taskId, "step.completed", {
      stepId: newId("l2-decompose"),
      type: "l2_decompose_plan",
      outcome:
        `L2 真分解命中：${routes.map((r) => r.solverKey).join("、")}` +
        (rejected.length > 0 ? `｜丢弃 ${rejected.map((x) => `${x.solverKey}(${x.reason})`).join("、")}` : ""),
      durationMs: 0,
    });

    await this.runMultiRoute(taskId, auth, routes, "llm-l2-decompose");
    return true;
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
      /** WO-SLOT-ENTITY-RESOLVE：按槽名的解析候选（域外/歧义时"您是不是指…"），进 task + SSE 同一份。 */
      slotCandidates?: Record<string, { objectType: string; objectId: string; label: string }[]>;
    },
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    const round = task.clarificationRounds + 1;
    /**
     * WO-SLOT-ENTITY-RESOLVE §6 · 待澄清内容**构造一次，两处同源**：写进 task.pendingClarification
     * ＋ 原样进 SSE `clarification.required`。此前只发 SSE ⇒ 轮询型客户端（CLI/批量脚本）不知道要补什么，
     * 只能干等到 10 分钟超时（实测批量测试卡死 150s）—— 那是 API 契约的洞，不是前端问题。
     */
    const pendingClarification: PendingClarification = {
      kind: opts.kind,
      round,
      askedAt: new Date().toISOString(),
      ...(opts.kind === "SLOT_FILLING"
        ? {
            slots: opts.missing.map((s) => ({
              name: s.name,
              type: s.type,
              prompt: clarifyPromptFor(s),
              // 解析失败/歧义时把候选一并给出（"您是不是指…"）——同源自槽位填充的解析诊断。
              ...(opts.slotCandidates?.[s.name]?.length ? { candidates: opts.slotCandidates[s.name]! } : {}),
            })),
          }
        : {}),
      ...(opts.kind === "INTENT_CHOICE" && opts.candidates
        ? { intents: opts.candidates.map((c) => ({ intentKey: c.key, name: c.name, description: c.description })) }
        : {}),
    };
    await this.deps.repos.tasks.patch(taskId, { status: "AWAITING_CLARIFICATION", clarificationRounds: round, pendingClarification });
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

    // SSE 载荷**派生自**上面那一份 pendingClarification（同源·不重算）；线上形状保持向后兼容
    // （SLOT_FILLING → slots[] · INTENT_CHOICE → options[] 且末尾追加"都不是"这个纯 UI 选项）。
    await this.deps.events.emit(taskId, "clarification.required", {
      kind: pendingClarification.kind,
      round,
      ...(pendingClarification.slots ? { slots: pendingClarification.slots } : {}),
      ...(pendingClarification.intents
        ? { options: [...pendingClarification.intents, { intentKey: null, name: "都不是", description: "以上都不是我想问的" }] }
        : {}),
    });
  }

  private async cancelForTimeout(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    await this.deps.repos.tasks.patch(taskId, { status: "CANCELLED", completedAt: new Date().toISOString() });
    await this.deps.events.emit(taskId, "task.cancelled", { reason: "clarification timeout (10min)" });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ★ WO-COORD-YIELD-AND-TERMINAL · D2 · 终态看门狗（闭 §8 `G-TASK-NO-TERMINAL`）
  //
  // 病根一句话：**状态机允许进入 `EXECUTING_*` 而不保证有人负责把它带出去。**
  //  （`AWAITING_CLARIFICATION` 一直是有看门狗的——`CLARIFICATION_TIMEOUT_MS` + `cancelForTimeout`；
  //   `EXECUTING_AGENT` / `EXECUTING_WORKFLOW` 没有 → 可永久悬挂：实测 19 分钟无 `completedAt`、
  //   token 冻结、CPU 0.5%、日志里 `level>=40` 一条都没有 —— 错误被完全吞掉。）
  //
  // 为什么**不是**"在每个分支各加一个 try/catch"：那是打补丁，下次新加一条执行分支又会漏（本仓已反复吃这个亏）。
  // 这里把责任挂在**状态转移**上：`enterExecuting` 是进入非终态执行中状态的**唯一**入口，进门即挂看门狗。
  // 新增一条执行分支时，你要么走 `enterExecuting`（自动有终态责任人），要么就得手写
  // `repos.tasks.patch({status:"EXECUTING_*"})`——后者在 review 里一眼可见，是可守的边界。
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 进入「非终态执行中」状态的**唯一**入口：置状态 + 同时挂终态看门狗（不变量 R19）。
   * @param phase 人话阶段名——中止答案里会原样引用它（"三角色会诊在 Ns 内未收敛"）。
   */
  private async enterExecuting(
    taskId: string,
    patch: { status: "EXECUTING_AGENT" | "EXECUTING_WORKFLOW"; path: "AGENT" | "WORKFLOW" },
    phase: string,
  ): Promise<void> {
    await this.deps.repos.tasks.patch(taskId, patch);
    this.armTerminalWatchdog(taskId, phase);
  }

  /** 挂/重挂看门狗（复用 `requestClarification` 那套 `setTimeout` + `timer.unref?.()` 形态·不另造机制）。 */
  private armTerminalWatchdog(taskId: string, phase: string): void {
    const prev = this.executing.get(taskId);
    if (prev) clearTimeout(prev.timer); // 同一 task 转阶段（如 rung② 由 path-B 重路由到 Coordinator）→ 重置计时，不叠加
    const timer = setTimeout(() => {
      void this.forceTerminalOnTimeout(taskId).catch((err) => {
        // 看门狗自身出错也不许静默——否则又回到"错误被完全吞掉"的老路。
        this.logSwallowed(taskId, "terminal-watchdog", err);
      });
    }, taskTerminalTimeoutMs());
    timer.unref?.();
    this.executing.set(taskId, { timer, startedAt: Date.now(), phase });
  }

  /** 解除看门狗（任务已落终态时调用；未调用也不会出错——回调本身对终态是 no-op·见下）。 */
  private disarmTerminalWatchdog(taskId: string): void {
    const w = this.executing.get(taskId);
    if (!w) return;
    clearTimeout(w.timer);
    this.executing.delete(taskId);
  }

  /**
   * 看门狗到点：**权威判据是任务的真实状态，不是簿记**——已落终态 → no-op（所以"忘了 disarm"不会误伤，
   * 这条比"每个终态出口都记得调 disarm"结实得多）。仍非终态 → 强制落终态 + **说真话的**答案。
   *
   * 答案铁律（本仓刚因「一句诊断盖所有病」返过工·`execute-plan.ts` 裸 catch 把四种失败说成"未接入 LLM provider"）：
   * 必须讲清 ①哪个阶段 ②卡了多少秒 ③**已经跑完的角色/步骤**。不许笼统 INTERNAL_ERROR，不许空答案。
   */
  private async forceTerminalOnTimeout(taskId: string): Promise<void> {
    const w = this.executing.get(taskId);
    this.executing.delete(taskId);
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return; // 已有人负责落终态 → 看门狗闭嘴

    const elapsedMs = w ? Date.now() - w.startedAt : taskTerminalTimeoutMs();
    const elapsedS = Math.max(1, Math.round(elapsedMs / 1000));
    const phase = w?.phase ?? "本次推演";
    const progress = await this.describeStalledProgress(taskId);

    // 让还在跑的循环在下一个边界自行退出（复用既有取消旗标·不新起中断机制）。
    this.cancelled.add(taskId);

    const roleNote =
      progress.roles.length > 0
        ? `${progress.roles.length} 角色会诊（${progress.roles.join("/")}）`
        : phase;
    const doneNote =
      progress.done.length > 0
        ? `中止前已完成：${progress.done.join("；")}。`
        : "中止前**没有任何一个子步骤跑完** —— 卡点在第一步之前，最常见成因是某次 LLM 调用没有返回（既非报错也非超时，只是不回）。";
    const answer: Answer = {
      trustLevel: "AGENT_EXPLORATORY",
      unverifiedNumerics: false,
      provenance: [],
      blocks: [
        {
          type: "text",
          markdown:
            `**${roleNote}在 ${elapsedS}s 内未收敛，已中止。**\n\n` +
            `${doneNote}\n\n` +
            `这不是"算不出来"，是这条路径超过了 ${Math.max(1, Math.round(taskTerminalTimeoutMs() / 1000))}s 的作答上限 —— ` +
            `与其让你继续等，不如如实告诉你它停在哪。\n\n` +
            `**你现在可以**：把问题问得更具体（点名基地 / 型号 / 时间窗），走确定性求解器通常十几秒就有答案；` +
            `或把问题拆小后分别提问。`,
        },
      ],
    };
    await this.deps.repos.tasks.patch(taskId, { answer });
    await this.deps.events.emit(taskId, "answer.final", answer);
    // 计数复用 `failTask` 里既有的 `tasksTotal{status:FAILED}`（`metrics.ts` 不在本单 🚦范围内 → 不新增计数器）。
    // 「错误被完全吞掉，一个字都没留」是本条断点的一半 —— 落终态必留一条 level>=40。
    this.logSwallowed(
      taskId,
      "terminal-watchdog",
      new Error(`task stuck in ${task.status} for ${elapsedS}s (phase=${phase}, doneSteps=${progress.done.length}) — forced to FAILED`),
    );
    // 复用既有 `failTask` 落终态（answer 已先写入 → 其"路径 B 无答案则补 gap 块"分支不会覆盖这份诚实答案）。
    await this.failTask(
      taskId,
      "TASK_TERMINAL_TIMEOUT",
      `${roleNote}在 ${elapsedS}s 内未收敛，已中止（阶段 ${phase}·已完成 ${progress.done.length} 步）`,
    );
  }

  /**
   * 从**既有事件流**还原"跑到哪了"（不新建簿记：事件本来就是这条任务的过程真相）。
   * `coordinator.planned` → 参与角色；`step.completed` 的 `dispatch_i` → 已答完的角色；其余 step → 步骤名。
   */
  private async describeStalledProgress(taskId: string): Promise<{ roles: string[]; done: string[] }> {
    let events: { seq: number; event: string; payload: unknown }[] = [];
    try {
      events = await this.deps.repos.events.listAfter(taskId, 0);
    } catch (err) {
      this.logSwallowed(taskId, "describeStalledProgress", err);
      return { roles: [], done: [] };
    }
    const planned = events.find((e) => e.event === "coordinator.planned")?.payload as
      | { dispatches?: { role?: string }[] }
      | undefined;
    const dispatchRoles = (planned?.dispatches ?? []).map((d) => d.role ?? "");
    const roles = dispatchRoles.map((r) => ROLE_LABELS[r] ?? r).filter(Boolean);

    const done: string[] = [];
    for (const e of events) {
      if (e.event !== "step.completed") continue;
      const p = e.payload as { stepId?: string; type?: string } | undefined;
      const stepId = p?.stepId ?? "";
      const m = /^dispatch_(\d+)$/.exec(stepId);
      if (m) {
        const idx = Number(m[1]);
        const role = dispatchRoles[idx];
        done.push(`${ROLE_LABELS[role ?? ""] ?? role ?? stepId} 已作答`);
      } else if (stepId && p?.type !== "agent_narration") {
        done.push(stepId);
      }
    }
    return { roles, done };
  }

  /**
   * 吞异常必留痕（WO §2-4）：Coordinator 扇出等路径上任何被 `catch {}` 咽下去的异常，至少落一条 **level>=40**。
   * 现状是 0 条 —— 那本身就是缺陷（"日志里就写着，却被假绿盖过去"的反面：这次是连写都没写）。
   * Orchestrator 没有注入 logger（`OrchestratorDeps` 无该字段，且 `config.ts` 不在本单 🚦范围内），
   * 故走 `console.error` 并**手工带上 `level:50`**，使部署态 `level>=40` 的日志检索能捞到它（形态与 dril/resource-registry.ts 的 console.warn 同源）。
   */
  private logSwallowed(taskId: string, where: string, err: unknown): void {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({ level: 50, module: "orchestrator", where, taskId, msg, ...(err instanceof Error && err.stack ? { stack: err.stack } : {}) }),
    );
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
    pending: PendingClarificationState,
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

    // ★ WO-SLOT-HARVEST · 确定性槽位底座（**接线点之一 · 主路**）——插在 fillSlots 之前、LLM 之下。
    //   病根是铁律 0.5 第三形态「接了线接错地方」：确定性抽取器早就有（buildSlotBag），但只接在 L2 分解，
    //   主链路 classify→fillSlots **没有任何东西在看问句文本** → 一次 LLM 格式抖动就决定用户拿不拿得到答案。
    //   底座只填空白（冲突时 LLM 赢）、只抽问句里真有的（R6 纯函数）。本方法是**所有** path-A 绑定的必经之路
    //   （主路高置信 / 确定性 block-route·ceo-route / 场景绑定·继承 / 澄清回填），一处接线全路径覆盖。
    //   #108 增补：底座**原值**另传一份给 fillSlots —— 预合并只填空白，填不了「LLM 给了但用不了」
    //   那一格（真 Kimi 实测：LLM 的「常州工厂」顶掉底座的 changzhou，而前者解析不到 → 反问）。
    const floor = deterministicSlotFloor(task.query, intent);
    const effectiveExtracted = mergeSlotFloor(floor, extracted);

    const { slots, missing, outOfDomain, resolutions } = await fillSlots(
      intent,
      effectiveExtracted,
      task.context,
      this.deps.engine.deps.dataCore.ontology,
      auth,
      floor,
    );
    // A5 感知层埋点：objectRef 解析尝试（分母）+ 域外实体（分子）→ 发独立事件 + 记误触发率。
    const objectRefAttempts = intent.slots.filter(
      (s) => s.type === "objectRef" && effectiveExtracted[s.name] !== undefined && effectiveExtracted[s.name] !== null && effectiveExtracted[s.name] !== "",
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
        // WO-SLOT-ENTITY-RESOLVE：域外/歧义候选随澄清一起落到 task + SSE（"您是不是指…"，同一份）。
        slotCandidates: Object.fromEntries(
          outOfDomain.map((o) => [
            o.slotName,
            (o.resolution?.candidates?.map((c) => ({ objectType: c.objectType, objectId: c.objectId, label: c.label })) ??
              o.candidates.map((c) => ({ objectType: c.objectType, objectId: c.objectId, label: c.label }))).slice(0, 5),
          ]),
        ),
      });
      return;
    }

    await this.deps.repos.tasks.patch(taskId, {
      matchedIntent: { intentId: intent.id, intentKey: intent.key, version: intent.version },
      slots: finalSlots,
      // WO-SLOT-ENTITY-RESOLVE：objectRef 槽解析留痕（"常州"→Base/changzhou·matchedBy=name），R13 可溯源；
      // 同时清空 pendingClarification —— 已经不问了，task 上就不该再挂着"在问什么"。
      ...(resolutions.length ? { slotResolutions: resolutions } : {}),
      pendingClarification: null,
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

    await this.enterExecuting(taskId, { status: "EXECUTING_WORKFLOW", path: "WORKFLOW" }, "工作流执行"); // D2 · 进门即挂终态看门狗
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
    if (result.status === "CANCELLED") {
      await this.deps.repos.tasks.patch(taskId, {
        status: "CANCELLED",
        resolvedRefs: dedupeRefs(resolvedRefs),
        completedAt: new Date().toISOString(),
      });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: result.reason });
      this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "CANCELLED" });
      return;
    }

    // WO-DECISION-KERNEL-WIRE（闭"CEO 深问止步方案·不成决策"脑裂·本体 §3 决策链）：
    // CEO 决策类深问（intent=ceo_decision·由 decision_play/signal 路由映射）出**真方案**后，若问句表达采纳/落地意图
    // → 经 L2 内核 OBO 落一等 Decision(PROPOSED·chosenOptionIds 默认取真推演 recommendedPlan.optionIds)；「立即落地」
    // 意图再 commit → COMMITTED + 派 ActionDraft(S2 DRAFT·审批门不绕)。引擎不改（decision_play 已在上方 workflow 跑完·
    // 此处只据真推演成决策）。透出 decisionId/status/actionDraftIds：SSE(decision.created/committed·已注册) + 答案块。
    // WO-SCENARIO-INPUT-PHASE0 · R13 留痕：path-A 工作流也要把槽位归一化（如天→周）写回答案 validationTrace。
    let answer = await this.maybeMakeDecision(taskId, auth, intent, slots, result.answer, result.stepOutputs);
    const normalizedSlots = slots._normalizedSlots as Record<string, unknown> | undefined;
    if (normalizedSlots) {
      const baseTrace = answer.validationTrace ?? {
        slicesUsed: [],
        consistency: { checks: [], verdict: "ALL_PASS" as const },
        crossValidation: { claims: [], verdict: "NO_CLAIMS" as const },
        generatedAt: new Date().toISOString(),
      };
      answer = { ...answer, validationTrace: { ...baseTrace, normalizedSlots } };
    }

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
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth);
    if (!(await this.deps.features.isEnabled(task.tenantId, "qos.agent-fallback", auth))) {
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

    await this.enterExecuting(taskId, { status: "EXECUTING_AGENT", path: "AGENT" }, "探索模式（单 agent 自由多跳）"); // D2 · 进门即挂终态看门狗
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
    // #90 · 默认自由问答挂载租户技能（暗发·关 = 下面 system/工具集逐字节同旧）。
    // 关键差别与注册 agent 路径：那边 skill 绑在 `agent.skills`，泛化 path-B 没有 agent，
    // 故技能来源是**租户级已发布集**（selectTenantSkills·R6 确定性）；注入量仍由 buildSkillSection
    // 的语义路由收窄（top-k 全文 + 其余降级为 id/名，模型需要时 load_skill 取全文）。
    const skillOnFreeQa = skillOnFreeQaEnabled(enabledFeatures);
    const freeQaSkills = skillOnFreeQa ? selectTenantSkills(await this.deps.repos.skills.listByTenant(task.tenantId)) : [];
    const baseSystem = opts?.systemOverride ?? AGENT_SYSTEM_CORE;
    const systemWithSkills =
      freeQaSkills.length > 0 ? `${baseSystem}${buildSkillSection(freeQaSkills, { query: task.query })}` : baseSystem;

    const result = await runAgentLoop({
      taskId,
      model,
      tenantId: task.tenantId,
      // WO-AGENTRUN-ATTRIBUTION · 通用探索路：**这里没有 AgentDefinition 可归属，而且这不是缺陷** ——
      // 工具集是 `pkg.toolWhitelist ∩ {READ,COMPUTE}` 当场算出来的（见上方 tools 构造），
      // 全程没有任何一版 agent 参与。所以传 `{ tenantId }` 而**不传 agentId**：
      // 引擎据此正面记 `attribution: "EXPLORATORY"`，让「确知没有归属对象」与「上线前的旧记录」
      // 在数据层就分得开。⛔ 绝不许为了让界面好看而在这里就近塞一个 agentId。
      attribution: { tenantId: task.tenantId },
      // WO-AGENTRUN-FANOUT-PERSIST：通用探索路是**这个任务本身**那次循环 ⇒ ROOT。
      // （位置与归属正交：这条既是 ROOT 又是 EXPLORATORY，两个字段各答各的问题。）
      placement: { origin: "ROOT" },
      system: systemWithSkills,
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
      // WO-LOOP-CONTROL-P1：Loop Detector 环检测 cap（opt-in·缺省 undefined → 禁用 → 既有 path-B 逐字节不变）
      loopRepeatCap: this.deps.config.QOS_AGENT_LOOP_REPEAT_CAP,
      // WO-LOOP-CONTROL-P2 · Escalation Ladder 暗发门（agent.escalation·关=停滞直接 degrade·字节兼容·不劫持）
      escalation: escalationEnabled(enabledFeatures),
      // WO-LOOP-CONTROL-P2 · per-tool 调用上界 / Retry Manager（opt-in env·缺省不设 → 不限/不重试 → 既有 path-B 逐字节不变）
      ...(this.deps.config.QOS_AGENT_PER_TOOL_CALL_CAP !== undefined ? { perToolCallCap: this.deps.config.QOS_AGENT_PER_TOOL_CALL_CAP } : {}),
      ...(this.deps.config.QOS_AGENT_RETRY_MAX_ATTEMPTS !== undefined ? { retry: { maxAttempts: this.deps.config.QOS_AGENT_RETRY_MAX_ATTEMPTS } } : {}),
      // #90 · 技能池非空才开 load_skill 工具（空池开了等于给模型一个永远返 undefined 的工具·徒增盲试）。
      ...(freeQaSkills.length > 0
        ? {
            loadSkillEnabled: true,
            loadSkill: async (skillId: string) => {
              // 只允许取**本次已注入清单内**的技能（防模型凭空猜 id 越出租户已发布集）。
              if (!freeQaSkills.some((x) => x.id === skillId)) return undefined;
              const skill = await this.deps.engine.resolveSkill(task.tenantId, skillId, "latest");
              if (!skill) return undefined;
              return {
                body: skill.body,
                resources: skill.resources.map((r) => ({
                  name: r.name,
                  url: `/b/v1/skills/${skill.id}/resources/${encodeURIComponent(r.name)}`,
                  ...(r.mime ? { mime: r.mime } : {}),
                  ...(r.description ? { description: r.description } : {}),
                })),
              };
            },
          }
        : {}),
    });

    await this.deps.repos.agentRuns.insert(result.run);
    // OC7 / #92 · 记账（无条件·best-effort·失败只计数不抛）。这是账本的**唯一真实写入方**：
    // 只有 AgentCore 知道一次 path-B 跑烧了多少 token（result.run 已累计 totalInput/OutputTokens）。
    // 诚实边界：classify()/compose() 的签名不外透 usage，故此处只记 agent 工具循环那部分，**不是全量成本**。
    void this.deps.llmBudget.record(task.tenantId, (result.run.totalInputTokens ?? 0) + (result.run.totalOutputTokens ?? 0));
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

    // ★ WO-LOOP-CONTROL-P2.5 · Escalation Ladder rung②（orchestrator 层升级重路由·收口 P2 诚实延后的 rung②）。
    // 叶子 agent 在 runAgentLoop 造不出扇出（rung② 属 orchestrator/runPathB 层）——P2 只交 rung①（换策略再试一轮）+ rung③（degrade）。
    // 本层补 rung②：单 agent **停滞**（rung① 用尽仍无进展·loop 上抛 result.stalled）→ **反应式重路由到 Coordinator 扇出**
    // 多角色重解 → 再不行才落既有 degrade（rung③ 兜底不删·唯一诚实出口）。三守卫：
    //   ① 一次性（rung② 至多一次·runCoordinator 完成即 return·非递归·G2 防无限重路由）；
    //   ② 防双 Coordinator（usedCoordinator=proactive Coordinator 会接手本题 → 短路·不反应式重入·SEAM ③）；
    //   ③ 暗发（escalationEnabled 关 → 整分支短路 → 停滞直接 degrade·逐字节同 P2·byte-compat）。
    // 预算不绕：rung② 扇出复用 runCoordinator（各角色 agent 同受 residualBudgetFromConfig 硬预算·同 proactive Coordinator）。
    const usedCoordinator =
      coordinatorEnabled(enabledFeatures) &&
      planCoordination(task.query, task.context.pageContext, [], deterministicMultiEnabled(enabledFeatures)) !== undefined;
    if (result.stalled && escalationEnabled(enabledFeatures) && !usedCoordinator) {
      if (await this.maybeRerouteToCoordinator(taskId, auth, task, result)) return; // rung② 成功 → runCoordinator 已 COMPLETED + answer.final
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
    // 综合失败时要能把「真没绑 provider」与「绑了但打不通」分开报（见 execute-plan classifySynthFailure）——
    // 故把真实可用性判定传下去，而不是让下游猜。从不抛（providerAvailable 内部已兜住）。
    const hasLlmProvider = await this.deps.llmSettings.providerAvailable(task.tenantId, "agent", model);
    const result = await executePlan(plan, {
      executor,
      llm: this.deps.engine.deps.llm,
      model,
      tenantId: task.tenantId,
      hasLlmProvider,
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
    await this.enterExecuting(taskId, { status: "EXECUTING_AGENT", path: "AGENT" }, `角色 agent 作答（${ROLE_LABELS[prof.role] ?? prof.role}）`); // D2 · 进门即挂终态看门狗
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
        // WO-AGENTRUN-FANOUT-PERSIST：角色 path-B 是**这个任务本身**那次循环 ⇒ ROOT（`getByTask` 返的就是它）。
        placement: { origin: "ROOT" },
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
   * WO-LOOP-CONTROL-P2.5 · Escalation Ladder rung② 反应式重路由到 Coordinator（停滞单 agent → 拆多角色重解·早于 degrade 兜底）。
   *
   * 触发前置（调用点已判）：`result.stalled`（rung① 用尽仍停滞）× `escalationEnabled` 开 × `!usedCoordinator`（proactive 未接手·防双 G2）。
   * 本方法内再守两道诚实门：
   *  ① 拆解 plan：优先复用既有 `planCoordination`（若本题实含 ≥2 域关键词但因 proactive 关而落到单 agent）；否则 rung② stalled-mode
   *     兜底 `planStalledCoordination`（交付风险三角·即便无跨域关键词也召集重解）。二者皆 undefined → return false（rung② no-op → 落既有 degrade）。
   *  ② 只 fan out 到**真实存在**的角色 agent（`repos.agents.get`·mirror runPathB :1274）——缺失 agent 不空调；存活角色 < 2 → return false（诚实降级）。
   * 通过 → 发 `agent_escalated` 伪 step（rung②·**复用** P2·**不新增** §8.2 事件名·**早于** degrade）→ 复用 `runCoordinator` 真扇出（invoke_agent
   * 各角色·enforceAgentObjectScope 真隔离·同一 residualBudgetFromConfig 硬预算·**不绕预算**）→ synthesize 综合答案收尾（COMPLETED + answer.final）。
   * 一次性：runCoordinator 完成即 return true·runPathB 随即 return（不落 degrade·rung② 至多一次·非递归·G2）。
   */
  private async maybeRerouteToCoordinator(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    result: AgentLoopResult,
  ): Promise<boolean> {
    // ① 拆解 plan：proactive planCoordination 优先（本题实含 ≥2 域关键词）→ 否则 rung② stalled-mode 兜底三角（复用零改扇出/汇总）。
    const plan =
      planCoordination(task.query, task.context.pageContext, [], false) ??
      planStalledCoordination(task.query, task.context.pageContext, []);
    if (!plan) return false; // 无可拆多角色 → rung② no-op → 落既有 degrade（诚实边界）
    // ② 诚实门：只 fan out 到真实存在的角色 agent（缺失不空调）；存活 < 2 → 不 reroute → 落既有 degrade。
    const live: RoleDispatch[] = [];
    for (const d of plan.dispatches) {
      if (await this.deps.repos.agents.get(d.agentId)) live.push(d);
    }
    if (live.length < 2) return false;
    const livePlan: CoordinatorPlan = { ...plan, dispatches: live };
    // rung② 升级信号（复用 agent_escalated 伪 step·不新增 §8.2 事件名·**早于** degrade·前端零改）。durationMs=0（R6·无 Date.now）。
    this.deps.metrics.agentEscalation.inc();
    void result; // result.stalled 已在调用点判真（rung② 前置）；payload 复用 P2 agent_escalated 形状·不新增字段
    await this.deps.events.emit(taskId, "step.completed", {
      stepId: newId("escalate"),
      type: "agent_escalated",
      outcome: "REROUTE_COORDINATOR",
      durationMs: 0,
    });
    // 复用既有 runCoordinator 真扇出（invoke_agent 各角色·scope 真隔离·同硬预算·不绕预算）→ synthesize 收尾（COMPLETED + answer.final）。
    await this.runCoordinator(taskId, auth, livePlan);
    return true;
  }

  /**
   * WO-FIVE-ROLE-AI-EMPLOYEE P1 · 跨域 Coordinator 编排执行：CoordinatorPlan → 每 dispatch 一个 invoke_agent 步扇出
   *（复用 workflow invoke_agent·enforceAgentObjectScope 真隔离——各角色 agent 只能在自身 scopeDeclaration.objectTypes 内取证，
   * 越界读对象被拒）→ 收各角色答 → synthesize 结构化汇总（谁答什么 + 一致/冲突 + 综合结论 + 每角色溯源）。
   * 真跨 agent 调用（非单 agent 换 prompt 假装）：每步经 engine.runRegisteredAgent 真调对应 agentId。
   */
  /**
   * ★ WO-COORD-YIELD-AND-TERMINAL · D1（闭 §8 `G-COORD-PHRASE-HIJACK`）· **Coordinator 兜底门**（唯一 proactive 入口）。
   *
   * 【门序】此方法只允许从 `runPipeline` 的 **τ 决策点**调用 —— 即 `classify` **之后**、path-B **之前**。
   * 从「关键词命中就抢」降级为「兜底」：判断"这题有没有 solver 锚"的权威是**确定性路由 + 分类器**，不是关键词表。
   *
   * 【开火条件·三者与】
   *  ① `coordinatorEnabled`（暗发 `agent.coordinator`·defaultOn:false·"ALL"→false → 既有 path-B 逐字节不变）；
   *  ② **分类器答不出**：`outOfCatalog === true` ‖ 无候选 ‖ 最高候选 `confidence < tauLow`
   *     （τ 复用现有低置信阈值 `pkg.thresholds.low ?? QOS_TAU_LOW`，**不新造常数**，与紧随其后的 path-B 判据同一个谓词）；
   *  ③ `planCoordination` 仍命中（关键词判据原样保留，但**降为必要不充分条件**——它自己的单测不受影响）。
   * 任一不成立 → 返 false → 照走既有 τ 决策 / 澄清 / path-B（逐字节不变·不劫持）。
   *
   * 【为什么不是"往排除词表里加词"】词表补丁治不了病：`交期风险` 换成 `交付吃紧`/`按期交不了` 立刻重演，
   * 而**每一个**同义词都得手工登记。判据搬家只搬一次：从此凡是分类器能答的题，Coordinator 一律够不着。
   */
  private async maybeRunCoordinator(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    classification: ClassificationResult,
    enabledFeatures: FeatureSet,
    tauLow: number,
  ): Promise<boolean> {
    if (!coordinatorEnabled(enabledFeatures)) return false;
    const top = classification.candidates[0];
    // ② 与下方 path-B 分支**同一个谓词**（改一处两处同步·不会再长出第二套阈值）。
    const classifierCannotAnswer = classification.outOfCatalog === true || !top || top.confidence < tauLow;
    if (!classifierCannotAnswer) return false;
    // ③ 关键词判据保留但降级：命中才可能会诊，不命中 → 照走单 agent path-B。
    //   仍传 deterministicMultiEnabled → 维持既有「能被②分解的题让位②」的降级（WO-QOS-CROSS-DOMAIN-UNIFIED 不回归）。
    const plan = planCoordination(task.query, task.context.pageContext, [], deterministicMultiEnabled(enabledFeatures));
    if (!plan) return false;
    await this.runCoordinator(taskId, auth, plan);
    return true;
  }

  private async runCoordinator(taskId: string, auth: RequestAuth, plan: CoordinatorPlan): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;

    // D2 · 进门即挂终态看门狗：**这条路正是事故现场** —— 三角色扇出后永久 EXECUTING_AGENT、19 分钟无 completedAt。
    await this.enterExecuting(taskId, { status: "EXECUTING_AGENT", path: "AGENT" }, `${plan.dispatches.length} 角色会诊`);
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
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth);
    if (drilRoutingEnabled(enabledFeatures)) {
      try {
        const drilPkg = await this.getDrilRouter().buildResourcePackage(
          auth,
          task.query,
          task.context.pageContext as Record<string, unknown> | undefined,
        );
        drilSection = renderDrilPackage(drilPkg);
      } catch (err) {
        // WO §2-4：扇出路径上被吞掉的异常**必须**至少留一条 level>=40（此前是裸 `catch {}` → 日志 0 条）。
        // 仍 fail-open 不阻断扇出（组包只是加速器），但不再一个字都不留。
        this.logSwallowed(taskId, "runCoordinator/buildResourcePackage", err);
        drilSection = "";
      }
    }
    const steps = buildDispatchSteps(plan, task.context.pageContext, drilSection);
    const budget = new BudgetTracker(this.residualBudgetFromConfig()); // WO-Phase4 §6：子 agent/角色/场景/工作流 path 同受硬预算（env 未设→宽松 DEFAULT 不变）
    const invokedAgentKeys: string[] = [];
    // ★ WO-ROUTE-1（闭 E9·「旁白在多角色路径上一条都不发」）：`emitNarration` 此前全仓唯一调用点是 runPathB
    //   —— `runCoordinator → runWorkflowSteps → runAgentStep → runRegisteredAgent` 这条链上一次都没传（默认 false）
    //   → 对照实验坐实：同一份 LLM 脚本、同样点亮 qos.reasoning-trace，path-B 单 agent 2 次往返发 1 条旁白，
    //   Coordinator 6 次往返发 0 条。多角色扇出恰恰是**最需要过程可见**的那条路（用户等的就是"三个角色分别在查什么"）。
    const narrationOn = reasoningTraceEnabled(enabledFeatures);
    // 每条旁白**带角色标识**（前端要分栏显示"供应链在查什么/生产在查什么"）。角色归属靠 workflow executor 的
    // **串行步序**确定性推导：executor 逐步 `for (const step of input.steps)` 串行执行并先发 `step.started`
    //（workflow/executor.ts:104-106）→ 记住当前 dispatch_i 即当前角色（R6 确定·无并发歧义）。
    // 同时给旁白伪 step 的 stepId 加 dispatch 前缀——各角色 loop 内部都叫 `narration-<i>`，不加前缀会在前端
    // `selectStepRows` 的 stepId Map 里互相覆盖（只剩最后一个角色的旁白）。
    const dispatchByStepId = new Map<string, CoordinatorPlan["dispatches"][number]>(
      plan.dispatches.map((d, i) => [`dispatch_${i}`, d]),
    );
    let current: { stepId: string; dispatch: CoordinatorPlan["dispatches"][number] } | undefined;
    const emitWithRole = (e: string, p: unknown): Promise<void> => {
      if (e === "step.started") {
        const sid = (p as { stepId?: string } | undefined)?.stepId;
        const d = sid ? dispatchByStepId.get(sid) : undefined;
        if (sid && d) current = { stepId: sid, dispatch: d };
      }
      let payload = p;
      const pl = p as { type?: string; stepId?: string; text?: string } | undefined;
      if (pl?.type === "agent_narration" && current) {
        const label = ROLE_LABELS[current.dispatch.role] ?? current.dispatch.role;
        payload = {
          ...(p as Record<string, unknown>),
          stepId: `${current.stepId}/${pl.stepId ?? "narration"}`,
          role: current.dispatch.role,
          roleLabel: label,
          agentId: current.dispatch.agentId,
          // 结构化字段（role/roleLabel）供前端分栏；同时把标识前缀进文本，使**当下**的时间线（只渲染 text）也看得见是谁在查。
          text: `【${label}】${pl.text ?? ""}`,
        };
      }
      return this.deps.events.emit(taskId, e, payload).then(() => undefined);
    };
    const result = await this.deps.engine.runWorkflowSteps({
      taskId,
      steps,
      slots: {},
      context: task.context,
      ctx: auth,
      nesting: { callChain: [], budget },
      emit: emitWithRole,
      trustLevel: "AGENT_EXPLORATORY",
      enforceAgentObjectScope: true, // 角色 scope 真隔离（越界读对象拒）
      ...(narrationOn ? { emitNarration: true } : {}), // 关 → 不传 → 既有 Coordinator 行为逐字节不变
      onResolvedRef: (r) => {
        if (r.kind === "agent") invokedAgentKeys.push(r.key);
      },
    });

    // 收各角色答（invoke_agent 步 stepOutputs[dispatch_i].data.answer）→ synthesize。
    if (result.status === "CANCELLED") {
      await this.deps.repos.tasks.patch(taskId, {
        status: "CANCELLED",
        completedAt: new Date().toISOString(),
      });
      await this.deps.events.emit(taskId, "task.cancelled", { reason: result.reason });
      this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "CANCELLED" });
      return;
    }
    const outputs = result.stepOutputs;
    const roleAnswers: RoleAnswerInput[] = plan.dispatches.map((d, i) => {
      const out = outputs[`dispatch_${i}`] as { data?: { answer?: Answer } } | null | undefined;
      const ans = out?.data?.answer;
      const firstText = ans?.blocks.find((b) => b.type === "text");
      const answerText = firstText && firstText.type === "text" ? firstText.markdown : "";
      return { role: d.role, agentId: d.agentId, subQuestion: d.subQuestion, answerText, scope: d.scope, objectTypes: d.objectTypes };
    });

    const answer = synthesize(plan, roleAnswers);
    this.disarmTerminalWatchdog(taskId); // D2 · 扇出收敛，责任交回正常收尾
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
    await this.enterExecuting(task.id, { status: "EXECUTING_AGENT", path: "AGENT" }, `场景入口 agent（${scene.mode}）`); // D2 · 进门即挂终态看门狗
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
        // WO-AGENTRUN-FANOUT-PERSIST：场景入口 agent 是**这个任务本身**那次循环 ⇒ ROOT。
        placement: { origin: "ROOT" },
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
    this.disarmTerminalWatchdog(taskId); // D2 · 用户已接管终态责任
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
      this.disarmTerminalWatchdog(t.id); // D2 · SUPERSEDED 已是终态责任人
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
    this.disarmTerminalWatchdog(taskId); // D2 · 已有人负责落终态 → 撤看门狗（漏撤也无害：回调对终态是 no-op）
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
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
    } else if (!task.answer) {
      // ★ #109 · 诚实终态：**任何**失败都必须留下一句用户看得懂的话。
      //   病灶是上面那个 `task.path === "AGENT"` 条件 —— 诚实答案的分支**只挂在 agent 路上**，
      //   于是 path-A（工作流）失败时 `answer` 恒 undefined，前端拿到 FAILED + 空答案 = 一片空白。
      //   实测（真 Kimi·2026-08-05）：「采纳常州的三班制方案」→ DataCore 400
      //   `payload.factor is required` —— 精确成因就在 task.error 里躺着，用户一个字都看不到。
      //   与 execute-plan 那个裸 catch 同族：**系统知道真因，却不说**。
      const failAnswer: Answer = {
        trustLevel: "VERIFIED_WORKFLOW",
        unverifiedNumerics: false,
        provenance: [],
        blocks: [{
          type: "text",
          markdown: `**这一步没能完成。**\n\n失败在：${message}\n\n（错误码 \`${code}\`）这不是"没算出来"，是执行链上某一步被拒绝了 —— 上面这句是系统拿到的原始成因，不是概括。`,
        }],
      };
      await this.deps.repos.tasks.patch(taskId, { answer: failAnswer });
      await this.deps.events.emit(taskId, "answer.final", failAnswer);
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
