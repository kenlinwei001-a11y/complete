import { z } from "zod";
import { IsoTime, JsonSchemaObject } from "./common.js";
import { ValidationPolicySchema } from "./output-validation.js";

// ---------------------------------------------------------------------------
// 平台 PRD §2 A1 连接器
// ---------------------------------------------------------------------------

export const ConnectorTypeSchema = z.object({
  key: z.string(), // sap_erp / salesforce_crm / generic_jdbc / rest_api / knowledge_base / external_feed / file_upload / prototype_html / mock_erp / mock_crm
  category: z.enum(["ERP", "CRM", "KB", "EXTERNAL", "FILE", "PROTOTYPE"]),
  configSchema: JsonSchemaObject,
  capabilities: z.object({
    batch: z.boolean(),
    incremental: z.boolean(),
    schemaDiscovery: z.boolean(),
  }),
});
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;

export const ConnectionInstanceSchema = z.object({
  id: z.string(), // conn_
  tenantId: z.string(),
  connectorTypeKey: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
  schedule: z.object({ cron: z.string() }).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "ERROR"]),
  lastSyncAt: IsoTime.optional(),
  lastError: z.string().optional(),
  /** A11 per-connection 归类：实例级来源系统类（默认取连接器类型 category，可覆盖、可自定义值 R14）。 */
  category: z.string().optional(),
  /** 约束执行层（可配置,按租户）：该源导入数据的本体校验策略 + 字段映射。 */
  validationPolicy: ValidationPolicySchema.optional(),
});
export type ConnectionInstance = z.infer<typeof ConnectionInstanceSchema>;

export const FieldProfileSchema = z.object({
  name: z.string(),
  inferredType: z.enum(["string", "number", "boolean", "date", "json"]),
  samples: z.array(z.unknown()),
  nullRate: z.number(),
  uniqueRate: z.number(),
  enumCandidates: z.array(z.string()).optional(),
  /** DF.5 语义目录：列业务语义描述（"这列是什么"），喂生成接地 prompt + /catalog/search 检索。 */
  description: z.string().optional(),
});
export type FieldProfile = z.infer<typeof FieldProfileSchema>;

export const SourceSchemaSchema = z.object({
  datasets: z.array(
    z.object({
      name: z.string(),
      fields: z.array(FieldProfileSchema),
      /** A8.1：ENTITY（缺省）| TIMESERIES——时序数据集不落 raw_datasets、不参与 materialize */
      kind: z.enum(["ENTITY", "TIMESERIES"]).optional(),
      timeField: z.string().optional(),
      entityRefField: z.string().optional(),
    }),
  ),
});
export type SourceSchema = z.infer<typeof SourceSchemaSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §3 A2 规则文档解析
// ---------------------------------------------------------------------------

export const CandidateRuleSchema = z.object({
  name: z.string(),
  description: z.string(),
  expression: z.string(),
  expressionConfidence: z.number(),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  sourceQuote: z.string(),
});
export type CandidateRule = z.infer<typeof CandidateRuleSchema>;

export const RuleDocStatusSchema = z.enum([
  "UPLOADED",
  "PARSED",
  "EXTRACTED",
  "IN_REVIEW",
  "PUBLISHED",
  "REJECTED",
]);

export const RuleOriginSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("DOCUMENT"),
    docId: z.string(),
    span: z.object({ start: z.number(), end: z.number() }),
    extractJobId: z.string(),
  }),
  z.object({ type: z.literal("MANUAL") }),
  z.object({ type: z.literal("SYNTHETIC") }),
]);
export type RuleOrigin = z.infer<typeof RuleOriginSchema>;

/** A5 规则库条目 */
export const RuleEntrySchema = z.object({
  id: z.string(),
  key: z.string(), // 如 C03
  name: z.string(),
  expression: z.string(),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  // 规则即引用（PRD-rules-as-references §2.2/§4）：命名阈值（求解器读 rule.params 而非硬编码）。
  // 改 param 即改推演（P2 求解器接入后，全 7 入口随之变）。可编辑、随规则版本（R6）。可选（旧规则无）。
  // A3-SUITE-1：params 同时承载切片契约字符串数组（mustIncludeTypes / mustIncludeLinkKeys），
  // 保持单一 RuleEntry 一等实体，不改 PropagationRule 的数值读取路径（冷启动 fallback）。
  params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])).optional(),
  // WO-RULES-CLASSIFY（加性·向后兼容）：规则业务类别（如 产能/物料/财务/合规/换型…）。规则库按此可筛选；
  // 单一来源=场景包 rule 元数据（种子/文档抽取时随规则一并授予，前端只读渲染 chip，非写死清单）。旧规则/手工规则可空 → 前端归「未分类」。
  category: z.string().optional(),
  origin: RuleOriginSchema,
  version: z.number().int(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
});
export type RuleEntry = z.infer<typeof RuleEntrySchema>;

/**
 * 规则即引用（PRD-rules-as-references §4/附录B）：每个求解器声明它引用哪些规则（ruleKey）。
 * 单一来源——门 `rule-closure:check` 据此校验「⋃ 引用 ⊆ 已发布规则定义」，杜绝"未找到定义"回潮。
 * （sop_balance 是工作流非求解器，其规则引用由 sop 工作流声明，不在此表。）
 */
export const SOLVER_RULE_REFS: Record<string, string[]> = {
  capacity_forecast: ["C01", "C02", "C03", "C09"],
  affected_orders: ["C05"],
  risk_timeline: ["C06", "C11"],
  plan_audit: ["C15", "C16", "C18", "C21", "C23"],
  plan_generate: ["C08", "C15", "C18"],
  mitigation_select: ["C08", "C10"],
  cert_schedule: ["C04", "C26"],
  kit_readiness: ["C06", "C16"],
  lta_gap: ["C16", "C27"],
  inventory_optimize: ["C16", "C28"],
  changeover_sequence: ["C22", "C29"],
  yield_diagnosis: ["C30"],
  maintenance_stagger: ["C11"],
  outsourcing_split: ["C08", "C31"],
  quote_margin: ["C15", "C24"],
  credit_exposure: ["C13", "C32"],
  capex_scenario: ["C18", "C23"],
  quarterly_gap: ["C08", "C29"],
  carbon_footprint: ["C33"],
};

/**
 * 规则即引用 **P4 · 数值维**（G-10 §8 残口）：`rule.params` → `solver_params` **路径绑定**。
 *
 * 病根（P1/P2 未闭的那一半）：P2 让求解器**评估**规则（`evaluatedRules` 真 PASS/WARN/BLOCK），但求解器
 * **算数用的系数/阈值**仍读 `solver_params` 里自己那份**同值字面量**——同一业务阈值在「规则种子」与
 * 「SolverParam 种子」各存一份（如 C04 `pendingCertFactor:0.6` ↔ `certFactors.认证中:0.6`；
 * C09 `staleHours:2/degradedFactor:0.9` ↔ `health.staleHours:2/health.degraded:0.9`）。
 * 门守的是 SolverParam 那份、规则那份**没人读** = **诱饵**：下一个人去改规则种子，以为改了推演。
 *
 * 本表把二者接成 **单源(rule.params) → 派生(solver_params)**：规则发布时按本表投影（`RulesService`），
 * 于是「改规则定义、不改任何代码 → 求解器输出真的变」。**不许并存**：场景包侧的 solver_params 种子值
 * 必须从同一条规则派生（见 `apps/datacore/src/synthetic/battery.ts` `ruleParamOf()`），不再各写一份。
 *
 * 与 `SOLVER_RULE_REFS` 的分工：那张表管**哪些规则被哪个求解器评估**（布尔闸），本表管**规则的命名阈值
 * 喂到哪个数值参数**（连续量）。两张表都在 contracts = 引用关系的单一来源。
 */
/**
 * 规则 DSL 里引用**本规则命名阈值**的命名空间（`params.<阈值名>`）。
 *
 * 为什么要有它（G-C08-EXPR-PARAM-SPLIT 的病根）：在此之前 DSL **只能写字面量**，于是同一个业务阈值
 * 在一条规则上被写了**两遍**——一遍在 `expression` 字符串里（规则引擎判定用），一遍在 `params` 里
 * （`RULE_PARAM_BINDINGS` 投影进 solver_params，求解器算数用）。二者可各自编辑、谁也不校验谁：
 * 管理员在界面上把 `params.cashFloor` 从 50 改成 60，求解器立刻按 60 算，而**同一条规则的判定**
 * 仍按 expression 里那个 50 走 —— 一条规则的"评估维"和"数值维"各说各话，且四包测试全绿。
 *
 * 有了 `params.` 前缀后，阈值**只写在 params 里一处**，expression 引用它：
 *   `AnnualScenario.cashCushion < params.cashFloor`
 * 改 params 即同时改判定与算数，结构上不可能再分叉。
 *
 * ⚠ 刻意是**独立操作数种类**（不是字段路径）：字段解析 `resolveField` 带"前缀可省"的回退
 * （`Order.qty` 解不出就试 `qty`），若把 `params.cashFloor` 当字段，解不出时会**静默回退**到
 * 载荷顶层的 `cashFloor` —— 那正是"看着合理的默认值"式静默兜底。故 params 引用只从 `rule.params`
 * 解析，取不到即**报错**（诚实缺席），绝不回退。
 */
export const RULE_PARAM_NAMESPACE = "params";

/** 构造规则 DSL 的命名阈值引用（`cashFloor` → `params.cashFloor`）。禁手写前缀。 */
export function ruleParamRef(param: string): string {
  return `${RULE_PARAM_NAMESPACE}.${param}`;
}

/**
 * 一个被绑定的 param 在**规则自己的判定**里扮演什么角色 —— 决定它是否**必须**被 expression 引用。
 *
 * 为什么必须显式登记（不能靠猜，也不能一刀切）：
 *  · `threshold`（阈值）—— 规则判定的比较对象，如 C18 现金底线、C09 时延上限。这类 param 若**不**被
 *    expression 引用，就意味着同一个业务数在这条规则上又有了第二份（expression 里的字面量），
 *    于是「改 params 改了推演、规则判定纹丝不动」的 G-C08-EXPR-PARAM-SPLIT 立刻复发。故**强制引用**。
 *  · `coefficient`（系数）—— 只喂求解器算数、不参与本规则判定，如 C04 认证降额系数、C09 降级后系数。
 *    这类 param 在 expression 里**本来就不该出现**；一刀切要求引用只会逼出一个假阈值。
 *
 * 一刀切两个方向都会错，所以角色写进契约、由 `assertBoundThresholdsReferenced` 在发布闸上强制。
 */
export type RuleParamRole = "threshold" | "coefficient";

export interface RuleParamBinding {
  /** 规则码（如 C09）。 */
  ruleKey: string;
  /** `rule.params` 内的命名阈值键。 */
  param: string;
  /** `solver_params` 内的点分路径（段可含中文枚举键，如 `certFactors.认证中`）。 */
  path: string;
  /** 该 param 是否参与本规则判定（决定 expression 是否必须引用它）。 */
  role: RuleParamRole;
  /** 人读补注：这个阈值在推演里怎么用。 */
  note: string;
}

export const RULE_PARAM_BINDINGS: readonly RuleParamBinding[] = [
  // C04 两个 param 都是**系数**：它的 expression 是分类谓词（认证状态≠量产），里面没有可参数化的
  // 数值阈值。硬要求引用只会造出一个假阈值 —— 这条规则本来就没有 EXPR-PARAM-SPLIT 那个病。
  { ruleKey: "C04", param: "productionFactor", path: "certFactors.量产", role: "coefficient", note: "量产认证产线产能计入系数（capacity_forecast/capex/sop/planviews 逐基地乘）" },
  { ruleKey: "C04", param: "pendingCertFactor", path: "certFactors.认证中", role: "coefficient", note: "认证中产线降额系数——C04「仅认证产线计入产能」的数值面" },
  { ruleKey: "C09", param: "staleHours", path: "health.staleHours", role: "threshold", note: "关键数据源新鲜度延迟阈值（h）：超过即触发 P90 临时降级" },
  { ruleKey: "C09", param: "degradedFactor", path: "health.degraded", role: "coefficient", note: "降级后的 P90 系数（正常系数 health.normal 归 M11 校准 p90_health，不由规则声明）" },
  { ruleKey: "C18", param: "cashFloor", path: "sop.cashFloor", role: "threshold", note: "现金垫底线（亿）：S&OP 版本校验 s4 的 cashOk 判据" },
  { ruleKey: "C18", param: "cashFloor", path: "planGenerate.targets.cashFloor", role: "threshold", note: "同一条 C18 的另一个消费口径（plan_generate 硬约束 hardViol='C18'）——两处必须同源，否则同一条规则的两个消费方各说各话" },
  { ruleKey: "C21", param: "balanceDeviationPct", path: "sop.dvThreshold", role: "threshold", note: "产销平衡偏差阈值（比率）：S&OP 偏差判定" },
  // WO-RULE-EXPR-PARAMS：补上 `battery.ts` C08 注释里预告了却一直没接的那一行。此前
  // `C08.params.outsourceRatioMax` **全仓零消费方**（只在注释里被提到）= 纯诱饵：改它一个数都不动。
  // 接上后 `whatIf.outsourceMax`（capacity.ts what-if 触红线拒绝判定真读的那个数）成为 C08 的派生副本。
  { ruleKey: "C08", param: "outsourceRatioMax", path: "whatIf.outsourceMax", role: "threshold", note: "外协比例红线（比率 0–1）：what-if 触红线拒绝判定的上限（capacity.ts）" },
] as const;

/**
 * 发布闸的**反向**校验（`assertValidExpression` 只查正向：引用的阈值都已声明）。
 *
 * 反向缺口是 `G-C08-EXPR-PARAM-SPLIT` 在**运行期**的残余面，§8 原文点了名：
 * 「静态门看不见——门是源码扫描，看不到运行时规则记录」。种子期 `battery.ts` 已单源，但管理员在
 * 规则编辑器里把 C18 的 `< params.cashFloor` 改回 `< 50` 再发布，**今天照样通过**：
 * 正向校验只问「引用的都声明了吗」，`< 50` 一个引用都没有 ⇒ 恒过。于是阈值又变回两份
 * （expression 里的 50 与 params.cashFloor），求解器按 params 算、规则判定按 50 走 —— 病灶原地复发。
 *
 * 本函数把那道门补上：凡 `RULE_PARAM_BINDINGS` 里登记为 `threshold` 的 param，只要这条规则**声明了它**
 * （数值），expression 就**必须引用** `params.<名>`。返回缺失的引用清单（空 = 通过）。
 *
 * 诚实边界：只管**被绑定**的 param（即真有第二个消费方、真会分叉的那些）。未绑定规则的阈值写在
 * expression 里是**单源**（没有第二份），不在本门管辖范围 —— 一刀切会逼所有规则长出假 params。
 *
 * @param referencedParams expression 里实际出现的 `params.<名>` 集合（由调用方用 DSL 解析器提供，
 *        不在此处做字符串匹配 —— 注释/字符串字面量里的 `params.x` 不算引用）。
 */
export function missingBoundThresholdRefs(
  ruleKey: string,
  declaredParams: Record<string, unknown> | undefined,
  referencedParams: ReadonlySet<string>,
  bindings: readonly RuleParamBinding[] = RULE_PARAM_BINDINGS,
): string[] {
  const missing = new Set<string>();
  for (const b of bindings) {
    if (b.ruleKey !== ruleKey || b.role !== "threshold") continue;
    const declared = declaredParams?.[b.param];
    // 没声明这个阈值 → 本规则没打算用它，不强求（声明了才有分叉的可能）。
    if (typeof declared !== "number" || !Number.isFinite(declared)) continue;
    if (!referencedParams.has(b.param)) missing.add(b.param);
  }
  return [...missing].sort();
}

/** 一次投影里被规则改写的一个数值参数。 */
export interface RuleParamChange {
  ruleKey: string;
  param: string;
  path: string;
  from: unknown;
  to: number;
}

function ruleParamPathParent(params: Record<string, unknown>, path: string): Record<string, unknown> | undefined {
  const segs = path.split(".");
  let cur: unknown = params;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segs[i] as string];
  }
  return cur != null && typeof cur === "object" ? (cur as Record<string, unknown>) : undefined;
}

/**
 * 纯函数（R6 确定性·无时钟/随机）：把已发布规则的命名阈值按 `RULE_PARAM_BINDINGS` 投影到一份
 * solver_params 上，返回**新对象**（不改入参）+ 变更清单。
 *
 * 诚实边界（三条守则，缺一即会写坏别的租户/别的参数）：
 *  1. **只写声明过的路径**——不在本表的 solver_params 一律不碰。
 *  2. **父容器不存在则跳过**（R14 行业无关）：非本场景包租户的 solver_params 没有 `certFactors`/`health`
 *     这些容器时，投影是 no-op，绝不凭空造参数结构。
 *  3. **非有限数跳过**（`params` 契约允许 string/string[]，那些不是数值阈值）——不把非数写进推演参数。
 */
export function applyRuleParamBindings(
  solverParams: Record<string, unknown>,
  rules: readonly { key: string; status?: string; params?: Record<string, number | string | string[]> | undefined }[],
  bindings: readonly RuleParamBinding[] = RULE_PARAM_BINDINGS,
): { params: Record<string, unknown>; changes: RuleParamChange[] } {
  // 路径写时复制（不 structuredClone：contracts 只挂 lib ES2022，且深克隆会把非 JSON 值弄坏）——
  // 只沿被改写的路径复制容器，其余子树与入参共享引用，入参本身一字不动。
  const next: Record<string, unknown> = { ...solverParams };
  const copied = new Set<Record<string, unknown>>([next]);
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const changes: RuleParamChange[] = [];
  for (const b of bindings) {
    const rule = byKey.get(b.ruleKey);
    const raw = rule?.params?.[b.param];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const parent = ruleParamPathParent(next, b.path);
    if (!parent) continue;
    const segs = b.path.split(".");
    const leaf = segs[segs.length - 1] as string;
    const from = parent[leaf];
    if (from === raw) continue;
    let cur = next;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i] as string;
      let child = cur[seg] as Record<string, unknown>;
      if (!copied.has(child)) {
        child = { ...child };
        copied.add(child);
        cur[seg] = child;
      }
      cur = child;
    }
    cur[leaf] = raw;
    changes.push({ ruleKey: b.ruleKey, param: b.param, path: b.path, from, to: raw });
  }
  return { params: next, changes };
}

/**
 * 规则即引用（PRD-rules-as-references §4）：求解器透出**真评估结果**（关联规则面板显 PASS/WARN/BLOCK，
 * 非装饰标签）。NOT_APPLICABLE = 该规则字段不在本求解器可见 payload（诚实标，不冒充通过）。
 */
export const EvaluatedRuleSchema = z.object({
  key: z.string(),
  name: z.string(),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  outcome: z.enum(["PASS", "WARN", "BLOCK", "NOT_APPLICABLE"]),
  expression: z.string(),
  evidence: z.string().optional(),
});
export type EvaluatedRule = z.infer<typeof EvaluatedRuleSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §5 A3 半自动本体建模
// ---------------------------------------------------------------------------

export const ModelingSuggestionSchema = z.object({
  objectTypes: z.array(
    z.object({
      action: z.enum(["CREATE", "MAP_TO_EXISTING"]),
      existingTypeKey: z.string().nullable(),
      typeKey: z.string(),
      displayName: z.string(),
      /** 治理增量 §1：归域强制（LLM 建议域归属；无法判断 → "unassigned"，发布阻断）。 */
      domain: z.string().default("unassigned"),
      sourceDataset: z.string(),
      properties: z.array(
        z.object({
          propKey: z.string(),
          sourceField: z.string(),
          // json：与 PropertyDef 对齐，使建模链能忠实表达数组/对象型属性（如 Model.bases）。
          dataType: z.enum(["string", "number", "boolean", "date", "enum", "ref", "json"]),
          isPrimaryKey: z.boolean(),
          refToTypeKey: z.string().nullable(),
        }),
      ),
      /**
       * 派生属性（R14 零写死 KPI 的派生图叶子，如 "SUM(Order.qty BY model)"）。
       * deriveModeling 默认空（数据里长不出公式）；半自动建模的人工 PATCH 阶段填入，
       * publish 携带进类型定义。轨L 增量2：demo 经真链建模须保策展派生属性不丢。
       */
      derivedProperties: z.array(z.object({ propKey: z.string(), formula: z.string() })).optional(),
      confidence: z.number(),
    }),
  ),
  linkTypes: z.array(
    z.object({
      fromTypeKey: z.string(),
      toTypeKey: z.string(),
      viaFields: z.object({ fromField: z.string(), toField: z.string() }),
      cardinality: z.enum(["1:1", "1:N", "N:1", "N:N"]),
      nameSuggestion: z.string(),
      confidence: z.number(),
    }),
  ),
});
export type ModelingSuggestion = z.infer<typeof ModelingSuggestionSchema>;

/**
 * 字段全建模覆盖报告（R12「字段全建模」）：导入数据源的每个字段都要落到某个对象属性。
 * 确定性映射管线（dataset→ObjectType · column→PropertyDef · FK→LinkType）默认 100% 覆盖。
 */
export const FieldCoverageReportSchema = z.object({
  datasets: z.array(
    z.object({
      name: z.string(),
      total: z.number().int(),
      modeled: z.number().int(),
      unmodeled: z.array(z.string()),
    }),
  ),
  totalFields: z.number().int(),
  modeledFields: z.number().int(),
  coverage: z.number(), // 0..1
  fullyCovered: z.boolean(),
});
export type FieldCoverageReport = z.infer<typeof FieldCoverageReportSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §6 A0/A6 权限
// ---------------------------------------------------------------------------

export const PermissionPolicySchema = z.object({
  id: z.string(), // pol_
  tenantId: z.string(),
  resource: z.object({
    kind: z.enum(["OBJECT_TYPE", "CONNECTION", "RULE_SET", "ACTION_TYPE"]),
    key: z.string(),
  }),
  grants: z.array(
    z.object({
      role: z.string(),
      ops: z.array(z.enum(["READ", "WRITE", "EXECUTE"])),
    }),
  ),
  rowFilter: z.string().optional(),
});
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §7 A7 合成数据
// ---------------------------------------------------------------------------

export const SyntheticJobBodySchema = z.object({
  industry: z.string(),
  scale: z.enum(["S", "M", "L", "XL"]),
  seed: z.number().int().optional(),
  /** 运营态出厂配置增量 §1.1：true → 合成后从 T−365 天回放至 T0（一年运营态）。 */
  livedIn: z.boolean().optional(),
  /**
   * WO-SYNTH-VALIDATION-LITE：合成剖面。FULL（默认，向后兼容）= 全量 90 天 TS 历史；
   * VALIDATION_LITE = 跳过 TS 历史与聚合（historyDays 语义=0），仅物化对象/派生/规则/权限/视图。
   * 关键安全性：TS 历史（genPoint）不消耗对象 RNG 游标，VLE 幂等指纹只覆盖对象，
   * 故 LITE 与 FULL 的对象字节完全一致——校验效力零损、耗时砍去大头。
   */
  profile: z.enum(["FULL", "VALIDATION_LITE"]).optional(),
  /** 显式覆盖 TS 历史天数（0=不生成 TS；未给且 profile=VALIDATION_LITE 时按 0；否则默认 90）。 */
  historyDays: z.number().int().min(0).optional(),
});
export type SyntheticJobBody = z.infer<typeof SyntheticJobBodySchema>;

/** A6 值域分布形：uniform=区间均匀 · normal=固定 Box–Muller(截断到 band) · banded=按权重确定性落桶。 */
export const ValueDomainShapeSchema = z.enum(["uniform", "normal", "banded"]);
export type ValueDomainShape = z.infer<typeof ValueDomainShapeSchema>;

export const GenSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum"), values: z.array(z.string()) }),
  z.object({
    kind: z.literal("number"),
    min: z.number(),
    max: z.number(),
    precision: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("pattern"), pattern: z.string() }), // 命名模式，如 "SO-{seq:5}"
  z.object({ kind: z.literal("fkSample"), refTypeKey: z.string() }),
  z.object({ kind: z.literal("date"), from: z.string(), to: z.string() }),
  // A6 拟真值域：按业务可信区间 + 分布形产值（domainKey 命中值域库则可省 band/shape）。确定性 R6。
  z.object({
    kind: z.literal("valueDomain"),
    domainKey: z.string().optional(),
    band: z.tuple([z.number(), z.number()]).optional(),
    shape: ValueDomainShapeSchema.optional(),
    bands: z.array(z.object({ range: z.tuple([z.number(), z.number()]), weight: z.number() })).optional(),
    precision: z.number().int().optional(),
  }),
]);
export type GenSpec = z.infer<typeof GenSpecSchema>;

/** A6 越线植入规约：对一条规则的阈值字段，确定性植入 crossCount 行越线 + nearCount 行近边界（固定索引）。 */
export const PlantSpecSchema = z.object({
  ruleKey: z.string(),
  typeKey: z.string(),
  field: z.string(),
  /** 违规方向：gt=值需 > threshold 才违规则植 > 的越线；lt 反之。 */
  op: z.enum(["gt", "lt"]),
  threshold: z.number(),
  crossCount: z.number().int().default(2),
  nearCount: z.number().int().default(2),
  /** 边界 δ（越线/近边界偏移量，相对阈值）。 */
  delta: z.number().default(0.02),
});
export type PlantSpec = z.infer<typeof PlantSpecSchema>;

export const IndustryTemplateSchema = z.object({
  industryKey: z.string(),
  ontology: z.record(z.string(), z.unknown()), // OntologyDefinition（对象/关系/派生公式）
  generation: z.array(
    z.object({
      typeKey: z.string(),
      count: z.object({ S: z.number().int(), M: z.number().int(), L: z.number().int(), XL: z.number().int().optional() }),
      propGenerators: z.record(z.string(), GenSpecSchema),
      /** A6 越线植入（显式声明）：固定索引植入越线/近边界样本，喂 VLE 查准 + 推演戏剧点。 */
      plants: z.array(PlantSpecSchema).optional(),
      /** A6 opt-in：对该类型 scope 的 BLOCK 规则自动派生默认 PlantSpec（保守默认 false，护 R6 向后兼容）。 */
      autoPlant: z.boolean().optional(),
    }),
  ),
  rules: z.array(
    z.object({
      id: z.string().optional(),
      key: z.string(),
      name: z.string(),
      expression: z.string(),
      scopeObjectTypes: z.array(z.string()).optional(),
      severity: z.string(),
      // 规则即引用（PRD-rules-as-references）：命名阈值，供求解器读（P2）+ 规则编辑器改。
      // 注：切片契约元数据不进 rules（见 sliceContracts）——它非行为规则、无 DSL 表达式、不进 planviews 域映射。
      params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])).optional(),
      // WO-RULES-CLASSIFY（加性）：规则业务类别（种子随规则授予，规则库分类筛选的真元数据源）。
      category: z.string().optional(),
      origin: RuleOriginSchema.optional(),
      version: z.number().int().optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).optional(),
    }),
  ),
  scenarioSeed: z.object({
    views: z.array(z.string()),
    intents: z.array(z.record(z.string(), z.unknown())),
  }),
  /**
   * A3-SUITE-1（refbase 修）：切片契约=元数据一等集合（非行为规则）。单一真源，供 slice fixtures 取
   * mustIncludeTypes/mustIncludeLinkKeys 做全链可达校验。**刻意不进 `rules`**——切片契约无 DSL 表达式
   * （曾用 expression:"FALSE" 塞进 rules → DSL 解析报错 + 泄漏进 planviews 域映射，本字段根治二者）。
   */
  sliceContracts: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        scopeObjectTypes: z.array(z.string()),
        mustIncludeTypes: z.array(z.string()),
        mustIncludeLinkKeys: z.array(z.string()),
      }),
    )
    .optional(),
  /** Entitlement 增量：行业模板默认功能集 */
  features: z.array(z.string()).optional(),
  /** A8.6 增量：时序生成规约与剧本（结构见 timeseries.ts） */
  tsGenerators: z.array(z.record(z.string(), z.unknown())).optional(),
  scenarioScript: z
    .array(z.object({ tick: z.number().int(), event: z.string(), params: z.record(z.string(), z.unknown()) }))
    .optional(),
  /** 求解器常数默认值（场景包 solverParams） */
  solverParams: z.record(z.string(), z.unknown()).optional(),
});
export type IndustryTemplate = z.infer<typeof IndustryTemplateSchema>;

// ---------------------------------------------------------------------------
// 数据接入分类（数据接入控制台：按业务域把"目前的数据"归类；每类可设系统对接/文件上传）
// ---------------------------------------------------------------------------

/** 接入方式：系统对接（连接器/API 同步）或文件上传（按模版灌入）。 */
export const IngestModeSchema = z.enum(["SYSTEM_INTEGRATION", "FILE_UPLOAD"]);
export type IngestMode = z.infer<typeof IngestModeSchema>;

/** 数据分类定义（行业域包派生；如 锂电「销售订单/物料/设备台账…」）。 */
export const DataCategorySchema = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().default(""),
  /** 归入本分类的本体对象类型键（"目前的数据"按此合并到分类）。 */
  typeKeys: z.array(z.string()),
  /** 本分类支持的接入方式（至少一种）。 */
  modes: z.array(IngestModeSchema).min(1),
  /** 默认接入方式（未设置覆盖时生效）。 */
  defaultMode: IngestModeSchema,
  /** 系统对接时建议的连接器类型键。 */
  connectorTypeKeys: z.array(z.string()).default([]),
});
export type DataCategory = z.infer<typeof DataCategorySchema>;

/** 分类接入方式 + 自定义模版列覆盖（持久化，按租户 R2；缺省回落 defaultMode + 本体派生模版）。 */
export const DataCategorySettingSchema = z.object({
  id: z.string(), // dcs_{tenant}_{categoryKey}
  tenantId: z.string(),
  categoryKey: z.string(),
  mode: IngestModeSchema.optional(),
  /** 用户上传 CSV 替换的自定义模版列（设置后优先于本体派生列；空=用派生模版）。 */
  customColumns: z.array(z.string()).optional(),
  updatedAt: IsoTime,
});
export type DataCategorySetting = z.infer<typeof DataCategorySettingSchema>;
