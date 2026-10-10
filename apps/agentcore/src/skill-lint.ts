import { SKILL_REFERENCE_KINDS, SKILL_REFERENCE_ROLES, type SkillDefinition, type SkillReference } from "@platform/contracts";
import { BUILTIN_TOOLS, FINAL_ANSWER_TOOL, LOAD_SKILL_TOOL } from "./tools/registry.js";
import { ENFORCED_SKILL_REF_SLOTS, isEnforcedSkillRefSlot } from "./engine.js";

/**
 * Skill 编写规范与质量门禁（PRD-addendum-skill-authoring，裁决 #25）。
 *
 * 门禁一 · 结构 lint（机械检查，零判断力）：让"优秀技能"成为可校验属性。低能力编写代理
 * 无需判断力也能据违规定位产出达标技能。门禁二（评测，联动 OC2）单列。
 */

export interface SkillLintViolation {
  rule: string;
  message: string;
  location: "summary" | "body" | "resources" | "metadata";
}

/** Lint 目标：兼容旧调用（只传 summary/body/resources），也支持工业级契约字段。 */
export interface SkillLintTarget {
  summary: string;
  body: string;
  resources: { name: string }[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  references?: SkillReference[];
  dependsOn?: SkillReference[];
}

/** 同租户全部 skill 列表，用于依赖图与循环依赖检测。 */
export interface SkillLintContext {
  allSkills?: SkillDefinition[];
  /**
   * 发布态：`dependsOn` 指向的 skill 必须已 PUBLISHED（草稿态预览 lint 不该因依赖还没发布就报错）。
   *
   * 补「造了没接」：`validateRefResolution` 一直带着 `requirePublished` 形参，但两个调用点都硬编码 `false`，
   * 而其上方注释写的是「dependsOn 在发布时要求 PUBLISHED 且无环」——规则存在、参数存在、就是没人传 true。
   */
  requirePublishedDeps?: boolean;
}

const FORBIDDEN_WORDS = ["有用", "强大", "全面", "各种", "帮助你", "介绍"];

/** body 七段固定骨架（发布校验检查段落存在性）。 */
const BODY_SECTIONS = ["目的", "适用边界", "前置检查", "步骤", "示例", "失败处理", "输出要求"];

const SUMMARY_MAX = 200;
const BODY_MAX = 3000;

// 词表取自契约单一来源（原稿在此手抄了一份，与 SkillReferenceSchema 各自维护 → 新增 kind 必漏 lint 这半·R-一致）
const VALID_REF_KINDS: ReadonlySet<string> = new Set(SKILL_REFERENCE_KINDS);
const VALID_REF_ROLES: ReadonlySet<string> = new Set(SKILL_REFERENCE_ROLES);

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

/** 轻量 JSON Schema 形状校验：lint 只检查它是对象且含 type，避免接受任意 dict。 */
function validateJsonSchemaShape(schema: Record<string, unknown> | undefined, path: string, location: "metadata"): SkillLintViolation[] {
  const v: SkillLintViolation[] = [];
  if (schema === undefined) return v;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    v.push({ rule: `${path}.invalid`, message: `${path} 必须是 JSON Schema 对象`, location });
    return v;
  }
  if (schema.type === undefined && schema.$ref === undefined && schema.oneOf === undefined && schema.anyOf === undefined && schema.allOf === undefined) {
    v.push({ rule: `${path}.missingType`, message: `${path} 至少需含 type / $ref / oneOf / anyOf / allOf 之一`, location });
  }
  return v;
}

function validateReferenceList(
  refs: SkillReference[] | undefined,
  path: "references" | "dependsOn",
): SkillLintViolation[] {
  const v: SkillLintViolation[] = [];
  if (refs === undefined) return v;
  if (!Array.isArray(refs)) {
    v.push({ rule: `${path}.type`, message: `${path} 必须是数组`, location: "metadata" });
    return v;
  }
  const seen = new Set<string>();
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!ref || typeof ref !== "object") {
      v.push({ rule: `${path}[${i}].type`, message: `${path}[${i}] 不是对象`, location: "metadata" });
      continue;
    }
    if (!VALID_REF_KINDS.has(ref.kind)) {
      v.push({ rule: `${path}[${i}].kind`, message: `${path}[${i}] kind「${ref.kind}」非法`, location: "metadata" });
    }
    if (!ref.key || typeof ref.key !== "string") {
      v.push({ rule: `${path}[${i}].key`, message: `${path}[${i}] key 不能为空`, location: "metadata" });
    }
    if (ref.role && !VALID_REF_ROLES.has(ref.role)) {
      v.push({ rule: `${path}[${i}].role`, message: `${path}[${i}] role「${ref.role}」非法`, location: "metadata" });
    }
    if (ref.version !== undefined && (!Number.isInteger(ref.version) || ref.version < 1)) {
      v.push({ rule: `${path}[${i}].version`, message: `${path}[${i}] version 必须是正整数`, location: "metadata" });
    }
    // WO-S05（欠账 #154）· **声明了运行时不会执行的前置/后验 → 当场报出来**。
    //
    // 这条门治的不是「配错了一个字段」，是**配错了没人吭声**：`precondition`/`postcheck` 带强制语义，
    // 但契约词表放行 kind×role 的全部组合，运行时只对 ENFORCED_SKILL_REF_SLOTS 里的组合真的做事。
    // 出厂唯一的 precondition 声明（solver+precondition）就落在差集里，被 engine 一行 `kind==="rule"`
    // 静默滤掉，三周无人知晓。判据与 engine 取值用的是**同一份表**（import 而非手抄）——
    // 抄一份就是装饰品：engine 改了、lint 拿旧的去测、照样绿（CLAUDE.md 铁律 0.6）。
    //
    // `context` / `fallback` 是告知性 role（投影进资源图供检索），不承诺执行，故不在此判据内。
    // 只判 `references`：engine 的强制路径读的就是 `s.references`；`dependsOn` 是依赖图/发布序语义
    // （由 validateRefResolution + 环检测把关），engine 不按 role 执行它，不该套同一张表。
    if (path === "references" && VALID_REF_KINDS.has(ref.kind) && ref.role && VALID_REF_ROLES.has(ref.role) && !isEnforcedSkillRefSlot(ref.kind, ref.role)) {
      const enforceableRoles = ENFORCED_SKILL_REF_SLOTS.filter((s) => s.role === ref.role).map((s) => s.kind);
      if (enforceableRoles.length > 0) {
        v.push({
          rule: `${path}[${i}].unenforceable`,
          message:
            `${path}[${i}] 声明了 role「${ref.role}」但 kind「${ref.kind}」运行时不会被执行` +
            `（该 role 目前只对 kind ${enforceableRoles.map((k) => `「${k}」`).join("、")} 生效）` +
            `——这类声明会被静默丢弃，请改用可执行的 kind，或先为该组合接上消费方并登记到 ENFORCED_SKILL_REF_SLOTS`,
          location: "metadata",
        });
      }
    }

    const duplicateKey = `${ref.kind}:${ref.key}`;
    if (seen.has(duplicateKey)) {
      v.push({ rule: `${path}[${i}].duplicate`, message: `${path} 内存在重复引用 ${duplicateKey}`, location: "metadata" });
    } else {
      seen.add(duplicateKey);
    }
  }
  return v;
}

/** 在 tenant 全量 skill 中按 key（可选 version）定位目标；返回匹配项或 undefined。 */
function findSkillByRef(skills: SkillDefinition[], ref: SkillReference): SkillDefinition | undefined {
  return skills.find((s) => {
    if (s.key !== ref.key) return false;
    if (ref.version !== undefined) return s.version === ref.version;
    return true;
  });
}

/** 检查 references / dependsOn 在当前 tenant 内可解析；仅针对 kind=skill（本地资源）。 */
function validateRefResolution(
  refs: SkillReference[] | undefined,
  path: "references" | "dependsOn",
  allSkills: SkillDefinition[] | undefined,
  requirePublished: boolean,
): SkillLintViolation[] {
  const v: SkillLintViolation[] = [];
  if (!refs || !allSkills) return v;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    // 非 skill 引用不归本地 lint 管：kind=solver/rule/ontologyType 由**发布时**的跨系统存在性探针
    // `probeMissingRefs`（`apps/agentcore/src/resources.ts`）校验。
    //
    // ⚠️ 这句话在 2026-08-09 之前是**谎报**：那个探针当时只接了 agent 发布与 workflow 发布两路，
    // **skill 发布路根本没接**——所以"由发布时的跨系统探针保证"保证了个寂寞，一个技能引用
    // 根本不存在的求解器照样能发布成功。2026-08-09（WO-SKILL-REFCLOSURE-A）把探针接上了
    // `POST /b/v1/skills/:id/publish`，这句话**从这天起才成立**。
    //
    // 复验方式（别信这段注释，亲手跑）：
    //   · `node scripts/check-ref-closure.mjs`（RC=0；摘掉 skill 发布路那行探针调用 → 该门红）
    //   · `pnpm --filter agentcore test skill-ref-closure`
    //     （从 HTTP 发布端点打进去：死路求解器 → 422 SKILL_REF_UNRESOLVED 且未落库）
    //
    // 诚实边界：探针只覆盖 solver / rule / ontologyType 三种 kind。
    // kind=constraint / slice / workflow / agent **今天仍无人校验**（既不在本地 lint，也不在探针里）——
    // 别把这段注释再读成"所有非 skill 引用都有人管"。
    if (ref.kind !== "skill") continue;
    const target = findSkillByRef(allSkills, ref);
    if (!target) {
      if (ref.required !== false) {
        v.push({ rule: `${path}[${i}].unresolved`, message: `${path}[${i}] 引用的 skill「${ref.key}」不存在`, location: "metadata" });
      }
      continue;
    }
    if (requirePublished && target.status !== "PUBLISHED") {
      v.push({
        rule: `${path}[${i}].notPublished`,
        message: `${path}[${i}] 依赖的 skill「${ref.key}」状态为 ${target.status}，发布要求 PUBLISHED`,
        location: "metadata",
      });
    }
  }
  return v;
}

/** 在 dependsOn 图中检测有向环（按 key 归一化，版本被忽略以符合发布语义）。 */
function detectSkillDependencyCycle(skills: SkillDefinition[] | undefined): string | undefined {
  if (!skills || skills.length === 0) return undefined;
  const byKey = new Map<string, SkillDefinition>();
  for (const s of skills) byKey.set(s.key, s);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string, stack: string[]): boolean {
    if (visiting.has(key)) {
      return true; // 命中环；调用方用 s.key 给出可读表示（不需要精确切片：忽略版本后环语义稳定）
    }
    if (visited.has(key)) return false;
    const skill = byKey.get(key);
    if (!skill) return false;
    visiting.add(key);
    const deps = skill.dependsOn ?? [];
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i]!;
      if (dep.kind !== "skill") continue;
      if (visit(dep.key, [...stack, key])) {
        return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  for (const s of skills) {
    if (visit(s.key, [])) {
      // 返回一条可读的环表示；不做精确切片，因为版本忽略后环语义稳定
      return `${s.key} -> ... -> ${s.key}`;
    }
  }
  return undefined;
}

export function lintSkill(
  skill: SkillLintTarget,
  opts: { extraToolNames?: string[] } = {},
  ctx: SkillLintContext = {},
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

  // —— §5 工业级契约字段（WO-SKILL-3）——
  v.push(...validateJsonSchemaShape(skill.inputSchema, "inputSchema", "metadata"));
  v.push(...validateJsonSchemaShape(skill.outputSchema, "outputSchema", "metadata"));
  v.push(...validateReferenceList(skill.references, "references"));
  v.push(...validateReferenceList(skill.dependsOn, "dependsOn"));

  // references 只需存在性；dependsOn 在发布时要求 PUBLISHED 且无环
  v.push(...validateRefResolution(skill.references, "references", ctx.allSkills, false));
  v.push(...validateRefResolution(skill.dependsOn, "dependsOn", ctx.allSkills, ctx.requirePublishedDeps ?? false));

  const cycle = detectSkillDependencyCycle(ctx.allSkills);
  if (cycle && (skill.dependsOn ?? []).some((d) => d.kind === "skill")) {
    v.push({ rule: "metadata.dependencyCycle", message: `Skill 依赖图存在环：${cycle}`, location: "metadata" });
  }

  return { ok: v.length === 0, violations: v };
}
