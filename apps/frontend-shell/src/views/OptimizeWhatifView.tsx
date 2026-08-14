import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeSolver } from "@/api/endpoints";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";

/**
 * 优化推演页（renderer=optimize-whatif·闭 G-12 前端半）——把 `optimize_whatif`（轨B·增量3）从"一个 Δ 数字"
 * 升级为**让用户看懂的决策比对**：结构化可编辑输入（改前局面）→ 白话推演控制（改哪个参数到多少）→
 * **基线方案 vs 扰动后方案**并排（开哪些设施 / 怎么指派 / 总成本），直接看到"改一个参数，最优决策怎么切换"。
 * 支持**二次推演**：输入/推演随时改，点「推演」重解、重比对。
 *
 * KILL-MOCK 铁律：Δ / 方案结构全部从真 sidecar CP-SAT 重解输出渲染（后端 baselineSolution/perturbedSolution 透传·
 * service.ts SOLVER_OUTPUT_SHAPES.optimize_whatif）；改输入/扰动→重取→决策真变（非写死）。
 * 诚实态：本地无 OPTIMIZER_BASE_URL → 后端返「未接入最优化引擎」→ 本页诚实提示（非空白 / 非假 Δ）。
 */

/** 5 CP-SAT 核心 family（= app.ts OPT_FAMILIES·抽象优化模板池，零业务常数）。 */
const FAMILIES: { key: string; label: string; hint: string }[] = [
  { key: "facility_location", label: "选址（基地×订单）", hint: "选开哪些设施 + 每个订单在哪生产·min 总成本" },
  { key: "min_cost_flow", label: "调拨网络", hint: "供需网络·min 运输成本" },
  { key: "set_cover", label: "覆盖布点", hint: "最少集合覆盖全域" },
  { key: "independent_set", label: "互斥选取", hint: "最大权互不相邻节点集" },
  { key: "combinatorial_auction", label: "组合中标", hint: "最大化中标组合价值" },
];

/** 每 family 的最小基线示例（抽象结构·零业务常数）——让页面开箱即可跑一个真解。 */
const FAMILY_EXAMPLE: Record<string, Record<string, unknown>> = {
  facility_location: {
    facilities: [
      { id: "f1", openCost: 100, capacity: 10 },
      { id: "f2", openCost: 120, capacity: 10 },
    ],
    clients: [
      { id: "c1", demand: 3 },
      { id: "c2", demand: 4 },
    ],
    assignCosts: [
      { client: "c1", facility: "f1", cost: 5 },
      { client: "c1", facility: "f2", cost: 8 },
      { client: "c2", facility: "f1", cost: 9 },
      { client: "c2", facility: "f2", cost: 4 },
    ],
  },
  min_cost_flow: {
    nodes: [{ id: "s1", supply: 10 }, { id: "s2", supply: 5 }, { id: "d1", supply: -8 }, { id: "d2", supply: -7 }],
    arcs: [
      { from: "s1", to: "d1", cost: 4, cap: 10 }, { from: "s1", to: "d2", cost: 6, cap: 10 },
      { from: "s2", to: "d1", cost: 5, cap: 10 }, { from: "s2", to: "d2", cost: 3, cap: 10 },
    ],
  },
  set_cover: {
    sets: [
      { id: "A", cost: 3, covers: ["e1", "e2", "e3"] }, { id: "B", cost: 2, covers: ["e2", "e4"] },
      { id: "C", cost: 4, covers: ["e3", "e4", "e5"] }, { id: "D", cost: 2, covers: ["e5", "e1"] },
    ],
  },
  independent_set: {
    nodes: [{ id: "n1", weight: 5 }, { id: "n2", weight: 4 }, { id: "n3", weight: 6 }, { id: "n4", weight: 3 }],
    edges: [{ a: "n1", b: "n2" }, { a: "n2", b: "n3" }, { a: "n3", b: "n4" }],
  },
  combinatorial_auction: {
    bids: [
      { id: "b1", value: 10, items: ["i1", "i2"] }, { id: "b2", value: 8, items: ["i2", "i3"] },
      { id: "b3", value: 6, items: ["i3"] }, { id: "b4", value: 7, items: ["i1"] },
    ],
  },
};

/** 每 family 的默认扰动 target（开箱预置一条·让页面打开即可"推演"·target 接地到该 family 的对象·DF.8）。 */
const FAMILY_DEFAULT_PERTURB: Record<string, { target: string; value: number }> = {
  facility_location: { target: "facilities.f1.openCost", value: 150 },
  min_cost_flow: { target: "arcs.s2-d2.cost", value: 9 },
  set_cover: { target: "sets.A.cost", value: 8 },
  independent_set: { target: "nodes.n3.weight", value: 2 },
  combinatorial_auction: { target: "bids.b1.value", value: 3 },
};

/** 中文口径标签（让"看懂"·未知字段回落原名）。 */
const COLL_LABEL: Record<string, string> = { facilities: "候选基地", clients: "订单需求", assignCosts: "指派成本", nodes: "节点", arcs: "调拨弧", sets: "候选集合", edges: "冲突边", bids: "投标包" };
const FIELD_LABEL: Record<string, string> = { openCost: "开设成本", capacity: "产能", demand: "需求量", cost: "成本", supply: "供给量", cap: "容量上限", weight: "权重", value: "价值", covers: "覆盖元素", items: "含物品" };
const collLabel = (k: string) => COLL_LABEL[k] ?? k;
const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k;

/** 可扰动数值字段白名单（决定哪些格子可编辑 + 哪些可当推演 target）。 */
const NUMERIC_FIELDS = ["openCost", "capacity", "demand", "cost", "supply", "cap", "weight", "value"];

interface FLSolution {
  openFacilities?: string[];
  assignments?: { client: string; facility: string }[];
  objective?: number;
  optimal?: boolean;
  [k: string]: unknown;
}
/** optimize_whatif 输出（= SOLVER_OUTPUT_SHAPES.optimize_whatif·含决策比对方案结构透传）。 */
interface OptWhatifOutput {
  baselineObjective: number | null;
  perturbedObjective: number | null;
  deltaObjective: number | null;
  feasible: boolean;
  conflictConstraints: string[];
  explanation: string;
  baselineSolution?: FLSolution;
  perturbedSolution?: FLSolution;
  summary?: string;
  optimal?: boolean;
  status?: string;
}

const fmt = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—");

/** 稳定 id（arcs 用 from-to 复合）。 */
const itemId = (coll: string, item: Record<string, unknown>): string => (coll === "arcs" ? `${item.from}-${item.to}` : String(item.id ?? ""));

/** 深克隆（结构化 args 全 JSON 可序列化）。 */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 把 data_override 扰动施加到 baseline 克隆（前端只为算"扰动后局面/成本明细"·真解仍在后端）。 */
function applyPerturbs(base: Record<string, unknown>, perturbs: { target: string; value: number }[]): Record<string, unknown> {
  const a = clone(base);
  for (const p of perturbs) {
    const [coll, id, field] = p.target.split(".");
    const arr = a[coll!] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) continue;
    const obj = arr.find((e) => itemId(coll!, e) === id);
    if (!obj) continue;
    const f = field ?? (coll === "facilities" ? "openCost" : coll === "bids" ? "value" : "cost");
    if (Number.isFinite(p.value)) obj[f] = p.value;
  }
  return a;
}

/** 从 baseline 派生所有可扰动 target（collection.id.field + 当前值 + 中文标签）。 */
function perturbTargets(baseline: Record<string, unknown>): { value: string; label: string; current: number }[] {
  const out: { value: string; label: string; current: number }[] = [];
  for (const [coll, arr] of Object.entries(baseline)) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr as Record<string, unknown>[]) {
      const id = itemId(coll, item);
      if (!id) continue;
      for (const f of NUMERIC_FIELDS) {
        if (typeof item[f] === "number") out.push({ value: `${coll}.${id}.${f}`, label: `${collLabel(coll)} ${id} · ${fieldLabel(f)}`, current: item[f] as number });
      }
    }
  }
  return out;
}

export default function OptimizeWhatifView({ view }: { view?: ViewConfigVM }) {
  const initialFamily = (view?.layout as { family?: string } | undefined)?.family ?? "facility_location";
  const [family, setFamily] = useState(initialFamily);
  const [baseline, setBaseline] = useState<Record<string, unknown>>(() => clone(FAMILY_EXAMPLE[initialFamily] ?? {}));
  const [perturbs, setPerturbs] = useState<{ target: string; value: number }[]>(() => {
    const d = FAMILY_DEFAULT_PERTURB[initialFamily];
    return d ? [{ ...d }] : [];
  });
  // 已提交求解的入参（点「推演」才更新·支持二次推演：改后再点即重解）。
  const [submitted, setSubmitted] = useState<{ family: string; baseline: Record<string, unknown>; perturbs: { target: string; value: number }[] } | null>(null);

  const onPickFamily = (k: string) => {
    setFamily(k);
    setBaseline(clone(FAMILY_EXAMPLE[k] ?? {}));
    const d = FAMILY_DEFAULT_PERTURB[k];
    setPerturbs(d ? [{ ...d }] : []);
    setSubmitted(null);
  };

  const targets = useMemo(() => perturbTargets(baseline), [baseline]);

  // 编辑基线数值格（immutable 更新）。
  const editCell = (coll: string, idx: number, field: string, raw: string) => {
    setBaseline((prev) => {
      const next = clone(prev);
      const arr = next[coll] as Record<string, unknown>[];
      const num = Number(raw);
      arr[idx]![field] = raw === "" ? "" : Number.isFinite(num) ? num : arr[idx]![field];
      return next;
    });
  };
  const editPerturb = (i: number, patch: Partial<{ target: string; value: number }>) =>
    setPerturbs((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addPerturb = () => setPerturbs((prev) => [...prev, { target: targets[0]?.value ?? "", value: targets[0]?.current ?? 0 }]);
  const removePerturb = (i: number) => setPerturbs((prev) => prev.filter((_, j) => j !== i));

  const runSolve = () => setSubmitted({ family, baseline: clone(baseline), perturbs: clone(perturbs) });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "optimize_whatif", submitted?.family, JSON.stringify(submitted?.baseline), JSON.stringify(submitted?.perturbs)],
    enabled: submitted != null && (submitted?.perturbs.length ?? 0) > 0,
    retry: false,
    queryFn: async () => {
      const perturbations = submitted!.perturbs.map((p) => ({ kind: "data_override", target: p.target, value: p.value }));
      const res = await invokeSolver("optimize_whatif", { family: submitted!.family, args: submitted!.baseline, perturbations, seed: 42 });
      return res.data as OptWhatifOutput;
    },
  });

  const errMsg = (error as { message?: string } | undefined)?.message ?? "";
  const unavailable = isError && /未接入|OPTIMIZER_BASE_URL|not.?configured/i.test(errMsg);
  const activeFamily = FAMILIES.find((f) => f.key === family);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="optimize-whatif">
      {/* 标题 + family 选择 */}
      <div className="panel">
        <div className="section-title">优化推演 · {activeFamily?.label ?? family}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.6 }}>{activeFamily?.hint}——改一个参数，看最优决策怎么变。</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {FAMILIES.map((f) => (
            <button key={f.key} data-testid={`ow-family-${f.key}`} className={`btn sm${family === f.key ? " primary" : ""}`} title={f.hint} onClick={() => onPickFamily(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ① 输入 · 当前局面（可编辑数值格） */}
      <div className="panel" data-testid="ow-input">
        <div className="section-title">① 输入 · 当前局面<span style={{ fontSize: 12, color: "var(--muted2)", fontWeight: 400, marginLeft: 8 }}>数值格可直接改</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 8 }}>
          {Object.entries(baseline).map(([coll, arr]) =>
            Array.isArray(arr) && arr.length > 0 ? <EditableTable key={coll} coll={coll} rows={arr as Record<string, unknown>[]} onEdit={editCell} /> : null,
          )}
        </div>
      </div>

      {/* ② 推演 · 改参数 */}
      <div className="panel" data-testid="ow-perturb">
        <div className="section-title">② 推演 · 改一个参数看影响</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {perturbs.map((p, i) => {
            const cur = targets.find((t) => t.value === p.target)?.current;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} data-testid={`ow-perturb-${i}`}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>把</span>
                <select data-testid={`ow-perturb-target-${i}`} value={p.target} onChange={(e) => editPerturb(i, { target: e.target.value })} style={selStyle}>
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {typeof cur === "number" && <span style={{ fontSize: 12, color: "var(--muted2)" }}>从 <span className="mono">{cur}</span></span>}
                <span style={{ color: "var(--muted2)" }}>改为</span>
                <input type="number" data-testid={`ow-perturb-value-${i}`} value={p.value} onChange={(e) => editPerturb(i, { value: Number(e.target.value) })} style={numStyle} />
                {perturbs.length > 1 && <button className="btn sm" data-testid={`ow-perturb-remove-${i}`} onClick={() => removePerturb(i)} title="移除这条">✕</button>}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn sm" data-testid="ow-perturb-add" onClick={addPerturb} disabled={targets.length === 0}>＋ 再加一条</button>
            <button className="btn primary" data-testid="ow-solve" onClick={runSolve} disabled={perturbs.length === 0} style={{ marginLeft: "auto" }}>
              推演 →
            </button>
          </div>
          {perturbs.length === 0 && <div style={{ fontSize: 12, color: "var(--amber-txt)" }}>至少加一条推演（改一个参数）才能求解。</div>}
        </div>
      </div>

      {/* ③ 结果 · 决策怎么变 */}
      {submitted && isLoading && <div className="empty-state" data-testid="ow-loading">{zh.common.loading}</div>}

      {unavailable && (
        <div className="empty-state" data-testid="ow-unavailable">
          <div className="code">🔌</div>
          <div style={{ fontWeight: 600, color: "var(--txt)" }}>未接入最优化引擎</div>
          <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center", lineHeight: 1.7 }}>
            optimize_whatif 需 CP-SAT sidecar（services/optimizer）。本地内存模式请设 <span className="mono">OPTIMIZER_BASE_URL</span> 并起 sidecar（见 DEPLOY.md）；compose 态已自动接入。诚实空态·不假渲 Δ。
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}>{errMsg}</div>
          </div>
        </div>
      )}

      {isError && !unavailable && (
        <div className="empty-state" data-testid="ow-error">
          <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center" }}>求解失败：{errMsg || "未知错误"}</div>
        </div>
      )}

      {data && !isError && submitted && <DecisionResult out={data} family={submitted.family} baseArgs={submitted.baseline} perturbs={submitted.perturbs} />}
    </div>
  );
}

/** 可编辑数值表：数值格 → input，非数值（id/from/to/covers…）→ 文本。 */
function EditableTable({ coll, rows, onEdit }: { coll: string; rows: Record<string, unknown>[]; onEdit: (coll: string, idx: number, field: string, raw: string) => void }) {
  const cols = Object.keys(rows[0] ?? {});
  return (
    <div className="panel" style={{ padding: "10px 12px", background: "var(--panel2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{collLabel(coll)}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>{cols.map((c) => <th key={c} style={{ textAlign: NUMERIC_FIELDS.includes(c) ? "right" : "left", color: "var(--muted2)", fontWeight: 600, padding: "3px 6px", fontSize: 12 }}>{fieldLabel(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {cols.map((c) => {
                const v = row[c];
                const editable = typeof v === "number" && NUMERIC_FIELDS.includes(c);
                return (
                  <td key={c} style={{ padding: "3px 6px", borderTop: "1px solid var(--line)", textAlign: editable ? "right" : "left" }}>
                    {editable ? (
                      <input
                        type="number"
                        data-testid={`ow-cell-${coll}-${itemId(coll, row)}-${c}`}
                        value={v as number}
                        onChange={(e) => onEdit(coll, idx, c, e.target.value)}
                        style={{ width: 62, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, padding: "2px 5px", borderRadius: 5, border: "1px solid var(--line2)", background: "var(--bg2)", color: "var(--txt)" }}
                      />
                    ) : Array.isArray(v) ? (
                      <span style={{ color: "var(--muted)" }}>{v.join(", ")}</span>
                    ) : (
                      <span className="mono" style={{ fontWeight: c === "id" ? 600 : 400 }}>{String(v)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 结果区：决策切换横幅 + 基线/扰动后方案并排 + Δ + 白话解读。 */
function DecisionResult({ out, family, baseArgs, perturbs }: { out: OptWhatifOutput; family: string; baseArgs: Record<string, unknown>; perturbs: { target: string; value: number }[] }) {
  const { baselineObjective, perturbedObjective, deltaObjective, feasible, conflictConstraints, explanation, baselineSolution, perturbedSolution } = out;
  const delta = typeof deltaObjective === "number" ? deltaObjective : null;
  const deltaColor = delta == null ? "var(--muted)" : delta > 0 ? "var(--amber)" : delta < 0 ? "var(--ok)" : "var(--muted)";
  const perturbedArgs = useMemo(() => applyPerturbs(baseArgs, perturbs), [baseArgs, perturbs]);

  const isFL = family === "facility_location" && (baselineSolution?.openFacilities || perturbedSolution?.openFacilities);
  const baseOpen = baselineSolution?.openFacilities ?? [];
  const pertOpen = perturbedSolution?.openFacilities ?? [];
  const switched = isFL && feasible && JSON.stringify([...baseOpen].sort()) !== JSON.stringify([...pertOpen].sort());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="ow-result">
      {/* 决策切换横幅 / Δ */}
      <div
        className="panel"
        data-testid={switched ? "ow-switch-banner" : "ow-delta-banner"}
        style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderLeft: `3px solid ${switched ? "var(--accent)" : deltaColor}` }}
      >
        {switched ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-txt)" }}>决策切换</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 7, background: "var(--hover-tint-strong)" }}>
              开 {baseOpen.join("/")} → 开 {pertOpen.join("/")}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>最优方案变了：改参后原方案不再划算，求解器自动改选</span>
          </>
        ) : (
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--txt)" }}>{feasible ? "最优决策不变（只是成本变化）" : "扰动后不可行"}</span>
        )}
        <span className="mono" data-testid="ow-delta-obj" style={{ marginLeft: "auto", fontSize: 20, fontWeight: 700, color: deltaColor }}>
          {delta != null && delta > 0 ? "+" : ""}{fmt(deltaObjective)}
        </span>
      </div>

      {/* 基线 vs 扰动后 方案并排 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <SolutionCard testid="ow-baseline-card" title="基线方案" tag="改前" tagKind="base" family={family} args={baseArgs} solution={baselineSolution} objective={baselineObjective} feasible />
        <SolutionCard testid="ow-perturbed-card" title="扰动后方案" tag="改后" tagKind="pert" family={family} args={perturbedArgs} solution={perturbedSolution} objective={perturbedObjective} feasible={feasible} />
      </div>

      {/* 可行性 / 冲突约束（不可行时才展开） */}
      <div className="panel" data-testid="ow-feasibility" style={{ padding: "10px 12px" }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>可行性 </span>
        <span className={`badge ${feasible ? "green" : "red"}`} data-testid="ow-feasible" data-feasible={feasible ? "1" : "0"}>{feasible ? "可行" : "不可行"}</span>
        {!feasible && conflictConstraints.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {conflictConstraints.map((c, i) => (
              <div key={i} data-testid={`ow-conflict-${i}`} style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--danger-txt)" }}>· {c}</div>
            ))}
          </div>
        )}
      </div>

      {/* 白话解读 */}
      <div className="panel" data-testid="ow-explanation" style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted2)", marginBottom: 5 }}>一句话解读</div>
        <div style={{ fontSize: 13, color: "var(--txt)", lineHeight: 1.75 }}>{explanation || "—"}</div>
      </div>
    </div>
  );
}

/** 单个方案卡：facility_location 渲"开哪些设施 + 怎么指派 + 成本明细"；其余 family 渲通用"选中项 + 目标值"。 */
function SolutionCard({
  testid, title, tag, tagKind, family, args, solution, objective, feasible,
}: {
  testid: string; title: string; tag: string; tagKind: "base" | "pert"; family: string; args: Record<string, unknown>; solution?: FLSolution; objective: number | null; feasible: boolean;
}) {
  const infeasible = !feasible && tagKind === "pert";
  return (
    <div className="panel" data-testid={testid} style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{title}</span>
        <span className="badge" style={tagKind === "pert" ? { background: "var(--accent)", color: "var(--on-accent)" } : undefined}>{tag}</span>
      </div>
      {infeasible ? (
        <div style={{ fontSize: 12.5, color: "var(--danger-txt)", padding: "8px 0" }}>扰动后无可行方案（约束冲突）。</div>
      ) : family === "facility_location" ? (
        <FacilityBody args={args} solution={solution} objective={objective} />
      ) : (
        <GenericBody solution={solution} objective={objective} />
      )}
    </div>
  );
}

/** facility_location 方案主体：每个设施 开/不开 + 客户指派 + 成本明细。 */
function FacilityBody({ args, solution, objective }: { args: Record<string, unknown>; solution?: FLSolution; objective: number | null }) {
  const facilities = (args.facilities as { id: string; openCost: number; capacity?: number }[]) ?? [];
  const assignCosts = (args.assignCosts as { client: string; facility: string; cost: number }[]) ?? [];
  const open = new Set(solution?.openFacilities ?? []);
  const assignments = solution?.assignments ?? [];
  const openCostSum = facilities.filter((f) => open.has(f.id)).reduce((s, f) => s + f.openCost, 0);
  const assignSum = assignments.reduce((s, a) => s + (assignCosts.find((x) => x.client === a.client && x.facility === a.facility)?.cost ?? 0), 0);
  const byFac = (fid: string) => assignments.filter((a) => a.facility === fid).map((a) => a.client);

  return (
    <div>
      {facilities.map((f) => {
        const isOpen = open.has(f.id);
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, marginBottom: 5, border: "1px solid var(--line)", background: isOpen ? "rgba(98,190,119,.1)" : "transparent", opacity: isOpen ? 1 : 0.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: isOpen ? "var(--ok)" : "var(--muted2)" }} />
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{f.id}</span>
            {isOpen && byFac(f.id).length > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>← {byFac(f.id).join(", ")}</span>}
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: isOpen ? "var(--ok-txt)" : "var(--muted2)" }}>{isOpen ? "✓ 开设" : "✗ 不开"}</span>
          </div>
        );
      })}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted2)" }}>总成本</div>
          <div style={{ fontSize: 12, color: "var(--muted2)", fontFamily: "var(--font-mono)" }}>开设 {openCostSum} + 指派 {assignSum}</div>
        </div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{fmt(objective)}</div>
      </div>
    </div>
  );
}

/** 通用方案主体（非 FL family）：把解里的数组字段（chosen/winners/flows…）列出 + 目标值。 */
function GenericBody({ solution, objective }: { solution?: FLSolution; objective: number | null }) {
  const arrays = Object.entries(solution ?? {}).filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];
  return (
    <div>
      {arrays.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted2)" }}>（方案结构见目标值）</div>
      ) : (
        arrays.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted2)" }}>{fieldLabel(k)}：</span>
            <span className="mono" style={{ fontSize: 12 }}>{v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")}</span>
          </div>
        ))
      )}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, color: "var(--muted2)" }}>目标值</div>
        <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{fmt(objective)}</div>
      </div>
    </div>
  );
}

const selStyle: React.CSSProperties = { fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--line2)", background: "var(--bg2)", color: "var(--txt)" };
const numStyle: React.CSSProperties = { width: 80, fontFamily: "var(--font-mono)", fontSize: 12.5, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--accent)", background: "var(--bg2)", color: "var(--txt)", fontWeight: 700 };
