import { useEffect, useState } from "react";
import type { TaskStreamState } from "@/sse/taskStreamReducer";
import { selectStepRows } from "@/sse/taskStreamReducer";
import zh from "@/locales/zh";
import styles from "./Timeline.module.css";

const STEP_ICONS: Record<string, string> = {
  resolve_slice: "▤",
  query_objects: "⌕",
  invoke_solver: "ƒ",
  evaluate_rules: "§",
  llm_compose: "✎",
  render_answer: "▦",
  create_action_draft: "✉",
  invoke_agent: "◇",
  invoke_mcp_tool: "⇄",
  tool_call: "⚙",
};

/** 流式过程时间线（PRD §6.3） */
export function Timeline({ state }: { state: TaskStreamState }) {
  const steps = selectStepRows(state);
  const [stale, setStale] = useState(false);

  // 心跳超过 30s 无事件 → 「仍在执行…」
  useEffect(() => {
    setStale(false);
    if (state.status !== "streaming" && state.status !== "connecting") return;
    const timer = setTimeout(() => setStale(true), 30_000);
    return () => clearTimeout(timer);
  }, [state.events.length, state.status]);

  const running = state.status === "streaming" || state.status === "connecting";

  return (
    <div className={styles.timeline} data-testid="task-timeline">
      {state.routing && (
        <div className={styles.routing} data-testid="routing-badge">
          {state.routing.path === "WORKFLOW" ? (
            <span className="badge green">{zh.dock.routedWorkflow(state.routing.intentKey ?? "")}</span>
          ) : (
            <span className="badge amber">◇ {zh.dock.exploreMode}</span>
          )}
          {state.routing.confidence != null && (
            <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>
              conf {state.routing.confidence.toFixed(2)}
            </span>
          )}
        </div>
      )}
      {steps.map((s) => (
        <StepRowView key={s.stepId} stepId={s.stepId} type={s.type} outcome={s.outcome} durationMs={s.durationMs} running={s.running} />
      ))}
      {running && (
        <div className={styles.spinnerRow}>
          <span className={styles.spinner} />
          {stale && <span data-testid="still-running">{zh.dock.running}</span>}
        </div>
      )}
    </div>
  );
}

function StepRowView({
  stepId,
  type,
  outcome,
  durationMs,
  running,
}: {
  stepId: string;
  type: string;
  outcome?: string;
  durationMs?: number;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const failed = outcome === "ERROR" || outcome === "FAILED";
  return (
    <div className={`${styles.step} ${failed ? styles.failed : ""}`} data-testid={`step-${stepId}`}>
      <button className={styles.stepHead} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.stepIcon}>{STEP_ICONS[type] ?? "•"}</span>
        <span className={styles.stepType}>{type}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--muted2)" }}>
          {stepId}
        </span>
        <span className={styles.stepRight}>
          {running ? (
            <span className={styles.spinner} />
          ) : (
            <>
              {failed && <span className="badge red">{outcome}</span>}
              {durationMs != null && <span className="mono">{durationMs}ms</span>}
            </>
          )}
        </span>
      </button>
      {open && (
        <div className={styles.stepDetail}>
          <span className="mono">stepId: {stepId}</span>
          {outcome && <span className="mono"> · outcome: {outcome}</span>}
        </div>
      )}
    </div>
  );
}
