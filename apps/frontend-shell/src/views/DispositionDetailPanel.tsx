import { Provenance } from "@/components/Provenance";
import zh from "@/locales/zh";
import type { DispositionStep } from "@platform/contracts";
import styles from "./RiskBoardView.module.css";

export function DispositionDetailPanel({ steps }: { steps: DispositionStep[] }) {
  return (
    <div className={styles.rkDet} style={{ margin: 0, padding: 12, background: "var(--panel)" }} data-testid="disposition-detail-panel">
      <div className={styles.rkDetH} style={{ marginBottom: 8 }}>
        <b>{zh.risk.dispositionDetail.title}</b>
      </div>
      {steps.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.common.none}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {steps.map((s, i) => (
            <div
              key={i}
              style={{ padding: 10, border: "1px solid var(--line2)", borderRadius: 8, background: "rgba(226,235,245,.02)" }}
              data-testid={`disposition-step-${i}`}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                {i + 1}. {s.action}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{s.rationale}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8, fontSize: 11 }}>
                <span data-testid={`disposition-step-trigger-${i}`}>
                  <span style={{ color: "var(--muted2)" }}>{zh.risk.dispositionDetail.stepTrigger}:</span>{" "}
                  <b>{s.triggerValue}</b>
                </span>
                <span data-testid={`disposition-step-gap-${i}`}>
                  <span style={{ color: "var(--muted2)" }}>{zh.risk.dispositionDetail.stepClosesGap}:</span>{" "}
                  <b>{s.closesGap}</b>
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11 }} data-testid={`disposition-step-prov-${i}`}>
                <Provenance
                  objectType={s.provenance.drillType}
                  objectId={s.provenance.drillId}
                  src={s.provenance.kind}
                  formula={`${s.provenance.drillType}.${s.provenance.drillField} = ${s.provenance.drillValue}`}
                  note={zh.risk.dispositionDetail.stepProvenanceNote}
                >
                  {zh.risk.dispositionDetail.stepProvenance}
                </Provenance>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
