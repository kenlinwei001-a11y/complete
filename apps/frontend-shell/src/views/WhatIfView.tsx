import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ImpactChange } from "@platform/contracts";
import { fetchObjectTypes, queryObjectsPaged, invokeSolver } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
// WO-SANDBOX-53CELLS · 判据 U5（结论数字标出处）：本页 deltas 表与影响面计数此前全是裸数字。
import { Provenance } from "@/components/Provenance";
import { SnapshotBadge } from "./sim/shared";
// WO-BEFE-WIRE-3 · 影响传播统一入口（POST /a/v1/simulation/impact-analysis）的**唯一生产调用方**。
// 挂在本页而不是另开一页：这一页的表单（类型/对象/属性/假设值）**就是**那个端点要的 `change`，
// 另造一张页 = 让用户把同一个假设填两遍，且两处口径迟早分家。
import { ImpactAnalysisPanel } from "./sim/ImpactAnalysisPanel";
import EdgeActivePanel from "./sim/EdgeActivePanel";
// WO-HARNESS-UX-GAP-1 · 判据 U7（同屏问答知道自己在哪一页）+ U9（导出物自带出处与生成时间）。
// 本页走 App.tsx 的专用 route，不经 ViewPage ⇒ 必须自己调 usePageView（理由见 shared.tsx 该函数注释）。
import { ExportReportButton, usePageView } from "./sim/shared";
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
 * 输入防抖（判据 U1 的配套，不是可选优化）。
 *
 * 撤掉提交闸后「假设值」是个自由文本框：不防抖 ⇒ 每敲一个键发一次求解，
 * 用户打 `1200` 会连发 `1` `12` `120` `1200` 四次，中间三次都是**没意义的假设**。
 * 防抖只推迟**发请求**，不推迟输入回显 —— 屏上的值一直是用户刚敲的那个，
 * 所以它**不是提交闸**（提交闸的定义是「不点某个东西结果永远不更新」，与「晚 300ms 更新」是两件事）。
 */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function WhatIfView({ view: _view }: { view?: ViewConfigVM }) {
  usePageView("what-if");
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

      {/* ── 同一份假设的**第二个出口**：跑在被隔离的推演世界里，四维分项（WO-BEFE-WIRE-3）──
          上面那个按钮走 `generic_inference`（无世界、单个裸计数）；这里走
          `POST /a/v1/simulation/impact-analysis`（世界隔离 + 对象/流程/决策/KPI 四维 + 诚实标记）。
          两个出口共用上面同一张表单 —— 用户不必把假设填两遍。 */}
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

      {/* ── 结果区 ── */}
      {assumptionReady && settled && result ? (
        <WhatIfResult out={result} snapshotVersion={runQ.data?.snapshotVersion} assumption={{ typeKey, objectId, prop, value: debouncedValue }} />
      ) : null}

      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。
          ⚠ 必须挂在**主组件**里、且不进 `ran && result` 那个条件：挂进结果区 = 没跑过推演就看不见开关，
          而"先关掉一条边再看结果"恰恰是最常见的用法（本单初稿真踩过这一下，收编前自查抓出）。 */}
      <EdgeActivePanel pageKey="what-if" />
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
}: {
  out: GenericInferenceOutput;
  snapshotVersion?: string;
  assumption: { typeKey: string; objectId: string; prop: string; value: string };
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
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="wi-result">
      {/* 影响面计数 —— 判据 U5：每个结论数字都指名道姓说出谁算的、算在什么之上。 */}
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
                rule="R6 确定性：同假设同快照重跑，逐字节一致"
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
                rule="R6 确定性"
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
      </div>

      {/* before / after deltas 表 */}
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
    </div>
  );
}
