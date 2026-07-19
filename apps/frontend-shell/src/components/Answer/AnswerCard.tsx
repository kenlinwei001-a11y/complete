import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Answer } from "@platform/contracts";
import { sendFeedback } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { AnswerBlockView } from "./AnswerBlocks";
import { ValidationTracePanel } from "./ValidationTracePanel";
import styles from "./AnswerCard.module.css";

/**
 * 回答卡：信任级视觉全局一致、不得变体（PRD §5）。
 * VERIFIED_WORKFLOW → 绿色徽章「已验证 · 工作流」
 * AGENT_EXPLORATORY → 琥珀徽章「探索 · AI」+ 虚线边框
 * unverifiedNumerics → 顶部琥珀警示条
 */
export function AnswerCard({
  answer,
  taskId,
  showFeedback = true,
  showDetailLink = true,
  onRetry,
}: {
  answer: Answer;
  taskId: string;
  showFeedback?: boolean;
  showDetailLink?: boolean;
  /** CL.7：gap 块"继续推演"重跑原问句（QueryDock 注入）。 */
  onRetry?: () => void;
}) {
  const exploratory = answer.trustLevel === "AGENT_EXPLORATORY";
  const provOrder = useMemo(() => answer.provenance.map((p) => p.id), [answer.provenance]);
  const provIndex = (provId: string) => {
    const i = provOrder.indexOf(provId);
    return i >= 0 ? i + 1 : 0;
  };
  const [voted, setVoted] = useState<"UP" | "DOWN" | null>(null);

  const vote = async (v: "UP" | "DOWN") => {
    try {
      await sendFeedback(taskId, v);
      setVoted(v);
      toast(zh.dock.feedbackDone, "success");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className={`${styles.card} ${exploratory ? styles.exploratory : ""}`} data-testid="answer-card" data-trust={answer.trustLevel}>
      {answer.unverifiedNumerics && (
        <div className={styles.warnStrip} data-testid="unverified-strip">
          ⚠ {zh.dock.unverifiedStrip}
        </div>
      )}
      <div className={styles.head}>
        {answer.trustLevel === "VERIFIED_WORKFLOW" ? (
          <span className="badge green" data-testid="trust-badge">
            ✓ {zh.dock.verifiedBadge}
          </span>
        ) : (
          <span className="badge amber" data-testid="trust-badge">
            ◇ {zh.dock.exploratoryBadge}
          </span>
        )}
        {/* WO-REAL-LLM-FREE-QUERY 诚实三态之三：AGENT_EXPLORATORY = path-B 真 LLM 深问（据页/块上下文·工具取证）。
            与 solver「确定性求解」/ DecisionPlay「策略推理·确定性生成」互斥——绝不把真 LLM 输出标"数据库事实"。 */}
        {exploratory && (
          <span className="badge" data-testid="answer-reasoning-mode" style={{ marginLeft: 6, color: "var(--muted)", borderColor: "var(--line2)", fontSize: 10 }}>
            {zh.dock.llmReasoningBadge}
          </span>
        )}
      </div>
      <div className={styles.blocks}>
        {answer.blocks.map((b, i) => (
          <AnswerBlockView key={i} block={b} taskId={taskId} provIndex={provIndex} onRetry={onRetry} />
        ))}
      </div>
      {answer.validationTrace && <ValidationTracePanel trace={answer.validationTrace} />}
      {(showFeedback || showDetailLink) && (
        <div className={styles.foot}>
          {showFeedback && (
            <span className={styles.votes}>
              <button
                className={`${styles.voteBtn} ${voted === "UP" ? styles.votedOn : ""}`}
                aria-label={zh.dock.feedbackUp}
                onClick={() => void vote("UP")}
                disabled={voted != null}
              >
                👍
              </button>
              <button
                className={`${styles.voteBtn} ${voted === "DOWN" ? styles.votedOn : ""}`}
                aria-label={zh.dock.feedbackDown}
                onClick={() => void vote("DOWN")}
                disabled={voted != null}
              >
                👎
              </button>
            </span>
          )}
          {showDetailLink && (
            <Link to={`/tasks/${taskId}`} className={styles.detailLink}>
              {zh.dock.viewTask} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
