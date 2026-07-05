import type { ReactNode } from "react";
import { useProvenance } from "./ProvenancePopover";
import styles from "./ProvTrigger.module.css";

function rectOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

/**
 * sup 角标悬停驻留（治理批次小注①）：角标是小靶，300ms 驻留 + 小命中区难触发 →
 * 缩短至 150ms（配合 .mark::after 热区外扩）；整卡/区域（ProvHoverArea）仍走默认 300ms（PRD §6.5）。
 * click 钉住不变（设计内交互）。
 */
export const PROV_MARK_HOVER_DELAY_MS = 150;

/** 上标引用角标（text block ⟦ref:provId⟧ → ⟦n⟧） */
export function ProvMark({
  provId,
  taskId,
  index,
  value,
  label,
}: {
  provId: string;
  taskId: string;
  index: number;
  value?: string;
  label?: string;
}) {
  const prov = useProvenance();
  const payload = (el: HTMLElement) => ({ provId, taskId, value, label, rect: rectOf(el) });
  return (
    <sup
      className={styles.mark}
      data-testid={`prov-mark-${provId}`}
      tabIndex={0}
      role="button"
      aria-label={`溯源 ${provId}`}
      onMouseEnter={(e) => prov.scheduleOpen(payload(e.currentTarget), PROV_MARK_HOVER_DELAY_MS)}
      onMouseLeave={() => prov.cancelScheduled()}
      onClick={(e) => prov.open(payload(e.currentTarget), true)}
      onKeyDown={(e) => e.key === "Enter" && prov.open(payload(e.currentTarget), true)}
    >
      [{index}]
    </sup>
  );
}

/** 整卡/区域悬停溯源（kpi 卡、table 表头角标等） */
export function ProvHoverArea({
  provId,
  taskId,
  value,
  label,
  children,
  className,
  testId,
}: {
  provId: string;
  taskId: string;
  value?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const prov = useProvenance();
  const payload = (el: HTMLElement) => ({ provId, taskId, value, label, rect: rectOf(el) });
  return (
    <div
      className={className}
      data-testid={testId}
      tabIndex={0}
      onMouseEnter={(e) => prov.scheduleOpen(payload(e.currentTarget))}
      onMouseLeave={() => prov.cancelScheduled()}
      onClick={(e) => prov.open(payload(e.currentTarget), true)}
      onKeyDown={(e) => e.key === "Enter" && prov.open(payload(e.currentTarget), true)}
    >
      {children}
    </div>
  );
}
