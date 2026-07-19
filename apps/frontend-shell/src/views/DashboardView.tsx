import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg } from "@/api/endpoints";
import type { DashboardWidgetDef, WidgetQueryDef, AffectedOrdersOutputVM } from "@/api/types";
import { SEG_REGISTRY } from "@platform/contracts";
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
  // WO-BLOCK-DIALOGUE：块级 getData 返 KPI 指标条该块真实数据（每指标 目标/实际/差/是否越线·metricKey 锚定首个越线指标）。
  const msBlockData = (): Record<string, unknown> => ({
    metricKey: (rows.find((m) => m.miss) ?? rows[0])?.metricId,
    metrics: rows.map((m) => ({ metricId: m.metricId, name: m.name, unit: m.unit, target: m.target, actual: m.actual, delta: m.delta, miss: m.miss })),
    missCount: rows.filter((m) => m.miss).length,
  });
  return (
    <BlockConversable blockId="metric-strip" blockType="metric-strip" blockTitle="经营指标条（KPI 达标）" getData={msBlockData} provenanceRef="metric_rollup">
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
    </BlockConversable>
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
