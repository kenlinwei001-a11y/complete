import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeSolver } from "@/api/endpoints";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";

/**
 * 优化推演页（renderer=optimize-whatif·闭 G-12 前端半）——把 `optimize_whatif` 求解器（轨B·增量3）的
 * **结构化扰动→sidecar 重解→Δ目标** 产物落地为一张页：选 family（5 CP-SAT 核心之一）+ 编辑扰动（改目标/约束）
 * → 调真 `invokeSolver('optimize_whatif')` → 渲 baseline→perturbed 的 **Δ目标** + feasible 徽标 +
 * conflictConstraints 列表 + explanation 文案。
 *
 * KILL-MOCK 铁律：Δ/feasible/conflict 全部从真 sidecar CP-SAT 重解输出渲染（改扰动→重取→Δ 真变·非写死）。
 * 诚实态：sidecar 未接入（本地无 OPTIMIZER_BASE_URL）→ 后端返「未接入最优化引擎」→ 本页**诚实提示**（非空白/非假 Δ）。
 * MSW mock 仅测渲染逻辑；真解须打到 services/optimizer/server.py（见 DEPLOY.md 本地起 sidecar）。
 */

/** 5 CP-SAT 核心 family（= app.ts OPT_FAMILIES·抽象优化模板池，零业务常数）。 */
const FAMILIES: { key: string; label: string; hint: string }[] = [
  { key: "facility_location", label: "选址 facility_location", hint: "选开设施 + 客户指派·min 总成本" },
  { key: "min_cost_flow", label: "最小费用流 min_cost_flow", hint: "供需网络·min 运输成本" },
  { key: "set_cover", label: "集合覆盖 set_cover", hint: "最少集合覆盖全域" },
  { key: "independent_set", label: "独立集 independent_set", hint: "最大权互不相邻节点集" },
  { key: "combinatorial_auction", label: "组合拍卖 combinatorial_auction", hint: "最大化中标组合价值" },
];

/** 每 family 的最小基线示例（抽象结构·零业务常数·dev 可改）——让页面开箱即可跑一个真解。 */
const FAMILY_EXAMPLE: Record<string, string> = {
  facility_location: JSON.stringify(
    {
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
    null,
    2,
  ),
  min_cost_flow: JSON.stringify({ nodes: [], arcs: [] }, null, 2),
  set_cover: JSON.stringify({ universe: [], sets: [] }, null, 2),
  independent_set: JSON.stringify({ nodes: [], edges: [] }, null, 2),
  combinatorial_auction: JSON.stringify({ items: [], bids: [] }, null, 2),
};

/** optimize_whatif 输出（= SOLVER_OUTPUT_SHAPES.optimize_whatif·service.ts:145）。 */
interface OptWhatifOutput {
  baselineObjective: number | null;
  perturbedObjective: number | null;
  deltaObjective: number | null;
  feasible: boolean;
  conflictConstraints: string[];
  explanation: string;
  summary?: string;
  optimal?: boolean;
  status?: string;
}

const fmt = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—");

export default function OptimizeWhatifView({ view }: { view?: ViewConfigVM }) {
  const initialFamily = (view?.layout as { family?: string } | undefined)?.family ?? "facility_location";
  const [family, setFamily] = useState(initialFamily);
  const [baselineText, setBaselineText] = useState(FAMILY_EXAMPLE[initialFamily] ?? "{}");
  const [perturbText, setPerturbText] = useState(JSON.stringify([{ kind: "cost", target: "facilities.f1.openCost", delta: 50 }], null, 2));  // 接地格式须 <collection>.<id>[.<field>]（opt-whatif.ts）；裸 "f1" 会接地失败
  // 已提交求解的入参（点「求解」才更新·避免每次敲键重取）。
  const [submitted, setSubmitted] = useState<{ family: string; baseline: string; perturb: string } | null>(null);

  const onPickFamily = (k: string) => {
    setFamily(k);
    setBaselineText(FAMILY_EXAMPLE[k] ?? "{}");
  };

  const parseErr = useMemo(() => {
    if (!submitted) return null;
    try {
      JSON.parse(submitted.baseline);
      JSON.parse(submitted.perturb);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [submitted]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "optimize_whatif", submitted?.family, submitted?.baseline, submitted?.perturb],
    enabled: submitted != null && parseErr == null,
    retry: false,
    queryFn: async () => {
      const args = JSON.parse(submitted!.baseline) as Record<string, unknown>;
      const perturbations = JSON.parse(submitted!.perturb) as unknown[];
      const res = await invokeSolver("optimize_whatif", { family: submitted!.family, args, perturbations, seed: 42 });
      return res.data as OptWhatifOutput;
    },
  });

  const errMsg = (error as { message?: string } | undefined)?.message ?? "";
  const unavailable = isError && /未接入|OPTIMIZER_BASE_URL|not.?configured/i.test(errMsg);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="optimize-whatif">
      {/* ── 控制区：family + 基线 + 扰动 ── */}
      <div className="panel" data-testid="ow-controls">
        <div className="section-title">优化推演 · 改目标/约束 → 真 CP-SAT 重解 → Δ目标</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {FAMILIES.map((f) => (
            <button
              key={f.key}
              data-testid={`ow-family-${f.key}`}
              className={`btn sm${family === f.key ? " primary" : ""}`}
              title={f.hint}
              onClick={() => onPickFamily(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            基线结构（抽象·零业务常数）
            <textarea
              data-testid="ow-baseline"
              value={baselineText}
              onChange={(e) => setBaselineText(e.target.value)}
              spellCheck={false}
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, minHeight: 160, padding: 8, borderRadius: 8, border: "1px solid var(--line2)", background: "var(--panel2)", color: "var(--txt)" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            扰动（改目标/约束 → Δ 真变）
            <textarea
              data-testid="ow-perturbations"
              value={perturbText}
              onChange={(e) => setPerturbText(e.target.value)}
              spellCheck={false}
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, minHeight: 160, padding: 8, borderRadius: 8, border: "1px solid var(--line2)", background: "var(--panel2)", color: "var(--txt)" }}
            />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            data-testid="ow-solve"
            onClick={() => setSubmitted({ family, baseline: baselineText, perturb: perturbText })}
          >
            求解 → Δ目标
          </button>
        </div>
      </div>

      {/* ── 结果区 ── */}
      {parseErr && (
        <div className="panel" data-testid="ow-parse-error" style={{ borderLeft: "3px solid var(--danger)" }}>
          <div style={{ fontSize: 12, color: "var(--danger)" }}>入参 JSON 解析失败（诚实报错·不假解）：{parseErr}</div>
        </div>
      )}

      {submitted && !parseErr && isLoading && <div className="empty-state" data-testid="ow-loading">{zh.common.loading}</div>}

      {/* 诚实未接入态：本地无 sidecar → 后端返「未接入」→ 不假渲 Δ。 */}
      {unavailable && (
        <div className="empty-state" data-testid="ow-unavailable">
          <div className="code">🔌</div>
          <div style={{ fontWeight: 600, color: "var(--txt)" }}>未接入最优化引擎</div>
          <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center", lineHeight: 1.7 }}>
            optimize_whatif 需 CP-SAT sidecar（services/optimizer）。本地内存模式请设{" "}
            <span className="mono">OPTIMIZER_BASE_URL</span> 并起 sidecar（见 DEPLOY.md）；compose 态已自动接入。诚实空态·不假渲 Δ。
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 11 }}>{errMsg}</div>
          </div>
        </div>
      )}

      {isError && !unavailable && (
        <div className="empty-state" data-testid="ow-error">
          <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center" }}>求解失败：{errMsg || "未知错误"}</div>
        </div>
      )}

      {data && !isError && <OptWhatifResult out={data} />}
    </div>
  );
}

function OptWhatifResult({ out }: { out: OptWhatifOutput }) {
  const { baselineObjective, perturbedObjective, deltaObjective, feasible, conflictConstraints, explanation, optimal, status } = out;
  const delta = typeof deltaObjective === "number" ? deltaObjective : null;
  const deltaColor = delta == null ? "var(--muted)" : delta > 0 ? "var(--amber)" : delta < 0 ? "var(--ok)" : "var(--muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="ow-result">
      {/* Δ目标三联 */}
      <div className="panel" data-testid="ow-objectives">
        <div className="section-title">Δ目标 · baseline → perturbed{(optimal || status) && <span className="badge green" data-testid="ow-optimal" style={{ marginLeft: 8, fontSize: 9 }}>{status ?? (optimal ? "OPTIMAL" : "")}·可证最优</span>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <div className="panel" style={{ padding: 12, background: "var(--panel2)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>基线目标</div>
            <div className="mono" data-testid="ow-baseline-obj" style={{ fontSize: 20, fontWeight: 700 }}>{fmt(baselineObjective)}</div>
          </div>
          <div className="panel" style={{ padding: 12, background: "var(--panel2)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>扰动后目标</div>
            <div className="mono" data-testid="ow-perturbed-obj" style={{ fontSize: 20, fontWeight: 700 }}>{fmt(perturbedObjective)}</div>
          </div>
          <div className="panel" style={{ padding: 12, background: "var(--panel2)", borderLeft: `3px solid ${deltaColor}` }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Δ目标</div>
            <div className="mono" data-testid="ow-delta-obj" style={{ fontSize: 20, fontWeight: 700, color: deltaColor }}>
              {delta != null && delta > 0 ? "+" : ""}{fmt(deltaObjective)}
            </div>
          </div>
        </div>
      </div>

      {/* 可行性 + 冲突约束 */}
      <div className="panel" data-testid="ow-feasibility">
        <div className="section-title">
          可行性 ·{" "}
          <span className={`badge ${feasible ? "green" : "red"}`} data-testid="ow-feasible" data-feasible={feasible ? "1" : "0"}>
            {feasible ? "可行" : "不可行"}
          </span>
        </div>
        <div data-testid="ow-conflicts" style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>冲突约束（{conflictConstraints.length}）</div>
          {conflictConstraints.length === 0 ? (
            <div className="empty-state" style={{ padding: 14, fontSize: 12 }} data-testid="ow-conflicts-none">无冲突约束</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {conflictConstraints.map((c, i) => (
                <div key={i} data-testid={`ow-conflict-${i}`} className="panel" style={{ padding: "6px 10px", borderLeft: "3px solid var(--danger)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  {c}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 解释 */}
      <div className="panel" data-testid="ow-explanation">
        <div className="section-title">解释</div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>{explanation || "—"}</div>
      </div>
    </div>
  );
}
