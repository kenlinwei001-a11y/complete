import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  branchSimScenario,
  compareSimScenarios,
  createActionDraft,
  saveSimScenario,
  type GlobalSimSevenDimKpi,
  type SimScenarioCompareCell,
  type SimScenarioSnapshot,
} from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { fmt } from "./shared";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GSLIVE-1-COCKPIT · 活③ 方案存/分支/横比条（decision_play 范式·七维 KPI × 方案矩阵）。
 *
 * 把一次全局推演（含自由杠杆/目标/订单子集）存为**命名方案** → **分支**变体 → **横比矩阵**（七维 KPI × A/B/…）
 * → 一键**采纳**走 `plan_change` ActionDraft（S2 审批·R4 不静默写真值）→ 状态回显 PENDING_APPROVAL。
 * 复用 WO-LIVE-SCENARIO 的 SimSession solve-mode 端点（saveSimScenario/branchSimScenario/compareSimScenarios·
 * 依赖未落 → 前端对预期契约形状并行开工·MSW 桩证接线·真端点合并态复验）。**SimSession 首次被业务页复用。**
 */

/** 当前推演快照（父级 GlobalSimView 捕获·存/分支入参）。 */
export interface ScenarioSnapshotInput {
  label: string;
  primary: string;
  request: Record<string, unknown>;
  kpi: GlobalSimSevenDimKpi;
  servedCount: number;
  displacedCount: number;
  ontimeRate: number;
}

const KPI_DIMS: (keyof GlobalSimSevenDimKpi)[] = ["ontime", "cost", "changeoverHours", "freight", "fgInv", "transitInv", "margin"];

export function GlobalSimScenarioBar({ getSnapshot }: { getSnapshot: () => ScenarioSnapshotInput | null }) {
  const { data: workspace } = useWorkspace();
  const [label, setLabel] = useState("");
  const [scenarios, setScenarios] = useState<SimScenarioSnapshot[]>([]);
  const [matrix, setMatrix] = useState<SimScenarioCompareCell[]>([]);
  const [adoptStatus, setAdoptStatus] = useState<{ label: string; status: string } | null>(null);

  const saveMut = useMutation({
    mutationFn: (input: ScenarioSnapshotInput & { parentId?: string | null }) =>
      saveSimScenario({
        page: "global-sim",
        label: input.label,
        primary: input.primary,
        request: input.request,
        kpi: input.kpi,
        servedCount: input.servedCount,
        displacedCount: input.displacedCount,
        ontimeRate: input.ontimeRate,
        parentId: input.parentId ?? null,
      }),
    onSuccess: (snap) => { setScenarios((prev) => [...prev, snap]); setLabel(""); toast(`方案已存：${snap.label}`, "success"); },
    onError: toastError,
  });

  const branchMut = useMutation({
    mutationFn: (parent: SimScenarioSnapshot) => {
      const snap = getSnapshot();
      return branchSimScenario(parent.id, {
        label: `${parent.label}·分支`,
        request: snap?.request,
        kpi: snap?.kpi,
      });
    },
    onSuccess: (snap) => { setScenarios((prev) => [...prev, snap]); toast(`已分支：${snap.label}`, "success"); },
    onError: toastError,
  });

  const adoptMut = useMutation({
    mutationFn: (cell: SimScenarioCompareCell) =>
      createActionDraft({
        actionTypeKey: "plan_change",
        // plan_change 非 global-sim payload（source:"global-sim-scenario"）→ **必带 versionId + reason**（后端 paramsSchema required·缺则 VALIDATION_ERROR·真 bug 修）。
        payload: {
          source: "global-sim-scenario", scenarioId: cell.id, label: cell.label, kpi: cell.kpi, ontimeRate: cell.ontimeRate, displaced: cell.displacedCount,
          versionId: `global-sim-scenario:${cell.id}`,
          reason: `采纳方案：${cell.label}`,
        },
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }).then((res) => ({ res, cell })),
    onSuccess: ({ res, cell }) => {
      setAdoptStatus({ label: cell.label, status: res.status });
      toast(zh.gslive.adopted(cell.label, res.status), "success");
    },
    onError: toastError,
  });

  // ≥2 方案 → 自动拉横比矩阵（decision_play 范式·七维 × 方案）。
  const ids = scenarios.map((s) => s.id).join(",");
  const refreshMatrix = useCallback(async () => {
    const list = ids ? ids.split(",") : [];
    if (list.length < 2) { setMatrix([]); return; }
    try { setMatrix((await compareSimScenarios(list)).scenarios); }
    catch (e) { toastError(e); }
  }, [ids]);
  useEffect(() => { void refreshMatrix(); }, [refreshMatrix]);

  const onSave = () => {
    const snap = getSnapshot();
    if (!snap) return;
    saveMut.mutate({ ...snap, label: label.trim() || `方案${scenarios.length + 1}·${snap.primary}` });
  };

  return (
    <div className={styles.glass} data-testid="global-sim-scenario-bar">
      <span className={styles.grpLabel}>[ {zh.gslive.scenarioTitle} ]</span>
      <div className={styles.summary}>{zh.gslive.scenarioHint}</div>

      {/* 存为方案 */}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <input
          type="text" value={label} placeholder={zh.gslive.saveLabelPlaceholder}
          data-testid="global-sim-scenario-label" onChange={(e) => setLabel(e.target.value)}
          style={{ flex: "1 1 200px" }}
        />
        <button className={styles.btnPrimary} data-testid="global-sim-scenario-save" disabled={saveMut.isPending} onClick={onSave}>
          {saveMut.isPending ? zh.gslive.saving : zh.gslive.saveScenario}
        </button>
      </div>

      {/* 已存方案列表（各可分支） */}
      {scenarios.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }} data-testid="global-sim-scenario-list">
          {scenarios.map((s) => (
            <div key={s.id} className={styles.batchChip} data-testid={`global-sim-scenario-item-${s.id}`}>
              <span>{s.label}{s.parentId ? "（分支）" : ""}</span>
              <button className={styles.segBtn} style={{ marginLeft: 6 }} data-testid={`global-sim-scenario-branch-${s.id}`} disabled={branchMut.isPending} onClick={() => branchMut.mutate(s)}>
                {branchMut.isPending ? zh.gslive.branching : zh.gslive.branch}
              </button>
            </div>
          ))}
        </div>
      ) : <div className={styles.textMuted} style={{ fontSize: 12, marginTop: 8 }}>{zh.gslive.noScenarios}</div>}

      {/* 横比矩阵（七维 KPI × 方案·decision_play 范式·每格真算·可采纳） */}
      {matrix.length >= 2 ? (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className={styles.gtable} data-testid="global-sim-scenario-matrix">
            <thead>
              <tr>
                <th>{zh.gslive.matrixMetric}</th>
                {matrix.map((c) => <th key={c.id} style={{ textAlign: "right" }} data-testid={`global-sim-scenario-col-${c.id}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{zh.gslive.metricServed}</td>
                {matrix.map((c) => <td key={c.id} className="num" data-testid={`global-sim-scenario-cell-${c.id}-served`}>{c.servedCount}</td>)}
              </tr>
              <tr>
                <td>{zh.gslive.metricDisplaced}</td>
                {matrix.map((c) => <td key={c.id} className="num" data-testid={`global-sim-scenario-cell-${c.id}-displaced`}>{c.displacedCount}</td>)}
              </tr>
              <tr>
                <td>{zh.gslive.metricOntimeRate}</td>
                {matrix.map((c) => <td key={c.id} className="num" data-testid={`global-sim-scenario-cell-${c.id}-ontimeRate`}>{fmt(c.ontimeRate, 0)}</td>)}
              </tr>
              {KPI_DIMS.map((dim) => (
                <tr key={dim}>
                  <td>{(zh.gslive.kpiDims as Record<string, string>)[dim] ?? dim}</td>
                  {matrix.map((c) => <td key={c.id} className="num" data-testid={`global-sim-scenario-cell-${c.id}-${dim}`}>{fmt(c.kpi[dim], 0)}</td>)}
                </tr>
              ))}
              <tr>
                <td>{zh.gslive.adopt}</td>
                {matrix.map((c) => (
                  <td key={c.id} style={{ textAlign: "right" }}>
                    <button className={styles.btnGhost} data-testid={`global-sim-scenario-adopt-${c.id}`} disabled={adoptMut.isPending} onClick={() => adoptMut.mutate(c)}>
                      {adoptMut.isPending ? zh.gslive.adopting : zh.gslive.adopt}
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : scenarios.length === 1 ? (
        <div className={styles.textMuted} style={{ fontSize: 12, marginTop: 8 }} data-testid="global-sim-scenario-needtwo">{zh.gslive.needTwo}</div>
      ) : null}

      {adoptStatus && (
        <div className={styles.tradeoff} data-testid="global-sim-scenario-adopt-status" data-status={adoptStatus.status} style={{ marginTop: 8 }}>
          {zh.gslive.adopted(adoptStatus.label, adoptStatus.status)}
        </div>
      )}
    </div>
  );
}
