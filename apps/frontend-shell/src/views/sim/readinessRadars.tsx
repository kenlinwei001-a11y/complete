import type { SimCertification } from "@platform/contracts";
import { SIM_KNOWLEDGE_DIM_LABEL, SIM_KNOWLEDGE_DIM_SRC } from "@/locales/zh";
import styles from "./SimViews.module.css";

/**
 * 就绪雷达渲染件（render-only·从 SandboxView 迁出·RL3 安全）——沙盘 SandboxView 与看板 BoardReadinessTrustBar 共用。
 *
 * 全部为**纯渲染 + 派生投影**（R13）：DERIVE 自既有 `SimCertification`（dims/worldCompleteness/l4Checks/trialTick/gaps），
 * 零新计算字段、零业务常数（R14）、缺数据诚实标（RL5）。搬迁不改逻辑，仅让看板可复用而不必把重的 SandboxView 拖进 board bundle。
 */

// ── 就绪雷达（自绘·维数动态 = certification.dims，不复用固定 5 维 RadarChart）─────────────
export function ReadinessRadar({
  dims,
  values,
  size = 168,
}: {
  dims: { key: string; label: string }[];
  values: Record<string, number>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const n = Math.max(dims.length, 3);
  const pt = (i: number, frac: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0, Math.min(100, frac)) / 100;
    return [Number((cx + r * k * Math.cos(a)).toFixed(2)), Number((cy + r * k * Math.sin(a)).toFixed(2))];
  };
  const rings = [1 / 3, 2 / 3, 1].map((f) =>
    dims.map((_, i) => pt(i, f * 100).join(",")).join(" "),
  );
  const poly = dims.map((d, i) => pt(i, values[d.key] ?? 0).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="就绪雷达" data-testid="sandbox-radar">
      {rings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={i === 2 ? 1.2 : 0.8} />
      ))}
      {dims.map((_, i) => {
        const [x, y] = pt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(226,235,245,.1)" strokeWidth={0.8} />;
      })}
      <polygon points={poly} fill="#43B7D7" fillOpacity={0.22} stroke="#43B7D7" strokeWidth={1.6} data-testid="sandbox-radar-polygon" />
      {dims.map((d, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const lx = cx + (size / 2 - 8) * Math.cos(a);
        const ly = cy + (size / 2 - 8) * Math.sin(a);
        return (
          <text key={d.key} x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fill="#9AA8B6" data-testid={`sandbox-radar-axis-${d.key}`}>
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

// ── 健康6维 + 信任4维 双雷达（轨A P1·AUDIT §1 母版口径） ──────────────────────────────
// 数据**零写死 R14**：每维 DERIVE 自既有 SimCertification（dims/worldCompleteness/l4Checks/trialTick/gaps）
// 这些字段本身又是 closure 五维 + GapReport 的投影（R13 派生投影非新真值）。
// 缺数据**诚实标**（hasData=false → 轴标灰 + 不画该顶点，绝不用占位数冒充真算 RL5）。
/** 单维：派生值 0-100 + 是否有真数据支撑（无 → 诚实标估算/无数据，不画顶点）。 */
export interface RadarDim {
  key: string;
  label: string;
  value: number;
  hasData: boolean;
  /** 该维派生自哪个 cert 字段（溯源文案，悬浮可见）。 */
  src: string;
}

/** 比例→百分（分母 0 = 无数据，诚实标）。 */
export function ratioPct(present: number, needed: number): { value: number; hasData: boolean } {
  if (needed <= 0) return { value: 0, hasData: false };
  return { value: Math.round((Math.min(present, needed) / needed) * 100), hasData: true };
}

/** 健康度 6 维（母版：规则覆盖/利用率/闭包/周期安全/可观测/激活）—— 全 DERIVE 自 cert。 */
export function deriveHealthDims(cert: SimCertification | null): RadarDim[] {
  if (!cert) return [];
  const wc = cert.worldCompleteness;
  const ruleCov = ratioPct(wc.propagationRules.present, wc.propagationRules.needed);
  // 建模完整度（正名·WO-CAP-03）：dims.knowledge = 字段消费率(schema 覆盖率)，非产能利用率，直接取。
  const closure = ratioPct(wc.derivationRules.present, wc.derivationRules.needed);
  const activation = ratioPct(wc.actions.present, wc.actions.needed);
  return [
    { key: "ruleCoverage", label: "规则覆盖", value: ruleCov.value, hasData: ruleCov.hasData, src: "worldCompleteness.propagationRules" },
    { key: "utilization", label: SIM_KNOWLEDGE_DIM_LABEL, value: Math.round(cert.dims.knowledge), hasData: true, src: SIM_KNOWLEDGE_DIM_SRC },
    { key: "closure", label: "闭包", value: closure.value, hasData: closure.hasData, src: "worldCompleteness.derivationRules" },
    { key: "cycleSafety", label: "周期安全", value: cert.l4Checks.fanoutSafe ? 100 : 0, hasData: true, src: "l4Checks.fanoutSafe（无高风险扇出）" },
    { key: "observability", label: "可观测", value: cert.l4Checks.observabilityMet ? 100 : Math.round(cert.dims.structure), hasData: true, src: "l4Checks.observabilityMet / dims.structure" },
    { key: "activation", label: "激活", value: activation.value, hasData: activation.hasData, src: "worldCompleteness.actions（写回行动）" },
  ];
}

/** 信任度 4 维（母版：运行时/可解释/时序/数据可信）—— 全 DERIVE 自 cert（Temporal Trust 来自 Trial Tick）。 */
export function deriveTrustDims(cert: SimCertification | null): RadarDim[] {
  if (!cert) return [];
  const wc = cert.worldCompleteness;
  // 数据可信：综合完整度 worldCompleteness.pct（范围预检口径）。
  const dataTrust = { value: Math.round(wc.pct), hasData: wc.stateVars.needed > 0 };
  return [
    { key: "runtime", label: "运行时", value: cert.trialTick.passed ? 100 : cert.trialTick.at ? 0 : 0, hasData: cert.trialTick.at != null, src: "trialTick.passed（实跑一次）" },
    { key: "explainability", label: "可解释", value: cert.l4Checks.writebackComplete ? 100 : Math.round(cert.dims.behavior), hasData: true, src: "l4Checks.writebackComplete / dims.behavior" },
    { key: "temporal", label: "时序", value: cert.trialTick.passed ? 100 : 0, hasData: cert.trialTick.at != null, src: "Trial Tick Temporal Trust（只读≤t态）" },
    { key: "dataTrust", label: "数据可信", value: dataTrust.value, hasData: dataTrust.hasData, src: "worldCompleteness.pct（范围预检）" },
  ];
}

/** 健康/信任通用雷达（维含 hasData：无数据维灰轴 + 不计入多边形顶点，诚实标）。 */
export function HealthTrustRadar({ title, dims, color, size = 176 }: { title: string; dims: RadarDim[]; color: string; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const n = Math.max(dims.length, 3);
  const pt = (i: number, frac: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0, Math.min(100, frac)) / 100;
    return [Number((cx + r * k * Math.cos(a)).toFixed(2)), Number((cy + r * k * Math.sin(a)).toFixed(2))];
  };
  const rings = [1 / 3, 2 / 3, 1].map((f) => dims.map((_, i) => pt(i, f * 100).join(",")).join(" "));
  // 多边形顶点：无数据维退到圆心（0），仍闭合（诚实——那一边塌陷可见缺数）。
  const poly = dims.map((d, i) => pt(i, d.hasData ? d.value : 0).join(",")).join(" ");
  const missing = dims.filter((d) => !d.hasData);
  // 综合分（轨Q 增量3·竞品 image1 母版「综合分位置」）：仅 hasData 维参与均值，缺数据不拉低（诚实）。
  const scored = dims.filter((d) => d.hasData);
  const composite = scored.length > 0 ? Math.round(scored.reduce((a, d) => a + d.value, 0) / scored.length) : 0;
  const slug = title === "健康度" ? "health" : "trust";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div className={styles.sub} style={{ marginBottom: 2 }} data-testid={`sandbox-${slug}-radar-title`}>
        {title}雷达 · {dims.length} 维 · 综合 <b style={{ color }} data-testid={`sandbox-${slug}-radar-composite`}>{composite}</b>
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}雷达`} data-testid={`sandbox-${title === "健康度" ? "health" : "trust"}-radar`}>
        {rings.map((pts, i) => (
          <polygon key={i} points={pts} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={i === 2 ? 1.2 : 0.8} />
        ))}
        {dims.map((d, i) => {
          const [x, y] = pt(i, 100);
          return <line key={d.key} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(226,235,245,.1)" strokeWidth={0.8} />;
        })}
        <polygon points={poly} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.6} />
        {dims.map((d, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          const lx = cx + (size / 2 - 10) * Math.cos(a);
          const ly = cy + (size / 2 - 10) * Math.sin(a);
          return (
            <text
              key={d.key}
              x={lx}
              y={ly + 3}
              textAnchor="middle"
              fontSize={8.5}
              fill={d.hasData ? "#9AA8B6" : "#5C6672"}
              data-testid={`sandbox-${title === "健康度" ? "health" : "trust"}-axis-${d.key}`}
            >
              <title>{d.src}{d.hasData ? ` · ${d.value}` : " · 无数据（诚实标，不计入）"}</title>
              {d.label}{d.hasData ? "" : "*"}
            </text>
          );
        })}
      </svg>
      {/* 底部轴值图例（竞品 image1：轴名 值 ×N·真派生·缺数据标 —）。 */}
      <div data-testid={`sandbox-${slug}-radar-legend`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 12px", fontSize: 10, color: "#9AA8B6", marginTop: 4, width: size }}>
        {dims.map((d) => (
          <div key={d.key} style={{ display: "flex", justifyContent: "space-between" }} title={d.src}>
            <span style={{ color: d.hasData ? "#9AA8B6" : "#5C6672" }}>{d.label}</span>
            <span className="mono" style={{ color: d.hasData ? color : "#5C6672" }}>{d.hasData ? d.value : "—"}</span>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <div className={styles.sub} style={{ fontSize: 10, color: "#5C6672" }} data-testid={`sandbox-${slug}-radar-missing`}>
          *{missing.map((d) => d.label).join("/")}：缺数据（诚实标·未计入）
        </div>
      )}
    </div>
  );
}
