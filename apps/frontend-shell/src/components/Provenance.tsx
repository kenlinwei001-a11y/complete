import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectLineage } from "@/api/endpoints";

/** 数据新鲜度（R13）：源连接器 lastSyncAt → 人类可读 + 是否降级（>2h 视为延迟，对应 C09）。 */
function freshnessOf(lastSyncAt?: string | null): { label: string; stale: boolean } | null {
  if (!lastSyncAt) return null;
  const ms = Date.now() - new Date(lastSyncAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const h = ms / 3_600_000;
  const label = h < 1 ? `${Math.max(1, Math.round(ms / 60_000))} 分钟前同步` : h < 48 ? `${h.toFixed(1)}h 前同步` : `${Math.round(h / 24)} 天前同步`;
  return { label, stale: h > 2 };
}

/**
 * 活数据可溯（R13 结论可溯源 · 信任=出处+推导可当场亮出 · 参考原型 provSpan/provTip）：
 * 把推演结论里的数字包一层 → 虚线下划线 + 悬浮即弹溯源【六要素】：
 *   来源系统 · 新鲜度 · 推导公式 · 输入因子 · 关联规则 · 备注。
 * src/formula/fresh 来自 lineage 端点（活数据，懒加载）；rule/inputs/note 由高价值数字按需作者标注。
 * 源系统延迟时新鲜度标"降级"，呼应置信度下调（C09）。
 */
export function Provenance({
  objectType,
  objectId,
  rule,
  inputs,
  note,
  children,
}: {
  objectType: string;
  objectId: string;
  /** 关联规则编号（如 "C15"），高价值数字按需标注。 */
  rule?: string;
  /** 输入因子（喂给公式的上游）。 */
  inputs?: string[];
  /** 备注/解释。 */
  note?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["a", "lineage", objectType, objectId],
    queryFn: () => fetchObjectLineage(objectType, objectId),
    enabled: open,
    staleTime: 60_000,
  });
  const fresh = freshnessOf(data?.source?.connection?.lastSyncAt);

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
            minWidth: 320,
            padding: 10,
            fontSize: 11,
            textAlign: "left",
            whiteSpace: "normal",
            boxShadow: "0 8px 28px rgba(0,0,0,.45)",
          }}
        >
          {isLoading || !data ? (
            <span style={{ color: "var(--muted2)" }}>溯源中…</span>
          ) : (
            <>
              {/* ① 来源系统 + ② 新鲜度 */}
              <div>
                <span style={{ color: "var(--muted2)" }}>来源：</span>
                <b>{data.source?.connection?.name ?? "—（手工/纯派生）"}</b>
                {fresh && (
                  <span
                    data-testid="prov-fresh"
                    style={{ marginLeft: 6, color: fresh.stale ? "var(--amber, #E8B54A)" : "var(--muted2)" }}
                  >
                    {fresh.stale ? `⚠ ${fresh.label} · 降级` : fresh.label}
                  </span>
                )}
              </div>
              {/* 原始表 + 行 */}
              {data.source?.rawDataset && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>原始表：</span>
                  <b className="mono">{data.source.rawDataset.name}</b>
                  {data.source.rawRowIdx != null && <span> · 第 {data.source.rawRowIdx + 1} 行</span>}
                </div>
              )}
              {/* ③ 推导公式（派生口径） */}
              {data.derivations.length > 0 && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>推导：</span>
                  <code style={{ fontSize: 10 }}>{data.derivations.map((d) => d.formula).join(" · ")}</code>
                </div>
              )}
              {/* ④ 输入因子（作者标注） */}
              {inputs && inputs.length > 0 && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>输入因子：</span>
                  {inputs.join(" · ")}
                </div>
              )}
              {/* ⑤ 关联规则（作者标注） */}
              {rule && (
                <div style={{ marginTop: 3 }} data-testid="prov-rule">
                  <span style={{ color: "var(--muted2)" }}>关联规则：</span>
                  <b style={{ color: "var(--red, #DD7E9E)" }}>{rule}</b>
                </div>
              )}
              {/* ⑥ 备注 */}
              {note && <div style={{ marginTop: 3, color: "var(--muted)" }}>{note}</div>}
              <div style={{ marginTop: 5, color: "var(--muted2)", fontSize: 10 }}>信任 = 出处 + 推导可当场亮出</div>
            </>
          )}
        </span>
      )}
    </span>
  );
}
