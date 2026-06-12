import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  advanceSopVersion,
  createSopVersion,
  fetchSopVersion,
  fetchSopVersions,
  finalizeSopVersion,
  patchSopVersion,
} from "@/api/endpoints";
import type { SopVersionVM } from "@/api/types";
import { useSessionStore } from "@/store/sessionStore";
import { toast, toastError } from "@/store/toastStore";
import type { ViewRendererProps } from "../registry";
import { fmt } from "./shared";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

const STATUS_BADGE: Record<SopVersionVM["status"], { label: string; cls: string }> = {
  DRAFT: { label: "DRAFT", cls: "badge" },
  IN_REVIEW: { label: "IN_REVIEW", cls: "badge blue" },
  EXEC_MEETING: { label: "EXEC_MEETING", cls: "badge amber" },
  FINAL: { label: "FINAL", cls: "badge green" },
};

/** ② 需求评审默认三线（原型 SOP_SEG：商用车 −11.8% 触发 C21） */
const DEFAULT_SEGMENTS = [
  { key: "pas", name: "乘用车", target: 69.0, rolling: 71.0, lastActual: 66.8 },
  { key: "ess", name: "储能", target: 45.0, rolling: 49.0, lastActual: 41.9 },
  { key: "com", name: "商用车", target: 13.6, rolling: 12.0, lastActual: 12.9 },
];

/** S&OP 月度平衡台（renderer=sop-balance）：版本 + 五步法状态机 + C22 锁定 */
export default function SopBalanceView(_props: ViewRendererProps) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [newMonth, setNewMonth] = useState("2026-07");

  const versions = useQuery({ queryKey: ["a", "sop-versions"], queryFn: fetchSopVersions });
  const version = useQuery({
    queryKey: ["a", "sop-version", selectedId],
    queryFn: () => fetchSopVersion(selectedId!),
    enabled: selectedId != null,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["a", "sop-versions"] });
    void qc.invalidateQueries({ queryKey: ["a", "sop-version", selectedId] });
  };

  const create = useMutation({
    mutationFn: () => createSopVersion({ month: newMonth, inputs: { demTotal: 132 } }),
    onSuccess: (v) => {
      invalidate();
      select(v.id, v.month);
      setStep(1);
    },
    onError: toastError,
  });

  const select = (id: string, month?: string) => {
    setSelectedId(id);
    setStep(1);
    useSessionStore.getState().setSelectedObjects([
      { objectType: "SopVersion", objectId: id, label: `S&OP ${month ?? ""}`.trim() },
    ]);
  };

  const v = version.data;

  return (
    <div data-testid="sop-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.sop.title}</h3>
          <div className={styles.sub}>
            五步法：产品 → 需求 → 供应 → 财务 → 高管决策会 · 版本状态机 DRAFT → IN_REVIEW → EXEC_MEETING → FINAL · 定稿后 C22 锁定，任何字段变更走计划变更 Action（409 PLAN_LOCKED）。
          </div>
        </div>
      </div>

      <div className={styles.sopGrid}>
        <div className="panel">
          <div className="section-title">{zh.sim.sop.versions}</div>
          <div className={styles.miniForm}>
            <input
              className="wide"
              style={{ width: 110 }}
              value={newMonth}
              aria-label="计划月份"
              onChange={(e) => setNewMonth(e.target.value)}
              placeholder="YYYY-MM"
            />
            <button className="btn sm primary" onClick={() => create.mutate()} data-testid="sop-create">
              {zh.sim.sop.newVersion}
            </button>
          </div>
          {(versions.data ?? []).map((it) => (
            <button key={it.id} className={`${styles.verItem} ${selectedId === it.id ? styles.on : ""}`} onClick={() => select(it.id, it.month)} data-testid={`sop-version-${it.month}`}>
              <span className="mono">{it.month}</span>
              <span className={STATUS_BADGE[it.status].cls} data-testid={`sop-status-${it.month}`}>
                {STATUS_BADGE[it.status].label}
              </span>
            </button>
          ))}
          {versions.data?.length === 0 && <div className="empty-state">{zh.common.none}</div>}
        </div>

        <div>
          {!v && <div className="empty-state">选择或新建一个月度版本</div>}
          {v && (
            <VersionDetail
              key={v.id}
              v={v}
              step={step}
              setStep={setStep}
              onChanged={invalidate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function VersionDetail({ v, step, setStep, onChanged }: { v: SopVersionVM; step: number; setStep: (n: number) => void; onChanged: () => void }) {
  const locked = v.status === "FINAL";
  const advance = useMutation({
    mutationFn: (p: { step: number; payload: Record<string, unknown> }) => advanceSopVersion(v.id, p.step, p.payload),
    onSuccess: () => onChanged(),
    onError: toastError,
  });
  const finalize = useMutation({
    mutationFn: () => finalizeSopVersion(v.id),
    onSuccess: () => {
      toast("已定稿并锁定（C22），审计已留痕（C10）", "success");
      onChanged();
    },
    onError: toastError,
  });
  // C22 锁定演示：FINAL 后改字段 → 409 PLAN_LOCKED toast
  const [lockDemoVal, setLockDemoVal] = useState("133");
  const patchDemo = useMutation({
    mutationFn: () => patchSopVersion(v.id, { demTotal: parseFloat(lockDemoVal) || 0 }),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: toastError,
  });

  const s4 = v.steps.s4 as { pass?: boolean; violations?: string[] } | undefined;

  return (
    <div className="panel" data-testid="sop-detail">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>
          S&OP <span className="mono">{v.month}</span>
        </b>
        <span className={STATUS_BADGE[v.status].cls} data-testid="sop-detail-status">
          {STATUS_BADGE[v.status].label}
        </span>
      </div>

      {locked && (
        <div className={styles.lockBanner} data-testid="sop-locked-banner">
          🔒 {zh.sim.sop.locked}
        </div>
      )}

      <div className={styles.stepper}>
        {zh.sim.sop.steps.map((label, i) => (
          <button key={label} className={`${styles.chip} ${step === i + 1 ? styles.on : ""}`} onClick={() => setStep(i + 1)} data-testid={`sop-step-chip-${i + 1}`}>
            {label}
          </button>
        ))}
      </div>

      {step === 1 && <Step1 v={v} locked={locked} run={(payload) => advance.mutate({ step: 1, payload })} />}
      {step === 2 && <Step2 v={v} locked={locked} run={(payload) => advance.mutate({ step: 2, payload })} />}
      {step === 3 && <Step3 v={v} locked={locked} run={(payload) => advance.mutate({ step: 3, payload })} />}
      {step === 4 && <Step4 v={v} locked={locked} run={(payload) => advance.mutate({ step: 4, payload })} />}
      {step === 5 && (
        <Step5
          v={v}
          locked={locked}
          blocked={!s4 || s4.pass !== true}
          run={(payload) => advance.mutate({ step: 5, payload })}
          onFinalize={() => finalize.mutate()}
        />
      )}

      {/* 改字段尝试（FINAL → 409 PLAN_LOCKED 演示；非 FINAL 可正常保存） */}
      <div className={styles.miniForm} style={{ marginTop: 16, borderTop: "1px dashed var(--line2)", paddingTop: 10 }}>
        <span>{zh.sim.sop.lockDemo}：月度需求总量</span>
        <input value={lockDemoVal} aria-label="月度需求总量" onChange={(e) => setLockDemoVal(e.target.value)} />
        <button className="btn sm" onClick={() => patchDemo.mutate()} data-testid="sop-lock-demo-save">
          {zh.common.save}
        </button>
      </div>
    </div>
  );
}

// ---------------- 五步面板 ----------------

function Step1({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const s1 = v.steps.s1 as { changes?: Record<string, unknown>[]; boundaryDeltaWanPerMonth?: number } | undefined;
  return (
    <div data-testid="sop-step1">
      <div className={styles.noteInfo}>产品评审先行：可产矩阵（型号×产线认证关系）变化直接改变 ②③ 的可行域。</div>
      {!locked && (
        <button className="btn primary" onClick={() => run({})} data-testid="sop-run-1">
          {zh.sim.sop.runStep("①")}（PLM 认证边 diff）
        </button>
      )}
      {s1 && (
        <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s1-table">
          <thead>
            <tr>
              <th>变化</th>
              <th>型号</th>
              <th>基地</th>
              <th>对供给影响(万套/月)</th>
            </tr>
          </thead>
          <tbody>
            {(s1.changes ?? []).map((c, i) => (
              <tr key={i}>
                <td className="zh">
                  <b>{String(c.kind)}</b>
                </td>
                <td>{String(c.modelId)}</td>
                <td className="zh">{String(c.baseId)}</td>
                <td style={{ color: Number(c.impactWanPerMonth) > 0 ? "var(--ok)" : Number(c.impactWanPerMonth) < 0 ? "var(--danger)" : undefined }}>
                  {Number(c.impactWanPerMonth) > 0 ? "+" : ""}
                  {Number(c.impactWanPerMonth)}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}>
                <b>供给可行域边界变化合计</b>
              </td>
              <td>
                <b>+{s1.boundaryDeltaWanPerMonth ?? 0}</b>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Step2({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const [rows, setRows] = useState(DEFAULT_SEGMENTS);
  const s2 = v.steps.s2 as
    | { rows?: { key: string; name: string; target: number; rolling: number; lastActual: number; dv: number; flagged: boolean }[]; total?: { target: number; rolling: number; dv: number } }
    | undefined;
  return (
    <div data-testid="sop-step2">
      {!locked && (
        <>
          <table className="cmp">
            <thead>
              <tr>
                <th>应用细分</th>
                <th>目标(年度分解)</th>
                <th>滚动 P50</th>
                <th>上月实际</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="zh">
                    <b>{r.name}</b>
                  </td>
                  {(["target", "rolling", "lastActual"] as const).map((f) => (
                    <td key={f}>
                      <input
                        type="number"
                        step={0.1}
                        value={r[f]}
                        style={{ width: 80 }}
                        aria-label={`${r.name}-${f}`}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [f]: parseFloat(e.target.value) || 0 } : x)))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => run({ segments: rows })} data-testid="sop-run-2">
            {zh.sim.sop.runStep("②")}（三线对照 · |dv|&gt;10% 触发 C21）
          </button>
        </>
      )}
      {s2?.rows && (
        <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s2-table">
          <thead>
            <tr>
              <th>应用细分</th>
              <th>目标</th>
              <th>滚动 P50</th>
              <th>上月实际</th>
              <th>滚动 vs 目标</th>
              <th>规则</th>
            </tr>
          </thead>
          <tbody>
            {s2.rows.map((r) => (
              <tr key={r.key}>
                <td className="zh">
                  <b>{r.name}</b>
                </td>
                <td>{fmt(r.target)}</td>
                <td>{fmt(r.rolling)}</td>
                <td>{fmt(r.lastActual)}</td>
                <td style={{ color: r.flagged ? "var(--danger)" : r.dv >= 0 ? "var(--ok)" : "var(--amber)", fontWeight: 700 }} data-testid={`sop-dv-${r.key}`}>
                  {r.dv > 0 ? "+" : ""}
                  {(r.dv * 100).toFixed(1)}%{r.flagged ? " ⚑" : ""}
                </td>
                <td>{r.flagged ? <span className="badge red">C21 差异提报 → 进⑤议程</span> : "—"}</td>
              </tr>
            ))}
            {s2.total && (
              <tr>
                <td className="zh">
                  <b>合计</b>
                </td>
                <td>
                  <b>{fmt(s2.total.target)}</b>
                </td>
                <td>
                  <b>{fmt(s2.total.rolling)}</b>
                </td>
                <td>—</td>
                <td>
                  <b>
                    {s2.total.dv > 0 ? "+" : ""}
                    {(s2.total.dv * 100).toFixed(1)}%
                  </b>
                </td>
                <td>—</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Step3({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const [incs, setIncs] = useState<{ name: string; delta: number }[]>([]);
  const s3 = v.steps.s3 as
    | { perBase?: { baseId: string; monthly: number; certFactor: number }[]; sup?: number; dem?: number; gap?: number; flagged?: boolean; increments?: { name: string; delta: number }[] }
    | undefined;
  return (
    <div data-testid="sop-step3">
      {!locked && (
        <div className={styles.miniForm}>
          <span>供给增量（决议外的常规对策）</span>
          <button
            className="btn sm"
            onClick={() => setIncs([...incs, { name: "常州化成夜班×1", delta: 1.2 }])}
          >
            ＋ 增量行
          </button>
          {incs.map((inc, i) => (
            <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input className="wide" value={inc.name} aria-label={`增量名称${i + 1}`} onChange={(e) => setIncs(incs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input type="number" step={0.1} value={inc.delta} aria-label={`增量数值${i + 1}`} onChange={(e) => setIncs(incs.map((x, j) => (j === i ? { ...x, delta: parseFloat(e.target.value) || 0 } : x)))} />
            </span>
          ))}
          <button className="btn primary" onClick={() => run({ increments: incs })} data-testid="sop-run-3">
            {zh.sim.sop.runStep("③")}（供给 = Σ基地 周产能×爬坡×认证）
          </button>
        </div>
      )}
      {s3?.perBase && (
        <>
          <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s3-table">
            <thead>
              <tr>
                <th>基地</th>
                <th>本月供给(万套)</th>
                <th>认证系数</th>
              </tr>
            </thead>
            <tbody>
              {s3.perBase.map((b) => (
                <tr key={b.baseId}>
                  <td className="zh">
                    <b>{b.baseId}</b>
                  </td>
                  <td>{fmt(b.monthly)}</td>
                  <td>{b.certFactor < 1 ? <span className="badge amber">认证中 ×{b.certFactor}</span> : "1.0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s3.flagged ? styles.noteRed : styles.noteInfo} data-testid="sop-gap">
            需求 <b className="mono">{fmt(s3.dem ?? 0)}</b> − 供给 <b className="mono">{fmt(s3.sup ?? 0)}</b> = 缺口{" "}
            <b className="mono">{fmt(s3.gap ?? 0)}</b> 万套{s3.flagged ? `（${zh.sim.sop.gapRed} → 红标，自动进⑤议程）` : ""}
          </div>
        </>
      )}
    </div>
  );
}

function Step4({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ revSum: 248, gmSum: 39.7, gmBudget: 16.4, cashCushion: 58 });
  const s4 = v.steps.s4 as
    | { gmRoll?: number; gmBudget?: number; gmOk?: boolean; cashOk?: boolean; cashCushion?: number; pass?: boolean; violations?: string[] }
    | undefined;
  const fields: { key: keyof typeof form; label: string; unit: string }[] = [
    { key: "revSum", label: "滚动收入合计", unit: "亿" },
    { key: "gmSum", label: "滚动毛利合计", unit: "亿" },
    { key: "gmBudget", label: "预算毛利率", unit: "%" },
    { key: "cashCushion", label: "现金垫(13周最低点)", unit: "亿" },
  ];
  return (
    <div data-testid="sop-step4">
      {!locked && (
        <>
          {fields.map((f) => (
            <div className={styles.formRow} key={f.key} style={{ maxWidth: 360 }}>
              <span>
                <label htmlFor={`sop4-${f.key}`}>{f.label}</label>
              </span>
              <input id={`sop4-${f.key}`} type="number" step={0.1} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: parseFloat(e.target.value) || 0 })} />
              <i>{f.unit}</i>
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => run(form)} data-testid="sop-run-4">
            {zh.sim.sop.runStep("④")}（毛利/现金 C15·C18 校验）
          </button>
        </>
      )}
      {s4 && (
        <div style={{ marginTop: 10 }} data-testid="sop-s4-result">
          <table className="cmp">
            <tbody>
              <tr>
                <td>毛利率_roll</td>
                <td>
                  <b>{Number(s4.gmRoll ?? 0).toFixed(2)}%</b>（预算 {s4.gmBudget}%·容差 0.5pp）
                </td>
                <td style={{ color: s4.gmOk ? "var(--ok)" : "var(--danger)" }}>{s4.gmOk ? "✓" : "✗"}</td>
              </tr>
              <tr>
                <td>现金垫 C18</td>
                <td>
                  <b>{s4.cashCushion} 亿</b>（底线 50 亿）
                </td>
                <td style={{ color: s4.cashOk ? "var(--ok)" : "var(--danger)" }}>{s4.cashOk ? "✓" : "✗"}</td>
              </tr>
            </tbody>
          </table>
          <div className={s4.pass ? styles.noteInfo : styles.noteRed} data-testid="sop-s4-pass">
            {s4.pass ? "④ 财务整合通过，可进入⑤高管决策会" : `④ 财务整合未通过：${(s4.violations ?? []).join("；")}`}
          </div>
        </div>
      )}
    </div>
  );
}

function Step5({
  v,
  locked,
  blocked,
  run,
  onFinalize,
}: {
  v: SopVersionVM;
  locked: boolean;
  blocked: boolean;
  run: (p: Record<string, unknown>) => void;
  onFinalize: () => void;
}) {
  const [resolutions, setResolutions] = useState<{ name: string; delta: number }[]>([
    { name: "常州化成夜班×1", delta: 1.2 },
    { name: "江门正极加急 200 吨", delta: 0.5 },
  ]);
  const s5 = v.steps.s5 as { supFinal?: number; gapFinal?: number } | undefined;
  return (
    <div data-testid="sop-step5">
      <div className="section-title">差异议程（②C21 + ③缺口 + ④越线项自动汇集）</div>
      {v.agenda.length === 0 && <div className={styles.noteInfo}>暂无议程项</div>}
      {v.agenda.map((a, i) => (
        <div className={styles.agendaItem} key={i} data-testid={`sop-agenda-${i}`}>
          <span className="badge amber">{a.source}</span> {a.title}
        </div>
      ))}

      {!locked && v.status !== "EXEC_MEETING" && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>
            决议增量项
          </div>
          {resolutions.map((r, i) => (
            <div className={styles.miniForm} key={i}>
              <input className="wide" value={r.name} aria-label={`决议${i + 1}名称`} onChange={(e) => setResolutions(resolutions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input
                type="number"
                step={0.1}
                value={r.delta}
                aria-label={`决议${i + 1}增量`}
                onChange={(e) => setResolutions(resolutions.map((x, j) => (j === i ? { ...x, delta: parseFloat(e.target.value) || 0 } : x)))}
              />
              <span>万套/月</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <button className="btn primary" disabled={blocked} onClick={() => run({ resolutions })} data-testid="sop-run-5">
              {zh.sim.sop.runStep("⑤")}（决议 → 版本演进）
            </button>
            {blocked && (
              <span style={{ fontSize: 11, color: "var(--danger)" }} data-testid="sop-step5-blocked">
                {zh.sim.sop.step5Blocked}
              </span>
            )}
          </div>
        </>
      )}

      {s5 && (
        <div className={styles.noteInfo} style={{ marginTop: 10 }} data-testid="sop-s5-result">
          决议后供给 <b className="mono">{fmt(s5.supFinal ?? 0)}</b> 万套 · 最终缺口 <b className="mono">{fmt(s5.gapFinal ?? 0)}</b> 万套
        </div>
      )}

      {v.status === "EXEC_MEETING" && (
        <button className="btn primary" style={{ marginTop: 10 }} onClick={onFinalize} data-testid="sop-finalize">
          {zh.sim.sop.finalize}
        </button>
      )}
    </div>
  );
}
