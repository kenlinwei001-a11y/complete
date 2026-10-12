import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchNotifications, readNotification, readAllNotifications } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";

/**
 * 通知中心（运营完备性 OC8）：审批待办/校准提案/合并候选/隔离区告警等定向通知。
 * 后端 `/a/v1/notifications*` 已就绪，本页补前端列表 + 标记已读 + 跳转引用对象。
 */
const KIND_LABEL: Record<string, string> = {
  approval_pending: "待审批", action_approved: "审批通过", action_rejected: "审批驳回",
  calibration_proposal: "校准提案", merge_candidate: "合并候选", quarantine_alert: "隔离告警",
};
const refLink = (refType?: string, refId?: string): string | null => {
  if (!refType || !refId) return null;
  if (refType === "action") return "/admin/actions";
  if (refType === "calibration") return "/admin/calibration";
  if (refType === "quarantine") return "/admin/quarantine";
  return null;
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "notifications"], queryFn: fetchNotifications });
  const items = data?.items ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["a", "notifications"] });

  const read = useMutation({ mutationFn: (id: string) => readNotification(id), onSuccess: invalidate, onError: toastError });
  const readAll = useMutation({ mutationFn: () => readAllNotifications(), onSuccess: invalidate, onError: toastError });

  return (
    <div data-testid="notifications-page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>通知中心 {data?.unread ? <span className="badge amber" data-testid="notif-unread">{data.unread} 未读</span> : null}</h2>
        <button className="btn sm" data-testid="notif-read-all" disabled={readAll.isPending || !data?.unread} onClick={() => readAll.mutate()}>全部已读</button>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        {items.map((n) => {
          const link = refLink(n.refType, n.refId);
          return (
            <div key={n.id} data-testid={`notif-${n.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--line)", opacity: n.readAt ? 0.55 : 1 }}>
              <span className="badge">{KIND_LABEL[n.kind] ?? n.kind}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: n.readAt ? 400 : 600 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{n.body}</div>
              </div>
              {link && <Link to={link} className="btn sm" data-testid={`notif-goto-${n.id}`}>查看</Link>}
              {!n.readAt && <button className="btn sm" data-testid={`notif-read-${n.id}`} onClick={() => read.mutate(n.id)}>已读</button>}
            </div>
          );
        })}
      </div>
      {items.length === 0 && <div className="empty-state">暂无通知</div>}
    </div>
  );
}
