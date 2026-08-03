import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
// DF.13 外协红线单一来源（C08）：规则缺失时的兜底上限读契约，禁内联裸阈值。
import { OUTSOURCE_REDLINE } from "@platform/contracts";
import { discoverLevers, fetchRules, runSolver, type DiscoveredLever } from "@/api/endpoints";
import { Feature } from "@/workspace/featureGate";
import { Provenance } from "@/components/Provenance";
import { fmt, useActionDraft } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

/**
 * WO-PROJECT-SIM-WHATIF ⑥ · 动态杠杆面板（闭 G-WHATIF-HARDCODED-LEVERS）：
 * 替换焊死 3 滑杆（夜班/加产线/外协）为「自⑤瓶颈反推 + 敏感度排序」的动态杠杆集——
 *   ① 杠杆自本体派生 DAG 反推（generic_inference mode:"levers"·服务端算敏感度，杠杆随瓶颈变，非写死）；
 *   ② top-K 动态滑杆 + tornado 条（∂目标/∂杠杆 降序，排序=真敏感度）；
 *   ③ 拖动 → generic_inference recompute 真重算 → before/after deltas + 每值 provenance（R13）；
 *   ④ 边界自规则闸（外协 C08 读规则表·非内联 20）/ 物理域；
 *   ⑤ 多方案利弊矩阵（每方案 generic_inference 真算·一键采纳回填）。
 * 纯投影（KILL-MOCK）：deltas / 敏感度 / 矩阵全部从真求解器输出渲染，零写死数字。
 */

interface Delta {
  objId: string;
  type: string;
  prop: string;
  before: unknown;
  after: unknown;
}
interface GenericInferenceOut {
  deltas: Delta[];
  rows: { objectId: string; type: string; prop: string; before: unknown; after: unknown }[];
  affectedObjects: number;
  count: number;
  rootTypes: string[];
}

const leverKey = (l: { objectType: string; objectId: string; prop: string }): string => `${l.objectType}.${l.objectId}.${l.prop}`;
const isOutsource = (prop: string): boolean => /outsource/i.test(prop);

/** 显示名：杠杆中文名的**单一真值在后端**（`discoverLevers` 下发 `factor`·datacore `LEVER_PROP_LABELS`）——
 *  前端只兜底：缺 `factor` 时回退「对象类型.属性」原键（露出后端单源缺项以便补·**不在视图内联业务常数标签**·R14 去电池锁死门守）。 */
function leverLabel(l: { objectType: string; prop: string; factor?: string }): string {
  return l.factor ?? `${l.objectType}.${l.prop}`;
}

/** 边界自规则闸（R14·非内联）：外协类杠杆上限读 C08 阈值（从规则表达式解析 ratio），其余取物理域 [0,1] 或值域兜底。 */
function leverBound(l: DiscoveredLever, c08Ratio: number): { min: number; max: number; step: number; pct: boolean; gated: boolean } {
  if (l.bound && Number.isFinite(l.bound.min) && Number.isFinite(l.bound.max) && !isOutsource(l.prop)) {
    const span = l.bound.max - l.bound.min;
    return { min: l.bound.min, max: l.bound.max, step: span > 0 ? Math.max(span / 20, 0.001) : 0.01, pct: false, gated: false };
  }
  if (isOutsource(l.prop)) {
    return { min: 0, max: c08Ratio, step: c08Ratio / 4 || 0.05, pct: true, gated: true };
  }
  // OEE / 利用率 / 良率：物理域 [0,1]。
  if (l.currentValue >= 0 && l.currentValue <= 1) return { min: 0, max: 1, step: 0.01, pct: false, gated: false };
  const max = Math.max(l.currentValue * 2, l.currentValue + 1);
  return { min: 0, max, step: Math.max(max / 20, 0.1), pct: false, gated: false };
}

/** WO-LEVER-UNIT · 杠杆值配单位（治本单源·后端 `valueKind`/`unit` 下发·前端只格式化不内联业务单位·R14）：
 *  ratio=比率（0–1 存储自动×100 显示 %，让"0.9"读作"90%"）；days/count/hours/minutes/qty=整数+单位后缀（如 26天/2班）。
 *  缺后端元数据（`valueKind` undefined）→ 诚实回退旧显示：pct 边界显 %（外协）、其余 3 位小数（不臆造单位）。 */
function fmtLeverValue(v: number, valueKind?: string, unit?: string, pct?: boolean): string {
  if (valueKind === "ratio") return `${Math.round(v <= 1 ? v * 100 : v)}%`;
  if (valueKind) {
    const n = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
    return `${n}${unit ?? ""}`;
  }
  return pct ? `${Math.round(v * 100)}%` : fmt(v, 3); // 无后端元数据 → 旧兜底（不臆造单位）
}

function deltaDir(before: unknown, after: unknown): { arrow: string; diff: string; color: string } | null {
  if (typeof before !== "number" || typeof after !== "number" || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  const d = Math.round((after - before) * 1e6) / 1e6;
  if (d === 0) return { arrow: "＝", diff: "0", color: "var(--muted2)" };
  return d > 0 ? { arrow: "▲", diff: `+${d}`, color: "var(--ok)" } : { arrow: "▼", diff: String(d), color: "var(--danger)" };
}

/**
 * C08 阈值解析（R14·非内联）：从规则表达式取第一个 0–1 小数 = 外协比例上限。
 * DF.13：规则表未返回时的兜底改读契约单一来源 `OUTSOURCE_REDLINE.maxRatio`（此前内联裸阈值）——
 * 兜底值与真闸值同源，规则表拉不到时 UI 也不会显示一个跟后端对不上的上限。
 */
function parseC08Ratio(rules: { key: string; expression?: string }[] | undefined): number {
  const c08 = rules?.find((r) => r.key === OUTSOURCE_REDLINE.ruleKey);
  const m = c08?.expression?.match(/(\d*\.?\d+)/);
  const v = m ? parseFloat(m[1]!) : NaN;
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : OUTSOURCE_REDLINE.maxRatio;
}

export function DynamicLeverPanel({
  baseP50,
  baseGap,
  factors,
  scopeObjectIds,
  modelId,
  snapshot,
  targetType = "Base",
  targetProp = "oeeIndex",
  topK = 6,
  grain,
  beforeLabel,
  adoptActionTypeKey = "采纳产能保障方案",
  onLiveState,
}: {
  baseP50: number;
  baseGap: number;
  factors: string[];
  scopeObjectIds?: string[];
  modelId: string;
  snapshot: { mode: string; qty: number; p50: number; p90: number; mainBn: string };
  /** WO-CAPLIVE-2：参数化推演目标（项目推演页默认 Base.oeeIndex；产能页传 Base.weeklyCap/Process 级）。
   *  硬编（旧 :91 targetType:"Base"/targetProp:"oeeIndex"）→ 参数，杠杆自不同产能目标反推（保 ProjectSimView 默认不回归）。 */
  targetType?: string;
  targetProp?: string;
  topK?: number;
  /** WO-CAPLIVE-TRUECHAIN：产能活台 grain 作用域（'process-model'）→ 杠杆发现/重算走真产能链（capacity_forecast.byProcessModel
   *  Σp50·后端 discoverCapacityLevers/capacityInferenceApply）。缺省（如 ProjectSimView）→ 通用 generic_inference recompute（零回归）。 */
  grain?: string;
  /** "调整前" 参照量的标签（项目推演=P50·产能页=可用产能，R14 下发）。 */
  beforeLabel?: string;
  /** 采纳杠杆组合的 ActionType（默认产能保障方案·C5 门经审批草稿）。 */
  adoptActionTypeKey?: string;
  /** WO-CAPLIVE-2：向父级暴露当前活推演态（当前杠杆组合 apply + 增益 + 影响面），供产能页方案存/分支/横比消费。 */
  onLiveState?: (s: { apply: { objectType: string; objectId: string; prop: string; value: number }[]; capGain: number; affected: number }) => void;
}) {
  const action = useActionDraft();
  const [values, setValues] = useState<Record<string, number>>({});

  // ① 杠杆发现（generic_inference mode:levers·服务端算敏感度，随⑤瓶颈变·目标参数化）。
  const leversQ = useQuery({
    queryKey: ["a", "levers", { factors, scope: scopeObjectIds, targetType, targetProp, topK, grain, modelId }],
    queryFn: async () => (await discoverLevers({ factors, scopeObjectIds, targetType, targetProp, topK, ...(grain ? { grain, modelId } : {}) })).data.levers,
    retry: false,
  });
  const levers = useMemo(() => leversQ.data ?? [], [leversQ.data]);

  // ④ 边界：C08 规则闸值（外协上限，读规则表·非内联）。
  const rulesQ = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules, staleTime: 60_000 });
  const c08Ratio = parseC08Ratio(rulesQ.data as { key: string; expression?: string }[] | undefined);

  const valueOf = (l: DiscoveredLever): number => values[leverKey(l)] ?? l.currentValue;
  const bounds = useMemo(() => {
    const m = new Map<string, ReturnType<typeof leverBound>>();
    for (const l of levers) m.set(leverKey(l), leverBound(l, c08Ratio));
    return m;
  }, [levers, c08Ratio]);

  // ③ 拖动 → 携真 {objectType,objectId,prop,value} 调 generic_inference 真重算（debounce + AbortController）。
  const activeApply = useMemo(
    () =>
      levers
        .filter((l) => {
          const v = values[leverKey(l)];
          return v !== undefined && v !== l.currentValue;
        })
        .map((l) => ({ objectType: l.objectType, objectId: l.objectId, prop: l.prop, value: values[leverKey(l)] as number })),
    [levers, values],
  );
  const live = useLiveSolver<GenericInferenceOut>(
    "generic_inference",
    activeApply.length > 0 ? { apply: activeApply, ...(grain ? { grain, modelId } : {}) } : null,
    (raw) => raw as GenericInferenceOut,
  );
  const out = live.data;

  const maxSens = Math.max(1e-9, ...levers.map((l) => Math.abs(l.sensitivity)));

  // WO-CAPLIVE-2：把当前活推演态（杠杆组合 + 增益 + 影响面）上抛父级（产能页方案存/分支/横比消费）。
  // 用序列化 key 稳定依赖、ref 持 callback（避免父级重建触发循环渲染）。
  const capGain = useMemo(
    () => (out?.deltas ?? []).reduce((acc, x) => acc + Math.max(0, Number(x.after) - Number(x.before)), 0),
    [out],
  );
  const onLiveStateRef = useRef(onLiveState);
  onLiveStateRef.current = onLiveState;
  const liveKey = JSON.stringify({ apply: activeApply, capGain: Math.round(capGain * 1e6), affected: out?.affectedObjects ?? 0 });
  useEffect(() => {
    const s = JSON.parse(liveKey) as { apply: { objectType: string; objectId: string; prop: string; value: number }[]; capGain: number; affected: number };
    onLiveStateRef.current?.({ apply: s.apply, capGain: s.capGain / 1e6, affected: s.affected });
  }, [liveKey]);

  // ⑤ 多方案候选组合（objective 驱动·确定性·非写死）：max_产能 / min_代价 / 均衡。
  const schemes = useMemo(() => {
    if (levers.length === 0) return [] as { key: string; label: string; apply: { objectType: string; objectId: string; prop: string; value: number }[] }[];
    const mk = (fn: (l: DiscoveredLever, b: ReturnType<typeof leverBound>) => number) =>
      levers.map((l) => {
        const b = bounds.get(leverKey(l))!;
        return { objectType: l.objectType, objectId: l.objectId, prop: l.prop, value: Math.round(fn(l, b) * 1e6) / 1e6 };
      });
    return [
      { key: "maxCap", label: zh.sim.proj.lever.schemes.maxCap, apply: mk((_l, b) => b.max) },
      // redline-allow：0.3 是「最省成本」方案对非外协杠杆的**推进比例**（外协杠杆本身在此保持不动），非红线阈值。
      { key: "minCost", label: zh.sim.proj.lever.schemes.minCost, apply: mk((l, b) => (isOutsource(l.prop) ? l.currentValue : l.currentValue + (b.max - l.currentValue) * 0.3)) },
      { key: "balanced", label: zh.sim.proj.lever.schemes.balanced, apply: mk((l, b) => (l.currentValue + b.max) / 2) },
    ];
  }, [levers, bounds]);

  const schemesQ = useQuery({
    queryKey: ["a", "lever-schemes", schemes.map((s) => s.apply), grain, modelId],
    enabled: schemes.length > 0,
    retry: false,
    queryFn: async () => {
      const results = await Promise.all(
        schemes.map(async (s) => {
          const res = await runSolver("generic_inference", { apply: s.apply, ...(grain ? { grain, modelId } : {}) });
          const d = res.data as GenericInferenceOut;
          const capGain = (d.deltas ?? []).reduce((acc, x) => acc + Math.max(0, Number(x.after) - Number(x.before)), 0);
          const ruleFlag = s.apply.some((a) => isOutsource(a.prop) && a.value >= c08Ratio);
          return { key: s.key, label: s.label, capGain: Math.round(capGain * 1e6) / 1e6, impact: d.affectedObjects ?? 0, ruleFlag };
        }),
      );
      return results;
    },
  });

  const adoptCombo = (apply: { objectType: string; objectId: string; prop: string; value: number }[]): void => {
    action.mutate({
      actionTypeKey: adoptActionTypeKey,
      payload: {
        modelId,
        levers: apply, // 迁移：动态杠杆组合 [{objectType,prop,value}]（替原 whatIf 三系数）
        snapshot: { ...snapshot, p50: snapshot.p50, baselineGap: baseGap },
      },
    });
  };

  const applyScheme = (schemeKey: string): void => {
    const s = schemes.find((x) => x.key === schemeKey);
    if (!s) return;
    const next: Record<string, number> = { ...values };
    for (const a of s.apply) next[`${a.objectType}.${a.objectId}.${a.prop}`] = a.value;
    setValues(next);
  };

  return (
    <div className={styles.whatIfPanel} data-testid="dynamic-lever-panel">
      <div className="section-title">{zh.sim.proj.lever.title}</div>
      <div className={styles.noteInfo}>{zh.sim.proj.lever.hint}</div>

      {leversQ.isLoading && <div className="empty-state">{zh.common.loading}</div>}
      {!leversQ.isLoading && levers.length === 0 && (
        <div className={styles.noteInfo} data-testid="lever-empty">{zh.sim.proj.lever.empty}</div>
      )}

      {levers.length > 0 && (
        <>
          {/* ② tornado 条（敏感度降序·排序=真敏感度） */}
          <div data-testid="lever-tornado" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 4 }}>{zh.sim.proj.lever.tornadoTitle}</div>
            {levers.map((l) => (
              <div key={leverKey(l)} data-testid={`tornado-bar-${l.prop}`} style={{ display: "flex", alignItems: "center", gap: 6, margin: "2px 0" }}>
                <span style={{ width: 128, fontSize: 11 }} className="zh">{leverLabel(l)}</span>
                <span className={styles.tightBar} style={{ flex: 1 }}>
                  <i style={{ width: `${Math.min(100, (Math.abs(l.sensitivity) / maxSens) * 100)}%`, background: "var(--c-capacity)" }} />
                </span>
                <span className="mono" data-testid={`tornado-sens-${l.prop}`} style={{ fontSize: 11, width: 64, textAlign: "right" }}>{fmt(l.sensitivity, 3)}</span>
              </div>
            ))}
          </div>

          {/* ③ top-K 动态滑杆（非焊死 3 根） */}
          {levers.map((l) => {
            const b = bounds.get(leverKey(l))!;
            const v = valueOf(l);
            const hitBound = v >= b.max;
            return (
              <div className={styles.sliderRow} key={leverKey(l)}>
                <span className="zh">
                  {leverLabel(l)}
                  <span style={{ color: "var(--muted2)", fontSize: 10 }}> · {zh.sim.proj.lever.current} {fmtLeverValue(l.currentValue, l.valueKind, l.unit, b.pct)}</span>
                </span>
                <input
                  type="range"
                  min={b.min}
                  max={b.max}
                  step={b.step}
                  value={v}
                  aria-label={leverLabel(l)}
                  data-testid={`lever-slider-${l.prop}`}
                  data-object-id={l.objectId}
                  data-object-type={l.objectType}
                  onChange={(e) => setValues((prev) => ({ ...prev, [leverKey(l)]: parseFloat(e.target.value) }))}
                />
                <b className="mono" data-testid={`lever-value-${l.prop}`}>{fmtLeverValue(v, l.valueKind, l.unit, b.pct)}</b>
                {hitBound && b.gated && (
                  <span className={styles.noteAmber} data-testid={`lever-bound-${l.prop}`} style={{ marginLeft: 6, fontSize: 10 }}>
                    {zh.sim.proj.lever.ruleGate(`${Math.round(c08Ratio * 100)}%`)}
                  </span>
                )}
              </div>
            );
          })}

          {/* A/B 对比 + 真重算 deltas（before/after + 每值 provenance R13） */}
          <div className={styles.abCompare} data-testid="lever-ab">
            <div>
              <span>{beforeLabel ?? zh.sim.proj.before}</span>
              <b data-testid="lever-before-p50">{fmt(baseP50)}</b>
            </div>
            <div>
              <span>影响面</span>
              <b data-testid="lever-affected-count">{out?.affectedObjects ?? 0}</b>
            </div>
            {/* D5 · 在途可见：拖杠杆触发的重算不再无声——已耗时（秒级递增）+ 主动取消。
                本面板杠杆全是滑杆（连续控件）→ 按仓主定案**不弹二次确认框**（每动一下弹一次不可用），
                照旧 debounce + 取消前序（D1 并线后底层求解真的会停，取消本就免费）。 */}
            {live.isFetching && (
              <div data-testid="lever-live-inflight">
                <span>求解中 · 已耗时</span>
                <b className="mono" data-testid="lever-live-elapsed">{Math.floor(live.elapsedMs / 1000)}s</b>
                <button className="btn sm" data-testid="lever-live-cancel" style={{ marginLeft: 6 }} onClick={live.cancel} title="放弃本次重算（服务端会真的中止底层求解）">
                  取消
                </button>
              </div>
            )}
          </div>

          {out && out.count > 0 && (
            <div style={{ marginTop: 8 }} data-testid="lever-deltas">
              <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 4 }}>{zh.sim.proj.lever.deltaTitle(out.rows.length)}</div>
              <table className="cmp">
                <thead>
                  <tr><th>对象</th><th>派生字段</th><th>before</th><th>after</th><th>变化</th></tr>
                </thead>
                <tbody>
                  {out.rows.map((r, i) => {
                    const dir = deltaDir(r.before, r.after);
                    return (
                      <tr key={`${r.objectId}-${r.prop}-${i}`} data-testid={`lever-delta-row-${r.objectId}-${r.prop}`}>
                        <td className="mono" style={{ fontSize: 10 }}>{r.objectId}</td>
                        <td className="mono">{r.prop}</td>
                        <td className="mono" data-testid={`lever-before-${r.objectId}-${r.prop}`}>{fmt(Number(r.before), 3)}</td>
                        <td className="mono" data-testid={`lever-after-${r.objectId}-${r.prop}`} style={{ fontWeight: 600 }}>
                          <Provenance
                            testId={`ld-${r.objectId}-${r.prop}`}
                            src="generic_inference · recompute(dryRun)"
                            formula={zh.sim.proj.lever.provFormula}
                            inputs={[`${r.type}.${r.prop}`, ...activeApply.map((a) => `${a.objectType}.${a.prop}=${a.value}`)]}
                            rule="C03/C08"
                          >
                            {fmt(Number(r.after), 3)}
                          </Provenance>
                        </td>
                        <td className="mono" data-testid={`lever-diff-${r.objectId}-${r.prop}`} style={dir ? { color: dir.color, fontWeight: 600 } : undefined}>
                          {dir ? `${dir.arrow} ${dir.diff}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ⑤ 多方案利弊量化矩阵（每方案 generic_inference 真算·一键采纳回填） */}
          <div style={{ marginTop: 12 }} data-testid="lever-scheme-matrix">
            <div className="section-title">{zh.sim.proj.lever.schemeTitle}</div>
            <div className={styles.noteInfo}>{zh.sim.proj.lever.schemeHint}</div>
            {schemesQ.data && (
              <table className="cmp">
                <thead>
                  <tr>
                    <th>{zh.sim.proj.lever.col.scheme}</th>
                    <th>{zh.sim.proj.lever.col.capGain}</th>
                    <th>{zh.sim.proj.lever.col.impact}</th>
                    <th>{zh.sim.proj.lever.col.ruleFlag}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {schemesQ.data.map((s) => (
                    <tr key={s.key} data-testid={`scheme-row-${s.key}`}>
                      <td className="zh"><b>{s.label}</b></td>
                      <td className="mono" data-testid={`scheme-capgain-${s.key}`}>
                        <Provenance testId={`scheme-prov-${s.key}`} src="generic_inference · 方案重算" formula={zh.sim.proj.lever.provFormula} inputs={[s.label]}>
                          {fmt(s.capGain, 3)}
                        </Provenance>
                      </td>
                      <td className="mono" data-testid={`scheme-impact-${s.key}`}>{s.impact}</td>
                      <td data-testid={`scheme-rule-${s.key}`}>{s.ruleFlag ? "⚠ C08" : "—"}</td>
                      <td>
                        <button className="btn sm" data-testid={`scheme-adopt-${s.key}`} onClick={() => applyScheme(s.key)}>
                          {zh.sim.proj.lever.adoptScheme}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <Feature flag="act.adopt-to-draft">
            <button className="btn sm primary" style={{ marginTop: 10 }} data-testid="lever-adopt" onClick={() => adoptCombo(activeApply.length > 0 ? activeApply : schemes[0]?.apply ?? [])}>
              {zh.sim.proj.lever.adopt}（杠杆组合 + 推演快照 → Action）
            </button>
          </Feature>
        </>
      )}
    </div>
  );
}
