import type { ReactNode } from "react";
import { useProvenance } from "./ProvenancePopover";
import styles from "./ProvTrigger.module.css";

function rectOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

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
      onMouseEnter={(e) => prov.scheduleOpen(payload(e.currentTarget))}
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
