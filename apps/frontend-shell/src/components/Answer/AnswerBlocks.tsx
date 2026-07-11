import { Fragment, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AnswerBlock, SimulationRequest } from "@platform/contracts";
import { Markdown, renderInline } from "@/components/ui/markdown";
import { ProvHoverArea, ProvMark } from "@/components/Provenance/ProvTrigger";
import { useSessionStore } from "@/store/sessionStore";
import { GapCard } from "./GapCard";
import zh from "@/locales/zh";
import styles from "./AnswerBlocks.module.css";

/**
 * AnswerBlock 渲染器（PRD §6.5，契约固定，每种 block 一个组件）。
 */
export function AnswerBlockView({
  block,
  taskId,
  provIndex,
  onRetry,
}: {
  block: AnswerBlock;
  taskId: string;
  provIndex: (provId: string) => number;
  onRetry?: () => void;
}) {
  switch (block.type) {
    case "text":
      return <TextBlock markdown={block.markdown} taskId={taskId} provIndex={provIndex} />;
    case "table":
      return <TableBlock columns={block.columns} rows={block.rows} provId={block.provId} taskId={taskId} provIndex={provIndex} />;
    case "kpi":
      return <KpiBlock label={block.label} value={block.value} unit={block.unit} provId={block.provId} taskId={taskId} />;
    case "rule_violation":
      return (
        <RuleViolationBlock
          ruleId={block.ruleId}
          severity={block.severity}
          explanation={block.explanation}
          provId={block.provId}
          taskId={taskId}
          provIndex={provIndex}
        />
      );
    case "action_draft":
      return <ActionDraftBlock draftId={block.draftId} actionType={block.actionType} summary={block.summary} />;
    case "gap":
      // ONTO-SCEN-LAUNCH-DET §2.5：场景卡缺口附发育态 → GapCard 渲染诚实发育卡（缺 X · 工单深链）。
      return <GapCard report={block.report} scenario={block.scenario} onRetry={onRetry} />;
    case "sandbox_render":
      // WO-SANDBOX-AS-RENDER-TARGET（S1）：时序推演意图 → 答案先行横幅 + 「打开推演沙盘」（scenarioPreset 通道进沙盘）。
      return <SandboxRenderBlock request={block.request} headline={block.headline} />;
    default:
      return null;
  }
}

const REF_RE = /⟦ref:([^⟧]+)⟧/g;

/** text：markdown + ⟦ref:provId⟧ → 上标引用角标 */
export function TextBlock({
  markdown,
  taskId,
  provIndex,
}: {
  markdown: string;
  taskId: string;
  provIndex: (provId: string) => number;
}) {
  const inlineWithRefs = (line: string, key: string): ReactNode => {
    const parts: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(line)) !== null) {
      if (m.index > last) parts.push(<Fragment key={`${key}t${i}`}>{renderInline(line.slice(last, m.index), `${key}t${i}`)}</Fragment>);
      const provId = m[1]!;
      parts.push(<ProvMark key={`${key}r${i}`} provId={provId} taskId={taskId} index={provIndex(provId)} />);
      last = m.index + m[0].length;
      i++;
    }
    if (last < line.length) parts.push(<Fragment key={`${key}tail`}>{renderInline(line.slice(last), `${key}tail`)}</Fragment>);
    return <>{parts}</>;
  };

  return (
    <div className={styles.text}>
      <Markdown source={markdown} inlineRender={inlineWithRefs} />
    </div>
  );
}

/** table：紧凑数据表（原型 .cmp 样式）+ 表头右侧溯源角标 */
export function TableBlock({
  columns,
  rows,
  provId,
  taskId,
  provIndex,
}: {
  columns: string[];
  rows: (string | number | null)[][];
  provId: string;
  taskId: string;
  provIndex: (provId: string) => number;
}) {
  return (
    <div className={styles.tableWrap} data-testid="answer-table">
      <div className={styles.tableHead}>
        <span />
        <ProvMark provId={provId} taskId={taskId} index={provIndex(provId)} />
      </div>
      <table className="cmp">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (
                <td key={ci} className={typeof cell === "string" && /[一-鿿]/.test(cell) ? "zh" : ""}>
                  {cell == null ? "—" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** kpi：label/value/unit（value mono 大号），整卡可悬停溯源 */
export function KpiBlock({
  label,
  value,
  unit,
  provId,
  taskId,
}: {
  label: string;
  value: string;
  unit?: string;
  provId: string;
  taskId: string;
}) {
  return (
    <ProvHoverArea provId={provId} taskId={taskId} value={`${value}${unit ?? ""}`} label={label} className={styles.kpi} testId={`kpi-${provId}`}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </ProvHoverArea>
  );
}

/** rule_violation：红边卡 */
export function RuleViolationBlock({
  ruleId,
  severity,
  explanation,
  provId,
  taskId,
  provIndex,
}: {
  ruleId: string;
  severity: string;
  explanation: string;
  provId: string;
  taskId: string;
  provIndex: (provId: string) => number;
}) {
  return (
    <div className={styles.violation} data-testid="rule-violation">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="badge red">{ruleId}</span>
        <span className="badge">{severity}</span>
        <ProvMark provId={provId} taskId={taskId} index={provIndex(provId)} />
      </div>
      <p style={{ marginTop: 6, lineHeight: 1.6 }}>{explanation}</p>
    </div>
  );
}

/**
 * sandbox_render（WO-SANDBOX-AS-RENDER-TARGET·S1）：时序推演意图落地——答案先行横幅 + 「打开推演沙盘」。
 * 点按经 scenarioPreset 单一通道（C4·非 URL）把 SimulationRequest 关键槽落 store → 导航 /v/sim-sandbox →
 * SandboxView（渲染器）经 useScenarioPreset("sim-sandbox") 读取并按对象裁剪世界起跑推演（source=dialogue）。
 * headline=答案先行摘要（客户端逐 tick 补状态级结论）。
 */
export function SandboxRenderBlock({ request, headline }: { request: SimulationRequest; headline: string }) {
  const navigate = useNavigate();
  const setScenarioPreset = useSessionStore((s) => s.setScenarioPreset);
  const shock = request.scenario.find((a) => a.kind === "shock");
  const subject = request.scope.objectIds[0];
  const open = () => {
    // SimulationRequest 关键槽 → slotPresets（供 useScenarioPreset 读初值）；simRequest 全量随行（下游按需消费）。
    setScenarioPreset({
      targetView: "sim-sandbox",
      slotPresets: {
        subject,
        objectType: request.scope.objectType,
        horizonTicks: request.horizonTicks,
        source: request.source,
        ...(shock && shock.kind === "shock" ? { stateVar: shock.target.stateVar, delta: shock.delta } : {}),
        simRequest: request,
      },
      label: headline,
      nonce: crypto.randomUUID(),
    });
    navigate("/v/sim-sandbox");
  };
  return (
    <div className={styles.draft} data-testid="sandbox-render">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="badge">推演沙盘</span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{request.horizonTicks} tick</span>
      </div>
      <p style={{ margin: "6px 0", lineHeight: 1.6 }}>{headline}</p>
      <button type="button" className={styles.draftLink} onClick={open} data-testid="sandbox-render-open">
        打开推演沙盘 →
      </button>
    </div>
  );
}

/** action_draft：待审批徽章 + 摘要 + 跳转审批台 */
export function ActionDraftBlock({ draftId, actionType, summary }: { draftId: string; actionType: string; summary: string }) {
  return (
    <div className={styles.draft} data-testid="action-draft">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="badge amber">{zh.dock.pendingApproval}</span>
        <span className="mono" style={{ fontSize: 11 }}>{actionType}</span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{draftId}</span>
      </div>
      <p style={{ margin: "6px 0", lineHeight: 1.6 }}>{summary}</p>
      <Link to="/admin/actions" className={styles.draftLink}>
        {zh.dock.gotoActions} →
      </Link>
    </div>
  );
}
