import { z } from "zod";
import type {
  BuildPlan, PlanDataSource, PlanObjectType, PlanRule, PlanSolverNeed,
  PlanSliceNeed, PlanIntentNeed, PlanPlanNeed, PlanSceneNeed,
  PlanWorkflowNeed, PlanSkillNeed, PlanAgentNeed,
} from "@platform/contracts";
import { deriveSolverArgs } from "./solver-args.js";
import { DOMAIN_ROOT_REQUIREMENTS } from "./domain-invariants.js";

/**
 * §2 LLM comprehend：让 LLM 只产出"听懂故事"的难点部分——对象类型 / 规则 / 求解器需求；
 * 机械的 B 栈倒推（切片/意图/计划/场景/工作流/技能/Agent）仍由确定性 `assemblePlanBody` 完成。
 * 缺 LLM 绑定/失败时由 `comprehendScript` 关键词地板兜底（R6 字节级一致）。
 */
const StrictComprehendSchema = z.object({
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
  /**
   * §3.4 场景拓扑：数据模拟的核心——不是造类型对的随机行,而是构造"被问现象真实存在"的世界。
   * sharedResources：哪些上游对象(sharedByType)共享同一关键资源(resourceType,count 越小越挤)→ 制造瓶颈。
   * plantedValues：植入特定字段值(产能<需求 / 优先级低 / 越线)→ 让争用/降级真实可被求解器发现。
   */
  scenarioTopology: z.object({
    sharedResources: z.array(z.object({
      resourceType: z.string(), sharedByType: z.string(), viaField: z.string(), count: z.number().int().min(1).default(1),
    })).default([]),
    plantedValues: z.array(z.object({
      typeKey: z.string(), field: z.string(), value: z.union([z.number(), z.string()]), everyN: z.number().int().min(1).default(1),
    })).default([]),
  }).optional(),
});

/**
 * 容错归一（实测必要）：真 LLM（如 Kimi/Moonshot）即便给了 json_schema 也常用别名措辞——
 * name↔typeKey、type↔dataType、float/int→number、domain 放顶层、properties↔fields 等。
 * 在 zod 校验前把原始 LLM JSON 归一到严格形状，使结构化输出对模型措辞鲁棒（否则静默回落地板）。
 * 确定性纯函数（R6）。
 */
function normDataType(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  if (["float", "double", "int", "integer", "decimal", "long", "bigint", "money", "currency"].includes(s)) return "number";
  if (["datetime", "timestamp", "time"].includes(s)) return "date";
  if (["bool"].includes(s)) return "boolean";
  if (["reference", "fk", "foreign", "foreignkey", "relation", "link"].includes(s)) return "ref";
  if (["category", "categorical", "select"].includes(s)) return "enum";
  if (["str", "text", "varchar", "char", "uuid", "id"].includes(s)) return "string";
  return (["string", "number", "boolean", "date", "enum", "ref"] as const).includes(s as never) ? s : "string";
}
function asArr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}
function normalizeComprehend(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const topDomain = typeof r.domain === "string" ? r.domain : undefined;
  const objectTypes = asArr(r.objectTypes).map((o) => ({
    typeKey: o.typeKey ?? o.key ?? o.name ?? o.type,
    displayName: o.displayName ?? o.label ?? o.cnName ?? o.name ?? o.typeKey,
    domain: o.domain ?? topDomain ?? "general",
    fields: asArr(o.fields ?? o.properties).map((f) => ({
      name: f.name ?? f.propKey ?? f.key ?? f.field,
      dataType: normDataType(f.dataType ?? f.type),
      ...(f.isPrimaryKey != null ? { isPrimaryKey: !!f.isPrimaryKey } : {}),
      ...((f.refToTypeKey ?? f.ref ?? f.references) ? { refToTypeKey: f.refToTypeKey ?? f.ref ?? f.references } : {}),
    })),
  }));
  const rules = asArr(r.rules).map((x) => ({
    key: x.key ?? x.id ?? x.name,
    name: x.name ?? x.key,
    expression: x.expression ?? x.expr ?? x.dsl ?? x.condition ?? "",
    scopeObjectTypes: Array.isArray(x.scopeObjectTypes ?? x.scope) ? (x.scopeObjectTypes ?? x.scope) : [],
    severity: ["BLOCK", "WARN", "INFO"].includes(String(x.severity ?? "").toUpperCase()) ? String(x.severity).toUpperCase() : "WARN",
  }));
  const solverNeeds = asArr(r.solverNeeds).map((s) => ({
    solverKey: s.solverKey ?? s.key ?? s.solver,
    inputFields: asArr(s.inputFields).map((f) => ({ typeKey: f.typeKey ?? f.type, propKey: f.propKey ?? f.field ?? f.name })),
  }));
  return { objectTypes, rules, solverNeeds, ...(r.scenarioTopology ? { scenarioTopology: r.scenarioTopology } : {}) };
}

/** LLM comprehend 输出 schema（先归一后严格校验，对真 LLM 措辞鲁棒）。 */
export const LlmComprehendSchema = z.preprocess(normalizeComprehend, StrictComprehendSchema);
export type LlmComprehendOutput = z.infer<typeof LlmComprehendSchema>;
export type ScenarioTopology = NonNullable<LlmComprehendOutput["scenarioTopology"]>;

export const COMPREHEND_SYSTEM = [
  "你是制造业运营本体建模专家。把用户的业务故事/问题解析为推演所需的本体骨架。只输出一个 JSON 对象，字段名必须严格如下（不要改名）：",
  "{",
  '  "objectTypes": [ { "typeKey": "英文驼峰", "displayName": "中文名", "domain": "见下枚举", "fields": [ { "name": "字段名", "dataType": "string|number|boolean|date|enum|ref", "isPrimaryKey": true|false, "refToTypeKey": "指向的typeKey或null" } ] } ],',
  '  "rules": [ { "key": "R_XX", "name": "中文名", "expression": "DSL如 Order.demandDelta > 0.5", "scopeObjectTypes": ["typeKey"], "severity": "BLOCK|WARN|INFO" } ],',
  '  "solverNeeds": [ { "solverKey": "求解器键", "inputFields": [ { "typeKey": "typeKey", "propKey": "字段名" } ] } ]',
  "}",
  '硬性约束：用 "typeKey" 不要用 name；字段用 "dataType" 不要用 type；dataType 只能是 string/number/boolean/date/enum/ref（不要 float/int/text）；每个对象类型至少一个字段 isPrimaryKey=true；domain 取 factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external 之一。',
  "若问题涉及工序/设备瓶颈、排产降级、后果推演，应建 Process/Equipment 等对象类型并提出对应 solver（如 shared_bottleneck / margin_attribution / concentration_risk）。",
].join("\n");

/** 已注册求解器的语义提示（让 LLM 把意图映射到平台真实存在的 solverKey，而非自造名 → 减少 SOLVER_NOT_FOUND）。 */
export const SOLVER_HINTS: Record<string, string> = {
  capacity_forecast: "产能可行性/能否承接某需求/产能预测 P50P90",
  affected_orders: "受影响订单/某基地或事件影响哪些订单/交期风险传导(车型/数量/金额)",
  risk_timeline: "风险越线根因/时序定位某天为何越线",
  shared_bottleneck: "共享瓶颈/谁挤占谁/抢占在产项目/按优先级哪张单降级",
  margin_attribution: "毛利倒挂根因/利润损失归因/哪个成本项把毛利拉穿",
  concentration_risk: "隐性客户或供应商集中度/暗线单点",
  supplier_disruption_radius: "单一供应商断供影响半径",
  selection_optimize: "组合最优化/在预算约束下选最优子集",
  outsourcing_split: "外协vs自产分配/缺口怎么补",
  quote_margin: "接单毛利评审/这单毛利过线吗",
  credit_exposure: "客户信用敞口/还能接新单吗",
  quarterly_gap: "季度缺口对策组合",
  inventory_optimize: "库存超储欠储/释放资金",
  changeover_sequence: "换型排序优化/少换型",
  lta_gap: "长协覆盖与补缺",
  kit_readiness: "物料齐套/缺料开不了工",
  cert_schedule: "认证排期",
  maintenance_stagger: "检修窗口错峰",
  yield_diagnosis: "良率波动诊断",
  capex_scenario: "产能投资评审",
  carbon_footprint: "碳足迹核算",
  countermeasure_combo: "对策组合补缺口",
};

/**
 * LLM 自造求解器名 → 已注册 solverKey 的确定性别名表。
 * 提示工程（comprehendSystemWithSolvers）是软约束，思维型模型仍会偶发自造语义名；
 * 此表是硬兜底：在装配 plan 时把已知同义名收敛到平台真实存在的 key，使链路确定性闭合
 * （R6：不依赖 LLM 措辞，同 core 同输出），未命中者保留原样 → 作为自成长工单浮现。
 */
export const SOLVER_ALIASES: Record<string, string> = {
  // 产能可行性族
  capacity_feasibility: "capacity_forecast",
  feasibility_check: "capacity_forecast",
  capacity_check: "capacity_forecast",
  capacity_availability: "capacity_forecast",
  can_fulfill: "capacity_forecast",
  capacity_p50p90: "capacity_forecast",
  // 受影响订单/交期传导族
  schedule_impact: "affected_orders",
  delivery_impact: "affected_orders",
  affected_customers: "affected_orders",
  order_impact: "affected_orders",
  impacted_orders: "affected_orders",
  customer_impact: "affected_orders",
  // 挤占/抢占族
  displacement: "shared_bottleneck",
  preemption: "shared_bottleneck",
  capacity_contention: "shared_bottleneck",
  resource_contention: "shared_bottleneck",
  priority_displacement: "shared_bottleneck",
  // 利润损失/毛利归因族
  profit_loss: "margin_attribution",
  margin_loss: "margin_attribution",
  profit_impact: "margin_attribution",
  margin_erosion: "margin_attribution",
  // 集中度族
  concentration: "concentration_risk",
  customer_concentration: "concentration_risk",
};

/** 把可能自造的 solverKey 收敛到已注册 key：先查别名表，命中且目标已注册→替换；否则原样。 */
export function normalizeSolverKey(key: string, registeredKeys?: readonly string[]): string {
  const aliased = SOLVER_ALIASES[key];
  if (aliased && (!registeredKeys || registeredKeys.includes(aliased))) return aliased;
  return key;
}

/** 把已注册求解器目录拼进 comprehend 系统提示——LLM 的 solverKey 必须优先从中选语义最贴近的一个。 */
export function comprehendSystemWithSolvers(registeredKeys: readonly string[]): string {
  const catalog = registeredKeys.map((k) => `- ${k}${SOLVER_HINTS[k] ? "：" + SOLVER_HINTS[k] : ""}`).join("\n");
  return (
    COMPREHEND_SYSTEM +
    "\n\n【已注册求解器目录】solverNeeds[].solverKey **必须优先从下表选语义最贴近的现有 key**（如'能否满足产能'→capacity_forecast、'挤占哪些项目'→shared_bottleneck、'影响哪些客户/订单'→affected_orders、'利润损失'→margin_attribution）；只有确实没有任何贴近项时才用新 key（新 key 将作为自成长工单，不要轻易新造）：\n" +
    catalog
  );
}

/** 由 LLM 产出的核心三件 → 装配完整 plan body（确定性 B 栈倒推，复用与关键词地板同一口径）。 */
export function assemblePlanBody(
  core: LlmComprehendOutput,
  script: string,
  seed: number,
  registeredSolverKeys?: readonly string[],
): ReturnType<typeof comprehendScript> & { scenarioTopology?: ScenarioTopology } {
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
  const solverNeeds: PlanSolverNeed[] = core.solverNeeds
    .filter((s) => s.inputFields.every((f) => typeKeys.has(f.typeKey)))
    // 自造求解器名 → 已注册 key 的确定性收敛（修 SOLVER_NOT_FOUND，使链路闭合不依赖 LLM 措辞）。
    .map((s) => ({ ...s, solverKey: normalizeSolverKey(s.solverKey, registeredSolverKeys) }))
    // FDE 自动倒推求解器参数（多跳路径/字段映射）→ 贯通到启动器使"点一下出答案"成立。
    .map((s) => ({ ...s, args: deriveSolverArgs(s.solverKey, objectTypes) }));
  return { dataSources, objectTypes, rules, solverNeeds, ...deriveBStack(objectTypes, solverNeeds, script), scenarioTopology: core.scenarioTopology };
}

/** B 栈倒推（确定性）：对象→切片；求解器→计划/意图/场景/工作流/技能/Agent。LLM 与关键词地板共用。 */
function deriveBStack(objectTypes: PlanObjectType[], solverNeeds: PlanSolverNeed[], script: string) {
  const sliceNeeds: PlanSliceNeed[] = objectTypes.map((t) => ({ sliceKey: `slice_${t.typeKey.toLowerCase()}`, rootType: t.typeKey, hops: [] }));
  const planNeeds: PlanPlanNeed[] = solverNeeds.map((s) => ({ planKey: `plan_${s.solverKey}`, steps: ["invoke_solver", "render"], solverKey: s.solverKey, args: s.args ?? {}, renderBindings: [] }));
  const intentNeeds: PlanIntentNeed[] = solverNeeds.map((s) => ({ intentKey: `intent_${s.solverKey}`, triggers: [s.solverKey], slots: [], planRef: `plan_${s.solverKey}`, riskLevel: "LOW" as const }));
  const sceneNeeds: PlanSceneNeed[] = solverNeeds.map((s) => ({ scenarioKey: `scene_${s.solverKey}`, targetView: SOLVER_TARGET_VIEW[s.solverKey] ?? "dash", intentKey: `intent_${s.solverKey}`, mode: "WORKFLOW" as const, presetContext: {}, triggerQuestion: script.trim().slice(0, 500) }));
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
      // A2：订单经哪道工序 + 优先级（共享瓶颈/降级倒推）+ 营收/成本（毛利倒挂倒推）。
      { name: "procRef", dataType: "ref", refToTypeKey: "Process" },
      { name: "prio", dataType: "number" },
      { name: "revenue", dataType: "number" },
      { name: "rawCost", dataType: "number" },
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
  // A2：地板听懂"工序/瓶颈/降级/挤占"——共享瓶颈倒推的资源类型（有产能字段）。
  {
    keywords: ["工序", "process", "瓶颈", "bottleneck", "化成", "卷绕", "降级", "挤占"],
    typeKey: "Process",
    displayName: "工序",
    domain: "process",
    connType: "mock_erp",
    baseRows: 8,
    fields: [
      { name: "procId", dataType: "string", isPrimaryKey: true },
      { name: "name", dataType: "string" },
      { name: "capacity", dataType: "number" },
    ],
  },
  // A2：地板听懂"设备/机台"——引用工序（断供/扇出可达）。
  {
    keywords: ["设备", "equipment", "机台"],
    typeKey: "Equipment",
    displayName: "设备",
    domain: "equip",
    connType: "mock_erp",
    baseRows: 12,
    fields: [
      { name: "equipId", dataType: "string", isPrimaryKey: true },
      { name: "name", dataType: "string" },
      { name: "procRef", dataType: "ref", refToTypeKey: "Process" },
    ],
  },
];

/**
 * E14 域树补全（确定性纯函数 R6，数据驱动 RL5）：选中的运营域实体（domain ∈ DOMAIN_ROOT_REQUIREMENTS）
 * 必须能溯源到对应 factory 根域实体，否则倒推出无根碎片树。补全两步：
 *  1) 缺根 → 从 ENTITIES 拉入该根域的根实体（factory 域 = Base）；
 *  2) 无根运营实体补一条到根实体的结构 ref（字段 `{root}Ref`），使 ref 链可达根（域完整）。
 * 仅用 domain 词表（无实体/行业常数）；ENTITIES 无对应根实体时**不硬造**（留 closure 诚实报 ORPHAN_NO_ROOT）。
 */
function completeDomainTree(selected: EntityTemplate[]): EntityTemplate[] {
  const present = new Map(selected.map((e) => [e.typeKey, e]));
  const presentDomains = new Set(selected.map((e) => e.domain));
  const result = [...selected];

  // 收集所需根域（去重，确定性排序）。
  const neededRootDomains = new Set<string>();
  for (const e of selected) {
    for (const rd of DOMAIN_ROOT_REQUIREMENTS[e.domain] ?? []) neededRootDomains.add(rd);
  }
  for (const rootDomain of [...neededRootDomains].sort()) {
    if (presentDomains.has(rootDomain)) continue; // 已有该根域实体
    const root = ENTITIES.find((e) => e.domain === rootDomain);
    if (!root) continue; // 无候选根实体 → 不硬造，留闭包诚实报无根
    result.push(root);
    present.set(root.typeKey, root);
    presentDomains.add(rootDomain);
  }

  // 对每个无根运营实体补一条到其根域实体的 ref（若它本身或经现有 ref 还到不了根）。
  const rootByDomain = new Map<string, string>();
  for (const e of result) if (!rootByDomain.has(e.domain)) rootByDomain.set(e.domain, e.typeKey);
  return result.map((e) => {
    const rootDomains = DOMAIN_ROOT_REQUIREMENTS[e.domain];
    if (!rootDomains || rootDomains.length === 0) return e;
    // 已有指向某根域实体的 ref？（直接相邻即可，多跳由 closure BFS 处理）
    const hasRootRef = e.fields.some((f) => {
      const tgt = f.refToTypeKey ? present.get(f.refToTypeKey) : undefined;
      return tgt && rootDomains.includes(tgt.domain);
    });
    // 或经其他运营实体间接可达（如 Equipment→Process→Base）：若同 plan 有指向的运营实体已挂根则不重复补。
    if (hasRootRef) return e;
    const rootDomain = rootDomains.find((rd) => rootByDomain.has(rd));
    if (!rootDomain) return e; // 根实体未补成（无候选）→ 留诚实报
    const rootTypeKey = rootByDomain.get(rootDomain)!;
    if (rootTypeKey === e.typeKey) return e;
    const refName = `${rootTypeKey.toLowerCase()}Ref`;
    if (e.fields.some((f) => f.name === refName)) return e;
    return { ...e, fields: [...e.fields, { name: refName, dataType: "ref" as const, refToTypeKey: rootTypeKey }] };
  });
}

const RULES: RuleTemplate[] = [
  { keywords: ["产能", "capacity", "上限"], key: "C03", name: "产能上限", expression: "Order.demandDelta <= 0.5", scopeObjectTypes: ["Order"], severity: "BLOCK" },
  { keywords: ["信用", "credit"], key: "C13", name: "信用额度", expression: "Order.credit <= Customer.creditLimit", scopeObjectTypes: ["Order"], severity: "BLOCK" },
  { keywords: ["利用率", "utilization", "告警"], key: "C05", name: "利用率持续告警", expression: "Line.utilization > 95", scopeObjectTypes: ["Line"], severity: "WARN" },
];

const SOLVERS: SolverTemplate[] = [
  { keywords: ["风险", "risk", "受影响", "affected"], solverKey: "affected_orders", inputFields: [{ typeKey: "Order", propKey: "due" }, { typeKey: "Order", propKey: "qty" }] },
  { keywords: ["产能", "capacity", "推演", "forecast"], solverKey: "capacity_forecast", inputFields: [{ typeKey: "Base", propKey: "gwh" }, { typeKey: "Base", propKey: "util" }] },
  // A2：新求解器进地板（参数由 deriveSolverArgs 据对象结构自动倒推；inputFields 要求的实体须被识别才选中）。
  { keywords: ["瓶颈", "bottleneck", "共享", "挤占", "降级"], solverKey: "shared_bottleneck", inputFields: [{ typeKey: "Process", propKey: "capacity" }, { typeKey: "Order", propKey: "qty" }] },
  { keywords: ["毛利", "倒挂", "margin", "成本", "亏损"], solverKey: "margin_attribution", inputFields: [{ typeKey: "Order", propKey: "revenue" }, { typeKey: "Order", propKey: "rawCost" }] },
];

/**
 * 求解器 → 落点视图（区7 一键推演的目标页）：故事建出的场景该在哪个真实业务页被触发。
 * 视图键与 workspace 导航/场景目录一致（risk/project/audit/generate/dash/sop/quarter）。
 * 缺省 dash（驾驶舱）。这同时让 scaffold 出的 DRAFT 场景带真实 targetView（非空）。
 */
const SOLVER_TARGET_VIEW: Record<string, string> = {
  affected_orders: "risk",
  capacity_forecast: "project",
  // A2：新求解器落点（推演与风险页）。
  shared_bottleneck: "risk",
  concentration_risk: "risk",
  supplier_disruption_radius: "risk",
  margin_attribution: "risk",
  selection_optimize: "project",
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

  // E14 域树补全（确定性 R6，数据驱动 RL5）：选中运营域实体（process/equip/capacity）但缺 factory 根
  // → 倒推会产**无根碎片**（孤儿 Process 无 factory 根，闭包 DOMAIN_INVARIANT_VIOLATION）。这里**自动补根**：
  // 拉入 factory 根实体（Base）并给无根运营实体补一条到根的结构 ref，使倒推出的对象树**域完整**（非静默残缺）。
  entities = completeDomainTree(entities);

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
  ).map((s) => ({ solverKey: s.solverKey, inputFields: s.inputFields, args: deriveSolverArgs(s.solverKey, objectTypes) }));

  // 知识库：把脚本原文作为一篇知识文档灌入（可溯源）。
  const kbDocs = [{ title: "场景脚本", content: script.slice(0, 4000) }];

  // ---- B 栈倒推（g8-P3 故事→全栈）：每个求解器 → 计划+意图+场景；每个对象类型 → 切片。----
  // 构成可运行编排链 场景→意图→计划→求解器→渲染（scenarioClosure 校验的脊柱）。
  const sliceNeeds: PlanSliceNeed[] = objectTypes.map((t) => ({ sliceKey: `slice_${t.typeKey.toLowerCase()}`, rootType: t.typeKey, hops: [] }));
  const planNeeds: PlanPlanNeed[] = solverNeeds.map((s) => ({
    planKey: `plan_${s.solverKey}`,
    steps: ["invoke_solver", "render"],
    solverKey: s.solverKey,
    args: s.args ?? {},
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
    triggerQuestion: script.trim().slice(0, 500), // E15：DRAFT 场景带触发问句（故事即问句）→ 可 grow/verify
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
