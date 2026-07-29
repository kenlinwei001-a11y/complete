import { BUILTIN_TOOLS, FINAL_ANSWER_TOOL, LOAD_SKILL_TOOL } from "./tools/registry.js";

/**
 * Skill 编写规范与质量门禁（PRD-addendum-skill-authoring，裁决 #25）。
 *
 * 门禁一 · 结构 lint（机械检查，零判断力）：让"优秀技能"成为可校验属性。低能力编写代理
 * 无需判断力也能据违规定位产出达标技能。门禁二（评测，联动 OC2）单列。
 */

export interface SkillLintViolation {
  rule: string;
  message: string;
  location: "summary" | "body" | "resources";
}

const FORBIDDEN_WORDS = ["有用", "强大", "全面", "各种", "帮助你", "介绍"];

/** body 七段固定骨架（发布校验检查段落存在性）。 */
const BODY_SECTIONS = ["目的", "适用边界", "前置检查", "步骤", "示例", "失败处理", "输出要求"];

const SUMMARY_MAX = 200;
const BODY_MAX = 3000;

/** 平台注册表全部工具名（lint 反查 body 中提及的工具名是否拼错）。 */
function registeredToolNames(extra: string[] = []): Set<string> {
  return new Set([
    ...BUILTIN_TOOLS.map((t) => t.name),
    FINAL_ANSWER_TOOL.name,
    LOAD_SKILL_TOOL.name,
    ...extra,
  ]);
}

/**
 * 门禁二 · 评测用例**类型判别**（PRD §4 三类：应触发 / 不应触发 / 行为增益）。
 *
 * 修「门只数数不判别」：此前发布门仅校验 `cases.length >= 3`，3 条同类用例（甚至 3 条完全相同的）
 * 即放行，而报错文案却宣称「含行为增益维度」——**名不副实的门**。误触发是污染所有无关任务的行为，
 * 「不应触发」用例缺失时该风险完全无人把守，故三类各须 ≥1。
 *
 * 判据（与 PRD §4 表逐行对齐）：
 *   应触发   = expect.toolSequence 含 `load_skill`（问句应加载本技能）
 *   不应触发 = expect.toolSequence 已声明但**不含** `load_skill`（"不适用"场景不得加载）
 *   行为增益 = expect.behaviorGain === true（挂载/不挂载两态对比更优）
 */
export interface SkillEvalCoverage {
  shouldTrigger: number;
  shouldNotTrigger: number;
  behaviorGain: number;
  missing: string[];
  ok: boolean;
}

export function classifySkillEvalCases(
  cases: { expect?: { toolSequence?: { name: string }[]; behaviorGain?: boolean } }[],
): SkillEvalCoverage {
  let shouldTrigger = 0;
  let shouldNotTrigger = 0;
  let behaviorGain = 0;
  for (const c of cases) {
    const seq = c.expect?.toolSequence;
    if (Array.isArray(seq)) {
      if (seq.some((s) => s.name === LOAD_SKILL_TOOL.name)) shouldTrigger++;
      else shouldNotTrigger++;
    }
    if (c.expect?.behaviorGain === true) behaviorGain++;
  }
  const missing: string[] = [];
  if (shouldTrigger < 1) missing.push(`应触发（toolSequence 含 ${LOAD_SKILL_TOOL.name}）`);
  if (shouldNotTrigger < 1) missing.push(`不应触发（toolSequence 已声明且不含 ${LOAD_SKILL_TOOL.name}）`);
  if (behaviorGain < 1) missing.push("行为增益（expect.behaviorGain=true）");
  return { shouldTrigger, shouldNotTrigger, behaviorGain, missing, ok: missing.length === 0 };
}

export function lintSkill(
  skill: { summary: string; body: string; resources: { name: string }[] },
  opts: { extraToolNames?: string[] } = {},
): { ok: boolean; violations: SkillLintViolation[] } {
  const v: SkillLintViolation[] = [];
  const summary = skill.summary ?? "";
  const body = skill.body ?? "";

  // —— §2 Summary 规范 ——
  if (summary.length > SUMMARY_MAX) {
    v.push({ rule: "summary.maxLength", message: `summary 超 ${SUMMARY_MAX} 字（当前 ${summary.length}）——summary 是触发器不是简介`, location: "summary" });
  }
  if (!/当[\s\S]+时使用/.test(summary)) {
    v.push({ rule: "summary.triggerTemplate", message: "summary 缺『当…时使用』触发场景句（必须是业务动词短语）", location: "summary" });
  }
  if (!/不适用[:：]/.test(summary)) {
    v.push({ rule: "summary.exclusion", message: "summary 缺『不适用：』排除边界句——没有排除边界的技能是误触发制造机", location: "summary" });
  }
  for (const w of FORBIDDEN_WORDS) {
    if (summary.includes(w)) {
      v.push({ rule: "summary.forbiddenWord", message: `summary 含禁用词「${w}」（只占字数不增触发信息）`, location: "summary" });
    }
  }

  // —— §3 Body 规范 ——
  if (body.length > BODY_MAX) {
    v.push({ rule: "body.maxLength", message: `body 超 ${BODY_MAX} 字（当前 ${body.length}）——将静态数据块下沉至 resource`, location: "body" });
  }
  for (const sec of BODY_SECTIONS) {
    // 段落以 markdown 标题出现：## 目的 / ## 适用边界 …
    if (!new RegExp(`^#{1,4}\\s*${sec}`, "m").test(body)) {
      v.push({ rule: "body.section", message: `body 缺骨架段落「## ${sec}」`, location: "body" });
    }
  }
  // 示例段须含 ≥1 正例 + ≥1 反例
  if (!body.includes("正例")) {
    v.push({ rule: "body.positiveExample", message: "body 缺正例（输入→正确处理→输出）", location: "body" });
  }
  if (!body.includes("反例")) {
    v.push({ rule: "body.negativeExample", message: "body 缺反例（常见错误做法及为何错）", location: "body" });
  }

  // —— resources 引用可解析 ——
  const declared = new Set((skill.resources ?? []).map((r) => r.name));
  for (const m of body.matchAll(/\{\{resource:([^}]+)\}\}/g)) {
    const name = (m[1] ?? "").trim();
    if (!declared.has(name)) {
      v.push({ rule: "body.resourceRef", message: `body 引用了未声明的 resource「${name}」`, location: "body" });
    }
  }

  // —— 工具名注册表反查（SA4：写错工具名→拒绝）——
  const known = registeredToolNames(opts.extraToolNames);
  // 抓「调用 `tool`」「`tool` 工具」形态里的 snake_case 标识符
  const toolMentions = new Set<string>();
  for (const m of body.matchAll(/调用\s*`?([a-z][a-z0-9_]*_[a-z0-9_]+)`?/g)) toolMentions.add(m[1]!);
  for (const m of body.matchAll(/`([a-z][a-z0-9_]*_[a-z0-9_]+)`\s*工具/g)) toolMentions.add(m[1]!);
  for (const name of toolMentions) {
    if (!known.has(name)) {
      v.push({ rule: "body.unknownTool", message: `body 提及未注册工具「${name}」（请核对工具注册表的准确名）`, location: "body" });
    }
  }

  return { ok: v.length === 0, violations: v };
}
