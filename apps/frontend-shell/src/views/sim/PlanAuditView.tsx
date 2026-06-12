import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlanAuditOutputSchema, RiskTimelineOutputSchema, type PlanAuditInput, type PlanAuditOutput } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import { useFeature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import { toastError } from "@/store/toastStore";
import type { ViewRendererProps } from "../registry";
import { HeatStrip, SnapshotBadge, useAdoptToDraft } from "./shared";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

type AuditItem = PlanAuditOutput["H"][number];

/** 原型 AUDIT_PRESETS（demo-推演系统.html buildAuditView：电池行业默认值） */
const PRESETS: Record<string, { note: string; input: PlanAuditInput }> = {
  V7: {
    note: "2026-07 月度 V7（S&OP 定稿基线）",
    input: { dem: 132, seg_pas: 71, seg_ess: 49, seg_com: 12, sup: 131.2, ltaCov: 92, kitGap: 654, gmTarget: 16.0, cashCushion: 58, capex: 0 },
  },
  CEO: {
    note: "CEO 直球：再加量 + 抬毛利 + 现金更紧",
    input: { dem: 140, seg_pas: 72, seg_ess: 56, seg_com: 12, sup: 131.2, ltaCov: 80, kitGap: 1200, gmTarget: 17.5, cashCushion: 48, capex: 8 },
  },
};

const FIELD_GROUPS: { title: string; fields: { key: keyof PlanAuditInput; label: string; unit: string; step: number }[] }[] = [
  {
    title: "需求侧（万套）",
    fields: [
      { key: "dem", label: "月度需求总量", unit: "万套", step: 0.1 },
      { key: "seg_pas", label: "乘用车", unit: "万套", step: 0.1 },
      { key: "seg_ess", label: "储能", unit: "万套", step: 0.1 },
      { key: "seg_com", label: "商用车", unit: "万套", step: 0.1 },
    ],
  },
  {
    title: "供给侧",
    fields: [
      { key: "sup", label: "月度可供给", unit: "万套", step: 0.1 },
      { key: "ltaCov", label: "长协覆盖率", unit: "%", step: 1 },
      { key: "kitGap", label: "正极物料缺口", unit: "吨", step: 10 },
    ],
  },
  {
    title: "财务侧",
    fields: [
      { key: "gmTarget", label: "毛利率目标", unit: "%", step: 0.1 },
      { key: "cashCushion", label: "现金安全垫(13周最低点)", unit: "亿", step: 0.5 },
      { key: "capex", label: "CAPEX 本月", unit: "亿", step: 0.5 },
    ],
  },
];

const VERDICT_COLOR: Record<PlanAuditOutput["verdict"], string> = {
  通过: "var(--ok)",
  有条件通过: "var(--amber)",
  不通过: "var(--danger)",
};

/** 规划体检（renderer=plan-audit）：输入计划 → plan_audit 求解器 → H/M/S 三段诊断 */
export default function PlanAuditView(_props: ViewRendererProps) {
  const [preset, setPreset] = useState("V7");
  const [form, setForm] = useState<PlanAuditInput>(PRESETS.V7!.input);
  const [result, setResult] = useState<{ out: PlanAuditOutput; gmStruct?: number; snapshotVersion: string } | null>(null);
  const canApplyFix = useFeature("act.plan-audit.apply-fix");
  const canAdopt = useFeature("act.adopt-to-draft");
  const adopt = useAdoptToDraft();

  const audit = useMutation({
    mutationFn: async (input: PlanAuditInput) => {
      const res = await runSolver("plan_audit", input as unknown as Record<string, unknown>);
      return {
        out: PlanAuditOutputSchema.parse(res.data),
        gmStruct: (res.data as { gmStruct?: number }).gmStruct,
        snapshotVersion: res.snapshotVersion,
      };
    },
    onSuccess: (data) => {
      setResult(data);
      // 选中对象写入共享 store（查询 Dock 随问句携带）
      useSessionStore.getState().setSelectedObjects([
        { objectType: "PlanVersion", objectId: `plan-${preset}`, label: `月度计划草案（${preset} 基线）` },
      ]);
    },
    onError: toastError,
  });

  const applyFix = (item: AuditItem) => {
    if (!item.fix) return;
    const next = { ...form, ...(item.fix.patch as Partial<PlanAuditInput>) };
    setForm(next);
    audit.mutate(next); // 应用即时重检（原型 applyAuditFix 语义）
  };

  return (
    <div data-testid="plan-audit-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.audit.title}</h3>
          <div className={styles.sub}>
            输入你的计划，系统按本体 + 规则 + 四平衡求解器全量扫描 → 三段输出：硬矛盾 H · 软风险 M · 建议修正 S，每项可追溯到规则与求解器。
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{zh.sim.audit.presets}</span>
          {Object.entries(PRESETS).map(([k, p]) => (
            <button
              key={k}
              className={`${styles.chip} ${preset === k ? styles.on : ""}`}
              title={p.note}
              data-testid={`audit-preset-${k}`}
              onClick={() => {
                setPreset(k);
                setForm(p.input);
                setResult(null);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.twoCol}>
        <div className="panel">
          <div className="section-title">{zh.sim.audit.inputTitle}</div>
          {FIELD_GROUPS.map((g) => (
            <div key={g.title}>
              <div className={styles.grpHead}>{g.title}</div>
              {g.fields.map((f) => (
                <div className={styles.formRow} key={f.key}>
                  <span>
                    <label htmlFor={`audit-${f.key}`}>{f.label}</label>
                  </span>
                  <input
                    id={`audit-${f.key}`}
                    type="number"
                    step={f.step}
                    value={form[f.key]}
                    data-testid={`audit-input-${f.key}`}
                    onChange={(e) => setForm({ ...form, [f.key]: parseFloat(e.target.value) || 0 })}
                  />
                  <i>{f.unit}</i>
                </div>
              ))}
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 12 }} disabled={audit.isPending} onClick={() => audit.mutate(form)} data-testid="audit-run">
            {zh.sim.runAudit} ▶
          </button>
        </div>

        <div>
          {!result && <div className="empty-state">{audit.isPending ? zh.common.loading : "填写计划字段后点「体检」"}</div>}
          {result && (
            <AuditResult
              out={result.out}
              gmStruct={result.gmStruct}
              snapshotVersion={result.snapshotVersion}
              canApplyFix={canApplyFix}
              canAdopt={canAdopt}
              onApplyFix={applyFix}
              onAdopt={(item) =>
                adopt.mutate({ versionId: `plan-${preset}`, reason: `规划体检 ${item.id}·${item.title}`, patch: item.fix?.patch ?? {} })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AuditResult({
  out,
  gmStruct,
  snapshotVersion,
  canApplyFix,
  canAdopt,
  onApplyFix,
  onAdopt,
}: {
  out: PlanAuditOutput;
  gmStruct?: number;
  snapshotVersion: string;
  canApplyFix: boolean;
  canAdopt: boolean;
  onApplyFix: (item: AuditItem) => void;
  onAdopt: (item: AuditItem) => void;
}) {
  const color = VERDICT_COLOR[out.verdict];
  const section = (title: string, cls: string, items: AuditItem[], withActions: boolean) =>
    items.length > 0 && (
      <>
        <div className={styles.secHead} style={{ color: cls === "hard" ? "var(--danger)" : cls === "med" ? "var(--amber)" : "var(--ok)" }}>
          {title}（{items.length}）
        </div>
        {items.map((item) => (
          <AuditCard
            key={`${cls}-${item.id}`}
            item={item}
            cls={cls}
            canApplyFix={withActions && canApplyFix}
            canAdopt={withActions && canAdopt}
            onApplyFix={onApplyFix}
            onAdopt={onAdopt}
          />
        ))}
      </>
    );

  return (
    <div className="panel" data-testid="audit-result">
      <div className={styles.verdict} style={{ borderColor: color, background: "transparent" }} data-testid="audit-verdict">
        <b style={{ color }}>{zh.sim.audit.verdict(out.verdict, out.score)}</b>
        <SnapshotBadge snapshotVersion={snapshotVersion} tool="plan_audit" />
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
          <span data-testid="audit-counts" className="mono">
            {out.H.length} 硬矛盾 / {out.M.length} 软风险 / {out.S.length} 建议
          </span>
          {gmStruct != null && (
            <>
               · {zh.sim.audit.gmStruct} <b className="mono">{gmStruct.toFixed(2)}%</b>（C15 口径）
            </>
          )}
        </div>
      </div>
      {section(zh.sim.audit.hardSection, "hard", out.H, true)}
      {section(zh.sim.audit.medSection, "med", out.M, true)}
      {section(zh.sim.audit.sugSection, "sug", out.S, true)}
      {out.H.length === 0 && out.M.length === 0 && out.S.length === 0 && (
        <div className={styles.noteInfo}>全部通过。可走 Action 进 S&OP 定稿流程（C10/C22）。</div>
      )}
    </div>
  );
}

function AuditCard({
  item,
  cls,
  canApplyFix,
  canAdopt,
  onApplyFix,
  onAdopt,
}: {
  item: AuditItem;
  cls: string;
  canApplyFix: boolean;
  canAdopt: boolean;
  onApplyFix: (item: AuditItem) => void;
  onAdopt: (item: AuditItem) => void;
}) {
  const [tlOpen, setTlOpen] = useState(false);
  return (
    <div className={`${styles.audCard} ${cls === "hard" ? styles.hard : cls === "med" ? styles.med : styles.sug}`} data-testid={`audit-item-${cls}-${item.id}`}>
      <div className={styles.audHead}>
        <b>
          {cls === "hard" ? "⛔" : cls === "med" ? "⚠" : "💡"} {item.title}
        </b>
        {item.ruleRef && <span className="badge amber">{item.ruleRef}</span>}
        <span className="badge">{item.id}</span>
      </div>
      <div className={styles.audWhy}>{item.why}</div>
      <div className={styles.audActions}>
        {item.fix && canApplyFix && Object.keys(item.fix.patch).length > 0 && (
          <button className="btn sm" data-testid={`apply-fix-${cls}-${item.id}`} onClick={() => onApplyFix(item)}>
            {zh.sim.audit.applyFix}：{item.fix.label}
          </button>
        )}
        {item.fix && canAdopt && (
          <button className="btn sm" data-testid={`adopt-${cls}-${item.id}`} onClick={() => onAdopt(item)}>
            {zh.sim.adoptToDraft}
          </button>
        )}
        <button className={styles.tlToggle} onClick={() => setTlOpen(!tlOpen)} data-testid={`tl-toggle-${cls}-${item.id}`}>
          {tlOpen ? "▼ 收起时序推演" : zh.sim.audit.timeline}
        </button>
      </div>
      {tlOpen && <RiskTimelineStrip />}
    </div>
  );
}

/** 时序推演展开：risk_timeline 求解器逐日张力条（与推演看板同源数学） */
function RiskTimelineStrip() {
  const { data, isLoading } = useQuery({
    queryKey: ["b", "solver", "risk_timeline"],
    queryFn: async () => {
      const res = await runSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  return (
    <div className={styles.tlBox} data-testid="audit-risk-timeline">
      <div style={{ fontSize: 10.5, color: "var(--muted2)", marginBottom: 4 }}>{zh.sim.audit.timelineHint}</div>
      {isLoading && <span style={{ fontSize: 11, color: "var(--muted)" }}>{zh.common.loading}</span>}
      {data?.cards.slice(0, 2).map((card) => (
        <div key={`${card.base}:${card.factor}`} style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 11 }}>
            {card.base} · {card.factor} · 峰值 <b className="mono">{card.peak.toFixed(0)}</b> · 越线日{" "}
            <b className="mono">{card.crossDay != null ? `D+${card.crossDay}` : zh.risk.noCross}</b>
          </span>
          <HeatStrip series={card.series} threshold={data.threshold} />
        </div>
      ))}
    </div>
  );
}
