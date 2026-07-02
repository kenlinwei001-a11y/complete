import type { SolverDataMode, SolverConfidence } from "@platform/contracts";
import { DataModeBadge } from "./DataModeBadge";
import { notLiveDecision } from "./DecisionValue";

/**
 * WO-DATAMODE-SWEEP · 决策页合成/估算披露横幅（移植自风险看板 `risk-confidence-banner` 范式）。
 *
 * KILL-MOCK-RED 红线：dataMode 显式非 LIVE（合成/估算/无真源）时，除了由
 * decisionVerdictColor/decisionColor 把决策红降级为中性灰，还必须在决策结论区**顶部诚实披露**
 * ——"此结论基于合成/估算数据，不作真实决策依据"，与风险看板一致（不再让合成裁决看起来像真裁决）。
 *
 * 未标 dataMode（undefined/null）⇒ 不渲染（向后兼容：真 LIVE / 旧 fixture 不出横幅）。
 */
export function DecisionModeBanner({
  dataMode,
  confidence,
  note,
  testId,
}: {
  dataMode?: SolverDataMode | string | null;
  confidence?: SolverConfidence | null;
  note?: string;
  testId?: string;
}) {
  if (!notLiveDecision(dataMode)) return null;
  return (
    <div
      data-testid={testId ?? "decision-mode-banner"}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        marginBottom: 10,
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid var(--warn, #caa23a)",
        background: "rgba(202,162,58,.10)",
      }}
    >
      <span style={{ fontSize: 11.5, color: "var(--warn, #caa23a)", fontWeight: 600 }}>
        ⚠ 此结论基于合成/估算数据（非真实接入）——不作真实决策依据；接入真实数据后自动转真实裁决
      </span>
      <DataModeBadge mode={dataMode} confidence={confidence} testId={testId ? `${testId}-badge` : undefined} />
      {note && <span style={{ fontSize: 11, color: "var(--muted2)" }}>{note}</span>}
    </div>
  );
}
