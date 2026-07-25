import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BASE_REGISTRY, BUSINESS_TYPE_LABEL } from "@platform/contracts";
import type { GlobalSimScheduleRow, GlobalSimKpi, GlobalSimBusinessTypeSummary, BusinessType, GlobalSimDueComparison, GlobalSimMethodScenario } from "@platform/contracts";
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
  // ④ G-VAR-2·目标 vs 最终可达交期推演；⑤ G-VAR-3·方法旋钮联合方案（求解器真产物·additive）。
  dueComparison?: GlobalSimDueComparison[];
  methodScenario?: GlobalSimMethodScenario;
}

/** ⑤ 方法旋钮目标键（与求解器 objectiveValues 同口径·中文标签）。 */
const OBJ_KNOB_KEYS = ["ontime", "cost", "changeover", "delay", "fgInventory"] as const;
type ObjKnobKey = (typeof OBJ_KNOB_KEYS)[number];
const OBJ_KNOB_LABEL: Record<ObjKnobKey, string> = { ontime: "按期", cost: "代价", changeover: "换型", delay: "延误", fgInventory: "成品库存" };
const METHOD_LABEL2: Record<string, string> = { weighted: "加权", lexicographic: "字典序", epsilon: "ε约束" };

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
// 时间窗天数（每个时间窗 = 多少天）：对齐 datacore portfolio 求解器真实口径——
// windowDays = coeff("windowDays", 14)，仓内无 PUBLISHED `portfolio_optimize_coeffs` 覆盖 → 引擎实跑缺省 14。
// 曾误标 21（"标 21 实跑 14"·与后端求解器不一致·误导用户）→ 校正为 14，令 UI 标注 / 交付日换算与后端同口径
// （KILL-MOCK-RED·不标假口径）。注：mock apps/frontend-shell/src/mocks/simSolvers.ts 仍写死 21（本单只读边界·见回报）。
const PORT_WINDOW_DAYS = 14;    // = datacore portfolio.ts windowDays 缺省口径
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
  const orderList = useMemo(() => (orders.data?.items ?? []).map((o) => {
    // ② G-UI-2·home 基地 = 首个可产基地 id（真数据·非占位）；base 保留原（数组时逗号串·仅回显兜底）。
    const homeBase = Array.isArray(o.props.bases) ? String((o.props.bases as unknown[])[0] ?? "") : String(o.props.bases ?? o.props.base ?? "");
    return { id: String(o.props.so ?? o.id), cust: String(o.props.cust ?? "—"), model: String(o.props.model ?? "—"), qty: Number(o.props.qty ?? 0), due: String(o.props.due ?? "—"), base: String(o.props.bases ?? o.props.base ?? "—"), homeBase, businessType: String(o.props.businessType ?? ""), early: o.props.early === true };
  }), [orders.data]);

  // ② G-UI-2·真 Line 对象（每基地代表产线 = PACK 线·成品下线·非占位）：订单/客户级展开显示 base + line 真数据。
  const linesQ = useQuery({ queryKey: ["a", "objects", { type: "Line", view: "global-sim" }], queryFn: () => searchObjects("Line", ""), retry: false });
  const packLineByBase = useMemo(() => {
    const m = new Map<string, { lineId: string; name: string }>();
    for (const l of linesQ.data?.items ?? []) {
      const baseId = String(l.props.baseId ?? "");
      if (!baseId) continue;
      const lineId = String(l.props.lineId ?? l.id);
      const name = String(l.props.name ?? lineId);
      if (/-pack$/i.test(lineId) || /PACK/i.test(name)) m.set(baseId, { lineId, name }); // PACK 线优先（成品下线）
      else if (!m.has(baseId)) m.set(baseId, { lineId, name }); // 无 PACK 则首条兜底
    }
    return m;
  }, [linesQ.data]);
  // baseKey 可能是拼音 id（changzhou·真 datacore/分配台账）或基地名（常州·mock 订单 bases）→ 两形态互解命中真 Line。
  const lineNameOf = useCallback((baseKey: string): string => {
    const direct = packLineByBase.get(baseKey);
    if (direct) return direct.name;
    const alt = BASE_NAME_BY_ID.has(baseKey) ? BASE_NAME_BY_ID.get(baseKey)! : (BASE_REGISTRY.find((b) => b.name === baseKey)?.baseId ?? "");
    return (alt && packLineByBase.get(alt)?.name) || "—";
  }, [packLineByBase]);

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
  const toggleBt = (t: BusinessType) => setBtFilter((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  // ③ G-VAR-1·分批交付 per-order（集合内单 → 后端按分批重算·交付率/持库真变）。
  const [splitOrders, setSplitOrders] = useState<Set<string>>(new Set());
  const toggleSplit = (id: string) => setSplitOrders((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // ④ G-VAR-2·最终交期 per-order（orderId → 天偏移·空 = 未设）。设值 → 后端放宽最晚窗 + 出目标vs可达差。
  const [finalDueDays, setFinalDueDays] = useState<Record<string, number>>({});
  const setFinalDue = (id: string, v: string) => setFinalDueDays((prev) => {
    const n = { ...prev }; const num = Number(v);
    if (v.trim() === "" || !Number.isFinite(num) || num < 0) delete n[id]; else n[id] = Math.round(num);
    return n;
  });
  // ⑤ G-VAR-3·方法旋钮（加权权重 / ε上界 / 字典序优先·改旋钮 → 后端按对应方法真重解 methodScenario）。
  const [methodWeights, setMethodWeights] = useState<Record<string, number>>({ ontime: 1, cost: 1, changeover: 1, delay: 1, fgInventory: 1 });
  const [epsilonBounds, setEpsilonBounds] = useState<Record<string, number>>({});
  const [priority, setPriority] = useState<string[]>([...OBJ_KNOB_KEYS]);

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
  // ③④⑤ 派生 arg 片段。
  const splitArr = useMemo(() => [...splitOrders].sort(), [splitOrders]);
  const finalDueKey = JSON.stringify(finalDueDays);
  const weightsChanged = OBJ_KNOB_KEYS.some((k) => (methodWeights[k] ?? 1) !== 1);
  const epsArr = useMemo(() => Object.entries(epsilonBounds).filter(([, b]) => Number.isFinite(b)).map(([key, bound]) => ({ key, bound })), [epsilonBounds]);
  // ⑤ 方法旋钮 → arg（weighted 默认未调 → 不携旋钮·护默认路径·不空转触发 methodScenario；调权重/切 ε/字典序 → 携对应旋钮）。
  const methodArg = useMemo<Record<string, unknown>>(() => {
    if (levers.method === "epsilon") return { method: "epsilon", ...(epsArr.length ? { epsilon: epsArr } : {}) };
    if (levers.method === "lexicographic") return { method: "lexicographic", priority };
    return weightsChanged ? { method: "weighted", methodWeights } : { method: "weighted" };
  }, [levers.method, epsArr, priority, weightsChanged, methodWeights]);

  const args = useMemo<Record<string, unknown> | null>(
    // WO-SURFACE-7DIM · twoStage:true → 后端编排路由 globalSimOptimize（返 GlobalSimResponse·7 维 schedule[]/kpi/mockNotes
    // additively 叠加经典 portfolio 字段·驾驶舱既有绑定不掉线）；MSW 态由 handlers 派发 mockGlobalSim（同 additive 形状）。
    // WO-GSLIVE-1-COCKPIT · 活②：freeLevers 非空 → 携真 levers[{key,target,delta}]（引擎已消费）→ leverDeltas before/after。
    // WO-W5 · businessTypes 非空 → 后端只对勾选类订单+预测联合推演·产能作用域收窄 → 矩阵/KPI 真变（真重算·非前端假过滤）。
    // ③④⑤ · splitOrderIds/finalDueDays/方法旋钮 → 后端真重解（分批/交期/方法·交付率/可达交期/objectiveValues 真变）。
    () => (orderList.length ? {
      orderIds, frozenOrderIds, scenarios: scenSet, objective: primary,
      frozenCapacityMode: levers.frozenCapacityMode, ...methodArg,
      ...(freeLevers.length ? { levers: freeLevers } : {}),
      ...(btArr.length ? { businessTypes: btArr } : {}),
      ...(splitArr.length ? { splitOrderIds: splitArr } : {}),
      ...(Object.keys(finalDueDays).length ? { finalDueDays } : {}),
      twoStage: true, nonce,
    } : null),
    [orderList.length, orderIds.join(","), frozenOrderIds.join(","), scenSet.join(","), primary, levers.frozenCapacityMode, JSON.stringify(methodArg), leversKey, btArr.join(","), splitArr.join(","), finalDueKey, nonce],
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
          <h2 title="联合推演（联合求解）：把全部订单、全部基地、各个时间段放在一起统一排产，不是一单一单单独算，而是一次算出全局最划算的方案。">全局联合推演 · 决策驾驶舱（全局最优在先）</h2>
          <p>把所有订单放在一起、在所有基地和时间窗上共享产能、不重复占用 → 一次算出全局最优。调节杠杆 / 勾选订单子集 / 切换目标 → 方案立即重算：产能占用图、KPI、排产安排、客户影响全链联动。</p>
        </div>
        <span className={styles.badge} title="这些数字是算法在满足产能约束下试算出来的最优方案（推演结果），不是数据库里已经发生的既有事实。" data-testid="global-sim-badge">推演结果 · 非数据库事实</span>
      </div>

      {/* ① 递进批次会话条（范围 / status / 已提交批次链） */}
      <div className={styles.batchBar} data-testid="global-sim-batchbar">
        <span className={styles.batchScope} title={`规划期被切成若干个「时间窗」，每个时间窗 ${PORT_WINDOW_DAYS} 天（与后端求解器 windowDays 同口径）；产能占用与交付日都按时间窗结算。`}>范围：全 {matrix?.bases.length ?? "—"} 个基地 × {matrix?.windows.length ?? "—"} 个时间窗（每窗 {PORT_WINDOW_DAYS} 天）</span>
        <span>主方案：{SCEN_LABEL[primary]}</span>
        <span className={`${styles.batchStatus} ${d && !d.feasible ? styles.bad : ""}`} data-testid="global-sim-feasible" title="「可行」= 现有产能下所选订单全部都能排下、没有订单被挤掉；「有被挤单」= 产能不够，部分订单排不下（下方「被挤单」卡逐单可查）。">
          {d ? (d.feasible ? "可行 · 全部订单都排下了" : `${d.status}${d.optimal ? "·可证最优" : ""} · 有被挤单`) : res.isFetching ? "求解中…" : "—"}
        </span>
        <span className={styles.batchChain} data-testid="global-sim-batchchain" title="已在产 / 已排定的订单（在产承诺）会先占住对应基地和时间窗的产能；本轮推演把这部分产能视为已被占用、不再重复分配给别的订单。">
          已排定批次 · 先占产能（在产承诺）：
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
        <span className={styles.grpLabel}>[ 业务类型（{(["passenger", "commercial", "storage"] as BusinessType[]).map((t) => BUSINESS_TYPE_LABEL[t]).join(" / ")}）· 勾选筛选后联合推演 ]</span>
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
          {BUSINESS_TYPE_LABEL.passenger}：产能不足 + 销售预测远大于实际订单（预测虚高·缺口最大）+ 部分客户需提前交付 · {BUSINESS_TYPE_LABEL.commercial}：产能空闲 + 订单波动大（CV 最高）· {BUSINESS_TYPE_LABEL.storage}：产能 ~95% 稳定。
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
          <span className={styles.grpLabel} title="每个格子 = 某基地在某个时间窗的产能占用率（已排产量 ÷ 可用产能）；颜色越暖代表越接近满载。鼠标悬停格子可查看该数字的数据来源（溯源）。">[ 产能占用矩阵 · 基地 × 时间窗 · 悬停格子查看数据来源 ]</span>
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
            <span className={`${styles.miniConserve} ${d && !d.reconciled ? styles.bad : ""}`} data-testid="global-sim-verdict" title="「可证最优」= 算法已从数学上证明这是最好的方案；「产能台账守恒」= 每个基地每个时间窗排下去的量都没超过可用产能、也没有被重复占用（一份产能只算一次）。">
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
                颜色 冷蓝→暖红 表示产能占用率（&lt;50% / &lt;80% / &lt;95% / 满载）·「满」= 产能被排满的挤压点，订单在此被挤下（下方「客户级影响」逐单可查）· 悬停单元格可查看产能 / 订单的数据来源。
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
            <span className={styles.grpLabel} title="联合求解：把下面勾选的订单放在一起、跨所有基地和时间窗统一排产，一次算出全局最划算的方案（不是一单一单单独算）。">[ 联合求解配置 ]</span>

            {/* ⑥ 对比方案（目标切换 = 多方案对比） */}
            <div className={styles.scenPicks} data-testid="global-sim-scens">
              <span className={styles.textMuted} style={{ fontSize: 11 }}>对比方案：</span>
              {ALL_SCENARIOS.map((k) => (
                <label key={k} className={styles.scenChk} data-testid={`global-sim-scen-${k}`}>
                  <input type="checkbox" checked={scenSet.includes(k)} onChange={() => toggleScen(k)} /> {SCEN_LABEL[k]}
                </label>
              ))}
            </div>

            {/* ④ 订单清单三态（参与 ✓ / 固定 🔒 / 排除 ☐）+ ② 基地/产线 + ③ 分批 + ④ 最终交期 */}
            <div style={{ marginTop: 12, maxHeight: 300, overflow: "auto" }}>
              <table className={styles.gtable} data-testid="global-sim-orders">
                <thead><tr><th>参与/固定/排除</th><th>订单</th><th>客户</th><th>型号</th><th style={{ textAlign: "right" }}>数量(套)</th><th>交期</th><th title="② 每订单产出基地（首个可产基地·真数据）">基地</th><th title="② 每订单产线（该基地 PACK 成品线·真 Line 对象·非占位）">产线</th><th title="③ 分批交付：勾选 → 该单按分批联合重解（交付率/成品持库真变）">分批</th><th title="④ 最终交期（自今起天数·放宽最晚可排窗 → 推演目标 vs 最终可达交期差）">最终交期(天)</th></tr></thead>
                <tbody>
                  {orderList.map((o) => {
                    const st = stateOf(o.id);
                    const baseName = (baseNameById.get(o.homeBase) ?? o.homeBase) || "—";
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
                        {/* ② 基地 + 产线（真数据·非占位） */}
                        <td data-testid={`global-sim-order-base-${o.id}`}>{baseName}</td>
                        <td className="mono" data-testid={`global-sim-order-line-${o.id}`} title={`产线 id：${packLineByBase.get(o.homeBase)?.lineId ?? "—"}`}>{lineNameOf(o.homeBase)}</td>
                        {/* ③ 分批交付开关（per-order） */}
                        <td style={{ textAlign: "center" }}>
                          <input type="checkbox" checked={splitOrders.has(o.id)} data-testid={`global-sim-split-${o.id}`} data-split={splitOrders.has(o.id)} title="分批 vs 一次交付" onChange={() => toggleSplit(o.id)} />
                        </td>
                        {/* ④ 最终交期（天·空 = 用目标交期） */}
                        <td>
                          <input type="number" min={0} value={finalDueDays[o.id] ?? ""} placeholder="—" data-testid={`global-sim-finaldue-${o.id}`} onChange={(e) => setFinalDue(o.id, e.target.value)} style={{ width: 64, textAlign: "right" }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ⑤ G-VAR-3 · 方法旋钮（左轨切方法·此处调该法参数 → 后端按对应方法真重解 methodScenario·结果真变） */}
            <div style={{ marginTop: 12 }} data-testid="global-sim-method-knobs" data-method={levers.method}>
              <span className={styles.grpLabel}>[ 求解方法旋钮 · {METHOD_LABEL2[levers.method] ?? levers.method}（改旋钮 → 引擎按对应方法真重解） ]</span>
              <div className={styles.leverHint} style={{ marginBottom: 6 }}>方法在左轨「优先级 · 多目标求解方法」切换；此处调该方法参数 → 下方 methodScenario 联合方案真变（非旋钮空转）。</div>

              {levers.method === "weighted" && (
                <div data-testid="global-sim-method-weighted">
                  {OBJ_KNOB_KEYS.map((k) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ flex: "0 0 76px", fontSize: 12 }}>{OBJ_KNOB_LABEL[k]} 权重</span>
                      <input type="range" min={0} max={10} step={0.5} value={methodWeights[k] ?? 1} data-testid={`global-sim-weight-${k}`} onChange={(e) => setMethodWeights((p) => ({ ...p, [k]: Number(e.target.value) }))} style={{ flex: 1 }} />
                      <span className="mono" style={{ width: 32, textAlign: "right" }} data-testid={`global-sim-weight-val-${k}`}>{(methodWeights[k] ?? 1).toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
              {levers.method === "epsilon" && (
                <div data-testid="global-sim-method-epsilon">
                  <div className={styles.leverHint}>为次目标设上界（收紧 → 主目标让位·分配真变）。空 = 不约束。</div>
                  {(["delay", "changeover", "cost", "fgInventory"] as const).map((k) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ flex: "0 0 76px", fontSize: 12 }}>{OBJ_KNOB_LABEL[k]} ≤</span>
                      <input type="number" min={0} value={epsilonBounds[k] ?? ""} placeholder="不约束" data-testid={`global-sim-epsilon-${k}`} onChange={(e) => setEpsilonBounds((p) => { const n = { ...p }; if (e.target.value.trim() === "") delete n[k]; else n[k] = Number(e.target.value); return n; })} style={{ width: 100, textAlign: "right" }} />
                    </div>
                  ))}
                </div>
              )}
              {levers.method === "lexicographic" && (
                <div data-testid="global-sim-method-lexicographic">
                  <div className={styles.leverHint}>调优先级（上=先·改序 → 分层最优换形）。</div>
                  {priority.map((k, i) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }} data-testid={`global-sim-priority-${k}`} data-rank={i}>
                      <span style={{ flex: 1, fontSize: 12 }}>{i + 1}. {OBJ_KNOB_LABEL[k as ObjKnobKey] ?? k}</span>
                      <button className={styles.segBtn} disabled={i === 0} data-testid={`global-sim-priority-up-${k}`} onClick={() => setPriority((p) => { const n = [...p]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })}>↑</button>
                      <button className={styles.segBtn} disabled={i === priority.length - 1} data-testid={`global-sim-priority-down-${k}`} onClick={() => setPriority((p) => { const n = [...p]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; })}>↓</button>
                    </div>
                  ))}
                </div>
              )}

              {d?.methodScenario && (
                <div className={styles.readoutRow} data-testid="global-sim-methodscenario" data-method={d.methodScenario.method} style={{ marginTop: 8 }}>
                  <div className={styles.readout}><b data-testid="global-sim-ms-served">{d.methodScenario.servedCount}</b><span>方法解·获排</span></div>
                  <div className={styles.readout}><b data-testid="global-sim-ms-ontime">{fmt(d.methodScenario.objectiveValues.ontime ?? 0, 0)}</b><span>按期</span></div>
                  <div className={styles.readout}><b data-testid="global-sim-ms-changeover">{(d.methodScenario.objectiveValues.changeover ?? 0).toFixed(1)}</b><span>换型</span></div>
                  <div className={styles.readout}><b data-testid="global-sim-ms-cost">{fmt(d.methodScenario.objectiveValues.cost ?? 0, 0)}</b><span>代价</span></div>
                </div>
              )}
            </div>

            {/* ④ G-VAR-2 · 目标 vs 最终可达交期推演（真求解产物·仅设了最终交期时出） */}
            {d?.dueComparison && d.dueComparison.length > 0 && (
              <div style={{ marginTop: 12 }} data-testid="global-sim-duecompare">
                <span className={styles.grpLabel}>[ 目标 vs 最终可达交期推演（每订单·真求解·非写死） ]</span>
                <table className={styles.gtable}>
                  <thead><tr><th>订单</th><th style={{ textAlign: "right" }}>目标(天)</th><th style={{ textAlign: "right" }}>最终(天)</th><th style={{ textAlign: "right" }}>可达(天)</th><th style={{ textAlign: "right" }}>差(天)</th><th>达最终</th></tr></thead>
                  <tbody>
                    {d.dueComparison.map((c) => (
                      <tr key={c.orderId} data-testid={`global-sim-duecompare-${c.orderId}`}>
                        <td className="mono">{c.orderId}</td>
                        <td className="num">{c.targetDueDay}</td>
                        <td className="num">{c.finalDueDay ?? "—"}</td>
                        <td className="num" data-testid={`global-sim-achievable-${c.orderId}`}>{c.achievableDay ?? "被挤"}</td>
                        <td className={`num ${(c.gapDays ?? 0) > 0 ? styles.bad : styles.ok}`} data-testid={`global-sim-gap-${c.orderId}`}>{c.gapDays == null ? "—" : c.gapDays > 0 ? `+${c.gapDays}` : c.gapDays}</td>
                        <td className={c.meetsFinal === false ? styles.bad : c.meetsFinal ? styles.ok : ""}>{c.meetsFinal == null ? "—" : c.meetsFinal ? "✓" : "✗"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={styles.summary}>目标交期 = 订单原始交期；可达交期 = 联合求解真实排产交付日（含两阶段在途）；差 = 可达 − 目标（正 = 晚于目标）。设最终交期放宽最晚可排窗 → 引擎在更晚窗真承接（而非被挤）·非写死。</div>
              </div>
            )}

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
                  <button className={styles.btnPrimary} data-testid="global-sim-solve" disabled={res.isFetching} onClick={() => setNonce((n) => n + 1)} title="按当前的杠杆、勾选订单和目标，重新做一次全局联合排产。">
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
          <span className={styles.grpLabel}>[ 联合分配台账 · 主方案 {SCEN_LABEL[primary]}（基地 × 时间窗 · 悬停查看数据来源） ]</span>
          <table className={styles.gtable} data-testid="global-sim-alloc">
            <thead><tr><th>需求项</th><th>来源</th><th>基地</th><th title="② 产线（该基地 PACK 成品线·真 Line 对象）">产线</th><th>窗口</th><th style={{ textAlign: "right" }}>量(套)</th><th style={{ textAlign: "right" }}>延误(天)</th><th /></tr></thead>
            <tbody>
              {d.allocation.map((a) => (
                <tr key={`${a.item}-${a.base}-${a.window}`} data-testid={`global-sim-alloc-${a.item}`} title={provTitle(a.provenance)}>
                  <td className="mono">{a.item}</td>
                  <td>{a.committed ? "在产承诺" : a.kind === "forecast" ? "预测" : "订单"}</td>
                  {/* ② 基地 + 产线（真数据·产线取该基地 PACK 成品线） */}
                  <td>{a.baseName}</td><td className="mono" data-testid={`global-sim-alloc-line-${a.item}`}>{lineNameOf(a.base)}</td><td className="num">{a.window}</td><td className="num">{fmt(a.qty, 0)}</td>
                  <td className={`num ${a.onTime ? styles.ok : styles.bad}`}>{a.onTime ? "按期" : fmt(a.delayDays, 0)}</td>
                  <td><DrillAffordance kind={a.kind} id={a.item} label="细排 →" testId={`global-sim-alloc-drill-${a.item}`} prov={a.provenance} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <span className={styles.grpLabel} style={{ marginTop: 14 }} title="逐格核对：每个基地每个时间窗的「已排产量」都不超过「可用净产能」，确保一份产能只被用一次、没有重复占用。">[ 共享产能守恒台账 · 逐格「已排产量 ≤ 可用产能」· 无重复占用 ]</span>
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

      {/* ⑦ 底栏客户级影响（被挤单→真客户名+细分+交付地+产线+影响额·⑥ 卡 click → 真项目详情·协调加产预览→确认→草稿） */}
      {d && <CustomerImpactBar displaced={d.displaced} orders={orderList} lineNameOf={lineNameOf} sessionId={sessionId} />}

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
