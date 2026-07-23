import type { SolverSemantics, TypeSemantics, TypeSemanticsPayload } from "@platform/contracts";
import type { LinkTypeDef, ObjectTypeDef } from "../domain.js";
import type { CatalogItem } from "../catalog.js";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 本体口径/语义投影（datacore 半·确定性 R6·无 LLM/时钟/随机）。
 *
 * 把已发布本体（对象类型 + 派生口径 + 字段映射 + 链路）与求解器目录（answersQuestions/tags/输出形状）
 * 打包成 `TypeSemanticsPayload`——问句→本体口径/语义投影层的**单一真值原料**。口径来自本体
 * `derivedProperties`、字段映射来自 `sourceBindings`、证据类型来自 `CausalFactor.drillType` 真数据，
 * **绝不内联/编数**。引擎半（agentcore）读此原料经 contracts `assembleContextBundle` 打分选型（共享代码·灭漂移）。
 */

export interface TypeSemanticsInput {
  /** 已发布对象类型（ACTIVE）。 */
  types: ObjectTypeDef[];
  /** 已发布链路。 */
  links: LinkTypeDef[];
  /** 求解器全集目录（ALL_SOLVER_CATALOG）。 */
  solverCatalog: CatalogItem[];
  /** 求解器输出形状（SOLVER_OUTPUT_SHAPES）。 */
  solverOutputShapes: Record<string, string[]>;
  /** 求解器 target 类型（SOLVER_GRAPH key→target·补 readsTypes）。 */
  solverTargets: Record<string, string>;
  /** 对象类型域回退表（GRAPH_DOMAIN·当类型自身无 domain 时）。 */
  graphDomain: Record<string, string>;
  /** CausalFactor 实例的 drillType 去重集（数据源自本体真实因果图·证据类型宇宙）。 */
  causalDrillTypes: string[];
  /** CausalFactor 类型所属域（causalEvidenceTypes 归属·assembly 据此判定纳入）。 */
  causalDomain?: string;
  /** 域过滤回显（可选）。 */
  domainFilter?: string;
}

const KEY_PROP_CAP = 6;

function domainOf(t: ObjectTypeDef, graphDomain: Record<string, string>): string {
  return t.domain ?? graphDomain[t.key] ?? "unassigned";
}

/** 把类型投影成 TypeSemantics（口径=派生公式·映射=sourceBinding·refs=refToTypeKey）。 */
function projectType(t: ObjectTypeDef, graphDomain: Record<string, string>): TypeSemantics {
  const props = t.properties ?? [];
  const pk = props.find((p) => p.isPrimaryKey)?.propKey;
  // 关键属性：主键优先，其余按声明序补足（供分组统计维度候选）。
  const ordered = [...(pk ? [pk] : []), ...props.map((p) => p.propKey).filter((k) => k !== pk)];
  const keyProps = ordered.slice(0, KEY_PROP_CAP);

  const caliber: Record<string, string> = {};
  for (const d of t.derivedProperties ?? []) caliber[d.propKey] = d.formula;

  const binding = (t.sourceBindings ?? [])[0];
  const fieldMappings: Record<string, string> = binding?.fieldMappings ? { ...binding.fieldMappings } : {};

  const units: Record<string, string> = {};
  for (const p of props) if (p.unit) units[p.propKey] = p.unit;

  const refs = [...new Set(props.map((p) => p.refToTypeKey).filter((r): r is string => !!r))].sort();

  return {
    typeKey: t.key,
    displayName: t.displayName ?? t.key,
    domain: domainOf(t, graphDomain),
    keyProps,
    caliber,
    fieldMappings,
    units,
    refs,
  };
}

/**
 * 求解器读取的对象类型（确定性·从描述/名/argHints/输出形状对已发布类型键做**词边界**匹配 + SOLVER_GRAPH target）。
 * 类型键为英文（Metric/MaterialBalance/Order…），词边界匹配可靠命中描述里的类型引用（如 "读 MaterialBalance"、"Metric.gap"）。
 */
function readsTypesFor(item: CatalogItem, outputShape: string[], target: string | undefined, typeKeys: string[]): string[] {
  const blob = [
    item.description ?? "",
    item.name ?? "",
    item.key ?? "",
    ...Object.values(item.argHints ?? {}),
    outputShape.join(" "),
  ].join(" ");
  const found = new Set<string>();
  for (const k of typeKeys) {
    // 词边界（类型键前后非字母数字·避免 Metric 命中 MetricXyz）。
    const re = new RegExp(`(^|[^A-Za-z0-9_])${k}([^A-Za-z0-9_]|$)`);
    if (re.test(blob)) found.add(k);
  }
  if (target && typeKeys.includes(target)) found.add(target);
  return [...found].sort();
}

function projectSolver(item: CatalogItem, input: TypeSemanticsInput, typeKeys: string[]): SolverSemantics {
  const outputShape = input.solverOutputShapes[item.key] ?? [];
  return {
    key: item.key,
    name: item.name,
    description: item.description ?? "",
    ...(item.domain ? { domain: item.domain } : {}),
    answersQuestions: item.answersQuestions ?? [],
    tags: item.tags ?? [],
    argHints: item.argHints ?? {},
    outputShape,
    readsTypes: readsTypesFor(item, outputShape, input.solverTargets[item.key], typeKeys),
  };
}

/**
 * 投影 = 单一真值口径/语义原料（确定性 R6）。同 (已发布本体, 域过滤) 同输出字节一致；
 * 改本体口径/映射（改 Metric caliber 或 type mapping 发布）→ 投影同步变（灭 mirror 漂移）。
 */
export function projectTypeSemantics(input: TypeSemanticsInput): TypeSemanticsPayload {
  const typeSemantics = input.types
    .map((t) => projectType(t, input.graphDomain))
    .sort((a, b) => (a.typeKey < b.typeKey ? -1 : a.typeKey > b.typeKey ? 1 : 0));
  const typeKeys = typeSemantics.map((t) => t.typeKey);
  const typeKeySet = new Set(typeKeys);

  const solvers = input.solverCatalog
    .map((s) => projectSolver(s, input, typeKeys))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const links = input.links
    .map((l) => ({
      key: l.key,
      from: l.fromTypeKey,
      to: l.toTypeKey,
      ...(l.cardinality ? { cardinality: l.cardinality } : {}),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const causalEvidenceTypes = [...new Set(input.causalDrillTypes)].filter((t) => typeKeySet.has(t)).sort();

  return {
    ...(input.domainFilter ? { domain: input.domainFilter } : {}),
    types: typeSemantics,
    solvers,
    links,
    causalEvidenceTypes,
    ...(input.causalDomain ? { causalDomain: input.causalDomain } : {}),
  };
}
