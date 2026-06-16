import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PlanAuditOutputSchema,
  RiskTimelineOutputSchema,
  type PlanAuditInput,
  type PlanAuditOutput,
} from "@platform/contracts";
import { fetchPlanVersionCurrent, runSolver } from "@/api/endpoints";
import { useFeature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import type { ViewRendererProps } from "../registry";
import { SnapshotBadge, useAdoptToDraft } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import { buildPropagation, PropagationTimeline } from "./PropagationTimeline";
import { Provenance } from "@/components/Provenance";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

type AuditItem = PlanAuditOutput["H"][number];

const FIELD_GROUPS: { title: string; fields: { key: keyof PlanAuditInput; label: string; unit: string; step: number }[] }[] = [
  {
    title: "需求侧（万套）",
    fields: [
      { key: "dem", label: "月度需求总量", unit: "万套", step: 0.1 },
      { key: "seg_pas", label: "乘用车", unit: "万套", step: 0.1 }, // debattery-allow：view.layout.fieldGroups 缺失兜底
      { key: "seg_ess", label: "储能", unit: "万套", step: 0.1 },
      { key: "seg_com", label: "商用车", unit: "万套", step: 0.1 }, // debattery-allow：同上
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
      { key: "gmTarget", label: "毛利率目标", unit: "%", step: 0.5 },
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

/**
 * 规划体检（renderer=plan-audit，增量 §7.10）：
 * 基线来自当前定稿 S&OP 版本（GET /a/v1/plan-versions/current），改任意字段
 * debounce 300ms 即时重检（plan_audit），竞态最后发出者胜。
 */
export default function PlanAuditView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：体检字段组结构由 ViewConfig.layout 声明（学 DashboardView），FIELD_GROUPS 仅兜底
  const fieldGroups = (view.layout?.fieldGroups as typeof FIELD_GROUPS | undefined) ?? FIELD_GROUPS;
  const baseline = useQuery({ queryKey: ["a", "plan-version-current"], queryFn: fetchPlanVersionCurrent });
  const [form, setForm] = useState<PlanAuditInput | null>(null);
  const canApplyFix = useFeature("act.plan-audit.apply-fix");
  const canAdopt = useFeature("act.adopt-to-draft");
  const adopt = useAdoptToDraft();

  // 基线到达 → 预填输入面板 + 选中对象写入共享 store（查询 Dock 随问句携带）
  useEffect(() => {
    if (!baseline.data || form !== null) return;
    setForm(baseline.data.input);
    useSessionStore.getState().setSelectedObjects([
      {
        objectType: "PlanVersion",
        objectId: baseline.data.versionId ?? "plan-baseline",
        label: `月度计划基线（${baseline.data.versionLabel}）`,
      },
    ]);
  }, [baseline.data, form]);

  const audit = useLiveSolver(
    "plan_audit",
    form as Record<string, unknown> | null,
    (raw) => ({
      out: PlanAuditOutputSchema.parse(raw),
      gmStruct: (raw as { gmStruct?: number }).gmStruct,
    }),
  );

  const applyFix = (item: AuditItem) => {
    if (!item.fix || !form) return;
    setForm({ ...form, ...(item.fix.patch as Partial<PlanAuditInput>) }); // 应用即触发重检（debounce）
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
        <button
          className="btn sm"
          data-testid="audit-reset"
          disabled={!baseline.data}
          onClick={() => baseline.data && setForm(baseline.data.input)}
        >
          {zh.sim.audit.resetInput}
        </button>
      </div>

      <div className={styles.baselineBar} data-testid="audit-baseline">
        <span className="badge blue">{baseline.data ? zh.sim.audit.baseline(baseline.data.versionLabel) : zh.common.loading}</span>
        {audit.isFetching && <span style={{ color: "var(--muted2)" }}>重检中…</span>}
      </div>

      <div className={styles.twoCol}>
        <div className="panel">
          <div className="section-title">{zh.sim.audit.inputTitle}</div>
          {!form && <div className="empty-state">{zh.common.loading}</div>}
          {form &&
            fieldGroups.map((g) => (
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
        </div>

        <div>
          {!audit.data && <div className="empty-state">{zh.common.loading}</div>}
          {audit.data && (
            <AuditResult
              out={audit.data.out}
              gmStruct={audit.data.gmStruct}
              snapshotVersion={audit.snapshotVersion ?? undefined}
              canApplyFix={canApplyFix}
              canAdopt={canAdopt}
              onApplyFix={applyFix}
              onAdopt={(item) =>
                adopt.mutate({
                  versionId: baseline.data?.versionId ?? "plan-baseline",
                  reason: `规划体检 ${item.id}·${item.title}`,
                  patch: item.fix?.patch ?? {},
                })
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
  snapshotVersion?: string;
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
               · {zh.sim.audit.gmStruct}{" "}
              {/* 体检关键结论（#4 backlog）：结构毛利率六要素溯源（C15 口径） */}
              <Provenance
                testId="audit-gmstruct"
                src="plan_audit 求解器（财务域）"
                formula="结构毛利率 = Σ(细分销量 × 细分毛利率) ÷ Σ销量"
                inputs={["各应用细分需求结构", "各细分毛利率"]}
                rule="C15"
                note="按需求结构动态加权，区别于单一毛利率目标"
              >
                <b className="mono">{gmStruct.toFixed(2)}%</b>
              </Provenance>
              （C15 口径）
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
  const [ruleOpen, setRuleOpen] = useState(false);
  return (
    <div className={`${styles.audCard} ${cls === "hard" ? styles.hard : cls === "med" ? styles.med : styles.sug}`} data-testid={`audit-item-${cls}-${item.id}`}>
      <div className={styles.audHead}>
        <b>
          {cls === "hard" ? "⛔" : cls === "med" ? "⚠" : "✓"} {item.title}
        </b>
        {item.ruleRef && (
          <button className="badge amber" style={{ cursor: "pointer" }} data-testid={`rule-badge-${cls}-${item.id}`} onClick={() => setRuleOpen(!ruleOpen)}>
            {item.ruleRef}
          </button>
        )}
        <span className="badge">{item.id}</span>
      </div>
      {ruleOpen && (
        <div className={styles.noteInfo} style={{ fontSize: 10.5 }}>
          规则 <b className="mono">{item.ruleRef}</b> · 表达式见规则库（/admin/rules），点击徽章收起。
        </div>
      )}
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
        {item.fix && <span style={{ fontSize: 10, color: "var(--muted2)" }}>{zh.sim.audit.fixFootnote}</span>}
        {(cls === "hard" || cls === "med") && (
          <button className={styles.tlToggle} onClick={() => setTlOpen(!tlOpen)} data-testid={`tl-toggle-${cls}-${item.id}`}>
            {tlOpen ? "▼ 收起时序推演" : zh.sim.audit.timeline}
          </button>
        )}
      </div>
      {tlOpen && <RiskPropagation itemId={item.id} />}
    </div>
  );
}

/** 时序推演展开（§7.10-4）：risk_timeline 同构传导数据 → PropagationTimeline（与 §7.11 问题卡共用全局唯一实现） */
function RiskPropagation({ itemId }: { itemId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["b", "solver", "risk_timeline"],
    queryFn: async () => {
      const res = await runSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  const vm = data ? buildPropagation(data) : null;
  return (
    <div className={styles.tlBox} data-testid={`audit-risk-timeline-${itemId}`}>
      <div style={{ fontSize: 10.5, color: "var(--muted2)", marginBottom: 4 }}>{zh.sim.audit.timelineHint}</div>
      {isLoading && <span style={{ fontSize: 11, color: "var(--muted)" }}>{zh.common.loading}</span>}
      {vm && <PropagationTimeline vm={vm} testId={`ptl-${itemId}`} />}
    </div>
  );
}
