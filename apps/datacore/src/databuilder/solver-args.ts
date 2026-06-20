import type { PlanObjectType } from "@platform/contracts";

/**
 * FDE 求解器参数自动倒推（确定性纯函数 R6）：从 comprehend 出的对象类型的**字段 + ref 结构**
 * 推导出多跳求解器调用所需的"路径/字段映射"参数,使"故事→建域→在启动器点一下出答案"成立——
 * 这正是数据构建发动机的核心智能（用户："自动填好多跳路径/字段映射"）。
 *
 * 只覆盖 args 可由 schema 唯一确定的求解器（shared_bottleneck/concentration_risk/margin_attribution）；
 * 需运行期标量(rootId/budget)的求解器(supplier_disruption_radius/selection_optimize)不在此自动填——
 * 诚实留空,由用户/故事提供,而非编造。推不出 → 返回 undefined（不绑垃圾参数,启动器据缺口诚实报）。
 */

type Prop = PlanObjectType["properties"][number];

const CAPACITY_RE = /产能|capacity|cap|容量|上限|可用|额定/i;
const DEMAND_RE = /需求|demand|qty|数量|用量|消耗|negotiat|订量|需量/i;
const PRIORITY_RE = /优先|priority|prio|级别|等级|权重/i;
const REVENUE_RE = /营收|revenue|售价|单价|price|收入|金额|amount|售/i;
const COST_RE = /成本|cost|费用|损|料价|原料|开支|支出|耗费/i;

const num = (t: PlanObjectType): Prop[] => t.properties.filter((p) => p.dataType === "number" && !p.isPrimaryKey);
const refs = (t: PlanObjectType): Prop[] => t.properties.filter((p) => p.dataType === "ref" || !!p.refToTypeKey);
const pick = (props: Prop[], re: RegExp): Prop | undefined => props.find((p) => re.test(p.propKey));
const byKey = (a: PlanObjectType, b: PlanObjectType) => a.typeKey.localeCompare(b.typeKey);

/** 共享瓶颈：资源类型(有产能字段、被引用) + 共享者类型(引用资源、有需求字段)。 */
function deriveSharedBottleneck(types: PlanObjectType[]): Record<string, unknown> | undefined {
  const sorted = [...types].sort(byKey);
  // 候选：(资源 R, 共享者 S, viaField)——S 有 ref→R 且 R/S 都有数值字段
  for (const R of sorted) {
    if (num(R).length === 0) continue;
    for (const S of sorted) {
      if (S.typeKey === R.typeKey) continue;
      const via = refs(S).find((p) => p.refToTypeKey === R.typeKey);
      if (!via || num(S).length === 0) continue;
      const capacityField = (pick(num(R), CAPACITY_RE) ?? num(R)[0])!.propKey;
      const demandField = (pick(num(S), DEMAND_RE) ?? num(S)[0])!.propKey;
      const priorityProp = pick(num(S), PRIORITY_RE);
      return {
        resourceType: R.typeKey,
        sharedByType: S.typeKey,
        viaField: via.propKey,
        capacityField,
        demandField,
        ...(priorityProp ? { priorityField: priorityProp.propKey } : {}),
      };
    }
  }
  return undefined;
}

/** 隐性集中度：沿 ref 正向链从起点走到终端根；取能走出的最长链（≥1 跳）。 */
function deriveConcentrationRisk(types: PlanObjectType[]): Record<string, unknown> | undefined {
  const map = new Map(types.map((t) => [t.typeKey, t]));
  const walk = (start: PlanObjectType): { viaField: string; toType: string }[] => {
    const path: { viaField: string; toType: string }[] = [];
    const seen = new Set<string>([start.typeKey]);
    let cur: PlanObjectType | undefined = start;
    while (cur) {
      // 取确定性的第一个出向 ref（按 propKey 排序）走下一跳
      const out = refs(cur).filter((p) => p.refToTypeKey && map.has(p.refToTypeKey!) && !seen.has(p.refToTypeKey!)).sort((a, b) => a.propKey.localeCompare(b.propKey))[0];
      if (!out) break;
      path.push({ viaField: out.propKey, toType: out.refToTypeKey! });
      seen.add(out.refToTypeKey!);
      cur = map.get(out.refToTypeKey!);
    }
    return path;
  };
  let best: { start: string; path: { viaField: string; toType: string }[] } | undefined;
  for (const t of [...types].sort(byKey)) {
    const path = walk(t);
    if (path.length >= 1 && (!best || path.length > best.path.length)) best = { start: t.typeKey, path };
  }
  if (!best) return undefined;
  return { startType: best.start, path: best.path };
}

/** 毛利倒挂：目标类型(有营收字段 + ≥1 成本字段)；costFields=成本类数值字段。 */
function deriveMarginAttribution(types: PlanObjectType[]): Record<string, unknown> | undefined {
  for (const T of [...types].sort(byKey)) {
    const rev = pick(num(T), REVENUE_RE);
    if (!rev) continue;
    const costs = num(T).filter((p) => p.propKey !== rev.propKey && COST_RE.test(p.propKey));
    if (costs.length === 0) continue;
    return {
      targetType: T.typeKey,
      revenueField: rev.propKey,
      costFields: costs.map((c) => ({ field: c.propKey, label: c.propKey })),
    };
  }
  return undefined;
}

const DERIVERS: Record<string, (types: PlanObjectType[]) => Record<string, unknown> | undefined> = {
  shared_bottleneck: deriveSharedBottleneck,
  concentration_risk: deriveConcentrationRisk,
  margin_attribution: deriveMarginAttribution,
};

/** 给定求解器键 + 倒推出的对象类型,返回可贯通到启动器的调用参数；推不出/不支持 → undefined。 */
export function deriveSolverArgs(solverKey: string, objectTypes: PlanObjectType[]): Record<string, unknown> | undefined {
  return DERIVERS[solverKey]?.(objectTypes);
}
