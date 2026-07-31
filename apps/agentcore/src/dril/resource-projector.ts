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
import type { McpServerConfig } from "@platform/contracts";
import type { ObjectTypeDefSummary, RuleSummary } from "../tools/clients.js";

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

/** skill ← AgentCore 本地 skills repo（summary 作描述）。 */
export function projectSkills(skills: SkillDefinition[]): SkillResource[] {
  return skills.map((s) => ({
    kind: "skill" as const,
    key: s.key,
    label: nonEmpty(s.name, s.key) ?? s.key,
    description: nonEmpty(s.summary, s.name, `技能 ${s.key}`) ?? `技能 ${s.key}`,
    capability: nonEmpty(s.summary, s.name),
    attachments: s.resources.map((r) => r.name),
    governance: { status: s.status, version: s.version },
  }));
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

/** 派生关系（写 resource_relations）：workflow→solver/slice(invokes)·agent→skill(binds)·agent→objectType 略。 */
export interface DerivedRelation {
  fromKind: string;
  fromKey: string;
  relType: string;
  toKind: string;
  toKey: string;
}

export function extractRelations(input: {
  workflows: WorkflowDefinition[];
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  rules: RuleSummary[];
}): DerivedRelation[] {
  const out: DerivedRelation[] = [];
  for (const w of input.workflows) {
    for (const st of w.steps) {
      const p = (st.params ?? {}) as { solverKey?: string; sliceKey?: string };
      if (st.type === "invoke_solver" && p.solverKey) {
        out.push({ fromKind: "workflow", fromKey: w.key, relType: "invokes", toKind: "solver", toKey: p.solverKey });
      }
      if (st.type === "resolve_slice" && p.sliceKey) {
        out.push({ fromKind: "workflow", fromKey: w.key, relType: "includes", toKind: "slice", toKey: p.sliceKey });
      }
    }
  }
  const skillById = new Map(input.skills.map((s) => [s.id, s.key] as const));
  for (const a of input.agents) {
    for (const sk of a.skills) {
      const key = skillById.get(sk.skillId);
      if (key) out.push({ fromKind: "agent", fromKey: a.key, relType: "binds", toKind: "skill", toKey: key });
    }
  }
  return out;
}
