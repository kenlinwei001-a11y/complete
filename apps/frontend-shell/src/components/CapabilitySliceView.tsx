import type { CapabilitySlice, VerifiedStatus } from "@platform/contracts";

/**
 * WO-5（可信自我账 §3.6·SELF-SURFACES-SLICE）：散落自我面 → 统一 Capability/Gap slice 视图（**共享组件**）。
 *
 * 各散落自我面（Agent 评测 / 兜底统计 / 校准 / VLE / …）逐步收敛到本组件——不再各搭各页。
 * 一行 = 一项 Capability（claim + 派生 verifiedStatus·**禁手打**）+ 其关联 actionable Gap 三元
 * （缺什么 / 补在哪 / 验收）。所有值来自后端 `/b/v1/self/capability-slice` 响应（逐值对后端）。
 */

const V_LABEL: Record<VerifiedStatus, string> = {
  VERIFIED: "已验证",
  UNVERIFIED: "未验证",
  STALE: "已漂移",
};
/** VERIFIED=绿 / UNVERIFIED=中性灰（诚实空态·不报红）/ STALE=橙（漂移曝光）。 */
const V_STYLE: Record<VerifiedStatus, { color: string; bg: string }> = {
  VERIFIED: { color: "var(--ok,#2a8)", bg: "rgba(42,136,85,0.12)" },
  UNVERIFIED: { color: "var(--muted,#888)", bg: "rgba(136,136,136,0.12)" },
  STALE: { color: "var(--warn,#c90)", bg: "rgba(204,153,0,0.14)" },
};

export function VerifiedBadge({ status }: { status: VerifiedStatus }) {
  const s = V_STYLE[status];
  return (
    <span
      data-testid={`vstatus-${status}`}
      style={{ color: s.color, background: s.bg, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}
    >
      {V_LABEL[status]}
    </span>
  );
}

export default function CapabilitySliceView({ slice }: { slice: CapabilitySlice | undefined }) {
  if (!slice) return <div className="empty-state">加载中…</div>;

  // 未接入面：诚实占位（不假装已归一）。
  if (!slice.wired) {
    return (
      <div className="empty-state" data-testid="slice-unwired">
        「{slice.surface}」面尚未接入统一 Capability/Gap 模型。{slice.note}
      </div>
    );
  }

  return (
    <div data-testid={`capability-slice-${slice.surface}`}>
      {slice.note && (
        <div className="muted" data-testid="slice-note" style={{ fontSize: 11.5, marginBottom: 8 }}>
          {slice.note}
        </div>
      )}
      {slice.rows.length === 0 ? (
        <div className="empty-state" data-testid="slice-empty">
          暂无 Capability——{slice.note || "该面尚无运行时数据。"}
        </div>
      ) : (
        <table className="cmp" data-testid="slice-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Capability（能力声明）</th>
              <th>验证态</th>
              <th>关联 Gap（缺什么 · 补在哪 · 验收）</th>
            </tr>
          </thead>
          <tbody>
            {slice.rows.map((row) => (
              <tr key={row.capability.key} data-testid={`slice-row-${row.capability.key}`}>
                <td>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{row.capability.key}</div>
                  <div className="zh" style={{ fontSize: 12 }}>{row.capability.claim}</div>
                </td>
                <td data-testid={`slice-vstatus-${row.capability.key}`}>
                  <VerifiedBadge status={row.capability.verifiedStatus} />
                </td>
                <td>
                  {row.gaps.length === 0 ? (
                    <span className="muted" style={{ fontSize: 11 }}>无缺口（已验证）</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 14, display: "grid", gap: 6 }}>
                      {row.gaps.map((g, i) => (
                        <li key={i} data-testid={`slice-gap-${row.capability.key}-${i}`} style={{ fontSize: 11.5 }}>
                          <span className="badge" style={{ fontSize: 9.5, marginRight: 4 }}>{g.gapCode}</span>
                          {g.blocking && <span className="badge red" style={{ fontSize: 9.5, marginRight: 4 }}>阻塞</span>}
                          <span className="zh">{g.what}</span>
                          <div style={{ fontSize: 10.5, color: "var(--muted2)" }}>
                            补在：{g.where} · 验收：{g.acceptance}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
