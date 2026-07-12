import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { parseWhatIfPreset, resolveBaseId, cropConfigToBase, cropWorldToBase, type WhatIfPreset } from "./whatif";
import { useScenarioPreset, presetNum, presetStr } from "./useScenarioPreset";
import type { ViewConfigVM } from "@/api/types";
import ModelCapacitySlice from "./ModelCapacitySlice";
import type { PropagationRule, PropagationTrace, SandboxViewConfig, SimCertification, SimTickUnit, SimulationRequest, TickState } from "@platform/contracts";
import { SimulationRequestSchema } from "@platform/contracts";
import {
  createSimSession,
  fetchObjectLineage,
  fetchObjectTypes,
  fetchSimCertification,
  fetchSimCompare,
  fetchSimPropagationRules,
  fetchSimViewConfig,
  invokeSolver,
  searchObjects,
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
import { stateVarLabel, SIM_KNOWLEDGE_DIM_LABEL, SIM_KNOWLEDGE_DIM_SRC, simRadarHumanLabel, simTickTimeLabel } from "@/locales/zh";
import { useFeature } from "@/workspace/featureGate";
import { SimDataModeBadge, overallDataMode, stateVarDataMode, objectDataMode, trustSummaryText } from "./SimDataModeBadge";
import { cardDecisionMode } from "../RiskBoardView";
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
/**
 * WO-SANDBOX-AS-RENDER-TARGET（S1·§5.4 五触发归一）：任意触发的原始 source → canonical SimulationRequest.source
 * 五枚举（dialogue/scenario/whatif/alert/workspace·R14 无业务常数）。决策视图 what-if 按钮的 WhatIfPreset.source
 * （risk-board=风险告警触发 / ledger·project-sim=决策 what-if）在此归一 → 全触发落同一 source 域，可溯（R13）。
 */
export function mapSimSource(raw: string | undefined, fromPreset: boolean): "dialogue" | "scenario" | "whatif" | "alert" | "workspace" {
  const s = (raw ?? "").toLowerCase();
  if (s === "dialogue") return "dialogue";
  if (s === "scenario" || s.includes("launch") || s.includes("scenario")) return "scenario";
  if (s === "alert" || s.includes("risk")) return "alert"; // 风险看板/告警触发
  if (s === "whatif" || s === "ledger" || s.includes("project") || s.includes("sim")) return "whatif";
  return fromPreset ? "scenario" : "workspace"; // 场景卡 preset 无显式 source → scenario；沙盘内直接操作 → workspace
}

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

/**
 * WO-CAP-03-KPI-FIX：单个 stateVar 的**真均值**——只在**携带该变量的对象**上取均值
 * （分母 = 携带者数，**非全 575 对象**），治「Σ携带者值 ÷ 全对象 = 稀释误标」
 * （利用率此前 (12×92 + 60×0.95) / 575 ≈ **2.0**·误冒充"利用率"）。
 *
 * 携带者判定 = 后端**真快照** `cfg.nodeObjectState[oid][v]` 为有限数（= obj.props 命中该 stateVar 的数值型属性，
 * 与 datacore `buildRealSnapshot` 同源）；世界态被 tick 传导后取 `world[oid][v]` 现态（反映推演）。
 *
 * 量纲统一（PRD §2.1）：同一 stateVar 若携带者跨「分数(≤1)/百分(>1)」两种量纲
 * （如 `Line.utilization` 百分 90-93 vs `Process.utilization` 分数 0.88-1.0），聚合前把分数值 ×100 归一到 0-100，
 * 避免 0.95 与 92 直接混算。仅当携带者同时含 >1 与 ≤1 两类才归一（纯分数比率变量如 demandDelta 不被改动）。
 *
 * 无 `nodeObjectState`（老配置/测试桩）→ 退回「全 world 对象均值」兜底（无真携带信息时不臆断，向后兼容）。
 *
 * WO-RC-UX-KPI-CARRIER（感知层命门·治「推了没反应·死的」错觉·一手证据 VERIFIED§1③）：携带者集**并入 tick 后
 * 传导目标对象**——`Base.loadIndex`/`Model.demandLoad` 等传导 target 在初始快照**无载体**（nodeObjectState 缺），
 * 但 tick 后 `world[oid][v]` 真被传导写入非零值（DAG Σ0→Σ358620 真变）。原实现只认初始载体 → 磁贴恒 0（主视觉真变、
 * 磁贴不动 = 死的错觉）。修：携带者 = 初始快照载体 ∪ **tick 后 world 有非零真值的对象**（KILL-MOCK-RED：取真 post-tick
 * 态·非补 0；排除 world 里恒 0 的未触及对象 → 不复稀释 WO-CAP-03）。tick 后磁贴随 DAG 真动。
 */
export function carrierMean(cfg: SandboxViewConfig, world: TickState, v: string): { value: number; carriers: number } {
  const nos = cfg.nodeObjectState;
  const objs = Object.keys(world);
  const ids = nos
    ? objs.filter((o) => {
        const r = nos[o]?.[v];
        if (typeof r === "number" && Number.isFinite(r)) return true; // 初始快照载体
        // WO-RC-UX-KPI-CARRIER：tick 后传导目标获真非零态 → 纳入（未触及对象 world 恒 0/缺 → 排除·不稀释）。
        const cur = world[o]?.[v];
        return typeof cur === "number" && Number.isFinite(cur) && cur !== 0;
      })
    : objs;
  if (ids.length === 0) return { value: 0, carriers: 0 };
  let vals = ids.map((o) => world[o]?.[v] ?? 0);
  const hasPct = vals.some((x) => x > 1);
  const hasFrac = vals.some((x) => x <= 1);
  if (hasPct && hasFrac) vals = vals.map((x) => (x <= 1 ? x * 100 : x)); // 分数→百分，统一 0-100
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { value: mean, carriers: ids.length };
}

/**
 * WO-CAP-03-KPI-FIX：全局态（0-100）——**按变量归一后再聚合**，勿把 totalDemand(32万量级) 等无界计数变量
 * 混入 0-100 全局态（此前 Σaggregate÷对象数 = **3339.5** 远超注释宣称 0-100、恒过阈值恒红误导）。
 * 各 stateVar 取「携带者真均值」，仅纳入归一后 ≤100 的**有界比率/百分变量**（无界计数变量排除），末端 clamp 0-100。
 * 无真快照（测试桩/老配置）→ 退回原 world 聚合（保持 tick 响应·向后兼容）。
 */
function computeGlobalKpi(cfg: SandboxViewConfig, world: TickState): number {
  const objs = Object.keys(world);
  if (objs.length === 0) return 0;
  if (cfg.nodeObjectState) {
    const perVar = cfg.stateVars
      .map((v) => carrierMean(cfg, world, v))
      .filter((r) => r.carriers > 0 && r.value <= 100);
    if (perVar.length > 0) {
      const m = perVar.reduce((a, r) => a + r.value, 0) / perVar.length;
      return Math.max(0, Math.min(100, m));
    }
  }
  return objs.reduce((a, o) => a + aggregate(world[o]), 0) / objs.length;
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

// ── SANDBOX-DAG-NODE-LAYOUT：分层/网格布局（治「35 节点单行·标签互叠成墨条」）─────────────────
// 复现根因：旧 `layers={[nodes]}` 把全部对象类型节点塞进单行 → 节点框收窄 ~21px、标签溢出互叠不可读。
// 治：按拓扑 rank 分层（longest-path·环安全）；宽层网格换行（每行 ≤ maxPerRow）；退化（链式→单列/全独点）
// 时回退纯网格（按 rank 序 chunk）。任一路径都保证每行节点数有上限 → 节点框有充裕间距 → 配合 fitLabel 标签不叠。
export const SANDBOX_MAX_PER_ROW = 6;

/** 对象类型拓扑 rank 分层 + 网格换行 → PmDag 多层入参（非单行）。纯函数（R6·确定性·无随机/时钟）。 */
export function layoutTopology(
  nodes: PmDagNode[],
  edges: [string, string][],
  maxPerRow: number = SANDBOX_MAX_PER_ROW,
): PmDagNode[][] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [nodes];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const [f, t] of edges) {
    if (!byId.has(f) || !byId.has(t) || f === t) continue;
    adj.get(f)!.push(t);
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }
  // Kahn 拓扑序上跑 longest-path rank（环残留节点留 rank 0，确定性不死循环）。
  const rank = new Map<string, number>(nodes.map((n) => [n.id, 0] as const));
  const deg = new Map(indeg);
  const queue = nodes.filter((n) => (deg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();
  while (queue.length) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    for (const v of adj.get(u) ?? []) {
      rank.set(v, Math.max(rank.get(v) ?? 0, (rank.get(u) ?? 0) + 1));
      deg.set(v, (deg.get(v) ?? 0) - 1);
      if ((deg.get(v) ?? 0) <= 0) queue.push(v);
    }
  }
  const maxRank = Math.max(...[...rank.values()]);
  const groups: PmDagNode[][] = [];
  for (let r = 0; r <= maxRank; r++) {
    const g = nodes.filter((n) => (rank.get(n.id) ?? 0) === r);
    if (g.length) groups.push(g);
  }
  const widest = Math.max(...groups.map((g) => g.length));
  // 退化：拓扑塌成长链（全独点）或层数过多 → 纯网格（按 rank 序 chunk，横铺不再单列过高）。
  if (widest <= 1 || groups.length > 8) {
    const flat = groups.flat();
    const rows: PmDagNode[][] = [];
    for (let i = 0; i < flat.length; i += maxPerRow) rows.push(flat.slice(i, i + maxPerRow));
    return rows;
  }
  // 正常：保留拓扑层，宽层网格换行（每行 ≤ maxPerRow）。
  const layers: PmDagNode[][] = [];
  for (const g of groups) {
    if (g.length <= maxPerRow) {
      layers.push(g);
      continue;
    }
    for (let i = 0; i < g.length; i += maxPerRow) layers.push(g.slice(i, i + maxPerRow));
  }
  return layers;
}

/** 超密聚合（thumbnail·聚类）：把分层结果折叠为「每层一个聚类节点」（`层N · k类对象`）→ 节点数骤降、必可读。
 *  边 = 相邻聚类层顺接。诚实聚合（真按拓扑层归并·标注成员数），非造数（RL5）。纯函数（R6）。 */
export function aggregateLayers(layers: PmDagNode[][]): { layers: PmDagNode[][]; edges: [string, string][] } {
  const clusters: PmDagNode[] = layers.map((layer, i) => ({
    id: `__layer_${i}`,
    label: `层 ${i + 1}`,
    sub: `${layer.length} 类对象`,
    color: "#43B7D7",
    st: 0,
  }));
  const edges: [string, string][] = [];
  for (let i = 0; i + 1 < clusters.length; i++) edges.push([clusters[i]!.id, clusters[i + 1]!.id]);
  return { layers: clusters.map((c) => [c]), edges };
}

/** 超密阈：对象类型数 > 此值即在 DAG 面板提供「聚合分层/展开全部」切换（默认展开·网格已可读）。 */
export const SANDBOX_DENSE_THRESHOLD = 18;

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
  // 建模完整度（正名·WO-CAP-03）：dims.knowledge = 字段消费率(schema 覆盖率)，非产能利用率，直接取。
  const closure = ratioPct(wc.derivationRules.present, wc.derivationRules.needed);
  const activation = ratioPct(wc.actions.present, wc.actions.needed);
  return [
    { key: "ruleCoverage", label: "规则覆盖", value: ruleCov.value, hasData: ruleCov.hasData, src: "worldCompleteness.propagationRules" },
    { key: "utilization", label: SIM_KNOWLEDGE_DIM_LABEL, value: Math.round(cert.dims.knowledge), hasData: true, src: SIM_KNOWLEDGE_DIM_SRC },
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
    { key: "action", label: "Action 行动", val: `${wc.actions.present} · ${SIM_KNOWLEDGE_DIM_LABEL} ${Math.round(cert.dims.knowledge)}%`, ok: wc.actions.present > 0, note: "写回行动数 · 建模完整度(dims.knowledge=字段消费率)" },
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
    queryFn: async () => (await invokeSolver("risk_timeline", {})).data as { dataMode?: string; confidence?: { synthetic?: boolean }; cards?: RiskCard[] },
    retry: false, enabled,
  });
  if (isError) return null;
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
            // C2（同源诚实标一致）：走**共享** cardDecisionMode（与 RiskBoardView 卡同判据·含 confidence.synthetic 门），
            // 杜绝同一常州风险此处「实测」而看板「估算·无实测」。仅 LIVE（真源+非合成世界）出决策红。
            const cLive = cardDecisionMode(c, data?.dataMode, data?.confidence) === "LIVE";
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
/** WO-SANDBOX-TICK-CALENDAR（S5）· 节点归因项：一条传导贡献（真链路真系数·非造·R13/G-10）。 */
interface NodeAttribution {
  fromObjectId: string;
  ruleKey: string;
  viaLinkKey: string;
  amount: number;
  coefficient: number | null; // 由 propRules[ruleKey] join；缺则 null（诚实不臆造）
  delayTicks: number | null;
}
/**
 * 计算某类型节点该 tick 的归因（"为什么红"）：末次 tick trace 中 toObjectId ∈ 本类型对象集的贡献，
 * 按 ruleKey join propRules 取真系数/延迟（G-10 显真定义）。纯派生（R6·消费引擎已产 trace·绝不编造）。
 */
export function computeNodeAttribution(
  typeKey: string,
  cfg: SandboxViewConfig,
  trace: readonly PropagationTrace[],
  propRules: readonly PropagationRule[],
): NodeAttribution[] {
  const ids = new Set(cfg.nodeObjectIds?.[typeKey] ?? []);
  const ruleByKey = new Map(propRules.map((r) => [r.key, r] as const));
  return trace
    .filter((t) => ids.has(t.toObjectId))
    .map((t) => {
      const r = ruleByKey.get(t.ruleKey);
      return {
        fromObjectId: t.fromObjectId,
        ruleKey: t.ruleKey,
        viaLinkKey: t.viaLinkKey,
        amount: t.amount,
        coefficient: r ? r.coefficient : null,
        delayTicks: r ? r.delayTicks : null,
      };
    });
}

/** 节点悬浮卡：取该类型**代表对象**（nodeObjectIds 首个）的 R13 lineage → 显上游链路。 */
function NodeLineagePopover({ typeKey, objectId, anchor, attributions, showAttribution }: {
  typeKey: string;
  objectId: string | null;
  anchor: { x: number; y: number };
  attributions?: NodeAttribution[];
  showAttribution?: boolean;
}) {
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
      {/* WO-SANDBOX-TICK-CALENDAR（S5）· 归因页签："为什么红"——本 tick 哪条边×什么系数把它传入（真 trace·非造）。 */}
      {showAttribution && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line2,#2a2a2a)" }} data-testid="sandbox-attribution">
          <div className={styles.secHead} style={{ marginBottom: 4 }}>归因 · 本 tick 为什么变（传导贡献）</div>
          {attributions && attributions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {attributions.slice(0, 6).map((a, i) => (
                <div key={`${a.ruleKey}-${a.fromObjectId}-${i}`} data-testid={`sandbox-attribution-${i}`} style={{ fontSize: 11.5 }}>
                  由 <b className="mono">{a.fromObjectId}</b> 经规则 <b className="mono">{a.ruleKey}</b>
                  {a.coefficient != null && <span className={styles.sub}>（系数 {a.coefficient}{a.delayTicks != null ? ` · 延迟 ${a.delayTicks}` : ""}）</span>}
                  {" "}via <span className="mono">{a.viaLinkKey}</span> 传入 <b className="mono">{a.amount.toFixed(2)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.sub} data-testid="sandbox-attribution-empty">本 tick 无传导贡献（静止/无输入/未推进）——诚实不造。</div>
          )}
        </div>
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

/**
 * SANDBOX-RENAME-BASECARDS ②（闭用户亲报「各基地卡片都没有了」·发现性回归）：各基地状态卡回主区·**默认可见**。
 * 根因：SANDBOX-LAYOUT-REWORK(§5) 把状态卡收进右栏折叠卡栈（默认折叠）→ 首屏 body.innerText 零基地名。
 * 修：基地卡走**主区独立渠道**（非右栏折叠卡·不进 side-stack）→ 首屏不点任何折叠即见基地名；右栏运行态/风险 TOP3 折叠记忆不动（§5 密度不破）。
 * 数据源 searchObjects("Base","")（与 GeoMapView 同源·真 Base 对象·util/OEE/瓶颈/GWh 真值·非合成 RL5）；
 * util/oeeIndex 为分数（值域 0.62–0.97）→ ×100 显百分。空世界（无 Base 对象）→ 诚实空态不造数。「360→」进对象 360（/o/Base/{baseId}）。
 */
function BaseStatusCards({ trustBadge, cfg, propRules }: {
  trustBadge?: boolean;
  cfg?: SandboxViewConfig;
  propRules?: readonly PropagationRule[];
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "objects", { type: "Base", view: "sandbox-basecards" }],
    queryFn: () => searchObjects("Base", ""),
    retry: false,
  });
  const bases = (data?.items ?? []).map((o) => ({
    baseId: String(o.props.baseId ?? o.id),
    name: String(o.props.name ?? ""),
    util: o.props.util != null ? Number(o.props.util) : null,
    oee: o.props.oeeIndex != null ? Number(o.props.oeeIndex) : null,
    bottleneck: o.props.bottleneck != null ? String(o.props.bottleneck) : null,
    gwh: o.props.gwh != null ? Number(o.props.gwh) : null,
  }));
  // 归一化显示：真后端 util/oeeIndex 为分数（值域 0.62–0.97）→ ×100；若已是百分数（>1，如 MSW mock 的 88）则原样。
  // 非造数——只统一「分数/百分数」两种真实表示口径，缺值诚实标 —（RL5）。
  const pct = (v: number | null) =>
    v != null && Number.isFinite(v) ? `${Math.round(v <= 1 ? v * 100 : v)}%` : "—";
  return (
    <div className={`panel ${styles.heroDag}`} data-testid="sandbox-base-cards-panel" style={{ padding: 14, minHeight: "auto" }}>
      <div className={styles.secHead} style={{ marginBottom: 8 }}>
        各基地状态 · 真 Base 对象（利用率/OEE/瓶颈/GWh · 点 360→ 看对象全景）
      </div>
      {isLoading ? (
        <div className={styles.sub} data-testid="sandbox-base-cards-loading">读取基地对象…</div>
      ) : isError ? (
        <div className={styles.sub} data-testid="sandbox-base-cards-error">基地对象读取失败（对象服务未就绪或该功能未开通）。</div>
      ) : bases.length === 0 ? (
        <div className={styles.sub} data-testid="sandbox-base-cards-empty">本租户暂无 Base 对象——诚实空态（无真值不造数 RL5）。</div>
      ) : (
        <div data-testid="sandbox-base-cards" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {bases.map((b) => (
            <div
              key={b.baseId}
              data-testid={`sandbox-base-card-${b.baseId}`}
              style={{ flex: "1 1 150px", minWidth: 150, border: "1px solid var(--line2,#2a2a2a)", borderRadius: 8, padding: "8px 10px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{b.name}</b>
                  {trustBadge && cfg && (
                    <SimDataModeBadge mode={objectDataMode(cfg, propRules ?? [], b.baseId)} testId={`sandbox-base-datamode-${b.baseId}`} />
                  )}
                </span>
                <Link
                  to={`/o/Base/${b.baseId}`}
                  data-testid={`sandbox-base-360-${b.baseId}`}
                  className={styles.sub}
                  style={{ fontSize: 11, whiteSpace: "nowrap" }}
                >
                  360→
                </Link>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 4, fontSize: 12, color: "var(--muted2)" }}>
                <span data-testid={`sandbox-base-util-${b.baseId}`}>利用率 <b className="mono" style={{ color: "var(--txt)" }}>{pct(b.util)}</b></span>
                <span>OEE <b className="mono">{pct(b.oee)}</b></span>
                <span>瓶颈 <b>{b.bottleneck ?? "—"}</b></span>
                <span>GWh <b className="mono">{b.gwh != null && Number.isFinite(b.gwh) ? b.gwh : "—"}</b></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 测试可注入 config（绕过网络，喂两套 mock config 证 R14）；生产留空走 view-config 端点。 */
export interface SandboxViewProps {
  injectedConfig?: SandboxViewConfig;
  /** WO-E2 测试注入：绕过 URL 直接喂 what-if presetContext（生产走 useSearchParams）。 */
  injectedPreset?: WhatIfPreset | null;
  /**
   * WO-SANDBOX-AS-RENDER-TARGET（S1）：适配 ViewRendererProps——沙盘注册为渲染器后经 ViewPage 分发时收到 view。
   * 独立路由 /v/sim-sandbox 零参调用（`= {}`）与测试注入路径均不受影响（optional·additive）。
   */
  view?: ViewConfigVM;
}

export default function SandboxView({ injectedConfig, injectedPreset }: SandboxViewProps = {}) {
  // WO-E2（沙盘 what-if 进决策日常）：决策入口一键「开 what-if」→ URL 带 presetContext → 注入 SimSession.scope。
  const [searchParams] = useSearchParams();
  const urlWhatIf = injectedPreset !== undefined ? injectedPreset : parseWhatIfPreset(searchParams);
  // WO-SANDBOX-AS-RENDER-TARGET（S1·五触发归一·source=dialogue）：人机对话时序推演意图 → sandbox_render 答案块
  // 经 scenarioPreset 单一通道进沙盘。此处读取并归一为 WhatIfPreset（subject→对象裁剪·label→上下文条），
  // 使沙盘按问句对象起跑（URL what-if 通道保留·优先级：URL/注入 > scenarioPreset·两条通道并存不互斥·RL9）。
  const simPreset = useScenarioPreset("sim-sandbox");
  const whatIf = useMemo<WhatIfPreset | null>(() => {
    if (urlWhatIf) return urlWhatIf;
    if (!simPreset) return null;
    const subject = presetStr(simPreset.slots, "subject");
    const weeks = presetNum(simPreset.slots, "horizonTicks");
    return {
      source: presetStr(simPreset.slots, "source") ?? "dialogue",
      subject,
      label: simPreset.label ?? (subject ? `${subject} 时序推演` : "时序推演"),
      ...(weeks !== undefined ? { weeks: Math.max(1, Math.round(weeks / 7)) } : {}),
    };
  }, [urlWhatIf, simPreset]);
  // WO-SANDBOX-AS-RENDER-TARGET（S1·§5.4 五触发归一）：**任何触发源**（对话/what-if 按钮/场景卡/告警/工作台）
  // 都归一为同一 SimulationRequest（同一管线、同一渲染·source 字段可溯 R13）。
  //  · 对话触发（源已携完整 shock 载荷）→ 解析 simPreset.slots.simRequest（zod 校验·拒脏值）；
  //  · URL what-if / 场景卡（scope-only·无 shock）→ 由 whatIf 归一构造 SimulationRequest（scenario=[]·纯当前态·
  //    source 经 mapSimSource 归一到 canonical 五源）——**不 auto-run shock**（scenario 空 → 保裁剪静止·RL9 旧行为不变）。
  // 净效果：五触发落同一 SimulationRequest；shock 携带者 auto-推演，scope-only 者裁剪静止；source 全程可溯。
  const simRequest = useMemo<SimulationRequest | null>(() => {
    const raw = simPreset?.slots?.simRequest;
    if (raw && typeof raw === "object") {
      const parsed = SimulationRequestSchema.safeParse(raw);
      if (parsed.success) return parsed.data; // 对话/告警等携完整 shock 载荷
    }
    if (!whatIf) return null;
    // scope-only 触发（what-if 按钮/场景卡）→ 归一构造（无 shock·纯当前态演化）。
    const baseId = resolveBaseId(whatIf.subject);
    const built = {
      targetView: "sim-sandbox" as const,
      scope: { objectType: "Base", objectIds: baseId ? [baseId] : [] },
      scenario: [],
      horizonTicks: whatIf.weeks && whatIf.weeks > 0 ? Math.round(whatIf.weeks * 7) : 14,
      compareBaseline: false,
      slotPresets: {},
      source: mapSimSource(whatIf.source, !!simPreset),
    };
    const parsed = SimulationRequestSchema.safeParse(built);
    return parsed.success ? parsed.data : null;
  }, [simPreset, whatIf]);
  // 归一 canonical source（R13 可溯·上下文条显示）——五触发落同一枚举。
  const unifiedSource = simRequest?.source ?? "workspace";
  const cfgQuery = useQuery({
    queryKey: ["a", "sim", "view-config"],
    queryFn: fetchSimViewConfig,
    enabled: !injectedConfig,
    retry: false,
  });
  const cfgRaw = injectedConfig ?? cfgQuery.data;
  // WO-CAP-06-WHATIF-SCOPE（闭 G-3）：what-if 带基地 subject 时，把沙盘世界**真按该基地裁剪**（原用全量 cfg=基地徽章摆设）。
  // subject（基地名/id）→ 规范 baseId → cropConfigToBase 只留本基地对象（DAG/KPI/baseSnapshot 全聚焦本基地·R3 隔离他基地）。
  const whatIfBaseId = useMemo(() => resolveBaseId(whatIf?.subject), [whatIf]);
  const cfg = useMemo(
    () => (cfgRaw && whatIfBaseId ? cropConfigToBase(cfgRaw, whatIfBaseId) : cfgRaw),
    [cfgRaw, whatIfBaseId],
  );

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
  const [tickDays, setTickDays] = useState(1); // 命令条批量推进天数 N（默认 1 = 现行单 tick 行为·WO-CAP-04）
  const [history, setHistory] = useState<number[]>([]); // 逐 tick 全局均值轨迹（时间轴/KPI heat）
  const [cert, setCert] = useState<SimCertification | null>(null);
  const [certScope, setCertScope] = useState<"GLOBAL" | "LOCAL">("GLOBAL"); // ④ 就绪范围（现可切，不再写死 GLOBAL）
  const [branching, setBranching] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null); // 子分支会话 id（对比用）
  const [compare, setCompare] = useState<{ a: SimCompareSeries; b: SimCompareSeries } | null>(null);
  const adopt = useActionDraft(); // 采纳 → R4 Action 草稿（RL4 正门，沙盘模拟态不直写真值）
  // WO-SANDBOX-AS-RENDER-TARGET（S1）：对话触发 SimulationRequest 的 auto-推进——init 记 {n:horizonTicks, nonce}，
  // 下方 effect 在会话就绪后消费一次（ranNonceRef 保证每 preset 只 auto-跑一次·手动 tick/切换后不复跑）。
  const pendingAutoRunRef = useRef<{ n: number; nonce: string } | null>(null);
  const ranNonceRef = useRef<string | null>(null);
  // §5.3 多轮追问→分支：followUp preset 会话就绪（且 auto-run 消费完）后 auto-触发 simBranch（每 preset 一次·nonce 去重）。
  const branchedNonceRef = useRef<string | null>(null);

  // SANDBOX-DAG-NODE-LAYOUT：DAG 视图模式（full=分层/网格全展开·aggregate=超密聚合缩略）。默认全展开（网格已可读）。
  const [dagMode, setDagMode] = useState<"full" | "aggregate">("full");
  // AI 指挥台（NL 驱动沙盘 · 确定性意图解析 R6）：输入条 + 末次回执。
  const [nlText, setNlText] = useState("");
  const [nlEcho, setNlEcho] = useState<{ msg: string; ok: boolean } | null>(null);
  // R13 节点溯源悬浮：点节点（=对象类型）→ 取该类型代表对象 lineage。pointer 位置作锚。
  const [lineage, setLineage] = useState<{ typeKey: string; objectId: string | null } | null>(null);
  const pointerRef = useRef({ x: 120, y: 120 });
  const [anchor, setAnchor] = useState({ x: 120, y: 120 });
  // WO-CAP-05-BRANCH-VISIBLE：对比卡移到左主区（命令条下·分支按钮邻位），分支成功后 scrollIntoView 拉进首屏视口。
  const compareRef = useRef<HTMLDivElement | null>(null);
  const scrollToCompareRef = useRef(false); // 仅「分支」触发滚动（刷新对比不打扰）；useEffect 待 compare 渲染后消费。

  // 全局 KPI（0-100）= 各 stateVar「携带者真均值」按变量归一后聚合（WO-CAP-03·排除无界计数变量·治 3339.5 恒红）。
  const globalKpi = useMemo(() => (cfg ? computeGlobalKpi(cfg, world) : 0), [world, cfg]);

  // WO-SANDBOX-TRUST-BADGE（S2·前端半·方案A）：诚信位徽标闸（暗发·关=不显徽标·页面 100% 原样·回退演练 §5.6）。
  // 汇总位纯前端派生（propRules.coefficientRef→UNCALIBRATED · 后端 cfg.nodeObjectMode→LIVE/SYNTHETIC/STALE · 皆无→UNKNOWN）。
  const trustBadgeOn = useFeature("sim.trust_badge");
  const overallMode = useMemo(() => (cfg ? overallDataMode(cfg, propRules) : "UNKNOWN"), [cfg, propRules]);

  // WO-SANDBOX-RADAR-COLLAPSE（S4·前端·暗发）：三雷达合一（主雷达维度换人话）+ L0-L4 折一句人话结论。
  // 关=原样（旧 DOM 未删·回退演练 §5.5）。值全 DERIVE 自 cert（R13·只换 label/重组不改数）。
  const radarCollapseOn = useFeature("sim.radar_collapse");

  // WO-SANDBOX-TICK-CALENDAR（S5·前端·暗发·复验收窄）：真 core = tick↔业务日 + 节点归因（消费引擎已产 PropagationTrace + propRules join·非造）。
  // 关=回抽象 tick + 节点纯血缘（旧行为·回退演练）。lastTrace=末次 tick 传导轨迹（节点归因源）。
  // tickUnit 读**会话真值** session.tickUnit（后端/CAPSIM 下发时生效·未下发退默认 day/1·graceful·非硬编码；周/里程碑逐因素时间轴 fold CAPSIM§1·勿补齐退役页）。
  const tickCalendarOn = useFeature("sim.tick_calendar");
  const [lastTrace, setLastTrace] = useState<PropagationTrace[]>([]);
  const [tickUnit, setTickUnit] = useState<SimTickUnit>({ unit: "day", perTick: 1 });

  // init 会话：baseSnapshot 由配置派生（无业务常数）。配置就绪即自动建会话。
  const init = useCallback(async (c: SandboxViewConfig) => {
    try {
      // WO-CAP-06：世界态按基地裁剪——c 已是裁剪后的 cfg（nodeObjectIds 只含本基地），再滤掉空类型占位键，只留本基地真对象。
      const snap = deriveBaseSnapshot(c);
      const cropped = whatIfBaseId ? cropWorldToBase(snap, whatIfBaseId) : null;
      const croppedBase = cropped && Object.keys(cropped).length > 0 ? cropped : snap;
      const didCrop = croppedBase !== snap; // 真裁剪（该基地有对象）时，scope 记 baseId，便于溯源/对照端点。
      // WO-SANDBOX-AS-RENDER-TARGET（S1·shock 真接通）：把冲击增量烘进 tick0 baseSnapshot（atTick=0），使传导从冲击态
      // 起跑（配合下方 auto-推进）。**诚实守卫**：仅当 shock.target.stateVar ∈ 该配置传导变量（c.stateVars）时注入——
      // 否则传导核不认该变量、注入=无意义伪值（S0 配套预检已就该缺口告警），保持诚实不造伪态。只作用于 base 中真实
      // 存在的对象（scope 内·objectIds="ALL" 则全 base）。无 shock/URL what-if 路径 → base 原样（旧行为零变化）。
      let base = croppedBase;
      const shock = simRequest?.scenario.find((a) => a.kind === "shock");
      if (shock && shock.kind === "shock" && c.stateVars.includes(shock.target.stateVar)) {
        const ids = shock.target.objectIds === "ALL" ? Object.keys(croppedBase) : shock.target.objectIds;
        const shocked: TickState = {};
        for (const [oid, row] of Object.entries(croppedBase)) {
          shocked[oid] = ids.includes(oid)
            ? { ...row, [shock.target.stateVar]: (row[shock.target.stateVar] ?? 0) + shock.delta }
            : row;
        }
        base = shocked;
      }
      // WO-E2：what-if 上下文（决策入口带入）注入 SimSession.scope —— 沙盘据此聚焦推演、决策完即弃/采纳（R2/R3 隔离）。
      const scope = whatIf
        ? { presetContext: whatIf as unknown as Record<string, unknown>, ...(didCrop ? { baseId: whatIfBaseId } : {}) }
        : {};
      const s = await createSimSession({ baseSnapshot: base, scope });
      // S1：**仅携 shock 的** SimulationRequest → 记 auto-推进 horizonTicks（下方 effect 消费·nonce 保证每 preset 只跑一次），
      // 让传导真跑出"逐 tick 状态级结论"（答案先行）。§5.4：scope-only 触发（what-if 按钮/场景卡·scenario=[]）**不 auto-run**
      // → 开箱裁剪静止（RL9 旧行为零变化）；只有 shock 携带者（对话/告警冲击）才自动推演。
      const hasShock = simRequest?.scenario.some((a) => a.kind === "shock") ?? false;
      if (simRequest && simPreset && hasShock && simRequest.horizonTicks > 0) {
        pendingAutoRunRef.current = { n: simRequest.horizonTicks, nonce: simPreset.nonce };
      }
      setSessionId(s.id);
      setTickUnit(s.tickUnit ?? { unit: "day", perTick: 1 }); // S5：读会话真值（后端下发时生效·未下发退默认 day/1·非硬编码）
      setWorld(base);
      setCurTick(0);
      setLastTrace([]); // S5：新会话清归因 trace（避免上会话残留·诚实）
      const g0 = computeGlobalKpi(c, base); // WO-CAP-03：时间轴与全局态同口径（归一后聚合，非原始混算）
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
  }, [certScope, whatIf, whatIfBaseId, simRequest, simPreset]);

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
      scrollToCompareRef.current = true; // 标记：本次是「分支」→ 对比卡渲染后滚进视口（治「点了没反应」）。
      setCompare(cmp);
      toast(`已从检查点分支（子会话 ${child.id}），可逐 tick 对比`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBranching(false);
    }
  }, [sessionId, curTick]);

  // WO-CAP-05：对比数据落地后，若来自「分支」动作，把对比卡滚进首屏视口 + 短暂高亮（分支结果可达·治 1652px 首屏外）。
  useEffect(() => {
    if (!compare || !scrollToCompareRef.current) return;
    scrollToCompareRef.current = false;
    // 待 DOM 提交后再滚（对比卡为条件渲染，此刻已挂载）。
    requestAnimationFrame(() => {
      compareRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  }, [compare]);

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
        let lastTr: PropagationTrace[] = [];
        for (let i = 0; i < n; i++) {
          const res = await simTick(sessionId, 1);
          last = res.state;
          lastTick = res.curTick;
          // S5：末次 tick 传导轨迹（引擎已产·非造）留作节点归因源。
          lastTr = (res.trace as PropagationTrace[] | undefined) ?? [];
          const g = computeGlobalKpi(cfg!, res.state); // WO-CAP-03：逐 tick 时间轴同全局态口径（归一后聚合）
          setHistory((h) => [...h, g]);
        }
        if (last) {
          setWorld(last);
          setCurTick(lastTick);
          setLastTrace(lastTr);
        }
      } catch (e) {
        toastError(e);
      } finally {
        setTicking(false);
      }
    },
    [sessionId, curTick, cfg],
  );

  // WO-SANDBOX-AS-RENDER-TARGET（S1）：对话触发 auto-推进——会话就绪后自动跑 horizonTicks（每 preset 一次·nonce 去重），
  // 让"问句→shock 注入→逐 tick 状态级结论"真跑通。手动 tick / URL what-if 路径不触发（pendingAutoRunRef 仅 init 设）。
  useEffect(() => {
    const pending = pendingAutoRunRef.current;
    if (!sessionId || !pending || ticking) return;
    if (ranNonceRef.current === pending.nonce) return;
    ranNonceRef.current = pending.nonce;
    pendingAutoRunRef.current = null;
    void runTicks(pending.n);
  }, [sessionId, ticking, runTicks]);

  // §5.3 多轮追问→分支布线：followUp preset（同会话前序推演的追问·如"那外协呢?"）→ 会话就绪且 auto-推进消费完后
  // auto-触发 onBranch（checkpoint→simBranch→A/B 对比）。**S1 只接通机制**：A/B 此刻相同（能分、能对比即达标）；
  // 往 B 注入不同应对 + 对比维换决策维 = S3。每 preset 一次（nonce 去重·手动分支不受影响）。
  useEffect(() => {
    const followUp = simPreset?.slots?.followUp === true;
    if (!followUp || !sessionId || branching) return;
    if (pendingAutoRunRef.current || ticking) return; // 有 auto-推进 → 等它跑完再分支（对比含推演路径）
    const nonce = simPreset!.nonce;
    if (branchedNonceRef.current === nonce) return;
    branchedNonceRef.current = nonce;
    void onBranch();
  }, [simPreset, sessionId, branching, ticking, onBranch]);

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
  // SANDBOX-DAG-NODE-LAYOUT：分层/网格布局（非单行）；超密时可切聚合缩略。
  const fullLayers = layoutTopology(nodes, edges);
  const isDense = nodes.length > SANDBOX_DENSE_THRESHOLD;
  const aggregated = aggregateLayers(fullLayers);
  const dagLayers = dagMode === "aggregate" ? aggregated.layers : fullLayers;
  const dagEdges = dagMode === "aggregate" ? aggregated.edges : edges;
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
    <div data-testid="sandbox-view" className={styles.page}>
      <div className={styles.head} style={{ marginBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
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
          {/* WO-CAP-08-OPS-FLOW（C1/C3·双向导引不落死路）：一条龙的上一环是「看瓶颈（风险看板）」——
              提供回跳链（带 ?focus=<baseId> 让看板真裁剪回该基地·round-trip 相干），不让运营在沙盘走进单行道。 */}
          <Link
            className="badge"
            data-testid="sandbox-back-to-risk"
            to={whatIfBaseId ? `/v/risk?focus=${encodeURIComponent(whatIfBaseId)}` : "/v/risk"}
            style={{ cursor: "pointer", textDecoration: "none" }}
          >
            ‹ 回看瓶颈
          </Link>
          <span className="badge blue" data-testid="sandbox-whatif-badge">what-if</span>
          {/* §5.4 五触发归一：canonical source（dialogue/scenario/whatif/alert/workspace）——全触发落同一域·可溯 R13。 */}
          <span className={styles.sub} data-testid="sandbox-whatif-source" data-sim-source={unifiedSource}>触发源：{unifiedSource}（原始 {whatIf.source}）</span>
          {whatIf.label && <b data-testid="sandbox-whatif-label">{whatIf.label}</b>}
          {whatIf.subject && <span className="badge" data-testid="sandbox-whatif-subject">{whatIf.subject}</span>}
          {whatIf.factor && <span className="badge" data-testid="sandbox-whatif-factor">{whatIf.factor}</span>}
          <span className={styles.sub} style={{ marginLeft: "auto" }}>就此问题推演对比基线 · 决策完即弃或采纳为 Action（R4）</span>
        </div>
      )}

      {/* WO-CAP-07-MODEL-DIM（型号维度·本体链路⑤前端 surface·additive）：电池型号切片——选型号 →
          capacity_forecast(modelId,qty,weeks) 出该型号 P50/P90/缺口/主瓶颈 + 型号可产基地网络（PRODUCIBLE_AT）。
          型号列表来自本体 Model 对象（R14·非写死）；what-if 带入的型号/需求/周数作初值。独立 panel·不动 KPI/命令条区。 */}
      <ModelCapacitySlice initialModel={whatIf?.model} demand={whatIf?.demand} weeks={whatIf?.weeks} />

      {/* WO-SANDBOX-LAYOUT-REWORK（PRD-frontend-visual-redesign §5·Option A·治拥挤）：
          整页栅格 主 7fr（hero 主视觉焦点）/ 右 5fr（折叠卡片栈·渐进披露）·大留白。
          左主区 = 顶栏命令条 + 主视觉 DAG（占主体）+ AI 指挥台底栏；右栏 = 折叠卡栈（默认仅就绪卡展开·其余折叠）。
          不删任何功能——次要面板收为折叠卡（内容保留 DOM·点标题展开·功能仍可达）。 */}
      <div className={styles.heroGrid} data-testid="sandbox-hero-grid">
        {/* ── 左主区 7fr：hero 主视觉焦点 ─────────────────────────────────── */}
        <div className={styles.heroMain} data-testid="sandbox-main-zone">
          {/* WO-SANDBOX-TRUST-BADGE（S2）：顶部"本次推演可信度"汇总位——用户一眼知这轮数敢不敢信（暗发·闸关全消失）。 */}
          {trustBadgeOn && (
            <div
              className={styles.sub}
              data-testid="sandbox-trust-summary"
              data-sim-datamode={overallMode}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}
            >
              <SimDataModeBadge mode={overallMode} testId="sandbox-trust-summary-badge" />
              <span data-testid="sandbox-trust-summary-text">{trustSummaryText(overallMode)}</span>
            </div>
          )}
          {/* 顶栏 · 全局态大数（主指标视觉权重最高·30px/700）+ 次级 stateVar KPI 小号排布 */}
          <div className={styles.heroState} data-testid="sandbox-kpis">
            <div className={styles.kpiHero} data-testid="sandbox-kpi-global">
              <span>
                全局态（tick <span data-testid="sandbox-cur-tick">{curTick}</span>
                {/* S5：tick↔业务时间——推进不再是抽象数字，绑「第 N 天/周」（simclock tick=1 模拟日·R6 纯换算）。 */}
                {tickCalendarOn && <span data-testid="sandbox-tick-calendar" style={{ color: "var(--muted2)" }}> · {simTickTimeLabel(curTick, tickUnit)}</span>}
                ）
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <b style={{ color: heatColor(globalKpi, heatThreshold) }} data-testid="sandbox-kpi-global-val">{globalKpi.toFixed(1)}</b>
                {trustBadgeOn && <SimDataModeBadge mode={overallMode} testId="sandbox-kpi-global-datamode" />}
              </span>
            </div>
            <div className={styles.threeKpiRow}>
              {cfg.stateVars.map((v) => {
                // WO-CAP-03-KPI-FIX：只在**携带该变量的对象**上取均值（分母=携带者，非全 575）+ 量纲统一（分数↔百分）。
                const { value: avg, carriers } = carrierMean(cfg, world, v);
                return (
                  <div key={v} className={styles.kpi} data-testid={`sandbox-kpi-${v}`}>
                    <span title={`${v} · ${carriers} 个携带对象取均值（口径：携带者真均值，非全对象稀释）`}>{stateVarLabel(v)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <b data-testid={`sandbox-kpi-${v}-val`}>{avg.toFixed(1)}</b>
                      {trustBadgeOn && <SimDataModeBadge mode={stateVarDataMode(cfg, propRules, v)} testId={`sandbox-kpi-${v}-datamode`} />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 命令条：推进 tick / 存档 / 分支 / 采纳 + tick 时间轴 heat（收为一条命令条） */}
          <div className="panel" data-testid="sandbox-controls" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }} className={styles.sub}>
              天数 N
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={tickDays}
                data-testid="sandbox-tick-days"
                disabled={!sessionId || ticking}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setTickDays(Number.isFinite(v) ? Math.max(1, Math.min(50, v)) : 1);
                }}
                style={{ width: 56 }}
              />
            </label>
            <button className="btn" data-testid="sandbox-tick-btn" disabled={!sessionId || ticking} onClick={() => runTicks(tickDays)}>
              {ticking ? "推进中…" : tickDays > 1 ? `推进 ${tickDays} 天` : "推进 tick"}
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

          {/* WO-CAP-05-BRANCH-VISIBLE：多场景 KPI 对比（北极星·分支后出现）落左主区·命令条下（分支按钮邻位）→ 点分支即在首屏视口，
              不再甩到右栏栈底 1652px（治「点了没反应」）。onBranch 成功后 scrollIntoView 再兜底拉进视口。活动结果·非常驻噪声。 */}
          {compare && (
            <div className="panel" ref={compareRef} data-testid="sandbox-compare-card" data-active="1" style={{ padding: "12px 14px", borderLeft: "3px solid #43B7D7" }}>
              <div className={styles.secHead} style={{ margin: "0 0 6px" }}>多场景 KPI 对比 · A 主线 vs B 分支（分支结果）</div>
              <div data-testid="sandbox-compare" style={{ padding: "4px 0 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className={styles.sub}>分支后各自推进 tick，再刷新对比看 A/B 差异</span>
                  <button className="btn sm ghost" data-testid="sandbox-compare-refresh-btn" disabled={!branchId} onClick={onRefreshCompare}>
                    刷新对比
                  </button>
                </div>
                <SimComparePanel a={compare.a} b={compare.b} heatThreshold={heatThreshold} />
              </div>
            </div>
          )}

          {/* 主视觉 · 业务建模链 DAG（占左主区主体·min-height 420px·节点色随 tick 变·点节点→R13 溯源悬浮） */}
          <div className={`panel ${styles.heroDag}`} data-testid="sandbox-topology" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div className={styles.secHead}>本体拓扑（分层/网格布局 · 节点态随 tick 变色 · 边标 ×系数·Δ延迟 · 点节点看 R13 上游链路）</div>
              {/* SANDBOX-DAG-NODE-LAYOUT 超密处理：类型数 > 阈值时给「聚合分层 / 展开全部」切换（聚合=每层一聚类节点缩略）。 */}
              {isDense && (
                <div data-testid="sandbox-dag-density" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className={styles.sub} data-testid="sandbox-dag-density-note">{nodes.length} 类对象 · {fullLayers.length} 层</span>
                  <button
                    className={`btn sm ${dagMode === "full" ? "primary" : ""}`}
                    data-testid="sandbox-dag-mode-full"
                    aria-pressed={dagMode === "full"}
                    onClick={() => setDagMode("full")}
                  >
                    展开全部
                  </button>
                  <button
                    className={`btn sm ${dagMode === "aggregate" ? "primary" : ""}`}
                    data-testid="sandbox-dag-mode-aggregate"
                    aria-pressed={dagMode === "aggregate"}
                    onClick={() => setDagMode("aggregate")}
                  >
                    聚合分层
                  </button>
                </div>
              )}
            </div>
            {nodes.length > 0 ? (
              <div onMouseMove={(e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; }} data-testid="sandbox-dag-wrap" data-dag-mode={dagMode} data-layer-count={dagLayers.length}>
                <PmDag
                  layers={dagLayers}
                  edges={dagEdges}
                  step={0}
                  testId="sandbox-dag"
                  onNodeClick={dagMode === "aggregate" ? undefined : onNodeClick}
                  edgeLabel={(from, to) => edgeLabels.get(edgeKey(from, to)) ?? null}
                  fitLabel
                />
              </div>
            ) : (
              <div className={styles.sub} data-testid="sandbox-topology-empty">本体暂无已发布对象类型——先在建模页发布对象。</div>
            )}
          </div>

          {/* SANDBOX-RENAME-BASECARDS ②：各基地状态卡回主区·默认可见（首屏零基地名回归修复）·非右栏折叠卡。 */}
          <BaseStatusCards trustBadge={trustBadgeOn} cfg={cfg} propRules={propRules} />

          {/* AI 指挥台（NL 驱动沙盘 · 确定性意图解析 R6）：自然语言→现有沙盘动作（tick/存档/分支/查询）·收为底栏。
              LLM 不可用即默认确定性解析（无 Date.now/random），未识别意图诚实降级显支持指令集。 */}
          <form
            className="panel"
            data-testid="sandbox-ai-console"
            style={{ padding: "10px 14px" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (nlText.trim()) void onIntent(nlText);
            }}
          >
            <div className={styles.secHead} style={{ margin: "0 0 6px" }}>AI 指挥台 · 自然语言驱动沙盘（确定性解析，无 LLM 依赖）</div>
            <div className={styles.inputBar} style={{ marginBottom: 0 }}>
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
        </div>

        {/* ── 右栏 5fr：折叠卡片栈·渐进披露（默认仅就绪卡展开·其余折叠·降密度核心） ────── */}
        <div className={styles.heroSide} data-testid="sandbox-side-stack">
          {/* 就绪认证卡（默认展开·§5 明列「就绪认证卡·默认展开」）：L0–L4 stepper / L4 三元组 / Trial Tick / scope / 完整度 gauge / entering 清单 */}
          <CollapsibleCard testId="sandbox-readiness-card" title="就绪认证 · L0–L4 + 世界完整度" summary={cert ? `${cert.level} · ${cert.canEnterSimulation ? "可进入" : "未就绪"}` : "就绪认证未开通"} defaultOpen={true}>
            <div data-testid="sandbox-readiness">
              {/* 轨Q 增量3（竞品 image1 ①）：4 行评估清单 State/Action/Writeback/Query（真派生自 cert）。 */}
              {cert && <EvalChecklist cert={cert} cfg={cfg} />}
              {cert ? (
                <SimReadinessPanel
                  cert={cert}
                  scope={certScope}
                  onScopeChange={(s) => void reloadCert(s)}
                  humanize={radarCollapseOn}
                  radar={
                    <ReadinessRadar
                      dims={radarCollapseOn ? cfg.radarDims.map((d) => ({ ...d, label: simRadarHumanLabel(d.key, d.label) })) : cfg.radarDims}
                      values={radarValues}
                    />
                  }
                />
              ) : (
                <>
                  <div className={styles.secHead}>就绪认证</div>
                  <div className={styles.sub} data-testid="sandbox-cert-na">就绪认证未开通（sim.certification 关）</div>
                </>
              )}
            </div>
          </CollapsibleCard>

          {/* 健康6维 + 信任4维 双雷达（轨A P1·AUDIT §1 母版口径）：数据全 DERIVE 自就绪认证（R14/R13），缺数据诚实标。
              §5：默认折叠·点标题展开·内容保留 DOM 功能仍可达。 */}
          <CollapsibleCard testId="sandbox-dual-radar-card" title="运行雷达 · 健康度 6 维 + 信任度 4 维" summary={cert ? `双雷达 · tick ${curTick}` : "需就绪认证数据"} scenario="解决什么运营问题：这轮推演的决策可信度体检——数敢不敢信、哪一维在拖后腿。" defaultOpen={false}>
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

          {/* 运行态 + 风险 TOP3（轨Q 增量2/4·竞品状态卡条）·WO-CAP-08 C2：默认展开（运营最关心·哪基地/工序张力最高）。 */}
          <CollapsibleCard testId="sandbox-runstate-card" title="运行态 · 风险 TOP3" summary={cert ? `Step +${curTick} · ${cert.canEnterSimulation ? "运行中" : "未就绪"}` : "需会话就绪"} scenario="解决什么运营问题：这轮推演下哪些基地/工序此刻张力最高、该先救谁。" defaultOpen={true}>
            {cert && (
              <div data-testid="sandbox-runstate" style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "6px 0 10px", fontSize: 12.5 }}>
                <span data-testid="sandbox-runstate-step">Step <b className="mono" style={{ color: "#43B7D7" }}>+{curTick}</b></span>
                <span data-testid="sandbox-runstate-rules">诞生规则 <b className="mono" style={{ color: "var(--ok)" }}>{cert.trialTick.rulesFired}</b> ✓</span>
                <span data-testid="sandbox-runstate-actions">可执行行动 <b className="mono">{cert.worldCompleteness.actions.present}/{cert.worldCompleteness.actions.needed}</b></span>
                <span data-testid="sandbox-runstate-canenter" style={{ color: cert.canEnterSimulation ? "var(--ok)" : "var(--danger)" }}>{cert.canEnterSimulation ? "运行中" : "未就绪"}</span>
              </div>
            )}
            {/* 风险 TOP3·接 risk_timeline 真求解器·MOCK 因素诚实标估算·守轨M 真推演红线。 */}
            <RiskTop3 enabled={!!sessionId} />
            {/* WO-CAP-08-OPS-FLOW（C1/C3·§77④）：本卡只列 TOP3·无逐因素矩阵/处置方案——给去处不留死路：
                跳「风险看板」看瓶颈量化矩阵 + 对症方案（mitigation_select·采纳→工单）。带 ?focus 让看板裁剪回该基地。 */}
            <div style={{ marginTop: 10 }}>
              <Link
                className={styles.sub}
                data-testid="sandbox-drill-bottleneck"
                to={whatIfBaseId ? `/v/risk?focus=${encodeURIComponent(whatIfBaseId)}` : "/v/risk"}
                style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
              >
                深挖瓶颈 · 看逐因素矩阵与处置方案 → 风险看板
              </Link>
            </div>
          </CollapsibleCard>

          {/* Schema 派生规则（轨Q 增量2·真 derivedProperties + 传导规则·[RUNTIME/INGEST] RESERVED）·§5：默认折叠。 */}
          {cert && (
            <CollapsibleCard testId="sandbox-schema-card" title="Schema 派生规则" summary="derivedProperties + 传导规则" scenario="解决什么运营问题：口径透明可审计——每个数怎么派生、凭哪条规则算出来的。" defaultOpen={false}>
              <SchemaDeriveRules cert={cert} />
            </CollapsibleCard>
          )}

          {/* 运行台 · Agent 指挥/技能/MCP/日志（复用平台标准 PlatformConsole·不新建并行）·§5：默认折叠。 */}
          <CollapsibleCard testId="sandbox-console-card" title="运行台 · Agent 指挥 / Skills / MCP / 日志" summary={`tick ${curTick} · 全局态 ${globalKpi.toFixed(1)}`} scenario="解决什么运营问题：对话式深挖——直接问它「为什么越线／换个应对会怎样」。" defaultOpen={false}>
            <PlatformConsole
              testId="sandbox-console"
              basicInfo={
                <div style={{ fontSize: 12.5, color: "var(--muted2)", lineHeight: 1.8 }} data-testid="sandbox-console-basic">
                  本体派生：{cfg.nodeTypes.length} 类对象 · {cfg.linkTypes.length} 类链路 · {cfg.stateVars.length} 状态变量 · {cfg.propagationCount} 传导规则。
                  当前 tick {curTick} · 全局态 {globalKpi.toFixed(1)}{cert ? ` · 就绪 ${cert.level}` : ""}。
                </div>
              }
            />
          </CollapsibleCard>

          {/* WO-CAP-05-BRANCH-VISIBLE：多场景 KPI 对比卡已移出右栏栈底 → 左主区命令条下（分支按钮邻位·首屏可见）。此处不再渲染。 */}

          {/* WO-SANDBOX-RUN-HISTORY（G-VIS-1）：历史推演记录（后端 sim_session 真留痕）·§5：默认折叠。
              refreshKey 随 sessionId/curTick 变 → 推进/分支后列表自动重取（C4 事件失效·R17 同页留痕）。 */}
          <CollapsibleCard testId="sandbox-run-history-card" title="历史推演记录" summary={`会话轨迹 · tick ${curTick}`} defaultOpen={false}>
            <SandboxRunHistory refreshKey={`${sessionId ?? ""}:${curTick}`} />
          </CollapsibleCard>
        </div>
      </div>

      {/* R13 溯源悬浮（点拓扑节点触发）：沿本体链路 数据源→原始表→建模派生→对象，不裸渲染。点空白关闭。 */}
      {lineage && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
            onClick={() => setLineage(null)}
            data-testid="sandbox-lineage-scrim"
          />
          <NodeLineagePopover
            typeKey={lineage.typeKey}
            objectId={lineage.objectId}
            anchor={anchor}
            showAttribution={tickCalendarOn}
            attributions={tickCalendarOn ? computeNodeAttribution(lineage.typeKey, cfg, lastTrace, propRules) : undefined}
          />
        </>
      )}
    </div>
  );
}
