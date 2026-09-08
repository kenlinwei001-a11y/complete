import type {
  AgentDefinition,
  AgentResource,
  FieldResource,
  IntentDefinition,
  IntentResource,
  McpResource,
  ObjectTypeResource,
  RuleResource,
  SkillDefinition,
  SkillResource,
  SliceResource,
  SolverResource,
  WorkflowDefinition,
  WorkflowResource,
} from "@platform/contracts";
import { SKILL_REFERENCE_KINDS } from "@platform/contracts";
import type { McpServerConfig, OntologySignature, ResourceInputOutput } from "@platform/contracts";
import type { ObjectTypeDefSummary, RuleSummary } from "../tools/clients.js";
import { extractResourceRelations } from "./relations.js";

/**
 * WO-DRIL-P1 · Resource Projector（PRD-decision-resource-intelligence-layer §6.3）。
 *
 * 纯投影函数：把各模块现有元数据映射为统一 `IntelligenceResource`（R13 派生投影·非新真值源）。
 * **无空描述纪律**：每个投影都保证 description 非空（缺省时从 name/key 合成 —— dril-registry:check 有牙）。
 * R14 零业务常数：本文件不内联任何业务对象名字面量，标签/对象类型均取自源模块字段（L4 tieredTags 留待 P2 从本体派生）。
 */

const nonEmpty = (...cands: (string | undefined)[]): string | undefined =>
  cands.map((c) => c?.trim()).find((c) => c && c.length > 0);

/** DataCore 目录项形状（catalog.discover / solverRegistry 返回）。 */
export interface CatalogItem {
  key: string;
  name: string;
  description: string;
  argHints?: Record<string, string>;
  domain?: string;
  /** 该资源能回答的 NL 样例问句（供近似问句语义检索/选型；search-engine semanticCandidates 已消费）。 */
  answersQuestions?: string[];
  /** 检索标签（供语义候选补召回）。 */
  tags?: string[];
  /** WO-CAPMAP-LIVE · 输出形状顶层 key（solverRegistry 专有·A 侧 `SOLVER_OUTPUT_SHAPES` 单一真值透传）。 */
  outputShape?: string[];
  /**
   * WO-69 P2 · Function 本体签名（读/写本体面）。**唯一出处在 DataCore**
   * （`apps/datacore/src/solvers/ontology-signature.ts`，由 S5 实跑比对门守住）。
   */
  ontologySignature?: OntologySignature;
}

/**
 * WO-69 P2 · `ontologySignature` → DRIL `inputSpec/outputSpec`（§5.3 ResourceInputOutput）的**唯一派生器**。
 *
 * 纪律：DRIL 侧**不许**再手填第二份「这个求解器读哪些对象类型」的清单——第二份清单必然与实现漂移
 * （本仓已有前科：清单与实现分家后没人发现，直到出错数）。此处只做**映射**，不做判断：
 *   · `inputSpec`  ← 签名 `reads`：objectTypes（读哪些类型）/ linkKeys（沿哪些链路）/ requiredProps。
 *   · `outputSpec` ← 签名 `writes`（只读求解器 = 无 writes → 不产 outputSpec，诚实空缺）。
 *
 * ⚠ `requiredProps` 语义**明文钉死**（WO 点名的历史坑：requiredProps/shape 曾被接反）：
 *   `Record<typeKey, 该类型上真被读到的属性名（逗号分隔）>`。
 *   **key 是对象类型、value 是属性列表**，不是反过来；某类型省略 propKeys（= 全属性）时**不产条目**
 *   （产一个空串会被下游读成"不需要任何属性"，正好是反的）。
 */
export function projectOntologySignature(sig: OntologySignature | undefined): {
  inputSpec?: ResourceInputOutput;
  outputSpec?: ResourceInputOutput;
} {
  if (!sig) return {};
  const out: { inputSpec?: ResourceInputOutput; outputSpec?: ResourceInputOutput } = {};
  const toSpec = (
    surfaces: { typeKey: string; propKeys?: string[]; linkKeys?: string[] }[],
  ): ResourceInputOutput | undefined => {
    if (surfaces.length === 0) return undefined;
    const objectTypes = [...new Set(surfaces.map((s) => s.typeKey))].sort();
    const linkKeys = [...new Set(surfaces.flatMap((s) => s.linkKeys ?? []))].sort();
    const requiredProps: Record<string, string> = {};
    for (const s of surfaces) {
      if (!s.propKeys || s.propKeys.length === 0) continue; // 全属性 / 无精确声明 → 不产条目（见上）
      const prev = requiredProps[s.typeKey];
      const merged = [...new Set([...(prev ? prev.split(", ") : []), ...s.propKeys])].sort();
      requiredProps[s.typeKey] = merged.join(", ");
    }
    return {
      objectTypes,
      ...(linkKeys.length > 0 ? { linkKeys } : {}),
      ...(Object.keys(requiredProps).length > 0 ? { requiredProps } : {}),
    };
  };
  const input = toSpec(sig.reads ?? []);
  if (input) out.inputSpec = input;
  const output = toSpec(sig.writes ?? []);
  if (output) out.outputSpec = output;
  return out;
}

/**
 * WO-69 P2 × WO-CAPMAP-LIVE 合流点：两个来源写的是**同一个 `outputSpec` 的不同字段** ——
 * 本体签名给 `objectTypes/linkKeys/requiredProps`（写哪些对象面），`SOLVER_OUTPUT_SHAPES` 给 `shape`
 * （结果的顶层字段名，能力地图据此告诉模型「取哪个字段做 ⟦ref:N⟧ 溯源」）。
 * **必须合并而非二选一** —— 择一即静默丢掉另一半，正是本仓「断在接缝」的老形态。
 */
export function mergeSolverSpecs(
  fromSignature: { inputSpec?: ResourceInputOutput; outputSpec?: ResourceInputOutput },
  outputShape: string[] | undefined,
): { inputSpec?: ResourceInputOutput; outputSpec?: ResourceInputOutput } {
  if (!outputShape || outputShape.length === 0) return fromSignature;
  return { ...fromSignature, outputSpec: { ...(fromSignature.outputSpec ?? {}), shape: outputShape } };
}

/**
 * solver ← DataCore solverRegistry（含净室通用族 + A8 CP-SAT）。
 * WO-DRIL-PRECISION：把目录侧的 `answersQuestions`（NL 样例问句）+ `tags` 一并投影进
 * IntelligenceResource——消费方 search-engine.semanticCandidates（:270）本就吃 answersQuestions，
 * 补齐后对口根因 solver 才拿得到语义分（此前只投 label/description/capability，样例问句被丢弃 →
 * intent 有样例分高、solver 没有排不上榜的病根）。R6：纯映射静态数据·同输入字节同序。
 */
export function projectSolvers(items: CatalogItem[]): SolverResource[] {
  return items.map((s) => ({
    kind: "solver" as const,
    key: s.key,
    label: nonEmpty(s.name, s.key) ?? s.key,
    description: nonEmpty(s.description, s.name, `求解器 ${s.key}`) ?? `求解器 ${s.key}`,
    ...(s.answersQuestions && s.answersQuestions.length > 0 ? { answersQuestions: s.answersQuestions } : {}),
    ...(s.tags && s.tags.length > 0 ? { tags: s.tags } : {}),
    argHints: s.argHints,
    domain: s.domain,
    capability: nonEmpty(s.description, s.name),
    // WO-69 P2：inputSpec/outputSpec **派生自** ontologySignature（无第二份手填清单；未签名 → 诚实空缺）。
    // WO-CAPMAP-LIVE：输出形状进 outputSpec.shape（真值在 A 侧 SOLVER_OUTPUT_SHAPES·R1 只读投影）。
    ...mergeSolverSpecs(projectOntologySignature(s.ontologySignature), s.outputShape),
    isDeterministic: true,
    requiresSidecar: false,
    runtime: { isDeterministic: true },
  }));
}

/** slice ← DataCore catalog.discover("slices")。P1 仅有目录级元数据；rootType/includedTypes 留 P3 从本体图补齐。 */
export function projectSlices(items: CatalogItem[]): SliceResource[] {
  return items.map((s) => ({
    kind: "slice" as const,
    key: s.key,
    label: nonEmpty(s.name, s.key) ?? s.key,
    description: nonEmpty(s.description, s.name, `本体切片 ${s.key}`) ?? `本体切片 ${s.key}`,
    // WO-DRIL-PRECISION：切片同理投影样例问句/标签（目录若声明则带上·search-engine 已消费）。
    ...(s.answersQuestions && s.answersQuestions.length > 0 ? { answersQuestions: s.answersQuestions } : {}),
    ...(s.tags && s.tags.length > 0 ? { tags: s.tags } : {}),
    argHints: s.argHints,
    domain: s.domain,
    capability: nonEmpty(s.description, s.name),
    rootType: "",
    includedTypes: [],
    includedLinkKeys: [],
  }));
}

/** rule ← DataCore /a/v1/rules（已发布）。severity 直投；description 缺省从 name/key 合成。 */
export function projectRules(rules: RuleSummary[]): RuleResource[] {
  const sev = (s?: string): RuleResource["severity"] =>
    s === "BLOCK" || s === "WARN" || s === "ADVISORY" || s === "INFO" ? s : undefined;
  return rules.map((r) => ({
    kind: "rule" as const,
    key: r.key,
    label: nonEmpty(r.name, r.key) ?? r.key,
    description:
      nonEmpty(r.description, r.name && r.name !== r.key ? r.name : undefined, `合规规则 ${r.key}`) ?? `合规规则 ${r.key}`,
    domain: "compliance",
    scopeObjectTypes: r.scopeObjectTypes ?? [],
    severity: sev(r.severity),
    expressionSummary: nonEmpty(r.expression),
  }));
}

/** workflow ← AgentCore 本地 workflows repo。 */
export function projectWorkflows(wfs: WorkflowDefinition[]): WorkflowResource[] {
  return wfs.map((w) => ({
    kind: "workflow" as const,
    key: w.key,
    label: nonEmpty(w.name, w.key) ?? w.key,
    description: nonEmpty(w.description, w.name, `工作流 ${w.key}`) ?? `工作流 ${w.key}`,
    capability: nonEmpty(w.description, w.name),
    governance: { status: w.status, version: w.version },
    steps: w.steps.map((st) => ({
      kind: st.type,
      ref: nonEmpty(
        (st.params as { solverKey?: string } | undefined)?.solverKey,
        (st.params as { sliceKey?: string } | undefined)?.sliceKey,
        (st.params as { agentId?: string } | undefined)?.agentId,
      ),
    })),
  }));
}

/** intent ← AgentCore 本地 intents repo（description 契约已保证非空）。 */
export function projectIntents(intents: IntentDefinition[]): IntentResource[] {
  return intents.map((i) => ({
    kind: "intent" as const,
    key: i.key,
    label: nonEmpty(i.name, i.key) ?? i.key,
    description: nonEmpty(i.description, i.name, `操作意图 ${i.key}`) ?? `操作意图 ${i.key}`,
    answersQuestions: i.examples,
    exampleQueries: i.examples,
    riskLevel: i.riskLevel,
    boundPlanRef: i.planRef ? `${i.planRef.planKey}@${i.planRef.version}` : i.planId,
    governance: { status: i.status, version: i.version, owner: i.owner },
  }));
}

/** skill ← AgentCore 本地 skills repo（summary 作描述；WO-SKILL-4 补齐 capability/input/output/relations）。 */
export function projectSkills(skills: SkillDefinition[]): SkillResource[] {
  return skills.map((s) => ({
    kind: "skill" as const,
    key: s.key,
    label: nonEmpty(s.name, s.key) ?? s.key,
    description: nonEmpty(s.summary, s.name, `技能 ${s.key}`) ?? `技能 ${s.key}`,
    capability: s.capability ?? nonEmpty(s.summary, s.name),
    inputSpec: s.inputSchema ? ioSpecFromJsonSchema(s.inputSchema) : undefined,
    outputSpec: s.outputSchema ? ioSpecFromJsonSchema(s.outputSchema) : undefined,
    triggerPatterns: s.summary ? [s.summary] : undefined,
    attachments: s.resources.map((r) => r.name),
    governance: { status: s.status, version: s.version },
  }));
}

/** 资源关系图可作为目标的 kind：= 契约引用词表减去 ontologyType（本体类型非资源图节点）。派生自单一来源，
 *  免得新增一种引用 kind 时这里悄悄漏掉（原稿是就地手写的字面量数组）。 */
const RESOURCE_REL_TARGET_KINDS: ReadonlySet<string> = new Set(
  SKILL_REFERENCE_KINDS.filter((k) => k !== "ontologyType"),
);

/**
 * 把 JSON Schema 投影为 `ResourceInputOutput`（契约 `intelligence-resource.ts:35`）。
 *
 * 两个字段按**契约语义**填，别按名字直觉填（原稿把二者接反了）：
 *   `requiredProps`（Record<名, 口径>）= 只收 `schema.required` 列出的那些属性 —— 原稿收了**全部** properties，
 *      于是 Agent 在资源目录里会把可选参数当必填，照着编造入参。
 *   `shape`（string[]·契约注释="输出顶层字段"）= 顶层字段名全集 `Object.keys(properties)` —— 原稿塞的是
 *      `schema.required`，既非顶层字段全集，用在 inputSpec 上也不是"输出字段"这个语义。
 */
function ioSpecFromJsonSchema(schema: Record<string, unknown>): { shape?: string[]; requiredProps?: Record<string, string> } {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((x): x is string => typeof x === "string")
    : [];
  // 顶层字段全集 = 必填名（保序在前）∪ 其余已声明属性。二者取任一单边都会丢字段：
  // 只取 required → 丢可选字段；只取 properties → 丢「声明了必填却没写属性定义」的字段。
  const shape = [...required, ...Object.keys(props).filter((k) => !required.includes(k))];
  // 只有 required 里的才是必填；无属性定义的必填字段诚实标 unknown，不假装知道它的口径。
  const requiredProps = Object.fromEntries(
    required.map((k) => [k, props[k]?.type ?? props[k]?.description ?? "unknown"]),
  );
  return {
    ...(shape.length > 0 ? { shape } : {}),
    ...(Object.keys(requiredProps).length > 0 ? { requiredProps } : {}),
  };
}

/** agent ← AgentCore 本地 agents repo（description 契约已保证非空）。 */
export function projectAgents(agents: AgentDefinition[]): AgentResource[] {
  return agents.map((a) => ({
    kind: "agent" as const,
    key: a.key,
    label: nonEmpty(a.name, a.key) ?? a.key,
    description: nonEmpty(a.description, a.name, `Agent ${a.key}`) ?? `Agent ${a.key}`,
    role: a.role,
    scopeObjectTypes: a.scopeDeclaration.objectTypes,
    toolNames: a.scopeDeclaration.toolNames,
    governance: { status: a.status, version: a.version },
  }));
}

/** mcp_tool ← MCP 配置（P1 投影到 server 级；tools/list 逐工具投影留后续 MCP 发现）。 */
export function projectMcp(configs: McpServerConfig[]): McpResource[] {
  return configs.map((c) => ({
    kind: "mcp_tool" as const,
    key: c.serverName ?? c.id,
    label: nonEmpty(c.name, c.serverName, c.id) ?? c.id,
    description: `MCP 服务器 ${nonEmpty(c.name, c.serverName) ?? c.id}（${c.transport.type}）`,
    serverName: c.serverName,
    transportKind: c.transport.type,
    governance: { status: c.status, version: c.version },
  }));
}

/**
 * WO-RESOURCE-CATALOG-ONTOLOGY T1 · object_type ← `GET /a/v1/ontology/object-types`（ACTIVE）。
 * 映射：key←typeKey · label←displayName · description←description（缺则按 WO §4 兜底：非空(description,
 * displayName, key) 合成 + `descriptionSynthesized: true`，**只拼已有 key/displayName，不编业务含义**）。
 * `inputSpec.objectTypes=[typeKey]`（L4 对象标签经 registry enrichTieredTags 从此派生）。
 * R14：零手写类型清单——投影集完全等于真值源集，虚构类型无从混入。R6：保真值源序，同输入字节同序。
 */
export function projectObjectTypes(defs: ObjectTypeDefSummary[]): ObjectTypeResource[] {
  const active = defs.filter((d) => d.status === undefined || d.status === "ACTIVE");
  return active.map((t) => {
    const label = nonEmpty(t.displayName, t.key) ?? t.key;
    const desc = nonEmpty(t.description);
    return {
      kind: "object_type" as const,
      key: t.key,
      label,
      description: desc ?? label,
      ...(desc ? {} : { descriptionSynthesized: true }),
      domain: t.domain,
      capability: desc ?? label,
      inputSpec: { objectTypes: [t.key] },
      ...(t.properties && t.properties.length > 0
        ? {
            properties: t.properties.map((p) => ({
              propKey: p.propKey,
              ...(p.description !== undefined ? { description: p.description } : {}),
              ...(p.unit !== undefined ? { unit: p.unit } : {}),
              ...(p.dataType !== undefined ? { dataType: p.dataType } : {}),
            })),
          }
        : {}),
      ...(t.linkKeys && t.linkKeys.length > 0 ? { linkKeys: t.linkKeys } : {}),
    };
  });
}

/** field 投影供给侧形状（type-semantics props 或 object-types properties 回退·统一喂 projectFields）。 */
export interface FieldSource {
  typeKey: string;
  props: { propKey: string; description?: string; unit?: string; dataType?: string }[];
}

/**
 * WO-RESOURCE-CATALOG-ONTOLOGY T2 · field ← `GET /a/v1/ontology/type-semantics`（接线契约早已声明的 kind）。
 * `key = ${typeKey}.${propKey}`（与 resource-descriptor.ts 既定口径一致）；**带量纲** `unit`（PropertyDef.unit
 * 已登记并被 generic_inference 消费，资源目录同步透出——Agent 才知道字段单位）。只投影 ACTIVE 类型的属性
 * （ACTIVE 过滤在 registry 供给侧完成并 log 裁剪数）；属性级 description 缺失同样按 §4 合成 + 标记。
 */
export function projectFields(sources: FieldSource[]): FieldResource[] {
  const out: FieldResource[] = [];
  for (const s of sources) {
    for (const p of s.props) {
      const key = `${s.typeKey}.${p.propKey}`;
      const desc = nonEmpty(p.description);
      out.push({
        kind: "field" as const,
        key,
        label: p.propKey,
        description: desc ?? key,
        ...(desc ? {} : { descriptionSynthesized: true }),
        objectType: s.typeKey,
        propKey: p.propKey,
        ...(p.unit !== undefined ? { unit: p.unit } : {}),
        ...(p.dataType !== undefined ? { dataType: p.dataType } : {}),
        inputSpec: { objectTypes: [s.typeKey] },
      });
    }
  }
  return out;
}

/** 派生关系（写 resource_relations）：workflow→solver/slice/rule · agent→skill · skill→references/dependsOn。 */
export interface DerivedRelation {
  fromKind: string;
  fromKey: string;
  relType: string;
  toKind: string;
  toKey: string;
}

const cmpRel = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * WO-SKILL-REFGRAPH-WIRE · 生产投影链路的**唯一**关系抽取入口（闭 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ①）。
 *
 * 病史（假绿第 9 形态原型）：本函数曾**零 src 调用方**——实现有、测试有且绿，生产链路却走
 * `relations.ts` 的 `extractResourceRelations`（不读 `skill.references/dependsOn`），于是 skill 引用边
 * 一条都没进过资源图，测试咬的是函数不是链路。
 *
 * 修法 = **组合而非复抄**：基础边（workflow→solver/slice/rule · agent→skill）的唯一出处仍是
 * `extractResourceRelations`（含去重 + 确定性序），本函数在其上叠加 Skill 工业级引用边。
 * 两份 workflow/agent 抽取逻辑并存必然漂移——本函数旧版就是复抄的，漏了 `evaluate_rules→rule`
 * 与去重排序；调用方 `dril/resource-registry.ts`（projectTenant 落 resource_relations）。
 */
export function extractRelations(input: {
  workflows: WorkflowDefinition[];
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  rules: RuleSummary[];
}): DerivedRelation[] {
  const out: DerivedRelation[] = [...extractResourceRelations(input)];
  // WO-SKILL-4：Skill 工业级引用 → 派生资源关系（precondition/postcheck/context/dependsOn）。
  for (const s of input.skills) {
    const pushRef = (ref: { kind: string; key: string }, relType: string) => {
      // ontologyType 不是资源图节点 → **真的略过**。
      // 原稿写的是 `ref.kind === "ontologyType" ? "slice" : ref.kind`，注释说"略过"、代码却把它改写成 slice，
      // 于是产出一条 toKind:"slice" 而 toKey 其实是本体类型键的**悬挂关系**（下游按 slice 查必然查不到）。
      if (ref.kind === "ontologyType") return;
      if (RESOURCE_REL_TARGET_KINDS.has(ref.kind)) {
        out.push({ fromKind: "skill", fromKey: s.key, relType, toKind: ref.kind, toKey: ref.key });
      }
    };
    for (const ref of s.references ?? []) pushRef(ref, "references");
    for (const dep of s.dependsOn ?? []) pushRef(dep, "dependsOn");
  }
  // 合并后整体去重 + 确定性排序（R6：同投影同关系集字节一致，与 extractResourceRelations 内部同口径）。
  const seen = new Set<string>();
  const uniq: DerivedRelation[] = [];
  for (const r of out) {
    const pk = `${r.fromKind}|${r.fromKey}|${r.relType}|${r.toKind}|${r.toKey}`;
    if (seen.has(pk)) continue;
    seen.add(pk);
    uniq.push(r);
  }
  uniq.sort(
    (a, b) =>
      cmpRel(a.fromKind, b.fromKind) ||
      cmpRel(a.fromKey, b.fromKey) ||
      cmpRel(a.relType, b.relType) ||
      cmpRel(a.toKind, b.toKind) ||
      cmpRel(a.toKey, b.toKey),
  );
  return uniq;
}
