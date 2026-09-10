/**
 * ══ WO-SIM-CONSOLE-0828 · 「推演与对策」控制台（2026-08-28 设计稿的六块屏）══════════
 *
 * 设计稿：`docs/design/UI-sim-console-20260828.html`
 *   md5 `b6e2ce7b365e4d3d7ca01135db83e426` · 38,215 字节
 *   金丝雀（自证读的是原稿）：「算 一 下」「什么都不做」「落在谁头上」三串都在。
 *
 * ── 它替换的是什么 ───────────────────────────────────────────────────────────
 * 同一条 route `v/sim-unified` 的**默认视图**。今天那套 8 页签工作台**没有删**，
 * 退到左栏页脚的「专家模式 ▸」后面，两者**共用同一个会话与同一份查询缓存**
 * （`sessionId` 由 `UnifiedSimShell` 一处解析后透下来；取数用的是与工作台**逐字相同**的
 * `queryKey`，故切过去不会重新发一遍请求）。
 * 这不是我加的分层 —— 稿子左栏页脚自己写着：
 *   > 「其余 12,675 个对象只在**结果里**出现，不进选择器 …… **专家模式 ▸**」
 *
 * ── 「算 一 下」这一下到底做了什么（稿上那句「用户不需要知道这是五次调用」）──────
 *   ① `simWorld`      读**扰动前**的世界（差分的基准）
 *   ② `createSimPerturbation` × N   把左栏那 N 件事逐条施加
 *   ③ `simTick(n, disclose:true)`   推 N 拍，并要**披露层**（规则/切片/耗时/是否调 agent）
 *   ④ `simWorld`      读**扰动后**的世界
 *   ⑤ `runSolver("chain_impediments")` 出卡点与对策
 * 五步在一个 mutation 里顺序跑完，屏上只有一个按钮。
 *
 * ── ⚠ 三条实测教训，直接写进了本文件的行为（不是注释里的客套）─────────────────
 *  ① **别拿源格判断扰动生没生效。** 2026-09-10 实测：同一条扰动，源格
 *     `Base.loadIndex` 只动 **0.008248**，而下游 130 条产线合计动了 **148.908054**
 *     —— 差 18,053 倍。源变量被顶在域上界（~99.7/100），分辨率被饱和吃光。
 *     ⇒ 本屏的「波及面」一律按**差分全集**算（`diffWorld`），不看源格。
 *  ② **`kind` 只能是契约那五类**（`demand_shift`/`supply_disruption`/`capacity_loss`/
 *     `cost_shock`/`quality_event`）。我第一版传了 `PRICE`，后端 400，
 *     四条对照臂**全部静默不生效**，读起来像「引擎不响应」。⇒ kind 一律取自 `eventCatalog`。
 *  ③ **删掉一条扰动不会回滚世界。** 后端 `deleteSimPerturbation` 明文「不回滚世界态」，
 *     且**在检查点那一拍写扰动会污染检查点本身**。⇒ 左栏的 ✕ 只从**待施加清单**里拿掉，
 *     世界已经吃过的那一下要靠重算；屏上把这件事说清楚，不装作删了就没发生过。
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PropagationRulesResponse, SandboxViewConfig } from "@platform/contracts";
import {
  createSimPerturbation,
  fetchAllObjects,
  fetchPropagationRules,
  fetchSimViewConfig,
  runSolver,
  simTick,
  simWorld,
} from "@/api/endpoints";
import {
  BUSINESS_EVENTS,
  LANDING_ABSENCE_TEXT,
  resolveLanding,
  type BusinessEvent,
  type CatalogCanary,
  type LandingState,
} from "./eventCatalog";
import {
  buildCustomerView,
  buildMoneyView,
  diffWorld,
  fmtMoney,
  NOCALC_WHY,
  ORDER_STATUS_TEXT,
  type CellDelta,
  type OrderRow,
  type WorldCells,
} from "./console0828Model";
import {
  buildChainImpedimentModel,
  ChainImpedimentPayloadSchema,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  type ChainImpedimentModel,
} from "../../chainImpediment";
import styles from "./Console0828.module.css";

/** 左栏「已经加了 N 件事」里的一条 —— **还没提交**，提交发生在「算一下」。 */
interface StagedEvent {
  readonly uid: string;
  readonly eventId: string;
  readonly name: string;
  readonly targetObjectId: string;
  readonly targetObjectName: string;
  readonly targetStateVar: string;
  readonly kind: BusinessEvent["kind"];
  readonly mode: BusinessEvent["mode"];
  readonly magnitude: number;
  readonly unit: string;
  readonly startTick: number | null;
  readonly durationTicks: number | null;
}

/** 一次「算一下」的产物。 */
interface RunResult {
  readonly beforeTick: number;
  readonly afterTick: number;
  readonly deltas: readonly CellDelta[];
  readonly staged: readonly StagedEvent[];
  /** 每条扰动的落库回执（`startTick` 是后端定的，不是前端猜的）。 */
  readonly receipts: readonly { readonly name: string; readonly startTick: number | null }[];
  readonly disclosure: DisclosureBrief | null;
  readonly impediments: ChainImpedimentModel | null;
  readonly impedimentError: string | null;
}

/** 披露层里屏上真要给的那几项（铁律 1.5 判据二：推演过程必须可披露）。 */
interface DisclosureBrief {
  readonly objects: number | null;
  readonly links: number | null;
  readonly sliceKey: string | null;
  readonly hops: number | null;
  readonly rulesFired: number | null;
  readonly rulesDeclared: number | null;
  readonly withCoefficientRef: number | null;
  readonly agentInvoked: boolean | null;
  readonly totalMs: number | null;
}

function readDisclosure(raw: unknown): DisclosureBrief | null {
  if (raw === null || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const graph = d.graph as Record<string, unknown> | undefined;
  const slice = d.slice as Record<string, unknown> | undefined;
  const rules = d.rules as Record<string, unknown> | undefined;
  const agent = d.agent as Record<string, unknown> | undefined;
  const timings = d.timings as Record<string, unknown> | undefined;
  return {
    objects: num(graph?.objects ?? d.objects),
    links: num(graph?.links ?? d.links),
    sliceKey: typeof slice?.sliceKey === "string" ? slice.sliceKey : null,
    hops: num(slice?.hops),
    rulesFired: num(rules?.fired),
    rulesDeclared: num(rules?.declared),
    withCoefficientRef: num(rules?.withCoefficientRef),
    agentInvoked: typeof agent?.invoked === "boolean" ? agent.invoked : null,
    totalMs: num(timings?.total ?? d.totalMs),
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export default function Console0828({
  sessionId,
  onExpert,
}: {
  sessionId: string | undefined;
  onExpert: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const enabled = sessionId !== undefined && sessionId !== "";

  /* ── 取数：三条**共用工作台的缓存键**，切到专家模式不会重发 ───────────────── */
  const cfgQ = useQuery({
    queryKey: ["a", "sim-view-config"],
    queryFn: fetchSimViewConfig,
    staleTime: Infinity,
    retry: false,
  });
  const rulesQ = useQuery({
    queryKey: ["a", "sim-propagation-rules", true],
    queryFn: () => fetchPropagationRules(true),
    staleTime: Infinity,
    retry: false,
  });
  /**
   * 订单**全量**。`fetchAllObjects` 按服务端回显的 `hasMore` 翻到底并拿 `total` 对账 ——
   * ⛔ 不许换成一次 `pageSize=500` 了事：那在 `Order`（恰好 500）上看着是对的，
   *    换个类型就静默少一半（本仓 `WO-PAGING-SILENT-TRUNCATION-SCAN` 记过这笔账）。
   */
  const ordersQ = useQuery({
    queryKey: ["a", "objects-all", "Order"],
    queryFn: () => fetchAllObjects("Order"),
    staleTime: Infinity,
    retry: false,
  });

  const cfg = cfgQ.data as SandboxViewConfig | undefined;
  const nodeObjectIds = cfg?.nodeObjectIds as Record<string, readonly string[]> | undefined;

  /** typeKey → 它在**已发布规则**里承载的量。业务事件靠它落地。 */
  const varsByType = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const rules = (rulesQ.data as PropagationRulesResponse | undefined)?.items ?? [];
    const touch = (t: string, v: string): void => {
      const s = m.get(t) ?? new Set<string>();
      s.add(v);
      m.set(t, s);
    };
    for (const r of rules) {
      touch(r.sourceTypeKey, r.sourceStateVar);
      touch(r.targetTypeKey, r.targetStateVar);
    }
    return m as ReadonlyMap<string, ReadonlySet<string>>;
  }, [rulesQ.data]);

  const countOf = useMemo(
    () => (t: string): number => (nodeObjectIds?.[t] ?? []).length,
    [nodeObjectIds],
  );

  /** 12 件事逐条落地判定 + 金丝雀。 */
  const landings = useMemo(() => {
    const out = new Map<string, LandingState>();
    for (const ev of BUSINESS_EVENTS) out.set(ev.id, resolveLanding(ev, varsByType, countOf));
    return out;
  }, [varsByType, countOf]);

  const canary: CatalogCanary = useMemo(() => {
    const landable = [...landings.values()].filter((l) => l.kind === "ok").length;
    return { typesInRules: varsByType.size, landable, ok: varsByType.size > 0 && landable > 0 };
  }, [landings, varsByType]);

  /** 六类「叫得出名字的实体」——条数**现算**，不写死稿上那 6 个数。 */
  const entityCounts = useMemo(
    () =>
      (["Base", "Customer", "Supplier", "Material", "Model", "DemandSegment"] as const).map((t) => ({
        typeKey: t,
        label: { Base: "基地", Customer: "客户", Supplier: "供应商", Material: "物料", Model: "型号", DemandSegment: "需求段" }[t],
        n: countOf(t),
      })),
    [countOf],
  );
  const entityTotal = entityCounts.reduce((s, e) => s + e.n, 0);

  /* ── 左栏交互态 ───────────────────────────────────────────────────────── */
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [staged, setStaged] = useState<readonly StagedEvent[]>([]);
  const [horizon, setHorizon] = useState(3);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pickedFix, setPickedFix] = useState<string | null>(null);

  /** 展开中那件事的落点候选（**按需**取对象层，取到才有名字）。 */
  const openEv = openEvent === null ? null : (BUSINESS_EVENTS.find((e) => e.id === openEvent) ?? null);
  const openLanding = openEvent === null ? null : (landings.get(openEvent) ?? null);
  const pickTypeKey = openLanding !== null && openLanding.kind === "ok" ? openLanding.typeKey : null;

  const pickQ = useQuery({
    queryKey: ["a", "objects-all", pickTypeKey ?? ""],
    queryFn: () => fetchAllObjects(pickTypeKey as string),
    enabled: pickTypeKey !== null,
    staleTime: Infinity,
    retry: false,
  });

  /** 一条候选实体在下拉里的显示名。**名字只来自对象层**，取不到就退回 id，不编。 */
  const options = useMemo(() => {
    const items = pickQ.data?.items ?? [];
    return items.slice(0, 500).map((it) => {
      const p = (it.props ?? {}) as Record<string, unknown>;
      const nm = ["name", "custName", "cust", "matName", "so", "supplierName"]
        .map((k) => p[k])
        .find((v): v is string => typeof v === "string" && v.trim() !== "");
      return { id: it.id, label: nm ?? it.id };
    });
  }, [pickQ.data]);

  const [pickId, setPickId] = useState<string>("");
  const [magnitude, setMagnitude] = useState<number>(0);
  const [startTick, setStartTick] = useState<string>("");
  const [duration, setDuration] = useState<string>("");

  const openForm = (ev: BusinessEvent): void => {
    setOpenEvent(ev.id);
    setPickId("");
    setMagnitude(ev.defaultMagnitude);
    setStartTick("");
    setDuration("");
  };

  const addStaged = (): void => {
    if (openEv === null || openLanding === null || openLanding.kind !== "ok" || pickId === "") return;
    const nm = options.find((o) => o.id === pickId)?.label ?? pickId;
    setStaged((p) => [
      ...p,
      {
        uid: `${openEv.id}:${pickId}:${String(p.length)}`,
        eventId: openEv.id,
        name: openEv.name,
        targetObjectId: pickId,
        targetObjectName: nm,
        targetStateVar: openLanding.stateVar,
        kind: openEv.kind,
        mode: openEv.mode,
        magnitude,
        unit: openEv.unit,
        startTick: startTick.trim() === "" ? null : Number(startTick),
        durationTicks: duration.trim() === "" ? null : Number(duration),
      },
    ]);
    setOpenEvent(null);
  };

  /* ── 「算 一 下」——五步一次走完 ───────────────────────────────────────── */
  const runM = useMutation({
    mutationFn: async (): Promise<RunResult> => {
      const sid = sessionId as string;
      const before = await simWorld(sid);
      const receipts: { name: string; startTick: number | null }[] = [];
      for (const s of staged) {
        const r = await createSimPerturbation(sid, {
          kind: s.kind,
          targetObjectId: s.targetObjectId,
          targetStateVar: s.targetStateVar,
          magnitude: s.magnitude,
          label: `${s.name} · ${s.targetObjectName}`,
          mode: s.mode,
          ...(s.startTick === null ? {} : { startTick: s.startTick }),
          durationTicks: s.durationTicks,
        });
        receipts.push({ name: s.name, startTick: r.perturbation.startTick ?? null });
      }
      const ticked = await simTick(sid, horizon, true);
      const after = await simWorld(sid);
      let imp: ChainImpedimentModel | null = null;
      let impErr: string | null = null;
      try {
        const res = await runSolver(CHAIN_IMPEDIMENT_SOLVER_KEY, { scope: {} });
        imp = buildChainImpedimentModel(ChainImpedimentPayloadSchema.parse(res.data));
      } catch (e) {
        // ⛔ 不许静默吞：卡点这一跳没走通 ≠ 没有卡点。屏上必须分得开。
        impErr = e instanceof Error ? e.message : String(e);
      }
      return {
        beforeTick: before.tick,
        afterTick: ticked.curTick,
        deltas: diffWorld(before.state as WorldCells, after.state as WorldCells),
        staged,
        receipts,
        disclosure: readDisclosure(ticked.disclosure ?? null),
        impediments: imp,
        impedimentError: impErr,
      };
    },
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["a", "sim-perturbations", sessionId ?? ""] });
    },
  });

  /* ── 结果派生 ─────────────────────────────────────────────────────────── */
  const orders: readonly OrderRow[] = useMemo(
    () =>
      (ordersQ.data?.items ?? []).map((it) => {
        const p = (it.props ?? {}) as Record<string, unknown>;
        const s = (k: string): string | null => (typeof p[k] === "string" ? (p[k] as string) : null);
        const n = (k: string): number | null =>
          typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null;
        return { id: it.id, cust: s("cust"), qty: n("qty"), value: n("value"), due: s("due"), status: s("status"), model: s("model") };
      }),
    [ordersQ.data],
  );

  /** 波及订单 id 集合。**按差分算，不按源格算**（教训 ①）。 */
  const touchedOrderIds = useMemo(() => {
    const ids = new Set(orders.map((o) => o.id));
    const out = new Set<string>();
    for (const d of result?.deltas ?? []) if (ids.has(d.objectId)) out.add(d.objectId);
    return out;
  }, [result, orders]);

  /**
   * 「这张单是被哪件事推的」。
   * ⚠ 今天**只在单件扰动时答得上**：多件同时施加，差分层看不出某一格是谁推的
   *   （披露层的 `contributions` 才有逐边归因，那是另一档的活）。
   *   ⇒ 多件时返回 `null`，屏上照实说「说不清主要是哪一件」，**不猜**。
   */
  const causeOf = useMemo(
    () => (_id: string): string | null =>
      (result?.staged.length ?? 0) === 1 ? (result?.staged[0]?.name ?? null) : null,
    [result],
  );

  const money = useMemo(
    () => (result === null ? null : buildMoneyView(result.deltas, orders, causeOf)),
    [result, orders, causeOf],
  );
  const custView = useMemo(
    () => (orders.length === 0 ? null : buildCustomerView(orders, touchedOrderIds)),
    [orders, touchedOrderIds],
  );

  /** 区④/⑤：能动的 N 处 / 只能盯着的 M 处 —— 全部取自引擎，前端零判定。 */
  const impGroups = useMemo(() => {
    const m = result?.impediments;
    if (m === undefined || m === null) return null;
    const all = m.groups.flatMap((g) => g.items);
    const actionable = all.filter((i) => i.candidates.length > 0);
    const watchOnly = all.filter((i) => i.candidates.length === 0);
    return { all, actionable, watchOnly, model: m };
  }, [result]);

  const picked = useMemo(() => {
    if (impGroups === null) return null;
    const id = pickedFix ?? impGroups.actionable[0]?.impedimentId ?? null;
    return impGroups.actionable.find((i) => i.impedimentId === id) ?? impGroups.actionable[0] ?? null;
  }, [impGroups, pickedFix]);

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */
  const zone = (n: string, t: string): JSX.Element => (
    <span className={styles.zoneTag}>
      <span className={styles.zoneNum}>{n}</span>
      {t}
    </span>
  );

  return (
    <div className={styles.wrap} data-testid="c0828-root">
      {/* ══ 区① 左栏 ══ */}
      <aside className={styles.rail} data-testid="c0828-rail">
        {zone("1", "加几件事")}
        <h2 className={styles.railTitle}>加一件或几件事，我算给你看</h2>

        {staged.length === 0 ? (
          <p className={styles.count} data-testid="c0828-staged-empty">
            还没有加任何事
          </p>
        ) : (
          <>
            <div className={styles.added} data-testid="c0828-staged">
              {staged.map((s) => (
                <div key={s.uid} className={styles.chip} data-testid={`c0828-chip-${s.eventId}`}>
                  <span>
                    {s.targetObjectName} <b className={styles.chipName}>{s.name}</b>{" "}
                    <span className={styles.mono}>
                      {s.magnitude}
                      {s.unit}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.chipX}
                    aria-label={`删掉 ${s.name}`}
                    onClick={() => setStaged((p) => p.filter((x) => x.uid !== s.uid))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <p className={styles.count} data-testid="c0828-staged-count">
              已经加了 {staged.length} 件事
            </p>
          </>
        )}

        <div className={styles.group}>
          <span className={styles.groupLabel}>还能加</span>
          {BUSINESS_EVENTS.map((ev) => {
            const L = landings.get(ev.id);
            const ok = L !== undefined && L.kind === "ok";
            const isOpen = openEvent === ev.id;
            return (
              <div key={ev.id}>
                <button
                  type="button"
                  className={styles.evBtn}
                  data-testid={`c0828-ev-${ev.id}`}
                  data-open={isOpen ? "1" : "0"}
                  data-landable={ok ? "1" : "0"}
                  disabled={!ok}
                  title={ok ? ev.detail : L === undefined ? "还在判定" : LANDING_ABSENCE_TEXT[L.kind as "no-instance" | "no-statevar"]}
                  onClick={() => (isOpen ? setOpenEvent(null) : openForm(ev))}
                >
                  <span>{ev.name}</span>
                  <span className={styles.evHint}>{ok ? ev.hint : "今天落不了地"}</span>
                  <span className={styles.evPlus}>{isOpen ? "－" : "＋"}</span>
                </button>

                {/* 就地展开下一级 —— 不跳页、不弹窗（稿子原话） */}
                {isOpen && ok && L !== undefined && L.kind === "ok" ? (
                  <div className={styles.expand} data-testid={`c0828-form-${ev.id}`}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>谁</span>
                      <select
                        value={pickId}
                        aria-label="落点"
                        data-testid={`c0828-pick-${ev.id}`}
                        onChange={(e) => setPickId(e.target.value)}
                      >
                        <option value="">
                          {pickQ.isPending ? "载入中…" : `请选择（${options.length} 个）`}
                        </option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>加多少</span>
                      <span className={styles.numRow}>
                        <input
                          type="number"
                          value={magnitude}
                          aria-label="幅度"
                          data-testid={`c0828-mag-${ev.id}`}
                          onChange={(e) => setMagnitude(Number(e.target.value))}
                        />
                        <span className={styles.unit}>{ev.unit}</span>
                      </span>
                    </div>

                    {/* 稿子要求：「什么时候开始 · 持续多久」收在 details 里 */}
                    <details className={styles.more}>
                      <summary>什么时候开始 · 持续多久</summary>
                      <div className={styles.moreBody}>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>从第</span>
                          <span className={styles.numRow}>
                            <input
                              type="number"
                              value={startTick}
                              placeholder="留空=当前拍"
                              aria-label="起始拍"
                              onChange={(e) => setStartTick(e.target.value)}
                            />
                            <span className={styles.unit}>拍起</span>
                          </span>
                        </div>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>持续</span>
                          <span className={styles.numRow}>
                            <input
                              type="number"
                              value={duration}
                              placeholder="留空=一直"
                              aria-label="持续拍数"
                              onChange={(e) => setDuration(e.target.value)}
                            />
                            <span className={styles.unit}>拍</span>
                          </span>
                        </div>
                        <p>
                          留空 = 从当前拍起、一直生效。填了起始拍而**又填了持续拍数**时，
                          若这个窗口已经整段落在过去，后端会照收（201）而世界一动不动 ——
                          这一态今天后端不给任何提示，故这里说明白。
                        </p>
                        <p>
                          这件事会落到 {L.typeKey} 的 {L.stateVar} 上；{ev.detail}
                        </p>
                      </div>
                    </details>

                    <div className={styles.acts}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        disabled={pickId === ""}
                        data-testid={`c0828-add-${ev.id}`}
                        onClick={addStaged}
                      >
                        加进去
                      </button>
                      <button type="button" className={styles.btn} onClick={() => setOpenEvent(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}

                {isOpen && !ok && L !== undefined && L.kind !== "ok" ? (
                  <div className={styles.expand} data-testid={`c0828-absent-${ev.id}`}>
                    <p className={styles.calibre}>{LANDING_ABSENCE_TEXT[L.kind]}</p>
                    <details className={styles.more}>
                      <summary>它找过哪些落点</summary>
                      <div className={styles.moreBody}>
                        {L.kind === "no-instance"
                          ? `找过这些对象类型：${L.triedTypes.join(" / ")}，本世界里都没有实例。`
                          : `${L.typeKey} 有实例，但它今天承载的量里没有：${L.triedVars.join(" / ")}。`}
                      </div>
                    </details>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* ── 区① 底部：整屏最亮的只有这一个 ── */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>往后推</span>
          <span className={styles.numRow}>
            <input
              type="number"
              value={horizon}
              min={1}
              aria-label="推几拍"
              data-testid="c0828-horizon"
              onChange={(e) => setHorizon(Math.max(1, Number(e.target.value)))}
            />
            <span className={styles.unit}>拍</span>
          </span>
        </div>
        <button
          type="button"
          className={styles.go}
          data-testid="c0828-go"
          disabled={!enabled || staged.length === 0 || runM.isPending}
          title={
            !enabled
              ? "先要有一个会话"
              : staged.length === 0
                ? "先在上面加至少一件事"
                : "施加、推进、出钱、出卡点、出方案，一次走完"
          }
          onClick={() => runM.mutate()}
        >
          {runM.isPending ? "正在算…" : "算 一 下"}
        </button>

        <div className={styles.railFoot}>
          <details className={styles.more}>
            <summary>这一下都做了什么</summary>
            <div className={styles.moreBody}>
              它自己把施加、推进、出钱、出卡点、出方案全走完 —— 用户不需要知道这是五次调用。
              主线只放这 <b>12 件你会开口问的事</b>；落点只在叫得出名字的实体里选。
              其余对象只在结果里出现，它们是传播介质，不是控制面板。
            </div>
          </details>
          <div data-testid="c0828-entity-counts">
            落点实体 <b className={styles.mono}>{entityTotal}</b> 个：
            {entityCounts.map((e) => ` ${e.label}${e.n}`).join(" ·")}
          </div>
          {!canary.ok && !cfgQ.isPending && !rulesQ.isPending ? (
            <div className={styles.warnBox} data-testid="c0828-canary-broken">
              12 件事一件都落不了地，而后端规则涉及 {canary.typesInRules} 个对象类型 —— 这是<b>工具坏了</b>，
              不是「今天没有可加的事」。
            </div>
          ) : null}
          <button type="button" className={styles.expertBtn} data-testid="c0828-expert" onClick={onExpert}>
            专家模式 ▸
          </button>
        </div>
      </aside>

      {/* ══ 主区 ══ */}
      <main className={styles.main}>
        {runM.isPending ? (
          <div className={styles.run} data-testid="c0828-running">
            <span className={styles.zoneNum}>2</span>
            正在算往后 {horizon} 拍…
            <span className={styles.bar}>
              <i className={styles.barFill} style={{ width: "62%" }} />
            </span>
          </div>
        ) : null}

        {runM.isError ? (
          <div className={styles.warnBox} data-testid="c0828-run-error">
            这次没算成：{runM.error instanceof Error ? runM.error.message : String(runM.error)}
            <br />
            —— 这是「这一跳失败」，不是「结果是 0」。
          </div>
        ) : null}

        {result === null && !runM.isPending ? (
          <section className={styles.panel} data-testid="c0828-idle">
            <div className={styles.head}>
              {zone("3", "钱上差多少")}
              <h3 className={styles.headTitle}>还没有算过</h3>
            </div>
            <p className={styles.empty}>
              左栏加一件或几件事，然后按「算 一 下」。
              {ordersQ.data === undefined ? null : (
                <>
                  {" "}
                  这个世界的订单簿现有{" "}
                  <b className={styles.mono}>{fmtMoney(orders.reduce((s, o) => s + (o.value ?? 0), 0), "元")}</b>，共{" "}
                  <b className={styles.mono}>{orders.length}</b> 张单。
                </>
              )}
            </p>
          </section>
        ) : null}

        {result !== null && money !== null ? (
          <>
            {/* ══ 区③ 钱上差多少 ══ */}
            <section className={styles.panel} data-testid="c0828-money">
              <div className={styles.head}>
                {zone("3", "钱上差多少")}
                <h3 className={styles.headTitle}>
                  这 {result.staged.length} 件事凑一块，往后 {horizon} 拍
                </h3>
                <span className={styles.headRight}>和下面的卡点、方案读的是同一次结果</span>
              </div>
              <div className={styles.money}>
                <div className={styles.moneyRow}>
                  <span className={styles.moneyLabel}>被推动的订单敞口</span>
                  <span className={styles.moneyBig} data-testid="c0828-exposure">
                    {fmtMoney(money.exposure, "元")}
                  </span>
                  <span className={styles.est}>估</span>
                </div>
                <div className={styles.calibre} data-testid="c0828-exposure-sub">
                  {money.exposedOrders} 张单 · 占订单簿 {pct(money.bookTotal === 0 ? 0 : money.exposure / money.bookTotal)}
                </div>
              </div>

              <div className={styles.brk}>
                {money.breakdown.map((b) => (
                  <div key={b.label} style={{ display: "contents" }}>
                    <span className={styles.brkKey}>{b.label}</span>
                    <span className={styles.brkVal}>
                      {b.cell.kind === "value" ? (
                        fmtMoney(b.cell.yuan, "元")
                      ) : (
                        <span className={styles.nocalc} data-testid={`c0828-nocalc-${b.label}`}>
                          这次算不出来
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <p className={styles.why} data-testid="c0828-maincause">
                {money.mainCause === null ? (
                  <>加了不止一件事，<b>说不清主要是哪一件</b></>
                ) : (
                  <>主要是<b>{money.mainCause}</b></>
                )}
              </p>

              <details className={styles.more} data-testid="c0828-recon">
                <summary>这几个数加起来对得上账</summary>
                <div className={styles.moreBody}>
                  <p>
                    「被推动的订单敞口」= 这次推演里读数真的变了的那些订单，把它们在对象层的成交额加起来。
                    它回答的是「有多少钱的单被碰到了」，不是「少赚了多少」—— 后者今天算不出来，见下。
                  </p>
                  <p>
                    订单簿合计 {fmtMoney(money.bookTotal, "元")}，共 {money.bookOrders} 张单（逐页翻到底后累加，
                    与服务端回报的总数对过账）。被推动 {money.exposedOrders} 张，合计 {fmtMoney(money.exposure, "元")}。
                  </p>
                  <p>毛利差：{NOCALC_WHY.margin}</p>
                  <p>多花的成本：{NOCALC_WHY.cost}</p>
                  <p>压住的应收：{NOCALC_WHY.receivable}</p>
                  <p>
                    这次一共有 {result.deltas.length} 格读数变了；世界从第 {result.beforeTick} 拍推到第{" "}
                    {result.afterTick} 拍。金丝雀：读到 {money.ordersSeen} 张单（为 0 就是遍历坏了，不是没有波及）。
                  </p>
                  <p>
                    ⚠ 别拿被扰的那一格自己的读数判断「生没生效」：源变量常被顶在域上界附近，
                    施一个 100 倍的量，源格可能只动千分之几，而下游会明显地动。这里的波及面按全世界差分算。
                  </p>
                  {result.receipts.length === 0 ? null : (
                    <p>
                      落库回执：
                      {result.receipts.map((r) => ` ${r.name}（起始第 ${r.startTick ?? "?"} 拍）`).join(" ·")}
                    </p>
                  )}
                </div>
              </details>
            </section>

            {/* ══ 区③b 落在谁头上 ══ */}
            {custView !== null ? (
              <section className={styles.panel} data-testid="c0828-cust">
                <div className={styles.head}>
                  {zone("3", "落在谁头上")}
                  <h3 className={styles.headTitle}>客户与订单</h3>
                  <span className={styles.headRight}>
                    订单簿 {fmtMoney(money.bookTotal, "元")} · {custView.totalCustomers} 家 · {money.bookOrders} 张
                  </span>
                </div>
                <div className={styles.two}>
                  <div>
                    <h4 className={styles.subHead}>
                      <span className={styles.dot} style={{ background: "var(--c-factory)" }} />
                      敞口最大的 {custView.rows.length} 家
                    </h4>
                    <div className={styles.tblWrap}>
                      <table className={styles.tbl}>
                        <thead>
                          <tr>
                            <th>客户</th>
                            <th className={styles.num}>张数</th>
                            <th className={styles.num}>金额</th>
                            <th className={styles.num}>占比</th>
                            <th className={styles.num}>这次波及</th>
                          </tr>
                        </thead>
                        <tbody>
                          {custView.rows.map((r) => (
                            <tr key={r.cust} data-testid={`c0828-cust-${r.cust}`}>
                              <td>{r.cust}</td>
                              <td className={styles.num}>{r.orders}</td>
                              <td className={styles.num}>{fmtMoney(r.value, "元")}</td>
                              <td className={styles.num}>{pct(r.share)}</td>
                              <td className={styles.num}>
                                {r.touchedOrders === 0 ? (
                                  <span className={styles.na}>—</span>
                                ) : (
                                  <span className={styles.late}>{r.touchedOrders} 张</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <details className={styles.more}>
                      <summary>这张表怎么来的</summary>
                      <div className={styles.moreBody}>
                        按对象层订单的客户名分组，把成交额加起来排序。占比的分母是订单簿合计。
                        「这次波及」= 该客户名下有几张单在这次推演里读数真的变了。
                        客户对象上另有信用额度与应收数，但它们的单位今天没有登记册说得清，故不摆上屏。
                      </div>
                    </details>
                  </div>

                  <div>
                    <h4 className={styles.subHead}>
                      <span className={styles.dot} style={{ background: "var(--c-capacity)" }} />
                      {money.bookOrders} 张单在哪一段
                    </h4>
                    <div className={styles.stat}>
                      {custView.statusDist.map((s) => (
                        <div key={s.status} className={styles.statCell} data-testid={`c0828-status-${s.status}`}>
                          <span className={`${styles.statVal} ${styles.mono}`}>{s.n}</span>
                          <span className={styles.statKey}>{s.label}</span>
                          <span className={`${styles.statKey} ${styles.mono}`}>
                            {pct(money.bookOrders === 0 ? 0 : s.n / money.bookOrders)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.risk}>
                      <div className={styles.statKey} style={{ marginBottom: 7 }}>
                        这次扰动波及
                      </div>
                      <ul className={styles.riskList}>
                        <li>
                          <span>被推动的单</span>
                          <span className={styles.late}>{money.exposedOrders} 张</span>
                        </li>
                        <li>
                          <span>涉及客户</span>
                          <span className={styles.mono}>
                            {custView.touchedCustomers} / {custView.totalCustomers} 家
                          </span>
                        </li>
                        <li>
                          <span>合计敞口</span>
                          <span className={styles.late}>{fmtMoney(money.exposure, "元")}</span>
                        </li>
                      </ul>
                      <details className={styles.more} style={{ marginTop: 8 }}>
                        <summary>为什么不写「会晚几张」</summary>
                        <div className={styles.moreBody}>
                          推演层的订单只有 0–100 的压力数，没有一格是交付日期；
                          「晚几天」要拿压力数折算成天，而这个折算今天没有出处。
                          故这里只说「被推动」——那是读数真的变了，可核对；「会晚」是推断，今天给不出。
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* ══ 区④ 哪儿会出事 ══ */}
            <section className={styles.panel} data-testid="c0828-impediment">
              <div className={styles.head}>
                {zone("4", "哪儿会出事")}
                <h3 className={styles.headTitle}>全流程卡点与堵点</h3>
                <span className={styles.headRight}>
                  {impGroups === null ? "这一跳没走通" : `扫出 ${impGroups.all.length} 处`}
                </span>
              </div>

              {result.impedimentError !== null ? (
                <div className={styles.warnBox} data-testid="c0828-imp-error">
                  卡点这一跳没走通：{result.impedimentError}
                  <br />—— 这是<b>没问出来</b>，不是「没有卡点」。两者处置相反，故分开说。
                </div>
              ) : impGroups === null ? (
                <p className={styles.empty}>这次没有取到卡点。</p>
              ) : (
                <>
                  <div className={styles.two}>
                    <div>
                      <h4 className={styles.subHead}>
                        <span className={styles.dot} style={{ background: "var(--accent)" }} />
                        能动的 {impGroups.actionable.length} 处
                      </h4>
                      {impGroups.actionable.length === 0 ? (
                        <p className={styles.empty}>一处也没有 —— 这次扫出来的卡点今天都没有对策。</p>
                      ) : (
                        <ul className={styles.fixList}>
                          {impGroups.actionable.slice(0, 6).map((i) => (
                            <li key={i.impedimentId} data-testid={`c0828-fix-${i.impedimentId}`}>
                              <span>{i.locus.label}</span>
                              <button
                                type="button"
                                className={styles.btn}
                                onClick={() => setPickedFix(i.impedimentId)}
                              >
                                {i.candidates.length} 种改法 ▸
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h4 className={styles.subHead}>
                        <span className={styles.dot} style={{ background: "var(--c-forecast)" }} />
                        只能盯着的 {impGroups.watchOnly.length} 处
                      </h4>
                      <div className={styles.watch} data-testid="c0828-watchonly">
                        {impGroups.watchOnly.length === 0 ? (
                          "这次每一处都有对策。"
                        ) : (
                          <>
                            最严重的是 <b>{impGroups.watchOnly[0]?.locus.label ?? "—"}</b>
                            {impGroups.watchOnly.length > 1 ? <> 与 <b>{impGroups.watchOnly[1]?.locus.label}</b></> : null}
                            ，今天没有对策。
                            <div style={{ marginTop: 5 }}>
                              这 {impGroups.watchOnly.length} 处今天一条对策也给不出 ——
                              <b> 这本身是结论，不是页面没加载出来。</b>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 时间线：按**拍**，不按天 */}
                  <div className={styles.tl}>
                    <div className={styles.statKey} style={{ marginBottom: 12, fontWeight: 600 }}>
                      这 {horizon} 拍里，世界从第 {result.beforeTick} 拍走到第 {result.afterTick} 拍
                    </div>
                    <div className={styles.tlWrap}>
                      <div className={styles.track}>
                        <div className={styles.trackLine} />
                        {Array.from({ length: Math.min(horizon + 1, 8) }, (_, k) => {
                          const t = result.beforeTick + k;
                          const left = `${(k / Math.max(1, Math.min(horizon, 7))) * 92 + 4}%`;
                          return (
                            <div key={t} className={styles.pt} style={{ left }}>
                              <div className={`${styles.ptMark} ${k === 0 ? styles.ptFirst : ""}`} />
                              <div className={styles.ptTick}>第 {t} 拍</div>
                              <div className={styles.ptWord}>{k === 0 ? "施加那一拍" : "推进"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <details className={styles.more}>
                      <summary>为什么写「拍」不写「天」</summary>
                      <div className={styles.moreBody}>
                        设计稿那条时间线写的是「第 2 天 / 第 8 天 …往后 30 天」。
                        推演世界的时间单位是「拍」，而「一拍等于几天」今天全平台没有登记册。
                        把拍直接读成天，屏上会好看，但那是编出来的换算，故这里只写拍。
                      </div>
                    </details>
                  </div>
                </>
              )}
            </section>

            {/* ══ 区⑤ 对策看板 ══ */}
            {impGroups !== null && impGroups.all.length > 0 ? (
              <section className={styles.panel} data-testid="c0828-board">
                <div className={styles.head}>
                  {zone("5", "一共有哪些对策")}
                  <h3 className={styles.headTitle}>对策看板 · {impGroups.all.length} 处卡点</h3>
                  <span className={styles.headRight}>按严重度排序 · 系统不给推荐</span>
                </div>
                <div className={styles.tblWrap}>
                  <table className={styles.board}>
                    <thead>
                      <tr>
                        <th>卡在哪</th>
                        <th className={styles.num}>严重度</th>
                        <th className={styles.num}>改法</th>
                        <th className={styles.num}>实测 / 红线</th>
                        <th className={styles.num}>判据</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {[...impGroups.all]
                        .sort((a, b) => b.severity - a.severity)
                        .slice(0, 12)
                        .map((i) => (
                          <tr
                            key={i.impedimentId}
                            data-dim={i.candidates.length === 0 ? "1" : "0"}
                            data-testid={`c0828-row-${i.impedimentId}`}
                          >
                            <td>{i.locus.label}</td>
                            <td className={styles.num}>{i.severity.toFixed(0)}</td>
                            <td className={styles.num}>
                              {i.candidates.length === 0 ? (
                                <span className={styles.na}>0 种</span>
                              ) : (
                                `${i.candidates.length} 种`
                              )}
                            </td>
                            <td className={styles.num}>
                              {i.evidence.metricValue.toFixed(2)} / {i.evidence.threshold.toFixed(2)}
                              {i.evidence.unit === "" ? "" : ` ${i.evidence.unit}`}
                            </td>
                            <td className={styles.num}>
                              {i.evidence.ruleKey ?? <span className={styles.na}>—</span>}
                            </td>
                            <td className={styles.num}>
                              {i.candidates.length === 0 ? (
                                <span className={styles.na}>没有对策</span>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.btn}
                                  onClick={() => setPickedFix(i.impedimentId)}
                                >
                                  看四栏 ▸
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <details className={styles.more}>
                  <summary>这块看板的诚实边界</summary>
                  <div className={styles.moreBody}>
                    {impGroups.model.notes.length === 0
                      ? "引擎这次没有附带诚实边界说明。"
                      : impGroups.model.notes.map((n) => <p key={n}>{n}</p>)}
                    <p>
                      能动 {impGroups.actionable.length} 处 · 只能盯着 {impGroups.watchOnly.length} 处。
                      排序用的是引擎给的严重度，系统不给推荐 —— 排序可换，选择是你的。
                    </p>
                  </div>
                </details>
              </section>
            ) : null}

            {/* ══ 区⑤b 四栏方案 ══ */}
            {picked !== null ? (
              <section className={styles.panel} data-testid="c0828-options">
                <div className={styles.head}>
                  {zone("5", "有几条路")}
                  <h3 className={styles.headTitle}>
                    {picked.locus.label} · {picked.candidates.length} 种改法
                  </h3>
                  <span className={styles.headRight}>系统不给推荐 —— 选择是你的</span>
                </div>
                <div className={styles.opts} data-testid="c0828-opt-grid">
                  {picked.candidates.slice(0, 3).map((c) => (
                    <div key={c.candidateId} className={styles.opt} data-testid={`c0828-opt-${c.candidateId}`}>
                      <h5 className={styles.optTitle}>{c.label}</h5>
                      <div className={styles.dims}>
                        <span className={styles.dimKey}>动哪个</span>
                        <span className={styles.dimVal}>{c.rung.label}</span>
                        <span className={styles.dimKey}>怎么连上</span>
                        <span className={styles.dimVal}>{c.join.label}</span>
                        <span className={styles.dimKey}>效果</span>
                        <span className={`${styles.dimVal} ${styles.mid}`}>{c.effect.label}</span>
                      </div>
                      <div className={styles.saves}>
                        <span className={styles.savesTitle}>它凭什么</span>
                        <details className={styles.more}>
                          <summary>依据</summary>
                          <div className={styles.moreBody}>
                            <p>{c.rung.why}</p>
                            <p>{c.join.why}</p>
                            <p>{c.effect.why}</p>
                          </div>
                        </details>
                      </div>
                      <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.pick}`}>
                        就这么办
                      </button>
                    </div>
                  ))}

                  {/* ⚠ 第四栏是设计核心，**不许省** */}
                  <div className={`${styles.opt} ${styles.optNone}`} data-testid="c0828-opt-donothing">
                    <h5 className={styles.optTitle}>什么都不做</h5>
                    <div className={styles.dims}>
                      <span className={styles.dimKey}>多久见效</span>
                      <span className={`${styles.dimVal} ${styles.na}`}>——</span>
                      <span className={styles.dimKey}>代价</span>
                      <span className={`${styles.dimVal} ${styles.na}`}>见下</span>
                      <span className={styles.dimKey}>风险</span>
                      <span className={`${styles.dimVal} ${styles.na}`}>——</span>
                    </div>
                    <div className={styles.saves}>
                      <span className={styles.savesTitle}>这一处会继续超线</span>
                      <ul className={styles.savesList}>
                        <li>
                          <span>实测</span>
                          <span className={styles.late}>{picked.evidence.metricValue.toFixed(2)}</span>
                        </li>
                        <li>
                          <span>红线</span>
                          <span>{picked.evidence.threshold.toFixed(2)}</span>
                        </li>
                        <li>
                          <span>超出</span>
                          <span className={styles.late}>{picked.evidence.breach.toFixed(2)}</span>
                        </li>
                      </ul>
                      <div className={styles.tot}>
                        被推动的订单敞口 <span className={styles.totBig}>{fmtMoney(money.exposure, "元")}</span>
                        <br />
                        <span className={styles.calibre}>{money.exposedOrders} 张单还在这条路上</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className={styles.calibre} data-testid="c0828-donothing-note">
                  第四栏没有按钮 —— 什么都不做不需要按钮，它是默认发生的。
                  它存在的理由：没有它，前三栏的代价看起来都是净支出；有了它，前三栏才有参照。
                </p>
              </section>
            ) : null}

            {/* ══ 诚实位 · 贯穿全屏 ══ */}
            <p className={styles.pgFoot} data-testid="c0828-honesty">
              〔估〕= 推演投影，不是实测。<span className={styles.nocalc}>删除线</span> = 这次算不出来，
              不是 0，也不是「无变化」。
              <details className={styles.more}>
                <summary>这次推演是怎么算的</summary>
                <div className={styles.moreBody}>
                  {result.disclosure === null ? (
                    <p>后端这次没有给披露层 —— 「没要到」不是「没有」。</p>
                  ) : (
                    <>
                      <p>
                        引用的数据：对象 {result.disclosure.objects ?? "—"} 个 · 关系{" "}
                        {result.disclosure.links ?? "—"} 条。
                      </p>
                      <p>
                        走过的本体切片：{result.disclosure.sliceKey ?? "—"} · 跳数{" "}
                        {result.disclosure.hops ?? "—"}。
                      </p>
                      <p>
                        命中的规则：已声明 {result.disclosure.rulesDeclared ?? "—"} 条，本次触发{" "}
                        {result.disclosure.rulesFired ?? "—"} 条；其中系数来自配置的{" "}
                        {result.disclosure.withCoefficientRef ?? "—"} 条 —— 其余是内联常数。
                      </p>
                      <p>
                        是否调用 agent：
                        {result.disclosure.agentInvoked === null
                          ? "这次没给这一项"
                          : result.disclosure.agentInvoked
                            ? "调用了"
                            : "本次未调用 agent"}
                        。耗时合计 {result.disclosure.totalMs ?? "—"} 毫秒。
                      </p>
                    </>
                  )}
                  <p>
                    公式、口径、机器编号、规则码全部收在这一层，第一层只放结论。
                  </p>
                </div>
              </details>
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
