import { useEffect, useMemo, useState } from "react";
import { runSolver } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import {
  buildChainImpedimentModel,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  ChainImpedimentPayloadSchema,
  DATA_MODE_LABEL,
  formatMetric,
  formatScope,
  IMPEDIMENT_KIND_LABEL,
  THRESHOLD_SOURCE_LABEL,
  type ChainImpedimentModel,
  type ImpedimentGroup,
  type ImpedimentVM,
} from "./chainImpediment";
import styles from "./ChainImpedimentView.module.css";

/**
 * WO-IMPEDIMENT-FE · 全链阻滞点（卡点 / 堵点 / 断点）。
 *
 * ── 这张页面回答什么（与 F1 线路图**不重复**）─────────────────────────────────
 * F1 全链线路图（`ChainLineMapView`，求解器 `chain_loss_attribution`）回答「**前置期的时间去哪了**」，
 * 它的停运站位是「某环节的耗时算不出来」。
 * 本页（求解器 `chain_impediments`，WO-SANDBOX-E3）回答「**哪里被卡住了、凭哪条规则说它被卡住**」：
 *  ① 三类**可判定分类** —— 卡点（不够）/ 堵点（流不动）/ 断点（接不上），互斥；
 *  ② **判定依据** —— 触发了哪条规则红线、实测值 vs 阈值 + 单位；
 *  ③ **阈值出处** —— 这条判定的旋钮在哪（规则 params / 表达式字面量 / 对象属性）；
 *  ④ **dataMode 四态 + caveat** —— 这条结论到底能不能当读数用。
 * ①②③④ 在 F1 的载荷里**一个都没有**（E1 的 `empty[]` 只有 `NO_CARRIER`/`NO_INSTANCE` 两种缺席形态、
 * 无规则、无阈值、无 severity、无 dataMode 分级）。逐字段对照见交付说明。
 * 本页因此**不画线路图、不画停运站位、不碰 `ChainLineMapView`** —— 那些是 F1 的既有资产。
 *
 * ── 数据来源（**只有一条**）───────────────────────────────────────────────────
 * 引擎求解器 `chain_impediments`，经 `runSolver` → B 侧 `/b/v1/solvers/{key}/run`。
 * 本组件**不带任何内置数据集**：引擎没接通就显示接不通，不拿示例数据顶上（`genuine-sim` 纪律）。
 *
 * ── 头号纪律：`dataMode` 如实渲染（把 PARTIAL 当 LIVE 画 = 退单）────────────────
 * 每一条阻滞点都带一个**诚实位徽标 + 一句「这条结论断言了什么」**，四态四句不合并：
 *  · `EMPTY`   → 明说「该环节读数不可信 ⇒ 算不出来」，**不渲染成 0、不渲染成空白**；
 *  · `PARTIAL` → 削弱原因**透传引擎 `caveats[]` 原文**（「只比对了快照与规则红线 X、未校验持续天数」），
 *                前端一个字都不改写；
 *  · `SYNTHETIC` → 明说 locus 对象带合成血缘；
 *  · `LIVE`    → 才是实测。
 *
 * ── 零结果也要说话 ────────────────────────────────────────────────────────────
 * 引擎返回空数组 ⇒ 显示「本次未检出」**并同时列出判不出来的判据与原因**，
 * 而不是一个「一切正常」的假空状态：0 条阻滞点 ≠ 全链健康，可能只是判据today判不出来。
 *
 * ── 主题 ──────────────────────────────────────────────────────────────────────
 * 零硬编码颜色：全部走 `styles/tokens.css` 的 CSS 变量 ⇒ dark / light / warm 三套自动跟随。
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; model: ChainImpedimentModel }
  | { status: "error"; code: string; message: string; requestId: string | null };

interface EnvelopeError {
  code?: string;
  message?: string;
  requestId?: string;
}

/**
 * 错误只陈述**能从响应直接读出**的事实：错误码 / 后端 message / requestId。
 * 不内联任何因果断言（"大概是没开通吧"）—— 前端看不出病因，只看得见响应。
 */
function readError(e: unknown): { code: string; message: string; requestId: string | null } {
  const anyE = e as { code?: string; message?: string; requestId?: string; error?: EnvelopeError; status?: number };
  const code = anyE?.error?.code ?? anyE?.code ?? (anyE?.status ? `HTTP_${anyE.status}` : "UNKNOWN");
  const message = anyE?.error?.message ?? anyE?.message ?? String(e);
  return { code: String(code), message, requestId: anyE?.error?.requestId ?? anyE?.requestId ?? null };
}

/**
 * 求解器入参：从 `view.options` 取，缺省 = 未限定（全域）。**不在前端编默认范围。**
 * ⚠ `businessTypes` / `modelIds` 本求解器显式拒绝（R-ARG-FIDELITY，见 `service.ts:3125`）——
 * 前端照样原样透传：**引擎该报 400 就让它报 400**，前端悄悄吞掉一个维度才是那族 plausible-but-WRONG 的病根。
 */
export function argsFromView(view: ViewRendererProps["view"] | undefined): Record<string, unknown> {
  const opts = (view?.options ?? {}) as Record<string, unknown>;
  const scope: Record<string, unknown> = {};
  for (const dim of ["baseIds", "businessTypes", "modelIds"] as const) {
    const v = opts[dim];
    if (Array.isArray(v) && v.length > 0) scope[dim] = v;
  }
  return { scope };
}

// ══════════════════════════════════════════════════════════════════════════════
// 单条阻滞点
// ══════════════════════════════════════════════════════════════════════════════

function ImpedimentCard({ im }: { im: ImpedimentVM }) {
  const ev = im.evidence;
  return (
    <li
      className={styles.card}
      data-testid={`ci-item-${im.impedimentId}`}
      data-kind={im.kind}
      data-data-mode={im.honesty.mode}
      data-break-subtype={im.breakSubtype ?? ""}
    >
      <div className={styles.cardHead}>
        <span className={styles.kindTag} data-kind={im.kind} data-testid={`ci-kind-${im.impedimentId}`}>
          {im.kindLabel}
          {im.breakSubtypeLabel !== null ? ` · ${im.breakSubtypeLabel}` : ""}
        </span>
        {/* 诚实位徽标 —— 本单头号判据：四态四色，绝不把 PARTIAL 画成 LIVE */}
        <span
          className={styles.honestyTag}
          data-mode={im.honesty.mode}
          data-degraded={im.honesty.degraded ? "1" : "0"}
          data-testid={`ci-datamode-${im.impedimentId}`}
          title={im.honesty.claim}
        >
          {im.honesty.label}
        </span>
        <span className={styles.severity} data-testid={`ci-severity-${im.impedimentId}`}>
          严重度 {im.severity}
        </span>
      </div>

      {/* 位置：哪个环节 / 哪个真对象（R13：落到对象，不是一句描述） */}
      <p className={styles.locus} data-testid={`ci-locus-${im.impedimentId}`}>
        <b>{im.locus.label}</b>
        <small>
          {im.stage} 段 · {im.locus.objectType} · <code>{im.locus.objectId}</code>
        </small>
      </p>

      {/* 判定依据：触发了哪条规则红线 · 实测值 vs 阈值 */}
      <dl className={styles.kv} data-testid={`ci-evidence-${im.impedimentId}`}>
        <dt>触发规则</dt>
        <dd data-testid={`ci-rule-${im.impedimentId}`}>
          {ev.ruleKey === null ? "引擎未回带规则码（无从溯源）" : <code>{ev.ruleKey}</code>}
          {ev.ruleParamKey !== null ? (
            <>
              {" "}
              · 旋钮 <code>params.{ev.ruleParamKey}</code>
            </>
          ) : null}
        </dd>
        <dt>实测值 vs 阈值</dt>
        <dd data-testid={`ci-metric-${im.impedimentId}`}>
          <b>{formatMetric(ev.metricValue)}</b> {ev.unit} <span className={styles.vs}>vs 红线</span>{" "}
          <b>{formatMetric(ev.threshold)}</b> {ev.unit}
          <small className={styles.breach}>（越线 {formatMetric(ev.breach)} {ev.unit}）</small>
        </dd>
        {im.thresholdSource !== null ? (
          <>
            <dt>阈值出处</dt>
            <dd data-testid={`ci-threshold-src-${im.impedimentId}`}>
              {THRESHOLD_SOURCE_LABEL[im.thresholdSource.source]}
              {im.thresholdSource.fieldPath !== undefined ? (
                <>
                  {" "}
                  · <code>{im.thresholdSource.fieldPath}</code>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {ev.derivationEdge !== null ? (
          <>
            <dt>派生边</dt>
            <dd data-testid={`ci-edge-${im.impedimentId}`}>
              <code>{ev.derivationEdge}</code>
            </dd>
          </>
        ) : null}
      </dl>

      {/* 诚实位说明 —— PARTIAL 时是引擎 caveats[] 原文，前端不改写 */}
      <p
        className={styles.honestyClaim}
        data-degraded={im.honesty.degraded ? "1" : "0"}
        data-testid={`ci-honesty-claim-${im.impedimentId}`}
      >
        {im.honesty.claim}
      </p>
      {im.honesty.detail !== null ? (
        <p className={styles.honestyDetail} data-testid={`ci-honesty-detail-${im.impedimentId}`}>
          {im.honesty.detail}
        </p>
      ) : null}
    </li>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 一类分组（空组也保留：「本类本次未检出」必须说出来，不是消失）
// ══════════════════════════════════════════════════════════════════════════════

function KindGroup({ g }: { g: ImpedimentGroup }) {
  return (
    <section className={styles.group} data-testid={`ci-group-${g.kind}`} data-kind={g.kind} data-count={g.items.length}>
      <header className={styles.groupHead}>
        <h4>
          <span className={styles.kindTag} data-kind={g.kind}>
            {g.label}
          </span>
          <span className={styles.groupCount} data-testid={`ci-count-${g.kind}`}>
            {g.items.length} 条
          </span>
        </h4>
        <p className={styles.groupMeaning}>{g.meaning}</p>
      </header>

      {g.items.length > 0 ? (
        <ul className={styles.cards}>
          {g.items.map((im) => (
            <ImpedimentCard key={im.impedimentId} im={im} />
          ))}
        </ul>
      ) : (
        <p className={styles.emptyGroup} data-testid={`ci-empty-${g.kind}`} role="note">
          本次未检出{g.label}。
          {g.unresolved.length > 0 ? (
            <>
              {" "}
              ⚠ 但本类有 <b>{g.unresolved.length}</b> 条判据<b>判不出来</b>（见下「判不出来的判据」）——
              所以「0 条」<b>不等于</b>「没有{g.label}」。
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 视图
// ══════════════════════════════════════════════════════════════════════════════

export function ChainImpedimentView({ view }: Partial<ViewRendererProps>) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const args = useMemo(() => argsFromView(view), [view]);
  const argsKey = useMemo(() => JSON.stringify(args), [args]);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    runSolver(CHAIN_IMPEDIMENT_SOLVER_KEY, JSON.parse(argsKey) as Record<string, unknown>)
      .then((res) => {
        if (!alive) return;
        // 形状不合当场抛（zod）——不猜、不兜底、不补默认值。
        const payload = ChainImpedimentPayloadSchema.parse(res.data);
        setState({ status: "ready", model: buildChainImpedimentModel(payload) });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({ status: "error", ...readError(e) });
      });
    return () => {
      alive = false;
    };
  }, [argsKey]);

  const model = state.status === "ready" ? state.model : null;

  return (
    <div className={styles.root} data-testid="ci-root">
      <header className={styles.head}>
        <div>
          <h3>全链阻滞点 · 卡点 / 堵点 / 断点</h3>
          <p className={styles.sub}>
            引擎 <code>{CHAIN_IMPEDIMENT_SOLVER_KEY}</code> 全链扫描：三类<b>互斥</b>可判 —— 同一 locus 同时命中卡点与堵点时，
            按规则声明的<b>利用率红线</b>裁决（达线 = 卡点）。每条结论的阈值都是<b>从规则表达式读回来的</b>，
            引擎内零阈值；改规则即改判定。
            <br />
            与<b>全链线路图</b>的分工：线路图问「前置期的时间去哪了」（环节耗时分解），本页问「哪里被卡住了、
            凭哪条规则说它被卡住」（规则红线判定）。两张图数据源不同，<b>不重复展示</b>。
          </p>
        </div>
      </header>

      {state.status === "loading" ? (
        <p className={styles.stateLine} data-testid="ci-loading">
          正在扫描全链阻滞点…
        </p>
      ) : null}

      {state.status === "error" ? (
        <section className={styles.engineError} data-testid="ci-engine-error" role="alert">
          <b>取不到引擎结果</b>
          <p>
            <code>{state.code}</code> · {state.message}
            {state.requestId !== null ? (
              <>
                {" "}
                · requestId <code>{state.requestId}</code>
              </>
            ) : null}
          </p>
          <p className={styles.errorHint}>
            这条路只有一个数据源（<code>{CHAIN_IMPEDIMENT_SOLVER_KEY}</code>）。取不到数时显示本提示，
            <b>不拿示例数据顶上</b> —— 编出来的假阻滞点比空白更危险（<code>genuine-sim</code> 纪律）。
          </p>
        </section>
      ) : null}

      {model !== null ? (
        <>
          {/* ── 顶栏：本次扫描是什么范围、几条、几条不可当实测用 ────────────────── */}
          <section className={styles.summaryBar} data-testid="ci-summary">
            <span data-testid="ci-scan-id">
              扫描 <code>{model.scanId}</code>
            </span>
            <span data-testid="ci-scope">范围：{formatScope(model.scope, model.scopeUnscoped)}</span>
            <span data-testid="ci-total">
              共 {model.total} 条 · {IMPEDIMENT_KIND_LABEL.BOTTLENECK} {model.groups[0]?.items.length ?? 0} ·{" "}
              {IMPEDIMENT_KIND_LABEL.CONGESTION} {model.groups[1]?.items.length ?? 0} · {IMPEDIMENT_KIND_LABEL.BREAK}{" "}
              {model.groups[2]?.items.length ?? 0}
            </span>
            <span data-testid="ci-honesty-counts" className={styles.honestyCounts}>
              {(["LIVE", "PARTIAL", "SYNTHETIC", "EMPTY"] as const).map((m) => (
                <i key={m} className={styles.honestyTag} data-mode={m} data-degraded={m === "LIVE" ? "0" : "1"}>
                  {DATA_MODE_LABEL[m]} {model.honestyCounts[m]}
                </i>
              ))}
            </span>
            {model.ruleSetVersion !== null ? (
              <span data-testid="ci-ruleset">
                规则集 <code>{model.ruleSetVersion}</code>
              </span>
            ) : null}
          </section>

          {model.countMismatch !== null ? (
            <p className={styles.mismatch} data-testid="ci-count-mismatch" role="alert">
              {model.countMismatch}
            </p>
          ) : null}

          {/* ── 三类分组 ───────────────────────────────────────────────────────── */}
          <div className={styles.groups}>
            {model.groups.map((g) => (
              <KindGroup key={g.kind} g={g} />
            ))}
          </div>

          {/* ── 判不出来的判据（诚实缺席 · 不是漏做）───────────────────────────── */}
          <section className={styles.unresolved} data-testid="ci-unresolved" role="note">
            <b>判不出来的判据（{model.unresolved.length} 条）—— 诚实缺席，不给默认阈值凑一个像样的判定</b>
            {model.unresolved.length === 0 ? (
              <p data-testid="ci-unresolved-none">本次全部判据都判得出来。</p>
            ) : (
              <ul>
                {model.unresolved.map((u) => (
                  <li key={u.bindingId} data-testid={`ci-unresolved-${u.bindingId}`} data-kind={u.kind}>
                    <span className={styles.kindTag} data-kind={u.kind}>
                      {IMPEDIMENT_KIND_LABEL[u.kind]}
                    </span>{" "}
                    <code>{u.bindingId}</code>
                    {u.ruleKey !== undefined ? (
                      <>
                        {" "}
                        · 规则 <code>{u.ruleKey}</code>
                      </>
                    ) : null}
                    <span className={styles.unknownTag}>{u.status}</span>
                    <p className={styles.unresolvedReason}>{u.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 阈值出处全表（R13：这次一共动了哪几个旋钮）──────────────────────── */}
          <section className={styles.thresholds} data-testid="ci-thresholds" role="note">
            <b>本次判定动用的阈值（{model.thresholds.length} 条）—— 每个数都指得出旋钮在哪</b>
            {model.thresholds.length === 0 ? (
              <p data-testid="ci-thresholds-none">
                引擎未回带任何阈值出处行 ⇒ 本次结论<b>指不出</b>「旋钮在哪」。
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>判据</th>
                    <th>规则</th>
                    <th>阈值</th>
                    <th>出处（改哪个旋钮）</th>
                  </tr>
                </thead>
                <tbody>
                  {model.thresholds.map((t) => (
                    <tr key={t.bindingId} data-testid={`ci-threshold-${t.bindingId}`}>
                      <td>
                        <code>{t.bindingId}</code>
                      </td>
                      <td>
                        <code>{t.ruleKey}</code>
                      </td>
                      <td>
                        {formatMetric(t.value)} {t.unit}
                      </td>
                      <td>
                        {THRESHOLD_SOURCE_LABEL[t.source]}
                        {t.ruleParamKey !== undefined ? (
                          <>
                            {" "}
                            · <code>params.{t.ruleParamKey}</code>
                          </>
                        ) : null}
                        {t.fieldPath !== undefined ? (
                          <>
                            {" "}
                            · <code>{t.fieldPath}</code>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── 诚实边界（引擎口径 + 本次载荷事实，视图必须原样显示）─────────────── */}
          {model.notes.length > 0 ? (
            <section className={styles.notes} data-testid="ci-notes" role="note">
              <b>本次扫描的诚实边界</b>
              <ul>
                {model.notes.map((n, i) => (
                  <li key={n} data-testid={`ci-note-${i}`}>
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default ChainImpedimentView;
