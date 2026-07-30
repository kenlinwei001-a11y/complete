import type { ReactNode } from "react";
import type { SimCertification } from "@platform/contracts";
import styles from "./SimViews.module.css";

/**
 * 就绪认证面板（增量 4 P0 · 砌齐 6 项 · 竞品 image6 全局认证屏）。
 *
 * 全部从 `deriveCertification`（GET /a/v1/sim/sessions/:id/certification）数据渲染，**零业务常数**：
 *  ① L0-L4 stepper（data-testid=sim-cert-level）
 *  ② L4 三元组卡（fanoutSafe / writebackComplete / observabilityMet）
 *  ③ Trial Tick 卡（passed / rulesFired）
 *  ④ GLOBAL↔LOCAL 切换（受控 scope，由父组件管理 + 重取）
 *  ⑤ 世界完整度 gauge（worldCompleteness.pct + 四项 present/needed）
 *  ⑥ entering[] 清单（含真 source — kind/source 来自后端，已 §6.1 真实化）
 * 雷达（三维 structure/knowledge/behavior）由父组件传入（复用既有 ReadinessRadar）。
 */

const CERT_LEVELS: { key: SimCertification["level"]; label: string }[] = [
  { key: "L0_INVALID", label: "L0 未定义" },
  { key: "L1_CONFIGURED", label: "L1 已配置" },
  { key: "L2_RUNNABLE", label: "L2 可运行" },
  { key: "L3_VERIFIED", label: "L3 已验证" },
  { key: "L4_CERTIFIED", label: "L4 已认证" },
];

const ENTER_KIND_LABEL: Record<string, string> = {
  DERIVATION: "派生",
  ACTION: "行动",
  PROPAGATION: "传导",
};

/** L0-L4 stepper：当前级及以下点亮。 */
function CertStepper({ level }: { level: SimCertification["level"] }) {
  const curIdx = CERT_LEVELS.findIndex((l) => l.key === level);
  return (
    <div data-testid="sim-cert-level" className={styles.certStepper} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {CERT_LEVELS.map((l, i) => {
        const active = i <= curIdx;
        const isCur = i === curIdx;
        return (
          <span
            key={l.key}
            data-testid={`sim-cert-step-${l.key}`}
            data-active={active ? "1" : "0"}
            data-current={isCur ? "1" : "0"}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: isCur ? 700 : 500,
              background: active ? (isCur ? "#43B7D7" : "rgba(67,183,215,.25)") : "rgba(226,235,245,.07)",
              color: active ? (isCur ? "#0b1622" : "var(--text)") : "var(--muted2)",
            }}
          >
            {l.label}
          </span>
        );
      })}
    </div>
  );
}

/** 三元组/单项布尔徽标。 */
function CheckBadge({ ok, label, testId }: { ok: boolean; label: string; testId: string }) {
  return (
    <span
      data-testid={testId}
      data-ok={ok ? "1" : "0"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        background: ok ? "rgba(67,183,215,.18)" : "rgba(224,98,108,.16)",
        color: ok ? "var(--ok)" : "var(--danger)",
      }}
    >
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

/** 完整度 gauge（半环 SVG，pct 0-100；确定性坐标）。 */
function CompletenessGauge({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const w = 120;
  const h = 70;
  const cx = w / 2;
  const cy = h - 6;
  const r = 50;
  const arc = (frac: number): string => {
    const a = Math.PI * (1 - frac); // 从左(π)扫到右(0)
    const x = cx + r * Math.cos(a);
    const y = cy - r * Math.sin(a);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const pathFor = (frac: number): string => {
    const end = arc(frac);
    const large = 0; // 半环以内
    return `M ${arc(0)} A ${r} ${r} 0 ${large} 1 ${end}`;
  };
  const color = p >= 80 ? "#43B7D7" : p >= 50 ? "#E8B54A" : "#E0626C";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="世界完整度" data-testid="sim-cert-gauge">
      <path d={pathFor(1)} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={8} strokeLinecap="round" />
      <path d={pathFor(p / 100)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" data-testid="sim-cert-gauge-fill" />
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={18} fontWeight={700} fill={color} data-testid="sim-cert-gauge-pct">
        {p.toFixed(0)}%
      </text>
    </svg>
  );
}

function Card({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} style={{ border: "1px solid rgba(226,235,245,.1)", borderRadius: 6, padding: 8 }}>
      <div className={styles.sub} style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function SimReadinessPanel({
  cert,
  scope,
  onScopeChange,
  radar,
}: {
  cert: SimCertification;
  scope: "GLOBAL" | "LOCAL";
  onScopeChange: (s: "GLOBAL" | "LOCAL") => void;
  radar?: ReactNode;
}) {
  const wc = cert.worldCompleteness;
  const wcRows: { label: string; v: { present: number; needed: number } }[] = [
    { label: "状态变量", v: wc.stateVars },
    { label: "派生规则", v: wc.derivationRules },
    { label: "写回行动", v: wc.actions },
    { label: "传导规则", v: wc.propagationRules },
  ];

  return (
    <div data-testid="sim-readiness-panel">
      {/* ④ GLOBAL↔LOCAL 切换 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div className={styles.secHead} style={{ margin: 0 }}>就绪认证</div>
        <div data-testid="sim-cert-scope-toggle" style={{ display: "flex", gap: 4 }}>
          {(["GLOBAL", "LOCAL"] as const).map((s) => (
            <button
              key={s}
              className={`btn sm ${scope === s ? "" : "ghost"}`}
              data-testid={`sim-cert-scope-${s}`}
              data-active={scope === s ? "1" : "0"}
              onClick={() => onScopeChange(s)}
            >
              {s === "GLOBAL" ? "全局" : "局部"}
            </button>
          ))}
        </div>
      </div>

      {/* ① L0-L4 stepper */}
      <CertStepper level={cert.level} />

      {/* 雷达（三维） + canEnter */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        {radar}
        <div>
          {/* 诚实门（WO-RC-UX-DOOR-TEXT）：未认证 ≠ 硬挡。标准沙盘页 tick 未门控 canEnter
              （推进按钮只认 !sessionId||ticking），本就可试跑 → 显「可试跑」提醒黄（复用 --warn，零新色），
              而非「暂不可进入」错误红劝退（真硬挡在 SimInitWizard「进入推演」另一入口，那里按钮才 disabled）。
              试跑结论与 S2 诚信位协同标 UNCALIBRATED/仅供参考。 */}
          <div
            data-testid="sim-cert-canenter"
            style={{ color: cert.canEnterSimulation ? "var(--ok)" : "var(--warn)", fontWeight: 700 }}
          >
            {cert.canEnterSimulation ? "✓ 可进入推演（已认证）" : "◐ 可试跑（未认证·结论仅供参考）"}
          </div>
          {cert.targetRef && (
            <div className={styles.sub} data-testid="sim-cert-target" style={{ marginTop: 2 }}>
              对象：<span className="mono">{cert.targetRef}</span>
            </div>
          )}
          {/*
            WO-UNIT-MEANING：四个分数此前裸奔（「综合 78 · 结构 82 …」看不出满分是 100 还是 10）。
            量纲来源＝契约 `SimCertificationSchema.dims` 注释「三维准备度 0-100」（contracts/src/sim.ts）——
            该字段是纯 z.number()、无 unit 字段也无导出常量可消费，故就近在标题里标一次量程（不逐值重复）。
          */}
          <div className={styles.sub} style={{ marginTop: 2 }} data-testid="sim-cert-dims">
            准备度（0–100 分）：综合 {cert.dims.composite.toFixed(0)} · 结构 {cert.dims.structure.toFixed(0)} / 知识 {cert.dims.knowledge.toFixed(0)} / 行为 {cert.dims.behavior.toFixed(0)}
          </div>
        </div>
      </div>

      {/* ②③⑤ 三卡：L4 三元组 / Trial Tick / 完整度 gauge */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 10 }}>
        <Card title="L4 三元组" testId="sim-cert-l4-triad">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <CheckBadge ok={cert.l4Checks.fanoutSafe} label="扇出安全" testId="sim-cert-l4-fanoutSafe" />
            <CheckBadge ok={cert.l4Checks.writebackComplete} label="写回完整" testId="sim-cert-l4-writebackComplete" />
            <CheckBadge ok={cert.l4Checks.observabilityMet} label="可观测达标" testId="sim-cert-l4-observabilityMet" />
          </div>
        </Card>

        <Card title="Trial Tick（空跑 1 tick）" testId="sim-cert-trial-tick">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <CheckBadge ok={cert.trialTick.passed} label={cert.trialTick.passed ? "通过" : "未通过"} testId="sim-cert-trial-passed" />
            <div className="mono" style={{ fontSize: 12 }} data-testid="sim-cert-trial-rulesfired">
              规则触发 {cert.trialTick.rulesFired} 条
            </div>
            {cert.trialTick.error && (
              <div style={{ fontSize: 11, color: "var(--danger)" }} data-testid="sim-cert-trial-error">{cert.trialTick.error}</div>
            )}
          </div>
        </Card>

        <Card title="世界完整度（范围预检）" testId="sim-cert-completeness">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CompletenessGauge pct={wc.pct} />
            <div style={{ fontSize: 11 }}>
              {wcRows.map((row) => (
                <div key={row.label} className="mono" data-testid={`sim-cert-wc-${row.label}`}>
                  {row.label} {row.v.present}/{row.v.needed}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* ⑥ entering[] 清单（含真 source） */}
      <div style={{ marginTop: 10 }} data-testid="sim-cert-entering">
        <div className={styles.sub}>将进入沙盘的状态变量（{wc.entering.length}）</div>
        {wc.entering.length > 0 ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {wc.entering.map((e, i) => (
              <li key={`${e.key}-${i}`} data-testid={`sim-cert-entering-${i}`} style={{ fontSize: 12 }}>
                <b className="mono">{e.key}</b>
                <span style={{ marginLeft: 6, color: "var(--muted2)" }}>
                  [{ENTER_KIND_LABEL[e.kind] ?? e.kind}] {e.source}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.sub} data-testid="sim-cert-entering-empty" style={{ marginTop: 4 }}>
            尚无将进入的状态变量（世界为空——先种传导规则/派生）。
          </div>
        )}
      </div>

      {/* 诚实缺件清单 */}
      {cert.gaps.length > 0 && (
        <div data-testid="sim-cert-gaps" style={{ marginTop: 10 }}>
          <div className={styles.sub}>缺件清单（诚实，不静默）</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {cert.gaps.slice(0, 8).map((g, i) => (
              <li key={i} data-testid={`sim-cert-gap-${i}`} style={{ fontSize: 12, color: "var(--muted2)" }}>
                <b className="mono">{g.gapCode}</b> · {g.ref} — {g.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
