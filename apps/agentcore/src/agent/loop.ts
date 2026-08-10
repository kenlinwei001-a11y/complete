import { z } from "zod";
import {
  AnswerBlockSchema,
  type AgentIteration,
  type AgentRunOrigin,
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
import { reflectAnswer, type ReflectVerdict } from "./reflect.js";
import {
  CONTEXT_FULL_REMINDER,
  ContextBudgeter,
  defaultRollingSummary,
  estimateTokensChars,
  firstLineSummary,
  foldOldestFrame,
  isDegradedSummary,
  stripDegradedMark,
  truncateToolResultJson,
  type IterationFrame,
} from "./context.js";

/**
 * WO-AGENTRUN-ATTRIBUTION · 把归属实参投影成 `AgentRunRecord` 的归属字段（**全仓唯一一处**）。
 *
 * 三条不许破的规矩，全部落在这一个函数里（所以只可能对或只可能全错，不会半对）：
 *  ① 不传 `attribution` → 返回 `{}`：一个归属字段都不写。旧记录长什么样，它就长什么样
 *     （"未知"必须可与"确知没有"区分 —— 那是「我没找到 ≠ 它不存在」在数据层的落法）。
 *  ② 传了但没有 `agentId` → `attribution: "EXPLORATORY"`，且 `agentId/agentKey/agentVersion`
 *     **一个都不填**。这是**正面声明**"本次真的没有 Agent 定义"，不是缺数据。
 *  ③ 传了且有 `agentId` → `REGISTERED`，三件套齐上。
 * `createdAt` 无条件跟随归属一起写（此前 run 记录没有任何时间字段，列表只能靠 id 前缀猜时间）。
 */
export function attributionFields(a: AgentRunAttributionInput | undefined): Partial<AgentRunRecord> {
  if (!a) return {};
  return {
    ...(a.tenantId ? { tenantId: a.tenantId } : {}),
    ...(a.agentId
      ? {
          agentId: a.agentId,
          ...(a.agentKey ? { agentKey: a.agentKey } : {}),
          ...(a.agentVersion !== undefined ? { agentVersion: a.agentVersion } : {}),
          attribution: "REGISTERED" as const,
        }
      : { attribution: "EXPLORATORY" as const }),
    createdAt: new Date().toISOString(),
  };
}

/**
 * WO-AGENTRUN-FANOUT-PERSIST · 编排位置字段的**全仓唯一**投影（与 `attributionFields` 同一条纪律）。
 *
 * 为什么也走单点：`origin` 决定 `getByTask` 会不会把一条子运行当成"这个任务的运行"返给
 * `/queries/:taskId/agent-run` 与 `evals.ts` 的 token 记账。各写各的一旦漂，症状是
 * **读端悄悄换了一条记录**（返回的是三个角色里随机某一个），而不是报错 —— 那种病最难查。
 */
export function originFields(o: AgentRunPlacementInput | undefined): Partial<AgentRunRecord> {
  if (!o) return {};
  return {
    origin: o.origin,
    ...(o.stepId ? { stepId: o.stepId } : {}),
  };
}

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

/**
 * WO-AGENTRUN-ATTRIBUTION · 归属实参（**调用方是唯一知情人**）。
 *
 * 为什么放在 loop 里回填、而不是各 `agentRuns.insert` 点各自 spread 一份：
 * insert 点有三处（`orchestrator.ts` 2075/2364/2614），各填各的必然漂 —— 而且其中一处
 * （runPathB）根本没有 AgentDefinition 可填，写在那里只会诱使人"就近找个 id 塞进去"。
 * 归属与运行数据在这里**同一次构造**（`finishRun`），要么一起有要么一起没有。
 *
 * `agentId` 有值 ⇒ `REGISTERED`；无值 ⇒ `EXPLORATORY`（正面声明"本次真的没有 Agent 定义"）。
 * **整个 `attribution` 不传 ⇒ 记录上一个归属字段都不写**（未知，不冒充 EXPLORATORY）。
 */
export interface AgentRunAttributionInput {
  tenantId?: string;
  agentId?: string;
  agentKey?: string;
  agentVersion?: number;
}

/**
 * WO-AGENTRUN-FANOUT-PERSIST · 编排位置实参（**调用方是唯一知情人**，与归属同理）。
 *
 * loop 自己看不出「我是任务本身那次循环，还是被某个 invoke_agent 步扇出的子 agent」——
 * 两种情形传进来的 `taskId` 是**同一个**（子 agent 挂在父任务的 taskId 上，事件/工具调用才串得起来）。
 * 所以位置必须由调用方声明：编排层三处顶层 insert 点传 `ROOT`，
 * `engine.runWorkflowSteps` 的 `runAgentStep` 传 `FANOUT` + 扇出它的步 id。
 */
export interface AgentRunPlacementInput {
  origin: AgentRunOrigin;
  stepId?: string;
}

export interface AgentLoopOpts {
  taskId: string;
  model: string;
  /** Tenant scope for multi-provider model resolution (RoutingLlmClient). */
  tenantId?: string;
  /** WO-AGENTRUN-ATTRIBUTION（additive·可选）：本次运行归属到哪个 Agent 定义（不传 = 不写归属字段）。 */
  attribution?: AgentRunAttributionInput;
  /** WO-AGENTRUN-FANOUT-PERSIST（additive·可选）：本次运行在编排结构里的位置（不传 = 不写位置字段）。 */
  placement?: AgentRunPlacementInput;
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
  /** WO-SKILL-2：聚合后的 provenance 策略（required|best_effort|none），缺省 best_effort。 */
  provenancePolicy?: "required" | "best_effort" | "none";
  /** WO-SKILL-2：true 表示挂载了写操作型 Skill，final_answer 必须含 action_draft。 */
  writeMode?: boolean;
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
  /**
   * G-9：per-call 有界超时（ms）。每轮 llm.agent()/executor.run() 的 deadline =
   * min(本值, budget 剩余时长)。缺省取 maxDurationMs（=不额外收紧单次调用，仅受 budget 兜底）。
   * 防某次调用挂住导致整任务 hang（budget.durationExceeded 只在轮首查一次）。
   */
  llmCallTimeoutMs?: number;
  /**
   * WO-QOS-2 · 规划式执行 plan 自检：本题导航图（NavigationSlice）投影出的对口 solver key 集。
   * 传入即启用「plan-then-execute」自检——某轮模型批量发起的 invoke_solver（= 一次性 plan）里引用的 solver
   * 若全部落在图内 = 采纳规划式快路径；有越界 = 该 solver 不在本题图 → 记 planFellBackToReAct（**不阻断真工具**·
   * ReAct 兜底，模型可继续逐跳）。缺省（不传）= 逐字节沿用既有 ReAct（既有全部 agent 测试不受影响）。
   */
  sliceSolverKeys?: string[];
  /**
   * WO-REFLECT-LOOP · 收尾前反思步开关（**暗发·默认关**→ 不传即零回归·既有全部 agent 测试逐字节不变）。
   * 开启后：模型将调 final_answer 收尾时先过一遍确定性复盘（reflect.ts）——不过关则回注原因、硬有界重规划一轮再复盘。
   * 仅 path-B `runAgentLoop` 生效（path-A/compose 直出不经此循环）。生产接线（据 entitlement 开关）由 orchestrator 侧注入（WO-0 领域·本单不碰）。
   */
  reflect?: boolean;
  /** 反思不过关时的重规划轮次上界（硬有界·默认 1）。 */
  replanBudget?: number;
  /**
   * 可选 LLM critic（entitlement `agent.critic`·暗发）：确定性复盘之后的 advisory 复核——返回 {ok,reason}。
   * **fail-open**：未注入 / 抛错 → 只用确定性复盘结论（绝不阻断循环·R6 主判仍确定）。
   */
  critic?: (input: { blocks: AnswerBlock[]; userContent: string }) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * WO-REASONING-TRACE（暗发 `qos.reasoning-trace`·建人机信任）：开启后把每轮"思考旁白"（模型在工具调用之间产出的
   * 自由文本 = ReAct 的 thought）经 `step.completed` 伪 step（`type=agent_narration`·**不新增 §8.2 事件名**）实时流给前端，
   * 让用户看到"agent 为什么下一步调这个工具"。缺省 false → 零回归（不发·既有 agent 测试字节不变）。
   */
  emitNarration?: boolean;
  /**
   * WO-LOOP-CONTROL-P1 · Loop Detector 环检测 cap（**opt-in·缺省禁用=现行为字节兼容**）。设正整数 N → 某 callSignature
   *（工具名 + 稳定序列化入参）累计调用 ≥ N → 视为无进度环 → 优雅降级 STALL_LOOP（补 S01「成功但空转」洞）。
   * 生产经 config `QOS_AGENT_LOOP_REPEAT_CAP` 注入（推荐 3）；undefined/≤0 = 不检测（既有全部治理测逐字节不变·R6）。
   */
  loopRepeatCap?: number;
  /**
   * WO-LOOP-CONTROL-P2 · per-tool 调用上界（PRD §3.3·机制 #3·**opt-in·缺省 undefined/≤0=不限=现行为字节兼容**）。
   * 设正整数 N → 某工具（按名）累计调用达 N → 置 `budget.exhausted` → 下一轮 `budget.exhausted` 守卫优雅降级
   *（补 P1 loop-hash「同参重复」外的「同工具**异参**刷屏」）。生产经 config `QOS_AGENT_PER_TOOL_CALL_CAP` 注入（推荐 8）。
   */
  perToolCallCap?: number;
  /**
   * WO-LOOP-CONTROL-P2 · Retry Manager（PRD §3.2·机制 #4·**opt-in·缺省 undefined=0 次重试=现行为字节兼容**）。
   * `maxAttempts` = 瞬时/传输层错的**最大重试次数**（额外尝试·不含首次）。retryable 回执且重试未尽 → 有界重试
   *（退避复用 per-call deadline·不新起定时器）→ 成功则不入停滞计数；确定性错/重试耗尽 → 立即入停滞（现行为）。
   */
  retry?: { maxAttempts: number };
  /**
   * WO-LOOP-CONTROL-P2 · Escalation Ladder（PRD §3.4·机制 #7·**暗发 `agent.escalation`·缺省 false=直接降级=现行为字节兼容**）。
   * 开启后：停滞（P1 hash 触顶 / S01 连续失败）时先走一级阶梯——rung① 换提示策略再试一轮（注入换角度 nudge + 复位停滞计数
   * 一次 + 发 `step.completed{type=agent_escalated}` 伪 step·**早于** degrade·不新增 §8.2 事件名）；仍停滞 → rung③ 落既有
   * `degrade`（rung② 升级 Coordinator 延后·见 WO 裁定 1·本单不在叶子造扇出）。一次性（`escalated` 状态位·mirror forceFinishNotified）。
   */
  escalation?: boolean;
}

export interface AgentLoopResult {
  outcome: "ANSWERED" | "FAILED" | "BUDGET_EXHAUSTED";
  answer: Answer;
  /** Raw structured final_answer input when expectsSchema was provided. */
  structured?: unknown;
  run: AgentRunRecord;
  sketch: { toolName: string; inputSummary: string }[];
  /**
   * G-9：本次运行因"有界终止"降级收尾时置位（TIMEOUT=某次调用挂住被 abort；
   * BUDGET_EXHAUSTED=预算/轮次耗尽；STALL_LOOP=WO-LOOP-CONTROL-P1 环检测·同签名反复调用无进度）。
   * 编排层据此在 answer.final 之前发 agent_degraded 伪 step（outcome 取 reason·前端零改）。
   */
  degraded?: { reason: "TIMEOUT" | "BUDGET_EXHAUSTED" | "STALL_LOOP" };
  /**
   * WO-LOOP-CONTROL-P2.5 · Escalation Ladder rung②（orchestrator 层升级重路由）可判别停滞信号：
   * 仅当 **escalation 开** 且 rung① 已用尽（`escalated` 已置位）后单 agent 仍停滞时置位——上抛给 runPathB 决定是否
   * 反应式重路由到 Coordinator 扇出（早于 degrade 兜底）。escalation 关 → 恒 undefined（逐字节同 P2·byte-compat）。
   * **注意**：本字段仅为编排层可判别标记，不改 degrade 收尾块/答案/溯源（degrade 仍是 loop.ts 唯一诚实出口·R7/R13）。
   * reason：STALL_LOOP=P1 hash 环触顶后仍停滞；STALL_CONSECUTIVE=S01 连续失败停滞。
   */
  stalled?: { reason: "STALL_LOOP" | "STALL_CONSECUTIVE" };
  /**
   * WO-QOS-2：仅当传入 sliceSolverKeys 时有值——本次运行中是否出现过「plan 引用了图外 solver」而回退 ReAct
   *（true = 至少一轮越界·false = 全程 plan 落在图内）。观测用（不改答案/溯源）。
   */
  planFellBackToReAct?: boolean;
  /**
   * WO-REFLECT-LOOP：仅当 opts.reflect 开启时有值——本次收尾是否经反思复盘拦下并重规划过
   *（对齐 planFellBackToReAct 手法·观测用·不改数字/溯源）。
   */
  reflected?: boolean;
  /** 反思不过关的原因（末次复盘的 reasons 拼接·观测/交底用）。 */
  replanReason?: string;
}

/**
 * WO-QOS-2 · plan 自检（纯函数 R6）：本轮模型批量发起的 invoke_solver 引用的 solver key 是否**全部**落在
 * NavigationSlice 图内。全部在 → 采纳规划式快路径；有越界 → 回退 ReAct（调用方不阻断真工具·仅记观测）。
 * 空 turnSolverKeys（本轮没调 solver）→ 视为在图内（true）；未提供图（sliceSolverKeys 空）→ 不判定（true）。
 */
export function planWithinSlice(turnSolverKeys: string[], sliceSolverKeys: string[]): boolean {
  if (sliceSolverKeys.length === 0 || turnSolverKeys.length === 0) return true;
  const inSlice = new Set(sliceSolverKeys);
  return turnSolverKeys.every((k) => inSlice.has(k));
}

/** G-9：AbortController abort 或 SDK 抛出的 AbortError/TimeoutError 的统一识别。 */
function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name;
  return name === "AbortError" || name === "TimeoutError";
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

/**
 * WO-AGENT-RUNTIME-S01 · 停滞早停阈值（治病根：workflow_capacity_check DENIED + invoke_solver ERROR + 反复 query_objects
 * 烧满预算 ~5min 像卡死）。连续工具失败（ERROR/DENIED）计数 ≥ STALL_CONSECUTIVE_FAILURES **且** 近 ≥ STALL_MIN_ROUNDS
 * 轮零成功工具产出 → 立即优雅降级（复用既有 BUDGET_EXHAUSTED 降级路径），不烧完预算。
 * 双条件（连续失败数 + 近 N 轮零成功）联合判定 = 防误伤「先错后恢复」的正常流：任一成功工具产出即复位两计数器。
 */
const STALL_CONSECUTIVE_FAILURES = 3;
const STALL_MIN_ROUNDS = 2;

/**
 * WO-LOOP-CONTROL-P1 · Loop Detector 环检测（补 S01「成功但空转」最后一个洞）：S01 只认"失败"——若 agent 反复以
 * **相同参数**调用**同一工具**（如 `query_objects(type=Order,filter=X)`）每次都"成功"返回相同（空）结果 → roundHadSuccess
 * 恒真 → S01 两计数器复位 → 永不触发停滞 → 一路烧到 maxIterations。本检测对每个真实 tool_use 算 `callSignature =
 * fnv1a(工具名 + 稳定序列化入参)`，维护 Map<签名,count>；某签名 count ≥ 有效 cap → 视为**无进度环** → 优雅降级
 * STALL_LOOP（复用唯一诚实出口 degrade·非 500·R7/R13）。**opt-in·缺省禁用**：`opts.loopRepeatCap` 未设/≤0 → 不检测
 *（既有全部治理测逐字节不变·R6 字节兼容）；生产经 config `QOS_AGENT_LOOP_REPEAT_CAP` 注入（推荐 3·mirror
 * `QOS_AGENT_MAX_ROUND_TRIPS` 的 opt-in 语义）。**不误伤**：签名含入参 → 不同入参的合法多次调用各自独立计数不累加。
 */
const LOOP_REPEAT_CAP_DEFAULT = 3;

/**
 * 稳定序列化（键排序·R6：无 `Date.now()`/`Math.random()`/时钟）：同一 input 恒得同一字符串，供环检测签名。
 * JSON.stringify 不保证对象键序稳定；此处对对象键排序后递归序列化，确保 `{a:1,b:2}` 与 `{b:2,a:1}` 同签名。
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * FNV-1a 32-bit（与 `util/embedding.ts` 同族·纯函数·无副作用/时钟/随机·R6）→ callSignature 十六进制串。
 * budget.ts 无现成 FNV-1a（PRD 假设有误·本单实测确认）；此处自写小纯 FNV-1a，与 embedding.ts 的 0x811c9dc5/
 * 0x01000193 参数一致（Math.imul 保 32 位溢出语义）。
 */
function callSignature(name: string, input: unknown): string {
  const s = `${name}\u0000${stableStringify(input)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

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
/**
 * WO-REFLECT-LOOP · 复盘 = 确定性 `reflectAnswer`（R6 主判）+ 可选 LLM critic（entitlement agent.critic·advisory）。
 * critic 未注入 / 抛错 → 只用确定性结论（**fail-open**·绝不阻断循环）；critic 判不过 → 追加一条 reason。
 */
async function reflectWithCritic(
  answer: Answer,
  opts: AgentLoopOpts,
  iterations: AgentIteration[],
): Promise<ReflectVerdict> {
  const base = reflectAnswer({
    blocks: answer.blocks,
    provenanceCount: answer.provenance.length,
    iterations,
    userContent: opts.userContent,
  });
  if (!opts.critic) return base;
  try {
    const c = await opts.critic({ blocks: answer.blocks, userContent: opts.userContent });
    if (!c.ok) return { ok: false, reasons: [...base.reasons, `LLM critic：${c.reason ?? "复核未过"}`] };
  } catch {
    // fail-open：critic 抛错不影响确定性主判（R6 复盘仍生效）。
  }
  return base;
}

export async function runAgentLoop(opts: AgentLoopOpts): Promise<AgentLoopResult> {
  const messages: LlmAgentMessage[] = [{ role: "user", content: opts.userContent }];
  const iterations: AgentIteration[] = [];
  const sketch: { toolName: string; inputSummary: string }[] = [];
  // Phase7C 消息级滚动摘要：折叠轮次的蒸馏素材在此累积，每轮压成「前情摘要」注入 system。
  // summarizer 可插拔（Phase8 生产可注入 LLM 摘要器，返回 Promise）；缺省确定性拼接（CI 可复现）。
  const rollingNotes: string[] = [];
  const summarize = opts.summarizer ?? defaultRollingSummary;
  const noteOfFrame = (f: IterationFrame) => `第${f.iteration + 1}轮[${f.tools.map((t) => `${t.name}:${t.firstLine}`).join("；")}]`;
  let summaryCache = "";
  let summaryLen = -1; // 仅当折叠轮数增加时重算摘要（LLM 摘要器调用次数 ≈ 折叠次数）
  const effectiveSystem = async (): Promise<string> => {
    if (rollingNotes.length === 0) return opts.system;
    if (rollingNotes.length !== summaryLen) {
      summaryCache = await summarize(rollingNotes);
      summaryLen = rollingNotes.length;
    }
    // WO-SEAM-COMPACT-REDLINE G3：摘要器判失效时（compose 抛错 / 返空 / 未过锚定校验）措辞必须与常态**可区分**。
    // 常态那句是「可信度声明」；异常态还要多说一件事：**更早轮次确立的约束可能已经不在这段里了**——
    // 压缩是不可逆有损变换，兜底拼接保不住语义，这时候让模型「照摘要答」正是静默错答的入口。
    if (isDegradedSummary(summaryCache)) {
      return `${opts.system}\n\n【前情摘要（⚠ 蒸馏失效，已回退确定性拼接）：本段可信度低，且**更早轮次确立的约束/红线可能已随压缩丢失**。业务事实一律以工具结果为准；若需引用早期约束，必须重新取证，不得据本段推断】\n${stripDegradedMark(summaryCache)}`;
    }
    return `${opts.system}\n\n【前情摘要（已折叠轮次蒸馏，仅供回忆；业务事实仍以工具结果为准）】\n${summaryCache}`;
  };
  const frames: IterationFrame[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let lastText = "";
  let consecutiveDenies = 0;
  // WO-AGENT-RUNTIME-S01 · 停滞早停计数（连续工具失败 ERROR/DENIED；近 N 轮零成功产出）——任一成功工具产出即复位两者。
  let consecutiveToolFailures = 0;
  let roundsWithoutSuccess = 0;
  let forceFinishNotified = false;
  // WO-QOS-2：规划式执行观测——某轮 plan（批量 invoke_solver）引用了图外 solver 而回退 ReAct 时置位（仅当 opts.sliceSolverKeys 传入）。
  let planFellBackToReAct = false;
  // 增量 §1.3 第 3 刀：收尾提醒已注入（finalizePending = 本轮就是「最后机会」轮）
  let finalizeUsed = false;
  let finalizePending = false;
  // WO-FIX-REASONING-CONTENT：本轮强制 final_answer 工具选择（收尾/兜底轮），发出即复位（只强制一轮）。
  let forceFinalAnswer = false;
  // 推理型模型"在推理通道给结论却漏调 final_answer"的补救只做一次（避免与降级路径互斥死循环）。
  let finalAnswerNudged = false;
  // WO-REFLECT-LOOP：反思步状态（仅 opts.reflect 开启时用）。replanBudget 硬有界（默认 1）。
  const replanBudget = Math.max(0, opts.replanBudget ?? 1);
  let replansUsed = 0;
  let reflected = false;
  let lastReplanReason = "";
  // WO-LOOP-CONTROL-P1 · Loop Detector 环检测状态（opt-in·repeatCap≤0 = 禁用 = 现行为字节兼容）。
  const repeatCap = opts.loopRepeatCap && opts.loopRepeatCap > 0 ? opts.loopRepeatCap : 0;
  const callSignatureCounts = new Map<string, number>();
  // WO-LOOP-CONTROL-P2 · per-tool 调用上界（opt-in）：设入 budget（缺省不设=不限=现行为字节兼容）。补 P1 hash「同参重复」外的「异参刷屏」。
  if (opts.perToolCallCap !== undefined && opts.perToolCallCap > 0) opts.budget.perToolCallCap = opts.perToolCallCap;
  // WO-LOOP-CONTROL-P2 · Retry Manager 最大重试次数（opt-in·0=不重试=现行为字节兼容）。
  const retryMaxAttempts = opts.retry && opts.retry.maxAttempts > 0 ? opts.retry.maxAttempts : 0;
  // WO-LOOP-CONTROL-P2 · Escalation Ladder 一次性状态位（暗发 escalation·mirror forceFinishNotified·升级至多一次·仍停滞即诚实降级）。
  let escalated = false;
  // WO-LOOP-CONTROL-P2.5 · rung② 可判别停滞标记（仅在 rung① 用尽后的停滞点置位·由 degrade 在 escalation 开时挂到结果 stalled 上抛
  // 编排层·关=永 undefined=逐字节同 P2）。不改 degrade 收尾块/答案/溯源——degrade 仍是唯一诚实出口。
  let stalledForReroute: { reason: "STALL_LOOP" | "STALL_CONSECUTIVE" } | undefined;

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
    // WO-AGENTRUN-ATTRIBUTION · 归属与运行数据同源同一次构造（全仓唯一回填点）。
    ...attributionFields(opts.attribution),
    // WO-AGENTRUN-FANOUT-PERSIST · 编排位置同上（ROOT / FANOUT + 扇出它的步 id）。
    ...originFields(opts.placement),
  });

  /**
   * G-9：从已探索轨迹确定性合成"部分发现"——**只复述工具查到什么，不下结论、不造数**。
   * 优先 lastText（模型末次自由文本）；否则从 sketch（本轮工具调用）去重复述；再退到 rollingNotes（折叠蒸馏）。
   */
  const synthesizePartialFindings = (): string => {
    if (lastText.trim()) return lastText;
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const s of sketch) {
      const key = `${s.toolName}｜${s.inputSummary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- 调用 ${s.toolName}（入参 ${s.inputSummary}）`);
    }
    if (lines.length === 0 && rollingNotes.length > 0) {
      for (const n of rollingNotes) lines.push(`- ${n}`);
    }
    if (lines.length === 0) return "（探索过程中未取得可复述的工具结果）";
    return `已探索线索（仅复述调用轨迹，未形成最终结论）：\n${lines.join("\n")}`;
  };

  /**
   * 优雅降级收尾。reason 存在 = 有界终止（TIMEOUT/BUDGET_EXHAUSTED）→ 置 degraded 供编排层发 agent_degraded 事件，
   * 并按 reason 计数（TIMEOUT→agentTimeout；否则 BUDGET_EXHAUSTED→agentBudgetExhausted，计数口径不变）+ 出诚实"未能完全解答"块。
   * reason 缺省（ANSWERED 软收尾 / FAILED 取消）→ 不发降级事件、不计 timeout（沿用旧兜底文案）。
   */
  const degrade = async (
    outcome: "ANSWERED" | "BUDGET_EXHAUSTED" | "FAILED",
    reason?: "TIMEOUT" | "BUDGET_EXHAUSTED" | "STALL_LOOP",
  ): Promise<AgentLoopResult> => {
    const blocks: AnswerBlock[] = [];
    // WO-Phase4/P1：有界终止（TIMEOUT/BUDGET_EXHAUSTED/STALL_LOOP）收尾——诚实摘要前缀 + 复用「部分发现」抢救（不造数）+ provenance 列已调工具。
    if (reason) {
      const budgetNote =
        reason === "STALL_LOOP"
          ? `反复以相同参数调用同一工具、未获新信息（环检测·loopRepeatCap=${opts.loopRepeatCap ?? LOOP_REPEAT_CAP_DEFAULT}）`
          : opts.budget.exhaustedReason ??
            (reason === "TIMEOUT" ? "单次调用超出有界时限" : `round-trip/迭代上界（已 ${opts.budget.roundTrips} 轮）`);
      const header =
        reason === "TIMEOUT"
          ? `[预算耗尽·诚实摘要] ⚠️ 探索超时：本次深问未能完全解答（${budgetNote}，已诚实终止）。以下为已探索到的线索：`
          : reason === "STALL_LOOP"
            ? `[预算耗尽·诚实摘要] ⚠️ 检测到无进度循环：${budgetNote}——本次深问未能完全解答（已诚实终止，未烧尽预算）。以下为已探索到的线索：`
            : `[预算耗尽·诚实摘要] ⚠️ 已达最大探索轮次/预算（${budgetNote}）：本次深问未能完全解答。以下为已探索到的线索：`;
      blocks.push({ type: "text", markdown: header });
      blocks.push({ type: "text", markdown: synthesizePartialFindings() });
    } else {
      blocks.push({ type: "text", markdown: lastText || "（探索模式未能产出回答）" });
    }
    const unverified = scanBlocks(blocks); // 未验证数字护栏（复述里若含裸数 → 标记，不放水）
    if (unverified) opts.metrics.unverifiedNumerics.inc({ path: "AGENT" });
    if (reason === "TIMEOUT") opts.metrics.agentTimeout.inc();
    else if (reason === "STALL_LOOP") opts.metrics.agentLoopRepeat.inc(); // P1 环检测归因（与 timeout 同款：只计专属 counter）
    else if (outcome === "BUDGET_EXHAUSTED") opts.metrics.agentBudgetExhausted.inc();
    // WO-Phase4 · R13：有界终止摘要复述已调工具 → provenance 列所有成功产出结果的 toolCallId（去重·仅 OK 调用·
    // 无成功调用则为空 = 诚实 NO_ANSWER，不编造溯源）。软收尾（无 reason）沿用既有空 provenance。
    const provenance: ProvenanceRef[] = [];
    if (reason) {
      const seen = new Set<string>();
      for (const it of iterations) {
        for (const c of it.toolCalls) {
          if (c.outcome !== "OK" || seen.has(c.toolCallId)) continue;
          seen.add(c.toolCallId);
          provenance.push({ id: newId("prov"), source: "TOOL_RESULT", toolCallId: c.toolCallId, toolName: c.toolName, outputPath: "$" });
        }
      }
    }
    return {
      outcome,
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: unverified },
      run: finishRun(outcome === "BUDGET_EXHAUSTED"),
      sketch,
      ...(reason ? { degraded: { reason } } : {}),
      // WO-LOOP-CONTROL-P2.5：escalation 开 + rung① 已用尽后仍停滞 → 上抛可判别 stalled（供 runPathB 决定 rung② 重路由·早于
      // 兜底）。escalation 关 / 非停滞出口（TIMEOUT / 硬预算 duration/roundTrip / ANSWERED / FAILED）→ stalledForReroute 未设 →
      // 无此字段 → 逐字节同 P2（byte-compat·degrade 答案本体不变）。
      ...(opts.escalation && stalledForReroute ? { stalled: stalledForReroute } : {}),
    };
  };

  /**
   * WO-LOOP-CONTROL-P2 · Escalation Ladder rung①（PRD §3.4·暗发·一次性·**升级而非只降级**）：停滞时先「换提示策略再试一轮」
   * 而非直接认输——注入换角度 nudge（复用 discover·mirror consecutiveDenies forceFinish nudge）+ 复位停滞计数一次 + 发
   * `step.completed{type=agent_escalated}` 伪 step（**早于** degrade·复用既有 step.completed·**不新增 §8.2 事件名**·前端零改）。
   * 返回 true → 调用方 `continue` 再跑一轮（rung① 换策略轮）；返回 false（feature 关 / 已升级过）→ 调用方落既有 `degrade`
   *（rung③ 认输·唯一诚实出口·字节兼容）。R6：主判为确定性状态位（emit 的 durationMs 仅审计时长·不入答案/溯源）。
   * rung②（升级 Coordinator）延后（WO 裁定 1·叶子不造扇出）——本单只交 rung①+rung③。
   */
  const maybeEscalate = async (iter: number): Promise<boolean> => {
    if (!opts.escalation || escalated) return false;
    escalated = true;
    opts.metrics.agentEscalation.inc();
    await opts.emit("step.completed", {
      stepId: `escalate-${iter}`,
      type: "agent_escalated",
      outcome: "RETRY_STRATEGY",
      durationMs: opts.budget.elapsedMs(),
    });
    messages.push({
      role: "user",
      content:
        "你已多轮无进展或反复失败。换个角度重来：先调用 discover(kind=\"object_types\")（或 discover(kind=\"solvers\")）" +
        "拿到本租户真实对象类型名/可用求解器，再据此换条件重查，避免重复相同的无效调用。",
    });
    // 复位停滞计数一次（给换策略轮一个干净起点·仅本次·后续再停滞→degrade·升级不可无限）。
    consecutiveToolFailures = 0;
    roundsWithoutSuccess = 0;
    callSignatureCounts.clear();
    return true;
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
    // G-9：per-call 有界超时也覆盖工具调用（令 executor.withTimeout 对 EXTERNAL/MCP 生效）——
    // deadline = min(llmCallTimeoutMs ?? maxDurationMs, budget 剩余)；超时被 executor 收敛为 {ok:false} ERROR tool_result。
    const remainingMs = opts.budget.budget.maxDurationMs - opts.budget.elapsedMs();
    const callTimeoutMs = Math.max(1, Math.min(opts.llmCallTimeoutMs ?? opts.budget.budget.maxDurationMs, remainingMs));
    // WO-LOOP-CONTROL-P2 · Retry Manager（PRD §3.2·机制 #4）：瞬时/传输层错（executor 回执 retryable=true·DataCore 不可达/
    // MCP 传输抖动）有界重试至多 retryMaxAttempts 次（退避复用同一 per-call deadline callTimeoutMs·**不新起定时器体系**）——
    // 重试成功（OK）→ 下游 roundHadSuccess 复位停滞计数（= 瞬时错**不入停滞**）；确定性错（retryable=false）不重试立即入停滞（现行为）。
    let r = await opts.executor.run(block.name, block.input, { binding, budgetDecision, timeoutMs: callTimeoutMs });
    for (let attempt = 0; r.retryable && attempt < retryMaxAttempts; attempt++) {
      opts.metrics.agentRetry.inc();
      r = await opts.executor.run(block.name, block.input, { binding, budgetDecision, timeoutMs: callTimeoutMs });
    }
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
    if (opts.budget.durationExceeded()) return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
    // WO-Phase4 · 硬预算兜底（确定性 R6·不依赖 LLM 输出内容）：探索类工具预算被 executor 消尽（exhausted）或
    // round-trip 上界已达 → 立即优雅降级收尾（复用 finalize-force / 部分发现抢救路径），不再空转。
    if (opts.budget.exhausted) return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
    if (opts.budget.roundTripsExceeded()) return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
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
        if (finalizeUsed) return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
        finalizeUsed = true;
        finalizePending = true;
        forceFinalAnswer = true; // WO-FIX-REASONING-CONTENT：收尾轮强制 final_answer（防推理模型漏调 → 无谓降级）
        budgeter.record("force_finalize", i, "hard threshold");
        messages.push({ role: "user", content: CONTEXT_FULL_REMINDER });
      }
    }

    // G-9：per-call 有界超时 —— 为本轮 agent() 建 AbortController + deadline，
    // deadline = min(llmCallTimeoutMs ?? maxDurationMs, budget 剩余)；挂住则 abort → catch 里优雅降级（不 throw）。
    const remainingMs = opts.budget.budget.maxDurationMs - opts.budget.elapsedMs();
    const callMs = Math.max(1, Math.min(opts.llmCallTimeoutMs ?? opts.budget.budget.maxDurationMs, remainingMs));
    const callAbort = new AbortController();
    const callTimer = setTimeout(() => callAbort.abort(), callMs);
    callTimer.unref?.();
    let response;
    // WO-FIX-REASONING-CONTENT：收尾/兜底/补救轮强制 final_answer（发出即复位，只强制这一轮）。
    const forcingFinal = forceFinalAnswer;
    forceFinalAnswer = false;
    try {
      response = await opts.llm.agent({
        model: opts.model,
        system: await effectiveSystem(), // §7C 注入滚动前情摘要（Phase8 可为 LLM 摘要）
        tools: llmTools,
        messages,
        maxTokens: 16000,
        tenantId: opts.tenantId,
        signal: callAbort.signal, // G-9：透传给适配器 → 底层 SDK，使挂住的调用可被上界终止
        ...(contextEdits ? { contextEdits } : {}),
        ...(forcingFinal ? { toolChoice: { type: "tool" as const, name: "final_answer" } } : {}),
      });
    } catch (err) {
      // G-9：per-call deadline abort / AbortError → 不 throw（非真错），收敛为诚实降级（TIMEOUT）。
      if (callAbort.signal.aborted || isAbortError(err)) {
        return await degrade("BUDGET_EXHAUSTED", "TIMEOUT");
      }
      // 第 3 刀（model_context_window_exceeded 形态）：折叠所有可折叠轮 + 注入收尾提醒后重试一次
      if (isContextWindowExceededError(err)) {
        if (finalizeUsed) return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
        for (let f = foldOldestFrame(messages, frames); f; f = foldOldestFrame(messages, frames)) {
          rollingNotes.push(noteOfFrame(f));
          budgeter.record("fold", i, "context window exceeded");
        }
        finalizeUsed = true;
        finalizePending = true;
        forceFinalAnswer = true; // WO-FIX-REASONING-CONTENT：超窗收尾轮同样强制 final_answer
        budgeter.record("force_finalize", i, "model_context_window_exceeded");
        messages.push({ role: "user", content: CONTEXT_FULL_REMINDER });
        continue;
      }
      // 非 abort 真错 → 仍 throw（交 failFromError 出 R7 信封）
      throw err;
    } finally {
      clearTimeout(callTimer);
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

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    // WO-REASONING-TRACE（暗发 `qos.reasoning-trace`·建人机信任）：把本轮"思考旁白"（模型在工具调用之间产出的自由文本 =
    // ReAct 的 thought）实时流给前端——复用 `step.completed` 伪 step（`type=agent_narration`·**不新增 §8.2 事件名**·
    // `stepId=narration-${i}` 独立行·不污染工具步时间线聚合）。仅当有旁白文本 **且** 本轮确有真工具动作（非纯 final_answer
    // 收尾）才发；纯收尾散文归 answer.final，不重复外露。`opts.emitNarration` 缺省 false → 零回归（既有 agent 测试字节不变）。
    if (opts.emitNarration && toolUses.some((b) => b.name !== "final_answer")) {
      const narration = texts.map((t) => t.text).join("\n").trim();
      if (narration) {
        await opts.emit("step.completed", { stepId: `narration-${i}`, type: "agent_narration", text: narration.slice(0, 600), iteration: i });
      }
    }

    if (response.stopReason !== "tool_use" || toolUses.length === 0) {
      // WO-FIX-REASONING-CONTENT：推理型模型（kimi-k2.6 等）把结论写进 reasoning_content 却漏调 final_answer
      //（适配器置 salvagedReasoning）→ 补一次「结构化收尾」强制轮（Manus 级韧性）：回述其结论、下一轮强制 final_answer，
      // 把"无溯源散文答复"升级为可溯源 final_answer。仅补一次（finalAnswerNudged）、且非「最后机会」轮，避免与降级互斥死循环。
      // 普通文本终结（非 reasoning 抢救）不介入 → 既有降级路径逐字节不变。
      if (response.salvagedReasoning && !finalAnswerNudged && !finalizePending) {
        finalAnswerNudged = true;
        forceFinalAnswer = true;
        messages.push({
          role: "user",
          content:
            "你已在推理中给出结论，但尚未调用 final_answer 工具收尾。请立即调用 final_answer，" +
            "把上面的结论输出为结构化 blocks；每个业务数字用 ⟦ref:N⟧ 引用你已调用工具的 tool_call_id。",
        });
        iterations.push({ index: i, toolCalls: [] });
        continue;
      }
      // finished without final_answer (§5.4-6 degraded text answer)
      return await degrade("ANSWERED");
    }

    // If this turn carries final_answer, accept it first and terminate (no tool_results needed).
    const finalBlock = toolUses.find((b) => b.name === "final_answer");
    if (finalBlock) {
      const accepted = await acceptFinalAnswer(finalBlock.input, opts);
      if (accepted.ok) {
        // WO-REFLECT-LOOP · 收尾前反思步（暗发·仅 opts.reflect 开·path-A/compose 不经此循环）。
        // 确定性复盘（reflect.ts·R6）+ 可选 LLM critic（agent.critic·fail-open advisory）→ 不过关且 replan 预算未尽 →
        // 把原因当作 final_answer 的 tool_result 回注（复用「无效 final_answer」同款 API 合法机制）+ 重规划一轮再复盘。
        if (opts.reflect) {
          const verdict = await reflectWithCritic(accepted.answer, opts, iterations);
          if (!verdict.ok) {
            reflected = true;
            lastReplanReason = verdict.reasons.join("；");
            const canReplan = replansUsed < replanBudget && !finalizePending && !opts.budget.exhausted && !opts.budget.roundTripsExceeded();
            if (canReplan) {
              replansUsed += 1;
              messages.push({
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    toolUseId: finalBlock.id,
                    content: `【反思复盘·未过关（第 ${replansUsed} 次重规划）】${lastReplanReason}。请据此补齐证据 / 调用对口 solver 后，重新用 final_answer 收尾。`,
                    isError: true,
                  },
                ],
              });
              iterations.push({ index: i, toolCalls: [] });
              continue;
            }
            // 重规划预算尽仍不过关 → 诚实收尾：附「反思发现的残余缺口」块（不静默发半成品·KILL-MOCK-RED）。
            const gapBlocks: AnswerBlock[] = [
              ...accepted.answer.blocks,
              { type: "text", markdown: `【反思发现的残余缺口（已尽重规划预算 ${replanBudget}）】${lastReplanReason}` },
            ];
            iterations.push({ index: i, toolCalls: [] });
            return {
              outcome: "ANSWERED",
              answer: { ...accepted.answer, blocks: gapBlocks, unverifiedNumerics: scanBlocks(gapBlocks) },
              structured: accepted.structured,
              run: finishRun(false),
              sketch,
              reflected: true,
              replanReason: lastReplanReason,
              ...(opts.sliceSolverKeys ? { planFellBackToReAct } : {}),
            };
          }
        }
        iterations.push({ index: i, toolCalls: [] });
        return {
          outcome: "ANSWERED",
          answer: accepted.answer,
          structured: accepted.structured,
          run: finishRun(false),
          sketch,
          ...(opts.reflect ? { reflected } : {}),
          ...(reflected && lastReplanReason ? { replanReason: lastReplanReason } : {}),
          ...(opts.sliceSolverKeys ? { planFellBackToReAct } : {}),
        };
      }
      // 第 3 刀「最后机会」轮给出的 final_answer 无效 → 按预算耗尽语义降级（不再续轮）
      if (finalizePending) return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
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
    if (finalizePending) return degrade("BUDGET_EXHAUSTED");

    // WO-QOS-2 · plan 自检：本轮（= 一次 plan）批量发起的 invoke_solver 引用的 solver 若有图外者 → 记回退 ReAct
    //（不阻断真工具·ReAct 兜底照跑）。仅当传入导航图 solver 集时判定；缺省不介入（既有行为逐字节不变）。
    if (opts.sliceSolverKeys && opts.sliceSolverKeys.length > 0) {
      const turnSolvers = toolUses
        .filter((b) => b.name === "invoke_solver")
        .map((b) => String((b.input as { solverKey?: unknown } | undefined)?.solverKey ?? ""))
        .filter(Boolean);
      if (!planWithinSlice(turnSolvers, opts.sliceSolverKeys)) planFellBackToReAct = true;
    }

    for (const block of toolUses) {
      if (!(block.name === "load_skill" && opts.loadSkillEnabled)) {
        sketch.push({ toolName: block.name, inputSummary: JSON.stringify(block.input ?? {}).slice(0, 200) });
      }
    }

    // -----------------------------------------------------------------------
    // WO-LOOP-CONTROL-P1 · Loop Detector 环检测（opt-in·补 S01 只认失败的洞：成功但原地打转）。
    // 对本轮每个真实 tool_use（final_answer 已在上处理返回·load_skill 元操作不计）算 callSignature 并累计；
    // 某签名累计 ≥ repeatCap → 无进度环 → 优雅降级 STALL_LOOP（纯 R6·稳定序列化·无 Date.now/随机·唯一诚实出口 degrade）。
    // sketch 已在上一步收录本轮调用 → degrade 的「部分发现」可诚实复述（不造数·R13）。**不误伤**：签名含入参 →
    // 不同入参各自独立计数不累加（对照组「每轮异参」永不触顶）。
    // -----------------------------------------------------------------------
    // WO-LOOP-CONTROL-P2 · per-tool 调用上界（PRD §3.3·机制 #3）：某工具（按名·**异参亦累计**）达 perToolCallCap → 置
    // budget.exhausted → 下一轮迭代前 `budget.exhausted` 守卫优雅降级（补 P1 hash 只认「同参重复」的洞·**零新降级路径**）。
    // 缺省不设 cap → 直接放行（现行为字节兼容）。final_answer/load_skill 元操作不计。
    if (opts.budget.perToolCallCap !== undefined) {
      for (const b of toolUses) {
        if (b.name === "final_answer" || b.name === "load_skill") continue;
        opts.budget.tryConsumeTool(b.name);
      }
    }

    if (repeatCap > 0) {
      // P1 hash 环检测：本轮任一真实 tool_use 的 callSignature 累计达 repeatCap → 无进度环。
      let hashStalled = false;
      for (const b of toolUses) {
        if (b.name === "final_answer" || b.name === "load_skill") continue;
        const sig = callSignature(b.name, b.input ?? {});
        const n = (callSignatureCounts.get(sig) ?? 0) + 1;
        callSignatureCounts.set(sig, n);
        if (n >= repeatCap) hashStalled = true;
      }
      if (hashStalled) {
        // WO-LOOP-CONTROL-P2 · Escalation Ladder：rung① 换策略再试一轮（**早于** degrade·暗发·一次性）；仍停滞才落 rung③ 认输。
        if (await maybeEscalate(i)) continue;
        // WO-P2.5：rung① 用尽仍停滞 → 标 stalled 上抛（rung② 由 orchestrator 决定重路由）；rung③ 唯一诚实出口 degrade(STALL_LOOP)。
        stalledForReroute = { reason: "STALL_LOOP" };
        return await degrade("BUDGET_EXHAUSTED", "STALL_LOOP");
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
    // WO-AGENT-RUNTIME-S01：本轮工具是否有成功产出 / 失败（ERROR/DENIED/BUDGET_EXCEEDED）计数（停滞早停用）。
    let roundHadSuccess = false;
    let roundFailures = 0;
    for (const o of outcomes) {
      if (o.call) iteration.toolCalls.push(o.call);
      toolResults.push(o.result);
      if (o.denyKind === "PERMISSION") consecutiveDenies += 1;
      else if (o.ok) consecutiveDenies = 0;
      if (o.ok) roundHadSuccess = true;
      else if (o.result.isError) roundFailures += 1;
    }
    // WO-AGENT-RUNTIME-S01 · 停滞早停计数更新：任一成功工具产出 → 复位；否则本轮失败累加 + 无成功轮 +1。
    if (roundHadSuccess) {
      consecutiveToolFailures = 0;
      roundsWithoutSuccess = 0;
    } else if (roundFailures > 0) {
      consecutiveToolFailures += roundFailures;
      roundsWithoutSuccess += 1;
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
    // WO-Phase4：完成一轮「LLM→工具执行→结果返回」→ round-trip +1（超 maxRoundTrips 在下一轮迭代前触发硬预算降级）。
    opts.budget.roundTrips += 1;

    // WO-AGENT-RUNTIME-S01 · 停滞早停（治病根 ~5min 卡死）：连续工具失败（ERROR/DENIED）≥ 阈值 **且** 近 ≥ N 轮零成功
    // 工具产出 → 立即优雅降级（复用 BUDGET_EXHAUSTED 降级路径），不再空转烧完预算。双条件联合 = 不误伤「先错后恢复」的
    // 正常流（任一成功产出即上面复位两计数器）。此前 loop 只对连续 PERMISSION 拒绝（consecutiveDenies）先 nudge——ERROR
    // 型停滞（invoke_solver ERROR/权限外 workflow DENIED 反复）无此护栏，会一路烧到 maxIterations（病根实测 ~5min）。
    if (consecutiveToolFailures >= STALL_CONSECUTIVE_FAILURES && roundsWithoutSuccess >= STALL_MIN_ROUNDS) {
      // WO-LOOP-CONTROL-P2 · Escalation Ladder：rung① 换策略再试一轮（**早于** degrade·暗发·一次性）；仍停滞才落 rung③ 认输。
      if (await maybeEscalate(i)) continue;
      // WO-LOOP-CONTROL-P2.5：rung① 已用尽仍停滞（S01 连续失败）→ 标 stalled 上抛（rung② 由 orchestrator 决定重路由·早于兜底）。
      stalledForReroute = { reason: "STALL_CONSECUTIVE" };
      return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
    }

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

  return await degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
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
  const provenancePolicy = opts.provenancePolicy ?? "best_effort";
  if (provenancePolicy === "required" && provenance.length === 0) {
    return { ok: false, errors: ["Skill provenancePolicy=required：final_answer 必须包含 provenance"] };
  }
  if (opts.writeMode) {
    const hasActionDraft = blocks.some((b) => b.type === "action_draft");
    if (!hasActionDraft) {
      return { ok: false, errors: ["挂载的 Skill 为 WRITE/审批类型，final_answer 必须包含 action_draft 块"] };
    }
  }
  const unverified = scanBlocks(blocks);
  if (unverified) opts.metrics.unverifiedNumerics.inc({ path: "AGENT" });
  return {
    ok: true,
    answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: unverified },
  };
}
