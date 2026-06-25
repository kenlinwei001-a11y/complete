import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { SandboxViewConfig, TickState } from "@platform/contracts";
import {
  createSimSession,
  fetchSimScopePrecheck,
  fetchSimViewConfig,
  type SimScopePrecheck,
} from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import { HeatStrip } from "./shared";
import styles from "./SimViews.module.css";

/**
 * 推演沙盘 · 初始化向导（增量 4 渐进项 · 配置驱动·零业务常数 R14）。
 *
 * 把"进入沙盘前的准备"做成独立可导航子屏（沙盘主屏 SandboxView 的兄弟屏）。三步：
 *   ① 世界基准 —— 选推演 scope（GLOBAL 整本体 / LOCAL 逐对象类型，类型来自 view-config.nodeTypes）。
 *   ② 推演范围 —— 选纳入推演的状态变量（stateVars 全来自 view-config，无任何行业实体名）。
 *   ③ 范围预检 —— 调既有 `GET /a/v1/sim/sessions/:id/scope-precheck`（复用增量 2 certification 数据），
 *      显示 worldCompleteness（完整度% + 将进入沙盘清单 entering[]）+ canEnterSimulation + 诚实 gaps。
 *      完成（且可进入）即跳沙盘主屏 /v/sim-sandbox。
 *
 * 所有可选项/维度均派生自 view-config + scope-precheck，代码里**零行业实体名**（debattery:check 守这条）。
 */

// ── 确定性派生（与 SandboxView 同构）：从配置造 tick0 世界态，无业务常数（纯结构哈希）。 ──
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
function deriveBaseSnapshot(cfg: SandboxViewConfig): TickState {
  const state: TickState = {};
  const vars = cfg.stateVars.length > 0 ? cfg.stateVars : ["v"];
  for (const t of cfg.nodeTypes) {
    const row: Record<string, number> = {};
    for (const v of vars) row[v] = Math.round(hash01(`${t}|${v}`) * 100);
    state[`${t}#0`] = row;
  }
  return state;
}

const STEPS = [
  { key: "baseline", label: "① 世界基准" },
  { key: "range", label: "② 推演范围" },
  { key: "precheck", label: "③ 范围预检" },
] as const;

const KIND_LABEL: Record<string, string> = {
  DERIVATION: "派生",
  ACTION: "行动",
  PROPAGATION: "传导",
};

/** 测试可注入 config（绕过网络）；生产留空走 view-config 端点。 */
export interface SimInitWizardProps {
  injectedConfig?: SandboxViewConfig;
}

export default function SimInitWizard({ injectedConfig }: SimInitWizardProps = {}) {
  const navigate = useNavigate();
  const cfgQuery = useQuery({
    queryKey: ["a", "sim", "view-config"],
    queryFn: fetchSimViewConfig,
    enabled: !injectedConfig,
    retry: false,
  });
  const cfg = injectedConfig ?? cfgQuery.data;

  const [step, setStep] = useState(0);
  // step① 世界基准
  const [scopeKind, setScopeKind] = useState<"GLOBAL" | "LOCAL">("GLOBAL");
  const [target, setTarget] = useState<string>(""); // LOCAL 时 = 某 nodeType
  // step② 推演范围：纳入推演的状态变量子集（默认全选）。
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  // step③ 预检结果
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [precheck, setPrecheck] = useState<SimScopePrecheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [entering, setEntering] = useState(false);

  // 配置就绪即默认全选 stateVars + LOCAL 时默认首个 nodeType 为 target。
  useEffect(() => {
    if (cfg) {
      setSelectedVars(new Set(cfg.stateVars));
      if (cfg.nodeTypes.length > 0 && !target) setTarget(cfg.nodeTypes[0]!);
    }
  }, [cfg, target]);

  const canLocal = (cfg?.nodeTypes.length ?? 0) > 0;

  // step③：建会话（baseSnapshot 由配置派生）+ 调 scope-precheck（复用增量 2 数据）。
  const runPrecheck = useCallback(async () => {
    if (!cfg) return;
    setChecking(true);
    try {
      const base = deriveBaseSnapshot(cfg);
      // 会话只建一次；切 scope 重检只复用同一会话。
      let sid = sessionId;
      if (!sid) {
        const s = await createSimSession({ baseSnapshot: base, scope: { kind: scopeKind, target: scopeKind === "LOCAL" ? target : null } });
        sid = s.id;
        setSessionId(s.id);
      }
      const pc = await fetchSimScopePrecheck(sid, scopeKind, scopeKind === "LOCAL" ? target : undefined);
      setPrecheck(pc);
    } catch (e) {
      toastError(e);
    } finally {
      setChecking(false);
    }
  }, [cfg, sessionId, scopeKind, target]);

  // 进入 step③ 自动跑一次预检。
  useEffect(() => {
    if (step === 2 && cfg && !precheck && !checking) void runPrecheck();
  }, [step, cfg, precheck, checking, runPrecheck]);

  // 完成 → 跳沙盘主屏（SPA 内导航，保内存态 JWT）。
  const onEnter = useCallback(() => {
    setEntering(true);
    navigate("/v/sim-sandbox");
  }, [navigate]);

  const enteringList = precheck?.worldCompleteness.entering ?? [];
  // 完整度小条（把 4 类完整度比拼成 heat 序列，纯结构、无业务常数）。
  const completenessSeries = useMemo(() => {
    const wc = precheck?.worldCompleteness;
    if (!wc) return [] as number[];
    const ratio = (p: { present: number; needed: number }) => (p.needed > 0 ? Math.round((p.present / p.needed) * 100) : 100);
    return [ratio(wc.stateVars), ratio(wc.derivationRules), ratio(wc.actions), ratio(wc.propagationRules)];
  }, [precheck]);

  if (!cfg) {
    if (cfgQuery.isError) return <div className="empty-state" data-testid="siminit-config-error">沙盘配置不可用（沙盘功能未开通或本体为空）</div>;
    return <div className="empty-state" data-testid="siminit-loading">加载沙盘配置…</div>;
  }

  return (
    <div data-testid="siminit-view" className={styles.head}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3>推演初始化向导 · 进入沙盘前三步准备</h3>
        <div className={styles.sub} data-testid="siminit-config-summary">
          本体派生：{cfg.nodeTypes.length} 类对象 · {cfg.stateVars.length} 状态变量 · {cfg.propagationCount} 传导规则
        </div>
      </div>

      {/* 步骤条 */}
      <div className={styles.stepper} data-testid="siminit-stepper">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            className={`btn sm ${i === step ? "" : "ghost"}`}
            data-testid={`siminit-step-${s.key}`}
            aria-current={i === step ? "step" : undefined}
            // 仅允许回退到已走过的步（不可跳到未达步）。
            disabled={i > step}
            onClick={() => setStep(i)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ① 世界基准：选 scope */}
      {step === 0 && (
        <div className="panel" data-testid="siminit-pane-baseline" style={{ padding: 14 }}>
          <div className={styles.secHead}>世界基准 · 推演范围 scope</div>
          <div className={styles.sub} style={{ marginBottom: 10 }}>
            选择以整本体（全局）还是单一对象类型（局部）作为推演世界基准。预检与就绪认证按此 scope 计算。
          </div>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input
              type="radio"
              name="scope"
              data-testid="siminit-scope-global"
              checked={scopeKind === "GLOBAL"}
              onChange={() => setScopeKind("GLOBAL")}
            />{" "}
            全局（整本体 · {cfg.nodeTypes.length} 类对象）
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="radio"
              name="scope"
              data-testid="siminit-scope-local"
              checked={scopeKind === "LOCAL"}
              disabled={!canLocal}
              onChange={() => setScopeKind("LOCAL")}
            />
            局部（单一对象类型）
            <select
              data-testid="siminit-scope-target"
              disabled={scopeKind !== "LOCAL"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {cfg.nodeTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: 14 }}>
            <button className="btn" data-testid="siminit-next-baseline" onClick={() => setStep(1)}>下一步 →</button>
          </div>
        </div>
      )}

      {/* ② 推演范围：选纳入的 stateVars */}
      {step === 1 && (
        <div className="panel" data-testid="siminit-pane-range" style={{ padding: 14 }}>
          <div className={styles.secHead}>推演范围 · 纳入推演的状态变量</div>
          <div className={styles.sub} style={{ marginBottom: 10 }}>
            状态变量全部派生自本体传导规则（view-config.stateVars）。勾选纳入本次推演的变量。
          </div>
          {cfg.stateVars.length === 0 ? (
            <div className={styles.sub} data-testid="siminit-range-empty">本体暂无状态变量（纯建模态，无传导规则）——预检仍可跑结构完整度。</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {cfg.stateVars.map((v) => (
                <label key={v} data-testid={`siminit-var-${v}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    data-testid={`siminit-var-cb-${v}`}
                    checked={selectedVars.has(v)}
                    onChange={(e) => {
                      setSelectedVars((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(v);
                        else next.delete(v);
                        return next;
                      });
                    }}
                  />
                  {v}
                </label>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button className="btn ghost sm" data-testid="siminit-back-range" onClick={() => setStep(0)}>← 上一步</button>
            <button className="btn" data-testid="siminit-next-range" onClick={() => setStep(2)}>预检范围 →</button>
          </div>
        </div>
      )}

      {/* ③ 范围预检：复用增量 2 scope-precheck 数据 */}
      {step === 2 && (
        <div className="panel" data-testid="siminit-pane-precheck" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div className={styles.secHead}>范围预检 · 世界完整度（scope: {scopeKind}{scopeKind === "LOCAL" ? ` · ${target}` : ""}）</div>
            <button className="btn ghost sm" data-testid="siminit-recheck" disabled={checking} onClick={() => { setPrecheck(null); void runPrecheck(); }}>
              {checking ? "预检中…" : "重新预检"}
            </button>
          </div>

          {!precheck ? (
            <div className={styles.sub} data-testid="siminit-precheck-loading">{checking ? "调用范围预检…" : "准备预检…"}</div>
          ) : (
            <>
              <div className={styles.threeKpiRow} data-testid="siminit-precheck-kpis" style={{ marginTop: 10 }}>
                <div className={styles.kpi}>
                  <span>世界完整度</span>
                  <b data-testid="siminit-completeness">{precheck.worldCompleteness.pct.toFixed(0)}%</b>
                </div>
                <div className={styles.kpi}>
                  <span>状态变量</span>
                  <b data-testid="siminit-wc-statevars">{precheck.worldCompleteness.stateVars.present}/{precheck.worldCompleteness.stateVars.needed}</b>
                </div>
                <div className={styles.kpi}>
                  <span>派生规则</span>
                  <b>{precheck.worldCompleteness.derivationRules.present}/{precheck.worldCompleteness.derivationRules.needed}</b>
                </div>
                <div className={styles.kpi}>
                  <span>写回行动</span>
                  <b>{precheck.worldCompleteness.actions.present}/{precheck.worldCompleteness.actions.needed}</b>
                </div>
              </div>

              {completenessSeries.length > 0 && (
                <div style={{ margin: "4px 0 12px" }} data-testid="siminit-completeness-strip">
                  <HeatStrip series={completenessSeries} threshold={100} />
                </div>
              )}

              {/* canEnter 诚实结论 */}
              <div
                data-testid="siminit-canenter"
                style={{ fontWeight: 700, color: precheck.canEnterSimulation ? "var(--ok)" : "var(--danger)", marginBottom: 10 }}
              >
                {precheck.canEnterSimulation ? "✓ 可进入推演" : "✗ 暂不可进入推演（先补齐下列缺件）"}
              </div>

              {/* entering[] —— 将进入沙盘的状态变量清单 */}
              <div className={styles.secHead}>将进入沙盘清单（{enteringList.length}）</div>
              {enteringList.length === 0 ? (
                <div className={styles.sub} data-testid="siminit-entering-empty">暂无可进入推演的状态变量——本体尚未配置派生/传导/行动。</div>
              ) : (
                <ul data-testid="siminit-entering" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {enteringList.map((e, i) => (
                    <li key={`${e.kind}:${e.key}`} data-testid={`siminit-entering-${i}`} style={{ fontSize: 12, color: "var(--muted2)" }}>
                      <b className="mono">{e.key}</b>
                      <span className="badge" style={{ marginLeft: 6 }}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                      {" "}← {e.source}
                    </li>
                  ))}
                </ul>
              )}

              {/* 诚实缺件清单（不静默） */}
              {precheck.gaps.length > 0 && (
                <div data-testid="siminit-gaps" style={{ marginTop: 10 }}>
                  <div className={styles.secHead}>缺件清单（诚实，不静默）</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {precheck.gaps.slice(0, 8).map((g, i) => (
                      <li key={i} data-testid={`siminit-gap-${i}`} style={{ fontSize: 12, color: "var(--muted2)" }}>
                        <b className="mono">{g.gapCode}</b> · {g.ref} — {g.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                <button className="btn ghost sm" data-testid="siminit-back-precheck" onClick={() => setStep(1)}>← 上一步</button>
                <button
                  className="btn"
                  data-testid="siminit-enter"
                  disabled={!precheck.canEnterSimulation || entering}
                  title={precheck.canEnterSimulation ? "进入推演沙盘主屏" : "范围预检未通过，先补齐缺件"}
                  onClick={onEnter}
                >
                  {entering ? "进入中…" : "完成 · 进入沙盘 →"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
