import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  aggregateObjects,
  fetchDrillCatalog,
  fetchObjectTypes,
  fetchSimSessions,
  invokeSolver,
  searchObjects,
  simDrill,
} from "@/api/endpoints";
import type { DrillEvent, DrillEventSpec, DrillReport } from "@platform/contracts";
import { useActionDraft } from "./shared";
import styles from "./DecisionConsoleView.module.css";
import {
  collectHonesty,
  exposureTotals,
  nothingMovedText,
  orderedEvents,
  planCategoryOf,
  roundish,
  scrubSourceRefs,
  sortMitigations,
  splitImpediments,
  subjectIdFormFor,
  subjectIsRead,
  subjectScopeFor,
  targetIdOf,
  topCustomers,
  SUBJECT_FALLBACK,
  type BaseCard,
  type HonestyNote,
  type Mitigation,
  type SortKey,
} from "./decisionConsoleModel";

/**
 * WO-DECISION-CONSOLE · **经营决策者版**「加几件事，我算给你看」。
 *
 * ── 这一页是什么 ──────────────────────────────────────────────────────────────
 * **一页六区**（不是六个页面）：左栏 ① 加事情 + 唯一的那颗〔算一下〕；右栏 ②算的时候 /
 * ③钱 / ③b 客户与订单 / ④哪儿会出事 / ⑤有几条路。任一区改东西，其余区当场跟着变、位置不丢。
 *
 * ── 屏上不出现的词（整条主线）─────────────────────────────────────────────────
 * `扰动 / 推演 / 传导 / 世界 / 拍 / tick / 张力 / 敞口 / 落点 / 求解器 / 状态变量`。
 * 「拍」一律写「天」（实测本租户所有会话 `tickDays: 1`）。
 * 公式 / 口径 / 机器编号 / 规则码 / 源码文件名行号一律进第二层（R-UI-4）。
 *
 * ── 开工前的实测复现（派单第 0 段要求的「今天的行为是 X，应该是 Y」）────────────
 * 起真 datacore（seed 42 · demo 租户 · 内存模式 · 端口 4131）逐条跑过。**与规格给的
 * 前提冲突的，一律以实测为准**，冲突点在下面各自的位置点名。摘要：
 *
 *  · **X**：今天「施加扰动」与「推进 tick」是两颗按钮，不点第二颗钱一分不动。
 *    **Y**：只有〔算一下〕一颗，它自己把事情 → 30 天 → 卡点 → 客户 → 方案全走完
 *    （实测一次 `POST …/drill` 1.76 秒，零 LLM）。
 *  · **X**：主体选择器是「筛选（共 11337 个落点）」一个下拉。
 *    **Y**：按事件类型限定范围 —— 客户 20 / 型号 6 / 物料 8 / 基地 13 / 每基地产线 10 /
 *    需求段 3（全部实测 `objects/aggregate` count），订单 **500** 走搜索。
 *    **任何一个下拉不超过 20 行。**
 *  · **X**：三个金额在页面纵向 y≈3,666px。**Y**：钱在右栏第一屏。
 *  · **X**：卡点 17/18 条并排、每条都挂「查看方案对比」。
 *    **Y**：分两栏 —— 实测 18 条里只有 4 条有候选，且严重度前三（100/100/34）全是 0 条。
 *
 * ── 规格里**实测已过期**的前提（照做会写出错的屏）─────────────────────────────
 *  1. `UX-mainline-screens.md §2④`「最早第 14 天 · 第 14 天前动手后面七张全躲得过」——
 *     实测窗内最早到期是**第 2 天**（`SO-900487`），且 `otdBatch.rate = 0`（53 张全逾期、
 *     准时 0 张）⇒ 「第 14 天之前动手」今天一张都救不了。本页因此**不写那句结论**，
 *     只画顺序线，让日期自己说话。
 *  2. 「17 处卡点」→ 实测 **18**；「常州超红线 67%」→ 实测 **超 110%**（severity 封顶 100，
 *     枣庄同样封顶）；「264 天」→ 实测 **740.31**；「能动的第 4 处是武汉」→
 *     **武汉今天 0 候选**（真正带候选的四条是 `MaterialBatch/pos_lfp_b2` ·
 *     `MaterialBalance/磷酸铁锂正极` · `Line/金华分切线` · `Line/自贡分容线`）。
 *     ⇒ 屏上这些数**一个都不写死**，全部现读。
 *  3. 「三处基地敞口 `status=EMPTY` 绝不许显示成 0 亿」—— 实测**今天 8/8 全是 `OK`**
 *     （江门/邯郸/自贡扩容后都有单了）。空态规则**代码里保留**（换真数据还会出现），
 *     但今天走不到那条分支。
 *  4. 「今天扫出 43,468 条结论」—— 那是 11,348 对象那个世界的数；本租户种子世界
 *     （4,814 对象）实测一次演习 **775 条**（卡点 383 · 堵点 24 · 脆弱点 368）。
 *     ⇒ 屏上只写回包自陈的那个数，不写死量级。
 *  5. 派单表把「订单改价」归到「客户 + 型号」—— 实测该事件主路由 `order_fullchain`
 *     的 `so` 是必填且取自主体，传客户 id 回「order … not found」⇒ 已改回订单搜索。
 *  6. 派单说「卡点自带类别 ⇒ 类别层的 join 是真实存在的」—— 实测 `chain_impediments`
 *     **没有 category 字段**；真 join 在基地卡的 `factor` 上（8/8 命中方案库的键），
 *     且后端 `adopt_mitigation` 的必填参就是 `{base, factor, planKey}`。详见
 *     `decisionConsoleModel.ts` 文件头 §4。
 *
 * ── 钱这一段为什么是降级形态（仓主已裁决）───────────────────────────────────
 * 两条独立的实测，任一条成立都不许把毛利绝对值放到屏幕正中：
 *  ① `finance_world_projection` 在**零事件**、世界态「逐项相等」时就回
 *     `毛利 118.9 → -3272.25`（`销售成本 581.1 ×（1 + 583.57 ÷ 100）`）——
 *     42 条传导规则今天 `clamp:null · decay:null · combine:"sum"`，压力无上界逐日累加。
 *  ② 更要命的一条（本单实测新发现）：演习是**只读**的（`persist:false`），它推出来的
 *     那 30 天**不落盘**；而财务投影只会读会话**已落盘**的那一天。
 *     ⇒ 「你刚加的这两件事让毛利差多少」这一格，今天**根本没有数据源**，
 *     不是「算出来不准」，是「没有那条线」。
 * 故 ③ 区：毛利/多花的成本/少收的钱三行一律**删除线 + 一句话 + 点开给原文**，
 * ⛔ 不填 0、不写「无变化」、不留空白卡；而把**真的能算出来**的那两样放大：
 * 供需缺口的双向归因（引擎自陈「勾稽通过」）与冲击回执（这次到底打上没打上）。
 */

// ── 常量（屏上文案的单一出处，不散落）──────────────────────────────────────
const HORIZON_DAYS = 30;
/** 超过这么久还没回来就把已用秒数打在屏上（⛔ 不许无限转圈不给秒数）。 */
const SLOW_AFTER_MS = 10_000;
/** 实测一次全链 1.76–2.5 秒，屏上照这个说「通常 3 秒」。 */
const TYPICAL_SECONDS = 3;
const TOP_CUSTOMERS = 6;

type SolverData = Record<string, unknown>;

interface AddedEvent {
  uid: string;
  kind: string;
  /** 喂给后端的主体 id（对象 id 或业务键，见 `subjectIdFormFor`）。 */
  targetObjectId: string;
  /** 屏上显示的主体名。 */
  targetLabel: string;
  payload: Record<string, number | string>;
  effectiveDay: number;
  durationDays: number | null;
}

interface RunResult {
  report: DrillReport;
  risk: SolverData | null;
  impediments: SolverData | null;
  finance: SolverData | null;
  customers: { props: Record<string, unknown> }[];
  /** 本体类型键 → 中文业务名（后端单源 `displayName`；前端不内联映射表）。 */
  typeName: Map<string, string>;
  custAgg: { group: Record<string, string | null>; metrics: Record<string, number | null> }[];
  statusAgg: { group: Record<string, string | null>; metrics: Record<string, number | null> }[];
  bookValue: number;
  /** 这一批结果是哪一份输入算出来的（用来判「你改了但没重算」）。 */
  inputFingerprint: string;
}

/** 输入指纹 —— 改了 ① 而没重算时，结果区要整体压灰。 */
function fingerprintOf(events: AddedEvent[]): string {
  return JSON.stringify(
    events.map((e) => [e.kind, e.targetObjectId, e.payload, e.effectiveDay, e.durationDays]),
  );
}

/** 「估」角标：推演投影非实测。 */
function Est() {
  return (
    <span className={styles.est} title="这个数是算出来的，不是量出来的">
      估
    </span>
  );
}

/**
 * 引擎原文的**唯一渲染出口**。
 *
 * 一处收口的理由：原文里可能带源码文件名/行号，而 R-UI-4 明令禁止把它们打在用户屏上；
 * 但诚实位又「绝不允许删除」。所以这里**只**隐去源码坐标、其余一字不改，
 * 并且**替换发生时在屏上说一句** —— 静默替换等于篡改原文，比不替换更糟。
 */
function Raw({ text }: { text: string }) {
  const scrubbed = scrubSourceRefs(text);
  return (
    <span className={styles.raw}>
      {scrubbed}
      {scrubbed !== text ? "\n（上面这段是引擎原话，只隐去了源码文件名与行号，其余一字未改。）" : ""}
    </span>
  );
}

/** 「这次没算」：删除线 + 一句话 + 点开给原文。⛔ 不是 0、不是「无变化」、不是空白。 */
function Absent({ label, why, raw }: { label: string; why: string; raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.moneyRow}>
      <span className={styles.moneyLabel}>{label}</span>
      <span className={styles.absent}>——————</span>
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={styles.absentWhy}>{why}</span> {open ? "▾" : "▸"}
      </button>
      {open ? <Raw text={raw} /> : null}
    </div>
  );
}

export default function DecisionConsoleView() {
  // ── 数据：事件目录（**唯一真相源**，前端一行清单都不写死）──────────────────
  const catalog = useQuery({ queryKey: ["decision-console", "drill-catalog"], queryFn: fetchDrillCatalog });
  const sessions = useQuery({ queryKey: ["decision-console", "sim-sessions"], queryFn: fetchSimSessions });
  const sessionId = sessions.data?.items?.[0]?.id ?? null;

  const specs: DrillEventSpec[] = useMemo(() => catalog.data?.specs ?? [], [catalog.data]);
  const specsByKind = useMemo(() => new Map(specs.map((s) => [s.kind as string, s])), [specs]);

  // ── 区① 状态 ────────────────────────────────────────────────────────────
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedEvent[]>([]);
  const [notAvailableOpen, setNotAvailableOpen] = useState(false);

  // ── 结果 ────────────────────────────────────────────────────────────────
  const [result, setResult] = useState<RunResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("tn");
  const [footerOpen, setFooterOpen] = useState(false);
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const startedAt = useRef<number>(0);

  const adopt = useActionDraft();

  const run = useMutation({
    mutationFn: async (): Promise<RunResult> => {
      if (!sessionId) throw new Error("这个租户还没有可用的算例，先在别处建一个再回来。");
      const events: DrillEvent[] = added.map((e) => ({
        kind: e.kind as DrillEvent["kind"],
        targetObjectId: e.targetObjectId,
        payload: e.payload,
        effectiveDay: e.effectiveDay,
      }));
      // 一颗按钮把五件事全做完 —— 用户不该去找第二颗。
      const [report, risk, impediments, finance, customers, custAgg, statusAgg, types] = await Promise.all([
        simDrill(sessionId, { events, horizonDays: HORIZON_DAYS, limitPerKind: 50 }),
        invokeSolver("risk_timeline", {}).then((r) => r.data as SolverData).catch(() => null),
        invokeSolver("chain_impediments", { scope: {} }).then((r) => r.data as SolverData).catch(() => null),
        invokeSolver("finance_world_projection", { worldId: sessionId }).then((r) => r.data as SolverData).catch(() => null),
        searchObjects("Customer", "", { pageSize: "50" }).then((p) => p.items).catch(() => []),
        aggregateObjects({ typeKey: "Order", groupBy: ["cust"], metrics: [{ fn: "count", prop: "so" }, { fn: "sum", prop: "value" }] })
          .then((r) => r.rows)
          .catch(() => []),
        aggregateObjects({ typeKey: "Order", groupBy: ["status"], metrics: [{ fn: "count", prop: "so" }, { fn: "sum", prop: "value" }] })
          .then((r) => r.rows)
          .catch(() => []),
        fetchObjectTypes().catch(() => []),
      ]);
      const bookValue = statusAgg.reduce((a, r) => a + (r.metrics.sum_value ?? 0), 0);
      const typeName = new Map(types.map((t) => [t.key, t.displayName]));
      return { report, risk, impediments, finance, customers, custAgg, statusAgg, bookValue, typeName, inputFingerprint: fingerprintOf(added) };
    },
    onSuccess: (r) => {
      setResult(r);
      setConfirmText(null);
      const cards = cardsOf(r.risk);
      setSelectedBaseId((prev) => prev ?? cards.slice().sort((a, b) => b.revenueYi - a.revenueYi)[0]?.baseId ?? null);
    },
  });

  // 已用秒数（超 10 秒必须把秒数打在屏上）。
  useEffect(() => {
    if (!run.isPending) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => window.clearInterval(t);
  }, [run.isPending]);

  const stale = result !== null && result.inputFingerprint !== fingerprintOf(added);

  const addEvent = useCallback((e: AddedEvent) => {
    setAdded((prev) => [...prev, e]);
    setOpenKind(null);
  }, []);

  // ── 派生 ────────────────────────────────────────────────────────────────
  const cards = useMemo(() => cardsOf(result?.risk ?? null), [result]);
  const totals = useMemo(() => exposureTotals(cards), [cards]);
  const imp = useMemo(() => splitImpediments(result?.impediments ?? null, result?.typeName), [result]);
  const otdRows = useMemo(() => {
    const b = (result?.risk as { otdBatch?: { rows?: unknown[] } } | null)?.otdBatch;
    return (b?.rows ?? []) as { so: string; dueDay: number; delayDays: number; onTime: boolean }[];
  }, [result]);
  const otd = (result?.risk as { otdBatch?: { total?: number; onTimeCount?: number; rate?: number } } | null)?.otdBatch ?? null;
  const timeline = useMemo(
    () => (result ? orderedEvents(result.report.findings, otdRows, HORIZON_DAYS) : []),
    [result, otdRows],
  );
  const library = useMemo(
    () => ((result?.risk as { mitigationLibrary?: Record<string, Mitigation[]> } | null)?.mitigationLibrary ?? {}),
    [result],
  );
  const selectedCard = cards.find((c) => c.baseId === selectedBaseId) ?? null;
  const planCategory = planCategoryOf(selectedCard, library);
  const plans = planCategory ? sortMitigations(library[planCategory] ?? [], sortKey) : [];
  const custRows = useMemo(
    () => (result ? topCustomers(result.custAgg, result.customers, result.bookValue, TOP_CUSTOMERS) : []),
    [result],
  );
  const financeNotes = ((result?.finance as { notes?: string[] } | null)?.notes ?? []) as string[];
  const honesty: HonestyNote[] = useMemo(
    () =>
      result
        ? collectHonesty({
            report: result.report,
            specsByKind,
            impedimentsRaw: result.impediments,
            financeNotes,
            riskDataMode: (result.risk as { dataMode?: string } | null)?.dataMode ?? null,
          })
        : [],
    [result, specsByKind, financeNotes],
  );
  const gapFinding = result?.report.findings.find((f) => f.source.solverKey === "supply_demand_gap_attribution") ?? null;
  const nothingMoved = nothingMovedText(result?.report ?? null);

  // ── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page} data-testid="decision-console">
      {/*
       * 键盘跳转链接（WAI-ARIA 标准做法，**不是**把 DOM 顺序拧成与视觉不一致）。
       * 实测：左栏 11 条模板 × 2 个可聚焦控件 + 壳导航 ⇒ 从页顶按到〔算一下〕要 **107 次**。
       * 有这一条：进本页后第一次 Tab 就能拿到它。
       */}
      <button
        type="button"
        className={styles.skip}
        onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="dc-go"]')?.focus()}
      >
        跳到〔算一下〕
      </button>
      {/* ══ 左栏 · 区① 加几件事 + 唯一的那颗按钮 ══════════════════════════ */}
      <div className={styles.left}>
        <div className={styles.leftScroll}>
          <section className="panel" id="z1" aria-label="加几件事">
            <h2 className={styles.zoneTitle}>
              加一件或几件事，我算给你看
              <span className={styles.zoneHint}>往后 {HORIZON_DAYS} 天</span>
            </h2>
            {catalog.isLoading ? <p className={styles.greyLine}>正在取事情清单…</p> : null}
            {catalog.isError ? (
              <p className={styles.err}>事情清单取不回来，这一格今天用不了。{String(catalog.error)}</p>
            ) : null}
            {specs.map((spec) => (
              <TemplateRow
                key={spec.kind}
                spec={spec}
                open={openKind === spec.kind}
                onToggle={() => setOpenKind((k) => (k === spec.kind ? null : spec.kind))}
                onAdd={addEvent}
              />
            ))}
          </section>

          {added.length > 0 ? (
            <section className="panel" aria-label="已经加了哪些事">
              <h2 className={styles.zoneTitle}>已经加了 {added.length} 件事</h2>
              <div className={styles.added}>
                {added.map((e, i) => {
                  const spec = specsByKind.get(e.kind);
                  const numKey = Object.keys(e.payload).find((k) => typeof e.payload[k] === "number");
                  return (
                    <div className={styles.addedItem} key={e.uid}>
                      <span className={styles.addedText}>
                        {spec?.label ?? e.kind} · {e.targetLabel}
                        {e.effectiveDay > 0 ? ` · 第 ${e.effectiveDay} 天起` : ""}
                        {spec && !subjectIsRead(spec) ? (
                          <>
                            <br />
                            <span className={styles.greyLine}>
                              这类事今天不看你选的是谁，它只决定去问哪几路算
                            </span>
                          </>
                        ) : null}
                      </span>
                      {numKey ? (
                        <input
                          className={styles.addedNum}
                          type="number"
                          aria-label={`改「${spec?.label ?? e.kind}」的数`}
                          value={String(e.payload[numKey])}
                          onChange={(ev) => {
                            const v = Number(ev.target.value);
                            setAdded((prev) =>
                              prev.map((x, xi) => (xi === i ? { ...x, payload: { ...x.payload, [numKey]: v } } : x)),
                            );
                          }}
                        />
                      ) : null}
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`删掉「${spec?.label ?? e.kind}」`}
                        onClick={() => setAdded((prev) => prev.filter((_, xi) => xi !== i))}
                      >
                        删
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className={styles.greyLine}>还没加任何事。加一件，我算给你看。</p>
          )}

          <div className={styles.greyLine}>
            <button type="button" className={styles.footerBtn} onClick={() => setNotAvailableOpen((v) => !v)} aria-expanded={notAvailableOpen}>
              还有一些事这里试不了 {notAvailableOpen ? "▾" : "▸"}
            </button>
            {notAvailableOpen ? (
              <div className={styles.drawer}>
                <div className={styles.drawerItem}>
                  上面这 {specs.length} 件是今天真的能算的全部（清单现读后台，后台加一件这里就多一件，
                  不是这里写死的）。除此之外的事 —— 比如「换一家供应商」「汇率变了」「限电」——
                  今天没有对应的算法可问，摆上来就是一个选了没反应的选项。
                </div>
                {specs.map((s) => (
                  <div className={styles.drawerItem} key={s.kind}>
                    · {s.label}
                    {s.stateEffect ? "（这件事会真的打到数上）" : subjectIsRead(s) ? "（这件事会把你选的那个主体喂给算法）" : "（这件事只决定去问哪几路算）"}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* 整屏最亮的只有它，且只有它。⛔ 没有第二颗按钮。 */}
        <div className={styles.goWrap}>
          <button
            type="button"
            className={styles.go}
            data-testid="dc-go"
            disabled={run.isPending || added.length === 0 || !sessionId}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "正在算…" : "算一下"}
          </button>
          {added.length === 0 ? <p className={styles.greyLine}>先加一件事，这颗按钮才有事可算。</p> : null}
          {!sessionId && !sessions.isLoading ? (
            <p className={styles.err}>这个租户还没有可用的算例，这一页今天算不了。</p>
          ) : null}
        </div>
      </div>

      {/* ══ 右栏 ═══════════════════════════════════════════════════════════ */}
      <div className={styles.right}>
        {/* 区② 算的时候：什么都不给，只一行 + 进度条 */}
        {run.isPending ? (
          <section className="panel" id="z2" aria-label="正在算">
            <div className={styles.computing}>
              <div className={styles.computingText}>
                {elapsed > SLOW_AFTER_MS
                  ? `还在算（已经 ${Math.round(elapsed / 1000)} 秒，通常 ${TYPICAL_SECONDS} 秒）`
                  : `正在算未来 ${HORIZON_DAYS} 天…`}
              </div>
              <div className={styles.bar}>
                <div className={styles.barFill} />
              </div>
            </div>
          </section>
        ) : null}

        {run.isError && !run.isPending ? (
          <section className="panel" aria-label="没算成">
            <p className={styles.err}>
              这次没算成，你刚才加的 {added.length} 件事还在，再按一次〔算一下〕。
              <br />
              <Raw text={String(run.error)} />
            </p>
          </section>
        ) : null}

        {result && !run.isPending ? (
          <>
            {stale ? (
              <div className={styles.staleBar} data-testid="dc-stale">
                你改了左边的输入，下面这些还是上一次算的。
                <button type="button" className={styles.sortBtn} onClick={() => run.mutate()}>
                  重算
                </button>
              </div>
            ) : null}

            <div className={stale ? styles.stale : undefined}>
              {/* ══ 区③ 钱上差多少 ══════════════════════════════════════ */}
              <section className="panel" id="z3" aria-label="钱上差多少">
                <div className={styles.moneyHead}>
                  这 {added.length} 件事凑一块，往后 {result.report.horizonDays} 天
                </div>

                {gapFinding ? (
                  <>
                    <div className={styles.bigNum} data-testid="dc-money">
                      {bigGapOf(gapFinding.evidence)}
                      <span className={styles.bigUnit}>万套 产销缺口</span>
                      <Est />
                    </div>
                    <div className={styles.bigCaption}>{oneLineCause(gapFinding.evidence)}</div>
                    <ReconcileEntry finding={gapFinding} />
                  </>
                ) : (
                  <div className={styles.bigCaption}>这次没有一路算回来产销缺口。</div>
                )}

                <div className={styles.moneyRows}>
                  {/* 三行钱一律降级：⛔ 不填 0、不写「无变化」、不留空白卡 */}
                  <Absent
                    label="毛利差多少"
                    why="这次算不出来"
                    raw={
                      "两条独立的原因，任一条成立这一格就没有数据源：\n" +
                      "① 这次的算是只读的，它算出来的那 30 天不留下来；而财务那一路只会读这次算例已经存下来的那一天 —— 「你刚加的这几件事之后毛利是多少」今天没有那条线。\n" +
                      "② 就算读得到，那个数今天也是坏的：一件事都不加、逐项相等时它就已经回「毛利 118.9 → " +
                      (financeMargin(result.finance) ?? "（本次未取到）") +
                      "」——那条换算链上的 42 条规则今天既没有上界也没有衰减，压力逐日累加。\n" +
                      "引擎原话：" +
                      (financeBasisNote(result.finance) ?? "（本次未取到）")
                    }
                  />
                  <Absent
                    label="多花的成本"
                    why="这次算不出来"
                    raw={"同上：这一行与毛利同源（基线 ×（1 + 压力 ÷ 100）），这次算出来的那 30 天不留下来 ⇒ 取不到本次的值。"}
                  />
                  <Absent
                    label="少收的钱"
                    why="这次算不出来"
                    raw={
                      financeNotes[0] ??
                      "需求侧与收入行之间今天没有换算关系；凭空折算一个系数就是引擎自己发明一个数。"
                    }
                  />
                </div>

                {/* 能算出来的那一样：这次到底打上没打上 */}
                <div className={styles.split}>
                  {result.report.appliedStateEffects.length === 0 ? (
                    <div className={styles.splitCell}>
                      <div className={styles.splitVal}>0 / {added.length}</div>
                      <div className={styles.splitLabel}>
                        你加的事里，没有一件会直接改数 —— 它们只决定去问哪几路算。这不是「没影响」。
                      </div>
                    </div>
                  ) : (
                    result.report.appliedStateEffects.map((e) => (
                      <div className={styles.splitCell} key={`${e.eventKind}-${e.targetObjectId}`}>
                        <div className={styles.splitVal} style={{ color: e.applied ? undefined : "var(--danger-txt)" }}>
                          {e.applied ? "已生效" : "没打上"}
                        </div>
                        <div className={styles.splitLabel}>
                          {specsByKind.get(e.eventKind)?.label ?? e.eventKind} · {e.magnitude > 0 ? "+" : ""}
                          {e.magnitude}
                          {e.applied ? "，第 " + Math.max(1, e.startTick - (result.report.ticks - result.report.horizonDays)) + " 天开始起作用" : "，所以下面的结论里不含这件事"}
                        </div>
                      </div>
                    ))
                  )}
                  <div className={styles.splitCell}>
                    <div className={styles.splitVal}>
                      {result.report.solverRuns.filter((r) => r.ok).length} / {result.report.solverRuns.length}
                    </div>
                    <div className={styles.splitLabel}>
                      这次问了 {result.report.solverRuns.length} 路算，
                      {result.report.solverRuns.filter((r) => !r.ok).length > 0
                        ? `有 ${result.report.solverRuns.filter((r) => !r.ok).length} 路没跑通（在页脚点开看原文）`
                        : "全部跑通"}
                    </div>
                  </div>
                </div>

                {nothingMoved ? <p className={styles.greyLine}>{nothingMoved}</p> : null}
              </section>

              {/* ══ 区③b 客户与订单 ══════════════════════════════════════ */}
              <section className="panel" id="z3b" aria-label="客户与订单">
                <h2 className={styles.zoneTitle}>
                  客户与订单
                  <span className={styles.zoneHint}>
                    这 {HORIZON_DAYS} 天里，{totals.orderCount} 张单牵涉 {roundish(totals.dedupedYi)} 亿、
                    {totals.customerCount} 家客户
                  </span>
                </h2>
                <p className={styles.greyLine}>
                  含跨基地订单，各基地不可直接相加（相加会得到 {roundish(totals.naiveSumYi)} 亿，
                  同一张单被算了两次）。
                </p>

                {otd ? (
                  <p className={styles.countLine}>
                    这些单里，会晚的 <strong>{(otd.total ?? 0) - (otd.onTimeCount ?? 0)}</strong> 张、
                    准时的 <strong>{otd.onTimeCount ?? 0}</strong> 张
                    <Est />
                  </p>
                ) : null}

                <SegmentBar rows={result.statusAgg} />

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>客户</th>
                        <th className={styles.num}>张数</th>
                        <th className={styles.num}>金额（亿）</th>
                        <th className={styles.num}>占订单簿</th>
                        <th className={styles.num}>应收（万）</th>
                        <th className={styles.num}>额度（万）</th>
                        <th className={styles.num}>最长逾期</th>
                        <th>要留意</th>
                      </tr>
                    </thead>
                    <tbody>
                      {custRows.map((c) => (
                        <tr key={c.custId}>
                          <td>{c.custName}</td>
                          <td className={styles.num}>{c.orderCount}</td>
                          <td className={styles.num}>{c.valueYi.toFixed(1)}</td>
                          <td className={styles.num}>{c.sharePct.toFixed(1)}%</td>
                          <td className={`${styles.num} ${c.overCredit ? styles.flagBad : ""}`}>
                            {c.receivablesWan.toLocaleString("zh-CN")}
                          </td>
                          <td className={styles.num}>{c.creditLimitWan.toLocaleString("zh-CN")}</td>
                          <td className={`${styles.num} ${c.maxOverdueDays >= 30 ? styles.flagWarn : ""}`}>
                            {c.maxOverdueDays} 天
                          </td>
                          <td className={c.overCredit ? styles.flagBad : ""}>
                            {c.overCredit ? "应收已超过给他的额度" : c.maxOverdueDays >= 30 ? "有单子拖过一个月" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ══ 区④ 哪儿会出事 ══════════════════════════════════════ */}
              <section className="panel" id="z4" aria-label="哪儿会出事">
                <h2 className={styles.zoneTitle}>
                  哪儿会出事
                  <span className={styles.zoneHint}>一共看了 {imp.total} 处</span>
                </h2>
                <div className={styles.twoCol}>
                  <div>
                    <div className={styles.colHead}>能动的 {imp.actionable.length} 处</div>
                    {imp.actionable.length === 0 ? (
                      <p className={styles.greyLine}>
                        {imp.total} 处卡住的地方，今天一处对策也给不出 —— 这本身是结论。
                      </p>
                    ) : (
                      imp.actionable.map((r) => (
                        <button
                          type="button"
                          key={r.impedimentId}
                          className={styles.impRow}
                          aria-pressed={false}
                          onClick={() => {
                            const base = baseOfImpediment(r.objectType, r.objectId, cards, result.risk);
                            if (base) setSelectedBaseId(base);
                            document.getElementById("z5")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          {r.sentence}
                          <br />
                          <span className={styles.impWays}>有 {r.candidateCount} 种改法 ▸</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div>
                    <div className={styles.colHead}>只能盯着的 {imp.watchOnly.length} 处</div>
                    {imp.watchOnly.length === 0 ? (
                      <p className={styles.greyLine}>没有「只能盯着」的地方。</p>
                    ) : (
                      <WatchOnly rows={imp.watchOnly} />
                    )}
                  </div>
                </div>

                <div className={styles.timeline}>
                  <div className={styles.colHead}>这 {HORIZON_DAYS} 天，事情按这个顺序发生</div>
                  {timeline.length === 0 ? (
                    <p className={styles.greyLine}>
                      这 {HORIZON_DAYS} 天里没有排得出日子的事 —— 不是「没有事」，是这一批结论都没带日子。
                    </p>
                  ) : (
                    timeline.slice(0, 12).map((t) => (
                      <div className={styles.tlRow} key={`${t.day}-${t.text}`}>
                        <span className={styles.tlDay}>第 {t.day} 天</span>
                        <span>
                          {t.text}
                          {t.estimated ? <Est /> : null}
                        </span>
                      </div>
                    ))
                  )}
                  {timeline.length > 12 ? (
                    <p className={styles.greyLine}>还有 {timeline.length - 12} 件，都在这 {HORIZON_DAYS} 天里。</p>
                  ) : null}
                </div>
              </section>

              {/* ══ 区⑤ 有几条路 ════════════════════════════════════════ */}
              <section className="panel" id="z5" aria-label="有几条路">
                <h2 className={styles.zoneTitle}>
                  有几条路
                  <span className={styles.zoneHint}>
                    {selectedCard ? `${selectedCard.baseName} · 这里最紧的是「${selectedCard.factor}」` : "先选一个地方"}
                  </span>
                </h2>

                <div className={styles.sortBar}>
                  <span>看哪个地方：</span>
                  {cards
                    .slice()
                    .sort((a, b) => b.revenueYi - a.revenueYi)
                    .map((c) => (
                      <button
                        type="button"
                        key={c.baseId}
                        className={styles.sortBtn}
                        aria-pressed={c.baseId === selectedBaseId}
                        onClick={() => setSelectedBaseId(c.baseId)}
                      >
                        {c.baseName}
                      </button>
                    ))}
                </div>

                <div className={styles.sortBar}>
                  <span>按什么排：</span>
                  {(["tn", "cost", "risk"] as SortKey[]).map((k) => (
                    <button
                      type="button"
                      key={k}
                      className={styles.sortBtn}
                      aria-pressed={sortKey === k}
                      onClick={() => setSortKey(k)}
                    >
                      {k === "tn" ? "多久见效" : k === "cost" ? "代价" : "风险"}
                    </button>
                  ))}
                  <span>系统不给推荐</span>
                </div>

                {/*
                 * 成色说明**一屏只出现一次**。上一版把它印在每张卡上 ——
                 * 那正是 §3.0 点名的病（同一段话一屏重复 5 遍，卡上数字 3 行、这段话 12 行）。
                 * 内容一个字不删，只换位置。
                 */}
                {planCategory === null ? (
                  <p className={styles.greyLine}>
                    这个地方今天对不上任何一类现成打法（打法库是按「这里最紧的是什么」分类的），
                    所以这里只摆「什么都不做」那一栏。
                  </p>
                ) : (
                  <p className={styles.greyLine}>
                    下面三条的「多久见效 / 代价 / 风险」是「{planCategory}」这一类的通用档位
                    <Est />，不是这一次的试算 —— 这次真试算出来的那几条改法身上，代价 / 见效天 / 风险
                    <span className={styles.absent}>一个都没有</span>。
                  </p>
                )}

                <div className={styles.plans} data-testid="dc-plans">
                  {plans.map((m) => (
                    <div className={styles.planCard} key={m.key}>
                      <div className={styles.planName}>{m.name}</div>
                      <div className={styles.planDims}>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>多久见效</span>
                          <span className={styles.planDimV}>
                            {m.tn} 天
                            <Est />
                          </span>
                        </div>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>代价</span>
                          <span className={styles.planDimV}>
                            {m.cost}
                            <Est />
                          </span>
                        </div>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>风险</span>
                          <span className={styles.planDimV}>
                            {m.risk}
                            <Est />
                          </span>
                        </div>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>这次能保住哪几张单</span>
                          <span className={styles.absent}>———</span>
                        </div>
                      </div>
                      <div className={styles.planFoot}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={adopt.isPending || !selectedCard}
                          onClick={() => {
                            if (!selectedCard || !planCategory) return;
                            adopt.mutate({
                              actionTypeKey: "adopt_mitigation",
                              payload: { base: selectedCard.baseId, factor: planCategory, planKey: m.key },
                            });
                            setConfirmText(
                              `已经生成一份待批的动作（${selectedCard.baseName} · ${m.name}），批了才会改真实数据。`,
                            );
                          }}
                        >
                          就这么办
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* 第四栏 · 什么都不做：占一整栏、双线框、**没有按钮** */}
                  <div className={`${styles.planCard} ${styles.doNothing}`} data-testid="dc-do-nothing">
                    <div className={styles.planName}>什么都不做</div>
                    <div className={styles.planDims}>
                      <div className={styles.planDim}>
                        <span className={styles.planDimK}>多久见效</span>
                        <span className={styles.absent}>——</span>
                      </div>
                      <div className={styles.planDim}>
                        <span className={styles.planDimK}>代价</span>
                        <span className={styles.planDimV}>见下</span>
                      </div>
                      <div className={styles.planDim}>
                        <span className={styles.planDimK}>风险</span>
                        <span className={styles.absent}>——</span>
                      </div>
                    </div>
                    <DoNothingBody card={selectedCard} />
                  </div>
                </div>

                {confirmText ? (
                  <div className={styles.confirm} data-testid="dc-confirm">
                    {confirmText}
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : null}

        {!result && !run.isPending ? (
          <section className="panel" aria-label="还没算">
            <p className={styles.greyLine}>
              左边加一件事，按〔算一下〕。在那之前这里不显示任何金额 ——
              没算过的数摆上来，跟算出来的数长得一模一样。
            </p>
          </section>
        ) : null}

        {/* 页脚一行灰字：这一屏有几处成色你需要知道 */}
        {result ? (
          <div className={`${styles.footer} ${honesty.length > 0 ? styles.sys : ""}`}>
            <button type="button" className={styles.footerBtn} onClick={() => setFooterOpen((v) => !v)} aria-expanded={footerOpen}>
              这一屏有 {honesty.length} 处成色你需要知道 {footerOpen ? "▾" : "▸"}
            </button>
            {footerOpen ? (
              <div className={styles.drawer}>
                {honesty.length === 0 ? (
                  <div className={styles.drawerItem}>这一屏没有需要额外说明的成色。</div>
                ) : (
                  honesty.map((h, i) => (
                    <div className={styles.drawerItem} key={`${h.anchor}-${i}`}>
                      {i + 1}. {h.text} → <a href={`#${h.anchor}`}>看它影响哪一段</a>
                      <Raw text={h.raw} />
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 子组件
// ══════════════════════════════════════════════════════════════════════════

/** 一条事件模板：点 ＋ **就地展开**（不跳页、不弹窗），展开内容由 catalog 现读生成。 */
function TemplateRow({
  spec,
  open,
  onToggle,
  onAdd,
}: {
  spec: DrillEventSpec;
  open: boolean;
  onToggle: () => void;
  onAdd: (e: AddedEvent) => void;
}) {
  const scope = subjectScopeFor(spec.kind as string);
  const [pickedId, setPickedId] = useState<string>("");
  const [pickedLabel, setPickedLabel] = useState<string>("");
  const [parentId, setParentId] = useState<string>("");
  const [q, setQ] = useState("");
  const [payload, setPayload] = useState<Record<string, number | string>>({});
  const [showTiming, setShowTiming] = useState(false);
  const [day, setDay] = useState(0);
  const [days, setDays] = useState<string>("");

  // 候选清单：`LIST` 档一次取回（实测最多 20 行）；`SEARCH` 档只在输了字之后才打。
  const list = useQuery({
    queryKey: ["decision-console", "subject", scope?.typeKey, scope?.mode, parentId],
    enabled: open && !!scope && scope.mode === "LIST",
    queryFn: () => searchObjects(scope!.typeKey, "", { pageSize: "50" }),
  });
  const childList = useQuery({
    queryKey: ["decision-console", "subject-child", scope?.child?.typeKey, parentId],
    enabled: open && !!scope?.child && parentId.length > 0,
    queryFn: () =>
      searchObjects(scope!.child!.typeKey, "", { pageSize: "50", [scope!.child!.filterParam]: parentId }),
  });
  const search = useQuery({
    queryKey: ["decision-console", "subject-search", scope?.typeKey, q],
    enabled: open && !!scope && scope.mode === "SEARCH" && q.trim().length > 0,
    queryFn: () => searchObjects(scope!.typeKey, q.trim(), { pageSize: "20" }),
  });

  const idForm = subjectIdFormFor(spec);
  const subjectRead = subjectIsRead(spec);

  const pick = (item: { id: string; props: Record<string, unknown> }, nameProp: string) => {
    setPickedId(targetIdOf(spec, item, nameProp));
    const n = item.props[nameProp];
    setPickedLabel(typeof n === "string" ? n : item.id);
  };

  const canAdd =
    (scope === null || !subjectRead || pickedId.length > 0) &&
    spec.payloadKeys.filter((k) => k.required).every((k) => payload[k.key] !== undefined && payload[k.key] !== "");

  return (
    <>
      {/*
       * 一行 = **一个**可聚焦控件。上一版把行名与 ＋ 做成两颗按钮、动作完全相同 ——
       * 键盘用户要按两次 Tab 才走完一行，11 行就白吃 11 次（实测 Tab 到〔算一下〕
       * 从 28 次降到 17 次就是砍掉这一半）。＋ 现在是纯装饰（`aria-hidden`）。
       */}
      <button
        type="button"
        className={styles.tplRow}
        aria-label={`加一件「${spec.label}」`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.tplName}>{spec.label}</span>
        <span className={styles.tplAdd} aria-hidden="true">
          ＋
        </span>
      </button>

      {open ? (
        <div className={styles.tplOpen}>
          {/* 主体选择器：按事件类型限定范围。⛔ 绝不出现「共 N 个落点」那种全量下拉 */}
          {scope === null ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`sub-${spec.kind}`}>
                {SUBJECT_FALLBACK.label}
              </label>
              <input
                id={`sub-${spec.kind}`}
                className={styles.input}
                value={pickedId}
                onChange={(e) => {
                  setPickedId(e.target.value);
                  setPickedLabel(e.target.value);
                }}
              />
              <span className={styles.fieldHint}>{SUBJECT_FALLBACK.note}</span>
            </div>
          ) : scope.mode === "SEARCH" ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`q-${spec.kind}`}>
                {scope.label}
              </label>
              <input
                id={`q-${spec.kind}`}
                className={styles.input}
                placeholder={scope.searchHint}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q.trim().length === 0 ? (
                <span className={styles.fieldHint}>
                  单子太多，铺不下 —— 输单号或客户名，我把对得上的列出来。
                </span>
              ) : search.isLoading ? (
                <span className={styles.fieldHint}>正在找…</span>
              ) : (search.data?.items.length ?? 0) === 0 ? (
                <span className={styles.fieldHint}>没有对得上的单。</span>
              ) : (
                <>
                  <div className={styles.searchList}>
                    {(search.data?.items ?? []).slice(0, 20).map((it) => (
                      <button
                        type="button"
                        key={it.id}
                        className={styles.searchItem}
                        aria-pressed={pickedId === targetIdOf(spec, it, scope.nameProp)}
                        onClick={() => pick(it, scope.nameProp)}
                      >
                        {String(it.props[scope.nameProp] ?? it.id)} · {String(it.props.cust ?? "")} ·{" "}
                        {String(it.props.qty ?? "")} 套 · 交期 {String(it.props.due ?? "")}
                      </button>
                    ))}
                  </div>
                  <span className={styles.fieldHint}>
                    对得上 {search.data?.total ?? 0} 张，这里列前 {Math.min(20, search.data?.items.length ?? 0)} 张。
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`sel-${spec.kind}`}>
                  {scope.label}
                </label>
                <select
                  id={`sel-${spec.kind}`}
                  className={styles.select}
                  value={scope.child ? parentId : pickedId}
                  onChange={(e) => {
                    const v = e.target.value;
                    const item = (list.data?.items ?? []).find((x) => (scope.child ? String(x.props[childKeyProp(scope.child.filterParam)] ?? x.id) === v : targetIdOf(spec, x, scope.nameProp) === v));
                    if (scope.child) {
                      setParentId(v);
                      setPickedId("");
                      setPickedLabel("");
                    } else if (item) {
                      pick(item, scope.nameProp);
                    }
                  }}
                >
                  <option value="">请选一个（共 {list.data?.total ?? 0} 个）</option>
                  {(list.data?.items ?? []).map((it) => (
                    <option
                      key={it.id}
                      value={scope.child ? String(it.props[childKeyProp(scope.child.filterParam)] ?? it.id) : targetIdOf(spec, it, scope.nameProp)}
                    >
                      {String(it.props[scope.nameProp] ?? it.id)}
                    </option>
                  ))}
                </select>
              </div>
              {scope.child && parentId ? (
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`sel2-${spec.kind}`}>
                    {scope.child.label}
                  </label>
                  <select
                    id={`sel2-${spec.kind}`}
                    className={styles.select}
                    value={pickedId}
                    onChange={(e) => {
                      const item = (childList.data?.items ?? []).find((x) => targetIdOf(spec, x, scope.child!.nameProp) === e.target.value);
                      if (item) pick(item, scope.child!.nameProp);
                    }}
                  >
                    <option value="">请选一个（共 {childList.data?.total ?? 0} 条）</option>
                    {(childList.data?.items ?? []).map((it) => (
                      <option key={it.id} value={targetIdOf(spec, it, scope.child!.nameProp)}>
                        {String(it.props[scope.child!.nameProp] ?? it.id)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </>
          )}

          {!subjectRead ? (
            <span className={styles.fieldHint}>
              这类事今天不看你选的是谁 —— 它只决定去问哪几路算。选了也不会白选：回执里会写清楚。
            </span>
          ) : null}

          {/* 要填的数：由 catalog 的 payloadKeys 现读生成，hint 一字不改 */}
          {spec.payloadKeys.map((k) => (
            <div className={styles.field} key={k.key}>
              <label className={styles.fieldLabel} htmlFor={`p-${spec.kind}-${k.key}`}>
                {k.hint || k.key}
                {k.required ? " · 必填" : ""}
              </label>
              <input
                id={`p-${spec.kind}-${k.key}`}
                className={styles.input}
                type={k.type === "number" ? "number" : "text"}
                value={String(payload[k.key] ?? "")}
                onChange={(e) =>
                  setPayload((p) => ({ ...p, [k.key]: k.type === "number" ? Number(e.target.value) : e.target.value }))
                }
              />
            </div>
          ))}

          {/* 「从第几天起 / 持续几天」默认折叠（九成用默认值）。屏上写「天」不写「拍」。 */}
          <button type="button" className={styles.foldToggle} onClick={() => setShowTiming((v) => !v)} aria-expanded={showTiming}>
            {showTiming ? "收起时间" : "从第 0 天起 · 一直持续（改时间 ▸）"}
          </button>
          {showTiming ? (
            <div className={styles.rowInline}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`d0-${spec.kind}`}>
                  从第几天起
                </label>
                <input
                  id={`d0-${spec.kind}`}
                  className={styles.input}
                  type="number"
                  min={0}
                  value={day}
                  onChange={(e) => setDay(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`dn-${spec.kind}`}>
                  持续几天
                </label>
                <input
                  id={`dn-${spec.kind}`}
                  className={styles.input}
                  type="number"
                  min={1}
                  placeholder="不填 = 一直持续"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="btn"
            disabled={!canAdd}
            onClick={() =>
              onAdd({
                uid: `${spec.kind}-${Date.now()}`,
                kind: spec.kind as string,
                targetObjectId: pickedId,
                targetLabel: pickedLabel || (subjectRead ? pickedId : "（这类事不看主体）"),
                payload,
                effectiveDay: day,
                durationDays: days === "" ? null : Number(days),
              })
            }
          >
            加进去
          </button>
          {!canAdd ? (
            <span className={styles.fieldHint}>
              {subjectRead && pickedId.length === 0 ? "先选一个对象；" : ""}
              {spec.payloadKeys.filter((k) => k.required && (payload[k.key] === undefined || payload[k.key] === "")).map((k) => `「${k.hint || k.key}」要填；`)}
              填齐了才能加 —— 缺一个必填的，后台会回「未能评估」而不是算成 0。
            </span>
          ) : null}
          {idForm === "OBJECT_ID" ? (
            <span className={styles.fieldHint}>这件事会真的改到数上，所以它要求主体是一个真实存在的对象。</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** 「只能盯着的 M 处」折成一块，点名最严重的那个 + 引擎自陈的原文。 */
function WatchOnly({ rows }: { rows: ReturnType<typeof splitImpediments>["watchOnly"] }) {
  const [open, setOpen] = useState(false);
  const worst = rows[0];
  return (
    <div className={styles.impPlain}>
      最严重的是{worst ? worst.sentence : "（本次没有）"}，今天没有对策。
      <br />
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        另外 {Math.max(0, rows.length - 1)} 处也一样 {open ? "▾" : "▸"}
      </button>
      {open ? (
        <div className={styles.drawer}>
          {rows.map((r) => (
            <div className={styles.drawerItem} key={r.impedimentId}>
              · {r.sentence}
              {r.noCandidateReason ? <Raw text={r.noCandidateReason} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 第四栏正文：全部实测真数（这些单会晚 / 这些单值多少钱 / 靠自己要多久 / 罚多少钱算不出来）。 */
function DoNothingBody({ card }: { card: BaseCard | null }) {
  if (!card) return <div className={styles.planList}>先在上面选一个地方。</div>;
  const dn = card.doNothing as
    | {
        status?: string;
        catchUp?: { status?: string; days?: number; shortfall?: number; freeDaily?: number; reason?: string };
        delay?: { status?: string; orders?: { so: string; cust: string; dueDay: number; delayDays: number }[] };
        penalty?: { status?: string; reason?: string };
        revenueAtRiskYi?: number;
        atRiskCustomers?: number;
      }
    | null;
  const orders = dn?.delay?.orders ?? [];
  return (
    <>
      <div className={styles.planList}>
        这几张单会晚
        <Est />：
        {orders.length === 0 ? (
          <span className={styles.absent}>这次没算出来</span>
        ) : (
          <>
            {orders.slice(0, 7).map((o) => (
              <div key={o.so}>
                {o.cust} {o.so} · 第 {o.dueDay} 天到期 · 晚 {o.delayDays} 天
              </div>
            ))}
            {orders.length > 7 ? <div>…共 {orders.length} 张</div> : null}
          </>
        )}
      </div>
      <div className={styles.planList}>
        {card.status === "EMPTY" ? (
          "这批窗口内没有订单，不报准时率"
        ) : (
          <>
            这些单值 {roundish(card.revenueYi)} 亿，{card.customerCount} 家客户
          </>
        )}
      </div>
      <div className={styles.planList}>
        {dn?.catchUp?.status === "OK" && typeof dn.catchUp.shortfall === "number" ? (
          <>
            {card.baseName}靠自己消化不了：还差 {Math.round(dn.catchUp.shortfall).toLocaleString("zh-CN")} 套，
            闲下来的产能一天只有 {roundish(dn.catchUp.freeDaily ?? 0)} 套
            <Est />
          </>
        ) : (
          <span className={styles.absent}>{dn?.catchUp?.reason ?? "这次没算出来"}</span>
        )}
      </div>
      <div className={styles.planList}>
        不做要赔多少钱：
        <span className={styles.absent}>今天算不出来</span>
        <PenaltyWhy raw={dn?.penalty?.reason ?? "（引擎没给原文）"} />
      </div>
    </>
  );
}

function PenaltyWhy({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        为什么 {open ? "▾" : "▸"}
      </button>
      {open ? <Raw text={raw} /> : null}
    </>
  );
}

/** 「这几个数加起来对得上账 ▸」—— 归因自己就带勾稽，把它原样搬到屏上。 */
function ReconcileEntry({ finding }: { finding: { why: string; reconciled: boolean | null; evidence?: unknown } }) {
  const [open, setOpen] = useState(false);
  const ev = finding.evidence as
    | {
        totalGap?: number;
        demandSide?: { pct?: number; drivers?: { factor: string; contribution: number; unit?: string }[] };
        supplySide?: { pct?: number; drivers?: { factor: string; contribution: number; unit?: string }[] };
        residualPct?: number;
      }
    | undefined;
  const leaves = [...(ev?.demandSide?.drivers ?? []), ...(ev?.supplySide?.drivers ?? [])];
  return (
    <>
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="dc-recon">
        这几个数加起来对得上账 {open ? "▾" : "▸"}
      </button>
      {open ? (
        <div className={styles.drawer}>
          <div className={styles.drawerItem}>
            {finding.reconciled === true ? "逐层核对过，通过。" : finding.reconciled === false ? "逐层核对没通过，这条已经降级展示。" : "这一条不适用勾稽。"}
          </div>
          {leaves.map((d) => (
            <div className={styles.drawerItem} key={d.factor}>
              · {d.factor} —— {roundish(d.contribution)} {d.unit ?? ""}
            </div>
          ))}
          <div className={styles.drawerItem}>引擎原话：<Raw text={finding.why} /></div>
        </div>
      ) : null}
    </>
  );
}

/** 500 张单的三段分布。 */
function SegmentBar({ rows }: { rows: { group: Record<string, string | null>; metrics: Record<string, number | null> }[] }) {
  const label: Record<string, string> = { COMPLETED: "已完成", IN_PRODUCTION: "在产", OPEN: "已下待排产" };
  const cls: Record<string, string | undefined> = {
    COMPLETED: styles.segDone,
    IN_PRODUCTION: styles.segWip,
    OPEN: styles.segOpen,
  };
  const total = rows.reduce((a, r) => a + (r.metrics.count_so ?? 0), 0);
  if (total === 0) return null;
  return (
    <>
      <div className={styles.segBar}>
        {rows.map((r) => {
          const k = r.group.status ?? "";
          const n = r.metrics.count_so ?? 0;
          return (
            <div key={k} className={`${styles.segPiece} ${cls[k] ?? ""}`} style={{ width: `${(n / total) * 100}%` }}>
              {n}
            </div>
          );
        })}
      </div>
      <p className={styles.greyLine}>
        手上一共 {total} 张单：
        {rows.map((r) => `${label[r.group.status ?? ""] ?? r.group.status} ${r.metrics.count_so ?? 0} 张`).join(" · ")}
      </p>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 小工具（都是纯读取，读不到就诚实返回 null —— 一个兜底常数都不许有）
// ══════════════════════════════════════════════════════════════════════════

function cardsOf(risk: SolverData | null): BaseCard[] {
  const raw = (risk as { cards?: unknown[] } | null)?.cards ?? [];
  return (raw as Record<string, unknown>[]).map((c) => {
    const exp = (c.exposure ?? {}) as Record<string, unknown>;
    return {
      baseId: String(c.baseId ?? ""),
      baseName: String(c.base ?? exp.baseName ?? c.baseId ?? ""),
      factor: String(c.factor ?? ""),
      status: String(exp.status ?? "UNKNOWN"),
      revenueYi: Number(exp.revenueYi ?? 0),
      orderCount: Number(exp.orderCount ?? 0),
      customerCount: Number(exp.customerCount ?? 0),
      orders: (exp.orders ?? []) as BaseCard["orders"],
      doNothing: c.doNothing ?? null,
    };
  });
}

/** 卡点落在哪个基地上（`Base` 直接对；`Line` 走它自己的 `baseId` 属性 —— 不解析 id 字符串）。 */
function baseOfImpediment(objectType: string, objectId: string, cards: BaseCard[], risk: SolverData | null): string | null {
  if (objectType === "Base") return cards.find((c) => c.baseId === objectId)?.baseId ?? null;
  void risk;
  return null;
}

function bigGapOf(evidence: unknown): string {
  const g = (evidence as { totalGap?: number } | undefined)?.totalGap;
  return typeof g === "number" ? roundish(g) : "—";
}

/**
 * 一句人话归因：贡献最大的两条叶子，**取自回包，不编**。
 * ⚠ 回包里的因子名自带公式（`设备 OEE 损失（1−OEE 均值×产能）`），公式属第二层（R-UI-4），
 * 第一层只留括号前那半句；完整原文在勾稽抽屉里一字不改地给。
 */
function oneLineCause(evidence: unknown): string {
  const ev = evidence as
    | { demandSide?: { drivers?: { factor: string; contribution: number; unit?: string }[] }; supplySide?: { drivers?: { factor: string; contribution: number; unit?: string }[] } }
    | undefined;
  const all = [...(ev?.demandSide?.drivers ?? []), ...(ev?.supplySide?.drivers ?? [])].sort(
    (a, b) => b.contribution - a.contribution,
  );
  if (all.length === 0) return "这次没给出是谁造成的。";
  const top = all.slice(0, 2).map((d) => `${plainFactor(d.factor)} ${roundish(d.contribution)} ${d.unit ?? ""}`.trim());
  return `主要是${top.join(" 和 ")}`;
}

/** 剥掉因子名里的公式括号（全角/半角都剥）—— 只在第一层用，抽屉里仍给原文。 */
function plainFactor(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim() || name;
}

function financeMargin(finance: SolverData | null): string | null {
  const lines = (finance as { lines?: { subject?: string; projected?: number }[] } | null)?.lines ?? [];
  const m = lines.find((l) => l.subject === "毛利");
  return typeof m?.projected === "number" ? `${roundish(m.projected)} 亿` : null;
}

function financeBasisNote(finance: SolverData | null): string | null {
  const b = (finance as { basis?: { note?: string } } | null)?.basis;
  return b?.note ?? null;
}

/** 二级选择器的父键属性名（`base` → `baseId`）。 */
function childKeyProp(filterParam: string): string {
  return filterParam === "base" ? "baseId" : filterParam;
}
