import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BASE_REGISTRY, BUSINESS_TYPE_LABEL } from "@platform/contracts";
import type { GlobalSimScheduleRow, GlobalSimKpi, GlobalSimBusinessTypeSummary, BusinessType } from "@platform/contracts";
import { composeGlobalSimNarrative, searchObjects, type GlobalSimSevenDimKpi, type SimComposeNarrative } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import { fmt, useActionDraft } from "./shared";
import { toastError } from "@/store/toastStore";
import { Feature } from "@/workspace/featureGate";
import { useLiveSolver } from "./useLiveSolver";
import { MultiObjWhatifPanel } from "./MultiObjWhatifPanel";
import { GlobalSimLevers, type LeverState, type FreeLever, type LeverCandidate, type LeverDeltaVM } from "./GlobalSimLevers";
import { GlobalSimScenarioBar, type ScenarioSnapshotInput } from "./GlobalSimScenarioBar";
import { ScheduleTable, type Transfer } from "./ScheduleTable";
import { CustomerImpactBar } from "./CustomerImpactBar";
import zh from "@/locales/zh";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GSIM-3-FRONTEND · 全局推演决策驾驶舱（五区/七块·接真 portfolio solver·真 bases/orders/customers）。
 *
 * 从「磨砂玻璃壳」长成**可操作决策台**——跨半命门 = 前端调杠杆/勾选订单子集 →（发起）联合求解 →
 * 矩阵格色 / KPI 卡 / 排产安排表 / 客户级影响**真变**（真打 portfolio·非 mock 写死·改输入→输出真变红咬）。
 *
 * 七块（沿视觉稿·接真·零杜撰）：
 *  ① 顶栏 + 递进批次会话条（范围/方案切换/发起联合求解/FEASIBLE·status/已提交批次链[WIP 产能 hold 可视]）
 *  ② 左轨杠杆盘（供给 frozenCapacityMode · 优先级 method · 需求纳入 · 物料只读 → 调动即标 [待重算]）
 *  ③ 中央热力矩阵（基地×窗·占用%·满载挤压点·hover 溯 provenance Line/Order/Material）
 *  ④ 订单清单三态（参与 ✓ / 固定 🔒 / 排除 ☐ → orderIds/frozenOrderIds·联合解真变）
 *  ⑤ 排产安排表（电芯段→在途→Pack段·真 InterBaseTransfer·异地明示·换型停机·交付日）
 *  ⑥ 右轨方案量化多维比对（在时率/代价/换型/… 并排 + 权衡解释·数字红线·只解释不造数）
 *  ⑦ 底栏客户级影响（被挤单→真客户名+DemandSegment+交付地+影响额·行动占位 P2）
 *
 * 接线：portfolio 求解器（datacore CP-SAT sidecar·mock 逐口径移植）；徽标诚实「推演结果·非数据库事实」；
 * 每分配/被挤/矩阵值带 provenance（R13）；基地/型号/客户名来自真对象（R14·零焊死·debattery 门守）。
 */

interface Prov { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }
// WO-SURFACE-7DIM · Scenario additively 携带 7 维 kpi（编排响应并列·经典 objectiveValues 不动）。
interface Scenario { key: string; objectiveValues: { ontime: number; delay: number; changeover: number; fgInventory: number; cost: number }; servedCount: number; displacedCount: number; servedQty: number; kpi?: GlobalSimKpi }
interface Alloc { item: string; kind: string; committed: boolean; base: string; baseName: string; window: number; windowStartDay?: number; qty: number; model?: string; delayDays: number; onTime: boolean; provenance: Prov }
interface PortResult {
  status: string; optimal: boolean; feasible: boolean; reconciled: boolean;
  allocation: Alloc[];
  displaced: { orderId: string; kind: string; qty: number; model: string; provenance: Prov }[];
  scenarios: Scenario[];
  objectiveValues: { ontime: number; delay: number; changeover: number; fgInventory: number; cost: number };
  capacityLedger: { baseId: string; window: number; cap: number; allocated: number }[];
  reconChecks: { ok: boolean }[];
  cost: { delay: number; changeover: number; unserved: number; total: number };
  frozen: { orderId: string; base: string; window: number; qty: number }[];
  summary: string;
  // WO-SURFACE-7DIM · 编排响应 additively 携带的 7 维产物（经典响应缺省 → 诚实省略·全 optional 守护）。
  schedule?: GlobalSimScheduleRow[];
  mockNotes?: string[];
  // WO-GSLIVE-1-COCKPIT · 活②：自由杠杆再优化 before/after 七维 KPI（求解器携 levers[] 返·可溯 drillType=Lever）。
  leverDeltas?: LeverDeltaVM[];
  // WO-W5·业务类型分口径汇总（乘/商/储各一行·占用率/预测缺口/提前交付/订单波动·求解器真聚合）。
  businessTypeSummary?: GlobalSimBusinessTypeSummary[];
  businessTypes?: BusinessType[];
}

/** WO-GSLIVE-1-COCKPIT · 活①：内嵌 NL 框（复用 SimCommanderDock 范式·带 sessionId）→ compose 路径联合求解叙述。 */
function GlobalSimNlDock({ sessionId }: { sessionId: string }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SimComposeNarrative | null>(null);
  const submit = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const res = await composeGlobalSimNarrative({ query: q, sessionId, context: { view: "global-sim" } });
      setAnswer(res);
      setInput("");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.glass} data-testid="global-sim-nl-dock">
      <span className={styles.grpLabel}>[ {zh.gslive.nlTitle} ]</span>
      <div className={styles.summary}>{zh.gslive.nlHint}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          type="text" value={input} placeholder={zh.gslive.nlPlaceholder}
          data-testid="global-sim-nl-input" disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          style={{ flex: 1 }}
        />
        <button className={styles.btnPrimary} data-testid="global-sim-nl-submit" disabled={busy || !input.trim()} onClick={() => void submit()}>
          {busy ? zh.gslive.nlSubmitting : zh.gslive.nlSubmit}
        </button>
      </div>
      {answer && (
        <div style={{ marginTop: 10 }} data-testid="global-sim-nl-answer" data-path={answer.path} data-ran-agent-loop={answer.ranAgentLoop}>
          <div className={styles.grpLabel}>{zh.gslive.nlAnswerTitle}</div>
          <div className={styles.summary} data-testid="global-sim-nl-narrative">{answer.narrative}</div>
          <span className={styles.badge} data-testid="global-sim-nl-path">{zh.gslive.nlPathBadge(answer.path, answer.ranAgentLoop)}</span>
        </div>
      )}
    </div>
  );
}

const ALL_SCENARIOS = ["max_ontime", "min_cost", "min_changeover", "min_fg_inventory"] as const;
const SCEN_LABEL: Record<string, string> = { max_ontime: "最多按期", min_cost: "最低代价", min_changeover: "最少换型", min_delay: "最小延误", min_fg_inventory: "最少成品库存" };
const provTitle = (p: Prov) => `溯源 ${p.kind}：${p.drillType}.${p.drillField}[${p.drillId}] = ${p.drillValue}`;
const PORT_WINDOW_DAYS = 21;    // 与 mock/后端 portfolio windowDays 同口径（交付日/窗起换算）
const PORT_FORECAST_START = "2026-06-10"; // 原型 T0（HTML_ORDERS forecastStart·交付日 ISO 锚）
/** 基地 id→名（BASE_REGISTRY 单一来源·R14·补 transfer.toBase 等未在分配中的基地名）。 */
const BASE_NAME_BY_ID = new Map(BASE_REGISTRY.map((b) => [b.baseId, b.name]));

const NON_DRILLABLE_NOTE: Record<string, string> = {
  wip: "在产承诺 · 预扣产能（非可细排订单）",
  forecast: "销售预测需求（未落订单 · 不可细排）",
};
function DrillAffordance({ kind, id, label, testId, prov }: { kind: string; id: string; label: string; testId: string; prov?: Prov }) {
  if (kind === "order") {
    return (
      <Link className={styles.drillLink} to={`/v/project-sim?order=${encodeURIComponent(id)}`} data-testid={testId}>
        {label}
      </Link>
    );
  }
  const note = NON_DRILLABLE_NOTE[kind] ?? "非可细排项（非销售订单）";
  return (
    <span
      data-testid={testId}
      data-drill-blocked="true"
      title={prov ? provTitle(prov) : note}
      style={{ fontSize: 11, fontStyle: "italic", color: "var(--muted2, #8a94a6)", whiteSpace: "nowrap" }}
    >
      {note}
    </span>
  );
}

/** 占用率 → 冷暖热力色（低=冷蓝，满=暖红·committed 深空底上可读）。 */
function heatColor(util: number): string {
  const u = Math.max(0, Math.min(1, util));
  if (u >= 0.95) return "rgba(224,98,108,0.55)";
  if (u >= 0.8) return "rgba(221,149,81,0.45)";
  if (u >= 0.5) return "rgba(210,176,76,0.32)";
  if (u > 0) return `rgba(84,181,196,${0.16 + u * 0.28})`;
  return "rgba(255,255,255,0.03)";
}

type OrderState = "in" | "frozen" | "excluded";

export default function GlobalSimView(_props: ViewRendererProps) {
  const orders = useQuery({ queryKey: ["a", "objects", { type: "Order", view: "global-sim" }], queryFn: () => searchObjects("Order", "") });
  const orderList = useMemo(() => (orders.data?.items ?? []).map((o) => ({ id: String(o.props.so ?? o.id), cust: String(o.props.cust ?? "—"), model: String(o.props.model ?? "—"), qty: Number(o.props.qty ?? 0), due: String(o.props.due ?? "—"), base: String(o.props.bases ?? o.props.base ?? "—"), businessType: String(o.props.businessType ?? ""), early: o.props.early === true })), [orders.data]);

  // 真 InterBaseTransfer 对象（跨基地调拨·transitDays 真值·喂区⑤两段排产表；缺则单段·诚实不伪造）。
  const xfers = useQuery({ queryKey: ["a", "objects", { type: "InterBaseTransfer" }], queryFn: () => searchObjects("InterBaseTransfer", ""), retry: false });
  const transfers = useMemo<Transfer[]>(() => (xfers.data?.items ?? []).map((t) => ({
    transferId: String(t.props.transferId ?? t.id), fromBase: String(t.props.fromBase ?? ""), toBase: String(t.props.toBase ?? ""),
    model: String(t.props.model ?? ""), transitDays: Number(t.props.transitDays ?? 0), status: String(t.props.status ?? ""),
  })), [xfers.data]);

  // ④ 订单三态（默认全参与）：frozen（固定·预扣产能）/ excluded（排除·移出决策集）；其余 = 参与。
  const [orderState, setOrderState] = useState<Record<string, OrderState>>({});
  const stateOf = (id: string): OrderState => orderState[id] ?? "in";
  const setState = (id: string, s: OrderState) => setOrderState((prev) => ({ ...prev, [id]: prev[id] === s ? "in" : s }));

  // WO-W5·业务类型勾选筛选（乘/商/储·空 = 全类型）：勾选 → args.businessTypes → 后端在收窄世界真重解（矩阵/KPI/客户影响真变·非前端假过滤）。
  const [btFilter, setBtFilter] = useState<Set<BusinessType>>(new Set());
  const toggleBt = (t: BusinessType) => setBtFilter((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const [scenarios, setScenarios] = useState<string[]>(["max_ontime", "min_cost"]);
  const [primary, setPrimary] = useState<string>("max_ontime");
  const [levers, setLevers] = useState<LeverState>({ frozenCapacityMode: "reserve", method: "weighted" });
  // WO-GSLIVE-1-COCKPIT · 活②：自由杠杆（portfolio 契约 levers[]·key/target/delta·任一变动 → args.levers 变 → 联合重解）。
  const [freeLevers, setFreeLevers] = useState<FreeLever[]>([]);
  const [nonce, setNonce] = useState(0);
  // 本页推演会话锚（NL 框 sessionId 上下文·稳定跨渲染）。
  const [sessionId] = useState(() => `gslive-${Math.random().toString(36).slice(2, 10)}`);

  const orderIds = orderList.filter((o) => stateOf(o.id) === "in").map((o) => o.id);
  const frozenOrderIds = orderList.filter((o) => stateOf(o.id) === "frozen").map((o) => o.id);
  const includedCount = orderIds.length;
  const scenSet = useMemo(() => (scenarios.includes(primary) ? scenarios : [primary, ...scenarios]), [scenarios, primary]);
  const leversKey = JSON.stringify(freeLevers);
  const btArr = useMemo(() => [...btFilter].sort(), [btFilter]);

  const args = useMemo<Record<string, unknown> | null>(
    // WO-SURFACE-7DIM · twoStage:true → 后端编排路由 globalSimOptimize（返 GlobalSimResponse·7 维 schedule[]/kpi/mockNotes
    // additively 叠加经典 portfolio 字段·驾驶舱既有绑定不掉线）；MSW 态由 handlers 派发 mockGlobalSim（同 additive 形状）。
    // WO-GSLIVE-1-COCKPIT · 活②：freeLevers 非空 → 携真 levers[{key,target,delta}]（引擎已消费）→ leverDeltas before/after。
    // WO-W5 · businessTypes 非空 → 后端只对勾选类订单+预测联合推演·产能作用域收窄 → 矩阵/KPI 真变（真重算·非前端假过滤）。
    () => (orderList.length ? { orderIds, frozenOrderIds, scenarios: scenSet, objective: primary, frozenCapacityMode: levers.frozenCapacityMode, method: levers.method, ...(freeLevers.length ? { levers: freeLevers } : {}), ...(btArr.length ? { businessTypes: btArr } : {}), twoStage: true, nonce } : null),
    [orderList.length, orderIds.join(","), frozenOrderIds.join(","), scenSet.join(","), primary, levers.frozenCapacityMode, levers.method, leversKey, btArr.join(","), nonce],
  );
  const res = useLiveSolver<PortResult>("portfolio", args, (raw) => raw as PortResult);
  const d = res.data;
  const adopt = useActionDraft();

  const toggleScen = (k: string) => setScenarios((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  // ③ Hero 产能占用矩阵（基地 × 窗口·从 capacityLedger 派生）。
  const matrix = useMemo(() => {
    if (!d) return null;
    const baseName = new Map<string, string>();
    for (const a of d.allocation) baseName.set(a.base, a.baseName);
    const bases = [...new Set(d.capacityLedger.map((c) => c.baseId))].sort();
    const windows = [...new Set(d.capacityLedger.map((c) => c.window))].sort((a, b) => a - b);
    const cell = new Map<string, { cap: number; allocated: number }>();
    for (const c of d.capacityLedger) cell.set(`${c.baseId}|${c.window}`, { cap: c.cap, allocated: c.allocated });
    return { bases: bases.filter((b) => d.capacityLedger.some((c) => c.baseId === b && c.allocated > 0)), windows, cell, baseName };
  }, [d]);

  // 基地 id→名（分配派生 ∪ BASE_REGISTRY 兜底·补 transfer.toBase 的 Pack 基地名）。
  const baseNameById = useMemo(() => {
    const m = new Map(BASE_NAME_BY_ID);
    for (const a of d?.allocation ?? []) m.set(a.base, a.baseName);
    return m;
  }, [d]);

  // WO-GSLIVE-1-COCKPIT · 活②：候选杠杆自结果**按占用率反推**（瓶颈基地在先·R14 目标自真结果非内联）。
  const leverCandidates = useMemo<LeverCandidate[]>(() => {
    if (!d) return [];
    const utilByBase = new Map<string, number>();
    for (const c of d.capacityLedger) {
      if (c.cap <= 0) continue;
      utilByBase.set(c.baseId, Math.max(utilByBase.get(c.baseId) ?? 0, c.allocated / c.cap));
    }
    const ranked = [...utilByBase.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const keyDefs = [
      { key: "capacityDaily", keyLabel: zh.gslive.leverKeys.capacityDaily },
      { key: "formationChannels", keyLabel: zh.gslive.leverKeys.formationChannels },
    ];
    const out: LeverCandidate[] = [];
    ranked.forEach(([baseId, util], i) => {
      const targetLabel = baseNameById.get(baseId) ?? baseId;
      // 头号瓶颈基地额外出「化成通道」杠杆；其余出「日产能」杠杆。
      for (const k of i === 0 ? keyDefs : keyDefs.slice(0, 1)) {
        out.push({ key: k.key, keyLabel: k.keyLabel, target: baseId, targetLabel, util, step: 1 });
      }
    });
    return out;
  }, [d, baseNameById]);

  const onAdopt = () => {
    if (!d) return;
    // WO-GSIM-5-ACTION：additive 附上 served 订单分配（回灌基线数据源）——执行器据此物化在产 WorkOrder
    // + 跨基地调剂 InterBaseTransfer，使采纳后下一轮联合推演基线真变（G-LOOP-FEEDBACK）。
    const served = d.allocation
      .filter((a) => a.kind === "order" && !a.committed)
      .map((a) => ({ orderId: a.item, base: a.base, baseName: a.baseName, window: a.window, windowStartDay: a.windowStartDay, qty: a.qty, model: a.model }));
    adopt.mutate({ actionTypeKey: "plan_change", payload: { source: "global-sim", objective: primary, servedQty: d.scenarios.find((s) => s.key === primary)?.servedQty ?? 0, displaced: d.displaced.map((x) => x.orderId), summary: d.summary, served } });
  };

  const primaryScen = d?.scenarios.find((s) => s.key === primary) ?? d?.scenarios[0];
  const ontimeRate = primaryScen && primaryScen.servedCount + primaryScen.displacedCount > 0
    ? (primaryScen.objectiveValues.ontime / (primaryScen.servedCount + primaryScen.displacedCount)) * 100 : 0;

  // WO-GSLIVE-1-COCKPIT · 活③：当前推演快照（供方案存/分支·七维 KPI 自主方案 kpi·缺则从 objectiveValues 兜底派生）。
  const getSnapshot = useCallback((): ScenarioSnapshotInput | null => {
    if (!primaryScen || !args) return null;
    const ov = primaryScen.objectiveValues;
    const kpi: GlobalSimSevenDimKpi = primaryScen.kpi ?? {
      ontime: ov.ontime ?? 0, cost: ov.cost ?? 0, changeoverHours: ov.changeover ?? 0,
      freight: 0, fgInv: ov.fgInventory ?? 0, transitInv: 0, margin: 0,
    };
    return {
      label: "", primary, request: args, kpi,
      servedCount: primaryScen.servedCount, displacedCount: primaryScen.displacedCount, ontimeRate,
    };
  }, [primaryScen, args, primary, ontimeRate]);

  // 已提交批次链（WIP committed 分配 = 背景承诺·产能 hold 可视）。
  const committedBatches = useMemo(() => (d?.allocation ?? []).filter((a) => a.committed).sort((a, b) => a.item.localeCompare(b.item)), [d]);

  // ⑥ 权衡解释（primary vs 最低代价·数字红线·只解释不造数）。
  const tradeoff = useMemo(() => {
    if (!d || !primaryScen) return null;
    const cheap = d.scenarios.find((s) => s.key === "min_cost");
    if (!cheap || cheap.key === primary) return null;
    const dCost = primaryScen.objectiveValues.cost - cheap.objectiveValues.cost;
    const dOntime = primaryScen.objectiveValues.ontime - cheap.objectiveValues.ontime;
    const dChg = primaryScen.objectiveValues.changeover - cheap.objectiveValues.changeover;
    return { dCost, dOntime, dChg, cheapCost: cheap.objectiveValues.cost, primCost: primaryScen.objectiveValues.cost };
  }, [d, primaryScen, primary]);

  return (
    <div className={styles.root} data-testid="global-sim">
      {/* ① 顶栏 */}
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h2>全局联合推演 · 决策驾驶舱（全局最优在先）</h2>
          <p>全订单 × 全基地 × 时间共享产能不重复占用 → 一次联合最优。调杠杆 / 勾选订单子集 / 切目标 → 联合最优真变：矩阵、KPI、排产安排、客户影响全链重算。</p>
        </div>
        <span className={styles.badge} title="联合最优在求解器上求可行方案，非数据库既有事实" data-testid="global-sim-badge">推演结果 · 非数据库事实</span>
      </div>

      {/* ① 递进批次会话条（范围 / status / 已提交批次链） */}
      <div className={styles.batchBar} data-testid="global-sim-batchbar">
        <span className={styles.batchScope}>范围：全 {matrix?.bases.length ?? "—"} 基地 × {matrix?.windows.length ?? "—"} 窗（{PORT_WINDOW_DAYS}天/窗）</span>
        <span>主方案：{SCEN_LABEL[primary]}</span>
        <span className={`${styles.batchStatus} ${d && !d.feasible ? styles.bad : ""}`} data-testid="global-sim-feasible">
          {d ? (d.feasible ? "FEASIBLE · 全订单获排" : `${d.status}${d.optimal ? "·可证最优" : ""} · 有被挤单`) : res.isFetching ? "求解中…" : "—"}
        </span>
        <span className={styles.batchChain} data-testid="global-sim-batchchain">
          已提交批次链（产能 hold）：
          {committedBatches.length
            ? committedBatches.slice(0, 8).map((c) => (
                <span key={c.item} className={styles.batchChip} title={provTitle(c.provenance)} data-testid={`global-sim-committed-${c.item}`}>
                  {c.item.replace(/^WIP:/, "")} · {c.baseName}窗{c.window} · {fmt(c.qty, 0)}套
                </span>
              ))
            : <span className={styles.textMuted}>（无在产承诺占用）</span>}
        </span>
      </div>

      {/* WO-W5 · 业务类型勾选筛选（乘/商/储）+ 分口径经营场景（勾选 → 后端在收窄世界真重解·矩阵/KPI 真变） */}
      <div className={styles.glass} data-testid="global-sim-business-type">
        <span className={styles.grpLabel}>[ 业务类型（乘用车 / 商用车 / 储能）· 勾选筛选后联合推演 ]</span>
        <div className={styles.scenPicks} data-testid="global-sim-bt-filter">
          <span className={styles.textMuted} style={{ fontSize: 11 }}>勾选筛选（空 = 全类型）：</span>
          {(["passenger", "commercial", "storage"] as BusinessType[]).map((t) => (
            <label key={t} className={styles.scenChk} data-testid={`global-sim-bt-${t}`}>
              <input type="checkbox" checked={btFilter.has(t)} onChange={() => toggleBt(t)} /> {BUSINESS_TYPE_LABEL[t]}
            </label>
          ))}
          {btFilter.size > 0 && <span className={styles.badge} data-testid="global-sim-bt-active">仅推演：{[...btFilter].map((t) => BUSINESS_TYPE_LABEL[t]).join(" / ")}</span>}
        </div>
        {d?.businessTypeSummary && (
          <table className={styles.gtable} data-testid="global-sim-bt-summary">
            <thead><tr><th>业务类型</th><th style={{ textAlign: "right" }}>产能占用</th><th style={{ textAlign: "right" }}>订单量(套)</th><th style={{ textAlign: "right" }}>预测量(套)</th><th style={{ textAlign: "right" }}>预测缺口</th><th style={{ textAlign: "right" }}>提前交付</th><th style={{ textAlign: "right" }}>订单波动(CV)</th><th style={{ textAlign: "right" }}>实排量</th><th style={{ textAlign: "right" }}>被挤量</th></tr></thead>
            <tbody>
              {d.businessTypeSummary.map((s) => {
                const util = s.capacityUtil;
                const scene = util >= 1 ? "产能不足" : util >= 0.85 ? "≈满载稳" : "产能空闲";
                return (
                  <tr key={s.businessType} data-testid={`global-sim-bt-row-${s.businessType}`}>
                    <td><strong className={styles.textPrimary}>{s.label}</strong></td>
                    <td className={`num ${util >= 1 ? styles.bad : styles.ok}`} data-testid={`global-sim-bt-util-${s.businessType}`} title={scene}>{(util * 100).toFixed(0)}% · {scene}</td>
                    <td className="num">{fmt(s.orderQty, 0)}</td>
                    <td className="num">{fmt(s.forecastQty, 0)}</td>
                    <td className="num" data-testid={`global-sim-bt-gap-${s.businessType}`}>{fmt(s.forecastGap, 0)}</td>
                    <td className="num" data-testid={`global-sim-bt-early-${s.businessType}`}>{s.earlyDeliveryCount}</td>
                    <td className="num" data-testid={`global-sim-bt-cv-${s.businessType}`}>{s.orderQtyCv.toFixed(2)}</td>
                    <td className="num">{fmt(s.allocatedQty, 0)}</td>
                    <td className={`num ${s.displacedQty > 0 ? styles.bad : ""}`}>{fmt(s.displacedQty, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className={styles.summary}>
          乘用车：产能不足 + 销售预测远大于实际订单（预测虚高·缺口最大）+ 部分客户需提前交付 · 商用车：产能空闲 + 订单波动大（CV 最高）· 储能：产能 ~95% 稳定。
          勾选 → 后端只对选中类订单+预测联合重解、产能作用域收窄到该类可产基地（矩阵/KPI/客户级影响全链真变·非展示层过滤）。
        </div>
      </div>

      {/* 活①·人机对话（内嵌 NL 框·compose 路径叙述）——暗发门控：真后端 /b/v1/sim/compose 未落时不渲染(R3·避 404·mock 态 on) */}
      <Feature flag="view.global-sim.live"><GlobalSimNlDock sessionId={sessionId} /></Feature>

      {/* 三栏：② 左轨杠杆盘 · ③ 中央 Hero 热力矩阵 · 右轨配置栈 */}
      <div className={styles.layout3}>
        {/* 左列：② 杠杆盘 + ③ 热力矩阵 纵向堆叠（填满左列·消除与右轨高度失衡留白）·② 杠杆盘含 preset + 活②自由杠杆区 */}
        <div className={styles.leftStack}>
        {/* ② 左轨杠杆盘 */}
        <GlobalSimLevers
          value={levers}
          onChange={setLevers}
          includedCount={includedCount}
          totalCount={orderList.length}
          frozenCount={frozenOrderIds.length}
          pending={res.isFetching}
          freeLevers={freeLevers}
          onFreeLeversChange={setFreeLevers}
          candidates={leverCandidates}
          leverDeltas={d?.leverDeltas ?? []}
        />

        {/* ③ 中央 Hero：产能占用矩阵 + 目标 segmented + 守恒 ✓ */}
        <div className={styles.glass}>
          <span className={styles.grpLabel}>[ 产能占用矩阵 · 基地 × 时间窗 · hover 溯 provenance ]</span>
          <div className={styles.heroTools}>
            <div className={styles.segmented} data-testid="global-sim-objective">
              {ALL_SCENARIOS.map((k) => (
                <button
                  key={k}
                  className={`${styles.segBtn} ${primary === k ? styles.segOn : ""}`}
                  data-testid={`global-sim-obj-${k}`}
                  onClick={() => setPrimary(k)}
                >
                  {SCEN_LABEL[k]}
                </button>
              ))}
            </div>
            <span className={`${styles.miniConserve} ${d && !d.reconciled ? styles.bad : ""}`} data-testid="global-sim-verdict">
              {d ? `${d.optimal ? "✓ 可证最优" : d.status} · 产能台账守恒${d.reconciled ? "通过" : "未通过"}` : res.isFetching ? "求解中…" : "—"}
            </span>
          </div>

          {matrix ? (
            <div className={styles.matrixWrap} data-testid="global-sim-heatmatrix">
              <table className={styles.heatMatrix}>
                <thead>
                  <tr>
                    <th />
                    {matrix.windows.map((w) => <th key={w}>窗{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.bases.map((b) => (
                    <tr key={b}>
                      <td className={styles.rowHead}>{matrix.baseName.get(b) ?? b}</td>
                      {matrix.windows.map((w) => {
                        const c = matrix.cell.get(`${b}|${w}`);
                        const util = c && c.cap > 0 ? c.allocated / c.cap : 0;
                        const full = util >= 0.95;
                        // hover 下钻 provenance（Line 产能 / 该格分配订单 / 满载挤压）。
                        const cellOrders = (d?.allocation ?? []).filter((a) => a.base === b && a.window === w && a.kind === "order");
                        const prov = cellOrders[0]?.provenance;
                        const drillTip = c
                          ? `${matrix.baseName.get(b) ?? b}·窗口${w}：已分配 ${fmt(c.allocated, 0)} / 净产能 ${fmt(c.cap, 0)}（占用 ${(util * 100).toFixed(0)}%）` +
                            (prov ? ` · 溯源 ${prov.drillType}.${prov.drillField}[${prov.drillId}]=${prov.drillValue}` : "") +
                            (cellOrders.length ? ` · 排入 ${cellOrders.map((o) => o.item).join("/")}` : "")
                          : "—";
                        return (
                          <td key={w} className={styles.heatCell} style={{ background: heatColor(util) }}
                            title={drillTip}
                            data-testid={`global-sim-heat-${b}-${w}`} data-util={Math.round(util * 100)}>
                            {c && c.allocated > 0 ? (util * 100).toFixed(0) : ""}
                            {full && <span className={styles.pin} title="满载 · 挤压点（联合求解在此产生被挤单）">满</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.summary}>
                色阶 冷蓝→暖红 按占用率（&lt;50% / &lt;80% / &lt;95% / 满载）· 「满」= 挤压点，联合求解在此产生被挤单（下方客户级影响逐单可溯）· hover 单元溯 Line/Order provenance。
              </div>
            </div>
          ) : (
            <div className={styles.empty}>{res.isFetching ? "求解中…" : "加载订单与产能中…"}</div>
          )}
        </div>
        </div>

        {/* 右轨：磨砂卡① 联合求解配置 + 订单清单三态 */}
        <div>
          <div className={styles.glass}>
            <span className={styles.grpLabel}>[ 联合求解配置 ]</span>

            {/* ⑥ 对比方案（目标切换 = 多方案对比） */}
            <div className={styles.scenPicks} data-testid="global-sim-scens">
              <span className={styles.textMuted} style={{ fontSize: 11 }}>对比方案：</span>
              {ALL_SCENARIOS.map((k) => (
                <label key={k} className={styles.scenChk} data-testid={`global-sim-scen-${k}`}>
                  <input type="checkbox" checked={scenSet.includes(k)} onChange={() => toggleScen(k)} /> {SCEN_LABEL[k]}
                </label>
              ))}
            </div>

            {/* ④ 订单清单三态（参与 ✓ / 固定 🔒 / 排除 ☐） */}
            <div style={{ marginTop: 12, maxHeight: 240, overflow: "auto" }}>
              <table className={styles.gtable} data-testid="global-sim-orders">
                <thead><tr><th>参与/固定/排除</th><th>订单</th><th>客户</th><th>型号</th><th style={{ textAlign: "right" }}>数量(套)</th><th>交期</th></tr></thead>
                <tbody>
                  {orderList.map((o) => {
                    const st = stateOf(o.id);
                    return (
                      <tr key={o.id} data-testid={`global-sim-order-${o.id}`} data-order-state={st}>
                        <td>
                          <span className={styles.triState}>
                            <button className={`${styles.triBtn} ${st === "in" ? styles.triOn : ""}`} title="参与联合求解" data-testid={`global-sim-include-${o.id}`} onClick={() => setState(o.id, "in")}>✓</button>
                            <button className={`${styles.triBtn} ${styles.triFreeze} ${st === "frozen" ? styles.triOn : ""}`} title="固定/冻结（预扣产能·不进决策集）" data-testid={`global-sim-freeze-${o.id}`} onClick={() => setState(o.id, "frozen")}>🔒</button>
                            <button className={`${styles.triBtn} ${styles.triExclude} ${st === "excluded" ? styles.triOn : ""}`} title="排除（移出决策集·不占产能）" data-testid={`global-sim-exclude-${o.id}`} onClick={() => setState(o.id, "excluded")}>☐</button>
                          </span>
                        </td>
                        <td className="mono">{o.id}</td><td>{o.cust}</td><td className="mono">{o.model}</td><td className="num">{fmt(o.qty, 0)}</td><td className="mono">{o.due}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 求解结果读数（KPI 卡） */}
            {d && primaryScen && (
              <>
                <div className={styles.readoutRow} data-testid="global-sim-readout">
                  <div className={styles.readout}><b>{ontimeRate.toFixed(0)}%</b><span>按期率（{SCEN_LABEL[primary]}）</span></div>
                  <div className={styles.readout}><b>{fmt(d.cost.total, 0)}</b><span>总代价</span></div>
                  {/* 换型指标统一走下方 7 维卡「换型(全链小时)」(= round(objectiveValues.changeover)·同值)·此处去重去误导「(分)」旧标签 */}
                  <div className={styles.readout}><b>{primaryScen.displacedCount}</b><span>被挤单</span></div>
                  <div className={styles.readout}><b>{d.frozen.length}</b><span>固定单</span></div>
                </div>

                {/* WO-SURFACE-7DIM · 7 维联合数学读数（电芯-Pack 两阶段网络产物·换型全链小时·毛利代理·kpi 真值·经典响应缺省则不显） */}
                {primaryScen.kpi && (
                  <div className={styles.readoutRow} data-testid="global-sim-gsim-kpi">
                    <div className={styles.readout}><b data-testid="global-sim-kpi-transitinv">{fmt(primaryScen.kpi.transitInv, 0)}</b><span>在途库存(套·天)</span></div>
                    <div className={styles.readout}><b data-testid="global-sim-kpi-changeoverhours">{primaryScen.kpi.changeoverHours.toFixed(1)}</b><span>换型(全链小时)</span></div>
                    <div className={styles.readout}><b data-testid="global-sim-kpi-freight">{fmt(primaryScen.kpi.freight, 0)}</b><span>在途运费</span></div>
                    <div className={styles.readout}><b data-testid="global-sim-kpi-margin">{fmt(primaryScen.kpi.margin, 0)}</b><span>毛利代理</span></div>
                  </div>
                )}

                {/* ⑥ 方案对比矩阵（改目标/杠杆 → 各目标值真漂移） */}
                <span className={styles.grpLabel} style={{ marginTop: 8 }}>[ 方案量化多维比对 ]</span>
                <table className={styles.gtable} data-testid="global-sim-matrix">
                  <thead><tr><th>方案</th><th>获排</th><th>被挤</th><th style={{ textAlign: "right" }}>获排量</th><th style={{ textAlign: "right" }}>按期</th><th style={{ textAlign: "right" }}>延误量</th><th style={{ textAlign: "right" }}>换型</th><th style={{ textAlign: "right" }}>成品库存</th><th style={{ textAlign: "right" }}>代价</th></tr></thead>
                  <tbody>
                    {d.scenarios.map((s) => (
                      <tr key={s.key} data-testid={`global-sim-scen-row-${s.key}`} style={s.key === primary ? { background: "rgba(108,123,246,0.1)" } : undefined}>
                        <td><strong className={styles.textPrimary}>{SCEN_LABEL[s.key] ?? s.key}</strong></td>
                        <td className="num">{s.servedCount}</td><td className="num">{s.displacedCount}</td><td className="num">{fmt(s.servedQty, 0)}</td>
                        <td className="num">{fmt(s.objectiveValues.ontime, 0)}</td><td className="num">{fmt(s.objectiveValues.delay, 0)}</td>
                        <td className="num">{fmt(s.objectiveValues.changeover, 0)}</td><td className="num" data-testid={`global-sim-fginv-${s.key}`}>{fmt(s.objectiveValues.fgInventory, 0)}</td><td className="num">{fmt(s.objectiveValues.cost, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* ⑥ 权衡解释（数字红线·只解释不造数） */}
                {tradeoff && (
                  <div className={styles.tradeoff} data-testid="global-sim-tradeoff">
                    权衡：主方案「{SCEN_LABEL[primary]}」相对「最低代价」——
                    代价 <b>{fmt(tradeoff.primCost, 0)}</b> vs <b>{fmt(tradeoff.cheapCost, 0)}</b>
                    （<span className={tradeoff.dCost > 0 ? styles.tradeoffRed : styles.ok}>{tradeoff.dCost > 0 ? "+" : ""}{fmt(tradeoff.dCost, 0)}</span>）·
                    按期 {tradeoff.dOntime >= 0 ? "+" : ""}{fmt(tradeoff.dOntime, 0)} 单 · 换型 {tradeoff.dChg >= 0 ? "+" : ""}{fmt(tradeoff.dChg, 0)} 分。
                    {tradeoff.dCost > 0 ? "多按期以更高代价换取（数字取自求解器真值·非估算）。" : "当前主方案代价不高于最低代价方案。"}
                  </div>
                )}

                <div className={styles.actions}>
                  <button className={styles.btnPrimary} data-testid="global-sim-solve" disabled={res.isFetching} onClick={() => setNonce((n) => n + 1)}>
                    {res.isFetching ? "求解中…" : "发起联合求解"}
                  </button>
                  <button className={styles.btnGhost} data-testid="global-sim-adopt" disabled={adopt.isPending} onClick={onAdopt} title="采纳 → 生成 plan_change Action 草稿（走 S2 审批·不直改排产真值 R4）">
                    {adopt.isPending ? "生成草稿中…" : "采纳方案（→ Action 审批）"}
                  </button>
                </div>
              </>
            )}
            {res.error ? <div className={styles.noteRed}>求解失败：{String(res.error?.message ?? "")}</div> : null}
          </div>

          {/* 磨砂卡② 被挤单 / 固定单卡（双向下钻） */}
          {d && (
            <div className={styles.glass}>
              <span className={styles.grpLabel}>[ 被挤单 / 固定单 · 进项目推演细排 ]</span>
              <div className={styles.cardGrid} data-testid="global-sim-displaced">
                {d.displaced.length ? d.displaced.map((x) => (
                  <div key={x.orderId} className={`${styles.orderCard} ${styles.displaced}`} data-testid={`global-sim-displaced-${x.orderId}`} title={provTitle(x.provenance)}>
                    <strong>{x.orderId}</strong>（{x.kind === "forecast" ? "预测" : x.kind === "wip" ? "在产" : x.model}）<br />
                    <span className="amt">{fmt(x.qty, 0)}</span> 套 · 未获排
                    <DrillAffordance kind={x.kind} id={x.orderId} label="进项目推演细排 →" testId={`global-sim-drill-${x.orderId}`} prov={x.provenance} />
                  </div>
                )) : <span className={styles.empty}>全部需求项获排（无被挤）</span>}
              </div>

              {d.frozen.length > 0 && (
                <div className={styles.cardGrid} data-testid="global-sim-frozen" style={{ marginTop: 10 }}>
                  {d.frozen.map((f) => (
                    <div key={f.orderId} className={`${styles.orderCard} ${styles.frozen}`} data-testid={`global-sim-frozen-${f.orderId}`}>
                      <strong>{f.orderId}</strong>（固定·产能预扣）<br />{baseNameById.get(f.base) ?? f.base} · 窗口{f.window} · <span className="amt">{fmt(f.qty, 0)}</span> 套
                      <Link className={styles.drillLink} to={`/v/project-sim?order=${encodeURIComponent(f.orderId)}`} data-testid={`global-sim-drill-${f.orderId}`}>进项目推演细排 →</Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ⑤ 排产安排表（电芯段→在途→Pack段·优先消费求解器真 schedule[]·无则回退 InterBaseTransfer JOIN） */}
      {d && (
        <ScheduleTable
          allocation={d.allocation}
          schedule={d.schedule}
          transfers={transfers}
          windowDays={PORT_WINDOW_DAYS}
          forecastStart={PORT_FORECAST_START}
          baseNameById={baseNameById}
        />
      )}

      {/* WO-SURFACE-7DIM · 诚实标注（KILL-MOCK-RED）：本次编排哪些两阶段供给用了 mock 兜底（WO-DATA 未落）；空则不显。 */}
      {d && (d.mockNotes?.length ?? 0) > 0 && (
        <div className={styles.noteRed} data-testid="global-sim-mocknotes">
          诚实标注 · 两阶段网络供给 mock 兜底（WO-DATA 未落 · 真距离/供芯派生见接真收口）：{d.mockNotes!.join("；")}
        </div>
      )}

      {/* 联合分配台账 + 共享产能守恒台账（全宽磨砂卡） */}
      {d && (
        <div className={styles.glass}>
          <span className={styles.grpLabel}>[ 联合分配台账 · 主方案 {SCEN_LABEL[primary]}（基地 × 时间窗 · provenance 悬浮） ]</span>
          <table className={styles.gtable} data-testid="global-sim-alloc">
            <thead><tr><th>需求项</th><th>来源</th><th>基地</th><th>窗口</th><th style={{ textAlign: "right" }}>量(套)</th><th style={{ textAlign: "right" }}>延误(天)</th><th /></tr></thead>
            <tbody>
              {d.allocation.map((a) => (
                <tr key={`${a.item}-${a.base}-${a.window}`} data-testid={`global-sim-alloc-${a.item}`} title={provTitle(a.provenance)}>
                  <td className="mono">{a.item}</td>
                  <td>{a.committed ? "在产承诺" : a.kind === "forecast" ? "预测" : "订单"}</td>
                  <td>{a.baseName}</td><td className="num">{a.window}</td><td className="num">{fmt(a.qty, 0)}</td>
                  <td className={`num ${a.onTime ? styles.ok : styles.bad}`}>{a.onTime ? "按期" : fmt(a.delayDays, 0)}</td>
                  <td><DrillAffordance kind={a.kind} id={a.item} label="细排 →" testId={`global-sim-alloc-drill-${a.item}`} prov={a.provenance} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <span className={styles.grpLabel} style={{ marginTop: 14 }}>[ 共享产能守恒台账 · 逐格 allocated ≤ 净cap · 无重复占用 ]</span>
          <table className={styles.gtable} data-testid="global-sim-ledger">
            <thead><tr><th>基地</th><th>窗口</th><th style={{ textAlign: "right" }}>净产能</th><th style={{ textAlign: "right" }}>已分配</th><th>守恒</th></tr></thead>
            <tbody>
              {d.capacityLedger.filter((c) => c.allocated > 0).map((c) => (
                <tr key={`${c.baseId}-${c.window}`} data-testid={`global-sim-ledger-${c.baseId}-${c.window}`}>
                  <td>{baseNameById.get(c.baseId) ?? c.baseId}</td><td className="num">{c.window}</td><td className="num">{fmt(c.cap, 0)}</td><td className="num">{fmt(c.allocated, 0)}</td>
                  <td className={c.allocated <= c.cap ? styles.ok : styles.bad}>{c.allocated <= c.cap ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.summary} data-testid="global-sim-summary">{d.summary}</div>
        </div>
      )}

      {/* ⑦ 底栏客户级影响（被挤单→真客户名+细分+交付地+影响额·行动占位） */}
      {d && <CustomerImpactBar displaced={d.displaced} orders={orderList} />}

      {/* 活③·方案存 / 分支 / 横比（decision_play 范式）——暗发门控：真后端 /a/v1/sim/scenarios 未落时不渲染(R3·避 404·mock 态 on) */}
      {d && <Feature flag="view.global-sim.live"><GlobalSimScenarioBar getSnapshot={getSnapshot} /></Feature>}

      {/* 迁入：多目标 + 跨对象占用联合 what-if（本是全局能力） */}
      <div className={`${styles.glass} ${styles.migrated}`}>
        <span className={styles.grpLabel}>[ 多目标联合 what-if · 跨对象占用（opt.multiobj） ]</span>
        <MultiObjWhatifPanel />
      </div>
    </div>
  );
}
