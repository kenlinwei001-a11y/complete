import { useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg } from "@/api/endpoints";
import type { DashboardWidgetDef, WidgetQueryDef, AffectedOrdersOutputVM } from "@/api/types";
import { SEG_REGISTRY, TIGHTNESS_METRIC, formatTightness } from "@platform/contracts";
import { Feature } from "@/workspace/featureGate";
import { EChart } from "@/components/ui/EChart";
import { BlockConversable } from "@/components/BlockConversable";
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
  { key: "aop", route: "/v/annual-scenario", title: "年度规划", sub: "三情景 · 触发挂牌 · 目标分解", color: "#9D8BF0" }, // debattery-allow
  { key: "quarter", route: "/v/quarterly-rolling", title: "季度规划", sub: "爬坡 vs 需求 · 长协偏差", color: "#5E8FE8" }, // debattery-allow
  { key: "sop", route: "/v/sop-balance", title: "月度规划", sub: "五步法 · 三线差异 · 版本管理", color: "#B07FD8" }, // debattery-allow
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

/**
 * KPI 卡装饰查找（真序列派生·KILL-MOCK）：一次取 history bundle → 给有**真时序**的 KPI 卡挂 sparkline + 环比 delta；
 * 计划达成率标 accent（实心橙卡·进度由真值派生）。无真序列的卡不挂装饰（诚实空·不编趋势）。
 */
function useKpiDecor(): (key: string) => KpiDecor | undefined {
  const { data } = useQuery({
    queryKey: ["a", "dash-kpi-decor-history"],
    queryFn: () => fetchHistoryBundle({ pageSize: 1 }),
    retry: false,
    staleTime: 60_000,
  });
  const trend = (data?.trend ?? []).map((p) => p.output).filter((n): n is number => typeof n === "number");
  const supply = (data?.deviation ?? []).map((d) => d.supply).filter((n): n is number => typeof n === "number");
  return (key: string): KpiDecor | undefined => {
    if (key === "gwh" && trend.length >= 2) {
      const sd = sparkDelta(trend);
      return { spark: trend.slice(-12), sparkLabel: "近月产出趋势（万套·真序列）", delta: sd?.delta, deltaTone: sd?.tone };
    }
    if (key === "supply-v7" && supply.length >= 2) {
      const sd = sparkDelta(supply);
      return { spark: supply.slice(-12), sparkLabel: "近月可供给趋势（万套·真序列）", delta: sd?.delta, deltaTone: sd?.tone };
    }
    if (key === "attain") return { accent: true }; // 计划达成率 → 实心橙 accent 卡（进度=真值 vs 100%）
    return undefined;
  };
}

export default function DashboardView({ view }: ViewRendererProps) {
  const navigate = useNavigate();
  const decorFor = useKpiDecor();
  const widgets = ((view.layout?.widgets as DashboardWidgetDef[] | undefined) ?? []).filter(Boolean);
  if (widgets.length === 0) return <div className="empty-state">{zh.common.none}</div>;
  const modLinks = (view.layout?.moduleLinks as ModLink[] | undefined) ?? MODULE_LINKS;
  const feedbackChain = (view.layout?.feedbackChain as string[] | undefined) ?? FEEDBACK_CHAIN;
  // #9 「经营指标」→「未达成指标根因下钻」联动：左侧点行选中该指标 → 右侧 rootcause 面板以 metricKey 真调 gap_attribution 下钻。
  const [drillMetric, setDrillMetric] = useState<CockpitMetricSel | null>(null);
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
              <Widget def={w} decor={decorFor(w.key)} drillMetric={drillMetric} onDrillMetric={setDrillMetric} />
            </Feature>
          ) : (
            <Widget key={w.key} def={w} decor={decorFor(w.key)} drillMetric={drillMetric} onDrillMetric={setDrillMetric} />
          ),
        )}
      </div>

      {/* 待解决的问题（自下而上：受影响订单逐单归因 → 问题清单） */}
      <ProblemPanel />

      {/* WO-A 供需失衡双向归因（真调 supply_demand_gap_attribution·需求端 ⊥ 供给端 + residual·勾稽 Σ=G） */}
      <SupplyDemandAttributionPanel />

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

      {/* 💡 决策推演入口（decision_play 5 区决策页·CEO「每个行动点开看·为何做/何用/为何有用」）。 */}
      <div className="panel" style={{ marginTop: 14, borderLeft: "3px solid var(--accent)" }} data-testid="dash-decision-entry">
        <div className="section-title">💡 决策推演</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            从越线根因一路到对症方案（各维真算 + provenance 下钻）、比对矩阵、触发规则、推荐组合与差距收窄试算——每个行动点开看为何做 / 何用 / 为何有用。
          </div>
          <button className="btn primary" data-testid="dash-decision-go" onClick={() => navigate("/v/decision-play")}>
            进入决策推演 ›
          </button>
          {/* WO-OPTIMIZE-WHATIF-FE：优化推演入口（改目标/约束→真 CP-SAT 重解→Δ目标·闭 G-12 前端半）。 */}
          <button className="btn" data-testid="dash-optimize-go" onClick={() => navigate("/v/optimize-whatif")}>
            优化推演（Δ目标）›
          </button>
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

// ─────────────────────────────────────────────────────────────────────────────
// WO-A · 供需失衡双向归因（supply_demand_gap_attribution 求解器接线）
// 病根：引擎 supply_demand_gap_attribution 已建（双向勾稽·9 测绿）但前端零调用——CEO 看不到
// 「缺口是需求端(预测虚高)还是供给端(产能/物料/OEE)，各占多少」。此 Panel 真调求解器→渲双向分解。
// KILL-MOCK：占比/贡献/provenance 全从真求解器输出派生，前端零写死；改后端颗粒→此处占比随变。
// 诚实空：无 S&OP 产销正缺口 → 不编五五开；供给端产能叶缺（Line.capacityDaily 未落）→ 显「诚实空」。
// ─────────────────────────────────────────────────────────────────────────────

/** 双向归因叶（真颗粒·万套等效·每叶带 provenance 下钻真对象 R13）。 */
interface SdgDriver {
  id: string;
  factor: string;
  contribution: number;
  share: number;
  unit?: string;
  driverValue?: number;
  provenance?: { kind?: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number };
}
interface SdgSide { contribution: number; share: number; pct: number; drivers: SdgDriver[] }
/** supply_demand_gap_attribution 求解器输出契约（datacore service.ts:946-1058·前端只读渲染）。 */
export interface SupplyDemandGapOutput {
  rootMetric?: { key: string; name: string; unit: string; gap: number };
  totalGap: number;
  unit?: string;
  demandSide: SdgSide | null;
  supplySide: SdgSide | null;
  residual: number;
  reconChecks?: { label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }[];
  reconciled?: boolean;
  residualPct?: number;
  summary?: string;
}

/** 供给端已知叶 id（引擎侧一等 key）——产能缺口叶。 */
const SDG_CAPACITY_LEAF = "capacity_gap";
/**
 * 供给端产能数据是否已接：引擎读 Line.capacityDaily，demo 仅种 max_capacity_day → capacityDaily 缺
 * → 引擎诚实不推产能缺口叶（capGap=0）。此判据用于前端**诚实渲染**（叶缺 → 显「产能数据未接·诚实空」，
 * 绝不编造产能占比）。前端零写死：直接看真输出里有无 capacity_gap 叶。
 */
export function supplyCapacityConnected(out: SupplyDemandGapOutput | undefined): boolean {
  return !!out?.supplySide?.drivers?.some((d) => d.id === SDG_CAPACITY_LEAF);
}

const sdgR1 = (x: number) => Math.round(x * 10) / 10;
const sdgR4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** 前端归一化视图模型：占比由求解器真贡献派生（非信 pct 字段·非写死），勾稽 Σ=G 客户端亲验（非只信 reconciled 标志）。 */
export interface SupplyDemandView {
  available: boolean;
  reason?: string;
  totalGap: number;
  unit: string;
  demand: { pct: number; contribution: number; share: number; drivers: SdgDriver[] } | null;
  supply: { pct: number; contribution: number; share: number; drivers: SdgDriver[] } | null;
  residual: number;
  residualPct: number;
  capacityConnected: boolean;
  reconSum: number;
  reconciled: boolean;
}
export function supplyDemandView(out: SupplyDemandGapOutput | undefined): SupplyDemandView {
  const unit = out?.unit ?? out?.rootMetric?.unit ?? "万套";
  const G = sdgR4(out?.totalGap ?? 0);
  const demand = out?.demandSide;
  const supply = out?.supplySide;
  // 诚实空：无求解器数据 / 无双向支 / 无正缺口 → 不编造（KILL-MOCK-RED）。
  if (!out || !demand || !supply || !(G > 0)) {
    return {
      available: false,
      reason: out?.summary ?? "无供需归因数据（诚实空·未编五五开）",
      totalGap: G, unit, demand: null, supply: null,
      residual: sdgR4(out?.residual ?? G), residualPct: G > 0 ? 100 : 0,
      capacityConnected: false, reconSum: 0, reconciled: false,
    };
  }
  const dc = sdgR4(demand.contribution);
  const sc = sdgR4(supply.contribution);
  const res = sdgR4(out.residual ?? 0);
  const reconSum = sdgR4(dc + sc + res);
  return {
    available: true, totalGap: G, unit,
    // 占比 = 真贡献 / 总缺口（活派生·改颗粒即变·C4）。
    demand: { pct: sdgR1((dc / G) * 100), contribution: dc, share: sdgR4(demand.share ?? dc / G), drivers: demand.drivers ?? [] },
    supply: { pct: sdgR1((sc / G) * 100), contribution: sc, share: sdgR4(supply.share ?? sc / G), drivers: supply.drivers ?? [] },
    residual: res, residualPct: sdgR1((Math.abs(res) / G) * 100),
    capacityConnected: supplyCapacityConnected(out),
    // 勾稽亲验：需求端贡献 + 供给端贡献 + residual == 总缺口（浮点≤1e-4·不只信 reconciled 标志）。
    reconSum, reconciled: Math.abs(reconSum - G) <= 1e-4,
  };
}

/** 双向归因单侧叶表：每叶 贡献/占比 + provenance 下钻真对象（drillType.drillId.drillField=drillValue·R13）。 */
function SdgSideBlock({ title, side, kind, unit, note }: { title: string; side: { pct: number; contribution: number; drivers: SdgDriver[] }; kind: "demand" | "supply"; unit: string; note?: ReactNode }) {
  const color = kind === "demand" ? "#7E8BEE" : "#DD7E9E";
  return (
    <div data-testid={`sdg-side-${kind}`}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        <span style={{ color }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--muted2)", fontWeight: 400 }}> · 占缺口 <b className="mono" data-testid={`sdg-${kind}-pct`}>{side.pct}%</b> · 贡献 <b className="mono">{side.contribution}</b>{unit}</span>
      </div>
      {side.drivers.length === 0 ? (
        <div className="badge" style={{ color: "var(--muted2)" }} data-testid={`sdg-${kind}-empty`}>该侧无驱动叶 · 诚实空（未编造）</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {side.drivers.map((d) => (
            <div key={d.id} className="panel" data-testid={`sdg-leaf-${d.id}`} style={{ padding: 6, borderLeft: `2px solid ${color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
                <span>{d.factor}</span>
                <b className="mono" style={{ whiteSpace: "nowrap" }}>{d.contribution}{unit} · {Math.round((d.share ?? 0) * 100)}%</b>
              </div>
              {d.provenance?.drillType && (
                // 下钻真对象（R13）：数据源 = drillType.drillId.drillField · 当前值 · 实测/派生标注。
                <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 2 }} data-testid={`sdg-prov-${d.id}`}>
                  下钻 {d.provenance.drillType}{d.provenance.drillId ? `.${d.provenance.drillId}` : ""}.{d.provenance.drillField} = <span className="mono">{d.provenance.drillValue}</span>
                  {d.provenance.kind ? <span className="badge" style={{ marginLeft: 4, fontSize: 9.5 }}>{d.provenance.kind}</span> : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {note}
    </div>
  );
}

/**
 * 驾驶舱「供需失衡双向归因」Panel（常驻·自取数·真调 supply_demand_gap_attribution）。
 * 总缺口 G → 需求端(预测偏差/在手订单/结构漂移) ⊥ 供给端(产能/物料/OEE) + residual·勾稽可视 Σ=G。
 * 无数据/求解器未接 → 静默不渲染（避免驾驶舱堆空块）；有数据但无正缺口 → 诚实空提示。
 */
function SupplyDemandAttributionPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "supply-demand-gap-attribution"],
    queryFn: async () => (await invokeSolver("supply_demand_gap_attribution", {})).data as SupplyDemandGapOutput,
    retry: false,
  });
  // 加载中 / 求解器不可用（如 mock 未接入 → 404）→ 静默不渲染（诚实：无真数据不占位不伪造）。
  if (isLoading || isError || !data) return null;
  const view = supplyDemandView(data);
  // WO-BLOCK-DIALOGUE：块级 getData 返该块**真实渲染数据**（供需双向的需求端/供给端占比·贡献·勾稽·metricKey 全真值·非写死）。
  const blockData = (): Record<string, unknown> => ({
    metricKey: data.rootMetric?.key,
    available: view.available,
    totalGap: view.totalGap,
    unit: view.unit,
    demandPct: view.demand?.pct ?? null,
    demandContribution: view.demand?.contribution ?? null,
    supplyPct: view.supply?.pct ?? null,
    supplyContribution: view.supply?.contribution ?? null,
    residual: view.residual,
    residualPct: view.residualPct,
    reconSum: view.reconSum,
    reconciled: view.reconciled,
    capacityConnected: view.capacityConnected,
    demandDrivers: (view.demand?.drivers ?? []).map((d) => ({ factor: d.factor, contribution: d.contribution, share: d.share })),
    supplyDrivers: (view.supply?.drivers ?? []).map((d) => ({ factor: d.factor, contribution: d.contribution, share: d.share })),
  });
  const wrap = (node: ReactNode) => (
    <BlockConversable blockId="dash-supply-demand" blockType="supply-demand" blockTitle="供需失衡双向归因" getData={blockData} provenanceRef="supply_demand_gap_attribution">
      {node}
    </BlockConversable>
  );
  if (!view.available) {
    return wrap(
      <div className="panel" style={{ marginTop: 16 }} data-testid="dash-supply-demand">
        <div className="section-title">供需失衡双向归因</div>
        <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="sdg-honest-empty">{view.reason}</div>
      </div>,
    );
  }
  const demand = view.demand!;
  const supply = view.supply!;
  return wrap(
    <div className="panel" style={{ marginTop: 16 }} data-testid="dash-supply-demand">
      <div className="section-title">供需失衡双向归因</div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 8 }}>
        产销总缺口 <b className="mono" data-testid="sdg-total">{view.totalGap}</b> {view.unit} · 反向双向分解：需求端 ⊥ 供给端 + residual（占比全由求解器真颗粒派生 · 前端零写死）
      </div>
      {/* 双向占比条（需求端 ⊥ 供给端 + residual = 100%·勾稽可视） */}
      <div data-testid="sdg-split" style={{ display: "flex", height: 22, borderRadius: 4, overflow: "hidden", fontSize: 10, marginBottom: 12, background: "var(--panel2)" }}>
        {demand.pct > 0 && <div style={{ width: `${demand.pct}%`, background: "#7E8BEE", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>需求端 {demand.pct}%</div>}
        {supply.pct > 0 && <div style={{ width: `${supply.pct}%`, background: "#DD7E9E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>供给端 {supply.pct}%</div>}
        {view.residualPct > 0 && <div style={{ width: `${view.residualPct}%`, background: "rgba(103,115,127,.5)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>residual {view.residualPct}%</div>}
      </div>
      {/* 两侧叶表（各归其侧·真值下钻） */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <SdgSideBlock title="需求端" kind="demand" side={demand} unit={view.unit} />
        <SdgSideBlock
          title="供给端" kind="supply" side={supply} unit={view.unit}
          note={!view.capacityConnected ? (
            // 诚实 GAP：Line.capacityDaily 未落（demo 仅种 max_capacity_day）→ 引擎不推产能缺口叶。
            // 绝不编造产能占比——如实标灰，待数据接入。
            <div data-testid="sdg-capacity-empty" className="badge" style={{ marginTop: 6, color: "var(--muted2)", whiteSpace: "normal", lineHeight: 1.4 }}>
              ⚠ 供给端产能缺口叶未接：Line.capacityDaily 未落库（当前仅 max_capacity_day）· 诚实空（未编造产能占比）
            </div>
          ) : null}
        />
      </div>
      {/* 勾稽可视：需求端贡献 + 供给端贡献 + residual = 总缺口（客户端亲验·非只信标志） */}
      <div data-testid="sdg-recon" style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted)" }}>
        勾稽 需求端 <b className="mono">{demand.contribution}</b> + 供给端 <b className="mono">{supply.contribution}</b> + residual <b className="mono">{view.residual}</b> = <b className="mono" data-testid="sdg-recon-sum">{view.reconSum}</b> {view.unit}
        <span style={{ margin: "0 6px" }}>vs 总缺口</span><b className="mono">{view.totalGap}</b> {view.unit}
        <span className="badge" data-testid="sdg-reconciled" style={{ marginLeft: 8, color: view.reconciled ? "var(--ok)" : "var(--danger)" }}>{view.reconciled ? "勾稽通过 ✓" : "勾稽未通过"}</span>
      </div>
    </div>
  );
}

// ─── iOS 分段控件（结构层·全主题）：圆角容器 + 滑动实心活跃 pill；warm 下活跃 pill 走深橙（经 .segGroup 的
// --seg-active-* 变量·见 theme-warm.css），其余主题回落 var(--panel) 白 pill。活跃色用 var(fallback) 规避 inline 冲突。
const segBarStyle: CSSProperties = { display: "inline-flex", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: 3, gap: 2 };
function segBtnStyle(active: boolean): CSSProperties {
  return {
    padding: "4px 12px", borderRadius: 8, fontSize: 12, border: "none", cursor: "pointer", whiteSpace: "nowrap",
    fontWeight: active ? 600 : 400, transition: "0.15s",
    background: active ? "var(--seg-active-bg, var(--panel))" : "transparent",
    color: active ? "var(--seg-active-txt, var(--txt))" : "var(--muted)",
    boxShadow: active ? "0 1px 2px rgba(17,17,26,.10)" : "none",
  };
}

/** 延期药丸（mono 小 pill）：重延（≥4d）重红 · 轻延（1–3d）轻橙 · 无延显破折号。真值派生·右对齐列用。 */
function DelayPill({ delay }: { delay: number }) {
  if (delay <= 0) return <span style={{ color: "var(--muted2)" }}>—</span>;
  const heavy = delay >= 4;
  return (
    <span className="mono" style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, background: heavy ? "rgba(229,72,77,.12)" : "rgba(232,89,12,.12)", color: heavy ? "var(--danger)" : "#E8590C" }}>
      +{delay}d
    </span>
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
    const e = SEG_ECON[r.seg] ?? { price: 0, margin: 0 }; // 假5 修：缺 SEG 参考价 → 诚实 0（不臆造 {price:0.6,margin:13}）
    const s = r.qty * e.price;
    sales += s;
    gp += (s * e.margin) / 100;
  }
  const gmRate = sales > 0 ? (gp / sales) * 100 : 0;
  return (
    <div data-testid="dash-order-ledger">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        <div className="segGroup" style={segBarStyle}>
          <button data-testid="ledger-seg-all" style={segBtnStyle(!seg)} onClick={() => setSeg("")}>{zh.dash.ledgerAll}</button>
          {segs.map((s) => (
            <button key={s} data-testid={`ledger-seg-${s}`} style={segBtnStyle(seg === s)} onClick={() => setSeg(s)}>{s}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12 }}>
          {zh.dash.ledgerGm}{" "}
          {/* 假5 修：毛利率为估算口径（SEG_REGISTRY 参考价派生·非 metric_rollup 实测）——逐格 Provenance + 脚注披露。 */}
          <Provenance testId="dash-gm" src="affected_orders × SEG_REGISTRY" formula="综合毛利率 = Σ(数量×SEG 参考单价×SEG 参考毛利率) ÷ Σ营收" inputs={["受影响订单数量", "SEG_REGISTRY 参考单价/毛利率"]} note="估算口径 · SEG 参考值非 metric_rollup 财务实测">
            <b className="mono" data-testid="ledger-gmrate">{gmRate.toFixed(1)}%</b>
          </Provenance>{" "}
          · {filtered.length} 单
        </span>
      </div>
      <table className="cmp" data-testid="ledger-table" style={{ fontSize: 12, width: "100%" }}>
        <thead><tr>
          <th>订单</th><th>客户</th><th>细分</th><th>型号</th>
          <th style={{ textAlign: "right" }}>数量</th>
          <th style={{ textAlign: "right" }}>交期</th>
          <th style={{ textAlign: "right" }}>延期</th>
          <th>风险</th>
        </tr></thead>
        <tbody>
          {filtered.slice(0, 12).map((r) => (
            <tr key={r.so} data-testid={`ledger-row-${r.so}`} style={{ cursor: "pointer" }} title={zh.dash.ledgerDrill} onClick={() => navigate("/v/order-chain")}>
              <td>{r.so}</td><td>{r.cust}</td><td>{r.seg}</td><td>{r.model}</td>
              <td className="mono" style={{ textAlign: "right" }}>{r.qty.toLocaleString()}</td>
              <td className="mono" style={{ textAlign: "right", color: "var(--muted2)" }}>{r.due}</td>
              <td style={{ textAlign: "right" }}><DelayPill delay={r.delay} /></td>
              <td style={{ fontSize: 11 }}>{[...new Set(r.risks.map((k) => k.factor))].join("/") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 假5 披露脚注：综合毛利率为估算口径（SEG_REGISTRY 参考价派生·非 metric_rollup 财务实测）。 */}
      <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 6 }} data-testid="dash-ledger-gmnote">{zh.dash.ledgerGmNote}</div>
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
  // WO-BLOCK-DIALOGUE：块级 getData 返根因树该块真实数据（当前层级·各 KPI 目标/实际/是否越线·展开的根因指标 metricKey 锚定）。
  const drillBlockData = (): Record<string, unknown> => ({
    level,
    metricKey: openKpi ?? kpis.find((k) => k.offTarget)?.kpiId,
    openKpi,
    kpis: kpis.map((k) => ({ kpiId: k.kpiId, name: k.name, category: k.category, actual: k.actual, target: k.target, unit: k.unit, offTarget: k.offTarget, status: k.status })),
    offTargetCount: kpis.filter((k) => k.offTarget).length,
  });
  return (
    <BlockConversable blockId="dash-plan-drill" blockType="root-cause-tree" blockTitle="规划根因下钻（根因树 DAG）" getData={drillBlockData} provenanceRef="gap_attribution">
    <div data-testid="dash-plan-drill">
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <div className="segGroup" style={segBarStyle}>
          {(["op", "month", "quarter", "year"] as const).map((lv) => (
            <button key={lv} data-testid={`drill-level-${lv}`} style={segBtnStyle(level === lv)} onClick={() => { setLevel(lv); setOpenKpi(null); }}>
              {zh.dash.drillLevels[lv]}
            </button>
          ))}
        </div>
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
    </BlockConversable>
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

function Widget({ def, decor, drillMetric, onDrillMetric }: { def: DashboardWidgetDef; decor?: KpiDecor; drillMetric?: CockpitMetricSel | null; onDrillMetric?: (m: CockpitMetricSel | null) => void }) {
  const { data, isLoading } = useWidgetData(def.query);
  // 结构层类名（warm 专属样式挂钩·其余主题无规则即回落普通卡）：accent 实心橙卡 / 深炭灰签名卡。
  const markerClass = [def.type === "kpi" && decor?.accent ? "warmKpiAccent" : "", def.type === "metric-strip" ? "warmSignature" : ""].filter(Boolean).join(" ");

  return (
    <div className={`${styles.card} ${markerClass}`} style={{ gridColumn: `span ${def.span ?? 1}`, display: "flex", flexDirection: "column", alignSelf: def.type === "kpi" ? "start" : undefined }} data-testid={`widget-${def.key}`}>
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
        <KpiWidget value={data} unit={def.unit} decor={decor} />
      ) : def.type === "chart" ? (
        <ChartWidget data={data} kind={def.chartKind ?? "line"} series={def.chartSeries} def={def} />
      ) : def.type === "summary" ? (
        <SummaryWidget data={data} />
      ) : def.type === "dag" ? (
        // #9 rootcause 面板：与左「经营指标」联动——选中指标 → 以 metricKey 真调 gap_attribution 下钻（达成/未达成皆可）；未选 → 回落 plan_rootcause.dag。
        def.key === "rootcause" ? (
          <RootCauseDrillWidget selectedMetric={drillMetric ?? null} fallbackDag={data as DagData | undefined} />
        ) : (
          <ProvenanceDag data={data as DagData | undefined} />
        )
      ) : def.type === "metric-strip" ? (
        <MetricStrip metrics={data as MetricRow[] | undefined} selectedKey={drillMetric?.key ?? null} onSelect={onDrillMetric} />
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
type MetricRow = { metricId: string; key?: string; name: string; unit?: string; target: number; actual: number; delta: number; miss: boolean };
/** #9 驾驶舱指标下钻选择：点左「经营指标」任一行 → 右「未达成指标根因下钻」联动该指标（达成/未达成皆可）。 */
export type CockpitMetricSel = { key: string; name: string };
function MetricStrip({ metrics, selectedKey, onSelect }: { metrics: MetricRow[] | undefined; selectedKey?: string | null; onSelect?: (m: CockpitMetricSel | null) => void }) {
  const rows = metrics ?? [];
  if (rows.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;
  // #9 metricKey 单一口径：优先 Metric.key（gap_attribution 一等键·如 material_cov），回落 metricId（真 solver 二者皆匹配 service.ts:1271）。
  const keyOf = (m: MetricRow) => m.key ?? m.metricId;
  // WO-BLOCK-DIALOGUE：块级 getData 返 KPI 指标条该块真实数据（每指标 目标/实际/差/是否越线·metricKey 锚定首个越线指标）。
  const msBlockData = (): Record<string, unknown> => ({
    metricKey: (rows.find((m) => m.miss) ?? rows[0])?.metricId,
    metrics: rows.map((m) => ({ metricId: m.metricId, name: m.name, unit: m.unit, target: m.target, actual: m.actual, delta: m.delta, miss: m.miss })),
    missCount: rows.filter((m) => m.miss).length,
  });
  // 综合达成健康度（真派生）：越线数 → 良好/中等/偏弱（顶部汇总头·非写死）。
  const missCount = rows.filter((m) => m.miss).length;
  const health = missCount === 0 ? { word: "良好", color: "var(--ok)" } : missCount <= 1 ? { word: "中等", color: "var(--amber)" } : { word: "偏弱", color: "var(--danger)" };
  return (
    <BlockConversable blockId="metric-strip" blockType="metric-strip" blockTitle="经营指标条（KPI 达标）" getData={msBlockData} provenanceRef="metric_rollup">
    <div data-testid="metric-strip" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 顶部「综合达成健康度」汇总头（真派生自越线数） */}
      <div data-testid="metric-health" style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>综合达成健康度</span>
        <b style={{ fontSize: 22, fontWeight: 700, color: health.color, letterSpacing: "0.02em" }}>{health.word}</b>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>{rows.length} 项指标 · {missCount} 项越线</span>
      </div>
      {rows.map((m) => {
        const status = m.miss ? "var(--danger)" : "var(--ok)";
        const pct = m.target > 0 ? Math.max(0, Math.min(100, (m.actual / m.target) * 100)) : 0;
        const mk = keyOf(m);
        const selected = selectedKey != null && selectedKey === mk;
        // #9 每行可点：下钻该指标根因（达成/未达成皆可）；点选中行再点 → 取消（回落默认越线根因）。
        return (
          <button
            type="button"
            key={m.metricId}
            data-testid={`metric-${m.metricId}`}
            data-selected={selected ? "1" : "0"}
            title="点击下钻该指标根因（达成 / 未达成皆可）"
            onClick={() => onSelect?.(selected ? null : { key: mk, name: m.name })}
            style={{
              display: "flex", flexDirection: "column", gap: 5, textAlign: "left", cursor: "pointer",
              background: selected ? "var(--panel2)" : "transparent", border: "none",
              borderLeft: `3px solid ${selected ? "var(--accent)" : "transparent"}`,
              padding: "4px 8px", borderRadius: 6, width: "100%", font: "inherit", color: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--txt)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: status, flex: "none" }} />
                {m.name}
                <span style={{ fontSize: 10, color: selected ? "var(--accent)" : "var(--muted2)" }}>{selected ? "下钻中 ›" : "下钻 ›"}</span>
              </span>
              <b className="mono" style={{ fontSize: 16, fontWeight: 700, color: m.miss ? "var(--danger)" : "var(--txt)" }}>
                {formatKpiValue(m.actual, m.unit)}{m.unit}
              </b>
            </div>
            {/* 达成进度条（actual/target·真值）——绿达标 / 红越线 */}
            <div style={{ height: 5, borderRadius: 999, background: "var(--line2)", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: status }} />
            </div>
            <div style={{ fontSize: 10.5, color: m.miss ? "var(--danger)" : "var(--muted2)" }}>
              目标 {formatKpiValue(m.target, m.unit)}{m.unit} · 差 {m.delta > 0 ? "+" : ""}{formatKpiValue(m.delta, m.unit)}{m.unit}{m.miss ? " · 越线" : ""}
            </div>
          </button>
        );
      })}
    </div>
    </BlockConversable>
  );
}

/**
 * #9 规划决策推演 · 未达成指标根因下钻（右面板·与左「经营指标」联动）：
 * 点左侧任一指标行 → 以该指标 metricKey 真调 **gap_attribution**（复用 PlanDrillWidget 同一深度反向归因路径），
 * 下钻其根因（**达成 / 未达成皆可**）。
 *   · 未达成（有缺口）→ gapAttributionToDag 投影多跳 caused_by 因果树（越线根 → 结构叶 → 逐跳终点根因）。
 *   · 已达成（actual≥target · solver 返 noGap=true · levels 空）→ **不空/不报错**：诚实正向框「达成·无缺口」
 *     + 仅渲该指标结构根（gapAttributionToDag 仍产 GREEN KPI 根节点）。**绝不为达成指标编造缺口子树**
 *     （KILL-MOCK-RED·铁律0.4——真 solver 零缺口短路 service.ts:1279 本就返空 levels，前端如实呈现结构根而非伪造分摊）。
 * 未选任何指标 → 回落 plan_rootcause.dag（默认自动展示越线根因·不破现状）。
 */
type GapAttrWithFlag = GapAttrOutput & { noGap?: boolean; totalGap?: number };
function RootCauseDrillWidget({ selectedMetric, fallbackDag }: { selectedMetric: CockpitMetricSel | null; fallbackDag: DagData | undefined }) {
  const metricKey = selectedMetric?.key ?? null;
  // 选中指标 → 以 metricKey 真调 gap_attribution（与 PlanDrillWidget 同路径·引擎不改）。切指标 → queryKey 变 → 真重下钻。
  const { data: ga, isLoading } = useQuery({
    queryKey: ["a", "cockpit-rootcause-drill", metricKey],
    queryFn: async () => (await invokeSolver("gap_attribution", { metricKey })).data as GapAttrWithFlag,
    enabled: !!metricKey,
    retry: false,
  });
  // 未选指标 → 默认展示越线根因（plan_rootcause.dag·不破现状）+ 提示点左侧指标联动。
  if (!metricKey) {
    return (
      <div data-testid="cockpit-rootcause" data-metric="">
        <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 8 }} data-testid="rootcause-hint">
          点击左侧「经营指标」任一行 → 下钻该指标根因（达成 / 未达成皆可）
        </div>
        <ProvenanceDag data={fallbackDag} />
      </div>
    );
  }
  if (isLoading || !ga?.rootMetric) return <div style={{ color: "var(--muted2)" }} data-testid="rootcause-loading">{zh.common.loading}</div>;
  const rm = ga.rootMetric;
  // noGap（达成）判据：solver noGap 标志优先（单一来源·前端不自判缺口）；兜底 totalGap<=0 / actual>=target。
  const achieved = ga.noGap === true || (typeof ga.totalGap === "number" ? ga.totalGap <= 0 : rm.actual != null && rm.target != null && rm.actual >= rm.target);
  const dag = gapAttributionToDag(ga); // 达成态 levels 空 → 仅产 GREEN KPI 根（结构根·非空树）。
  return (
    <div data-testid="cockpit-rootcause" data-metric={metricKey} data-achieved={achieved ? "1" : "0"}>
      {achieved ? (
        // 达成·无缺口：诚实正向框（不空不报错）——solver noGap（levels 空）→ 仅展示达成结构根，不编缺口子树。
        <div className="panel" data-testid="rootcause-achieved" style={{ padding: 8, marginBottom: 8, borderLeft: "3px solid var(--ok)" }}>
          <b style={{ color: "var(--ok)" }}>✓ 「{rm.name}」已达成 · 无缺口</b>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            实际 <b className="mono">{rm.actual}{rm.unit}</b> ≥ 目标 <b className="mono">{rm.target}{rm.unit}</b> —— 无需归因；下方为该指标达成结构（无缺口子树·诚实不编造）。
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }} data-testid="rootcause-drilled">
          下钻指标「<b>{rm.name}</b>」根因 · 缺口 <b className="mono">{ga.totalGap ?? rm.gap}{rm.unit}</b>（gap_attribution 深度反向归因）
        </div>
      )}
      <ProvenanceDag data={dag} />
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
  // WO-BLOCK-DIALOGUE：块级 getData 返反事实双轨该块真实数据（基地/因素/处置·峰值削减·越线推迟·少越线日·阈值·当前基地）。
  const cfBlockData = (): Record<string, unknown> => ({
    base: data.base,
    selectedBase: selected,
    factor: data.factor,
    mitigation: data.mitigation,
    peakCut: data.delta.peakCut,
    crossDelayDays: data.delta.crossDelayDays,
    ordersSaved: data.delta.ordersSaved,
    threshold: data.threshold,
    horizon,
  });
  return (
    <BlockConversable blockId="cf-widget" blockType="counterfactual" blockTitle={`反事实双轨推演（${data.base}·${data.factor}）`} getData={cfBlockData} provenanceRef="counterfactual_timeline">
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
      {/*
        WO-UNIT-MEANING · peakCut 是**张力指数的削减量**（Δ，同 risk_timeline 的 0–100 张力空间），
        此前渲染为裸「峰值削减 12」——会被读成 12 台/12%。差值不能套 formatTightness（那是水平值「张力12/100」，
        语义相反），故用 contracts `TIGHTNESS_METRIC` 的名称+量程拼出「削减 12 点张力（0–100 指数）」，量程不内联。
      */}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>
        <b data-testid="cf-base">{data.base}</b>·{data.factor}：不解决 vs「{data.mitigation}」—— 峰值削减 <b className="mono" data-testid="cf-peakcut">{data.delta.peakCut}</b> 点{TIGHTNESS_METRIC.label}（{TIGHTNESS_METRIC.scaleMin}–{TIGHTNESS_METRIC.scaleMax} 指数） · 越线日推迟 <b className="mono">{data.delta.crossDelayDays}</b> 天 · 少越线 <b className="mono">{data.delta.ordersSaved}</b> 日
      </div>
      <div data-testid="cf-axis-caption" style={{ fontSize: 10.5, color: "var(--muted2)", marginBottom: 2 }}>
        纵轴：{TIGHTNESS_METRIC.label}（{TIGHTNESS_METRIC.scaleMin}–{TIGHTNESS_METRIC.scaleMax} 指数·{TIGHTNESS_METRIC.hint}）· 越线阈值 {formatTightness(data.threshold)}
      </div>
      <EChart
        height={180}
        testId="cf-chart"
        option={{
          grid: { top: 24, bottom: 24, left: 36, right: 12 },
          legend: { top: 0, textStyle: { color: "#9FB0C3", fontSize: 10 }, data: ["不解决", "处置后"] },
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: days },
          yAxis: { type: "value", max: TIGHTNESS_METRIC.scaleMax, name: `${TIGHTNESS_METRIC.label}(${TIGHTNESS_METRIC.scaleMin}–${TIGHTNESS_METRIC.scaleMax})`, nameTextStyle: { fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
          series: [
            { name: "不解决", type: "line", smooth: true, data: data.baselineSeries, itemStyle: { color: "#DD7E9E" } },
            { name: "处置后", type: "line", smooth: true, data: data.mitigatedSeries, itemStyle: { color: "#62BE77" } },
            { name: "阈值", type: "line", data: data.baselineSeries.map(() => data.threshold), lineStyle: { type: "dashed", color: "#E8B54A", width: 1 }, symbol: "none" },
          ],
        }}
      />
    </div>
    </BlockConversable>
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
          {/* WO-UNIT-MEANING：供给原为裸数字（同行缺口已带「万套」）→ 两者同口径显式标注，避免只有一半带单位。 */}
          供给 <b className="mono">{cur.supply}</b> 万套 · 缺口 <b className="mono" style={{ color: cur.gap > 2 ? "var(--danger)" : "var(--ok)" }}>{cur.gap}</b> 万套
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

/**
 * KPI 卡装饰（结构层·全主题共享）——**全部由真数据派生**（KILL-MOCK）：
 * - spark：真时序序列（如 history.trend 月度产出 / deviation 月度可供给）→ SVG 折线 sparkline；
 * - delta / deltaTone：由同一真序列 末点 vs 前点 环比派生（非写死）；
 * - accent：实心深橙 accent 卡（warm 专属·经 .warmKpiAccent 类，其余主题回落普通卡）；
 * - progressPct：accent 卡进度条（如计划达成率 value 相对 100% 目标）——真值派生。
 * 无真序列/无进度 → 该装饰缺省不渲染（诚实空·不编趋势）。
 */
export interface KpiDecor {
  spark?: number[];
  sparkLabel?: string;
  delta?: number;
  deltaUnit?: string;
  deltaTone?: "up" | "down" | "flat";
  accent?: boolean;
  progressPct?: number;
  progressNote?: string;
}

/** 环比 delta（末点 vs 前点·%），真序列派生；序列 < 2 或前点 0 → undefined（不编）。 */
export function sparkDelta(series: number[] | undefined): { delta: number; tone: "up" | "down" | "flat" } | undefined {
  if (!series || series.length < 2) return undefined;
  const last = series[series.length - 1]!;
  const prev = series[series.length - 2]!;
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return undefined;
  const delta = Math.round(((last - prev) / Math.abs(prev)) * 1000) / 10;
  return { delta, tone: delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat" };
}

const TONE_COLOR: Record<string, string> = { up: "var(--ok)", down: "var(--danger)", flat: "var(--muted2)" };

/** 细 sparkline（SVG polyline·趋势色低透明·末点实心）——纯真序列渲染，无坐标/无写死。 */
function Sparkline({ series, tone = "flat", w = 96, h = 28 }: { series: number[]; tone?: "up" | "down" | "flat"; w?: number; h?: number }) {
  const pts = series.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 3;
  const step = (w - pad * 2) / (pts.length - 1);
  const xy = pts.map((v, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (v - min) / span)] as const);
  const poly = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1]!;
  const color = TONE_COLOR[tone];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden style={{ display: "block" }}>
      <polyline points={poly} stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      <circle cx={lx} cy={ly} r={2.4} fill={color} />
    </svg>
  );
}

/** delta 药丸（↑绿 / ↓红 / 中性灰）——真序列环比派生。 */
function DeltaPill({ delta, tone, unit, testId }: { delta: number; tone: "up" | "down" | "flat"; unit?: string; testId?: string }) {
  const arrow = tone === "up" ? "↑" : tone === "down" ? "↓" : "→";
  const bg = tone === "up" ? "rgba(48,209,88,.14)" : tone === "down" ? "rgba(229,72,77,.14)" : "rgba(139,152,165,.16)";
  return (
    <span
      data-testid={testId}
      style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, background: bg, color: TONE_COLOR[tone], fontFamily: "var(--font-mono)" }}
    >
      {arrow} {Math.abs(delta)}{unit ?? "%"}
    </span>
  );
}

function KpiWidget({ value, unit, decor }: { value: unknown; unit?: string; decor?: KpiDecor }) {
  const display = formatKpiValue(value, unit);
  const d = decor ?? {};
  const sd = d.delta !== undefined && d.deltaTone ? { delta: d.delta, tone: d.deltaTone } : undefined;
  // accent 进度：优先 decor.progressPct，否则由真值派生（百分比 KPI → value 相对 100% 目标）。
  const pctVal = typeof value === "number" ? (unit === "%" && value > 0 && value <= 1 ? value * 100 : value) : undefined;
  const accentPct = d.accent ? (d.progressPct ?? (unit === "%" && pctVal !== undefined ? pctVal : undefined)) : d.progressPct;
  const accentNote = d.progressNote ?? (d.accent && unit === "%" && pctVal !== undefined ? `目标 100% · 差 ${(100 - pctVal).toFixed(1)}pt` : undefined);
  const hasFoot = !!sd || (d.spark && d.spark.length >= 2);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className={`${styles.kpiValue} ${d.accent ? "warmKpiAccentValue" : ""}`}>
        {display}
        {unit && <small>{unit}</small>}
      </div>
      {/* accent 卡：真值进度条（value 相对目标）——warm 下白条，其余主题回落 accent 色条。 */}
      {d.accent && accentPct !== undefined && (
        <div style={{ marginTop: "auto", paddingTop: 12 }}>
          <div className={"warmKpiAccentTrack"} style={{ height: 6, borderRadius: 999, background: "var(--line2)", overflow: "hidden" }}>
            <div className={"warmKpiAccentFill"} style={{ width: `${Math.max(0, Math.min(100, accentPct))}%`, height: "100%", borderRadius: 999, background: "var(--accent)" }} />
          </div>
          {accentNote && <div className={"warmKpiAccentNote"} style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{accentNote}</div>}
        </div>
      )}
      {/* delta 药丸 + sparkline（真序列派生·非 accent 卡时展示） */}
      {!d.accent && hasFoot && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginTop: "auto", paddingTop: 10 }}>
          {sd ? <DeltaPill delta={sd.delta} tone={sd.tone} unit={d.deltaUnit} testId={`kpi-delta`} /> : <span />}
          {d.spark && d.spark.length >= 2 && (
            <span title={d.sparkLabel}>
              <Sparkline series={d.spark} tone={sd?.tone ?? d.deltaTone ?? "flat"} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * WO-UNIT-MEANING · 驾驶舱图表纵轴口径（含"12 个月产出趋势"「历史回放」widget）。
 *
 * 改前：所有 chart widget 的 y 轴都是纯裸刻度——`38000` 究竟是套数、OEE 百分比还是代价分，读者无从判断。
 * 单源顺序（**只消费、不臆造**）：
 *  ① `DashboardWidgetDef.unit`（api/types.ts:111，ViewConfig.layout.widgets 声明式字段，已被 KpiWidget 消费）——
 *     后端 datacore/synthetic/service.ts 目前只给 kpi widget 填了 unit，chart widget 尚未填；此处先接上，
 *     后端补 `unit` 当天前端即自动生效，**不需要再改前端**（治本收敛点）。
 *  ② 退而求其次取 `WidgetQueryDef` 里可核验的真口径（不是单位，但能说清"这条线到底在数什么"）：
 *     timeseries → `序列 · 按{粒度}{聚合}`；history → history/bundle 的字段名；objects-aggregate → `{agg}({prop})`。
 * 未落到 ①/② 任何一条时**不编单位**，只提示口径缺失（同 RiskBoardView 案例回放先例）。
 */
function chartAxisCaption(def: Pick<DashboardWidgetDef, "unit" | "query">): string {
  if (def.unit) return `纵轴单位：${def.unit}（widget 声明 unit）`;
  const q = def.query;
  const GRAIN: Record<string, string> = { shift: "班", day: "日", week: "周" };
  const AGG: Record<string, string> = { sum: "合计", avg: "均值", max: "最大值", min: "最小值", count: "计数" };
  if (q.kind === "timeseries") {
    return `纵轴口径：序列 ${q.seriesKey} · 按${GRAIN[q.grain] ?? q.grain}${AGG[q.agg] ?? q.agg}（量纲随该序列定义·接口未回传 unit，故只标口径不臆造单位）`;
  }
  if (q.kind === "history") {
    return `纵轴口径：历史回放 history/bundle.${q.field}（量纲见 widget 标题·接口未回传 unit，故只标口径不臆造单位）`;
  }
  if (q.kind === "objects-aggregate") {
    return `纵轴口径：${AGG[q.agg] ?? q.agg}(${q.prop ?? q.objectType})·对象 ${q.objectType}`;
  }
  if (q.kind === "solver") return `纵轴口径：求解器 ${q.solverKey} 输出${q.valuePath ? ` ${q.valuePath}` : ""}`;
  return "纵轴口径：未声明（widget 未给 unit，查询定义也无可核验口径）";
}
/** 轴名（贴在 y 轴顶端）：有 unit 用 unit，否则用口径短名——与 caption 同源，避免图注与轴名漂移。 */
function chartAxisName(def: Pick<DashboardWidgetDef, "unit" | "query">): string {
  if (def.unit) return def.unit;
  const q = def.query;
  if (q.kind === "timeseries") return q.seriesKey;
  if (q.kind === "history") return q.field;
  if (q.kind === "objects-aggregate") return `${q.agg}(${q.prop ?? q.objectType})`;
  if (q.kind === "solver") return q.solverKey;
  return "";
}

function ChartWidget({ data, kind, series, def }: { data: unknown; kind: "line" | "bar" | "trideviation"; series?: { key: string; name: string; color?: string }[]; def: DashboardWidgetDef }) {
  // jsdom 无 canvas（EChart 静默降级），故轴名同文案另以 caption 落 DOM——可测 + 浏览器里也是有用的图注。
  const caption = chartAxisCaption(def);
  const axisName = chartAxisName(def);
  const Caption = (
    <div data-testid={`chart-axis-caption-${def.key}`} style={{ fontSize: 10, color: "var(--muted2)", marginBottom: 2 }}>
      {caption}
    </div>
  );
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
      <>
        {Caption}
        <EChart
          height={200}
          option={{
            grid: { top: 28, bottom: 24, left: 40, right: 12 },
            legend: { top: 0, textStyle: { color: "#9FB0C3", fontSize: 10 } },
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: buckets },
            yAxis: { type: "value", name: axisName, nameTextStyle: { fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
            series: [...lineSeries, { name: "偏差", type: "bar", data: dev, itemStyle: { color: "rgba(221,126,158,.35)" }, barWidth: "40%" }],
          }}
        />
      </>
    );
  }
  const points = (data as { bucket: string; value: number }[] | undefined) ?? [];
  return (
    <>
      {Caption}
      <EChart
        height={180}
        option={{
          grid: { top: 16, bottom: 24, left: 40, right: 12 },
          xAxis: { type: "category", data: points.map((p) => p.bucket) },
          yAxis: { type: "value", name: axisName, nameTextStyle: { fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
          series: [{ type: kind, data: points.map((p) => p.value), itemStyle: { color: "#4C90F0" }, smooth: true }],
        }}
      />
    </>
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
            {/* WO-UNIT-MEANING：财务影响口径为**亿**（同视图 :200 与 planFixtures「金额(亿)」同源），此处原漏标 → 补齐同口径。 */}
            {p.orderCount} 单 · 财务影响 {p.financeImpact} 亿 · <span className="zh">{p.rootCauseSummary}</span>
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
