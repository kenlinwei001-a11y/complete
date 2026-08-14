import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AnswerBlock } from "@platform/contracts";
import { Markdown, renderInline } from "@/components/ui/markdown";
import { ProvHoverArea, ProvMark } from "@/components/Provenance/ProvTrigger";
import { GapCard } from "./GapCard";
import { KitProcurementLegs } from "./KitProcurementLegs";
import { buildKitOrderVMs, kitReadableRows } from "./kitProcurement";
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
      return <TableBlockOrKit columns={block.columns} rows={block.rows} provId={block.provId} taskId={taskId} provIndex={provIndex} />;
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
      return <GapCard report={block.report} onRetry={onRetry} />;
    default:
      return null;
  }
}

/**
 * WO-S08-KIT-PROCUREMENT-FE：`kit_readiness` 的行投影是一张**普通 table 块**
 * （QOS 的 `AnswerBlockSchema` 没有结构化的齐套块），而 `shortItems` 这一列被 agentcore 的
 * `cellOf()` 兜底成**整项 JSON 字符串** —— 采购四段就躺在那坨转义 JSON 里，用户读不出来。
 *
 * 这里在 table 分支上加一道识别：认出来 ⇒ ① 表格里那一列换成可读摘要 ② 下方接四段面板；
 * 认不出来（列名不符 / 解析不过）⇒ **原样渲染普通表格**，回落到今天的行为，绝不因为接了新渲染把信息弄丢。
 */
function TableBlockOrKit(props: {
  columns: string[];
  rows: (string | number | null)[][];
  provId: string;
  taskId: string;
  provIndex: (provId: string) => number;
}) {
  const { columns, rows, provId, taskId, provIndex } = props;
  const kitOrders = buildKitOrderVMs(columns, rows);
  if (kitOrders === null) {
    return <TableBlock columns={columns} rows={rows} provId={provId} taskId={taskId} provIndex={provIndex} />;
  }
  return (
    <>
      <TableBlock columns={columns} rows={kitReadableRows(columns, rows, kitOrders)} provId={provId} taskId={taskId} provIndex={provIndex} />
      <KitProcurementLegs orders={kitOrders} provId={provId} provIndex={provIndex} />
    </>
  );
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

/** action_draft：待审批徽章 + 摘要 + 跳转审批台 */
export function ActionDraftBlock({ draftId, actionType, summary }: { draftId: string; actionType: string; summary: string }) {
  return (
    <div className={styles.draft} data-testid="action-draft">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="badge amber">{zh.dock.pendingApproval}</span>
        <span className="mono" style={{ fontSize: 12 }}>{actionType}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--muted2)" }}>{draftId}</span>
      </div>
      <p style={{ margin: "6px 0", lineHeight: 1.6 }}>{summary}</p>
      <Link to="/admin/actions" className={styles.draftLink}>
        {zh.dock.gotoActions} →
      </Link>
    </div>
  );
}
