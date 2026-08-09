import { z } from "zod";
import { JsonSchemaObject } from "./common.js";
import {
  SKILL_REFERENCE_KINDS,
  SKILL_REFERENCE_ROLES,
  isWriteModeSkill,
  type SkillDefinition,
  type SkillReference,
} from "./agentcore.js";
import { OnErrorSchema, type PlanStep } from "./qos.js";

/**
 * WO-SKILL-COMPILER-S1 · 技能编译流水线的 **S1 最小垂直切片**（`docs/PRD-skill-compiler-registry.md` §4）。
 *
 * PRD §4.1 的七段管线是：
 *   SkillSource → ① Parser → SkillAst → ② Validator → ③ Optimizer → SkillRuntimePackage → SkillCompileReport
 * **本文件只承载 ① 与 ③ 的「图派生」那一半**，理由是 PRD §4.1 的分层纪律：
 * 「① 与 ③ 是纯函数（无 Date.now、无随机、无网络），可在 contracts 层单测；② 的 IO 全部集中在可注入接口」。
 * 故 ② Validator（要读工具注册表 + 跑 lintSkill）落在 `apps/agentcore/src/skill-compiler.ts`，不在这里。
 *
 * ---------------------------------------------------------------------------
 * ⛔ 命名红线（PRD §3.1 红线 1 · §8.3 禁止清单 · 静态门 `skill-compiler:check` 守）
 * ---------------------------------------------------------------------------
 * 本模块的产物**不得**沿用 QOS 路径 A 已占用的那两个名字（`packages/contracts/src/qos.ts:180` 的
 * `ExecutionPlanSchema` 承载「意图怎么答」的语义，出厂 32 个意图各绑一个）。
 * 再占一次 = 制造第二份真源。故按 PRD §3.2 术语表取名：
 *   Parser 产物  → `SkillAst`
 *   图产物       → `SkillReasoningGraph`（技能推理图）
 *   最终打包产物 → `SkillRuntimePackage`（**本切片不做**，见 `SKILL_COMPILE_STAGES`）
 *
 * ⚠️ 工单原文要求把图契约命名为红线 1 点名禁用的那个名字。**按 PRD 红线执行，未照工单原文命名**，
 *    偏离已在交付说明里单列。响应字段名仍按工单叫 `graph`（字段名不在红线的标识符射程内，
 *    且 `graph` 不是被占用的那个词）。
 *
 * ---------------------------------------------------------------------------
 * R6 确定性（本仓铁律 · PRD §4.2 DT 组）
 * ---------------------------------------------------------------------------
 * 本文件全部为纯函数：无 `Date.now`、无 `Math.random`、无 `new Date`、无 IO。
 * 所有集合（引用桶 / 节点 / 边 / 诊断）按稳定键**字典序**排序，且对象字面量的键序固定 →
 * 同一 `SkillDefinition` 两次编译，`JSON.stringify` 逐字节一致。
 */

// ---------------------------------------------------------------------------
// 阶段与诚实边界
// ---------------------------------------------------------------------------

/**
 * 七段管线在本切片的落地状态。**没做的段必须显式标 `NOT_IMPLEMENTED`**——
 * 返回一个空对象让调用方以为跑过了，是本仓反复吃亏的那一族（"填了字段没有消费方，比不填更危险"）。
 */
export const SKILL_COMPILE_STAGES = ["parse", "validate", "graph", "optimize", "package"] as const;
export type SkillCompileStage = (typeof SKILL_COMPILE_STAGES)[number];

export const SkillCompileStageStatusSchema = z.enum(["OK", "FAILED", "NOT_IMPLEMENTED"]);
export type SkillCompileStageStatus = z.infer<typeof SkillCompileStageStatusSchema>;

export const SkillCompileStageReportSchema = z.object({
  stage: z.enum(SKILL_COMPILE_STAGES),
  status: SkillCompileStageStatusSchema,
  /** 为什么是这个状态；`NOT_IMPLEMENTED` 时必须写明「谁来做 / 归哪张工单」，不许只丢一个枚举值。 */
  note: z.string(),
});
export type SkillCompileStageReport = z.infer<typeof SkillCompileStageReportSchema>;

// ---------------------------------------------------------------------------
// 诊断
// ---------------------------------------------------------------------------

export const SkillDiagnosticSeveritySchema = z.enum(["error", "warning", "info"]);
export type SkillDiagnosticSeverity = z.infer<typeof SkillDiagnosticSeveritySchema>;

export const SkillCompileDiagnosticSchema = z.object({
  /** PRD §4.2 诊断码；本切片实产 `GV-LINT` / `RG-TOOL` / `GR-*` 三组的子集。 */
  code: z.string(),
  severity: SkillDiagnosticSeveritySchema,
  /** JSON Pointer 路径，供编辑器定位（PRD §4.1「结构化 + 位置信息」）。 */
  path: z.string(),
  message: z.string(),
  /** 当场亮出的证据（R13）：命中的 key / 词表 / 调用点，不许只说"有问题"。 */
  evidence: z.string().optional(),
});
export type SkillCompileDiagnostic = z.infer<typeof SkillCompileDiagnosticSchema>;

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

/** AST 里的归一化引用：保留出处路径，供诊断定位与 §5.4 反查。 */
export const SkillAstRefSchema = z.object({
  kind: z.enum(SKILL_REFERENCE_KINDS),
  key: z.string(),
  /** 省略 = latest；本切片**不解析**成具体版本（钉版属 Validator 的 IO 段，PRD §4.3.2）。 */
  version: z.number().int().nullable(),
  required: z.boolean(),
  role: z.enum(SKILL_REFERENCE_ROLES),
  /** 来自 `references[]` 还是 `dependsOn[]`——两者语义不同（PRD §4.2 RG-SKILL），不许合成一句。 */
  origin: z.enum(["references", "dependsOn"]),
  /** JSON Pointer，如 `/references/0`。 */
  path: z.string(),
});
export type SkillAstRef = z.infer<typeof SkillAstRefSchema>;

/**
 * AST 的 `tools[]`。
 *
 * ⚠️ **诚实边界（工单描述与代码不符之处）**：工单要求 AST 含 `tools[]`，但
 * `SKILL_REFERENCE_KINDS`（`agentcore.ts:216`）今天**没有** `"tool"` / `"mcp"` 两个 kind——
 * PRD §9.1 把「加这两个 kind」列为**契约改动**，不在本切片的范围边界内。
 * 故本切片的 `tools[]` 是 **derived（派生）而非 declared（声明）**：由引用 kind 推出
 * 「跑这条技能必然要用到平台的哪个工具」。每条都带 `impliedBy` 说明它是谁推出来的，
 * 绝不伪装成作者声明过的东西。
 */
export const SkillAstToolSchema = z.object({
  /** 平台工具注册表里的工具名（`apps/agentcore/src/tools/registry.ts`）。 */
  name: z.string(),
  /** 恒为 `derived`：本切片没有任何「作者声明工具」的契约字段可读。 */
  source: z.literal("derived"),
  /** 推出它的依据：引用的 `kind:key`，或 `sideEffect/approvalGate`。字典序。 */
  impliedBy: z.array(z.string()),
});
export type SkillAstTool = z.infer<typeof SkillAstToolSchema>;

/**
 * ⛔ **三条线共用字段 · 改名会同时断三条链（审核方 2026-08-09 对名裁决）** ⛔
 *
 * 「这个 skill 怎么执行」的步骤集合，**唯一合法名字 = `Skill.execution.steps`**。
 * 定这条规矩是因为同一个字段一度在三份 PRD 里有三个名字：
 *   - `docs/PRD-skill-migration.md:165`            → `execution.plan[]`
 *   - `docs/PRD-skill-compiler-registry.md:176`    → `skill.execution.steps`  ← 裁决取此名
 *   - `docs/PRD-skill-runtime-orchestrator.md:41`  → `compileGraph(Skill.execution ⊕ legacy plan.steps)`
 * 三条线各按各的名字落地 ⇒ 互相读到 `undefined` ⇒ 静默回落 legacy ⇒ **功能等于没做，而四包全绿**。
 * 这是 `G-SIDEEFFECT-VOCAB-SPLIT` 同族（同一概念多套词表 → 判定分支永不触发 → 两边测试都绿）。
 *
 * **改这个名字会断的链**：
 *   ① 迁移线（WO-SKILL-MIGRATION-SCOPE）写入 → ② 本编译线读取产 AST/推理图 → ③ 运行时编排线消费执行。
 * 任一端改名，另两端读到 `undefined` 并**静默回落 legacy plan**——不会报错，只会功能消失。
 * 要改名必须三条线同一个 diff 一起改，并回写 `docs/SYSTEM-ONTOLOGY.md`。
 */
export const SKILL_EXECUTION_STEPS_PATH = "execution.steps" as const;

/**
 * AST 的执行步骤段。
 *
 * ⚠️ **诚实边界（"接了线没数据"，不是"已实现"）**：`SkillDefinitionSchema`（`agentcore.ts:236`）
 * 今天**还没有** `execution` 字段（实测：该文件 grep `execution` 零命中，而金丝雀 `references:` 命中 :256
 * ⇒ 工具是好的，确实不存在），字段由迁移线在建。故本切片：
 *   - 只按裁决的名字 `execution.steps` 读，绝不兼容任何别名（兼容别名 = 把词表分裂固化下来）；
 *   - 今天恒读到 `undefined` → `declared:false` + `steps:[]`，并**显式说出来**，
 *     不让调用方把"空数组"误读成"这个技能没有步骤"。
 * 三分法定性（铁律 0.5）：这是**接了线没数据**，不是没接线，也不是接错地方。
 */
export const SkillAstExecutionSchema = z.object({
  /**
   * 读自 `Skill.execution.steps`。元素**不在本切片做形状校验**——元素类型该用哪个判别联合
   * 尚有未决问题（`PlanStep` 是闭合联合，而生产校验器 `validatePlanSteps` 收的是
   * `ExtendedPlanStep = PlanStep | ExtraToolStep`，见 `apps/agentcore/src/workflow/executor.ts:27`），
   * 已上报审核方。在裁决前把任一侧写死进契约都会制造下一次分裂，故此处保持透传。
   */
  steps: z.array(z.unknown()),
  /** `false` = 契约上还没有这个字段（今天恒 false）。 */
  declared: z.boolean(),
  /** 提取出的步骤 type 序列，供诊断与后续图接线；`declared:false` 时为空。 */
  stepTypes: z.array(z.string()),
  note: z.string(),
});
export type SkillAstExecution = z.infer<typeof SkillAstExecutionSchema>;

export const SkillAstSchema = z.object({
  astVersion: z.literal(1),
  /** PRD §6.2/§6.1 点名的身份段。 */
  skill: z.object({
    id: z.string(),
    tenantId: z.string(),
    key: z.string(),
    version: z.number().int(),
    name: z.string(),
    status: z.string(),
    capability: z.string().nullable(),
    sideEffect: z.string().nullable(),
    approvalGate: z.string().nullable(),
    provenancePolicy: z.string().nullable(),
    maxBudgetRounds: z.number().int().nullable(),
    /** 单一判定出处（`agentcore.ts:201`）——GR-APPROVAL 只准用这一处，不得再造第二处判定。 */
    writeMode: z.boolean(),
  }),
  /** `kind:"ontologyType"`（PRD §6.1 `ontology/requires.json`）。 */
  ontology: z.array(SkillAstRefSchema),
  /** `kind:"rule" | "constraint"`（PRD §6.1 `rules/requires.json`）。 */
  rules: z.array(SkillAstRefSchema),
  /** `kind:"slice"`。 */
  slices: z.array(SkillAstRefSchema),
  /** `kind:"solver"` 全量（PRD §6.1 `solver/requires.json`）。 */
  solvers: z.array(SkillAstRefSchema),
  /**
   * 主求解器 = `solvers` 字典序首个，无则 `null`。
   * PRD §6.1 的 `solver/requires.json` 是**单数**口径，故单列一个位；同时保留 `solvers[]` 全量，
   * 因为 `references[]` 允许多个 solver——只给单数会静默丢引用。
   */
  solver: SkillAstRefSchema.nullable(),
  /** `kind:"agent"`。 */
  agents: z.array(SkillAstRefSchema),
  /** `kind:"workflow"`。 */
  workflows: z.array(SkillAstRefSchema),
  /** `kind:"skill"`（含 `dependsOn`，两者靠 `origin` 区分）。 */
  skills: z.array(SkillAstRefSchema),
  /** 派生工具集，见 `SkillAstToolSchema` 的诚实边界。 */
  tools: z.array(SkillAstToolSchema),
  io: z.object({
    inputSchema: JsonSchemaObject.nullable(),
    outputSchema: JsonSchemaObject.nullable(),
  }),
  /** `Skill.execution.steps`（对名裁决唯一名字）；今天恒 `declared:false`，见 `SkillAstExecutionSchema`。 */
  execution: SkillAstExecutionSchema,
  /**
   * `.skill` 包格式 / 签名 / manifest 的字段位（PRD §6）。
   * **本切片不做**（归 WO-SKILL-PACKAGE），故恒为下面这个显式标记——**不是空对象**。
   */
  runtimePackage: z.object({
    status: z.literal("NOT_IMPLEMENTED"),
    note: z.string(),
  }),
});
export type SkillAst = z.infer<typeof SkillAstSchema>;

// ---------------------------------------------------------------------------
// 推理图（PRD §3.2 SkillReasoningGraph · §9.1 形状）
// ---------------------------------------------------------------------------

/**
 * 节点类型词表。**七条复用既有 `PlanStep["type"]`（`qos.ts:109`），三条是新增且各自写明为什么不能复用。**
 *
 * 复用（= 与工作流引擎同一套步骤词汇，不造第二套）：
 *   query_objects · resolve_slice · invoke_solver · evaluate_rules · invoke_agent
 *   · render_answer · create_action_draft
 * 新增（既有词表里确实没有对应项）：
 *   entry            —— PRD §9.1 要求图有 `entry`；`PlanStep` 是线性步骤序列，没有"入口节点"概念。
 *   exit_error       —— PRD §9.1 要求 `exits[]{kind:normal|error}`；`PlanStep` 无异常出口概念
 *                       （它的异常语义是每步的 `onError`，管不了"整条链失败后落到哪"）。
 *   invoke_workflow  —— 引用 `kind:"workflow"` 需要一个节点，而 `PlanStep` 里没有调工作流的步骤类型
 *                       （工作流是被 `POST /b/v1/workflows/:id/run` 启动的，不是某个步骤）。
 * 另有一条借自**工具注册表**而非步骤词表：
 *   load_skill       —— `LOAD_SKILL_TOOL.name`（`apps/agentcore/src/tools/registry.ts:481`）。
 *                       引用 `kind:"skill"` 在运行时就是靠这个工具取的，不另起名。
 *                       编译器侧对它做注册表反查（RG-TOOL），改名即红。
 */
export const SKILL_REASONING_NODE_TYPES = [
  "create_action_draft",
  "entry",
  "evaluate_rules",
  "exit_error",
  "invoke_agent",
  "invoke_solver",
  "invoke_workflow",
  "load_skill",
  "query_objects",
  "render_answer",
  "resolve_slice",
] as const;
export type SkillReasoningNodeType = (typeof SKILL_REASONING_NODE_TYPES)[number];

/**
 * 机器守的「复用不漂移」：下面这个数组的每一项都必须仍是合法的 `PlanStep["type"]`。
 * 谁在 `qos.ts` 改了步骤类型名，**这里当场 TS 编译失败**——不靠人记得回来看注释。
 * （铁律 0.6：机制的判据 = 下次同样的错发生时，是机器先说话。）
 */
export const SKILL_REASONING_NODE_TYPES_REUSED_FROM_PLAN_STEP = [
  "create_action_draft",
  "evaluate_rules",
  "invoke_agent",
  "invoke_solver",
  "query_objects",
  "render_answer",
  "resolve_slice",
] as const satisfies readonly PlanStep["type"][];

/** 反向也钉死：复用集必须是节点词表的子集（防有人只改一边）。 */
type _AssertReusedSubsetOfNodeTypes =
  (typeof SKILL_REASONING_NODE_TYPES_REUSED_FROM_PLAN_STEP)[number] extends SkillReasoningNodeType ? true : never;
const _assertReusedSubset: _AssertReusedSubsetOfNodeTypes = true;
void _assertReusedSubset;

export const SkillReasoningNodeSchema = z.object({
  id: z.string(),
  type: z.enum(SKILL_REASONING_NODE_TYPES),
  /** 该节点来自哪条引用；`entry` / `exit_error` / 终止渲染节点为 `null`。 */
  ref: SkillAstRefSchema.nullable(),
  /**
   * GR-EXCEPTION：可失败节点必须声明异常语义。
   * **复用既有 `OnErrorSchema`**（`qos.ts:104` = `FAIL | SKIP`），不新造词表。
   */
  onError: OnErrorSchema.nullable(),
});
export type SkillReasoningNode = z.infer<typeof SkillReasoningNodeSchema>;

export const SkillReasoningEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** `null` = 无条件；`"on_error"` = 异常路径。 */
  condition: z.enum(["on_error"]).nullable(),
});
export type SkillReasoningEdge = z.infer<typeof SkillReasoningEdgeSchema>;

export const SkillReasoningGraphSchema = z.object({
  entry: z.string(),
  nodes: z.array(SkillReasoningNodeSchema),
  edges: z.array(SkillReasoningEdgeSchema),
  exits: z.array(z.object({ nodeId: z.string(), kind: z.enum(["normal", "error"]) })),
});
export type SkillReasoningGraph = z.infer<typeof SkillReasoningGraphSchema>;

// ---------------------------------------------------------------------------
// 编译响应（`POST /b/v1/skills/:id/compile`）
// ---------------------------------------------------------------------------

export const SkillCompileResultSchema = z.object({
  skillId: z.string(),
  skillKey: z.string(),
  skillVersion: z.number().int(),
  ok: z.boolean(),
  ast: SkillAstSchema,
  graph: SkillReasoningGraphSchema,
  diagnostics: z.array(SkillCompileDiagnosticSchema),
  stages: z.array(SkillCompileStageReportSchema),
});
export type SkillCompileResult = z.infer<typeof SkillCompileResultSchema>;

// ---------------------------------------------------------------------------
// ① Parser（纯函数）
// ---------------------------------------------------------------------------

type SkillReferenceKind = (typeof SKILL_REFERENCE_KINDS)[number];

/**
 * 引用 kind → {AST 桶, 图节点类型, 运行时必需工具}。
 *
 * 写成 `Record<SkillReferenceKind, …>` 是**故意的**：`SKILL_REFERENCE_KINDS` 一旦按 PRD §9.1
 * 扩出 `"tool"` / `"mcp"`，这里**当场 TS 编译失败**，逼下一个人补映射——
 * 而不是让新 kind 静默落进"没有节点、没有工具"的黑洞里（`G-SIDEEFFECT-VOCAB-SPLIT` 那族病）。
 */
export const SKILL_REF_KIND_BINDING: Record<
  SkillReferenceKind,
  { bucket: "ontology" | "rules" | "slices" | "solvers" | "agents" | "workflows" | "skills"; node: SkillReasoningNodeType; tool: string | null }
> = {
  agent: { bucket: "agents", node: "invoke_agent", tool: null },
  constraint: { bucket: "rules", node: "evaluate_rules", tool: "evaluate_rules" },
  ontologyType: { bucket: "ontology", node: "query_objects", tool: "query_objects" },
  rule: { bucket: "rules", node: "evaluate_rules", tool: "evaluate_rules" },
  skill: { bucket: "skills", node: "load_skill", tool: "load_skill" },
  slice: { bucket: "slices", node: "resolve_slice", tool: "resolve_slice" },
  solver: { bucket: "solvers", node: "invoke_solver", tool: "invoke_solver" },
  workflow: { bucket: "workflows", node: "invoke_workflow", tool: null },
};

/** 写模式技能必须能产 action_draft（R4 真值经 Action · GR-APPROVAL）。 */
export const WRITE_MODE_REQUIRED_TOOL = "create_action_draft";

/**
 * 读 `Skill.execution.steps` —— **只认这一个名字**（对名裁决 2026-08-09）。
 *
 * 刻意**不做**任何别名回退（不读 `execution.plan`、不读 `plan.steps`、不读 `steps`）：
 * 别名回退看着"更健壮"，实则把词表分裂固化成永久兼容层，
 * 让"三条线名字不一致"这个事故**永远不会红**——正是本仓最痛的那种静默。
 * 名字对不上就该是空 + 显式说明，让人一眼看见，而不是悄悄跑通一半。
 *
 * 入参故意收成结构类型而非 `SkillDefinition`：契约上该字段还不存在（迁移线在建），
 * 本函数在它落地的当天自动开始有数据，无需再改一行。
 */
export function readSkillExecutionSteps(skill: unknown): { steps: unknown[]; declared: boolean } {
  const execution = (skill as { execution?: unknown } | null)?.execution;
  if (execution === null || typeof execution !== "object") return { steps: [], declared: false };
  const steps = (execution as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return { steps: [], declared: false };
  return { steps, declared: true };
}

/** 稳定排序键：kind → key → version(latest 排在具体版本前) → origin。 */
function refSortKey(r: SkillAstRef): string {
  return `${r.kind} ${r.key} ${r.version === null ? "" : String(r.version).padStart(10, "0")} ${r.origin}`;
}

function normalizeRef(ref: SkillReference, origin: "references" | "dependsOn", index: number): SkillAstRef {
  return {
    kind: ref.kind,
    key: ref.key,
    version: typeof ref.version === "number" ? ref.version : null,
    required: ref.required !== false,
    role: ref.role ?? "context",
    origin,
    path: `/${origin}/${index}`,
  };
}

/**
 * ① Parser：`SkillDefinition` → `SkillAst`。**纯函数**（PRD §4.1 分层纪律）。
 *
 * 输入刻意收窄成既有的 `SkillDefinition`（`agentcore.ts:236`），不另造一套 Skill 形状——
 * 「同一概念两套词表」是本仓最痛的病（历史上两个 dev 各造一套全链节点词表，交集为 0）。
 */
export function parseSkillToAst(skill: SkillDefinition): SkillAst {
  const buckets: Record<(typeof SKILL_REF_KIND_BINDING)[SkillReferenceKind]["bucket"], SkillAstRef[]> = {
    ontology: [],
    rules: [],
    slices: [],
    solvers: [],
    agents: [],
    workflows: [],
    skills: [],
  };

  const all: SkillAstRef[] = [
    ...(skill.references ?? []).map((r, i) => normalizeRef(r, "references", i)),
    ...(skill.dependsOn ?? []).map((r, i) => normalizeRef(r, "dependsOn", i)),
  ];
  for (const r of all) buckets[SKILL_REF_KIND_BINDING[r.kind].bucket].push(r);
  for (const k of Object.keys(buckets) as (keyof typeof buckets)[]) {
    buckets[k].sort((a, b) => (refSortKey(a) < refSortKey(b) ? -1 : refSortKey(a) > refSortKey(b) ? 1 : 0));
  }

  const writeMode = isWriteModeSkill(skill);
  const execution = readSkillExecutionSteps(skill);

  // 派生工具集：kind → 必需工具，外加写模式的 create_action_draft。impliedBy 与工具名均字典序（R6）。
  const toolImplications = new Map<string, Set<string>>();
  for (const r of all) {
    const tool = SKILL_REF_KIND_BINDING[r.kind].tool;
    if (!tool) continue;
    if (!toolImplications.has(tool)) toolImplications.set(tool, new Set());
    toolImplications.get(tool)!.add(`${r.kind}:${r.key}`);
  }
  if (writeMode) {
    if (!toolImplications.has(WRITE_MODE_REQUIRED_TOOL)) toolImplications.set(WRITE_MODE_REQUIRED_TOOL, new Set());
    toolImplications
      .get(WRITE_MODE_REQUIRED_TOOL)!
      .add(`writeMode:sideEffect=${skill.sideEffect ?? "none"},approvalGate=${skill.approvalGate ?? "none"}`);
  }
  const tools: SkillAstTool[] = [...toolImplications.entries()]
    .map(([name, implied]) => ({ name, source: "derived" as const, impliedBy: [...implied].sort() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    astVersion: 1,
    skill: {
      id: skill.id,
      tenantId: skill.tenantId,
      key: skill.key,
      version: skill.version,
      name: skill.name,
      status: skill.status,
      capability: skill.capability ?? null,
      sideEffect: skill.sideEffect ?? null,
      approvalGate: skill.approvalGate ?? null,
      provenancePolicy: skill.provenancePolicy ?? null,
      maxBudgetRounds: typeof skill.maxBudgetRounds === "number" ? skill.maxBudgetRounds : null,
      writeMode,
    },
    ontology: buckets.ontology,
    rules: buckets.rules,
    slices: buckets.slices,
    solvers: buckets.solvers,
    solver: buckets.solvers[0] ?? null,
    agents: buckets.agents,
    workflows: buckets.workflows,
    skills: buckets.skills,
    tools,
    io: {
      inputSchema: skill.inputSchema ?? null,
      outputSchema: skill.outputSchema ?? null,
    },
    execution: {
      steps: execution.steps,
      declared: execution.declared,
      stepTypes: execution.steps
        .map((s) => (s !== null && typeof s === "object" ? (s as { type?: unknown }).type : undefined))
        .filter((t): t is string => typeof t === "string"),
      note: execution.declared
        ? `读自 ${SKILL_EXECUTION_STEPS_PATH}（三条线共用字段·对名裁决唯一名字）；本切片不校验元素形状，也未接入推理图（GR-STEPS 未实现）。`
        : `${SKILL_EXECUTION_STEPS_PATH} 在 SkillDefinitionSchema 上尚不存在（迁移线在建）——恒空属「接了线没数据」，` +
          "不是「这个技能没有步骤」，更不是「已实现」。本切片不做任何别名回退。",
    },
    runtimePackage: {
      status: "NOT_IMPLEMENTED",
      note:
        "`.skill` 包格式 / manifest / 签名属 WO-SKILL-PACKAGE（PRD §6），本切片只留字段位，未实现。" +
        "调用方不得据此认为已产出可分发制品。",
    },
  };
}

// ---------------------------------------------------------------------------
// ③ 推理图派生（纯函数）
// ---------------------------------------------------------------------------

export const SKILL_GRAPH_ENTRY_NODE_ID = "entry";
export const SKILL_GRAPH_NORMAL_EXIT_NODE_ID = "exit:render_answer";
export const SKILL_GRAPH_ERROR_EXIT_NODE_ID = "exit:error";
export const SKILL_GRAPH_ACTION_DRAFT_NODE_ID = "act:create_action_draft";

/** 节点 id 与引用一一对应，且可逆解析（SEAM 断言靠它把节点集合与 `references[]` 对账）。 */
export function skillGraphNodeId(ref: SkillAstRef): string {
  return `ref:${ref.origin}:${ref.kind}:${ref.key}`;
}

/** 可失败节点（GR-EXCEPTION：必须有异常出口）。 */
const FAILABLE_NODE_TYPES = new Set<SkillReasoningNodeType>([
  "evaluate_rules",
  "invoke_agent",
  "invoke_solver",
  "invoke_workflow",
  "load_skill",
  "query_objects",
  "resolve_slice",
]);

function sortNodes(a: SkillReasoningNode, b: SkillReasoningNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sortEdges(a: SkillReasoningEdge, b: SkillReasoningEdge): number {
  const ka = `${a.from} ${a.to} ${a.condition ?? ""}`;
  const kb = `${b.from} ${b.to} ${b.condition ?? ""}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * ③ 从 AST 派生技能推理图。**纯函数 · 确定性（R6）**。
 *
 * 分层拓扑（按引用的 `role` 分层，层内并列、层间全连）：
 *   entry → [precondition] → [context] → [postcheck] → (create_action_draft?) → render_answer(normal exit)
 *   fallback 角色的引用挂在异常路径上：entry --on_error--> [fallback] → exit_error
 *   每个可失败节点 --on_error--> exit_error（GR-EXCEPTION：每条路径都终止于已定义的终止节点）
 *
 * **不做的事**（PRD §4.4 Optimizer「不做」清单）：不重排、不剪枝、不跨技能内联展开。
 * 本切片连 Optimizer 都没做——图是直接派生的，未经拓扑优化，见 `SKILL_COMPILE_STAGES` 的 `optimize` 段。
 */
export function deriveSkillReasoningGraph(ast: SkillAst): SkillReasoningGraph {
  const refs: SkillAstRef[] = [
    ...ast.ontology,
    ...ast.rules,
    ...ast.slices,
    ...ast.solvers,
    ...ast.agents,
    ...ast.workflows,
    ...ast.skills,
  ];

  const nodes: SkillReasoningNode[] = [
    { id: SKILL_GRAPH_ENTRY_NODE_ID, type: "entry", ref: null, onError: null },
    { id: SKILL_GRAPH_NORMAL_EXIT_NODE_ID, type: "render_answer", ref: null, onError: null },
    { id: SKILL_GRAPH_ERROR_EXIT_NODE_ID, type: "exit_error", ref: null, onError: null },
  ];

  const byRole: Record<(typeof SKILL_REFERENCE_ROLES)[number], string[]> = {
    precondition: [],
    context: [],
    postcheck: [],
    fallback: [],
  };

  for (const ref of refs) {
    const id = skillGraphNodeId(ref);
    const type = SKILL_REF_KIND_BINDING[ref.kind].node;
    nodes.push({
      id,
      type,
      ref,
      // required:false 的引用解析失败只降级（PRD §4.2 RG-OPTIONAL）→ SKIP；必需引用 → FAIL。
      onError: FAILABLE_NODE_TYPES.has(type) ? (ref.required ? "FAIL" : "SKIP") : null,
    });
    byRole[ref.role].push(id);
  }
  for (const role of Object.keys(byRole) as (keyof typeof byRole)[]) byRole[role].sort();

  if (ast.skill.writeMode) {
    nodes.push({ id: SKILL_GRAPH_ACTION_DRAFT_NODE_ID, type: "create_action_draft", ref: null, onError: null });
  }

  const edges: SkillReasoningEdge[] = [];
  const link = (from: string, to: string, condition: "on_error" | null = null): void => {
    edges.push({ from, to, condition });
  };

  // 正常路径分层：空层直接跳过（不生成悬空层）。
  const mainLayers: string[][] = [
    [SKILL_GRAPH_ENTRY_NODE_ID],
    byRole.precondition,
    byRole.context,
    byRole.postcheck,
    ast.skill.writeMode ? [SKILL_GRAPH_ACTION_DRAFT_NODE_ID] : [],
    [SKILL_GRAPH_NORMAL_EXIT_NODE_ID],
  ].filter((layer) => layer.length > 0);

  for (let i = 0; i + 1 < mainLayers.length; i++) {
    for (const from of mainLayers[i]!) for (const to of mainLayers[i + 1]!) link(from, to);
  }

  // 异常路径：fallback 角色的引用只在出错时走。
  for (const id of byRole.fallback) {
    link(SKILL_GRAPH_ENTRY_NODE_ID, id, "on_error");
    link(id, SKILL_GRAPH_ERROR_EXIT_NODE_ID);
  }
  // GR-EXCEPTION：每个可失败节点都有一条到已定义异常出口的边。
  for (const node of nodes) {
    if (node.ref && FAILABLE_NODE_TYPES.has(node.type) && node.ref.role !== "fallback") {
      link(node.id, SKILL_GRAPH_ERROR_EXIT_NODE_ID, "on_error");
    }
  }

  nodes.sort(sortNodes);
  edges.sort(sortEdges);

  return {
    entry: SKILL_GRAPH_ENTRY_NODE_ID,
    nodes,
    edges,
    exits: [
      { nodeId: SKILL_GRAPH_ERROR_EXIT_NODE_ID, kind: "error" },
      { nodeId: SKILL_GRAPH_NORMAL_EXIT_NODE_ID, kind: "normal" },
    ],
  };
}

/**
 * 图节点集合 → `kind:key` 集合（只算由引用派生的节点，跳过 entry/exit/action_draft）。
 * SEAM 断言与编译器内部对账**共用这一个实现**——各抄一份就是装饰品（铁律 0.6）。
 */
export function skillGraphRefKeys(graph: SkillReasoningGraph): string[] {
  return graph.nodes
    .filter((n) => n.ref !== null)
    .map((n) => `${n.ref!.kind}:${n.ref!.key}`)
    .sort();
}

/** `SkillDefinition.references[] + dependsOn[]` → `kind:key` 集合（对账的另一半）。 */
export function skillDeclaredRefKeys(skill: Pick<SkillDefinition, "references" | "dependsOn">): string[] {
  return [...(skill.references ?? []), ...(skill.dependsOn ?? [])].map((r) => `${r.kind}:${r.key}`).sort();
}
