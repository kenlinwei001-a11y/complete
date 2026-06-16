import { useQuery } from "@tanstack/react-query";
import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg } from "@/api/endpoints";
import type { DashboardWidgetDef, WidgetQueryDef } from "@/api/types";
import { Feature } from "@/workspace/featureGate";
import { EChart } from "@/components/ui/EChart";
import { Provenance } from "@/components/Provenance";
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
        <ChartWidget data={data} kind={def.chartKind ?? "line"} />
      ) : (
        <TableWidget data={data} columns={(def.query as { columns?: string[] }).columns} />
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

function ChartWidget({ data, kind }: { data: unknown; kind: "line" | "bar" }) {
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
