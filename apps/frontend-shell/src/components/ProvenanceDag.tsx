import { useState, type ReactNode } from "react";
import zh from "@/locales/zh";

/**
 * cockpit P2 规划决策推演 · 根因归因 DAG（<ProvenanceDag>）。
 * 渲染 plan_rootcause 求解器产出的因果 DAG：经营 KPI（越线根）→ 因子 → 取证叶，
 * 逐层缩进 + 边权重（贡献占比）。结构与数字全部来自求解器（活数据算出），前端不写死（R14）。
 *
 * WO-B · PROVENANCE-HOVER（R13 三态诚实溯源）：树上每个数字 hover → 溯源弹窗，全部字段
 * 从节点真值读（零写死叙事串·KILL-MOCK）。三态由节点真字段判定（见 <NodeProv>）：
 *   ① 下钻值（evidence 叶·有 drillType）→「数据源=drillType.drillId.drillField · 当前值=drillValue」（DB 对象真值）；
 *      provenanceSynthetic → 标灰「合成·未接实测」，绝不冒充 DB 实测。
 *   ② 派生/贡献值（kpi/ksf/factor）→「派生·非 DB 原值」+ 输入链（drillValue→占比→贡献）——绝不把算出来的数说成"来自数据库"。
 */

export interface DagNode {
  id: string;
  kind: "kpi" | "ksf" | "factor" | "evidence";
  label: string;
  sub?: string;
  value?: number;
  share?: number;
  status?: string;
  actual?: number;
  target?: number;
  unit?: string;
  /** ── R13 三态溯源字段（hover 弹窗读这些真值·随求解器 provenance 投影带出·零写死）── */
  contribution?: number; // 派生贡献值（gap 量纲·= value 的语义化·用于派生弹窗输入链末端）
  provKind?: string; // 求解器 provenance.kind（实测/派生/外部信号/决策/求解器/策略推理）
  drillType?: string; // 下钻源对象类型（Equipment/MaterialBalance/Supplier/DecisionGap/…）
  drillId?: string; // 下钻源对象 id（R13 可下钻定位）
  drillField?: string; // 取值字段（oee_current/gapTon/actualSupplyTon/…）
  drillValue?: number; // 该字段真值（改它→弹窗"当前值"跟着变·C2 铁律）
  provenanceSynthetic?: boolean; // 合成源诚实标灰（地缘/矿价无真源·不冒充 DB 实测）
  basis?: string; // 设定依据/出处（部分因果节点带·如 BackupSupplierPool.certWeeks）
}

/** provenance 字段（求解器输出）→ DagNode 溯源字段（前端弹窗读）。仅搬运真值，不构造叙事。 */
type ProvFields = Pick<DagNode, "provKind" | "drillType" | "drillId" | "drillField" | "drillValue" | "provenanceSynthetic" | "basis">;
const provOf = (cn: GapAttrNode): ProvFields => {
  const pv = cn.provenance;
  if (!pv) return {};
  return {
    provKind: pv.kind,
    drillType: pv.drillType,
    drillId: pv.drillId,
    drillField: pv.drillField,
    drillValue: pv.drillValue,
    ...(pv.provenanceSynthetic ? { provenanceSynthetic: true } : {}),
    ...(pv.basis ? { basis: pv.basis } : {}),
  };
};
export interface DagEdge {
  from: string;
  to: string;
  weight?: number;
  kind?: string;
}
export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
}

/**
 * WO-COCKPIT-INFER：gap_attribution（CEO-2 深度反向归因·多跳 caused_by 因果树）产物 → DagData（因果树）。
 * 引擎不改（§5）——纯前端投影：越线 Metric 根 → 因果层（levels[depth=3] caused_by 链·逐跳）→ 每因素下钻真证据叶。
 * 比 plan_rootcause 的 1 跳 KPI→因子→取证深：一路溯到地缘/决策终点根因（`ProvenanceDag` 递归渲染多跳链）。
 */
export interface GapAttrNode {
  id: string;
  factor: string;
  contribution: number;
  unit?: string;
  share?: number;
  /** 结构层节点的归属路径（`[metricId, base:<基地>, <叶id>]`）——用于把订单/瓶颈叶归到所属基地。 */
  path?: string[];
  /** 每跳出处（R13·gap-attribution.ts GapProvenanceSchema）：kind = 真值来源性质·合成源标灰·drill* = 下钻真对象字段。 */
  provenance?: { kind?: string; drillType?: string; drillField?: string; drillValue?: number; drillId?: string; provenanceSynthetic?: boolean; basis?: string };
}
export interface GapAttrOutput {
  rootMetric: { key: string; name: string; unit: string; target?: number; actual?: number; gap: number };
  levels?: { depth: number; label: string; nodes: GapAttrNode[] }[];
  causalEdges?: { from: string; to: string; viaLinkKey?: string }[];
  atomicLeaves?: { id: string; factor: string; contribution: number; unit?: string; share?: number }[];
  /**
   * WO-CAPACITY-PAGE-100PCT ③ · 求解器回传的**实际生效作用域**（引擎单一出处，前端不再自行推断）。
   * `factorApplied=false` + `factorNote` = 传了 factorId 但引擎无该因子的因果域 → 树仍按基地出，
   * 界面必须据实标"未按该因子细分"，而不是把树藏掉再编一个"引擎不支持作用域"的病因。
   */
  scope?: { baseId?: string; displayName?: string; exposure?: boolean; factorId?: string; factorApplied?: boolean; factorNote?: string };
}
export function gapAttributionToDag(ga: GapAttrOutput | undefined): DagData | undefined {
  if (!ga?.rootMetric) return undefined;
  const rm = ga.rootMetric;
  const kpiId = `kpi:${rm.key}`;
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  const status = rm.actual != null && rm.target != null ? (rm.actual < rm.target ? "RED" : "GREEN") : "RED";
  nodes.push({ id: kpiId, kind: "kpi", label: rm.name, status, value: rm.gap, unit: rm.unit, actual: rm.actual, target: rm.target });
  // 每叶下钻真证据（provenance→evidence 节点·R13）。evidence 叶带全套 provenance 字段供 hover 三态弹窗读。
  const drillEvidence = (cn: GapAttrNode) => {
    const pv = cn.provenance;
    if (pv?.drillType) {
      const ev = `${cn.id}:ev`;
      nodes.push({ id: ev, kind: "evidence", label: `${pv.drillType}.${pv.drillField ?? ""}`, value: pv.drillValue, ...provOf(cn) });
      edges.push({ from: cn.id, to: ev, weight: cn.share, kind: "drill" });
    }
  };
  // P0-1 · 结构层（L1 基地 / L2 订单·设备OEE瓶颈·物料短缺叶）——引擎已算(depth 1/2)，前端渲染出来，
  // 才看得见"卡在哪个瓶颈（利用率 vs 物料 vs 订单）"这一层；不再只跳到 depth-3 地缘链。零新数据·纯投影。
  const l1 = ga.levels?.find((L) => L.depth === 1)?.nodes ?? [];
  const l2 = ga.levels?.find((L) => L.depth === 2)?.nodes ?? [];
  let causalParent = kpiId; // 因果链结构入口：有物料短缺叶则挂其下，否则挂 KPI 根（退化/无结构层·backward-compat）。
  if (l1.length > 0) {
    const l1ids = new Set(l1.map((n) => n.id));
    for (const bn of l1) {
      nodes.push({ id: bn.id, kind: "ksf", label: bn.factor, value: bn.contribution, contribution: bn.contribution, share: bn.share, unit: bn.unit, ...provOf(bn) });
      edges.push({ from: kpiId, to: bn.id, weight: bn.share, kind: "kpi_ksf" });
    }
    for (const cn of l2) {
      const parent = Array.isArray(cn.path) && cn.path[1] && l1ids.has(cn.path[1]) ? cn.path[1] : (l1[0]?.id ?? kpiId);
      nodes.push({ id: cn.id, kind: "factor", label: cn.factor, value: cn.contribution, contribution: cn.contribution, share: cn.share, unit: cn.unit, ...provOf(cn) });
      edges.push({ from: parent, to: cn.id, weight: cn.share, kind: "ksf_factor" });
      drillEvidence(cn);
      if (cn.id.startsWith("material:")) causalParent = cn.id; // 物料短缺叶 = 因果链(caused_by)结构父
    }
  }
  // 因果层（caused_by 多跳链）：逐因素 → factor 节点 + 下钻真证据叶。
  const causal = ga.levels?.find((L) => L.depth === 3)?.nodes ?? [];
  const reached = new Set(causal.map((n) => n.id.replace(/^cf:/, "")));
  for (const cn of causal) {
    nodes.push({ id: cn.id, kind: "factor", label: cn.factor, value: cn.contribution, contribution: cn.contribution, share: cn.share, unit: cn.unit, ...provOf(cn) });
    drillEvidence(cn);
  }
  // caused_by 树边：reached→reached 直连（逐跳因果链）；入口（from 未 reached=结构入口）→ 挂因果结构父（物料叶/KPI 根）。
  const seenEntry = new Set<string>();
  for (const e of ga.causalEdges ?? []) {
    if (!reached.has(e.to)) continue;
    if (reached.has(e.from)) edges.push({ from: `cf:${e.from}`, to: `cf:${e.to}`, kind: "caused_by" });
    else if (!seenEntry.has(e.to)) { seenEntry.add(e.to); edges.push({ from: causalParent, to: `cf:${e.to}`, kind: "gap_entry" }); }
  }
  // 无因果链（退化·诚实）：结构父直挂 atomicLeaves 作因素。
  if (causal.length === 0) {
    for (const lf of ga.atomicLeaves ?? []) {
      nodes.push({ id: lf.id, kind: "factor", label: lf.factor, value: lf.contribution, contribution: lf.contribution, share: lf.share, unit: lf.unit, ...provOf(lf) });
      edges.push({ from: causalParent, to: lf.id, kind: "gap_leaf" });
    }
  }
  return { nodes, edges };
}

/**
 * WO-CAPACITY-INFER-PROCESS · CI-a 基地根因推演树：把 `gap_attribution`（全局 Metric 深度反向归因）产物
 * **作用域到单一基地** → DagData（越线 Metric 根 → 该基地 KSF → 结构叶[设备OEE/物料gapTon/订单] + 下钻真证据
 * → 物料短缺叶挂 caused_by 因果链溯终点根因）。结构与数字全部来自求解器（活数据算出·R13/R14），前端零写死。
 *
 * ⚠ 诚实边界（引擎侧真实限制·非本前端伪造）：
 *  - `gap_attribution` **不接受 base×factor 作用域**（引擎按全局最严重 Metric 归因·基地是结构分摊的 L1 层）→
 *    本函数在**客户端**按基地过滤 L1/L2 节点（L2 靠 `path[1]===base:<基地>`）。基地名须与引擎 `Order.bases[0]` 对齐，
 *    对不上（该基地不在结构归因基地集内）→ 返回 undefined，调用方走**诚实灰**（列出后端缺口·绝不编造根因树）。
 *  - 归因按**基地**聚合，**未按具体越线因子**（化成柜张力等 7 张力因子）细分——引擎无此维，调用方需据实标注。
 */
export function gapAttributionToBaseRootCause(ga: GapAttrOutput | undefined, baseName: string): DagData | undefined {
  if (!ga?.rootMetric || !baseName) return undefined;
  const levels = ga.levels ?? [];
  const l1 = levels.find((L) => L.depth === 1)?.nodes ?? [];
  const l2 = levels.find((L) => L.depth === 2)?.nodes ?? [];
  const l3 = levels.find((L) => L.depth === 3)?.nodes ?? [];
  // 匹配该基地的 L1 结构节点（id `base:<基地>` 或 factor `基地 <基地>` 或含基地名）——引擎/mock 命名容差。
  const baseNode = l1.find((n) => n.id === `base:${baseName}` || n.factor === `基地 ${baseName}` || n.factor.includes(baseName));
  if (!baseNode) return undefined; // 该基地不在结构归因内 → 诚实灰（调用方处理）
  const baseId = baseNode.id;

  const rm = ga.rootMetric;
  const kpiId = `kpi:${rm.key}`;
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  const status = rm.actual != null && rm.target != null ? (rm.actual < rm.target ? "RED" : "GREEN") : "RED";
  // 第一层：全局越线 Metric 根（该基地贡献所归属的经营目标·真 actual/target/gap）。
  nodes.push({ id: kpiId, kind: "kpi", label: rm.name, status, value: rm.gap, unit: rm.unit, actual: rm.actual, target: rm.target });
  // 第二层：基地作 KSF（占缺口 share + 贡献量·真值）。
  nodes.push({ id: baseId, kind: "ksf", label: baseNode.factor, sub: `占缺口 ${fmtPct(baseNode.share)} · 贡献 ${baseNode.contribution}${baseNode.unit ?? rm.unit}`, contribution: baseNode.contribution, share: baseNode.share, unit: baseNode.unit ?? rm.unit, ...provOf(baseNode) });
  edges.push({ from: kpiId, to: baseId, weight: baseNode.share, kind: "kpi_ksf" });

  // 第三层：该基地的结构叶（订单/设备OEE/物料短缺）——L2 按 path[1]===baseId 归属（无 path=退化，全挂）。
  let materialId: string | undefined;
  const kids = l2.filter((n) => (Array.isArray(n.path) ? n.path[1] === baseId : true));
  for (const c of kids) {
    nodes.push({ id: c.id, kind: "factor", label: c.factor, value: c.contribution, contribution: c.contribution, share: c.share, unit: c.unit, ...provOf(c) });
    edges.push({ from: baseId, to: c.id, weight: c.share, kind: "struct" });
    const pv = c.provenance;
    if (pv?.drillType) {
      const ev = `${c.id}:ev`;
      nodes.push({ id: ev, kind: "evidence", label: `${pv.drillType}.${pv.drillField ?? ""}`, value: pv.drillValue, ...provOf(c) });
      edges.push({ from: c.id, to: ev, weight: c.share, kind: "drill" });
    }
    if (c.id.startsWith("material:")) materialId = c.id;
  }

  // 第四层：物料短缺叶挂 caused_by 因果链（逐跳溯地缘/决策终点根因·复用 depth=3 因果层 + 下钻真值叶）。
  if (materialId && l3.length > 0) {
    const reached = new Set(l3.map((n) => n.id.replace(/^cf:/, "")));
    for (const cn of l3) {
      nodes.push({ id: cn.id, kind: "factor", label: cn.factor, value: cn.contribution, contribution: cn.contribution, share: cn.share, unit: cn.unit, ...provOf(cn) });
      const pv = cn.provenance;
      if (pv?.drillType) {
        const ev = `${cn.id}:ev`;
        nodes.push({ id: ev, kind: "evidence", label: `${pv.drillType}.${pv.drillField ?? ""}`, value: pv.drillValue, ...provOf(cn) });
        edges.push({ from: cn.id, to: ev, weight: cn.share, kind: "drill" });
      }
    }
    const seenEntry = new Set<string>();
    for (const e of ga.causalEdges ?? []) {
      if (!reached.has(e.to)) continue;
      if (reached.has(e.from)) edges.push({ from: `cf:${e.from}`, to: `cf:${e.to}`, kind: "caused_by" });
      else if (!seenEntry.has(e.to)) { seenEntry.add(e.to); edges.push({ from: materialId, to: `cf:${e.to}`, kind: "caused_by_entry" }); }
    }
  }
  return { nodes, edges };
}

const STATUS_COLOR: Record<string, string> = { RED: "#DD7E9E", AMBER: "#D2B04C", GREEN: "#62BE77" };
const fmtPct = (w?: number) => (typeof w === "number" ? `${Math.round(w * 100)}%` : "");
// 求解器 provenance.kind → 徽章色（无匹配走绿·实测底色）。字符串来自求解器真值，不在前端穷举以外硬编叙事。
const PROV_KIND_COLOR: Record<string, string> = { 实测: "#62BE77", 派生: "#4C90F0", 外部信号: "#D2B04C", 决策: "#DD7E9E", 求解器: "#4C90F0", 策略推理: "#a78bfa" };

/** 三态诚实（R13·纯由节点真字段判定·无写死）：下钻实测值 / 合成源标灰 / 派生贡献值 / 无结构源明细。 */
type ProvState = "measured" | "synthetic" | "derived" | "detail";
function provStateOf(node: DagNode): ProvState {
  if (node.kind === "evidence") {
    if (node.provenanceSynthetic) return "synthetic"; // 合成源诚实标灰（不冒充 DB 实测）
    return node.drillType ? "measured" : "detail"; // 有下钻源=DB 实测值；无=仅证据明细（诚实）
  }
  return "derived"; // kpi/ksf/factor 显示的是算出来的贡献/缺口 → 派生（绝不说"来自数据库"）
}
const STATE_META: Record<ProvState, { label: string; color: string; note: string }> = {
  measured: { label: "实测", color: "#62BE77", note: "下钻值 · 来自数据库对象" },
  synthetic: { label: "合成", color: "var(--muted2)", note: "合成种子 · 未接实测数据源" },
  derived: { label: "派生", color: "#4C90F0", note: "派生值 · 非数据库原值" },
  detail: { label: "明细", color: "var(--muted2)", note: "证据明细 · 无结构化下钻源" },
};
const drillPath = (node: DagNode) => [node.drillType, node.drillId, node.drillField].filter(Boolean).join(".");

/**
 * WO-B · 溯源悬浮（R13 三态诚实·KILL-MOCK）：包住树上任一数字 → hover/focus 弹出处。
 * 弹窗内容 100% 从节点真字段读（provKind/drillType/drillId/drillField/drillValue/provenanceSynthetic/basis/
 * contribution/share/actual/target），零写死叙事串。三态见 provStateOf：
 *   · measured/detail（evidence 叶）→ 数据源 drillType.drillId.drillField + 当前值 drillValue（DB 对象真值）。
 *   · synthetic（合成源）→ 标灰 + 诚实注「合成种子·未接实测」，绝不冒充 DB 实测。
 *   · derived（kpi/ksf/factor）→「派生·非 DB 原值」+ 输入链（drillValue→占比→贡献 / 缺口=目标−实际），绝不说"来自数据库"。
 */
function NodeProv({ node, children }: { node: DagNode; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const state = provStateOf(node);
  const isDrill = state === "measured" || state === "detail" || state === "synthetic";
  const meta = STATE_META[state];
  // 徽章：实测态用求解器真 provKind（实测/派生/外部信号/…），其余用状态默认标签——均非编造，反映真值来源性质。
  const badgeLabel = state === "measured" ? node.provKind ?? meta.label : meta.label;
  const badgeColor = state === "measured" ? PROV_KIND_COLOR[node.provKind ?? ""] ?? meta.color : meta.color;
  const path = drillPath(node);
  const contribution = node.contribution ?? node.value;
  return (
    <span
      data-testid={`prov-hover-${node.id}`}
      data-prov-state={state}
      role="button"
      tabIndex={0}
      aria-label="溯源"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ borderBottom: "1px dashed var(--muted)", cursor: "help", position: "relative", color: state === "synthetic" ? "var(--muted2)" : undefined }}
    >
      {children}
      {open && (
        <span
          /* 欠账 #104：因果树浮层盖在密排节点文字上 → 不透明 .popover-surface，非磨砂 .panel。 */
          className="popover-surface"
          role="tooltip"
          data-testid={`prov-tip-${node.id}`}
          style={{ position: "absolute", zIndex: 60, top: "130%", left: 0, minWidth: 260, padding: 10, fontSize: 11, textAlign: "left", whiteSpace: "normal" }}
        >
          {/* 三态徽章（诚实标注：实测/派生/合成/明细） */}
          <div style={{ marginBottom: 5 }}>
            <span className="badge" data-testid={`prov-state-${node.id}`} style={{ background: badgeColor, color: "#fff" }}>{badgeLabel}</span>
            <span style={{ marginLeft: 6, color: "var(--muted2)" }}>{meta.note}</span>
          </div>
          {isDrill ? (
            // ── 下钻值：数据源对象 + 该字段当前真值（DB 对象·可下钻定位） ──
            <>
              {node.drillType ? (
                <div>
                  <span style={{ color: "var(--muted2)" }}>数据源：</span>
                  <code data-testid={`prov-src-${node.id}`} style={{ fontSize: 10 }}>{path}</code>
                </div>
              ) : (
                <div style={{ color: "var(--muted2)" }}>此叶无结构化下钻源（仅证据明细）</div>
              )}
              {node.drillValue != null && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>当前值：</span>
                  <b data-testid={`prov-val-${node.id}`}>{node.drillValue}</b>
                  {node.drillField && <span style={{ marginLeft: 4, color: "var(--muted2)" }}>（{node.drillField}）</span>}
                </div>
              )}
              {state === "synthetic" && <div style={{ marginTop: 3, color: "var(--muted2)" }}>⚠ 合成种子 · 未接实测数据源——不冒充数据库实测</div>}
            </>
          ) : (
            // ── 派生/贡献值：非 DB 原值，展示推导（缺口=目标−实际 / 下钻真值→占比→贡献），绝不说"来自数据库" ──
            <>
              {node.kind === "kpi" && node.actual != null && node.target != null ? (
                <div>
                  <span style={{ color: "var(--muted2)" }}>推导：</span>
                  <code data-testid={`prov-formula-${node.id}`} style={{ fontSize: 10 }}>缺口 = 目标 {node.target}{node.unit ?? ""} − 实际 {node.actual}{node.unit ?? ""} = {node.value}{node.unit ?? ""}</code>
                </div>
              ) : (
                <div>
                  <span style={{ color: "var(--muted2)" }}>输入链：</span>
                  <code data-testid={`prov-chain-${node.id}`} style={{ fontSize: 10 }}>
                    {node.drillValue != null && `${node.drillField ?? "源值"} ${node.drillValue} → `}
                    {node.share != null && `占比 ${fmtPct(node.share)} → `}
                    贡献 {contribution}{node.unit ?? ""}
                  </code>
                </div>
              )}
              {node.drillType && (
                <div style={{ marginTop: 3, color: "var(--muted2)" }}>
                  源对象：<code style={{ fontSize: 10 }}>{path}</code>
                  {node.provKind && <span style={{ marginLeft: 4 }}>· {node.provKind}</span>}
                </div>
              )}
              {node.provenanceSynthetic && <div style={{ marginTop: 3, color: "var(--muted2)" }}>⚠ 输入源为合成种子（未接实测）</div>}
            </>
          )}
          {node.basis && <div style={{ marginTop: 3, color: "var(--muted)" }} data-testid={`prov-basis-${node.id}`}>依据：{node.basis}</div>}
          <div style={{ marginTop: 5, color: "var(--muted2)", fontSize: 10 }}>信任 = 出处 + 推导可当场亮出</div>
        </span>
      )}
    </span>
  );
}

export function ProvenanceDag({ data }: { data: DagData | undefined }) {
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  if (nodes.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = (id: string): { node: DagNode; weight?: number }[] =>
    edges
      .filter((e) => e.from === id)
      .flatMap((e) => {
        const node = byId.get(e.to);
        return node ? [{ node, weight: e.weight }] : [];
      });
  const roots = nodes.filter((n) => n.kind === "kpi");

  // 因子节点（含取证叶 + 递归子因素）渲染——kpi 直挂 / ksf 下挂 / **gap_attribution 多跳 caused_by 因果链**递归复用。
  // depth 守卫防环（caused_by 理论无环，兜底 12 层）。子因素（kind≠evidence）递归下钻，取证叶 badge 平铺。
  const renderFactor = ({ node: factor, weight }: { node: DagNode; weight?: number }, depth = 0): JSX.Element => {
    const kids = childrenOf(factor.id);
    const evid = kids.filter((k) => k.node.kind === "evidence");
    const subFactors = kids.filter((k) => k.node.kind !== "evidence");
    return (
      <div key={factor.id} data-testid={`dag-node-${factor.id}`} data-kind="factor" style={{ paddingLeft: 14, borderLeft: "2px solid rgba(124,58,237,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="badge" style={{ background: "rgba(124,58,237,.18)", color: "#a78bfa" }}>{fmtPct(weight)}</span>
          <span>{factor.label}</span>
          {/* 贡献值 hover → 派生弹窗（非 DB 原值·输入链）。 */}
          <span style={{ fontSize: 11, color: "var(--muted2)" }}><NodeProv node={factor}>贡献 {factor.value}</NodeProv></span>
        </div>
        {/* 取证叶（活数据明细·下钻真证据）——hover → 下钻弹窗（数据源+当前真值·合成标灰）。 */}
        {evid.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, paddingLeft: 12 }}>
            {evid.map(({ node: leaf }) => (
              <span key={leaf.id} data-testid={`dag-node-${leaf.id}`} data-kind="evidence" className="badge" style={{ background: "var(--panel2,rgba(255,255,255,.04))", fontSize: 10.5 }}>
                <NodeProv node={leaf}>{leaf.label} · {leaf.value}</NodeProv>
              </span>
            ))}
          </div>
        )}
        {/* 子因素（caused_by 下一跳）递归——一路溯到终点根因（gap_attribution 深度树）。 */}
        {subFactors.length > 0 && depth < 12 && (
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
            {subFactors.map((c) => renderFactor(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="provenance-dag" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {roots.map((kpi) => (
        <div key={kpi.id} className="panel" data-testid={`dag-node-${kpi.id}`} data-kind="kpi" style={{ padding: 10, borderLeft: `3px solid ${STATUS_COLOR[kpi.status ?? ""] ?? "var(--muted2)"}` }}>
          {/* 第一层：KPI 越线根（实际 vs 目标 + 缺口） */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge" style={{ background: STATUS_COLOR[kpi.status ?? ""] ?? undefined, color: "#fff" }}>{kpi.status}</span>
            <b>{kpi.label}</b>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              实际 {kpi.actual}{kpi.unit} · 目标 {kpi.target}{kpi.unit} · <NodeProv node={kpi}>缺口 {kpi.value}{kpi.unit}</NodeProv>
            </span>
          </div>
          {/* 第二层：KSF 关键成功要素层（SPINE.3，若有）→ 第三层因子 → 取证叶；无 KSF 则 kpi 直挂因子。 */}
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {childrenOf(kpi.id).map((child) =>
              child.node.kind === "ksf" ? (
                <div key={child.node.id} data-testid={`dag-node-${child.node.id}`} data-kind="ksf" style={{ paddingLeft: 8, borderLeft: "2px solid rgba(76,144,240,.5)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span className="badge" style={{ background: "rgba(76,144,240,.18)", color: "#4C90F0" }}>KSF</span>
                    <b>{child.node.label}</b>
                    {child.node.sub && <span style={{ fontSize: 11, color: "var(--muted2)" }}><NodeProv node={child.node}>{child.node.sub}</NodeProv></span>}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                    {childrenOf(child.node.id).map(renderFactor)}
                  </div>
                </div>
              ) : (
                renderFactor(child)
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
