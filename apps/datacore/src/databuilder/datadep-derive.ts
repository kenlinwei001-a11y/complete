import type { DataDependency, DataDependencyItem, PlanSolverNeed } from "@platform/contracts";
import { ROLE_CANONICAL } from "../solvers/datadep-context.js";

/**
 * DATADEP-C5-COMPREHEND-FILL · 站①「填充引擎」纯派生核（design-time·倒推填 keystone 清单契约）.
 *
 * 无副作用·无 LLM·无 service 依赖（仅 contracts + datadep-context 角色映射）→ comprehend 与 solvers/service
 * 皆可安全 import（避免 service↔comprehend 环）。分工（钉死）：**DataDependency 清单 = WHAT**（durable·R6·门守·
 * 进 runtime 就绪探测）；**倒推 = HOW**（design-time·LLM 产难点[对象类型/字段/求解器需求]、本模块机械派生清单结构·
 * 不进 runtime 热路径）。派生**只声明需求结构不产任何数值**（真数据仍确定性合成/真人正门）。
 *
 * 角色键（R14 抽象角色·零业务常数）：typeKey 若为 keystone 已登记 canonical 类型（Order/Base/…）→ 折回其抽象
 * 角色键（order/base/…）；否则（LLM 自造新类型 FooBar）→ 用 typeKey 本身作角色（就绪探测 resolveSolverType 回退
 * canonical==roleType==typeKey 可 listByType 计数）。typeKey 非"常州/NCM4680"业务实例名 → 不违 R14（门
 * datadep-manifest:check 只守 factory `SOLVER_DATADEP`·本 DRAFT 派生件不入 registry·不受门约束）。
 */
const CANONICAL_TO_ROLE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ROLE_CANONICAL).map(([role, canonical]) => [canonical, role])),
);

/** typeKey → 抽象角色键（R14）：命中 canonical 折回角色，否则原样 typeKey（DRAFT 新类型无抽象角色）。 */
export function typeKeyToRole(typeKey: string): string {
  return CANONICAL_TO_ROLE[typeKey] ?? typeKey;
}

/**
 * 从一个求解器的输入字段派生 `DataDependency` 清单（确定性·R6）。按 typeKey 分组 → 每组一条 require：
 * roleType（抽象角色·R14）· minRows=1（结构性下限·非业务量·design-time 不产数值）· props=该类型被用到的字段并集。
 * 空 inputFields → 空 requires（诚实·不硬造）。role/props 排序去重使字节一致（floor 与 LLM 派生同结果）。
 */
export function deriveDataDependency(
  inputFields: readonly { typeKey: string; propKey: string }[],
): DataDependency {
  const byType = new Map<string, Set<string>>();
  for (const f of inputFields) {
    if (!byType.has(f.typeKey)) byType.set(f.typeKey, new Set());
    if (f.propKey) byType.get(f.typeKey)!.add(f.propKey);
  }
  const requires: DataDependencyItem[] = [...byType.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([typeKey, props]) => {
      const item: DataDependencyItem = { roleType: typeKeyToRole(typeKey), minRows: 1 };
      if (props.size > 0) item.props = [...props].sort();
      return item;
    });
  return { requires };
}

/**
 * 从求解器**读取的对象类型集**派生 `DataDependency`（用于 P5 LLM 临时求解器 SolverGenSpec 无逐字段口径时·
 * 每类型一条 require·minRows=1·props 未知则省略）。确定性·R6。喂 SolverArtifact.requires（design-time·DRAFT→R4）。
 */
export function deriveDataDependencyFromTypes(typeKeys: readonly string[]): DataDependency {
  const requires: DataDependencyItem[] = [...new Set(typeKeys)]
    .sort()
    .map((typeKey) => ({ roleType: typeKeyToRole(typeKey), minRows: 1 }));
  return { requires };
}

/** 逐求解器倒推清单（solverKey→DataDependency）。填 BuildPlan.dataDependencies·喂 SolverArtifact.requires（DRAFT→R4）。 */
export function deriveDataDependencies(
  solverNeeds: readonly PlanSolverNeed[],
): Record<string, DataDependency> {
  const out: Record<string, DataDependency> = {};
  for (const s of solverNeeds) out[s.solverKey] = deriveDataDependency(s.inputFields);
  return out;
}

/** 给每个求解器需求挂上倒推出的 requires 清单（design-time·DRAFT·随 plan；晋升前非 durable 声明）。 */
export function withRequires(solverNeeds: PlanSolverNeed[]): PlanSolverNeed[] {
  return solverNeeds.map((s) => ({ ...s, requires: deriveDataDependency(s.inputFields) }));
}
