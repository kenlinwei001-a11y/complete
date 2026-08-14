import { useEffect, useState } from "react";
import type { RoleTrack, StepRow, TaskStreamState } from "@/sse/taskStreamReducer";
import { selectRoleTracks, selectStepRows } from "@/sse/taskStreamReducer";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
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

/**
 * WO-FE-AGENT-TRACE：旁白文本被后端加了 `【角色名】` 前缀（`orchestrator.ts:2539`），
 * 那是"前端丢字段"年代的权宜之计——现在角色由结构化字段单独成栏，前缀就是重复。
 * **只在前缀与本行角色名逐字相同时**剥离；不同/没有则原样保留（绝不猜着删用户看得见的字）。
 */
export function stripRolePrefix(text: string, roleLabel?: string): string {
  if (!roleLabel) return text;
  const p = `【${roleLabel}】`;
  return text.startsWith(p) ? text.slice(p.length) : text;
}

/** 流式过程时间线（PRD §6.3） */
export function Timeline({ state }: { state: TaskStreamState }) {
  const steps = selectStepRows(state);
  // WO-FE-AGENT-TRACE：多角色会诊时按角色分栏；非 Coordinator 任务 tracks 为空 → 走下方原平铺渲染（逐字节不变）。
  const { tracks, ungrouped } = selectRoleTracks(state);
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
            /*
              WO-UNIT-MEANING：此前渲染成「conf 0.94」——既不知道是什么、也不知道满分是 1 还是 100。
              量纲＝分类置信度 0–1（QOS `routing.completed` 事件 confidence，契约 qos.ts 为纯 z.number()、
              无 unit 字段可消费；agentcore 侧与阈值 tauHigh/tauMid 同尺度比较，恒 0–1），故就近写成「置信度 0.94/1」。
              WO-HOVER-LAYER：口径本身从原生 `title=` 迁到 InfoPopover
              （规范 §2 R-UI-3 明令禁止用 HTML title 属性充当浮层）。
            */
            /* `?` 触发器是**兄弟**不是子节点：data-testid="routing-confidence" 标的是那个**数值**，
               把触发器塞进去会污染它的 textContent（实测 f2.query-flow 断言 `^置信度 \d\.\d{2}\/1$` 当场红）。 */
            <span className="mono" style={{ fontSize: 12, color: "var(--muted2)" }}>
              <span data-testid="routing-confidence">置信度 {state.routing.confidence.toFixed(2)}/1</span>
              <InfoPopover topic={zh.sim.sandbox.info.routingConfidenceTopic} testId="routing-confidence">
                {zh.sim.sandbox.info.routingConfidenceBody}
              </InfoPopover>
            </span>
          )}
        </div>
      )}
      {/* 多角色会诊：一个角色一栏（roleLabel 就是给这个用的）。tracks 为空 → 整块不渲染。 */}
      {tracks.length > 0 && (
        <div className={styles.roleTracks} data-testid="role-tracks">
          {tracks.map((t) => (
            <RoleTrackView key={t.roleKey} track={t} />
          ))}
        </div>
      )}
      {(tracks.length > 0 ? ungrouped : steps).map((s) => (
        <StepLine key={s.stepId} row={s} />
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

/**
 * WO-FE-AGENT-TRACE · 角色栏：表头是「角色名 + 它是哪个 agent + 在答什么子问题」，
 * 栏内是该角色自己的步。**每一格都独立降级**——没有 agentId 就不出 agentId 那格，
 * 不出现「未知」「-」这类假值（本仓「诚实位在说谎」的老账）。
 */
function RoleTrackView({ track }: { track: RoleTrack }) {
  const running = track.rows.some((r) => r.running);
  return (
    <section className={styles.roleTrack} data-testid={`role-track-${track.roleKey}`} data-running={running || undefined}>
      <header className={styles.roleHead}>
        <span className={styles.roleLabel} data-testid={`role-label-${track.roleKey}`}>{track.roleLabel}</span>
        {track.agentId && (
          <span className="mono" style={{ fontSize: 12, color: "var(--muted2)" }} data-testid={`role-agent-${track.roleKey}`} title="执行该角色的 agent">
            {track.agentId}
          </span>
        )}
        {running && <span className={styles.spinner} />}
      </header>
      {track.subQuestion && (
        <div className={styles.roleSub} data-testid={`role-subq-${track.roleKey}`}>{track.subQuestion}</div>
      )}
      {track.rows.map((r) => (
        <StepLine key={r.stepId} row={r} />
      ))}
    </section>
  );
}

/** 一行步：旁白走气泡、工具步走可展开行。角色/轮次等结构化标识由各自组件按"有才显示"渲染。 */
function StepLine({ row }: { row: StepRow }) {
  return row.type === "agent_narration" ? (
    <NarrationRow text={stripRolePrefix(row.text ?? "", row.roleLabel)} roleLabel={row.roleLabel} iteration={row.iteration} />
  ) : (
    <StepRowView
      stepId={row.stepId}
      type={row.type}
      outcome={row.outcome}
      durationMs={row.durationMs}
      running={row.running}
      roleLabel={row.roleLabel}
      agentId={row.agentId}
      iteration={row.iteration}
    />
  );
}

/** WO-REASONING-TRACE：agent 每轮"思考旁白"气泡（💭·建人机信任·实时展示"为什么下一步这么做"·暗发 qos.reasoning-trace 才有）。 */
function NarrationRow({ text, roleLabel, iteration }: { text: string; roleLabel?: string; iteration?: number }) {
  if (!text.trim()) return null;
  return (
    <div
      data-testid="agent-narration"
      data-role={roleLabel}
      style={{
        display: "flex", gap: 6, alignItems: "flex-start", padding: "3px 8px", margin: "2px 0",
        fontSize: 12, fontStyle: "italic", color: "var(--muted2)",
        borderLeft: "2px solid var(--c-capacity, #43B7D7)", opacity: 0.9,
      }}
    >
      <span style={{ flexShrink: 0 }}>💭</span>
      {/* 角色/轮次各自独立：缺哪个就不出哪个 chip（不占位、不填假值） */}
      {roleLabel && <span className={styles.chipRole} data-testid="narration-role">{roleLabel}</span>}
      {iteration != null && <span className={styles.chipIter} data-testid="narration-iteration">{zh.dock.iterationChip(iteration)}</span>}
      <span style={{ whiteSpace: "pre-wrap", minWidth: 0 }}>{text}</span>
    </div>
  );
}

function StepRowView({
  stepId,
  type,
  outcome,
  durationMs,
  running,
  roleLabel,
  agentId,
  iteration,
}: {
  stepId: string;
  type: string;
  outcome?: string;
  durationMs?: number;
  running: boolean;
  roleLabel?: string;
  agentId?: string;
  iteration?: number;
}) {
  const [open, setOpen] = useState(false);
  const failed = outcome === "ERROR" || outcome === "FAILED";
  return (
    <div className={`${styles.step} ${failed ? styles.failed : ""}`} data-testid={`step-${stepId}`}>
      <button className={styles.stepHead} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.stepIcon}>{STEP_ICONS[type] ?? "•"}</span>
        <span className={styles.stepType}>{type}</span>
        {/* 结构化标识：有才显示（老任务/老事件没有这些字段是正常的，缺就整格不出） */}
        {roleLabel && <span className={styles.chipRole} data-testid={`step-role-${stepId}`}>{roleLabel}</span>}
        {iteration != null && <span className={styles.chipIter} data-testid={`step-iteration-${stepId}`}>{zh.dock.iterationChip(iteration)}</span>}
        <span className="mono" style={{ fontSize: 12, color: "var(--muted2)" }}>
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
          {agentId && <span className="mono" data-testid={`step-agent-${stepId}`}> · agentId: {agentId}</span>}
        </div>
      )}
    </div>
  );
}
