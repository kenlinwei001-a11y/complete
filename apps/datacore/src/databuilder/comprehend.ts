import type {
  BuildPlan, PlanDataSource, PlanObjectType, PlanRule, PlanSolverNeed,
  PlanSliceNeed, PlanIntentNeed, PlanPlanNeed, PlanSceneNeed,
} from "@platform/contracts";

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
    targetView: "",
    intentKey: `intent_${s.solverKey}`,
    mode: "WORKFLOW" as const,
    presetContext: {},
  }));

  return {
    dataSources, objectTypes, rules, solverNeeds, kbDocs,
    sliceNeeds, intentNeeds, planNeeds, sceneNeeds,
    workflowNeeds: [], skillNeeds: [], agentNeeds: [], mcpNeeds: [],
  };
}
