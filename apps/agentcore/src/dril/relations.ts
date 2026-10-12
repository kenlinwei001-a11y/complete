import type {
  AgentDefinition,
  IntelligenceResource,
  ResourceRelation,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";
import type { RuleSummary } from "../tools/clients.js";
import type { ResourceRelationRow } from "../persistence/repos.js";

/**
 * WO-DRIL-P3 · Resource Relations 自动抽取（PRD-decision-resource-intelligence-layer §10-P3 / §6.2）。
 *
 * 两类关系（R13 派生投影·非新真值源，全部从各模块**已有**元数据算出）：
 *  A. 资源↔资源（写 resource_relations·两端均须在册·无死路）：
 *     - workflow --invokes--> solver   （step.type=invoke_solver·params.solverKey）
 *     - workflow --includes--> slice    （step.type=resolve_slice·params.sliceKey）
 *     - workflow --invokes--> rule      （step.type=evaluate_rules·params.ruleIds[]·§10-P3「workflow.step→rule」）
 *     - agent    --binds--> skill        （agent.skills[].skillId → skill.key）
 *  B. 资源→对象类型（1-hop 图·§10-P3「solver.reads→objectType / rule.scopeObjectTypes / slice.includes→objectType」）：
 *     - solver/slice --reads--> objectType   （inputSpec.objectTypes / includedTypes）
 *     - rule         --scopes--> objectType  （scopeObjectTypes）
 *     对象类型非注册表资源（toKind="objectType" 不在 9 类），故**不落 resource_relations**（避免污染 R2 三表 +
 *     ResourceRelation 契约 toKind 枚举）；仅供 `GET /resources/{kind}/{key}/relations` 端点即时派生返回。
 *
 * R6：纯函数·确定性排序（同投影同关系集字节一致）。R14：不内联业务对象名（类型来自资源字段）。
 */

/** 资源↔资源派生边（写 resource_relations 的形状）。 */
export interface DerivedRelation {
  fromKind: string;
  fromKey: string;
  relType: string;
  toKind: string;
  toKey: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A. 资源↔资源关系（供 registry 落 resource_relations·两端在册过滤在 registry 侧做）。
 * 输入 = 各模块原始定义（= 投影源·R13）。确定性去重 + 排序。
 */
export function extractResourceRelations(input: {
  workflows: WorkflowDefinition[];
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  rules: RuleSummary[];
}): DerivedRelation[] {
  const out: DerivedRelation[] = [];
  for (const w of input.workflows) {
    for (const st of w.steps) {
      const p = (st.params ?? {}) as { solverKey?: string; sliceKey?: string; ruleIds?: unknown };
      if (st.type === "invoke_solver" && p.solverKey) {
        out.push({ fromKind: "workflow", fromKey: w.key, relType: "invokes", toKind: "solver", toKey: p.solverKey });
      }
      if (st.type === "resolve_slice" && p.sliceKey) {
        out.push({ fromKind: "workflow", fromKey: w.key, relType: "includes", toKind: "slice", toKey: p.sliceKey });
      }
      if (st.type === "evaluate_rules" && Array.isArray(p.ruleIds)) {
        for (const rk of p.ruleIds) {
          if (typeof rk === "string" && rk.length > 0) {
            out.push({ fromKind: "workflow", fromKey: w.key, relType: "invokes", toKind: "rule", toKey: rk });
          }
        }
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

  // 去重 + 确定性序（R6）。
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
      cmp(a.fromKind, b.fromKind) ||
      cmp(a.fromKey, b.fromKey) ||
      cmp(a.relType, b.relType) ||
      cmp(a.toKind, b.toKind) ||
      cmp(a.toKey, b.toKey),
  );
  return uniq;
}

/** 资源显式声明/派生的对象类型（solver/slice inputSpec.objectTypes·slice includedTypes·rule/agent scopeObjectTypes）。 */
function declaredObjectTypes(r: IntelligenceResource): string[] {
  const anyR = r as {
    scopeObjectTypes?: string[];
    includedTypes?: string[];
    inputSpec?: { objectTypes?: string[] };
  };
  const out = new Set<string>();
  for (const t of anyR.scopeObjectTypes ?? []) out.add(t);
  for (const t of anyR.includedTypes ?? []) out.add(t);
  for (const t of anyR.inputSpec?.objectTypes ?? []) out.add(t);
  return [...out];
}

/**
 * B. 资源→对象类型 1-hop 边（§10-P3·端点即时派生·**不落库**）。relType 按 kind 语义：
 * rule → scopes；其余（solver/slice/…）→ reads。R6 确定性序。
 */
export function objectTypeRelations(r: IntelligenceResource): ResourceRelation[] {
  const relType = r.kind === "rule" ? ("scopes" as const) : ("reads" as const);
  return declaredObjectTypes(r)
    .sort(cmp)
    .map((t) => ({ relType, toKind: "objectType" as ResourceRelation["toKind"], toKey: t }));
}

/**
 * 组装一个资源的**出边** `ResourceRelation[]`（供 resource.relations 回填 + relationStrength 打分 + 端点）。
 * = 库里的资源↔资源出边（rows·1-hop）+ 即时派生的对象类型出边。R6 确定性序。
 */
export function relationsOf(rows: ResourceRelationRow[], kind: string, key: string, resource?: IntelligenceResource): ResourceRelation[] {
  const rr: ResourceRelation[] = rows
    .filter((r) => r.fromKind === kind && r.fromKey === key)
    .map((r) => ({
      relType: r.relType as ResourceRelation["relType"],
      toKind: r.toKind as ResourceRelation["toKind"],
      toKey: r.toKey,
      ...(r.meta ? { meta: r.meta } : {}),
    }))
    .sort((a, b) => cmp(a.relType, b.relType) || cmp(a.toKind, b.toKind) || cmp(a.toKey, b.toKey));
  const objEdges = resource ? objectTypeRelations(resource) : [];
  return [...rr, ...objEdges];
}
