import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectLineage, fetchDataHealth } from "@/api/endpoints";
import { RuleRef } from "./RuleRef";

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
 * 两种供数：
 *   ① 对象数据 → 传 objectType+objectId，src/formula/fresh 由 lineage 端点懒加载（活数据）。
 *   ② 推演结论的计算值（如 P50/P90/缺口）→ 传 src/formula（按数据点作者标注，无对象可溯时用）。
 * 两类都可叠加 rule/inputs/note。源系统延迟时新鲜度标"降级"，呼应置信度下调（C09）。
 */
export function Provenance({
  objectType,
  objectId,
  src,
  formula,
  freshness,
  rule,
  inputs,
  note,
  testId,
  children,
}: {
  /** 对象溯源模式：传则懒加载 lineage（来源/原始表/派生口径来自活数据）。 */
  objectType?: string;
  objectId?: string;
  /** 作者标注模式：计算型结论数字直接给来源/公式/新鲜度。 */
  src?: string;
  formula?: string;
  freshness?: string;
  /** 两类都可叠加。 */
  rule?: string;
  inputs?: string[];
  note?: string;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasLineage = Boolean(objectType && objectId);
  const { data, isLoading } = useQuery({
    queryKey: ["a", "lineage", objectType, objectId],
    queryFn: () => fetchObjectLineage(objectType!, objectId!),
    enabled: open && hasLineage,
    staleTime: 60_000,
  });
  // R13 收尾#2：新鲜度统一从全局 DATA_HEALTH 注册表取（单一来源），源系统降级时全链一致降级。
  const { data: health } = useQuery({ queryKey: ["a", "data-health", {}], queryFn: fetchDataHealth, enabled: open, staleTime: 60_000 });

  // 合并：lineage（活数据）优先，作者标注兜底
  const srcName = data?.source?.connection?.name ?? src ?? null;
  const formulas = data && data.derivations.length > 0 ? data.derivations.map((d) => d.formula) : formula ? [formula] : [];
  // 新鲜度优先级：DATA_HEALTH（按 connId 或源系统名匹配）> 连接器 lastSyncAt > 作者标注
  const connId = data?.source?.connection?.id;
  const hk = health?.sources.find((s) => (connId && s.connId === connId) || (!!src && (src === s.system || src.includes(s.system))));
  const fresh: { label: string; stale: boolean; impact?: string } | null = hk
    ? {
        label: `${hk.system} · ${hk.status === "OK" ? "正常" : hk.status} · 延迟 ${hk.latencyMin}min`,
        stale: hk.status !== "OK",
        impact: hk.degradeImpact ? `P90 ${hk.degradeImpact.p90From}→${hk.degradeImpact.p90To}（C09 降级）` : undefined,
      }
    : freshnessOf(data?.source?.connection?.lastSyncAt) ?? (freshness ? { label: freshness, stale: false } : null);
  const loading = open && hasLineage && (isLoading || !data);
  const tid = `prov-${objectType ?? "v"}-${objectId ?? testId ?? "x"}`;

  return (
    <span
      style={{ borderBottom: "1px dashed var(--muted)", cursor: "help", position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      data-testid={tid}
    >
      {children}
      {open && (
        <span
          /* 欠账 #104：这层浮在密集正文之上，必须走**不透明**的 .popover-surface，
             不能复用磨砂玻璃 .panel（底下的字会透上来与本层文字叠印）。投影随主题走 --popover-shadow，
             不再内联硬编码 rgba。 */
          className="popover-surface"
          role="tooltip"
          data-testid="prov-tip"
          style={{
            position: "absolute",
            zIndex: 60,
            top: "130%",
            left: 0,
            minWidth: 320,
            padding: 10,
            fontSize: 12,
            textAlign: "left",
            whiteSpace: "normal",
          }}
        >
          {loading ? (
            <span style={{ color: "var(--muted2)" }}>溯源中…</span>
          ) : (
            <>
              {/* ① 来源系统 + ② 新鲜度 */}
              <div>
                <span style={{ color: "var(--muted2)" }}>来源：</span>
                <b>{srcName ?? "—（手工/纯派生）"}</b>
                {fresh && (
                  <span data-testid="prov-fresh" style={{ marginLeft: 6, color: fresh.stale ? "var(--amber, #E8B54A)" : "var(--muted2)" }}>
                    {fresh.stale ? `⚠ ${fresh.label} · 降级` : fresh.label}
                    {fresh.impact && <span style={{ marginLeft: 4 }}>· {fresh.impact}</span>}
                  </span>
                )}
              </div>
              {/* 原始表 + 行（仅对象溯源模式） */}
              {data?.source?.rawDataset && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>原始表：</span>
                  <b className="mono">{data.source.rawDataset.name}</b>
                  {data.source.rawRowIdx != null && <span> · 第 {data.source.rawRowIdx + 1} 行</span>}
                </div>
              )}
              {/* ③ 推导公式 */}
              {formulas.length > 0 && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>推导：</span>
                  <code style={{ fontSize: 12 }}>{formulas.join(" · ")}</code>
                </div>
              )}
              {/* ④ 输入因子 */}
              {inputs && inputs.length > 0 && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: "var(--muted2)" }}>输入因子：</span>
                  {inputs.join(" · ")}
                </div>
              )}
              {/* ⑤ 关联规则 */}
              {rule && (
                <div style={{ marginTop: 3 }} data-testid="prov-rule">
                  <span style={{ color: "var(--muted2)" }}>关联规则：</span>
                  {/* 两跳：再悬浮规则编号 → 规则完整定义 */}
                  <RuleRef code={rule} />
                </div>
              )}
              {/* ⑥ 备注 */}
              {note && <div style={{ marginTop: 3, color: "var(--muted)" }}>{note}</div>}
              <div style={{ marginTop: 5, color: "var(--muted2)", fontSize: 12 }}>信任 = 出处 + 推导可当场亮出</div>
            </>
          )}
        </span>
      )}
    </span>
  );
}
