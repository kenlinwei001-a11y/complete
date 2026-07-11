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

/**
 * WO-FAKE-08（P0 前端 defake·堵根）：单 tick「全局态」标量的**权威口径·两只读控件的单一引用点**
 * （SimComparePanel + SandboxRunHistory 同引本函数——一处口径·一处修双处引）。
 * 与 SandboxView 的 computeGlobalKpi/carrierMean（WO-CAP-03-KPI-FIX）**同口径**。
 *
 * 病根（此前两控件各自的 tickMean）：`Σ 所有对象 × 所有 stateVar ÷ cnt` = **跨维扁平均**——
 * 把 totalDemand(32 万量级) 等**无界计数变量**与 util(0-100) 混进一个平均，分母还被全对象数稀释（同 ÷575 病），
 * 产出的"全局态"既非 0-100 也无量纲意义，却被 A/B 对比表 / heat strip / sparkline 当**权威 KPI** 显示 → 误导决策。
 *
 * 口径（与 CAP-03 一字对齐）：
 *   ① 各 stateVar 只在**携带该变量的对象**上取均值（分母 = 携带者，非全对象）；
 *   ② 同一变量若携带者跨分数(≤1)/百分(>1)两量纲，把分数值 ×100 归一到 0-100（避免 0.95 与 92 混算）；
 *   ③ 仅纳入归一后 ≤100 的**有界比率/百分变量**（排除无界计数变量）；④ 末端 clamp 0-100。
 * 无任何有界变量（退化）→ 诚实返 0（不臆造扁平混算值·不冒充权威 KPI）。
 *
 * 携带者/量纲信息全从 `state`（= 后端 compare/session 真快照逐 tick 态）派生，零业务常数（R14）。
 */
export function globalKpiFromState(state: Record<string, Record<string, number>>): number {
  const objs = Object.keys(state);
  if (objs.length === 0) return 0;
  const vars = new Set<string>();
  for (const o of objs) for (const v of Object.keys(state[o] ?? {})) vars.add(v);
  const perVar: number[] = [];
  for (const v of vars) {
    const carriers = objs.filter((o) => {
      const r = state[o]?.[v];
      return typeof r === "number" && Number.isFinite(r);
    });
    if (carriers.length === 0) continue;
    let vals = carriers.map((o) => state[o]![v]!);
    const hasPct = vals.some((x) => x > 1);
    const hasFrac = vals.some((x) => x <= 1);
    if (hasPct && hasFrac) vals = vals.map((x) => (x <= 1 ? x * 100 : x)); // 分数→百分，统一 0-100
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean <= 100) perVar.push(mean); // 排除无界计数变量（归一后仍 >100 → 剔除·与 computeGlobalKpi 一致）
  }
  if (perVar.length === 0) return 0;
  const m = perVar.reduce((a, b) => a + b, 0) / perVar.length;
  return Math.max(0, Math.min(100, m));
}

/** 溯源角标：求解器结果带 snapshotVersion（一个事实一个出处） */
export function SnapshotBadge({ snapshotVersion, tool }: { snapshotVersion?: string; tool: string }) {
  if (!snapshotVersion) return null;
  return (
    <span className="badge" title={`invoke_solver:${tool} · snapshot ${snapshotVersion}`} data-testid="snapshot-badge">
      ⓘ {zh.sim.snapshotBadge(snapshotVersion)}
    </span>
  );
}

/**
 * SIM-REAL-SNAPSHOT（簇D3）：沙盘热度红带阈的**前端单一兜底真源**——仅当 view-config 未下发 heatThreshold
 * 时使用（权威值来自后端 DEFAULT_SANDBOX_HEAT_THRESHOLD·随 view-config 下发）。取代此前散落各视图内联的 70。
 */
export const DEFAULT_HEAT_THRESHOLD = 70;

/** 逐日张力 heat strip（与推演看板 MiniStrip 同视觉语言；risk-board 未导出 → 此处独立实现） */
export function HeatStrip({ series, threshold = DEFAULT_HEAT_THRESHOLD }: { series: number[]; threshold?: number }) {
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
