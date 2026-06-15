import type { ReactNode } from "react";

/**
 * 管理平台增量 §6：空态引导规范 —— 每个管理页空态必须给「下一步」操作入口，
 * 禁止空白表格无操作入口。
 */
export function EmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="empty-state" data-testid="empty-cta" style={{ padding: "28px 0", textAlign: "center" }}>
      <div style={{ color: "var(--muted)", marginBottom: 12 }}>{message}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>{children}</div>
    </div>
  );
}
