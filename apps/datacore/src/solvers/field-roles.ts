// A13 通用图求解器地板语义确定化：把"哪个类型/字段是 root/sink/resource/priority(地板)/leaf"的角色解析
// 做成**纯函数 + 结构信号 + 显式 tie-break**，去掉 LLM 消歧（R6）。真歧义时返回**确定性排序候选 + 置信度**
// （供 solver-args 取 top1 / A5 比差 / A4 让人选），**绝不调 Kimi**。命名辅助信号来自配置化词库（R14）。
import { lexiconHit } from "./field-role-lexicon.js";

// 结构子集（解耦 PlanObjectType/ObjectTypeDef，两者均结构兼容）。
export interface RoleResolverType {
  typeKey: string;
  properties: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string | null }[];
}
type Prop = RoleResolverType["properties"][number];
const numFields = (t: RoleResolverType): Prop[] => t.properties.filter((p) => p.dataType === "number" && !p.isPrimaryKey);
const outRefs = (t: RoleResolverType): Prop[] => t.properties.filter((p) => p.dataType === "ref" || !!p.refToTypeKey);

export interface RoleCandidate { value: string; score: number; signals: string[] }
export interface FieldRoleResolution {
  solverKey: string;
  /** 解析出的 top1 角色（类型角色给 typeKey，字段角色给 propKey）；解不出该角色 → 缺省不含此键。 */
  roles: Record<string, string>;
  /** 每角色的确定性排序候选（score 降序 + tie-break）。 */
  candidates: Record<string, RoleCandidate[]>;
  /** 置信度 [0,1]：top1 与 top2 分差越大越高；无候选=0。 */
  confidence: number;
  /** top1/top2 分差 < 阈值 → 真歧义（仍给确定性 top1 作默认 + 候选上报）。 */
  ambiguous: boolean;
}

/** 每通用求解器需要的角色集（类型角色/字段角色）。 */
export const SOLVER_FIELD_ROLES: Record<string, string[]> = {
  supplier_disruption_radius: ["rootType"], // 断供根（反向扇出起点）；rootId 是运行期标量,不在此
  concentration_risk: ["rootType", "sinkType"], // 扇出起点 + 收敛汇点
  shared_bottleneck: ["resourceType", "sharedByType", "priorityField"],
  margin_attribution: ["targetType", "revenueField"],
};

/** 结构信号：扇入(被多少类型 ref)/扇出(out-ref 数)，确定性。 */
function graphSignals(types: RoleResolverType[]): Map<string, { fanIn: number; fanOut: number }> {
  const sig = new Map(types.map((t) => [t.typeKey, { fanIn: 0, fanOut: 0 }]));
  for (const t of types) {
    for (const r of outRefs(t)) {
      if (!r.refToTypeKey || !sig.has(r.refToTypeKey)) continue;
      sig.get(t.typeKey)!.fanOut += 1;
      sig.get(r.refToTypeKey)!.fanIn += 1;
    }
  }
  return sig;
}

/** 确定性排序：score 降序 → value 字典序（固定 tie-break，R6）。 */
function rank(cands: RoleCandidate[]): RoleCandidate[] {
  return cands.slice().sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
}

/** top1/top2 分差 → 置信度 + ambiguous（差 ≥2 视为确定）。 */
function confidenceOf(ranked: RoleCandidate[]): { confidence: number; ambiguous: boolean } {
  if (ranked.length === 0) return { confidence: 0, ambiguous: false };
  if (ranked.length === 1) return { confidence: 1, ambiguous: false };
  const gap = ranked[0]!.score - ranked[1]!.score;
  const ambiguous = gap < 2;
  return { confidence: Math.min(1, 0.5 + gap * 0.2), ambiguous };
}

/**
 * 确定性角色解析。无 LLM、无随机；同 (types, solverKey) 字节一致。
 * 类型角色用 fanIn/fanOut + 命名词库打分；字段角色用类型/数值/命名打分。真歧义返回排序候选 + ambiguous。
 */
export function resolveFieldRoles(types: RoleResolverType[], solverKey: string): FieldRoleResolution {
  const sig = graphSignals(types);
  const sorted = [...types].sort((a, b) => a.typeKey.localeCompare(b.typeKey));
  const candidates: Record<string, RoleCandidate[]> = {};
  const roles: Record<string, string> = {};
  const need = SOLVER_FIELD_ROLES[solverKey] ?? [];

  const typeCand = (scoreFn: (t: RoleResolverType, s: { fanIn: number; fanOut: number }) => { score: number; signals: string[] } | null): RoleCandidate[] =>
    rank(sorted.flatMap((t) => {
      const r = scoreFn(t, sig.get(t.typeKey)!);
      return r && r.score > 0 ? [{ value: t.typeKey, score: r.score, signals: r.signals }] : [];
    }));

  for (const role of need) {
    let cands: RoleCandidate[] = [];
    if (role === "rootType" && solverKey === "supplier_disruption_radius") {
      // 断供根 = 被 ref 的终端汇点（disruption 沿"谁 ref 我"反向扇出）：fanIn>0 + 终端(fanOut=0) + 命名命中 source/supplier。
      cands = typeCand((t, s) => (s.fanIn === 0 ? null : { score: s.fanIn * 2 + (s.fanOut === 0 ? 2 : 0) + (lexiconHit(t.typeKey, "sourceSink") ? 3 : 0), signals: [`fanIn=${s.fanIn}`, ...(s.fanOut === 0 ? ["terminal"] : []), ...(lexiconHit(t.typeKey, "sourceSink") ? ["name:source"] : [])] }));
    } else if (role === "rootType") {
      // concentration_risk 起点 = 扇出多、命名命中 leaf（客户/订单 是分散起点）。
      cands = typeCand((t, s) => ({ score: s.fanOut * 2 + (lexiconHit(t.typeKey, "leaf") ? 3 : 0), signals: [`fanOut=${s.fanOut}`, ...(lexiconHit(t.typeKey, "leaf") ? ["name:leaf"] : [])] }));
    } else if (role === "sinkType") {
      cands = typeCand((t, s) => ({ score: s.fanIn * 2 + (lexiconHit(t.typeKey, "sourceSink") ? 3 : 0), signals: [`fanIn=${s.fanIn}`] }));
    } else if (role === "resourceType") {
      cands = typeCand((t, s) => ({ score: (s.fanIn > 0 ? 1 : 0) + (numFields(t).some((p) => lexiconHit(p.propKey, "capacity")) ? 3 : 0), signals: ["capacity-field"] }));
    } else if (role === "sharedByType") {
      cands = typeCand((t) => ({ score: outRefs(t).length > 0 && numFields(t).some((p) => lexiconHit(p.propKey, "demand")) ? 3 : 0, signals: ["demand-field+ref"] }));
    } else if (role === "targetType") {
      cands = typeCand((t) => ({ score: numFields(t).some((p) => lexiconHit(p.propKey, "revenue")) && numFields(t).some((p) => lexiconHit(p.propKey, "cost")) ? 4 : 0, signals: ["revenue+cost"] }));
    } else if (role === "priorityField" || role === "revenueField") {
      // 字段角色：在已解析的承载类型上挑命名命中的数值字段。
      const carrierRole = role === "priorityField" ? "sharedByType" : "targetType";
      const carrier = roles[carrierRole];
      const t = carrier ? types.find((x) => x.typeKey === carrier) : undefined;
      const lexKey = role === "priorityField" ? "priority" : "revenue";
      cands = t ? rank(numFields(t).filter((p) => lexiconHit(p.propKey, lexKey)).map((p) => ({ value: p.propKey, score: 2, signals: [`name:${lexKey}`] }))) : [];
    }
    candidates[role] = cands;
    if (cands.length > 0) roles[role] = cands[0]!.value;
  }

  // 整体置信度 = 最关键角色（need[0]）的置信度。
  const primary = candidates[need[0] ?? ""] ?? [];
  const { confidence, ambiguous } = confidenceOf(primary);
  return { solverKey, roles, candidates, confidence, ambiguous };
}
