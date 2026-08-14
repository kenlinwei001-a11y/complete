import { useState } from "react";
// WO-UNIT-MEANING：7 维 before/after 表的量纲取自 contracts 单源（i18n 只给中文标签·不内联单位）。
import { kpiDimUnit } from "@platform/contracts";
import zh from "@/locales/zh";
import { fmt } from "./shared";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GSIM-3 · 区② 左轨杠杆盘——需求/供给/物料/优先级分组·调动即标 [待重算]·映射 portfolio 真 solver 控制参数。
 *
 * 杠杆锚真求解器入参（非焊死示意）：
 *  - 供给：冻结产能处置 `frozenCapacityMode`（reserve 锁定 / release 释放）→ 改即重求解、冻结单产能占用真变；
 *  - 优先级：求解方法 `method`（weighted 加权 / lexicographic 字典序 / epsilon ε约束）→ 多目标合成方式真变；
 *  - 需求：纳入订单子集（区④勾选·此处只读计数·联动）；
 *  - 物料：物料约束经产能净额派生（portfolio 无独立物料杠杆·诚实只读·见派生诊断 DAG）。
 * 任一调动 → args 变 → useLiveSolver 去抖重求解（[待重算]/[求解中] 状态由 pending 反映·结果矩阵/KPI/排产真变）。
 *
 * WO-GSLIVE-1-COCKPIT · 活②：在 preset 区之上加「自由杠杆」区——把契约已有的自由 `levers[]`（key/target/delta·
 * 引擎已消费·零契约改动）在 UI 暴露。候选杠杆自结果按占用率反推（瓶颈基地在先·R14 目标自真结果非内联）+
 * 用户拨动/新增任意 {key,target,delta} → 父级并入 args.levers → portfolio 联合重解 → leverDeltas before/after
 * 七维 KPI + provenance（drillType=Lever·R13 每值溯源）。preset 区照旧保留。**血脉 = portfolio levers[]·非 generic_inference。**
 */

export interface LeverState { frozenCapacityMode: "reserve" | "release"; method: "weighted" | "lexicographic" | "epsilon" }

/** 自由杠杆（portfolio 契约 GlobalSimLever·联合重解入参 levers[]）。 */
export interface FreeLever { key: string; target: string; delta: number }
/** 候选杠杆（自结果占用率反推·瓶颈基地在先·R14）。 */
export interface LeverCandidate { key: string; keyLabel: string; target: string; targetLabel: string; util: number; step: number }
/** 七维 KPI（前端展示层·形状复用契约 GlobalSimKpi）。 */
export interface LeverKpi7 { ontime: number; cost: number; changeoverHours: number; freight: number; fgInv: number; transitInv: number; margin: number }
/** 杠杆再优化 delta（求解器返·before/after 七维·可溯）。 */
export interface LeverDeltaVM {
  lever: FreeLever;
  before: LeverKpi7;
  after: LeverKpi7;
  provenance: { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number };
}

const METHOD_LABEL: Record<LeverState["method"], string> = { weighted: "加权", lexicographic: "字典序", epsilon: "ε约束" };
const KPI_DIMS: (keyof LeverKpi7)[] = ["ontime", "cost", "changeoverHours", "freight", "fgInv", "transitInv", "margin"];
const leverId = (l: { key: string; target: string }) => `${l.key}-${l.target}`;

export function GlobalSimLevers({
  value, onChange, includedCount, totalCount, frozenCount, pending,
  freeLevers = [], onFreeLeversChange, candidates = [], leverDeltas = [],
  elapsedMs = 0, onCancel, stale = false, onRecompute,
}: {
  value: LeverState;
  onChange: (next: LeverState) => void;
  includedCount: number;
  totalCount: number;
  frozenCount: number;
  pending: boolean;
  // 活②·自由杠杆（父级 GlobalSimView 传入·可选以兼容）
  freeLevers?: FreeLever[];
  onFreeLeversChange?: (next: FreeLever[]) => void;
  candidates?: LeverCandidate[];
  leverDeltas?: LeverDeltaVM[];
  // D5 · 在途可见 + 旧参数标记（沿用既有 [待重算] 徽标扩展·不新造一套）
  /** 在途已耗时（ms·秒级递增） */
  elapsedMs?: number;
  /** 主动取消本次推演（用户可直接放弃·不必靠改参数间接取消） */
  onCancel?: () => void;
  /** 参数已改但屏上结果对应旧参数（用户选「否」或主动取消后） */
  stale?: boolean;
  /** 以当前参数重算 */
  onRecompute?: () => void;
}) {
  const [customKey, setCustomKey] = useState("");
  const [customTarget, setCustomTarget] = useState("");

  const hasLever = (l: { key: string; target: string }) => freeLevers.some((f) => f.key === l.key && f.target === l.target);
  const addLever = (l: FreeLever) => {
    if (!onFreeLeversChange || hasLever(l)) return;
    onFreeLeversChange([...freeLevers, l]);
  };
  const setDelta = (l: FreeLever, delta: number) => {
    if (!onFreeLeversChange) return;
    onFreeLeversChange(freeLevers.map((f) => (f.key === l.key && f.target === l.target ? { ...f, delta } : f)));
  };
  const removeLever = (l: FreeLever) => {
    if (!onFreeLeversChange) return;
    onFreeLeversChange(freeLevers.filter((f) => !(f.key === l.key && f.target === l.target)));
  };
  const addCustom = () => {
    const key = customKey.trim();
    const target = customTarget.trim();
    if (!key || !target) return;
    addLever({ key, target, delta: 1 });
    setCustomKey("");
    setCustomTarget("");
  };
  const targetLabelOf = (l: FreeLever): string => candidates.find((c) => c.target === l.target)?.targetLabel ?? l.target;
  const keyLabelOf = (l: FreeLever): string => candidates.find((c) => c.key === l.key)?.keyLabel ?? (zh.gslive.leverKeys as Record<string, string>)[l.key] ?? l.key;

  return (
    <div className={styles.glass} data-testid="global-sim-levers">
      <span className={styles.grpLabel}>
        [ 杠杆盘 · 需求 / 供给 / 物料 / 优先级 ]
        {/* D5 · 在途可见：既有 [待重算] 徽标扩展出「已耗时」+「取消」（不新造一套状态显示） */}
        {pending && (
          <span className={styles.recalcBadge} data-testid="global-sim-recalc">
            ● {"　"}求解中 · 已耗时 <b className="mono" data-testid="global-sim-elapsed">{Math.floor(Math.max(0, elapsedMs) / 1000)}</b> 秒
            {onCancel && (
              <button
                type="button"
                data-testid="global-sim-cancel-solve"
                title="放弃本次推演（服务端会真的中止底层求解）——不必靠改参数间接取消"
                onClick={onCancel}
                style={{ marginLeft: 6, fontSize: 12, padding: "0 6px", cursor: "pointer", background: "transparent", color: "inherit", border: "1px solid currentColor", borderRadius: 4 }}
              >
                取消本次推演
              </button>
            )}
          </span>
        )}
        {/* D5 · 用户选「否」/主动取消后：绝不静默丢改动，也绝不让结果与旁边的参数对不上 → 明标 + 待重算 */}
        {stale && (
          <span
            className={styles.recalcBadge}
            data-testid="global-sim-stale"
            title="你的改动已保留，但当前屏上的结果是用旧参数算出来的；点「重算」按新参数重新求解。"
            style={{ color: "var(--danger-txt)" }}
          >
            ⚠ {"　"}参数已改 · 当前结果对应旧参数
            {onRecompute && (
              <button
                type="button"
                data-testid="global-sim-recompute"
                onClick={onRecompute}
                style={{ marginLeft: 6, fontSize: 12, padding: "0 6px", cursor: "pointer", background: "transparent", color: "inherit", border: "1px solid currentColor", borderRadius: 4 }}
              >
                重算
              </button>
            )}
          </span>
        )}
      </span>

      {/* 供给：冻结产能处置（真 arg frozenCapacityMode） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-supply">
        <div className={styles.leverLabel}>供给 · 冻结产能处置</div>
        <div className={styles.segmented}>
          {(["reserve", "release"] as const).map((m) => (
            <button
              key={m}
              className={`${styles.segBtn} ${value.frozenCapacityMode === m ? styles.segOn : ""}`}
              data-testid={`global-sim-lever-frozen-${m}`}
              onClick={() => onChange({ ...value, frozenCapacityMode: m })}
            >
              {m === "reserve" ? "锁定（预扣产能）" : "释放（看极限）"}
            </button>
          ))}
        </div>
        <div className={styles.leverHint}>冻结 {frozenCount} 单 · 锁定=其产能不可被他单占用；释放=看产能极限可行性。</div>
      </div>

      {/* 优先级：求解方法（真 arg method） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-priority">
        <div className={styles.leverLabel}>优先级 · 多目标求解方法</div>
        <div className={styles.segmented}>
          {(["weighted", "lexicographic", "epsilon"] as const).map((m) => (
            <button
              key={m}
              className={`${styles.segBtn} ${value.method === m ? styles.segOn : ""}`}
              data-testid={`global-sim-lever-method-${m}`}
              onClick={() => onChange({ ...value, method: m })}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <div className={styles.leverHint}>加权=各目标线性合成；字典序=按序逐目标锁定；ε约束=主目标最优下约束次目标。</div>
      </div>

      {/* 活②·自由杠杆区（portfolio levers[]·任意变量联合重解·preset 区之外并存） */}
      <div className={styles.leverGroup} data-testid="global-sim-freelevers">
        <div className={styles.leverLabel}>{zh.gslive.freeLevers}</div>
        <div className={styles.leverHint}>{zh.gslive.freeLeversHint}</div>

        {/* 候选杠杆（占用率反推·瓶颈在先） */}
        <div className={styles.leverHint} style={{ marginTop: 6 }}>{zh.gslive.candidatesTitle}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }} data-testid="global-sim-freelever-candidates">
          {candidates.length ? candidates.map((c) => (
            <button
              key={leverId(c)}
              className={styles.segChip}
              disabled={hasLever(c)}
              data-testid={`global-sim-freelever-cand-${leverId(c)}`}
              title={`占用率 ${(c.util * 100).toFixed(0)}% · 目标 ${c.targetLabel}`}
              onClick={() => addLever({ key: c.key, target: c.target, delta: c.step })}
            >
              + {c.keyLabel}·{c.targetLabel} <span style={{ opacity: 0.6 }}>{(c.util * 100).toFixed(0)}%</span>
            </button>
          )) : <span className={styles.textMuted} style={{ fontSize: 12 }}>{zh.gslive.noCandidates}</span>}
        </div>

        {/* 新增自定义杠杆（任意 key/target） */}
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }} data-testid="global-sim-freelever-add">
          <input
            type="text" value={customKey} placeholder={zh.gslive.leverKeyPlaceholder}
            data-testid="global-sim-freelever-key" onChange={(e) => setCustomKey(e.target.value)}
            style={{ flex: "1 1 120px", minWidth: 0 }}
          />
          <select value={customTarget} data-testid="global-sim-freelever-target" onChange={(e) => setCustomTarget(e.target.value)} style={{ flex: "1 1 100px" }}>
            <option value="">目标基地…</option>
            {[...new Map(candidates.map((c) => [c.target, c.targetLabel])).entries()].map(([t, lbl]) => (
              <option key={t} value={t}>{lbl}</option>
            ))}
          </select>
          <button className={styles.segBtn} data-testid="global-sim-freelever-addbtn" disabled={!customKey.trim() || !customTarget.trim()} onClick={addCustom}>
            {zh.gslive.add}
          </button>
        </div>

        {/* 生效杠杆（联合重解入参 levers[]） */}
        <div className={styles.leverHint} style={{ marginTop: 8 }}>{zh.gslive.activeTitle}</div>
        {freeLevers.length ? (
          <div data-testid="global-sim-freelever-active">
            {freeLevers.map((l) => (
              <div key={leverId(l)} data-testid={`global-sim-freelever-${leverId(l)}`} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                <span style={{ flex: 1, fontSize: 12 }}>{keyLabelOf(l)} · <span className="mono">{targetLabelOf(l)}</span></span>
                <button className={styles.segBtn} data-testid={`global-sim-freelever-dec-${leverId(l)}`} onClick={() => setDelta(l, l.delta - 1)}>−</button>
                <input
                  type="number" value={l.delta}
                  data-testid={`global-sim-freelever-delta-${leverId(l)}`}
                  onChange={(e) => setDelta(l, Number(e.target.value) || 0)}
                  style={{ width: 56, textAlign: "center" }}
                />
                <button className={styles.segBtn} data-testid={`global-sim-freelever-inc-${leverId(l)}`} onClick={() => setDelta(l, l.delta + 1)}>+</button>
                <button className={styles.segBtn} data-testid={`global-sim-freelever-rm-${leverId(l)}`} title={zh.gslive.remove} onClick={() => removeLever(l)}>×</button>
              </div>
            ))}
          </div>
        ) : <div className={styles.textMuted} style={{ fontSize: 12 }}>{zh.gslive.noActive}</div>}

        {/* leverDeltas before/after 七维 KPI（每值溯源 drillType=Lever·R13） */}
        <div className={styles.leverHint} style={{ marginTop: 8 }}>{zh.gslive.deltasTitle}</div>
        {leverDeltas.length ? (
          <div data-testid="global-sim-leverdeltas">
            {leverDeltas.map((dlt) => (
              <div key={leverId(dlt.lever)} data-testid={`global-sim-leverdelta-${leverId(dlt.lever)}`} className={styles.orderCard} style={{ marginTop: 6 }} title={`溯源 ${dlt.provenance.kind}：${dlt.provenance.drillType}.${dlt.provenance.drillField}[${dlt.provenance.drillId}] = ${dlt.provenance.drillValue}`}>
                <strong style={{ fontSize: 12 }}>{keyLabelOf(dlt.lever)}·{targetLabelOf(dlt.lever)}（Δ{dlt.lever.delta}）</strong>
                <table className={styles.gtable} style={{ marginTop: 4 }}>
                  <thead><tr><th>维度</th><th style={{ textAlign: "right" }}>before</th><th style={{ textAlign: "right" }}>after</th></tr></thead>
                  <tbody>
                    {KPI_DIMS.map((dim) => {
                      const b = dlt.before[dim]; const a = dlt.after[dim];
                      const changed = Math.abs(a - b) > 1e-9;
                      return (
                        <tr key={dim} data-testid={`global-sim-leverdelta-${leverId(dlt.lever)}-${dim}`} data-changed={changed}>
                          <td>{(zh.gslive.kpiDims as Record<string, string>)[dim] ?? dim}{kpiDimUnit(dim) ? `(${kpiDimUnit(dim)})` : ""}</td>
                          <td className="num">{fmt(b, 0)}</td>
                          <td className="num" style={changed ? { color: a > b ? "var(--danger,#c0392b)" : "var(--ok,#2e7d32)" } : undefined}>{fmt(a, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : <div className={styles.textMuted} style={{ fontSize: 12 }}>{zh.gslive.noDeltas}</div>}
      </div>

      {/* 需求：纳入订单子集（区④联动·只读计数） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-demand">
        <div className={styles.leverLabel}>需求 · 纳入订单</div>
        <div className={styles.leverReadout} data-testid="global-sim-lever-included">
          <b>{includedCount}</b> / {totalCount} 单纳入决策集
        </div>
        <div className={styles.leverHint}>在下方订单清单勾选参与 ✓ / 固定 🔒 / 排除 ☐ 调节需求子集 → 联合解真变。</div>
      </div>

      {/* 物料：诚实只读（portfolio 无独立物料杠杆） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-material">
        <div className={styles.leverLabel}>物料 · 约束（派生·只读）</div>
        <div className={styles.leverHint}>物料齐套约束经基地净产能派生纳入联合守恒（无独立物料杠杆·诚实标·细看产能派生诊断 DAG）。</div>
      </div>
    </div>
  );
}
