import type { ReadinessResult } from "@platform/contracts";
import styles from "./pipeline.module.css";

const GRADE_LABEL: Record<string, string> = {
  NASCENT: "初生",
  DEVELOPING: "发育中",
  READY: "就绪",
};
const GRADE_CLASS: Record<string, string> = {
  NASCENT: "red",
  DEVELOPING: "amber",
  READY: "green",
};

/** 局部仿真准备度（PRD v2 §A.5「67/100」）：整体 + 各实体 + 各维度条形。 */
export function ReadinessGauge({ result }: { result: ReadinessResult }) {
  return (
    <div className={styles.gauge} data-testid="readiness-gauge">
      <div className={styles.gaugeHead}>
        <div className={styles.gaugeScore} data-testid="readiness-overall">
          <strong>{result.overall}</strong>
          <span>/100</span>
        </div>
        <span className={`badge ${GRADE_CLASS[result.grade] ?? ""}`} data-testid="readiness-grade">
          {GRADE_LABEL[result.grade] ?? result.grade}
        </span>
      </div>
      {result.entities.map((e) => (
        <div key={e.nodeId} className={styles.gaugeEntity} data-testid={`readiness-entity-${e.nodeId}`}>
          <div className={styles.gaugeEntityHead}>
            <span className="mono">{e.typeKey}</span>
            <span className="badge">{e.storageMode}</span>
            <span className={styles.gaugeEntityScore}>{e.score}/100</span>
          </div>
          {e.dimensions.map((d) => (
            <div key={d.key} className={styles.gaugeDim} data-testid={`readiness-dim-${e.nodeId}-${d.key}`}>
              <span className={styles.gaugeDimLabel}>{d.label}</span>
              <span className={styles.gaugeBar}>
                <span className={styles.gaugeBarFill} style={{ width: `${d.score}%` }} data-score={d.score} />
              </span>
              <span className={styles.gaugeDimScore}>{d.score}</span>
            </div>
          ))}
          {e.missing.length > 0 && (
            <div className={styles.gaugeMissing}>
              缺项：{e.missing.join("、")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default ReadinessGauge;
