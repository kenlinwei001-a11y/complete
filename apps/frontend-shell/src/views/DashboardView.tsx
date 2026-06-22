import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg } from "@/api/endpoints";
import type { DashboardWidgetDef, WidgetQueryDef } from "@/api/types";
import { Feature } from "@/workspace/featureGate";
import { EChart } from "@/components/ui/EChart";
import { Provenance } from "@/components/Provenance";
import { ProvenanceDag, type DagData } from "@/components/ProvenanceDag";
import type { ViewRendererProps } from "./registry";
import zh from "@/locales/zh";
import styles from "./DashboardView.module.css";

/**
 * 驾驶舱（renderer=dashboard，PRD §7.3）：
 * 卡片网格由 ViewConfig.layout 声明（kpi/chart/table），数据源为声明式 query 定义——前端只执行不硬编码。
 */
export default function DashboardView({ view }: ViewRendererProps) {
  const widgets = ((view.layout?.widgets as DashboardWidgetDef[] | undefined) ?? []).filter(Boolean);
  if (widgets.length === 0) return <div className="empty-state">{zh.common.none}</div>;
  return (
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
        <CounterfactualWidget data={data as CounterfactualData | undefined} />
      ) : def.type === "version-toggle" ? (
        <VersionToggleWidget data={data as { items?: { props: Record<string, unknown> }[] } | undefined} />
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
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {m.actual}<small style={{ fontSize: 11 }}>{m.unit}</small>
          </div>
          <div style={{ fontSize: 10.5, color: m.miss ? "#DD7E9E" : "var(--muted2)" }}>
            目标 {m.target}{m.unit} · 差 {m.delta > 0 ? "+" : ""}{m.delta}{m.miss ? " · 越线" : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

/** cockpit P5 反事实双轨推演：counterfactual_timeline → do-nothing baseline ‖ 处置后 双曲线 + 差值（前端零写死）。 */
type CounterfactualData = { baselineSeries: number[]; mitigatedSeries: number[]; threshold: number; base: string; factor: string; mitigation: string; delta: { peakCut: number; crossDelayDays: number; ordersSaved: number } };
function CounterfactualWidget({ data }: { data: CounterfactualData | undefined }) {
  if (!data) return <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>;
  const days = data.baselineSeries.map((_, i) => `D+${i}`);
  return (
    <div data-testid="cf-widget">
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>
        {data.base}·{data.factor}：不解决 vs「{data.mitigation}」—— 峰值削减 <b className="mono" data-testid="cf-peakcut">{data.delta.peakCut}</b> · 越线日推迟 <b className="mono">{data.delta.crossDelayDays}</b> 天 · 少越线 <b className="mono">{data.delta.ordersSaved}</b> 日
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

function KpiWidget({ value, unit }: { value: unknown; unit?: string }) {
  const display =
    typeof value === "number" ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)) : String(value ?? "—");
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
