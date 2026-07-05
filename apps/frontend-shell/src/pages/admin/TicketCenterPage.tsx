import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TicketBoardRow, TicketDetail } from "@platform/contracts";
import {
  fetchTicketBoard,
  fetchTicketDetail,
  claimWorklistItem,
  releaseWorklistItem,
  fillWorklistItem,
  runGrowth,
} from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import { DrillBack } from "@/components/DrillBack";

/**
 * 统一工单中心（TICKET-CENTER-UNIFIED·用户亲定 2026-07-05）：
 * 「所有类似需要补数据/补求解器/补…，认领之后都集中在一个页面，点击每个工单，都可以看到详情，列举补充的内容」。
 * - 聚合全类型（三源真值·零造行）：WorklistItem(DATA_GAP) + B3 HARD DataRequest 人工描述单 + GrowthTicket(FEATURE/PLAN_SCAFFOLD/SOLVER_GAP)；
 *   kind 为开放扩展位——ONTO-SCEN 批次 NEEDS_HUMAN 发育工单（GrowthTicket 同源）自动进面，零硬耦合。
 * - Tab：全部 | 待认领 | 我的在办（认领后默认落此·跨类型聚合）| 已完成。
 * - 点行 → 详情抽屉（侧滑）：通用段（问句/缺口码/类型/状态时间线/认领人）+ **补充内容清单段**（按类型列举 what needs to be supplied）。
 * - kind-first 权限语义不破（GROWTH fix）：仅 WORKLIST 真在办项（claimable）走认领/释放/补生命周期；
 *   FEATURE/SOLVER_GAP 只读、PLAN_SCAFFOLD 深链去审批——绝不对 gtk_ 调 worklist claim（后端 409 guard 同守）。
 */
const KIND_LABEL: Record<string, string> = {
  DATA_GAP: "缺数据",
  DATA_REQUEST: "补数描述单",
  PLAN_SCAFFOLD: "缺计划",
  SOLVER_GAP: "缺求解器",
  FEATURE: "缺功能",
};
const KIND_BADGE: Record<string, string> = { DATA_GAP: "amber", DATA_REQUEST: "red", PLAN_SCAFFOLD: "blue", SOLVER_GAP: "blue", FEATURE: "" };
const STATUS_BADGE: Record<string, string> = { OPEN: "amber", CLAIMED: "blue", IN_PROGRESS: "blue", DONE: "green", NEEDS_HUMAN: "amber" };

type TabKey = "all" | "open" | "mine" | "done";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "open", label: "待认领" },
  { key: "mine", label: "我的在办" },
  { key: "done", label: "已完成" },
];

const fmt = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });

export default function TicketCenterPage() {
  const qc = useQueryClient();
  const { data: workspace } = useWorkspace();
  const myUserId = workspace?.user?.id;
  const [tab, setTab] = useState<TabKey>("all");
  const [fKind, setFKind] = useState("");
  // ONTO-SCEN-LAUNCH-DET §2.5 深链：?ticket=<id>（发育卡「已建工单 #N」/通知中心）→ 直开详情抽屉。
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("ticket"),
  );

  const { data: board } = useQuery({ queryKey: ["b", "ticket-board"], queryFn: fetchTicketBoard });
  const allRows = board?.items ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["b", "ticket-board"] });
    void qc.invalidateQueries({ queryKey: ["b", "ticket-detail"] });
    void qc.invalidateQueries({ queryKey: ["b", "growth-worklist"] });
  };

  const claim = useMutation({
    mutationFn: (id: string) => claimWorklistItem(id),
    // 认领后默认落「我的在办」（用户亲定：认领之后都集中在一个页面）。
    onSuccess: () => { toast("已认领——已归入「我的在办」", "success"); setTab("mine"); invalidate(); },
    onError: toastError,
  });
  const release = useMutation({
    mutationFn: (id: string) => releaseWorklistItem(id),
    onSuccess: () => { toast("已释放", "success"); invalidate(); },
    onError: toastError,
  });
  const fill = useMutation({
    mutationFn: (id: string) => fillWorklistItem(id),
    onSuccess: (w) => { toast(`补数据缺口完成：${w.result ?? "已补"}`, "success"); invalidate(); },
    onError: toastError,
  });
  const rerun = useMutation({
    mutationFn: (q: string) => runGrowth(q),
    onSuccess: () => { toast("已继续推演重跑", "success"); invalidate(); },
    onError: toastError,
  });

  // Tab 收窄（跨类型聚合）：待认领=OPEN；我的在办=owner==me 且未完成；已完成=DONE。
  const rows = useMemo(() => allRows.filter((r) => {
    if (fKind && r.kind !== fKind) return false;
    if (tab === "open") return r.status === "OPEN";
    if (tab === "mine") return r.owner === myUserId && (r.status === "CLAIMED" || r.status === "IN_PROGRESS");
    if (tab === "done") return r.status === "DONE";
    return true;
  }), [allRows, tab, fKind, myUserId]);

  const tabCount = (k: TabKey) => allRows.filter((r) => {
    if (k === "open") return r.status === "OPEN";
    if (k === "mine") return r.owner === myUserId && (r.status === "CLAIMED" || r.status === "IN_PROGRESS");
    if (k === "done") return r.status === "DONE";
    return true;
  }).length;

  const kinds = useMemo(() => [...new Set(allRows.map((r) => r.kind))].sort(), [allRows]);

  // 行内操作随态（kind-first 分流·GROWTH fix 409 guard 语义保真）：
  const rowActions = (r: TicketBoardRow) => {
    if (!r.claimable) {
      // GrowthTicket 只读映射行：绝不出认领（误调 worklist claim → 后端 409）；PLAN_SCAFFOLD 深链去审批，其余"需开发（工单）"。
      if (r.kind === "PLAN_SCAFFOLD") return <a className="btn sm" data-testid={`tc-approve-${r.id}`} href={r.deeplink ?? "/admin/actions"} onClick={(e) => e.stopPropagation()}>去审批</a>;
      return <span className="muted" style={{ fontSize: 11 }} data-testid={`tc-readonly-${r.id}`}>需开发（工单）</span>;
    }
    if (r.status === "OPEN") return <button className="btn sm" data-testid={`tc-claim-${r.id}`} onClick={(e) => { e.stopPropagation(); claim.mutate(r.id); }} disabled={claim.isPending}>认领</button>;
    if (r.status === "DONE") return <button className="btn sm" data-testid={`tc-rerun-${r.id}`} onClick={(e) => { e.stopPropagation(); rerun.mutate(r.fromQuestion); }} disabled={rerun.isPending}>继续推演</button>;
    if (r.status === "NEEDS_HUMAN") return <span className="muted" style={{ fontSize: 11 }}>待人工</span>;
    // CLAIMED / IN_PROGRESS：DATA_REQUEST（HARD 导入）走真人正门深链，DATA_GAP 可触发补。
    const isImport = r.kind === "DATA_REQUEST";
    return (
      <span style={{ display: "inline-flex", gap: 6 }}>
        {isImport
          ? <a className="btn sm" data-testid={`tc-import-${r.id}`} href={r.deeplink ?? "/connections"} onClick={(e) => e.stopPropagation()}>去导入</a>
          : <button className="btn primary sm" data-testid={`tc-fill-${r.id}`} onClick={(e) => { e.stopPropagation(); fill.mutate(r.id); }} disabled={fill.isPending}>{fill.isPending ? "补数中…" : "补数据缺口"}</button>}
        <button className="btn sm" data-testid={`tc-release-${r.id}`} onClick={(e) => { e.stopPropagation(); release.mutate(r.id); }} disabled={release.isPending}>释放</button>
      </span>
    );
  };

  return (
    <div data-testid="ticket-center-page">
      <DrillBack fallbackTo="/admin/catalog" testId="tc-back" />
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>工单中心</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        全类型补 X 工单一页集中（缺数据 / 补数描述单 / 缺计划 / 缺求解器 / 缺功能）——点工单看详情与补充内容清单；认领后归入「我的在办」。
        诊断运行视图见 <a href="/admin/growth">自成长驾驶舱</a>。
      </div>

      {/* Tab（跨类型聚合收窄） */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn sm${tab === t.key ? " primary" : ""}`}
            data-testid={`tc-tab-${t.key}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="mono" style={{ fontSize: 10 }}>{tabCount(t.key)}</span>
          </button>
        ))}
        <select data-testid="tc-filter-kind" value={fKind} onChange={(e) => setFKind(e.target.value)} style={{ marginLeft: "auto" }}>
          <option value="">全部类型</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k} {k}</option>)}
        </select>
      </div>

      <table className="cmp" data-testid="tc-board" style={{ width: "100%" }}>
        <thead><tr><th>问题 / 来由</th><th>缺口码</th><th>类型</th><th>状态</th><th>认领人</th><th>操作</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`tc-row-${r.id}`} style={{ cursor: "pointer" }} onClick={() => setSelectedId(r.id)} title="点击查看详情与补充内容清单">
              <td style={{ fontSize: 11.5 }}>{r.fromQuestion}</td>
              <td className="mono">{r.gapCode}</td>
              <td><span className={`badge ${KIND_BADGE[r.kind] ?? ""}`} data-testid={`tc-kind-${r.id}`}>{KIND_LABEL[r.kind] ?? r.kind}</span></td>
              <td><span className={`badge ${STATUS_BADGE[r.status] ?? ""}`} data-testid={`tc-status-${r.id}`}>{r.status}</span></td>
              <td style={{ fontSize: 11.5 }} data-testid={`tc-owner-${r.id}`}>{r.owner ?? "—"}</td>
              <td>{rowActions(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="empty-state" data-testid="tc-empty">
          {allRows.length === 0 ? "暂无工单——在自成长驾驶舱跑一个问题诊断缺口，或场景发育/就绪探测出缺口后自动登记。" : "本 Tab / 类型下暂无工单。"}
        </div>
      )}

      {selectedId && <TicketDetailDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

/** 详情抽屉（侧滑）：通用段 + 状态时间线 + 补充内容清单段（核心·按类型列举）。 */
function TicketDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: detail, isLoading, error } = useQuery({ queryKey: ["b", "ticket-detail", id], queryFn: () => fetchTicketDetail(id) });
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.32)" }}
      data-testid="tc-drawer-backdrop"
    >
      <aside
        className="panel"
        data-testid="tc-drawer"
        role="complementary"
        aria-label="工单详情"
        style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 520, maxWidth: "92vw", overflowY: "auto", padding: 14, boxShadow: "-8px 0 28px rgba(0,0,0,.4)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>工单详情</strong>
          <span className="mono muted" style={{ fontSize: 10 }}>{id}</span>
          <button className="btn sm" style={{ marginLeft: "auto" }} aria-label="关闭" data-testid="tc-drawer-close" onClick={onClose}>✕</button>
        </div>
        {isLoading && <div className="hint">加载中…</div>}
        {error != null && <div className="empty-state">详情加载失败：{(error as Error).message}</div>}
        {detail && <TicketDetailBody detail={detail} />}
      </aside>
    </div>
  );
}

function Row({ k, children, testId }: { k: string; children: React.ReactNode; testId?: string }) {
  return (
    <tr>
      <td style={{ width: 92, color: "var(--muted2)", verticalAlign: "top" }}>{k}</td>
      <td data-testid={testId}>{children}</td>
    </tr>
  );
}

function TicketDetailBody({ detail }: { detail: TicketDetail }) {
  const { row, timeline, supply } = detail;
  return (
    <div data-testid="tc-detail-body">
      {/* 通用段：问句 / 缺口码 / 类型 / 认领人 / 状态时间线 */}
      <table className="cmp" style={{ width: "100%", marginBottom: 12 }}>
        <tbody>
          <Row k="来自问句" testId="tc-d-question">{row.fromQuestion}</Row>
          <Row k="缺口码" testId="tc-d-gapcode"><span className="mono">{row.gapCode}</span></Row>
          <Row k="类型" testId="tc-d-kind"><span className={`badge ${KIND_BADGE[row.kind] ?? ""}`}>{KIND_LABEL[row.kind] ?? row.kind}</span> <span className="mono muted" style={{ fontSize: 10 }}>{row.kind}·{row.source}</span></Row>
          <Row k="状态" testId="tc-d-status"><span className={`badge ${STATUS_BADGE[row.status] ?? ""}`}>{row.status}</span></Row>
          <Row k="认领人" testId="tc-d-owner">{row.owner ?? "—"}</Row>
          <Row k="诊断证据" testId="tc-d-evidence"><span style={{ fontSize: 11 }}>{row.evidence}</span></Row>
        </tbody>
      </table>
      <div className="section-title" style={{ fontSize: 12 }}>状态时间线</div>
      <ul data-testid="tc-d-timeline" style={{ fontSize: 11, margin: "4px 0 12px", paddingLeft: 18 }}>
        {timeline.map((t, i) => <li key={i}><span className="mono muted">{fmt(t.at)}</span> · {t.label}</li>)}
      </ul>

      {/* 补充内容清单段（核心）：按类型列举 what needs to be supplied —— 全部真源字段投影（R13）。 */}
      <div className="section-title" style={{ fontSize: 12 }}>补充内容清单</div>
      <div data-testid="tc-d-supply" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {supply.fillPlan && (
          <table className="cmp" style={{ width: "100%" }} data-testid="tc-d-fillplan">
            <tbody>
              <Row k="补法">{supply.fillPlan.mode} · {supply.fillPlan.action}</Row>
              {supply.fillPlan.typeKey && <Row k="对象类型" testId="tc-d-fillplan-type"><span className="mono">{supply.fillPlan.typeKey}</span></Row>}
              {supply.fillPlan.fields && supply.fillPlan.fields.length > 0 && <Row k="字段" testId="tc-d-fillplan-fields"><span className="mono">{supply.fillPlan.fields.join(" · ")}</span></Row>}
              {supply.fillPlan.rows != null && <Row k="行数" testId="tc-d-fillplan-rows"><span className="mono">{supply.fillPlan.rows}</span></Row>}
              {supply.fillPlan.seed != null && <Row k="seed">{supply.fillPlan.seed}（R6 确定性）</Row>}
            </tbody>
          </table>
        )}
        {supply.requires && supply.requires.length > 0 && (
          <div data-testid="tc-d-requires">
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>数据依赖清单（DataDependency requires · present / needed 实测）</div>
            <table className="cmp" style={{ width: "100%" }}>
              <thead><tr><th>角色</th><th>解析类型</th><th>现有</th><th>需要</th><th>就绪</th></tr></thead>
              <tbody>
                {supply.requires.map((r) => (
                  <tr key={r.roleType} data-testid={`tc-d-require-${r.roleType}`}>
                    <td className="mono">{r.roleType}</td>
                    <td className="mono">{r.resolvedType ?? "—"}</td>
                    <td className="mono">{r.present}</td>
                    <td className="mono">{r.needed}</td>
                    <td>{r.ok ? "✓" : "✗ 缺"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {supply.boundary && (
          <div data-testid="tc-d-boundary" className="panel" style={{ padding: 8, fontSize: 11 }}>
            <b>{supply.boundary.gate}</b> · {supply.boundary.conclusion}
          </div>
        )}
        {supply.dataRequest && (
          <div data-testid="tc-d-datarequest">
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>精确补数请求（DataRequest·人工描述单）</div>
            <table className="cmp" style={{ width: "100%" }}>
              <tbody>
                <Row k="对象类型" testId="tc-d-dr-type"><span className="mono">{supply.dataRequest.typeKey}</span></Row>
                {supply.dataRequest.columns.length > 0 && <Row k="列清单" testId="tc-d-dr-columns"><span className="mono">{supply.dataRequest.columns.join(" · ")}</span></Row>}
                {supply.dataRequest.entities.length > 0 && <Row k="涉实体" testId="tc-d-dr-entities">{supply.dataRequest.entities.join(" · ")}</Row>}
                <Row k="原因">{supply.dataRequest.reason}</Row>
                {supply.dataRequest.description && <Row k="人工描述" testId="tc-d-dr-desc">{supply.dataRequest.description}</Row>}
              </tbody>
            </table>
            {supply.dataRequest.descriptionSchema && supply.dataRequest.descriptionSchema.length > 0 && (
              <div style={{ marginTop: 6 }} data-testid="tc-d-dr-schema">
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>需人工填写的描述项（descriptionSchema）</div>
                <table className="cmp" style={{ width: "100%" }}>
                  <thead><tr><th>字段</th><th>说明</th></tr></thead>
                  <tbody>
                    {supply.dataRequest.descriptionSchema.map((f) => (
                      <tr key={f.field} data-testid={`tc-d-dr-field-${f.field}`}><td className="mono">{f.field}</td><td style={{ fontSize: 11 }}>{f.hint}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {supply.ioContract && (
          <div data-testid="tc-d-iocontract">
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>I/O 契约线索（求解器/功能骨架签名来源）</div>
            <table className="cmp" style={{ width: "100%" }}>
              <tbody>
                <Row k="输入" testId="tc-d-io-inputs">{supply.ioContract.inputs.length > 0 ? <span className="mono">{supply.ioContract.inputs.join(" · ")}</span> : "—"}</Row>
                <Row k="输出形状" testId="tc-d-io-output">{supply.ioContract.outputShape.length > 0 ? <span className="mono">{supply.ioContract.outputShape.join(" · ")}</span> : "—"}</Row>
              </tbody>
            </table>
          </div>
        )}
        {supply.ontologyRefs && (supply.ontologyRefs.objectTypes.length > 0 || supply.ontologyRefs.slices.length > 0 || supply.ontologyRefs.rules.length > 0) && (
          <div data-testid="tc-d-ontorefs">
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>本体引用（施工定位）</div>
            <table className="cmp" style={{ width: "100%" }}>
              <tbody>
                {supply.ontologyRefs.objectTypes.length > 0 && <Row k="对象类型"><span className="mono">{supply.ontologyRefs.objectTypes.join(" · ")}</span></Row>}
                {supply.ontologyRefs.slices.length > 0 && <Row k="切片"><span className="mono">{supply.ontologyRefs.slices.join(" · ")}</span></Row>}
                {supply.ontologyRefs.rules.length > 0 && <Row k="规则"><span className="mono">{supply.ontologyRefs.rules.join(" · ")}</span></Row>}
              </tbody>
            </table>
          </div>
        )}
        {supply.acceptance && (
          <div data-testid="tc-d-acceptance" className="panel" style={{ padding: 8, fontSize: 11 }}>
            <b>验收线索</b> · {supply.acceptance}
          </div>
        )}
        {supply.scaffoldedDrafts && supply.scaffoldedDrafts.length > 0 && (
          <div data-testid="tc-d-drafts">
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>已 scaffold 的 DRAFT 步序（审批发布即施工·R4 非自动发布）</div>
            <ol style={{ fontSize: 11, margin: 0, paddingLeft: 18 }}>
              {supply.scaffoldedDrafts.map((d, i) => <li key={i} data-testid={`tc-d-draft-${d.key}`}><span className="mono">{d.kind}</span> · {d.key}</li>)}
            </ol>
          </div>
        )}
        {supply.deeplink && (
          <a className="btn sm" href={supply.deeplink} data-testid="tc-d-deeplink" style={{ alignSelf: "flex-start" }}>
            {row.kind === "PLAN_SCAFFOLD" ? "去审批 →" : row.kind === "DATA_REQUEST" ? "去导入（真人正门）→" : "打开操作深链 →"}
          </a>
        )}
        {!supply.fillPlan && !supply.dataRequest && !supply.ioContract && !supply.acceptance && (!supply.scaffoldedDrafts || supply.scaffoldedDrafts.length === 0) && (
          <div className="empty-state" style={{ fontSize: 11 }}>该工单真源未携结构化补充清单——以上方诊断证据为准（诚实空态，不造行）。</div>
        )}
      </div>
    </div>
  );
}
