// WO-Phase3-B · §3.1 本体查询引擎（Query Engine）——独立纯函数（R6 确定性·join≠compute 铁律）。
//
// 强制复用（非重写）：
//   ① planSlice（本文件同目录）——规划 rootType→目标类型最短路 → SlicePlan（确定性 BFS）。
//   ② executeSlice（经 deps 注入·OntologyCore 提供）——按 SlicePlan 读 ObjectInstance/Link（A6 行级过滤内建）。
//   ③ recompute（经 deps 注入·可选）——overrides 假设注入前向重算 → before/after（generic_inference fallback）。
// 聚合（sum/count/avg/max）只在引擎内算，入库仍是颗粒对象（R13 零聚合入库）。
//
// 能力边界 guard（join≠compute）：只做遍历 + 简单聚合；约束求解/组合优化/跨对象复杂业务公式
// （ATP/SOP/portfolio/财务信用）必须 fallback 到专用 solver 或 Phase2 组合器，不得内置。
//
// 依赖 IO 全经 deps 注入（executeSlice/recompute/对象读取），使本引擎可组件级单测、确定性可复验。
import { planSlice, type PlannerType, type PlannerLink } from "./slice-planner.js";
import type {
  OntologyQueryInput,
  OntologyQueryOutput,
  OntologyQueryFilter,
  OntologyQueryOverride,
  OntologyQueryDelta,
} from "@platform/contracts";

export interface QueryEngineTypeDef {
  key: string;
  domain?: string;
  pk: string;
}
export interface QueryEngineLinkDef {
  key: string;
  fromTypeKey: string;
  toTypeKey: string;
}
export interface QueryEngineObject {
  id: string;
  objectKey: string;
  props: Record<string, unknown>;
}
export interface QueryEngineSliceNode {
  id: string;
  typeKey: string;
  objectKey: string;
  props: Record<string, unknown>;
}
export interface SliceSpecLike {
  root: { typeKey: string; selector: { byKey?: unknown; filter?: Record<string, unknown> } };
  paths: { linkKey: string; direction: "out" | "in"; filter?: Record<string, unknown> }[][];
  maxNodes: number;
}
export interface QueryEngineDeps {
  types: QueryEngineTypeDef[];
  links: QueryEngineLinkDef[];
  /** 读某类型全部（可见）根对象（rootFilter 预选用）。 */
  listRoots: (typeKey: string) => Promise<QueryEngineObject[]>;
  /** 沿 SlicePlan 读对象/链路（OntologyCore.executeSlice 包一层）。 */
  executeSlice: (spec: SliceSpecLike, args: Record<string, unknown>) => Promise<{ nodes: QueryEngineSliceNode[] }>;
  /** 假设注入前向重算（overrides 非空时调；缺省不支持 what-if）。 */
  recompute?: (overrides: OntologyQueryOverride[]) => Promise<OntologyQueryDelta[]>;
}

/** 结构化错误：NL 或规划无法解析出查询路径（诚实不编造）。 */
export class NoQueryPlanError extends Error {
  code = "NO_QUERY_PLAN";
  constructor(message: string) {
    super(message);
    this.name = "NoQueryPlanError";
  }
}

/** 单字段过滤（确定性）：eq/ne/in/contains + 数值/日期串可比的 gt/gte/lt/lte（ISO 日期串字典序正确）。 */
export function matchQueryFilter(actual: unknown, op: string, want: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === want;
    case "ne":
      return actual !== want;
    case "in":
      return Array.isArray(want) && (want as unknown[]).includes(actual);
    case "contains":
      return String(actual ?? "").includes(String(want ?? ""));
    default:
      break;
  }
  const an = Number(actual);
  const wn = Number(want);
  const bothNum = Number.isFinite(an) && Number.isFinite(wn) && typeof actual !== "string";
  const cmp = bothNum ? an - wn : String(actual ?? "").localeCompare(String(want ?? ""));
  switch (op) {
    case "gt":
      return cmp > 0;
    case "gte":
      return cmp >= 0;
    case "lt":
      return cmp < 0;
    case "lte":
      return cmp <= 0;
    default:
      return false;
  }
}

const applyFilters = (props: Record<string, unknown>, filters?: OntologyQueryFilter[]): boolean =>
  !filters || filters.every((f) => matchQueryFilter(props[f.field], f.op, f.value));

/** 仅 eq 过滤 → executeSlice 可下推的 filter map（其余算子引擎内后置，见下）。 */
const eqFilterMap = (filters?: OntologyQueryFilter[]): Record<string, unknown> | undefined => {
  if (!filters) return undefined;
  const m: Record<string, unknown> = {};
  for (const f of filters) if (f.op === "eq") m[f.field] = f.value;
  return Object.keys(m).length > 0 ? m : undefined;
};

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * 执行一次本体查询。确定性（R6）：稳定排序（objId/分组键字典序）、无 Date.now/随机。
 * R13：每行 provenance = {typeKey, objId, linkPath}；R12：入参字段来自运行时本体（未存在的 linkKey/type 报错）。
 */
export async function runOntologyQuery(deps: QueryEngineDeps, input: OntologyQueryInput): Promise<OntologyQueryOutput> {
  const plannerTypes: PlannerType[] = deps.types.map((t) => ({ key: t.key, domain: t.domain }));
  const plannerLinks: PlannerLink[] = deps.links.map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));
  const linkByKey = new Map(deps.links.map((l) => [l.key, l]));
  const typeSet = new Set(deps.types.map((t) => t.key));
  const dirToSlice = (d: "forward" | "backward"): "out" | "in" => (d === "forward" ? "out" : "in");

  // R12 双向闭包：rootType / select.type / hop.linkKey 必须在运行时本体中存在。
  if (!typeSet.has(input.rootType)) throw new NoQueryPlanError(`rootType ${input.rootType} 不在本体中`);
  const selectTypes = [...new Set(input.select.map((s) => s.type))];
  for (const st of selectTypes) if (!typeSet.has(st)) throw new NoQueryPlanError(`select 类型 ${st} 不在本体中`);
  const targetTypes = selectTypes.filter((t) => t !== input.rootType);

  // ── ① 规划路径：显式 hops 优先；否则 planSlice 求 rootType→各 select 类型最短路 ──
  type HopStep = { linkKey: string; direction: "out" | "in"; toType: string; filter?: OntologyQueryFilter[] };
  let paths: HopStep[][] = [];
  const usedSliceKeys: string[] = [];

  // planSlice best-effort（供 usedSliceKeys / queryPlan；显式 hops 时亦尝试）。
  const planned = targetTypes.length > 0 ? planSlice(plannerTypes, plannerLinks, { rootType: input.rootType, targets: targetTypes, maxHops: 8 }) : null;

  if (input.hops.length > 0) {
    // 显式多跳：逐跳按 link 定义 + direction 推 toType，校验闭包（linkKey 存在 + 端点匹配当前类型）。
    let cur = input.rootType;
    const steps: HopStep[] = [];
    for (const h of input.hops) {
      const lt = linkByKey.get(h.linkKey);
      if (!lt) throw new NoQueryPlanError(`linkKey ${h.linkKey} 不在本体中`);
      const dir = dirToSlice(h.direction);
      const toType = dir === "out" ? lt.toTypeKey : lt.fromTypeKey;
      const fromType = dir === "out" ? lt.fromTypeKey : lt.toTypeKey;
      if (fromType !== cur) throw new NoQueryPlanError(`hop ${h.linkKey}:${h.direction} 起点 ${fromType} 与当前类型 ${cur} 不接（链路断裂 R12）`);
      if (h.targetType && h.targetType !== toType) throw new NoQueryPlanError(`hop ${h.linkKey}:${h.direction} 落点应为 ${toType}，声明 ${h.targetType} 不符`);
      steps.push({ linkKey: h.linkKey, direction: dir, toType, filter: h.filter });
      cur = toType;
    }
    paths = [steps];
    if (planned && planned.ok) usedSliceKeys.push(planned.plan.sliceKey);
  } else {
    if (targetTypes.length === 0) {
      paths = []; // 仅查根类型（rootType===select.type）：无跳。
    } else {
      if (!planned || !planned.ok) {
        throw new NoQueryPlanError(`无法规划 ${input.rootType}→${targetTypes.join("/")} 的遍历路径（不可达）`);
      }
      usedSliceKeys.push(planned.plan.sliceKey);
      for (const p of planned.plan.paths) {
        let cur = input.rootType;
        const steps: HopStep[] = [];
        for (const hop of p.hops) {
          steps.push({ linkKey: hop.linkKey, direction: hop.direction, toType: hop.toType });
          cur = hop.toType;
        }
        void cur;
        if (steps.length > 0) paths.push(steps);
      }
    }
  }

  // 类型级 linkPath 映射（首达即定）：type → ["linkKey:direction", ...]，供逐行 provenance。
  const linkPathByType = new Map<string, string[]>();
  linkPathByType.set(input.rootType, []);
  for (const steps of paths) {
    const acc: string[] = [];
    for (const s of steps) {
      acc.push(`${s.linkKey}:${s.direction}`);
      if (!linkPathByType.has(s.toType)) linkPathByType.set(s.toType, [...acc]);
    }
  }

  // 每类型的后置过滤集（rootFilter + 各 hop.filter；覆盖非 eq 算子·终端类型完全正确）。
  const postFilterByType = new Map<string, OntologyQueryFilter[]>();
  if (input.rootFilter) postFilterByType.set(input.rootType, input.rootFilter);
  for (const steps of paths) for (const s of steps) if (s.filter) postFilterByType.set(s.toType, [...(postFilterByType.get(s.toType) ?? []), ...s.filter]);

  // ── ② executeSlice 读对象图 ──
  // rootFilter：全 eq 且仅按主键/单键时可下推 selector；一般情形预选根后按 byKey 逐根遍历（保证下游剪枝正确）。
  const sliceSpecPaths = paths.map((steps) => steps.map((s) => ({ linkKey: s.linkKey, direction: s.direction, ...(eqFilterMap(s.filter) ? { filter: eqFilterMap(s.filter) } : {}) })));

  const mergedNodes = new Map<string, QueryEngineSliceNode>();
  const runSlice = async (selector: SliceSpecLike["root"]["selector"]) => {
    const out = await deps.executeSlice({ root: { typeKey: input.rootType, selector }, paths: sliceSpecPaths, maxNodes: 1000 }, {});
    for (const n of out.nodes) if (!mergedNodes.has(n.id)) mergedNodes.set(n.id, n);
  };

  if (input.rootFilter && input.rootFilter.length > 0) {
    const roots = await deps.listRoots(input.rootType);
    const matched = roots.filter((r) => applyFilters(r.props, input.rootFilter)).sort((a, b) => a.objectKey.localeCompare(b.objectKey));
    if (matched.length === 0) throw new NoQueryPlanError(`rootFilter 无匹配根对象（${input.rootType}）`);
    for (const r of matched) await runSlice({ byKey: r.objectKey });
  } else {
    await runSlice({});
  }

  // ── ③ 假设注入（overrides）→ recompute before/after（generic_inference fallback / what-if） ──
  let deltas: OntologyQueryDelta[] | undefined;
  const overriddenIds = new Set<string>();
  if (input.overrides && input.overrides.length > 0) {
    if (!deps.recompute) throw new NoQueryPlanError("overrides 需 recompute 支持（本调用未注入 recompute）");
    deltas = await deps.recompute(input.overrides);
    for (const o of input.overrides) overriddenIds.add(o.objectId);
    for (const d of deltas) overriddenIds.add(d.objId);
  }

  // ── ④ 组织 rows / columns / provenance / 聚合 ──
  const nodesByType = new Map<string, QueryEngineSliceNode[]>();
  for (const n of mergedNodes.values()) {
    const arr = nodesByType.get(n.typeKey) ?? [];
    arr.push(n);
    nodesByType.set(n.typeKey, arr);
  }

  const rows: Record<string, unknown>[] = [];
  const columns: string[] = [];
  const provenance: OntologyQueryOutput["provenance"] = [];
  const aggregation: string[] = [];
  const pushCol = (c: string) => { if (!columns.includes(c)) columns.push(c); };
  const derivedFrom = (id: string): string | undefined => (overriddenIds.has(id) ? "overrides·recompute(dryRun)" : undefined);

  for (const sel of input.select) {
    const filters = postFilterByType.get(sel.type);
    let nodes = (nodesByType.get(sel.type) ?? []).filter((n) => applyFilters(n.props, filters));
    nodes = nodes.sort((a, b) => a.id.localeCompare(b.id)); // R6 稳定序
    const lp = linkPathByType.get(sel.type) ?? [];

    if (sel.aggregate) {
      const field = sel.fields[0];
      const groups = new Map<string, QueryEngineSliceNode[]>();
      for (const n of nodes) {
        const gk = sel.groupBy ? String(n.props[sel.groupBy] ?? "") : "__all__";
        (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(n);
      }
      const aggCol = `${sel.type}.${sel.aggregate}(${field ?? "*"})`;
      aggregation.push(aggCol);
      if (sel.groupBy) pushCol(`${sel.type}.${sel.groupBy}`);
      pushCol(aggCol);
      for (const gk of [...groups.keys()].sort()) {
        const members = groups.get(gk)!;
        let value: number;
        if (sel.aggregate === "count") value = members.length;
        else {
          const nums = members.map((m) => Number(m.props[field ?? ""])).filter((v) => Number.isFinite(v));
          if (sel.aggregate === "sum") value = nums.reduce((s, v) => s + v, 0);
          else if (sel.aggregate === "avg") value = nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
          else value = nums.length > 0 ? Math.max(...nums) : 0; // max
        }
        const row: Record<string, unknown> = { [aggCol]: round6(value) };
        if (sel.groupBy) row[`${sel.type}.${sel.groupBy}`] = gk === "__all__" ? null : gk;
        rows.push(row);
        for (const m of members) provenance.push({ typeKey: sel.type, objId: m.id, linkPath: lp, ...(derivedFrom(m.id) ? { derivedFrom: derivedFrom(m.id)! } : {}) });
      }
    } else {
      for (const f of sel.fields) pushCol(`${sel.type}.${f}`);
      for (const n of nodes) {
        const row: Record<string, unknown> = {};
        for (const f of sel.fields) row[`${sel.type}.${f}`] = n.props[f];
        rows.push(row);
        provenance.push({ typeKey: sel.type, objId: n.id, linkPath: lp, ...(derivedFrom(n.id) ? { derivedFrom: derivedFrom(n.id)! } : {}) });
      }
    }
  }

  // orderBy（对已投影列排序·确定性 tie-break by 首列）+ limit。
  if (input.orderBy) {
    const col = columns.includes(input.orderBy.field) ? input.orderBy.field : columns.find((c) => c.endsWith(`.${input.orderBy!.field}`)) ?? input.orderBy.field;
    const sign = input.orderBy.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      const an = Number(av);
      const bn = Number(bv);
      const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return cmp !== 0 ? sign * cmp : 0;
    });
  }
  const limited = input.limit !== undefined ? rows.slice(0, input.limit) : rows;

  const primaryTarget = targetTypes[0] ?? input.rootType;
  const primaryPathSteps = paths.find((p) => p[p.length - 1]?.toType === primaryTarget) ?? paths[0] ?? [];
  const queryPlanHops = primaryPathSteps.map((s) => ({ linkKey: s.linkKey, direction: (s.direction === "out" ? "forward" : "backward") as "forward" | "backward", toType: s.toType }));

  return {
    rows: limited,
    columns,
    provenance,
    queryPlan: { usedSliceKeys, hops: queryPlanHops, aggregation },
    ...(deltas ? { deltas } : {}),
    summary: `${input.rootType} 遍历 ${paths.reduce((m, p) => Math.max(m, p.length), 0)} 跳 → ${limited.length} 行（${input.select.map((s) => (s.aggregate ? `${s.type}.${s.aggregate}(${s.fields[0] ?? "*"})` : s.type)).join(", ")}）${deltas ? `·假设重算 ${deltas.length} 项 before/after` : ""}`,
  };
}
