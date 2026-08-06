import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { ProvenanceRef } from "@platform/contracts";
import { fetchTask, queryTimeseriesAgg } from "@/api/endpoints";
import { RuleRef } from "../RuleRef";
import zh from "@/locales/zh";
import styles from "./ProvenancePopover.module.css";

/** 宽松视图模型：契约 ProvenanceRef + 任务详情侧的补充展示字段 */
export type ProvVM = ProvenanceRef & {
  stepId?: string;
  formula?: string;
  rules?: { key: string; expression: string }[];
  valueLabel?: string;
  value?: string;
};

interface OpenState {
  provId: string;
  taskId: string;
  /** 调用方可直接给出值与口径（kpi/table 开启处） */
  value?: string;
  label?: string;
  rect: { top: number; left: number; bottom: number; right: number };
  pinned: boolean;
}

interface ProvCtx {
  open: (s: Omit<OpenState, "pinned">, pinned: boolean) => void;
  scheduleOpen: (s: Omit<OpenState, "pinned">) => void;
  cancelScheduled: () => void;
  close: () => void;
}

const Ctx = createContext<ProvCtx | null>(null);

export function useProvenance(): ProvCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ProvenanceProvider missing");
  return ctx;
}

/** 全局唯一溯源弹窗（PRD §6.5）：悬停 300ms 出现 / 点击固定 */
export function ProvenanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((s: Omit<OpenState, "pinned">, pinned: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setState({ ...s, pinned });
  }, []);

  const scheduleOpen = useCallback(
    (s: Omit<OpenState, "pinned">) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setState({ ...s, pinned: false }), 300);
    },
    [],
  );

  const cancelScheduled = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setState((s) => (s && !s.pinned ? null : s));
  }, []);

  const close = useCallback(() => setState(null), []);

  // 悬停延时在卸载时必须撤销：否则 300ms 后仍会 setState 到已卸载树 / 已拆除的测试环境上
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  return (
    <Ctx.Provider value={{ open, scheduleOpen, cancelScheduled, close }}>
      {children}
      {state && <PopoverPanel state={state} onClose={close} />}
    </Ctx.Provider>
  );
}

function PopoverPanel({ state, onClose }: { state: OpenState; onClose: () => void }) {
  const { data: task } = useQuery({
    queryKey: ["b", "task", state.taskId],
    queryFn: () => fetchTask(state.taskId),
    staleTime: 60_000,
  });

  const ref = (task?.answer?.provenance as ProvVM[] | undefined)?.find((p) => p.id === state.provId);

  useEffect(() => {
    if (!state.pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(`.${styles.pop}`)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [state.pinned, onClose]);

  const top = Math.min(state.rect.bottom + 8, window.innerHeight - 320);
  const left = Math.min(state.rect.left, window.innerWidth - 380);

  return createPortal(
    <div className={`popover-surface ${styles.pop}`} style={{ top, left }} role="tooltip" data-testid="prov-popover">
      <div className={styles.head}>
        <span className="badge blue">{state.provId}</span>
        {state.pinned && (
          <button className={styles.x} onClick={onClose} aria-label={zh.common.close}>
            ✕
          </button>
        )}
      </div>
      {!ref && <div className={styles.loading}>{zh.common.loading}</div>}
      {ref && <PopoverSections prov={ref} value={state.value} label={state.label} />}
    </div>,
    document.body,
  );
}

function PopoverSections({ prov, value, label }: { prov: ProvVM; value?: string; label?: string }) {
  return (
    <div>
      {/* ① 值与口径 */}
      <section className={styles.sec}>
        <h5>{zh.prov.valueSection}</h5>
        <div className={styles.valueRow}>
          <span className="mono" style={{ fontSize: 16 }}>
            {value ?? prov.value ?? "—"}
          </span>
          <span style={{ color: "var(--muted)" }}>{label ?? prov.valueLabel ?? prov.outputPath}</span>
        </div>
      </section>
      {/* ② 来源 */}
      <section className={styles.sec}>
        <h5>{zh.prov.sourceSection}</h5>
        {prov.source === "TS_AGGREGATE" && prov.tsAgg ? (
          <TsAggSource prov={prov} />
        ) : (
          <div className="mono" style={{ fontSize: 11.5 }}>
            {prov.toolName}
            {prov.snapshotVersion && (
              <span style={{ color: "var(--muted2)" }}> · snapshot {prov.snapshotVersion}</span>
            )}
          </div>
        )}
      </section>
      {/* ③ 计算 */}
      <section className={styles.sec}>
        <h5>{zh.prov.computeSection}</h5>
        <div className="mono" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
          {prov.outputPath}
        </div>
        {prov.stepId && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
            step <span className="mono">{prov.stepId}</span>
            {prov.formula && <> · {prov.formula}</>}
          </div>
        )}
      </section>
      {/* ④ 规则 */}
      <section className={styles.sec}>
        <h5>{zh.prov.ruleSection}</h5>
        {prov.rules?.length ? (
          // 收尾#4：统一用共享 <RuleRef>（与 hover 版 <Provenance> 同一规则机制；两跳取活规则定义）
          prov.rules.map((r) => (
            <div key={r.key} style={{ marginBottom: 4 }}>
              <RuleRef code={r.key} />
            </div>
          ))
        ) : (
          <span style={{ color: "var(--muted2)", fontSize: 11.5 }}>{zh.prov.noRule}</span>
        )}
      </section>
    </div>
  );
}

/** A8 §3：TS_AGGREGATE 形态文案 + 聚合趋势小图（仍不出原始行） */
function TsAggSource({ prov }: { prov: ProvVM }) {
  const agg = prov.tsAgg!;
  const [showTrend, setShowTrend] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
        {zh.prov.tsAggText(agg.window.start, agg.window.end, agg.rowsIn, aggLabel(agg.specKey), agg.specKey)}
      </div>
      <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setShowTrend(!showTrend)}>
        {zh.prov.trend}
      </button>
      {showTrend && <TrendSparkline prov={prov} />}
    </div>
  );
}

function aggLabel(specKey: string): string {
  if (specKey.includes("oee")) return "加权均值";
  return "均值";
}

function TrendSparkline({ prov }: { prov: ProvVM }) {
  const agg = prov.tsAgg!;
  const seriesKey = agg.specKey.split("@")[0] ?? agg.specKey;
  const { data } = useQuery({
    queryKey: ["a", "ts-agg", { seriesKey, window: agg.window }],
    queryFn: () =>
      queryTimeseriesAgg({
        seriesKey,
        entityIds: [],
        window: { from: agg.window.start, to: agg.window.end, grain: "day" },
        agg: "avg",
      }),
  });
  const points = data?.points ?? [];
  if (points.length === 0) return <div className={styles.loading}>{zh.common.loading}</div>;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 320;
  const h = 56;
  const path = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * (w - 8) + 4;
      const y = h - 8 - ((v - min) / Math.max(max - min, 1e-9)) * (h - 16);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} data-testid="ts-trend" style={{ marginTop: 6 }}>
      <path d={path} fill="none" stroke="var(--c-capacity)" strokeWidth={1.5} />
    </svg>
  );
}
