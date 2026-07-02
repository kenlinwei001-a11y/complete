import type { CSSProperties, ReactNode } from "react";
import type { SolverDataMode } from "@platform/contracts";

/**
 * WO-KILL-MOCK-RED · 阶段②（前端消费门·治本）—— 决策值渲染门。
 *
 * 用户第一性原则：推演/决策/告警必须基于**真实数据**。诚实标注 mock ≠ 满足原则——
 * 把假的老实贴个「估算」徽章，它还是假的。治本 = 把 `dataMode` 从「徽章」升级为「渲染门」：
 * `dataMode!=="LIVE"`（MOCK/SYNTHETIC/无真源）⇒ 决策级输出（红/越线/✗/峰值削减/裁决/推荐）
 * 一律**排除/灰/空态**，**绝不渲染为可行动结论**。
 *
 * 本文件是唯一入口，替换全前端 `heatColor(v,threshold)` / `>=threshold?var(--danger)` 直用点。
 */

/** dataMode 是否允许出决策级结论（红/越线/裁决）。仅 LIVE 为真数据。 */
export function isLiveDecision(dataMode?: SolverDataMode | string | null): boolean {
  return dataMode === "LIVE";
}

/**
 * 显式非 LIVE（MOCK/SYNTHETIC/STALE/PARTIAL）→ true（抑制决策红）；
 * 未标 dataMode（undefined/null）→ false（向后兼容：旧 fixture / 真 LIVE 未回传时不误灰）。
 * 与 RiskBoardView 既有 `dm != null && dm !== "LIVE"` 判据同源，供全站分类型裁决门统一复用。
 */
export function notLiveDecision(dataMode?: SolverDataMode | string | null): boolean {
  return dataMode != null && dataMode !== "LIVE";
}

/**
 * 分类型裁决色门（站不住 / 不建议接 / ⛔硬约束违反 / ✗缺口 等**非阈值型**裁决色）：
 * 显式非 LIVE ⇒ 中性灰（合成/估算不出决策红）；LIVE 或未标 ⇒ 保持传入的 liveColor。
 * 与 decisionColor（阈值型数值）互补，同守 KILL-MOCK-RED 红线——决策级红只在真数据出。
 */
export function decisionVerdictColor(
  liveColor: string,
  dataMode?: SolverDataMode | string | null,
  muted = "var(--muted)",
): string {
  return notLiveDecision(dataMode) ? muted : liveColor;
}

/**
 * 决策级色门：值越阈 → danger 红，仅当 `dataMode==="LIVE"`（真数据）。
 * 非 LIVE（MOCK/SYNTHETIC/STALE/PARTIAL/无真源）或 value 为 null → 返回中性灰 `var(--muted)`，**绝不返 danger 红**。
 * 替换裸 `v>=threshold?var(--danger):...` 与 heatColor 决策用法。
 *
 * @param opts.calm  正常档色（低于关注档），默认 var(--txt)。LIVE 时正常档也用此色。
 * @param opts.midGap 关注档（黄）阈值差，默认 15；仅 LIVE 生效。
 */
export function decisionColor(
  value: number | null | undefined,
  threshold: number,
  dataMode?: SolverDataMode | string | null,
  opts?: { danger?: string; warn?: string; calm?: string; muted?: string; midGap?: number },
): string {
  const danger = opts?.danger ?? "var(--danger)";
  const warn = opts?.warn ?? "var(--amber)";
  const calm = opts?.calm ?? "var(--txt)";
  const muted = opts?.muted ?? "var(--muted)";
  const midGap = opts?.midGap ?? 15;
  // 渲染门：非真数据 或 无值 → 中性灰，不参与决策着色。
  if (value == null || !isLiveDecision(dataMode)) return muted;
  if (value >= threshold) return danger;
  if (value >= threshold - midGap) return warn;
  return calm;
}

/**
 * 决策级 heat 门（复刻 RiskPopover.heatColor 的三档 rgba 但受 dataMode 守卫）。
 * 非 LIVE / null → 中性灰 rgba（不出红/黄）。有真数据才三档着色。
 * 替换 heatColor(v,threshold) 在决策网格/日条上的直用点。
 */
export function decisionHeat(
  value: number | null | undefined,
  threshold: number,
  dataMode?: SolverDataMode | string | null,
): string {
  if (value == null || !isLiveDecision(dataMode)) return "rgba(154,168,182,.28)"; // 中性灰（var(--muted) 同色系）
  if (value >= threshold) return "rgba(224,98,108,.85)";
  if (value >= threshold - 15) return "rgba(232,181,74,.7)";
  return `rgba(67,183,215,${0.15 + (Math.max(0, value) / 100) * 0.55})`;
}

/** 非 LIVE 时对越线/峰值/裁决文案的统一降级措辞（诚实空态·不出可行动结论）。 */
export const NON_LIVE_HINT = "估算·不可作决策依据";
export const NO_DATA_HINT = "无真实数据·不参与越线判定·请接入实测数据（连接器与上传）";

/**
 * <DecisionValue>：渲染一个可能越阈的决策数值。
 * - LIVE 且有值：正常按 decisionColor 着色（越阈红），可显 crossedLabel 徽标。
 * - 非 LIVE 或无值：降级为中性灰值 + "估算·不可作决策依据"（或传 emptyText 走空态），**不出红/不显越线**。
 */
export function DecisionValue({
  value,
  threshold,
  dataMode,
  format,
  suffix,
  emptyText,
  hint,
  testId,
  style,
  crossedLabel,
}: {
  value: number | null | undefined;
  threshold: number;
  dataMode?: SolverDataMode | string | null;
  /** 值格式化（默认四舍五入整数）。 */
  format?: (v: number) => string;
  suffix?: ReactNode;
  /** 无值时的空态文案（传则走空态·不渲染数值）。 */
  emptyText?: ReactNode;
  /** 非 LIVE 时附加的降级提示（默认 NON_LIVE_HINT）；传 null 关闭。 */
  hint?: ReactNode | null;
  testId?: string;
  style?: CSSProperties;
  /** LIVE 越阈时显示的徽标（如「越线」）。 */
  crossedLabel?: ReactNode;
}) {
  const live = isLiveDecision(dataMode);
  const fmt = format ?? ((v: number) => `${Math.round(v)}`);

  if (value == null) {
    return (
      <span data-testid={testId} style={style}>
        <b className="mono" style={{ color: "var(--muted)" }}>{emptyText ?? "—"}</b>
      </span>
    );
  }

  const color = decisionColor(value, threshold, dataMode);
  const crossed = live && value >= threshold;
  const showHint = !live && hint !== null;

  return (
    <span data-testid={testId} style={style}>
      <b className="mono" style={{ color }}>{fmt(value)}</b>
      {suffix}
      {crossed && crossedLabel != null && (
        <span data-testid={testId ? `${testId}-crossed` : undefined} style={{ marginLeft: 4, color: "var(--danger)", fontSize: 11 }}>{crossedLabel}</span>
      )}
      {showHint && (
        <span data-testid={testId ? `${testId}-hint` : undefined} style={{ marginLeft: 4, color: "var(--muted2)", fontSize: 10 }}>{hint ?? NON_LIVE_HINT}</span>
      )}
    </span>
  );
}
