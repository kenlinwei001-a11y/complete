/**
 * WO-DSH-E2E · L1 双跑语料（50 任务 + 2 gated 槽）——纯数据，零 IO。
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
  dsh: { rounds: StubRound[]; govDeny?: string[] };
  native: { turns: ScriptedTurn[]; preBlock?: RuleVerdict[]; postBlock?: RuleVerdict[] };
  expect: {
    answer: Answer;
    nativeIterations: IterationAnchor[];
    nativeTokens: { input: number; output: number };
    /** dsh 臂 stats 锚（usage 折出和）；deny_prefork（零 spawn）无。 */
    dshStats?: DshStatsAnchor;
    /** dsh 臂治理桥真 deny 的 wire 证据位：requests[i].body 须含 reason 逐字。 */
    denyWire?: { requestIndex: number; reason: string }[];
    /** deny_prefork：分叉前预检早退 ⇒ dsh 零 spawn（反向哨兵）。 */
    dshZeroSpawn?: boolean;
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

/** 长上下文填充（确定性；≥4096 字符 = 蓝图「4KB 长上下文」档）。 */
const longPrompt = (q: string, id: string): string => {
  const filler = `背景材料（${id}）：锂电产销运营长上下文填充段，订单产能物料现金流口径铺陈。`;
  let p = `${q}\n\n${filler}`;
  while (p.length < 4096) p += filler;
  return p;
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

/** deny_pre · 前置 deny：dsh 臂首次调用（final_answer）即被治理桥拒；native 臂 POST_CHECK 替换。 */
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

/** deny_mid · 中段 deny：dsh 臂 load_skill 成功后 final_answer 被拒；native 臂同形 + POST_CHECK。 */
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

/** deny_all · 全 deny：dsh 臂每次工具调用皆被拒；native 臂多规则 POST_CHECK 全 BLOCK。 */
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
];

/** A5 确定性子集（同臂连跑两遍过同一比对器）：每类至少一 + 长上下文 + provenance + 多轮。 */
export const A5_SUBSET: readonly string[] = ["dr50-ac", "dr50-ad", "dr50-an", "dr50-ag", "dr50-bk", "dr50-bs"];

/**
 * 跨单回执 gated 槽（蓝图末行：角色路/场景路 STALL_LOOP 各一）。
 * 本树 orchestrator 唯 :2179 一处 agent_degraded 发射（runPathB 段）——runRolePathB/runSceneAgent
 * 两处 degraded 静默缝 WO 未落线，缝修复后转正式任务；driver 鸣报 skipped，不冒充覆盖。
 */
export const GATED_SLOTS = [
  {
    id: "dr50-gated-role-stall",
    path: "runRolePathB",
    scenario: "STALL_LOOP",
    gate: "WO-degraded-seams 缝①（runRolePathB degraded 静默缝）未落线",
  },
  {
    id: "dr50-gated-scene-stall",
    path: "runSceneAgent",
    scenario: "STALL_LOOP",
    gate: "WO-degraded-seams 缝②（runSceneAgent degraded 静默缝）未落线",
  },
] as const;
