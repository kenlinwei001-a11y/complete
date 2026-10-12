/**
 * 净室归因求解器·前端参数倒推（确定性纯函数·R6·KILL-MOCK）。
 *
 * 三个通用净室求解器（shared_bottleneck / concentration_risk / margin_attribution）的调用参数
 * 全部由**真实对象类型的字段 + ref 结构**倒推——绝不写死 upstreamType/rootType/itemType/viaField/costFields。
 * 逻辑与后端 apps/datacore/src/databuilder/solver-args.ts 同源（命名语义正则一字不差），
 * 使前端「选一个真对象类型 → 自动填好多跳路径/字段映射 → 调求解器」成立。
 *
 * 每个求解器暴露 `candidates(types)`：返回可跑的候选（按语义强度/链长确定性排序），
 * 首个即默认；候选的 `primary`（resourceType/startType/targetType）供下拉切换 → 换 args → 投影随之变。
 * 推不出 → 候选为空 → 视图诚实空态（不绑垃圾参数、不编数字）。
 */

export interface CrProp {
  propKey: string;
  dataType: string;
  isPrimaryKey?: boolean;
  refToTypeKey?: string | null;
  unit?: string;
}
export interface CrType {
  key: string;
  displayName: string;
  domain?: string;
  status?: string;
  properties: CrProp[];
}

// 命名语义正则（与后端 solver-args.ts 同源）。
const CAPACITY_RE = /产能|capacity|cap|容量|上限|可用|额定/i;
const DEMAND_RE = /需求|demand|qty|数量|用量|消耗|negotiat|订量|需量/i;
const PRIORITY_RE = /优先|priority|prio|级别|等级|权重/i;
const REVENUE_RE = /营收|revenue|售价|单价|price|收入|金额|amount|售/i;
const COST_RE = /成本|cost|费用|损|料价|原料|开支|支出|耗费/i;

const numProps = (t: CrType): CrProp[] => t.properties.filter((p) => p.dataType === "number" && !p.isPrimaryKey);
const refProps = (t: CrType): CrProp[] => t.properties.filter((p) => p.dataType === "ref" || !!p.refToTypeKey);
const pick = (props: CrProp[], re: RegExp): CrProp | undefined => props.find((p) => re.test(p.propKey));
const displayOf = (types: CrType[], key: string): string => types.find((t) => t.key === key)?.displayName ?? key;

// ---------------- shared_bottleneck ----------------
export interface BottleneckCandidate {
  /** 主选（资源类型），供下拉切换。 */
  primary: string;
  primaryLabel: string;
  sharedByLabel: string;
  args: {
    resourceType: string;
    sharedByType: string;
    viaField: string;
    capacityField: string;
    demandField: string;
    priorityField?: string;
  };
  score: number;
}

/**
 * 共享瓶颈候选：资源类型(有数值字段、被引用) × 共享者类型(引用资源、有需求字段)。
 * 按"字段名语义强度"打分（产能命名 +2 / 需求命名 +2 / 优先级 +1）；同资源取分最高的共享者。
 * 确定性 tie-break（typeKey 升序）。
 */
export function bottleneckCandidates(types: CrType[]): BottleneckCandidate[] {
  const sorted = [...types].sort((a, b) => a.key.localeCompare(b.key));
  const bestByResource = new Map<string, BottleneckCandidate>();
  for (const R of sorted) {
    if (numProps(R).length === 0) continue;
    for (const S of sorted) {
      if (S.key === R.key || numProps(S).length === 0) continue;
      const via = refProps(S).find((p) => p.refToTypeKey === R.key);
      if (!via) continue;
      const capProp = pick(numProps(R), CAPACITY_RE);
      const demProp = pick(numProps(S), DEMAND_RE);
      const priProp = pick(numProps(S), PRIORITY_RE);
      const score = (capProp ? 2 : 0) + (demProp ? 2 : 0) + (priProp ? 1 : 0);
      const cand: BottleneckCandidate = {
        primary: R.key,
        primaryLabel: R.displayName,
        sharedByLabel: S.displayName,
        args: {
          resourceType: R.key,
          sharedByType: S.key,
          viaField: via.propKey,
          capacityField: (capProp ?? numProps(R)[0])!.propKey,
          demandField: (demProp ?? numProps(S)[0])!.propKey,
          ...(priProp ? { priorityField: priProp.propKey } : {}),
        },
        score,
      };
      const prev = bestByResource.get(R.key);
      if (!prev || cand.score > prev.score || (cand.score === prev.score && S.key < prev.args.sharedByType)) {
        bestByResource.set(R.key, cand);
      }
    }
  }
  return [...bestByResource.values()].sort((a, b) => b.score - a.score || a.primary.localeCompare(b.primary));
}

// ---------------- concentration_risk ----------------
export interface ConcentrationCandidate {
  primary: string; // startType
  primaryLabel: string;
  rootType: string;
  rootLabel: string;
  args: { startType: string; path: { viaField: string; toType: string }[]; minDependents: number };
}

/** 沿 ref 正向链从起点走到终端根；取每个起点能走出的最长链（≥1 跳）。 */
function walk(start: CrType, map: Map<string, CrType>): { viaField: string; toType: string }[] {
  const path: { viaField: string; toType: string }[] = [];
  const seen = new Set<string>([start.key]);
  let cur: CrType | undefined = start;
  while (cur) {
    const out = refProps(cur)
      .filter((p) => p.refToTypeKey && map.has(p.refToTypeKey) && !seen.has(p.refToTypeKey))
      .sort((a, b) => a.propKey.localeCompare(b.propKey))[0];
    if (!out) break;
    path.push({ viaField: out.propKey, toType: out.refToTypeKey! });
    seen.add(out.refToTypeKey!);
    cur = map.get(out.refToTypeKey!);
  }
  return path;
}

export function concentrationCandidates(types: CrType[]): ConcentrationCandidate[] {
  const map = new Map(types.map((t) => [t.key, t]));
  const out: ConcentrationCandidate[] = [];
  for (const t of [...types].sort((a, b) => a.key.localeCompare(b.key))) {
    const path = walk(t, map);
    if (path.length < 1) continue;
    const rootType = path[path.length - 1]!.toType;
    out.push({
      primary: t.key,
      primaryLabel: t.displayName,
      rootType,
      rootLabel: displayOf(types, rootType),
      args: { startType: t.key, path, minDependents: 2 },
    });
  }
  // 链越长越可能暴露"暗线单点"，长链优先；确定性 tie-break。
  return out.sort((a, b) => b.args.path.length - a.args.path.length || a.primary.localeCompare(b.primary));
}

// ---------------- margin_attribution ----------------
export interface MarginCandidate {
  primary: string; // targetType
  primaryLabel: string;
  args: {
    targetType: string;
    revenueField: string;
    costFields: { field: string; label?: string }[];
    marginThreshold: number;
  };
}

/** 目标类型(有营收字段 + ≥1 成本字段)；costFields=成本类数值字段。 */
export function marginCandidates(types: CrType[]): MarginCandidate[] {
  const out: MarginCandidate[] = [];
  for (const T of [...types].sort((a, b) => a.key.localeCompare(b.key))) {
    const rev = pick(numProps(T), REVENUE_RE);
    if (!rev) continue;
    const costs = numProps(T).filter((p) => p.propKey !== rev.propKey && COST_RE.test(p.propKey));
    if (costs.length === 0) continue;
    out.push({
      primary: T.key,
      primaryLabel: T.displayName,
      args: {
        targetType: T.key,
        revenueField: rev.propKey,
        costFields: costs.map((c) => ({ field: c.propKey, label: c.propKey })),
        marginThreshold: 0,
      },
    });
  }
  return out;
}
