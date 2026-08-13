import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TIGHTNESS_METRIC, formatTightness } from "@platform/contracts";
import zh from "@/locales/zh";
import styles from "./RiskPopover.module.css";

/**
 * §7.3 风险弹窗 —— risk-board 与 order-chain（§7.16 关联风险点 chip）共用组件。
 * 悬停触发，展示 基地·风险因素·峰值·越线日 + 逐日张力 mini strip。
 *
 * WO-UNIT-MEANING：peak / series 与 risk_timeline 卡面**同一口径**＝张力 0–100 指数（非百分比、非该因素本身的值），
 * 故峰值与逐日格 tooltip 一律经 contracts `formatTightness` 单源渲染——卡面已治，本共用弹窗此前仍裸奔
 * （`峰值 91` 会被读成「OEE=91%」），是同一指标的漏网消费点。前端不内联量程（改 TIGHTNESS_METRIC 即改此处）。
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
    <div className={`popover-surface ${styles.pop}`} style={{ top, left }} role="tooltip" data-testid="risk-popover">
      <div className={styles.head}>
        <strong>{data.base}</strong>
        <span className="badge">{data.factor}</span>
      </div>
      <div className={styles.metrics}>
        <span>
          {zh.risk.peak}
          <b className="mono" data-testid="risk-popover-peak" style={{ color: data.peak >= threshold ? "var(--danger)" : "var(--txt)" }}>
            {formatTightness(data.peak)}
          </b>
        </span>
        <span>
          {zh.risk.crossDay}
          <b className="mono">{data.crossDay != null ? `D+${data.crossDay}` : zh.risk.noCross}</b>
        </span>
      </div>
      {/* 峰值口径：**可见文字**，不是 `title=` 属性（见 locales/zh.ts risk.peakCaliber 的说明）。 */}
      <div className={styles.caliber} data-testid="risk-popover-peak-caliber">
        {zh.risk.peakCaliber(TIGHTNESS_METRIC.scaleMin, TIGHTNESS_METRIC.scaleMax, TIGHTNESS_METRIC.hint)}
      </div>
      {data.series && data.series.length > 0 && (
        <>
          <div className={styles.strip} data-testid="risk-popover-strip">
            {data.series.map((v, i) => (
              // 逐格值走 `aria-label`（可访问名·读屏念得到），不走 `title=`：
              // 30 个格子不可能各挂一个浮层，而量程/阈值已由下面那行图例承载。
              <span key={i} aria-label={zh.risk.dayCellAria(i, formatTightness(v))} style={{ background: heatColor(v, threshold) }} />
            ))}
          </div>
          {/* 每格一天的色块本身也是"裸数字"（只有颜色没有口径）→ 补一行图例说明量纲与越线阈值。 */}
          <div className={styles.stripLegend} data-testid="risk-popover-strip-legend">
            {zh.risk.dailyStrip}（{TIGHTNESS_METRIC.label} {TIGHTNESS_METRIC.scaleMin}–{TIGHTNESS_METRIC.scaleMax}·{TIGHTNESS_METRIC.hint}）· 越线阈值 {formatTightness(threshold)}
          </div>
        </>
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
