import { Fragment, useCallback, useMemo, useState } from "react";
// 判据 U8 明细面板里的两条**成段诚实位**降进浮层（规范 §1 · `check-ui-first-layer` D2b）。
import { InfoPopover } from "@/components/InfoPopover";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BASE_REGISTRY, BUSINESS_TYPE_LABEL, objectiveHeader } from "@platform/contracts";
import type { GlobalSimScheduleRow, GlobalSimKpi, GlobalSimBusinessTypeSummary, BusinessType, GlobalSimDueComparison, GlobalSimMethodScenario, GlobalSimCost } from "@platform/contracts";
import { composeGlobalSimNarrative, searchObjects, type GlobalSimSevenDimKpi, type SimComposeNarrative } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import { fmt, useActionDraft, ExportReportButton } from "./shared";
import type { ProvenanceReport } from "./exportProvenance";
import { toastError } from "@/store/toastStore";
import { Feature } from "@/workspace/featureGate";
import { RecomputeConfirmDialog } from "@/components/RecomputeConfirmDialog";
// WO-SANDBOX-53CELLS · 判据 U5（结论数字标出处）：本页此前全文无 SnapshotBadge/<Provenance>，
// `provenance` 只出现在类型定义与 hover 的 title= 串里，屏上结论读数一个出处都没有。
import { Provenance } from "@/components/Provenance";
import { useLiveSolver } from "./useLiveSolver";
// WO-U3-DAG-REST · 判据 U3（过程图 + 点节点看凭什么）—— 结构与画法与样板两页同源，
// 见 `reasoningGraph.ts` 头注；本页**不另建**一套。
import { ProcessGraphPanel } from "./ProcessGraphPanel";
// WO-U2-STEPWISE-2 · 判据 U2（分步标口径）。步骤契约**投影自本页同一份 `GS_GRAPH`**，不另写一份。
import { SolverStepBar, useSolverStep } from "./SolverStepBar";
import { assertReasoningGraph, toSolverSteps, type ReasoningGraph } from "./reasoningGraph";
import { MultiObjWhatifPanel } from "./MultiObjWhatifPanel";
import { GlobalSimLevers, type LeverState, type FreeLever, type LeverCandidate, type LeverDeltaVM } from "./GlobalSimLevers";
import { GlobalSimScenarioBar, type ScenarioSnapshotInput } from "./GlobalSimScenarioBar";
import { ScheduleTable, type Transfer } from "./ScheduleTable";
import { CustomerImpactBar } from "./CustomerImpactBar";
import EdgeActivePanel from "./EdgeActivePanel";
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
  // R1 contracts-only-shared：原此处**重定义**了一份 cost 类型且漏了 `unit`（契约 GlobalSimCostSchema 早已含
  // unit，后端/mock 也都在发）→ 前端读不到量纲，总代价只能裸渲染。改为直接引用契约类型（不再各存一份）。
  cost: GlobalSimCost;
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

/**
 * ══ WO-U3-DAG-REST · `global-sim` 推演结构（判据 U3 过程图）══
 *
 * ── 顶回上一单的判定 ──────────────────────────────────────────────────────────
 * `WO-U3-DAG-DESIGN` 判本页「缺**产品裁决**（这页的『过程』是什么没定）」而挂账。
 * 复核后不成立：本页的过程**不用裁决，代码里读得出来** —— 一次 `portfolio` 联合求解，
 * 输出扇出到几块并排面板，**哪块读哪个字段**是写死在本文件里的：
 *  · 热力矩阵 ← `capacityLedger`（`matrix` useMemo 逐格取 cap/allocated）
 *  · 客户级影响 ← `displaced`（`<CustomerImpactBar displaced={d.displaced} …>`）
 *  · 按期率 ← `primaryScen.objectiveValues.ontime ÷ (servedCount + displacedCount)`
 *  · 采纳草案 ← `allocation` 里 `kind==="order" && !committed` 的那批
 * 「过程是什么」= 这张扇出图，不是一个待拍板的产品问题。
 * 形态（铁律 0.6）：**「我用『没人裁决过』当作『没法确定』的证据，而前者并不度量后者。」**
 *
 * ── 这一页凭什么必须画图 ──────────────────────────────────────────────────────
 * 分叉：一次解产出**三个互补切片**（获排 ∥ 被挤 ∥ 产能台账）——
 * 屏上它们分散在矩阵、读数条、底栏三处，看不出是同一次解。
 * 汇合：**按期率的分母同时要获排与被挤**（`servedCount + displacedCount`）——
 * 少看一半就会把「按期率高」读成「排得好」，而它也可能是「大量订单被挤掉之后剩下的都按期」。
 * 这两件事步骤条都表达不了 ⇒ `isLinearChain(GS_GRAPH) === false`。
 */
const GS_GRAPH: ReasoningGraph = assertReasoningGraph({
  layerTitles: ["入参与杠杆", "联合求解", "解的三个面", "读数与结论"],
  nodes: [
    {
      key: "inputs", layer: 0, label: "入参与杠杆", sub: "订单三态 · 目标 · 旋钮",
      data: "orderIds / frozenOrderIds / objective / frozenCapacityMode / method(+weights|priority|epsilon) / levers[]",
      solver: "页面入参 · 未求解",
      rule: "订单三态（参与 ✓ / 固定 🔒 / 排除 ☐）与杠杆全部进求解入参；改任一项 → 参数与结果不一致即置灰，绝不让屏上结果与旁边的参数对不上",
      ruleKind: "projection",
      note: "复算这一屏必须带齐这一整组入参：少一样得到的就是另一份排产。",
    },
    {
      key: "solve", layer: 1, label: "联合求解", sub: "两阶段 · CP-SAT",
      data: "status / feasible / optimal / reconChecks",
      solver: "portfolio（twoStage）",
      rule: "「可证最优」⟺ 求解器证到 OPTIMAL；未证到只报 FEASIBLE，不许把可行解说成最优解",
      ruleKind: "projection",
      note: "结果是算法在产能约束下比较出的优选方案，**不是数据库里已发生的事实**。",
    },
    {
      key: "alloc", layer: 2, label: "获排分配", sub: "排下了的那批",
      data: "allocation[]（item / base / window / qty / delayDays / onTime）",
      solver: "portfolio",
      rule: "逐条带 provenance（drillType/drillId/drillField/drillValue），可下钻到 Line/Order/Material 的真值",
      ruleKind: "projection",
    },
    {
      key: "displaced", layer: 2, label: "被挤订单", sub: "产能排不下的",
      data: "displaced[]（orderId / kind / qty / model / provenance）",
      solver: "portfolio",
      rule: "被挤 = 产能排不下、被联合求解挤出决策集的订单；产能台账守恒（一份产能只算一次）",
      ruleKind: "projection",
    },
    {
      key: "ledger", layer: 2, label: "产能台账", sub: "基地 × 窗口",
      data: "capacityLedger[]（baseId / window / cap / allocated）",
      solver: "portfolio",
      rule: "占用率 = allocated ÷ cap，逐（基地,窗口）格算；cap ≤ 0 的格不参与瓶颈排序（除数为 0 不臆造 100%）",
      ruleKind: "projection",
      formula: "占用率(基地,窗) = allocated ÷ cap",
    },
    {
      key: "ontime", layer: 3, label: "按期率", sub: "获排 ∥ 被挤 两者都要",
      data: "scenarios[primary].objectiveValues.ontime / servedCount / displacedCount",
      solver: "portfolio",
      rule: "按期率 = 该方案按期完成数 ÷（获排单 + 被挤单）——**分母含被挤单**，否则挤掉一半再算按期率必然虚高",
      ruleKind: "projection",
      formula: "按期率 = ontime ÷ (servedCount + displacedCount)",
      note: "这是本图上唯一的汇合点：只看获排那一支会得出一个系统性偏高的数。",
    },
    {
      key: "matrix", layer: 3, label: "占用矩阵", sub: "挤压点在哪",
      data: "由 capacityLedger 派生的 (基地,窗) → {cap, allocated} 映射",
      solver: "portfolio",
      rule: "只画 allocated > 0 的基地列（零占用的基地不占版面，也不冒充「有产能未用」）",
      ruleKind: "projection",
    },
    {
      key: "customer", layer: 3, label: "客户级影响", sub: "谁被挤了",
      data: "displaced[] × 订单台账（客户名 / DemandSegment / 交付地 / 影响额）",
      solver: "portfolio · displaced 联本体对象",
      rule: "客户名与细分取自真对象（非写死）；被挤单逐条落到客户 —— 「被挤 N 单」这个数不对时，先核这张表里哪一单不该被挤",
      ruleKind: "projection",
    },
  ],
  edges: [
    { from: "inputs", to: "solve" },
    // 分叉：一次解的三个互补切片。
    { from: "solve", to: "alloc" },
    { from: "solve", to: "displaced" },
    { from: "solve", to: "ledger" },
    // 汇合：按期率的分母同时要获排与被挤。
    { from: "alloc", to: "ontime" },
    { from: "displaced", to: "ontime" },
    { from: "ledger", to: "matrix" },
    { from: "displaced", to: "customer" },
  ],
});

/**
 * WO-U2-STEPWISE-2 · 判据 **U2** 的步骤契约 —— **投影自 `GS_GRAPH`，不手写第二份**。
 *
 * 四步 = 图的四层：入参与杠杆 → 联合求解 → 解的三个面 → 读数与结论。
 * 第 3 层是**并列层**（获排 ∥ 被挤 ∥ 产能台账，同一次解的三个互补切片），
 * `toSolverSteps` 会如实写「本层 3 个并列环，规则逐环不同 ⇒ 在过程图上点各环看」，
 * **不挑一个节点的规则冒充全层**（有损投影必须写在脸上·见 reasoningGraph.ts 头注）。
 */
const GS_STEPS = toSolverSteps(GS_GRAPH);

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

// WO-OPTIMAL-WORDING · 最优性标注跟求解器自述走（optimal 字段是 sidecar/内存贪心的如实自述，见
// datacore solvers/inproc-optimizer.ts「诚实红线」）：可证最优 ⟺ CP-SAT 证到 OPTIMAL；
// FEASIBLE = 可行但未证最优（内存态确定性贪心恒落此态）——翻成人话，不甩英文状态词上屏。
function optimalityLabel(d: { optimal: boolean; status: string }): string {
  if (d.optimal) return "✓ 可证最优";
  if (d.status === "FEASIBLE") return "可行解 · 未证最优";
  return d.status;
}
const provTitle = (p: Prov) => `溯源 ${p.kind}：${p.drillType}.${p.drillField}[${p.drillId}] = ${p.drillValue}`;
// 时间窗天数（每个时间窗 = 多少天）：对齐 datacore portfolio 求解器真实口径——
// windowDays = coeff("windowDays", 14)，仓内无 PUBLISHED `portfolio_optimize_coeffs` 覆盖 → 引擎实跑缺省 14。
// 曾误标 21（"标 21 实跑 14"·与后端求解器不一致·误导用户）→ 校正为 14，令 UI 标注 / 交付日换算与后端同口径
// （KILL-MOCK-RED·不标假口径）。注：mock apps/frontend-shell/src/mocks/simSolvers.ts 仍写死 21（本单只读边界·见回报）。
const PORT_WINDOW_DAYS = 14;    // = datacore portfolio.ts windowDays 缺省口径
const PORT_FORECAST_START = "2026-06-10"; // 原型 T0（HTML_ORDERS forecastStart·交付日 ISO 锚）
/**
 * D5 · 需二次确认的**离散型** arg 键（开关 / 下拉 / 三态勾选 / 批次增删 / 排序按钮）——
 * 求解在途时改这些 → 弹窗问一句再决定是否取消上一次推演。
 * 故意**不含**滑杆/数字输入等连续控件所改的键（methodWeights 权重滑杆 · epsilon 上界 ·
 * finalDueDays 最终交期 · committedBatches 转拨量滑杆 · twoStage/nonce）：每动一下弹一次框不可用，
 * 连续控件照旧 debounce + 取消前序（D1 并线后取消是真的，本就免费）。
 */
const PORT_CONFIRM_ARG_KEYS = [
  "orderIds", "frozenOrderIds", "scenarios", "objective",
  "frozenCapacityMode", "method", "priority", "levers", "businessTypes", "splitOrderIds",
] as const;
/** 基地 id→名（BASE_REGISTRY 单一来源·R14·补 transfer.toBase 等未在分配中的基地名）。 */
const BASE_NAME_BY_ID = new Map(BASE_REGISTRY.map((b) => [b.baseId, b.name]));

const NON_DRILLABLE_NOTE: Record<string, string> = {
  wip: "在产承诺 · 预扣产能（非可细排订单）",
  forecast: "销售预测需求（未落订单 · 不可细排）",
};
/**
 * ══ 判据 U8「看明细不换页」· 本页此前的病灶就在这个组件里 ═══════════════════════
 *
 * 改前：唯一的下钻手段是 `<Link to="/v/project-sim?order=…">进项目推演细排 →`
 * ——**类名逐字就叫 `drillLink`**，下钻本身是靠跳页实现的。
 * 判据点名的正是这件事：「想看细节 ⇒ 被带走 ⇒ 现场清零」
 * （刚调了一整屏杠杆/场景，跳一次全没了，回来还得重调）。
 *
 * 改后：**两个 affordance 并列，各答各的问题**——
 *  · 「看明细」= 就地展开（`onInspect`，本页内 `OrderDrillPanel`）⇒ 判据要的那一半；
 *  · 「去项目推演页」= **保留**跳页，但明说它是"去做别的事"。判据原文写得很清楚：
 *    「跳去另一张页做别的事（交接/切视角）**不算违反**」——所以这条出口不该删，
 *    删了反而丢功能；错的是"只有它"。
 */
function DrillAffordance({
  kind, id, label, testId, prov, onInspect,
}: { kind: string; id: string; label: string; testId: string; prov?: Prov; onInspect?: (id: string) => void }) {
  if (kind === "order") {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        {onInspect && (
          <button
            type="button"
            className={styles.drillLink}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
            data-testid={`${testId}-inspect`}
            onClick={() => onInspect(id)}
          >
            {label}
          </button>
        )}
        <Link className={styles.drillLink} to={`/v/project-sim?order=${encodeURIComponent(id)}`} data-testid={testId}>
          去项目推演页 ↗
        </Link>
      </span>
    );
  }
  const note = NON_DRILLABLE_NOTE[kind] ?? "非可细排项（非销售订单）";
  return (
    <span
      data-testid={testId}
      data-drill-blocked="true"
      title={prov ? provTitle(prov) : note}
      style={{ fontSize: 12, fontStyle: "italic", color: "var(--muted2, #8a94a6)", whiteSpace: "nowrap" }}
    >
      {note}
    </span>
  );
}

/** `OrderDrillPanel` 要的那几样——全部是**本页已经拿到**的真值，本组件不另调任何接口。 */
export interface OrderDrillInput {
  orderId: string;
  /** 订单台账那一行（`GET /a/v1/objects?type=Order` 投影，见 `orderList`）。查不到 ⇒ null，照实说。 */
  order: { id: string; cust: string; model: string; qty: number; due: string; base: string; businessType: string } | null;
  /** 求解器排产行（`schedule[]` 里 orderId 命中的那一行）。没有 ⇒ null（= 这一单根本没排上）。 */
  row: { packBase: string; packWindow: number; deliverDay: number; transitDays: number; freightCost: number; status: string } | null;
  /** 被挤单那一条（`displaced[]`）。 */
  displaced: { qty: number; kind: string; model?: string } | null;
  /** 固定单那一条（`frozen[]`）。 */
  frozen: { base: string; window: number; qty: number } | null;
  /** 该单落点基地×窗口的产能占用（`capacityLedger` 命中格）——"被谁挤掉的"落在这里。 */
  ledger: { baseId: string; window: number; cap: number; allocated: number } | null;
  baseNameOf: (id: string) => string;
}

/**
 * ══ 判据 U8「看明细不换页」· `global-sim` 的就地明细 ══════════════════════════
 *
 * 判据要的是「点一条结论能**就地**展开明细，不跳走」。本面板因此是**内联展开**
 * （不是路由、不是新页），关掉即恢复原样，杠杆/场景一格不动。
 *
 * ⛔ **每一个数都必须能指到本页已有的真字段**（见 `OrderDrillInput` 逐字段注释）：
 *   订单台账 → `orderList`（真 Order 对象）· 排产 → `schedule[]` · 被挤 → `displaced[]` ·
 *   固定 → `frozen[]` · 产能占用 → `capacityLedger[]`。
 *   取不到的一律**明说"求解器没给"**，不填占位数字 —— 这一页最容易的错法是给被挤单
 *   编一个"预计交付日"，而它恰恰是因为没排上才被挤的。
 *
 * ⛔ 不用 `<details>`：本仓实测闭合态子节点 `getBoundingClientRect()` 仍返回非零旧矩形，
 *   屏上看不见、版面门数上不降，两头落空。折叠一律走行内 `display`（这里是条件渲染）。
 */
function OrderDrillPanel({ input, onClose }: { input: OrderDrillInput; onClose: () => void }) {
  const { orderId, order, row, displaced, frozen, ledger, baseNameOf } = input;
  const rows: { k: string; v: string }[] = [];
  if (order) {
    rows.push({ k: "客户", v: order.cust });
    rows.push({ k: "型号", v: order.model });
    rows.push({ k: "数量", v: `${order.qty} 套` });
    rows.push({ k: "交期", v: order.due });
    rows.push({ k: "归属基地", v: order.base });
    if (order.businessType) rows.push({ k: "业务类型", v: order.businessType });
  }
  if (frozen) {
    rows.push({ k: "固定占位", v: `${baseNameOf(frozen.base)} · 窗口 ${frozen.window} · ${frozen.qty} 套（产能预扣）` });
  }
  if (displaced) {
    rows.push({ k: "被挤量", v: `${displaced.qty} 套 · 未获排` });
  }
  if (row) {
    rows.push({ k: "Pack 落点", v: `${baseNameOf(row.packBase)} · 完工窗 ${row.packWindow}` });
    rows.push({ k: "交付日", v: `第 ${row.deliverDay} 天（含在途 ${row.transitDays} 天）` });
    rows.push({ k: "运费", v: String(row.freightCost) });
    rows.push({ k: "排产状态", v: row.status });
  }
  if (ledger) {
    const util = ledger.cap > 0 ? Math.round((ledger.allocated / ledger.cap) * 100) : null;
    rows.push({
      k: "落点产能",
      v: `${baseNameOf(ledger.baseId)} 窗口 ${ledger.window}：已占 ${ledger.allocated} / 上限 ${ledger.cap}${util != null ? `（${util}%）` : ""}`,
    });
  }
  return (
    <div
      className="panel"
      data-testid="global-sim-drill-panel"
      data-order={orderId}
      style={{ marginTop: 10, borderLeft: "3px solid var(--accent)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <b data-testid="global-sim-drill-panel-title">接单可行性细排 · {orderId}</b>
        <button className="btn sm" style={{ marginLeft: "auto" }} data-testid="global-sim-drill-close" onClick={onClose}>
          收起
        </button>
      </div>
      {rows.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 12px", fontSize: 12.5 }}>
          {rows.map((r) => (
            <Fragment key={r.k}>
              <span style={{ color: "var(--muted2)" }}>{r.k}</span>
              <span data-testid={`global-sim-drill-f-${r.k}`}>{r.v}</span>
            </Fragment>
          ))}
        </div>
      ) : (
        /*
          ⚠ 第一层只留**短结论 + 一个 `?`**，成段解释进浮层（规范 §1 · `check-ui-first-layer` D2b
          咬 ≥24 字的成段说明）。初稿两段话直接摊在第一层，被该门当场咬出
          「第一层长说明串 17 → 19」——**降层不是删除**，记号留在第一层。
        */
        <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="global-sim-drill-empty">
          查不到明细
          <InfoPopover topic="为什么这一单没有明细" testId="global-sim-drill-empty-why">
            <span>这一单在订单台账、排产结果、产能台账里都查不到明细——诚实空态，不编造细排。</span>
          </InfoPopover>
        </div>
      )}
      {/* 诚实位：没排产行 ≠ 数据没取到。两者屏上长得一样、含义完全相反，必须分开说（成段解释在 `?` 里）。 */}
      {!row && (
        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="global-sim-drill-norow">
          无排产行 · 未获排
          <InfoPopover topic="没有 Pack 落点与交付日是怎么回事" testId="global-sim-drill-norow-why">
            <span>
              求解器没有给这一单排产行（schedule[] 里没有它）——所以这里没有 Pack 落点与交付日。
              这不是取数失败，正是「未获排」本身。
            </span>
          </InfoPopover>
        </div>
      )}
    </div>
  );
}

/** 占用率 → 冷暖热力色（低=冷蓝，满=暖红）。半透明语义色阶叠加在 heatCell 上·配 --txt 文字·明暗主题皆可读；
    空占用回退主题感知中性底 var(--hover-tint)（原 rgba(255,255,255,.03) 白 veil 在浅色系不可见）。 */
function heatColor(util: number): string {
  const u = Math.max(0, Math.min(1, util));
  if (u >= 0.95) return "rgba(224,98,108,0.55)";
  if (u >= 0.8) return "rgba(221,149,81,0.45)";
  if (u >= 0.5) return "rgba(210,176,76,0.32)";
  if (u > 0) return `rgba(84,181,196,${0.16 + u * 0.28})`;
  return "var(--hover-tint)";
}

type OrderState = "in" | "frozen" | "excluded";

export default function GlobalSimView(_props: ViewRendererProps) {
  /**
   * 判据 U2 步骤态。**默认末步 = 完整结果**（与改前屏面逐字节一致 ⇒ 存量测试零回归）。
   * `upto(n)` 是本页**唯一分段闸**：下面每一块结果都经它决定渲染与否。
   */
  const { active: gsStep, setActive: setGsStep, upto } = useSolverStep(GS_STEPS.length);
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
  // WO-L3-TRANSFER · L3 耦合联动推演：转拨量滑杆（→ committedBatches 预占目标基地净产能·L3 mapCoupledChainToPortfolio 同 arg）。
  // 拖转拨量 → 目标基地净产能↓ → 该基地他单被挤/延后（交期）+ 联合解残差↑（需外协）·守恒内真传导实时联动（非前端假联动）。
  const [transferBase, setTransferBase] = useState<string>("");
  const [transferWan, setTransferWan] = useState<number>(0); // 转拨量（万套·0 = 不转拨·基线）
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
    // WO-L3-TRANSFER · transferWan>0 且选了目标基地 → 携 committedBatches[{base,qty}]（预占目标基地净产能·L3 同 arg）→
    //   联合解在守恒内真传导（交期/被挤/残差随转拨真变）·转拨=0 即基线（不携·零回归）。
    () => (orderList.length ? {
      orderIds, frozenOrderIds, scenarios: scenSet, objective: primary,
      frozenCapacityMode: levers.frozenCapacityMode, ...methodArg,
      ...(freeLevers.length ? { levers: freeLevers } : {}),
      ...(btArr.length ? { businessTypes: btArr } : {}),
      ...(splitArr.length ? { splitOrderIds: splitArr } : {}),
      ...(Object.keys(finalDueDays).length ? { finalDueDays } : {}),
      ...(transferWan > 0 && transferBase ? { committedBatches: [{ base: transferBase, qty: Math.round(transferWan * 10000) }] } : {}),
      twoStage: true, nonce,
    } : null),
    [orderList.length, orderIds.join(","), frozenOrderIds.join(","), scenSet.join(","), primary, levers.frozenCapacityMode, JSON.stringify(methodArg), leversKey, btArr.join(","), splitArr.join(","), finalDueKey, transferBase, transferWan, nonce],
  );
  const res = useLiveSolver<PortResult>("portfolio", args, (raw) => raw as PortResult, { confirmKeys: PORT_CONFIRM_ARG_KEYS });
  const d = res.data;
  const adopt = useActionDraft();
  // D5 · 结果区与参数不一致时（用户选「否」/主动取消后）置灰 —— 红线：绝不让屏上结果与旁边显示的参数对不上。
  const staleStyle = res.isStale ? { opacity: 0.42, filter: "grayscale(1)" } : undefined;

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

  /**
   * ══ 判据 U8「看明细不换页」· 就地展开的那一单 ═════════════════════════════════
   * `from` 记的是**从哪一块点开的**：面板就渲染在那一块下面（"就地"的字面意思）。
   * 只留一个全局面板、渲染在页尾，点被挤单却要滚到页尾去看，等于换了个方式把人带走。
   */
  const [drill, setDrill] = useState<{ id: string; from: "card" | "alloc" } | null>(null);
  const openDrillCard = useCallback((id: string) => setDrill({ id, from: "card" }), []);
  const openDrillAlloc = useCallback((id: string) => setDrill({ id, from: "alloc" }), []);
  const closeDrill = useCallback(() => setDrill(null), []);

  /**
   * 明细面板的入参装配 —— **只从本页已有的真值里取**，一个字段都不另调接口、不编造。
   * 每一路取不到就给 `null`，由面板显式说"求解器没给"（诚实缺席 ≠ 取数失败）。
   */
  const drillInput = useMemo<OrderDrillInput | null>(() => {
    if (!drill) return null;
    const id = drill.id;
    const order = orderList.find((o) => o.id === id) ?? null;
    const row = (d?.schedule ?? []).find((r) => r.orderId === id) ?? null;
    const dis = (d?.displaced ?? []).find((x) => x.orderId === id) ?? null;
    const frz = (d?.frozen ?? []).find((f) => f.orderId === id) ?? null;
    // 落点格：优先按排产行的 Pack 落点找；没有排产行（= 未获排）就按固定单的占位格找。
    const at = row ? { baseId: row.packBase, window: row.packWindow } : frz ? { baseId: frz.base, window: frz.window } : null;
    const ledger = at ? ((d?.capacityLedger ?? []).find((c) => c.baseId === at.baseId && c.window === at.window) ?? null) : null;
    return {
      orderId: id,
      order: order ? { id: order.id, cust: order.cust, model: order.model, qty: order.qty, due: order.due, base: order.base, businessType: order.businessType } : null,
      row: row ? { packBase: row.packBase, packWindow: row.packWindow, deliverDay: row.deliverDay, transitDays: row.transitDays, freightCost: row.freightCost, status: row.status } : null,
      displaced: dis ? { qty: dis.qty, kind: dis.kind, model: dis.model } : null,
      frozen: frz ? { base: frz.base, window: frz.window, qty: frz.qty } : null,
      ledger,
      baseNameOf: (b: string) => baseNameById.get(b) ?? b,
    };
  }, [drill, orderList, d, baseNameById]);

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

  /**
   * WO-U7-U9-REST · 判据 U9：导出物自带出处与生成时间。
   * 联合解对「目标 + 订单子集 + 冻结集」三者都敏感，少写一样复算出的就是另一份排产 —— 全进 basis。
   */
  const buildReport = (): ProvenanceReport => ({
    docName: "全局项目推演",
    basis: [
      `求解器 portfolio（twoStage 联合求解 · 本体快照 ${res.snapshotVersion ?? "—"} · 同输入同输出）`,
      `主目标：${SCEN_LABEL[primary] ?? primary} · 订单 ${orderIds.length} 单（冻结 ${frozenOrderIds.length} 单）· 场景 ${scenSet.join("/")}`,
    ],
    sections: [
      {
        heading: "结论",
        head: ["项", "值"],
        rows: d
          ? [
              ["判定", d.feasible ? "可行 · 全部订单都排下了" : `${d.status}${d.optimal ? "·可证最优" : ""} · 有被挤单`],
              ["按期率", `${ontimeRate.toFixed(0)}%`],
              ["被挤单量（套）", fmt(displacedQty, 0)],
            ]
          : [],
      },
      {
        heading: "主方案读数",
        head: ["项", "值"],
        rows: primaryScen
          ? [
              ["按期（单）", primaryScen.objectiveValues.ontime],
              ["代价", fmt(primaryScen.objectiveValues.cost)],
              ["换型（小时）", fmt(primaryScen.objectiveValues.changeover)],
            ]
          : [],
      },
    ],
  });

  // WO-L3-TRANSFER · 交期/外协联动读数（联合解真产物·随转拨 committedBatches 在同一次守恒解内实时变）。
  //   需外协残差 = 被挤单量（联合解算不下的量·真残差）；延后单 = 分配里未按期的单（交期传导）。
  const displacedQty = useMemo(() => (d?.displaced ?? []).reduce((s, x) => s + (Number(x.qty) || 0), 0), [d]);
  const delayedAllocCount = useMemo(() => (d?.allocation ?? []).filter((a) => !a.onTime).length, [d]);
  // 转拨目标基地候选（结果 capacityLedger 基地 id·post-solve；基线前 BASE_REGISTRY 兜底·名从单一来源映射）。
  const transferBaseOptions = useMemo(() => {
    const ids = matrix?.bases?.length ? matrix.bases : BASE_REGISTRY.slice(0, 8).map((b) => b.baseId);
    return ids.map((id) => ({ id, name: baseNameById.get(id) ?? BASE_NAME_BY_ID.get(id) ?? id }));
  }, [matrix, baseNameById]);
  const transferBaseName = baseNameById.get(transferBase) ?? BASE_NAME_BY_ID.get(transferBase) ?? transferBase;

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
          <h2 title="接单组合优选：把全部项目（订单）、全部基地、各个时间段放在一起统一排产，一次算出全局更划算的组合——不是一个项目一个项目单独算再拼起来。底层机制仍是一次「联合求解」。">接单组合优选 · 决策驾驶舱（全局优选在先）</h2>
          <p>把所有订单放在一起、在所有基地和时间窗上共享产能、不重复占用 → 一次联合求解，按所选目标（按期 / 延误 / 换型 / 库存 / 成本）在产能约束下比较出优选组合。调节杠杆 / 勾选订单子集 / 切换目标 → 方案立即重算：产能占用图、KPI、排产安排、客户影响全链联动。</p>
        </div>
        <span className={styles.badge} title="这些数字是算法在满足产能约束下、按所选目标比较后给出的优选方案（推演结果），不是数据库里已经发生的既有事实。" data-testid="global-sim-badge">推演结果 · 非数据库事实</span>
        {/* 判据 U9：导出入口（第一层只留按钮 + ? 记号，口径进浮层 —— 共享件统一分层）。 */}
        <ExportReportButton pageKey="global-sim" build={buildReport} />
      </div>

      {/* ── 判据 U2 · 分步推演（步骤态**真正驱动**下面整屏的分段）───────────────────
          摆在读数之前：先说清「这一屏分几步算出来的」，再让用户停在任一步只看那一步的数。
          ⚠ 不是装饰条：点第 N 步 ⇒ 屏上的数只显示到第 N 步为止（闸见各块 `upto(…)`）。 */}
      <div className={styles.glass} data-testid="global-sim-steps-panel">
        <SolverStepBar steps={GS_STEPS} active={gsStep} onSelect={setGsStep} testId="gs-steps" />
        {/* 第 1 步的产物 = 这次联合求解读进去的那一整组入参（少一样得到的就是另一份排产）。 */}
        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="gs-step-inputs">
          主目标 <span className="mono">{primary}</span> · 参与订单{" "}
          <b data-testid="gs-step-inputs-orders">{orderIds.length}</b> 单 · 固定{" "}
          <b data-testid="gs-step-inputs-frozen">{frozenOrderIds.length}</b> 单 · 方法{" "}
          <span className="mono">{levers.method ?? "weighted"}</span> · 固定产能口径{" "}
          <span className="mono">{levers.frozenCapacityMode ?? "reserve"}</span>
        </div>
      </div>

      {/* ① 递进批次会话条（范围 / status / 已提交批次链） */}
      <div className={styles.batchBar} data-testid="global-sim-batchbar">
        <span className={styles.batchScope} title={`规划期被切成若干个「时间窗」，每个时间窗 ${PORT_WINDOW_DAYS} 天（与后端求解器 windowDays 同口径）；产能占用与交付日都按时间窗结算。`}>范围：全 {matrix?.bases.length ?? "—"} 个基地 × {matrix?.windows.length ?? "—"} 个时间窗（每窗 {PORT_WINDOW_DAYS} 天）</span>
        <span>主方案：{SCEN_LABEL[primary]}</span>
        {/* U2 分段闸：可行/最优判定是图上 `solve` 节点（layer 1 = 第 2 步）读的 feasible/optimal/status。 */}
        {upto(2) && (
        <span className={`${styles.batchStatus} ${d && !d.feasible ? styles.bad : ""}`} data-testid="global-sim-feasible" title="「可行」= 现有产能下所选订单全部都能排下、没有订单被挤掉；「有被挤单」= 产能不够，部分订单排不下（下方「被挤单」卡逐单可查）。">
          {d ? (d.feasible ? "可行 · 全部订单都排下了" : `${optimalityLabel(d)} · 有被挤单`) : res.isFetching ? "求解中…" : "—"}
        </span>
        )}
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

      {/* D5 · 二次调参确认（求解在途 + 离散调参才弹；滑杆等连续控件不弹·照旧 debounce + 取消前序） */}
      {res.needsConfirm && (
        <RecomputeConfirmDialog
          elapsedMs={res.elapsedMs}
          what="接单组合优选"
          onConfirm={res.confirmRecompute}
          onKeep={res.keepCurrent}
        />
      )}

      {/* D5 · 结果区旧参数标（用户选「否」/主动取消后）：改动已保留、结果未重算 → 明标 + 一键重算，绝不静默不一致 */}
      {res.isStale && (
        <div
          className={styles.noteRed}
          data-testid="global-sim-stale-banner"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >
          <span>⚠ 参数已改 · 当前结果对应旧参数（你的改动已保留，未被丢弃；下方结果与产能矩阵仍是上一组参数算出来的）。</span>
          <button className={styles.btnPrimary} data-testid="global-sim-stale-recompute" onClick={res.recompute}>
            按新参数重算
          </button>
        </div>
      )}

      {/* WO-W5 · 业务类型勾选筛选（乘/商/储）+ 分口径经营场景（勾选 → 后端在收窄世界真重解·矩阵/KPI 真变） */}
      <div className={styles.glass} data-testid="global-sim-business-type">
        <span className={styles.grpLabel}>[ 业务类型（{(["passenger", "commercial", "storage"] as BusinessType[]).map((t) => BUSINESS_TYPE_LABEL[t]).join(" / ")}）· 勾选筛选后联合推演 ]</span>
        <div className={styles.scenPicks} data-testid="global-sim-bt-filter">
          <span className={styles.textMuted} style={{ fontSize: 12 }}>勾选筛选（空 = 全类型）：</span>
          {(["passenger", "commercial", "storage"] as BusinessType[]).map((t) => (
            <label key={t} className={styles.scenChk} data-testid={`global-sim-bt-${t}`}>
              <input type="checkbox" checked={btFilter.has(t)} onChange={() => toggleBt(t)} /> {BUSINESS_TYPE_LABEL[t]}
            </label>
          ))}
          {btFilter.size > 0 && <span className={styles.badge} data-testid="global-sim-bt-active">仅推演：{[...btFilter].map((t) => BUSINESS_TYPE_LABEL[t]).join(" / ")}</span>}
        </div>
        {d?.businessTypeSummary && (
          <table className={styles.gtable} data-testid="global-sim-bt-summary">
            {/*
              WO-UNIT-MEANING：订单量/预测量本来就带 (套)，同表的 预测缺口/提前交付/实排量/被挤量 却裸奔——
              同一行里「12,000」和「3」量纲不同却都没标，最易误读。单位取自契约字段注释（contracts/global-sim.ts
              `GlobalSimBusinessTypeSummarySchema`：forecastGap/allocatedQty/displacedQty=套，earlyDeliveryCount=订单数）。
              「订单波动(CV)」**故意不加单位**：变异系数 σ/μ 是无量纲比值，列头已点名 CV。
            */}
            <thead><tr><th>业务类型</th><th style={{ textAlign: "right" }}>产能占用</th><th style={{ textAlign: "right" }}>订单量(套)</th><th style={{ textAlign: "right" }}>预测量(套)</th><th style={{ textAlign: "right" }}>预测缺口(套)</th><th style={{ textAlign: "right" }}>提前交付(单)</th><th style={{ textAlign: "right" }}>订单波动(CV·无量纲)</th><th style={{ textAlign: "right" }}>实排量(套)</th><th style={{ textAlign: "right" }}>被挤量(套)</th></tr></thead>
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

      {/* WO-L3-TRANSFER · L3 耦合联动推演：拖转拨量 → 交期 / 需外协 整条链在同一次 portfolio 守恒解内实时联动（非独立测算拼接） */}
      <div className={styles.glass} data-testid="global-sim-l3-transfer">
        <span className={styles.grpLabel} title="转拨量 = 把产能预先划拨、预占某个目标基地的净产能。拖动滑杆：目标基地可用产能减少 → 其它订单被挤下或延后（交期）→ 联合解算不下的量成为真残差（需外协）。三者在同一次守恒求解内联动传导，不是分开算再拼——这正是 L3 耦合联合求解。">
          [ L3 耦合联动推演 · 转拨量 → 交期 / 外协（整条链一次守恒解 · 实时联动） ]
        </span>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }} data-testid="global-sim-transfer-controls">
          <span style={{ fontSize: 12 }}>转入基地（预占其净产能）：</span>
          <select value={transferBase} data-testid="global-sim-transfer-base" onChange={(e) => setTransferBase(e.target.value)} style={{ minWidth: 120 }}>
            <option value="">选择目标基地…</option>
            {transferBaseOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: 12 }}>转拨量：</span>
          <input
            type="range" min={0} max={20} step={0.5} value={transferWan}
            aria-label="转拨量（万套）" data-testid="global-sim-transfer-slider" disabled={!transferBase}
            onChange={(e) => setTransferWan(parseFloat(e.target.value))}
            style={{ flex: "1 1 160px", minWidth: 120 }}
          />
          <b className="mono" data-testid="global-sim-transfer-qty">{transferWan} 万套</b>
          {transferWan > 0 && transferBase && (
            <button className={styles.btnGhost} data-testid="global-sim-transfer-reset" onClick={() => setTransferWan(0)} style={{ fontSize: 12 }}>归零（回基线）</button>
          )}
        </div>

        {/* 三阶段联动读数（转拨 → 交期 → 残差外协·同一次守恒解真产物·随滑杆实时变） */}
        <div className={styles.readoutRow} data-testid="global-sim-transfer-chain">
          <div className={styles.readout}><b data-testid="global-sim-transfer-chain-in">{transferWan}</b><span>① 转拨(万套)→{transferBase ? transferBaseName : "—"}</span></div>
          <div className={styles.readout}><b data-testid="global-sim-transfer-chain-ontime">{d ? `${ontimeRate.toFixed(0)}%` : "—"}</b><span>② 交期·按期率</span></div>
          <div className={styles.readout}><b data-testid="global-sim-transfer-chain-delayed">{d ? delayedAllocCount : "—"}</b><span>② 延后单</span></div>
          <div className={styles.readout}><b data-testid="global-sim-transfer-chain-residual" className={displacedQty > 0 ? styles.bad : styles.ok}>{d ? fmt(displacedQty, 0) : "—"}</b><span>③ 残差→需外协(套)</span></div>
        </div>
        <div className={styles.summary}>
          拖动转拨量 → 目标基地净产能被预占（committedBatches）→ 该基地他单被挤/延后（交期传导）+ 联合解算不下的<b>真残差</b>成为需外协量——全在<b>同一次 portfolio 守恒解</b>内联动求定（Σ 分配 ≤ 净产能·逐格守恒），非独立测算再拼接。残差的外协/加班细分见人机对话「L3 耦合联合求解」路径。
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
          elapsedMs={res.elapsedMs}
          onCancel={res.cancel}
          stale={res.isStale}
          onRecompute={res.recompute}
        />

        {/* ③ 中央 Hero：产能占用矩阵 + 目标 segmented + 守恒 ✓（D5：参数已改未重算 → 置灰，不与旁边参数对不上） */}
        <div className={styles.glass} data-testid="global-sim-hero" data-stale={res.isStale} style={staleStyle}>
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
            {/* U2 分段闸：最优性 + 守恒判定同属图上 `solve` 节点（layer 1 = 第 2 步）。 */}
            {upto(2) && (
            <span className={`${styles.miniConserve} ${d && !d.reconciled ? styles.bad : ""}`} data-testid="global-sim-verdict" title="「可证最优」= 精确求解器已从数学上证明这是最好的方案；「可行解 · 未证最优」= 求解器给出了满足约束的方案、但未证明它是最好的（内存态确定性贪心恒落此态）；「产能台账守恒」= 每个基地每个时间窗排下去的量都没超过可用产能、也没有被重复占用（一份产能只算一次）。">
              {d ? `${optimalityLabel(d)} · 产能台账守恒${d.reconciled ? "通过" : "未通过"}` : res.isFetching ? "求解中…" : "—"}
            </span>
            )}
          </div>

          {/* U2 分段闸：占用矩阵是图上 `matrix` 节点（layer 3 = 第 4 步「读数与结论」），
              由 `capacityLedger`（第 3 步）派生 ⇒ 比台账**晚一步**出。
              ⚠ 闸在**最外层**：停在前几步时连「加载中…」空态也不许出 —— 那句话会把
              「这一步还没算到」说成「在加载」，是两个不同的命题（诚实位）。 */}
          {!upto(4) ? null : matrix ? (
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
                            {/* WO-UNIT-MEANING：格内此前是裸数「87」——同一个量（allocated/cap 产能占用率）在本页
                                「业务类型」表里是带 % 渲染的（上方 global-sim-bt-util），热力格漏了 % 就成了歧义数。
                                量纲同源：占用率 = 已分配/净产能（无 contracts unit 字段，是本页内既有渲染口径）。 */}
                            {c && c.allocated > 0 ? `${(util * 100).toFixed(0)}%` : ""}
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
            <span className={styles.grpLabel} title="联合求解：把下面勾选的订单放在一起、跨所有基地和时间窗统一排产，一次求解、按所选目标比较出更划算的组合（不是一单一单单独算）。">[ 联合求解配置 ]</span>

            {/* ⑥ 对比方案（目标切换 = 多方案对比） */}
            <div className={styles.scenPicks} data-testid="global-sim-scens">
              <span className={styles.textMuted} style={{ fontSize: 12 }}>对比方案：</span>
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
                  <div className={styles.leverHint}>调优先级（上=先·改序 → 分层优选换形）。</div>
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
                  {/* WO-UNIT-MEANING：方法旋钮读数原为裸「按期/换型/代价」无量纲 → 复用同一单位字典单源。 */}
                  <div className={styles.readout}><b data-testid="global-sim-ms-ontime">{fmt(d.methodScenario.objectiveValues.ontime ?? 0, 0)}</b><span>{objectiveHeader("ontime")}</span></div>
                  <div className={styles.readout}><b data-testid="global-sim-ms-changeover">{(d.methodScenario.objectiveValues.changeover ?? 0).toFixed(1)}</b><span>{objectiveHeader("changeover")}</span></div>
                  <div className={styles.readout}><b data-testid="global-sim-ms-cost">{fmt(d.methodScenario.objectiveValues.cost ?? 0, 0)}</b><span>{objectiveHeader("cost")}</span></div>
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

            {/* 判据 U3 · 推演过程图（结果读数**之前**：先说清这一屏是怎么算出来的，再看数）。
                它比下面并排的几块读数多说的那件事：**一次求解的三个面**（获排 / 被挤 / 产能台账）
                是同一次解的互补切片，而按期率**同时**要获排与被挤两个数才算得出来（真汇合）。
                并排摆着的面板看不出这层关系，图上一眼看得出；点任一环 → 面板出该环的来源与规则。 */}
            {d && <ProcessGraphPanel graph={GS_GRAPH} testId="global-sim-process-graph" />}

            {/* 求解结果读数（KPI 卡） */}
            {d && primaryScen && (
              <>
                {/* D5：参数已改未重算 → 结果读数置灰（红线：结果绝不与旁边显示的参数不一致） */}
                {/* U2 分段闸：这一整块是图上 layer 3「读数与结论」（按期率 / 总代价 / 被挤单读数 +
                    方案比对矩阵 + 权衡句）—— 第 4 步才出。 */}
                {upto(4) && (
                <div data-testid="global-sim-results" data-stale={res.isStale} style={staleStyle}>
                {/* ══ 判据 U5「结论数字标出处」 ══
                    改前本页**全文没有一处** `SnapshotBadge`/`<Provenance>`：`provenance` 二字只出现在
                    `interface Prov` 与 hover 的 `title=` 字符串里，屏上的结论读数（按期率/总代价/被挤单）
                    一个出处都没有。判据表因此记「不符合」。
                    ⚠ 这里刻意**不新开第一层信息块**（本文件在 `ui-first-layer` 棘轮里 first=209，只降不升），
                    而是把出处挂到**已有的那几个数字**上 —— `<Provenance>` 是 hover 浮层，计入 deferred。 */}
                <div className={styles.readoutRow} data-testid="global-sim-readout">
                  <div className={styles.readout}>
                    <b>
                      <Provenance
                        testId="gs-ontime"
                        src={`求解器 portfolio${res.snapshotVersion ? ` · 快照 ${res.snapshotVersion}` : ""}`}
                        formula="按期率 = 该方案按期完成数 ÷ (获排单 + 被挤单)"
                        inputs={[`目标：${SCEN_LABEL[primary]}`, `获排 ${primaryScen.servedCount}`, `被挤 ${primaryScen.displacedCount}`]}
                        rule="确定性重算：同一批订单 + 同一组杠杆 + 同一个目标，重解结果逐字节一致"
                        note="联合求解结果 —— 是算法在产能约束下、按所选目标比较出的优选方案，不是数据库里已发生的事实。"
                      >
                        {ontimeRate.toFixed(0)}%
                      </Provenance>
                    </b>
                    <span>按期率（{SCEN_LABEL[primary]}）</span>
                  </div>
                  {/* WO-UNIT-MEANING：后端 portfolio 已下发 cost.unit（"代价单位"=惩罚加权分·非货币），
                      前端此前未读 → 裸数字易被当成"元"。改读后端单源；缺则诚实留空不臆造。 */}
                  <div className={styles.readout}>
                    <b>
                      <Provenance
                        testId="gs-cost"
                        src={`求解器 portfolio · 目标函数${res.snapshotVersion ? ` · 快照 ${res.snapshotVersion}` : ""}`}
                        formula="总代价 = 各目标项按权重加权求和（惩罚分，非货币）"
                        inputs={[`目标：${SCEN_LABEL[primary]}`, ...(d.cost.unit ? [`量纲：${d.cost.unit}`] : [])]}
                        rule="确定性重算：同一批订单 + 同一组杠杆 + 同一个目标，重解结果逐字节一致"
                        note={d.cost.unit ? undefined : "后端本次未下发量纲字段——诚实留空，不臆造成「元」。"}
                      >
                        {fmt(d.cost.total, 0)}
                      </Provenance>
                    </b>
                    <span>总代价{d.cost.unit ? `（${d.cost.unit}·非货币）` : ""}</span>
                  </div>
                  {/* 换型指标统一走下方 7 维卡「换型(全链小时)」(= round(objectiveValues.changeover)·同值)·此处去重去误导「(分)」旧标签 */}
                  <div className={styles.readout}>
                    <b>
                      <Provenance
                        testId="gs-displaced"
                        src={`求解器 portfolio · displaced${res.snapshotVersion ? ` · 快照 ${res.snapshotVersion}` : ""}`}
                        formula="被挤单 = 产能排不下、被联合求解挤出决策集的订单条数"
                        inputs={[`目标：${SCEN_LABEL[primary]}`, `获排 ${primaryScen.servedCount}`]}
                        rule="确定性重算 · 产能台账守恒（一份产能只算一次）"
                        note="逐单在下方「客户级影响」可查——这个数不对时，先核那张表里哪一单不该被挤。"
                      >
                        {primaryScen.displacedCount}
                      </Provenance>
                    </b>
                    <span>被挤单</span>
                  </div>
                  <div className={styles.readout}><b>{d.frozen.length}</b><span>固定单</span></div>
                </div>

                {/* WO-SURFACE-7DIM · 7 维联合数学读数（电芯-Pack 两阶段网络产物·换型全链小时·毛利代理·kpi 真值·经典响应缺省则不显） */}
                {primaryScen.kpi && (
                  <div className={styles.readoutRow} data-testid="global-sim-gsim-kpi">
                    <div className={styles.readout}><b data-testid="global-sim-kpi-transitinv">{fmt(primaryScen.kpi.transitInv, 0)}</b><span>在途库存(套·天)</span></div>
                    <div className={styles.readout}><b data-testid="global-sim-kpi-changeoverhours">{primaryScen.kpi.changeoverHours.toFixed(1)}</b><span>换型(全链小时)</span></div>
                    {/* WO-UNIT-MEANING：运费/毛利代理原为裸整数（不知是元/万元/代价分）→ 标注量纲。 */}
                    <div className={styles.readout}><b data-testid="global-sim-kpi-freight">{fmt(primaryScen.kpi.freight, 0)}</b><span>在途运费(元)</span></div>
                    <div className={styles.readout}><b data-testid="global-sim-kpi-margin">{fmt(primaryScen.kpi.margin, 0)}</b><span>毛利代理(元)</span></div>
                  </div>
                )}

                {/* ⑥ 方案对比矩阵（改目标/杠杆 → 各目标值真漂移） */}
                <span className={styles.grpLabel} style={{ marginTop: 8 }}>[ 方案量化多维比对 ]</span>
                <table className={styles.gtable} data-testid="global-sim-matrix">
                  {/* WO-UNIT-MEANING：列头量纲由 contracts `objectiveHeader` **单源**下发（此前本行内联
                      「(套·天)/(小时)/(代价单位)」——换口径要改多处且易漂移；现改这一处即全站同步·R14 不内联）。 */}
                  <thead><tr><th>方案</th><th>获排(单)</th><th>被挤(单)</th><th style={{ textAlign: "right" }}>获排量(套)</th><th style={{ textAlign: "right" }}>{objectiveHeader("ontime")}</th><th style={{ textAlign: "right" }}>{objectiveHeader("delay")}</th><th style={{ textAlign: "right" }}>{objectiveHeader("changeover")}</th><th style={{ textAlign: "right" }}>{objectiveHeader("fgInventory")}</th><th style={{ textAlign: "right" }}>{objectiveHeader("cost")}</th></tr></thead>
                  <tbody>
                    {d.scenarios.map((s) => (
                      <tr key={s.key} data-testid={`global-sim-scen-row-${s.key}`} style={s.key === primary ? { background: "var(--nav-active-bg)" } : undefined}>
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
                    {/* WO-UNIT-MEANING 真 bug 修：换型口径为**全链小时**（contracts/global-sim.ts:16 单位红线「不残留分钟」·
                        与本页 :720「换型(全链小时)」同源），此处原误标「分」→ 错单位比缺单位更误导，改「小时」。 */}
                    按期 {tradeoff.dOntime >= 0 ? "+" : ""}{fmt(tradeoff.dOntime, 0)} 单 · 换型 {tradeoff.dChg >= 0 ? "+" : ""}{fmt(tradeoff.dChg, 0)} 小时。
                    {tradeoff.dCost > 0 ? "多按期以更高代价换取（数字取自求解器真值·非估算）。" : "当前主方案代价不高于最低代价方案。"}
                  </div>
                )}
                </div>
                )}

                <div className={styles.actions}>
                  <button className={styles.btnPrimary} data-testid="global-sim-solve" disabled={res.isFetching} onClick={() => setNonce((n) => n + 1)} title="按当前的杠杆、勾选订单和目标，重新做一次全局联合排产。">
                    {res.isFetching ? "求解中…" : "发起联合求解"}
                  </button>
                  {/* D5：结果对应旧参数时不许采纳（采纳的必须是屏上参数真算出来的方案·非过期解） */}
                  <button className={styles.btnGhost} data-testid="global-sim-adopt" disabled={adopt.isPending || res.isStale} onClick={onAdopt} title={res.isStale ? "当前结果对应旧参数——请先按新参数重算再采纳" : "采纳 → 生成 plan_change Action 草稿（走 S2 审批·不直改排产真值 R4）"}>
                    {adopt.isPending ? "生成草稿中…" : res.isStale ? "采纳方案（需先重算）" : "采纳方案（→ Action 审批）"}
                  </button>
                </div>
              </>
            )}
            {res.error ? <div className={styles.noteRed}>求解失败：{String(res.error?.message ?? "")}</div> : null}
          </div>

          {/* 磨砂卡② 被挤单 / 固定单卡（双向下钻）。
              U2 分段闸：被挤单是图上 `displaced` 节点（layer 2 = 第 3 步「解的三个面」）。 */}
          {d && upto(3) && (
            <div className={styles.glass}>
              <span className={styles.grpLabel}>[ 被挤单 / 固定单 · 接单可行性细排 ]</span>
              <div className={styles.cardGrid} data-testid="global-sim-displaced">
                {d.displaced.length ? d.displaced.map((x) => (
                  <div key={x.orderId} className={`${styles.orderCard} ${styles.displaced}`} data-testid={`global-sim-displaced-${x.orderId}`} title={provTitle(x.provenance)}>
                    <strong>{x.orderId}</strong>（{x.kind === "forecast" ? "预测" : x.kind === "wip" ? "在产" : x.model}）<br />
                    <span className="amt">{fmt(x.qty, 0)}</span> 套 · 未获排
                    <DrillAffordance kind={x.kind} id={x.orderId} label="看明细" testId={`global-sim-drill-${x.orderId}`} prov={x.provenance} onInspect={openDrillCard} />
                  </div>
                )) : <span className={styles.empty}>全部需求项获排（无被挤）</span>}
              </div>

              {d.frozen.length > 0 && (
                <div className={styles.cardGrid} data-testid="global-sim-frozen" style={{ marginTop: 10 }}>
                  {d.frozen.map((f) => (
                    <div key={f.orderId} className={`${styles.orderCard} ${styles.frozen}`} data-testid={`global-sim-frozen-${f.orderId}`}>
                      <strong>{f.orderId}</strong>（固定·产能预扣）<br />{baseNameById.get(f.base) ?? f.base} · 窗口{f.window} · <span className="amt">{fmt(f.qty, 0)}</span> 套
                      {/* 判据 U8：固定单此前也只有一条 `<Link>` 跳页 —— 同样补就地展开，跳页保留为"去做别的事"的出口。 */}
                      <DrillAffordance kind="order" id={f.orderId} label="看明细" testId={`global-sim-drill-${f.orderId}`} onInspect={openDrillCard} />
                    </div>
                  ))}
                </div>
              )}

              {/* 判据 U8 · **就地**展开：面板渲染在被点那一块的正下方，路由一个字节不动。 */}
              {drillInput && drill?.from === "card" && <OrderDrillPanel input={drillInput} onClose={closeDrill} />}
            </div>
          )}
        </div>
      </div>

      {/* ⑤ 排产安排表（电芯段→在途→Pack段·优先消费求解器真 schedule[]·无则回退 InterBaseTransfer JOIN）。
          U2 分段闸：排产安排逐条来自 `allocation[]` = 图上 `alloc` 节点（layer 2 = 第 3 步）。 */}
      {d && upto(3) && (
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
          {/* §3.3「开发的话不许上屏」：原文印着工单编号「WO-DATA 未落」——那是内部排期，
              用户读了做不了任何决定。诚实位本身（哪些供给用了兜底）一个字没删，只把编号移进本注释。 */}
          诚实标注 · 两阶段网络供给用了兜底数据（真距离 / 供芯派生尚未接真）：{d.mockNotes!.join("；")}
        </div>
      )}

      {/* 联合分配台账 + 共享产能守恒台账（全宽磨砂卡）。
          U2 分段闸：分配台账 = `alloc` 节点、守恒台账 = `ledger` 节点，
          两者同属 layer 2「解的三个面」⇒ 第 3 步出。 */}
      {d && upto(3) && (
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
                  <td><DrillAffordance kind={a.kind} id={a.item} label="看明细" testId={`global-sim-alloc-drill-${a.item}`} prov={a.provenance} onInspect={openDrillAlloc} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 判据 U8 · 台账里点「看明细」也**就地**展开在台账下方，不跳走。 */}
          {drillInput && drill?.from === "alloc" && <OrderDrillPanel input={drillInput} onClose={closeDrill} />}

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
      {/* U2 分段闸：客户级影响是图上 `customer` 节点（layer 3 = 第 4 步「读数与结论」）——
          它由第 3 步的被挤单**再联本体对象**得出，故比被挤单卡晚一步。 */}
      {d && upto(4) && <CustomerImpactBar displaced={d.displaced} orders={orderList} lineNameOf={lineNameOf} sessionId={sessionId} />}

      {/* 活③·方案存 / 分支 / 横比（decision_play 范式）——暗发门控：真后端 /a/v1/sim/scenarios 未落时不渲染(R3·避 404·mock 态 on) */}
      {d && <Feature flag="view.global-sim.live"><GlobalSimScenarioBar getSnapshot={getSnapshot} /></Feature>}

      {/* 迁入：多目标 + 跨对象占用联合 what-if（本是全局能力） */}
      <div className={`${styles.glass} ${styles.migrated}`}>
        <span className={styles.grpLabel}>[ 多目标联合 what-if · 跨对象占用（opt.multiobj） ]</span>
        <MultiObjWhatifPanel />
      </div>
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。 */}
      <EdgeActivePanel pageKey="global-sim" />
    </div>
  );
}
