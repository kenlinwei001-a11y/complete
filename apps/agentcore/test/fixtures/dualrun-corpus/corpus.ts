/**
 * WO-DSH-E2E · L1 双跑语料（60 任务 + 2 gated 槽）——纯数据，零 IO。
 *
 * 对账口径单源 = 同目录 RECONCILIATION.md（team-lead 2026-08-19 重定义：
 * scalar + kernel 唯一白名单 + native 迭代锚 + dsh stats 对齐）。摘要：
 * - 每条任务 = {native 臂 mock 队列剧本, dsh 臂 stub 剧本(+PLATFORM_GOV_DENY), 期望声明}；
 * - dsh 臂 meta-tools only（生产档 cordis.yml 零真工具插件）：final_answer / load_skill / 纯文本轮；
 * - 答案块零裸数（生产 scanBlocks 语义：token 内嵌数字如 dr50-xx 不算，孤立数字算；
 *   两臂同算，保 unverifiedNumerics:false 锚简洁）；
 * - native load_skill 入参键 = skillId，dsh = key（声明映射，RECONCILIATION §2-A4）。
 *
 * 跨单回执（蓝图末行）：角色路/场景路 STALL_LOOP 各一槽 → GATED_SLOTS（静默缝 WO 未落线，
 * driver 鸣报 skipped，不冒充覆盖）。
 */
import type { Answer, AnswerBlock, RuleVerdict } from "@platform/contracts";
import { SCENARIO_CATALOG } from "../../../src/scenarios-catalog.js";
import { text, toolUse, type ScriptedTurn } from "../../../src/llm/mock.js";
import type { StubRound } from "../../helpers-dsh-stub.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type TaskClass = "answer" | "deny_pre" | "deny_mid" | "deny_all" | "deny_prefork";

export interface CorpusSkill {
  key: string;
  name: string;
  summary: string;
  body: string;
  /** skill precondition 规则引用（deny_prefork 类用；engine.ts 分叉前预检的输入）。 */
  preRuleKeys?: string[];
}

export interface IterationAnchor {
  calls: { toolName: string; outcome: string; input?: unknown }[];
}

export interface DshStatsAnchor {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  pressureTokens: number;
  turns: number;
  steps: number;
}

export interface DualRunTask {
  id: string;
  cls: TaskClass;
  source: "scenario" | "synthetic";
  prompt: string;
  skills: CorpusSkill[];
  ruleBindings: { ruleKeys: string[]; mode: "PRE_CHECK" | "POST_CHECK" | "BOTH" };
  /** G2 结构化任务：expectsSchema 透传 runRegisteredAgent（engine.ts:225 两臂接线俱在）。 */
  expectsSchema?: Record<string, unknown>;
  dsh: { rounds: StubRound[]; govDeny?: string[] };
  native: { turns: ScriptedTurn[]; preBlock?: RuleVerdict[]; postBlock?: RuleVerdict[] };
  expect: {
    answer: Answer;
    /** G2：structured 深等锚（result.structured 双臂捕获比对；非结构化任务缺省 = 两臂同 undefined）。 */
    structured?: unknown;
    nativeIterations: IterationAnchor[];
    nativeTokens: { input: number; output: number };
    /** dsh 臂 stats 锚（usage 折出和）；deny_prefork（零 spawn）无。 */
    dshStats?: DshStatsAnchor;
    /** dsh 臂治理桥真 deny 的 wire 证据位：requests[i].body 须含 reason 逐字。 */
    denyWire?: { requestIndex: number; reason: string }[];
    /** deny_prefork：分叉前预检早退 ⇒ dsh 零 spawn（反向哨兵）。 */
    dshZeroSpawn?: boolean;
    /**
     * EMPTY 空块类专用：发车哨兵第 3 条（answer 含任务 marker）条件豁免位。
     * 仅当 expect.answer 结构上不可能携带 marker（空 blocks / 空 markdown / 空白软收尾）
     * 才允许置 true；driver 谓词会结构性复核（豁免位 ∧ 期望值确无 marker 才跳过，
     * 且 A0 闸断言「豁免 ⇔ 期望答案无 marker」双恰），误置不会静默放水。
     * 豁免时的替代发车证据：dsh 臂 wire 首请求体含本任务 prompt（prompt 必含 id，
     * A0 闸同断）+ stats/sessionStats 锚；native 臂 token/迭代锚（mock 按消费记账）。
     */
    skipMarkerSentinel?: boolean;
    /**
     * G3 length 截断分歧（RECONCILIATION §3 #9 缝观察·team-lead 2026-08-21 裁决）：
     * finish_reason=length 场景 = 设计取向差（native 宽容软收尾 / dsh 诚实降级），
     * 两臂**不互比**，各锚各的声明产物（先例 = A4 token 账两臂分锚）。
     * 置位后 driver 分锚：native 臂锚 = expect.answer 本位 + outcome ANSWERED +
     * budgetExhausted false + 无 degraded（四件常量在 driver 写死）；dsh 臂锚 = 本字段四件套。
     * 全局 A1/A4/outcome 互比对其他任务零放宽。
     */
    lengthDivergence?: {
      dsh: {
        outcome: "BUDGET_EXHAUSTED";
        answer: Answer;
        budgetExhausted: true;
        degraded: { reason: "BUDGET_EXHAUSTED" };
      };
    };
  };
}

// ---------------------------------------------------------------------------
// 构造件（纯函数）
// ---------------------------------------------------------------------------

/** stub 剧本标准 usage（逐轮同值；stats 锚按轮数折出）。 */
export const STUB_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

/** 治理桥 mock 模式 deny reason 模板（platform-governance.mjs:31 逐字）。 */
export const govDenyReason = (tool: string): string =>
  `mock rule engine: tool ${tool} denied by ruleBindings PRE_CHECK`;

/** 语料技能 id（driver insert 用同一函数，单源）。 */
export const skillIdOf = (taskId: string, key: string): string => `skl_${taskId}_${key}`;

const T = (markdown: string): AnswerBlock => ({ type: "text", markdown });
const RV = (ruleId: string, explanation: string, provId: string): AnswerBlock => ({
  type: "rule_violation", ruleId, severity: "BLOCK", explanation, provId,
});

const expectAnswer = (blocks: AnswerBlock[], provenance: Answer["provenance"] = []): Answer => ({
  trustLevel: "AGENT_EXPLORATORY",
  blocks,
  provenance,
  unverifiedNumerics: false,
});

/** provenance 形态任务的期望溯源（两臂同引未解析 id ⇒ toolName "unknown"；id/toolCallId 走比对器归一）。 */
const maskedProv = (n: number): Answer["provenance"] =>
  Array.from({ length: n }, () => ({
    id: "prov-masked",
    source: "TOOL_RESULT" as const,
    toolCallId: "tc-masked",
    toolName: "unknown",
    outputPath: "$",
  }));

/** dsh stats 锚：r 轮 × STUB_USAGE（pi-ai 折出：无 cache hit ⇒ uncached=prompt_tokens）。 */
const stats = (r: number): DshStatsAnchor => ({
  uncachedInputTokens: STUB_USAGE.prompt_tokens * r,
  outputTokens: STUB_USAGE.completion_tokens * r,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  pressureTokens: STUB_USAGE.prompt_tokens,
  turns: 1,
  steps: r,
});

const rFa = (args: unknown): StubRound => ({
  toolCall: { name: "final_answer", arguments: JSON.stringify(args) }, usage: STUB_USAGE,
});
const rLs = (key: string): StubRound => ({
  toolCall: { name: "load_skill", arguments: JSON.stringify({ key }) }, usage: STUB_USAGE,
});
const rTx = (t: string): StubRound => ({ text: t, usage: STUB_USAGE });

const nFa = (args: unknown): ScriptedTurn => ({ content: [toolUse("final_answer", args)] });
const nLs = (skillId: string): ScriptedTurn => ({ content: [toolUse("load_skill", { skillId })] });
const nTx = (t: string): ScriptedTurn => ({ content: [text(t)] });

/** G3：finish_reason=length 截断轮（dsh stub 文本轮覆盖 finishReason；native mock stopReason 逐字透传）。 */
const rTxLen = (t: string): StubRound => ({ text: t, usage: STUB_USAGE, finishReason: "length" });
const nTxLen = (t: string): ScriptedTurn => ({ content: [text(t)], stopReason: "length" });

/**
 * G3 诚实摘要头锚（镜像 reassemble.ts max-tokens 路模板逐字——即 stall 路 :372 同形：
 * 「[预算耗尽·诚实摘要] ⚠️ …未能完全解答…以下为已探索到的线索：」）。
 * 语料锚与产品码各自持字面量（同 STRUCTURED_ANSWER_TEXT 对 loop.ts 的锚法）：漂移即红，正是锚的职能。
 */
export const LENGTH_TRUNCATION_HEADER =
  "[预算耗尽·诚实摘要] ⚠️ 模型输出触长度上限被截断——本次深问未能完全解答（已诚实终止）。以下为已探索到的线索：";

/** 长上下文填充（确定性；≥4096 字符 = 蓝图「4KB 长上下文」档）。 */
const longPrompt = (q: string, id: string): string => {
  const filler = `背景材料（${id}）：锂电产销运营长上下文填充段，订单产能物料现金流口径铺陈。`;
  let p = `${q}\n\n${filler}`;
  while (p.length < 4096) p += filler;
  return p;
};

/** 超长输出填充（确定性；≥32KB = G4 长输出档）。全段零裸数（scanBlocks 护栏），携带任务 marker。 */
const longMarkdown = (id: string): string => {
  const para = `【${id}】超长输出确定性填充段：锂电产销运营口径铺陈，订单产能物料现金流逐条展开，供双跑字节比对压力测试。\n\n`;
  let m = para;
  while (m.length < 32768) m += para;
  return m;
};

const skill = (key: string, taskId: string, preRuleKeys?: string[]): CorpusSkill => ({
  key,
  name: `语料技能 ${key}（${taskId}）`,
  summary: `供 ${taskId} 双跑对账的剧本化技能 ${key}`,
  body: `## ${key} 正文（${taskId}）\n\n口径铺陈与剧本化材料，供 load_skill 轮次消费。`,
  ...(preRuleKeys ? { preRuleKeys } : {}),
});

const SKILL_KEYS = ["sk-a", "sk-b", "sk-c", "sk-d"] as const;

// ---------------------------------------------------------------------------
// 任务类构造器
// ---------------------------------------------------------------------------

interface ClassOpts {
  id: string;
  source: "scenario" | "synthetic";
  prompt: string;
}

/** answer · 立即收尾（零工具轮，一次 LLM 往返）。 */
function answerImmediate(o: ClassOpts & { blocks?: AnswerBlock[]; provenance?: { toolCallId: string; outputPath: string }[] }): DualRunTask {
  const blocks = o.blocks ?? [T(`【${o.id}】剧本化回答：按声明口径直接收尾。`)];
  const args = { blocks, provenance: o.provenance ?? [] };
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rFa(args), rTx(`收尾 ${o.id}`)] },
    native: { turns: [nFa(args)] },
    expect: {
      answer: expectAnswer(blocks, maskedProv((o.provenance ?? []).length)),
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
    },
  };
}

/** answer · 软收尾（纯文本轮，无 final_answer）。 */
function answerSoft(o: ClassOpts): DualRunTask {
  const t = `【${o.id}】软收尾文本：模型未调 final_answer，末次文本兜底。`;
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rTx(t)] },
    native: { turns: [nTx(t)] },
    expect: {
      answer: expectAnswer([T(t)]),
      nativeIterations: [],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(1),
    },
  };
}

/**
 * answer · G3 length 截断（finish_reason=length 单文本轮）。
 * 链：native mock stopReason 逐字 ⇒ loop.ts:1027 ≠"tool_use" ⇒ degrade("ANSWERED") 软收尾
 * （无 reason ⇒ 无摘要头/无 degraded/budgetExhausted=false，loop.ts:635-637/659——设计取向差，
 * native 侧不修，REC §3 #9）；dsh pi-ai mapStopReason length⇒max-tokens ⇒ reassemble outcome
 * BUDGET_EXHAUSTED + degraded{BUDGET_EXHAUSTED} + 诚实摘要头 + engine 出口 run.budgetExhausted=true
 * （W2 批3 dsh 自体修复两件）。双臂分锚不互比（先例 = A4 token 账）。
 */
function answerLengthTruncated(o: ClassOpts): DualRunTask {
  const t = `【${o.id}】截断前已产出的部分文本：模型输出触长度上限，话未说完。`;
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rTxLen(t)] },
    native: { turns: [nTxLen(t)] },
    expect: {
      answer: expectAnswer([T(t)]), // native 臂锚本位（软收尾原文；A0 护栏/豁免双恰同消费本位）
      nativeIterations: [],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(1),
      lengthDivergence: {
        dsh: {
          outcome: "BUDGET_EXHAUSTED",
          answer: expectAnswer([T(LENGTH_TRUNCATION_HEADER), T(t)]),
          budgetExhausted: true,
          degraded: { reason: "BUDGET_EXHAUSTED" },
        },
      },
    },
  };
}

const CN_NUM = "零一二三四五";

/** answer · n 轮 load_skill + final_answer（n = 工具轮数；LLM 往返 = n+1）。 */
function answerSkillRounds(o: ClassOpts & { n: number; blocks?: AnswerBlock[]; provenance?: { toolCallId: string; outputPath: string }[] }): DualRunTask {
  const skills = SKILL_KEYS.slice(0, o.n).map((k) => skill(k, o.id));
  const blocks = o.blocks ?? [T(`【${o.id}】剧本化回答：经${CN_NUM[o.n]}轮技能加载后收尾。`)];
  const args = { blocks, provenance: o.provenance ?? [] };
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills, ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [...skills.map((s) => rLs(s.key)), rFa(args), rTx(`收尾 ${o.id}`)] },
    native: { turns: [...skills.map((s) => nLs(skillIdOf(o.id, s.key))), nFa(args)] },
    expect: {
      answer: expectAnswer(blocks, maskedProv((o.provenance ?? []).length)),
      nativeIterations: [
        ...skills.map((s) => ({ calls: [{ toolName: "load_skill", outcome: "OK", input: { skillId: skillIdOf(o.id, s.key) } }] })),
        { calls: [] },
      ],
      nativeTokens: { input: 100 * (o.n + 1), output: 50 * (o.n + 1) },
      dshStats: stats(o.n + 2),
    },
  };
}

// ---------------------------------------------------------------------------
// W2 批1 构造器：G1 EMPTY 空块类 + G4 超长输出
// （机制依据：两臂 final_answer 校验同一 zod 形——loop.ts FinalAnswerSchema 与
//  reassemble.ts FinalAnswerInputSchema 均 blocks:z.array(...) 无 .min(1)、
//  text 块 markdown:z.string() 无 .min(1)；软收尾兜底文案两臂逐字同 =
//  `lastText || "（探索模式未能产出回答）"`。空块/空串天然逐字节可账。）
// ---------------------------------------------------------------------------

/** answer · EMPTY 空块：final_answer blocks:[]（kimi 系模型真实吐空块形态）。答案无 marker ⇒ 豁免位。 */
function answerEmptyBlocks(o: ClassOpts): DualRunTask {
  const args = { blocks: [], provenance: [] };
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rFa(args), rTx(`收尾 ${o.id}`)] },
    native: { turns: [nFa(args)] },
    expect: {
      answer: expectAnswer([]),
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
      skipMarkerSentinel: true,
    },
  };
}

/** answer · EMPTY 空串：final_answer 单 text 块 markdown:""（空串过同一 zod 形）。答案无 marker ⇒ 豁免位。 */
function answerEmptyMarkdown(o: ClassOpts): DualRunTask {
  const args = { blocks: [T("")], provenance: [] };
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rFa(args), rTx(`收尾 ${o.id}`)] },
    native: { turns: [nFa(args)] },
    expect: {
      answer: expectAnswer([T("")]),
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
      skipMarkerSentinel: true,
    },
  };
}

/** answer · EMPTY 近空白软收尾：纯文本轮给空白串（零可见内容软收尾形态）。
 *  ⚠ 为何不是纯空串：dsh 臂 pi-ai 适配器对「stop + 零内容块」判 EMPTY_RESPONSE 错误
 *  （dsh-llm-pi-ai mapStopReason：message.content.length===0 ⇒ kind:error），
 *  turn/end reason=error ⇒ outcome FAILED，而 native 臂纯空串走 lastText||兜底 仍 ANSWERED
 *  ——纯空软收尾的 outcome 两臂结构性分歧（缝观察登记见 RECONCILIATION §3 #8，裁决候选，
 *  本层不拿白名单吞）。空白串 " " 在适配器侧是合法内容块（stop 正常完成），
 *  保留「无可见内容软收尾」语义且两臂逐字节可账。答案无 marker ⇒ 豁免位。 */
function answerEmptySoft(o: ClassOpts): DualRunTask {
  const t = " ";
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rTx(t)] },
    native: { turns: [nTx(t)] },
    expect: {
      answer: expectAnswer([T(t)]),
      nativeIterations: [],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(1),
      skipMarkerSentinel: true,
    },
  };
}

/** answer · EMPTY 混排：空块+正常块同列（正常块携带 marker ⇒ 哨兵保留，证明空块不炸哨兵）。 */
function answerEmptyMixed(o: ClassOpts): DualRunTask {
  const blocks = [T(""), T(`【${o.id}】空块混排形态：首块为空串、本块携带任务 marker。`)];
  const args = { blocks, provenance: [] };
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rFa(args), rTx(`收尾 ${o.id}`)] },
    native: { turns: [nFa(args)] },
    expect: {
      answer: expectAnswer(blocks),
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
    },
  };
}

/** answer · G4 超长输出：final_answer 单 text 块 ≥32KB 确定性长文（比对器深度等 + wire 大单帧解析压测）。 */
function answerLongMarkdown(o: ClassOpts): DualRunTask {
  const blocks = [T(longMarkdown(o.id))];
  const args = { blocks, provenance: [] };
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rFa(args), rTx(`收尾 ${o.id}`)] },
    native: { turns: [nFa(args)] },
    expect: {
      answer: expectAnswer(blocks),
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
    },
  };
}

/** answer · G4 超长软收尾：纯文本轮给 ≥32KB 长文（lastText 兜底路径的长文形态）。 */
function answerLongSoft(o: ClassOpts): DualRunTask {
  const t = longMarkdown(o.id);
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [rTx(t)] },
    native: { turns: [nTx(t)] },
    expect: {
      answer: expectAnswer([T(t)]),
      nativeIterations: [],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(1),
    },
  };
}

// ---------------------------------------------------------------------------
// W2 批2 构造器：G2 expectsSchema 结构化输出
// （机制依据：两臂接线俱在——engine.ts:605 setup / :620 reassemble / :695 native loop 同传
//  opts.expectsSchema。valid 形态：native acceptFinalAnswer 校验过 ⇒ answer 恒固定文案
//  「已按要求返回结构化结果。」（loop.ts:1287-1295）；dsh reassemble expectsSchema 分支
//  answer = lastAssistantText || 兜底（reassemble.ts:401）⇒ dsh 剧本末轮文本逐字写
//  同一固定文案对齐。structured = final_answer raw input，两臂深等。）
// ---------------------------------------------------------------------------

/** 结构化收尾固定文案（native 恒产此文案；dsh 剧本末轮逐字对齐——单源，防两臂各写漂移）。 */
export const STRUCTURED_ANSWER_TEXT = "已按要求返回结构化结果。";

/** answer · G2 valid：expectsSchema 校验通过 ⇒ 双臂收敛固定文案 + structured 深等。答案无 marker ⇒ 豁免位。 */
function answerStructured(o: ClassOpts & { schema: Record<string, unknown>; structured: Record<string, unknown> }): DualRunTask {
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    expectsSchema: o.schema,
    dsh: { rounds: [rFa(o.structured), rTx(STRUCTURED_ANSWER_TEXT)] },
    native: { turns: [nFa(o.structured)] },
    expect: {
      answer: expectAnswer([T(STRUCTURED_ANSWER_TEXT)]),
      structured: o.structured,
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
      skipMarkerSentinel: true,
    },
  };
}

/** answer · G2 invalid→valid 收敛：invalid final_answer 两臂同拒后收敛 valid。
 *  native：acceptFinalAnswer checkJsonSchema 拒 ⇒ tool_result 回注「参数校验失败」续轮（loop.ts:1122-1131）
 *    ⇒ 次轮 valid 收敛；dsh：invalid 调用随帧流掠过，reassemble 校验**末次** final_answer（valid）
 *    ⇒ 通过。fail-closed 钉「落进 result.structured 的值必过 schema」由 reassemble 单测探针钉死
 *    （dsh-runtime-reassemble.test.ts ③ 组），本条钉双臂收敛形态。答案无 marker ⇒ 豁免位。 */
function answerStructuredReplan(o: ClassOpts & { schema: Record<string, unknown>; invalid: Record<string, unknown>; structured: Record<string, unknown> }): DualRunTask {
  return {
    id: o.id, cls: "answer", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    expectsSchema: o.schema,
    dsh: { rounds: [rFa(o.invalid), rFa(o.structured), rTx(STRUCTURED_ANSWER_TEXT)] },
    native: { turns: [nFa(o.invalid), nFa(o.structured)] },
    expect: {
      answer: expectAnswer([T(STRUCTURED_ANSWER_TEXT)]),
      structured: o.structured,
      nativeIterations: [{ calls: [] }, { calls: [] }],
      nativeTokens: { input: 200, output: 100 },
      dshStats: stats(3),
      skipMarkerSentinel: true,
    },
  };
}

/** deny_pre · 前置 deny：dsh 臂首次调用（final_answer）即被治理桥拒；双臂终答 = engine 出口 POST_CHECK 替换（W1 起同码）。 */

function denyPre(o: ClassOpts & { ruleId: string }): DualRunTask {
  const explanation = `拒绝口径（${o.id}）：命中出厂规则前置拦截，按声明口径拒绝。`;
  const blocks = [RV(o.ruleId, explanation, "prov_post_check")];
  const args = { blocks, provenance: [] };
  return {
    id: o.id, cls: "deny_pre", source: o.source, prompt: o.prompt,
    skills: [], ruleBindings: { ruleKeys: [o.ruleId], mode: "POST_CHECK" },
    dsh: { rounds: [rFa(args), rTx(`已被规则拒绝 ${o.id}`)], govDeny: ["final_answer"] },
    native: {
      turns: [nFa({ blocks: [T(`实质回答占位 ${o.id}`)], provenance: [] })],
      postBlock: [{ ruleId: o.ruleId, passed: false, severity: "BLOCK", explanation }],
    },
    expect: {
      answer: expectAnswer(blocks),
      nativeIterations: [{ calls: [] }],
      nativeTokens: { input: 100, output: 50 },
      dshStats: stats(2),
      denyWire: [{ requestIndex: 1, reason: govDenyReason("final_answer") }],
    },
  };
}

/** deny_mid · 中段 deny：dsh 臂 load_skill 成功后 final_answer 被拒；双臂终答 = POST_CHECK 替换（W1 起同码）。 */
function denyMid(o: ClassOpts & { ruleId: string }): DualRunTask {
  const explanation = `拒绝口径（${o.id}）：命中出厂规则中段拦截，按声明口径拒绝。`;
  const blocks = [RV(o.ruleId, explanation, "prov_post_check")];
  const args = { blocks, provenance: [] };
  const sk = skill("sk-a", o.id);
  return {
    id: o.id, cls: "deny_mid", source: o.source, prompt: o.prompt,
    skills: [sk], ruleBindings: { ruleKeys: [o.ruleId], mode: "POST_CHECK" },
    dsh: { rounds: [rLs(sk.key), rFa(args), rTx(`已被规则拒绝 ${o.id}`)], govDeny: ["final_answer"] },
    native: {
      turns: [nLs(skillIdOf(o.id, sk.key)), nFa({ blocks: [T(`实质回答占位 ${o.id}`)], provenance: [] })],
      postBlock: [{ ruleId: o.ruleId, passed: false, severity: "BLOCK", explanation }],
    },
    expect: {
      answer: expectAnswer(blocks),
      nativeIterations: [
        { calls: [{ toolName: "load_skill", outcome: "OK", input: { skillId: skillIdOf(o.id, sk.key) } }] },
        { calls: [] },
      ],
      nativeTokens: { input: 200, output: 100 },
      dshStats: stats(3),
      denyWire: [{ requestIndex: 2, reason: govDenyReason("final_answer") }],
    },
  };
}

/** deny_all · 全 deny：dsh 臂每次工具调用皆被拒；双臂终答 = 多规则 POST_CHECK 全 BLOCK（W1 起同码）。 */
function denyAll(o: ClassOpts & { ruleIds: [string, string] }): DualRunTask {
  const blocks = o.ruleIds.map((r, i) =>
    RV(r, `拒绝口径（${o.id}）之${"甲乙"[i]}：命中出厂规则全量拦截，按声明口径拒绝。`, "prov_post_check"));
  const args = { blocks, provenance: [] };
  const sk = skill("sk-a", o.id);
  return {
    id: o.id, cls: "deny_all", source: o.source, prompt: o.prompt,
    skills: [sk], ruleBindings: { ruleKeys: [...o.ruleIds], mode: "POST_CHECK" },
    dsh: {
      rounds: [rLs(sk.key), rFa(args), rFa(args), rTx(`已被规则拒绝 ${o.id}`)],
      govDeny: ["load_skill", "final_answer"],
    },
    native: {
      turns: [nLs(skillIdOf(o.id, sk.key)), nFa({ blocks: [T(`实质回答占位 ${o.id}`)], provenance: [] })],
      postBlock: o.ruleIds.map((r, i) => ({
        ruleId: r, passed: false, severity: "BLOCK" as const,
        explanation: `拒绝口径（${o.id}）之${"甲乙"[i]}：命中出厂规则全量拦截，按声明口径拒绝。`,
      })),
    },
    expect: {
      answer: expectAnswer(blocks),
      nativeIterations: [
        { calls: [{ toolName: "load_skill", outcome: "OK", input: { skillId: skillIdOf(o.id, sk.key) } }] },
        { calls: [] },
      ],
      nativeTokens: { input: 200, output: 100 },
      dshStats: stats(4),
      denyWire: [
        { requestIndex: 1, reason: govDenyReason("load_skill") },
        { requestIndex: 2, reason: govDenyReason("final_answer") },
      ],
    },
  };
}

/** deny_prefork · 分叉前 skill precondition 预检 BLOCK：两臂对称早退，dsh 零 spawn（反向哨兵）。 */
function denyPrefork(o: ClassOpts & { ruleId: string }): DualRunTask {
  const explanation = `拒绝口径（${o.id}）：技能前置规则拦截，按声明口径拒绝。`;
  const blocks = [RV(o.ruleId, explanation, "prov_skill_rule_check")];
  const sk = skill("sk-a", o.id, [o.ruleId]);
  return {
    id: o.id, cls: "deny_prefork", source: o.source, prompt: o.prompt,
    skills: [sk], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    dsh: { rounds: [] },
    native: {
      turns: [],
      preBlock: [{ ruleId: o.ruleId, passed: false, severity: "BLOCK", explanation }],
    },
    expect: {
      answer: expectAnswer(blocks),
      nativeIterations: [],
      nativeTokens: { input: 0, output: 0 },
      dshZeroSpawn: true,
    },
  };
}

// ---------------------------------------------------------------------------
// 50 任务清单
// ---------------------------------------------------------------------------

const SQ = (sNo: string): string => {
  const card = SCENARIO_CATALOG.find((c) => c.sNo === sNo);
  if (!card) throw new Error(`scenario ${sNo} not in catalog`);
  return card.triggerQuestion;
};

/** 多块形态（text+table+kpi）；首段 text 携带任务 marker（哨兵），全块零裸数（scanBlocks 护栏）。 */
const multiBlocks = (id: string): AnswerBlock[] => [
  { type: "text", markdown: `【${id}】多块答卷首段：口径说明。` },
  { type: "table", columns: ["项目", "口径"], rows: [["甲项", "按声明"], ["乙项", "按声明"]], provId: "prov-blk" },
  { type: "kpi", label: "综合评级", value: "优", provId: "prov-blk" },
];
/** provenance 形态任务：两臂同引未解析 id（⇒ toolName "unknown" 两臂一致；真对象溯源属 L5）。 */
const UNKNOWN_PROV = [{ toolCallId: "callprov-unresolved", outputPath: "$" }];

export const DUALRUN_CORPUS: DualRunTask[] = [
  // ---- 场景目录取材 20 条（S01-S20 triggerQuestion；执行通道不借 evals） ----
  answerImmediate({ id: "dr50-aa", source: "scenario", prompt: SQ("S01") }),
  answerSkillRounds({ id: "dr50-ab", source: "scenario", prompt: SQ("S02"), n: 1 }),
  answerSoft({ id: "dr50-ac", source: "scenario", prompt: SQ("S03") }),
  answerSkillRounds({ id: "dr50-ad", source: "scenario", prompt: SQ("S04"), n: 3 }),
  answerImmediate({ id: "dr50-ae", source: "scenario", prompt: SQ("S05") }),
  answerSkillRounds({ id: "dr50-af", source: "scenario", prompt: SQ("S06"), n: 1 }),
  answerImmediate({ id: "dr50-ag", source: "scenario", prompt: SQ("S07"), provenance: UNKNOWN_PROV }),
  answerSkillRounds({ id: "dr50-ah", source: "scenario", prompt: SQ("S08"), n: 1 }),
  answerSoft({ id: "dr50-ai", source: "scenario", prompt: SQ("S09") }),
  answerImmediate({ id: "dr50-aj", source: "scenario", prompt: SQ("S10") }),
  answerSkillRounds({ id: "dr50-ak", source: "scenario", prompt: SQ("S11"), n: 3 }),
  answerImmediate({ id: "dr50-al", source: "scenario", prompt: SQ("S12") }),
  answerSkillRounds({ id: "dr50-am", source: "scenario", prompt: SQ("S13"), n: 1 }),
  answerImmediate({ id: "dr50-an", source: "scenario", prompt: longPrompt(SQ("S14"), "dr50-an") }),
  answerSkillRounds({ id: "dr50-ao", source: "scenario", prompt: longPrompt(SQ("S15"), "dr50-ao"), n: 1 }),
  answerImmediate({ id: "dr50-ap", source: "scenario", prompt: SQ("S16") }),
  answerSkillRounds({ id: "dr50-aq", source: "scenario", prompt: SQ("S17"), n: 4 }),
  answerSoft({ id: "dr50-ar", source: "scenario", prompt: SQ("S18") }),
  answerImmediate({ id: "dr50-as", source: "scenario", prompt: SQ("S19"), blocks: multiBlocks("dr50-as") }),
  answerSkillRounds({ id: "dr50-at", source: "scenario", prompt: SQ("S20"), n: 1 }),
  // ---- 合成 16 条（四维补齐：长度/工具轮/多轮/形态） ----
  answerImmediate({ id: "dr50-au", source: "synthetic", prompt: "合成题 au：当前现金垫口径怎么看？" }),
  answerImmediate({ id: "dr50-av", source: "synthetic", prompt: longPrompt("合成题 av：长上下文下的库存口径怎么看？", "dr50-av") }),
  answerImmediate({ id: "dr50-aw", source: "synthetic", prompt: "合成题 aw：多块形态应答口径。", blocks: multiBlocks("dr50-aw") }),
  answerSkillRounds({ id: "dr50-ax", source: "synthetic", prompt: "合成题 ax：技能加载一轮后作答。", n: 1 }),
  answerSkillRounds({ id: "dr50-ay", source: "synthetic", prompt: "合成题 ay：技能加载后多块作答。", n: 1, blocks: multiBlocks("dr50-ay") }),
  answerSkillRounds({ id: "dr50-az", source: "synthetic", prompt: longPrompt("合成题 az：长上下文加技能加载。", "dr50-az"), n: 1 }),
  answerSoft({ id: "dr50-ba", source: "synthetic", prompt: "合成题 ba：软收尾形态。" }),
  answerSkillRounds({ id: "dr50-bb", source: "synthetic", prompt: "合成题 bb：三轮技能加载。", n: 3 }),
  answerSkillRounds({ id: "dr50-bc", source: "synthetic", prompt: longPrompt("合成题 bc：长上下文三轮技能。", "dr50-bc"), n: 3 }),
  answerSkillRounds({ id: "dr50-bd", source: "synthetic", prompt: "合成题 bd：四轮技能五次往返。", n: 4 }),
  answerSkillRounds({ id: "dr50-be", source: "synthetic", prompt: "合成题 be：四轮技能五次往返之二。", n: 4 }),
  answerSkillRounds({ id: "dr50-bf", source: "synthetic", prompt: longPrompt("合成题 bf：长上下文四轮技能。", "dr50-bf"), n: 4 }),
  answerSkillRounds({ id: "dr50-bg", source: "synthetic", prompt: "合成题 bg：技能加载加溯源形态。", n: 1, provenance: UNKNOWN_PROV }),
  answerImmediate({ id: "dr50-bh", source: "synthetic", prompt: "合成题 bh：立即收尾之二。" }),
  answerSkillRounds({ id: "dr50-bi", source: "synthetic", prompt: "合成题 bi：技能加载一轮之二。", n: 1 }),
  answerImmediate({ id: "dr50-bj", source: "synthetic", prompt: "合成题 bj：立即收尾之三。" }),
  // ---- 拒绝混合 14 条（前置 4 / 中段 4 / 全 deny 4 / 分叉前 2） ----
  denyPre({ id: "dr50-bk", source: "scenario", prompt: SQ("S02"), ruleId: "RULE-DUALRUN-PRE-K" }),
  denyPre({ id: "dr50-bl", source: "scenario", prompt: SQ("S03"), ruleId: "RULE-DUALRUN-PRE-L" }),
  denyPre({ id: "dr50-bm", source: "synthetic", prompt: "合成题 bm：前置拒绝口径一。", ruleId: "RULE-DUALRUN-PRE-M" }),
  denyPre({ id: "dr50-bn", source: "synthetic", prompt: "合成题 bn：前置拒绝口径二。", ruleId: "RULE-DUALRUN-PRE-N" }),
  denyMid({ id: "dr50-bo", source: "scenario", prompt: SQ("S04"), ruleId: "RULE-DUALRUN-MID-O" }),
  denyMid({ id: "dr50-bp", source: "synthetic", prompt: "合成题 bp：中段拒绝口径一。", ruleId: "RULE-DUALRUN-MID-P" }),
  denyMid({ id: "dr50-bq", source: "synthetic", prompt: "合成题 bq：中段拒绝口径二。", ruleId: "RULE-DUALRUN-MID-Q" }),
  denyMid({ id: "dr50-br", source: "synthetic", prompt: longPrompt("合成题 br：长上下文中段拒绝。", "dr50-br"), ruleId: "RULE-DUALRUN-MID-R" }),
  denyAll({ id: "dr50-bs", source: "scenario", prompt: SQ("S05"), ruleIds: ["RULE-DUALRUN-ALL-SA", "RULE-DUALRUN-ALL-SB"] }),
  denyAll({ id: "dr50-bt", source: "synthetic", prompt: "合成题 bt：全量拒绝口径一。", ruleIds: ["RULE-DUALRUN-ALL-TA", "RULE-DUALRUN-ALL-TB"] }),
  denyAll({ id: "dr50-bu", source: "synthetic", prompt: "合成题 bu：全量拒绝口径二。", ruleIds: ["RULE-DUALRUN-ALL-UA", "RULE-DUALRUN-ALL-UB"] }),
  denyAll({ id: "dr50-bv", source: "synthetic", prompt: "合成题 bv：全量拒绝口径三。", ruleIds: ["RULE-DUALRUN-ALL-VA", "RULE-DUALRUN-ALL-VB"] }),
  denyPrefork({ id: "dr50-bw", source: "scenario", prompt: SQ("S06"), ruleId: "RULE-DUALRUN-FORK-W" }),
  denyPrefork({ id: "dr50-bx", source: "synthetic", prompt: "合成题 bx：分叉前预检拒绝。", ruleId: "RULE-DUALRUN-FORK-X" }),
  // ---- W2 批1：G1 EMPTY 空块类 4 条 + G4 超长输出 2 条（全合成；prompt 含 id，
  //      供豁免任务的 dsh wire 首请求替代哨兵锚定「消费的是本任务输入」） ----
  answerEmptyBlocks({ id: "dr50-by", source: "synthetic", prompt: "合成题 by（dr50-by）：空块形态应答口径。" }),
  answerEmptyMarkdown({ id: "dr50-bz", source: "synthetic", prompt: "合成题 bz（dr50-bz）：空串块形态应答口径。" }),
  answerEmptySoft({ id: "dr50-ca", source: "synthetic", prompt: "合成题 ca（dr50-ca）：空文本软收尾形态。" }),
  answerEmptyMixed({ id: "dr50-cb", source: "synthetic", prompt: "合成题 cb（dr50-cb）：空块混排形态。" }),
  answerLongMarkdown({ id: "dr50-cc", source: "synthetic", prompt: "合成题 cc（dr50-cc）：超长输出形态。" }),
  answerLongSoft({ id: "dr50-cd", source: "synthetic", prompt: "合成题 cd（dr50-cd）：超长软收尾形态。" }),
  // ---- W2 批2：G2 expectsSchema 结构化输出（valid 2 条；prompt 含 id 供豁免位 wire 替代哨兵） ----
  answerStructured({
    id: "dr50-ce", source: "synthetic",
    prompt: "合成题 ce（dr50-ce）：单键结构化结论产出。",
    schema: { type: "object", required: ["conclusion"], properties: { conclusion: { type: "string" } } },
    structured: { conclusion: "结构化结论（ce）：按声明口径产出，单键形态。" },
  }),
  answerStructured({
    id: "dr50-cf", source: "synthetic",
    prompt: "合成题 cf（dr50-cf）：嵌套结构化产出。",
    schema: {
      type: "object", required: ["summary", "items"],
      properties: {
        summary: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object", required: ["name", "score"],
            properties: { name: { type: "string" }, score: { type: "number" } },
          },
        },
      },
    },
    structured: {
      summary: "嵌套结论（cf）：数组套对象形态。",
      items: [
        { name: "甲项", score: 0.9 },
        { name: "乙项", score: 0.7 },
      ],
    },
  }),
  answerStructuredReplan({
    id: "dr50-cg", source: "synthetic",
    prompt: "合成题 cg（dr50-cg）：先给不合 schema 的结构化结果再收敛。",
    schema: { type: "object", required: ["conclusion"], properties: { conclusion: { type: "string" } } },
    invalid: { wrong: "缺 conclusion 键的非法输入（cg）" },
    structured: { conclusion: "结构化结论（cg）：invalid 被拒后收敛产出。" },
  }),
  // ---- W2 批3：G3 finish_reason=length 截断（双臂分锚，REC §3 #9 设计取向差 + dsh 自体修复） ----
  answerLengthTruncated({
    id: "dr50-ch", source: "synthetic",
    prompt: "合成题 ch（dr50-ch）：输出触长度上限截断的双臂口径对账。",
  }),
];

/** A5 确定性子集（同臂连跑两遍过同一比对器）：每类至少一 + 长上下文 + provenance + 多轮 + 空块混排 + 结构化。 */
export const A5_SUBSET: readonly string[] = ["dr50-ac", "dr50-ad", "dr50-an", "dr50-ag", "dr50-bk", "dr50-bs", "dr50-cb", "dr50-ce"];

/**
 * 跨单回执 gated 槽（蓝图末行：角色路/场景路 STALL_LOOP 各一）。
 * 两处 degraded 静默缝已由 886c436a7 落线（orchestrator agent_degraded 发射点 :2182/:2433/:2694）；
 * 解 gate 属跨单回执新语料面（超 runRegisteredAgent 单驱动边界），team-lead 2026-08-21 裁决
 * 转 W5 登记（W5-输入 #1，REC §3 #7）——槽维持 gated，driver 鸣报 skipped，不冒充覆盖。
 */
export const GATED_SLOTS = [
  {
    id: "dr50-gated-role-stall",
    path: "runRolePathB",
    scenario: "STALL_LOOP",
    gate: "解 gate 属新语料面，转 W5 登记（W5-输入 #1；缝① 886c436a7 已落线）",
  },
  {
    id: "dr50-gated-scene-stall",
    path: "runSceneAgent",
    scenario: "STALL_LOOP",
    gate: "解 gate 属新语料面，转 W5 登记（W5-输入 #1；缝② 886c436a7 已落线）",
  },
] as const;
