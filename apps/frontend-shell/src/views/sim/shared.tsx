import { useMutation, useQuery } from "@tanstack/react-query";
import { createActionDraft, runSolver } from "@/api/endpoints";
import type { AffectedOrdersOutputVM } from "@/api/types";
import { Provenance } from "@/components/Provenance";
import { notLiveDecision } from "@/components/DecisionValue";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

/** 数字一律 --font-mono */
export const fmt = (v: number, d = 1): string => v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** 溯源角标：求解器结果带 snapshotVersion（一个事实一个出处） */
export function SnapshotBadge({ snapshotVersion, tool }: { snapshotVersion?: string; tool: string }) {
  if (!snapshotVersion) return null;
  return (
    <span className="badge" title={`invoke_solver:${tool} · snapshot ${snapshotVersion}`} data-testid="snapshot-badge">
      ⓘ {zh.sim.snapshotBadge(snapshotVersion)}
    </span>
  );
}

/** 逐日张力 heat strip（与推演看板 MiniStrip 同视觉语言；risk-board 未导出 → 此处独立实现） */
export function HeatStrip({ series, threshold }: { series: number[]; threshold: number }) {
  return (
    <div className={styles.heatStrip} data-testid="sim-heat-strip">
      {series.map((v, i) => (
        <span
          key={i}
          title={`D+${i} · ${v.toFixed(0)}`}
          style={{
            background:
              v >= threshold
                ? "rgba(224,98,108,.85)"
                : v >= threshold - 15
                  ? "rgba(232,181,74,.7)"
                  : `rgba(67,183,215,${0.15 + (v / 100) * 0.55})`,
          }}
        />
      ))}
    </div>
  );
}

/** 采纳 → Action 草稿（C10 审批留痕，统一 actionTypeKey=plan_change —— 体检页旧链路保留） */
export function useAdoptToDraft() {
  const { data: workspace } = useWorkspace();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      createActionDraft({
        actionTypeKey: "plan_change",
        payload,
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }),
    onSuccess: () => toast(`${zh.sim.adoptDone}（${zh.sim.gotoActions}：/admin/actions）`, "success"),
    onError: toastError,
  });
}

/**
 * 轨R #4（母版 · 规划侧项目级聚合毛利勾稽表）：规划根因 DAG 下方挂综合毛利率逐细分贡献勾稽——
 * 数据源 = affected_orders 聚合 marginLedger（与驾驶舱「综合毛利率勾稽闭合」**同一求解器、同一来源**，
 * 不另起并行求解器·R13/R14/RL5）。Σ贡献 = 综合毛利率（正/负贡献闭合到缺口），表脚显示闭合徽。
 */
export function MarginLedgerTable({ testId = "margin-ledger" }: { testId?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["b", "solver", "affected_orders", "margin-ledger"],
    queryFn: async () => {
      const res = await runSolver("affected_orders", {});
      const vm = res.data as AffectedOrdersOutputVM;
      // WO-DATAMODE-SWEEP（FIX·补漏）：透传顶层 dataMode → 合成/估算时缺口贡献 danger 红降级中性。
      return vm.marginLedger ? { ...vm.marginLedger, dataMode: vm.dataMode } : undefined;
    },
  });
  if (isLoading) return <div className="panel" data-testid={testId}><div style={{ color: "var(--muted2)" }}>{zh.common.loading}</div></div>;
  if (!data || data.bySegment.length === 0) return null; // 无聚合数据 → 不渲染（向后兼容，不画空表）
  // 合成/估算（显式非 LIVE）→ 缺口贡献/闭合等 decision 级 danger 降级中性（凡 danger 决策组件必守 dataMode）。
  const mlNotLive = notLiveDecision(data.dataMode);
  const gapColor = (v: number) => (mlNotLive ? "var(--muted2)" : v < 0 ? "var(--danger)" : "var(--ok)");

  return (
    <div className="panel" data-testid={testId} style={{ marginTop: 12 }}>
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        项目级聚合毛利勾稽（Σ负+正贡献闭合 · 与驾驶舱同源）
        <Provenance
          testId={`${testId}-prov`}
          src="affected_orders 求解器（订单全链聚合 · marginLedger）"
          formula="综合毛利率 = Σ_细分(营收占比 × 细分毛利率)；缺口 = Σ_细分(营收占比 ×(细分毛利率 − 目标))"
          inputs={["各应用细分营收占比", "各细分毛利率", "毛利率目标"]}
          rule="C15/C24"
          note="与经营驾驶舱「综合毛利率勾稽闭合」同一求解器输出（marginLedger）·非另起并行求解器"
        >
          <span className="badge">ⓘ</span>
        </Provenance>
      </div>
      <table className="data-table mono" data-testid={`${testId}-table`} style={{ width: "100%", fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>应用细分</th>
            <th style={{ textAlign: "right" }}>营收(万)</th>
            <th style={{ textAlign: "right" }}>营收占比</th>
            <th style={{ textAlign: "right" }}>细分毛利率</th>
            <th style={{ textAlign: "right" }}>对综合毛利贡献(pp)</th>
            <th style={{ textAlign: "right" }}>对缺口贡献(pp)</th>
            <th style={{ textAlign: "right" }}>订单数</th>
          </tr>
        </thead>
        <tbody>
          {data.bySegment.map((s) => (
            <tr key={s.seg} data-testid={`${testId}-row-${s.seg}`}>
              <td style={{ textAlign: "left" }}>{s.seg}</td>
              <td style={{ textAlign: "right" }}>{fmt(s.revenue, 0)}</td>
              <td style={{ textAlign: "right" }}>{(s.revShare * 100).toFixed(1)}%</td>
              <td style={{ textAlign: "right" }}>{s.marginPct.toFixed(1)}%</td>
              <td style={{ textAlign: "right" }}>{s.contributionPp.toFixed(2)}</td>
              <td style={{ textAlign: "right", color: gapColor(s.gapContributionPp) }}>
                {s.gapContributionPp >= 0 ? "+" : ""}{s.gapContributionPp.toFixed(2)}
              </td>
              <td style={{ textAlign: "right" }}>{s.orderCount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1px solid var(--line)", fontWeight: 600 }} data-testid={`${testId}-total`}>
            <td style={{ textAlign: "left" }}>合计（勾稽）</td>
            <td style={{ textAlign: "right" }}>—</td>
            <td style={{ textAlign: "right" }}>100%</td>
            <td style={{ textAlign: "right" }}>—</td>
            <td style={{ textAlign: "right" }}>Σ {data.gmRatePct.toFixed(2)} = 综合毛利率</td>
            <td style={{ textAlign: "right", color: gapColor(data.gapPp) }}>
              Σ {data.gapPp >= 0 ? "+" : ""}{data.gapPp.toFixed(2)}
            </td>
            <td style={{ textAlign: "right" }}>—</td>
          </tr>
        </tfoot>
      </table>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
        综合毛利率 <b className="mono">{data.gmRatePct.toFixed(2)}%</b> vs 目标 <b className="mono">{data.targetPct.toFixed(1)}%</b> · 缺口{" "}
        <b className="mono" style={{ color: gapColor(data.gapPp) }}>{data.gapPp >= 0 ? "+" : ""}{data.gapPp.toFixed(2)}pp{mlNotLive ? "·估算" : ""}</b>{" "}
        <span className="badge" style={{ background: mlNotLive ? "rgba(154,168,182,.18)" : data.reconciled ? "rgba(98,190,119,.18)" : "rgba(224,98,108,.18)", color: mlNotLive ? "var(--muted2)" : data.reconciled ? "var(--ok)" : "var(--danger)" }} data-testid={`${testId}-reconciled`}>
          {data.reconciled ? "已闭合 ✓" : "未闭合"}
        </span>
      </div>
    </div>
  );
}

/**
 * 采纳类按钮统一行为（增量 §0-4）：POST /a/v1/action-drafts（actionType 按各节）
 * → toast「草稿已创建，待审批」+ 链接 /admin/actions。任何视图不得直改计划/排产数据。
 */
export function useActionDraft() {
  const { data: workspace } = useWorkspace();
  return useMutation({
    mutationFn: (input: { actionTypeKey: string; payload: Record<string, unknown> }) =>
      createActionDraft({
        actionTypeKey: input.actionTypeKey,
        payload: input.payload,
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }),
    onSuccess: () => toast(`草稿已创建，待审批（${zh.sim.gotoActions}：/admin/actions）`, "success"),
    onError: toastError,
  });
}
