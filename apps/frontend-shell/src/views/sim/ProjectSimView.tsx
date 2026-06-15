import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BottleneckMatrixOutputSchema,
  CapacityForecastOutputSchema,
  type CapacityForecastOutput,
} from "@platform/contracts";
import { runSolver, searchObjects } from "@/api/endpoints";
import { Feature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import { Modal } from "@/components/ui/Modal";
import { Provenance } from "@/components/Provenance";
import type { ViewRendererProps } from "../registry";
import { fmt, SnapshotBadge, useActionDraft } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import { PmDag, type PmDagNode } from "./PmDag";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

const MODELS = ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah"];
const ADDRESSES = ["上海", "广州", "北京", "成都", "海外"];
/** 物流时长（天，battery solverParams.logistics 镜像 —— 地址下拉旁展示） */
const LOGISTICS: Record<string, number> = { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 };

interface BatchRowInput {
  qty: number;
  dueDate: string;
  address: string;
}

interface WhatIfState {
  nightShifts: number; // 0–3
  extraChannels: number; // 0–6
  outsourcePct: number; // 0–20 step 5（20 截止 + C08 提示，§7.13）
}

interface WhatIfOut {
  rejected: boolean;
  reason?: string;
  adjustedP50?: number;
  adjustedP90?: number;
  physicalCap?: number;
  capped?: boolean;
  capNote?: string;
  gap?: number;
  ok?: boolean;
}

/**
 * 项目推演（renderer=project-sim，增量 §7.13）：参数区（型号/整单·分批）→ 六步 stepper
 * （①场景解析…⑥结论与对策）+ 常显 DAG 面板（随步骤点亮）；任何参数变更 debounce 重算。
 */
export default function ProjectSimView(_props: ViewRendererProps) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [modelId, setModelId] = useState("4680-NCM");
  const [qty, setQty] = useState(40);
  const [weeks, setWeeks] = useState(6);
  const [batches, setBatches] = useState<BatchRowInput[]>([
    { qty: 18, dueDate: "2026-07-13", address: "上海" },
    { qty: 22, dueDate: "2026-08-10", address: "海外" },
  ]);
  const [whatIf, setWhatIf] = useState<WhatIfState>({ nightShifts: 0, extraChannels: 0, outsourcePct: 0 });
  const [step, setStep] = useState(1);
  const [bnOpen, setBnOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const action = useActionDraft();

  const orders = useQuery({
    queryKey: ["a", "objects", { type: "Order", view: "project-sim" }],
    queryFn: () => searchObjects("Order", ""),
  });

  // 任何参数变更 → debounce 300ms 重算 capacity_forecast（what-if 滑杆同路径，拖动即重算）
  const args = useMemo<Record<string, unknown>>(
    () => ({
      modelId,
      ...(mode === "single" ? { qty, weeks } : { batches: batches.map((b) => ({ qty: b.qty, dueDate: b.dueDate, address: b.address })) }),
      whatIf: { nightShifts: whatIf.nightShifts, extraChannels: whatIf.extraChannels, outsourceRatio: whatIf.outsourcePct / 100 },
    }),
    [modelId, mode, qty, weeks, batches, whatIf],
  );
  const forecast = useLiveSolver("capacity_forecast", args, (raw) => CapacityForecastOutputSchema.parse(raw));
  const out = forecast.data;
  const wi = out ? ((out as Record<string, unknown>).whatIf as WhatIfOut | undefined) : undefined;

  // ⑤ 多维瓶颈矩阵（bottleneck_matrix 求解器，弹窗按需取数）
  const bnBases = useMemo(() => (out ? out.perBaseRows.map((r) => r.base) : []), [out]);
  const bnMatrix = useQuery({
    queryKey: ["b", "solver", "bottleneck_matrix", bnBases],
    queryFn: async () => {
      const res = await runSolver("bottleneck_matrix", { baseIds: bnBases });
      return BottleneckMatrixOutputSchema.parse(res.data);
    },
    enabled: bnOpen && bnBases.length > 0,
  });

  const pickOrder = (o: { id: string; props: Record<string, unknown> }) => {
    setSelectedOrder(o.id);
    const m = String(o.props.model ?? "");
    if (MODELS.includes(m)) setModelId(m);
    const q = Number(o.props.qty ?? 0);
    if (q > 0) setQty(Math.max(1, Math.round(q / 100))); // 套 → 万套（演示折算）
    useSessionStore.getState().setSelectedObjects([{ objectType: "Order", objectId: o.id, label: String(o.props.so ?? o.id) }]);
  };

  const adopt = () => {
    if (!out) return;
    action.mutate({
      actionTypeKey: "采纳产能保障方案",
      payload: {
        modelId,
        whatIf: { nightShifts: whatIf.nightShifts, extraChannels: whatIf.extraChannels, outsourcePct: whatIf.outsourcePct },
        snapshot: {
          mode,
          qty: Number((out as Record<string, unknown>).qty ?? qty),
          p50: out.p50,
          p90: out.p90,
          adjustedP50: wi?.adjustedP50 ?? out.p50,
          adjustedP90: wi?.adjustedP90 ?? out.p90,
          gap: wi?.gap ?? out.gap,
          mainBn: out.mainBn,
        },
      },
    });
  };

  return (
    <div data-testid="project-sim-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.proj.title}</h3>
          <div className={styles.sub}>
            一个型号即一个项目级模拟：①场景解析 → ②可产基地收敛 → ③驱动因子装载 → ④逐级聚合P50 → ⑤瓶颈定位 → ⑥结论与对策；任何参数变更即重算（debounce 300ms · 竞态最后发出者胜）。
          </div>
        </div>
        {forecast.isFetching && <span style={{ fontSize: 11, color: "var(--muted2)" }}>重算中…</span>}
      </div>

      <div className={styles.projGrid}>
        <div className="panel">
          <div className="section-title">{zh.sim.proj.orders}</div>
          <div className={styles.orderList} data-testid="proj-order-list">
            {(orders.data?.items ?? []).slice(0, 12).map((o) => (
              <button key={o.id} className={`${styles.orderItem} ${selectedOrder === o.id ? styles.on : ""}`} onClick={() => pickOrder(o)} data-testid={`proj-order-${String(o.props.so ?? o.id)}`}>
                <span className="mono">{String(o.props.so ?? o.id)}</span> · {String(o.props.cust ?? "—")}
                <br />
                <span className="mono">{String(o.props.model ?? "—")}</span> · <span className="mono">{String(o.props.qty ?? "—")}</span> 套 · 交期{" "}
                <span className="mono">{String(o.props.due ?? "—")}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          {/* 参数区（§7.13）：型号选择器（写 selectedObjects）+ 整单/分批 */}
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="section-title">📝 输入需求 · 改输入即重演</div>
            <div className={styles.inputBar}>
              <button className={`${styles.chip} ${mode === "single" ? styles.on : ""}`} onClick={() => setMode("single")} data-testid="mode-single">
                {zh.sim.proj.single}
              </button>
              <button className={`${styles.chip} ${mode === "batch" ? styles.on : ""}`} onClick={() => setMode("batch")} data-testid="mode-batch">
                {zh.sim.proj.batch}
              </button>
              <label>
                {zh.sim.proj.model}
                <select
                  value={modelId}
                  aria-label={zh.sim.proj.model}
                  onChange={(e) => {
                    setModelId(e.target.value);
                    useSessionStore.getState().setSelectedObjects([
                      { objectType: "Model", objectId: `model-${e.target.value}`, label: e.target.value },
                    ]);
                  }}
                >
                  {MODELS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              {mode === "single" && (
                <>
                  <label>
                    {zh.sim.proj.qty}
                    <input type="number" min={0.1} step={1} value={qty} aria-label={zh.sim.proj.qty} style={{ width: 70 }} onChange={(e) => setQty(Math.max(0.1, parseFloat(e.target.value) || 0))} />
                  </label>
                  <label>
                    {zh.sim.proj.weeks}
                    <input type="number" min={1} max={52} value={weeks} aria-label={zh.sim.proj.weeks} style={{ width: 56 }} onChange={(e) => setWeeks(Math.min(52, Math.max(1, parseInt(e.target.value) || 1)))} />
                  </label>
                </>
              )}
            </div>

            {mode === "batch" && (
              <div>
                <table className="cmp" data-testid="batch-editor">
                  <thead>
                    <tr>
                      <th>批次</th>
                      <th>数量(万套)</th>
                      <th>交付日期</th>
                      <th>交付地址</th>
                      <th>物流时长</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b, i) => (
                      <tr key={i}>
                        <td>第 {i + 1} 批</td>
                        <td>
                          <input
                            type="number"
                            value={b.qty}
                            min={0.1}
                            style={{ width: 70 }}
                            aria-label={`第${i + 1}批数量`}
                            onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, qty: parseFloat(e.target.value) || 0 } : x)))}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={b.dueDate}
                            aria-label={`第${i + 1}批交付日期`}
                            onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))}
                          />
                        </td>
                        <td>
                          <select
                            value={b.address}
                            aria-label={`第${i + 1}批交付地址`}
                            onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))}
                          >
                            {ADDRESSES.map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </td>
                        <td className="mono" data-testid={`batch-logi-${i}`}>
                          {zh.sim.proj.logistics(LOGISTICS[b.address] ?? 7)}
                        </td>
                        <td>
                          {batches.length > 1 && (
                            <button className="btn sm danger" aria-label={`删除第${i + 1}批`} onClick={() => setBatches(batches.filter((_, j) => j !== i))}>
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn sm" style={{ marginTop: 8 }} data-testid="batch-add" onClick={() => setBatches([...batches, { qty: 10, dueDate: "2026-08-24", address: "上海" }])}>
                  {zh.sim.proj.addBatch}
                </button>
                <div className={styles.noteInfo}>净生产窗口 = 交付日 − 该地址物流时长；每批按「累计需求 ≤ 累计P90」校验。</div>
              </div>
            )}
          </div>

          {!out && <div className="empty-state">{zh.common.loading}</div>}
          {out && (
            <div className={styles.pmGrid}>
              {/* 六步 stepper（§7.13） */}
              <div className="panel" data-testid="pm-stepper">
                <div className={styles.pmStepBar}>
                  {zh.sim.proj.steps.map((label, i) => (
                    <button key={label} className={`${styles.chip} ${step === i + 1 ? styles.on : ""}`} data-testid={`pm-step-chip-${i + 1}`} onClick={() => setStep(i + 1)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <button className="btn sm" disabled={step <= 1} data-testid="pm-prev" onClick={() => setStep(step - 1)}>
                    {zh.sim.proj.prevStep}
                  </button>
                  <button className="btn sm" disabled={step >= 6} data-testid="pm-next" onClick={() => setStep(step + 1)}>
                    {zh.sim.proj.nextStep}
                  </button>
                  <span className={styles.pmStepNum} data-testid="pm-step-counter">
                    {zh.sim.proj.stepOf(step, 6)} · {zh.sim.proj.steps[step - 1]}
                  </span>
                  <SnapshotBadge snapshotVersion={forecast.snapshotVersion ?? undefined} tool="capacity_forecast" />
                </div>
                <StepBody
                  step={step}
                  out={out}
                  mode={mode}
                  modelId={modelId}
                  qty={qty}
                  weeks={Number((out as Record<string, unknown>).weeks ?? weeks)}
                  whatIf={whatIf}
                  setWhatIf={setWhatIf}
                  wi={wi}
                  onOpenBn={() => setBnOpen(true)}
                  onAdopt={adopt}
                />
              </div>

              {/* 常显 DAG 面板（§7.13）：六层固定，随步骤点亮 */}
              <div className="panel" data-testid="pm-dag-panel">
                <div className="section-title">{zh.sim.proj.dagTitle}</div>
                <PmDag {...buildDag(out, mode, qty, weeks, modelId, batches)} step={step} />
              </div>
            </div>
          )}
        </div>
      </div>

      {bnOpen && (
        <Modal title={`${zh.sim.proj.bnMatrix} · 基地×7因素`} onClose={() => setBnOpen(false)} width={720}>
          <div data-testid="bn-matrix-modal">
            {bnMatrix.isLoading && <div className="empty-state">{zh.common.loading}</div>}
            {bnMatrix.data && (
              <>
                <table className="cmp" data-testid="bn-matrix-table">
                  <thead>
                    <tr>
                      <th>基地</th>
                      {bnMatrix.data.factors.map((f) => (
                        <th key={f}>{f}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bnMatrix.data.rows.map((r) => (
                      <tr key={r.base}>
                        <td className="zh">
                          <b>{r.base}</b>
                        </td>
                        {bnMatrix.data!.factors.map((f) => {
                          const t = r.tightness[f] ?? 0;
                          return (
                            <td key={f}>
                              <span className={styles.bnCell} style={{ background: bnColor(t) }} data-testid={`bn-cell-${r.base}-${f}`}>
                                {r.primary === f ? "◉" : ""}
                                {t}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={styles.noteInfo}>
                  ◉ = 主瓶颈因素 · 色阶 绿→黄→橙→红 按紧张度（&lt;60 / &lt;75 / &lt;85 / ≥85）· dataMode {bnMatrix.data.dataMode}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function bnColor(t: number): string {
  return t >= 85 ? "#DD7E9E" : t >= 75 ? "#DD9551" : t >= 60 ? "#D2B04C" : "#62BE77";
}

// ---------------- 六步主体（每步一张数据表，§7.13） ----------------

function StepBody({
  step,
  out,
  mode,
  modelId,
  qty,
  weeks,
  whatIf,
  setWhatIf,
  wi,
  onOpenBn,
  onAdopt,
}: {
  step: number;
  out: CapacityForecastOutput;
  mode: "single" | "batch";
  modelId: string;
  qty: number;
  weeks: number;
  whatIf: WhatIfState;
  setWhatIf: (w: WhatIfState) => void;
  wi: WhatIfOut | undefined;
  onOpenBn: () => void;
  onAdopt: () => void;
}) {
  const totalQty = Number((out as Record<string, unknown>).qty ?? qty);

  if (step === 1) {
    if (mode === "batch" && out.batchRows) {
      return (
        <table className="cmp" data-testid="pm-step1-batch">
          <thead>
            <tr>
              <th>批次</th>
              <th>数量(万套)</th>
              <th>交付日 · 地址</th>
              <th>净窗口(wkEff)</th>
              <th>累计需求</th>
              <th>累计P90</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            {out.batchRows.map((b, i) => (
              <tr key={i}>
                <td>第 {i + 1} 批</td>
                <td>{fmt(b.qty)}</td>
                <td>
                  {b.dueDate} · {b.address ?? "—"}
                </td>
                <td className="mono" data-testid={`batch-wkeff-${i}`}>
                  {b.wkEff} 周
                </td>
                <td>{fmt(b.cumDemand)}</td>
                <td>{fmt(b.cumP90)}</td>
                <td style={{ color: b.ok ? "var(--ok)" : "var(--danger)", fontWeight: 700 }} data-testid={`batch-ok-${i}`}>
                  {b.ok ? "✓ 按期" : `✗ 缺 ${fmt(b.cumDemand - b.cumP90)}`}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1.5px solid var(--line2)" }}>
              <td>
                <b>合计</b>
              </td>
              <td>
                <b>{fmt(totalQty)}</b>
              </td>
              <td colSpan={5}>净生产窗口 = 交付日 − 地址物流时长（物料/物流域）· 每批按「累计需求 ≤ 累计P90」校验</td>
            </tr>
          </tbody>
        </table>
      );
    }
    return (
      <table className="cmp" data-testid="pm-step1-single">
        <thead>
          <tr>
            <th>字段</th>
            <th>值</th>
            <th>来源/校验</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>型号</td>
            <td>
              <b className="mono">{modelId}</b>
            </td>
            <td>产品域 · PLM</td>
          </tr>
          <tr>
            <td>需求量</td>
            <td>
              <b className="mono">{fmt(totalQty)}</b> 万套
            </td>
            <td>用户输入 → 结构化预测场景对象</td>
          </tr>
          <tr>
            <td>交付窗口</td>
            <td>
              <b className="mono">{weeks}</b> 周
            </td>
            <td>规则 C10 校验场景字段完整性 ✓</td>
          </tr>
          <tr>
            <td>候选对策</td>
            <td>加夜班 / 扩化成通道 / 外协</td>
            <td>方案库（按约束因素对症）</td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (step === 2) {
    return (
      <table className="cmp" data-testid="pm-step2">
        <thead>
          <tr>
            <th>基地</th>
            <th>认证状态</th>
            <th>周产能(万套)</th>
          </tr>
        </thead>
        <tbody>
          {out.perBaseRows.map((r) => (
            <tr key={r.base}>
              <td className="zh">
                <b>{r.base}</b>
              </td>
              <td>
                {r.certFactor < 1 ? (
                  <span className="badge amber" data-testid={`cert-pending-${r.base}`}>
                    {zh.sim.proj.certPending} ×{r.certFactor}
                  </span>
                ) : (
                  "量产 1.0"
                )}
              </td>
              <td>{fmt(r.weeklyCap, 2)}</td>
            </tr>
          ))}
          {out.pendingCertList.length > 0 && (
            <tr>
              <td colSpan={3} style={{ color: "var(--amber)" }} data-testid="pending-cert">
                {out.pendingCertList.join("、")} {zh.sim.proj.pendingCert}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  if (step === 3) {
    return (
      <div data-testid="pm-step3">
        <table className="cmp">
          <thead>
            <tr>
              <th>基地</th>
              <th>爬坡曲线</th>
              <th>检修窗</th>
              <th>认证系数</th>
            </tr>
          </thead>
          <tbody>
            {out.perBaseRows.map((r) => (
              <tr key={r.base}>
                <td className="zh">
                  <b>{r.base}</b>
                </td>
                <td>前 4 周 0.88→1.0</td>
                <td>{r.maintWeek != null ? `第 ${r.maintWeek} 周（×0.72）` : "—"}</td>
                <td>{r.certFactor < 1 ? `×${r.certFactor}（认证中）` : "×1.0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.noteInfo}>
          数据健康度（C09）：P90 系数 <b className="mono">{out.healthFactor}</b>（IoT/MES/QMS 驱动因子新鲜度联动）
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div data-testid="pm-step4">
        <table className="cmp">
          <thead>
            <tr>
              <th>基地</th>
              <th>周产能(万套)</th>
              <th>累计(万套)</th>
            </tr>
          </thead>
          <tbody>
            {out.perBaseRows.map((r) => (
              <tr key={r.base}>
                <td className="zh">
                  <b>{r.base}</b>
                </td>
                <td>{fmt(r.weeklyCap, 2)}</td>
                <td>{fmt(r.cumTotal, 2)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1.5px solid var(--line2)" }}>
              <td>
                <b>合计</b>
              </td>
              <td colSpan={2} data-testid="pm-step4-total">
                P50 <b className="mono">{fmt(out.p50)}</b> 万套 · P90 = P50 × <b className="mono">{out.healthFactor}</b> ={" "}
                <b className="mono">{fmt(out.p90)}</b> 万套
              </td>
            </tr>
          </tbody>
        </table>
        {out.degradeNote && (
          <div className={styles.noteAmber} data-testid="degrade-note">
            ⚠ {out.degradeNote}
          </div>
        )}
      </div>
    );
  }

  if (step === 5) {
    return (
      <div data-testid="pm-step5">
        <table className="cmp">
          <thead>
            <tr>
              <th>基地</th>
              <th>瓶颈</th>
              <th>紧张度</th>
            </tr>
          </thead>
          <tbody>
            {out.perBaseRows.map((r) => (
              <tr key={r.base}>
                <td className="zh">
                  <b>{r.base}</b>
                </td>
                <td className="zh">{r.bottleneck}</td>
                <td>
                  <span className={styles.tightBar}>
                    <i
                      style={{
                        width: `${Math.min(100, r.tightness)}%`,
                        background: r.tightness >= 85 ? "var(--danger)" : r.tightness >= 70 ? "var(--amber)" : "var(--c-capacity)",
                      }}
                    />
                  </span>
                  <span className="mono" style={{ color: r.tightness >= 85 ? "var(--danger)" : undefined }}>
                    {r.tightness}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.noteInfo}>
          主瓶颈：<b className="zh">{out.mainBn || "—"}</b>
        </div>
        <button className="btn sm" data-testid="bn-matrix-open" onClick={onOpenBn}>
          {zh.sim.proj.bnMatrixOpen}
        </button>
      </div>
    );
  }

  // ⑥ 结论与对策 + what-if 三滑杆（拖动即重算）
  const okColor = out.ok ? "var(--ok)" : "var(--danger)";
  const effGap = wi && !wi.rejected && wi.gap != null ? wi.gap : out.gap;
  return (
    <div data-testid="pm-step6">
      <div className={styles.okBar} style={{ borderColor: okColor, color: okColor }} data-testid="proj-verdict-bar">
        {mode === "batch" ? (out.ok ? zh.sim.proj.batchOk : zh.sim.proj.batchGap(fmt(out.gap))) : out.ok ? "✓ 产能可满足" : `✗ 缺口 ${fmt(out.gap)} 万套`}
      </div>
      <div className={styles.threeKpiRow}>
        <div className={styles.kpi} data-testid="kpi-p50">
          {/* 可信赖的推演（R13）：结论数字六要素溯源 */}
          <Provenance
            testId="p50"
            src="聚合求解器"
            formula="P50 = Σ可产基地 Σ周(周产能 × 爬坡曲线 × 检修窗 × 认证系数)"
            inputs={["可产基地", "爬坡曲线", "检修窗", "认证系数"]}
            rule="C01/C02"
          >
            <b style={{ color: "var(--c-capacity)" }}>{fmt(out.p50)}</b>
          </Provenance>
          <span>P50 累计产能(万套)</span>
        </div>
        <div className={styles.kpi} data-testid="kpi-p90">
          <Provenance
            testId="p90"
            src="IoT/SCADA 数据健康度"
            formula={`P90 = P50 × 健康度系数 ${out.healthFactor}`}
            inputs={["P50", "数据新鲜度→健康度系数"]}
            rule="C09"
            note="IoT 延迟时健康度系数自动下调，置信度随之削弱"
          >
            <b style={{ color: "var(--c-forecast)" }}>{fmt(out.p90)}</b>
          </Provenance>
          <span>P90（× 健康度 {out.healthFactor}）</span>
        </div>
        <div className={styles.kpi} data-testid="kpi-demand">
          <b>{fmt(totalQty)}</b>
          <span>需求(万套)</span>
        </div>
      </div>

      <Feature flag="view.project-sim.whatif">
        <div className={styles.whatIfPanel} data-testid="whatif-panel">
          <div className="section-title">{zh.sim.proj.whatIf}</div>
          <div className={styles.sliderRow}>
            <span>{zh.sim.proj.nightShift}（0–3 班）</span>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={whatIf.nightShifts}
              aria-label={zh.sim.proj.nightShift}
              data-testid="whatif-night"
              onChange={(e) => setWhatIf({ ...whatIf, nightShifts: parseInt(e.target.value) })}
            />
            <b>+{whatIf.nightShifts}</b>
          </div>
          <div className={styles.sliderRow}>
            <span>{zh.sim.proj.extraChannels}（0–6 条）</span>
            <input
              type="range"
              min={0}
              max={6}
              step={1}
              value={whatIf.extraChannels}
              aria-label={zh.sim.proj.extraChannels}
              data-testid="whatif-channels"
              onChange={(e) => setWhatIf({ ...whatIf, extraChannels: parseInt(e.target.value) })}
            />
            <b>+{whatIf.extraChannels}</b>
          </div>
          <div className={styles.sliderRow}>
            <span>{zh.sim.proj.outsource}（0–20% · step 5）</span>
            <input
              type="range"
              min={0}
              max={20}
              step={5}
              value={whatIf.outsourcePct}
              aria-label={zh.sim.proj.outsource}
              data-testid="whatif-outsource"
              onChange={(e) => setWhatIf({ ...whatIf, outsourcePct: parseInt(e.target.value) })}
            />
            <b>{whatIf.outsourcePct}%</b>
          </div>
          {whatIf.outsourcePct >= 20 && (
            <div className={styles.noteAmber} data-testid="whatif-c08">
              ⚠ {zh.sim.proj.outsourceCap}
            </div>
          )}
          {wi?.rejected && (
            <div className={styles.noteRed} data-testid="whatif-rejected">
              ⛔ {wi.reason}
            </div>
          )}

          <div className={styles.okBar} style={{ borderColor: effGap <= 0 ? "var(--ok)" : "var(--danger)", color: effGap <= 0 ? "var(--ok)" : "var(--danger)" }} data-testid="whatif-gap">
            {effGap <= 0 ? zh.sim.proj.gapZero(fmt(-effGap)) : zh.sim.proj.gapLeft(fmt(effGap))}
          </div>
          {wi && !wi.rejected && (
            <div className={styles.abCompare} data-testid="whatif-compare">
              <div>
                <span>{zh.sim.proj.before}</span>
                <b data-testid="whatif-before">{fmt(out.p50)}</b>
              </div>
              <div style={{ borderColor: "rgba(98,190,119,.5)" }}>
                <span>
                  {zh.sim.proj.after}（P90 {fmt(wi.adjustedP90 ?? 0)}）
                </span>
                <b style={{ color: "var(--ok)" }} data-testid="whatif-after">
                  {fmt(wi.adjustedP50 ?? 0)}
                </b>
              </div>
            </div>
          )}
          {wi && !wi.rejected && wi.capped && <div className={styles.noteAmber}>{wi.capNote}</div>}

          <Feature flag="act.adopt-to-draft">
            <button className="btn sm primary" style={{ marginTop: 10 }} data-testid="proj-adopt" onClick={onAdopt}>
              {zh.sim.proj.adopt}（参数组合 + 推演快照 → Action）
            </button>
          </Feature>
        </div>
      </Feature>
    </div>
  );
}

// ---------------- DAG 装配（六层固定，§7.13） ----------------

function buildDag(
  out: CapacityForecastOutput,
  mode: "single" | "batch",
  qty: number,
  weeks: number,
  modelId: string,
  batches: BatchRowInput[],
): { layers: PmDagNode[][]; edges: [string, string][] } {
  const totalQty = Number((out as Record<string, unknown>).qty ?? qty);
  const baseRows = out.perBaseRows.slice(0, 6);
  const folded = out.perBaseRows.length > 6 ? out.perBaseRows.length - 6 : 0;
  const minWk = out.batchRows && out.batchRows.length > 0 ? Math.min(...out.batchRows.map((b) => b.wkEff)) : weeks;

  const layers: PmDagNode[][] = [
    [
      mode === "batch"
        ? { id: "dem", label: `分批交货 ${out.batchRows?.length ?? batches.length} 批 · Σ${fmt(totalQty)} 万套`, sub: `最紧批净窗口 ${minWk} 周（已扣物流）`, color: "#7E8BEE", st: 1 }
        : { id: "dem", label: `需求 ${fmt(totalQty)} 万套 · ${weeks} 周`, sub: "结构化预测场景", color: "#7E8BEE", st: 1 },
    ],
    [{ id: "mdl", label: modelId, sub: "型号对象（产品域 · PLM）", color: "#D2B04C", st: 1 }],
    baseRows
      .map<PmDagNode>((r, i) => ({
        id: `b${i}`,
        label: r.base,
        sub: `周产能 ${fmt(r.weeklyCap, 2)} 万套${r.certFactor < 1 ? " · 认证中" : ""}`,
        color: "#54B5C4",
        st: 2,
      }))
      .concat(folded > 0 ? [{ id: "bm", label: `+${folded} 基地`, sub: "见步骤②", color: "#54B5C4", st: 2 }] : []),
    [
      { id: "f1", label: "节拍 × OEE × 良率", sub: "IoT/MES/QMS 驱动因子", color: "#9D8BF0", st: 3 },
      { id: "f2", label: "爬坡曲线 + 检修窗", sub: "前4周 0.88→1.0 · 各基地检修周", color: "#9D8BF0", st: 3 },
      { id: "f3", label: "认证系数 + 数据健康度", sub: `PLM 认证 · P90 系数 ${out.healthFactor}`, color: "#9D8BF0", st: 3 },
    ],
    [
      { id: "agg", label: "聚合求解器", sub: `Σ基地 Σ周 → P50 ${fmt(out.p50)} 万套`, color: "#C470B8", st: 4 },
      { id: "bn", label: "瓶颈求解器", sub: `主瓶颈：${out.mainBn || "—"}`, color: "#C470B8", st: 5 },
    ],
    [
      {
        id: "fc",
        label: `产能预测 ${out.ok ? "✓ 可达" : `✗ 缺口 ${fmt(out.gap)} 万套`}`,
        sub: `P50 ${fmt(out.p50)} · P90 ${fmt(out.p90)}（×${out.healthFactor}）vs 需求 ${fmt(totalQty)}`,
        color: out.ok ? "#62BE77" : "#DD7E9E",
        st: 6,
      },
    ],
  ];
  const edges: [string, string][] = [["dem", "mdl"]];
  for (const n of layers[2]!) edges.push(["mdl", n.id], [n.id, "agg"]);
  edges.push(["f1", "agg"], ["f2", "agg"], ["f3", "agg"], ["agg", "bn"], ["agg", "fc"], ["bn", "fc"]);
  return { layers, edges };
}
