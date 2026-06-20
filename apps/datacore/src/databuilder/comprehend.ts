import { z } from "zod";
import type {
  BuildPlan, PlanDataSource, PlanObjectType, PlanRule, PlanSolverNeed,
  PlanSliceNeed, PlanIntentNeed, PlanPlanNeed, PlanSceneNeed,
  PlanWorkflowNeed, PlanSkillNeed, PlanAgentNeed,
} from "@platform/contracts";

/**
 * §2 LLM comprehend：让 LLM 只产出"听懂故事"的难点部分——对象类型 / 规则 / 求解器需求；
 * 机械的 B 栈倒推（切片/意图/计划/场景/工作流/技能/Agent）仍由确定性 `assemblePlanBody` 完成。
 * 缺 LLM 绑定/失败时由 `comprehendScript` 关键词地板兜底（R6 字节级一致）。
 */
export const LlmComprehendSchema = z.object({
  objectTypes: z.array(z.object({
    typeKey: z.string(),
    displayName: z.string(),
    domain: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      dataType: z.enum(["string", "number", "boolean", "date", "enum", "ref"]),
      isPrimaryKey: z.boolean().optional(),
      refToTypeKey: z.string().nullable().optional(),
    })),
  })),
  rules: z.array(z.object({
    key: z.string(), name: z.string(), expression: z.string(),
    scopeObjectTypes: z.array(z.string()), severity: z.enum(["BLOCK", "WARN", "INFO"]),
  })),
  solverNeeds: z.array(z.object({
    solverKey: z.string(),
    inputFields: z.array(z.object({ typeKey: z.string(), propKey: z.string() })),
  })),
});
export type LlmComprehendOutput = z.infer<typeof LlmComprehendSchema>;

export const COMPREHEND_SYSTEM = [
  "你是制造业运营本体建模专家。把用户的业务故事/问题解析为推演所需的本体骨架。",
  "输出 JSON：objectTypes(对象类型+字段，每类至少一个 isPrimaryKey)、rules(业务约束 DSL，如 'Order.demandDelta > 0.5')、solverNeeds(回答该问题所需的求解器及其输入字段)。",
  "domain 取：factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external 之一。",
  "若问题涉及工序/设备瓶颈、排产降级、后果推演，应建 Process/Equipment 等对象类型并提出对应 solver（如 shared_bottleneck / schedule_downgrade / impact_forecast）。",
].join("\n");

/** 由 LLM 产出的核心三件 → 装配完整 plan body（确定性 B 栈倒推，复用与关键词地板同一口径）。 */
export function assemblePlanBody(
  core: LlmComprehendOutput,
  script: string,
  seed: number,
): ReturnType<typeof comprehendScript> {
  const typeKeys = new Set(core.objectTypes.map((t) => t.typeKey));
  const dataSources: PlanDataSource[] = core.objectTypes.map((e) => ({
    connType: "mock_generic",
    name: `${e.displayName}数据源`,
    datasetKey: e.typeKey.toLowerCase(),
    rowCount: 12 + (hashString(`${e.typeKey}|${seed}`) % 12),
    fields: e.fields.map((f) => ({ name: f.name, dataType: f.dataType, consumedBy: [e.typeKey] })),
  }));
  const objectTypes: PlanObjectType[] = core.objectTypes.map((e) => ({
    typeKey: e.typeKey, displayName: e.displayName, domain: e.domain, sourceDataset: e.typeKey.toLowerCase(),
    properties: e.fields.map((f) => ({ propKey: f.name, sourceField: f.name, dataType: f.dataType, isPrimaryKey: f.isPrimaryKey ?? false, refToTypeKey: f.refToTypeKey ?? null })),
  }));
  const rules: PlanRule[] = core.rules.filter((r) => r.scopeObjectTypes.every((t) => typeKeys.has(t)));
  const solverNeeds: PlanSolverNeed[] = core.solverNeeds.filter((s) => s.inputFields.every((f) => typeKeys.has(f.typeKey)));
  return { dataSources, objectTypes, rules, solverNeeds, ...deriveBStack(objectTypes, solverNeeds, script) };
}

/** B 栈倒推（确定性）：对象→切片；求解器→计划/意图/场景/工作流/技能/Agent。LLM 与关键词地板共用。 */
function deriveBStack(objectTypes: PlanObjectType[], solverNeeds: PlanSolverNeed[], script: string) {
  const sliceNeeds: PlanSliceNeed[] = objectTypes.map((t) => ({ sliceKey: `slice_${t.typeKey.toLowerCase()}`, rootType: t.typeKey, hops: [] }));
  const planNeeds: PlanPlanNeed[] = solverNeeds.map((s) => ({ planKey: `plan_${s.solverKey}`, steps: ["invoke_solver", "render"], renderBindings: [] }));
  const intentNeeds: PlanIntentNeed[] = solverNeeds.map((s) => ({ intentKey: `intent_${s.solverKey}`, triggers: [s.solverKey], slots: [], planRef: `plan_${s.solverKey}`, riskLevel: "LOW" as const }));
  const sceneNeeds: PlanSceneNeed[] = solverNeeds.map((s) => ({ scenarioKey: `scene_${s.solverKey}`, targetView: SOLVER_TARGET_VIEW[s.solverKey] ?? "dash", intentKey: `intent_${s.solverKey}`, mode: "WORKFLOW" as const, presetContext: {} }));
  const workflowNeeds: PlanWorkflowNeed[] = solverNeeds.map((s) => ({ workflowKey: `wf_${s.solverKey}`, kind: "workflow", steps: ["invoke_solver", "render"] }));
  const skillNeeds: PlanSkillNeed[] = solverNeeds.map((s) => ({ skillKey: `skl_${s.solverKey}`, capability: s.solverKey, resources: [] }));
  const agentNeeds: PlanAgentNeed[] = solverNeeds.map((s) => ({ agentKey: `agt_${s.solverKey}`, systemPrompt: `针对 ${s.solverKey} 的推演分析 agent`, tools: [s.solverKey], skills: [`skl_${s.solverKey}`], ruleBindings: [], scopeObjectTypes: [...new Set(s.inputFields.map((f) => f.typeKey))] }));
  const kbDocs = [{ title: "场景脚本", content: script.slice(0, 4000) }];
  return { kbDocs, sliceNeeds, intentNeeds, planNeeds, sceneNeeds, workflowNeeds, skillNeeds, agentNeeds, mcpNeeds: [] };
}

/**
 * Comprehend 阶段：把故事脚本确定性地拆解为 build plan。
 * v1 采用确定性规则解析（关键词目录 + seed 播种行数），不依赖网络/LLM，
 * 保证同 (script, seed) 字节级一致；LLM 增强为后续可选层（设计共识见 memory）。
 */

type Field = { name: string; dataType: "string" | "number" | "boolean" | "date" | "enum" | "ref"; isPrimaryKey?: boolean; refToTypeKey?: string | null };

interface EntityTemplate {
  keywords: string[];
  typeKey: string;
  displayName: string;
  domain: string;
  connType: string;
  fields: Field[];
  baseRows: number;
}

interface RuleTemplate {
  keywords: string[];
  key: string;
  name: string;
  expression: string;
  scopeObjectTypes: string[];
  severity: "BLOCK" | "WARN" | "INFO";
}

interface SolverTemplate {
  keywords: string[];
  solverKey: string;
  inputFields: { typeKey: string; propKey: string }[];
}

// 锂电制造域实体目录（确定性、可扩展）。每个实体 = 一个数据源节点 + 一个对象类型。
const ENTITIES: EntityTemplate[] = [
  {
    keywords: ["订单", "order", "交付", "交期", "delivery"],
    typeKey: "Order",
    displayName: "订单",
    domain: "product",
    connType: "mock_crm",
    baseRows: 20,
    fields: [
      { name: "so", dataType: "string", isPrimaryKey: true },
      { name: "cust", dataType: "string" },
      { name: "model", dataType: "string" },
      { name: "qty", dataType: "number" },
      { name: "due", dataType: "date" },
      { name: "credit", dataType: "number" },
      { name: "demandDelta", dataType: "number" },
    ],
  },
  {
    keywords: ["基地", "工厂", "base", "plant", "产能", "capacity"],
    typeKey: "Base",
    displayName: "基地",
    domain: "factory",
    connType: "mock_erp",
    baseRows: 6,
    fields: [
      { name: "baseId", dataType: "string", isPrimaryKey: true },
      { name: "name", dataType: "string" },
      { name: "gwh", dataType: "number" },
      { name: "util", dataType: "number" },
    ],
  },
  {
    keywords: ["产线", "line", "排产", "利用率", "utilization"],
    typeKey: "Line",
    displayName: "产线",
    domain: "capacity",
    connType: "mock_erp",
    baseRows: 12,
    fields: [
      { name: "lineNo", dataType: "string", isPrimaryKey: true },
      { name: "baseId", dataType: "string", refToTypeKey: "Base" },
      { name: "utilization", dataType: "number" },
    ],
  },
  {
    keywords: ["客户", "customer", "信用", "credit"],
    typeKey: "Customer",
    displayName: "客户",
    domain: "people",
    connType: "mock_crm",
    baseRows: 10,
    fields: [
      { name: "custId", dataType: "string", isPrimaryKey: true },
      { name: "name", dataType: "string" },
      { name: "creditLimit", dataType: "number" },
    ],
  },
  {
    keywords: ["物料", "material", "采购", "齐套", "kit"],
    typeKey: "Material",
    displayName: "物料",
    domain: "process",
    connType: "mock_erp",
    baseRows: 15,
    fields: [
      { name: "matId", dataType: "string", isPrimaryKey: true },
      { name: "name", dataType: "string" },
      { name: "stockDays", dataType: "number" },
    ],
  },
];

const RULES: RuleTemplate[] = [
  { keywords: ["产能", "capacity", "上限"], key: "C03", name: "产能上限", expression: "Order.demandDelta <= 0.5", scopeObjectTypes: ["Order"], severity: "BLOCK" },
  { keywords: ["信用", "credit"], key: "C13", name: "信用额度", expression: "Order.credit <= Customer.creditLimit", scopeObjectTypes: ["Order"], severity: "BLOCK" },
  { keywords: ["利用率", "utilization", "告警"], key: "C05", name: "利用率持续告警", expression: "Line.utilization > 95", scopeObjectTypes: ["Line"], severity: "WARN" },
];

const SOLVERS: SolverTemplate[] = [
  { keywords: ["风险", "risk", "受影响", "affected"], solverKey: "affected_orders", inputFields: [{ typeKey: "Order", propKey: "due" }, { typeKey: "Order", propKey: "qty" }] },
  { keywords: ["产能", "capacity", "推演", "forecast"], solverKey: "capacity_forecast", inputFields: [{ typeKey: "Base", propKey: "gwh" }, { typeKey: "Base", propKey: "util" }] },
];

/**
 * 求解器 → 落点视图（区7 一键推演的目标页）：故事建出的场景该在哪个真实业务页被触发。
 * 视图键与 workspace 导航/场景目录一致（risk/project/audit/generate/dash/sop/quarter）。
 * 缺省 dash（驾驶舱）。这同时让 scaffold 出的 DRAFT 场景带真实 targetView（非空）。
 */
const SOLVER_TARGET_VIEW: Record<string, string> = {
  affected_orders: "risk",
  capacity_forecast: "project",
};

/**
 * g8-P6 存量回填：把既有"推演能力（求解器）"逆向导出为确定性故事脚本。
 * 用求解器关键词 + 其输入对象类型的关键词组句，保证 comprehend 重解析回同一全栈链
 * （场景→意图→计划→求解器），从而给每个存量推演场景补出可追溯血缘。programmatic，无写死脚本。
 */
export function deriveBackfillScripts(): { key: string; script: string }[] {
  return SOLVERS.map((s) => {
    const entityNames = [...new Set(s.inputFields.map((f) => ENTITIES.find((e) => e.typeKey === f.typeKey)?.keywords[0]).filter((x): x is string => !!x))];
    const verb = s.keywords[0] ?? s.solverKey;
    const script = `针对${entityNames.join("、")}做${verb}${verb.includes("推演") ? "" : "推演"}分析`;
    return { key: s.solverKey, script };
  });
}

/**
 * g8-P5 故事脚本自动生成器：从平台自有能力目录（求解器 + 规则）确定性派生候选故事脚本，
 * 供"持续自动输入"压测/探索。programmatic、无写死脚本、同环境字节级一致（R6）。
 * = 求解器能力覆盖（deriveBackfillScripts）⊕ 规则覆盖（每条约束一条探索脚本）。
 */
export function deriveGeneratedScripts(): { key: string; script: string }[] {
  const out = [...deriveBackfillScripts()];
  for (const r of RULES) {
    const entNames = [...new Set(r.scopeObjectTypes.map((t) => ENTITIES.find((e) => e.typeKey === t)?.keywords[0]).filter((x): x is string => !!x))];
    if (entNames.length === 0) continue;
    out.push({ key: `rule_${r.key}`, script: `检查${entNames.join("、")}的${r.keywords[0] ?? r.name}约束` });
  }
  return out;
}

/**
 * 区6③ 故事覆盖度（"没遗漏"的直接证据，确定性 R6）：把故事逐句与已建制品对账——
 * 每句若命中某实体/规则/求解器关键词且该制品确已在 plan 中建出 → mapped + refs；
 * 否则 mapped=false（"未理解/未建模"高亮），喂"切片缺失/超域"诊断与建模待办。
 * 复用 comprehend 同一关键词目录，故映射口径与建域一致（不另造一套启发式）。
 */
export interface CoverageSentence {
  text: string;
  mapped: boolean;
  refs: string[];
}
export function deriveStoryCoverage(
  script: string,
  plan?: Pick<BuildPlan, "objectTypes" | "rules" | "solverNeeds">,
): CoverageSentence[] {
  const sentences = script
    .split(/[。！？；;.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const planTypes = new Set((plan?.objectTypes ?? []).map((t) => t.typeKey));
  const planRules = new Set((plan?.rules ?? []).map((r) => r.key));
  const planSolvers = new Set((plan?.solverNeeds ?? []).map((s) => s.solverKey));
  return sentences.map((text) => {
    const refs: string[] = [];
    for (const e of ENTITIES) if (planTypes.has(e.typeKey) && matches(text, e.keywords)) refs.push(e.typeKey);
    for (const r of RULES) if (planRules.has(r.key) && matches(text, r.keywords)) refs.push(r.key);
    for (const s of SOLVERS) if (planSolvers.has(s.solverKey) && matches(text, s.keywords)) refs.push(s.solverKey);
    return { text, mapped: refs.length > 0, refs };
  });
}

/** 确定性 32-bit 哈希（用于 seed 派生行数，避免随机）。 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function matches(script: string, keywords: string[]): boolean {
  const lc = script.toLowerCase();
  return keywords.some((k) => lc.includes(k.toLowerCase()));
}

/** 解析脚本 → plan 主体（service 再补 id/tenantId/builderKey/createdAt）。 */
export function comprehendScript(
  script: string,
  seed: number,
): Pick<
  BuildPlan,
  | "dataSources" | "objectTypes" | "rules" | "solverNeeds" | "kbDocs"
  | "sliceNeeds" | "intentNeeds" | "planNeeds" | "workflowNeeds" | "skillNeeds" | "agentNeeds" | "mcpNeeds" | "sceneNeeds"
> {
  // 命中实体；无命中则兜底 Order + Base 最小集（保证 pipeline 永远可跑）。
  let entities = ENTITIES.filter((e) => matches(script, e.keywords));
  if (entities.length === 0) entities = ENTITIES.filter((e) => e.typeKey === "Order" || e.typeKey === "Base");

  const typeKeys = new Set(entities.map((e) => e.typeKey));

  const dataSources: PlanDataSource[] = entities.map((e) => {
    const rowCount = e.baseRows + (hashString(`${e.typeKey}|${seed}`) % 10);
    return {
      connType: e.connType,
      name: `${e.displayName}数据源`,
      datasetKey: e.typeKey.toLowerCase(),
      rowCount,
      fields: e.fields.map((f) => ({ name: f.name, dataType: f.dataType, consumedBy: [e.typeKey] })),
    };
  });

  const objectTypes: PlanObjectType[] = entities.map((e) => ({
    typeKey: e.typeKey,
    displayName: e.displayName,
    domain: e.domain,
    sourceDataset: e.typeKey.toLowerCase(),
    properties: e.fields.map((f) => ({
      propKey: f.name,
      sourceField: f.name,
      dataType: f.dataType,
      isPrimaryKey: f.isPrimaryKey ?? false,
      refToTypeKey: f.refToTypeKey ?? null,
    })),
  }));

  // 规则：命中关键词且其 scope 类型已在 plan 中（保证规则可落、可闭合）。
  const rules: PlanRule[] = RULES.filter(
    (r) => matches(script, r.keywords) && r.scopeObjectTypes.every((t) => typeKeys.has(t)),
  ).map((r) => ({ key: r.key, name: r.name, expression: r.expression, scopeObjectTypes: r.scopeObjectTypes, severity: r.severity }));

  // 求解器：命中关键词且其依赖类型已在 plan 中。
  const solverNeeds: PlanSolverNeed[] = SOLVERS.filter(
    (s) => matches(script, s.keywords) && s.inputFields.every((f) => typeKeys.has(f.typeKey)),
  ).map((s) => ({ solverKey: s.solverKey, inputFields: s.inputFields }));

  // 知识库：把脚本原文作为一篇知识文档灌入（可溯源）。
  const kbDocs = [{ title: "场景脚本", content: script.slice(0, 4000) }];

  // ---- B 栈倒推（g8-P3 故事→全栈）：每个求解器 → 计划+意图+场景；每个对象类型 → 切片。----
  // 构成可运行编排链 场景→意图→计划→求解器→渲染（scenarioClosure 校验的脊柱）。
  const sliceNeeds: PlanSliceNeed[] = objectTypes.map((t) => ({ sliceKey: `slice_${t.typeKey.toLowerCase()}`, rootType: t.typeKey, hops: [] }));
  const planNeeds: PlanPlanNeed[] = solverNeeds.map((s) => ({
    planKey: `plan_${s.solverKey}`,
    steps: ["invoke_solver", "render"],
    renderBindings: s.renderBindings ?? [],
  }));
  const intentNeeds: PlanIntentNeed[] = solverNeeds.map((s) => ({
    intentKey: `intent_${s.solverKey}`,
    triggers: [s.solverKey],
    slots: [],
    planRef: `plan_${s.solverKey}`,
    riskLevel: "LOW" as const,
  }));
  const sceneNeeds: PlanSceneNeed[] = solverNeeds.map((s) => ({
    scenarioKey: `scene_${s.solverKey}`,
    targetView: SOLVER_TARGET_VIEW[s.solverKey] ?? "dash",
    intentKey: `intent_${s.solverKey}`,
    mode: "WORKFLOW" as const,
    presetContext: {},
  }));
  // 债2：倒推扩到 workflow/skill/agent（每个求解器 → 工作流+技能+Agent），让 B 栈配置全可见。
  const workflowNeeds: PlanWorkflowNeed[] = solverNeeds.map((s) => ({
    workflowKey: `wf_${s.solverKey}`,
    kind: "workflow",
    steps: ["invoke_solver", "render"],
  }));
  const skillNeeds: PlanSkillNeed[] = solverNeeds.map((s) => ({
    skillKey: `skl_${s.solverKey}`,
    capability: s.solverKey,
    resources: [],
  }));
  const agentNeeds: PlanAgentNeed[] = solverNeeds.map((s) => ({
    agentKey: `agt_${s.solverKey}`,
    systemPrompt: `针对 ${s.solverKey} 的推演分析 agent（g8 故事倒推 scaffold）`,
    tools: [s.solverKey],
    skills: [`skl_${s.solverKey}`],
    ruleBindings: [],
    scopeObjectTypes: [...new Set(s.inputFields.map((f) => f.typeKey))],
  }));

  return {
    dataSources, objectTypes, rules, solverNeeds, kbDocs,
    sliceNeeds, intentNeeds, planNeeds, sceneNeeds,
    workflowNeeds, skillNeeds, agentNeeds, mcpNeeds: [],
  };
}
