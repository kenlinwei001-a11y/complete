import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrowthRunReport, WorklistItem, WorklistKind, WorklistStatus } from "@platform/contracts";
import {
  runGrowth,
  fetchGrowthLedger,
  fetchGrowthWorklist,
  claimWorklistItem,
  releaseWorklistItem,
  fillWorklistItem,
} from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError, toast } from "@/store/toastStore";
import { DrillBack } from "@/components/DrillBack";

/**
 * 自成长发动机驾驶舱（PRD-growth-worklist-human-fill）：把"客户问题"当燃料跑一轮 LOOP（探针→诊断缺口），
 * 缺数据**不再自动补**——诊断出的可补项登记为**在办看板**一行（OPEN·DATA_GAP）；人按状态/认领人/类型筛 →
 * 认领 → 点「补数据缺口」→ 才真跑 fillData/provisionWorld（R6 seed 确定性）→ DONE → 可继续推演重跑。
 * G-9：自动补 → 人工闸控补（更诚实·人可控）。
 */
const TERMINAL_BADGE: Record<string, { label: string; cls: string }> = {
  CONVERGED: { label: "已收敛 ✓", cls: "green" },
  BOUNDARY: { label: "边界（仅剩缺功能工单）", cls: "amber" },
  MAX_ROUNDS: { label: "未收敛（达 K 轮）", cls: "red" },
  NEEDS_HUMAN: { label: "待人工补（已入在办看板）", cls: "amber" },
};
const WL_STATUS_BADGE: Record<WorklistStatus, string> = {
  OPEN: "amber", CLAIMED: "blue", IN_PROGRESS: "blue", DONE: "green", NEEDS_HUMAN: "amber",
};
const WL_KIND_LABEL: Record<WorklistKind, string> = {
  DATA_GAP: "缺数据", PLAN_SCAFFOLD: "缺计划", FEATURE: "缺功能",
};
const WL_KIND_BADGE: Record<WorklistKind, string> = { DATA_GAP: "amber", PLAN_SCAFFOLD: "blue", FEATURE: "" };

export default function GrowthCockpitPage() {
  const qc = useQueryClient();
  const { data: workspace } = useWorkspace();
  const myUserId = workspace?.user?.id;
  const [query, setQuery] = useState("常州影响哪些订单？"); // debattery-allow（输入框示例占位，非业务常数）
  const [maxRounds, setMaxRounds] = useState(4);
  const [report, setReport] = useState<GrowthRunReport | null>(null);
  // 筛选（状态/认领人/类型）
  const [fStatus, setFStatus] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fKind, setFKind] = useState("");

  const { data: ledger } = useQuery({ queryKey: ["b", "growth-ledger"], queryFn: fetchGrowthLedger });
  // 看板拉全量（前端做类型/状态/认领人筛，逐值对照后端；owner=me 收窄经后端）。
  const { data: worklist } = useQuery({ queryKey: ["b", "growth-worklist"], queryFn: () => fetchGrowthWorklist() });

  const invalidateBoard = () => {
    void qc.invalidateQueries({ queryKey: ["b", "growth-worklist"] });
    void qc.invalidateQueries({ queryKey: ["b", "growth-ledger"] });
  };

  const run = useMutation({
    mutationFn: () => runGrowth(query, maxRounds),
    onSuccess: (r) => { setReport(r); invalidateBoard(); },
    onError: toastError,
  });
  const claim = useMutation({
    mutationFn: (id: string) => claimWorklistItem(id),
    onSuccess: () => { toast("已认领", "success"); invalidateBoard(); },
    onError: toastError,
  });
  const release = useMutation({
    mutationFn: (id: string) => releaseWorklistItem(id),
    onSuccess: () => { toast("已释放", "success"); invalidateBoard(); },
    onError: toastError,
  });
  const fill = useMutation({
    mutationFn: (id: string) => fillWorklistItem(id),
    onSuccess: (w) => { toast(`补数据缺口完成：${w.result ?? "已补"}`, "success"); invalidateBoard(); },
    onError: toastError,
  });
  const rerun = useMutation({
    mutationFn: (q: string) => runGrowth(q, maxRounds),
    onSuccess: (r) => { setReport(r); toast("已继续推演重跑", "success"); invalidateBoard(); },
    onError: toastError,
  });

  const runs = ledger?.items ?? [];
  const allItems = worklist?.items ?? [];
  // 认领人下拉去重（来自 items 的 owner）。
  const owners = useMemo(() => [...new Set(allItems.map((i) => i.owner).filter((x): x is string => !!x))], [allItems]);
  // 前端筛（逐值对照后端全量收窄）。
  const items = allItems.filter((i) =>
    (!fStatus || i.status === fStatus) &&
    (!fKind || i.kind === fKind) &&
    (!fOwner || (fOwner === "me" ? i.owner === myUserId : i.owner === fOwner)),
  );

  // 量化头条：需求可答率（账本）/ 待认领 / 我的在办 / 补成率。
  const answerable = runs.filter((e) => e.report.terminalState === "CONVERGED").length;
  const answerRate = runs.length ? Math.round((answerable / runs.length) * 100) : 0;
  const openCount = allItems.filter((i) => i.status === "OPEN").length;
  const mineCount = allItems.filter((i) => i.owner === myUserId && (i.status === "CLAIMED" || i.status === "IN_PROGRESS")).length;
  const doneCount = allItems.filter((i) => i.status === "DONE").length;
  const fillRate = allItems.length ? Math.round((doneCount / allItems.length) * 100) : 0;

  const rowActions = (i: WorklistItem) => {
    // FIX（复验 BLOCK）：FEATURE/PLAN_SCAFFOLD 是 GrowthTicket 只读映射（id=工单 id·非 growthWorklist 项）——
    // 其生命周期走各自工单流程（审批/开发），绝不走 worklist claim/fill（否则认领→后端按 worklist id 查不到→404 静默）。
    // 故按类型**先**分流：仅 DATA_GAP 真在办项才有认领→补→继续推演的完整闸控生命周期。
    if (i.kind === "PLAN_SCAFFOLD") return <a className="btn sm" data-testid={`wl-approve-${i.id}`} href={i.deeplink ?? "/admin/actions"}>去审批</a>;
    if (i.kind === "FEATURE") return <span className="muted" style={{ fontSize: 11 }} data-testid={`wl-feature-${i.id}`}>需开发（工单）</span>;
    // DATA_GAP：真在办项·完整人工闸生命周期。
    if (i.status === "OPEN") return <button className="btn sm" data-testid={`wl-claim-${i.id}`} onClick={() => claim.mutate(i.id)} disabled={claim.isPending}>认领</button>;
    if (i.status === "DONE") return <button className="btn sm" data-testid={`wl-rerun-${i.id}`} onClick={() => rerun.mutate(i.fromQuestion)} disabled={rerun.isPending}>继续推演</button>;
    // CLAIMED / IN_PROGRESS
    return (
      <span style={{ display: "inline-flex", gap: 6 }}>
        <button className="btn primary sm" data-testid={`wl-fill-${i.id}`} onClick={() => fill.mutate(i.id)} disabled={fill.isPending}>{fill.isPending ? "补数中…" : "补数据缺口"}</button>
        <button className="btn sm" data-testid={`wl-release-${i.id}`} onClick={() => release.mutate(i.id)} disabled={release.isPending}>释放</button>
      </span>
    );
  };

  return (
    <div data-testid="growth-cockpit-page">
      {/* R17 下钻回退：发育驾驶舱是二级下钻页（从别页/徽章跳入），兜底回目录。 */}
      <DrillBack fallbackTo="/admin/catalog" testId="growth-back" />
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>自成长发动机驾驶舱</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        把"客户明确问题"当燃料：真跑一遍 QOS 诊断缺口 → 缺数据**不自动补**，登记在办看板 → 人认领后点「补数据缺口」才真跑（R6 确定性）→ 缺功能出工单。
      </div>

      {/* 运行 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input data-testid="growth-query" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
        <label style={{ fontSize: 12 }}>K <input data-testid="growth-k" type="number" value={maxRounds} min={1} max={20} onChange={(e) => setMaxRounds(Number(e.target.value))} style={{ width: 56 }} /></label>
        <button className="btn primary sm" data-testid="growth-run" disabled={run.isPending || !query.trim()} onClick={() => run.mutate()}>{run.isPending ? "跑动中…" : "运行"}</button>
      </div>

      {/* 量化指标 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", gap: 24, fontSize: 12, flexWrap: "wrap" }}>
        <span data-testid="metric-answer-rate">需求可答率 <b style={{ color: "var(--ok)" }}>{answerRate}%</b> <span className="muted">({answerable}/{runs.length})</span></span>
        <span>待认领 <b className="amber" data-testid="metric-open-tickets">{openCount}</b></span>
        <span>我的在办 <b data-testid="wl-metric-mine">{mineCount}</b></span>
        <span>补成率 <b style={{ color: "var(--ok)" }} data-testid="wl-metric-fillrate">{fillRate}%</b> <span className="muted">({doneCount}/{allItems.length})</span></span>
      </div>

      {/* 本次运行结果 */}
      {report && (
        <div className="panel" style={{ marginBottom: 12 }} data-testid="growth-report">
          <div className="section-title">
            本次运行 <span className={`badge ${TERMINAL_BADGE[report.terminalState]?.cls}`} data-testid="growth-terminal">{TERMINAL_BADGE[report.terminalState]?.label}</span>
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{report.rounds.length} 轮 / K={report.maxRounds}</span>
          </div>
          {report.rounds.map((rd) => (
            <div key={rd.round} data-testid={`growth-round-${rd.round}`} style={{ fontSize: 11.5, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
              <b>第 {rd.round} 轮</b> · 缺口 <span className="badge">{rd.gapReport.verdict}</span>{" "}
              {rd.gapReport.findings.map((f, i) => <span key={i} className="mono" style={{ marginLeft: 6 }}>{f.gapCode}</span>)}
              {rd.fillApplied && <span style={{ marginLeft: 8, color: "var(--muted)" }}>→ 补：{rd.fillApplied.action}{rd.fillApplied.advanced ? " ✓推进" : ""}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 在办看板（筛：状态/认领人/类型 + 认领 + 补数据缺口）。
          TICKET-CENTER-UNIFIED：本页保留为诊断运行视图（操作列保留·dev 定夺声明：驾驶舱是"跑诊断→就地补"工作流，
          收敛操作会打断该闭环）；跨类型聚合 + 详情抽屉在工单中心。 */}
      <div className="section-title">
        在办看板（去自动补·人工触发补数据缺口）
        <a href="/admin/tickets" className="btn sm" style={{ marginLeft: 8 }} data-testid="growth-to-ticket-center">→ 工单中心（全类型聚合·详情清单）</a>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <select data-testid="wl-filter-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="OPEN">待认领 OPEN</option>
          <option value="CLAIMED">已认领 CLAIMED</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="DONE">DONE</option>
          <option value="NEEDS_HUMAN">NEEDS_HUMAN</option>
        </select>
        <select data-testid="wl-filter-owner" value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
          <option value="">全部认领人</option>
          <option value="me">我（{myUserId ?? "?"}）</option>
          {owners.filter((o) => o !== myUserId).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select data-testid="wl-filter-kind" value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="">全部类型</option>
          <option value="DATA_GAP">缺数据 DATA_GAP</option>
          <option value="PLAN_SCAFFOLD">缺计划 PLAN_SCAFFOLD</option>
          <option value="FEATURE">缺功能 FEATURE</option>
        </select>
      </div>
      <table className="cmp" data-testid="growth-worklist" style={{ width: "100%", marginBottom: 14 }}>
        <thead><tr><th>问题</th><th>缺口码</th><th>类型</th><th>状态</th><th>认领人</th><th>操作</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} data-testid={`wl-row-${i.id}`}>
              <td style={{ fontSize: 11.5 }}>{i.fromQuestion}</td>
              <td className="mono">{i.gapCode}</td>
              <td><span className={`badge ${WL_KIND_BADGE[i.kind]}`}>{WL_KIND_LABEL[i.kind]}</span></td>
              <td><span className={`badge ${WL_STATUS_BADGE[i.status]}`} data-testid={`wl-status-${i.id}`}>{i.status}</span></td>
              <td style={{ fontSize: 11.5 }} data-testid={`wl-owner-${i.id}`}>{i.owner ?? "—"}</td>
              <td>{rowActions(i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <div className="empty-state" data-testid="wl-empty">{allItems.length === 0 ? "暂无在办项——跑一个问题诊断缺口。" : "无匹配筛选的在办项。"}</div>}

      {/* 成长账本 */}
      <div className="section-title">成长账本（demand-indexed）</div>
      <table className="cmp" data-testid="growth-ledger" style={{ width: "100%" }}>
        <thead><tr><th>客户问题</th><th>终态</th><th>轮数</th><th>工单</th></tr></thead>
        <tbody>
          {runs.map((e) => (
            <tr key={e.id} data-testid={`ledger-${e.id}`}>
              <td style={{ fontSize: 11.5 }}>{e.report.question}</td>
              <td><span className={`badge ${TERMINAL_BADGE[e.report.terminalState]?.cls}`}>{e.report.terminalState}</span></td>
              <td className="mono">{e.report.rounds.length}</td>
              <td className="mono">{e.report.openTickets.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && <div className="empty-state">暂无运行记录——输入一个客户问题点「运行」。</div>}
    </div>
  );
}
