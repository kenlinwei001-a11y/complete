import type { PropagationRule, SandboxViewConfig, SimDataMode } from "@platform/contracts";
import { DataModeBadge } from "@/components/DataModeBadge";

/**
 * WO-SANDBOX-TRUST-BADGE（S2·前端半·方案A）· 沙盘诚信位徽标——让每个数字标真假（用户"敢信"）。
 *
 * 复用既有 `DataModeBadge`（LIVE/SYNTHETIC/STALE 三档委托·零新色·既有 --warn token）；本封装额外承接两档：
 *  - UNCALIBRATED：传导系数为冷启动默认（coefficientRef 空·G-10）——**前端可自派生**（propRules 真读·非造）。
 *  - UNKNOWN（来源待披露）：后端尚未提供对象 origin/dataHealth 诚信位（datacore·Dev-1 域待补）——诚实标"来源待披露"，
 *    **绝不假标 LIVE**（KILL-MOCK-RED）。Dev-1 补 view-config.nodeObjectMode 后自动升 SYNTHETIC/LIVE/STALE。
 *
 * 诚实边界：SYNTHETIC/LIVE/STALE 需对象 origin（后端真判据）——前端只在后端提供 nodeObjectMode 时显之，否则退 UNKNOWN；
 * UNCALIBRATED 是前端能独立诚实派生的一档（不依赖后端）。
 */

export type SimBadgeMode = SimDataMode | "UNKNOWN";

const EXTRA: Record<"UNCALIBRATED" | "UNKNOWN", { label: string; title: string; warn: boolean }> = {
  UNCALIBRATED: { label: "系数未校准", title: "传导系数为冷启动默认值（未经校准·G-10）——推演方向可参考，量级不可当真值采信", warn: true },
  UNKNOWN: { label: "来源待披露", title: "该数字的数据来源诚信位后端尚未提供（对象 origin 待接入）——诚实不冒充实测", warn: false },
};

export function SimDataModeBadge({ mode, testId }: { mode?: SimBadgeMode | null; testId?: string }) {
  if (!mode) return null;
  // LIVE/SYNTHETIC/STALE → 委托既有 DataModeBadge（完全复用·零新色）。
  if (mode === "LIVE" || mode === "SYNTHETIC" || mode === "STALE") {
    return <DataModeBadge mode={mode} testId={testId ?? `sim-datamode-${mode}`} />;
  }
  const x = EXTRA[mode];
  if (!x) return null;
  return (
    <span
      className="badge"
      data-testid={testId ?? `sim-datamode-${mode}`}
      data-sim-datamode={mode}
      title={x.title}
      style={{ fontSize: 10, alignSelf: "flex-start", ...(x.warn ? { background: "var(--warn, #caa23a)", color: "#1a1400" } : { opacity: 0.8 }) }}
    >
      {x.label}
    </span>
  );
}

/** 诚信位不可信排序（LIVE 最可信 → STALE 最不可信·汇总取最弱·WO §3.2）。 */
const RANK: Record<SimBadgeMode, number> = { LIVE: 0, UNKNOWN: 1, UNCALIBRATED: 2, SYNTHETIC: 3, STALE: 4 };

/** 传导规则中系数未校准（coefficientRef 空）的目标状态变量集——UNCALIBRATED 前端真派生源（非造）。 */
export function uncalibratedStateVars(propRules: readonly PropagationRule[]): Set<string> {
  const s = new Set<string>();
  for (const r of propRules) if (!r.coefficientRef) s.add(r.targetStateVar);
  return s;
}

/**
 * 单格诚信位（对象 id × 状态变量）：后端 nodeObjectMode 优先（真 origin 派生）；否则前端派生 UNCALIBRATED（系数未校准）；
 * 都无 → UNKNOWN（来源待披露·诚实不臆断）。纯派生（R6）·绝不造 LIVE。
 */
export function cellDataMode(
  cfg: SandboxViewConfig,
  uncalSet: Set<string>,
  oid: string,
  stateVar: string,
): SimBadgeMode {
  const backend = cfg.nodeObjectMode?.[oid]?.[stateVar];
  if (backend) return backend;
  if (uncalSet.has(stateVar)) return "UNCALIBRATED";
  return "UNKNOWN";
}

/** 单状态变量汇总位（跨该变量所有携带对象取最不可信档）——每 stateVar KPI 一枚。纯派生·绝不造 LIVE。 */
export function stateVarDataMode(
  cfg: SandboxViewConfig,
  propRules: readonly PropagationRule[],
  stateVar: string,
): SimBadgeMode {
  const uncalSet = uncalibratedStateVars(propRules);
  const ids = Object.values(cfg.nodeObjectIds ?? {}).flat();
  let worst: SimBadgeMode = "LIVE";
  let any = false;
  for (const oid of ids) {
    any = true;
    const m = cellDataMode(cfg, uncalSet, oid, stateVar);
    if (RANK[m] > RANK[worst]) worst = m;
  }
  // 无携带对象 → 该变量本身若冷启动未校准则 UNCALIBRATED，否则 UNKNOWN（诚实不冒充 LIVE）。
  return any ? worst : uncalSet.has(stateVar) ? "UNCALIBRATED" : "UNKNOWN";
}

/** 单对象汇总位（跨该对象所有状态变量取最不可信档）——每基地卡一枚。纯派生·绝不造 LIVE。 */
export function objectDataMode(
  cfg: SandboxViewConfig,
  propRules: readonly PropagationRule[],
  oid: string,
): SimBadgeMode {
  const uncalSet = uncalibratedStateVars(propRules);
  const vars = cfg.stateVars ?? [];
  let worst: SimBadgeMode = "LIVE";
  let any = false;
  for (const v of vars) {
    any = true;
    const m = cellDataMode(cfg, uncalSet, oid, v);
    if (RANK[m] > RANK[worst]) worst = m;
  }
  return any ? worst : "UNKNOWN";
}

/** 汇总诚信位（取所有涉及格的最不可信档）——顶部"本次推演可信度"总位。 */
export function overallDataMode(
  cfg: SandboxViewConfig,
  propRules: readonly PropagationRule[],
): SimBadgeMode {
  const uncalSet = uncalibratedStateVars(propRules);
  let worst: SimBadgeMode = "LIVE";
  const ids = Object.values(cfg.nodeObjectIds ?? {}).flat();
  const vars = cfg.stateVars ?? [];
  let any = false;
  for (const oid of ids) {
    for (const v of vars) {
      any = true;
      const m = cellDataMode(cfg, uncalSet, oid, v);
      if (RANK[m] > RANK[worst]) worst = m;
    }
  }
  // 无对象/无变量（空世界）→ UNKNOWN（诚实·不冒充 LIVE）。
  return any ? worst : "UNKNOWN";
}

/** 汇总位 → 顶部人话摘要（"本次推演：…·仅供参考"）。零业务常数（纯诚信文案·R14）。 */
export function trustSummaryText(mode: SimBadgeMode): string {
  switch (mode) {
    case "LIVE": return "本次推演：数据实测·系数已校准——结论可作决策参考。";
    case "STALE": return "本次推演：关键数据源滞后——结论基于较早数据，谨慎采信。";
    case "SYNTHETIC": return "本次推演：合成数据（非真实接入）——用于演示/冷启动，不可当真实决策依据。";
    case "UNCALIBRATED": return "本次推演：传导系数未校准（冷启动默认）——方向可参考，量级仅供参考。";
    default: return "本次推演：数据来源诚信位待后端披露——诚实不冒充实测，仅供参考。";
  }
}
