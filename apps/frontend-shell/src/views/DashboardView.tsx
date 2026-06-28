import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg } from "@/api/endpoints";
import type { DashboardWidgetDef, WidgetQueryDef, AffectedOrdersOutputVM } from "@/api/types";
import { SEG_REGISTRY } from "@platform/contracts";
import { Feature } from "@/workspace/featureGate";
import { EChart } from "@/components/ui/EChart";
import { Provenance } from "@/components/Provenance";
import { ProvenanceDag, type DagData } from "@/components/ProvenanceDag";
import { DagNodeDrawer, type DagDetail } from "@/components/DagNodeDrawer";
import type { ViewRendererProps } from "./registry";
import { useQuickLaunch } from "@/components/ScenarioLauncher/useScenarioLaunch";
import zh from "@/locales/zh";
import styles from "./DashboardView.module.css";
import { downloadCsv } from "./exportCsv";

/** 轨M 增量2b（母版 §1.A AI 对话栏·补 G-3）：驾驶舱板块级 AI 栏——注入 presetContext(落点 dash)→QOS（复用 useQuickLaunch 既有管线，不新建聊天）。 */
function DashAiBar() {
  const quickLaunch = useQuickLaunch();
  const [q, setQ] = useState("");
  const ask = () => { const query = q.trim(); if (!query) return; void quickLaunch({ query, targetView: "dash", selectedObjects: [] }); setQ(""); };
  return (
    <div data-testid="dash-ai-bar" style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "var(--muted2)" }}>AI 问驾驶舱</span>
      <input data-testid="dash-ai-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
        placeholder="本月最大风险是什么 / 哪些产线 7 月会越红线 …" style={{ flex: 1, fontSize: 12.5, padding: "5px 9px", borderRadius: 6, background: "var(--panel2,rgba(255,255,255,.04))", border: "1px solid var(--line,rgba(255,255,255,.12))", color: "var(--txt)" }} />
      <button className="btn sm" data-testid="dash-ai-submit" disabled={!q.trim()} onClick={ask}>提问</button>
    </div>
  );
}

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
      {/* 轨M 增量2b（母版 §1.A AI 对话栏·补断点 G-3）：板块级 AI 栏注入 presetContext(落点驾驶舱+实时选中对象)→QOS，
          复用 useQuickLaunch 既有管线，不新建聊天。 */}
      <DashAiBar />
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
  // 轨M 增量2a：综合毛利率 = 后端 marginLedger 逐细分贡献勾稽（真算·闭合·可溯），取代前端 Σgp/Σsales。
  const ml = data?.marginLedger;
  const gmRate = ml ? ml.gmRatePct : (() => { let s = 0, g = 0; for (const r of filtered) { const e = SEG_ECON[r.seg] ?? { price: 0.6, margin: 13 }; const v = r.qty * e.price; s += v; g += (v * e.margin) / 100; } return s > 0 ? (g / s) * 100 : 0; })();
  return (
    <div data-testid="dash-order-ledger">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        <button className="badge" data-testid="ledger-seg-all" style={{ cursor: "pointer", opacity: seg ? 0.55 : 1 }} onClick={() => setSeg("")}>{zh.dash.ledgerAll}</button>
        {segs.map((s) => (
          <button key={s} className="badge" data-testid={`ledger-seg-${s}`} style={{ cursor: "pointer", opacity: seg === s ? 1 : 0.55 }} onClick={() => setSeg(s)}>{s}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{zh.dash.ledgerGm} <b className="mono" data-testid="ledger-gmrate">{gmRate.toFixed(1)}%</b> · {filtered.length} 单</span>
      </div>
      {/* 轨M 增量2a 综合毛利率逐细分贡献勾稽（母版 §1.A/§1.B）：Σ贡献=综合毛利率（闭合）·Σ缺口贡献=缺口（负+正闭合），逐细分可溯。 */}
      {ml && (
        <details data-testid="ledger-margin-reconcile" style={{ marginBottom: 8, fontSize: 11.5, background: "var(--panel2,rgba(255,255,255,.03))", borderRadius: 6, padding: "6px 8px" }}>
          <summary style={{ cursor: "pointer" }}>
            综合毛利率勾稽：<b className="mono">{ml.gmRatePct.toFixed(2)}%</b> vs 目标 {ml.targetPct.toFixed(1)}% · 缺口 <b className="mono" style={{ color: ml.gapPp < 0 ? "var(--danger)" : "var(--ok,#62BE77)" }}>{ml.gapPp >= 0 ? "+" : ""}{ml.gapPp.toFixed(2)}pp</b> {ml.reconciled ? "· 已闭合 ✓" : "· 未闭合 ✗"}
          </summary>
          <table className="cmp" style={{ width: "100%", marginTop: 6, fontSize: 11 }}>
            <thead><tr><th>细分</th><th>营收占比</th><th>毛利率</th><th>贡献(pp)</th><th>缺口贡献(pp)</th><th>单</th></tr></thead>
            <tbody>
              {ml.bySegment.map((b) => (
                <tr key={b.seg} data-testid={`ledger-recon-${b.seg}`}>
                  <td className="zh">{b.seg}</td>
                  <td className="mono">{(b.revShare * 100).toFixed(1)}%</td>
                  <td className="mono">{b.marginPct}%</td>
                  <td className="mono">{b.contributionPp.toFixed(2)}</td>
                  <td className="mono" style={{ color: b.gapContributionPp < 0 ? "var(--danger)" : "var(--ok,#62BE77)" }}>{b.gapContributionPp >= 0 ? "+" : ""}{b.gapContributionPp.toFixed(2)}</td>
                  <td className="mono">{b.orderCount}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--line,rgba(255,255,255,.12))", fontWeight: 600 }}>
                <td>Σ 合计</td><td className="mono">100%</td><td>—</td>
                <td className="mono">{ml.gmRatePct.toFixed(2)}</td>
                <td className="mono">{ml.gapPp >= 0 ? "+" : ""}{ml.gapPp.toFixed(2)}</td><td className="mono">{ml.bySegment.reduce((s, b) => s + b.orderCount, 0)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      )}
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
              <div style={{ fontSize: 16, fontWeight: 600 }}>{k.actual}<small style={{ fontSize: 10 }}>{k.unit}</small></div>
              <div style={{ fontSize: 10, color: k.offTarget ? "#DD7E9E" : "var(--muted2)" }}>目标 {k.target}{k.unit}{k.offTarget ? " · 未达成" : ""}</div>
            </button>
          ))}
        </div>
      )}
      {openKpi && data?.dag && (
        <div style={{ marginTop: 10 }} data-testid="drill-dag">
          <ProvenanceDag data={data.dag} />
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

const EVENT_LABEL: Record<number, string> = { 0: "正常", 1: "周末", 2: "检修" };

/**
 * Level-2 逐日拆因（R13）：读 attainment:line 真 rollup 分量（oeeAttain/yieldAttain/lineOee/eventFlag），
 * 跨产线按日均聚 → 逐日 达成率 = 设备效率达成 × 良率达成，标掉日(<期均) + 主因。返回 breakdown + 最差日（供 level-3）。
 * 分量为后端沿 Line→Process→Equipment 拓扑逐台勾稽算出（agg-query measureField），非前端写死（R14）。
 */
async function fetchAttainmentDecomp(seriesKey: string): Promise<{ breakdown: NonNullable<DagDetail["breakdown"]>; worstDay?: string }> {
  // 取近 14 个有数据的日：合成历史止于 forecastStart（≈今日前数周），拉宽窗口（≤120 桶上限）后切末 14 日。
  const to = new Date();
  const from = new Date(to.getTime() - 118 * 86400_000);
  const win = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), grain: "day" };
  const fields = ["attainment", "oeeAttain", "yieldAttain", "lineOee", "eventFlag"] as const;
  const byField = await Promise.all(
    fields.map((mf) => queryTimeseriesAgg({ seriesKey, entityIds: [], window: win, agg: "avg", measureField: mf })),
  );
  const dayMap = new Map<string, Record<string, { sum: number; n: number }>>();
  fields.forEach((mf, fi) => {
    for (const p of byField[fi]!.points) {
      const row = dayMap.get(p.bucket) ?? {};
      const cur = row[mf] ?? { sum: 0, n: 0 };
      row[mf] = { sum: cur.sum + p.value, n: cur.n + 1 };
      dayMap.set(p.bucket, row);
    }
  });
  const days = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14);
  if (days.length === 0) return { breakdown: { columns: ["日期"], rows: [], caption: "暂无逐日派生数据（需真后端 attainment:line 序列）" } };
  const avg = (r: Record<string, { sum: number; n: number }>, k: string) => (r[k] && r[k]!.n ? r[k]!.sum / r[k]!.n : 0);
  const periodAvg = days.reduce((s, [, r]) => s + avg(r, "attainment"), 0) / days.length;
  let worstDay = days[0]![0];
  let worstAt = 1;
  const rows = days.map(([date, r]) => {
    const at = avg(r, "attainment"), oee = avg(r, "oeeAttain"), yld = avg(r, "yieldAttain"), loee = avg(r, "lineOee");
    const flag = Math.round(avg(r, "eventFlag"));
    if (at < worstAt) { worstAt = at; worstDay = date; }
    // 主因：排程日（周末/检修）OEE 自然走低标排程；否则取设备效率/良率缺口大者。
    const cause = flag > 0 ? `排程·${EVENT_LABEL[flag]}` : 1 - oee >= 1 - yld ? "设备效率" : "良率";
    return {
      cells: [date.slice(5), `${(at * 100).toFixed(1)}%`, `${(oee * 100).toFixed(1)}%`, `${(yld * 100).toFixed(1)}%`, `${(loee * 100).toFixed(1)}%`, cause],
      dip: at < periodAvg - 0.005,
    };
  });
  return {
    breakdown: {
      columns: ["日期", "达成率", "设备效率达成", "良率达成", "产线OEE", "主因"],
      rows,
      caption: `近 ${days.length} 日逐日拆解（达成率 = 设备效率达成 × 良率达成·OEE 为逐台设备产量加权 rollup）·灰底=低于期均 ${(periodAvg * 100).toFixed(1)}%`,
    },
    worstDay,
  };
}

const dayWin = (day: string) => ({ from: day, to: new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10), grain: "day" });

/** A3 跨线排行：某日全部产线达成率升序（最低在前），行可点选下钻其逐设备。 */
async function fetchLineRanking(seriesKey: string, day: string, onPick: (lineId: string) => void): Promise<NonNullable<DagDetail["breakdown"]>> {
  const pts = (await queryTimeseriesAgg({ seriesKey, entityIds: [], window: dayWin(day), agg: "avg", measureField: "attainment" })).points;
  if (pts.length === 0) return { columns: ["产线"], rows: [], caption: `${day} 无产线数据` };
  const rows = pts.slice().sort((a, b) => a.value - b.value).map((p, i) => ({
    cells: [p.entityId, `${(p.value * 100).toFixed(1)}%`],
    dip: i === 0,
    onClick: () => onPick(p.entityId),
  }));
  return { columns: ["产线", "达成率"], rows, caption: `${day} 全 ${pts.length} 线达成率升序（灰底=最低）·点任一线下钻其逐台设备/工序` };
}

/**
 * Level-3 逐设备勾稽（R13 点到具体设备/工序）：给定产线（缺省取最差线）→ 沿 Line→Equipment/Process 拓扑
 * 列逐台 oee:equip / 逐工序 yield:process（升序，最低=拖累点）。设备行可点 → 看该设备 OEE 趋势（A2）。
 */
async function fetchEquipDrill(seriesKey: string, day: string, lineIdIn: string | undefined, onPickEquip: (equipId: string) => void): Promise<NonNullable<DagDetail["breakdown"]>> {
  const win = dayWin(day);
  let lineId = lineIdIn;
  if (!lineId) {
    const linePts = (await queryTimeseriesAgg({ seriesKey, entityIds: [], window: win, agg: "avg", measureField: "attainment" })).points;
    if (linePts.length === 0) return { columns: ["对象"], rows: [], caption: `${day} 无产线数据` };
    lineId = linePts.slice().sort((a, b) => a.value - b.value)[0]!.entityId;
  }
  const [equips, procs] = await Promise.all([
    queryObjectsPaged("Equipment", 1, 100, { lineId }),
    queryObjectsPaged("Process", 1, 100, { lineId }),
  ]);
  const equipIds = equips.items.map((e) => String(e.props.equipId ?? e.id));
  const procIds = procs.items.map((p) => String(p.props.processId ?? p.id));
  const [oeePts, yldPts] = await Promise.all([
    equipIds.length ? queryTimeseriesAgg({ seriesKey: "oee:equip", entityIds: equipIds.slice(0, 20), window: win, agg: "avg" }) : Promise.resolve({ points: [] as { entityId: string; value: number }[] }),
    procIds.length ? queryTimeseriesAgg({ seriesKey: "yield:process", entityIds: procIds.slice(0, 20), window: win, agg: "avg" }) : Promise.resolve({ points: [] as { entityId: string; value: number }[] }),
  ]);
  const eqRows = oeePts.points.slice().sort((a, b) => a.value - b.value).map((p, i) => ({
    cells: [p.entityId.replace(`${lineId}-`, ""), "设备 OEE", `${(p.value * 100).toFixed(1)}%`],
    dip: i === 0,
    onClick: () => onPickEquip(p.entityId), // A2：点设备看趋势
  }));
  const prRows = yldPts.points.slice().sort((a, b) => a.value - b.value).map((p) => ({
    cells: [p.entityId.replace(`${lineId}-`, ""), "工序良率", `${(p.value * 100).toFixed(1)}%`],
    dip: false,
  }));
  if (eqRows.length === 0 && prRows.length === 0) return { columns: ["对象"], rows: [], caption: `${day}·${lineId} 无设备/工序序列（需真后端）` };
  const worstEq = eqRows[0]?.cells[0] ?? "—";
  return {
    columns: ["设备/工序", "类型", "实际值"],
    rows: [...eqRows, ...prRows],
    caption: `${day} 产线「${lineId}」逐台勾稽（OEE 升序·灰底=最低拖累点：${worstEq}）·点设备行看其 OEE 趋势`,
  };
}

/** A2 设备级时间轴：单台设备 oee:equip 近窗口逐日趋势（接现成 agg-query，单设备）。 */
async function fetchEquipTrend(equipId: string): Promise<NonNullable<DagDetail["breakdown"]>> {
  const to = new Date();
  const from = new Date(to.getTime() - 118 * 86400_000);
  const pts = (await queryTimeseriesAgg({ seriesKey: "oee:equip", entityIds: [equipId], window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), grain: "day" }, agg: "avg" })).points;
  const days = pts.slice(-14);
  if (days.length === 0) return { columns: ["日期"], rows: [], caption: `${equipId} 无 OEE 序列` };
  const avg = days.reduce((s, p) => s + p.value, 0) / days.length;
  const rows = days.map((p) => ({ cells: [p.bucket.slice(5), `${(p.value * 100).toFixed(1)}%`], dip: p.value < avg - 0.02 }));
  return { columns: ["日期", "OEE"], rows, caption: `设备「${equipId}」近 ${days.length} 日 OEE 趋势（灰底=低于均值 ${(avg * 100).toFixed(1)}%）` };
}

function KpiDrillButton({ def, value, scale }: { def: DashboardWidgetDef; value: unknown; scale?: number }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "lines" | "equip" | "equiptrend">("days");
  const [pickedLine, setPickedLine] = useState<string | undefined>();
  const [pickedEquip, setPickedEquip] = useState<string | undefined>();
  const seriesKey = def.drill?.seriesKey;
  const { data: l2, isFetching: l2Loading } = useQuery({
    queryKey: ["attain-decomp", seriesKey],
    queryFn: () => fetchAttainmentDecomp(seriesKey!),
    enabled: open && !!seriesKey,
  });
  const worstDay = l2?.worstDay;
  const { data: lineRank, isFetching: lineLoading } = useQuery({
    queryKey: ["attain-lines", seriesKey, worstDay],
    queryFn: () => fetchLineRanking(seriesKey!, worstDay!, (lineId) => { setPickedLine(lineId); setView("equip"); }),
    enabled: open && view === "lines" && !!seriesKey && !!worstDay,
  });
  const { data: l3, isFetching: l3Loading } = useQuery({
    queryKey: ["attain-equip", seriesKey, worstDay, pickedLine],
    queryFn: () => fetchEquipDrill(seriesKey!, worstDay!, pickedLine, (eq) => { setPickedEquip(eq); setView("equiptrend"); }),
    enabled: open && view === "equip" && !!seriesKey && !!worstDay,
  });
  const { data: trend, isFetching: trendLoading } = useQuery({
    queryKey: ["equip-trend", pickedEquip],
    queryFn: () => fetchEquipTrend(pickedEquip!),
    enabled: open && view === "equiptrend" && !!pickedEquip,
  });
  const close = () => { setOpen(false); setView("days"); setPickedLine(undefined); setPickedEquip(undefined); };
  return (
    <>
      <button
        type="button"
        data-testid={`kpi-drill-${def.key}`}
        onClick={() => { setView("days"); setOpen(true); }}
        title="点开逐日拆因 → 逐线 → 逐设备 → 设备趋势"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
      >
        <KpiWidget value={value} unit={def.unit} scale={scale} />
        <span style={{ fontSize: 10, color: "var(--accent,#6ea8fe)" }}>点开逐日拆因 →</span>
      </button>
      {open && view === "days" && (
        <DagNodeDrawer
          onClose={close}
          detail={{
            title: `${def.title} · 逐日拆因`,
            src: def.provenance?.sourceSystem ?? "时序库·attainment:line",
            formula: def.provenance?.formula ?? "达成率 = 设备效率达成 × 良率达成",
            inputs: def.provenance?.inputs,
            rule: def.provenance?.ruleRefs,
            note: l2Loading ? "加载逐日派生数据…" : def.provenance?.note,
            breakdown: l2?.breakdown ?? { columns: ["日期"], rows: [], caption: l2Loading ? "加载中…" : "" },
            action: worstDay ? { label: `下钻最差日 ${worstDay.slice(5)} · 全线排行 →`, onClick: () => setView("lines") } : undefined,
          }}
        />
      )}
      {open && view === "lines" && (
        <DagNodeDrawer
          onClose={close}
          detail={{
            title: `${def.title} · 全线达成率排行（${worstDay?.slice(5) ?? ""}）`,
            src: "时序库·attainment:line（各线该日达成率）",
            formula: "点任一产线 → 下钻其逐台 oee:equip / yield:process",
            rule: def.provenance?.ruleRefs,
            note: lineLoading ? "加载全线排行…" : "灰底=该日达成率最低产线；点行下钻该线逐设备勾稽（A3）",
            breakdown: lineRank ?? { columns: ["产线"], rows: [], caption: lineLoading ? "加载中…" : "" },
            action: { label: "← 返回逐日拆因", onClick: () => setView("days") },
          }}
        />
      )}
      {open && view === "equip" && (
        <DagNodeDrawer
          onClose={close}
          detail={{
            title: `${def.title} · 逐设备勾稽（${pickedLine ?? "最差线"}·${worstDay?.slice(5) ?? ""}）`,
            src: "时序库·oee:equip / yield:process（沿 Line→Equipment/Process 拓扑）",
            formula: "产线OEE = Σ(设备oee×产量)/Σ产量；产线良率 = avg(工序yield)",
            rule: def.provenance?.ruleRefs,
            note: l3Loading ? "加载逐台设备/工序数据…" : "最低 OEE 设备 = 该日该线达成率主要拖累点（停机/低效）；点设备行看其 OEE 趋势（A2·R13）",
            breakdown: l3 ?? { columns: ["对象"], rows: [], caption: l3Loading ? "加载中…" : "" },
            action: { label: "← 返回全线排行", onClick: () => setView("lines") },
          }}
        />
      )}
      {open && view === "equiptrend" && (
        <DagNodeDrawer
          onClose={close}
          detail={{
            title: `${def.title} · 设备 OEE 趋势`,
            src: "时序库·oee:equip（单台设备逐日）",
            formula: "OEE = 可用率 × 性能 × 良率（设备级），逐日时序",
            note: trendLoading ? "加载设备趋势…" : "该设备近期 OEE 走势——定位停机/低效是持续性还是单日（R13 逐设备时间轴）",
            breakdown: trend ?? { columns: ["日期"], rows: [], caption: trendLoading ? "加载中…" : "" },
            action: { label: "← 返回逐设备", onClick: () => setView("equip") },
          }}
        />
      )}
    </>
  );
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
              src={def.provenance.sourceSystem ?? def.provenance.toolName}
              formula={def.provenance.formula ?? def.provenance.label ?? `输出路径 ${def.provenance.outputPath}`}
              freshness={def.provenance.snapshotVersion ? `快照 ${def.provenance.snapshotVersion}` : undefined}
              rule={def.provenance.ruleRefs}
              inputs={def.provenance.inputs}
              note={def.provenance.note ?? `输出路径 ${def.provenance.outputPath} · 驾驶舱声明式查询（ViewConfig.layout.widgets）`}
            >
              <span className="badge">ⓘ</span>
            </Provenance>
          </span>
        )}
      </div>
      {isLoading ? (
        <div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div>
      ) : def.type === "kpi" ? (
        def.drill ? <KpiDrillButton def={def} value={data} scale={def.scale} /> : <KpiWidget value={data} unit={def.unit} scale={def.scale} />
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

function KpiWidget({ value, unit, scale }: { value: unknown; unit?: string; scale?: number }) {
  // M7：比率字段 ×scale 显示（如 util 0.78 × 100 = 78%），缺省不缩放。
  const scaled = typeof value === "number" && scale && scale !== 1 ? value * scale : value;
  const display =
    typeof scaled === "number" ? (Number.isInteger(scaled) ? scaled.toLocaleString() : scaled.toFixed(scale && scale !== 1 ? 1 : 2)) : String(scaled ?? "—");
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
