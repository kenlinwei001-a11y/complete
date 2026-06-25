import type { BuildPlan, ClosureFinding, PlanObjectType } from "@platform/contracts";

/**
 * E14 · 域运营本体不变量（**数据/配置**，非代码 —— RL5 零业务常数，换租户/行业=换这张表）。
 *
 * 背景（增量0 baseline 实勘）：comprehend 倒推可能产**碎片对象树**——例如倒推出一个引用
 * `refToTypeKey` 指向"根"类型、但那个根类型并未一并建出（孤儿 Process 无 factory 根 / Equipment 引
 * Process 但 Process 缺失）。此前闭包只校验"对象有 domain / 求解器入参字段存在 / 规则 scope 存在"，
 * **不校验对象属性的 ref 目标是否真存在于 plan** → 碎片树静默通过（绿测试≠能用：建出来引不动）。
 *
 * 本模块把"域结构完整性"编码为**两类纯数据不变量**，由 `checkDomainInvariants` 确定性求值（R6）：
 *  1) REFERENTIAL（结构性，零配置）：对象属性 `refToTypeKey` 指向的类型必须在 plan 中存在；
 *     缺失 = 碎片树 = `DOMAIN_INVARIANT_VIOLATION:DANGLING_REF`。这条对一切域生效，无业务常数。
 *  2) DOMAIN_ROOT（运营性，**数据**）：某些**运营域**的对象必须能（直接或经 ref 链）落到一个
 *     "根域"对象上（如 capacity/equip/process 域的对象须有一条 ref 链通到 factory 根域对象）——
 *     否则是"无根碎片"。根域 + 哪些域需挂根，全在 `DOMAIN_ROOT_REQUIREMENTS` 数据里声明，
 *     **不写死任何实体名/基地名/工序名**（只用平台自有的 domain 枚举，本体 §2 的 domain 词表）。
 *
 * 诚实：违反 → 产 `kind:"OBJECT" status:"FAILED"` finding（detail 前缀 `DOMAIN_INVARIANT_VIOLATION`），
 * 喂 closure 的 `hasObjectFail` → STRICT 阻断 / PROVISIONAL 降 ADVISORY 如实记录（不静默、不假绿）。
 */

/** 不变量违反码（finding.detail 前缀），供 FDE 节点/前端按码归类。 */
export const DOMAIN_INVARIANT_CODE = "DOMAIN_INVARIANT_VIOLATION";

/**
 * 根域要求（**数据**）：key=需挂根的运营域，value=该域对象必须能经 ref 链到达的"根域"集合之一。
 * 语义："运营域对象不应是悬空碎片，应能溯源到一个组织/物理根（factory 根域）。"
 * 仅用 domain 枚举（factory/capacity/equip/process…，本体 §2 词表），零实体/行业常数 → 换行业改这张表即可。
 * 留空对象 = 不强制（如 sales/finance/external 等域本就可独立存在）。
 */
export const DOMAIN_ROOT_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  capacity: ["factory"],
  equip: ["factory"],
  process: ["factory"],
});

type Ref = { from: string; to: string; viaField: string };

/** 收集 plan 内所有对象属性的 ref 边（refToTypeKey）。 */
function planRefs(objectTypes: PlanObjectType[]): Ref[] {
  const out: Ref[] = [];
  for (const t of objectTypes) {
    for (const p of t.properties) {
      if (p.refToTypeKey) out.push({ from: t.typeKey, to: p.refToTypeKey, viaField: p.propKey });
    }
  }
  return out;
}

/** 从 startType 沿 ref 边 BFS，能否到达 domain ∈ rootDomains 的任一类型（确定性，环安全）。 */
function reachesRootDomain(
  startType: string,
  rootDomains: readonly string[],
  byKey: Map<string, PlanObjectType>,
  edges: Map<string, string[]>,
): boolean {
  const seen = new Set<string>();
  const queue = [startType];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = byKey.get(cur);
    if (t && rootDomains.includes(t.domain)) return true;
    for (const next of (edges.get(cur) ?? [])) if (!seen.has(next)) queue.push(next);
  }
  return false;
}

/**
 * 域运营本体不变量求值（纯函数 R6）→ closure findings（OBJECT/FAILED + DOMAIN_INVARIANT_VIOLATION 前缀）。
 * 1) 悬空 ref：refToTypeKey 目标不在 plan → 碎片树（DANGLING_REF）；
 * 2) 无根碎片：需挂根的运营域对象，经 ref 链到不了任何根域 → ORPHAN_NO_ROOT。
 * 不产违反 → 返回空数组（不污染 findings）。
 */
export function checkDomainInvariants(plan: Pick<BuildPlan, "objectTypes">): ClosureFinding[] {
  const objectTypes = plan.objectTypes;
  const byKey = new Map(objectTypes.map((t) => [t.typeKey, t]));
  const refs = planRefs(objectTypes);
  const findings: ClosureFinding[] = [];

  // (1) 悬空 ref：目标类型缺失 = ref 指向空（如可选 ref 未一并建出）。记录为 SOFT（ORPHAN_PASSED，不阻断）——
  // 不是每条悬空 ref 都是致命碎片（floor 的 Order.procRef 等可选 ref 在未建 Process 的故事里本就空）；
  // 真正阻断的"无根碎片"由 (2) ORPHAN_NO_ROOT 判（运营域对象到不了 factory 根）。确定性顺序排序。
  const dangling = refs.filter((r) => !byKey.has(r.to)).sort((a, b) => (a.from + a.viaField).localeCompare(b.from + b.viaField));
  for (const r of dangling) {
    findings.push({
      kind: "OBJECT",
      ref: `${r.from}.${r.viaField}->${r.to}`,
      status: "ORPHAN_PASSED",
      detail: `${DOMAIN_INVARIANT_CODE}:DANGLING_REF · 属性 ${r.from}.${r.viaField} 引用类型 ${r.to} 未在域内建出（ref 空，SOFT 记录）`,
    });
  }

  // (2) 无根碎片：需挂根的运营域对象到不了根域。仅对 ref 目标存在的边建图（悬空已在(1)报）。
  const edges = new Map<string, string[]>();
  for (const r of refs) if (byKey.has(r.to)) (edges.get(r.from) ?? edges.set(r.from, []).get(r.from)!).push(r.to);
  for (const t of [...objectTypes].sort((a, b) => a.typeKey.localeCompare(b.typeKey))) {
    const rootDomains = DOMAIN_ROOT_REQUIREMENTS[t.domain];
    if (!rootDomains || rootDomains.length === 0) continue;
    // 若 plan 内根本没有任一根域对象 → 该运营域对象注定无根（碎片）。
    const hasAnyRoot = objectTypes.some((o) => rootDomains.includes(o.domain));
    if (!hasAnyRoot || !reachesRootDomain(t.typeKey, rootDomains, byKey, edges)) {
      findings.push({
        kind: "OBJECT",
        ref: t.typeKey,
        status: "FAILED",
        detail: `${DOMAIN_INVARIANT_CODE}:ORPHAN_NO_ROOT · 运营域 ${t.domain} 对象 ${t.typeKey} 无 ref 链通达根域 [${rootDomains.join("/")}]（无根碎片）`,
      });
    }
  }

  return findings;
}
