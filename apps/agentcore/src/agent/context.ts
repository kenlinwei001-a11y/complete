import type { ContextOp } from "@platform/contracts";
import type { LlmAgentMessage, LlmAgentRequest, LlmCapabilities, LlmClient } from "../llm/types.js";
import type { Metrics } from "../metrics.js";

/**
 * Agent 上下文管理（PRD 增量 · Agent 运行时强化 §1）。
 *
 * - §1.1 Token 预算器：Anthropic 用 count_tokens（每 2 轮实测一次，期间 chars/3.5 增量估算）；
 *   openai_compatible 一律 chars/3.5。软阈值 = min(maxContext, 200K)×70%，硬阈值 90%。
 * - §1.2 单个 tool_result 进入 messages 前截断至 8KB（JSON 在数组维度截断，保结构合法）。
 * - §1.3 三刀清理：折叠最旧迭代 tool_result → 服务端 compaction → 强制收尾。
 */

export const TOOL_RESULT_CONTEXT_LIMIT = 8 * 1024;
export const SKILL_RESOURCE_TEXT_LIMIT = 64 * 1024;
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
export const SOFT_THRESHOLD_RATIO = 0.7;
export const HARD_THRESHOLD_RATIO = 0.9;
export const CHARS_PER_TOKEN = 3.5;

/** 第 3 刀注入的收尾提醒（增量 §1.3-3）。 */
export const CONTEXT_FULL_REMINDER = "上下文已满，立即基于已有结果调用 final_answer";

// ---------------------------------------------------------------------------
// §1.1 token 估算
// ---------------------------------------------------------------------------

function charsOfMessage(m: LlmAgentMessage): number {
  if (typeof m.content === "string") return m.content.length;
  let n = 0;
  for (const b of m.content) n += JSON.stringify(b).length;
  return n;
}

/** chars/3.5 估算（system + tools + messages）。mock 的 countTokens 用同一公式以保确定性。 */
export function estimateTokensChars(req: Pick<LlmAgentRequest, "system" | "tools" | "messages">): number {
  let chars = req.system.length + JSON.stringify(req.tools ?? []).length;
  for (const m of req.messages) chars += charsOfMessage(m);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// §1.2 tool_result 截断（数组维度，保结构合法）
// ---------------------------------------------------------------------------

export interface TruncationResult {
  /** serialized (possibly truncated) JSON */
  json: string;
  truncated: boolean;
  /** 尾注（语义一字不差）：[已截断：共 n 条，仅含前 k 条。…] */
  note?: string;
}

type JsonPath = (string | number)[];

function findLargestArray(value: unknown, path: JsonPath = [], best?: { path: JsonPath; size: number; length: number }):
  | { path: JsonPath; size: number; length: number }
  | undefined {
  if (Array.isArray(value)) {
    const size = JSON.stringify(value).length;
    if (!best || size > best.size) best = { path, size, length: value.length };
    value.forEach((v, i) => {
      best = findLargestArray(v, [...path, i], best);
    });
    return best;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      best = findLargestArray(v, [...path, k], best);
    }
  }
  return best;
}

function cloneWithArraySlice(value: unknown, path: JsonPath, keep: number): unknown {
  if (path.length === 0) {
    return Array.isArray(value) ? value.slice(0, keep) : value;
  }
  const [head, ...rest] = path as [string | number, ...JsonPath];
  if (Array.isArray(value)) {
    return value.map((v, i) => (i === head ? cloneWithArraySlice(v, rest, keep) : v));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    out[String(head)] = cloneWithArraySlice(out[String(head)], rest, keep);
    return out;
  }
  return value;
}

function truncationNote(total: number, kept: number): string {
  return `[已截断：共 ${total} 条，仅含前 ${kept} 条。请用更精确的过滤条件或聚合工具重查]`;
}

/**
 * 单个 tool_result 进入 messages 前截断至 limit（§1.2）：JSON 在最大数组维度截断保结构合法，
 * 附尾注把「取太多」转化为模型可自纠的信号。审计仍存全量（tool_calls 既有规则，不经过此函数）。
 */
export function truncateToolResultJson(payload: unknown, limitBytes = TOOL_RESULT_CONTEXT_LIMIT): TruncationResult {
  const full = JSON.stringify(payload) ?? "null";
  if (Buffer.byteLength(full, "utf8") <= limitBytes) return { json: full, truncated: false };

  const arr = findLargestArray(payload);
  if (arr && arr.length > 0) {
    // binary search the max keep count whose serialization fits the limit
    let lo = 0;
    let hi = arr.length - 1; // strictly fewer items than the original
    let bestJson: string | undefined;
    let bestKeep = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = JSON.stringify(cloneWithArraySlice(payload, arr.path, mid));
      if (Buffer.byteLength(candidate, "utf8") <= limitBytes) {
        bestJson = candidate;
        bestKeep = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (bestJson !== undefined) {
      return { json: bestJson, truncated: true, note: truncationNote(arr.length, bestKeep) };
    }
  }
  // 非数组型超长（如超长字符串）：降级为 preview 包装（仍是合法 JSON）
  const previewChars = Math.max(0, Math.floor(limitBytes / 2));
  const preview = full.slice(0, previewChars);
  return {
    json: JSON.stringify({ _truncated: true, preview }),
    truncated: true,
    note: truncationNote(1, 1),
  };
}

// ---------------------------------------------------------------------------
// §1.3 第 1 刀：最旧迭代 tool_result 折叠
// ---------------------------------------------------------------------------

export interface IterationFrame {
  /** 0 起的循环迭代序号 */
  iteration: number;
  /** 该迭代 tool_results 用户消息在 messages 中的下标 */
  toolResultMsgIndex: number;
  /** 折叠摘要素材：每个 tool_result 的工具名 + 首行摘要 */
  tools: { name: string; firstLine: string }[];
  folded: boolean;
}

export function firstLineSummary(content: string, maxChars = 80): string {
  // 摘要不带 <tool_data> 包装（占位摘要只为提示模型「曾经拿到过什么」）
  const stripped = content.replace(/^<tool_data[^>]*>/, "").replace(/<\/tool_data>\s*$/, "");
  const line = stripped.split("\n", 1)[0] ?? "";
  return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
}

/**
 * 折叠最旧的未折叠迭代（assistant 的 tool_use 块保留——保持消息结构合法）。
 * 最近 2 轮永不折叠；无可折叠时返回 undefined。
 */
export function foldOldestFrame(messages: LlmAgentMessage[], frames: IterationFrame[]): IterationFrame | undefined {
  const unfolded = frames.filter((f) => !f.folded);
  if (unfolded.length <= 2) return undefined;
  const frame = unfolded[0] as IterationFrame;
  const msg = messages[frame.toolResultMsgIndex];
  if (msg && Array.isArray(msg.content)) {
    let ti = 0;
    msg.content = msg.content.map((b) => {
      if (b.type !== "tool_result") return b;
      const meta = frame.tools[ti++] ?? { name: "tool", firstLine: "" };
      return {
        ...b,
        content: `[第 ${frame.iteration + 1} 轮 ${meta.name} 结果已折叠：${meta.firstLine}。如需请重新调用]`,
      };
    });
  }
  frame.folded = true;
  return frame;
}

// ---------------------------------------------------------------------------
// §7C 默认滚动摘要（确定性·无 LLM·CI 可复现）
// ---------------------------------------------------------------------------

/**
 * Phase7C / WO-FIX-REASONING-CONTENT：确定性默认滚动摘要。把已折叠轮次的蒸馏笔记压成有界
 * 「已查证据」digest——去重、保留全部工具名与首行事实、按时间序，总量有界（自最近向前累加至
 * maxChars，超出以"更早 N 轮已略"计数省略·近端优先保留）。相比朴素"末 N 条拼接"：①去重复述
 * ②有界防膨胀 ③结构化为条目便于模型回忆。生产可注入 LLM 摘要器覆盖（llmRollingSummarizer）。
 * 纯函数、无时钟/随机 → 同输入字节级一致。
 */
export function defaultRollingSummary(notes: string[], maxChars = 1600): string {
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const n of notes) {
    const key = n.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      uniq.push(key);
    }
  }
  const kept: string[] = [];
  let used = 0;
  for (let idx = uniq.length - 1; idx >= 0; idx--) {
    const line = `- ${uniq[idx]}`;
    if (kept.length > 0 && used + line.length > maxChars) {
      kept.unshift(`（更早 ${idx + 1} 轮已略）`);
      break;
    }
    kept.unshift(line);
    used += line.length + 1;
  }
  return kept.join("\n");
}

/**
 * WO-CONTEXT-COMPRESSION · 真 LLM 滚动摘要器（补齐上下文压缩最后一块——`defaultRollingSummary` 是确定性拼接，
 * 此处接上没实现的 LLM 摘要器 hook）。返回 `(notes) => Promise<string>` 供 runAgentLoop `opts.summarizer` 注入。
 *
 * - `providerAvailable=true`：调 `llm.compose` 把已折叠轮次笔记压成 ≤1600 字前情摘要；**compose 抛错 / 返回空 → 兜底
 *   `defaultRollingSummary(notes)`**（fail-open·绝不阻断 agent 循环）。
 * - `providerAvailable=false`：直接 `defaultRollingSummary(notes)`（fail-open·CI 可复现·零额外 LLM 调用）。
 *
 * 数字红线不放松：摘要「仅供回忆·业务事实仍以工具结果为准」（与 loop.ts effectiveSystem 注入措辞一致）。
 */
export function makeLlmRollingSummarizer(
  llm: Pick<LlmClient, "compose">,
  model: string,
  tenantId: string | undefined,
  providerAvailable: boolean,
): (notes: string[]) => Promise<string> {
  return async (notes: string[]): Promise<string> => {
    if (!providerAvailable) return defaultRollingSummary(notes);
    try {
      const out = await llm.compose({
        model,
        instruction:
          "把以下已折叠轮次的调查笔记压成 ≤1600 字中文『前情摘要』：只保留已验证事实 + 工具名 + 关键数字，去重，不编造。" +
          "该摘要仅供回忆·业务事实仍以工具结果为准。",
        inputs: notes.map((note, i) => ({ round: i + 1, note })),
        ...(tenantId ? { tenantId } : {}),
      });
      const s = (out ?? "").trim();
      return s.length > 0 ? s : defaultRollingSummary(notes);
    } catch {
      // fail-open：compose 抛错（无 provider / key 失效 / 网关异常）→ 退确定性兜底，不阻断循环。
      return defaultRollingSummary(notes);
    }
  };
}

// ---------------------------------------------------------------------------
// §1.1/§1.3 预算器（阈值 + 测量节奏 + contextOps 留痕）
// ---------------------------------------------------------------------------

export class ContextBudgeter {
  caps: LlmCapabilities = { countTokens: false, compaction: false };
  softLimit = Math.floor(DEFAULT_MAX_CONTEXT_TOKENS * SOFT_THRESHOLD_RATIO);
  hardLimit = Math.floor(DEFAULT_MAX_CONTEXT_TOKENS * HARD_THRESHOLD_RATIO);
  readonly ops: ContextOp[] = [];
  private measureCount = 0;

  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
    private readonly tenantId?: string,
    private readonly metrics?: Metrics,
  ) {}

  async init(): Promise<void> {
    try {
      this.caps = (await this.llm.capabilities?.(this.model, this.tenantId)) ?? this.caps;
    } catch {
      /* capability probe is best-effort */
    }
    const max = Math.min(this.caps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS, DEFAULT_MAX_CONTEXT_TOKENS);
    this.softLimit = Math.floor(max * SOFT_THRESHOLD_RATIO);
    this.hardLimit = Math.floor(max * HARD_THRESHOLD_RATIO);
  }

  /** count_tokens 每 2 轮实测一次（首轮即实测），期间 chars/3.5 增量估算。 */
  async measure(req: Pick<LlmAgentRequest, "system" | "tools" | "messages">): Promise<number> {
    this.measureCount += 1;
    if (this.caps.countTokens && this.llm.countTokens && this.measureCount % 2 === 1) {
      try {
        return await this.llm.countTokens({
          model: this.model,
          tenantId: this.tenantId,
          system: req.system,
          tools: req.tools,
          messages: req.messages,
        });
      } catch {
        /* 实测失败 → 估算兜底 */
      }
    }
    return estimateTokensChars(req);
  }

  record(op: ContextOp["op"], iteration: number, detail?: string): void {
    this.ops.push({ op, iteration, ...(detail ? { detail } : {}) });
    this.metrics?.contextOps.inc({ op });
  }
}
