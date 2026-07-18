import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg } from "@/api/endpoints";
import type { DashboardWidgetDef, WidgetQueryDef, AffectedOrdersOutputVM } from "@/api/types";
import { SEG_REGISTRY } from "@platform/contracts";
import { Feature } from "@/workspace/featureGate";
import { EChart } from "@/components/ui/EChart";
import { Provenance } from "@/components/Provenance";
import { ProvenanceDag, gapAttributionToDag, type DagData, type GapAttrOutput } from "@/components/ProvenanceDag";
import type { ViewRendererProps } from "./registry";
import zh from "@/locales/zh";
import styles from "./DashboardView.module.css";
import { downloadCsv } from "./exportCsv";

/** 导出行数据结构（metric_rollup.metrics + affected_orders.problems）。 */
export interface DashExportMetric { name?: string; key?: string; target?: number; actual?: number; delta?: number; miss?: boolean }
export interface DashExportProblem { title?: string; orderCount?: number; financeImpact?: number }

/** PRD-cockpit §8 P5「导出」：把经营指标 + 待解决问题拼成 CSV 行（纯函数，确定性，可单测）。 */
export function buildDashExportRows(metrics: DashExportMetric[], problems: DashExportProblem[]): (readonly unknown[])[] {
  return [
    [zh.dash.exportTitleRow],
    zh.dash.exportMetricHeader,
    ...metrics.map((m) => [m.name ?? m.key ?? "", m.target ?? "", m.actual ?? "", m.delta ?? "", m.miss ? "越线" : ""]),
    [],
    zh.dash.exportProblemHeader,
    ...problems.map((p) => [p.title ?? "", p.orderCount ?? "", p.financeImpact ?? ""]),
  ];
}

/**
 * 驾驶舱（renderer=dashboard，PRD §7.3）：
 * 卡片网格由 ViewConfig.layout 声明（kpi/chart/table），数据源为声明式 query 定义——前端只执行不硬编码。
 */
// PRD-IND-dash §2.5/§2.6：回采校准链（5 节点）+ 模块直达（6 卡）。结构/导航/叙事，view.layout 优先下发。
type ModLink = { key: string; route: string; title: string; sub: string; color: string };
const MODULE_LINKS: ModLink[] = [
  { key: "aop", route: "/v/annual-scenario", title: "年度情景规划台", sub: "三情景 · 触发挂牌 · 目标分解", color: "#9D8BF0" }, // debattery-allow
  { key: "quarter", route: "/v/quarterly-rolling", title: "季度滚动看板", sub: "爬坡 vs 需求 · 长协偏差", color: "#5E8FE8" }, // debattery-allow
  { key: "sop", route: "/v/sop-balance", title: "月度 S&OP", sub: "五步法 · 三线差异 · 版本管理", color: "#B07FD8" }, // debattery-allow
  { key: "risk", route: "/v/risk", title: "产能推演", sub: "计划-执行之桥 · 8 风险基地", color: "#DD7E9E" }, // debattery-allow
  { key: "order", route: "/v/project-sim", title: "项目推演", sub: "订单全链 + 型号产能模拟", color: "#36BFA5" }, // debattery-allow
  { key: "all", route: "/v/graph", title: "业务建模全景", sub: "14 域 · 含外部域与决策应用域", color: "#54B5C4" }, // debattery-allow
];
const FEEDBACK_CHAIN: string[] = [
  "实际产出 / 销量 / 到货 / 回款", // debattery-allow：回采链叙事节点
  "月度 S&OP 三线差异（V7 vs 实际）",
  "季度滚动重估（爬坡 / 长协偏差）",
  "年度情景校准与触发监测",
  "↻ 精度校准器 C12 反向调参",
];

export default function DashboardView({ view }: ViewRendererProps) {
  const navigate = useNavigate();
  const widgets = ((view.layout?.widgets as DashboardWidgetDef[] | undefined) ?? []).filter(Boolean);
  if (widgets.length === 0) return <div className="empty-state">{zh.common.none}</div>;
  const modLinks = (view.layout?.moduleLinks as ModLink[] | undefined) ?? MODULE_LINKS;
  const feedbackChain = (view.layout?.feedbackChain as string[] | undefined) ?? FEEDBACK_CHAIN;
  const handleExport = async () => {
    const [ao, mr] = await Promise.allSettled([invokeSolver("affected_orders", {}), invokeSolver("metric_rollup", { level: "op" })]);
    const problems = ao.status === "fulfilled" ? ((ao.value.data as { problems?: DashExportProblem[] })?.problems ?? []) : [];
    const metrics = mr.status === "fulfilled" ? ((mr.value.data as { metrics?: DashExportMetric[] })?.metrics ?? []) : [];
    downloadCsv(`dashboard-${new Date().toISOString().slice(0, 10)}`, buildDashExportRows(metrics, problems));
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn" data-testid="dash-export" onClick={handleExport}>{zh.dash.exportLabel}</button>
      </div>
      <div className={styles.grid} data-testid="dashboard-grid">
        {widgets.map((w) =>
          w.featureKey ? (
            <Feature key={w.key} flag={w.featureKey}>
              <Widget def={w} />
            </Feature>
          ) : (
            <Widget key={w.key} def={w} />
          ),
        )}
      </div>

      {/* 待解决的问题（自下而上：受影响订单逐单归因 → 问题清单） */}
      <ProblemPanel />

      {/* 回采校准链（实际 → 月度 → 季度 → 年度 · C12 反向调参） */}
      <div className="panel" style={{ marginTop: 16 }} data-testid="dash-feedback-chain">
        <div className="section-title">{zh.dash.feedbackTitle}</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12 }}>
          {feedbackChain.map((n, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="badge" data-testid={`dash-fb-${i}`}>{n}</span>
              {i < feedbackChain.length - 1 && <span style={{ color: "var(--muted2)" }}>→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* 模块直达（点击进入对应视图） */}
      <div className="panel" style={{ marginTop: 14 }} data-testid="dash-modules">
        <div className="section-title">{zh.dash.modulesTitle}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {modLinks.map((m) => (
            <button
              key={m.key}
              className={styles.card}
              style={{ borderLeft: `3px solid ${m.color}`, cursor: "pointer", textAlign: "left" }}
              data-testid={`dash-mod-${m.key}`}
              onClick={() => navigate(m.route)}
            >
              <b style={{ color: m.color }}>{m.title}</b>
              <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 4 }}>{m.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** PRD-IND-dash §2.3：待解决的问题面板——自下而上把受影响订单归并为问题清单（affected_orders 同源）。 */
function ProblemPanel() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["b", "affected-orders", { dash: true }],
    queryFn: async () => (await invokeSolver("affected_orders", {})).data as { rows?: unknown[]; problems?: { category: string; title: string; orderCount: number; financeImpact: number }[] },
    retry: false,
  });
  const problems = data?.problems ?? [];
  if (problems.length === 0) return null;
  const orderCount = data?.rows?.length ?? problems.reduce((s, p) => s + p.orderCount, 0);
  return (
    <div className="panel" style={{ marginTop: 16 }} data-testid="dash-problems">
      <div className="section-title">{zh.dash.problemsTitle(problems.length)}</div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 8 }}>{zh.dash.problemsSub(orderCount, problems.length)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {problems.map((p) => (
          // 点击下钻订单全链聚合并自动展开该问题的逐单根因 DAG（PRD-cockpit §2.3 问题归并→台账逐单根因）。
          <button
            key={p.category}
            className={styles.card}
            style={{ borderLeft: "3px solid var(--danger)", cursor: "pointer", textAlign: "left" }}
            data-testid={`dash-problem-${p.category}`}
            title={zh.dash.problemDrill}
            onClick={() => navigate(`/v/order-chain?problem=${encodeURIComponent(p.category)}`)}
          >
            <b>{p.title}</b>
            <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 4 }}>
              影响 <b className="mono">{p.orderCount}</b> 单 · <b className="mono">{p.financeImpact.toFixed(0)}</b> 亿 <span style={{ color: "var(--accent)" }}>›</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** SEG 经济派生（单价/毛利率，单一来源 SEG_REGISTRY，R14）。 */
const SEG_ECON: Record<string, { price: number; margin: number }> = Object.fromEntries(
  SEG_REGISTRY.map((s) => [s.seg, { price: s.priceWan, margin: s.marginPct }]),
);

/** PRD-cockpit §2.1 订单经营台账：受影响订单台账 + 应用细分筛选 + 综合毛利率聚合 + 点单下钻逐单根因 DAG。 */
function OrderLedgerWidget() {
  const navigate = useNavigate();
  const [seg, setSeg] = useState<string>("");
  const { data, isLoading } = useQuery({
    queryKey: ["b", "affected-orders", { ledger: true }],
    queryFn: async () => (await invokeSolver("affected_orders", {})).data as AffectedOrdersOutputVM,
    retry: false,
  });
  if (isLoading) return <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>;
  const rows = data?.rows ?? [];
  if (rows.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;
  const segs = [...new Set(rows.map((r) => r.seg))];
  const filtered = seg ? rows.filter((r) => r.seg === seg) : rows;
  let sales = 0;
  let gp = 0;
  for (const r of filtered) {
    const e = SEG_ECON[r.seg] ?? { price: 0.6, margin: 13 };
    const s = r.qty * e.price;
    sales += s;
    gp += (s * e.margin) / 100;
  }
  const gmRate = sales > 0 ? (gp / sales) * 100 : 0;
  return (
    <div data-testid="dash-order-ledger">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        <button className="badge" data-testid="ledger-seg-all" style={{ cursor: "pointer", opacity: seg ? 0.55 : 1 }} onClick={() => setSeg("")}>{zh.dash.ledgerAll}</button>
        {segs.map((s) => (
          <button key={s} className="badge" data-testid={`ledger-seg-${s}`} style={{ cursor: "pointer", opacity: seg === s ? 1 : 0.55 }} onClick={() => setSeg(s)}>{s}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{zh.dash.ledgerGm} <b className="mono" data-testid="ledger-gmrate">{gmRate.toFixed(1)}%</b> · {filtered.length} 单</span>
      </div>
      <table className="cmp" data-testid="ledger-table" style={{ fontSize: 12, width: "100%" }}>
        <thead><tr><th>订单</th><th>客户</th><th>细分</th><th>型号</th><th>数量</th><th>交期</th><th>延期</th><th>风险</th></tr></thead>
        <tbody>
          {filtered.slice(0, 12).map((r) => (
            <tr key={r.so} data-testid={`ledger-row-${r.so}`} style={{ cursor: "pointer" }} title={zh.dash.ledgerDrill} onClick={() => navigate("/v/order-chain")}>
              <td>{r.so}</td><td>{r.cust}</td><td>{r.seg}</td><td>{r.model}</td>
              <td className="mono">{r.qty}</td><td>{r.due}</td>
              <td className="mono" style={{ color: r.delay > 0 ? "var(--danger)" : "var(--muted2)" }}>{r.delay > 0 ? `+${r.delay}d` : "—"}</td>
              <td style={{ fontSize: 11 }}>{[...new Set(r.risks.map((k) => k.factor))].join("/") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DrillKpi = { kpiId: string; name: string; category: string; actual: number; target: number; floorVal: number; unit: string; offTarget: boolean; status: string };
/** PRD-cockpit §2.1 规划决策推演：月/季/年 KPI 条 + 点未达成→根因 DAG + 一键去建议/体检。 */
function PlanDrillWidget() {
  const navigate = useNavigate();
  const [level, setLevel] = useState<string>("op");
  const { data, isLoading } = useQuery({
    queryKey: ["a", "plan-rootcause", { level }],
    queryFn: async () => (await invokeSolver("plan_rootcause", level === "op" ? {} : { level })).data as { kpis?: DrillKpi[]; dag?: DagData },
    retry: false,
  });
  const kpis = data?.kpis ?? [];
  const [openKpi, setOpenKpi] = useState<string | null>(null);
  // WO-COCKPIT-INFER：点未达成指标 → 换用 **gap_attribution**（CEO-2 深度反向归因·多跳 caused_by 因果树·引擎不改 §5）
  // 取代 plan_rootcause 的 1 跳浅 DAG——一路溯到地缘/决策终点根因。前端 gapAttributionToDag 投影，非改引擎。
  const { data: causalDag, isLoading: causalLoading } = useQuery({
    queryKey: ["a", "gap-attribution-dag", openKpi],
    queryFn: async () => gapAttributionToDag((await invokeSolver("gap_attribution", { metricKey: openKpi })).data as GapAttrOutput),
    enabled: !!openKpi,
    retry: false,
  });
  return (
    <div data-testid="dash-plan-drill">
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        {(["op", "month", "quarter", "year"] as const).map((lv) => (
          <button key={lv} className="badge" data-testid={`drill-level-${lv}`} style={{ cursor: "pointer", opacity: level === lv ? 1 : 0.55 }} onClick={() => { setLevel(lv); setOpenKpi(null); }}>
            {zh.dash.drillLevels[lv]}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="badge" data-testid="drill-to-generate" style={{ cursor: "pointer" }} onClick={() => navigate("/v/plan-generate")}>{zh.dash.drillToGenerate} ›</button>
          <button className="badge" data-testid="drill-to-audit" style={{ cursor: "pointer" }} onClick={() => navigate("/v/plan-audit")}>{zh.dash.drillToAudit} ›</button>
        </span>
      </div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
      ) : kpis.length === 0 ? (
        <div style={{ color: "var(--muted2)" }} data-testid="drill-empty">{zh.dash.drillEmpty(zh.dash.drillLevels[level] ?? level)}</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {kpis.map((k) => (
            <button
              key={k.kpiId}
              data-testid={`drill-kpi-${k.kpiId}`}
              className="panel"
              style={{ padding: 8, minWidth: 130, textAlign: "left", cursor: "pointer", borderLeft: `3px solid ${k.offTarget ? "#DD7E9E" : k.status === "AMBER" ? "#E8B54A" : "#62BE77"}` }}
              onClick={() => setOpenKpi(openKpi === k.kpiId ? null : k.kpiId)}
            >
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{k.name}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--txt)" }}>{k.actual}<small style={{ fontSize: 10 }}>{k.unit}</small></div>
              <div style={{ fontSize: 10, color: k.offTarget ? "#DD7E9E" : "var(--muted2)" }}>目标 {k.target}{k.unit}{k.offTarget ? " · 未达成" : ""}</div>
            </button>
          ))}
        </div>
      )}
      {openKpi && (
        <div style={{ marginTop: 10 }} data-testid="drill-dag">
          {causalLoading ? (
            <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
          ) : (
            <ProvenanceDag data={causalDag} />
          )}
        </div>
      )}
    </div>
  );
}

function useWidgetData(q: WidgetQueryDef) {
  return useQuery({
    queryKey: ["a", "widget", q],
    queryFn: async (): Promise<unknown> => {
      switch (q.kind) {
        case "objects":
          return queryObjectsPaged(q.objectType, 1, q.limit ?? 50, (q.filter ?? {}) as Record<string, string>);
        case "objects-aggregate": {
          // 治理增量 §3.6：声明式聚合落 POST /a/v1/objects/aggregate（聚合下推，不再拉全量本地算）。
          const prop = q.prop ?? (q.objectType ? "id" : "id");
          const res = await aggregateObjects({
            typeKey: q.objectType,
            filter: q.filter,
            groupBy: [],
            metrics: [{ prop: q.agg === "count" ? prop : (q.prop ?? prop), fn: q.agg }],
          });
          const row = res.rows[0];
          if (!row) return q.agg === "count" ? 0 : null;
          const key = `${q.agg}_${q.agg === "count" ? prop : (q.prop ?? prop)}`;
          return row.metrics[key] ?? (q.agg === "count" ? 0 : null);
        }
        case "solver": {
          const res = await invokeSolver(q.solverKey, q.args);
          if (!q.valuePath) return res.data;
          return q.valuePath.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], res.data);
        }
        // 运营态出厂配置增量 §4.1：12 个月趋势 / 准交率 / 年度已执行工单 / 已交付台账
        case "history": {
          const bundle = await fetchHistoryBundle({ pageSize: 1 });
          switch (q.field) {
            case "trend":
              // 检修月下凹可见：bucket 带 ⛭ 标记（maintBaseIds 非空）
              return bundle.trend.map((p) => ({ bucket: p.maintBaseIds.length > 0 ? `${p.month}⛭` : p.month, value: p.output }));
            case "onTimeRate":
              return bundle.onTimeRate;
            case "executedCount":
              return bundle.actionStats.executed;
            case "delivered":
              return { items: bundle.delivered.map((d) => ({ id: d.so, props: d as unknown as Record<string, unknown> })) };
            case "deviation":
              // 三线偏差复合图：逐月 {month→bucket, demand, supply, gap}
              return (bundle.deviation ?? []).map((d) => ({ bucket: d.month, demand: d.demand, supply: d.supply, gap: d.gap }));
          }
          return null;
        }
        case "timeseries": {
          const to = new Date();
          const from = new Date(to.getTime() - q.days * 86400_000);
          const res = await queryTimeseriesAgg({
            seriesKey: q.seriesKey,
            entityIds: q.entityIds,
            window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), grain: q.grain },
            agg: q.agg,
          });
          return res.points;
        }
      }
    },
  });
}

function Widget({ def }: { def: DashboardWidgetDef }) {
  const { data, isLoading } = useWidgetData(def.query);

  return (
    <div className={styles.card} style={{ gridColumn: `span ${def.span ?? 1}` }} data-testid={`widget-${def.key}`}>
      <div className={styles.cardHead}>
        <span>{def.title}</span>
        {def.provenance && (
          // 富出处悬浮（#5 · R13）：基础 ⓘ 升六要素溯源（来源/新鲜度/推导/输入/规则/备注）。
          <span data-testid={`widget-prov-${def.key}`}>
            <Provenance
              testId={`widget-${def.key}`}
              src={def.provenance.toolName}
              formula={`输出路径 ${def.provenance.outputPath}`}
              freshness={def.provenance.snapshotVersion ? `快照 ${def.provenance.snapshotVersion}` : undefined}
              note="驾驶舱 widget 声明式查询（ViewConfig.layout.widgets）"
            >
              <span className="badge">ⓘ</span>
            </Provenance>
          </span>
        )}
      </div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
      ) : def.type === "kpi" ? (
        <KpiWidget value={data} unit={def.unit} />
      ) : def.type === "chart" ? (
        <ChartWidget data={data} kind={def.chartKind ?? "line"} series={def.chartSeries} />
      ) : def.type === "summary" ? (
        <SummaryWidget data={data} />
      ) : def.type === "dag" ? (
        <ProvenanceDag data={data as DagData | undefined} />
      ) : def.type === "metric-strip" ? (
        <MetricStrip metrics={data as MetricRow[] | undefined} />
      ) : def.type === "counterfactual" ? (
        <CounterfactualWidget def={def} />
      ) : def.type === "version-toggle" ? (
        <VersionToggleWidget data={data as { items?: { props: Record<string, unknown> }[] } | undefined} />
      ) : def.type === "order-ledger" ? (
        <OrderLedgerWidget />
      ) : def.type === "plan-drill" ? (
        <PlanDrillWidget />
      ) : (
        <TableWidget data={data} columns={(def.query as { columns?: string[] }).columns} />
      )}
    </div>
  );
}

/** SPINE.4 经营指标条：metric_rollup 产出的 Metric（目标 vs 实际 + delta + 越线红），各视图 KPI 单一出处 R-一致。 */
type MetricRow = { metricId: string; name: string; unit?: string; target: number; actual: number; delta: number; miss: boolean };
function MetricStrip({ metrics }: { metrics: MetricRow[] | undefined }) {
  const rows = metrics ?? [];
  if (rows.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;
  return (
    <div data-testid="metric-strip" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {rows.map((m) => (
        <div key={m.metricId} data-testid={`metric-${m.metricId}`} className="panel" style={{ padding: 8, minWidth: 120, borderLeft: `3px solid ${m.miss ? "#DD7E9E" : "#62BE77"}` }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.name}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--txt)" }}>
            {formatKpiValue(m.actual, m.unit)}<small style={{ fontSize: 11 }}>{m.unit}</small>
          </div>
          <div style={{ fontSize: 10.5, color: m.miss ? "#DD7E9E" : "var(--muted2)" }}>
            目标 {formatKpiValue(m.target, m.unit)}{m.unit} · 差 {m.delta > 0 ? "+" : ""}{formatKpiValue(m.delta, m.unit)}{m.miss ? " · 越线" : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * cockpit P5 反事实双轨推演：counterfactual_timeline → do-nothing baseline ‖ 处置后 双曲线 + 差值（前端零写死）。
 * WO-C 基地选择器：基地列表真取自 risk_timeline cards（与推演看板同源·非写死），选基地 → 以 { base } 重调
 * counterfactual_timeline → 出该基地双轨（KILL-MOCK：双轨全从真 solver 渲，切基地则真变）。默认不传 base →
 * 后端取峰值最严重基地（不破现状·C3）；selected 以返回的 data.base 反映之。
 */
type CounterfactualData = { baselineSeries: number[]; mitigatedSeries: number[]; threshold: number; base: string; factor: string; mitigation: string; delta: { peakCut: number; crossDelayDays: number; ordersSaved: number } };
function CounterfactualWidget({ def }: { def: DashboardWidgetDef }) {
  const horizon = (def.query.kind === "solver" ? (def.query.args as { horizon?: number }).horizon : undefined) ?? 30;
  // "" = 让后端取峰值最严重基地（默认态）；选定则传 base 覆盖。
  const [base, setBase] = useState<string>("");
  // 基地列表真取自 risk_timeline cards（与 RiskBoardView 同源·R14 零写死）。
  const { data: baseList } = useQuery({
    queryKey: ["a", "cf-baselist", horizon],
    queryFn: async () => {
      const res = await invokeSolver("risk_timeline", { horizon });
      return [...new Set(((res.data as { cards?: { base: string }[] })?.cards ?? []).map((c) => c.base).filter(Boolean))];
    },
    retry: false,
  });
  // 双轨：base 传后端真求解（切基地 → queryKey 变 → 真重调 → 双轨真变）。keepPreviousData 使切换时选择器不闪。
  const { data } = useQuery({
    queryKey: ["a", "counterfactual", horizon, base],
    queryFn: async () => (await invokeSolver("counterfactual_timeline", { horizon, ...(base ? { base } : {}) })).data as CounterfactualData,
    placeholderData: keepPreviousData,
    retry: false,
  });
  if (!data) return <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>;
  const selected = base || data.base; // 默认反映后端所选最严重基地
  const options = (baseList ?? []).includes(selected) ? (baseList ?? []) : [selected, ...(baseList ?? [])];
  const days = data.baselineSeries.map((_, i) => `D+${i}`);
  return (
    <div data-testid="cf-widget">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12, color: "var(--muted)" }}>
        推演基地：
        <select
          data-testid="cf-basesel"
          value={selected}
          onChange={(e) => setBase(e.target.value)}
          style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, color: "var(--txt)", padding: "4px 10px", fontSize: 12, cursor: "pointer", minWidth: 120 }}
        >
          {options.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>切换基地看各自双轨</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>
        <b data-testid="cf-base">{data.base}</b>·{data.factor}：不解决 vs「{data.mitigation}」—— 峰值削减 <b className="mono" data-testid="cf-peakcut">{data.delta.peakCut}</b> · 越线日推迟 <b className="mono">{data.delta.crossDelayDays}</b> 天 · 少越线 <b className="mono">{data.delta.ordersSaved}</b> 日
      </div>
      <EChart
        height={180}
        testId="cf-chart"
        option={{
          grid: { top: 24, bottom: 24, left: 36, right: 12 },
          legend: { top: 0, textStyle: { color: "#9FB0C3", fontSize: 10 }, data: ["不解决", "处置后"] },
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: days },
          yAxis: { type: "value", max: 100, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
          series: [
            { name: "不解决", type: "line", smooth: true, data: data.baselineSeries, itemStyle: { color: "#DD7E9E" } },
            { name: "处置后", type: "line", smooth: true, data: data.mitigatedSeries, itemStyle: { color: "#62BE77" } },
            { name: "阈值", type: "line", data: data.baselineSeries.map(() => data.threshold), lineStyle: { type: "dashed", color: "#E8B54A", width: 1 }, symbol: "none" },
          ],
        }}
      />
    </div>
  );
}

/** cockpit P5 S&OP 版本切换（V1/V3/V5/V7，SopVersionRow）：选版本看供给/缺口/备注。 */
function VersionToggleWidget({ data }: { data: { items?: { props: Record<string, unknown> }[] } | undefined }) {
  const rows = (data?.items ?? []).map((o) => o.props as { ver: string; demand: number; supply: number; gap: number; note: string; isFinal: boolean }).sort((a, b) => String(a.ver).localeCompare(String(b.ver)));
  const [sel, setSel] = useState<string>(rows.find((r) => r.isFinal)?.ver ?? rows[rows.length - 1]?.ver ?? "");
  const cur = rows.find((r) => r.ver === sel);
  if (rows.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;
  return (
    <div data-testid="version-toggle">
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {rows.map((r) => (
          <button key={r.ver} data-testid={`ver-chip-${r.ver}`} className="badge" onClick={() => setSel(r.ver)}
            style={{ cursor: "pointer", background: r.ver === sel ? "#4C90F0" : undefined, color: r.ver === sel ? "#fff" : undefined }}>
            {r.ver}{r.isFinal ? "·待定稿" : ""}
          </button>
        ))}
      </div>
      {cur && (
        <div style={{ marginTop: 6, fontSize: 12 }} data-testid="version-detail">
          供给 <b className="mono">{cur.supply}</b> · 缺口 <b className="mono" style={{ color: cur.gap > 2 ? "var(--danger)" : "var(--ok)" }}>{cur.gap}</b> 万套
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{cur.note}</div>
        </div>
      )}
    </div>
  );
}

function formatKpiValue(value: unknown, unit?: string): string {
  if (typeof value !== "number") return String(value ?? "—");
  if (unit === "%" && value > 0 && value <= 1) {
    const scaled = value * 100;
    return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function KpiWidget({ value, unit }: { value: unknown; unit?: string }) {
  const display = formatKpiValue(value, unit);
  return (
    <div className={styles.kpiValue}>
      {display}
      {unit && <small>{unit}</small>}
    </div>
  );
}

function ChartWidget({ data, kind, series }: { data: unknown; kind: "line" | "bar" | "trideviation"; series?: { key: string; name: string; color?: string }[] }) {
  // 三线偏差复合图（#5）：多系列折线 + 偏差柱（首两系列之差，如 需求−供给=缺口）。
  if (kind === "trideviation") {
    const rows = (data as Record<string, unknown>[] | undefined) ?? [];
    const cols = series ?? [
      { key: "demand", name: "需求", color: "#7E8BEE" },
      { key: "supply", name: "供给", color: "#62BE77" },
      { key: "gap", name: "缺口", color: "#DD7E9E" },
    ];
    const buckets = rows.map((r) => String(r.bucket ?? r.month ?? ""));
    const lineSeries = cols.map((c) => ({
      name: c.name, type: "line" as const, smooth: true, data: rows.map((r) => Number(r[c.key] ?? 0)), itemStyle: { color: c.color },
    }));
    // 偏差柱：首系列 − 次系列（无 gap 字段时由复合图自算偏差，凸显"绿测试≠能用"的缺口）
    const dev = rows.map((r) => Math.round((Number(r[cols[0]!.key] ?? 0) - Number(r[cols[1]!.key] ?? 0)) * 100) / 100);
    return (
      <EChart
        height={200}
        option={{
          grid: { top: 28, bottom: 24, left: 40, right: 12 },
          legend: { top: 0, textStyle: { color: "#9FB0C3", fontSize: 10 } },
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: buckets },
          yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
          series: [...lineSeries, { name: "偏差", type: "bar", data: dev, itemStyle: { color: "rgba(221,126,158,.35)" }, barWidth: "40%" }],
        }}
      />
    );
  }
  const points = (data as { bucket: string; value: number }[] | undefined) ?? [];
  return (
    <EChart
      height={180}
      option={{
        grid: { top: 16, bottom: 24, left: 40, right: 12 },
        xAxis: { type: "category", data: points.map((p) => p.bucket) },
        yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
        series: [{ type: kind, data: points.map((p) => p.value), itemStyle: { color: "#4C90F0" }, smooth: true }],
      }}
    />
  );
}

/** 问题聚合摘要（#5）：affected_orders 求解器 problems[] 按类别归并的摘要卡（类别/单数/财务影响/根因）。 */
function SummaryWidget({ data }: { data: unknown }) {
  const out = data as { problems?: { category: string; title: string; orderCount: number; financeImpact: number; rootCauseSummary: string }[] } | undefined;
  const problems = out?.problems ?? [];
  const CAT: Record<string, string> = { DELIVERY: "交期", MARGIN: "毛利", KIT: "齐套", CREDIT: "信用" };
  if (problems.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;
  return (
    <div data-testid="widget-summary-problems" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {problems.map((p) => (
        <div key={p.category} className="panel" data-testid={`summary-problem-${p.category}`} style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          <div>
            <span className="badge red" style={{ marginRight: 6 }}>{CAT[p.category] ?? p.category}</span>
            <b>{p.title}</b>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {p.orderCount} 单 · 财务影响 {p.financeImpact} · <span className="zh">{p.rootCauseSummary}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TableWidget({ data, columns }: { data: unknown; columns?: string[] }) {
  const page = data as { items?: { id: string; props: Record<string, unknown> }[] } | undefined;
  const items = page?.items ?? [];
  const cols = columns ?? (items[0] ? Object.keys(items[0].props).slice(0, 5) : []);
  return (
    <table className="cmp">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.slice(0, 8).map((it) => (
          <tr key={it.id}>
            {cols.map((c) => (
              <td key={c}>{String(it.props[c] ?? "—")}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
