import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AnnualScenario, AopResponse } from "@platform/contracts";
import { createActionDraft, fetchAop } from "@/api/endpoints";
import { useFeature } from "@/workspace/featureGate";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import type { ViewRendererProps } from "../registry";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

const YEAR = 2027;

/** 情景顶边色条（保守灰蓝 / 基准蓝 / 激进琥珀，对齐原型 AOP_SCEN.c） */
const SCEN_COLORS: Record<string, string> = {
  conservative: "#7C8896",
  baseline: "#54B5C4",
  aggressive: "#E8B54A",
};

/** 年度情景规划台（renderer=annual-scenario，§7.14）：三情景卡 + 触发挂牌 + 目标分解流 */
export default function AnnualScenarioView(_props: ViewRendererProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["a", "plan-aop", { year: YEAR }],
    queryFn: () => fetchAop(YEAR),
  });

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  return (
    <div data-testid="annual-scenario-view">
      <div className={simStyles.head}>
        <div>
          <h3>{zh.aop.title(YEAR)}</h3>
          <div className={simStyles.sub}>
            产能建设求解器：情景需求曲线 vs 投产时点 → 缺口/过剩窗口 · IRR · 利用率预测（C23 门槛校验）· 情景挂触发条件活在系统里。
          </div>
        </div>
      </div>

      <div className={styles.scenGrid}>
        {data.scenarios.map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </div>

      <TriggerBoard triggers={data.triggers} />
      <DecompositionFlow decomposition={data.decomposition} />
    </div>
  );
}

function ScenarioCard({ scenario: s }: { scenario: AnnualScenario }) {
  const [openRule, setOpenRule] = useState<string | null>(null);
  const color = SCEN_COLORS[s.key] ?? "var(--accent)";
  const canFinalize = useFeature("act.aop-finalize");
  const { data: workspace } = useWorkspace();
  const isCatalogAdmin = (workspace?.user?.roles ?? []).some((r) => r.split(":")[0] === "catalog_admin");

  const finalize = useMutation({
    mutationFn: () =>
      createActionDraft({
        actionTypeKey: "AOP情景拍板",
        payload: { scenarioId: s.id, scenarioKey: s.key, year: s.year, demand: s.demand },
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }),
    onSuccess: () => toast(`${zh.aop.finalizeDone}（${zh.sim.gotoActions}：/admin/actions）`, "success"),
    onError: toastError,
  });

  return (
    <div
      className={`${styles.scenCard} ${s.finalized ? styles.pick : ""}`}
      style={{ borderTopColor: color }}
      data-testid={`scen-card-${s.key}`}
      data-finalized={s.finalized}
    >
      <div className={styles.scenHead}>
        <b style={{ color }}>{s.name}</b>
        {s.finalized && (
          <span className="badge green" data-testid={`scen-finalized-${s.key}`}>
            {zh.aop.finalizedChip}
          </span>
        )}
        {!s.finalized && isCatalogAdmin && canFinalize && (
          <button
            className="btn sm"
            style={{ marginLeft: "auto" }}
            disabled={finalize.isPending}
            onClick={() => finalize.mutate()}
            data-testid={`scen-finalize-${s.key}`}
          >
            {zh.aop.finalizeBtn}
          </button>
        )}
      </div>
      <div className={styles.scenBig}>
        {s.demand.toLocaleString("zh-CN")} <small>{zh.aop.demandUnit}</small>
      </div>
      <div className={styles.scenRow}>
        <span>{zh.aop.capacityDecision}</span>
        <div className="zh">{s.capacityDecision}</div>
      </div>
      <div className={styles.scenRow}>
        <span>{zh.aop.ltaLock}</span>
        <div className="zh">{s.ltaLock}</div>
      </div>
      <div className={styles.scenRow}>
        <span>{zh.aop.finance}</span>
        <div className="mono">{zh.aop.financeText(s.finance.revenue, s.finance.capex, s.finance.irr)}</div>
      </div>
      {s.capexScenario && s.capexScenario.projects.length > 0 && (
        <div className={styles.scenRow}>
          <span>{zh.aop.projectFinance}</span>
          <div data-testid={`scen-projects-${s.key}`}>
            {s.capexScenario.projects.map((p) => (
              <div key={p.id} className="mono" data-testid={`scen-project-${s.key}-${p.id}`} style={{ fontSize: 11 }}>
                {p.name}：IRR {p.irr.toFixed(1)}% · 24月利用率 {(p.util24 * 100).toFixed(1)}%{" "}
                <span className={`badge ${p.c23pass ? "green" : "amber"}`}>{p.c23pass ? "C23 ✓" : "C23 ⚠"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.scenRow}>
        <span>{zh.aop.ruleChecks}</span>
        <div>
          {s.ruleChecks.map((rc) => (
            <span key={rc.ruleKey} style={{ marginRight: 6 }}>
              <button
                className={`badge ${rc.passed ? "green" : "amber"}`}
                data-testid={`scen-rule-${s.key}-${rc.ruleKey}`}
                onClick={() => setOpenRule(openRule === rc.ruleKey ? null : rc.ruleKey)}
              >
                {rc.ruleKey} {rc.passed ? "✓" : "⚠"}
              </button>
            </span>
          ))}
          {openRule && (
            <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5, background: "var(--bg2)", borderRadius: 6, padding: "5px 8px" }} data-testid={`scen-rule-detail-${s.key}`}>
              {s.ruleChecks.find((rc) => rc.ruleKey === openRule)?.explanation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 触发条件挂牌表：已触发行高亮 + 触发时间 + 通知记录（后端规则扫描，前端只读） */
function TriggerBoard({ triggers }: { triggers: AopResponse["triggers"] }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="section-title">{zh.aop.triggerSection}</div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 8 }}>{zh.aop.triggerHint}</div>
      <table className="cmp" data-testid="aop-trigger-table">
        <thead>
          <tr>
            <th>{zh.aop.trgCond}</th>
            <th>{zh.aop.trgAction}</th>
            <th>{zh.aop.trgState}</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((t) => (
            <tr
              key={t.id}
              className={`${styles.trgRow} ${t.status === "TRIGGERED" ? styles.trgTriggered : ""}`}
              data-testid={`aop-trigger-${t.id}`}
              data-status={t.status}
            >
              <td className="zh">
                <b>{t.condition}</b>
              </td>
              <td className="zh">{t.action}</td>
              <td className="zh">
                {t.status === "MONITORING" ? (
                  <span className="badge amber">{zh.aop.monitoring}</span>
                ) : (
                  <>
                    <span className="badge green">{zh.aop.triggered}</span>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>
                      {t.triggeredAt && <span className="mono">{zh.aop.triggeredAt(t.triggeredAt.slice(0, 16).replace("T", " "))}</span>}
                      {t.notifiedTo && t.notifiedTo.length > 0 && <div>{zh.aop.notified(t.notifiedTo.join("、"))}</div>}
                    </div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 目标分解流（年 → 季 → 月）：分解节点悬停溯源（targetRef 与 S&OP 目标线同源） */
function DecompositionFlow({ decomposition }: { decomposition: AopResponse["decomposition"] }) {
  const [prov, setProv] = useState<{ ref: string; top: number; left: number } | null>(null);
  const year = decomposition.find((d) => d.level === "year");
  const quarters = decomposition.filter((d) => d.level === "quarter");
  const months = decomposition.filter((d) => d.level === "month");

  const hover = (e: ReactMouseEvent, targetRef?: string) => {
    if (!targetRef) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProv({ ref: targetRef, top: r.bottom + 6, left: r.left });
  };

  return (
    <div className="panel">
      <div className="section-title">{zh.aop.decompSection}</div>
      <div className={styles.decFlow} data-testid="aop-dec-flow">
        {year && (
          <div className={styles.decNode} data-testid="dec-node-year" onMouseEnter={(e) => hover(e, year.targetRef)} onMouseLeave={() => setProv(null)}>
            <b>{year.period}</b>
            {year.value.toLocaleString("zh-CN")} 万套
          </div>
        )}
        {quarters.map((q) => {
          const qMonths = months.filter((m) => quarterOf(m.period) === q.period);
          return (
            <span key={q.period} style={{ display: "contents" }}>
              <span className={styles.decArrow}>→</span>
              <div
                className={styles.decNode}
                data-testid={`dec-node-${q.period}`}
                onMouseEnter={(e) => hover(e, q.targetRef)}
                onMouseLeave={() => setProv(null)}
              >
                <b>{q.period}</b>
                {q.value} 万套
                {qMonths.length > 0 && (
                  <div className={styles.decMonths}>
                    {qMonths.map((m) => (
                      <i
                        key={m.period}
                        data-testid={`dec-month-${m.period}`}
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          hover(e, m.targetRef);
                        }}
                        onMouseLeave={() => setProv(null)}
                      >
                        {m.period.slice(5)}月 {m.value}
                      </i>
                    ))}
                  </div>
                )}
              </div>
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 8 }} data-testid="aop-dec-footnote">
        {zh.aop.decompFootnote}
      </div>
      {prov && (
        <div className={styles.decProv} style={{ top: prov.top, left: prov.left }} role="tooltip" data-testid="dec-prov-pop">
          <span className="mono">{prov.ref}</span>
          <div>{zh.aop.decompProv(prov.ref)}</div>
        </div>
      )}
    </div>
  );
}

function quarterOf(month: string): string {
  const [y, m] = month.split("-");
  const q = Math.ceil(Number(m) / 3);
  return `${y}-Q${q}`;
}
