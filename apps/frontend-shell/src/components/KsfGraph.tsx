import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runSolver } from "@/api/endpoints";
import { DailyDotAxis, type DotOrder } from "@/components/DailyDotAxis";
import zh from "@/locales/zh";
import styles from "./KsfGraph.module.css";

/**
 * audit.3 财务 KSF 图（audit/generate 共用）：3 层有向图——待解决问题（越线 Metric）→ 关键成功要素
 * KSF（5）→ 财务计划指标（Metric）。数据走 ksf_graph 求解器（前端零写死 R14）。问题节点点击 →
 * 高亮其传导的 KSF + 财务指标（沿威胁/支撑边）+ 展开该问题的 audit_timeline 逐日圆点轴（联动）。
 */
interface KsfGraphData {
  problems: { id: string; name: string; severity: string; ksfRef: string; gap?: number }[];
  ksfNodes: { id: string; key: string; name: string; sub: string }[];
  finNodes: { id: string; name: string; actual: number; target: number; unit: string; status: string }[];
  edges: { from: string; to: string; kind: "threat" | "support" }[];
  summary: string;
}

/**
 * WO-U3-DAG-SPLIT · 点中的节点（判别联合，供调用方开「凭什么」面板）。
 * 三类节点的数据形状不同（问题=越线 Metric / KSF=一等对象 / 财务=计划指标），
 * 合在一个类型里会逼调用方做可空猜谜——分开，由 kind 收窄。
 */
export type KsfNodeRef =
  | { kind: "problem"; node: KsfGraphData["problems"][number] }
  | { kind: "ksf"; node: KsfGraphData["ksfNodes"][number] }
  | { kind: "fin"; node: KsfGraphData["finNodes"][number] };

export function KsfGraph({ testId = "ksf-graph", onNodeInspect }: { testId?: string; onNodeInspect?: (ref: KsfNodeRef) => void }) {
  const [sel, setSel] = useState<string | null>(null); // 选中的问题 id
  const { data, isLoading } = useQuery({
    queryKey: ["b", "ksf_graph"],
    queryFn: async () => (await runSolver("ksf_graph", {})).data as KsfGraphData,
  });

  if (isLoading) return <div className="panel"><div className="section-title">{zh.sim.ksf.title}</div><div className="empty-state">{zh.common.loading}</div></div>;
  if (!data || data.ksfNodes.length === 0) return null;

  // 选中问题 → 沿边求其传导的 KSF 与财务指标（高亮集）。
  const selProblem = data.problems.find((p) => p.id === sel);
  const litKsf = new Set<string>();
  const litFin = new Set<string>();
  if (selProblem) {
    for (const e of data.edges) if (e.kind === "threat" && e.from === sel) litKsf.add(e.to);
    for (const e of data.edges) if (e.kind === "support" && litKsf.has(e.from)) litFin.add(e.to);
  }
  const sevCls = (s: string) => (s === "H" ? "red" : s === "M" ? "amber" : "");

  return (
    <div className="panel" data-testid={testId}>
      <div className="section-title">{zh.sim.ksf.title}</div>
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 8 }}>{data.summary}</div>
      <div className={styles.graph}>
        {/* 问题层 */}
        <div className={styles.col} data-testid="ksf-col-problems">
          <div className={styles.colHead}>{zh.sim.ksf.problems}</div>
          {data.problems.map((p) => (
            <button
              key={p.id}
              className={`${styles.node} ${styles.problem} ${sel === p.id ? styles.sel : ""}`}
              data-testid={`ksf-problem-${p.id}`}
              onClick={() => {
                setSel(sel === p.id ? null : p.id);
                // WO-U3-DAG-SPLIT：可选「凭什么」面板（不外溢——不传 onNodeInspect 维持今天只高亮的行为，
                // plan-audit 等其余消费方逐字节不变）。点消（再点同一节点）不上面板。
                if (onNodeInspect && sel !== p.id) onNodeInspect({ kind: "problem", node: p });
              }}
            >
              <span className={`badge ${sevCls(p.severity)}`}>{p.severity}</span> {p.name}
            </button>
          ))}
        </div>
        <div className={styles.arrow}>⇢</div>
        {/* KSF 层 */}
        <div className={styles.col} data-testid="ksf-col-ksf">
          <div className={styles.colHead}>{zh.sim.ksf.ksf}</div>
          {data.ksfNodes.map((k) => (
            <div
              key={k.id}
              className={`${styles.node} ${styles.ksf} ${litKsf.has(k.id) ? styles.lit : sel ? styles.dim : ""}`}
              data-testid={`ksf-node-${k.key}`}
              // WO-U3-DAG-SPLIT：可选点击（只在传了 onNodeInspect 时才是按钮——不传零行为变化）。
              {...(onNodeInspect
                ? { role: "button" as const, tabIndex: 0, style: { cursor: "pointer" }, "data-clickable": "1", onClick: () => onNodeInspect({ kind: "ksf", node: k }), onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && onNodeInspect({ kind: "ksf", node: k }) }
                : {})}
            >
              <b>{k.name}</b>
              <span className={styles.sub}>{k.sub}</span>
            </div>
          ))}
        </div>
        <div className={styles.arrow}>⇢</div>
        {/* 财务指标层 */}
        <div className={styles.col} data-testid="ksf-col-fin">
          <div className={styles.colHead}>{zh.sim.ksf.fin}</div>
          {data.finNodes.map((f) => (
            <div
              key={f.id}
              className={`${styles.node} ${styles.fin} ${litFin.has(f.id) ? styles.lit : sel ? styles.dim : ""}`}
              data-testid={`ksf-fin-${f.id}`}
              data-status={f.status}
              // WO-U3-DAG-SPLIT：可选点击（同 KSF 层——不传 onNodeInspect 零行为变化）。
              {...(onNodeInspect
                ? { role: "button" as const, tabIndex: 0, style: { cursor: "pointer" }, "data-clickable": "1", onClick: () => onNodeInspect({ kind: "fin", node: f }), onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && onNodeInspect({ kind: "fin", node: f }) }
                : {})}
            >
              {f.name} <span className="mono" style={{ fontSize: 12 }}>{f.actual}/{f.target}{f.unit}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 问题节点点击 → 联动其 audit_timeline 逐日圆点轴 */}
      {selProblem && <ProblemTimeline problem={selProblem} />}
    </div>
  );
}

/** 问题时序联动：消费 audit_timeline（按问题派生 kind 出逐日 series），复用 DailyDotAxis。 */
function ProblemTimeline({ problem }: { problem: { id: string; name: string; ksfRef: string } }) {
  const { data, isLoading } = useQuery({
    queryKey: ["b", "audit_timeline", problem.id],
    queryFn: async () => (await runSolver("audit_timeline", { kind: problem.ksfRef || problem.name })).data as {
      series: number[]; threshold: number; crossDay: number | null; peak: number; stages?: { label: string }[];
    },
  });
  return (
    <div className={styles.tl} data-testid={`ksf-timeline-${problem.id}`}>
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 4 }}>{zh.sim.ksf.timelineHint(problem.name)}</div>
      {isLoading && <span style={{ fontSize: 12, color: "var(--muted)" }}>{zh.common.loading}</span>}
      {data && data.series.length > 0 && (
        <DailyDotAxis
          series={data.series}
          threshold={data.threshold}
          crossDay={data.crossDay}
          peak={data.peak}
          affectedOrders={[] as DotOrder[]}
          testId={`ksf-dda-${problem.id}`}
        />
      )}
    </div>
  );
}
