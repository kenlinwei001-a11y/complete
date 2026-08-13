import { useCallback, useEffect, useMemo, useState } from "react";
import { runSolver } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import { formatDays } from "./chainLineMap";
import {
  buildOrderVMs,
  buildWhoToCall,
  DEFAULT_KIT_ARGS,
  KIT_READINESS_SOLVER_KEY,
  KitReadinessPayloadSchema,
  LEG_STATUS_PRESENTATION,
  statusTally,
  type ItemVM,
  type LegVM,
  type OrderVM,
} from "./procurementLegs";
import styles from "./ProcurementLegsView.module.css";

/**
 * WO-PROCUREMENT-FRONTEND · 采购四段腿分解（「该找谁」页）。
 *
 * ── 本页存在的理由 ────────────────────────────────────────────────────────────
 * WO-SANDBOX-D2 让引擎能回答"晚在哪一段、该找谁"（`kit_readiness` 每个缺料项带
 * `procurement` 四段 / `ownerDays` / `criticalLeg`），但那之后这些字段**零前端消费方** ——
 * 能力在后端跑着，用户在界面上一个字看不见。本组件是那条缺失的链路。
 *
 * 用户要的不是「晚了 36 天」，是「今天该打哪通电话」。所以本页的版面顺序是：
 *   ① 该找谁总榜（全量关键段按具体责任方归并·整页第一眼）
 *   ② 逐缺料项：关键段横幅 → 四段瀑布 → 合计 → 责任方汇总 → MOQ/准时率
 * 而不是先摆一张按物料排的表让人自己找。
 *
 * ── 数据来源（**只有一条**）────────────────────────────────────────────────────
 * 引擎求解器 `kit_readiness`，经 `runSolver` → B 侧 `/b/v1/solvers/{key}/run` → A 侧 invoke。
 * 本组件**不带任何内置数据集**：引擎接不通就显示接不通，不拿示例数据顶上。
 * 入参刻意只给分析窗（不传 `orders`）—— 引擎 `deriveExtendedArgs` 见到 `orders` 会直接返回，
 * 采购段凭证根本不会被推导出来（详见 `procurementLegs.ts DEFAULT_KIT_ARGS` 注释）。
 *
 * ── 三态（本单第 2 条硬要求）──────────────────────────────────────────────────
 * `MEASURED` / `NOT_APPLICABLE` / `EMPTY` 三者在本页有**四重**互不相同的编码：
 *   ① `data-status` 属性（可断言）
 *   ② 文案标签「实测」/「不适用」/「取不到」+ 各自的 `reason` 前缀（口径 / 依据 / 缺）
 *   ③ 形状与纹理（实心条 / 零宽虚线塌陷 / 斜纹点线洞）—— 去掉颜色仍一眼可分
 *   ④ **功能性后果**：`EMPTY` 阻断四段合计（`totalDays: null`），`NOT_APPLICABLE` 计 0 不阻断。
 * 第 ④ 条是最硬的那条 —— 把「不适用」和「不知道」混为一谈的界面做不出这个差别。
 *
 * ── 主题 ──────────────────────────────────────────────────────────────────────
 * 零硬编码颜色：全部走 `styles/tokens.css` 的 CSS 变量 ⇒ dark / light / warm 三套自动跟随。
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; orders: OrderVM[]; snapshotVersion: string | null }
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

const pctText = (pct: number | null): string => (pct === null ? "—" : `${pct.toFixed(1)}%`);

// ══════════════════════════════════════════════════════════════════════════════
// § 一条腿
// ══════════════════════════════════════════════════════════════════════════════

function LegRow({ leg }: { leg: LegVM }): JSX.Element {
  const pres = leg.presentation;
  return (
    <li
      className={styles.leg}
      data-testid={`proc-leg-${leg.leg}`}
      data-status={leg.status}
      data-known={pres.known ? "1" : "0"}
      data-blocks-total={pres.blocksTotal ? "1" : "0"}
      data-owner={leg.owner}
      data-critical={leg.critical ? "1" : "0"}
      data-value-add={leg.valueAdd ? "1" : "0"}
    >
      <span className={styles.legName}>
        {leg.label}
        {leg.critical ? " ◀" : ""}
      </span>

      <span className={styles.legOwner}>
        <span className={styles.legOwnerRole}>{leg.ownerLabel}</span>
        {/* 责任方指不出来 ⇒ 明说"未指明"，**不编一个名字**（契约 ownerRef 可为 null）。 */}
        <span className={styles.legOwnerRef} data-absent={leg.ownerRef === null ? "1" : "0"} data-testid={`proc-leg-${leg.leg}-ownerref`}>
          {leg.ownerRef ?? "未指明"}
        </span>
      </span>

      {/* 条本体：三态三种形状/纹理 */}
      <span className={styles.track}>
        {leg.status === "MEASURED" ? (
          <span className={styles.bar} data-status="MEASURED" data-value-add={leg.valueAdd ? "1" : "0"} style={{ width: `${leg.widthPct}%` }} />
        ) : leg.status === "NOT_APPLICABLE" ? (
          // 零宽塌陷 + 虚线：**结构上没有这一段**（真值 0，已结算）
          <span className={styles.naMark} data-testid={`proc-leg-${leg.leg}-na`}>
            本段不存在 · 0 天（已结算）
          </span>
        ) : (
          // 斜纹 + 点线：**不知道**（未结算，阻断合计）——刻意不给任何数字
          <span className={styles.emptyMark} data-testid={`proc-leg-${leg.leg}-empty`}>
            取不到真值 · 不知道多少天
          </span>
        )}
      </span>

      <span className={styles.legDays} data-testid={`proc-leg-${leg.leg}-days`} data-known={pres.known ? "1" : "0"}>
        {leg.daysText} · {pres.label}
      </span>

      {leg.reason ? (
        <span className={styles.legReason} data-testid={`proc-leg-${leg.leg}-reason`}>
          <b className={styles.reasonTag} data-status={leg.status}>
            {pres.reasonPrefix}
          </b>
          {leg.reason}
        </span>
      ) : null}

      {leg.source ? (
        <span className={styles.legSource} data-testid={`proc-leg-${leg.leg}-source`}>
          出处：{leg.source.objectType}.{leg.source.field} ← {leg.source.objectIds.join(" / ")}
        </span>
      ) : null}
    </li>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 一个缺料项
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一个缺料项。
 *
 * ⚠ **testid 是「相对其容器」的，不保证全页唯一** —— 真实数据里同一个物料会在多张单上重复出现：
 *   引擎 `extended.ts:676-680` 给**每一张**订单挂的都是同一份 `mats.slice(0, 4)`
 *   （最多 8 单 × 同 4 个物料）⇒ `proc-item-elyte` / `proc-critical-elyte` 会出现 8 次。
 *   所以取元素一律 `within(screen.getByTestId(\`proc-order-<orderId>\`))` 逐单收窄，
 *   段一级同理经 `within(proc-waterfall-<material>)`。全局 `screen.getByTestId` 在多单数据下必然多命中 ——
 *   这正是"fixture 只有一单所以测试绿"的那类假绿，可达门里专门有一例（⑩）咬真实的多单形态。
 */
function ItemCard({ item }: { item: ItemVM }): JSX.Element {
  return (
    <section className={styles.item} data-testid={`proc-item-${item.material}`} data-complete={item.complete ? "1" : "0"}>
      <header className={styles.itemHead}>
        <span className={styles.material}>{item.material}</span>
        <span className={styles.pill} data-tone="danger">
          缺 {item.shortage}
        </span>
        <span className={styles.supplier} data-testid={`proc-item-${item.material}-supplier`}>
          {item.supplierName ?? "供应商未指明"}
          {item.supplierId ? `（${item.supplierId}）` : ""}
        </span>
      </header>

      {/* ── criticalLeg：整个特性的落点 —— 用户要的是"该去找谁" ──────────────── */}
      {item.critical ? (
        <div
          className={styles.critical}
          data-testid={`proc-critical-${item.material}`}
          data-leg={item.critical.leg}
          data-owner={item.critical.owner}
          data-internal={item.critical.internal ? "1" : "0"}
        >
          <span className={styles.criticalLabel}>最该找</span>
          <span className={styles.criticalWho}>{item.critical.ownerRef ?? item.critical.ownerLabel}</span>
          <span className={styles.criticalMeta}>
            {item.critical.legLabel} · {item.critical.ownerLabel} · {item.critical.daysText} · 占采购总耗时 {pctText(item.critical.pctOfTotal)}
          </span>
          <span className={styles.criticalHint}>{item.critical.actionHint}</span>
        </div>
      ) : (
        <div className={styles.criticalAbsent} data-testid={`proc-critical-absent-${item.material}`}>
          最该找：<b>无从判定</b> —— 四段无一实测（<code>criticalProcurementLeg</code> 只在实测段里取最大）。
          先把下面标「取不到」的段补上真凭证，再谈找谁。
        </div>
      )}

      {/* 引擎汇总 vs 契约唯一实现：对不上就当面报，不静默择一显示 */}
      {item.criticalAgreement === "MISMATCH" ? (
        <p className={styles.mismatch} data-testid={`proc-critical-mismatch-${item.material}`}>
          ⚠ 引擎下发的 criticalLeg 与契约 <code>criticalProcurementLeg(legs)</code> 重算结果<b>不一致</b>。
          屏上显示的是按契约唯一实现算出的那一段；请查引擎侧，不要按这条打电话。
        </p>
      ) : null}
      {item.ownerAgreement === "MISMATCH" ? (
        <p className={styles.mismatch} data-testid={`proc-owner-mismatch-${item.material}`}>
          ⚠ 引擎下发的 ownerDays 与契约 <code>procurementDaysByOwner(legs)</code> 重算结果<b>不一致</b>（屏上为后者）。
        </p>
      ) : null}

      {/* ── 四段瀑布 ────────────────────────────────────────────────────────── */}
      <ol className={styles.waterfall} data-testid={`proc-waterfall-${item.material}`} data-legs={item.legs.length}>
        {item.legs.map((l) => (
          <LegRow key={l.leg} leg={l} />
        ))}
      </ol>

      {/* ── 合计（EMPTY 阻断 ⇒ 明说是被哪几段挡的）──────────────────────────── */}
      <div className={styles.totals} data-testid={`proc-total-${item.material}`} data-complete={item.complete ? "1" : "0"}>
        <span className={styles.totalItem}>
          <span className={styles.totalKey}>四段合计</span>
          <span className={styles.totalVal} data-known={item.totalDays === null ? "0" : "1"} data-testid={`proc-total-days-${item.material}`}>
            {item.totalDays === null ? "不可结算" : formatDays(item.totalDays)}
          </span>
        </span>
        <span className={styles.totalItem}>
          <span className={styles.totalKey}>其中增值</span>
          <span className={styles.totalVal}>{item.valueAddDays === null ? "—" : formatDays(item.valueAddDays)}</span>
        </span>
        <span className={styles.totalItem}>
          <span className={styles.totalKey}>承诺齐套日</span>
          <span className={styles.totalVal} data-known={item.earliestKitDay === null ? "0" : "1"}>
            {item.earliestKitDay === null ? "不可结算" : `D${item.earliestKitDay}`}
          </span>
        </span>
        <span className={styles.totalItem}>
          <span className={styles.totalKey}>期望齐套日</span>
          <span className={styles.totalVal} data-known={item.expectedKitDay === null ? "0" : "1"} data-testid={`proc-expected-kit-${item.material}`}>
            {item.expectedKitDay === null ? "不可结算" : `D${item.expectedKitDay}`}
          </span>
        </span>
        {item.expectedSlipDays !== null ? (
          <span className={styles.totalItem}>
            <span className={styles.totalKey}>期望滑期</span>
            <span className={styles.totalVal}>
              {formatDays(item.expectedSlipDays)}
              {item.onTimeRate === null ? "" : `（准时率 ${(item.onTimeRate * 100).toFixed(1)}%）`}
            </span>
          </span>
        ) : null}
        {item.totalDays === null ? (
          <span className={styles.totalBlocked} data-testid={`proc-total-blocked-${item.material}`}>
            合计不可结算：{item.blockingLegs.map((k) => item.legs.find((l) => l.leg === k)?.label ?? k).join("、")} 取不到真值。
            拒绝拿已知几段之和冒充总数 —— 那会让最早齐套日系统性偏早，而且偏多少没人看得见。
          </span>
        ) : null}
      </div>

      {/* ── 责任方汇总 ──────────────────────────────────────────────────────── */}
      <div className={styles.rollup} data-testid={`proc-rollup-${item.material}`}>
        <span className={styles.totalKey}>这些天里谁占了多少</span>
        {item.ownerRollup.map((r) => (
          <span key={r.owner} className={styles.rollupChip} data-owner={r.owner} data-internal={r.internal ? "1" : "0"} data-testid={`proc-rollup-${item.material}-${r.owner}`}>
            {r.ownerLabel}
            <b className={styles.rollupDays}>
              {formatDays(r.days)} · {pctText(r.pctOfTotal)}
            </b>
          </span>
        ))}
        {item.unknownOwners.map((o) => (
          <span key={o} className={styles.rollupUnknown} data-testid={`proc-rollup-unknown-${item.material}-${o}`}>
            {o} 天数未知（不摊到任何人头上）
          </span>
        ))}
      </div>

      {/* ── MOQ（D2 接线：缺 3 吨但起订 1000 → 就得买 1000）────────────────── */}
      <div className={styles.rollup} data-testid={`proc-moq-${item.material}`} data-applied={item.moqApplied ? "1" : "0"}>
        <span className={styles.totalKey}>补货量</span>
        <span className={styles.rollupChip}>
          {item.replenishQty === null ? "起订量取不到 ⇒ 采购量不可结算（不拿缺口冒充）" : `实际采购 ${item.replenishQty}`}
        </span>
        {item.moqApplied ? (
          <span className={styles.pill} data-tone="warn" data-testid={`proc-moq-applied-${item.material}`}>
            起订量抬高了采购量：缺 {item.shortage} → 起订 {item.minOrderQty}
          </span>
        ) : null}
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 页面
// ══════════════════════════════════════════════════════════════════════════════

export default function ProcurementLegsView({ view }: ViewRendererProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // `view.options` 可覆盖分析窗（ViewPage 传参这条路真的通）；其余入参不开放 —— 见 DEFAULT_KIT_ARGS。
  const argsKey = useMemo(() => {
    const o = view.options ?? {};
    const args: Record<string, unknown> = { ...DEFAULT_KIT_ARGS };
    if (typeof o.fromDay === "number") args.fromDay = o.fromDay;
    if (typeof o.toDay === "number") args.toDay = o.toDay;
    return JSON.stringify(args);
  }, [view.options]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setState({ status: "loading" });
    runSolver(KIT_READINESS_SOLVER_KEY, JSON.parse(argsKey) as Record<string, unknown>, ac.signal).then(
      (raw) => {
        if (cancelled) return;
        const parsed = KitReadinessPayloadSchema.safeParse((raw as { data?: unknown })?.data ?? raw);
        if (!parsed.success) {
          // 形状不合契约 ⇒ 报出来，**不去猜、不去补字段**。采购段用的是契约的
          // `ProcurementPlanSchema`，所以"四段被合成一个数"这类回归在这里当场现形。
          setState({
            status: "error",
            code: "PAYLOAD_SHAPE",
            message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "),
            requestId: null,
          });
          return;
        }
        setState({
          status: "ready",
          orders: buildOrderVMs(parsed.data),
          snapshotVersion: (raw as { snapshotVersion?: string })?.snapshotVersion ?? null,
        });
      },
      (e: unknown) => {
        if (cancelled) return;
        setState({ status: "error", ...readError(e) });
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [argsKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const orders = state.status === "ready" ? state.orders : [];
  const whoToCall = useMemo(() => buildWhoToCall(orders), [orders]);
  const tally = useMemo(() => statusTally(orders), [orders]);
  const itemCount = orders.reduce((s, o) => s + o.items.length, 0);

  return (
    <div className={styles.root} data-testid="procurement-legs-root" data-status={state.status}>
      <header className={styles.head}>
        <h2 className={styles.title}>{view.title || "采购四段腿分解 · 该找谁"}</h2>
        <p className={styles.note}>
          缺料时把采购总耗时拆成<b>按责任方可归属</b>的四段：供应商生产（SUPPLIER）→ 在途运输（CARRIER）→
          清关（CUSTOMS_BROKER）→ 到货检验（QUALITY_IQC）。回答的不是「晚了多少天」，是「晚在哪一段、该去找谁」。
          真值来自引擎求解器 <code>{KIT_READINESS_SOLVER_KEY}</code>，本页不带任何内置数据集。
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={styles.btn} onClick={reload} data-testid="proc-reload">
            重新取数
          </button>
          {state.status === "ready" ? (
            <span data-testid="proc-tally">
              缺料项 {itemCount} · 实测段 {tally.MEASURED} · 不适用段 {tally.NOT_APPLICABLE} · 取不到段 {tally.EMPTY}
              {state.snapshotVersion ? ` · 快照 ${state.snapshotVersion}` : ""}
            </span>
          ) : null}
        </div>
      </header>

      {/* ── 三态图例：把「不适用」与「取不到」的区别当面写清楚 ─────────────── */}
      <div className={styles.legend} data-testid="proc-legend">
        {(["MEASURED", "NOT_APPLICABLE", "EMPTY"] as const).map((s) => (
          <span key={s} className={styles.legendItem} data-testid={`proc-legend-${s}`}>
            <i className={styles.legendSwatch} data-status={s} />
            <span>
              <b>{LEG_STATUS_PRESENTATION[s].label}</b>（{s}）：{LEG_STATUS_PRESENTATION[s].meaning}
            </span>
          </span>
        ))}
      </div>

      {state.status === "loading" ? (
        <div className={styles.state} data-testid="proc-loading">
          正在向引擎求解 {KIT_READINESS_SOLVER_KEY}…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className={styles.state} data-testid="proc-error">
          <b className={styles.stateTitle}>取不到采购四段分解</b>
          <span className={styles.stateCode} data-testid="proc-error-code">
            {state.code}
          </span>
          <p>{state.message}</p>
          {state.requestId ? <p className={styles.stateCode}>requestId: {state.requestId}</p> : null}
          <p>
            本页只陈述响应里读得到的事实，不猜病因，也不拿示例数据顶上 ——
            界面上看不见，就说明这条链今天不通。
          </p>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          {/* ── ① 该找谁总榜（整页第一眼）───────────────────────────────── */}
          {whoToCall.length > 0 ? (
            <div className={styles.whoBoard} data-testid="proc-whoboard" data-count={whoToCall.length}>
              <b className={styles.whoTitle}>该找谁 · 按关键段责任方归并（累计天数降序）</b>
              <ol className={styles.whoList}>
                {whoToCall.map((w, i) => (
                  <li key={`${w.owner}-${w.ownerRef ?? ""}`} className={styles.whoRow} data-testid={`proc-who-${i}`} data-owner={w.owner} data-internal={w.internal ? "1" : "0"}>
                    <span className={styles.whoRank}>#{i + 1}</span>
                    <span className={styles.whoName}>{w.displayName}</span>
                    <span className={styles.whoRole} data-internal={w.internal ? "1" : "0"}>
                      {w.ownerLabel}
                      {w.internal ? " · 对内" : ""}
                    </span>
                    <span className={styles.whoDays}>关键段合计 {formatDays(w.totalDays)}</span>
                    <span className={styles.whoMats}>压住：{w.materials.join("、")}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className={styles.state} data-testid="proc-whoboard-empty">
              <b className={styles.stateTitle}>没有可归责的关键段</b>
              <p>
                本次结果里没有任何一项缺料能定出关键段 —— 要么没有缺料项，要么缺料项的四段无一实测。
                不编一个"最该找的人"。
              </p>
            </div>
          )}

          {/* ── ② 逐订单 / 逐缺料项 ─────────────────────────────────────── */}
          {orders.map((o) => (
            <section key={o.orderId} className={styles.order} data-testid={`proc-order-${o.orderId}`} data-kit-status={o.earliestKitDayStatus ?? ""}>
              <header className={styles.orderHead}>
                <span className={styles.orderId}>{o.orderId}</span>
                <span className={styles.pill} data-tone={o.kitRatio >= 1 ? "ok" : "danger"}>
                  齐套率 {(o.kitRatio * 100).toFixed(1)}%
                </span>
                {o.advice ? <span className={styles.pill}>{o.advice}</span> : null}
                <span className={styles.pill} data-tone={o.earliestKitDay === null ? "danger" : "warn"} data-testid={`proc-order-kitday-${o.orderId}`}>
                  最早齐套日 {o.earliestKitDay === null ? "不可结算" : `D${o.earliestKitDay}`}
                </span>
              </header>

              {o.earliestKitDayReason ? (
                <p className={styles.totalBlocked} data-testid={`proc-order-kitreason-${o.orderId}`}>
                  {o.earliestKitDayReason}
                </p>
              ) : null}

              {o.items.map((it) => (
                <ItemCard key={it.material} item={it} />
              ))}

              {o.itemsWithoutProcurement.length > 0 ? (
                <p className={styles.totalBlocked} data-testid={`proc-order-noproc-${o.orderId}`}>
                  以下缺料项引擎<b>没有下发采购段分解</b>，因此答不出「该找谁」（不假装它们没缺）：
                  {o.itemsWithoutProcurement.join("、")}
                </p>
              ) : null}

              {o.items.length === 0 && o.itemsWithoutProcurement.length === 0 ? (
                <p className={styles.note} data-testid={`proc-order-nokit-${o.orderId}`}>
                  本单不缺料，无采购段可分解。
                </p>
              ) : null}
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
