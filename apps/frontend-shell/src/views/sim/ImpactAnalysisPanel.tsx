import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AffectedDecisionItem,
  AffectedKpiItem,
  AffectedObjectItem,
  AffectedProcessItem,
  ImpactAnalysisResponse,
  ImpactChange,
  ImpactDimensionUnavailable,
} from "@platform/contracts";
import { fetchSimSessions, runImpactAnalysis } from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";
import styles from "./ImpactAnalysisPanel.module.css";

/**
 * WO-BEFE-WIRE-3 · **影响传播分析**（`POST /a/v1/simulation/impact-analysis` 的前端消费方）。
 *
 * ── 它为什么存在 ─────────────────────────────────────────────────────────────
 * 后端 `WO-IMPACT-PROPAGATION` 早已落地（`apps/datacore/src/app.ts` 注册 · `sim/impact-analysis.ts` 实现），
 * 而 **2026-08-10 实测**（复验命令：`node scripts/check-backend-frontend-seam.mjs --verbose`）
 * 该端点在门 `befe-seam:check` 载体② 的「当前零调用端点明细」里赫然在列：**前端零调用方**。
 * 这正是本仓 `G-BE-FE-SEAM-DEAD`：后端开了口子没人用 ——「有端点无入口」。
 * 本组件把那个口子接到用户的手指上；接完同一条命令报「已修复」。
 *
 * ── 与隔壁那个按钮的区别（同一份假设，两个出口）──────────────────────────────
 * 宿主页（`views/WhatIfView.tsx`）已有一个「推演下游影响」按钮，走 `generic_inference` 求解器：
 * 它**没有世界**，且只给一个裸 `affectedObjects:number`。本组件走的是第四个出口：
 *  ① 跑在一个**被隔离的推演世界**里（`worldId` = `SimSession.id`）；
 *  ② 结果拆成四维（对象 / 流程 / 决策 / KPI），每一维都是 `available` 上的**判别联合**。
 *
 * ── 🔴 本组件的头号纪律：四个「0」不是同一个 0 ───────────────────────────────
 * 契约把三种事实分得清清楚楚，前端**不许**把它们塌回一个数字：
 *  · `available:false`     → 这一维**算不了**（平台今天没有承载物）→ 屏上显「算不了」+ 缺什么，**不是 0**；
 *  · `count:0, universe:0` → 台账是空的                        → 显 `0 / 共 0`；
 *  · `count:0, universe:N` → 查过了，确实没被波及                → 显 `0 / 共 N`。
 * 少了 `universe`，`0` 就是个歧义数字 —— 所以每张卡都必须把 `universe` 一起显出来。
 *
 * ── 信息分层（`docs/CONVENTION-ui-information-layering.md`）────────────────────
 *  · **第一层**只有数值 / 状态 / 名字：一个最大号的「受影响对象数」＋三张分项卡＋诚实位记号；
 *  · **第二层**（点一次）：各维明细表（对象逐条 before→after、流程、决策、KPI）；
 *  · **浮层**（`?`）：引擎口径（`ontology-core.recompute`）、`countBasis`、世界叠加了多少条、
 *    每一维的连接键、`available:false` 的原因原文。禁止用原生 `title` 当浮层（本仓出过滞留遮挡事故）。
 *  · 诚实位（warnings / 截断 / oldValue 不一致 / 算不了）**降层可以，删除不行**：
 *    第一层一律留一个可见记号（`.flag` 徽标），点开才看全文。
 *
 * ── 零写死（R14）───────────────────────────────────────────────────────────────
 * 屏上每一个数字、每一句原因、每一个类型名都来自这次响应的某个字段。
 * 本文件没有任何行业实体名，没有任何"默认值"回落 —— 后端没给的，屏上就诚实地说没有。
 */

// ── 判别联合的两半（契约同构，仅为本文件的窄化方便）────────────────────────────
interface DimAvailable<T> {
  available: true;
  count: number;
  universe: number;
  items: T[];
  truncated: boolean;
}
type Dim<T> = DimAvailable<T> | ImpactDimensionUnavailable;

const isAvailable = <T,>(d: Dim<T>): d is DimAvailable<T> => d.available;

/** 值展示：`undefined`/`null` → 「—」（诚实空，不写 0）；其余原样。 */
function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 浮层正文（口径 / 公式 / 诚实位说明 —— 规范 §1 规定它们不许待在第一层）
 * ═══════════════════════════════════════════════════════════════════════════ */

function BasisNote({ basis }: { basis: ImpactAnalysisResponse["basis"] }) {
  return (
    <span data-testid="impact-basis-note">
      传播引擎 <code>{basis.engine}</code>（全平台唯一那一份增量重算，本页不另算一套）。
      计数口径 <code>{basis.countBasis}</code> = 去重对象数，不是 delta 行数。
      <br />
      世界 <code>{basis.worldId}</code> · tick {basis.worldTick} · 状态 {basis.worldStatus}；
      世界态往克隆图上叠加了 <b>{basis.worldOverlayApplied}</b> 条（objectId × stateVar）。
      叠加 0 条 ⇒ 这次实质跑在真本体当前值上，<b>没有发生世界隔离</b>。
      <br />
      本体里参与传播的 ACTIVE 派生规格 <b>{basis.derivationSpecCount}</b> 条；为 0 时四维必空 ——
      那是「没有派生边可传」，不是「没影响」。
      {basis.observedOldValue === undefined ? null : (
        <>
          <br />
          世界里的真实旧值：<code>{fmtVal(basis.observedOldValue)}</code>
          {basis.oldValueMismatch ? "（与调用方声明的旧值不一致，仅如实标注，不影响计算）" : ""}
        </>
      )}
    </span>
  );
}

function HonestyNote({ warnings }: { warnings: string[] }) {
  return (
    <span data-testid="impact-warnings-note">
      下面每一条都是后端原文透传（前端不改写、不总结、不合并）：
      <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
        {warnings.map((w) => (
          <li key={w} style={{ marginBottom: 2 }}>
            {w}
          </li>
        ))}
      </ul>
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 一张分项卡（第一层只放：数值 · 状态 · 名字）
 * ═══════════════════════════════════════════════════════════════════════════ */

function DimensionCard<T>({
  dim,
  label,
  testId,
  caliber,
}: {
  dim: Dim<T>;
  label: string;
  testId: string;
  /** 进浮层的口径说明（连接键、全域是什么）。 */
  caliber: ReactNode;
}) {
  const ok = isAvailable(dim);
  return (
    <div
      className={`${styles.card} ${ok ? "" : styles.blocked}`}
      data-testid={`impact-dim-${testId}`}
      data-available={ok ? "1" : "0"}
    >
      <span className={styles.cardMain}>
        {ok ? (
          <>
            <b className={styles.cardNum} data-testid={`impact-count-${testId}`}>
              {dim.count}
            </b>
            <span className={styles.cardLabel}>{label}</span>
            {/* `universe` 与 `count` 必须同屏：少了它，`0` 分不清「台账空」与「没被波及」。 */}
            <span className={styles.meta} data-testid={`impact-universe-${testId}`}>
              / 共 {dim.universe}
            </span>
          </>
        ) : (
          <>
            {/* 诚实位：这一维**算不了**。绝不渲染成 0 —— 那是本仓最恨的静默错答。 */}
            <b className={styles.cardNum} data-testid={`impact-blocked-${testId}`}>
              算不了
            </b>
            <span className={styles.cardLabel}>{label}</span>
            <span className={styles.meta} data-testid={`impact-missing-${testId}`}>
              缺 {dim.missingCarrier}
            </span>
          </>
        )}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {ok && dim.truncated ? (
          <span className={styles.flag} data-testid={`impact-truncated-${testId}`}>
            明细已截断
          </span>
        ) : null}
        <InfoPopover topic={zh.sim.sandbox.info.impactDimension(label)} testId={`impact-${testId}`} align="right">
          <span data-testid={`impact-caliber-${testId}`}>
            {caliber}
            {ok ? (
              <>
                <br />
                计数 <b>{dim.count}</b> 是全量（不受明细上限截断影响）；本次带回明细 {dim.items.length} 条
                {dim.truncated ? "（已截断）" : ""}。
              </>
            ) : (
              <>
                <br />
                后端原文：{dim.reason}
              </>
            )}
          </span>
        </InfoPopover>
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 第二层：明细表（一次点击才出现 —— 逐项拆解不属于第一层）
 * ═══════════════════════════════════════════════════════════════════════════ */

function DetailTables({ res }: { res: ImpactAnalysisResponse }) {
  const objects = res.affectedObjects as DimAvailable<AffectedObjectItem>;
  const procs = res.affectedProcesses as Dim<AffectedProcessItem> & { instanceLevel?: ImpactDimensionUnavailable };
  const decisions = res.affectedDecisions as Dim<AffectedDecisionItem>;
  const kpis = res.affectedKpis as Dim<AffectedKpiItem>;

  return (
    <div className={styles.wrap} data-testid="impact-details">
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="impact-detail-objects">
          <thead>
            <tr>
              <th>受影响对象</th>
              <th>类型</th>
              <th>派生属性 before → after</th>
            </tr>
          </thead>
          <tbody>
            {objects.items.length === 0 ? (
              <tr>
                <td colSpan={3} className={styles.meta} data-testid="impact-detail-objects-empty">
                  本次传播闭包为空（明细 0 条）—— 口径见上面的 <b>?</b>，别当成「查不到」。
                </td>
              </tr>
            ) : (
              objects.items.map((o) => (
                <tr key={o.objectId} data-testid={`impact-object-${o.objectId}`}>
                  <td className="mono">{o.objectId}</td>
                  {/* 类型可能是空串：后端说不出来就照实留空，不拿 objectId 猜一个 */}
                  <td>{o.objectType === "" ? <span className={styles.meta}>（后端未回类型）</span> : o.objectType}</td>
                  <td className="mono">
                    {o.changedProps.length === 0 ? (
                      <span className={styles.meta}>在闭包内但值未变</span>
                    ) : (
                      o.changedProps.map((p) => (
                        <div key={p.prop} data-testid={`impact-object-prop-${o.objectId}-${p.prop}`}>
                          {p.prop}: {fmtVal(p.before)} → <b>{fmtVal(p.after)}</b>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isAvailable(kpis) && kpis.items.length > 0 ? (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="impact-detail-kpis">
            <thead>
              <tr>
                <th>受影响 KPI</th>
                <th>指标键</th>
                <th>越线</th>
              </tr>
            </thead>
            <tbody>
              {kpis.items.map((k) => (
                <tr key={k.objectId} data-testid={`impact-kpi-${k.objectId}`}>
                  <td>{k.name ?? <span className={styles.meta}>（对象上无 name）</span>}</td>
                  <td className="mono">{k.metricKey ?? <span className={styles.meta}>（无 key）</span>}</td>
                  {/* 三态照搬后端：UNKNOWN 绝不显示成"安全" —— 「没算出越线」≠「没越线」。 */}
                  <td data-testid={`impact-kpi-breach-${k.objectId}`}>{k.breach}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isAvailable(procs) && procs.items.length > 0 ? (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="impact-detail-processes">
            <thead>
              <tr>
                <th>受影响流程</th>
                <th>承载类型</th>
                <th>经由对象</th>
              </tr>
            </thead>
            <tbody>
              {procs.items.map((p) => (
                <tr key={p.processKey} data-testid={`impact-process-${p.processKey}`}>
                  <td>
                    <span className="mono">{p.processKey}</span> {p.name}
                  </td>
                  <td className="mono">{p.carrierTypeKey}</td>
                  <td className="mono">{p.viaObjectIds.join(" , ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isAvailable(decisions) && decisions.items.length > 0 ? (
        <div className={styles.scroll}>
          <table className={styles.table} data-testid="impact-detail-decisions">
            <thead>
              <tr>
                <th>受影响决策</th>
                <th>状态</th>
                <th>锚定指标</th>
                <th>已派行动</th>
              </tr>
            </thead>
            <tbody>
              {decisions.items.map((d) => (
                <tr key={d.decisionId} data-testid={`impact-decision-${d.decisionId}`}>
                  <td className="mono">{d.decisionId}</td>
                  <td>{d.status}</td>
                  <td className="mono">{d.metricKey}</td>
                  <td className="mono" data-testid={`impact-decision-drafts-${d.decisionId}`}>
                    {d.actionDraftCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 流程**实例**粒度：契约里恒为 available:false。降层到这里但绝不删 —— 少了它，
          definition 粒度的 count 会被读成「有 N 个流程实例被卡住」。 */}
      {procs.instanceLevel ? (
        <div className={styles.meta} data-testid="impact-process-instance-level">
          流程<b>实例</b>粒度：算不了（缺 {procs.instanceLevel.missingCarrier}）。{procs.instanceLevel.reason}
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 主组件
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * WO-SANDBOX-V3 · 两个**可选**入参，让本面板能被推演沙盘的下区（只读区）宿主。
 *
 * 判据 PRD §4.4：「主区与下区内**零输入控件**」。本面板原生自带两个输入
 * （世界 `<select>` + 「在世界里分析影响」`<button>`），直接搬进下区就破了这一条。
 * 故给宿主两把钥匙，**两个都不传 = 今天的行为逐字节不变**（`WhatIfView` 零回归）：
 *  · `worldId`  —— 世界由宿主定（沙盘就是"这个会话的世界"，让用户在下区再选一次世界，
 *                  等于允许他看着 A 世界的画布读 B 世界的影响，那是静默错答）；
 *                  给了就**不发** `fetchSimSessions`，也不渲染 `<select>`。
 *  · `autoRun`  —— 假设一变就自动跑，不渲染那个按钮。沙盘里的「假设」就是**已经施加的扰动**，
 *                  它已经发生了；再要用户点一次「分析影响」是让他为一件既成事实按确认键。
 *
 * ⚠ 两个都不传时 `worldsQ` 照发、`<select>`/`<button>` 照渲染 —— 这不是"顺手也改改宿主页"，
 *   而是本仓「默认值 = 今天的行为」的既有约定（同 `chrome="embedded"` 那一族）。
 */
export function ImpactAnalysisPanel({
  change,
  worldId: fixedWorldId,
  autoRun = false,
}: {
  change: ImpactChange | null;
  worldId?: string;
  autoRun?: boolean;
}) {
  const [worldId, setWorldId] = useState<string>("");
  const [res, setRes] = useState<ImpactAnalysisResponse | null>(null);
  const [err, setErr] = useState<{ code?: string; message?: string; requestId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openDetail, setOpenDetail] = useState(false);

  const hostControlsWorld = fixedWorldId !== undefined;
  // 可选世界 = 本租户的推演会话（栈 A）。**不写死任何 id**：没有会话就诚实说没有。
  // 宿主已经定了世界 ⇒ `enabled:false`：这一发请求的唯一用途是填那个 `<select>`，
  // 而 `<select>` 此时根本不渲染。发了就是白发（且会在沙盘首屏多一次往返）。
  const worldsQ = useQuery({
    queryKey: ["a", "sim-sessions", "impact-analysis"],
    queryFn: fetchSimSessions,
    enabled: !hostControlsWorld,
    retry: false,
    staleTime: 30_000,
  });
  const worlds = useMemo(() => worldsQ.data?.items ?? [], [worldsQ.data]);
  const effectiveWorld = hostControlsWorld
    ? fixedWorldId
    : worldId !== "" && worlds.some((w) => w.id === worldId)
      ? worldId
      : (worlds[0]?.id ?? "");

  // 假设一改，上一次的结论立刻作废 —— 留着它会让屏上的四维读起来像是新假设的结果。
  const changeKey = change === null ? "" : `${change.objectType}|${change.objectId}|${change.prop}|${String(change.value)}`;
  useEffect(() => {
    setRes(null);
    setErr(null);
    setOpenDetail(false);
  }, [changeKey, effectiveWorld]);

  const canRun = change !== null && effectiveWorld !== "" && !busy;

  const run = async (): Promise<void> => {
    if (change === null || effectiveWorld === "" || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await runImpactAnalysis({ worldId: effectiveWorld, change, limit: 200 }));
    } catch (e) {
      // 诚实错误块：只陈述响应里读得出的事实，不回落到任何"默认结果"。
      const x = e as { code?: string; message?: string; requestId?: string };
      setRes(null);
      setErr({ code: x?.code, message: x?.message, requestId: x?.requestId });
    } finally {
      setBusy(false);
    }
  };

  /**
   * `autoRun`：假设/世界一变就重跑一次。
   *
   * ⚠ 依赖数组用 `changeKey`（一个字符串）而不是 `change`（一个每次渲染都新建的对象）——
   *   用对象会让这个 effect 每渲染都跑一次，变成一个**自触发的请求循环**。
   *   `runRef` 拿到最新的闭包，effect 本身只依赖"假设变没变"这件事。
   */
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!autoRun || change === null || effectiveWorld === "") return;
    void runRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, changeKey, effectiveWorld]);

  return (
    <div className={styles.wrap} data-testid="impact-analysis">
      <div className={styles.form}>
        <span className={styles.meta}>推演世界</span>
        {hostControlsWorld ? (
          // 世界由宿主定：**读数仍在第一层**（哪个世界算出来的是结论的一部分，不许只写在浮层里），
          // 只是不再是一个可改的控件。
          <span className={styles.meta} data-testid="impact-world-fixed">
            {effectiveWorld}
          </span>
        ) : worldsQ.isLoading ? (
          <span className={styles.meta} data-testid="impact-worlds-loading">
            读取推演世界…
          </span>
        ) : worlds.length === 0 ? (
          // 诚实空：没有世界就没有世界。不提供一个点了会 404 的按钮。
          <span className={styles.meta} data-testid="impact-no-world">
            本租户还没有推演世界（`SimSession`）。影响传播必须跑在一个被隔离的世界里 ——
            先去推演沙盘建一个，再回来分析。
          </span>
        ) : (
          <select
            data-testid="impact-world-select"
            aria-label="影响传播的推演世界"
            value={effectiveWorld}
            onChange={(e) => setWorldId(e.target.value)}
          >
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.id} · tick {w.curTick} · {w.status}
              </option>
            ))}
          </select>
        )}
      </div>

      {autoRun ? (
        // 自动跑：按钮没了，但**"正在算 / 还没有假设"这两个态一个都不能少** ——
        // 少了它们，屏上会在请求飞行中一片空白，读者分不清"没影响"和"还没算完"。
        <span className={styles.meta} data-testid="impact-auto">
          {busy ? "分析中…" : zh.sim.sandbox.impact.autoNote}
        </span>
      ) : (
        <button
          className="btn sm primary"
          data-testid="impact-run"
          disabled={!canRun}
          onClick={() => void run()}
        >
          {busy ? "分析中…" : "在世界里分析影响"}
        </button>
      )}
      {change === null ? (
        <span className={styles.meta} data-testid="impact-need-change">
          {autoRun ? zh.sim.sandbox.impact.needPerturbation : "先在上面选定「对象类型 / 对象 / 属性 / 假设值」，这里才知道要传播哪一处变更。"}
        </span>
      ) : null}

      {err ? (
        <div className={styles.meta} data-testid="impact-error" style={{ color: "var(--warn-txt)" }}>
          影响传播分析失败（{err.code ?? "ERROR"}）：{err.message ?? "请求失败"}
          {err.requestId ? ` · requestId ${err.requestId}` : ""}
        </div>
      ) : null}

      {res ? (
        <>
          {/* ── 第一层 · 本面板要回答的那个数（唯一最大字号 · R-UI-2）────────── */}
          <div className={styles.head} data-testid="impact-head">
            <b className={styles.headNum} data-testid="impact-count-objects">
              {res.affectedObjects.count}
            </b>
            <span className={styles.headLabel}>
              个对象受影响
              <span className={styles.meta} data-testid="impact-universe-objects">
                / 共 {res.affectedObjects.universe}
              </span>
              <InfoPopover topic={zh.sim.sandbox.info.impactBasis} testId="impact-basis" align="right">
                <BasisNote basis={res.basis} />
              </InfoPopover>
              {/* 诚实位降层后第一层保留的可见记号 —— 静默降层等于删除。 */}
              {res.warnings.length > 0 ? (
                <span className={styles.flag} data-testid="impact-warning-flag">
                  ⚠ {res.warnings.length} 条口径提示
                  <InfoPopover topic={zh.sim.sandbox.info.impactHonesty} testId="impact-warnings" align="right">
                    <HonestyNote warnings={res.warnings} />
                  </InfoPopover>
                </span>
              ) : null}
              {res.basis.oldValueMismatch ? (
                <span className={styles.flag} data-testid="impact-oldvalue-mismatch">
                  ⚠ 旧值与世界不一致
                </span>
              ) : null}
              {res.affectedObjects.truncated ? (
                <span className={styles.flag} data-testid="impact-truncated-objects">
                  明细已截断
                </span>
              ) : null}
            </span>
          </div>

          {/* ── 结构：谁推出谁（规范 §3 —— 不看文字也要看得出递进）────────────
              对象 ─┬→ 流程（经 carrierTypeKey 命中）
                    └→ KPI（对象里的 KPI 承载类型）─→ 决策（锚在那些 KPI 上） */}
          <div className={styles.chain} data-testid="impact-chain">
            <div className={styles.branch}>
              <span className={styles.connector} aria-hidden="true" />
              <DimensionCard
                dim={res.affectedProcesses as Dim<AffectedProcessItem>}
                label="流程"
                testId="processes"
                caliber={
                  <>
                    连接键 = 流程定义的 <code>carrierTypeKey</code> ∩ 受影响对象的类型集合。
                    全域 = 本租户流程定义总条数。粒度是<b>定义</b>不是实例。
                  </>
                }
              />
            </div>
            <div className={styles.branch}>
              <span className={styles.connector} aria-hidden="true" />
              <DimensionCard
                dim={res.affectedKpis as Dim<AffectedKpiItem>}
                label="KPI"
                testId="kpis"
                caliber={
                  <>
                    承载判据是<b>结构性</b>的：同时具备 <code>target</code> 与 <code>actual</code> 两个属性的对象类型即承载 KPI
                    （不写死类型名，换行业自动跟着走）。本次判定为 KPI 承载类型：
                    <code>{res.basis.kpiTypeKeys.join(" , ") || "（无）"}</code>。
                  </>
                }
              />
            </div>
            <div className={`${styles.branch} ${styles.sub}`}>
              <span className={styles.connector} aria-hidden="true" />
              <DimensionCard
                dim={res.affectedDecisions as Dim<AffectedDecisionItem>}
                label="决策"
                testId="decisions"
                caliber={
                  <>
                    连接键 = 决策台账的锚定指标 ∩ 上面那批受影响 KPI 的 key —— 所以它是<b>从 KPI 推出来的</b>，
                    不与 KPI 并列。全域 = 本租户决策台账总条数。
                  </>
                }
              />
            </div>
          </div>

          {/* ── 第二层：明细（一次点击）──────────────────────────────────── */}
          <button
            className={`btn sm ghost ${styles.detailToggle}`}
            data-testid="impact-detail-toggle"
            aria-expanded={openDetail}
            onClick={() => setOpenDetail((v) => !v)}
          >
            {openDetail ? "▾ 收起明细" : "▸ 展开明细（逐条 before → after）"}
          </button>
          {openDetail ? <DetailTables res={res} /> : null}
        </>
      ) : null}
    </div>
  );
}

export default ImpactAnalysisPanel;
