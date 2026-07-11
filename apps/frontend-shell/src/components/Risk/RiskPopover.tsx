import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SolverDataMode } from "@platform/contracts";
import { decisionColor, decisionHeat, NO_DATA_HINT } from "@/components/DecisionValue";
import zh from "@/locales/zh";
import styles from "./RiskPopover.module.css";

/**
 * §7.3 风险弹窗 —— risk-board 与 order-chain（§7.16 关联风险点 chip）共用组件。
 * 悬停触发，展示 基地·风险因素·峰值·越线日 + 逐日张力 mini strip。
 *
 * WO-KILL-MOCK-RED 阶段②（治本）：加 `dataMode`——非 LIVE（MOCK/SYNTHETIC/无真源）时
 * 峰值/日条一律走中性灰（decisionColor/decisionHeat 门），越线日降级为"无真实数据·不参与越线判定"，
 * peak 可空。绝不把哈希/合成值渲染成红越线可行动结论。
 */
export interface RiskPopoverData {
  base: string;
  factor: string;
  peak: number | null;
  crossDay: number | null;
  series?: number[];
  threshold?: number;
  /** 显式非 LIVE ⇒ 峰值/越线/日条排除决策着色（灰）；缺省（未传）向后兼容按 LIVE 着色。 */
  dataMode?: SolverDataMode | string | null;
}

export function heatColor(v: number, threshold: number): string {
  if (v >= threshold) return "rgba(224,98,108,.85)";
  if (v >= threshold - 15) return "rgba(232,181,74,.7)";
  return `rgba(67,183,215,${0.15 + (v / 100) * 0.55})`;
}

export function RiskPopover({ data, anchor }: { data: RiskPopoverData; anchor: { top: number; left: number; bottom: number } }) {
  // WO-FAKE-10（阈值后端下发·前端不硬编码）：越线阈值取后端 data.threshold（risk 求解器 params.risk.threshold·可校准）；
  // 缺阈值 → 不再内联 ?? 85 伪造阈，走中性（非 LIVE 着色·灰），对齐 OrderChainView E4 治本。
  const threshold = data.threshold;
  // 向后兼容：仅显式非 LIVE 才灰化排除（未标 dataMode 的旧 fixture/真 LIVE 保持既有行为）；缺阈值亦视为非 LIVE（不着决策色）。
  const live = threshold != null && (data.dataMode == null || data.dataMode === "LIVE");
  const effMode = live ? "LIVE" : (data.dataMode ?? "MOCK");
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
          <b className="mono" style={{ color: decisionColor(data.peak, threshold ?? 0, effMode) }}>
            {data.peak != null ? data.peak.toFixed(0) : "—"}
          </b>
        </span>
        <span>
          {zh.risk.crossDay}
          {/* 治本：非 LIVE 不显越线日（哈希越线不作决策结论），显中性"未参与判定"。 */}
          <b className="mono">{live && data.crossDay != null ? `D+${data.crossDay}` : zh.risk.noCross}</b>
        </span>
      </div>
      {live && data.series && data.series.length > 0 ? (
        <div className={styles.strip} data-testid="risk-popover-strip">
          {data.series.map((v, i) => (
            <span key={i} title={`D+${i} · ${v.toFixed(0)}`} style={{ background: decisionHeat(v, threshold ?? 0, effMode) }} />
          ))}
        </div>
      ) : (
        <div data-testid="risk-popover-nodata" style={{ fontSize: 10.5, color: "var(--muted2)", marginTop: 4 }}>
          {NO_DATA_HINT}
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
