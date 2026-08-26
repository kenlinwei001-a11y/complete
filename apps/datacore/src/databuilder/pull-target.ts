/**
 * DF.6 拉取靶（PRD 生成接地层 §3.3，keystone）：视图声明它要拉取的求解器输出字段（pull target）——
 * 与 ModuleProvisioner/SHAPE 闭包互补的**输出侧反向-data**（R12）：
 * 拉取靶字段 ⊄ 求解器输出形状（SOLVER_OUTPUT_SHAPES） → 该求解器缺此输出字段 → TO_CREATE（倒序发育生长信号）。
 * 把"视图要、但求解器算不出"挡在建图期（G-8/G-2「绿测试≠能用」）。纯函数确定性（R6），与租户无关（R14）。
 */

/** 视图布局里与拉取靶相关的最小读模型（来自 ViewConfig.views[].layout）。 */
export interface ViewLayoutLike {
  key: string;
  layout?: { solverKey?: string; outputFields?: string[] } | Record<string, unknown>;
}

export interface ViewPullTarget {
  viewKey: string;
  solverKey: string;
  outputFields: string[];
}

/** 从视图集派生拉取靶登记表（仅声明了 solverKey + outputFields 的视图入册）。确定性排序。 */
export function deriveViewPullTargets(views: ViewLayoutLike[]): ViewPullTarget[] {
  const out: ViewPullTarget[] = [];
  for (const v of views) {
    const layout = (v.layout ?? {}) as { solverKey?: string; outputFields?: string[] };
    if (!layout.solverKey || !Array.isArray(layout.outputFields) || layout.outputFields.length === 0) continue;
    out.push({ viewKey: v.key, solverKey: layout.solverKey, outputFields: [...layout.outputFields] });
  }
  out.sort((a, b) => a.viewKey.localeCompare(b.viewKey));
  return out;
}

export interface PullTargetFinding {
  viewKey: string;
  solverKey: string;
  field: string;
  /** COVERED=求解器产出该字段 · UNMET=求解器缺此输出字段(→TO_CREATE) · SHAPE_UNKNOWN=求解器输出形状未声明(跳过判定) */
  status: "COVERED" | "UNMET" | "SHAPE_UNKNOWN";
}

/**
 * 拉取靶覆盖校验：逐 (视图, 字段) 比对求解器输出形状。
 * field 取顶层 key（容忍 `a.b`/`a[0]` 嵌套绑定，只校验顶层是否产出）。
 */
export function checkPullTargetCoverage(targets: ViewPullTarget[], shapes: Record<string, string[]>): PullTargetFinding[] {
  const findings: PullTargetFinding[] = [];
  for (const t of targets) {
    const shape = shapes[t.solverKey];
    const known = shape ? new Set(shape) : null;
    for (const f of t.outputFields) {
      const top = f.split(".")[0]!.split("[")[0]!;
      if (!known) findings.push({ viewKey: t.viewKey, solverKey: t.solverKey, field: top, status: "SHAPE_UNKNOWN" });
      else findings.push({ viewKey: t.viewKey, solverKey: t.solverKey, field: top, status: known.has(top) ? "COVERED" : "UNMET" });
    }
  }
  return findings;
}

/** 未满足的拉取靶（→ 求解器缺输出字段 → TO_CREATE 生长信号）。 */
export function unmetPullTargets(findings: PullTargetFinding[]): PullTargetFinding[] {
  return findings.filter((f) => f.status === "UNMET");
}
