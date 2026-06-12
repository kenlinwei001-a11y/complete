import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CapacityForecastOutputSchema, type CapacityForecastOutput } from "@platform/contracts";
import { runSolver, searchObjects } from "@/api/endpoints";
import { Feature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import { toastError } from "@/store/toastStore";
import type { ViewRendererProps } from "../registry";
import { fmt, SnapshotBadge } from "./shared";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

const MODELS = ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah"];
const ADDRESSES = ["上海", "广州", "北京", "成都", "海外"];

interface BatchRowInput {
  qty: number;
  dueDate: string;
  address: string;
}

interface WhatIfState {
  nightShifts: number;
  extraChannels: number;
  outsourcePct: number; // 0–25（>20 演示 C08 拒绝）
}

type WhatIfResult =
  | { rejected: true; ruleRef: string; reason: string }
  | {
      rejected: false;
      adjustedP50: number;
      adjustedP90: number;
      physicalCap: number;
      capped: boolean;
      capNote?: string;
      gap: number;
      ok: boolean;
    };

/** 项目推演（renderer=project-sim）：订单/型号 → capacity_forecast（单批 / 分批 + what-if 调参） */
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
  const [result, setResult] = useState<{ out: CapacityForecastOutput; snapshotVersion: string; withWhatIf: boolean } | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["a", "objects", { type: "Order", view: "project-sim" }],
    queryFn: () => searchObjects("Order", ""),
  });

  const buildArgs = (withWhatIf: boolean): Record<string, unknown> => ({
    modelId,
    ...(mode === "single" ? { qty, weeks } : { batches: batches.map((b) => ({ qty: b.qty, dueDate: b.dueDate, address: b.address })) }),
    ...(withWhatIf
      ? { whatIf: { nightShifts: whatIf.nightShifts, extraChannels: whatIf.extraChannels, outsourceRatio: whatIf.outsourcePct / 100 } }
      : {}),
  });

  const run = useMutation({
    mutationFn: async (withWhatIf: boolean) => {
      const res = await runSolver("capacity_forecast", buildArgs(withWhatIf));
      return { out: CapacityForecastOutputSchema.parse(res.data), snapshotVersion: res.snapshotVersion, withWhatIf };
    },
    onSuccess: setResult,
    onError: toastError,
  });

  const pickOrder = (o: { id: string; props: Record<string, unknown> }) => {
    setSelectedOrder(o.id);
    const m = String(o.props.model ?? "");
    if (MODELS.includes(m)) setModelId(m);
    const q = Number(o.props.qty ?? 0);
    if (q > 0) setQty(Math.max(1, Math.round(q / 100))); // 套 → 万套（演示折算）
    // 选中订单写入共享 store（查询 Dock 上下文）
    useSessionStore.getState().setSelectedObjects([
      { objectType: "Order", objectId: o.id, label: String(o.props.so ?? o.id) },
    ]);
    setResult(null);
  };

  const out = result?.out;
  const wi = out ? ((out as Record<string, unknown>).whatIf as WhatIfResult | undefined) : undefined;

  return (
    <div data-testid="project-sim-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.proj.title}</h3>
          <div className={styles.sub}>
            一个型号即一个项目级模拟：输入需求 → 聚合/瓶颈求解器逐基地核算（爬坡 × 检修窗 × 认证系数 × 数据健康度）→ P50/P90 与缺口；分批模式按「累计需求 ≤ 累计P90」逐批校验（净窗口已扣物流时长）。
          </div>
        </div>
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
              <button className="btn primary" disabled={run.isPending} onClick={() => run.mutate(false)} data-testid="proj-run">
                {zh.sim.run} ▶
              </button>
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
                        <td>
                          {batches.length > 1 && (
                            <button className="btn sm danger" onClick={() => setBatches(batches.filter((_, j) => j !== i))}>
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setBatches([...batches, { qty: 10, dueDate: "2026-08-24", address: "上海" }])}>
                  {zh.sim.proj.addBatch}
                </button>
                <div className={styles.noteInfo}>净生产窗口 = 交付日 − 该地址物流时长；每批按「累计需求 ≤ 累计P90」校验。</div>
              </div>
            )}
          </div>

          {out && (
            <div className="panel" data-testid="proj-result">
              <ForecastResult out={out} snapshotVersion={result!.snapshotVersion} mode={mode} weeks={Number((out as Record<string, unknown>).weeks ?? weeks)} />

              {/* what-if 调参（BLOCK 级 feature） */}
              <Feature flag="view.project-sim.whatif">
                <div className={styles.whatIfPanel} data-testid="whatif-panel">
                  <div className="section-title">{zh.sim.proj.whatIf}</div>
                  <div className={styles.whatIfRow}>
                    <span>{zh.sim.proj.nightShift}</span>
                    {[0, 1, 2].map((n) => (
                      <button key={n} className={`${styles.chip} ${whatIf.nightShifts === n ? styles.on : ""}`} data-testid={`night-${n}`} onClick={() => setWhatIf({ ...whatIf, nightShifts: n })}>
                        {n === 0 ? "关" : `+${n}`}
                      </button>
                    ))}
                    <span>{zh.sim.proj.extraChannels}</span>
                    {[0, 1, 2].map((n) => (
                      <button key={n} className={`${styles.chip} ${whatIf.extraChannels === n ? styles.on : ""}`} onClick={() => setWhatIf({ ...whatIf, extraChannels: n })}>
                        {n === 0 ? "关" : `+${n}`}
                      </button>
                    ))}
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                      {zh.sim.proj.outsource}（≤20%，C08）
                      <input
                        type="range"
                        min={0}
                        max={25}
                        step={5}
                        value={whatIf.outsourcePct}
                        aria-label={zh.sim.proj.outsource}
                        onChange={(e) => setWhatIf({ ...whatIf, outsourcePct: parseInt(e.target.value) })}
                      />
                      <b className="mono">{whatIf.outsourcePct}%</b>
                    </label>
                    <button className="btn sm primary" disabled={run.isPending} onClick={() => run.mutate(true)} data-testid="whatif-run">
                      {zh.sim.proj.recompute}
                    </button>
                  </div>

                  {result?.withWhatIf && wi && wi.rejected && (
                    <div className={styles.noteRed} data-testid="whatif-rejected">
                      ⛔ {wi.reason}
                    </div>
                  )}
                  {result?.withWhatIf && wi && !wi.rejected && (
                    <div className={styles.abCompare} data-testid="whatif-compare">
                      <div>
                        <span>{zh.sim.proj.before}</span>
                        <b data-testid="whatif-before">{fmt(out.p50)}</b>
                      </div>
                      <div style={{ borderColor: "rgba(98,190,119,.5)" }}>
                        <span>{zh.sim.proj.after}（P90 {fmt(wi.adjustedP90)}）</span>
                        <b style={{ color: "var(--ok)" }} data-testid="whatif-after">
                          {fmt(wi.adjustedP50)}
                        </b>
                      </div>
                      <div>
                        <span>调整后缺口</span>
                        <b style={{ color: wi.ok ? "var(--ok)" : "var(--danger)" }}>{fmt(wi.gap)}</b>
                      </div>
                      {wi.capped && <div className={styles.noteAmber}>{wi.capNote}</div>}
                    </div>
                  )}
                </div>
              </Feature>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ForecastResult({ out, snapshotVersion, mode, weeks }: { out: CapacityForecastOutput; snapshotVersion: string; mode: "single" | "batch"; weeks: number }) {
  const okColor = out.ok ? "var(--ok)" : "var(--danger)";
  return (
    <div>
      <div className={styles.threeKpiRow}>
        <div className={styles.kpi} data-testid="kpi-p50">
          <b style={{ color: "var(--c-capacity)" }}>{fmt(out.p50)}</b>
          <span>
            P50 累计产能(万套) <SnapshotBadge snapshotVersion={snapshotVersion} tool="capacity_forecast" />
          </span>
        </div>
        <div className={styles.kpi} data-testid="kpi-p90">
          <b style={{ color: "var(--c-forecast)" }}>{fmt(out.p90)}</b>
          <span>P90（× 健康度 {out.healthFactor}）</span>
        </div>
        <div className={styles.kpi} data-testid="kpi-gap">
          <b style={{ color: out.gap > 0 ? "var(--danger)" : "var(--ok)" }}>{fmt(out.gap)}</b>
          <span>缺口(万套，P90 口径)</span>
        </div>
        <div className={styles.kpi}>
          <b style={{ color: "var(--c-solver)" }}>{out.mainBn || "—"}</b>
          <span>主瓶颈</span>
        </div>
      </div>

      <div className={styles.okBar} style={{ borderColor: okColor, color: okColor }} data-testid="proj-verdict-bar">
        {mode === "batch"
          ? out.ok
            ? zh.sim.proj.batchOk
            : zh.sim.proj.batchGap(fmt(out.gap))
          : out.ok
            ? zh.sim.proj.okBar(weeks)
            : zh.sim.proj.gapBar(fmt(out.gap))}
      </div>

      {out.degradeNote && (
        <div className={styles.noteAmber} data-testid="degrade-note">
          ⚠ {out.degradeNote}
        </div>
      )}
      {out.pendingCertList.length > 0 && (
        <div className={styles.noteInfo} data-testid="pending-cert">
          {out.pendingCertList.join("、")} {zh.sim.proj.pendingCert}
        </div>
      )}

      {out.batchRows && out.batchRows.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>
            分批校验（累计需求 vs 累计P90）
          </div>
          <table className="cmp" data-testid="batch-result-table">
            <thead>
              <tr>
                <th>批次</th>
                <th>数量</th>
                <th>交付日 · 地址</th>
                <th>净窗口</th>
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
                    {b.dueDate} · {String((b as Record<string, unknown>).address ?? "—")}
                  </td>
                  <td>{b.wkEff} 周</td>
                  <td>{fmt(b.cumDemand)}</td>
                  <td>{fmt(b.cumP90)}</td>
                  <td style={{ color: b.ok ? "var(--ok)" : "var(--danger)", fontWeight: 700 }} data-testid={`batch-ok-${i}`}>
                    {b.ok ? "✓ 按期" : `✗ 缺 ${fmt(b.cumDemand - b.cumP90)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="section-title" style={{ marginTop: 10 }}>
        逐基地下钻（周产能 × 爬坡 × 检修 × 认证）
      </div>
      <table className="cmp" data-testid="per-base-table">
        <thead>
          <tr>
            <th>基地</th>
            <th>周产能(万套)</th>
            <th>认证系数</th>
            <th>检修周</th>
            <th>瓶颈</th>
            <th>紧张度</th>
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
              <td>
                {r.certFactor < 1 ? (
                  <span className="badge amber" data-testid={`cert-pending-${r.base}`}>
                    {zh.sim.proj.certPending} ×{r.certFactor}
                  </span>
                ) : (
                  "1.0"
                )}
              </td>
              <td>{r.maintWeek != null ? `第 ${r.maintWeek} 周（×0.72）` : "—"}</td>
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
              <td>{fmt(r.cumTotal, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
