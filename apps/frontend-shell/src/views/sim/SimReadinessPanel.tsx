import type { ReactNode } from "react";
import type { SimCertification } from "@platform/contracts";
import styles from "./SimViews.module.css";

/**
 * 就绪认证面板（增量 4 P0 · 砌齐 6 项 · 竞品 image6 全局认证屏）。
 *
 * 全部从 `deriveCertification`（GET /a/v1/sim/sessions/:id/certification）数据渲染，**零业务常数**：
 *  ① L0-L4 stepper（data-testid=sim-cert-level）
 *  ② L4 三元组卡（fanoutSafe / writebackComplete / observabilityMet）
 *  ③ Trial Tick 卡（passed / derivationNodes / propagationCovered）
 *  ④ GLOBAL↔LOCAL 切换（受控 scope，由父组件管理 + 重取）
 *  ⑤ 世界完整度 gauge（worldCompleteness.pct + 三项 present/needed + 状态变量名清单）
 *  ⑥ entering[] 清单（按 kind 分组 + 含真 source — kind/source 来自后端，已 §6.1 真实化）
 * 雷达（三维 structure/knowledge/behavior）由父组件传入（复用既有 ReadinessRadar）。
 *
 * ══ WO-CERT-HONESTY（诚实性修复 · 2026-08-10）══
 * 本面板此前四处「口径错标」——数字/名词都在，但没有一个度量它自称度量的东西，屏上自己跟自己打架：
 *  ① 「状态变量 N/M」与「派生规则 N/M」**恒等**（后端两行取同一个变量/同一个表达式）→ 删该行，
 *     改列**真正的状态变量名**（传导规则 source/target stateVar 去重集，同 SandboxViewConfig.stateVars）。
 *  ② 标题「将进入沙盘的**状态变量**」下挂的却是 DERIVATION|ACTION|PROPAGATION 三类混装
 *     （实测 demo（SEED_DEMO=1 真跑 GET /a/v1/sim/sessions/:id/certification）23 条 = 行动 10 · 传导 13 · 派生 0 ⇒ 标题里的名词一条都没有）→ 改称「要素」并按 kind 分组计数。
 *  ③ 「规则触发 N 条」数的是**派生依赖图节点数**，且那趟空跑**一条都没触发、传导栈根本没跑**
 *     （欠账 #152）→ 改标「派生图节点 N 个」+ 显式标注传导未纳入 + 把 passed 的语义写在屏上。
 *  ④ 「✓可进入推演（已认证）」与「完整度 33%」并排贴着不解释 → 加一句话说清两者度量的是两件事、
 *     互不蕴含（判据本身是对的，不动，只改表达）。
 * 判据：**屏上每个数字/每句话都要能回答「它度量的到底是什么」**，答不上就不许显示。
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

/** entering[] 的分组显示顺序（固定，R6 确定性：同数据同渲染序）。 */
type EnterKind = "ACTION" | "PROPAGATION" | "DERIVATION";
const ENTER_KIND_ORDER: EnterKind[] = ["ACTION", "PROPAGATION", "DERIVATION"];

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
  // ① 三对 present/needed —— 每一对的两半都有各自的承载物（见 certification.ts 注释）。
  //    此前第一行「状态变量」与「派生规则」取的是同一个数，已删（名不副实的行不许上屏）。
  const wcRows: { label: string; v: { present: number; needed: number } }[] = [
    { label: "派生规则", v: wc.derivationRules },
    { label: "写回行动", v: wc.actions },
    { label: "传导规则", v: wc.propagationRules },
  ];
  // ② entering[] 按 kind 分组：三类混装的清单必须让人一眼看出各多少条，
  //    否则「13 条」会被读成「13 个状态变量」（实测 demo 上其中派生 0 条）。
  //    索引沿用**原数组序**（testid 稳定），只改分组呈现。
  const enteringByKind = ENTER_KIND_ORDER.map((kind) => ({
    kind,
    items: wc.entering.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === kind),
  }));

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
          {/* 诚实门（WO-RC-UX-DOOR-TEXT）：未认证 ≠ 硬挡。沙盘页 tick 未门控 canEnter
              （推进按钮只认 !sessionId||ticking），本就可试跑 → 显「可试跑」提醒黄（复用 --warn，零新色），
              而非「暂不可进入」错误红劝退。试跑结论与 S2 诚信位协同标 UNCALIBRATED/仅供参考。

              ⚠ 措辞更新（WO-SIM-SCOPE-LOCAL ③·2026-08-08）：本行原文曾写「真硬挡在 SimInitWizard
              『进入推演』另一入口，那里按钮才 disabled」。该向导已**退役删除**，那句话若留着就成了
              一条**过期的诚实缺席声明**（本仓已因这种"注释还在、实现早没了"的形态判错过多次）。
              实测为真的现状：**全应用不存在任何按 `canEnterSimulation` 硬挡的入口** ——
              沙盘是唯一入口，且它从不 disable「推进 tick」。未认证只降级为屏上提醒，不劝退。 */}
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

        {/* ③ Trial Tick 卡（WO-CERT-HONESTY ③ · 欠账 #152）——三处措辞全部改成实测口径：
              旧：「通过」+「规则触发 0 条」。读起来是「传导跑过了，只是没触发规则」。
              实：这趟空跑只做了「装载对象 + 派生依赖图拓扑排序」，零条派生被求值、传导核根本没被调用。
              故：passed 的语义写在屏上；数字改标它真正在数的东西（派生图节点数）；
                  传导覆盖与否由后端字段 `propagationCovered` 驱动（不在 UI 硬写，L3-a 落地后自动消失）。*/}
        <Card title="Trial Tick（空跑 1 tick）" testId="sim-cert-trial-tick">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <CheckBadge
              ok={cert.trialTick.passed}
              label={cert.trialTick.passed ? "重算未抛异常" : "重算抛异常"}
              testId="sim-cert-trial-passed"
            />
            <div className={styles.sub} style={{ fontSize: 11 }} data-testid="sim-cert-trial-meaning">
              「通过」= 派生依赖图可拓扑排序（无环），**不代表这个世界已经推动过**。
            </div>
            <div className="mono" style={{ fontSize: 12 }} data-testid="sim-cert-trial-derivation-nodes">
              派生图节点 {cert.trialTick.derivationNodes} 个
            </div>
            <div className={styles.sub} style={{ fontSize: 11 }} data-testid="sim-cert-trial-nodes-meaning">
              = 派生依赖图规模；本次空跑不喂变更集，实际求值 0 条。
            </div>
            {!cert.trialTick.propagationCovered && (
              <div style={{ fontSize: 11, color: "var(--warn)" }} data-testid="sim-cert-trial-propagation-uncovered">
                ⚠ 传导未纳入本次空跑（跑的是派生重算，不是传导核）
              </div>
            )}
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
          {/* ① 真正的状态变量 = 传导规则 source/target stateVar 去重集（后端 stateVarKeys，与
                 SandboxViewConfig.stateVars 同源）。是**清单不是比值**：没有任何地方声明「应有几个」，
                 编一个分母出来就是错答，所以这里只报名字与个数。 */}
          <div className={styles.sub} style={{ fontSize: 11, marginTop: 6 }} data-testid="sim-cert-wc-statevars">
            世界将承载的状态变量 {wc.stateVarKeys.length} 个
            {wc.stateVarKeys.length > 0 && <>：<span className="mono">{wc.stateVarKeys.join(" · ")}</span></>}
          </div>
          {/* ④ 认证 vs 完整度：判据本身没问题（见 certification.ts canEnterSimulation 注释），
                 缺的是这句解释——不解释就会被读成「已认证 · 33%」自相矛盾。 */}
          <div className={styles.sub} style={{ fontSize: 11, marginTop: 4 }} data-testid="sim-cert-completeness-note">
            完整度 ≠ 认证：认证判「<b>能不能跑</b>」（结构闭合 + L4 三元组 + 空跑未抛异常）；
            完整度判「<b>这个世界建得全不全</b>」（已建 / 应建）。两者互不蕴含 ——
            只建了一部分的世界，其已建的那部分照样可以闭合可跑。
          </div>
        </Card>
      </div>

      {/* ⑥ entering[] 清单（按 kind 分组 + 含真 source）。
             WO-CERT-HONESTY ②：标题原写「将进入沙盘的**状态变量**（13）」，而这 13 条是
             DERIVATION|ACTION|PROPAGATION 三类混装 —— 实测 demo 上派生恰好 0 条，
             即标题里的那个名词在列表里一条都没有。改标「要素」并把三类计数摆到明面上。 */}
      <div style={{ marginTop: 10 }} data-testid="sim-cert-entering">
        <div className={styles.sub}>将进入沙盘的要素（{wc.entering.length}）</div>
        <div className={styles.sub} style={{ fontSize: 11 }} data-testid="sim-cert-entering-groups">
          {ENTER_KIND_ORDER.map((k) => `${ENTER_KIND_LABEL[k]} ${wc.entering.filter((e) => e.kind === k).length}`).join(" · ")}
        </div>
        {wc.entering.length > 0 ? (
          enteringByKind
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.kind} style={{ marginTop: 4 }} data-testid={`sim-cert-entering-group-${g.kind}`}>
                <div className={styles.sub} style={{ fontSize: 11 }}>
                  {ENTER_KIND_LABEL[g.kind]}（{g.items.length}）
                </div>
                <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                  {g.items.map(({ e, i }) => (
                    <li key={`${e.key}-${i}`} data-testid={`sim-cert-entering-${i}`} style={{ fontSize: 12 }}>
                      <b className="mono">{e.key}</b>
                      <span style={{ marginLeft: 6, color: "var(--muted2)" }}>
                        [{ENTER_KIND_LABEL[e.kind] ?? e.kind}] {e.source}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
        ) : (
          <div className={styles.sub} data-testid="sim-cert-entering-empty" style={{ marginTop: 4 }}>
            尚无将进入沙盘的要素（世界为空——先种传导规则 / 派生 / 写回行动）。
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
