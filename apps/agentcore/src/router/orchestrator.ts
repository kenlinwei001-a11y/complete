import type {
  Answer,
  AnswerBlock,
  ClarificationReplyBody,
  ClassificationResult,
  ExecutionGraph,
  ExecutionPlan,
  IntentDefinition,
  PlannerShadowRecord,
  QueryTask,
  ResolvedRef,
  ScenarioPackage,
  SceneEntryConfig,
  SessionContext,
  SlotDef,
  SubmitQueryBody,
  TemplateValue,
} from "@platform/contracts";
import { ErrorCodes, problemClassForIntent, isProblemClassCovered, validateExecutionGraph } from "@platform/contracts";
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
import { featureEnabled, intentAllowed, type FeatureSet } from "../features/registry.js";
import { newId } from "../ids.js";
import type { LlmSettings } from "../llm/providers.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import { BudgetTracker } from "../tools/budget.js";
import { SIM_COMMANDER_TOOLS } from "../tools/registry.js";
import { reconcileUniversalAgent, SEED_UNIVERSAL_AGENT_ID } from "../agents/universal.js";
import { pseudoEmbed } from "../util/embedding.js";
import { stripRefMarks } from "../util/prov-refs.js";
import { fillSlots, normalizeExtractedSlots, toClarificationSlot, type SlotSource, type SlotSubstitution } from "./slots.js";
import { appendDataGapBlock } from "../scenario-grounding.js";
import { injectScenarioRuleStep } from "./scenario-rules.js";
import { recordOutOfDomain, recordResolutionAttempts } from "./perception-metrics.js";
import { VALID_SOLVER_KEYS, buildRequirementGraph, parseQuestionAst } from "../growth/requirement-graph.js";
import {
  buildPlannerShadowRecord,
  diffPlannerShadow,
  isFallbackGraph,
  linearizeExecutionGraph,
  synthesizePlan,
  type PlannerRegistries,
} from "../growth/execution-planner.js";
import { plannerWhitelistFromConfig } from "../config.js";
import { fetchOntologyGraph, fetchRegistrySnapshot } from "../growth/pre-analyze.js";
// WO-SANDBOX-AS-RENDER-TARGET（S1）：时序推演意图 → SimulationRequest 归一装配（纯函数·source=dialogue）。
import { assembleSimulationRequest, isSimIntent } from "./sim-request.js";

const CLARIFICATION_TIMEOUT_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// LAUNCHER-SLOT-TRUTH 治本辅助（②入参覆盖 · ④回显 · ⑤诚实横幅）
// ---------------------------------------------------------------------------

/** 把 objectRef 槽值压成标量入参（求解器入参要标量 ID，非 {objectType,objectId,label} 对象）。 */
function scalarizeSlotValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "objectId" in (v as Record<string, unknown>)) {
    return (v as { objectId: unknown }).objectId;
  }
  return v;
}

/** 面向用户的槽位中文标签（回显/横幅用）。未知键回落 description 首句或键名本身。 */
function slotLabel(slot: SlotDef | undefined, name: string): string {
  const KEY_LABEL: Record<string, string> = {
    base: "基地", baseId: "基地", baseName: "基地",
    model: "型号", modelId: "型号",
    custName: "客户", customer: "客户",
    lineId: "产线", processKey: "工序", material: "物料",
    month: "月份", quarter: "季度", day: "日期", date: "日期", timeWindow: "时间窗",
    weeks: "周数", week: "周", horizonWeeks: "周数", fromDay: "起始日", toDay: "截止日",
    gap: "缺口", qty: "数量", demandDelta: "需求增量", cashCushion: "现金垫",
    scenario: "情景", solutionName: "方案", factor: "因子", solverKey: "求解器",
  };
  if (KEY_LABEL[name]) return KEY_LABEL[name];
  const desc = slot?.description?.trim();
  if (desc) return desc.split(/[（(：:，,]/)[0]!.trim() || name;
  return name;
}

/** 槽值的可读展示（objectRef → label；标量 → 原样）。 */
function slotDisplay(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const r = v as { label?: unknown; objectId?: unknown };
    if (typeof r.label === "string") return r.label;
    if (typeof r.objectId === "string") return r.objectId;
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * ②/根B：把**本轮显式抽取**（source=extracted）的槽位值覆盖进 invoke_solver 步骤的**同名入参键**。
 * 仅覆盖 args 中已存在的键（不注入未知入参）；仅 extracted 覆盖（chip/preset 保留烘焙值 → 点卡启动零回归）。
 * 不改动共享 plan 对象（克隆 step/params/args）。纯函数、确定性（R6）。
 */
export function applyExtractedArgOverrides(
  steps: ExecutionPlan["steps"],
  slots: Record<string, unknown>,
  sources: Record<string, SlotSource>,
): ExecutionPlan["steps"] {
  const overrides: Record<string, unknown> = {};
  for (const [name, src] of Object.entries(sources)) {
    if (src === "extracted" && slots[name] !== undefined && slots[name] !== null) {
      overrides[name] = scalarizeSlotValue(slots[name]);
    }
  }
  if (Object.keys(overrides).length === 0) return steps;
  return steps.map((step) => {
    if (step.type !== "invoke_solver") return step;
    const argObj = step.params.args ?? {};
    let changed = false;
    const nextArgs: Record<string, TemplateValue> = { ...argObj };
    for (const [k, v] of Object.entries(overrides)) {
      if (k in argObj) {
        nextArgs[k] = v as TemplateValue;
        changed = true;
      }
    }
    if (!changed) return step;
    return { ...step, params: { ...step.params, args: nextArgs } };
  });
}

/**
 * ④回显 + ⑤诚实横幅（治最恶性静默错答）：
 *   ⑤ substitutions 非空 → 顶部横幅明说"你说的 X 未能对应，本次改用 Y（来源）作答"——绝不静默换题；
 *   ④ 回显本次实际所用关键实体/参数（基地/型号/月份/金额…），使问答错配可见（非静默绿标）。
 * 返回 text 块数组（供 prepend 到答案）；无可回显槽（如无槽意图）→ 空数组。
 */
export function buildSlotTruthBlocks(
  intent: IntentDefinition,
  slots: Record<string, unknown>,
  slotMeta: { sources: Record<string, SlotSource>; substitutions: SlotSubstitution[] },
): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const slotByName = new Map(intent.slots.map((s) => [s.name, s]));

  // ⑤ 诚实横幅（每条替换一句人话）
  for (const sub of slotMeta.substitutions) {
    const label = slotLabel(slotByName.get(sub.slotName), sub.slotName);
    const srcWord = sub.usedSource === "preset" ? "场景预置" : "页面选中";
    blocks.push({
      type: "text",
      markdown: `⚠ 你提到的「${sub.attempted}」未能对应到系统中的已知${label}，本次按${srcWord}的「${slotDisplay(sub.usedValue)}」作答。若非所需，请改用系统内的名称或重新选择后再问。`,
    });
  }

  // ④ 参数回显（本次实际所用的关键实体/参数）
  const echoed: string[] = [];
  for (const slot of intent.slots) {
    const v = slots[slot.name];
    if (v === undefined || v === null || v === "") continue;
    if (slot.type === "timeWindow" && typeof v === "object") {
      const tw = v as { from?: unknown; to?: unknown };
      echoed.push(`${slotLabel(slot, slot.name)}=${slotDisplay(tw.from)}~${slotDisplay(tw.to)}`);
    } else {
      echoed.push(`${slotLabel(slot, slot.name)}=${slotDisplay(v)}`);
    }
  }
  if (echoed.length > 0) {
    blocks.push({ type: "text", markdown: `本次回答所用参数：${echoed.join("、")}。` });
  }
  return blocks;
}

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
      // LLM-ROLE-RESOLUTION-FIX：诚实区分错因（不再一律断言"未绑定"误导已绑用户）。跨角色通用兜底后，
      // 仍报此错 = 要么未绑任何用途、要么已绑 provider 的密钥无效/不可达。并声明全覆盖不变量（绑任一大类即全覆盖）。
      message:
        "LLM 调用未成功：未绑定任何 LLM 用途，或已绑定 provider 的密钥无效/不可达。请在 设置→LLM 用途绑定 确认已绑 provider 且密钥有效——绑定任一大类即覆盖全部用途，无需逐意图单独绑定。",
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
  /**
   * CLARIFY-LOOP-CONVERGE：用户经 INTENT_CHOICE **显式选定**的意图被锁定（locked=true）。
   * 锁定后其后续槽位反问轮次耗尽时 → **诚实降级终态**（明说缺哪些参数、给出最佳理解），绝不把用户的
   * 显式选择静默丢进开放式路径 B 从零再探索——那正是低把握自由问句被 Kimi 端到端观察到"绕圈/不收敛"的根因：
   * 用户已明确"就问这个意图"，系统却在缺参时抛弃该选择、转泛答，用户感知为反复澄清不收敛。
   * 非锁定（高把握自动匹配 / "都不是"拒绝全部候选）保持既有路径 B 语义（PRD §5.1.2-4）。
   */
  locked?: boolean;
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

/**
 * ONTO-SCEN-LAUNCH-DET（PRD-scenario-ontogenesis §2.5）：场景卡任务不可答 → classifyGap → GapReport →
 * GrowthTicket + 通知 + 收件箱 + 降级卡（GOVERNED→PROVISIONAL）+ 诚实 gap 块（前端发育卡）。
 * 由 server.ts 装配（那里有 scenarios/growthTickets/emitDomainEvent/通知客户端），编排器只在终态调用。
 * 传入的 task 是**终态形状**（status/error 已就位，可能尚未落库）——hook 纯读 task、只写场景侧制品。
 */
export type ScenarioGapBlock = Extract<AnswerBlock, { type: "gap" }>;
/**
 * ONTO-SCEN-GROWTH-LOOP（§2.5/§2.6）：钩收到终态 task **⊕ 提交时的 RequestAuth**——AUTO_DERIVE 支需以真 OBO
 * 身份就地倒序发育 growScenario（重跑 triggerQuestion 真投影出 KPI，非合成/兜底）。auth 由编排器按 taskId 随任务
 * 携带（`runAuth`，非内部任务才存·runPipeline 结束即清），缺失（异常路径）时钩降级为纯 NEEDS_HUMAN 开票（不静默）。
 */
export type ScenarioGapHook = (task: QueryTask, auth?: RequestAuth) => Promise<ScenarioGapBlock | null>;

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

/** deterministicClassify 的纯核心（与 fuseClassification ① 分支共用·R6 同输入同输出）。scored 需已降序。 */
function deterministicClassifyFromScores(
  scored: { key: string; score: number }[],
): ClassificationResult | undefined {
  const STRONG = 0.5,
    MARGIN = 0.15,
    WEAK = 0.34;
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

/** PRD-upstream-classify-precision §4 · 一致性加成系数 β 默认值。 */
export const FUSE_BETA_DEFAULT = 0.1;

/**
 * PRD-upstream-classify-precision §4 (A1)·分类融合（确定性 ⊕ LLM，不再互斥）。
 * 纯函数（R6·无时钟/随机·可单测）：LLM 与确定性都算，再合成。返回 {result, rescued}。
 * 规则（PRD §4 逐条）：
 *  ① LLM 缺失 → 退回纯确定性（== 现行 deterministicClassify 语义·向后兼容）。
 *  ② 救回遗漏：确定性 score≥0.5 命中的意图若不在 LLM 候选 → 以 confidence=τ_low 补入（避免漏路由 Path B）。
 *  ③ 一致性加成：LLM top 与确定性 top 同一意图 → 置信 ×(1+β)（只上浮·不下调 LLM top·PRD §8）。
 *  ④ 冲突不硬塞：LLM 与确定性 top 分歧且都不强 → 不额外动作 → 维持 LLM 语义（中置信→INTENT_CHOICE 澄清·诚实不赌）。
 * `rescued`（=②确定性补入使 top 从 <τ_low 脱离 Path B）供 qos_classify_fuse_rescued_total 计量。
 * **等价保证**：LLM 存在且无补入/无上浮时，result 与输入 llm 逐字段一致（关闸 == 现行 `llm ?? det` 的 llm 分支）。
 */
export function fuseClassification(
  llm: ClassificationResult | undefined,
  candidates: IntentDefinition[],
  query: string,
  tau: { high: number; low: number },
  beta: number = FUSE_BETA_DEFAULT,
): { result: ClassificationResult | undefined; rescued: boolean } {
  const scored = candidates
    .map((c) => ({ key: c.key, score: deterministicMatchScore(query, c) }))
    .sort((a, b) => b.score - a.score);

  // ① LLM 缺失 → 纯确定性（100% 等价现行 deterministicClassify）
  if (!llm) {
    return { result: deterministicClassifyFromScores(scored), rescued: false };
  }

  const STRONG = 0.5;
  const fused = llm.candidates.map((c) => ({ ...c }));

  // ② 救回遗漏：det score≥0.5 命中的意图不在 LLM 候选 → 补入，confidence=τ_low（scored 已降序）
  let added = false;
  for (const d of scored) {
    if (d.score < STRONG) break;
    if (!fused.some((c) => c.intentKey === d.key)) {
      fused.push({ intentKey: d.key, confidence: tau.low });
      added = true;
    }
  }

  // ③ 一致性加成：LLM top 与确定性 top 同一意图 → ×(1+β)（只上浮·封顶 1·不下调）
  const detTop = scored[0];
  const llmTopKey = llm.candidates[0]?.intentKey;
  let bonusApplied = false;
  if (detTop && detTop.score > 0 && llmTopKey && detTop.key === llmTopKey) {
    const t = fused.find((c) => c.intentKey === llmTopKey);
    if (t) {
      const boosted = Math.min(1, t.confidence * (1 + beta));
      if (boosted !== t.confidence) {
        t.confidence = boosted;
        bonusApplied = true;
      }
    }
  }

  // ④ 无补入/无上浮 → 100% 等价输入 llm（严格等价关闸态 `llm ?? det` 的 llm 分支·候选序/字段不变）
  if (!added && !bonusApplied) {
    return { result: { ...llm, candidates: fused }, rescued: false };
  }

  // 稳定排序（confidence 降序·同分保持插入序 → R6 确定），截前 3
  const sorted = fused
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.confidence - a.c.confidence || a.i - b.i)
    .map((x) => x.c)
    .slice(0, 3);

  const result: ClassificationResult = {
    ...llm,
    candidates: sorted,
    // 补入后目录内已有候选 → outOfCatalog 置 false；未补入则保持 LLM 判定
    outOfCatalog: added ? false : llm.outOfCatalog,
  };

  // rescue 计量：原 LLM 会落 Path B（outOfCatalog / 无 top / top<τ_low），而②补入后 top≥τ_low 脱离 Path B
  const llmTopConf = llm.candidates[0]?.confidence ?? 0;
  const llmWouldPathB = llm.outOfCatalog || !llm.candidates[0] || llmTopConf < tau.low;
  const fusedTop = sorted[0];
  const fusedWouldPathB = result.outOfCatalog || !fusedTop || fusedTop.confidence < tau.low;
  const rescued = added && llmWouldPathB && !fusedWouldPathB;

  return { result, rescued };
}

export class Orchestrator {
  private readonly pending = new Map<string, PendingClarification>();
  private readonly cancelled = new Set<string>();
  /** ONTO-SCEN-LAUNCH-DET §2.5：场景缺口处置钩（server.ts 装配；未装配=零行为变化）。 */
  private scenarioGap?: ScenarioGapHook;
  /** ONTO-SCEN-GROWTH-LOOP §2.5：非内部任务的提交身份（按 taskId），供缺口钩 AUTO_DERIVE 支以真 OBO 身份重验；runPipeline 结束清。 */
  private readonly runAuth = new Map<string, RequestAuth>();
  /**
   * L1-B WO-L1B-4 规划器影子观察 sideband（in-process·有界·观察态·shadow only）：
   * `synthesizePlan` 的 divergence 记录（按 taskId·测试/FDE 可读·零持久化端点变化 → 零用户可见）。
   * 同时 best-effort 搭车既存 PreAnalysisReport.planner（durable·若报告已在·不新建 → GET pre-analysis 404 恒不变）。
   */
  private readonly plannerShadows = new Map<string, PlannerShadowRecord>();
  private static readonly PLANNER_SHADOW_CAP = 512;
  /** WO-L1B-5：STAGE-2 serve 白名单（config `QOS_PLANNER_WHITELIST` 派生·进程级不变·摘除 env=秒级回退）。 */
  private plannerWhitelistMemo?: Set<string>;

  constructor(private readonly deps: OrchestratorDeps) {}

  /** WO-L1B-5：STAGE-2 serve 白名单（延迟计算一次·配置态·非白名单 intent 仍走模板·判决不换手 NG6）。 */
  private plannerWhitelist(): Set<string> {
    if (!this.plannerWhitelistMemo) this.plannerWhitelistMemo = plannerWhitelistFromConfig(this.deps.config);
    return this.plannerWhitelistMemo;
  }

  /** WO-L1B-4：读规划器影子记录（观察态·测试/内省用·不经端点·零用户可见）。 */
  getPlannerShadow(taskId: string): PlannerShadowRecord | undefined {
    return this.plannerShadows.get(taskId);
  }

  setScenarioGap(hook: ScenarioGapHook): void {
    this.scenarioGap = hook;
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
      // ONTO-SCEN-LAUNCH-DET：内部验证任务留痕（grow/A10 verify/growth probe）→ 场景缺口处置不重复触发。
      ...(opts?.internal ? { internal: true } : {}),
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
    // ONTO-SCEN-GROWTH-LOOP §2.5：非内部（真用户点卡）任务携身份供缺口钩 AUTO_DERIVE 支就地倒序发育重验；
    // 本方法结束即清（缺口处置在 completeScenarioGap/failTask 内联 await 完成，早于此 finally，故读得到）。
    if (!task.internal) this.runAuth.set(taskId, auth);
    try {
      await this.runPipelineInner(taskId, auth, task);
    } finally {
      this.runAuth.delete(taskId);
    }
  }

  private async runPipelineInner(taskId: string, auth: RequestAuth, task: QueryTask): Promise<void> {
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

    // §2.4 确定性启动（PRD-scenario-ontogenesis · ONTO-SCEN-LAUNCH-DET）：GOVERNED 卡的闭包已被
    // 倒序发育长成并经 A10 亲手验证 → 正序点卡**全程零 classifier**（确定性是发育闭合的自然结果，非补丁）。
    // classify LLM 只服务自由问句；GOVERNED 卡即便绑定失败也**绝不**回落 LLM classify/探索——诚实缺口终结（§2.5）。
    const forcedKey = task.context.scenarioIntentKey;
    const scenarioCard = forcedKey && task.context.scenarioKey
      ? await this.deps.repos.scenarios.byKey(task.tenantId, task.context.scenarioKey)
      : undefined;
    const governedLaunch = scenarioCard?.maturity === "GOVERNED";

    if (candidates.length === 0) {
      const classification: ClassificationResult = {
        candidates: [],
        outOfCatalog: true,
        extractedSlots: {},
        latencyMs: 0,
        model: "none",
      };
      await this.deps.repos.tasks.patch(taskId, { classification });
      // GOVERNED 卡：意图目录空（被退发布/删除/entitlement 关闭）→ 不落探索，诚实缺口终结（§2.5）。
      if (governedLaunch) {
        await this.completeScenarioGap(taskId, "INTENT_NOT_AVAILABLE", `场景意图「${forcedKey}」不在已发布候选（本视图意图目录为空）`);
        return;
      }
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
    if (forcedKey) {
      const forced = candidates.find((c) => c.key === forcedKey);
      if (forced) {
        const probe = await fillSlots(forced, {}, task.context, this.deps.engine.deps.dataCore.ontology, auth);
        // GOVERNED 卡：即便个别槽位未能从上下文满足也照样确定性绑定——proceedWithIntent 的槽位填充/
        // 确定性 SLOT_FILLING 澄清同样零 classifier（零反问由 grow 验证保障，此处守底不回落 LLM）。
        if (probe.missing.length === 0 || governedLaunch) {
          await this.deps.repos.tasks.patch(taskId, {
            classification: { candidates: [{ intentKey: forced.key, confidence: 1 }], outOfCatalog: false, extractedSlots: {}, latencyMs: 0, model: "deterministic:scenario-bind" },
          });
          await this.proceedWithIntent(taskId, auth, forced, {});
          return;
        }
      } else if (governedLaunch) {
        // GOVERNED 卡的意图不可绑定（被退发布/删除/entitlement 关闭）→ 诚实缺口终结，不碰 classifier。
        await this.completeScenarioGap(taskId, "INTENT_NOT_AVAILABLE", `场景意图「${forcedKey}」不在已发布候选（意图被退发布/删除或功能关闭）`);
        return;
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

    // ③ τ 阈值（融合与决策共用·提前算）
    const tauHigh = pkg.thresholds?.high ?? this.deps.config.QOS_TAU_HIGH;
    const tauLow = pkg.thresholds?.low ?? this.deps.config.QOS_TAU_LOW;

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
    // PRD-upstream-classify-precision §4 (A1)·分类融合暗发开关（QOS_CLASSIFY_FUSE·defaultOn:false·RL2）：
    // ON → fuseClassification（确定性 ⊕ LLM·救回领域术语误判·②补入/③一致性加成/④冲突不硬塞）；
    // OFF → 100% 等价现行 `llmClassification ?? deterministicClassify`（旧路径不删·关闸=改造前系统·可证回退）。
    let classification: ClassificationResult | undefined;
    if (this.deps.config.QOS_CLASSIFY_FUSE === "1") {
      const fuse = fuseClassification(
        llmClassification,
        candidates,
        task.query,
        { high: tauHigh, low: tauLow },
        this.deps.config.QOS_CLASSIFY_FUSE_BETA,
      );
      classification = fuse.result;
      // A4 可观测：确定性补入使查询落 Path A/澄清而非 Path B → 救回计数。
      if (fuse.rescued) this.deps.metrics.classifyFuseRescued.inc();
    } else {
      classification = llmClassification ?? this.deterministicClassify(task, candidates);
    }
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

    // L1-A 需求图引擎（PRD-L1A-requirement-graph-engine §2.1·WO-L1A-3·暗发 QOS_REQUIREMENT_GRAPH·观察态旁路）：
    // classify 落库后、τ 决策前 additive 构「问句→需求图」（纯咨询·**不改判决/路由/answer**·NG6 additive）。
    // 缺省 OFF → 该段不执行 → pipeline 与改造前字节一致（对齐 QOS_CLASSIFY_FUSE 暗发范式·回退演练 C3）。
    if (this.deps.config.QOS_REQUIREMENT_GRAPH === "1") {
      await this.buildRequirementGraphSideband(taskId, auth, task, classification);
    }

    // ③ τ decision（tauHigh/tauLow 已于分类前算出·此处复用）
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
   * L1-A 需求图引擎旁路（PRD §2.1/§4·WO-L1A-3·观察态·暗发 QOS_REQUIREMENT_GRAPH）：
   * 问句 → parseQuestionAst（复用 classify 产物 + slots 三阶梯实体解析·经 OBO REST 读本体）→
   * buildRequirementGraph（八段 Pipeline·三白名单 by-construction）→ 持久化（requirementGraphs repo·R2 tenant）→
   * emit `step.completed{stepId:"requirement-graph"}`（复用既有伪步帧·零新 SSE 事件名·守 QOS-PRD §8.2）。
   *
   * **全 try/catch 吞异常·绝不阻断主链**（RG 是咨询派生产物·NG6 additive）——判决/路由/answer 地位不换手。
   * R6：generatedAt 注入（图内不取时钟·仅事件 durationMs 用时钟·不入图）。隐性需求闭包沿用 L0 entitlement
   * `growth.hidden_req`（关=只显式需求·对齐 preAnalyzeQuery）；真本体图经服务间凭证拉 DataCore（同 L0 来源·无真图诚实降级）。
   */
  private async buildRequirementGraphSideband(
    taskId: string,
    auth: RequestAuth,
    task: QueryTask,
    classification: ClassificationResult,
  ): Promise<void> {
    const t0 = Date.now();
    const generatedAt = new Date().toISOString();
    try {
      await this.deps.events.emit(taskId, "step.started", { stepId: "requirement-graph", type: "requirement-graph" });
      const ontology = this.deps.engine.deps.dataCore.ontology;
      const ast = await parseQuestionAst({
        taskId,
        tenantId: task.tenantId,
        rawText: task.query,
        classification,
        ontology,
        authCtx: auth,
        generatedAt,
      });
      const hiddenReqEnabled = await this.deps.features.isEnabled(task.tenantId, "growth.hidden_req", auth.token);
      const graph = await fetchOntologyGraph(this.deps.config, task.tenantId);
      const rg = buildRequirementGraph({ ast, graph, generatedAt, hiddenReqEnabled });
      await this.deps.repos.requirementGraphs.upsert(rg);
      await this.deps.events.emit(taskId, "step.completed", {
        stepId: "requirement-graph",
        type: "requirement-graph",
        outcome: "built",
        durationMs: Date.now() - t0,
      });
    } catch {
      // 吞异常（观察态·绝不阻断主链）——诚实留痕经 SSE failed 步帧（不静默·铁律0.4），不影响 task 终态/answer。
      await this.deps.events
        .emit(taskId, "step.completed", { stepId: "requirement-graph", type: "requirement-graph", outcome: "failed", durationMs: Date.now() - t0 })
        .catch(() => {});
    }
  }

  /**
   * L1-B WO-L1B-4 规划器影子（PRD §2.2/§4.1·**STAGE-0 shadow ONLY**·观察态·暗发 QOS_EXEC_PLANNER）：
   * 载 L1-A RequirementGraph（有则用·无则跳）→ synthesizePlan（纯函数·R6·注册表入参）→ diffPlannerShadow
   * 对照模板计划落 divergence → 记 sideband（in-process·测试/FDE 读）+ best-effort 搭车既存 PreAnalysisReport.planner。
   *
   * **全 try/catch 吞·绝不阻断答题**（NG6 additive）：判决/路由/answer 地位不换手；不设 graph=synthesized、
   * 不发 SSE 帧（serve/翻闸归 WO-L1B-5）。R6：generatedAt 复用 reqGraph.generatedAt（确定性·双跑字节一致）。
   */
  private async runPlannerShadow(
    taskId: string,
    tenantId: string,
    intent: IntentDefinition,
    plan: ExecutionPlan,
  ): Promise<void> {
    try {
      const reqGraph = await this.deps.repos.requirementGraphs.getByTaskId(tenantId, taskId);
      if (!reqGraph) return; // L1-A 需求图未产（QOS_REQUIREMENT_GRAPH 关）→ 无可影子·诚实跳过

      const registries = await this.loadPlannerRegistries(tenantId, plan);
      const synthesized = synthesizePlan(reqGraph, registries, {
        generatedAt: reqGraph.generatedAt, // R6：复用需求图确定性时刻（内部不取时钟）
        intentKey: intent.key,
        templateFallback: plan, // 覆盖门 <0.8 / 综合非法 → 诚实回落模板（绝不产非法图）
      });
      const divergence = diffPlannerShadow(plan, synthesized);
      const record = buildPlannerShadowRecord(reqGraph, synthesized, divergence);
      await this.recordPlannerShadow(tenantId, taskId, record);
    } catch {
      // 观察态·绝不阻断主链（NG6）——影子失败静默吞（不改 answer/route/decision·shadow 无用户可见留痕）。
    }
  }

  /**
   * WO-L1B-5：装配 synthesizePlan 注册表（IO 在纯函数外·synthesizePlan 本身无 IO·R6）——
   * solverKey 白名单（requirement-graph:check 同源）+ 已发布 Skill/Agent + 本意图模板计划绑定的 skill key
   * （scenarioMatch 因子·无模板则空集）。shadow / serve 共用（不重造）。
   */
  private async loadPlannerRegistries(tenantId: string, plan?: ExecutionPlan): Promise<PlannerRegistries> {
    const skills = (await this.deps.repos.skills.listByTenant(tenantId)).filter((s) => s.status === "PUBLISHED");
    const agents = (await this.deps.repos.agents.listByTenant(tenantId)).filter((a) => a.status === "PUBLISHED");
    const boundSkillKeys = new Set<string>();
    for (const ref of plan?.skillRefs ?? []) {
      const s = skills.find((x) => x.id === ref.skillId);
      if (s) boundSkillKeys.add(s.key);
    }
    return { validSolverKeys: VALID_SOLVER_KEYS, skills, agents, boundSkillKeys };
  }

  /**
   * WO-L1B-5 · serve 翻闸综合图（STAGE-1 fall-through / STAGE-2 白名单共用·§2.2·全 try/catch 吞）：
   * 载 L1-A RequirementGraph → synthesizePlan（纯函数·R6·注册表入参）→ **仅当产出真可执行综合图时返回**。
   * 覆盖门 <0.8 / 综合非法 / 无需求图 / 回落模板（isFallbackGraph）→ 返回 null（调用方回落模板或保持 fall-through·
   * **绝不 emit 非法图·绝不 degrade**）。final validateExecutionGraph 兜底（越界即回 null）。
   * templatePlan：STAGE-2 传模板作 fallback（回落即返 null → 走模板）；STAGE-1 传 null（无模板可回落·回落即返 null → 保持今日 fall-through）。
   */
  private async trySynthesizeServeGraph(
    taskId: string,
    tenantId: string,
    intent: IntentDefinition,
    templatePlan: ExecutionPlan | null,
  ): Promise<ExecutionGraph | null> {
    try {
      const reqGraph = await this.deps.repos.requirementGraphs.getByTaskId(tenantId, taskId);
      if (!reqGraph) return null; // 无需求图（QOS_REQUIREMENT_GRAPH 关）→ 无可综合·回落模板/fall-through
      const registries = await this.loadPlannerRegistries(tenantId, templatePlan ?? undefined);
      const synthesized = synthesizePlan(reqGraph, registries, {
        generatedAt: reqGraph.generatedAt, // R6 确定性时刻（内部不取时钟）
        intentKey: intent.key,
        ...(templatePlan ? { templateFallback: templatePlan } : {}),
      });
      // 覆盖门 <0.8 / 无可综合节点 / 综合非法 → synthesizePlan 已回落（isFallbackGraph）→ serve 返 null（诚实·不 degrade）。
      if (isFallbackGraph(synthesized)) return null;
      // 最终兜底（越界候选/环 zod 未必挡）：非法图绝不服务。
      if (!validateExecutionGraph(synthesized, { solverKeys: registries.validSolverKeys }).ok) return null;
      return synthesized;
    } catch {
      return null; // 任何异常 → 回落模板/fall-through（NG6·绝不阻断/degrade）
    }
  }

  /** 落规划器影子记录：in-process sideband（有界·必落）+ best-effort 搭车既存 PreAnalysisReport.planner（durable·不新建报告）。 */
  private async recordPlannerShadow(
    tenantId: string,
    taskId: string,
    record: PlannerShadowRecord,
  ): Promise<void> {
    // ① in-process sideband（有界 LRU·测试/FDE 内省·零持久化端点变化 → 零用户可见）。
    if (this.plannerShadows.size >= Orchestrator.PLANNER_SHADOW_CAP) {
      const oldest = this.plannerShadows.keys().next().value;
      if (oldest !== undefined) this.plannerShadows.delete(oldest);
    }
    this.plannerShadows.set(taskId, record);
    // ② best-effort durable：仅**已存在**的 PreAnalysisReport 上附 planner（不新建 → GET pre-analysis 404 恒不变·additive）。
    try {
      const existing = await this.deps.repos.preAnalyses.getByTaskId(tenantId, taskId);
      if (existing) await this.deps.repos.preAnalyses.upsert({ ...existing, planner: record });
    } catch {
      /* durable 搭车失败不影响 in-process 观察（诚实降级） */
    }
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
    const scored = candidates
      .map((c) => ({ key: c.key, score: deterministicMatchScore(task.query, c) }))
      .sort((a, b) => b.score - a.score);
    return deterministicClassifyFromScores(scored);
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
      /** CLARIFY-LOOP-CONVERGE：本轮澄清所属意图是否为用户经 INTENT_CHOICE 显式锁定（随轮次传播）。 */
      locked?: boolean;
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
      locked: opts.locked,
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
      // CLARIFY-LOOP-CONVERGE：用户显式选定意图 → 锁定（locked=true）。后续若槽位补全轮次耗尽，
      // 走诚实降级终态而非静默丢进路径 B（见 proceedWithIntent 尾部守卫）。
      setImmediate(() => {
        void this.proceedWithIntent(taskId, auth, intent, task.classification?.extractedSlots ?? {}, {}, true).catch((err) =>
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
    // CLARIFY-LOOP-CONVERGE：把锁定标记随槽位轮次传播（INTENT_CHOICE 选定后的槽位反问仍是锁定态）。
    await this.proceedWithIntent(taskId, auth, intent, extractedPlus, merged, pending.locked ?? false);
  }

  private async proceedWithIntent(
    taskId: string,
    auth: RequestAuth,
    intent: IntentDefinition,
    extracted: Record<string, unknown>,
    presetSlots: Record<string, unknown> = {},
    /**
     * CLARIFY-LOOP-CONVERGE：本意图是否为用户经 INTENT_CHOICE **显式锁定**（默认 false=高把握自动匹配）。
     * 锁定态在槽位轮次耗尽时走诚实降级终态（守卫见下），非锁定保持既有路径 B 语义。
     */
    locked = false,
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;

    // WO MODE-DISPATCH-HONOR（审计簇⑦·mode 钉死表被场景实体架空）：意图已解析的**唯一分发点**上，
    // 尊重一等权威 mode 链——MaterializedIntent.mode（审核方逐意图钉死 13 workflow-first / 7 agent-first·
    // R14 数据驱动非硬编码分派）**先于**场景实体的一揽子 WORKFLOW_FIRST 默认。此前只看 scene.mode →
    // yield_diag 等 agent-first 意图（为什么/哪个好/怎么选）被压回 Path A 工作流表格、真推理永不触发。
    // AGENT_FIRST → 委派该意图绑定的 PUBLISHED agent（agentRun.agentId 持久化·AGENT-UNIVERSAL C2 同坐标系
    // 可审计）；查无一等 Intent / 绑定 agent 不可用 → 回落既有链（Path A·全 -first 保兜底·诚实不硬塞）。
    const authoritative = await this.deps.repos.materializedIntents.byKey(task.tenantId, intent.key);
    if (authoritative?.status === "PUBLISHED" && authoritative.mode === "AGENT_FIRST" && authoritative.bindings.agentId) {
      const boundAgent = await this.deps.repos.agents.get(authoritative.bindings.agentId);
      if (boundAgent && boundAgent.status === "PUBLISHED" && boundAgent.tenantId === task.tenantId) {
        await this.deps.repos.tasks.patch(taskId, {
          matchedIntent: { intentId: intent.id, intentKey: intent.key, version: intent.version },
        });
        await this.runConfiguredAgent(task, auth, boundAgent.id, `意图权威模式 AGENT_FIRST（一等 Intent ${intent.key}）`, intent.key);
        return;
      }
    }

    // LAUNCHER-SLOT-TRUTH ① 形状归一（单一真相源）：分类器 extractedSlots 可能按意图键嵌套
    // `{affected_orders:{base:"合肥"}}`——压扁成本意图的扁平 {slotName:value} 后再填槽，否则本轮显式值被
    // 静默丢弃、落 chip 旧实体（问合肥答常州）。continueSlotFilling 传来的 slotValues 已是扁平槽名，归一为幂等。
    const normalized = normalizeExtractedSlots(extracted, intent);

    const { slots, missing, outOfDomain, sources, substitutions } = await fillSlots(
      intent,
      normalized,
      task.context,
      this.deps.engine.deps.dataCore.ontology,
      auth,
    );
    // A5 感知层埋点：objectRef 解析尝试（分母）+ 域外实体（分子）→ 发独立事件 + 记误触发率。
    const objectRefAttempts = intent.slots.filter(
      (s) => s.type === "objectRef" && normalized[s.name] !== undefined && normalized[s.name] !== null && normalized[s.name] !== "",
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
    const finalSources: Record<string, SlotSource> = { ...sources };
    for (const [k, v] of Object.entries(presetSlots)) {
      if (finalSlots[k] === undefined || finalSlots[k] === null) {
        finalSlots[k] = v;
        finalSources[k] = "preset";
      }
    }
    const stillMissing = missing.filter((m) => finalSlots[m.name] === undefined || finalSlots[m.name] === null);

    if (stillMissing.length > 0) {
      if (task.clarificationRounds >= 2) {
        // CLARIFY-LOOP-CONVERGE：轮次耗尽的分叉——
        // ① 用户经 INTENT_CHOICE **显式锁定**了意图：绝不把该选择静默丢进开放式路径 B（那会丢弃用户
        //    "就问这个意图"的明确意愿、转泛答，正是 Kimi 端到端观察到的低把握"绕圈/不收敛"根因）。
        //    改走**诚实降级终态**：明说该意图缺哪些参数、给出最佳理解、指路如何补齐（COMPLETED·非无限追问）。
        // ② 未锁定（高把握自动匹配后纯槽位反问耗尽）：保持既有路径 B 语义（PRD §5.1.2-4·A5 不回归）。
        if (locked) {
          await this.completeLockedClarifyDegrade(task, intent, stillMissing);
          return;
        }
        await this.runPathB(taskId, auth, task.classification);
        return;
      }
      await this.requestClarification(taskId, auth, {
        kind: "SLOT_FILLING",
        intent,
        slots: finalSlots,
        missing: stillMissing,
        // CLARIFY-LOOP-CONVERGE：锁定态随槽位轮次传播（下一轮回到本方法仍是锁定态）。
        locked,
        payload: {
          // CLARIFY-CHAIN-FIX（簇⑨断①②）：payload 走契约 ClarificationSlot 全量传输——
          // 人话 clarifyPrompt（前端 label 所读字段·非旧 `prompt` 错位名）+ enum 取值 + objectRef 类型。
          kind: "SLOT_FILLING",
          slots: stillMissing.map((s) => toClarificationSlot(s)),
        },
      });
      return;
    }

    await this.deps.repos.tasks.patch(taskId, {
      matchedIntent: { intentId: intent.id, intentKey: intent.key, version: intent.version },
      slots: finalSlots,
    });
    await this.runPathA(taskId, auth, intent, finalSlots, { sources: finalSources, substitutions });
  }

  // -------------------------------------------------------------------------
  // Path A: deterministic workflow (§5.3)
  // -------------------------------------------------------------------------
  private async runPathA(
    taskId: string,
    auth: RequestAuth,
    intent: IntentDefinition,
    slots: Record<string, unknown>,
    slotMeta: { sources: Record<string, SlotSource>; substitutions: SlotSubstitution[] } = { sources: {}, substitutions: [] },
  ): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task) return;
    // WO-SANDBOX-AS-RENDER-TARGET（S1·additive 绞杀式暗发·地标锚定：runPathA 顶部·不碰 Dev-1 L1-B serve/planner 区）：
    // 时序推演意图（sim.shock/hold/trend/policy）+ feature `sim.sandbox_render` 开 → 归一 SimulationRequest → 渲染进沙盘
    // （sandbox_render 答案先行）或诚实短路（hold/trend/policy 待 S6 / 配套缺 gap）。命中即 return（短路·不进既有 plan
    // 解析/serve/executePathATail）；feature 关或非时序意图 → 直落既有 Path A（零回归·旧路径未删 RL9）。
    if (await this.maybeRenderSandbox(task, auth, intent, slots)) return;
    // WO-L1B-5：serve 翻闸档（`QOS_EXEC_PLANNER==="serve"`·暗发）——STAGE-1 fall-through / STAGE-2 白名单综合图服务。
    // 缺省 OFF（未置 / "shadow"）→ 只走影子·serve 分支全不触发（判决地位不换手·NG6·可证回退）。
    const serve = this.deps.config.QOS_EXEC_PLANNER === "serve";

    // 引用模式增量 §2.1：意图 → 计划执行时解析（planRef latest = 当前 PUBLISHED 最新版；pin = 精确版本）
    const resolution = await resolvePlanForIntent(this.deps.repos, intent);
    if (!resolution) {
      // WO-L1B-5 STAGE-1（serve·fall-through·**零回归**）：无模板计划的 intent 今日直接 fail（degrade）。
      // serve 档下若能综合出**真可执行图**（覆盖门≥0.8·非回落）→ 服务综合图跑 runWorkflowDag（真并行/durable
      // 执行器）→ 真求解器真答案（R11 闭包）；综合不出（无需求图/覆盖不足/回落）→ 保持今日 fall-through（诚实·不 degrade）。
      if (serve) {
        const served = await this.trySynthesizeServeGraph(taskId, task.tenantId, intent, null);
        if (served) {
          await this.executePathATail(task, auth, intent, slots, slotMeta, {
            steps: linearizeExecutionGraph(served), // QOS_WORKFLOW_DAG 关时串行 parity 通路（拓扑序）
            graph: served, // QOS_WORKFLOW_DAG 开时走 DAG 拓扑并行
            resolvedRefs: [{ kind: "plan", key: served.graphId, version: 1 }], // 留痕：服务的是综合图（非模板）
          });
          return;
        }
      }
      const refDesc = intent.planRef ? `${intent.planRef.planKey}@${intent.planRef.version}` : intent.planId;
      await this.failTask(taskId, "PLAN_NOT_FOUND", `plan not found: ${refDesc}`);
      return;
    }
    const plan = resolution.plan;
    // §2.2 留痕：执行时解析到的实际版本
    const resolvedRefs: ResolvedRef[] = [{ kind: "plan", key: resolution.ref.key, version: resolution.ref.version }];

    // L1-B WO-L1B-4 规划器影子段（PRD §2.2·QOS_EXEC_PLANNER·shadow + serve 均落 divergence·暗发·可回退）：
    // resolvePlanForIntent（判决态·上方 :plan）**之后**、runWorkflowSteps（下方）**之前**，additive 影子跑
    // synthesizePlan 对照模板计划落 divergence（观察态·测试/FDE 可读）。全 try/catch 吞——规划器失败绝不影响
    // answer/route/decision（NG6）。缺省 OFF（QOS_EXEC_PLANNER 未置）→ 该段不执行 → pipeline 与改造前字节一致。
    if (this.deps.config.QOS_EXEC_PLANNER) {
      await this.runPlannerShadow(taskId, task.tenantId, intent, plan);
    }

    // O10（G-9 收尾）：来自场景卡的查询（context.scenarioKey）→ 卡声明的 rules[] 若未被既有 evaluate_rules 步 /
    // 求解器 evaluatedRules（轨E）覆盖 → 自动插一个 evaluate_rules 步，使卡规则在路径 A 真被评估透出 PASS/WARN/BLOCK。
    let steps = plan.steps;
    const scenarioKey = (task.context as { scenarioKey?: string }).scenarioKey;
    if (scenarioKey) {
      const card = await this.deps.repos.scenarios.byKey(auth.tenantId, scenarioKey);
      if (card?.rules && card.rules.length > 0) steps = injectScenarioRuleStep(steps, card.rules);
    }

    // LAUNCHER-SLOT-TRUTH ②/根B：派生意图的执行计划把求解器入参**种子期烘焙成字面量**（60亿/8周/石墨负极…
    // 结构性不可能被本轮改写覆盖）。此处把**本轮显式抽取**（source=extracted）的槽位值覆盖进 invoke_solver
    // 的同名入参键（仅覆盖 args 中已存在的键，避免注入未知入参；仅 extracted 覆盖，preset/chip 保留烘焙值→
    // 零回归点卡启动）。使"问武汉2170"真进求解器算 2170，而非静默回显烘焙的 4680/成都。
    steps = applyExtractedArgOverrides(steps, slots, slotMeta.sources);

    // WO-L1B-5 STAGE-2（serve·白名单翻闸·配置态·摘除 env=秒级回退）：**仅**白名单 intent 用综合图替换模板；
    // 非白名单 intent 仍用模板（判决地位不换手·NG6）。综合不出真可执行图（覆盖门<0.8/回落/异常）→ 保持模板（诚实·不 degrade）。
    let servedGraph: ExecutionGraph | undefined;
    if (serve && this.plannerWhitelist().has(intent.key)) {
      const g = await this.trySynthesizeServeGraph(taskId, task.tenantId, intent, plan);
      if (g) {
        servedGraph = g;
        // 综合图线性化作 DAG-关串行 parity 通路；仍应用 extracted 槽位覆盖（slot-truth 不因翻闸丢失）。
        steps = applyExtractedArgOverrides(linearizeExecutionGraph(g), slots, slotMeta.sources);
      }
    }

    await this.executePathATail(task, auth, intent, slots, slotMeta, {
      steps,
      graph: servedGraph,
      skillRefs: plan.skillRefs, // SKILL-LIBRARY-EVERYWHERE §3：Path A 计划绑定方法论确定性消费于结论叙事
      resolvedRefs,
    });
  }

  /**
   * runPathA 执行尾段（模板 / STAGE-1 / STAGE-2 共用·不重造终态组装）：patch EXECUTING → 派发执行器
   * （`graph` 存在且 QOS_WORKFLOW_DAG 开 → DAG 拓扑并行；否则 `steps` 串行·parity）→ 终态答案组装 + slot-truth。
   */
  private async executePathATail(
    task: QueryTask,
    auth: RequestAuth,
    intent: IntentDefinition,
    slots: Record<string, unknown>,
    slotMeta: { sources: Record<string, SlotSource>; substitutions: SlotSubstitution[] },
    exec: {
      steps: ExecutionPlan["steps"];
      graph?: ExecutionGraph;
      skillRefs?: ExecutionPlan["skillRefs"];
      resolvedRefs: ResolvedRef[];
    },
  ): Promise<void> {
    const taskId = task.id;
    const resolvedRefs = exec.resolvedRefs;
    await this.deps.repos.tasks.patch(taskId, { status: "EXECUTING_WORKFLOW", path: "WORKFLOW" });
    this.deps.metrics.recordRouting(true);
    await this.deps.events.emit(taskId, "routing.completed", {
      path: "WORKFLOW",
      intentKey: intent.key,
      confidence: task.classification?.candidates[0]?.confidence,
    });

    const budget = new BudgetTracker();
    const result = await this.deps.engine.runWorkflowSteps({
      taskId,
      steps: exec.steps,
      graph: exec.graph, // WO-L1B-5：serve 综合图（DAG 开走拓扑并行·DAG 关忽略走 steps 串行）
      slots,
      context: task.context,
      ctx: auth,
      nesting: { callChain: [], budget },
      emit: (e, p) => this.deps.events.emit(taskId, e, p).then(() => undefined),
      trustLevel: "VERIFIED_WORKFLOW",
      onResolvedRef: (r) => resolvedRefs.push(r),
      skillRefs: exec.skillRefs,
    });

    if (result.status === "FAILED") {
      // ONTO-SCEN-LAUNCH-DET §2.5：场景卡 Path A 运行失败（如求解器被删）→ classifyGap → 开票/通知/
      // 降级卡 + 诚实 gap 块答案（answer.final 先于 task.failed），前端渲染发育卡而非裸错。
      await this.attachScenarioGapAnswer(task, result.error);
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
    const gapAnswer = appendDataGapBlock(result.answer, task.query, taskId);
    // LAUNCHER-SLOT-TRUTH ④/⑤：在答案顶部注入
    //   ⑤ 诚实横幅（若本轮显式给了实体/参数却没绑上、改用了 chip/preset → 明说改用了什么，绝不静默换题）；
    //   ④ 参数回显（本次回答实际所用的关键实体/参数：基地/型号/月份/金额…）→ 错配可见、非静默绿标。
    const echoBlocks = buildSlotTruthBlocks(intent, slots, slotMeta);
    const answer = echoBlocks.length > 0 ? { ...gapAnswer, blocks: [...echoBlocks, ...gapAnswer.blocks] } : gapAnswer;
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

    // WO UPG-L0-SOLVER-COVERAGE C3（single choke·所有 Path B 兜底必经此处）：按**分析型问题类目**打点，
    // 使「哪些问题类目往未验证 Path B 落」可观测（覆盖矩阵接进运行时）。类目取分类首候选意图（未登记→unknown_intent）。
    // 未覆盖类目（无 path-A 求解器）→ 显式发 coverage-gap 事件（诚实报缺口·非静默兜底·驱动 A3 补齐优先级）。
    const problemClass = problemClassForIntent(classification?.candidates?.[0]?.intentKey);
    this.deps.metrics.pathBByProblemClass.inc({ class: problemClass });
    if (problemClass === "unknown_intent" || !isProblemClassCovered(problemClass)) {
      await this.deps.events.emit(taskId, "step.completed", {
        stepId: "coverage-check",
        type: "coverage-gap",
        outcome: "gap",
        problemClass,
      });
    }

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
    // L1.5 WO-L1.5-3B（暗发 memory.cbr_retrieve·R3）：retrieve_similar_cases 工具仅当租户开通该键时对 agent 可见
    // （关→从暴露列表剔除=模型看不到=不存在→agent 行为字节一致 NG6）。memory.cbr_retrieve 已在 AgentCore
    // FEATURE_REGISTRY 双注册（防 unknown-key 恒真陷阱），故可用 featureEnabled（set="ALL" 降级→全开·与 sim 同语义）。
    const cbrRetrieveOn = featureEnabled(enabledFeatures, "memory.cbr_retrieve");
    const budget = new BudgetTracker();
    const priorSummary = agentPriorSummary(await this.previousConversationTasks(task));
    const resolvedRefs: ResolvedRef[] = [];

    try {
      const result = await this.deps.engine.runRegisteredAgent({
        taskId: task.id,
        agentId: SEED_UNIVERSAL_AGENT_ID,
        version: "latest",
        prompt: buildAgentUser(task, priorSummary || undefined),
        question: task.query,
        ctx: auth,
        nesting: { callChain: [], budget },
        emit: (e, p) => this.deps.events.emit(task.id, e, p).then(() => undefined),
        isCancelled: () => this.cancelled.has(task.id),
        onResolvedRef: (r) => resolvedRefs.push(r),
        // R3 暗发：sim 工具关 entitlement → 从暴露列表剔除（模型看不到=不存在）；retrieve_similar_cases 同理受
        // memory.cbr_retrieve 门控（关→剔除→字节一致 NG6）；其余全工具面放行。
        toolVisibilityFilter: (name) => {
          if (simNames.includes(name)) return simCommanderOn;
          if (name === "retrieve_similar_cases") return cbrRetrieveOn;
          return true;
        },
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
      // PROV-REF-INTEGRITY：⟦ref:provId⟧ 是答案实例级标识（每次运行新铸 ULID）——经验条目里既悬停
      // 不可解析、又破坏 R6 同 trace 字节一致蒸馏 → 摘除后再截断。
      const outcome = firstText && firstText.type === "text" ? stripRefMarks(firstText.markdown).slice(0, 240) : "(无文本结论)";
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
    await this.runConfiguredAgent(task, auth, scene.defaultAgentId as string, `场景入口模式 ${scene.mode}`);
  }

  /**
   * 配置化 agent 运行（单一机制·勿两处各写一套）：场景入口 agent（runSceneAgent）与
   * WO MODE-DISPATCH-HONOR 的意图权威 AGENT_FIRST 委派共用——patch 执行态 → routing.completed（note
   * 标明委派来源）→ engine.runRegisteredAgent → agentRun 持久化（C2·agentId 可审计）→ 终态 + 经验回写。
   */
  private async runConfiguredAgent(task: QueryTask, auth: RequestAuth, agentId: string, note: string, intentKey?: string): Promise<void> {
    await this.deps.repos.tasks.patch(task.id, { status: "EXECUTING_AGENT", path: "AGENT" });
    this.deps.metrics.recordRouting(false);
    await this.deps.events.emit(task.id, "routing.completed", { path: "AGENT", ...(intentKey ? { intentKey } : {}), note });

    const budget = new BudgetTracker();
    try {
      // 增量 §1.4：场景入口 agent 同样注入前情摘要（共用同一构建器）
      const priorSummary = agentPriorSummary(await this.previousConversationTasks(task));
      const resolvedRefs: ResolvedRef[] = [];
      const result = await this.deps.engine.runRegisteredAgent({
        taskId: task.id,
        agentId,
        version: "latest",
        prompt: buildAgentUser(task, priorSummary || undefined),
        question: task.query,
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
   * CLARIFY-LOOP-CONVERGE：用户经 INTENT_CHOICE **锁定**的意图在澄清轮次耗尽后仍缺必填参数 → **诚实降级终态**。
   * 不再无限追问、也不静默转开放式路径 B 泛答（那会丢弃用户"就问这个意图"的明确选择、被感知为绕圈不收敛）。
   * 产出：锁定意图名 + 缺失参数的人话清单（clarifyPrompt/description/裸名回落）+ 补齐指路。COMPLETED·非 FAILED
   * （这是可控降级而非错误）。记 matchedIntent（审计：用户确实选定了此意图）。绝不合成/兜底任何业务数字（R6·诚实边界）。
   */
  private async completeLockedClarifyDegrade(
    task: QueryTask,
    intent: IntentDefinition,
    missing: SlotDef[],
  ): Promise<void> {
    const paramLines = missing
      .map((s) => `- ${s.clarifyPrompt?.trim() || s.description?.trim() || s.name}`)
      .join("\n");
    const answer: Answer = {
      trustLevel: "VERIFIED_WORKFLOW",
      blocks: [
        {
          type: "text",
          markdown:
            `我已锁定你要问的是「${intent.name}」，但还差以下参数才能给出精确结果，暂无法作答（不会用估计值糊弄）：\n${paramLines}\n\n` +
            `请在上面补齐这些参数后重问，或换一种更具体的问法（例如直接带上基地/型号/时间等）。`,
        },
      ],
      provenance: [],
      unverifiedNumerics: false,
    };
    await this.deps.repos.tasks.patch(task.id, {
      status: "COMPLETED",
      path: "WORKFLOW",
      matchedIntent: { intentId: intent.id, intentKey: intent.key, version: intent.version },
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
    // ONTO-SCEN-LAUNCH-DET §2.5：场景卡任务失败 → 场景缺口处置（classifyGap→工单/通知/降级卡→诚实发育卡）。
    const scenarioHandled = await this.attachScenarioGapAnswer(task, { code, message });
    // CL.7 GF.2：路径 B agent 硬失败 → 在答案流并入结构化缺口块，对话坞渲染可点缺口卡（▶触发
    // 自成长 LOOP 实诊断+补 → 续推），而非只剩红错叙述。闭 G-3 对话侧（诚实暴露断点）。其余路径（工作流/
    // 校验）维持纯 FAILED。answer.final 先于 task.failed 发出 → useTaskStream 既得 gap 答案又得失败态。
    if (task.path === "AGENT" && !task.answer && !scenarioHandled) {
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

  /**
   * ONTO-SCEN-LAUNCH-DET §2.4/§2.5：GOVERNED 卡确定性启动在**路由期**即不可绑定（意图不在候选）——
   * 不碰 classifier、不落探索：诚实以缺口终结任务（缺口处置钩产出 gap 块答案 + 工单/通知/降级卡）。
   */
  private async completeScenarioGap(taskId: string, code: string, message: string): Promise<void> {
    const task = await this.deps.repos.tasks.get(taskId);
    if (!task || ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return;
    await this.attachScenarioGapAnswer(task, { code, message, stepId: "classify" });
    await this.deps.repos.tasks.patch(taskId, {
      status: "FAILED",
      error: { code, message, stepId: "classify" },
      completedAt: new Date().toISOString(),
    });
    await this.deps.events.emit(taskId, "task.failed", { code, message });
    this.deps.metrics.tasksTotal.inc({ path: task.path ?? "NONE", status: "FAILED" });
  }

  /**
   * §2.5 缺口=生长信号：场景卡任务（非内部验证）不可答 → 经 scenarioGap 钩（server.ts 装配：
   * classifyGap 7 码 → GapReport → GrowthTicket + 通知 + 收件箱 + 降级卡）产出诚实 gap 块答案，
   * patch answer + emit answer.final（先于 task.failed → useTaskStream 既得发育卡又得失败态）。
   * 返回是否已挂载（true=前端将渲染「此卡发育中：缺 X · 已建工单 #N」，不再出现无信息死答）。
   */
  private async attachScenarioGapAnswer(
    taskRef: QueryTask,
    error: { code: string; message: string; stepId?: string },
  ): Promise<boolean> {
    if (!this.scenarioGap || !taskRef.context.scenarioKey || taskRef.internal) return false;
    const task = (await this.deps.repos.tasks.get(taskRef.id)) ?? taskRef;
    if (task.answer) return false;
    try {
      // ONTO-SCEN-GROWTH-LOOP §2.5：随任务携提交身份 → 缺口钩 AUTO_DERIVE 支以真 OBO 身份重验（缺失则钩降级纯开票）。
      const block = await this.scenarioGap({ ...task, status: "FAILED", error }, this.runAuth.get(taskRef.id));
      if (!block) return false;
      const answer: Answer = { trustLevel: "AGENT_EXPLORATORY", blocks: [block], provenance: [], unverifiedNumerics: false };
      await this.deps.repos.tasks.patch(task.id, { answer });
      await this.deps.events.emit(task.id, "answer.final", answer);
      return true;
    } catch {
      return false; // 缺口处置失败不阻断任务终态（fail-safe：宁可少一张发育卡，不卡死任务）
    }
  }

  /**
   * WO-SANDBOX-AS-RENDER-TARGET（S1）· 时序推演意图 → 渲染进沙盘（五触发归一·对话侧）。返回 true=已终态处理（短路）。
   *  - 非时序意图 / feature `sim.sandbox_render` 关 → false（回落既有 Path A·零回归·旧路径未删 RL9）。
   *  - DEFERRED（hold/trend/policy 待 S6·或 scope 缺）→ 诚实文本答案 + COMPLETED（KILL-MOCK-RED 不假跑）。
   *  - deterministic 分类的 shock（classification.model 以 `deterministic:` 开头·关键词级无 LLM 语义）→ DEFERRED
   *    诚实缩范围·不起推演（G-SANDBOX-DET-SHOCK·绝不无 LLM 起推演）。
   *  - READY（真 LLM 分类的 shock）→ S0 配套预检：意图声明的传导规则/状态变量缺 → gap 文本（不渲染静止沙盘·§5.2 诚实）；齐 → sandbox_render 答案先行块。
   */
  private async maybeRenderSandbox(
    task: QueryTask,
    auth: RequestAuth,
    intent: IntentDefinition,
    slots: Record<string, unknown>,
  ): Promise<boolean> {
    if (!isSimIntent(intent.key)) return false;
    if (!(await this.deps.features.isEnabled(task.tenantId, "sim.sandbox_render", auth.token))) return false;

    const selectedObjects = task.context.selectedObjects ?? [];
    // 时序意图常声明零槽（渲染进沙盘·非求解器入参）→ 已填 slots 可能不含 delta/weeks/stateVar；并入 classification
    // 抽取全量（extractedSlots）+ presetSlots，使装配器拿到完整抽取上下文（已填 slots 优先·R6 确定性合并顺序固定）。
    const simSlots: Record<string, unknown> = {
      ...(task.classification?.extractedSlots ?? {}),
      ...(task.context.presetSlots ?? {}),
      ...slots,
    };
    const assembled = assembleSimulationRequest(intent.key, simSlots, selectedObjects);
    if (assembled.status === "NOT_SIM") return false;

    // WO-SANDBOX-SHOCK-NO-FLOOR（用户 2026-07-11 亲定扩红线：绝不无 LLM 起推演）· G-SANDBOX-DET-SHOCK。
    // 只有真 LLM 语义分类的 shock 才起推演。classification.model 以 `deterministic:` 开头（关键词级
    // bigram 匹配·无 LLM 语义）时，assembleSimulationRequest 的对象/stateVar 选取是纯关键词级推演——
    // 诚实缩范围：走 DEFERRED、不装配 shock 沙盘推演（KILL-MOCK-RED·不假跑）。真 LLM 分类（model 非
    // deterministic:*·如 claude-*/provider spec）才继续 READY 装配。hold/trend/policy 已由装配器 DEFERRED，
    // 此处只收紧 shock 的 deterministic 分支。诚实收紧·直接生效（无 defaultOff 闸：红线不容默认关）。
    if (assembled.status === "READY" && (task.classification?.model ?? "").startsWith("deterministic:")) {
      await this.completeSandboxAnswer(task, [
        {
          type: "text",
          markdown:
            "⏳ 该冲击型时序推演由关键词级分类命中（无 LLM 语义分类）。为避免在无 LLM 语义下用关键词级匹配来选取推演对象/状态变量（会产出无据的推演），暂不起推演——诚实缩范围（KILL-MOCK-RED·绝不无 LLM 起推演）。配置可用的 LLM 供应商后即可对该冲击做真语义推演。",
        },
      ]);
      return true;
    }

    if (assembled.status === "DEFERRED") {
      await this.completeSandboxAnswer(task, [{ type: "text", markdown: `⏳ ${assembled.reason}` }]);
      return true;
    }

    // READY（shock）· S0 配套预检（复用 S0 覆盖：意图声明 stateVarKeys/propagationRuleKeys vs DataCore registry-snapshot）。
    const gapText = await this.sandboxConfigPrecheck(task.tenantId, intent.key);
    if (gapText) {
      await this.completeSandboxAnswer(task, [{ type: "text", markdown: gapText }]);
      return true;
    }

    // §5.3 多轮追问→分支布线：本轮是同会话前序时序推演的追问（如"那外协呢?"）→ 标 followUp，
    // 前端沙盘据此 auto-触发 simBranch（A/B 对比·S1 只接通机制·A/B 此刻相同·注入不同应对=S3）。诚实：检测失败不阻断（默认非追问）。
    const followUp = await this.isSandboxFollowUp(task);
    await this.completeSandboxAnswer(task, [
      { type: "text", markdown: assembled.block.headline },
      { ...assembled.block, ...(followUp ? { followUp: true } : {}) },
    ]);
    return true;
  }

  /**
   * §5.3：本轮时序推演是否同会话前序推演的**追问**——同 conversationId 的前序任务里有产过 sandbox_render 答案块
   * 即判 true（多轮"那外协呢?"承接）。纯读·tenant 隔离（previousConversationTasks 已带谓词）·检测异常默认 false（不阻断）。
   */
  private async isSandboxFollowUp(task: QueryTask): Promise<boolean> {
    try {
      const prior = await this.previousConversationTasks(task);
      return prior.some((t) => (t.answer?.blocks ?? []).some((b) => (b as { type?: string }).type === "sandbox_render"));
    } catch {
      return false;
    }
  }

  /** 终态组装（沙盘渲染/诚实短路共用·不重造 answer 组装）：patch COMPLETED + answer + answer.final 事件 + 计数。 */
  private async completeSandboxAnswer(task: QueryTask, blocks: Answer["blocks"]): Promise<void> {
    const answer: Answer = { trustLevel: "VERIFIED_WORKFLOW", blocks, provenance: [], unverifiedNumerics: false };
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
   * S0 配套预检（WO-SANDBOX-CONFIG-COVERAGE 覆盖复用）：意图声明的传导规则/状态变量 vs DataCore 现状快照。
   * 缺 → 返回诚实 gap 文案（不渲染沙盘·免呈现无传导静止态）；齐/未声明/快照不可达 → null（放行·诚实降级不阻断，
   * 沙盘客户端遇缺自行诚实静止）。GrowthTicket 由 S0 后台 preAnalyzeQuery 路径落（growth.pre_analysis 开时·此处不重复开票）。
   */
  private async sandboxConfigPrecheck(tenantId: string, intentKey: string): Promise<string | null> {
    const mi = await this.deps.repos.materializedIntents.byKey(tenantId, intentKey);
    const declaredStateVars = mi?.bindings.stateVarKeys ?? [];
    const declaredRules = mi?.bindings.propagationRuleKeys ?? [];
    if (declaredStateVars.length === 0 && declaredRules.length === 0) return null;
    const snap = await fetchRegistrySnapshot(this.deps.config, tenantId);
    if (!snap) return null; // 快照不可达 → 诚实降级不阻断（不造假缺口）
    const haveSV = new Set(snap.state_var ?? []);
    const havePR = new Set(snap.propagation_rule ?? []);
    const missingSV = declaredStateVars.filter((k) => !haveSV.has(k));
    const missingPR = declaredRules.filter((k) => !havePR.has(k));
    if (missingSV.length === 0 && missingPR.length === 0) return null;
    const parts: string[] = [];
    if (missingPR.length > 0) parts.push(`传导规则「${missingPR.join("、")}」`);
    if (missingSV.length > 0) parts.push(`状态变量「${missingSV.join("、")}」`);
    return `⚠️ 该时序推演的配套尚缺：${parts.join("；")}。需先建模发布这些配套（系数×延迟/派生属性），补齐后即可推演。为避免呈现无传导的静止沙盘，暂不渲染（诚实边界·KILL-MOCK-RED）。`;
  }
}
