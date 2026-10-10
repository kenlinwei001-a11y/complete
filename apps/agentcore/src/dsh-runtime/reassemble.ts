/**
 * WO-DSH-POC-S3 · dsh session.event 帧流 → 我方 Answer/SSE 的**纯重组装**（零 IO）。
 *
 * 输入是 JSON-RPC wire 上 session.event 通知里的 event 帧（已序列化过一遭的普通 JSON），
 * 输出对齐 runAgentLoop 的 Answer 组装语义（agent/loop.ts）：
 *   - final_answer 调用 ⇒ blocks/provenance 严格校验（AnswerBlockSchema 单校验点），
 *     provenance 的 toolName 从帧流里的 tool/call 记录回填（对位 loop.ts repos.toolCalls.get）；
 *   - 无 final_answer ⇒ 软收尾：最后一条 assistant/message 文本兜底（对位 lastText 分支）；
 *   - turn/end reason: completed→ANSWERED · max-tokens→BUDGET_EXHAUSTED · error/aborted→FAILED；
 *     max-tokens 收尾补诚实摘要头（W2 批3 dsh 自体修复②，镜像 stall 路模板·对位 loop.ts:620-634）；
 *   - aborted 且 cause.kind==='stall-loop'（N3 watchdog cancel 落帧）⇒ 分类前置：
 *     BUDGET_EXHAUSTED + degraded{STALL_LOOP} + 诚实降级块（镜像 loop.ts:620-632），
 *     先于 expectsSchema/final_answer 分支（degrade 短路语义）；
 *   - expectsSchema 模式 ⇒ checkJsonSchema 校验（对位 loop.ts:1284 acceptFinalAnswer，
 *     同一 util/jsonschema.ts 单源）后 structured = final_answer raw input；invalid ⇒ fail-closed。
 *
 * WO-DSH-N2 · SSE 桥映射表（createSseMapper，既有三分支逐字节不动 + 四增补）：
 *   tool/call              → step.started  {stepId=callId, type=name}        （meta 工具 skip，见下）
 *   tool/result            → step.completed{stepId, status: OK|ERROR}        （meta 查集 skip）
 *   assistant/chunk text-delta      → step.completed{stepId:narration-<t>-<s>, type:agent_narration, text}
 *   assistant/chunk reasoning-delta → step.completed{stepId:think-<t>-<s>-<i>, type:agent_think, text}（N2·D-1 流式透传）
 *   compaction/start       → step.started  {stepId:compaction-<id>, type:compaction}（N2·D-4）
 *   compaction/summary     → step.completed{同 stepId, type:compaction, text:已压缩 N 条/约 M tokens}
 *   compaction/end         → step.completed{同 stepId, type:compaction, outcome:OK|ERROR(error 时 text=原文)}
 *   usage/finish/block-start/block-end/tool-call-delta/turn/end/assistant/message/command/* → 不逐帧映射
 *   meta 工具（final_answer/`skill`）：tool/call skip 并记 callId 集，tool/result 查集 skip（D-7·对齐 loop.ts:1146 口径）。
 *     ⚠ 技能加载器**两臂名字不同**：native = `load_skill`（我方常量，tools/registry.ts:481），
 *     dsh = `skill`（上游常量，@deepseek-ai/dsh-tool-skill@0.1.0-rc.6，不可配）。本文件只处理 dsh 帧流 ⇒ 写真名 `skill`。
 * 红线：finish 帧的 replayState（adapter-private）**绝不外发**——finish 不映射，stats 不含其任何字段。
 * N2·D-2：统计走 reassembleDshRun 的 additive stats 键（纯 fold，口径=dsh-session-stats/token-meter
 * 投影语义）；零 usage 帧 ⇒ stats 键整体不出（诚实缺省）。projectedTokens/contextWindow 帧流无源，不自封。
 */

import { AnswerBlockSchema, type AgentIteration, type Answer, type AnswerBlock, type ProvenanceRef } from "@platform/contracts";
import { z } from "zod";
import { scanBlocks } from "../util/numerics.js";
// WO-ARM-FAILURE-VISIBLE：失败披露的**渲染/归一**单源在 `agent/failure-disclosure.ts`
// （两臂共用；本文件只做帧流取数）。⛔ 不许在本文件另写一份渲染。
import { failedToolCall, renderFailedCallsBlock, type FailedToolCall } from "../agent/failure-disclosure.js";
export type { FailedToolCall } from "../agent/failure-disclosure.js";
// WO-DSH-REFLECT-PARITY：复盘判据**单源复用** `agent/reflect.ts`（原生路同一份四查），
// 本文件不另写第二套 —— 两份实现必漂，正是本仓「不许另抄一份」铁律防的那个形态。
import { reflectAnswer } from "../agent/reflect.js";
import { checkJsonSchema } from "../util/jsonschema.js";
import { newId } from "../ids.js";

// ---- dsh 帧的窄本地类型（只声明重组装消费的字段；wire 上还有更多字段，宽容忽略） ----

export interface DshSessionEvent {
  type: string;
  /** N2 additive：帧序号/主机打戳 ms（wire 全字段帧自带；stats fold 的时间源）。 */
  seq?: number;
  time?: number;
  data?: unknown;
}

interface DshToolCall {
  toolCallId: string;
  name: string;
  input: unknown;
}

export interface ReassembleOptions {
  /** skillGovernance 聚合（loop.ts:451 同口径）；writeMode/provenancePolicy 校验在此执行。 */
  governance?: { writeMode: boolean; provenancePolicy: "required" | "best_effort" | "none" };
  /** expectsSchema 模式：final_answer raw input 按 schema 校验（fail-closed）后进 structured，不按 AnswerBlock 校验。 */
  expectsSchema?: Record<string, unknown>;
  /** provenance id 生成（测试注入确定性 id；生产缺省 prov_ 前缀自增由调用方包一层）。 */
  newProvId?: () => string;
  /**
   * WO-DSH-REFLECT-PARITY：收尾前**确定性复盘**（`agent/reflect.ts` 单源四查 ——
   * ①答了吗 ②裸数∧⟦ref:N⟧越界 ③工具静默失败 ④**Solver-first（禁自算·须走 invoke_solver）**）。
   *
   * **与 `runAgentLoop` 的 `opts.reflect` 同判据 ∧ 同门控**（`reflectEnabled(enabledFeatures)`，
   * 由调用方求值后传入）：两条路同口径是 ROLLOUT「外部可观察面逐字节一致」的前提，
   * 也是「开流前后不改变用户体验」的前提 —— 若本路单方面收紧，开流就成了一次产品行为变更。
   *
   * 给了才复盘（= 原生路 `opts.reflect` 的 dsh 对位位）；`userContent` 供 ④ 判排产/优化类问句。
   */
  reflect?: { userContent: string };
  /**
   * WO-DSH-PROD-READY W9-full：宿主 tool-execute 反向通道侧表（W8主 端点逐调用累积；
   * 键 = 帧 callId 原值——桥上传 exec.callId 直通，team-lead 2026-08-22 裁决，关联白得）。
   * 命中支 = 事实源：outcome 翻四态（OK/DENIED/ERROR/BUDGET_EXCEEDED 按端点记录）、
   * toolCallId 换 tc_ 形态、durationMs 取宿主实测值（覆盖帧 time 差推导）；未命中支
   * （MCP/meta 不过宿主）维持 W9-lite 帧流两态推导。只读消费（opts 进、值出，不 mutate）。
   */
  hostToolCalls?: ReadonlyMap<
    string,
    { outcome: "OK" | "DENIED" | "ERROR" | "BUDGET_EXCEEDED"; toolCallId: string; durationMs: number }
  >;
}

export type ReassembledRun =
  | {
      ok: true;
      outcome: "ANSWERED" | "FAILED" | "BUDGET_EXHAUSTED";
      answer: Answer;
      sketch: { toolName: string; inputSummary: string }[];
      structured?: Record<string, unknown>;
      degraded?: { reason: "TIMEOUT" | "BUDGET_EXHAUSTED" | "STALL_LOOP" };
      /**
       * WO-DSH-ARM-FAILURE-VISIBLE · **本次答案是怎么收的尾**（判别位，全部 ok:true 出口恒带）。
       *
       * 为什么需要它：本函数原先有两条出口（`final_answer` 支 / 无 final_answer 的软收尾支）在
       * 记录上**完全同形** —— 都是 blocks + provenance + unverifiedNumerics，软收尾不带任何标记
       * ⇒ 事后读一条 run，**分不出「模型答完了」还是「模型压根没交卷，平台拿末次正文兜的底」**。
       * 而这两件事的处置完全不同（后者是「本次没答」，用户读到的却是模型的过程文本）。
       *
       * `DEGRADED` = 有界终止路（stall / 预算尽）的诚实摘要出口 —— 它们本就有 `degraded.reason`，
       * 这里给同一位补齐三态，免得消费方按「有没有 degraded」二次推导。
       */
      closing: "FINAL_ANSWER" | "SOFT_CLOSE" | "DEGRADED";
      /** N2·D-2 additive：帧流纯 fold 统计（零 usage 帧 ⇒ 键整体不出·诚实缺省）。 */
      stats?: DshRunStats;
      /**
       * WO-DSH-PROD-READY W9-lite：帧流 → AgentIteration 骨架（foldDshIterations 纯 fold）。
       * 恒在（可空数组——零配对调用 ⇒ [] 诚实缺省，不造迭代）；ok:false 路径不造（stats 同口径）。
       */
      iterations: AgentIteration[];
      /**
       * WO-DSH-REFLECT-PARITY：本次收尾是否被复盘拦下（原生路 `reflected` 同口径）。
       * 缺省不出键（未复盘 / 复盘过关）—— additive optional，旧消费方字节兼容。
       */
      reflected?: boolean;
      /** 复盘不过关的原因（原生路 `replanReason` 同口径的清单形态）。 */
      replanReasons?: string[];
    }
  /**
   * 拒绝臂。`code` 为 **additive optional 判别位**（既有三处 governance/schema 拒绝不带此键，
   * 逐字节旧行为）：WO-NUMERIC-REDLINE-BLOCK 用它让 engine 出口**不靠匹配文案**就能识别
   * 数字红线拦截 —— 拿错误串当判别键会在文案一改就静默失灵（本仓「拿 X 当 Y 的证据」老病）。
   */
  | { ok: false; errors: string[] };

/** N2·D-2 · stats 三键（与 dsh host projections.values 同形子集；oracle 对账见 A2）。 */
export interface DshRunStats {
  /** dsh-session-stats projection 口径（lib/types/projection.d.ts：step/end 是步计数权威）。 */
  sessionStats: {
    turns: number;
    steps: number;
    llmMs: number;
    toolMs: number;
    ttftMs: number;
    ttftSteps: number;
    decodeMs: number;
    decodeTokens: number;
  };
  /** dsh-token-meter TokenUsageProjection：四桶 DISJOINT，Σ 全部 usage 块。 */
  tokenUsage: {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  /** 仅 pressureTokens（=末 usage 块 in+cacheRead+cacheWrite）；projectedTokens/contextWindow 帧流无源不出。 */
  contextPressure?: { pressureTokens: number };
}

const FinalAnswerInputSchema = z
  .object({
    blocks: z.array(AnswerBlockSchema),
    provenance: z.array(z.object({ toolCallId: z.string(), outputPath: z.string() }).strict()),
  })
  .strict();

/** 从帧流提取 tool/call 记录。帧形（agent-loop/src/tool-calls.ts:263 实证）：
 * {type:'tool/call', data:{turn, step, callId, name, arguments}} —— arguments 是 LLM 原始
 * JSON 字符串（mock 剧本与真模型同形），此处容错解析为对象。 */
export function collectToolCalls(events: readonly DshSessionEvent[]): DshToolCall[] {
  const out: DshToolCall[] = [];
  for (const e of events) {
    if (e.type !== "tool/call" || typeof e.data !== "object" || e.data === null) continue;
    const d = e.data as Record<string, unknown>;
    if (typeof d.callId !== "string" || typeof d.name !== "string") continue;
    let input: unknown = d.arguments;
    if (typeof input === "string") {
      try { input = JSON.parse(input); } catch { /* 保留原始字符串 */ }
    }
    out.push({ toolCallId: d.callId, name: d.name, input });
  }
  return out;
}

function lastAssistantText(events: readonly DshSessionEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type !== "assistant/message" || typeof e.data !== "object" || e.data === null) continue;
    const message = (e.data as Record<string, unknown>).message as { content?: { type?: string; text?: string }[] } | undefined;
    const t = (message?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text ?? "").join("");
    if (t) text = t;
  }
  return text;
}

function turnEndReason(events: readonly DshSessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== "turn/end") continue;
    const reason = (e.data as Record<string, unknown> | undefined)?.reason;
    if (typeof reason === "string") return reason;
    if (typeof reason === "object" && reason !== null) return String((reason as Record<string, unknown>).kind ?? "");
    return "";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// N3 · stall-loop 分类器（watchdog cancel 落帧 ⇒ STALL_LOOP 诚实降级重建）。
// 帧形实证（dsh-agent-loop index.js:575-580/592-595）：cancel(cause) → abort signal →
// turn/end data.reason = {kind:'aborted', reason:<cause 原样>}；watchdog 的 cause =
// {kind:'stall-loop', tool, count, cap}（纯 JSON，过 session lossless-JSON 校验）。
// ---------------------------------------------------------------------------

export interface StallLoopCause {
  kind: "stall-loop";
  tool?: string;
  count?: number;
  cap?: number;
}

/** 最后一个 turn/end 若为 stall-loop abort 则返回其 cause；否则 undefined（普通 aborted/error 不误吞）。 */
export function stallLoopCause(events: readonly DshSessionEvent[]): StallLoopCause | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== "turn/end") continue;
    const reason = (e.data as Record<string, unknown> | undefined)?.reason;
    if (typeof reason !== "object" || reason === null) return undefined;
    if ((reason as Record<string, unknown>).kind !== "aborted") return undefined;
    const inner = (reason as Record<string, unknown>).reason;
    if (typeof inner !== "object" || inner === null) return undefined;
    if ((inner as Record<string, unknown>).kind !== "stall-loop") return undefined;
    return inner as StallLoopCause;
  }
  return undefined;
}

/**
 * W8主 · B6 预算降级桥（与 stallLoopCause 同构的第三分类器）：
 * harness tool-bridge 收到宿主 BUDGET_EXCEEDED 回执 ⇒ agent.cancel({kind:'budget-exhausted',
 * reason}）⇒ turn/end data.reason = {kind:'aborted', reason:<cause 原样>}。
 * reason 字段 = 宿主 BUDGET_EXCEEDED payload.reason 原值（如 "maxToolCalls exceeded"），
 * 供诚实摘要头 budgetNote 逐字复用（loop.ts:632 模板）。
 */
export interface BudgetExhaustedCause {
  kind: "budget-exhausted";
  reason?: string;
}

/** 最后一个 turn/end 若为 budget-exhausted abort 则返回其 cause；否则 undefined。 */
export function budgetExhaustedCause(events: readonly DshSessionEvent[]): BudgetExhaustedCause | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== "turn/end") continue;
    const reason = (e.data as Record<string, unknown> | undefined)?.reason;
    if (typeof reason !== "object" || reason === null) return undefined;
    if ((reason as Record<string, unknown>).kind !== "aborted") return undefined;
    const inner = (reason as Record<string, unknown>).reason;
    if (typeof inner !== "object" || inner === null) return undefined;
    if ((inner as Record<string, unknown>).kind !== "budget-exhausted") return undefined;
    return inner as BudgetExhaustedCause;
  }
  return undefined;
}

/** tool/result 帧的窄提取（成功判定仅供 stall-loop 诚实块的 provenance）。 */
function successfulCallIds(events: readonly DshSessionEvent[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== "tool/result" || typeof e.data !== "object" || e.data === null) continue;
    const message = (e.data as Record<string, unknown>).message as
      | { content?: { type?: string; toolCallId?: string; isError?: boolean }[] }
      | undefined;
    for (const b of message?.content ?? []) {
      if (b?.type !== "tool-result" || typeof b.toolCallId !== "string") continue;
      if (b.isError === true || seen.has(b.toolCallId)) continue;
      seen.add(b.toolCallId);
      out.push(b.toolCallId);
    }
  }
  return out;
}

/**
 * WO-DSH-ARM-FAILURE-VISIBLE · 从帧流收集失败调用（isError=true 的 tool-result）。
 *
 * ⛔ **渲染与归一不在本文件** —— 那是两条臂共用的唯一实现，中性位置在
 * `agent/failure-disclosure.ts`（放这里会被 `loop.ts` 静态 import = 第二个 dsh-runtime 入口，
 * 触 `check-dsh-dormancy.mjs` D3）。本函数只做**取数**（帧流口径），产出同一份 `FailedToolCall`。
 *
 * outcome 的取证次序（**事实源优先，不许猜**）：① 宿主侧表 `hostToolCalls`（四态 + tc_ id 的
 * 事实源，与 `foldDshIterations` 同一张表）；② 表未命中（MCP/meta 外形态）才按帧文本里的
 * **平台自带文案**回判（DENIED/BUDGET 的三句文案与 `mcp-host-bridge.ts` / `loop.ts` 同源，
 * 此处只认它们，不做语义猜测；认不出即 ERROR —— 保守方向，不把失败说轻）。
 */
export function collectFailedCalls(
  events: readonly DshSessionEvent[],
  hostToolCalls?: ReassembleOptions["hostToolCalls"],
): FailedToolCall[] {
  const nameByCallId = new Map(collectToolCalls(events).map((c) => [c.toolCallId, c.name]));
  const out: FailedToolCall[] = [];
  for (const e of events) {
    if (e.type !== "tool/result" || typeof e.data !== "object" || e.data === null) continue;
    const message = (e.data as Record<string, unknown>).message as { content?: unknown[] } | undefined;
    for (const b of message?.content ?? []) {
      if (typeof b !== "object" || b === null) continue;
      const block = b as Record<string, unknown>;
      if (block.type !== "tool-result" || typeof block.toolCallId !== "string" || block.isError !== true) continue;
      const reason = toolResultText(block);
      const host = hostToolCalls?.get(block.toolCallId);
      const outcome =
        host?.outcome && host.outcome !== "OK"
          ? host.outcome
          : /AGENT_SCOPE_VIOLATION|无权访问/u.test(reason)
            ? "DENIED"
            : /预算已尽/u.test(reason)
              ? "BUDGET_EXCEEDED"
              : "ERROR";
      const note = failedToolCall(nameByCallId.get(block.toolCallId) ?? "unknown", outcome, reason);
      if (note) out.push(note);
    }
  }
  return out;
}

/** 工具结果帧里的文本（三种形态都收：`[{type:"text",text}]` / 裸串 / 空）。 */
function toolResultText(b: Record<string, unknown>): string {
  const c = b.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && (x as { type?: unknown }).type === "text")
      .map((x) => (typeof x.text === "string" ? x.text : ""))
      .join("");
  }
  return "";
}

/**
 * G-9 部分发现合成 · 镜像 loop.ts:588-604 synthesizePartialFindings 同口径
 * （只复述工具查到什么，不下结论、不造数）：优先末次 assistant 文本，否则 sketch 去重复述，
 * 再退固定兜底。reassemble 侧无 rollingNotes（dsh 帧流无对应物）——该档如实缺失。
 */
function synthesizePartialFindings(
  events: readonly DshSessionEvent[],
  sketch: { toolName: string; inputSummary: string }[],
): string {
  const lastText = lastAssistantText(events);
  if (lastText.trim()) return lastText;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const s of sketch) {
    const key = `${s.toolName}｜${s.inputSummary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- 调用 ${s.toolName}（入参 ${s.inputSummary}）`);
  }
  if (lines.length === 0) return "（探索过程中未取得可复述的工具结果）";
  return `已探索线索（仅复述调用轨迹，未形成最终结论）：\n${lines.join("\n")}`;
}

/**
 * N2·D-2 · 帧流纯 fold → stats（口径与 dsh-session-stats / dsh-token-meter 投影逐条对齐，
 * hist-multihop 763 帧机器复算全等，A2 以夹具 projections.values 为独立 oracle 对账）：
 *   steps=step/end 计数（步生命周期权威）；turns=有闭合步的去重 turn 数；
 *   llmMs=Σ(message.time−step/start.time · 有 message 的步)；
 *   ttftMs=Σ(首个非空 delta.time−step/start.time)，ttftSteps=有首 token 的步数；
 *   decodeMs=Σ(message.time−首 token.time · 有 usage 的步)，decodeTokens=同域 Σ outputTokens；
 *   toolMs=Σ(result.time−call.time 按 callId 配对)；
 *   tokenUsage=Σ usage 块四桶（DISJOINT，cacheWrite 缺省 0）；
 *   contextPressure.pressureTokens=末 usage 块 in+cacheRead+cacheWrite。
 * 缺 time 的帧对应时间量不计（与 dsh cancelled step 同构）；零 usage 帧 ⇒ undefined（诚实缺省）。
 */
export function foldDshRunStats(events: readonly DshSessionEvent[]): DshRunStats | undefined {
  const stepStart = new Map<string, number>();
  const messageTime = new Map<string, number>();
  const firstTokenTime = new Map<string, number>();
  const stepOutputTokens = new Map<string, number>();
  const pendingCalls = new Map<string, number>();
  const turnsWithClosedStep = new Set<number>();
  let steps = 0;
  let toolMs = 0;
  const tokenUsage = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let lastUsage: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined;
  let sawUsage = false;

  for (const e of events) {
    const d = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
    const key = `${d.turn ?? 0}-${d.step ?? 0}`;
    switch (e.type) {
      case "step/start":
        if (typeof e.time === "number") stepStart.set(key, e.time);
        break;
      case "step/end":
        steps += 1;
        turnsWithClosedStep.add(typeof d.turn === "number" ? d.turn : 0);
        break;
      case "assistant/message":
        if (typeof e.time === "number") messageTime.set(key, e.time);
        break;
      case "assistant/chunk": {
        const chunk = d.chunk as { type?: string; text?: string; usage?: Record<string, unknown> } | undefined;
        if (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") {
          if (chunk.text && typeof e.time === "number" && !firstTokenTime.has(key)) firstTokenTime.set(key, e.time);
        } else if (chunk?.type === "usage") {
          const u = (chunk.usage ?? {}) as Record<string, unknown>;
          const num = (v: unknown): number => (typeof v === "number" ? v : 0);
          sawUsage = true;
          tokenUsage.uncachedInputTokens += num(u.inputTokens);
          tokenUsage.outputTokens += num(u.outputTokens);
          tokenUsage.cacheReadTokens += num(u.cacheReadTokens);
          tokenUsage.cacheWriteTokens += num(u.cacheWriteTokens);
          stepOutputTokens.set(key, (stepOutputTokens.get(key) ?? 0) + num(u.outputTokens));
          lastUsage = u;
        }
        break;
      }
      case "tool/call":
        if (typeof d.callId === "string" && typeof e.time === "number") pendingCalls.set(d.callId, e.time);
        break;
      case "tool/result": {
        const message = d.message as { content?: { type?: string; toolCallId?: string }[] } | undefined;
        const tr = (message?.content ?? []).find((b) => b?.type === "tool-result");
        const callId = tr?.toolCallId;
        if (callId !== undefined && pendingCalls.has(callId) && typeof e.time === "number") {
          toolMs += e.time - pendingCalls.get(callId)!;
          pendingCalls.delete(callId);
        }
        break;
      }
      default:
        break;
    }
  }

  if (!sawUsage) return undefined;

  let llmMs = 0;
  for (const [k, mt] of messageTime) {
    const st = stepStart.get(k);
    if (st !== undefined) llmMs += mt - st;
  }
  let ttftMs = 0;
  let ttftSteps = 0;
  for (const [k, ft] of firstTokenTime) {
    const st = stepStart.get(k);
    if (st !== undefined) {
      ttftMs += ft - st;
      ttftSteps += 1;
    }
  }
  let decodeMs = 0;
  let decodeTokens = 0;
  for (const [k, out] of stepOutputTokens) {
    const mt = messageTime.get(k);
    const ft = firstTokenTime.get(k);
    if (mt !== undefined && ft !== undefined) {
      decodeMs += mt - ft;
      decodeTokens += out;
    }
  }

  return {
    sessionStats: {
      turns: turnsWithClosedStep.size,
      steps,
      llmMs,
      toolMs,
      ttftMs,
      ttftSteps,
      decodeMs,
      decodeTokens,
    },
    tokenUsage,
    ...(lastUsage
      ? {
          contextPressure: {
            pressureTokens:
              (typeof lastUsage.inputTokens === "number" ? lastUsage.inputTokens : 0) +
              (typeof lastUsage.cacheReadTokens === "number" ? lastUsage.cacheReadTokens : 0) +
              (typeof lastUsage.cacheWriteTokens === "number" ? lastUsage.cacheWriteTokens : 0),
          },
        }
      : {}),
  };
}

/**
 * WO-DSH-PROD-READY W9-lite · 帧流 → AgentIteration 骨架（审计记录空壳修复第一刀，纯 fold 零 IO）。
 *
 * 口径（逐条有据，不硬造）：
 *   - 分组粒度 = step（team-lead 2026-08-21 裁决②）：native 迭代粒度 = 每 LLM 轮
 *     （loop.ts:908 的 i），dsh 语义 turn=用户请求轮、step=LLM 响应轮 ⇒ 对位是 step 不是 turn；
 *     单 prompt 形态 turn 恒 1（hist-multihop 全帧 turn:1 + dualrun 语料 stats 锚 turns:1 双实证），
 *     turn 分组恒产单迭代、无 parity 价值。分组键 = `${turn}-${step}`（foldDshRunStats :252
 *     fold 键先例）；配对键 = turn-step-callId（同键域，callId 只在步内唯一不跨步担保）。
 *   - 每 LLM 轮一迭代：step/end 收轮的步即有迭代（dsh-agent-loop lib:558 step/end 在 finally
 *     里，每个开始的步必收轮）——空 step 轮推 {index, toolCalls:[]}（对位 native :1041/:1083
 *     空轮形态）；轮次证据（step/end）与调用证据（配对帧）分离，不互相冒充。
 *     并集补丁：步未收轮（进程 crash 死在 finally 前）但有配对调用 ⇒ 该步仍出迭代
 *     （审计面已执行调用不丢）；零帧/零证据 ⇒ []（零 spawn 早退诚实缺省）。
 *   - index = (turn, step) 数值排序后 0 基顺编号——对位 native index=i 的 0 基轮次序号；
 *     帧 step 是 1 基/turn 内编号（hist-multihop 实证 step 1..7），直填会跨 turn 撞号且与
 *     native 恒差 1，故按契约字段既有语义（0 基轮次序号）填，不漏帧流外信息。
 *   - toolCalls = 该步内完成 tool/call↔tool/result 配对的调用（wire 序）：
 *     outcome 两态 = isError⇒ERROR、否则 OK。DENIED/BUDGET_EXCEEDED 帧流**无源**——治理桥
 *     deny 在 dsh 臂只是 isError=true 的 tool/result（MCP 调用不过宿主 executor，无 tc_ id、
 *     无 IAM 决策记录，REC §3 #10），不许硬造。
 *   - durationMs = 配对 e.time 差（foldDshRunStats :277-287 同法配对）；缺 time 帧 ⇒ 0
 *     （native 未执行调用 durationMs:0 同约定，loop.ts:780），不产负值/NaN 的面由帧流自带
 *     时间单调性担保（同一主机打戳）。
 *   - meta 口径对位 native 审计：final_answer 不进（native 在派发前拦截、audit 无记录；
 *     其轮次仍留空迭代）；技能加载器进（native runToolBlock 有 audit 条目，loop.ts:734-746）
 *     —— 审计判据是**「谁在派发前被拦截」**不是名字，故本处**不写工具名**：native 叫 `load_skill`、
 *     dsh 叫 `skill`（上游常量），两侧同名与否与审计口径无关。
 *     ——与 sketch/SSE 桥的「meta 双剔」不同，审计面只剔 final_answer。
 *   - 未配对 tool/call（abort 撕票等帧不全）不进 toolCalls——帧不全不造 outcome；
 *     调用轨迹仍由 sketch 承载（诚实缺省，信号不丢）。W9-full 起 hostToolCalls 侧表
 *     命中支翻四态 + tc_（REC §3 #10 BUILTIN 段已销，MCP 未命中支两态维持）。
 */
export function foldDshIterations(
  events: readonly DshSessionEvent[],
  hostToolCalls?: ReassembleOptions["hostToolCalls"],
): AgentIteration[] {
  interface PendingCall {
    turn: number;
    step: number;
    callId: string;
    name: string;
    input: unknown;
    time?: number;
  }
  // 配对键 = `${turn}-${step}-${callId}`（team-lead 2026-08-21 裁决②补充，foldDshRunStats :252
  // 的 `${turn}-${step}` fold 键先例上延一段）——callId 唯一性只在步内担保，跨 turn 复用同
  // callId 时裸 callId 键会错配。
  const pending = new Map<string, PendingCall>();
  // 分桶键 = `${turn}-${step}`（缺省 0-0，foldDshRunStats 同兜底）；桶在 step/end 收轮或
  // 首个配对调用落桶时创建。
  const buckets = new Map<string, { turn: number; step: number; toolCalls: AgentIteration["toolCalls"] }>();
  const bucketOf = (turn: number, step: number): { turn: number; step: number; toolCalls: AgentIteration["toolCalls"] } => {
    const key = `${turn}-${step}`;
    let b = buckets.get(key);
    if (!b) {
      b = { turn, step, toolCalls: [] };
      buckets.set(key, b);
    }
    return b;
  };
  for (const e of events) {
    const d = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
    const turn = typeof d.turn === "number" ? d.turn : 0;
    const step = typeof d.step === "number" ? d.step : 0;
    if (e.type === "step/end") {
      bucketOf(turn, step); // 收轮即出迭代（空 step 轮 = 空 toolCalls，native :1041 同形态）
      continue;
    }
    if (e.type === "tool/call") {
      if (typeof d.callId !== "string" || typeof d.name !== "string") continue;
      if (d.name === "final_answer") continue; // meta 口径：派发前拦截，native 审计同无记录
      let input: unknown = d.arguments;
      if (typeof input === "string") {
        try { input = JSON.parse(input); } catch { /* 保留原始字符串（collectToolCalls 同容错） */ }
      }
      pending.set(`${turn}-${step}-${d.callId}`, {
        turn,
        step,
        callId: d.callId,
        name: d.name,
        input,
        ...(typeof e.time === "number" ? { time: e.time } : {}),
      });
      continue;
    }
    if (e.type !== "tool/result") continue;
    const message = d.message as { content?: { type?: string; toolCallId?: string; isError?: boolean }[] } | undefined;
    for (const b of message?.content ?? []) {
      if (b?.type !== "tool-result" || typeof b.toolCallId !== "string") continue;
      const call = pending.get(`${turn}-${step}-${b.toolCallId}`);
      if (!call) continue;
      pending.delete(`${turn}-${step}-${b.toolCallId}`);
      // W9-full 侧表合流（team-lead 2026-08-22 裁决：键 = 帧 callId 原值直通）——命中支 =
      // 事实源（四态 outcome + tc_ 形态 id + 宿主实测 durationMs，覆盖帧推导）；未命中支
      // （MCP/meta 不过宿主）维持帧两态推导。配对权威仍是帧：侧表不补帧外调用。
      const host = hostToolCalls?.get(call.callId);
      bucketOf(call.turn, call.step).toolCalls.push({
        toolCallId: host ? host.toolCallId : call.callId,
        toolName: call.name,
        input: call.input,
        outcome: host ? host.outcome : b.isError === true ? "ERROR" : "OK",
        durationMs: host ? host.durationMs : call.time !== undefined && typeof e.time === "number" ? e.time - call.time : 0,
      });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.turn - b.turn || a.step - b.step)
    .map((b, i) => ({ index: i, toolCalls: b.toolCalls }));
}

/**
 * WO-PROVENANCE-TRACE-FIX · 软收尾时的 **provenance 抢救**（抢救模型**自己声明**的那一份，
 * 不是平台代编一份）。
 *
 * ══ 今天的行为是 X（活服务实测 2026-10-10 · task_01M4JD5ZV67RMXRE896TSMQM59）═══════════
 * 模型调了 `final_answer`，正文与 kpi 块里带 ⟦ref:0⟧…⟦ref:6⟧（**指向它自己那份 provenance 的下标**），
 * 但 `blocks` 不合 `AnswerBlockSchema`（模型用了 `{"type":"text","text":…}` / `{"type":"kpi","items":[…,"ref":N]}`，
 * 平台契约要的是 `markdown` / `provId`）⇒ `FinalAnswerInputSchema.safeParse` 整份失败 ⇒ 走软收尾。
 * 软收尾**只兜正文**（`lastAssistantText`），**把同一份入参里的 provenance 一并丢掉** ⇒ 交付的
 * `answer.provenance` 恒 `[]`，而正文的 ⟦ref:N⟧ 全部落在空表之外（屏上是「有出处」的样子）。
 *
 * ══ 应该是 Y ═══════════════════════════════════════════════════════════════════════════
 * **块不合 schema** 与 **模型没声明出处** 是两件事：前者是格式手滑（WO-DSH-ARM-GAPS 已定性为
 * 不该整份丢），后者才是「不编造溯源」。今天一句 `parsed?.success` 把两件事合并处理了 ——
 * 形态：
 * > **「我用『整份 final_answer 没通过校验』当作『模型没声明过出处』的证据，
 * >   而前者并不度量后者 —— 出处就在同一份被拒的入参里。」**
 * 故软收尾时**只抢救 provenance 这一项**（`blocks` 仍走正文兜底、仍不采信）。
 *
 * ⛔ 两条硬边界（缺一条就不是本函数）：
 *   ① **位置完整性优先**：任一条目不是「带字符串 toolCallId 的对象」⇒ **整份不采**
 *      （丢中间一项会让后面每一项的下标整体前移，⟦ref:N⟧ 会静默指向错误的数据源）。
 *      `outputPath` 缺失/非串降级为 `"$"`（它是展示路径，不影响位置语义）。
 *   ② **空数组 ⇒ undefined**：模型没声明（或声明为空）时**不给平台代编的兜底** ——
 *      「不编造溯源」这条设计一个字没动（`provenance` 仍为空 ⇒ `unverifiedNumerics` 照亮、
 *      屏上仍如实披露）。**这不是** stall/预算尽那两条降级出口的口径：那两条的正文是
 *      **平台自撰**的复述（它知道正文引用的是哪些调用），而软收尾的正文是**模型自撰**的，
 *      平台把「本次成功调用清单」按位置配上去 = 替模型猜下标，正是本仓最忌的「编造」。
 */
export function salvageDeclaredProvenance(
  finalCall: { input: unknown } | undefined,
): { toolCallId: string; outputPath: string }[] | undefined {
  const input = finalCall?.input;
  if (typeof input !== "object" || input === null) return undefined;
  const raw = (input as Record<string, unknown>).provenance;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: { toolCallId: string; outputPath: string }[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) return undefined; // ① 位置完整性：一项坏 ⇒ 整份不采
    const o = e as Record<string, unknown>;
    if (typeof o.toolCallId !== "string") return undefined;
    out.push({ toolCallId: o.toolCallId, outputPath: typeof o.outputPath === "string" ? o.outputPath : "$" });
  }
  return out;
}

/**
 * 重组装主函数。事件顺序即 wire 顺序；只读不改。
 */
export function reassembleDshRun(events: readonly DshSessionEvent[], opts: ReassembleOptions = {}): ReassembledRun {
  const newProvId = opts.newProvId ?? (() => newId("prov")); // 与 loop.ts 同一生成器（ids.ts 单源）
  const calls = collectToolCalls(events);
  const toolNameByCallId = new Map(calls.map((c) => [c.toolCallId, c.name]));
  // WO-PROVENANCE-TRACE-FIX · **模型面 id 与帧 id 不是同一个字符串**：模型在上下文里看到的
  // 是工具回执信封 `<tool_data tool_call_id="tc_…">`（宿主审计行 id），而帧流里是 DSH 自己的
  // `call_00_…`。模型声明 provenance 时引用的是**它看得见的那个**（实测其思考里写的正是 `tc_…` 形态），
  // 只按帧 id 回填 ⇒ 每一条都落 `"unknown"`（有表、但每条都指不出是哪件工具）。
  // 故再用宿主侧表（帧 callId → 宿主 tc_ id）补一张反向表，**两种 id 都认**。
  // ⛔ 只补不覆盖：帧 id 命中优先（同一条调用两个 id 都指同一工具，先到先得即可）。
  //
  // ⚠️ 侧表的**键不是帧 callId**（本仓实测 2026-10-10）：内置 MCP 反向通道的 callId 由**桥进程自铸**
  // （`mcp-host-bridge.ts` `nextCallId`：`{模型面全名}@{自增序号}`，MCP wire 上带不了 DSH 帧 id）
  // ⇒ 原「按帧 callId 取值」这一路**恒不命中**，值（宿主 `tc_…` 审计行 id）就永远拿不到名字。
  // 桥铸造的键**前缀本身就是模型面全名**，故此处从键前缀取回，并**要求它逐字出现在本 run 帧流的
  // 工具名集合里**（自证）：形态一变只会退回 `"unknown"`，**绝不会把名字安到另一次调用头上**。
  const frameToolNames = new Set(calls.map((c) => c.name));
  for (const [bridgeCallId, host] of opts.hostToolCalls ?? []) {
    if (toolNameByCallId.has(host.toolCallId)) continue;
    const at = bridgeCallId.lastIndexOf("@");
    const fromKey = at > 0 ? bridgeCallId.slice(0, at) : undefined;
    const name =
      toolNameByCallId.get(bridgeCallId) ?? (fromKey !== undefined && frameToolNames.has(fromKey) ? fromKey : undefined);
    if (name !== undefined) toolNameByCallId.set(host.toolCallId, name);
  }
  // sketch：loop.ts:1146 同口径 —— 元工具（final_answer/技能加载器）不进 sketch。
  // 技能加载器名 = dsh 臂真名 `skill`（上游常量，@deepseek-ai/dsh-tool-skill，不可配）；
  // native 的 `load_skill` 不流经本函数（本函数只吃 dsh 帧流）。
  const sketch = calls
    .filter((c) => c.name !== "final_answer" && c.name !== "skill")
    .map((c) => ({ toolName: c.name, inputSummary: JSON.stringify(c.input ?? {}).slice(0, 200) }));

  const reason = turnEndReason(events);
  const outcome = reason === "completed" ? "ANSWERED"
    : reason === "max-tokens" ? "BUDGET_EXHAUSTED"
    : "FAILED";

  // W9-lite：iterations 骨架与 stats 同为帧流纯 fold，三条 ok:true 出口恒带（失败路径不造）。
  // W9-full：hostToolCalls 侧表入 fold（命中支四态+tc_+宿主 durationMs，未命中支帧两态维持）。
  const iterations = foldDshIterations(events, opts.hostToolCalls);

  // WO-DSH-ARM-FAILURE-VISIBLE：失败披露块（可点名）——**三条答案出口共用同一份**（stall / 预算尽 /
  // 常规收尾），零失败的运行 ⇒ 空数组（不产块），故既有夹具字节不变。
  const failureBlocks = (() => {
    const block = renderFailedCallsBlock(collectFailedCalls(events, opts.hostToolCalls));
    return block ? [block] : [];
  })();

  const finalCall = [...calls].reverse().find((c) => c.name === "final_answer");

  // N3 · stall-loop 分类前置（degrade 短路语义，先于 expectsSchema/final_answer 分支）：
  // watchdog cancel 落帧 ⇒ outcome BUDGET_EXHAUSTED + degraded{STALL_LOOP}（对位 loop.ts:1182）
  // + 诚实降级块（header 模板镜像 loop.ts:620-632，cap 从帧 cause 取——reassemble 保纯不读 env）
  // + provenance 仅成功 callId 去重 outputPath "$"（loop.ts:644-656 同口径；失败/未答调用不进）。
  const stall = stallLoopCause(events);
  if (stall) {
    const budgetNote = `反复以相同参数调用同一工具、未获新信息（环检测·loopRepeatCap=${stall.cap ?? "?"}）`;
    const header = `[预算耗尽·诚实摘要] ⚠️ 检测到无进度循环：${budgetNote}——本次深问未能完全解答（已诚实终止，未烧尽预算）。以下为已探索到的线索：`;
    const blocks: AnswerBlock[] = [
      { type: "text", markdown: header },
      { type: "text", markdown: synthesizePartialFindings(events, sketch) },
      ...failureBlocks,
    ];
    const provenance: ProvenanceRef[] = successfulCallIds(events).map((toolCallId) => ({
      id: newProvId(),
      source: "TOOL_RESULT",
      toolCallId,
      toolName: toolNameByCallId.get(toolCallId) ?? "unknown",
      outputPath: "$",
    }));
    return {
      ok: true,
      outcome: "BUDGET_EXHAUSTED",
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: scanBlocks(blocks, provenance.length) },
      sketch,
      degraded: { reason: "STALL_LOOP" },
      closing: "DEGRADED",
      iterations,
    };
  }

  // W8主 · B6 预算降级桥分类前置（与上方 stall 分支同构，先于 expectsSchema/final_answer）：
  // tool-bridge 收宿主 BUDGET_EXCEEDED ⇒ cancel 落帧 ⇒ outcome BUDGET_EXHAUSTED +
  // degraded{BUDGET_EXHAUSTED} + 诚实摘要头（loop.ts:632 BUDGET_EXHAUSTED 支模板逐字，
  // budgetNote = 宿主 reason 原值）+ 部分发现抢救 + provenance 仅成功 callId（stall 同口径）。
  const budgetHit = budgetExhaustedCause(events);
  if (budgetHit) {
    const budgetNote = budgetHit.reason ?? "round-trip/迭代上界";
    const header = `[预算耗尽·诚实摘要] ⚠️ 已达最大探索轮次/预算（${budgetNote}）：本次深问未能完全解答。以下为已探索到的线索：`;
    const blocks: AnswerBlock[] = [
      { type: "text", markdown: header },
      { type: "text", markdown: synthesizePartialFindings(events, sketch) },
      ...failureBlocks,
    ];
    const provenance: ProvenanceRef[] = successfulCallIds(events).map((toolCallId) => ({
      id: newProvId(),
      source: "TOOL_RESULT",
      toolCallId,
      toolName: toolNameByCallId.get(toolCallId) ?? "unknown",
      outputPath: "$",
    }));
    return {
      ok: true,
      outcome: "BUDGET_EXHAUSTED",
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: scanBlocks(blocks, provenance.length) },
      sketch,
      degraded: { reason: "BUDGET_EXHAUSTED" },
      closing: "DEGRADED",
      iterations,
    };
  }

  // N2·D-2：stats 纯 fold（零 usage ⇒ undefined ⇒ 键不出）；失败路径（ok:false）不造。
  const stats = foldDshRunStats(events);

  // expectsSchema 模式：schema 校验后 structured = raw input。
  // 校验对位 loop.ts:1284（acceptFinalAnswer 的 expectsSchema 分支）——同一 checkJsonSchema
  // （util/jsonschema.ts）import 复用，单源零漂移；invalid ⇒ fail-closed ok:false
  // （与下方 provenancePolicy/writeMode rejects 同通道）。
  // ⚠ 注释订正（W2 批2③）：本分支原注释自称「对位 loop.ts:147/256」——:256 只是
  //   AgentLoopResult.structured 的类型注释、:147 非校验点，真校验在 acceptFinalAnswer；
  //   原实现 raw 直通无校验，invalid structured 会落进 result.structured（探针实证，
  //   dsh-runtime-reassemble.test.ts ③ 组 red-first 两条）。
  if (opts.expectsSchema !== undefined) {
    if (!finalCall) {
      return { ok: false, errors: ["expectsSchema 模式但帧流中无 final_answer 调用"] };
    }
    const schemaErrors = checkJsonSchema(finalCall.input, opts.expectsSchema);
    if (schemaErrors.length > 0) {
      return { ok: false, errors: [`expectsSchema 校验失败: ${schemaErrors.join("; ")}`] };
    }
    return {
      ok: true,
      outcome,
      answer: { trustLevel: "AGENT_EXPLORATORY", blocks: [{ type: "text", markdown: lastAssistantText(events) || "（结构化回答见 structured）" }, ...failureBlocks], provenance: [], unverifiedNumerics: false },
      sketch,
      structured: (typeof finalCall.input === "object" && finalCall.input !== null ? finalCall.input : {}) as Record<string, unknown>,
      ...(outcome === "BUDGET_EXHAUSTED" ? { degraded: { reason: "BUDGET_EXHAUSTED" as const } } : {}),
      closing: "FINAL_ANSWER",
      ...(stats ? { stats } : {}),
      iterations,
    };
  }

  let blocks: AnswerBlock[];
  const provenance: ProvenanceRef[] = [];
  // ══ WO-DSH-ARM-GAPS · 软收尾的**第二条入口**（原本只有「压根没调 final_answer」一条）═════════════
  //
  // 改前：`final_answer` 调了但入参不合 schema ⇒ **整份答案硬拒**（ok:false）⇒ engine 出口 FAILED，
  //   屏上是 `dsh 重组装拒绝：final_answer 入参校验失败: Invalid input: expected string, received undefined`
  //   —— 内核名 + 英文 zod 错误 + provenance=0（实测 task_01M3YBVK7A8KY4MW2AH5MWBNQH）。
  // 改后：与「没调 final_answer」**共用同一条软收尾支**（正文兜底 `lastAssistantText`）。
  //
  // ══ 为什么这是缺陷、而不是「设计如此」——两条臂的对照 ═══════════════════════════════════════
  // 原生臂（loop.ts:1188 起）对同一情形的处置是**把错误回注给模型再跑一轮**：
  //   `final_answer 参数校验失败: …` 作为 tool_result（isError）回注 ⇒ 模型重试 ⇒ 用户**从头到尾看不到那句错误**。
  // 而 dsh 臂是子进程**收束之后**的纯 fold，模型已退出 ⇒ **结构上无法回注**（本文件 reflect 一节已把这条
  //   处境写死过一次，处置同为「走第二支：把残余缺口明写进答案，不静默发半成品」）。故此处照同一范式走第二支。
  //
  // ⚠️ 真正说不通的是**改前那对组合的反差**：模型**更差**的行为（压根不调 final_answer）拿到软收尾
  //   （用户读到正文），模型**更好**的行为（调了 final_answer 但写错字段名）却拿到硬拒 + 英文错误上屏。
  //   形态（铁律 0.6 句式）：
  // > **「我用『它调用了 final_answer 却没收下』当作『该给用户的答案不存在』的证据，
  // >   而前者并不度量后者 —— 正文就在帧流里，同一份帧流在另一条入口下是被读出来给用户看的。」**
  //
  // ══ 安全边界：这一步**没有**放宽任何治理面（逐条点名，缺一条都不成立）═══════════════════════
  //   · 数字红线（下方 `scanBlocks(blocks)`）照跑 —— 软收尾的正文**同样**被扫，agent 自撰的裸数照样拒。
  //   · `provenancePolicy=required` **判据未动**（仍是「表为空即拒」）—— 只是「模型没声明 provenance」
  //     与「模型声明了但 blocks 写坏」不再被合并成同一个结果：前者照拒（反向金丝雀·甲咬这条），
  //     后者的要求**本来就已被满足**（final_answer 里确实带了 provenance）⇒ 采信它，不是放宽门。
  //   · `writeMode`（要求 action_draft 块）照拒 —— 软收尾无该块 ⇒ 必红。
  //   即：**被放宽的只有「格式手滑」。治理与红线一个字没动。**
  const parsed = finalCall ? FinalAnswerInputSchema.safeParse(finalCall.input) : undefined;
  // loop.ts:1431-1446 同口径：模型声明的每一条 {toolCallId, outputPath} → 全量 ProvenanceRef，
  // toolName 从帧流回填（`audit?.toolName ?? "unknown"` 同口径）。
  const pushProvenance = (declared: readonly { toolCallId: string; outputPath: string }[]) => {
    for (const p of declared) {
      provenance.push({
        id: newProvId(),
        source: "TOOL_RESULT",
        toolCallId: p.toolCallId,
        toolName: toolNameByCallId.get(p.toolCallId) ?? "unknown", // loop.ts: audit?.toolName ?? "unknown" 同口径
        outputPath: p.outputPath,
      });
    }
  };
  if (parsed?.success) {
    blocks = parsed.data.blocks;
    pushProvenance(parsed.data.provenance);
  } else {
    // 软收尾（无 final_answer **或** final_answer 入参不合 schema）：最后文本兜底。
    // ⚠ WO-PROVENANCE-TRACE-FIX 起：**正文兜底 ≠ 出处也丢** —— 模型在同一份被拒的入参里
    //   声明的 provenance 照抢救（见 salvageDeclaredProvenance 头注：位置完整性 + 空则不给兜底）。
    //   `blocks` 仍一个字节都不采信（模型那份 `text`/`ref` 字段名不合契约，采信即改契约）。
    blocks = [{ type: "text", markdown: lastAssistantText(events) || "（探索模式未能产出回答）" }];
    const salvaged = salvageDeclaredProvenance(finalCall);
    if (salvaged) pushProvenance(salvaged);
  }

  const policy = opts.governance?.provenancePolicy ?? "best_effort";
  if (policy === "required" && provenance.length === 0) {
    return { ok: false, errors: ["Skill provenancePolicy=required：final_answer 必须包含 provenance"] };
  }
  if (opts.governance?.writeMode && !blocks.some((b) => b.type === "action_draft")) {
    return { ok: false, errors: ["挂载的 Skill 为 WRITE/审批类型，final_answer 必须包含 action_draft 块"] };
  }

  // ══ WO-DSH-REDLINE-PARITY（仓主 2026-10-03 裁决）· dsh 路**不再阻断**，对齐原生路 ═══════════
  //
  // 本处原为 `if (scanBlocks(blocks)) return {ok:false, code:NUMERIC_REDLINE}` —— **无条件硬拦**。
  // 裁决依据是配对实测（同一句排产问话、同一 agent、同一提示词、同一判据 `scanBlocks`）：
  //   · 原生路答案 `unverifiedNumerics=true` ⇒ **照常整份交付**（三方案 + 5 条溯源 + 33 条规则）；
  //   · dsh 路**同等质量**的答案（三方案 + 9 处 ⟦ref:N⟧）⇒ **整份拒绝**，用户只看到一句红线文案。
  //   ⇒ 同一个判据、同一个值，两条路两种结局。dsh 臂因此**结构上交付不了**本平台的目标产物
  //     （「形成多个方案和方案比对」），且与答案质量无关：模型答得再好，只要有一个句子的数字没带
  //     ⟦ref:N⟧，整份就没了 —— 而模型确实做不到句句不漏（实测 9 处引用仍有 2 句漏）。
  //
  // 为什么选「对齐」而不是「收紧原生路」：收紧是一次**平台级**产品动作，须同时作用于两条路
  //   （仓主原则「所有计算用求解器」不区分内核）。只拦一条时 #17 的 DSH 双跑不成立 ——
  //   两臂不在同一交付契约下，比值不度量任何东西。
  //
  // ⚠️ **本单一个字没动判据**：`scanBlocks` 仍是单源、仍是 `unverifiedNumerics` 的取值处
  //   （下方 answer 组装），两条路的处置计数也仍是同一个 `numericRedline` 计数器
  //   （engine 侧现均为 `would_block`）。**降的是处置，不是检测。**
  //
  // ⚠️ 对齐的代价，明写在这里（不许读成「红线不灵了」）：一份「一条 provenance + 十个编造数字」
  //   的产出，今天**照样交付**，只带 `unverifiedNumerics:true` 诚实标。这正是原生路的既有口径。
  //   真要把红线推成平台级**阻断**，先修下面这条 —— 否则收紧的力度取决于模型爱不爱写编号列表。
  //
  // ⚠️ 检测器自身已登记的缺陷（**本单未修**，对齐后它不再拦人，但会污染 `would_block` 计数）：
  //   切句器 `(?<=\.)(?=\s|$)` 在半角序号的句点后切一刀 ⇒ `"1. 某句"` 被切成 `["1.", " 某句"]`，
  //   独立段 `"1."` 无引用标记且匹配数字正则 ⇒ 判违规。实测两份答案共 12 处触发，**7 处（58%）
  //   是 markdown 有序列表序号**（`1.`/`2.`/`3.`）。⇒ 该门今天度量的是「引用格式完备度」，
  //   不是「数字是不是模型编的」—— 求解器真跑出来的数字，同句没带 ⟦ref:N⟧ 一样判裸数。
  //   形态：「我用『这句里有数字字符且无引用标记』当作『这个数字是模型编的』的证据，
  //   而前者并不度量后者。」（仓内既有的 multihop 真实语料已把这条钉过一次，见 reassemble 测试。）

  // WO-DSH-REFLECT-PARITY · 收尾前确定性复盘（`agent/reflect.ts` 单源四查；与原生路 `opts.reflect` 同判据同门控）。
  //
  // **处置只对位原生路的第二支**（「重规划预算尽 ⇒ 诚实收尾」）：本路是子进程**收束之后**的纯 fold，
  // 模型已退出 ⇒ 结构上无法把 reasons 回注进子进程再跑一轮（原生路第一支「回注 + 有界重规划」在此不存在）。
  // 故走第二支：**把残余缺口明写进答案**，不静默发半成品（KILL-MOCK-RED 同口径）。
  // ⛔ 不许把这条读成「已对齐原生路完整语义」——差的就是那一轮重规划，登记在案。
  //
  // 位置：与原生路**同序**（`loop.ts` 的 reflect 支同样把缺口块拼进 blocks 后，再以扫描值出 answer）
  // —— 故 `unverifiedNumerics` 两路都含平台自撰的缺口文案，口径一致，无可比性问题。
  // WO-DSH-ARM-FAILURE-VISIBLE：失败披露块**接在答案之后、复盘缺口块之前**（顺序 load-bearing：
  // 复盘块在两条路里都是「最后一句」（原生路同序），本块插到它前面才不改变那个观察面）。
  blocks = [...blocks, ...failureBlocks];
  let reflected = false;
  let replanReasons: string[] | undefined;
  if (opts.reflect) {
    const verdict = reflectAnswer({
      blocks,
      provenanceCount: provenance.length,
      iterations,
      userContent: opts.reflect.userContent,
    });
    if (!verdict.ok) {
      reflected = true;
      replanReasons = verdict.reasons;
      blocks = [
        ...blocks,
        {
          type: "text",
          // ★ WO-REFLECT-JARGON-SPLIT：上屏只用 `userReasons`。原串还用 `reasons` 并把
          // 「dsh 路·收束后不可回注重规划」印在用户屏上 —— 内核名 + 内部循环机制，用户读了做不了任何决定
          //（与原生路同一形态，故一并按同一判据处置）。
          // `replanReasons` 审计字段仍留 `verdict.reasons`（模型口径），要追病因去那里追。
          markdown: `【本次回答的已知不足】${verdict.userReasons.join("；")}`,
        },
      ];
    }
  }

  // W2 批3（team-lead 2026-08-21 裁决·dsh 自体修复②）：max-tokens 截断收尾补诚实摘要头——
  // 镜像上方 stall 路模板（同形：header 块 + 截断前文/产出块），对位 native degrade 有界终止
  // 必带诚实前缀的约定（loop.ts:620-634）。stall 路自带头提前 return，不会叠双头；
  // expectsSchema 分支同有 BUDGET_EXHAUSTED 可能（:417），其 answer 是占位文案，不在本修复面。
  // 语料锚 = corpus.ts LENGTH_TRUNCATION_HEADER（漂移即红，锚的职能）。
  if (outcome === "BUDGET_EXHAUSTED") {
    blocks = [
      {
        type: "text",
        markdown:
          "[预算耗尽·诚实摘要] ⚠️ 模型输出触长度上限被截断——本次深问未能完全解答（已诚实终止）。以下为已探索到的线索：",
      },
      ...blocks,
    ];
  }

  return {
    ok: true,
    outcome,
    answer: { trustLevel: "AGENT_EXPLORATORY", blocks, provenance, unverifiedNumerics: scanBlocks(blocks, provenance.length) },
    sketch,
    ...(outcome === "BUDGET_EXHAUSTED" ? { degraded: { reason: "BUDGET_EXHAUSTED" as const } } : {}),
    closing: parsed?.success ? "FINAL_ANSWER" : "SOFT_CLOSE",
    ...(stats ? { stats } : {}),
    iterations,
    ...(reflected ? { reflected, replanReasons } : {}),
  };
}

// ---------------------------------------------------------------------------
// SSE 桥（E6 三档 verdict 的可重建档）：dsh 帧 → query-task SSE 事件增量。
// 返回 undefined = 该帧不产生 SSE 事件（answer.final/task.failed 由 runner 在 turn/end 时
// 用重组装结果发，不走逐帧映射——载荷要完整 Answer）。
// ---------------------------------------------------------------------------

export interface SseEmission {
  event: string;
  payload: Record<string, unknown>;
}

/**
 * loop.ts:1146 同口径：元工具不进 sketch，也不进 SSE 桥（D-7）。
 * ⚠ 技能加载器**两臂名字不同**，本集只装 dsh 帧流里出现的真名：
 *   · native `load_skill`（我方常量，tools/registry.ts:481）—— 不进本函数；
 *   · dsh `skill`（上游常量，@deepseek-ai/dsh-tool-skill@0.1.0-rc.6，不可配）—— P2A 换名后就是它。
 * 写错名字 = meta 帧不再被 skip ⇒ 技能加载会以 `type:"skill"` 上 SSE 面（native 不发这步）。
 */
const META_TOOL_NAMES = new Set(["final_answer", "skill"]);

/**
 * N2·D-7 · SSE 桥工厂（原 mapDshEventToSse 纯函数 → 工厂持态版）。
 * 内持 meta callId 集：tool/call 遇 meta 工具（final_answer/`skill`）skip 并记集，
 * tool/result 查集 skip——meta 帧不上 SSE 面（native loop 也不为它们发 step 事件）。
 * 既有三映射分支（tool/call·tool/result·text-delta）逐字节不动（POC toEqual 锚定即闸）。
 */
export function createSseMapper(): (e: DshSessionEvent) => SseEmission | undefined {
  const metaCallIds = new Set<string>();
  return (e: DshSessionEvent): SseEmission | undefined => {
    const d = (typeof e.data === "object" && e.data !== null ? e.data : {}) as Record<string, unknown>;
    switch (e.type) {
      case "tool/call": {
        // loop.ts:844 同形：stepId = toolCallId，type = 工具名
        const first = collectToolCalls([e])[0];
        if (!first) return undefined;
        if (META_TOOL_NAMES.has(first.name)) {
          metaCallIds.add(first.toolCallId);
          return undefined;
        }
        return { event: "step.started", payload: { stepId: first.toolCallId, type: first.name } };
      }
      case "tool/result": {
        const message = d.message as { content?: { type?: string; toolCallId?: string; isError?: boolean }[] } | undefined;
        const tr = (message?.content ?? []).find((b) => b?.type === "tool-result");
        if (!tr) return undefined;
        if (tr.toolCallId !== undefined && metaCallIds.has(tr.toolCallId)) return undefined;
        return { event: "step.completed", payload: { stepId: tr.toolCallId, status: tr.isError ? "ERROR" : "OK" } };
      }
      case "assistant/chunk": {
        // E6：narration 可映射 assistant/chunk 文本帧。帧形 {turn, step, chunk}，
        // chunk 是原始 LLM chunk（text-delta 才带文本）。
        const chunk = d.chunk as { type?: string; index?: number; text?: string } | undefined;
        // N2·D-1：reasoning-delta 逐 delta 流式透传（与 text-delta 同构；stepId 带 index 防多块互覆）。
        if (chunk?.type === "reasoning-delta") {
          const think = chunk.text;
          return think
            ? { event: "step.completed", payload: { stepId: `think-${d.turn ?? 0}-${d.step ?? 0}-${chunk.index ?? 0}`, type: "agent_think", text: think } }
            : undefined;
        }
        const text = chunk?.type === "text-delta" ? chunk.text : undefined;
        return text ? { event: "step.completed", payload: { stepId: `narration-${d.turn ?? 0}-${d.step ?? 0}`, type: "agent_narration", text } } : undefined;
      }
      // N2·D-4：compaction 伪步对（selectStepRows 按 stepId fold 三帧合一行）。command/run|done 不映射。
      case "compaction/start": {
        const id = typeof d.compactionId === "string" ? d.compactionId : "unknown";
        return { event: "step.started", payload: { stepId: `compaction-${id}`, type: "compaction" } };
      }
      case "compaction/summary": {
        const id = typeof d.compactionId === "string" ? d.compactionId : "unknown";
        const n = Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : 0;
        const tokens = typeof d.shadowedTokenCount === "number" ? d.shadowedTokenCount : 0;
        return { event: "step.completed", payload: { stepId: `compaction-${id}`, type: "compaction", text: `已压缩 ${n} 条/约 ${tokens} tokens` } };
      }
      case "compaction/end": {
        const id = typeof d.compactionId === "string" ? d.compactionId : "unknown";
        const error = typeof d.error === "string" && d.error ? d.error : undefined;
        // error 原文逐字透传（PRD §5.1 不顶替）；无 summary ⇒ 零「已压缩」文本。
        return {
          event: "step.completed",
          payload: { stepId: `compaction-${id}`, type: "compaction", outcome: error ? "ERROR" : "OK", ...(error ? { text: error } : {}) },
        };
      }
      default:
        return undefined;
    }
  };
}
