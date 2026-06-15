import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectLineage } from "@/api/endpoints";

/**
 * 活数据可溯（PRD-live-traceable-data §3.3 / 参考原型 provSpan/provTip）：
 * 把推演结论里的一个对象数据包一层 → 虚线下划线 + 悬浮即弹"引用来源"：
 * 来源连接器 / 原始表 + 行 / 派生口径。数据来自 lineage 端点（活数据，非写死字典）。
 * 悬停时才懒加载 lineage（enabled=open），避免列表整页预取。
 */
export function Provenance({
  objectType,
  objectId,
  children,
}: {
  objectType: string;
  objectId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["a", "lineage", objectType, objectId],
    queryFn: () => fetchObjectLineage(objectType, objectId),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <span
      style={{ borderBottom: "1px dashed var(--muted)", cursor: "help", position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      data-testid={`prov-${objectType}-${objectId}`}
    >
      {children}
      {open && (
        <span
          className="panel"
          role="tooltip"
          data-testid="prov-tip"
          style={{
            position: "absolute",
            zIndex: 60,
            top: "130%",
            left: 0,
            minWidth: 300,
            padding: 10,
            fontSize: 11,
            textAlign: "left",
            whiteSpace: "normal",
            boxShadow: "0 8px 28px rgba(0,0,0,.45)",
          }}
        >
          {isLoading || !data ? (
            <span style={{ color: "var(--muted2)" }}>溯源中…</span>
          ) : data.source ? (
            <>
              <div>
                <span style={{ color: "var(--muted2)" }}>来源：</span>
                <b>{data.source.connection?.name ?? "—"}</b>
              </div>
              <div style={{ marginTop: 3 }}>
                <span style={{ color: "var(--muted2)" }}>原始表：</span>
                <b className="mono">{data.source.rawDataset?.name ?? "—"}</b>
                {data.source.rawRowIdx != null && <span> · 第 {data.source.rawRowIdx + 1} 行</span>}
              </div>
              {data.derivations.length > 0 && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>派生口径：</span>
                  <span className="mono">{data.derivations.map((d) => d.prop).join(" · ")}</span>
                </div>
              )}
              <div style={{ marginTop: 5, color: "var(--muted2)", fontSize: 10 }}>一个事实一个出处 · 可溯回原始数据</div>
            </>
          ) : (
            <span style={{ color: "var(--muted2)" }}>无原始表来源（手工录入 / 纯派生对象）</span>
          )}
        </span>
      )}
    </span>
  );
}
