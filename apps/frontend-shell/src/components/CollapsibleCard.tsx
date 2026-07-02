import { useState, type ReactNode } from "react";

/**
 * WO-SANDBOX-LAYOUT-REWORK（PRD-frontend-visual-redesign §5·折叠交互）：卡标题行 cursor pointer + ▸/▾；
 * 折叠态仅显标题 + 1 行摘要（--muted2）；展开态显全内容 → 一屏密度从 12 面板降为「1 主体 + N 折叠卡」。
 *
 * 关键：折叠态用 `hidden`(display:none) 保留内容在 DOM（不 conditional-render）——既降视觉密度（真浏览器折叠不占屏），
 * 又不破坏既有 testid 断言（jsdom getByTestId 仍能命中·所有功能仍可达·§5「不删功能」）。§2 卡壳视觉。
 */
export interface CollapsibleCardProps {
  title: ReactNode;
  /** 折叠态显示的一行摘要（--muted2）。 */
  summary?: ReactNode;
  /** 默认是否展开（次要卡默认折叠·主卡默认展开）。 */
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}

export function CollapsibleCard({ title, summary, defaultOpen = false, children, testId = "collapsible-card" }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="panel"
      data-testid={testId}
      data-open={open ? "1" : "0"}
      style={{ padding: 0, overflow: "hidden" }}
    >
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
          background: "transparent", border: 0, cursor: "pointer", textAlign: "left", color: "var(--txt)",
        }}
      >
        <span style={{ color: "var(--muted2)", fontSize: 12, width: 14 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--txt)" }}>{title}</span>
        {!open && summary != null && (
          <span data-testid={`${testId}-summary`} style={{ fontSize: 11.5, color: "var(--muted2)", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>
            {summary}
          </span>
        )}
      </button>
      {/* 折叠态 display:none 保留内容（不破坏 testid·真浏览器不占屏）。 */}
      <div hidden={!open} data-testid={`${testId}-body`} style={{ padding: "0 14px 14px" }}>
        {children}
      </div>
    </div>
  );
}
