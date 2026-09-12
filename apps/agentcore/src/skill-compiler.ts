import {
  SKILL_COMPILE_STAGES,
  deriveSkillReasoningGraph,
  parseSkillToAst,
  skillDeclaredRefKeys,
  skillGraphRefKeys,
  type SkillAst,
  type SkillCompileDiagnostic,
  type SkillCompileResult,
  type SkillCompileStageReport,
  type SkillDefinition,
} from "@platform/contracts";
import { lintSkill, type SkillLintViolation } from "./skill-lint.js";
import { BUILTIN_TOOLS, FINAL_ANSWER_TOOL, LOAD_SKILL_TOOL } from "./tools/registry.js";

/**
 * WO-SKILL-COMPILER-S1 · 技能编译流水线的 **② Validator 段 + 装配**
 * （`docs/PRD-skill-compiler-registry.md` §4.1 / §4.2）。
 *
 * PRD §4.1 的分层纪律：① Parser 与 ③ 图派生是纯函数、住在 contracts
 * （`packages/contracts/src/skill-compile.ts`）；**② 是唯一需要读注册表的一段**，故住在这里。
 *
 * ---------------------------------------------------------------------------
 * ⛔ Validator 必须**调既有 lintSkill**，不许另写一套校验
 * ---------------------------------------------------------------------------
 * `lintSkill`（`apps/agentcore/src/skill-lint.ts:234`）已经存在且已接发布路
 * （`server.ts:1246` POST /b/v1/skills/:id/publish）。编译器把它当作**一个诊断源**接入，
 * 一条规则也不重写——否则就是本仓最痛的「同一概念两套词表」：历史上两个 dev 各造一套全链
 * 节点词表、交集为 0，两边测试都是绿的。
 * 对应 PRD §4.2 的 **GV-LINT** 诊断码：「全量复用 lintSkill ——**不重写**」。
 *
 * ---------------------------------------------------------------------------
 * 本切片**没做**的段（诚实边界 · 不许返回空对象让调用方以为跑过了）
 * ---------------------------------------------------------------------------
 * - **Optimizer（PRD §4.4）**：拓扑排序 / 并行分组 / 死节点剪除 / 常量折叠 / 预算下推 —— 全未做。
 * - **SkillRuntimePackage + 签名（PRD §4.5 / §6）**：`.skill` 包格式、digest、manifest、验签 —— 全未做，
 *   归 WO-SKILL-PACKAGE。
 * - **RG 组的跨系统引用探针（PRD §4.2 / §4.3）**：`probeMissingRefs`（`apps/agentcore/src/resources.ts`）
 *   今天已接三条发布路：workflow / agent / skill。skill 路 2026-08-09（WO-SKILL-REFCLOSURE-A）接线，
 *   后经 WO-REFGATE-ENT 把判据抽进 `skill-publish-gate.ts` 的 `runSkillPublishGate`，
 *   发布路由与启动期种子审计**共用同一份实现**；探针自身亦已 fail-closed
 *   （注册表读不出/空集 → 抛 `RefProbeUnavailableError` → 503；死引用 → 422 SKILL_REF_UNRESOLVED 且未落库）。
 *   本编译切片仍**不**在编译期做该校验——`compileSkill` 是确定性纯函数（R6·零 I/O），探针属发布期职责；
 *   故 `kind` 为 rule/constraint/solver/slice/ontologyType/workflow/agent 的引用在**编译产物**里不带存在性结论，
 *   这一点在诊断里以 `RG-NOT-WIRED` info 显式说出来，不静默略过。
 */

/** 平台注册表全部工具名。与 `skill-lint.ts:53-60 registeredToolNames()` **同源**（同一份 registry 导出）。 */
function registeredToolNames(extra: string[] = []): Set<string> {
  return new Set([
    ...BUILTIN_TOOLS.map((t) => t.name),
    FINAL_ANSWER_TOOL.name,
    LOAD_SKILL_TOOL.name,
    ...extra,
  ]);
}

/** lint 的 location → JSON Pointer 路径（编辑器定位用；lint 本身只给粗粒度位置）。 */
const LINT_LOCATION_POINTER: Record<SkillLintViolation["location"], string> = {
  summary: "/summary",
  body: "/body",
  resources: "/resources",
  metadata: "",
};

function sortDiagnostics(a: SkillCompileDiagnostic, b: SkillCompileDiagnostic): number {
  const ka = `${a.code} ${a.path} ${a.message}`;
  const kb = `${b.code} ${b.path} ${b.message}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export interface CompileSkillContext {
  /** 同租户全部 skill（`lintSkill` 的跨资源规则靠它，缺省会让那两条规则恒过——见 `server.ts:1243` 的注释）。 */
  allSkills?: SkillDefinition[];
  /** 发布态：`dependsOn` 指向的 skill 必须已 PUBLISHED。编辑器干跑传 false。 */
  requirePublishedDeps?: boolean;
  /** 租户自定义工具名（同 `lintSkill` 的 `opts.extraToolNames`）。 */
  extraToolNames?: string[];
}

/**
 * ② Validator：把 AST + 既有 lint 结果 + 工具注册表反查汇成诊断表。
 *
 * 返回的每条诊断都带 `code`（PRD §4.2 的诊断码）+ `path`（JSON Pointer）+ `evidence`（R13 当场亮出证据）。
 */
export function validateSkillAst(
  skill: SkillDefinition,
  ast: SkillAst,
  ctx: CompileSkillContext = {},
): SkillCompileDiagnostic[] {
  const diagnostics: SkillCompileDiagnostic[] = [];

  // —— GV-LINT：全量复用既有 lintSkill，一条规则不重写 ——
  const lint = lintSkill(
    skill,
    { extraToolNames: ctx.extraToolNames },
    { allSkills: ctx.allSkills, requirePublishedDeps: ctx.requirePublishedDeps },
  );
  for (const v of lint.violations) {
    diagnostics.push({
      code: "GV-LINT",
      severity: "error",
      path: LINT_LOCATION_POINTER[v.location],
      message: v.message,
      evidence: `lintSkill rule=${v.rule}`,
    });
  }

  // —— RG-TOOL：派生工具集必须都在平台工具注册表里 ——
  // 这条同时是 contracts 侧 SKILL_REF_KIND_BINDING 的**反查门**：谁在 tools/registry.ts 把
  // load_skill / invoke_solver 之类改了名，这里当场报错，而不是让编译器安静地产出一个指向空气的工具名。
  const known = registeredToolNames(ctx.extraToolNames);
  for (const tool of ast.tools) {
    if (!known.has(tool.name)) {
      diagnostics.push({
        code: "RG-TOOL",
        severity: "error",
        path: "/tools",
        message: `派生工具「${tool.name}」不在平台工具注册表中（引用 kind→工具 的映射已与注册表漂移）`,
        evidence: `impliedBy=${tool.impliedBy.join(",")}；注册表 ${known.size} 个工具名`,
      });
    }
  }

  // —— GR-REACH：节点集合必须与声明的引用逐条对账（接缝判据，SEAM 咬的就是这条）——
  // 与 SEAM 测试**共用 contracts 里的同一个实现**，不各抄一份（抄了就是装饰品）。
  const graphKeys = skillGraphRefKeys(deriveSkillReasoningGraph(ast));
  const declaredKeys = skillDeclaredRefKeys(skill);
  if (JSON.stringify(graphKeys) !== JSON.stringify(declaredKeys)) {
    diagnostics.push({
      code: "GR-REACH",
      severity: "error",
      path: "/references",
      message: "推理图节点集合与声明的引用不一致——有引用没长出节点，或有节点凭空冒出",
      evidence: `graph=[${graphKeys.join(",")}] declared=[${declaredKeys.join(",")}]`,
    });
  }

  // —— GR-APPROVAL：写模式技能的图里必须有产 action_draft 的节点（R4 真值经 Action）——
  // 判定只用 `isWriteModeSkill`（已在 Parser 段调过，落在 ast.skill.writeMode），不再造第二处。
  if (ast.skill.writeMode && !ast.tools.some((t) => t.name === "create_action_draft")) {
    diagnostics.push({
      code: "GR-APPROVAL",
      severity: "error",
      path: "/sideEffect",
      message: "写模式技能未派生出 create_action_draft —— 它将无法产出可审批的行动草案",
      evidence: `sideEffect=${ast.skill.sideEffect ?? "none"} approvalGate=${ast.skill.approvalGate ?? "none"}`,
    });
  }

  // —— IO-OUTPUT-CONSUMER：声明了 outputSchema 但本切片没有校验消费方（PRD §4.2 IO 组，SPEC D5）——
  if (ast.io.outputSchema !== null) {
    diagnostics.push({
      code: "IO-OUTPUT-CONSUMER",
      severity: "warning",
      path: "/outputSchema",
      message: "outputSchema 已声明，但本编译切片未产出运行时包，故此声明目前无人消费",
      evidence: "SkillRuntimePackage 段 NOT_IMPLEMENTED（WO-SKILL-PACKAGE）",
    });
  }

  // —— GR-STEPS：`Skill.execution.steps` 的步骤校验（PRD §4.2 GR-STEPS）本切片未实现 ——
  // 对名裁决（2026-08-09）定死唯一字段名 `execution.steps`；契约上它今天还不存在（迁移线在建）。
  // 两种情形分开报，**不许合成一句**（"接了线没数据" 与 "有数据没消费" 修法完全不同）：
  if (!ast.execution.declared) {
    diagnostics.push({
      code: "GR-STEPS-NO-DATA",
      severity: "info",
      path: "/execution/steps",
      message:
        "Skill.execution.steps 在 SkillDefinitionSchema 上尚不存在（迁移线在建），故确定性步骤段恒空——" +
        "属「接了线没数据」，不是「这个技能没有步骤」。本编译器不做任何别名回退：名字对不上就该空得刺眼。",
      evidence: "对名裁决 2026-08-09 · 唯一字段名 execution.steps",
    });
  } else {
    diagnostics.push({
      code: "GR-STEPS",
      severity: "warning",
      path: "/execution/steps",
      message:
        `已读到 ${ast.execution.steps.length} 条 execution.steps，但本切片**未**对其跑 validatePlanSteps` +
        "（id 不重复 / 无前向引用 / render_answer 末步 / 超时合计 ≤5min），也未把它接进推理图。",
      evidence: `stepTypes=${ast.execution.stepTypes.join(",") || "(无 type 字段)"}`,
    });
  }

  // —— RG-NOT-WIRED：本编译切片是确定性纯函数（R6·零 I/O），跨系统引用存在性不在编译期校验；
  //    发布期由发布门守住（fail-closed），此处只把「编译产物不带存在性结论」说出来（诚实边界，不静默略过）——
  const unprobed = [...ast.ontology, ...ast.rules, ...ast.slices, ...ast.solvers, ...ast.agents, ...ast.workflows];
  if (unprobed.length > 0) {
    diagnostics.push({
      code: "RG-NOT-WIRED",
      severity: "info",
      path: "/references",
      message:
        `${unprobed.length} 条非 skill 引用在本编译切片内未做存在性校验——编译器是确定性纯函数（R6·零 I/O），` +
        "存在性校验在发布期：POST /b/v1/skills/:id/publish 经 runSkillPublishGate 调 probeMissingRefs" +
        "（2026-08-09 WO-SKILL-REFCLOSURE-A 起 fail-closed：注册表读不出/空集 → 503 REF_PROBE_UNAVAILABLE；" +
        "死引用 → 422 SKILL_REF_UNRESOLVED 且未落库）。",
      evidence: unprobed.map((r) => `${r.kind}:${r.key}`).sort().join(","),
    });
  }

  return diagnostics.sort(sortDiagnostics);
}

/** 本切片各段的落地状态。**没做的段一律 NOT_IMPLEMENTED**，且必须写明归谁做。 */
function stageReports(hasError: boolean): SkillCompileStageReport[] {
  const byStage: Record<(typeof SKILL_COMPILE_STAGES)[number], SkillCompileStageReport> = {
    parse: { stage: "parse", status: "OK", note: "SkillDefinition → SkillAst（纯函数·contracts/skill-compile.ts）" },
    validate: {
      stage: "validate",
      status: hasError ? "FAILED" : "OK",
      note:
        "复用既有 lintSkill（skill-lint.ts 的 lintSkill）+ 工具注册表反查 + 图/引用对账。" +
        "跨系统引用存在性探针不在编译切片内（纯函数零 I/O）——发布期由 skill-publish-gate.ts 的 " +
        "runSkillPublishGate 调 probeMissingRefs 守住（fail-closed，见 RG-NOT-WIRED 诊断）。",
    },
    graph: { stage: "graph", status: "OK", note: "AST → SkillReasoningGraph（纯函数·分层拓扑·未经优化）" },
    optimize: {
      stage: "optimize",
      status: "NOT_IMPLEMENTED",
      note:
        "PRD §4.4 Optimizer（拓扑排序 / parallelGroup 分组 / 死节点剪除 / 常量折叠 / 预算下推）本切片未做。" +
        "graph 段给出的是**未优化**的派生图，不要当成优化产物。",
    },
    package: {
      stage: "package",
      status: "NOT_IMPLEMENTED",
      note:
        "PRD §4.5 / §6 的 SkillRuntimePackage、digest、manifest.json、signature/ 本切片全未做，归 WO-SKILL-PACKAGE。" +
        "本响应**不含**任何可分发制品。",
    },
  };
  return SKILL_COMPILE_STAGES.map((s) => byStage[s]);
}

/**
 * 编译一个 Skill：① Parser → ② Validator → ③ 图派生。
 *
 * **R6 确定性**：无 `Date.now` / `Math.random` / 网络；同一 `SkillDefinition` + 同一 ctx 两次调用，
 * `JSON.stringify(result)` 逐字节一致。
 */
export function compileSkill(skill: SkillDefinition, ctx: CompileSkillContext = {}): SkillCompileResult {
  const ast = parseSkillToAst(skill);
  const diagnostics = validateSkillAst(skill, ast, ctx);
  const graph = deriveSkillReasoningGraph(ast);
  const hasError = diagnostics.some((d) => d.severity === "error");
  return {
    skillId: skill.id,
    skillKey: skill.key,
    skillVersion: skill.version,
    ok: !hasError,
    ast,
    graph,
    diagnostics,
    stages: stageReports(hasError),
  };
}
