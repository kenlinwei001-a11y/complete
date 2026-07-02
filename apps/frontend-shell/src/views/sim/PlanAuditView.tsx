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
import { SnapshotBadge, useAdoptToDraft, MarginLedgerTable } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import { buildPropagation, PropagationTimeline } from "./PropagationTimeline";
import { DataModeBadge } from "@/components/DataModeBadge";
import { DecisionModeBanner } from "@/components/DecisionModeBanner";
import { decisionVerdictColor } from "@/components/DecisionValue";
import { DailyDotAxis, type DotOrder } from "@/components/DailyDotAxis";
import { KsfGraph } from "@/components/KsfGraph";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { Provenance } from "@/components/Provenance";
import { RuleRef } from "@/components/RuleRef";
import { ExternalSignalStrip } from "@/components/ExternalSignalStrip";
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

// PRD-IND-audit §3.1：verdict 4 态色板（站不住红 / 重要风险黄 / 关注青 / 全通过绿）。
const VERDICT_COLOR: Record<PlanAuditOutput["verdict"], string> = {
  站不住: "var(--danger)",
  可定稿但有重要风险: "var(--amber)",
  "可定稿·关注风险": "var(--c-capacity)",
  "全部通过·可直接定稿": "var(--ok)",
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
      {/* UI缺口 M5：外部信号 chip 条（环境感知·接 EXT_SIG 现成）。 */}
      <ExternalSignalStrip testId="ext-signal-audit" />
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

      {/* audit.3：财务 KSF 图（问题→KSF→财务指标 3 层；问题节点点击联动其时序轴）。audit/generate 共用组件。 */}
      <KsfGraph />
      {/* 轨R #4：项目级聚合毛利勾稽表（Σ负+正贡献闭合·与驾驶舱毛利勾稽同源 affected_orders.marginLedger）。 */}
      <MarginLedgerTable testId="margin-ledger-audit" />
      {/* inference-process 横切：本次规划体检推演的编排过程 DAG */}
      <InferenceProcessPanel testId="inference-audit" solved />
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
  // WO-DATAMODE-SWEEP（KILL-MOCK-RED 漏网点）：合成/估算（dataMode 显式非 LIVE）时决策级裁决色降级为中性灰
  // （不让"站不住/可定稿 65 分"看起来像真裁决），并在结论区顶部披露横幅；LIVE/未标 → 原裁决色。
  const color = decisionVerdictColor(VERDICT_COLOR[out.verdict], out.dataMode);
  const section = (title: string, cls: string, items: AuditItem[], withActions: boolean) =>
    items.length > 0 && (
      <>
        <div className={styles.secHead} style={{ color: decisionVerdictColor(cls === "hard" ? "var(--danger)" : cls === "med" ? "var(--amber)" : "var(--ok)", out.dataMode) }}>
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
      {/* WO-DATAMODE-SWEEP：合成/估算披露横幅（移植风险看板范式）——非 LIVE 时诚实标"不作真实决策依据"。 */}
      <DecisionModeBanner dataMode={out.dataMode} testId="audit-datamode-banner" note="体检评分与硬矛盾/软风险裁决由合成计划基线推演，接入真实 S&OP 后转真实裁决" />
      <div className={styles.verdict} style={{ borderColor: color, background: "transparent" }} data-testid="audit-verdict">
        <b style={{ color }}>{zh.sim.audit.verdict(out.verdict, out.score, out.M.length)}</b>
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
  return (
    <div className={`${styles.audCard} ${cls === "hard" ? styles.hard : cls === "med" ? styles.med : styles.sug}`} data-testid={`audit-item-${cls}-${item.id}`}>
      <div className={styles.audHead}>
        <b>
          {cls === "hard" ? "⛔" : cls === "med" ? "⚠" : "✓"} {item.title}
        </b>
        {/* 轨N 增量1·N-R3：规则号接 RuleRef（就地悬浮出定义/阈值/作用域/版本，不再让用户跳 /admin/rules）。 */}
        {item.ruleRef && (
          <span data-testid={`rule-badge-${cls}-${item.id}`}><RuleRef code={item.ruleRef} /></span>
        )}
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
        {item.fix && <span style={{ fontSize: 10, color: "var(--muted2)" }}>{zh.sim.audit.fixFootnote}</span>}
        {(cls === "hard" || cls === "med") && (
          <button className={styles.tlToggle} onClick={() => setTlOpen(!tlOpen)} data-testid={`tl-toggle-${cls}-${item.id}`}>
            {tlOpen ? "▼ 收起时序推演" : zh.sim.audit.timeline}
          </button>
        )}
      </div>
      {tlOpen && <RiskPropagation itemId={item.id} kind={item.kind} />}
    </div>
  );
}

/** 时序推演展开：逐日圆点轴按审计项 kind 路由 audit_timeline 出各自曲线（PRD §2②，非共用一条）；
 * 4 节点传导链 stepper 仍由 risk_timeline 渲染（PropagationTimeline，与 §7.11 问题卡共用 + 订单弹窗）。 */
function RiskPropagation({ itemId, kind }: { itemId: string; kind?: string }) {
  // ① 逐日圆点轴：按 kind 派生（每审计项独立曲线）。
  const dot = useQuery({
    queryKey: ["b", "solver", "audit_timeline", kind ?? "struct"],
    queryFn: async () => {
      const res = await runSolver("audit_timeline", { kind: kind ?? "struct" });
      return res.data as { kind: string; series: number[]; threshold: number; crossDay: number | null; peak: number; events?: unknown[]; affectedOrders?: unknown[]; dataMode?: string };
    },
  });
  // ② 4 节点传导链 stepper + 受影响订单弹窗：复用 risk_timeline（全局唯一 PropagationTimeline 实现）。
  const { data: rt, isLoading } = useQuery({
    queryKey: ["b", "solver", "risk_timeline"],
    queryFn: async () => {
      const res = await runSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  const vm = rt ? buildPropagation(rt) : null;
  return (
    <div className={styles.tlBox} data-testid={`audit-risk-timeline-${itemId}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "var(--muted2)", marginBottom: 4 }}>
        <span>{zh.sim.audit.timelineHint}{kind ? ` · 口径：${kind}` : ""}</span>
        {/* A0 诚实位：audit_timeline 曲线由 kind 名哈希确定性派生（无实测）、波及订单真算 → 标 PARTIAL/MOCK，禁哈希冒充真算 */}
        <DataModeBadge
          mode={dot.data?.dataMode}
          note="逐日传导曲线/峰值/越线日为确定性派生（kind 名哈希·无实测）；波及订单由产能传导引擎真算"
          testId={`audit-timeline-datamode-${itemId}`}
        />
      </div>
      {isLoading && <span style={{ fontSize: 11, color: "var(--muted)" }}>{zh.common.loading}</span>}
      {/* PRD §2②：逐日圆点轴消费按 kind 派生的 audit_timeline series（每项独立曲线） */}
      {dot.data && (
        <DailyDotAxis
          series={dot.data.series}
          threshold={dot.data.threshold}
          crossDay={dot.data.crossDay}
          peak={dot.data.peak}
          events={(dot.data.events ?? []) as never}
          affectedOrders={(dot.data.affectedOrders ?? []) as unknown as DotOrder[]}
          testId={`dda-${itemId}`}
        />
      )}
      {vm && <PropagationTimeline vm={vm} testId={`ptl-${itemId}`} />}
    </div>
  );
}
