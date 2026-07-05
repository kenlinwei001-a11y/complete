import type {
  Answer,
  ClarificationReplyBody,
  ClassificationResult,
  IntentDefinition,
  QueryTask,
  ResolvedRef,
  ScenarioPackage,
  SceneEntryConfig,
  SessionContext,
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
} from "../agent/prompts.js";
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
import { SIM_COMMANDER_TOOLS } from "../tools/registry.js";
import { reconcileUniversalAgent, SEED_UNIVERSAL_AGENT_ID } from "../agents/universal.js";
import { pseudoEmbed } from "../util/embedding.js";
import { clarifyPromptFor, fillSlots } from "./slots.js";
import { appendDataGapBlock } from "../scenario-grounding.js";
import { injectScenarioRuleStep } from "./scenario-rules.js";
import { recordOutOfDomain, recordResolutionAttempts } from "./perception-metrics.js";

const CLARIFICATION_TIMEOUT_MS = 10 * 60_000;

/**
 * WO-1B 兜底：LLM SDK 鉴权失败的原始串（如 Anthropic "Could not resolve authentication method"）绝不透传给用户。
 * 命中已知签名 → 归一为 LLM_PURPOSE_UNBOUND + 中文引导（R7 信封·诚实降级，不泄漏 SDK 内部串）。
 */
const LLM_AUTH_LEAK_SIGNATURES = [
  "could not resolve authentication",
  "x-api-key",
  "authentication_error",
  "no api key",
  "apikey",
];
function sanitizeLlmAuthLeak(code: string, message: string): { code: string; message: string } {
  const lower = (message ?? "").toLowerCase();
  if (LLM_AUTH_LEAK_SIGNATURES.some((s) => lower.includes(s))) {
    return {
      code: "LLM_PURPOSE_UNBOUND",
      message: "LLM 用途未解析到可用 provider 或密钥无效——请在 设置→LLM 用途绑定 配置 provider 与密钥",
    };
  }
  return { code, message };
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
  /** WO-B AGENT-OBSERVATIONAL-MEMORY：gated LLM keyFindings 蒸馏器（QOS_MEMORY_LLM=1 才装配·默认 undefined=确定性模板·R6）。 */
  memoryDistiller?: (args: { tenantId: string; query: string; toolPath: string; fallback: string }) => Promise<string>;
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
 * WO-QOS-DIAG · 确定性分类回退（"确定性是地板"）：LLM 不可用/classify 失败时的**无 LLM 兜底路由**。
 * 纯函数（R6·同输入同输出·无时钟/随机）：把归一问句拆字符 bigram，与意图 name/description/examples 的
 * bigram 求「问句被覆盖率」containment = |q∩t|/|q|，取各文本最大值——preset 类问句（≈意图 examples）得高分。
 * 只用于 LLM 缺失时的兜底，绝不冒充 LLM 分类；弱匹配返 0 → 上层诚实降级（不硬塞、不误路由）。
 */
function charBigrams(s: string): Set<string> {
  const n = normalizeQuery(s);
  const grams = new Set<string>();
  if (n.length === 1) grams.add(n);
  for (let i = 0; i + 1 < n.length; i++) grams.add(n.slice(i, i + 2));
  return grams;
}

export function deterministicMatchScore(query: string, intent: IntentDefinition): number {
  const q = charBigrams(query);
  if (q.size === 0) return 0;
  const texts = [intent.name, intent.description, ...intent.examples];
  let best = 0;
  for (const t of texts) {
    const tb = charBigrams(t);
    if (tb.size === 0) continue;
    let overlap = 0;
    for (const g of q) if (tb.has(g)) overlap++;
    const containment = overlap / q.size; // 问句 bigram 被该文本覆盖的比例
    if (containment > best) best = containment;
  }
  return best;
}

export class Orchestrator {
  private readonly pending = new Map<string, PendingClarification>();
  private readonly cancelled = new Set<string>();

  constructor(private readonly deps: OrchestratorDeps) {}

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
    // 内部批量（如 eval 套件逐条跑）不受"每用户并发 ≤3"节流——那是面向交互用户的限流，不应卡内部回归。
    if (!opts?.internal) {
      const active = await this.deps.repos.tasks.countActiveByUser(auth.tenantId, auth.userId);
      if (active >= 3) {
        throw new HttpError(429, ErrorCodes.RATE_LIMITED, "每用户并发执行中任务 ≤3");
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

    // ② 场景卡改写问句（自由路径）继承卡 presetSlots（本单根因②·治 G-3 launcher→自由问句接缝）：
    // 用户点场景卡（注入 presetSlots，如 S01 demandDelta:0.2）后，在对话坞改写成自己的问句 → 该次
    // 提交走前端 buildContext（PRD §6.2 固定，不带 presetSlots），仅 conversationId 指向卡的父任务。
    // 若不继承，卡的 presetSlots 全丢 → 本不该问的槽（demandDelta）被反问裸 key。此处按会话血缘从父
    // 任务继承 presetSlots 作**默认**（用户本次显式抽取的槽优先级更高，见 fillSlots ① > ①.5）。
    const inheritedPresets = await this.inheritScenarioPresets(auth.tenantId, body.context);
    const mergedContext: SessionContext = {
      ...body.context,
      conversationId: body.context.conversationId ?? undefined,
      ...(Object.keys(inheritedPresets).length > 0 ? { presetSlots: inheritedPresets } : {}),
    };

    const task: QueryTask = {
      id: taskId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      packageId: body.packageId,
      conversationId: body.context.conversationId ?? newId("conv"),
      query: body.query,
      context: mergedContext,
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
    // WO-Q1：分类期 LLM 往返慢（Kimi 推理模型可达 ~30s），此前 task.accepted→routing.completed 间纯静默。
    // 发一个 "classify" 处理步（复用既有 step.started/completed 帧·前端 selectStepRows 直接渲染 → 思考态可见），
    // 让首进度帧在 accept 后毫秒级出现（不改 §8.2 事件集·不改前端·不动 Path A）。
    await this.deps.events.emit(taskId, "step.started", { stepId: "classify", type: "classify" });
    const classifyT0 = Date.now();
    // WO-QOS-DIAG · 无 LLM 兜底路由（"确定性是地板"）：LLM classify 失败/不可用（无 provider·全链此前 100% FAILED）
    // 时，用确定性 example 匹配兜底——preset 类问句仍确定性路由到 path A（无 LLM 也能答），弱匹配返 undefined
    // → 照旧诚实降级。仅在 LLM classify 未产出时触发，LLM 可用时零行为变化（不冒充 LLM 分类·model 标 deterministic:*）。
    const llmClassification = await this.classify(task, pkg, candidates);
    // LLM classifier 失败（不可用/超时/限流·3 次重试后无产出）计数——**不论**确定性兜底是否随后救回
    // （指标语义 = "LLM 分类失败率"，与路由结果解耦；WO-QOS-DIAG 前该 inc 与 path-B 分支耦合，兜底救回会漏计）。
    if (!llmClassification) this.deps.metrics.classifierErrors.inc();
    const classification = llmClassification ?? this.deterministicClassify(task, candidates);
    await this.deps.events.emit(taskId, "step.completed", {
      stepId: "classify",
      type: "classify",
      outcome: classification ? (llmClassification ? "matched" : "deterministic-fallback") : "fallback",
      durationMs: Date.now() - classifyT0,
    });
    if (!classification) {
      if (mode === "WORKFLOW_ONLY") {
        await this.completeWorkflowOnlyMiss(task, candidates);
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
  ): Promise<ClassificationResult | undefined> {
    // resolution order (amends QOS-PRD §6): package field → tenant ModelBinding → env default
    const model = await this.deps.llmSettings.roleModel(task.tenantId, "classifier", pkg.classifierModel);
    // 关思考开关（用途绑定级）：classifier 绑思考模型(kimi-k2.6)时可关思维链，分类从 10–90s 降到秒级
    const disableThinking = await this.deps.llmSettings.roleDisableThinking(task.tenantId, "classifier");
    const catalog = candidates
      .map((i) => {
        const slotDesc = i.slots.map((s) => `${s.name}(${s.type}${s.required ? ",必填" : ""}): ${s.description}`).join("; ");
        return `- ${i.key}: ${i.description}\n  示例: ${i.examples.slice(0, 3).join(" / ")}\n  槽位: ${slotDesc || "无"}`;
      })
      .join("\n");
    const historySummary = await this.conversationSummary(task);
    const contextSummary = `view=${task.context.view}; selected=${task.context.selectedObjects
      .map((o) => `${o.objectType}:${o.label ?? o.objectId}`)
      .join(",")}`;

    const system = buildClassifierSystem(catalog);
    const user = buildClassifierUser({ query: task.query, historySummary, contextSummary });

    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now();
      try {
        const raw = await this.deps.engine.deps.llm.classify({ model, system, user, tenantId: task.tenantId, disableThinking });
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

  /**
   * WO-QOS-DIAG · 确定性分类兜底（无 LLM 时的路由地板）。纯确定性（R6）：
   * 对每个候选意图算 `deterministicMatchScore`（问句 bigram 被 name/description/examples 覆盖率），
   * - 唯一强匹配（top≥STRONG 且领先第二≥MARGIN，或仅 1 候选且 top≥STRONG）→ confidence 1.0 → 直进 path A（确定性工作流·无 LLM）；
   * - 多个接近的中等匹配（top≥WEAK）→ 置信度落 (τ_low, τ_high) → 触发 INTENT_CHOICE 澄清（用户确定性选，仍无 LLM）；
   * - 全部弱（top<WEAK）→ undefined → 上层照旧诚实降级（path B / 需配置 LLM），**绝不硬塞/误路由/冒充真答**。
   * model 标 `deterministic:example-match`（审计诚实位·非 LLM）。
   */
  private deterministicClassify(task: QueryTask, candidates: IntentDefinition[]): ClassificationResult | undefined {
    const STRONG = 0.5, MARGIN = 0.15, WEAK = 0.34;
    const scored = candidates
      .map((c) => ({ key: c.key, score: deterministicMatchScore(task.query, c) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top || top.score < WEAK) return undefined; // 无足够确定性证据 → 不硬塞，交上层诚实降级
    const second = scored[1]?.score ?? 0;
    const base = { outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "deterministic:example-match" };
    // 唯一强匹配 → 高置信 → path A
    if (top.score >= STRONG && (scored.length === 1 || top.score - second >= MARGIN)) {
      return { candidates: [{ intentKey: top.key, confidence: 1 }], ...base };
    }
    // 多候选接近 → 中置信 → INTENT_CHOICE 确定性澄清（落 τ_low..τ_high 之间的固定 0.7）
    const near = scored.filter((s) => s.score >= WEAK).slice(0, 3).map((s) => ({ intentKey: s.key, confidence: 0.7 }));
    return { candidates: near, ...base };
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

  /**
   * ② 场景卡改写问句时的 presetSlots 继承（治 G-3 launcher→自由问句接缝）。
   * 会话血缘：前端点卡后 `store.setConversationId(res.taskId)`（PRD §6.2 buildContext 固定不带 presetSlots），
   * 后续对话坞改写的问句以卡的**父任务 id** 作 context.conversationId 提交 → 这里据此取回父任务，把其
   * presetSlots 继承为本轮**默认**（用户本轮显式给的槽在 fillSlots 里优先级更高、会覆盖）。
   * 父任务定位两条兜底：① 直接 `tasks.get(conversationId)`（前端约定 conversationId=父 taskId）；
   * ② 同会话 `listByConversation`。取最近的、带非空 presetSlots 的祖先。用户本轮显式 presetSlots 优先合并在上。
   * 无父/无预置 → 返回本轮原样 presetSlots（可能为空），零行为变化。确定性、纯读、tenant 隔离（R6/租户铁律）。
   */
  private async inheritScenarioPresets(
    tenantId: string,
    context: SessionContext,
  ): Promise<Record<string, unknown>> {
    const own = context.presetSlots ?? {};
    const convId = context.conversationId;
    if (!convId) return own;
    const ancestors: QueryTask[] = [];
    const direct = await this.deps.repos.tasks.get(convId);
    if (direct && direct.tenantId === tenantId) ancestors.push(direct);
    const siblings = await this.deps.repos.tasks.listByConversation(tenantId, convId);
    ancestors.push(...siblings);
    // 取最近创建的、带非空 presetSlots 的祖先（确定性：createdAt 降序，同刻按 id）。
    const withPreset = ancestors
      .filter((t) => t.context?.presetSlots && Object.keys(t.context.presetSlots).length > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    if (!withPreset) return own;
    // 父默认在下、用户本轮显式在上（改写≠弃 preset·仅用户显式给出的槽覆盖）。
    return { ...withPreset.context.presetSlots, ...own };
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

    const budget = new BudgetTracker();
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

    // LAUNCHER-GROUNDED-QUESTIONS（Part B）：工作流跑通但**结果为数据未接齐空壳**（BP-7 显性化文案，
    // 无 KPI/表数据）→ 追加 `gap` 块（携真问句 + taskId）。答案坞据此渲染既有 GapCard 的「认领并补数据」
    // （复用 GROWTH-WORKLIST human-gated fill·非自动补），登记 WorklistItem → 跳补数据页 → 补后继续推演。
    // 仅命中"数据未接齐/无输出"（真缺数据·补数据有用）；"真无解"（约束不可行·补数据无用）不追加，诚实区分。
    const answer = appendDataGapBlock(result.answer, task.query, taskId);
    await this.deps.repos.tasks.patch(taskId, {
      status: "COMPLETED",
      answer,
      resolvedRefs: dedupeRefs(resolvedRefs),
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "answer.final", answer);
    this.deps.metrics.tasksTotal.inc({ path: "WORKFLOW", status: "COMPLETED" });
  }

  // -------------------------------------------------------------------------
  // Path B: restricted agent fallback (§5.4)
  // -------------------------------------------------------------------------
  private async runPathB(taskId: string, auth: RequestAuth, classification?: ClassificationResult): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    // package 必须存在（分类阈值/意图册来源）；兜底工具面已不再取自 package 白名单（改由 agt_universal 一等配置）。
    if (!(await this.deps.repos.packages.get(task.packageId))) return;

    // entitlement PRD §5: qos.agent-fallback off → every would-be path-B branch
    // returns the WORKFLOW_ONLY behavior (请换个问法 + available intents), no agent run.
    const enabledFeatures = await this.deps.features.enabledSet(task.tenantId, auth.token);
    if (!(await this.deps.features.isEnabled(task.tenantId, "qos.agent-fallback", auth.token))) {
      const candidates = await this.publishedIntentsForView(task.packageId, task.context.view, enabledFeatures);
      await this.completeWorkflowOnlyMiss(task, candidates);
      return;
    }

    // WO-SCENE-B：WORKFLOW_FIRST 命不中预设意图 → 若本入口配了**场景级 agent**（scene.defaultAgentId 且已发布），
    // 回落到该配置完整的场景 agent（本页数据上下文 + 规则/求解器子集 + 接地）而非通用 path-B agent
    // ——使"规划体检"等入口的开放问句得到接地结构化答复（非泛答）。无场景 agent 则照旧通用 path-B。
    const scene = await this.deps.repos.sceneEntries.byView(task.tenantId, task.context.view);
    let handoffFromAgentId: string | undefined;
    if (scene?.defaultAgentId) {
      const agent = await this.deps.repos.agents.get(scene.defaultAgentId);
      if (agent && agent.status === "PUBLISHED") {
        await this.runSceneAgent(task, auth, scene);
        return;
      }
      // WO-C AGENT-HANDOFF-OBJECT：本入口配了场景 agent 但不可用（未发布/缺失）→ 真实发生 scene→universal
      // 回落委派。fromAgentId = 该配置的真持久场景 agent id；兜底运行后落一等 Handoff 记录（可审计·谁→谁）。
      handoffFromAgentId = scene.defaultAgentId;
    }

    // AGENT-UNIVERSAL-FALLBACK：兜底终点重接——命不中预设、且本入口无场景专属 agent → 委派一等全域探索智能体
    // agt_universal（替代旧「写死白名单 ∩ {READ,COMPUTE} + create_action_draft + discover」）。全工具面
    // （全 BUILTIN + 已发布 workflow + 已绑定 MCP）由 reconcileUniversalAgent 随行同步（D1/D2/D3）；
    // sim 工具 entitlement 暗发（R3）经 toolVisibilityFilter 剔除；护栏（写仅 create_action_draft·限额·OBO·审计）不变。
    await this.runUniversalAgent(task, auth, enabledFeatures, classification, handoffFromAgentId);
  }

  /**
   * AGENT-UNIVERSAL-FALLBACK：全域探索智能体兜底路由（人机对话入口命门）。
   * 命不中预设意图、且本入口未配场景专属 agent 时的终点——委派一等可配置的 PUBLISHED agent `agt_universal`
   * （engine.runRegisteredAgent，与 runSceneAgent 同机制：MCP 展开 + scope 门 + skills + 规则 POST_CHECK）。
   * 护栏：① sim 工具仅 sim.commander 开通时可见（R3 暗发，toolVisibilityFilter 剔除）；② 写仅 create_action_draft
   * （R4·工具层内建）；③ 预算限额（agent.budget）；④ OBO 透传 / 租户隔离 / 审计 decision-trace（agentRuns 记 agentId）不变；
   * ⑤ 无 LLM 仍诚实降级（runAgentLoop 内建 LLM_PURPOSE_UNBOUND·不泄漏 SDK 串）。落 fallbackTrace 供 /ops/fallback-stats。
   */
  private async runUniversalAgent(
    task: QueryTask,
    auth: RequestAuth,
    enabledFeatures: FeatureSet,
    classification?: ClassificationResult,
    /** WO-C：若本次是 scene→universal 回落委派，则为交出方（场景）agent 的真持久 id；否则 undefined（非交接）。 */
    handoffFromAgentId?: string,
  ): Promise<void> {
    // 兜底前懒 reconcile：把 agt_universal 的 tools 面与「已发布 workflow + 已绑定 MCP 配置」对齐（幂等·R6），
    // 并对非 demo 租户/首次落兜底懒播种——保证「调用所有 MCP」始终触达兜底（D2）。
    await reconcileUniversalAgent(this.deps.repos, task.tenantId);

    // WO-C AGENT-HANDOFF-OBJECT：scene→universal 回落委派 → 在**委派决策点**（真跑前）落一等 Handoff 记录。
    // 记录时机=交接真实发生之时（早于下游 agent 运行），故即便下游 LLM 失败/无凭据也留痕（可审计不丢）。
    // fromAgentId=配置但不可用的场景 agent 真持久 id；toAgentId=agt_universal 真持久 id（reconcile 已确保存在，
    // 与 AGENT-UNIVERSAL C2 agentRun.agentId 同坐标系）。carriedSlots/carriedEvidence 为真值（非合成）。
    if (handoffFromAgentId) {
      const carriedSlots: Record<string, unknown> = {
        ...(task.context.presetSlots ?? {}),
        ...(classification?.extractedSlots ?? {}),
      };
      const carriedEvidence = (task.context.selectedObjects ?? []).map((o) => `obj:${o.objectType}:${o.objectId}`);
      await this.deps.repos.handoffs.insert({
        id: newId("hof"),
        tenantId: task.tenantId,
        taskId: task.id,
        fromAgentId: handoffFromAgentId,
        toAgentId: SEED_UNIVERSAL_AGENT_ID,
        reason: "场景 agent 未发布/缺失 → 全域探索兜底（scene→universal 回落）",
        carriedSlots,
        carriedEvidence,
        at: new Date().toISOString(),
      });
      await this.deps.events.emit(task.id, "agent.handoff", { fromAgentId: handoffFromAgentId, toAgentId: SEED_UNIVERSAL_AGENT_ID });
    }

    await this.deps.repos.tasks.patch(task.id, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(task.id, "routing.completed", { path: "AGENT", note: "进入全域探索模式" });

    // 增量4 §5：sim 工具仅在租户开通 sim.commander(+sim.sandbox) 时可见（关→不存在·R3 暗发）。
    // enabledFeatures="ALL"（mock 默认/降级）→ 全开；显式 Set 时要求两键齐备。
    const simCommanderOn = simCommanderEnabled(enabledFeatures);
    const simNames = SIM_COMMANDER_TOOLS as readonly string[];
    const budget = new BudgetTracker();
    const priorSummary = agentPriorSummary(await this.previousConversationTasks(task));
    const resolvedRefs: ResolvedRef[] = [];

    try {
      const result = await this.deps.engine.runRegisteredAgent({
        taskId: task.id,
        agentId: SEED_UNIVERSAL_AGENT_ID,
        version: "latest",
        prompt: buildAgentUser(task, priorSummary || undefined),
        ctx: auth,
        nesting: { callChain: [], budget },
        emit: (e, p) => this.deps.events.emit(task.id, e, p).then(() => undefined),
        isCancelled: () => this.cancelled.has(task.id),
        onResolvedRef: (r) => resolvedRefs.push(r),
        // R3 暗发：sim 工具关 entitlement → 从暴露列表剔除（模型看不到=不存在）；其余全工具面放行。
        toolVisibilityFilter: (name) => simCommanderOn || !simNames.includes(name),
      });

      await this.deps.repos.agentRuns.insert(result.run);

      await this.deps.repos.fallbackTraces.insert({
        id: newId("fbt"),
        taskId: task.id,
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

      if (this.cancelled.has(task.id)) {
        await this.deps.repos.tasks.patch(task.id, { status: "CANCELLED", completedAt: new Date().toISOString() });
        await this.deps.events.emit(task.id, "task.cancelled", { reason: "user cancelled" });
        this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "CANCELLED" });
        return;
      }

      await this.deps.repos.tasks.patch(task.id, {
        status: "COMPLETED",
        answer: result.answer,
        classification,
        resolvedRefs: dedupeRefs(resolvedRefs),
        completedAt: new Date().toISOString(),
      });
      for (const block of result.answer.blocks) {
        if (block.type === "action_draft") {
          await this.deps.events.emit(task.id, "action_draft.created", {
            draftId: block.draftId,
            actionType: block.actionType,
          });
        }
      }
      await this.deps.events.emit(task.id, "answer.final", result.answer);
      this.deps.metrics.tasksTotal.inc({ path: "AGENT", status: "COMPLETED" });
      await this.recordExperience(task.id);
    } catch (err) {
      await this.failFromError(task.id, err, "AGENT_ERROR");
    }
  }

  /**
   * WO-B AGENT-OBSERVATIONAL-MEMORY · 观察记忆写侧（Phase6A 回写管线的诚实边界加固）：
   * path B / 场景 agent 任务**达终态**（COMPLETED 且有 answer）时，把本轮 decision-trace（工具序列 +
   * 求解器 + 结论首段）经**确定性模板蒸馏**为一条经验条目落入经验记忆库，供后续 search_experience 检索。
   *
   * 诚实边界（KILL-MOCK-RED 红线）：条目标 `origin:OBSERVED` + `provenance:taskId` —— 它是**路径提示**
   * 而非业务真值源；search_experience 返回时随行免责声明『仅供路径参考·业务事实以工具结果为准』，
   * OBSERVED 的任何数字永不被引用为已核验业务数字。
   *
   * 确定性（R6）：id / toolPath / keyFindings(默认) / date / embedding 均为 trace 的纯函数 —— 同 trace 同条目
   * 字节一致。LLM 蒸馏仅在 `QOS_MEMORY_LLM=1` 装配 memoryDistiller 时接管 keyFindings（失败回退确定性）。
   * R2：tenantId 随条目；留存走 G-RET 增长表哲学（upsert-by-taskId 天然去重·不做逐任务累积）。
   * 回写失败不影响主流程。
   */
  private async recordExperience(taskId: string): Promise<void> {
    try {
      const task = await this.deps.repos.tasks.get(taskId);
      if (!task?.answer) return;
      const calls = await this.deps.repos.toolCalls.listByTask(taskId);
      const tools = [...new Set(calls.map((c) => c.toolName))]; // 首次出现序（决定性）
      const solvers = [
        ...new Set(
          calls
            .filter((c) => c.toolName === "invoke_solver")
            .map((c) => (c.input as { solverKey?: string } | undefined)?.solverKey)
            .filter((s): s is string => !!s),
        ),
      ];
      // toolPath = decision-trace 的工具序列（结构化路径提示的核心维度）。
      const toolPath = `${tools.join(" → ") || "—"}${solvers.length ? ` ⟨求解器:${solvers.join("/")}⟩` : ""}`;
      const approach = `工具:${tools.join("/") || "—"}${solvers.length ? ` · 求解器:${solvers.join("/")}` : ""} · ${calls.length} 次调用`;
      const firstText = task.answer.blocks.find((b) => b.type === "text");
      const outcome = firstText && firstText.type === "text" ? firstText.markdown.slice(0, 240) : "(无文本结论)";
      const scene = String((task.context as { view?: string } | undefined)?.view ?? "agent");
      const intentKey = (task.matchedIntent as { intentKey?: string } | undefined)?.intentKey ?? scene;
      const date = (task.completedAt ?? task.createdAt ?? new Date().toISOString()).slice(0, 10);
      // keyFindings：确定性默认 = 结论首段；gated LLM（QOS_MEMORY_LLM=1）时由 memoryDistiller 蒸馏（失败回退确定性·R6 地板）。
      let keyFindings = outcome;
      if (this.deps.config.QOS_MEMORY_LLM === "1" && this.deps.memoryDistiller) {
        keyFindings = await this.deps.memoryDistiller({ tenantId: task.tenantId, query: task.query, toolPath, fallback: outcome });
      }
      const id = `exp_auto_${taskId}`.replace(/[^\w-]/g, "_");
      await this.deps.repos.experience.upsert({
        id,
        tenantId: task.tenantId,
        scene,
        question: task.query,
        approach,
        outcome,
        date,
        embedding: pseudoEmbed(`${task.query} ${approach}`),
        // WO-B 诚实边界字段：
        origin: "OBSERVED",
        provenance: taskId,
        intentKey,
        toolPath,
        keyFindings,
      });
      // §4 事件：experience.distilled（观察记忆写侧留痕·可审计·不含业务数字）。
      await this.deps.events.emit(task.id, "experience.distilled", { id, origin: "OBSERVED", provenance: taskId, intentKey, toolPath });
    } catch {
      /* 回写失败不影响主流程 */
    }
  }

  /** AGENT_FIRST / AGENT_ONLY scene-entry modes — skip classification, run the configured agent. */
  private async runSceneAgent(task: QueryTask, auth: RequestAuth, scene: SceneEntryConfig): Promise<void> {
    await this.deps.repos.tasks.patch(task.id, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(task.id, "routing.completed", { path: "AGENT", note: `场景入口模式 ${scene.mode}` });

    const budget = new BudgetTracker();
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

  private async failTask(taskId: string, code: string, rawMessage: string): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return;
    // WO-1B 红线：禁止把 LLM SDK 原始鉴权串透传给用户。即便根因修在解析层（LlmPurposeUnboundError），
    // 这里兜底扫描已知 SDK 鉴权签名 → 替换为结构化中文引导（防任意未覆盖泄漏路径，R7 信封·诚实降级）。
    const { code: safeCode, message } = sanitizeLlmAuthLeak(code, rawMessage);
    code = safeCode;
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
