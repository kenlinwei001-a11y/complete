import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import zh from "@/locales/zh";
import styles from "./RiskPopover.module.css";

/**
 * §7.3 风险弹窗 —— risk-board 与 order-chain（§7.16 关联风险点 chip）共用组件。
 * 悬停触发，展示 基地·风险因素·峰值·越线日 + 逐日张力 mini strip。
 */
export interface RiskPopoverData {
  base: string;
  factor: string;
  peak: number;
  crossDay: number | null;
  series?: number[];
  threshold?: number;
}

export function heatColor(v: number, threshold: number): string {
  if (v >= threshold) return "rgba(224,98,108,.85)";
  if (v >= threshold - 15) return "rgba(232,181,74,.7)";
  return `rgba(67,183,215,${0.15 + (v / 100) * 0.55})`;
}

export function RiskPopover({ data, anchor }: { data: RiskPopoverData; anchor: { top: number; left: number; bottom: number } }) {
  const threshold = data.threshold ?? 85;
  const top = Math.min(anchor.bottom + 6, (typeof window !== "undefined" ? window.innerHeight : 800) - 180);
  const left = Math.min(anchor.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280);
  return createPortal(
    <div className={styles.pop} style={{ top, left }} role="tooltip" data-testid="risk-popover">
      <div className={styles.head}>
        <strong>{data.base}</strong>
        <span className="badge">{data.factor}</span>
      </div>
      <div className={styles.metrics}>
        <span>
          {zh.risk.peak}
          <b className="mono" style={{ color: data.peak >= threshold ? "var(--danger)" : "var(--txt)" }}>
            {data.peak.toFixed(0)}
          </b>
        </span>
        <span>
          {zh.risk.crossDay}
          <b className="mono">{data.crossDay != null ? `D+${data.crossDay}` : zh.risk.noCross}</b>
        </span>
      </div>
      {data.series && data.series.length > 0 && (
        <div className={styles.strip} data-testid="risk-popover-strip">
          {data.series.map((v, i) => (
            <span key={i} title={`D+${i} · ${v.toFixed(0)}`} style={{ background: heatColor(v, threshold) }} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** 悬停触发器：包住任意 chip/badge，mouseenter 显示 RiskPopover */
export function RiskHoverTrigger({
  data,
  children,
  className,
  style,
  testId,
}: {
  data: RiskPopoverData;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, bottom: 0 });
  return (
    <span
      ref={ref}
      className={className}
      style={style}
      data-testid={testId}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setAnchor({ top: r.top, left: r.left, bottom: r.bottom });
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && <RiskPopover data={data} anchor={anchor} />}
    </span>
  );
}
