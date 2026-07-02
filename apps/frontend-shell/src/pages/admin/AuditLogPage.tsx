import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuditLogEntry } from "@platform/contracts";
import { fetchAuditLog } from "@/api/endpoints";

/**
 * WO-AUDIT-LOG-UI（G-VIS-1 · 合规审计日志前端落地）：补 IPO 断层——后端 append-only audit_log 有真值
 * （GET /a/v1/audit-log 返 actorId/action/targetKind/before/after），此前前端零入口零页面，产品内看不到
 * "谁(actorId)何时(at)对什么(targetKind)做了什么(action)、改前改后(before/after)"。
 * 本页只读消费该端点：表格 + 按 action/actor/target 筛选 + 展开见 before→after diff（前端所见=后端真值·R13 可溯源）。
 */
export default function AuditLogPage() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // actor/target 后端过滤（adminplatform.ts 端点支持）；action 后端未支持 → 客户端过滤。
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "audit-log", { actor, target }],
    queryFn: () => fetchAuditLog({ actor: actor || undefined, target: target || undefined, limit: 500 }),
    retry: false,
  });

  const items = data?.items ?? [];
  // action 下拉候选（从当前结果集去重·真值驱动·非写死枚举）。
  const actionOptions = useMemo(() => [...new Set(items.map((e) => e.action))].sort(), [items]);
  const rows = action ? items.filter((e) => e.action === action) : items;

  return (
    <div data-testid="audit-log-page">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16 }}>审计日志</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>谁·何时·对什么·做了什么·改前改后（append-only·R13 可溯源）</span>
        <select value={action} aria-label="按动作筛选" data-testid="audit-filter-action" onChange={(e) => setAction(e.target.value)} style={{ marginLeft: "auto" }}>
          <option value="">全部动作</option>
          {actionOptions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input value={actor} aria-label="按操作者筛选" data-testid="audit-filter-actor" placeholder="操作者 actorId" onChange={(e) => setActor(e.target.value)} style={{ width: 150 }} />
        <input value={target} aria-label="按目标筛选" data-testid="audit-filter-target" placeholder="目标类型/ID" onChange={(e) => setTarget(e.target.value)} style={{ width: 150 }} />
      </div>

      {isLoading && <div style={{ color: "var(--muted2)" }}>加载中…</div>}
      {isError && <div className="empty-state" data-testid="audit-error">审计日志读取失败（需 admin / auditor / platform_admin 角色）</div>}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="empty-state" data-testid="audit-empty">暂无审计记录——做一次管理变更（改规则 / 配 audit-sink / 改权限等）后，此处记录谁何时改了什么。</div>
      )}

      {rows.length > 0 && (
        <div className="panel">
          <table className="cmp" data-testid="audit-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>动作</th>
                <th>目标</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <AuditRow key={e.id} e={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 6 }}>共 {data?.total ?? rows.length} 条（显示 {rows.length}）</div>
        </div>
      )}
    </div>
  );
}

function AuditRow({ e, open, onToggle }: { e: AuditLogEntry; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr style={{ cursor: "pointer" }} onClick={onToggle} data-testid={`audit-row-${e.id}`}>
        <td className="mono" style={{ fontSize: 11 }}>{e.at.replace("T", " ").slice(0, 19)}</td>
        <td className="mono">{e.actorId}</td>
        <td><span className="badge" data-testid={`audit-action-${e.id}`}>{e.action}</span></td>
        <td className="zh">{e.targetKind}<span style={{ color: "var(--muted2)" }}> · {e.targetId}</span></td>
        <td style={{ color: "var(--accent)" }}>{open ? "▾" : "▸"} diff</td>
      </tr>
      {open && (
        <tr data-testid={`audit-diff-${e.id}`}>
          <td colSpan={5}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12, background: "var(--panel2,rgba(255,255,255,.03))", borderRadius: 6, padding: "8px 10px" }}>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>改前 (before)</div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-testid={`audit-before-${e.id}`}>{e.before ? JSON.stringify(e.before, null, 2) : "—（创建/无前值）"}</pre>
              </div>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>改后 (after)</div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-testid={`audit-after-${e.id}`}>{e.after ? JSON.stringify(e.after, null, 2) : "—（删除/无后值）"}</pre>
              </div>
            </div>
            {e.requestId && <div style={{ fontSize: 10.5, color: "var(--muted2)", marginTop: 4 }}>requestId: {e.requestId}（跨系统日志同源）</div>}
          </td>
        </tr>
      )}
    </>
  );
}
