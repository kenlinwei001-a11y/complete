import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ImpactChange } from "@platform/contracts";
import { fetchObjectTypes, queryObjectsPaged, invokeSolver } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";
// WO-BEFE-WIRE-3 · 影响传播统一入口（POST /a/v1/simulation/impact-analysis）的**唯一生产调用方**。
// 挂在本页而不是另开一页：这一页的表单（类型/对象/属性/假设值）**就是**那个端点要的 `change`，
// 另造一张页 = 让用户把同一个假设填两遍，且两处口径迟早分家。
import { ImpactAnalysisPanel } from "./sim/ImpactAnalysisPanel";
import EdgeActivePanel from "./sim/EdgeActivePanel";

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
    ? { arrow: "▲", diff: `+${d}`, color: "var(--ok)" }
    : { arrow: "▼", diff: String(d), color: "var(--danger)" };
}

/** 对象展示名：优先 name / 主键值，退回内部 id。 */
function objectLabel(props: Record<string, unknown>, pkKey: string | undefined, id: string): string {
  const name = props.name ?? props.displayName;
  const pk = pkKey ? props[pkKey] : undefined;
  const base = pk != null ? String(pk) : id;
  if (name != null && String(name) !== base) return `${base} · ${String(name)}`;
  return base;
}

export default function WhatIfView({ view: _view }: { view?: ViewConfigVM }) {
  const [typeKey, setTypeKey] = useState<string>("");
  const [objectId, setObjectId] = useState<string>("");
  const [prop, setProp] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [result, setResult] = useState<GenericInferenceOutput | null>(null);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const canRun = typeKey !== "" && objectId !== "" && prop !== "" && value.trim() !== "" && !busy;

  /**
   * WO-BEFE-WIRE-3 · 本页表单 → 影响传播端点要的**那一处变更**。
   *
   * 与下面 `run()` 喂给 `generic_inference` 的 `apply[0]` 是**同一份口径**（含数值属性的类型强制），
   * 不另算一套 —— 两个出口读的必须是同一个假设，否则「两处结论对不上」会被读成引擎不一致。
   * `oldValue` 是**调用方声明的变更前值**，纯记录性：后端不拿它计算，只在与世界里的真实旧值
   * 不一致时回一个 `basis.oldValueMismatch` 标记出来（我们把那个标记显示在第一层）。
   */
  const impactChange = useMemo<ImpactChange | null>(() => {
    if (typeKey === "" || objectId === "" || prop === "" || value.trim() === "") return null;
    const coerced: unknown =
      currentProp?.dataType === "number" && Number.isFinite(Number(value)) ? Number(value) : value;
    return {
      objectType: typeKey,
      objectId,
      prop,
      value: coerced,
      ...(currentValue === undefined ? {} : { oldValue: currentValue }),
    };
  }, [typeKey, objectId, prop, value, currentProp, currentValue]);

  const onSelectType = (k: string): void => {
    setTypeKey(k);
    setObjectId("");
    setProp("");
    setValue("");
    setResult(null);
    setRan(false);
  };

  const run = async (): Promise<void> => {
    if (!canRun || impactChange === null) return;
    setBusy(true);
    try {
      // 值类型强制（数值属性转 number，其余透传字符串）走 `impactChange` 单源 ——
      // 此前这里另写了一遍同样的三元式，两处迟早分家（WO-BEFE-WIRE-3 顺手合并）。
      const res = await invokeSolver("generic_inference", {
        apply: [{ objectType: typeKey, objectId, prop, value: impactChange.value }],
      });
      setResult(res.data as GenericInferenceOutput);
      setRan(true);
    } catch (e) {
      toastError(e);
      setResult(null);
      setRan(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="what-if">
      {/* ── 说明 ── */}
      <div className="panel" data-testid="wi-intro">
        <div className="section-title">通用假设推演 · 把某属性改成 X，看下游怎样</div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          选一个对象、改它的某个属性到假设值 → 前向重算下游派生链，给出 before / after 变化与影响面。
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
                onChange={(e) => { setObjectId(e.target.value); setResult(null); setRan(false); }}
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
                onChange={(e) => { setProp(e.target.value); setResult(null); setRan(false); }}
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

            <button className="btn primary" data-testid="wi-run" disabled={!canRun} onClick={run}>
              {busy ? "推演中…" : "推演下游影响"}
            </button>
          </div>
        )}
      </div>

      {/* ── 同一份假设的**第二个出口**：跑在被隔离的推演世界里，四维分项（WO-BEFE-WIRE-3）──
          上面那个按钮走 `generic_inference`（无世界、单个裸计数）；这里走
          `POST /a/v1/simulation/impact-analysis`（世界隔离 + 对象/流程/决策/KPI 四维 + 诚实标记）。
          两个出口共用上面同一张表单 —— 用户不必把假设填两遍。 */}
      <div className="panel" data-testid="wi-impact-panel">
        <div className="section-title">① b 在推演世界里分析影响（世界隔离 · 四维分项）</div>
        <ImpactAnalysisPanel change={impactChange} />
      </div>

      {/* ── 结果区 ── */}
      {ran && result ? <WhatIfResult out={result} currentProp={currentProp} /> : null}
    </div>
  );
}

function WhatIfResult({ out, currentProp }: { out: GenericInferenceOutput; currentProp?: TypeProp }) {
  const rows = out.rows ?? [];
  // 诚实空态：无 delta（该属性无下游派生 / 改动不引起任何重算）——不编造影响。
  if (out.count === 0 || rows.length === 0) {
    return (
      <div className="panel empty-state" data-testid="wi-empty" style={{ padding: 24 }}>
        <div className="code">🫧</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>该假设无下游影响</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center", lineHeight: 1.7 }}>
          前向重算后未产生任何派生字段变化——此属性可能没有下游派生链，或假设值不改变任何派生结果。诚实空态，不编造影响面。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="wi-result">
      {/* 影响面计数 */}
      <div className="panel" data-testid="wi-impact">
        <div className="section-title">② 影响面</div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }} data-testid="wi-affected-count">{out.affectedObjects}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>受影响对象</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--ok)" }} data-testid="wi-delta-count">{out.count}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>派生字段变化</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--txt)", paddingTop: 6 }} data-testid="wi-root-types">{(out.rootTypes ?? []).join(" / ") || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>假设根类型</div>
          </div>
        </div>
      </div>

      {/* before / after deltas 表 */}
      <div className="panel" data-testid="wi-deltas">
        <div className="section-title">③ 下游 before → after（{rows.length}）</div>
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
                    <td className="mono" style={{ fontSize: 11 }}>{r.objectId}</td>
                    <td className="zh">{r.type}</td>
                    {/* WO-UNIT-MEANING：逐行是不同派生字段（产能/天数/比率/金额混排），
                        原先 before/after 全裸数字无从判断口径 → 带后端下发的量纲（缺则不显·不臆造）。 */}
                    <td className="mono">{r.prop}{r.unit ? <span style={{ color: "var(--muted2)", fontSize: 10 }}> ({r.unit})</span> : null}</td>
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
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。 */}
      <EdgeActivePanel pageKey="what-if" />
    </div>
  );
}
