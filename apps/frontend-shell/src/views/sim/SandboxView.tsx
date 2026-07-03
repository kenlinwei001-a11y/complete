import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { parseWhatIfPreset, type WhatIfPreset } from "./whatif";
import type { PropagationRule, SandboxViewConfig, SimCertification, TickState } from "@platform/contracts";
import {
  createSimSession,
  fetchObjectLineage,
  fetchObjectTypes,
  fetchSimCertification,
  fetchSimCompare,
  fetchSimPropagationRules,
  fetchSimViewConfig,
  invokeSolver,
  simBranch,
  simCheckpoint,
  simTick,
  type ObjectLineageVM,
  type SimCompareSeries,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { PmDag, type PmDagNode } from "./PmDag";
import { PlatformConsole } from "@/components/PlatformConsole/PlatformConsole";
import { HeatStrip, useActionDraft, DEFAULT_HEAT_THRESHOLD } from "./shared";
import { SimReadinessPanel } from "./SimReadinessPanel";
import { SimComparePanel } from "./SimComparePanel";
import { SandboxRunHistory } from "./SandboxRunHistory";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import styles from "./SimViews.module.css";

/**
 * 推演沙盘主决策页（增量 4 · R17「一页看全 数据→推演→溯源→动作→AI」· 配置驱动·零业务常数 R14）。
 *
 * 全部节点 / 边 / 状态变量 / 雷达维 / KPI 来自 `GET /a/v1/sim/view-config`（= 租户本体 + 传导规则派生），
 * 代码里**零行业实体名**——换租户 / 换行业 = 换本体内容，本组件一行不改（两配置证见 test/sandbox-view.test.tsx）。
 *
 * 交互：init 会话（baseSnapshot 由 view-config 派生）→「推进 tick」simTick → 节点色 / KPI 随 world 态变。
 * 复用：PmDag（拓扑）· HeatStrip（KPI heat）· 自绘就绪雷达（维 = certification.dims）。
 */

/**
 * tick0 世界态（baseSnapshot）——**SIM-REAL-SNAPSHOT（审计簇D 治本·KILL-MOCK-RED 同源）**。
 *
 * 键 = **真物化对象 id**（cfg.nodeObjectIds，= propagateTick 引擎 idsByType 同源）；值 = **后端真实对象属性态**
 * （cfg.nodeObjectState[oid]，= obj.props 命中 stateVar 的数值）。推演从后端真世界态起跑。
 *
 * 铁律 0.4 红线：**绝不 hash(oid) 造伪初态**。某对象/变量后端无真值 → 诚实退 0（静止），不合成/不哈希冒充。
 * 空世界（该类型无对象）退 `${type}#0` 占位键（全 0，无传导，页面仍可跑）——诚实空态，非造数。
 */
export function deriveBaseSnapshot(cfg: SandboxViewConfig): TickState {
  const state: TickState = {};
  const vars = cfg.stateVars.length > 0 ? cfg.stateVars : ["v"]; // 无传导规则态：单占位变量，保证页面可跑
  for (const t of cfg.nodeTypes) {
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length > 0 ? ids : [`${t}#0`]; // 有真对象用真 id；空世界退占位键
    for (const oid of keys) {
      const real = cfg.nodeObjectState?.[oid];
      const row: Record<string, number> = {};
      // 真实属性态优先；后端未下发该 (对象,变量) 真值 → 诚实 0（静止，绝不造伪初态）。
      for (const v of vars) {
        const rv = real?.[v];
        row[v] = typeof rv === "number" && Number.isFinite(rv) ? rv : 0;
      }
      state[oid] = row;
    }
  }
  return state;
}

/** 对象当前态聚合成单值（节点着色用）：所有 stateVar 均值，0-100。 */
function aggregate(row: Record<string, number> | undefined): number {
  if (!row) return 0;
  const vals = Object.values(row);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** 聚合值 → 着色（高=暖红 警示 / 中=琥珀 / 低=青）。红带阈 = 权威 sim 配置（view-config.heatThreshold，非内联 70）；
 * 中带 = 红带下 25pt 的可视渐变分界（非决策值）。纯函数，无业务语义。 */
function heatColor(v: number, threshold: number): string {
  if (v >= threshold) return "#E0626C";
  if (v >= threshold - 25) return "#E8B54A";
  return "#43B7D7";
}

/** 配置 → PmDag 单层节点（节点=nodeTypes，着色 = 该类型**所有真物化对象**当前态均值）。
 * P0 修：world 现按真对象 id 键 → 聚合 cfg.nodeObjectIds[t] 各对象态（空世界退 `${t}#0` 占位）。 */
function buildNodes(cfg: SandboxViewConfig, world: TickState, threshold: number): PmDagNode[] {
  return cfg.nodeTypes.map((t) => {
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length > 0 ? ids : [`${t}#0`];
    const vals = keys.map((k) => aggregate(world[k]));
    const v = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { id: t, label: t, sub: `Σ ${v.toFixed(0)}`, color: heatColor(v, threshold), st: 0 };
  });
}

/** 边 + 传导规则元数据（G-11 P3）：边来自**真传导规则**（sourceTypeKey→targetTypeKey）时带系数/延迟标注；
 *  无规则时退 nodeTypes 顺序相邻（保证拓扑可见，无标注）。系数/延迟全自规则字段——零行业常数 R14。 */
interface SandboxEdges {
  /** 渲染用边列表（节点 = 对象类型 key）。 */
  list: [string, string][];
  /** `from→to` → 标注文案（`×系数` + 若 delayTicks>0 加 `·Δ延迟`）；缺则不在 map（不显，向后兼容 RL5）。 */
  labels: Map<string, string>;
}

/** 多条同 (source,target) 规则去重为一条边；标注合并各规则 `×系数`（多 viaLinkKey 同型对时）。 */
function edgeKey(from: string, to: string): string {
  return from + "->" + to;
}

/** 配置 + 真传导规则 → 边 + 系数/延迟标注。规则为空（纯建模态/sim.propagation 关）则退相邻兜底（无标注）。 */
function buildEdges(cfg: SandboxViewConfig, rules: PropagationRule[]): SandboxEdges {
  const nodeSet = new Set(cfg.nodeTypes);
  const list: [string, string][] = [];
  const labels = new Map<string, string>();
  const seen = new Set<string>();
  // 真边：来自传导规则的 source→target 类型对（仅当两端都是已发布对象类型，避免悬空边）。
  for (const r of rules) {
    if (!nodeSet.has(r.sourceTypeKey) || !nodeSet.has(r.targetTypeKey)) continue;
    const k = edgeKey(r.sourceTypeKey, r.targetTypeKey);
    if (!seen.has(k)) {
      seen.add(k);
      list.push([r.sourceTypeKey, r.targetTypeKey]);
    }
    // 标注：`×系数`（+ delayTicks>0 显 `·Δ延迟`）。同型对多规则用 / 串接（一眼看全各条系数）。
    const part = `×${r.coefficient}${r.delayTicks > 0 ? `·Δ${r.delayTicks}` : ""}`;
    const prev = labels.get(k);
    labels.set(k, prev ? `${prev} / ${part}` : part);
  }
  if (list.length > 0) return { list, labels };
  // 兜底（无传导规则）：按 nodeTypes 顺序相邻，仅为拓扑可见——无系数可标，labels 空（诚实不造假）。
  const n = cfg.nodeTypes;
  for (let i = 0; i + 1 < n.length; i++) list.push([n[i]!, n[i + 1]!]);
  return { list, labels };
}

// ── 就绪雷达（自绘·维数动态 = certification.dims，不复用固定 5 维 RadarChart）─────────────
function ReadinessRadar({
  dims,
  values,
  size = 168,
}: {
  dims: { key: string; label: string }[];
  values: Record<string, number>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const n = Math.max(dims.length, 3);
  const pt = (i: number, frac: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0, Math.min(100, frac)) / 100;
    return [Number((cx + r * k * Math.cos(a)).toFixed(2)), Number((cy + r * k * Math.sin(a)).toFixed(2))];
  };
  const rings = [1 / 3, 2 / 3, 1].map((f) =>
    dims.map((_, i) => pt(i, f * 100).join(",")).join(" "),
  );
  const poly = dims.map((d, i) => pt(i, values[d.key] ?? 0).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="就绪雷达" data-testid="sandbox-radar">
      {rings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={i === 2 ? 1.2 : 0.8} />
      ))}
      {dims.map((_, i) => {
        const [x, y] = pt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(226,235,245,.1)" strokeWidth={0.8} />;
      })}
      <polygon points={poly} fill="#43B7D7" fillOpacity={0.22} stroke="#43B7D7" strokeWidth={1.6} data-testid="sandbox-radar-polygon" />
      {dims.map((d, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const lx = cx + (size / 2 - 8) * Math.cos(a);
        const ly = cy + (size / 2 - 8) * Math.sin(a);
        return (
          <text key={d.key} x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fill="#9AA8B6" data-testid={`sandbox-radar-axis-${d.key}`}>
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

// ── 健康6维 + 信任4维 双雷达（轨A P1·AUDIT §1 母版口径） ──────────────────────────────
// 数据**零写死 R14**：每维 DERIVE 自既有 SimCertification（dims/worldCompleteness/l4Checks/trialTick/gaps）
// 这些字段本身又是 closure 五维 + GapReport 的投影（R13 派生投影非新真值）。
// 缺数据**诚实标**（hasData=false → 轴标灰 + 不画该顶点，绝不用占位数冒充真算 RL5）。
/** 单维：派生值 0-100 + 是否有真数据支撑（无 → 诚实标估算/无数据，不画顶点）。 */
interface RadarDim {
  key: string;
  label: string;
  value: number;
  hasData: boolean;
  /** 该维派生自哪个 cert 字段（溯源文案，悬浮可见）。 */
  src: string;
}

/** 比例→百分（分母 0 = 无数据，诚实标）。 */
function ratioPct(present: number, needed: number): { value: number; hasData: boolean } {
  if (needed <= 0) return { value: 0, hasData: false };
  return { value: Math.round((Math.min(present, needed) / needed) * 100), hasData: true };
}

/** 健康度 6 维（母版：规则覆盖/利用率/闭包/周期安全/可观测/激活）—— 全 DERIVE 自 cert。 */
function deriveHealthDims(cert: SimCertification | null): RadarDim[] {
  if (!cert) return [];
  const wc = cert.worldCompleteness;
  const ruleCov = ratioPct(wc.propagationRules.present, wc.propagationRules.needed);
  // 利用率：知识维已含「DATA 维 + 利用率」投影（契约注释），直接取 dims.knowledge。
  const closure = ratioPct(wc.derivationRules.present, wc.derivationRules.needed);
  const activation = ratioPct(wc.actions.present, wc.actions.needed);
  return [
    { key: "ruleCoverage", label: "规则覆盖", value: ruleCov.value, hasData: ruleCov.hasData, src: "worldCompleteness.propagationRules" },
    { key: "utilization", label: "利用率", value: Math.round(cert.dims.knowledge), hasData: true, src: "dims.knowledge（DATA维+利用率）" },
    { key: "closure", label: "闭包", value: closure.value, hasData: closure.hasData, src: "worldCompleteness.derivationRules" },
    { key: "cycleSafety", label: "周期安全", value: cert.l4Checks.fanoutSafe ? 100 : 0, hasData: true, src: "l4Checks.fanoutSafe（无高风险扇出）" },
    { key: "observability", label: "可观测", value: cert.l4Checks.observabilityMet ? 100 : Math.round(cert.dims.structure), hasData: true, src: "l4Checks.observabilityMet / dims.structure" },
    { key: "activation", label: "激活", value: activation.value, hasData: activation.hasData, src: "worldCompleteness.actions（写回行动）" },
  ];
}

/** 信任度 4 维（母版：运行时/可解释/时序/数据可信）—— 全 DERIVE 自 cert（Temporal Trust 来自 Trial Tick）。 */
function deriveTrustDims(cert: SimCertification | null): RadarDim[] {
  if (!cert) return [];
  const wc = cert.worldCompleteness;
  // 数据可信：综合完整度 worldCompleteness.pct（范围预检口径）。
  const dataTrust = { value: Math.round(wc.pct), hasData: wc.stateVars.needed > 0 };
  return [
    { key: "runtime", label: "运行时", value: cert.trialTick.passed ? 100 : cert.trialTick.at ? 0 : 0, hasData: cert.trialTick.at != null, src: "trialTick.passed（实跑一次）" },
    { key: "explainability", label: "可解释", value: cert.l4Checks.writebackComplete ? 100 : Math.round(cert.dims.behavior), hasData: true, src: "l4Checks.writebackComplete / dims.behavior" },
    { key: "temporal", label: "时序", value: cert.trialTick.passed ? 100 : 0, hasData: cert.trialTick.at != null, src: "Trial Tick Temporal Trust（只读≤t态）" },
    { key: "dataTrust", label: "数据可信", value: dataTrust.value, hasData: dataTrust.hasData, src: "worldCompleteness.pct（范围预检）" },
  ];
}

/** 健康/信任通用雷达（维含 hasData：无数据维灰轴 + 不计入多边形顶点，诚实标）。 */
function HealthTrustRadar({ title, dims, color, size = 176 }: { title: string; dims: RadarDim[]; color: string; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const n = Math.max(dims.length, 3);
  const pt = (i: number, frac: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0, Math.min(100, frac)) / 100;
    return [Number((cx + r * k * Math.cos(a)).toFixed(2)), Number((cy + r * k * Math.sin(a)).toFixed(2))];
  };
  const rings = [1 / 3, 2 / 3, 1].map((f) => dims.map((_, i) => pt(i, f * 100).join(",")).join(" "));
  // 多边形顶点：无数据维退到圆心（0），仍闭合（诚实——那一边塌陷可见缺数）。
  const poly = dims.map((d, i) => pt(i, d.hasData ? d.value : 0).join(",")).join(" ");
  const missing = dims.filter((d) => !d.hasData);
  // 综合分（轨Q 增量3·竞品 image1 母版「综合分位置」）：仅 hasData 维参与均值，缺数据不拉低（诚实）。
  const scored = dims.filter((d) => d.hasData);
  const composite = scored.length > 0 ? Math.round(scored.reduce((a, d) => a + d.value, 0) / scored.length) : 0;
  const slug = title === "健康度" ? "health" : "trust";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div className={styles.sub} style={{ marginBottom: 2 }} data-testid={`sandbox-${slug}-radar-title`}>
        {title}雷达 · {dims.length} 维 · 综合 <b style={{ color }} data-testid={`sandbox-${slug}-radar-composite`}>{composite}</b>
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}雷达`} data-testid={`sandbox-${title === "健康度" ? "health" : "trust"}-radar`}>
        {rings.map((pts, i) => (
          <polygon key={i} points={pts} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={i === 2 ? 1.2 : 0.8} />
        ))}
        {dims.map((d, i) => {
          const [x, y] = pt(i, 100);
          return <line key={d.key} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(226,235,245,.1)" strokeWidth={0.8} />;
        })}
        <polygon points={poly} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.6} />
        {dims.map((d, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          const lx = cx + (size / 2 - 10) * Math.cos(a);
          const ly = cy + (size / 2 - 10) * Math.sin(a);
          return (
            <text
              key={d.key}
              x={lx}
              y={ly + 3}
              textAnchor="middle"
              fontSize={8.5}
              fill={d.hasData ? "#9AA8B6" : "#5C6672"}
              data-testid={`sandbox-${title === "健康度" ? "health" : "trust"}-axis-${d.key}`}
            >
              <title>{d.src}{d.hasData ? ` · ${d.value}` : " · 无数据（诚实标，不计入）"}</title>
              {d.label}{d.hasData ? "" : "*"}
            </text>
          );
        })}
      </svg>
      {/* 底部轴值图例（竞品 image1：轴名 值 ×N·真派生·缺数据标 —）。 */}
      <div data-testid={`sandbox-${slug}-radar-legend`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 12px", fontSize: 10, color: "#9AA8B6", marginTop: 4, width: size }}>
        {dims.map((d) => (
          <div key={d.key} style={{ display: "flex", justifyContent: "space-between" }} title={d.src}>
            <span style={{ color: d.hasData ? "#9AA8B6" : "#5C6672" }}>{d.label}</span>
            <span className="mono" style={{ color: d.hasData ? color : "#5C6672" }}>{d.hasData ? d.value : "—"}</span>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <div className={styles.sub} style={{ fontSize: 10, color: "#5C6672" }} data-testid={`sandbox-${slug}-radar-missing`}>
          *{missing.map((d) => d.label).join("/")}：缺数据（诚实标·未计入）
        </div>
      )}
    </div>
  );
}

/** 轨Q 增量3（竞品 image1 中面板 ① 4 行评估清单）：State/Action/Writeback/Query 全派生自 cert（真·零写死）。 */
function EvalChecklist({ cert, cfg }: { cert: SimCertification; cfg: SandboxViewConfig }) {
  const wc = cert.worldCompleteness;
  const queryCovered = cert.l4Checks.observabilityMet;
  const rows: { key: string; label: string; val: string; ok: boolean; note: string }[] = [
    { key: "state", label: "State 状态变量", val: `${cfg.stateVars.length}`, ok: cfg.stateVars.length > 0, note: "纳入推演的状态变量（view-config.stateVars）" },
    { key: "action", label: "Action 行动", val: `${wc.actions.present} · 利用率 ${Math.round(cert.dims.knowledge)}%`, ok: wc.actions.present > 0, note: "写回行动数 · 知识利用率(dims.knowledge)" },
    { key: "writeback", label: "Writeback 写回", val: cert.l4Checks.writebackComplete ? "完整" : "缺", ok: cert.l4Checks.writebackComplete, note: "≥1 writeback ActionType(l4Checks.writebackComplete)" },
    { key: "query", label: "Query 图查询", val: queryCovered ? "已覆盖" : "0", ok: queryCovered, note: queryCovered ? "切片覆盖达标(observabilityMet)" : "无切片覆盖 · 图查询页后端未建(§10.1 RESERVED)" },
  ];
  return (
    <div data-testid="sandbox-eval-checklist" style={{ marginBottom: 10 }}>
      <div className={styles.secHead} style={{ marginBottom: 6 }}>运行态评估清单</div>
      {rows.map((r) => (
        <div key={r.key} data-testid={`sandbox-eval-${r.key}`} title={r.note}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "3px 0", borderBottom: "1px solid rgba(226,235,245,.06)" }}>
          <span style={{ color: "var(--muted2)" }}>{r.label}</span>
          <span className="mono" style={{ color: r.ok ? "var(--ok)" : "var(--muted2)" }}>{r.val}{r.ok ? " ✓" : ""}</span>
        </div>
      ))}
    </div>
  );
}

/** 知识激活（竞品 image1 ④·静态可达传播链 N/N·DORMANT/ACTIVE）：传播链=propagationRules·状态取 curTick 真态。 */
function KnowledgeActivation({ cert, curTick }: { cert: SimCertification; curTick: number }) {
  const wc = cert.worldCompleteness;
  const active = curTick > 0;
  return (
    <div data-testid="sandbox-knowledge-activation" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(226,235,245,.1)", fontSize: 12.5 }}>
      <span style={{ color: "var(--muted2)" }}>知识激活 · 静态可达传播链</span>
      <b className="mono" data-testid="sandbox-knowledge-chains">{wc.propagationRules.present}/{wc.propagationRules.needed}</b>
      <span className={`badge ${active ? "green" : ""}`} data-testid="sandbox-knowledge-status">
        {active ? `ACTIVE · 已推进 ${curTick} tick` : "DORMANT · 未推进（tick 0）"}
      </span>
    </div>
  );
}

/**
 * 轨Q 增量4（竞品状态卡条 风险 TOP3·接 `risk_timeline` 真求解器）：**守轨M 真推演红线**——
 * MOCK 因素无真数据源 → 基线张力是 mockTightness 启发估算（非实测），诚实标"估算·无实测"，绝不当真红；
 * LIVE 因素标"实测"。峰值取真求解器 peak·TOP3 按 peak 排序。
 */
// WO-KILL-MOCK-RED 阶段②：peak/currentTightness 可空（无真源）+ dataMode 顶层/卡级用于渲染门。
interface RiskCard { base: string; factor: string; dataMode?: string; hasData?: boolean; peak: number | null; currentTightness?: { value: number | null } }
function RiskTop3({ enabled }: { enabled: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "risk_timeline", "sandbox-top3"],
    queryFn: async () => (await invokeSolver("risk_timeline", {})).data as { dataMode?: string; cards?: RiskCard[] },
    retry: false, enabled,
  });
  if (isError) return null;
  // 向后兼容：仅显式非 LIVE 才抑制（未标 dataMode 的旧 fixture/真 LIVE 保持既有行为）。
  const notLive = (dm?: string | null) => dm != null && dm !== "LIVE";
  const topLive = !notLive(data?.dataMode);
  const cards = [...(data?.cards ?? [])].sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0)).slice(0, 3);
  return (
    <div className="panel" data-testid="sandbox-risk-top3" style={{ padding: 12, marginTop: 12 }}>
      <div className={styles.secHead} style={{ marginBottom: 6 }}>风险 TOP3 · 接 risk_timeline 求解器（MOCK 因素诚实标估算·守真推演红线）</div>
      {isLoading || !data ? (
        <div className={styles.sub}>加载风险时间线…</div>
      ) : cards.length === 0 ? (
        <div className={styles.sub} data-testid="sandbox-risk-empty">无风险因素。</div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {cards.map((c, i) => {
            // WO-KILL-MOCK-RED 治本：仅顶层+该卡 LIVE 且 hasData 才出决策红；否则中性灰（不把哈希/合成峰值染红）。
            const cLive = topLive && !notLive(c.dataMode) && c.hasData !== false;
            const col = cLive && c.peak != null ? (c.peak >= 80 ? "#E0626C" : c.peak >= 50 ? "#E8B54A" : "#62BE77") : "var(--muted)";
            const baseline = c.currentTightness?.value;
            return (
              <div key={`${c.base}:${c.factor}`} data-testid={`sandbox-risk-${i}`} data-decision-mode={cLive ? "LIVE" : "MUTED"} style={{ flex: "1 1 180px", border: "1px solid var(--border,#2a2a2a)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <b style={{ fontSize: 13 }}>{c.base} · {c.factor}</b>
                  <b className="mono" style={{ color: col, fontSize: 16 }}>{c.peak != null ? c.peak : "—"}</b>
                </div>
                <div style={{ marginTop: 4 }}>
                  {!cLive ? (
                    <span className="badge" data-testid={`sandbox-risk-datamode-${i}`} title="该因素无真数据源（或合成/顶层非实测）·基线张力为启发/合成估算(非实测)·不作决策红">
                      估算·无实测{baseline != null ? `（基线 ${Math.round(baseline)}）` : ""}
                    </span>
                  ) : (
                    <span className="badge green" data-testid={`sandbox-risk-datamode-${i}`} title="真数据源·实测张力">
                      实测{baseline != null ? `（基线 ${Math.round(baseline)}）` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 轨Q 增量2（竞品 image8 运行台右栏 Schema Derive Rules）：列真**派生规则**（ObjectType.derivedProperties·
 * `Type.prop ← formula`）+ **传导规则**（cert.entering kind=PROPAGATION·`r: source`）。**接现成真数据·零写死**。
 * ③/②类诚实 RESERVED：`[RUNTIME]/[INGEST]` 阶段标——PropagationRule 后端无 phase 字段（§10②）→ 不画假阶段。
 */
function SchemaDeriveRules({ cert }: { cert: SimCertification }) {
  const { data: types } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes, retry: false });
  const derivs = (types ?? []).flatMap((t) => (t.derivedProperties ?? []).map((d) => ({ id: `${t.key}.${d.propKey}`, expr: d.formula, kind: "派生" })));
  const props = cert.worldCompleteness.entering.filter((e) => e.kind === "PROPAGATION").map((e) => ({ id: e.key, expr: e.source, kind: "传导" }));
  const rules = [...derivs, ...props];
  return (
    <div className="panel" data-testid="sandbox-schema-rules" style={{ padding: 12, marginTop: 12 }}>
      <div className={styles.secHead} style={{ marginBottom: 4 }}>Schema 派生规则（{rules.length} · 真 derivedProperties + 传导规则）</div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 6 }} data-testid="sandbox-schema-phase-reserved">◌ [RUNTIME]/[INGEST] 阶段标 · RESERVED（PropagationRule 后端无 phase 字段·§10②，不画假阶段）</div>
      {rules.length === 0 ? (
        <div className={styles.sub} data-testid="sandbox-schema-rules-empty">无派生/传导规则。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 240, overflowY: "auto" }}>
          {rules.map((r, i) => (
            <div key={`${r.id}-${i}`} data-testid={`sandbox-schema-rule-${i}`} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "baseline" }}>
              <span className="badge" style={{ flexShrink: 0 }}>{r.kind}</span>
              <span className="mono" style={{ color: "var(--txt)", flexShrink: 0 }}>{r.id}</span>
              <span style={{ color: "var(--muted2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>← {r.expr}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AI 指挥台（NL 驱动沙盘 · 确定性意图解析，R6 无 LLM/随机） ────────────────────────────
// 母版「NL→驱动沙盘动作」：解析意图→映射**现有沙盘 API**（tick/checkpoint/branch/query），不新建并行动作。
// LLM 不可用即默认走确定性关键词解析（CLI classifyOperation 同范式）；解析不出诚实显「未识别意图」。
type SandboxIntentKind = "tick" | "checkpoint" | "branch" | "query" | "unknown";
interface SandboxIntent {
  kind: SandboxIntentKind;
  /** tick：推进步数（默认 1）。 */
  n?: number;
  /** 人读回执（确定性，作 echo）。 */
  echo: string;
}

/** 确定性 NL 意图解析（R6：纯函数，无 Date.now/random/LLM）。中文关键词打分，多候选取首命中（固定优先级）。 */
export function parseSandboxIntent(text: string): SandboxIntent {
  const t = text.trim().toLowerCase();
  if (!t) return { kind: "unknown", echo: "请输入指令" };
  // 步数抽取（"推进 3 tick" / "走3步"）：取首个 1-3 位数字。
  const numMatch = t.match(/(\d{1,3})/);
  const n = numMatch ? Math.max(1, Math.min(50, parseInt(numMatch[1]!, 10))) : 1;
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  // 固定优先级：分支 > 存档 > 推进 > 查询（避免"推进后分支"歧义瞎跑）。
  if (has("分支", "对比", "branch", "compare", "场景")) return { kind: "branch", echo: "意图：分支并开多场景对比" };
  if (has("存档", "检查点", "checkpoint", "保存", "快照")) return { kind: "checkpoint", echo: "意图：存当前检查点" };
  if (has("推进", "tick", "前进", "走", "推", "步", "演")) return { kind: "tick", n, echo: `意图：推进 ${n} 个 tick` };
  if (has("查询", "查", "状态", "就绪", "查看", "多少", "怎样", "如何", "认证")) return { kind: "query", echo: "意图：刷新世界态与就绪认证" };
  return { kind: "unknown", echo: `未识别意图：「${text.trim()}」（支持：推进N tick / 存档检查点 / 分支对比 / 查询状态）` };
}

// ── R13 节点溯源悬浮（datasource→建模→对象 · 复用 fetchObjectLineage，不裸渲染） ──────────────
/** 节点悬浮卡：取该类型**代表对象**（nodeObjectIds 首个）的 R13 lineage → 显上游链路。 */
function NodeLineagePopover({ typeKey, objectId, anchor }: { typeKey: string; objectId: string | null; anchor: { x: number; y: number } }) {
  const q = useQuery({
    queryKey: ["a", "lineage", typeKey, objectId],
    queryFn: () => fetchObjectLineage(typeKey, objectId!),
    enabled: !!objectId,
    retry: false,
    staleTime: 60_000,
  });
  const top = Math.min(anchor.y + 10, window.innerHeight - 260);
  const left = Math.min(anchor.x + 10, window.innerWidth - 320);
  return (
    <div
      style={{
        position: "fixed", top, left, width: 300, zIndex: 50,
        background: "var(--panel2)", border: "1px solid var(--line2)", borderRadius: 8,
        padding: 12, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      }}
      role="tooltip"
      data-testid="sandbox-lineage-popover"
    >
      <div className={styles.secHead} style={{ marginBottom: 6 }}>R13 溯源 · {typeKey}</div>
      {!objectId ? (
        <div className={styles.sub} data-testid="sandbox-lineage-empty">空世界：该类型无已物化对象，无上游链路可溯。</div>
      ) : q.isLoading ? (
        <div className={styles.sub}>读取上游链路…</div>
      ) : q.isError || !q.data ? (
        <div className={styles.sub} data-testid="sandbox-lineage-error">溯源不可用（lineage 未开通或对象无来源）。</div>
      ) : (
        <LineageChain vm={q.data} />
      )}
    </div>
  );
}

/** 沿本体链路渲染：数据源 → 原始表 → 建模派生 → 对象（R13 不裸渲染，逐段标）。 */
function LineageChain({ vm }: { vm: ObjectLineageVM }) {
  const conn = vm.source?.connection ?? null;
  const ds = vm.source?.rawDataset ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="sandbox-lineage-chain">
      <div data-testid="sandbox-lineage-source">
        <span className="badge blue">数据源</span>{" "}
        {conn ? <b>{conn.name}</b> : <span className={styles.sub}>无连接来源（origin 非来源派生）</span>}
        {conn && <span className={styles.sub}> · {conn.connectorTypeKey}</span>}
      </div>
      <div className={styles.sub} style={{ textAlign: "center" }}>↓</div>
      <div data-testid="sandbox-lineage-dataset">
        <span className="badge">原始表</span>{" "}
        {ds ? <b className="mono">{ds.name}</b> : <span className={styles.sub}>无原始表</span>}
        {ds && <span className={styles.sub}> · {ds.rowCount} 行</span>}
      </div>
      <div className={styles.sub} style={{ textAlign: "center" }}>↓</div>
      <div data-testid="sandbox-lineage-derive">
        <span className="badge">建模派生</span>{" "}
        {vm.derivations.length > 0 ? (
          <span className="mono" style={{ fontSize: 11 }}>{vm.derivations.length} 条派生</span>
        ) : (
          <span className={styles.sub}>无派生属性</span>
        )}
      </div>
      <div className={styles.sub} style={{ textAlign: "center" }}>↓</div>
      <div data-testid="sandbox-lineage-object">
        <span className="badge blue">对象</span>{" "}
        <b className="mono" style={{ fontSize: 11 }}>{vm.object.id}</b>
        <span className={styles.sub}> · snapshot {vm.snapshotVersion}</span>
      </div>
    </div>
  );
}

/** 测试可注入 config（绕过网络，喂两套 mock config 证 R14）；生产留空走 view-config 端点。 */
export interface SandboxViewProps {
  injectedConfig?: SandboxViewConfig;
  /** WO-E2 测试注入：绕过 URL 直接喂 what-if presetContext（生产走 useSearchParams）。 */
  injectedPreset?: WhatIfPreset | null;
}

export default function SandboxView({ injectedConfig, injectedPreset }: SandboxViewProps = {}) {
  // WO-E2（沙盘 what-if 进决策日常）：决策入口一键「开 what-if」→ URL 带 presetContext → 注入 SimSession.scope。
  const [searchParams] = useSearchParams();
  const whatIf = injectedPreset !== undefined ? injectedPreset : parseWhatIfPreset(searchParams);
  const cfgQuery = useQuery({
    queryKey: ["a", "sim", "view-config"],
    queryFn: fetchSimViewConfig,
    enabled: !injectedConfig,
    retry: false,
  });
  const cfg = injectedConfig ?? cfgQuery.data;

  // G-11 P3：真传导规则（系数/延迟）→ 拓扑边标注。sim.propagation 关时 404 → 容错（retry:false），边退无标注兜底。
  const rulesQuery = useQuery({
    queryKey: ["a", "sim", "propagation-rules"],
    queryFn: fetchSimPropagationRules,
    enabled: !!cfg,
    retry: false,
  });
  const propRules = rulesQuery.data?.items ?? [];

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [world, setWorld] = useState<TickState>({});
  const [curTick, setCurTick] = useState(0);
  const [ticking, setTicking] = useState(false);
  const [history, setHistory] = useState<number[]>([]); // 逐 tick 全局均值轨迹（时间轴/KPI heat）
  const [cert, setCert] = useState<SimCertification | null>(null);
  const [certScope, setCertScope] = useState<"GLOBAL" | "LOCAL">("GLOBAL"); // ④ 就绪范围（现可切，不再写死 GLOBAL）
  const [branching, setBranching] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null); // 子分支会话 id（对比用）
  const [compare, setCompare] = useState<{ a: SimCompareSeries; b: SimCompareSeries } | null>(null);
  const adopt = useActionDraft(); // 采纳 → R4 Action 草稿（RL4 正门，沙盘模拟态不直写真值）

  // AI 指挥台（NL 驱动沙盘 · 确定性意图解析 R6）：输入条 + 末次回执。
  const [nlText, setNlText] = useState("");
  const [nlEcho, setNlEcho] = useState<{ msg: string; ok: boolean } | null>(null);
  // R13 节点溯源悬浮：点节点（=对象类型）→ 取该类型代表对象 lineage。pointer 位置作锚。
  const [lineage, setLineage] = useState<{ typeKey: string; objectId: string | null } | null>(null);
  const pointerRef = useRef({ x: 120, y: 120 });
  const [anchor, setAnchor] = useState({ x: 120, y: 120 });

  // 全局 KPI = 当前 world 所有对象聚合态的均值（0-100）。
  const globalKpi = useMemo(() => {
    const objs = Object.keys(world);
    if (objs.length === 0) return 0;
    return objs.reduce((a, o) => a + aggregate(world[o]), 0) / objs.length;
  }, [world]);

  // init 会话：baseSnapshot 由配置派生（无业务常数）。配置就绪即自动建会话。
  const init = useCallback(async (c: SandboxViewConfig) => {
    try {
      const base = deriveBaseSnapshot(c);
      // WO-E2：what-if 上下文（决策入口带入）注入 SimSession.scope —— 沙盘据此聚焦推演、决策完即弃/采纳（R2/R3 隔离）。
      const scope = whatIf ? { presetContext: whatIf as unknown as Record<string, unknown> } : {};
      const s = await createSimSession({ baseSnapshot: base, scope });
      setSessionId(s.id);
      setWorld(base);
      setCurTick(0);
      const g0 = Object.keys(base).reduce((a, o) => a + aggregate(base[o]), 0) / Math.max(1, Object.keys(base).length);
      setHistory([g0]);
      // 就绪认证：诚实展示 L0-L4 + 三元组 + Trial Tick + 完整度 + entering + canEnter + gaps。
      try {
        setCert(await fetchSimCertification(s.id, certScope));
      } catch {
        /* certification entitlement 关时容错：仅不显认证面板 */
      }
    } catch (e) {
      toastError(e);
    }
  }, [certScope, whatIf]);

  useEffect(() => {
    if (cfg && !sessionId) void init(cfg);
  }, [cfg, sessionId, init]);

  // ④ scope 切换 → 重取就绪认证（GLOBAL↔LOCAL），不重建会话。
  const reloadCert = useCallback(
    async (scope: "GLOBAL" | "LOCAL") => {
      setCertScope(scope);
      if (!sessionId) return;
      try {
        setCert(await fetchSimCertification(sessionId, scope));
      } catch {
        /* 容错 */
      }
    },
    [sessionId],
  );

  const onTick = useCallback(async () => {
    if (!sessionId) return;
    setTicking(true);
    try {
      const res = await simTick(sessionId, 1);
      setWorld(res.state);
      setCurTick(res.curTick);
      const g = Object.keys(res.state).reduce((a, o) => a + aggregate(res.state[o]), 0) / Math.max(1, Object.keys(res.state).length);
      setHistory((h) => [...h, g]);
    } catch (e) {
      toastError(e);
    } finally {
      setTicking(false);
    }
  }, [sessionId]);

  const onCheckpoint = useCallback(async () => {
    if (!sessionId) return;
    try {
      const cp = await simCheckpoint(sessionId, `tick${curTick}`);
      toast(`检查点已存：${cp.label}（tick ${cp.tick}）`, "success");
    } catch (e) {
      toastError(e);
    }
  }, [sessionId, curTick]);

  // 分支（北极星）：当前 tick 存检查点 → 从该检查点派生子会话 → 取 A(主线)/B(分支) 对比序列。
  const onBranch = useCallback(async () => {
    if (!sessionId) return;
    setBranching(true);
    try {
      const cp = await simCheckpoint(sessionId, `branch@tick${curTick}`);
      const child = await simBranch(sessionId, cp.id);
      setBranchId(child.id);
      const cmp = await fetchSimCompare(sessionId, child.id);
      setCompare(cmp);
      toast(`已从检查点分支（子会话 ${child.id}），可逐 tick 对比`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBranching(false);
    }
  }, [sessionId, curTick]);

  // 对比刷新（分支会话各自推进后重新拉序列；A 主线 + B 分支）。
  const onRefreshCompare = useCallback(async () => {
    if (!sessionId || !branchId) return;
    try {
      setCompare(await fetchSimCompare(sessionId, branchId));
    } catch (e) {
      toastError(e);
    }
  }, [sessionId, branchId]);

  // 采纳此推演结论 → R4 Action 草稿（RL4 正门）：沙盘是模拟态不写真值，采纳才经 Action 审批流写。
  const onAdopt = useCallback(() => {
    if (!sessionId) return;
    adopt.mutate({
      actionTypeKey: "plan_change",
      payload: {
        // plan_change 必填 versionId + reason（走 S2 审批正门）；沙盘以会话@tick 作版本锚。
        versionId: `sim:${sessionId}@tick${curTick}`,
        reason: `采纳推演沙盘结论（${certScope} · 全局态 ${globalKpi.toFixed(1)}${cert ? ` · ${cert.level}` : ""}）`,
        patch: {
          source: "sim_sandbox",
          simulated: true, // 诚实标：此为模拟态结论，采纳才经 Action 正门写真值（RL4）
          sessionId,
          tick: curTick,
          globalKpi: Number(globalKpi.toFixed(2)),
          certLevel: cert?.level ?? null,
          scope: certScope,
        },
      },
    });
  }, [sessionId, curTick, globalKpi, cert, certScope, adopt]);

  // 推进 N 个 tick（AI 指挥台「推进 N」用）：逐次 simTick（引擎逐 tick 真传导，不一次跳）。
  const runTicks = useCallback(
    async (n: number) => {
      if (!sessionId) return;
      setTicking(true);
      try {
        let last: TickState | null = null;
        let lastTick = curTick;
        for (let i = 0; i < n; i++) {
          const res = await simTick(sessionId, 1);
          last = res.state;
          lastTick = res.curTick;
          const g = Object.keys(res.state).reduce((a, o) => a + aggregate(res.state[o]), 0) / Math.max(1, Object.keys(res.state).length);
          setHistory((h) => [...h, g]);
        }
        if (last) {
          setWorld(last);
          setCurTick(lastTick);
        }
      } catch (e) {
        toastError(e);
      } finally {
        setTicking(false);
      }
    },
    [sessionId, curTick],
  );

  // AI 指挥台分发：NL → 确定性意图 → 映射**现有沙盘动作**（tick/checkpoint/branch/query），不新建并行动作。
  const onIntent = useCallback(
    async (raw: string) => {
      const intent = parseSandboxIntent(raw);
      if (!sessionId && intent.kind !== "unknown") {
        setNlEcho({ msg: "会话尚未就绪，请稍候再下指令", ok: false });
        return;
      }
      switch (intent.kind) {
        case "tick":
          setNlEcho({ msg: `${intent.echo} ✓`, ok: true });
          await runTicks(intent.n ?? 1);
          break;
        case "checkpoint":
          setNlEcho({ msg: `${intent.echo} ✓`, ok: true });
          await onCheckpoint();
          break;
        case "branch":
          setNlEcho({ msg: `${intent.echo} ✓`, ok: true });
          await onBranch();
          break;
        case "query":
          setNlEcho({ msg: `${intent.echo} ✓`, ok: true });
          if (sessionId) {
            try {
              setCert(await fetchSimCertification(sessionId, certScope));
            } catch {
              /* 容错 */
            }
          }
          break;
        default:
          // 诚实降级：无 LLM 时不瞎跑，明示未识别 + 支持的指令集。
          setNlEcho({ msg: intent.echo, ok: false });
      }
      setNlText("");
    },
    [sessionId, certScope, runTicks, onCheckpoint, onBranch],
  );

  if (!cfg) {
    if (cfgQuery.isError) return <div className="empty-state" data-testid="sandbox-config-error">沙盘配置不可用（沙盘功能未开通或本体为空）</div>;
    return <div className="empty-state" data-testid="sandbox-loading">加载沙盘配置…</div>;
  }

  // 热度红带阈：权威取 view-config.heatThreshold（后端 DEFAULT_SANDBOX_HEAT_THRESHOLD），未下发退前端单一兜底常数。
  const heatThreshold = cfg.heatThreshold ?? DEFAULT_HEAT_THRESHOLD;
  const nodes = buildNodes(cfg, world, heatThreshold);
  const { list: edges, labels: edgeLabels } = buildEdges(cfg, propRules);
  const radarValues: Record<string, number> = cert
    ? { structure: cert.dims.structure, knowledge: cert.dims.knowledge, behavior: cert.dims.behavior }
    : {};
  // 健康6维 + 信任4维（轨A P1）：全 DERIVE 自 cert（R14 零写死/R13 派生投影/缺数据诚实标）。
  const healthDims = deriveHealthDims(cert);
  const trustDims = deriveTrustDims(cert);
  // 点拓扑节点（=对象类型）→ 取该类型代表对象（nodeObjectIds 首个）开 R13 溯源悬浮。
  const onNodeClick = (typeKey: string) => {
    const ids = cfg.nodeObjectIds?.[typeKey] ?? [];
    setAnchor(pointerRef.current);
    setLineage({ typeKey, objectId: ids.length > 0 ? ids[0]! : null });
  };

  return (
    <div data-testid="sandbox-view" className={styles.head}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3>推演沙盘 · 一页看全（数据 → 推演 → 溯源 → 动作 → AI）</h3>
        <div className={styles.sub} data-testid="sandbox-config-summary">
          本体派生：{cfg.nodeTypes.length} 类对象 · {cfg.linkTypes.length} 类链路 · {cfg.stateVars.length} 状态变量 · {cfg.propagationCount} 传导规则
        </div>
      </div>

      {/* WO-E2（沙盘 what-if 进决策日常）：决策入口一键「开 what-if」带入的上下文条——推演聚焦此问题，决策完即弃/采纳（R3 隔离主世界）。 */}
      {whatIf && (
        <div
          className="panel"
          data-testid="sandbox-whatif-context"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", marginTop: 8, borderLeft: "3px solid #43B7D7" }}
        >
          <span className="badge blue" data-testid="sandbox-whatif-badge">what-if</span>
          <span className={styles.sub} data-testid="sandbox-whatif-source">来自决策入口：{whatIf.source}</span>
          {whatIf.label && <b data-testid="sandbox-whatif-label">{whatIf.label}</b>}
          {whatIf.subject && <span className="badge" data-testid="sandbox-whatif-subject">{whatIf.subject}</span>}
          {whatIf.factor && <span className="badge" data-testid="sandbox-whatif-factor">{whatIf.factor}</span>}
          <span className={styles.sub} style={{ marginLeft: "auto" }}>就此问题推演对比基线 · 决策完即弃或采纳为 Action（R4）</span>
        </div>
      )}

      {/* KPI 行：全局态 + 逐 stateVar（全从配置 stateVars 渲染） */}
      <div className={styles.threeKpiRow} data-testid="sandbox-kpis">
        <div className={styles.kpi} data-testid="sandbox-kpi-global">
          <span>全局态（tick {curTick}）</span>
          <b style={{ color: heatColor(globalKpi, heatThreshold) }} data-testid="sandbox-kpi-global-val">{globalKpi.toFixed(1)}</b>
        </div>
        {cfg.stateVars.map((v) => {
          const objs = Object.keys(world);
          const avg = objs.length ? objs.reduce((a, o) => a + (world[o]?.[v] ?? 0), 0) / objs.length : 0;
          return (
            <div key={v} className={styles.kpi} data-testid={`sandbox-kpi-${v}`}>
              <span>{v}</span>
              <b data-testid={`sandbox-kpi-${v}-val`}>{avg.toFixed(1)}</b>
            </div>
          );
        })}
      </div>

      {/* AI 指挥台（NL 驱动沙盘 · 确定性意图解析 R6）：自然语言→现有沙盘动作（tick/存档/分支/查询）。
          LLM 不可用即默认确定性解析（无 Date.now/random），未识别意图诚实降级显支持指令集。 */}
      <form
        className="panel"
        data-testid="sandbox-ai-console"
        style={{ padding: 12, marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (nlText.trim()) void onIntent(nlText);
        }}
      >
        <div className={styles.secHead}>AI 指挥台 · 自然语言驱动沙盘（确定性解析，无 LLM 依赖）</div>
        <div className={styles.inputBar} style={{ marginTop: 8 }}>
          <input
            data-testid="sandbox-ai-input"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="例：推进 5 个 tick / 存档检查点 / 分支对比 / 查询就绪状态"
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            disabled={!sessionId || ticking}
          />
          <button className="btn sm primary" type="submit" data-testid="sandbox-ai-run" disabled={!sessionId || ticking || !nlText.trim()}>
            执行
          </button>
        </div>
        {nlEcho && (
          <div
            className={styles.sub}
            data-testid="sandbox-ai-echo"
            style={{ marginTop: 6, color: nlEcho.ok ? "#43B7D7" : "#E0626C" }}
          >
            {nlEcho.msg}
          </div>
        )}
      </form>

      {/* 控制条：推进 tick / 存档 / tick 时间轴 heat */}
      <div className="panel" data-testid="sandbox-controls" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 12 }}>
        <button className="btn" data-testid="sandbox-tick-btn" disabled={!sessionId || ticking} onClick={onTick}>
          {ticking ? "推进中…" : "推进 tick"}
        </button>
        <button className="btn sm" data-testid="sandbox-checkpoint-btn" disabled={!sessionId} onClick={onCheckpoint}>
          存档检查点
        </button>
        <button className="btn sm" data-testid="sandbox-branch-btn" disabled={!sessionId || branching} onClick={onBranch}>
          {branching ? "分支中…" : "分支（多场景对比）"}
        </button>
        <button className="btn sm primary" data-testid="sandbox-adopt-btn" disabled={!sessionId || adopt.isPending} onClick={onAdopt}>
          {adopt.isPending ? "采纳中…" : "采纳此推演结论"}
        </button>
        <div style={{ flex: 1, minWidth: 160 }} data-testid="sandbox-timeline">
          <div className={styles.sub} style={{ marginBottom: 2 }}>tick 时间轴（全局态轨迹）</div>
          <HeatStrip series={history} threshold={heatThreshold} />
        </div>
      </div>

      <div className={styles.twoCol} style={{ marginTop: 12 }}>
        {/* 就绪面板（左）：6 项砌齐 —— L0-L4 stepper / L4 三元组 / Trial Tick / scope 切换 / 完整度 gauge / entering 清单 */}
        <div className="panel" data-testid="sandbox-readiness" style={{ padding: 12 }}>
          {/* 轨Q 增量3（竞品 image1 ①）：4 行评估清单 State/Action/Writeback/Query（真派生自 cert）。 */}
          {cert && <EvalChecklist cert={cert} cfg={cfg} />}
          {cert ? (
            <SimReadinessPanel
              cert={cert}
              scope={certScope}
              onScopeChange={(s) => void reloadCert(s)}
              radar={<ReadinessRadar dims={cfg.radarDims} values={radarValues} />}
            />
          ) : (
            <>
              <div className={styles.secHead}>就绪认证</div>
              <div className={styles.sub} data-testid="sandbox-cert-na">就绪认证未开通（sim.certification 关）</div>
            </>
          )}
        </div>

        {/* 拓扑（右）：PmDag 单层，节点=nodeTypes，着色随 world 态；点节点→R13 溯源悬浮 */}
        <div className="panel" data-testid="sandbox-topology" style={{ padding: 12 }}>
          <div className={styles.secHead}>本体拓扑（节点态随 tick 变色 · 边标 ×系数·Δ延迟 · 点节点看 R13 上游链路）</div>
          {nodes.length > 0 ? (
            <div onMouseMove={(e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; }}>
              <PmDag
                layers={[nodes]}
                edges={edges}
                step={0}
                testId="sandbox-dag"
                onNodeClick={onNodeClick}
                edgeLabel={(from, to) => edgeLabels.get(edgeKey(from, to)) ?? null}
              />
            </div>
          ) : (
            <div className={styles.sub} data-testid="sandbox-topology-empty">本体暂无已发布对象类型——先在建模页发布对象。</div>
          )}
        </div>
      </div>

      {/* 健康6维 + 信任4维 双雷达（轨A P1·AUDIT §1 母版口径）：数据全 DERIVE 自就绪认证（R14/R13），缺数据诚实标。
          WO-SANDBOX-LAYOUT-REWORK §5：收为折叠卡（默认折叠·降一屏密度·内容保留在 DOM 功能仍可达）。 */}
      <div style={{ marginTop: 12 }}>
      <CollapsibleCard testId="sandbox-dual-radar-card" title="运行雷达 · 健康度 6 维 + 信任度 4 维" summary={cert ? `双雷达 · tick ${curTick}` : "需就绪认证数据"} defaultOpen={false}>
      <div data-testid="sandbox-dual-radar">
        {cert ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              <HealthTrustRadar title="健康度" dims={healthDims} color="#43B7D7" />
              <HealthTrustRadar title="信任度" dims={trustDims} color="#7BD389" />
            </div>
            {/* 轨Q 增量3（竞品 image1 ④）：知识激活·静态可达传播链 N/N + DORMANT/ACTIVE（真 cert + curTick）。 */}
            <KnowledgeActivation cert={cert} curTick={curTick} />
          </>
        ) : (
          <div className={styles.sub} data-testid="sandbox-dual-radar-na">
            双雷达需就绪认证数据（sim.certification 未开通或会话未就绪）——不写死占位值（RL5）。
          </div>
        )}
      </div>
      </CollapsibleCard>
      </div>

      {/* 轨Q 增量4（竞品状态卡条 风险 TOP3·接 risk_timeline 真求解器·MOCK 因素诚实标估算·守轨M 真推演红线）。 */}
      <RiskTop3 enabled={!!sessionId} />

      {/* 轨Q 增量2（竞品 image8 状态卡条·运行台状态：Step / 诞生规则 / 可执行行动·全真 cert + curTick）。 */}
      {cert && (
        <div className="panel" data-testid="sandbox-runstate" style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "10px 12px", marginTop: 12, fontSize: 12.5 }}>
          <span data-testid="sandbox-runstate-step">Step <b className="mono" style={{ color: "#43B7D7" }}>+{curTick}</b></span>
          <span data-testid="sandbox-runstate-rules">诞生规则 <b className="mono" style={{ color: "var(--ok)" }}>{cert.trialTick.rulesFired}</b> ✓</span>
          <span data-testid="sandbox-runstate-actions">可执行行动 <b className="mono">{cert.worldCompleteness.actions.present}/{cert.worldCompleteness.actions.needed}</b></span>
          <span data-testid="sandbox-runstate-canenter" style={{ color: cert.canEnterSimulation ? "var(--ok)" : "var(--danger)" }}>{cert.canEnterSimulation ? "运行中" : "未就绪"}</span>
        </div>
      )}

      {/* 轨Q 增量2（竞品 image8 右栏 Schema Derive Rules·真 derivedProperties + 传导规则·[RUNTIME/INGEST] RESERVED）。 */}
      {cert && <SchemaDeriveRules cert={cert} />}

      {/* 轨Q 增量4b（竞品中栏 6 子 tab + Agent 指挥台接 QOS）：复用平台标准 PlatformConsole（不新建并行）。
          基本信息=沙盘本体派生摘要；Skills/MCP/日志=接现成真后端；图查询=③类 RESERVED；Agent 点真场景卡→QOS 真出答案。 */}
      <PlatformConsole
        testId="sandbox-console"
        basicInfo={
          <div style={{ fontSize: 12.5, color: "var(--muted2)", lineHeight: 1.8 }} data-testid="sandbox-console-basic">
            本体派生：{cfg.nodeTypes.length} 类对象 · {cfg.linkTypes.length} 类链路 · {cfg.stateVars.length} 状态变量 · {cfg.propagationCount} 传导规则。
            当前 tick {curTick} · 全局态 {globalKpi.toFixed(1)}{cert ? ` · 就绪 ${cert.level}` : ""}。
          </div>
        }
      />

      {/* 多场景 KPI 对比面板（北极星）：分支后出现，A 主线 vs B 分支逐 tick 差异 */}
      {compare && (
        <div className="panel" data-testid="sandbox-compare" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className={styles.sub}>分支后各自推进 tick，再刷新对比看 A/B 差异</span>
            <button className="btn sm ghost" data-testid="sandbox-compare-refresh-btn" disabled={!branchId} onClick={onRefreshCompare}>
              刷新对比
            </button>
          </div>
          <SimComparePanel a={compare.a} b={compare.b} heatThreshold={heatThreshold} />
        </div>
      )}

      {/* WO-SANDBOX-RUN-HISTORY（G-VIS-1）：历史推演记录（后端 sim_session 真留痕·前端此前 0 面板）。
          refreshKey 随 sessionId/curTick 变 → 推进/分支后列表自动重取（C4 事件失效·R17 同页留痕）。
          WO-SANDBOX-LAYOUT-REWORK §5：收为折叠卡（默认折叠·§5 明列「历史推演记录卡·默认折叠」）。 */}
      <div style={{ marginTop: 12 }}>
        <CollapsibleCard testId="sandbox-run-history-card" title="历史推演记录" summary={`会话轨迹 · tick ${curTick}`} defaultOpen={false}>
          <SandboxRunHistory refreshKey={`${sessionId ?? ""}:${curTick}`} />
        </CollapsibleCard>
      </div>

      {/* R13 溯源悬浮（点拓扑节点触发）：沿本体链路 数据源→原始表→建模派生→对象，不裸渲染。点空白关闭。 */}
      {lineage && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
            onClick={() => setLineage(null)}
            data-testid="sandbox-lineage-scrim"
          />
          <NodeLineagePopover typeKey={lineage.typeKey} objectId={lineage.objectId} anchor={anchor} />
        </>
      )}
    </div>
  );
}
