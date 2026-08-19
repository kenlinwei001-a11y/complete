import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ImpactChange } from "@platform/contracts";
import { fetchObjectTypes, queryObjectsPaged, invokeSolver } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";
import { useDebounced } from "@/lib/useDebounced";
import { InfoPopover } from "@/components/InfoPopover";
// WO-SANDBOX-53CELLS · 判据 U5（结论数字标出处）：本页 deltas 表与影响面计数此前全是裸数字。
import { Provenance } from "@/components/Provenance";
import { SnapshotBadge } from "./sim/shared";
// WO-BEFE-WIRE-3 · 影响传播统一入口（POST /a/v1/simulation/impact-analysis）的**唯一生产调用方**。
// 挂在本页而不是另开一页：这一页的表单（类型/对象/属性/假设值）**就是**那个端点要的 `change`，
// 另造一张页 = 让用户把同一个假设填两遍，且两处口径迟早分家。
import { ImpactAnalysisPanel } from "./sim/ImpactAnalysisPanel";
// WO-U3-DAG-REST · 判据 U3（过程图 + 点节点看凭什么）。结构与画法都与样板两页同源，
// 见 `sim/reasoningGraph.ts` 头注 —— 本页**不另建**一套。
import { ProcessGraphPanel } from "./sim/ProcessGraphPanel";
import { assertReasoningGraph, toSolverSteps, type ReasoningGraph } from "./sim/reasoningGraph";
// WO-U2-STEPWISE-2 · 判据 U2（分步标口径）。步骤契约**投影自本页同一份 `WI_GRAPH`**，
// 不另写一份 —— 两份会漂移，屏上两处对同一环给出两种说法（见 reasoningGraph.ts 头注 RL3）。
import { SolverStepBar, useSolverStep } from "./sim/SolverStepBar";
import EdgeActivePanel from "./sim/EdgeActivePanel";
// WO-HARNESS-UX-GAP-1 · 判据 U7（同屏问答知道自己在哪一页）+ U9（导出物自带出处与生成时间）。
// 本页走 App.tsx 的专用 route，不经 ViewPage ⇒ 必须自己调 usePageView（理由见 shared.tsx 该函数注释）。
import { ExportReportButton, usePageView, useActionDraft } from "./sim/shared";
import { useFeature } from "@/workspace/featureGate";
import type { ProvenanceReport } from "./sim/exportProvenance";

/**
 * 通用假设推演页（renderer=what-if）——把 `generic_inference` 求解器（G-5 通用 what-if）落地为一张交互页：
 *   选对象类型 → 选对象 → 选属性 → 填假设值 → invoke generic_inference → 渲 before/after deltas 表
 *   （受影响对象 + 各派生字段变化）+ 影响面计数。回答 CEO 诉求「把某属性改成 X，下游会怎样」。
 *
 * 契约（grounded·datacore solvers/service.ts genericInference）：
 *   invokeSolver("generic_inference", { apply:[{objectType,objectId,prop,value}] })
 *     → { deltas:[{objId,type,prop,before,after}], rows:[{objectId,...}], affectedObjects:number, count:number, rootTypes:string[] }
 *   不落库（dryRun）· 确定性 R6 · 前向重算下游派生链 before→after。
 *
 * KILL-MOCK 铁律：deltas 表 / 影响面计数 全部从真 invokeSolver 输出渲染，零写死数字——改假设值 → 求解器重算 →
 * deltas 随之变（本页仅忠实投影）。对象/类型列表从真 REST 取（/a/v1/ontology/object-types + /a/v1/objects），不写死。
 * 诚实：求解器返回空 deltas（该属性无下游派生，或改动不引起任何重算）→ 诚实空态，不编造影响。
 */

interface Delta {
  objId: string;
  type: string;
  prop: string;
  before: unknown;
  after: unknown;
}
interface GenericInferenceOutput {
  deltas: Delta[];
  // WO-UNIT-MEANING：逐行量纲由后端取本体 PropertyDef.unit 下发（缺则省略·前端不臆造）。
  rows: { objectId: string; type: string; prop: string; before: unknown; after: unknown; unit?: string }[];
  affectedObjects: number;
  count: number;
  rootTypes: string[];
}

interface TypeProp {
  propKey: string;
  dataType: string;
  isPrimaryKey: boolean;
  unit?: string;
}
interface ObjectType {
  key: string;
  displayName: string;
  domain?: string;
  properties: TypeProp[];
}

/**
 * 屏上这一刻的假设 —— 结果区与「采纳」按钮读的是**同一个对象**，不各存一份。
 * `value` 是给人看的原串（渲染 `assumptionLine` 用），`coerced` 是给机器写的强制类型值
 * （落进 ActionDraft 的 `patch`）；两者同源于一次输入，只是用途不同。
 */
interface Assumption {
  typeKey: string;
  objectId: string;
  prop: string;
  /** 输入框里的原串（展示用） */
  value: string;
  /** 过了 `coerce` 的值（number 属性 → number）—— 落库写的是这个 */
  coerced: unknown;
  /** `prop` 这一格的量纲（本体 PropertyDef.unit·后端下发，缺则无） */
  unit?: string;
  /** 世界里现在的值（纯记录性：与 `coerced` 同一个 propKey，故同轴同量纲） */
  oldValue?: unknown;
}

const fmtVal = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** 数值 before/after → 方向 + 增量（纯投影，非写死；非数值不臆造方向）。 */
function deltaDir(before: unknown, after: unknown): { arrow: string; diff: string; color: string } | null {
  if (typeof before !== "number" || typeof after !== "number" || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  const d = Math.round((after - before) * 1e6) / 1e6;
  if (d === 0) return { arrow: "＝", diff: "0", color: "var(--muted2)" };
  return d > 0
    ? { arrow: "▲", diff: `+${d}`, color: "var(--ok-txt)" }
    : { arrow: "▼", diff: String(d), color: "var(--danger-txt)" };
}

/** 对象展示名：优先 name / 主键值，退回内部 id。 */
function objectLabel(props: Record<string, unknown>, pkKey: string | undefined, id: string): string {
  const name = props.name ?? props.displayName;
  const pk = pkKey ? props[pkKey] : undefined;
  const base = pk != null ? String(pk) : id;
  if (name != null && String(name) !== base) return `${base} · ${String(name)}`;
  return base;
}

/**
 * ══ WO-U3-DAG-REST · `what-if` 推演结构（判据 U3 过程图）══
 *
 * ── 顶回上一单的判定，并给出取证 ──────────────────────────────────────────────
 * `WO-U3-DAG-DESIGN` 判本页「缺**后端派生边**」而挂账。那句话本身**是真的**：
 * `generic_inference` 的输出白名单（`apps/datacore/src/solvers/service.ts` 的
 * `generic_inference: ["deltas","rows","affectedObjects","count","rootTypes"]`）里
 * 确实没有任何「哪个派生字段由哪个派生字段推出」的边 —— 想画一张**数据血缘图**，今天画不出。
 *
 * 但**判据 U3 要的不是数据血缘图，是推演过程图**。样板两页给的就是过程图：
 * `optimize-whatif` 的节点是「入参 / 基线求解 / 扰动后求解 / 比对 / 解读」，
 * 每个节点的 `data` 才是求解器的输出字段名。照铁律 0.6 的句式，上一单的形态是：
 * **「我用『后端没给派生边』当作『这一页画不出推演过程图』的证据，而前者并不度量后者。」**
 *
 * ── 这一页凭什么必须画图（分叉是真的，且是本页最要紧的一件事）──────────────────
 * 同一份假设在本页有**两个出口**，且**互不为输入**：
 *  ① `generic_inference` —— **没有世界**，直接在当前快照上前向重算派生链；
 *  ② `POST /a/v1/simulation/impact-analysis` —— 跑在**被隔离的推演世界**里，四维分项。
 * 两者的世界语义不同 ⇒ **两边的数不可互相印证**。步骤条把并列压成一格就会把这件事抹掉，
 * 而它恰恰是读本页时最容易犯的错（把上下两块的数当成同一次推演的两半）。
 */
const WI_GRAPH: ReasoningGraph = assertReasoningGraph({
  layerTitles: ["设定假设", "两条推演路", "读数", "逐行明细"],
  nodes: [
    {
      key: "assume", layer: 0, label: "设定假设", sub: "类型 · 对象 · 属性 · 值",
      data: "表单四项（objectType / objectId / prop / value）",
      solver: "页面入参 · 未求解",
      rule: "数值属性按 dataType=number 强制转数、其余透传字符串（两个出口共用同一份类型强制）",
      ruleKind: "projection",
      note: "输入即重演：四项任一改动就重算，不需要点任何按钮（判据 U1）。",
    },
    {
      key: "infer", layer: 1, label: "前向重算", sub: "无世界 · 当前快照",
      data: "generic_inference 响应（deltas / rows / affectedObjects / count / rootTypes）",
      solver: "generic_inference",
      rule: "本体派生引擎 recompute(dryRun + apply)：不落库试算，同一假设 + 同一快照重跑逐字节一致",
      ruleKind: "projection",
      note: "这一路**没有推演世界**——它直接在当前快照上算，所以它的数与下面那一路不是同一个世界里的数。",
    },
    {
      key: "propagate", layer: 1, label: "世界隔离传播", sub: "SimSession 世界内",
      data: "impact-analysis 响应（basis.engine / basis.worldOverlayApplied / basis.derivationSpecCount）",
      solver: "POST /a/v1/simulation/impact-analysis",
      rule: "在被隔离的推演世界（worldId = SimSession.id）里传播，四维各按 available 判别联合分档",
      ruleKind: "projection",
      note: "与左边那一路**互不为输入**：两次是两个世界里的两次独立计算，数字对不上不等于引擎不一致。",
    },
    {
      key: "scope", layer: 2, label: "影响面读数", sub: "受影响对象 · 变化处数",
      data: "affectedObjects + count + rootTypes",
      solver: "generic_inference",
      rule: "受影响对象数 = 重算后至少一个派生字段发生变化的对象个数；变化处数 = Σ 各对象上 before ≠ after 的字段条数",
      ruleKind: "projection",
      formula: "受影响对象 = |{ o | ∃p, before(o,p) ≠ after(o,p) }|",
    },
    {
      key: "dims", layer: 2, label: "四维分项", sub: "对象 / 流程 / KPI / 决策",
      data: "affectedObjects / affectedProcesses / affectedKpis / affectedDecisions（各带 count + universe）",
      solver: "POST /a/v1/simulation/impact-analysis",
      rule: "四个「0」不是同一个 0：available:false ⇒ 算不了（不显 0）；count:0 且 universe:0 ⇒ 台账空；count:0 且 universe:N ⇒ 查过确实没被波及",
      ruleKind: "projection",
      note: "流程是**定义**粒度不是实例粒度；决策是从 KPI 推出来的（锚定指标 ∩ 受影响 KPI），不与 KPI 并列。",
    },
    {
      key: "deltas", layer: 3, label: "下游逐行", sub: "before → after",
      data: "rows[]（objectId / type / prop / before / after / unit）",
      solver: "generic_inference",
      rule: "逐行是不同派生字段（产能/天数/比率/金额混排）⇒ 量纲取后端 PropertyDef.unit，后端没给就不显，前端不臆造",
      ruleKind: "projection",
      note: "空 rows 是诚实空态：该属性没有下游派生链，或假设值不改变任何派生结果——不是「算不出来」。",
    },
  ],
  edges: [
    // 分叉：同一份假设喂给两条**世界语义不同**的路。
    { from: "assume", to: "infer" },
    { from: "assume", to: "propagate" },
    { from: "infer", to: "scope" },
    { from: "propagate", to: "dims" },
    // 逐行表是影响面那两个计数的明细（同一路，不跨路）。
    { from: "scope", to: "deltas" },
  ],
});

/**
 * WO-U2-STEPWISE-2 · 判据 **U2** 的步骤契约 —— **投影自 `WI_GRAPH`，不手写第二份**。
 *
 * 四步 = 图的四层：设定假设 → 两条推演路 → 读数 → 逐行明细。
 * 每步的 数据·求解器·规则 逐字来自图上节点（字段名不许改写成白话：字段漂移时引用当场断）。
 * 第 2 层是**并列层**（两条世界语义不同的路），`toSolverSteps` 会如实写「本层 2 个并列环，
 * 规则逐环不同 ⇒ 在过程图上点各环看」——**不挑一个节点的规则冒充全层**。
 */
const WI_STEPS = toSolverSteps(WI_GRAPH);

/*
 * 判据 U1 的输入防抖已提到 `@/lib/useDebounced`（`optimize-whatif` 撤闸时要用同一个行为）。
 * 本文件原有的私有实现逐字节等价，只是换了位置 —— 行为不变，理由见该文件头注。
 */

export default function WhatIfView({ view: _view }: { view?: ViewConfigVM }) {
  usePageView("what-if");
  /**
   * 判据 U2 步骤态。**默认末步 = 完整结果**（与改前屏面逐字节一致 ⇒ 存量测试零回归）。
   * `upto(n)` 是本页**唯一分段闸**：结果区每一段都经它决定渲染与否，
   * 任何段不许自行判断 `active`（绕开 = 步骤条退化成装饰，变异反证也咬不到）。
   */
  const { active: wiStep, setActive: setWiStep, upto } = useSolverStep(WI_STEPS.length);
  const [typeKey, setTypeKey] = useState<string>("");
  const [objectId, setObjectId] = useState<string>("");
  const [prop, setProp] = useState<string>("");
  const [value, setValue] = useState<string>("");

  // 类型列表（真 REST /a/v1/ontology/object-types）——不写死。
  const typesQ = useQuery({
    queryKey: ["a", "what-if", "object-types"],
    queryFn: async () => (await fetchObjectTypes()) as ObjectType[],
    retry: false,
  });
  const types = typesQ.data ?? [];
  const currentType = useMemo(() => types.find((t) => t.key === typeKey), [types, typeKey]);
  const pkKey = useMemo(() => currentType?.properties.find((p) => p.isPrimaryKey)?.propKey, [currentType]);

  // 选定类型的对象列表（真 REST /a/v1/objects?type=）——不写死。
  const objectsQ = useQuery({
    queryKey: ["a", "what-if", "objects", typeKey],
    queryFn: async () => (await queryObjectsPaged(typeKey, 1, 200, {})).items,
    enabled: typeKey !== "",
    retry: false,
  });
  const objects = objectsQ.data ?? [];
  const currentObject = useMemo(() => objects.find((o) => o.id === objectId), [objects, objectId]);
  const currentProp = useMemo(() => currentType?.properties.find((p) => p.propKey === prop), [currentType, prop]);
  const currentValue = currentObject && prop ? currentObject.props[prop] : undefined;

  /**
   * ══ 判据 U1「改输入即重演」——**撤掉提交闸** ══
   *
   * 改前：四个字段填完还要点 `wi-run`，`run()` 命令式调求解器写进 `result` state。
   * 那是判据 U1 逐字点名的那个东西，且它的失败模式最坏：
   * **用户改完假设值不点，屏上还挂着上一次的结果，看起来像是新的**（表格照样在、数字照样漂亮），
   * 除非他记得自己刚改过什么，否则分辨不出。
   *
   * 改后：假设直接进 `queryKey`，改任一字段 → key 变 → 真重调求解器。
   * 「不点按钮结果不更新」这个中间态**结构上不存在了**，不是靠自觉。
   */
  const debouncedValue = useDebounced(value.trim(), 300);
  const assumptionReady = typeKey !== "" && objectId !== "" && prop !== "" && debouncedValue !== "";
  /**
   * 值类型强制（数值属性转 number，其余透传字符串）——**本页唯一一份口径**。
   * 两个出口（自动重演的 `generic_inference` 与下面那个影响传播端点）都调它，
   * 不许各写一遍三元式：两处分家后「同一个假设两处结论对不上」会被读成引擎不一致。
   */
  const coerce = (raw: string): unknown =>
    currentProp?.dataType === "number" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  const coercedValue = coerce(debouncedValue);

  const runQ = useQuery({
    // 假设的每一维都在 key 里：改型号/对象/属性/值任一 → key 变 → 重算（R6 同输入同输出，可缓存）。
    queryKey: ["a", "what-if", "infer", typeKey, objectId, prop, debouncedValue],
    queryFn: async () =>
      (await invokeSolver("generic_inference", { apply: [{ objectType: typeKey, objectId, prop, value: coercedValue }] })) as {
        data: GenericInferenceOutput;
        snapshotVersion: string;
      },
    enabled: assumptionReady,
    retry: false,
  });
  const result = runQ.data?.data ?? null;
  const busy = runQ.isFetching;
  // 值还没落定（用户正在敲）时不许把上一次的结果说成当前假设的结果 —— 那正是 U1 要消灭的那个中间态。
  const settled = debouncedValue === value.trim();

  useEffect(() => {
    if (runQ.isError) toastError(runQ.error);
  }, [runQ.isError, runQ.error]);

  /**
   * WO-BEFE-WIRE-3 · 本页表单 → 影响传播端点要的**那一处变更**。
   *
   * 与下面 `run()` 喂给 `generic_inference` 的 `apply[0]` 是**同一份口径**（含数值属性的类型强制），
   * 不另算一套 —— 两个出口读的必须是同一个假设，否则「两处结论对不上」会被读成引擎不一致。
   * `oldValue` 是**调用方声明的变更前值**，纯记录性：后端不拿它计算，只在与世界里的真实旧值
   * 不一致时回一个 `basis.oldValueMismatch` 标记出来（我们把那个标记显示在第一层）。
   */
  /**
   * ⚠ 这里刻意读**未防抖**的 `value`，不读 `debouncedValue`。
   * 防抖是**自动重演那条路**的限流手段（不加就每敲一键发一次求解）；
   * 这个面板有自己的运行按钮，用户点下去时该拿的是**他此刻屏上看到的那个值**，
   * 晚 300ms 反而会出现「按钮点了、送出去的却是上一个字符」的错位。
   * 类型强制走上面同一个 `coerce`，所以两个出口的**口径**仍是一份，只是**时机**不同。
   */
  const impactChange = useMemo<ImpactChange | null>(() => {
    const raw = value.trim();
    if (typeKey === "" || objectId === "" || prop === "" || raw === "") return null;
    return {
      objectType: typeKey,
      objectId,
      prop,
      value: coerce(raw),
      ...(currentValue === undefined ? {} : { oldValue: currentValue }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, objectId, prop, value, currentProp, currentValue]);

  const onSelectType = (k: string): void => {
    setTypeKey(k);
    setObjectId("");
    setProp("");
    setValue("");
  };

  /**
   * 判据 U9 · 导出物的内容 —— **只搬屏上已有的值，本函数不做任何算术**。
   * 做成函数（点下去才求值）而不是提前算好的对象：用户改完输入没点推演时导出，
   * 拿到的必须是「当前这一屏」的东西，而不是上一次的残留。
   * `basis` 逐条写清「谁算的、算在什么之上」——第三方照这几句能把同样的数再算一遍。
   */
  const buildReport = (): ProvenanceReport => {
    const rows = result?.rows ?? [];
    return {
      docName: "通用假设推演",
      basis: [
        "求解器 generic_inference（前向重算下游派生链·同输入同输出）",
        `假设：${typeKey || "（未选类型）"} / ${objectId || "（未选对象）"} 的 ${prop || "（未选属性）"} 改为 ${value.trim() || "（未填）"}`,
        "不落库试算——真实数据未被改动，导出物反映的是假设世界",
        rows.length === 0 ? "本次尚无推演结果（未运行或该假设无下游影响）" : `受影响对象 ${result?.affectedObjects ?? 0} 个 · 派生字段变化 ${result?.count ?? 0} 处`,
      ],
      sections: [
        {
          heading: "下游 before → after",
          head: ["对象", "类型", "派生字段", "before", "after", "量纲"],
          rows: rows.map((r) => [r.objectId, r.type, r.prop, fmtVal(r.before), fmtVal(r.after), r.unit ?? "—"]),
        },
      ],
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="what-if">
      {/* ── 说明 ── */}
      <div className="panel" data-testid="wi-intro">
        <div className="section-title">
          通用假设推演 · 把某属性改成 X，看下游怎样
          {/* 「这一页怎么用」是一整句操作说明 —— 按规范 §1 它既不是数值、也不是状态、也不是名字，
              降进 `?` 浮层，原文一字未删。 */}
          <InfoPopover topic={zh.whatIf.info.howItWorks} testId="wi-intro-how">
            <span data-testid="wi-intro-how-body">
              选一个对象、改它的某个属性到假设值 → 前向重算下游派生链，给出 before / after 变化与影响面。
            </span>
          </InfoPopover>
          <ExportReportButton pageKey="what-if" build={buildReport} />
        </div>
        {/* 「不落库」这条**留第一层**（规范 §4.2）：它若为真，用户对下面所有读数的解读完全不同 ——
            不看它，这一页会被当成真的改了数据。破坏性/写入语义的诚实位不降层。 */}
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          <b>不落库、确定性</b>——纯试算，不改真实数据。
        </div>
      </div>

      {/* ── 假设输入区 ── */}
      <div className="panel" data-testid="wi-form">
        <div className="section-title">① 设定假设</div>
        {typesQ.isLoading ? (
          <div className="empty-state" style={{ padding: 16, fontSize: 12 }}>{zh.common.loading}</div>
        ) : types.length === 0 ? (
          <div className="empty-state" data-testid="wi-no-types" style={{ padding: 16, fontSize: 12 }}>
            暂无已发布对象类型——无可推演对象。
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
            {/* 对象类型 */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>对象类型</span>
              <select className="input" data-testid="wi-type-select" value={typeKey} onChange={(e) => onSelectType(e.target.value)}>
                <option value="">选择类型…</option>
                {types.map((t) => (
                  <option key={t.key} value={t.key}>{t.displayName}（{t.key}）</option>
                ))}
              </select>
            </label>

            {/* 对象 */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>对象{objectsQ.isFetching ? "（加载中…）" : ""}</span>
              <select
                className="input"
                data-testid="wi-object-select"
                value={objectId}
                disabled={typeKey === "" || objects.length === 0}
                onChange={(e) => setObjectId(e.target.value)}
              >
                <option value="">{objects.length === 0 && typeKey !== "" && !objectsQ.isFetching ? "该类型暂无对象" : "选择对象…"}</option>
                {objects.map((o) => (
                  <option key={o.id} value={o.id}>{objectLabel(o.props, pkKey, o.id)}</option>
                ))}
              </select>
            </label>

            {/* 属性 */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>属性</span>
              <select
                className="input"
                data-testid="wi-prop-select"
                value={prop}
                disabled={!currentType}
                onChange={(e) => setProp(e.target.value)}
              >
                <option value="">选择属性…</option>
                {(currentType?.properties ?? []).map((p) => (
                  <option key={p.propKey} value={p.propKey}>
                    {p.propKey}（{p.dataType}{p.unit ? ` · ${p.unit}` : ""}）
                  </option>
                ))}
              </select>
            </label>

            {/* 假设值 */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>
                假设值
                {currentValue !== undefined ? <span style={{ color: "var(--muted2)" }}>（当前 {fmtVal(currentValue)}{currentProp?.unit ?? ""}）</span> : null}
              </span>
              <input
                className="input"
                data-testid="wi-value-input"
                type={currentProp?.dataType === "number" ? "number" : "text"}
                value={value}
                disabled={prop === ""}
                placeholder={currentValue !== undefined ? fmtVal(currentValue) : "填假设值…"}
                onChange={(e) => { setValue(e.target.value); }}
              />
            </label>

            {/* 判据 U1：这里**不再有提交闸**。留的是一个**状态记号**（在算 / 已按当前假设算出），
                不是按钮 —— 它不控制任何东西，只回答「我现在看到的是不是刚才那个假设的结果」。 */}
            <div style={{ fontSize: 12, color: "var(--muted)", paddingBottom: 6 }} data-testid="wi-live-state">
              {!assumptionReady
                ? "填完四项即自动推演"
                : busy || !settled
                  ? "推演中…"
                  : "已按当前假设推演（改任一项即重演，无需点按钮）"}
            </div>
          </div>
        )}
      </div>

      {/* ── 判据 U2 · 分步推演（步骤态**真正驱动**下面结果区的分段）───────────────
          ⚠ 它不是装饰条：点第 N 步 ⇒ 屏上的数只显示到第 N 步为止（闸见各段 `upto(…)`）。 */}
      <div className="panel" data-testid="wi-steps-panel">
        <SolverStepBar steps={WI_STEPS} active={wiStep} onSelect={setWiStep} testId="wi-steps" />
        {/* 第 1 步的产物 = 这次推演读进去的那份假设（入参回执，真值回显，不是重复表单）。 */}
        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="wi-step-inputs">
          假设 · <span className="mono">{typeKey || "—"}</span> / <span className="mono">{objectId || "—"}</span>
          <span> 的 </span>
          <span className="mono">{prop || "—"}</span> = <span className="mono">{value.trim() || "—"}</span>
          {currentValue === undefined ? null : <span>（原值 <span className="mono">{fmtVal(currentValue)}</span>）</span>}
        </div>
        {/* 第 2 步的产物 = 两条路各自的**求解基准**（谁算的 · 算在什么之上）。
            ⚠ 只写这一步真拿得到的东西：`snapshotVersion` 是 `generic_inference` 的后端真回执；
            第二条路的读数在第 3 步才出（它的面板此刻还没挂），故这里**只报它的求解器与世界语义，不报结果**。 */}
        {upto(2) && (
          <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 4 }} data-testid="wi-step-solve">
            <span className="mono">generic_inference</span> · 快照{" "}
            <span className="mono" data-testid="wi-step-solve-snapshot">{runQ.data?.snapshotVersion ?? "—"}</span>
            <span> · 无世界（当前快照上前向重算）</span>
            <span> ∥ </span>
            <span className="mono">impact-analysis</span>
            <span> · 世界隔离（两条路互不为输入）</span>
          </div>
        )}
      </div>

      {/* ── 判据 U3 · 推演过程图 ──────────────────────────────────────────────
          摆在两个出口**之间**：往上是假设，往下是两条路各自的读数。
          它比上下两块多说的那件事：两条路**世界语义不同、互不为输入** ——
          屏上两块面板并排摆着，看不出这层关系，图上一眼看得出（点任一环看它凭什么）。 */}
      <ProcessGraphPanel graph={WI_GRAPH} testId="wi-process-graph" />

      {/* ── 同一份假设的**第二个出口**：跑在被隔离的推演世界里，四维分项（WO-BEFE-WIRE-3）──
          上面那个按钮走 `generic_inference`（无世界、单个裸计数）；这里走
          `POST /a/v1/simulation/impact-analysis`（世界隔离 + 对象/流程/决策/KPI 四维 + 诚实标记）。
          两个出口共用上面同一张表单 —— 用户不必把假设填两遍。 */}
      {/* U2 分段闸：这个面板给的是**第 3 步「读数」**那一层的数（四维分项 = 图上 `dims` 节点，layer 2）。
          停在第 1/2 步时它整块退场 —— 那两步还没算到「读数」这一层。 */}
      {upto(3) && (
      <div className="panel" data-testid="wi-impact-panel">
        {/* 标题只留**名字**；括号里那串「世界隔离 · 四维分项」说的是这一格**怎么算的**，
            是口径不是名字（规范 §1 / R-UI-3）—— 连同「跟上面那个按钮差在哪」一起降浮层。 */}
        <div className="section-title">
          ① b 在推演世界里分析影响
          <InfoPopover topic={zh.whatIf.info.impactWorld} testId="wi-impact-world">
            <span data-testid="wi-impact-world-body">
              世界隔离 · 四维分项：上面那个按钮走 generic_inference（无世界、单个裸计数）；
              这一格跑在被隔离的推演世界里，给对象 / 流程 / 决策 / KPI 四维分项 + 诚实标记。
              两个出口共用同一张表单，假设不必填两遍。
            </span>
          </InfoPopover>
        </div>
        <ImpactAnalysisPanel change={impactChange} />
      </div>
      )}

      {/* ── 结果区 ── */}
      {assumptionReady && settled && result ? (
        <WhatIfResult
          out={result}
          snapshotVersion={runQ.data?.snapshotVersion}
          assumption={{
            typeKey,
            objectId,
            prop,
            value: debouncedValue,
            // ⚠ 采纳那条路要写进 `patch` 的是**强制过类型的**值，不是输入框里那串字符：
            // `patch: { 转速: "1200" }` 会把一个数值属性写成字符串，之后所有派生算术当场变 NaN。
            // 复用页内**同一份** `coerce`（上面那条自动重演的路也用它）—— 两条出口口径分家，
            // 就会出现「屏上算的是数、落库落的是串」这种屏上看不出来的错。
            coerced: coercedValue,
            // 量纲：取本体 PropertyDef.unit（后端下发·缺则 undefined，前端不臆造）。
            // 它与 `patch` 写进去的那个属性是**同一个 propKey**，所以屏上标的量纲就是落库那一格的量纲。
            unit: currentProp?.unit,
            oldValue: currentValue,
          }}
          // WO-U2-STEPWISE-2 · 判据 U2 分段闸（唯一出处 = `useSolverStep.upto`）。
          upto={upto}
        />
      ) : null}

      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。
          ⚠ 必须挂在**主组件**里、且不进 `ran && result` 那个条件：挂进结果区 = 没跑过推演就看不见开关，
          而"先关掉一条边再看结果"恰恰是最常见的用法（本单初稿真踩过这一下，收编前自查抓出）。 */}
      <EdgeActivePanel pageKey="what-if" />
    </div>
  );
}

/**
 * ══ 判据 U6「结论即动作」· 采纳该假设 → `对象数据变更` ActionDraft ══
 *
 * ── 为什么是 `对象数据变更`，而不是新造一个动作类型（先追一层再动手）──────────────
 * 这一页的假设**形状**就是 `对象数据变更` 的 payload 形状，一一对上，没有翻译层：
 *   屏上「把 `<对象>` 的 `<属性>` 改成 `<值>`」 ≡ `{ objectId, patch: { [prop]: value } }`
 *   （后端 `app.ts` 该分支：合并进 `obj.props` → `origin: MANUAL` → `runDerivations()`）。
 * 而这一页此前**唯一缺的就是这条路**：屏上第一层写着「不落库、纯试算」——那句话是真的，
 * 但它同时意味着用户看完 before/after 之后**无处可去**，只能记下参数换一张页面重填一遍。
 * R4「真值经 Action」已经规定了对象写入只有审批这一条路；本按钮接的正是那条既有的路。
 *
 * ── ⚠ 顶回 §5/§5.2 登记的那条「备裁」理由（照铁律 0.5 追了一层，实测不成立）────────
 * 原文（`docs/PRD-harness-ux-adoption.md` §5:1153）写：这四页是「**净室通用页（与租户本体无关）**」，
 * 硬补会造出「在一个通用假设页上生成**全租户** Action」。**前半句在本页上是错的**：
 * 本页的类型列表来自 `GET /a/v1/ontology/object-types`、对象列表来自 `GET /a/v1/objects?type=`，
 * 两个都是**该租户自己的本体与真对象**（`ctx(req)` 逐请求取 tenantId）——
 * 「页面是通用实现」与「数据与租户无关」是两件事，前者不度量后者。
 * 后半句的担心也已有现成的门挡着，不需要靠「不做」来防：
 *   · `POST /a/v1/action-drafts` 走 `ctx(req)`，草稿天然落在发起人自己的租户里（R2）；
 *   · `assertObjectPatchWritable` 在**建草稿时**就逐属性过 A6 列级 authz，命中不可写属性直接 403
 *     `PROPERTY_FORBIDDEN`、草稿根本不创建；执行期 `assertDraftPatchWritableAtExecute` 再复校一次
 *     （堵「先建草稿、后收紧策略」的时间窗）。
 * 所以本页这一格不是「产品裁决」，是一条**没接的线**。另三页的情况与本页不同，见交单报告。
 *
 * ── 反 `G-ACTION-NOOP-EXEC`（空 payload 假绿）────────────────────────────────
 * `patch` 里那一格**就是用户选的那个 propKey、填的那个值**（过同一份 `coerce`），
 * 不是空表单、不是重填、不是只带一句结论文案的空壳。接缝断言见
 * `test/wo-u6-what-if-adopt.test.tsx`（前端半：payload 逐字段 = 屏上那份）与
 * `apps/datacore/test/action-adopt-hypothesis.seam.test.ts`（后端半：审批后**换一条路**读回对象，
 * 属性真的变了 + 派生真的重算了）。
 */
function AdoptHypothesisButton({
  assumption,
  out,
  snapshotVersion,
  assumptionLine,
}: {
  assumption: Assumption;
  out: GenericInferenceOutput;
  snapshotVersion?: string;
  assumptionLine: string;
}) {
  const canAdopt = useFeature("act.adopt-to-draft");
  const adopt = useActionDraft();
  if (!canAdopt) return null;
  const unitTxt = assumption.unit ? ` ${assumption.unit}` : "";
  const onAdopt = (): void => {
    adopt.mutate({
      actionTypeKey: "对象数据变更",
      payload: {
        source: "what-if",
        objectType: assumption.typeKey,
        objectId: assumption.objectId,
        // ★ 结论带过去的那一格：键 = 用户选的 propKey，值 = 用户填的假设值（已过 coerce）。
        //   量纲 = `propUnit`（同一个 propKey 的本体量纲）—— 写进去的那一格和屏上标的那一格是同一格。
        patch: { [assumption.prop]: assumption.coerced },
        /** `patch` 里那唯一一格的量纲（本体 PropertyDef.unit）；无量纲属性则不下发，不臆造。 */
        ...(assumption.unit ? { propUnit: assumption.unit } : {}),
        /** 变更前值：纯记录性，后端不拿它计算；与 `patch` 同 propKey ⇒ 同轴同量纲。 */
        ...(assumption.oldValue === undefined ? {} : { oldValue: assumption.oldValue }),
        // paramsSchema 的必填项。写的是**这次采纳时屏上那份结论**，让审批人看得见「他是看着什么数点的」。
        reason:
          `通用假设推演采纳：${assumptionLine}${unitTxt}` +
          ` —— 前向重算影响 ${out.affectedObjects} 个对象、${out.count} 处派生字段` +
          `（求解器 generic_inference${snapshotVersion ? ` · 快照 ${snapshotVersion}` : ""}）`,
        /**
         * 结论快照。⚠ 两项都是**计数（个/处·无量纲）**，与上面 `patch` 里那个带量纲的属性值
         * 分处不同字段、不共用任何键 —— 前科 `G-LEVER-SNAPSHOT-UNIT-LIE` 正是把一个无量纲的数
         * 塞进了一个有量纲的字段名下，屏上看不出、审批人照着假数签了字。
         */
        impact: {
          affectedObjects: out.affectedObjects,
          changedDerivedFields: out.count,
          rootTypes: out.rootTypes ?? [],
        },
        provenance: { solver: "generic_inference", snapshotVersion: snapshotVersion ?? null },
      },
    });
  };
  return (
    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn sm primary"
        data-testid="wi-adopt-hypothesis"
        disabled={adopt.isPending}
        onClick={onAdopt}
      >
        {adopt.isPending ? "生成草稿中…" : "采纳该假设（→ Action 审批）"}
      </button>
      {/* 第一层只留动作本身 + 一个记号；「采纳之后到底会发生什么」是成段口径，降浮层（R-UI-3）。 */}
      <InfoPopover topic="采纳后会发生什么" testId="wi-adopt">
        <span data-testid="wi-adopt-body">
          采纳 = 把这一屏的假设原样造成一张「对象数据变更」审批草稿：写哪个对象、改哪个属性、改成什么值，
          都直接取屏上这份假设，你不必再去别处重填一遍。草稿进 S2 审批，**审批通过之后**才把这个值写进真实数据
          并重跑下游派生；在那之前真实数据一个字节都不动（这一页本身仍然是不落库的试算）。
          若这个属性在你的权限下不可写，建草稿这一步就会被挡下并告诉你哪一格不可写，不会静默丢字段。
        </span>
      </InfoPopover>
    </div>
  );
}

/**
 * ══ 判据 U5「结论数字标出处」 ══
 *
 * 改前本页的结论数字（受影响对象 / 派生字段变化 / deltas 表的 before-after）**全是裸数字**：
 * 屏上没有一个字说「这是谁算的、算在哪个快照上」。判据表因此记「不符合」。
 * 唯一提到求解器名的地方在**导出物**的 basis 里 —— 但导出物不上屏，
 * 「导出里写了」不度量「屏上标了出处」（照铁律 0.6 的句式，这两件事不是一回事）。
 *
 * 改后：`SnapshotBadge`（求解器键 + 快照版本，走后端真回执 `snapshotVersion`）
 * ＋ 每个结论数字挂 `<Provenance>` 六要素（来源 / 推导 / 输入 / 规则）。
 * 用户读了能做的决定：数不对时知道该找哪一环，而不是整屏一起怀疑。
 */
function WhatIfResult({
  out,
  snapshotVersion,
  assumption,
  upto,
}: {
  out: GenericInferenceOutput;
  snapshotVersion?: string;
  assumption: Assumption;
  /** 判据 U2 分段闸（唯一出处 = `useSolverStep.upto`）：本区每一段经它决定渲染与否。 */
  upto: (stepNo: number) => boolean;
}) {
  const rows = out.rows ?? [];
  const assumptionLine = `${assumption.typeKey}/${assumption.objectId}.${assumption.prop} = ${assumption.value}`;
  // 诚实空态：无 delta（该属性无下游派生 / 改动不引起任何重算）——不编造影响。
  if (out.count === 0 || rows.length === 0) {
    return (
      <div className="panel empty-state" data-testid="wi-empty" style={{ padding: 24 }}>
        <div className="code">🫧</div>
        {/* 「该假设无下游影响」这个结论本身已经窄而准（它不说「没数据」也不说「算不出」），
            所以「为什么没有」——两种可能的病因 + 诚实空态交代——按规范 §1 降进 `?` 浮层，
            第一层留结论 + 记号。原文一字未删。 */}
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>
          该假设无下游影响
          <InfoPopover topic={zh.whatIf.info.emptyWhy} testId="wi-empty-why">
            <span data-testid="wi-empty-why-body">
              前向重算后未产生任何派生字段变化——此属性可能没有下游派生链，或假设值不改变任何派生结果。诚实空态，不编造影响面。
            </span>
          </InfoPopover>
        </div>
        {/* 判据 U6：「无下游影响」**也是一个结论**，而且是最适合直接下手的那种（改了不波及别人）。
            把按钮只挂在有 deltas 的那一支，会让用户在这一支无处可去——判据卡的正是这件事。 */}
        <AdoptHypothesisButton assumption={assumption} out={out} snapshotVersion={snapshotVersion} assumptionLine={assumptionLine} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="wi-result">
      {/* 影响面计数 —— 判据 U5：每个结论数字都指名道姓说出谁算的、算在什么之上。
          U2 分段闸：这一格是图上 `scope` 节点（layer 2 = 第 3 步「读数」）的产物。 */}
      {upto(3) && (
      <div className="panel" data-testid="wi-impact">
        <div className="section-title">
          ② 影响面
          <SnapshotBadge snapshotVersion={snapshotVersion} tool="generic_inference" />
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent-txt)" }} data-testid="wi-affected-count">
              <Provenance
                testId="wi-affected"
                src="求解器 generic_inference（前向重算下游派生链·不落库试算）"
                formula="受影响对象数 = 前向重算后至少一个派生字段发生变化的对象个数"
                inputs={[`假设：${assumptionLine}`, "派生链：本体 PropertyDef 的派生定义"]}
                rule="确定性重算：同一个假设 + 同一份快照重跑，结果逐字节一致"
                note="试算不落库——这个数说的是「假设世界里会波及多少对象」，真实数据未被改动。"
              >
                {out.affectedObjects}
              </Provenance>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>受影响对象</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--ok-txt)" }} data-testid="wi-delta-count">
              <Provenance
                testId="wi-delta"
                src="求解器 generic_inference · deltas"
                formula="派生字段变化数 = Σ 各受影响对象上 before ≠ after 的派生字段条数"
                inputs={[`假设：${assumptionLine}`, `受影响对象 ${out.affectedObjects} 个`]}
                rule="确定性重算：同一个假设 + 同一份快照重跑，结果逐字节一致"
              >
                {out.count}
              </Provenance>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>派生字段变化</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--txt)", paddingTop: 6 }} data-testid="wi-root-types">{(out.rootTypes ?? []).join(" / ") || "—"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>假设根类型</div>
          </div>
        </div>
        {/* 判据 U6「结论即动作」：动作就摆在结论旁边，参数由这份结论直接带过去（见组件头注）。 */}
        <AdoptHypothesisButton assumption={assumption} out={out} snapshotVersion={snapshotVersion} assumptionLine={assumptionLine} />
      </div>
      )}

      {/* before / after deltas 表。
          U2 分段闸：逐行明细是图上 `deltas` 节点（layer 3 = 第 4 步），比影响面计数**晚一步**。 */}
      {upto(4) && (
      <div className="panel" data-testid="wi-deltas">
        <div className="section-title">
          ③ 下游 before → after（{rows.length}）
          <SnapshotBadge snapshotVersion={snapshotVersion} tool="generic_inference" />
        </div>
        {/* 判据 U5：整张表的出处一句话说清（逐行再挂一次浮层会把表挤爆，且每行出处相同）。 */}
        <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 4 }} data-testid="wi-deltas-src">
          全表由求解器 <span className="mono">generic_inference</span> 在假设 <span className="mono">{assumptionLine}</span> 下前向重算得出
          {snapshotVersion ? <> · 快照 <span className="mono">{snapshotVersion}</span></> : null}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cmp" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>对象</th>
                <th>类型</th>
                <th>派生字段</th>
                <th>before</th>
                <th>after</th>
                <th>变化</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const dir = deltaDir(r.before, r.after);
                return (
                  <tr key={`${r.objectId}-${r.prop}-${i}`} data-testid={`wi-delta-row-${r.objectId}-${r.prop}`}>
                    <td className="mono" style={{ fontSize: 12 }}>{r.objectId}</td>
                    <td className="zh">{r.type}</td>
                    {/* WO-UNIT-MEANING：逐行是不同派生字段（产能/天数/比率/金额混排），
                        原先 before/after 全裸数字无从判断口径 → 带后端下发的量纲（缺则不显·不臆造）。 */}
                    <td className="mono">{r.prop}{r.unit ? <span style={{ color: "var(--muted2)", fontSize: 12 }}> ({r.unit})</span> : null}</td>
                    <td className="mono" data-testid={`wi-before-${r.objectId}-${r.prop}`}>{fmtVal(r.before)}{r.unit ? ` ${r.unit}` : ""}</td>
                    <td className="mono" data-testid={`wi-after-${r.objectId}-${r.prop}`} style={{ fontWeight: 600 }}>{fmtVal(r.after)}{r.unit ? ` ${r.unit}` : ""}</td>
                    <td className="mono" data-testid={`wi-diff-${r.objectId}-${r.prop}`} style={dir ? { color: dir.color, fontWeight: 600 } : { color: "var(--muted2)" }}>
                      {dir ? `${dir.arrow} ${dir.diff}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
