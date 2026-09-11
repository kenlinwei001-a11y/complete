/**
 * ══ WO-SIM-CONSOLE-0828 · 「推演与对策」控制台（2026-08-28 设计稿的六块屏）══════════
 *
 * 设计稿：`docs/design/UI-sim-console-20260828.html`
 *   md5 `b6e2ce7b365e4d3d7ca01135db83e426` · 38,215 字节
 *   金丝雀（自证读的是原稿）：「算 一 下」「什么都不做」「落在谁头上」三串都在。
 *   ⚠ **那三串是稿子里的字，不是今天屏上的字**：WO-C0828-VOICE 已把屏上文案整体升到
 *   台账语域（「算 一 下」→「开始推演」·「什么都不做」→「不处置」·「落在谁头上」→
 *   「客户与订单敞口」）。仓主原话：「非常不专业，不符合企业级系统的要求」。
 *   **金丝雀仍按稿子原文核**，改了它就再也证明不了「我读的是原稿」。
 *
 * ── 它替换的是什么 ───────────────────────────────────────────────────────────
 * 同一条 route `v/sim-unified` 的**默认视图**。今天那套 8 页签工作台**没有删**，
 * 退到左栏页脚的「专家模式 ▸」后面，两者**共用同一个会话与同一份查询缓存**
 * （`sessionId` 由 `UnifiedSimShell` 一处解析后透下来；取数用的是与工作台**逐字相同**的
 * `queryKey`，故切过去不会重新发一遍请求）。
 * 这不是我加的分层 —— 稿子左栏页脚自己写着：
 *   > 「其余 12,675 个对象只在**结果里**出现，不进选择器 …… **专家模式 ▸**」
 *
 * ── 「开始推演」这一下到底做了什么（稿上那句「用户不需要知道这是五次调用」）──────
 *   ① `simWorld`      读**扰动前**的世界（差分的基准）
 *   ② `createSimPerturbation` × N   把左栏那 N 件事逐条施加
 *   ③ `simTick(n, disclose:true)`   推 N 拍，并要**披露层**（规则/切片/耗时/是否调 agent）
 *   ④ `simWorld`      读**扰动后**的世界
 *   ⑤ `runSolver("chain_impediments")` 出卡点与对策
 * 五步在一个 mutation 里顺序跑完，屏上只有一个按钮。
 *
 * ── 时间一律给**真实日期**，「第 N 拍」作括注（WO-C0828-VOICE，仓主 2026-09-11）──────
 * 仓主原话：「里面的『从几拍』起，太模糊了，为何不调整为日期呢？」，并裁决
 * **起点用「推演发起的那一天」**。换算实现与三态处置见 `console0828Model.ts`
 * 的 `buildTickCalendar` / `tickDateISO` / `tickLabel` 头注 —— 这块屏只做取数与渲染。
 *
 * ── ⚠ 三条实测教训，直接写进了本文件的行为（不是注释里的客套）
 * **三条均实测于 2026-09-10**（真后端 `SEED_DEMO=1`）；复验入口：`POST /a/v1/sim/sessions/:id/perturbations`
 * 与 `POST /a/v1/sim/sessions/:id/tick`，逐条比对施加前后同一格读数。─────────────────
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
import { Fragment, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PropagationRulesResponse, SandboxViewConfig } from "@platform/contracts";
import {
  createSimPerturbation,
  fetchAllObjects,
  fetchPropagationRules,
  fetchSimPerturbations,
  fetchSimSessions,
  fetchSimViewConfig,
  proposeSimCandidates,
  runSolver,
  simTick,
  simWorld,
  type SimProposalResponse,
} from "@/api/endpoints";
import { BASE_REGISTRY } from "@platform/contracts";
import { formatScope } from "../../chainImpediment";
import {
  BUSINESS_EVENTS,
  LANDING_ABSENCE_TEXT,
  resolveLanding,
  type BusinessEvent,
  type CatalogCanary,
  type LandingState,
} from "./eventCatalog";
import {
  BIZ_EFFECT,
  BIZ_JOIN,
  BIZ_RUNG,
  buildCustomerView,
  buildMoneyView,
  buildTickCalendar,
  IMPEDIMENT_KIND_PLAIN,
  diffWorld,
  fmtMoney,
  NOCALC_WHY,
  ORDER_STATUS_TEXT,
  tickDateISO,
  tickLabel,
  type CellDelta,
  type OrderRow,
  type TickCalendar,
  type WorldCells,
} from "./console0828Model";
import {
  buildChainImpedimentModel,
  ChainImpedimentPayloadSchema,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  type ChainImpedimentModel,
} from "../../chainImpediment";
import styles from "./Console0828.module.css";

/** 左栏「已添加 N 件扰动事件」里的一条 —— **还没提交**，提交发生在「开始推演」。 */
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

/** 一次「开始推演」的产物。 */
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

/**
 * WO-AGENT-INTO-SIM · 出方案用哪个 agent。
 *
 * 用出厂 analyst（`agt_seed_analyst`，`mocks/seed.ts` 的 key=`analyst`·version=1）——
 * 它是全对象域 / 全工具的那一个，也是场景入口 `scn_graph` 已经绑着的默认 agent。
 * ⚠ 这里**不做 agent 选择器**：本单要证明的是「这条链通不通」，
 *   而「让用户挑哪个 agent 出方案」是另一个产品决策（谁有权用哪个 agent 是 authz 的事）。
 *   写死一个 + 把它的 key 印在屏上（`provenance.agentId`），比给一个空下拉诚实。
 */
const AGENT_FOR_PROPOSALS = "agt_seed_analyst";

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

  /** 六类「叫得出名字的实体」——条数**现算**，不写死稿上那 6 个数。 现算于渲染期；（**实测于 2026-09-10**；复验：`GET /a/v1/objects?type=Base` 等五型读 `total`，2026-09-10 实测 13/20/15/8/6） */
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

  /**
   * ══ 顶栏 · 范围选择器（设计稿「常州 · 全网」那半截）════════════════════════════
   *
   * ── 今天的行为是 X ──
   * `runSolver(chain_impediments, { scope: {} })` —— **写死空 scope**，屏上只好写
   * 「本次扫描范围未限定 ⇒ 结果是全域的」。那句话本身没错，但它描述的是一个
   * **前端自己造成**的限制，不是引擎的限制。
   *
   * ── 应该是 Y ──
   * 引擎**收** `scope.baseIds` 且**真的裁**。2026-09-10 本机对照实验（datacore :48317，
   * `POST /a/v1/solvers/chain_impediments/invoke`）：
   *   · `scope={}`                      → 18 处卡点，落点含 常州 / 枣庄 / 武汉 / 自贡分容线 / 金华分切线
   *   · `scope={baseIds:["changzhou"]}` → 14 处卡点，**常州在、枣庄与武汉不在**
   *   · `scope={baseIds:["zaozhuang"]}` → 14 处卡点，**枣庄在、常州不在**
   * 三次 `scopeUnscoped` 依次为 true / false / false，且 `scope` 原样回带。
   * ⇒ 这不是「选了不生效」的装饰控件，选择**真的改变结论集**。
   *
   * ⚠ **「往后 30 天」那半截刻意不做**：推演世界的时间单位是「拍」，而「一拍等于几天」
   *   全平台没有登记册；把拍读成天就是造口径（与区④ 时间线同一条纪律，屏上已有原话）。
   *   横轴长度由左栏「推几拍」控制，那是**真的**有出处的那个量。
   *
   * ⚠ 基地清单取自 `BASE_REGISTRY` 单源（13 个），**前端不另抄一份**；
   *   `null` = 未限定，**不等于**「全选 13 个」—— 后者会把「归属 UNKNOWN」的落点漏掉。
   */
  const [scopeBaseId, setScopeBaseId] = useState<string | null>(null);

  /**
   * ══ 顶栏 · 会话恢复（设计稿「上次这条推演 · 已恢复」）════════════════════════════
   *
   * ── 今天的行为是 X ──
   * 屏上**没有对应物**。刷新一次页面，左栏回到「还没有加任何事」，
   * 而这条推演在**服务端**其实是有历史的 —— 用户看不到，只能以为自己在从零开始。
   *
   * ── 应该是 Y ──
   * `GET /a/v1/sim/sessions/:id/perturbations` **落盘可查**。2026-09-10 本机实测该会话
   * （`sims_demo_seed_world`，curTick=3）回 **1 条**：`sims_demo_seed_world_p0` ·
   * kind=`demand_shift` · startTick=1 · 「种子扰动 · 把「短缺风险」抬高一个全距(+100)…」。
   * ⇒ 这是**真的服务端状态**，不是前端编的一个「已恢复」贴纸。
   *
   * ⚠ 措辞必须扛得住追问：屏上写的是「**这条推演上次留下 N 件事**（服务端记着的）」，
   *   **不是**「你上次的输入已经帮你填回来了」—— 后者是假的：左栏那份待施加清单
   *   （`staged`）纯属本次浏览器内的草稿，从来不落盘，也**不该**被这条冒充。
   *   两者是不同的东西，混在一起就是一个会说谎的诚实位。
   */
  const restoredQ = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  const restored = restoredQ.data?.items ?? [];

  /**
   * ══ 时间轴口径 · 拍 → 真实日期（WO-C0828-VOICE）════════════════════════════════
   *
   * ── 今天的行为是 X ──
   * 屏上从头到尾只写「第 N 拍」，且第二层给了一句**站不住的理由**：
   *   > 「『一拍等于几天』今天全平台没有登记册。」
   *
   * ── 应该是 Y ──
   * 换算要的两个量**就在同一个对象上**：`SimSession.createdAt` + `SimSession.tickDays`
   * （两者都在 `packages/contracts/src/sim.ts` 的 `SimSessionSchema` 里；本单开工逐个打开读过，
   * 不是照抄注释）。本机实测本租户那条会话回的是
   * `{createdAt:"2026-01-01T00:00:00.000Z", tickDays:1, curTick:3}`。
   * ⇒ 后端零改动，缺的只是这块屏没挂上去。
   *
   * ⚠ **复用工作台那一份缓存**（`["a","sim-sessions"]` 与 `UnifiedSimShell` 的 `sessionsQ`
   *   逐字相同）⇒ 这里不会多发一次请求，也不会出现「两处各查一次、答案还不一样」。
   *
   * ⛔ 取不到会话 / `createdAt` 解析不出来时 `cal` 为 `null` ⇒ 屏上**退回「第 N 拍」并说明原因**，
   *   绝不拿「今天」顶上：那属于三态里的「**没取到**」，与「没有」处置相反 ——
   *   而且编出来的日期错一整年也不会有任何东西报错。
   */
  const sessionsQ = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  const sessionRow = useMemo(
    () => (sessionsQ.data?.items ?? []).find((s) => s.id === sessionId),
    [sessionsQ.data, sessionId],
  );
  const cal: TickCalendar | null = useMemo(
    () => buildTickCalendar(sessionRow?.createdAt, sessionRow?.tickDays),
    [sessionRow],
  );
  /** 当前是第几拍（表单里「留空 = 当前拍」要回显它等于哪一天）。 */
  const curTick = sessionRow?.curTick ?? null;
  /** `cal` 为 `null` 时屏上那句话 —— **说清是哪一种「没有」**。 */
  const calShortfall: string | null =
    cal !== null
      ? null
      : sessionsQ.isPending
        ? "会话口径读取中，日期稍后显示。"
        : sessionsQ.isError
          ? "会话口径没取到，故时间一律按拍显示（「没取到」不是「没有起始日」）。"
          : "这条会话没回起始日，故时间一律按拍显示 —— 不按当天倒推，倒推出来的日期无从核对。";

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

  /* ── 「开始推演」——五步一次走完 ───────────────────────────────────────── */
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
        // 范围**由顶栏选择器给**，不再写死 `{}`。`null` = 未限定（全域）。
        // ⛔ 不许在这里编一个默认基地：未限定与「默认某个基地」是两个不同的结论集。
        const scope = scopeBaseId === null ? {} : { baseIds: [scopeBaseId] };
        const res = await runSolver(CHAIN_IMPEDIMENT_SOLVER_KEY, { scope });
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
    const raw = all.filter((i) => i.candidates.length === 0);

    /**
     * ── 「只能盯着」的排序尺子：**超线倍数**，不是 severity ──────────────────────
     *
     * ⚠ 这不是审美选择，是 severity **在这一段没有区分度**（本机实测，非读码推断）：
     *   14 处里有 **2 处 severity 双双封顶 100**（常州 / 枣庄）⇒ 谁排第一由数组顺序决定，
     *   而数组顺序是引擎分组的副产物，不承载「哪个更要紧」。
     *   于是屏上那句「最严重的是 X 与 Y」其实是**在报一个任意顺序**，而它读起来像个结论。
     *
     *   形态（铁律 0.6 句式）：
     *   **「我用『它排在数组第一个』当作『它最要紧』的证据，而前者并不度量后者。」**
     *
     * 换成 `metricValue / threshold`（超出红线多少倍）：两者当场分开 —— 实测
     * 常州 3974.32/1760 = 2.26×，枣庄 2985.92/620 = 4.82×。两个数都是引擎给的真值，
     * 比值是纯算术，**没有引入任何新口径**。
     *
     * ⛔ 为什么**不**按「敞口金额 × 频次」排（那才是业务上最该用的尺子）：
     *   `chain_impediments` 的每条记录里**根本没有金额**（字段只有 locus / severity /
     *   evidence{metricValue,threshold,unit,ruleKey}）。屏上那个 454.6 亿是**订单簿总额**，
     *   是全局量，把它摊到某一处卡点头上就是**编一个不存在的归因** —— 那正是本仓最忌的造数。
     *   ⇒ 今天能诚实做到的最好排序就是超线倍数；金额排序要等引擎给出逐卡点敞口，另立单。
     *   这条缺口写在屏上（见下「这把尺子是什么」），不藏着。
     */
    const ratioOf = (i: (typeof raw)[number]): number => {
      const t = i.evidence.threshold;
      // 红线为 0 时比值无定义（除零）——退回 severity，且**不假装**它有区分度。
      return t === 0 ? Number.NEGATIVE_INFINITY : i.evidence.metricValue / t;
    };
    const watchOnly = [...raw].sort((a, b) => ratioOf(b) - ratioOf(a) || b.severity - a.severity);
    const severityTied = raw.filter((i) => i.severity >= 100).length;
    return { all, actionable, watchOnly, model: m, ratioOf, severityTied };
  }, [result]);

  const picked = useMemo(() => {
    if (impGroups === null) return null;
    const id = pickedFix ?? impGroups.actionable[0]?.impedimentId ?? null;
    return impGroups.actionable.find((i) => i.impedimentId === id) ?? impGroups.actionable[0] ?? null;
  }, [impGroups, pickedFix]);

  /* ══ WO-C0828-VOICE · 「N 种对策 ▸」点了没反应 —— 三条病因叠在一起 ═══════════════
   *
   * 仓主实拍反馈「点了没反应」。逐条核过，**三条都成立，缺一条都修不好**：
   *  ① **面板在一屏之外**：按钮 y≈803–968，四栏面板 y≈1800 —— 相距约 997px，
   *     而一屏约 800px。点了确实"什么都没发生"，因为发生的事在屏幕外面。
   *  ② **点第一项是真的什么都不发生**：`picked` 的默认值就是 `actionable[0]`，
   *     点它时 `pickedFix` 从 `null` 变成它自己的 id，`picked` **前后完全相同**，
   *     React 连一次重渲染的可见差异都没有。
   *  ③ **没有选中态**：几个按钮长得一模一样，点完也认不出面板画的是哪一处。
   *
   * ── 修法与取舍 ──────────────────────────────────────────────────────────
   * · ① 选**点完滚进视野**，⛔ 没有把四栏面板挪到区④ 之后：那样会让区号变成
   *   4 → 5b → 5 → 5c，把「先看全量看板、再看某一处的四条路」这个阅读顺序打乱；
   *   而区⑤ 看板里的「查看对策 ▸」也指向同一块面板，挪上去就轮到它跨屏了 —— 病灶换个人得。
   * · ③ 的选中态**从 `picked` 派生，不从 `pickedFix`** —— 这样默认那一项一进来就标着选中，
   *   因为面板画的**本来就是**它。拿 `pickedFix`（初值 `null`）当判据的话，
   *   屏上会出现「面板画着 A，而 A 没被标选中」这种自相矛盾。
   * · ② 因此自动闭合：点第一项 ⇒ 仍然滚动 + 选中态成立，反馈与点别的项一模一样。
   */
  const optionsRef = useRef<HTMLElement | null>(null);
  const revealFix = (impedimentId: string): void => {
    setPickedFix(impedimentId);
    // 面板要等这一次 state 落地后才在正确的位置上 —— 故推到下一帧再滚。
    // ⚠ `?.` 不是客套：jsdom 不实现 `scrollIntoView`，少了它接缝门会红在一个与本单无关的地方。
    requestAnimationFrame(() => {
      optionsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  };

  /**
   * 一处卡点的**辨识串** —— 光有 `locus.label` 不够。
   *
   * 本机实测（真后端 `SEED_DEMO=1`，`POST /a/v1/solvers/chain_impediments/invoke` 18 处）：
   * **5 个标签各自出现 2 次**（电解液 / 铜箔 / 磷酸铁锂正极 / 三元正极 / 石墨负极）。
   * 逐条追到底，重名的两行**既不是同一对象的两条判据，也不只是两个实例**，而是两者同时：
   *   · `磷酸铁锂正极` ① `MaterialBatch·pos_lfp_b2`  判据 `C28`（批次滞留）
   *   · `磷酸铁锂正极` ② `MaterialBalance·mbal-2`    判据 `C06`（物料缺口）
   * 两个**不同对象类型**的不同实例，恰好共用同一个物料名当 `label`。
   * ⇒ 判据码与落点实例**两样都给**才真的分得开：只给判据码，将来同判据同名的两行又会撞；
   *   只给实例 id，`C28`/`C06` 这层「为什么它算卡点」就丢了（看板里那一列正是它）。
   * ⛔ 不加「①②」这种序号：序号不解释任何东西，只是把重名藏起来。
   */
  const fixTag = (i: { readonly evidence: { readonly ruleKey: string | null }; readonly locus: { readonly objectId: string } }): string =>
    `判据 ${i.evidence.ruleKey ?? "未给"} · 落点 ${i.locus.objectId}`;

  /* ── WO-AGENT-INTO-SIM · 「让 agent 想想办法」──────────────────────────────────
   *
   * 落点是**只能盯着的那几处**：引擎枚举跑完了、结论是本体上没有可拨的杠杆
   * （`candidates.length === 0`）。那句「今天一条对策也给不出」本身是结论，不是加载失败 ——
   * 但它是**引擎这一条路**的结论，不是「这件事没救」。agent 的价值正在这里：
   * 它读同一份世界态与同一份杠杆菜单，去凑一组**引擎枚举器没往那儿看**的组合。
   *
   * ⚠ 三条纪律，缺一条这块屏就开始说谎：
   *  ① **agent 不产数**：回来的只有 {leverIndex,valueIndex} 下标，数值一律从后端兑现好的
   *    `request.levers` / `menu.levers` 里取，前端一个数都不算。
   *  ② **产地必须上屏**：`provenance.agentInvolved` 为 false 时回的是**确定性兜底**，
   *    此时必须写明「本次未调用 agent」+ 原因，**不许**当成 agent 的产出摆着。
   *  ③ **一处一问**：`agentFor` 记的是「问的是哪一处卡点」，换一处要重新问 ——
   *    否则 A 处的方案会挂在 B 处名下（第 4 格对照实验要的正是「没问的那处不许动」）。
   */
  const [agentFor, setAgentFor] = useState<string | null>(null);
  const [agentRes, setAgentRes] = useState<SimProposalResponse | null>(null);
  const [agentErr, setAgentErr] = useState<string | null>(null);
  const agentM = useMutation({
    mutationFn: async (impedimentId: string): Promise<SimProposalResponse> => {
      setAgentFor(impedimentId);
      setAgentErr(null);
      return proposeSimCandidates(sessionId as string, AGENT_FOR_PROPOSALS);
    },
    onSuccess: (r) => { setAgentRes(r); },
    // ⛔ 不静默吞：「没问出来」与「问了但没有方案」处置相反，屏上必须分得开。
    onError: (e: unknown) => { setAgentRes(null); setAgentErr(e instanceof Error ? e.message : String(e)); },
  });

  /** agent 方案 → 四栏表要的那几格。**数值只从后端兑现结果里取**（前端零计算）。 */
  const agentOptions = useMemo(() => {
    const p = agentRes?.proposal;
    if (p === undefined || agentRes?.applicable !== true) return null;
    return p.draft.options.map((o, idx) => ({
      id: `agent-${String(idx)}`,
      name: o.name,
      rationale: o.rationale,
      // 「动哪个 / 动到几档」：逐条从菜单里把 agent 挑的那一档的**数值**取出来。
      moves: o.picks.map((pk) => {
        const lv = p.menu.levers[pk.leverIndex];
        return {
          key: lv?.key ?? `杠杆#${String(pk.leverIndex)}`,
          label: lv?.label ?? lv?.key ?? `杠杆#${String(pk.leverIndex)}`,
          value: lv?.values[pk.valueIndex] ?? null,
          slot: `第 ${String(pk.valueIndex + 1)} / ${String(lv?.values.length ?? 0)} 档`,
        };
      }),
    }));
  }, [agentRes]);

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */
  const zone = (n: string, t: string): JSX.Element => (
    <span className={styles.zoneTag}>
      <span className={styles.zoneNum}>{n}</span>
      {t}
    </span>
  );

  return (
    <div className={styles.shell} data-testid="c0828-shell">
      {/* ══ 页内顶栏（设计稿 `.top`）══════════════════════════════════════════
          稿上四样：标题 · 范围 · 订单/客户计数 · 会话恢复。
          计数那两个**这里不重复摆** —— 它们已经在区③/③b 的说明句里，且那里离用到它们的
          地方更近；同一个数在一屏上摆两遍，改一处漏一处就会当场自相矛盾。 */}
      <div className={styles.topbar} data-testid="c0828-topbar">
        <span className={styles.topTitle}>推演与对策</span>

        {/* ── 范围选择器（③）──────────────────────────────────────────── */}
        <label className={styles.scopeBox}>
          <span className={styles.scopeLbl}>范围</span>
          <select
            className={styles.scopeSel}
            data-testid="c0828-scope-select"
            value={scopeBaseId ?? ""}
            onChange={(e) => setScopeBaseId(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">全网（未限定）</option>
            {BASE_REGISTRY.map((b) => (
              <option key={b.baseId} value={b.baseId}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        {/* 引擎**回带**的那个 scope —— 不是我送出去的那个。两者若不一致，这里会当场看得见。 */}
        {result?.impediments != null ? (
          <span className={styles.topTag} data-testid="c0828-scope-echo">
            引擎本次实际扫描范围：<b>{formatScope(result.impediments.scope, result.impediments.scopeUnscoped)}</b>
          </span>
        ) : (
          <span className={styles.topDim} data-testid="c0828-scope-pending">
            范围变更后须重新推演方可生效
          </span>
        )}

        {/* ── 会话恢复（②）───────────────────────────────────────────── */}
        <span className={styles.topRight}>
          {restoredQ.isPending ? (
            <span className={styles.topDim} data-testid="c0828-restore-loading">
              正在查询本会话推演历史…
            </span>
          ) : restoredQ.isError ? (
            <span className={styles.topDim} data-testid="c0828-restore-error">
              本会话推演历史读取失败（不等于「无历史记录」）
            </span>
          ) : restored.length === 0 ? (
            <span className={styles.topDim} data-testid="c0828-restore-none">
              本会话在服务端无扰动记录
            </span>
          ) : (
            <details className={styles.topDetails} data-testid="c0828-restored">
              <summary className={styles.topTag}>
                服务端历史扰动 · 已恢复 <b>{restored.length}</b> 件
              </summary>
              <div className={styles.topPop}>
                <p>
                  这 {restored.length} 件为<b>服务端留存记录</b>（本会话历史上已施加的扰动，刷新不丢失），
                  已计入当前世界态。
                </p>
                <ul className={styles.restoreList}>
                  {restored.map((p) => (
                    <li key={p.id} data-testid={`c0828-restored-${p.id}`}>
                      <b>{p.startTick === null || p.startTick === undefined ? "起始拍未给" : `${tickLabel(cal, p.startTick)} 起`}</b> · {p.label ?? p.kind}
                    </li>
                  ))}
                </ul>
                <p className={styles.calibre}>
                  ⚠ 左栏「待施加清单」是本次会话的<b>本地草稿，不落盘</b> ——
                  它不在本次恢复的内容里，也不可由它代表。两者口径不同。
                </p>
              </div>
            </details>
          )}
        </span>
      </div>

      <div className={styles.wrap} data-testid="c0828-root">
      {/* ══ 区① 左栏 ══ */}
      <aside className={styles.rail} data-testid="c0828-rail">
        {zone("1", "扰动事件")}
        <h2 className={styles.railTitle}>选择扰动事件，推演其叠加影响</h2>

        {staged.length === 0 ? (
          <p className={styles.count} data-testid="c0828-staged-empty">
            尚未添加扰动事件
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
                    aria-label={`移除 ${s.name}`}
                    onClick={() => setStaged((p) => p.filter((x) => x.uid !== s.uid))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <p className={styles.count} data-testid="c0828-staged-count">
              已添加 {staged.length} 件扰动事件
            </p>
          </>
        )}

        <div className={styles.group}>
          <span className={styles.groupLabel}>可继续添加</span>
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
                  /* ⚠ 这里刻意**不加** `disabled`，也**不加**原生 `title=` —— 两者叠在一起制造过一个三重不可见：
                   *  ① 「为什么这件事今天落不了地」的解释写在下面 `c0828-absent-{id}` 面板里；
                   *  ② 那个面板靠**点击**打开，而按钮当时是 `disabled` ⇒ 点不动；
                   *  ③ 兜底的原生 `title` 在 **disabled 元素上多数浏览器根本不渲染**。
                   * ⇒ 解释写好了，用户三条路都看不到 —— 屏上只剩一句「今天落不了地」而说不出为什么。
                   * 现在：落不了地的也点得开，点开就是那条解释（`openForm` 只 set state，
                   * 真正的写口 `addStaged` 另有 `kind !== "ok"` 早退守着，点开不等于加得进去）。
                   * 顺带满足 R-UI-3 / `provenance-popover-legibility` 那条棘轮：口径不进原生 title。 */
                  onClick={() => (isOpen ? setOpenEvent(null) : openForm(ev))}
                >
                  <span>{ev.name}</span>
                  {/* 落不了地时**把理由摆在第一层**，不是一句无信息量的「今天落不了地」——
                      理由是决策信息（它决定你要不要去补那个对象/状态量），该上屏。 */}
                  <span className={styles.evHint}>
                    {ok ? ev.hint : L === undefined ? "还在判定" : LANDING_ABSENCE_TEXT[L.kind as "no-instance" | "no-statevar"]}
                  </span>
                  <span className={styles.evPlus}>{isOpen ? "－" : "＋"}</span>
                </button>

                {/* 就地展开下一级 —— 不跳页、不弹窗（稿子原话） */}
                {isOpen && ok && L !== undefined && L.kind === "ok" ? (
                  <div className={styles.expand} data-testid={`c0828-form-${ev.id}`}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>落点对象</span>
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
                      <span className={styles.fieldLabel}>幅度</span>
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
                      <summary>起始时点与持续时长</summary>
                      <div className={styles.moreBody}>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>起始拍</span>
                          <span className={styles.numRow}>
                            <input
                              type="number"
                              value={startTick}
                              placeholder="留空=当前拍"
                              aria-label="起始拍"
                              onChange={(e) => setStartTick(e.target.value)}
                            />
                            <span className={styles.unit}>拍</span>
                          </span>
                        </div>
                        {/* ⚠ 主输入**仍是拍**，旁边实时回显它等于哪一天。
                            ⛔ 没有把它换成日期选择器：后端收的是 `startTick`，而
                            `tickDays > 1` 时「某一天」落在哪一拍要先定 向上取整还是向下取整 ——
                            那是一条口径决定（引擎侧 `ticksForDays` 用的是 `ceil`），
                            本单不顺手替它拍板。回显解决的是「模糊」这个真问题，且零歧义。 */}
                        <p className={styles.calibre} data-testid="c0828-start-echo">
                          {cal === null
                            ? calShortfall
                            : startTick.trim() === ""
                              ? `留空 = 当前拍（第 ${curTick ?? "?"} 拍${
                                  curTick === null ? "" : ` · ${tickDateISO(cal, curTick) ?? ""}`
                                }）`
                              : Number.isFinite(Number(startTick))
                                ? `= ${tickDateISO(cal, Number(startTick)) ?? "—"}`
                                : "这一格不是数字，无法换算日期"}
                        </p>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>持续</span>
                          <span className={styles.numRow}>
                            <input
                              type="number"
                              value={duration}
                              placeholder="留空=持续生效"
                              aria-label="持续拍数"
                              onChange={(e) => setDuration(e.target.value)}
                            />
                            <span className={styles.unit}>拍</span>
                          </span>
                        </div>
                        {cal !== null && duration.trim() !== "" && Number.isFinite(Number(duration)) ? (
                          <p className={styles.calibre}>= {Number(duration) * cal.tickDays} 天</p>
                        ) : null}
                        <p>
                          两格留空 = 自当前拍起持续生效。若同时填写起始拍与持续拍数，
                          且该窗口已<b>整段落在过去</b>，后端仍会受理（201）而世界态不变 ——
                          该情形后端不返回任何提示，故在此说明。
                        </p>
                        <p>
                          本事件落到 {L.typeKey} 的 {L.stateVar} 上；{ev.detail}
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
                        加入
                      </button>
                      <button type="button" className={styles.btn} onClick={() => setOpenEvent(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}

                {isOpen && !ok && L !== undefined && L.kind !== "ok" ? (
                  <div className={styles.expand} data-testid={`c0828-absent-${ev.id}`}>
                    {/* ⚠ 这一句**单独挂锚点**：接缝门 ②b 要咬的命题是「两种缺失措辞不许一样」，
                        而整块面板的 textContent 里还混着「它找过哪些落点」那段逐事件明细 ——
                        拿整块去比，两种措辞**改成一模一样也照样不相等**，断言等于没咬。
                        （本单实测：把两条措辞改成同一句，门仍然全绿。）*/}
                    <p className={styles.calibre} data-testid={`c0828-absent-why-${ev.id}`}>
                      {LANDING_ABSENCE_TEXT[L.kind]}
                    </p>
                    <details className={styles.more}>
                      <summary>它找过哪些落点</summary>
                      <div className={styles.moreBody}>
                        {L.kind === "no-instance"
                          ? `找过这些对象类型：${L.triedTypes.join(" / ")}，本世界里都没有实例。`
                          : `${L.typeKey} 有实例，但这类对象今天记着的指标里没有这几项：${L.triedVars.join(" / ")}。`}
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
          <span className={styles.fieldLabel}>推演时长</span>
          <span className={styles.numRow}>
            <input
              type="number"
              value={horizon}
              min={1}
              aria-label="推演拍数"
              data-testid="c0828-horizon"
              onChange={(e) => setHorizon(Math.max(1, Number(e.target.value)))}
            />
            <span className={styles.unit}>拍</span>
          </span>
        </div>
        <p className={styles.calibre} data-testid="c0828-horizon-echo">
          {cal === null
            ? calShortfall
            : curTick === null
              ? `= ${horizon * cal.tickDays} 天`
              : `= ${horizon * cal.tickDays} 天，推演至 ${tickDateISO(cal, curTick + horizon) ?? "—"}`}
        </p>
        <button
          type="button"
          className={styles.go}
          data-testid="c0828-go"
          disabled={!enabled || staged.length === 0 || runM.isPending}
          title={
            !enabled
              ? "需先建立推演会话"
              : staged.length === 0
                ? "请先添加至少一件扰动事件"
                : "一次执行：施加扰动 · 推进世界 · 财务影响 · 卡点识别 · 对策生成"
          }
          onClick={() => runM.mutate()}
        >
          {runM.isPending ? "推演中…" : "开始推演"}
        </button>

        <div className={styles.railFoot}>
          <details className={styles.more}>
            <summary>本次推演执行记录</summary>
            <div className={styles.moreBody}>
              一次操作依次执行：施加扰动 · 推进世界 · 财务影响 · 卡点识别 · 对策生成，共五次服务调用。
              主线只列 <b>12 类业务扰动事件</b>；落点限定在具名实体范围内。
              其余对象只在结果中出现，属传播介质，不进入选择器。
            </div>
          </details>
          <div data-testid="c0828-entity-counts">
            落点实体 <b className={styles.mono}>{entityTotal}</b> 个：
            {entityCounts.map((e) => ` ${e.label}${e.n}`).join(" ·")}
          </div>
          {!canary.ok && !cfgQ.isPending && !rulesQ.isPending ? (
            <div className={styles.warnBox} data-testid="c0828-canary-broken">
              12 类扰动事件全部无法落地，而后端规则涉及 {canary.typesInRules} 个对象类型 —— 这是<b>探测失效</b>，
              不是「当前无可添加的事件」。
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
            正在推演往后 {horizon} 拍…
            <span className={styles.bar}>
              <i className={styles.barFill} style={{ width: "62%" }} />
            </span>
          </div>
        ) : null}

        {runM.isError ? (
          <div className={styles.warnBox} data-testid="c0828-run-error">
            本次推演未完成：{runM.error instanceof Error ? runM.error.message : String(runM.error)}
            <br />
            —— 这是<b>本次调用失败</b>，不是「结果为 0」。
          </div>
        ) : null}

        {result === null && !runM.isPending ? (
          <section className={styles.panel} data-testid="c0828-idle">
            <div className={styles.head}>
              {zone("3", "财务影响")}
              <h3 className={styles.headTitle}>尚未推演</h3>
            </div>
            <p className={styles.empty}>
              在左栏添加扰动事件后，点击「开始推演」。
              {ordersQ.data === undefined ? null : (
                <>
                  {" "}
                  当前订单簿合计{" "}
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
                {zone("3", "财务影响")}
                <h3 className={styles.headTitle}>
                  {result.staged.length} 件扰动事件叠加 · 推演至 {tickLabel(cal, result.afterTick)}
                </h3>
                <span className={styles.headRight}>与下方卡点、对策同源于本次推演结果</span>
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
                          本次无法计算
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <p className={styles.why} data-testid="c0828-maincause">
                {money.mainCause === null ? (
                  <><b>多因叠加，无法归因到单一事件</b></>
                ) : (
                  <>主因：<b>{money.mainCause}</b></>
                )}
              </p>

              <details className={styles.more} data-testid="c0828-recon">
                <summary>金额勾稽</summary>
                <div className={styles.moreBody}>
                  <p>
                    「被推动的订单敞口」= 本次推演中读数发生变化的订单，按对象层成交额合计。
                    其口径是「受影响订单的金额规模」，不是「利润损失」—— 后者本次无法计算，见下。
                  </p>
                  <p>
                    订单簿合计 {fmtMoney(money.bookTotal, "元")}，共 {money.bookOrders} 张单（逐页取全后累加，
                    并与服务端返回的总数勾稽）。被推动 {money.exposedOrders} 张，合计 {fmtMoney(money.exposure, "元")}。
                  </p>
                  <p>毛利差额：{NOCALC_WHY.margin}</p>
                  <p>新增成本：{NOCALC_WHY.cost}</p>
                  <p>占压应收：{NOCALC_WHY.receivable}</p>
                  <p>
                    本次共 {result.deltas.length} 格读数发生变化；世界态自 {tickLabel(cal, result.beforeTick)} 推进至{" "}
                    {tickLabel(cal, result.afterTick)}。金丝雀：读取到 {money.ordersSeen} 张单（为 0 表示遍历失效，不是「无波及」）。
                  </p>
                  <p>
                    ⚠ 不应以被扰动格自身的读数判定扰动是否生效：源变量常被约束在域上界附近，
                    即使施加 100 倍量级，源格变动可能仅千分之几，而下游变动显著。本屏波及面按全局差分计算。
                  </p>
                  {result.receipts.length === 0 ? null : (
                    <p>
                      落库回执：
                      {result.receipts.map((r) => ` ${r.name}（起始 ${r.startTick === null ? "未给" : tickLabel(cal, r.startTick)}）`).join(" ·")}
                    </p>
                  )}
                </div>
              </details>
            </section>

            {/* ══ 区③b 落在谁头上 ══ */}
            {custView !== null ? (
              <section className={styles.panel} data-testid="c0828-cust">
                <div className={styles.head}>
                  {zone("3", "客户与订单敞口")}
                  <h3 className={styles.headTitle}>受影响客户与订单</h3>
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
                            <th className={styles.num}>本次波及</th>
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
                      <summary>数据来源</summary>
                      <div className={styles.moreBody}>
                        按对象层订单的客户名分组，合计成交额后排序。占比分母为订单簿合计。
                        「本次波及」= 该客户名下在本次推演中读数发生变化的订单数。
                        客户对象另有信用额度与应收数，其计量单位无登记册可据，故不上屏。
                      </div>
                    </details>
                  </div>

                  <div>
                    <h4 className={styles.subHead}>
                      <span className={styles.dot} style={{ background: "var(--c-capacity)" }} />
                      {money.bookOrders} 张单的状态分布
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
                        本次扰动波及
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
                        <summary>延误张数的缺口说明</summary>
                        <div className={styles.moreBody}>
                          推演层订单仅有 0–100 的压力读数，无交付日期字段；
                          「延误天数」需将压力读数折算为天，而该折算系数无出处。
                          故此处只给「被推动」—— 它对应读数的真实变化，可核对；「延误」属推断，本次给不出。
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
                {zone("4", "受阻环节")}
                <h3 className={styles.headTitle}>全流程扫描结果</h3>
                <span className={styles.headRight}>
                  {impGroups === null ? "本次调用未完成" : `扫出 ${impGroups.all.length} 处`}
                </span>
              </div>

              {result.impedimentError !== null ? (
                <div className={styles.warnBox} data-testid="c0828-imp-error">
                  卡点识别未完成：{result.impedimentError}
                  <br />—— 这是<b>调用失败</b>，不是「无卡点」。二者处置相反，故分列。
                </div>
              ) : impGroups === null ? (
                <p className={styles.empty}>本次未取到卡点数据。</p>
              ) : (
                <>
                  {/* ⚠ 「卡点 / 堵点 / 断点」是引擎回包里 `kind` 的**三个不同取值**，
                      不是一个量的三种叫法（实测 counts = 5 / 6 / 7，三类各有实例）。
                      三者处置相反，故屏上逐类给条数 + 一句可判定含义，⛔ 不合并成一个词。 */}
                  <div className={styles.kinds} data-testid="c0828-kinds">
                    {impGroups.model.groups.map((g) => (
                      <div key={g.kind} className={styles.kindRow} data-testid={`c0828-kind-${g.kind}`}>
                        <span className={styles.kindName}>
                          {g.label} <b className={styles.mono}>{g.items.length}</b> 处
                        </span>
                        <span className={styles.calibre}>{IMPEDIMENT_KIND_PLAIN[g.kind] ?? g.meaning}</span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.two}>
                    <div>
                      <h4 className={styles.subHead}>
                        <span className={styles.dot} style={{ background: "var(--accent)" }} />
                        可处置 {impGroups.actionable.length} 处
                      </h4>
                      {impGroups.actionable.length === 0 ? (
                        <p className={styles.empty}>无 —— 本次扫出的卡点均无可用对策。</p>
                      ) : (
                        <ul className={styles.fixList}>
                          {impGroups.actionable.slice(0, 6).map((i) => {
                            const on = picked?.impedimentId === i.impedimentId;
                            return (
                              <li key={i.impedimentId} data-testid={`c0828-fix-${i.impedimentId}`} data-on={on ? "1" : "0"}>
                                <span>
                                  {i.locus.label}
                                  <br />
                                  <span className={styles.calibre}>{fixTag(i)}</span>
                                </span>
                                <button
                                  type="button"
                                  className={`${styles.btn} ${on ? styles.btnOn : ""}`}
                                  aria-pressed={on}
                                  data-testid={`c0828-fixbtn-${i.impedimentId}`}
                                  onClick={() => { revealFix(i.impedimentId); }}
                                >
                                  {on ? "▾ " : ""}
                                  {i.candidates.length} 种对策 ▸
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h4 className={styles.subHead}>
                        <span className={styles.dot} style={{ background: "var(--c-forecast)" }} />
                        仅可监控 {impGroups.watchOnly.length} 处
                      </h4>
                      <div className={styles.watch} data-testid="c0828-watchonly">
                        {impGroups.watchOnly.length === 0 ? (
                          "本次每一处均有对策。"
                        ) : (
                          <>
                            超线倍数最高的是 <b>{impGroups.watchOnly[0]?.locus.label ?? "—"}</b>
                            {impGroups.watchOnly[0] !== undefined && Number.isFinite(impGroups.ratioOf(impGroups.watchOnly[0]))
                              ? <>（{impGroups.ratioOf(impGroups.watchOnly[0]).toFixed(2)}×）</>
                              : null}
                            {impGroups.watchOnly.length > 1 ? (
                              <> 与 <b>{impGroups.watchOnly[1]?.locus.label}</b>
                                {impGroups.watchOnly[1] !== undefined && Number.isFinite(impGroups.ratioOf(impGroups.watchOnly[1]))
                                  ? <>（{impGroups.ratioOf(impGroups.watchOnly[1]).toFixed(2)}×）</>
                                  : null}
                              </>
                            ) : null}
                            ，当前无对策。
                            <div style={{ marginTop: 5 }}>
                              这 {impGroups.watchOnly.length} 处当前无法给出任何对策 ——
                              <b> 这是推演结论，非加载失败。</b>
                            </div>
                            {/* ══ WO-AGENT-INTO-SIM · 入口就开在这句结论旁边 ══
                                上面那句是**引擎枚举器**的结论（它跑完了，本体上没有可拨的杠杆）。
                                agent 走的是另一条路：读同一份杠杆菜单去凑组合。
                                两条路的结论并列摆着，用户才知道「还有一条没走过的路」。 */}
                            <div style={{ marginTop: 9, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className={styles.btn}
                                data-testid="c0828-ask-agent"
                                disabled={agentM.isPending}
                                onClick={() => { agentM.mutate(impGroups.watchOnly[0]?.impedimentId ?? "watch-0"); }}
                              >
                                {agentM.isPending ? "agent 推演中…" : "交由 agent 生成对策 ▸"}
                              </button>
                              <span className={styles.calibre}>
                                引擎枚举已穷尽；改由 agent 读取同一份杠杆菜单重新生成。
                              </span>
                            </div>
                            {/* ⚠ 收敛这一步必须可审：一次只问**一处**，且要说清「凭什么是这一处」。
                                不写出来的话，屏上看起来就像「agent 替你把所有卡点都想了一遍」，
                                而那是做不到的，也不是这里发生的事。 */}
                            <details className={styles.more} style={{ marginTop: 6 }}>
                              <summary>排序口径说明</summary>
                              <div className={styles.moreBody}>
                                <p>
                                  每次只提交<b>超线倍数最高的那一处</b>（
                                  {impGroups.watchOnly[0]?.locus.label ?? "—"}），不把这
                                  {impGroups.watchOnly.length} 处一并提交 —— 一并提交等同于由 agent 代为排序，
                                  而排序应由使用方依口径判定，系统不给推荐。
                                </p>
                                <p>
                                  排序口径为<b>超线倍数</b>（实测 ÷ 红线），不是严重度：本批有{" "}
                                  <b>{impGroups.severityTied}</b> 处严重度封顶 100，
                                  排名失去区分度 —— 此时「排名第一」只反映数组顺序，不反映轻重。
                                </p>
                                <p>
                                  ⚠ 业务上更适用的排序口径是<b>敞口金额 × 频次</b>，当前<b>给不出</b>：
                                  卡点记录无逐处金额（仅有实测 / 红线 / 单位 / 规则码）。
                                  屏上订单簿总额为<b>全局量</b>，分摊到单处即构造一个不存在的归因，
                                  故不采用，并在此列明该缺口。
                                </p>
                              </div>
                            </details>
                            {agentErr !== null ? (
                              <div className={styles.calibre} style={{ marginTop: 6 }} data-testid="c0828-agent-err">
                                调用失败：{agentErr}
                                <br />—— 这是<b>调用失败</b>，不是「agent 未能给出对策」。二者处置相反，故分列。
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 时间线：主口径给**日期**，拍作括注保留（引擎的量是拍，删干净就两层对不上账）。 */}
                  <div className={styles.tl}>
                    <div className={styles.statKey} style={{ marginBottom: 12, fontWeight: 600 }} data-testid="c0828-tl-head">
                      本次推演 {horizon} 拍：{tickLabel(cal, result.beforeTick)} → {tickLabel(cal, result.afterTick)}
                    </div>
                    <div className={styles.tlWrap}>
                      <div className={styles.track}>
                        <div className={styles.trackLine} />
                        {Array.from({ length: Math.min(horizon + 1, 8) }, (_, k) => {
                          const t = result.beforeTick + k;
                          const left = `${(k / Math.max(1, Math.min(horizon, 7))) * 92 + 4}%`;
                          const iso = tickDateISO(cal, t);
                          return (
                            <div key={t} className={styles.pt} style={{ left }} data-testid={`c0828-tl-pt-${t}`}>
                              <div className={`${styles.ptMark} ${k === 0 ? styles.ptFirst : ""}`} />
                              <div className={styles.ptTick}>{iso ?? `第 ${t} 拍`}</div>
                              <div className={styles.ptWord}>
                                {iso === null ? (k === 0 ? "扰动施加" : "推进") : `第 ${t} 拍${k === 0 ? " · 施加" : ""}`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <details className={styles.more}>
                      <summary>时间轴口径</summary>
                      <div className={styles.moreBody} data-testid="c0828-tl-calibre">
                        {cal === null ? (
                          <p>{calShortfall}</p>
                        ) : (
                          <>
                            <p>
                              日期由<b>本会话的起始日</b>与<b>一拍的天数</b>换算得来，两项都取自会话本身：
                              起始日 <b>{tickDateISO(cal, 0)}</b>（第 0 拍 = 推演发起那一天）· 一拍 ={" "}
                              <b>{cal.tickDays}</b> 天。
                            </p>
                            {cal.tickDays > 1 ? (
                              <p>
                                一拍跨 {cal.tickDays} 天，刻度上标的是<b>该拍的起始日</b> ——
                                扰动按「起始拍」施加，引擎在那一拍的开头吃掉它。
                                第 N 拍覆盖的区间是 [起始日, 起始日 + {cal.tickDays - 1} 天]。
                              </p>
                            ) : null}
                            <p>
                              括号里的「第 N 拍」<b>刻意保留</b>：引擎收发的量就是拍，
                              两层对不上账时要靠它追。
                            </p>
                          </>
                        )}
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
                  {zone("5", "对策清单")}
                  <h3 className={styles.headTitle}>对策看板 · {impGroups.all.length} 处受阻环节</h3>
                  <span className={styles.headRight}>按严重度排序 · 系统不给推荐</span>
                </div>
                <div className={styles.tblWrap}>
                  <table className={styles.board}>
                    <thead>
                      <tr>
                        <th>受阻环节</th>
                        <th className={styles.num}>严重度</th>
                        <th className={styles.num}>对策数</th>
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
                            <td>
                              {i.locus.label}
                              {/* 同名两行靠这一格分开（实测同名标签 5 组 × 2 行）。 */}
                              <br />
                              <span className={styles.calibre}>
                                {i.kindLabel} · 落点 {i.locus.objectId}
                              </span>
                            </td>
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
                                  className={`${styles.btn} ${picked?.impedimentId === i.impedimentId ? styles.btnOn : ""}`}
                                  aria-pressed={picked?.impedimentId === i.impedimentId}
                                  onClick={() => { revealFix(i.impedimentId); }}
                                >
                                  查看对策 ▸
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <details className={styles.more}>
                  <summary>本看板的口径边界</summary>
                  <div className={styles.moreBody}>
                    {impGroups.model.notes.length === 0
                      ? "引擎本次未附带口径边界说明。"
                      : impGroups.model.notes.map((n) => <p key={n}>{n}</p>)}
                    <p>
                      可处置 {impGroups.actionable.length} 处 · 仅可监控 {impGroups.watchOnly.length} 处。
                      排序采用引擎给出的严重度，系统不给推荐 —— 排序口径可切换，决策由使用方作出。
                    </p>
                    {/* ══ ① 设计稿有、这里没有的那三列：逐列写明为什么缺 ════════════════
                        ⚠ **三列缺的理由不一样，不许合并成一句「今天给不出」** ——
                          合并之后，读者没法判断哪一列是「再接一条线就有」、哪一列是
                          「今天真的没有出处」。本仓已因为「拿一个笼统数字盖住两个不同事实」
                          记过账，这里不重犯。 */}
                    <p data-testid="c0828-board-missing-cols">
                      以下三列当前<b>缺失</b>，逐列说明：
                    </p>
                    <ul className={styles.restoreList} data-testid="c0828-missing-why">
                      <li>
                        <b>最快见效</b> · <b>最低代价</b> —— <b>当前无出处</b>。
                        {/*
                         * ⚠ 下一行那句「只有三个」是一条**枚举断言** —— 引擎哪天给对策多挂一个维，
                         * 它就从「诚实披露」变成「屏上说谎」，而**不会有任何人被通知**。
                         * 故把它赌的那个计数写下来（`stale-claims` 门与本记号同一个执行器现算）：
                         * 三个维在 `impediment-options.ts` 里各带一行 `betterWhen:`，
                         * 长出第四个维 ⇒ 现算变 4 ⇒ 当场红，逼着回来改这句话。
                         * ⚠ 赌注刻意挂在**引擎**那一侧而不是本文件：本文件只是转述，
                         * 真相源是产维的那段代码 —— 赌自己等于没赌。
                         * ⚠ 记号必须**紧贴被赌的那一行**：门的 `markScopeRange` 从命中行向上走，
                         * 一遇到非注释行就停 —— 隔着 `<li>` 挂在列表外面，门一个字都看不见。
                         * @stale-fact apps/datacore/src/solvers/impediment-options.ts /betterWhen: / ==3
                         */}
                        一条对策身上带的量只有三个（超阈幅度 / 严重度 / 产能 cellsPerDayP50 合计），
                        <b>没有一个是时间，也没有一个是代价</b>。
                        要上屏就得为每条对策自拟一个「几天见效」「代价高中低」，那是构造口径。
                        ⚠ 四栏方案中「多久见效 · 代价 · 风险」三行仅出现在
                        <b>「不处置」一栏</b>，取值为「——／见下／——」<b>占位符</b>，
                        不是数据 —— 无法汇总，因底层无此口径。
                      </li>
                      <li>
                        <b>不处置的后果</b> —— 需<b>逐处金额</b>，
                        而卡点记录仅有实测 / 红线 / 单位 / 规则码，全平台无逐处金额出处。
                        与上文「受阻环节」一节指出的是同一缺口。
                      </li>
                    </ul>
                    <p className={styles.calibre}>
                      这三列<b>如实缺失</b>，不以构造值占位 ——
                      「无法计算」与「为 0 / 为低」是两个不同的命题，屏上混同即失真。
                    </p>
                  </div>
                </details>
              </section>
            ) : null}

            {/* ══ 区⑤b 四栏方案 ══ */}
            {picked !== null ? (
              <section className={styles.panel} data-testid="c0828-options" ref={optionsRef}>
                <div className={styles.head}>
                  {zone("5", "对策方案")}
                  <h3 className={styles.headTitle} data-testid="c0828-options-title">
                    {picked.locus.label} · {picked.candidates.length} 种对策
                  </h3>
                  {/* 重名的两处靠这一行分开（实测同名标签 5 组 × 2 行，见上 `fixTag` 头注）。 */}
                  <span className={styles.headRight} data-testid="c0828-options-tag">
                    {fixTag(picked)} · 系统不给推荐，决策由使用方作出
                  </span>
                </div>
                <div className={styles.opts} data-testid="c0828-opt-grid">
                  {picked.candidates.slice(0, 3).map((c) => (
                    <div key={c.candidateId} className={styles.opt} data-testid={`c0828-opt-${c.candidateId}`}>
                      <h5 className={styles.optTitle}>{c.label}</h5>
                      <div className={styles.dims}>
                        <span className={styles.dimKey}>调到哪</span>
                        <span className={styles.dimVal}>{BIZ_RUNG[c.rung.kind].label}</span>
                        <span className={styles.dimKey}>杠杆在哪</span>
                        <span className={styles.dimVal}>{BIZ_JOIN[c.join.kind].label}</span>
                        <span className={styles.dimKey}>动完会怎样</span>
                        <span className={`${styles.dimVal} ${styles.mid}`}>{BIZ_EFFECT[c.effect.kind].label}</span>
                      </div>
                      <div className={styles.saves}>
                        <span className={styles.savesTitle}>判定依据</span>
                        <details className={styles.more}>
                          <summary>明细</summary>
                          <div className={styles.moreBody} data-testid={`c0828-opt-why-${c.candidateId}`}>
                            <p>{BIZ_RUNG[c.rung.kind].why}</p>
                            <p>{BIZ_JOIN[c.join.kind].why}</p>
                            <p>{BIZ_EFFECT[c.effect.kind].why}</p>
                            {/* 业务事实（规则码 / 真值 / 单位）**必须给** —— 铁律 1.5 判据二。
                                该消失的是「它在代码里长什么样」，不是「这个数打哪来」。 */}
                            <p className={styles.calibre}>
                              取值：{c.fromText} → {c.toText}
                              {c.lever.factorName === null ? "" : ` · 因子「${c.lever.factorName}」`}
                            </p>
                          </div>
                        </details>
                      </div>
                      <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.pick}`}>
                        采纳此方案
                      </button>
                    </div>
                  ))}

                  {/* ⚠ 第四栏是设计核心，**不许省** */}
                  <div className={`${styles.opt} ${styles.optNone}`} data-testid="c0828-opt-donothing">
                    <h5 className={styles.optTitle}>不处置</h5>
                    <div className={styles.dims}>
                      <span className={styles.dimKey}>多久见效</span>
                      <span className={`${styles.dimVal} ${styles.na}`}>——</span>
                      <span className={styles.dimKey}>代价</span>
                      <span className={`${styles.dimVal} ${styles.na}`}>见下</span>
                      <span className={styles.dimKey}>风险</span>
                      <span className={`${styles.dimVal} ${styles.na}`}>——</span>
                    </div>
                    <div className={styles.saves}>
                      <span className={styles.savesTitle}>该处将持续超线</span>
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
                        <span className={styles.calibre}>{money.exposedOrders} 张单仍在此路径上</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className={styles.calibre} data-testid="c0828-donothing-note">
                  第四栏无按钮 —— 不处置无需操作，属默认发生。
                  它存在的理由：没有它，前三栏的代价都读作净支出；有了它，前三栏才有参照基线。
                </p>
              </section>
            ) : null}

            {/* ══ 区⑤c · agent 提的方案（同一张四栏表，产地必须一眼分得出来）══ */}
            {agentRes !== null ? (
              <section className={styles.panel} data-testid="c0828-agent-options">
                <div className={styles.head}>
                  {zone("5", "agent 补充对策")}
                  <h3 className={styles.headTitle}>
                    {(() => {
                      const im = impGroups?.all.find((i) => i.impedimentId === agentFor);
                      return im === undefined ? "agent 方案" : `${im.locus.label} · agent 方案`;
                    })()}
                  </h3>
                  <span className={styles.headRight}>系统不给推荐 —— 决策由使用方作出</span>
                </div>

                {/* ── 诚实位：这一份到底是不是 agent 想的 ────────────────────────────
                    ⚠ 本单最强的验收信号就是这一条：接通前它恒为「本次未调用 agent」。
                    它为 false 时下面那些方案是**确定性兜底**，不是 agent 的产出 —— 必须写明，
                    否则就是一个会说谎的诚实位。R-UI-4：不打源码文件名/行号，
                    但 agent key / 模型 / 路由 / 耗时 / 条数是**业务事实**，必须给。 */}
                <div className={styles.agentBar} data-testid="c0828-agent-prov">
                  {agentRes.proposal?.provenance.agentInvolved === true ? (
                    <>
                      <span className={styles.agentTag}>◆ agent 生成</span>
                      <span>
                        agent <code>{agentRes.proposal.provenance.agentId ?? "—"}</code> ·
                        模型 <code>{agentRes.proposal.provenance.model ?? "—"}</code> ·
                        路由 <code>{agentRes.proposal.provenance.route}</code> ·
                        耗时 <code>{agentRes.proposal.provenance.elapsedMs ?? "—"}</code> 毫秒 ·
                        菜单 <code>{agentRes.proposal.menu.levers.length}</code> 根杠杆 ·
                        输出 <code>{agentRes.proposal.draft.options.length}</code> 个方案
                        {agentRes.reused === true ? " ·（复用已定版，本次未再调用模型）" : ""}
                      </span>
                    </>
                  ) : (
                    <span data-testid="c0828-agent-fallback">
                      <b>本次未调用 agent</b> —— 以下是系统按固定规则给出的<b>备用方案</b>，
                      <b>不是</b> agent 生成的。原因：{agentRes.proposal?.provenance.fallbackReason ?? "未给原因"}
                    </span>
                  )}
                </div>

                {agentRes.applicable !== true ? (
                  <p className={styles.empty} data-testid="c0828-agent-inapplicable">
                    本次无法装配杠杆菜单{agentRes.missingRoles !== undefined && agentRes.missingRoles.length > 0
                      ? `（缺：${agentRes.missingRoles.join("、")}）`
                      : ""}
                    —— 菜单缺失时不调用 agent，调用也只能凭空构造杠杆。
                  </p>
                ) : (
                  <>
                    <div className={styles.opts} data-testid="c0828-agent-grid">
                      {(agentOptions ?? []).slice(0, 3).map((o) => (
                        <div key={o.id} className={`${styles.opt} ${styles.optAgent}`} data-testid={`c0828-agent-opt-${o.id}`}>
                          <div className={styles.optHead}>
                            <h5 className={styles.optTitle}>{o.name}</h5>
                            <span className={styles.agentTag}>◆ agent 生成</span>
                          </div>
                          <div className={styles.dims}>
                            {o.moves.slice(0, 4).map((mv) => (
                              <Fragment key={mv.key}>
                                <span className={styles.dimKey}>{mv.label}</span>
                                <span className={styles.dimVal}>
                                  {mv.value === null ? <span className={styles.na}>——</span> : mv.value.toLocaleString("zh-CN")}
                                </span>
                              </Fragment>
                            ))}
                          </div>
                          <div className={styles.saves}>
                            <span className={styles.savesTitle}>判定依据</span>
                            <div style={{ lineHeight: 1.75 }}>{o.rationale}</div>
                            <details className={styles.more}>
                              <summary>档位出处</summary>
                              <div className={styles.moreBody}>
                                {o.moves.map((mv) => (
                                  <p key={mv.key}>
                                    {mv.label}：{mv.slot}（档位数值由真实数据算出，agent 只负责选哪一档）
                                  </p>
                                ))}
                              </div>
                            </details>
                          </div>
                          <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.pick}`}>
                            采纳此方案
                          </button>
                        </div>
                      ))}

                      {/* ⚠ 第四栏是设计核心，**agent 这张表里同样不许省** */}
                      {(() => {
                        const im = impGroups?.all.find((i) => i.impedimentId === agentFor);
                        return (
                          <div className={`${styles.opt} ${styles.optNone}`} data-testid="c0828-agent-donothing">
                            <h5 className={styles.optTitle}>不处置</h5>
                            <div className={styles.dims}>
                              <span className={styles.dimKey}>多久见效</span>
                              <span className={`${styles.dimVal} ${styles.na}`}>——</span>
                              <span className={styles.dimKey}>代价</span>
                              <span className={`${styles.dimVal} ${styles.na}`}>见下</span>
                            </div>
                            <div className={styles.saves}>
                              <span className={styles.savesTitle}>该处将持续超线</span>
                              {im === undefined ? (
                                <div className={styles.na}>本次未取到该处的实测 / 红线。</div>
                              ) : (
                                <ul className={styles.savesList}>
                                  <li><span>实测</span><span className={styles.late}>{im.evidence.metricValue.toFixed(2)}</span></li>
                                  <li><span>红线</span><span>{im.evidence.threshold.toFixed(2)}</span></li>
                                  <li><span>超出</span><span className={styles.late}>{im.evidence.breach.toFixed(2)}</span></li>
                                </ul>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <p className={styles.calibre} style={{ marginTop: 10 }} data-testid="c0828-agent-compare">
                      {agentRes.proposal?.draft.comparisonNote === ""
                        ? "agent 本次未给出方案之间的权衡说明。"
                        : agentRes.proposal?.draft.comparisonNote}
                    </p>
                    <details className={styles.more}>
                      <summary>数据来源</summary>
                      <div className={styles.moreBody}>
                        <p>
                          agent <b>不产出任何数值</b>：它交回来的只有「选第几根杠杆、第几档」和一段说明。
                          上表每一格数值，都是按它选的那一档从<b>杠杆菜单</b>里取出来的；
                          菜单上的档位由真实数据算出，基线读数由求解器算出。
                        </p>
                        <p>
                          因此它给不出菜单之外的数值：选一个菜单上没有的档位会被当场拒收，
                          屏上退回「本次未调用 agent」并写明原因，不会悄悄换成一个相近的档位。
                        </p>
                        <p>
                          本次提案版本 <code>{agentRes.proposal?.version ?? "—"}</code>，
                          世界态指纹 <code>{agentRes.proposal?.inputFingerprint.slice(0, 12) ?? "—"}</code>
                          —— 世界态不变时重复请求复用同一版本，不会每操作一次就更换一批方案。
                        </p>
                        {/* ⚠⚠ 这一段是**诚实位**，不许删：标题写着「某处 · agent 方案」，
                            很容易读成「agent 专门为这一处想的」，而今天**不是**。 */}
                        <p>
                          ⚠ <b>本批方案并非针对该单处卡点定制。</b>
                          agent 读取的是<b>整体世界态</b>（本次事件 + 求解器基线读数 + 对象条数）
                          与<b>全局杠杆菜单</b>，不获知入口来自哪一处卡点 ——
                          该处名称由<b>使用方选定</b>，非 agent 指定。
                        </p>
                        <p>
                          正确读法：这是「针对<b>当前世界态</b>的若干组杠杆组合」，现用于该处卡点。
                          若要 agent <b>针对单处</b>出方案，需将该处的落点与判据一并送入菜单 ——
                          涉及跨包契约变更，不在本次范围内；
                          <b>未做即如实列明，不作已完成陈述</b>。
                        </p>
                      </div>
                    </details>
                  </>
                )}
              </section>
            ) : null}

            {/* ══ 诚实位 · 贯穿全屏 ══ */}
            <p className={styles.pgFoot} data-testid="c0828-honesty">
              〔估〕= 推演算出来的数，不是实测值。<span className={styles.nocalc}>删除线</span> = 本次无法计算，
              不是 0，也不是「无变化」。
              <details className={styles.more}>
                <summary>本次推演的计算口径</summary>
                <div className={styles.moreBody}>
                  {result.disclosure === null ? (
                    <p>后端本次未返回披露层 —— 「未取到」不等于「不存在」。</p>
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
    </div>
  );
}
