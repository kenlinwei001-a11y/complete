import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CapacityForecastOutputSchema } from "@platform/contracts";
import { searchObjects } from "@/api/endpoints";
import { decisionColor, decisionHeat, decisionVerdictColor } from "@/components/DecisionValue";
import { fmt } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import styles from "./SimViews.module.css";

/**
 * WO-CAP-07-MODEL-DIM（型号维度·链路⑤前端 surface）：在推演沙盘里补一层**电池型号切片**——
 * 后端型号维度早已现成（`capacity_forecast` 按 modelId 建·`catalog.ts:86`；型号可产基地网络 `PRODUCIBLE_AT`
 * `catalog.ts:33`；Model 一等类型 `graphmeta.ts`），此前沙盘只有基地/全局态视角、从不 surface 型号维度。
 * 本组件把该维度接通：选型号 → 调 `capacity_forecast(modelId,qty,weeks)` 出该型号的 P50/P90/缺口/主瓶颈 +
 * **型号级可产基地网络**（perBaseRows=可产基地·走 PRODUCIBLE_AT·带各基地瓶颈/紧张度；nonProducible=不可产基地）。
 *
 * 纪律：
 * - **C2/R14 配置驱动·非写死**：型号列表来自本体 `Model` 对象（`GET /a/v1/objects?type=Model`·真后端），
 *   不内联任何型号常量；无 Model 对象 → 诚实空态（不编造型号）。
 * - **C1 逐值对后端**：P50/P90/缺口/主瓶颈/可产基地全取 `capacity_forecast` 端点原值（`useLiveSolver` 同前端既有路径），
 *   前端只做展示不改算。KILL-MOCK-RED：紧张度无真源（`live!==true`）→ 灰显「估算」不染决策红。
 * - **additive·localized**：新 panel 独立挂载，不动沙盘 KPI/命令条/DAG 区（与并发 KPI 口径修并行不冲突）。
 */
export interface ModelCapacitySliceProps {
  /** what-if 决策入口带入的型号（命中本体型号列表才作初值·否则退列表首项）。 */
  initialModel?: string;
  /** what-if 带入的需求量（万套）/交付周数——作 capacity_forecast 入参初值（缺省用视图默认）。 */
  demand?: number;
  weeks?: number;
  /** 测试注入：绕过网络喂型号列表（证 R14 列表来自数据源·非组件内写死）。 */
  injectedModels?: string[];
}

const DEFAULT_QTY = 40; // 万套（与项目推演同口径·what-if 未带 demand 时的默认需求）
const DEFAULT_WEEKS = 6; // 交付周数默认

export default function ModelCapacitySlice({ initialModel, demand, weeks, injectedModels }: ModelCapacitySliceProps) {
  // C2/R14：型号列表来自本体 Model 对象（真后端 /a/v1/objects?type=Model），非组件内硬编码。
  const modelObjs = useQuery({
    queryKey: ["a", "objects", { type: "Model", view: "sandbox-model-slice" }],
    queryFn: () => searchObjects("Model", ""),
    enabled: injectedModels === undefined,
  });
  const models = useMemo(
    () => injectedModels ?? (modelObjs.data?.items ?? []).map((o) => String(o.props.modelId ?? o.props.name ?? o.id)),
    [injectedModels, modelObjs.data],
  );
  const modelsKey = models.join("|");

  const [modelId, setModelId] = useState("");
  // 列表就绪 → 定型号初值：保留合法当前值 > what-if 带入型号（命中列表）> 列表首项。
  useEffect(() => {
    if (models.length === 0) return;
    setModelId((cur) => {
      if (cur && models.includes(cur)) return cur;
      if (initialModel && models.includes(initialModel)) return initialModel;
      return models[0]!;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey, initialModel]);

  const qty = demand != null && Number.isFinite(demand) ? Math.max(0.1, demand) : DEFAULT_QTY;
  const wk = weeks != null && Number.isFinite(weeks) ? Math.min(52, Math.max(1, Math.round(weeks))) : DEFAULT_WEEKS;

  // C1：逐值取 capacity_forecast 端点（同前端既有 useLiveSolver 路径·debounce+竞态守卫），前端只展示不改算。
  const args = useMemo<Record<string, unknown> | null>(
    () => (modelId ? { modelId, qty, weeks: wk } : null),
    [modelId, qty, wk],
  );
  const forecast = useLiveSolver("capacity_forecast", args, (raw) => CapacityForecastOutputSchema.parse(raw));
  const out = forecast.data;

  const okColor = out ? (out.ok ? "var(--ok)" : decisionVerdictColor("var(--danger)", out.dataMode)) : "var(--muted)";

  return (
    <div className="panel" data-testid="sandbox-model-slice" style={{ padding: "10px 14px", marginTop: 8, borderLeft: "3px solid #7C9AF5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span className="badge" style={{ background: "#7C9AF5", color: "#fff" }} data-testid="sandbox-model-badge">型号维度</span>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className={styles.sub}>电池型号</span>
          {models.length > 0 ? (
            <select
              value={modelId}
              aria-label="电池型号"
              data-testid="sandbox-model-select"
              onChange={(e) => setModelId(e.target.value)}
            >
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          ) : (
            <span className={styles.sub} data-testid="sandbox-model-empty">本租户暂无本体 Model 对象（接入型号主数据后此处可选）</span>
          )}
        </label>
        <span className={styles.sub}>
          需求 <b className="mono">{fmt(qty)}</b> 万套 · <b className="mono">{wk}</b> 周
          {initialModel && models.includes(initialModel) ? "（型号自 what-if 带入）" : ""}
        </span>
        {forecast.isFetching && <span style={{ fontSize: 11, color: "var(--muted2)" }}>推演中…</span>}
        <span className={styles.sub} style={{ marginLeft: "auto" }}>型号可产基地网络 → capacity_forecast（P50/P90/缺口/主瓶颈·逐值来自求解器）</span>
      </div>

      {modelId && !out && <div className="empty-state" style={{ padding: 8 }}>推演该型号产能满足度…</div>}

      {out && (
        <>
          {/* 型号级 P50/P90/缺口/主瓶颈（逐值取 capacity_forecast 端点） */}
          <div className={styles.threeKpiRow} data-testid="sandbox-model-kpis">
            <div className={styles.kpi}>
              <span>P50 可产（万套）</span>
              <b className="mono" data-testid="sandbox-model-p50">{fmt(out.p50)}</b>
            </div>
            <div className={styles.kpi}>
              <span>P90 可产（万套）</span>
              <b className="mono" data-testid="sandbox-model-p90">{fmt(out.p90)}</b>
            </div>
            <div className={styles.kpi}>
              <span>缺口（万套）</span>
              <b className="mono" data-testid="sandbox-model-gap" style={{ color: out.gap > 0 ? okColor : "var(--ok)" }}>{fmt(out.gap)}</b>
            </div>
            <div className={styles.kpi}>
              <span>主瓶颈</span>
              <b className="zh" data-testid="sandbox-model-mainbn">{out.mainBn || "—"}</b>
            </div>
          </div>
          <div className={styles.okBar} style={{ borderColor: okColor, color: okColor, margin: "8px 0" }} data-testid="sandbox-model-verdict">
            {out.ok ? "✓ 该型号产能可满足" : `✗ 该型号缺口 ${fmt(out.gap)} 万套`}
          </div>

          {/* 型号级可产基地网络（PRODUCIBLE_AT）：可产基地 + 各基地瓶颈/紧张度 + 不可产基地。 */}
          <div className="section-title" style={{ marginTop: 4 }}>型号可产基地网络（PRODUCIBLE_AT）· 各基地瓶颈</div>
          <table className="cmp" data-testid="sandbox-model-base-table">
            <thead>
              <tr>
                <th>可产基地</th>
                <th>瓶颈</th>
                <th>紧张度</th>
                <th>周产能(万套)</th>
              </tr>
            </thead>
            <tbody>
              {out.perBaseRows.map((r) => (
                <tr key={r.base} data-testid={`sandbox-model-base-${r.base}`}>
                  <td className="zh"><b>{r.base}</b></td>
                  <td className="zh">{r.bottleneck}</td>
                  <td>
                    {/* KILL-MOCK-RED：无真源紧张度 → 灰「估算」不染决策红；仅 live 真数据才染红。 */}
                    <span className={styles.tightBar}>
                      <i style={{ width: `${Math.min(100, r.tightness ?? 0)}%`, background: decisionHeat(r.tightness, 85, r.live ? "LIVE" : "MOCK") }} />
                    </span>
                    <span className="mono" style={{ color: decisionColor(r.tightness, 85, r.live ? "LIVE" : "MOCK") }}>
                      {r.tightness != null ? r.tightness : "—"}
                    </span>
                    <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>{r.live ? "实测" : "估算"}</span>
                  </td>
                  <td className="mono">{fmt(r.weeklyCap, 2)}</td>
                </tr>
              ))}
              {(out.nonProducible ?? []).map((nb) => (
                <tr key={nb.base} style={{ opacity: 0.55 }} data-testid={`sandbox-model-nonprod-${nb.base}`}>
                  <td className="zh"><span style={{ textDecoration: "line-through" }}>{nb.base}</span> ✗</td>
                  <td colSpan={3} style={{ color: "var(--muted)" }}>{nb.reason}</td>
                </tr>
              ))}
              {out.totalBases != null && out.producibleCount != null && (
                <tr>
                  <td colSpan={4} style={{ color: "var(--accent)" }} data-testid="sandbox-model-converge">
                    收敛：型号 <b className="mono">{modelId}</b> 仅在 <b className="mono">{out.producibleCount}</b>/<b className="mono">{out.totalBases}</b> 个基地可产（PRODUCIBLE_AT）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className={styles.noteInfo}>型号级瓶颈基地列表来自 capacity_forecast 的型号可产基地网络（PRODUCIBLE_AT）；主瓶颈 = 各基地最紧真源工序。</div>
        </>
      )}
    </div>
  );
}
