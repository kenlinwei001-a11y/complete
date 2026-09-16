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
  spanLabel,
  tickDateISO,
  tickLabel,
  tickUnitWord,
  type CellDelta,
  type OrderRow,
  type TickCalendar,
  type WorldCells,
  isSettledOrder,
} from "./console0828Model";
import {
  buildChainImpedimentModel,
  ChainImpedimentPayloadSchema,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  type ChainImpedimentModel,
} from "../../chainImpediment";
import { InfoPopover } from "@/components/InfoPopover";
import { readSnapshotOrigin } from "../metricWallModel";
import { RealityMeterRow, type ReplaySpec } from "../RealityMeter";
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

/**
 * 一条暂存事件 → `POST …/perturbations` 的**提交载荷**。**唯一构造处**。
 *
 * ── 为什么提成函数（WO-SIM-REALITY-METER）─────────────────────────────────────
 * 「开始推演」与「跟纯占位世界对照」要发**逐字段相同**的那一套扰动。
 * 两处各拼一份字面量 = 第二套真相源：改一处漏一处，而两臂用了不同扰动这件事
 * **屏上看不出来、类型系统也看不见** —— 对照实验会静默地变成两个不同的实验。
 * ⇒ 一份实现，两处调用；「两臂相同」由**结构**保证，不靠人比对。
 */
function perturbBodyOf(s: StagedEvent): Parameters<typeof createSimPerturbation>[1] {
  return {
    kind: s.kind,
    targetObjectId: s.targetObjectId,
    targetStateVar: s.targetStateVar,
    magnitude: s.magnitude,
    label: `${s.name} · ${s.targetObjectName}`,
    mode: s.mode,
    ...(s.startTick === null ? {} : { startTick: s.startTick }),
    durationTicks: s.durationTicks,
  };
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
 * WO-SIM-DENSE ① · KPI 卡口径浮层的展开方向 —— **纯几何，无业务语义**。
 * 一行六格，最右那两格的浮层若仍向右展开会顶出屏幕右缘（`InfoPopover` 宽 380px，
 * 而一格才 ~250px）。⇒ 后三分之一向左开。
 */
const kpiAlign = (i: number, n: number): "left" | "right" => (i >= n - Math.max(1, Math.ceil(n / 3)) ? "right" : "left");

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

/**
 * ══ WO-C0828-COO-FIRST-SCREEN · 页签键（视角：COO / 决策者）════════════════════
 *
 * ── 今天的行为是 X ──
 * 五块结果面板**纵向摞成一条瀑布**。实测（**2026-09-15**，真后端 SEED_DEMO=1 + 真 chromium
 * 1600×900，施 1 件扰动）：滚动容器 `#main-content` 内容高 **3601px** / 视口 **842px**
 * = **4.28 屏**，「💰 财务影响」落在第 **4.2** 屏 —— COO 最想看的那个数要滚四屏才看得到。
 *
 * **怎么亲手复验这三个数**（复审不必相信我）：真后端起 datacore（`SEED_DEMO=1`）与本包
 * `pnpm --filter frontend-shell exec vite`，登录 demo/admin，进 `/v/sim-unified`，
 * 加 1 件扰动点「开始推演」，然后在控制台读
 * `document.querySelector("#main-content").scrollHeight / .clientHeight`。
 * ⚠ **必须量这个内层容器**：量 `document.documentElement` 恒得 900/900（滚动不在文档层），
 *   会得出「本来就只有一屏」这个恰好相反的结论。
 *
 * ── 应该是 Y ──
 * 第一屏恒定给**结论**（四个数 + 怎么办），明细进页签、在同一块区域换内容。
 *
 * ⚠ **页签只有 6 个，不是仓主原话里的 4 个** —— 差异在这里点名，不藏着：
 *   原话是 `[受阻环节][对策方案][全流程扫描][执行记录]`，
 *   而 `c0828-cust`（客户与订单）与 `c0828-money`（财务勾稽）这两块**在那 4 个里没有落点**。
 *   它们不能就地删：① 既有接缝门逐块断言它们在场；② 规范 §1「诚实位可降层、不可删」。
 *   ⇒ 各给一个页签（`cust` / `money`），**降层而非删除**。
 *   两块的**头条数**（敞口金额 / 客户家数）已经上了第一屏，页签里放的是明细与勾稽。
 */
type TabKey = "board" | "options" | "scan" | "cust" | "money" | "log";

/**
 * 第一屏那**四个数**。⚠ 不是新造的量 —— 逐个对应既有 KPI 卡的 `key`，取数一字未改。
 * 余下两张卡（`fix` 可处置 / `entity` 可落点实体）**没有被删**，整卡搬进「执行记录」页签
 * （`entity` 同时仍在左栏页脚 `c0828-entity-counts` 第一层可见）。
 *
 * ══ 顺序是**按出身排的**，不是按「谁更重要」拍的（红线 4）════════════════════
 * 本会话世界态出处**实测**（`GET /a/v1/sim/sessions` → `scope.baseSnapshotOrigin`，
 * 2026-09-15 真后端 `sims_demo_seed_world`）：
 *   `kind=DERIVED` · `round(hash01(对象id|状态变量)×100)` · cells **5,895** ·
 *   **measuredCells 0** · derivedCells 5,895
 * ⇒ 凡「哪些对象被推动」这一步经过世界态的数，其**集合**都是占位世界选出来的。
 *
 *  · `imp`（卡点处数）—— 全流程扫描**只收 scope**，不收会话/世界态/扰动，
 *    读对象层真字段、判规则表真红线 ⇒ **唯一不经占位世界的数** ⇒ **排首位**。
 *    佐证（不是推断）：12 件扰动与 1 件扰动实测**同为 18 处**。
 *  · `orders` / `cust` —— 占位世界选出的集合的**计数** ⇒ 次位。
 *  · `exposure`（敞口金额）—— 真金额 × 占位世界选出的集合 ⇒ **末位、降档、带可见记号**。
 *
 * ⚠ 与本单原派单里「COO 先看钱」的排法**相反**，以红线 4 为准：
 *   诊断（哪里卡着）与对策（能调什么）用的是真数据，是这一屏唯一站得住的部分。
 */
const HEADLINE_KPIS: readonly string[] = ["imp", "orders", "cust", "exposure"];

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
  /** 当前页签。默认「受阻环节」—— 它是「怎么办」那几行的宿主，点进去接着往下走。 */
  const [tab, setTab] = useState<TabKey>("board");

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
   * ⚠ **「往后 30 天」那半截刻意不做** —— 但理由**不是**原来写的那句
   *   ~~「『一拍等于几天』全平台没有登记册」~~。**那句话是错的，2026-09-11 已被推翻**：
   *   登记册就是 `SimSession.tickDays`（见下方 `cal` 那段头注与 `console0828Model.tickDateISO`），
   *   这块屏今天自己就在拿它做换算。留着旧理由比没有理由更危险 —— 它写在最容易被信的地方，
   *   而本仓真的因为它派错过一次活（WO-SIM-PLAIN-WORDS 的派单书就引了这两句互相打架的话）。
   *   真实理由只有一条：**顶栏这个控件选的是「范围」不是「时长」**，时长由左栏那一格管，
   *   两处各摆一个时间输入会造出「以哪个为准」这个问的不出口的歧义。
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
  /**
   * ══ WO-SIM-REALITY-METER · 世界态出处记号（`scope.baseSnapshotOrigin`）══════════
   *
   * ⚠ 读法走 `metricWallModel.readSnapshotOrigin` —— **本屏不另写一套**：
   *   契约里 `scope` 是 `z.record(z.string(), z.unknown())` 的松口袋，逐字段防御性读这件事
   *   已经有唯一实现，抄第二份就会出现「两处各读各的、缺字段时结论还不一样」。
   * ⚠ `sessionRow === undefined` 与「有这一条但它没带记号」是**两件事**，
   *   下面 `originAbsence` 把它们分开说，⛔ 不塌成一句「取不到」。
   */
  const origin = useMemo(
    () => (sessionRow === undefined ? null : readSnapshotOrigin(sessionRow.scope)),
    [sessionRow],
  );
  const originAbsence: string | null =
    origin !== null
      ? null
      : sessionsQ.isPending
        ? "会话清单还在路上 —— 真业务数占比待会才知道"
        : sessionsQ.isError
          ? "会话清单这一跳失败 —— 不知道有多少是真业务数（不是「一格都没有」）"
          : sessionRow === undefined
            ? "会话清单里没有这一条 ⇒ 说不出它的世界态出处"
            : "这条会话没有带世界态出处记号 ⇒ 出处不明，屏上一律按「非实测」读";
  /** `typeKey → 中文名`。**取自传导规则回包自己带的那两格**，⛔ 前端不另建一张中文映射表。 */
  const typeNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (rulesQ.data as PropagationRulesResponse | undefined)?.items ?? []) {
      if (typeof r.sourceTypeName === "string" && r.sourceTypeName !== "") m.set(r.sourceTypeKey, r.sourceTypeName);
      if (typeof r.targetTypeName === "string" && r.targetTypeName !== "") m.set(r.targetTypeKey, r.targetTypeName);
    }
    return m as ReadonlyMap<string, string>;
  }, [rulesQ.data]);
  const stateVarNames = (rulesQ.data as PropagationRulesResponse | undefined)?.stateVarNames;

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
        /**
         * `once` 的事件**恒 `null`**（契约里 `null` = 永久 ⇒ 引擎永不回退），
         * ⛔ 不读 `duration` state —— 它那一格根本没渲染，但 state 仍在（上一件事留下的残值
         * 会被 `openForm` 清掉，可这是**两层保险**：渲染没了而 state 漏进载荷，
         * 正是那种「屏上看不见、载荷里却有」的静默错，typecheck 一个字都看不见）。
         */
        durationTicks:
          openEv.timeShape === "once" ? null : duration.trim() === "" ? null : Number(duration),
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
        const r = await createSimPerturbation(sid, perturbBodyOf(s));
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
    // WO-EXPOSURE-STATUS：与 buildMoneyView 共用 isSettledOrder —— 已完成单不进客户面，
    // 否则屏上会出现「被推动 150 张，却涉及全部 20 家客户」这种自相矛盾。
    const byId = new Map(orders.map((o) => [o.id, o]));
    for (const d of result?.deltas ?? [])
      if (ids.has(d.objectId) && !isSettledOrder(byId.get(d.objectId))) out.add(d.objectId);
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

  /**
   * WO-SIM-REALITY-METER · 「跟纯占位世界对照」要复刻的那一次推演。
   *
   * ⚠ 取的是 `result`（**真跑过的那一次**）而不是左栏当前的 `staged` / `horizon`：
   *   用户跑完之后还可以继续往清单里加事件、改推演时长，那时 `staged` 已经不是屏上
   *   这批数字的来源了。拿它去对照 = 拿另一次实验的条件来解释这一次的读数。
   * ⚠ 拍数取 `afterTick − beforeTick` —— **后端回执**，不是前端的 `horizon` 输入框。
   */
  const replay: ReplaySpec | null = useMemo(
    () =>
      result === null
        ? null
        : { payloads: result.staged.map(perturbBodyOf), ticks: Math.max(0, result.afterTick - result.beforeTick) },
    [result],
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
  /* ⚠ WO-C0828-COO-FIRST-SCREEN 删掉了 `optionsRef` / `impedimentRef` / `boardRef` 三个 ref。
     它们原本只有一个用途：给四个「下钻出口」按钮做 `scrollIntoView` 的落点。
     四个目的地现在都是**同一块区域的页签**，跳转变成 `goTab(...)` ⇒ 三个 ref 成了死代码。
     ⛔ 四个按钮本身**一个都没删**（`c0828-drill-cust` / `-board` / `-money` /
     `c0828-ai-goto-options` testid 一字未改），只是落点从「滚过去」换成「切页签」。
     顺带：`?.scrollIntoView?.()` 那圈 jsdom 兼容写法也随之不再需要。 */
  /** 页签内容区 —— 换页签时把它自己滚回顶部（⛔ 不是滚页面，页面已经不滚了）。 */
  const tabBodyRef = useRef<HTMLDivElement | null>(null);

  /**
   * ══ WO-C0828-COO-FIRST-SCREEN · `revealFix` 改版 ═══════════════════════════
   *
   * ── 改前的行为 ──
   * `setPickedFix` + `optionsRef.scrollIntoView()`。上面那段 WO-C0828-VOICE 的注释
   * 记着当初的取舍：病因① 是「面板在一屏之外（按钮 y≈803–968，面板 y≈1800，相距约 997px）」，
   * 当时选的修法是**点完滚过去**。
   * 代价也记着：18 条列表里点第 3 条，视线被甩到 ~1000px 外，回来找不到刚才那条。
   *
   * ── 改后 ──
   * 对策面板与受阻环节列表现在是**同一块区域的两个页签**，「一屏之外」这个前提没有了 ⇒
   * 病因① **自然消失**，不再需要滚动这个补丁。
   * ⚠ 但病因②③ **仍然成立且仍然要治**（它们与版面无关）：
   *   ② 点默认那一项时 `picked` 前后完全相同 ⇒ 没有任何可见变化；
   *   ③ 选中态。
   * 两者都由 `setPickedFix` + `aria-pressed`（从 `picked` 派生）继续守着，一个都没撤。
   * 现在多一件可见的事：**页签跟着跳到「对策方案」**，于是点默认那一项也有确定的反馈。
   *
   * ⛔ `scrollIntoView` 已移除，**不是忘了**：页面不再滚动，
   *    它唯一还能做的就是把内层 `.tabBody` 滚一下，而此刻内容刚换、目标就在顶部。
   *    改滚 `.tabBody` 到 0，语义明确且与 jsdom 无关（`scrollTop` 是普通属性，不是未实现的方法）。
   */
  const revealFix = (impedimentId: string): void => {
    setPickedFix(impedimentId);
    setTab("options");
    if (tabBodyRef.current !== null) tabBodyRef.current.scrollTop = 0;
  };
  /** 换页签 = 换内容 + 内容区回顶。⛔ 不动页面滚动位置（页面已无滚动）。 */
  const goTab = (t: TabKey): void => {
    setTab(t);
    if (tabBodyRef.current !== null) tabBodyRef.current.scrollTop = 0;
  };

  /**
   * 一处卡点的**辨识串** —— 光有 `locus.label` 不够。
   *
   * **实测于 2026-09-11**（真后端 `SEED_DEMO=1`，本机 datacore :49317）。复验：
   *   `curl -sX POST -H 'X-Debug-User: demo:admin:admin' -H 'content-type: application/json' \
   *    -d '{"scope":{}}' http://<datacore>/a/v1/solvers/chain_impediments/invoke`
   *   再对 `data.impediments[].locus.label` 做词频。当日 18 处：
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

  /* ══ WO-UX-UNIFY · KPI 条的取数（纪律第 2 条「KPI 条 3–5 张」）════════════════
   *
   * ⛔⛔ **每一格都来自本屏已有的真接口，一个占位数都没有。**
   *   · 推演前：`fetchAllObjects("Order")` 的全量订单簿（逐页取全）+ 左栏待施加清单
   *   · 推演后：`buildMoneyView` / `buildCustomerView` / 求解器 `chain_impediments`
   *   参考稿（`UI-sim-7tabs-20260911.html` 等）里的数**相当一部分是编的占位**，⛔ 一个都没抄。
   *
   * ── 关于「迷你走势」（sparkline）：**今天没有，如实缺着** ────────────────────
   *   参考稿每张 KPI 卡都带一条走势线。本屏画不出来，原因是真的：
   *   `runM` 走的是 `simTick(sid, horizon)` **一次跳 N 拍**，然后 `simWorld` 读**一次**终态
   *   （本文件头注那五步的 ③④）⇒ 全屏只有「扰动前」「扰动后」**两个**观测点，
   *   中间每一拍的读数**从未取回**。两点画不出走势，补一条是编历史。
   *   ⇒ 屏上给一句说明（`c0828-kpi-nospark`），**不画那条线**。
   *   ⚠ 这不是「没做」，是「没有数据源」——两者处置相反，故写明是哪一种。
   *
   * ── 关于「环比」：给的是**份额/基数对比**，不是「较上周」 ──────────────────
   *   本屏不留存历史推演，没有"上一期"可比 ⇒ ⛔ 不编一个「较上周 ↑x%」。
   *   每张卡的第二行给的是**同次推演内的真实对比**（占订单簿 / 占总数），
   *   口径写在第三行 `.kpiCal` 里，**默认可见**。
   */
  const bookTotalRaw = useMemo(() => orders.reduce((s, o) => s + (o.value ?? 0), 0), [orders]);

  interface KpiCard {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    /** 金额串用 30px 会撑破卡 ⇒ 降到正文级（**不新增字号档**，仍是 12/13/30 三级）。 */
    readonly small?: boolean;
    readonly cmp: string;
    /**
     * ⚠ 口径说明 —— **默认可见的那一层，不许折叠**。
     *
     * ⚠ 类型是 `JSX.Element` 而不是 `string`，这是**实测逼出来的**：第一版写成字符串并在里面
     * 用了 `**…**` 做强调，真浏览器上**原样渲染成了星号**（JSX 文本节点不解析 markdown）——
     * 屏上出现「按**世界差分全集**判定」这种脏字。
     * 形态：「我用『我在源码里写了强调标记』当作『屏上会显示为强调』的证据，而前者并不度量后者。」
     * ⇒ 强调一律用 `<b>`；屏上也不再打 ⛔ 这类工单黑话记号（那是给派单看的，不是给用户看的）。
     */
    readonly cal: JSX.Element;
    /**
     * WO-SIM-DENSE ① · **第一层那一行**口径（10.5px 灰字，超长 ellipsis）。
     *
     * ⚠ 它是 `cal` 的**压缩**，不是 `cal` 的替代 —— `cal` 整段一字不少地搬进了
     * `InfoPopover`，第一层留 `?` 记号（`docs/CONVENTION-ui-information-layering.md`
     * §1「诚实位允许降层、绝不允许删除；降层后第一层必须留可见记号」）。
     * **静默降层等于删除**，所以这两样必须同时在场：一行摘要 + 可见触发器。
     *
     * ⛔ 这一行里不许出现 `cal` 里没有的新断言 —— 压缩只许删字，不许加意思。
     */
    readonly calOne: string;
    readonly alert?: boolean;
    /**
     * ══ WO-C0828-COO-FIRST-SCREEN 红线 4 · 这个数**出身可靠吗** ════════════════
     *
     * `true` = 它的**取值集合**由哈希占位世界选出来，不由真业务关系选出来。
     * 屏上必须因此降一档呈现并**在第一层留可见记号**（⛔ 不许只写在浮层里 ——
     * 浮层要点开才看得到，「静默降层等于删除」）。
     * ⛔ 也不许因此把它删掉或改成「—」：它是**真算出来的**，只是出身不可靠；
     *   改成「—」就变成「没取到」，那是另一个命题。
     */
    readonly estimated?: boolean;
    /** 第一层那个可见记号上的字（短，一眼能读）。 */
    readonly estTag?: string;
  }

  const kpis = useMemo<readonly KpiCard[]>(() => {
    if (result === null || money === null) {
      // ── 推演前：只摆这一刻**真的取到了**的三个量 ──
      if (ordersQ.data === undefined) return [];
      return [
        {
          key: "book",
          label: "在手订单簿合计",
          value: fmtMoney(bookTotalRaw, "元"),
          small: true,
          cmp: `${orders.length} 张单 · ${new Set(orders.map((o) => o.cust ?? "")).size} 家客户`,
          cal: (<>口径：对象层 Order.value 逐页取全后加总，为<b>已签成交额</b>；≠ 年度计划营收，也 ≠ 需求预测。</>),
          calOne: "对象层 Order.value 加总 · 已签成交额",
        },
        {
          key: "staged",
          label: "待施加扰动",
          value: String(staged.length),
          // 长度口径与左栏那个输入框同源（`spanLabel`）：天为主、拍作括注，取不到刻度才只剩拍。
          cmp: staged.length === 0 ? "尚未添加" : `推演时长 ${spanLabel(cal, horizon)}`,
          cal: (<>口径：左栏本地草稿，<b>不落盘</b>；与顶栏「服务端历史扰动」不是同一份，两者不可相加。</>),
          calOne: "左栏本地草稿 · 不落盘",
        },
        {
          key: "entity",
          label: "可落点实体",
          value: String(entityTotal),
          cmp: entityCounts.map((e) => `${e.label}${e.n}`).join(" · "),
          cal: (<>口径：12 类扰动事件可落到的<b>具名实体</b>；其余对象只作传播介质，不进选择器。</>),
          calOne: "12 类事件可落到的具名实体",
        },
      ];
    }
    /* ── 推演后：**六张**，全部来自本次推演结果 ────────────────────────────────
       WO-SIM-DENSE ② · 稿子是一行六格：敞口 / 订单 / 客户 / 受阻环节 / 可处置 / 可落点实体。
       改前只有前五张 —— 第六张「可落点实体」**不是新造的量**，它推演前就在（`entity` 那张，
       同一个 `entityTotal` / `entityCounts` 单源），只是推演后被整张撤掉了。
       ⚠ 撤掉它其实是个信息损失：它答的是「这套推演**够得着多少东西**」，
       推演完照样要回答（用户下一步就要去改落点）。这里把它接回来，**取数一字未改**。 */
    const share = money.bookTotal === 0 ? 0 : money.exposure / money.bookTotal;
    return [
      {
        key: "exposure",
        label: "被推动的订单敞口",
        value: fmtMoney(money.exposure, "元"),
        small: true,
        cmp: `占订单簿 ${pct(share)} · 基数 ${fmtMoney(money.bookTotal, "元")}`,
        cal: (<>口径：本次推演中读数发生变化的订单，按对象层成交额合计 —— 是「<b>受影响订单的金额规模</b>」，<b>不是利润损失</b>（毛利 / 成本 / 应收三项本次无法计算，见下方「金额勾稽」）。
          <br />
          <b>⚠ 这个数今天不能直接用来做决策。</b>金额本身是真的（对象层 Order.value），
          但「<b>哪些订单算被推动</b>」由<b>结构派生的占位世界</b>决定，不由「这张单是否真用了出事的物料」决定：
          本会话世界态出处回包标为<b>结构派生</b>（不是量出来的），
          <b>5,895 格全部为派生值，真读数 0 格</b>
          {/* ⚠ 生成式原文**刻意不在这里重复一份**：`cal` 这段 JSX 挂在对象属性上，
              `ui-first-layer` 的静态扫描追不进 `InfoPopover`，会把它判成第一层的
              「口径/公式」（R-UI-3）—— 2026-09-15 跑 `node scripts/check-ui-first-layer.mjs`
              实测因此多出 1 条（77 → 78），移出后回到 77。
              原文在下方「带 ~ 的三个数只作量级参考」那句的浮层里，一字不少。 */}
          （生成式原文在四个数下方那句「带 ~ 的三个数只作量级参考」的浮层里，本处不重复一份）。
          叠加传导边按真实用量加权的是少数：种子里 49 条用量引用中 <b>43 条为空</b>，
          ⇒ 受影响订单的**集合**是占位世界选出来的，金额规模随之只能当**量级参考**。
          ⛔ 它<b>不是「没取到」</b> —— 是真算出来的，只是出身不可靠，故降档呈现而非隐藏。</>),
        calOne: "真金额 × 占位世界选出的订单集合 · 只作量级参考",
        estimated: true,
        estTag: "估算·集合由占位世界选出",
      },
      {
        key: "orders",
        label: "受影响订单",
        value: String(money.exposedOrders),
        cmp: `共 ${money.bookOrders} 张 · 读到 ${money.ordersSeen} 张`,
        cal: (<>口径：按<b>世界差分全集</b>判定，<b>不按</b>被扰动的源格判定 —— 源变量常被顶在域上界，源格只动千分之几而下游动千百倍。读到 0 张表示遍历失效，不是「无波及」。
          <br />
          ⚠ 这是<b>张数</b>，可靠性与上面那笔金额同源：**哪些单进这个集合**由结构派生的占位世界决定
          （本会话实测 <b>实测格 0 / 派生格 5,895</b>）⇒ 张数可信为「有这么多单被推动」，
          但<b>不可读作「这几张单真的因这件事受影响」</b>。</>),
        calOne: "按世界差分全集判定 · 不按源格",
        estimated: true,
        estTag: "集合由占位世界选出",
      },
      {
        key: "cust",
        label: "受影响客户",
        value: custView === null ? "—" : String(custView.touchedCustomers),
        cmp: custView === null ? "客户视图本次未取到" : `共 ${custView.totalCustomers} 家`,
        cal: (<>口径：由受影响订单按 Order.cust 归并得到，<b>非独立的客户级读数</b>；客户对象自带的应收数因计量单位无登记册（元 / 万元差 10000 倍）<b>不上屏</b>。
          <br />
          ⚠ 它是上面那个订单集合的归并结果 ⇒ <b>同源、同样只作量级参考</b>。</>),
        calOne: "由受影响订单按 Order.cust 归并",
        estimated: true,
        estTag: "集合由占位世界选出",
      },
      {
        key: "imp",
        label: "受阻环节",
        value: impGroups === null ? "—" : String(impGroups.all.length),
        cmp:
          impGroups === null
            ? "本次未取到"
            : impGroups.model.groups.map((g) => `${g.label}${g.items.length}`).join(" · "),
        cal: (<>口径：卡点 / 堵点 / 断点是引擎回包里 kind 的<b>三个不同取值</b>，处置相反，<b>不合并</b>成一个词。取不到时显「—」，那是<b>调用失败</b>，不是「无卡点」。
          <br />
          <b>这一格是本屏出身最硬的数</b>：全流程扫描只收<b>范围</b>，不收会话 / 世界态 / 扰动 ——
          它读的是<b>对象层真字段</b>、判的是<b>规则表里的真红线</b>（每处都带判据码与实测值 / 阈值），
          与那个结构派生的占位世界<b>无关</b>。
          ⚠ 同一枚硬币的另一面：<b>加不加扰动，这个数都不会变</b>（本次实测 12 件扰动与 1 件扰动同为 18 处）——
          它答的是「这条链今天哪里卡着」，<b>不是</b>「这次扰动卡出了什么」。</>),
        calOne: "读对象层真字段 · 判规则表真红线 · 不随扰动变",
      },
      {
        key: "fix",
        label: "可处置",
        value: impGroups === null ? "—" : String(impGroups.actionable.length),
        cmp: impGroups === null ? "本次未取到" : `仅可监控 ${impGroups.watchOnly.length} 处`,
        // 「一处都动不了」是真告警 ⇒ 这一张才允许染色（纪律第 4 条）。
        alert: impGroups !== null && impGroups.all.length > 0 && impGroups.actionable.length === 0,
        // 这两句是**阈值式定义**，不是断言：逐字对应上面 `impGroups` 的两条 filter
        // （`candidates.length > 0` / `=== 0`），每次渲染现算 ⇒ 不存在「过时」这一态，
        // 故**不挂** `@stale-fact`。⛔ 别写成「一条都没有」那种否定断言形态：
        // 同一个意思，前者是定义（恒真），后者读起来像在报一个当下的事实（会过时）。
        cal: (<>口径：「可处置」= 引擎为该处<b>枚举出的对策条数 ≥ 1</b>；「仅可监控」= 该条数<b>为 0</b>。<b>系统不给推荐，决策由使用方作出。</b></>),
        calOne: "引擎枚举出的对策条数 ≥ 1",
      },
      /* 第六张 —— 与推演前那张 `entity` **同一个取数**（`entityTotal` / `entityCounts`），
         ⛔ 不是为了凑满六格新编的量。`key` 也沿用 `entity`，testid 因此前后一致。 */
      {
        key: "entity",
        label: "可落点实体",
        value: String(entityTotal),
        cmp: entityCounts.map((e) => `${e.label}${e.n}`).join(" · "),
        cal: (<>口径：12 类扰动事件可落到的<b>具名实体</b>；其余对象只作传播介质，不进选择器。</>),
        calOne: "12 类事件可落到的具名实体",
      },
    ];
    // `cal` 进依赖：「推演时长」那格的长度口径现在读它（天/拍），会话口径一到手这张卡要重算。
  }, [result, money, custView, impGroups, ordersQ.data, orders, bookTotalRaw, staged.length, horizon, entityTotal, entityCounts, cal]);

  /* ══ WO-C0828-COO-FIRST-SCREEN · 「怎么办」那 3–4 行 ═══════════════════════════
   *
   * ⛔⛔ **一个编出来的量都没有。** 开工时逐行读过契约原文复核：
   *   `packages/contracts/src/chain-sim.ts` 的 `SolutionCandidateSchema` 是 `z.strictObject`，
   *   字段清单只有 candidateId / impedimentId / label / lever / fromValue / toValue /
   *   join / rungKind / rungSource / effectKind / dims / provenance / dataMode。
   *   **没有 cost、没有 leadTime、没有「见效时间」、没有「风险等级」。**
   *   `strictObject` 还意味着后端多塞一个字段会直接 parse 失败 ⇒ 这份清单就是全部。
   *
   * 故每行只摆三样**真有的**：
   *   ① 动什么 —— `label`（引擎派生，R14 禁内联业务名词）
   *   ② 从多少拨到多少 —— `fromText` → `toText`（按 `valueKind` 格式化后的真值）
   *   ③ 改善最大的那一维 —— `dims` 里 `improvement` 最大的那条
   *
   * ⚠ `improvement` 的**方向判定走 contracts 单源** `candidateDimImprovement`（>0 = 比基线好），
   *   前端不自己判「越大越好还是越小越好」——`betterWhen` 两种都有，自己判必错一半。
   * ⚠ 只取 `moved === true` 的维：契约 `superRefine` 只保证**至少一维**动了，
   *   没动的那些维 `improvement` 为 0，拿它当「改善」就是把「没变化」报成「改善 0」。
   * ⛔ 没有拿 `breach` 冒充「代价」，也没有拿改善量冒充「见效天数」——
   *   前者是超阈幅度（该处今天超线多少），后者是 KPI 改善量，两个都不是时间也不是钱。
   */
  const howtoRows = useMemo(() => {
    if (picked === null) return null;
    return picked.candidates.slice(0, 3).map((c) => {
      const moved = c.dims.filter((d) => d.moved && Number.isFinite(d.improvement));
      const best = [...moved].sort((a, b) => b.improvement - a.improvement)[0] ?? null;
      return { id: c.candidateId, label: c.label, fromText: c.fromText, toText: c.toText, best };
    });
  }, [picked]);

  /** 改善量的显示。⚠ 单位一律用引擎给的 `d.unit`，⛔ 前端不换算也不补单位。 */
  const fmtGain = (n: number): string => n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

  /**
   * 页签表。**条数全部来自引擎回包**（`impGroups` / `picked` / `custView`），⛔ 无一写死。
   * ⚠ 取不到时给 `null` 而不是 `0` —— 「没取到」与「有 0 条」处置相反，
   *   页签上显示一个 `0` 会把「这次没问出来」读成「这里确实空」。
   */
  const TABS = useMemo(
    (): readonly { key: TabKey; label: string; n: number | null }[] => [
      { key: "board", label: "受阻环节", n: impGroups?.all.length ?? null },
      { key: "options", label: "对策方案", n: picked?.candidates.length ?? null },
      { key: "scan", label: "全流程扫描", n: impGroups?.watchOnly.length ?? null },
      { key: "cust", label: "客户与订单", n: custView?.touchedCustomers ?? null },
      { key: "money", label: "财务影响", n: null },
      { key: "log", label: "执行记录", n: null },
    ],
    [impGroups, picked, custView],
  );

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */
  const zone = (n: string, t: string): JSX.Element => (
    <span className={styles.zoneTag}>
      <span className={styles.zoneNum}>{n}</span>
      {t}
    </span>
  );

  /**
   * 一张 KPI 卡。**从既有 JSX 原样提出来的函数**，内部一个字符没改 ——
   * 提取的唯一原因是同一份卡片现在要在两处渲染：第一屏那四张 + 「执行记录」页签里那两张。
   * ⛔ 抄第二份是禁止的（改一处漏一处，本仓治过多次）。
   */
  const renderKpi = (k: KpiCard, i: number, n: number): JSX.Element => (
    <div
      key={k.key}
      className={k.alert === true ? `${styles.kpi} ${styles.kpiAlert}` : styles.kpi}
      data-testid={`c0828-kpi-${k.key}`}
    >
      {/* 标签行 —— 标签 + `?` 记号。那个 `?` 就是「降层后第一层留下的可见记号」，
          ⛔ 不许去掉：去掉 = 静默降层 = 删除（规范 §1）。 */}
      <span className={styles.kpiKey}>
        {k.label}
        <InfoPopover topic={`${k.label} · 口径`} testId={`c0828-kpi-${k.key}`} align={kpiAlign(i, n)}>
          {k.cal}
        </InfoPopover>
      </span>
      {/* ══ 红线 4 · 出身记号 —— **第一层可见**，⛔ 不许只写在浮层里 ════════════
          「静默降层等于删除」：浮层要点开才看得到，而这条是「这个数能不能拿来做决策」，
          它必须在**不点任何东西**的情况下就被读到。
          记号有两半，缺一半都不够：
            ① `~` 前缀贴着数字本身 —— 数字被截图 / 被读出来时记号跟着走；
            ② 一枚写着出身的小牌子 —— `~` 只说「约」，说不清「约在哪」。
          ⛔ 不用红/琥珀：出身不可靠**不是告警**（纪律第 4 条，告警色专用于越线）。 */}
      {/* 数字与出身小牌子**同一行**（`.kpiValRow`）—— 不给牌子单开一行：
          2026-09-15 实测单开一行每张卡长 20px，四张就是 80px，直接从页签内容区身上扣
          （量法与起服务的命令见本文件 `Console0828.tsx` 顶部 `TabKey` 头注那段；
          这一格读 `[data-testid="c0828-kpis"]` 的 `getBoundingClientRect().height`：
          牌子独占一行时 149px、并入数字行后 105px）。 */}
      <span className={styles.kpiValRow}>
        <span className={`${styles.kpiBig} ${k.small === true ? styles.kpiBigSm : ""}`}>
          {k.estimated === true ? <span className={styles.kpiApprox}>~</span> : null}
          {k.value}
        </span>
        {k.estimated === true ? (
          <span className={styles.kpiEst} data-testid={`c0828-kpiest-${k.key}`}>
            {k.estTag ?? "估算"}
          </span>
        ) : null}
      </span>
      <span className={styles.kpiCmp}>{k.cmp}</span>
      {/* 第一层口径：**一行**，超长 ellipsis（`.kpiCal1`）。
          完整那段在上面的浮层里，一字未删 —— 两者由 `cal` / `calOne` 各管一头。
          ⚠ `data-testid` 沿用 `c0828-kpical-*`：既有测试靠它找口径，改名等于把门拆了。 */}
      <span className={styles.kpiCal1} data-testid={`c0828-kpical-${k.key}`}>
        {k.calOne}
      </span>
    </div>
  );

  /** 第一屏那四张（仓主指定）。⚠ 按 `HEADLINE_KPIS` 的**顺序**取，不是按 `kpis` 的顺序。 */
  const headKpis = HEADLINE_KPIS.map((key) => kpis.find((k) => k.key === key)).filter(
    (k): k is KpiCard => k !== undefined,
  );
  /** 其余卡 —— **没被删**，整卡搬进「执行记录」页签（降层，不是删除）。 */
  const restKpis = kpis.filter((k) => !HEADLINE_KPIS.includes(k.key));

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
                      <b>{p.startTick === null || p.startTick === undefined ? "开始时间未给" : `${tickLabel(cal, p.startTick)} 起`}</b> · {p.label ?? p.kind}
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

      {/* ══ WO-SIM-REALITY-METER · 真实度读数 + 一键跟纯占位世界对照 ══════════════
          **第一层常显**（⛔ 不藏进浮层，⛔ 不随页签变，⛔ 推演前也在）——
          它答的是「这一屏的数能不能拿来做决策」，必须在不点任何东西的情况下就读得到。
          高度从三栏身上扣（本块 `flex:none` · `.wrap` `flex:1 min-height:0`），页面不长。 */}
      <RealityMeterRow
        origin={origin}
        absence={originAbsence}
        varsByType={varsByType}
        typeNames={typeNames}
        stateVarNames={stateVarNames}
        sessionId={sessionId}
        replay={replay}
        orders={orders}
      />

        {/* ══ WO-C0828-COO-FIRST-SCREEN · 结论区 —— **第一屏的全部**（恒在，不随页签变）══
            顺序就是 COO 问问题的顺序：这是哪一次推演 → 多少钱 / 谁 / 卡在哪 → 怎么办。
            ⚠ 它**在 `.wrap` 之外**，拿的是整幅宽（2026-09-15 实测 1310px）而不是中栏的 666px ——
              四个数是头条，值这个宽度。
              （量法与起服务的命令见本文件 `Console0828.tsx` 顶部 `TabKey` 头注那段；
              这一格在 1600×900 下读 `[data-testid="c0828-verdict"]` 与该页 `main` 的
              `getBoundingClientRect().width`。） */}
        {result !== null && money !== null ? (
          <div className={styles.verdict} data-testid="c0828-verdict">
            {/* ① 顶条：`N 件扰动 · 推演至 <日期>` */}
            <div className={styles.vBar}>
              <span className={styles.vBarTitle}>本次推演</span>
              <span className={runM.isPending ? `${styles.badge} ${styles.badgeQuiet}` : styles.badge} data-testid="c0828-run-badge">
                {runM.isPending
                  ? "推演中"
                  : `${result.staged.length} 件扰动 · 推演至 ${tickLabel(cal, result.afterTick)}`}
              </span>
              <span className={styles.calibre} data-testid="c0828-verdict-sub">
                {result.deltas.length} 格读数发生变化 · 明细在下方页签
                <InfoPopover topic="这一屏怎么读" testId="c0828-verdict-sub">
                  左栏选事件 → 开始推演 → 第一层给四个数与「怎么办」，明细在下方页签；右栏给要点与建议。
                  本次 {result.staged.length} 件扰动事件叠加，{result.deltas.length} 格读数发生变化。
                </InfoPopover>
              </span>
              {/* 右侧次级动作 —— ⚠ **没有新造动作**：同一个 `runM.mutate`、同一份禁用判据。 */}
              <span className={styles.pageActs}>
                <button
                  type="button"
                  className={styles.btn}
                  data-testid="c0828-rerun"
                  disabled={runM.isPending || staged.length === 0}
                  title={staged.length === 0 ? "左栏待施加清单为空" : "按当前左栏清单与推演时长重新推演"}
                  onClick={() => runM.mutate()}
                >
                  {runM.isPending ? "推演中…" : "重新推演"}
                </button>
              </span>
            </div>

            {/* ② 四个数 —— ⚠ 卡片取数、口径浮层、`c0828-kpi-*` / `c0828-kpical-*` 全部沿用。 */}
            <div
              className={styles.kpis}
              data-testid="c0828-kpis"
              style={{ "--kpi-n": headKpis.length } as React.CSSProperties}
            >
              {headKpis.map((k, i) => renderKpi(k, i, headKpis.length))}
            </div>
            {/* ══ 红线 4 · 这一排数**出身不同**，一句话说清谁硬谁软 ════════════════════
                ⚠ 这一句必须**第一层可见**（不折叠）：它答的是「这些数能不能拿来做决策」。
                  展开的那一层只放「凭什么这么说」的取证细节（R-UI-3），
                  而**结论本身与每张卡上的 `~` / 小牌子都在第一层** ⇒ 不是静默降层。 */}
            <p className={styles.calibre} data-testid="c0828-verdict-origin">
              <b>先看「受阻环节」与下方「怎么办」</b>：读真字段、判真红线。带 <b>~</b> 的三个数只作<b>量级参考</b>
              <InfoPopover topic="为什么带 ~ 的三个数只作量级参考" testId="c0828-verdict-origin">
                {/* ⚠ **2026-09-16 订正（WO-SIM-REALITY-METER）**：这里原先写死
                    「5,895 格全部为派生值，真读数 0 格」。`WO-SIM-ORDER-REAL-FIELDS` 落地当天
                    那句话就变成了**假话**（真读数不再是 0，实测 450 格），而它是直接印在用户屏上的。
                    形态是本仓反复记账的那一条：**写死的数字不度量「今天是多少」**，
                    改了也不会红。⇒ 改成从本会话回包**现算**；取不到就照实说取不到。 */}
                本会话世界态出处回包标为 <b>结构派生</b>（不是量出来的）：
                生成式 <b>round(hash01(对象id|状态变量) × 100)</b>，
                {origin === null || origin.cells === null || origin.measuredCells === null ? (
                  <b>本次取不到格数分项（{originAbsence ?? "出处记号缺席"}）</b>
                ) : (
                  <b>
                    {origin.cells.toLocaleString("zh-CN")} 格里 {origin.derivedCells === null ? "—" : origin.derivedCells.toLocaleString("zh-CN")} 格为派生值，
                    真读数 {origin.measuredCells.toLocaleString("zh-CN")} 格
                  </b>
                )}
                。 ⇒「哪些订单算被推动」由这个占位世界选出，<b>不由「这张单是否真用了出事的物料」选出</b>；
                叠加传导边按真实用量加权的是少数：种子里 49 条用量引用中 <b>43 条为空</b>。
                金额本身是真的（对象层 Order.value），<b>不可靠的是集合</b>，故降档呈现而非隐藏。
                反之「受阻环节」只收范围、不收世界态，读对象层真字段判规则表真红线 —— 与占位世界无关。
              </InfoPopover>
            </p>

            {/* ③ 怎么办 —— 引擎枚举出来的对策，每条一行 */}
            <div className={styles.howto} data-testid="c0828-howto">
              {/* 小节标题与「这一行对策是谁的」合成一行 —— 单开一行要多 18px，
                  而这 18px 是直接从页签内容区身上扣的。 */}
              <span className={styles.vSecHead}>
                怎么办
                {picked === null ? null : (
                  <>
                    {" "}· 针对「{picked.locus.label}」（{picked.candidates.length} 条）
                    <span className={styles.howWho}>{fixTag(picked)} · 系统不给推荐，决策由使用方作出</span>
                  </>
                )}
              </span>
              {picked === null || howtoRows === null ? (
                <p className={styles.calibre} data-testid="c0828-howto-none">
                  {impGroups === null
                    ? "本次未取到卡点数据，故无对策可列 —— 这是调用未完成，不是「无对策」。"
                    : "本次扫出的卡点均无可拨杠杆，引擎给不出对策 —— 这是推演结论，不是加载失败。可在「受阻环节」页签里交由 agent 再试一条路。"}
                </p>
              ) : (
                <>
                  {howtoRows.map((r) => (
                    <div key={r.id} className={styles.howRow} data-testid={`c0828-how-${r.id}`}>
                      <span className={styles.howName}>{r.label}</span>
                      <span className={styles.howMove}>
                        {r.fromText} → {r.toText}
                      </span>
                      <span className={styles.howGain}>
                        {r.best === null ? (
                          // 契约只保证「至少一维动了」；真取不到时如实说，⛔ 不填 0。
                          <span className={styles.nocalc}>本次无改善维可报</span>
                        ) : (
                          <>
                            {r.best.label}{" "}
                            <span className={styles.howGainNum}>
                              {r.best.improvement > 0 ? "+" : ""}
                              {fmtGain(r.best.improvement)}
                            </span>{" "}
                            {r.best.unit}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                  {/* 第四行「不处置」—— 设计核心，⛔ 不许省：没有它，上面几行的代价都读作净支出。 */}
                  <div className={`${styles.howRow} ${styles.howRowNone}`} data-testid="c0828-how-donothing">
                    <span className={styles.howName}>不处置</span>
                    <span className={styles.howMove}>
                      实测 {picked.evidence.metricValue.toFixed(2)} / 红线 {picked.evidence.threshold.toFixed(2)}
                    </span>
                    <span className={styles.howGain}>
                      该处持续超线 <span className={styles.late}>{picked.evidence.breach.toFixed(2)}</span>，
                      {money.exposedOrders} 张单仍在此路径上
                    </span>
                  </div>
                </>
              )}
              {/* ⚠⚠ 诚实位 · **不许删**：屏上不给「代价 / 见效时间」，必须说清是哪一种「没有」。
                  第一层留**可判定的那一句**（是字段不存在，不是这次没取到）——
                  这正是规范 §1 要求降层后必须保留的那半；取证细节进浮层。 */}
              <p className={styles.calibre} data-testid="c0828-howto-nocost">
                这几行<b>不给「代价」与「见效时间」</b>：引擎回包里<b>没有这两个字段</b> —— 是<b>字段不存在</b>，不是这次没取到
                <InfoPopover topic="为什么没有代价与见效时间" testId="c0828-howto-nocost">
                  方案候选（`SolutionCandidate`）今天只有：落点、从多少拨到多少、逐维 KPI 改善量、
                  档位出处、join 路径与生成公式 —— <b>没有 cost、没有 leadTime、没有风险等级</b>。
                  它是**严格对象**（多一个字段就会解析失败），所以这份清单就是全部。
                  「字段不存在」与「这次没取到」<b>处置相反</b>：前者要上游先定义口径，后者重试即可。
                  ⛔ 屏上也没有拿<b>超阈幅度</b>冒充代价、拿 <b>KPI 改善量</b>冒充天数 ——
                  那两样都不是时间，也不是钱。
                </InfoPopover>
              </p>
            </div>
          </div>
        ) : kpis.length === 0 ? null : (
          /* 推演前：`--kpi-n` = 本次真的有几张卡（3 张真量）。
             ⛔ 不写死 6：留三个空格子等于用版面暗示还有三个量没算出来。 */
          <div
            className={styles.kpis}
            data-testid="c0828-kpis"
            style={{ "--kpi-n": kpis.length } as React.CSSProperties}
          >
            {kpis.map((k, i) => renderKpi(k, i, kpis.length))}
          </div>
        )}
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
                  /* ══ 三段式（WO-SIM-PLAIN-WORDS · 仓主原话「不就是：什么事情 - 发生时间 - 调整了什么」）══
                   *
                   * ── 今天的行为是 X ──
                   * 展开后是四格平铺（落点对象 · 幅度 · details 里的起始 + 持续），格与格之间
                   * 没有任何结构，用户要自己在脑子里把它们归成「问的是什么」。
                   * ── 应该是 Y ──
                   * 收成仓主说的那三段，**顺序就是他说的那个顺序**。
                   *
                   * ⚠ 三段只是**分组与排序**，一个格子都没删（判据 4：字符集合只增不减）。
                   *   「幅度」排到第三段是三段式的直接后果 —— 它答的是「调整了什么」，
                   *   而且它有预填默认值（`defaultMagnitude`），唯一必填的是第一段那个下拉。 */
                  <div className={styles.expand} data-testid={`c0828-form-${ev.id}`}>
                    <p className={styles.calibre} data-testid={`c0828-seg1-${ev.id}`}>
                      ① 什么事：{ev.name}
                    </p>
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
                    {/* ⚠ 「一次性变更，之后一直生效」这句必须在**第一层**（展开表单即见），
                        不能只写在下面 `<details>` 里 —— 它回答的是「这件事为什么没有持续时长」，
                        而那一格的**缺席**恰恰是用户第一眼会问的事。成段解释仍在第二层。 */}
                    <p className={styles.calibre} data-testid={`c0828-seg2-${ev.id}`}>
                      ② 发生时间{ev.timeShape === "once" ? " · 一次性变更，之后一直生效" : ""}
                    </p>
                    {/* 稿子要求：「什么时候开始 · 持续多久」收在 details 里 */}
                    <details className={styles.more}>
                      <summary>{ev.timeShape === "once" ? "开始时间" : "开始时间与持续时长"}</summary>
                      <div className={styles.moreBody}>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>开始时间</span>
                          <span className={styles.numRow}>
                            <input
                              type="number"
                              value={startTick}
                              placeholder={cal === null ? "留空=当前拍" : "留空=从现在起"}
                              aria-label="开始时间"
                              onChange={(e) => setStartTick(e.target.value)}
                            />
                            {/* 单位词：取得到刻度就不写「拍」，让下面那行的**日期**当主口径；
                                取不到才退回「拍」，并由 `calShortfall` 说明为什么没有日期。 */}
                            {cal === null ? <span className={styles.unit}>拍</span> : null}
                          </span>
                        </div>
                        {/* ⚠ 输入的那个数**仍是拍序**（后端收的就是 `startTick`），
                            但屏上读到的主口径是**日期**，「第 N 拍」退到括号里。
                            ⛔ 没有把它换成日期选择器：`tickDays > 1` 时「某一天」落在哪一拍
                            要先定向上取整还是向下取整 —— 那是一条口径决定（引擎侧
                            `ticksForDays` 用的是 `ceil`），本单不顺手替它拍板。 */}
                        <p className={styles.calibre} data-testid="c0828-start-echo">
                          {cal === null
                            ? calShortfall
                            : startTick.trim() === ""
                              ? `留空 = 从现在起（${curTick === null ? "当前时点未知" : tickLabel(cal, curTick)}）`
                              : Number.isFinite(Number(startTick))
                                ? `= ${tickLabel(cal, Number(startTick))}`
                                : "这一格不是数字，无法换算日期"}
                        </p>
                        {/* ── 一次性 / 持续 两种时间形态，表单不一样（`eventCatalog.EventTimeShape`）──
                            `once` ⇒ **不渲染**「持续」这一格：填了它引擎会在到期那一拍
                            把这笔 delta 撤掉（`sim/propagation.ts` 的 `exitsAt`/`revertValue`），
                            而「改交付地点 · 持续 5 拍」= 第 6 天收货地自己改回去，业务上不存在。 */}
                        {ev.timeShape === "sustained" ? (
                          <>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>持续时长</span>
                              <span className={styles.numRow}>
                                <input
                                  type="number"
                                  value={duration}
                                  placeholder="留空=一直持续"
                                  aria-label="持续时长"
                                  data-testid={`c0828-dur-${ev.id}`}
                                  onChange={(e) => setDuration(e.target.value)}
                                />
                                <span className={styles.unit}>{tickUnitWord(cal)}</span>
                              </span>
                            </div>
                            <p className={styles.calibre} data-testid={`c0828-dur-echo-${ev.id}`}>
                              {duration.trim() === "" || !Number.isFinite(Number(duration))
                                ? "留空 = 一直持续，不自动恢复。"
                                : cal === null
                                  ? `= ${spanLabel(cal, Number(duration))} —— ${calShortfall ?? ""}`
                                  : `= ${spanLabel(cal, Number(duration))}，期满后该项自动恢复。`}
                            </p>
                            <p>
                              两格留空 = 自当前时点起一直生效。若同时填写开始时间与持续时长，
                              且该窗口已<b>整段落在过去</b>，后端仍会受理（201）而世界态不变 ——
                              该情形后端不返回任何提示，故在此说明。
                            </p>
                          </>
                        ) : (
                          <p data-testid={`c0828-once-${ev.id}`}>
                            <b>一次性变更，之后一直生效。</b>
                            这件事发生完就结束，不设持续时长 —— 变更本身不会到期自己撤回
                            （会随时间消退的是它的<b>后果</b>，那由传导与衰减负责）。
                            开始时间留空 = 自当前时点起生效；若填的时点已<b>落在过去</b>，
                            后端仍会受理（201）而世界态不变，该情形后端不返回任何提示，故在此说明。
                          </p>
                        )}
                        <p>
                          本事件落到 {L.typeKey} 的 {L.stateVar} 上；{ev.detail}
                        </p>
                      </div>
                    </details>

                    <p className={styles.calibre} data-testid={`c0828-seg3-${ev.id}`}>
                      ③ 调整了什么
                    </p>
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
              aria-label="推演时长"
              data-testid="c0828-horizon"
              onChange={(e) => setHorizon(Math.max(1, Number(e.target.value)))}
            />
            <span className={styles.unit}>{tickUnitWord(cal)}</span>
          </span>
        </div>
        <p className={styles.calibre} data-testid="c0828-horizon-echo">
          {cal === null
            ? `${spanLabel(cal, horizon)} —— ${calShortfall ?? ""}`
            : curTick === null
              ? `= ${spanLabel(cal, horizon)}`
              : `= ${spanLabel(cal, horizon)}，推演至 ${tickLabel(cal, curTick + horizon)}`}
        </p>
        <button
          type="button"
          className={styles.go}
          data-testid="c0828-go"
          disabled={!enabled || staged.length === 0 || runM.isPending}
          /**
           * ⚠ `title` 只放**为什么现在点不动**，⛔ 不放口径。
           *
           * 我第一版把「一次执行：施加扰动 · 推进世界 · …」这串放进了 `title`，
           * 被 `provenance-popover-legibility` 那道棘轮当场咬红（**按渲染文本计 94 > 基线 93**）——
           * 规范 §2 R-UI-3 明禁用原生 `title` 充当浮层：它在 disabled 元素上多数浏览器
           * 根本不渲染，键盘与读屏也拿不到，写进去等于**写了没人看得见**。
           * 那五步现在只在第一层的「本次推演执行记录」里给（展开即见），这里不重复一份。
           * ⇒ 可点时**不给 title**（`undefined`，React 会整个不渲染这个属性）。
           */
          title={
            !enabled ? "需先建立推演会话" : staged.length === 0 ? "请先添加至少一件扰动事件" : undefined
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
              {/* 铁律 1.5 判据二：「今天推演路零 LLM ⇒ 必须明写『本次未调用 agent』，
                  不许留白让人以为调了」。2026-09-14 真后端实测（datacore:15001 + agentcore:15002
                  分开起、分别看访问日志）：agentcore 全程只被调 /b/v1/scenarios（页面初始化拉场景卡）
                  与 /b/v1/outbox（事件轮询），日志里 agent|orchestrat|workflow|qos|EXECUTING 零命中；
                  推演动作全在 datacore 的 /a/v1/sim/... 上。⇒ 屏上这行不是免责声明，是实测结论。 */}
              <div style={{ marginTop: 6 }}>
                <b>本次未调用 agent</b> —— 上述五步均为确定性计算：读已发布的传导规则表做传导推演，
                再由求解器算卡点。<b>同一组扰动重复推演，结果逐字节相同</b>（不变量 R6）。
                屏上的数字背后没有语言模型参与推理。
              </div>
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
          {/* WO-UX-UNIFY：原先这里还有一个 `data-testid="c0828-expert"` 的「专家模式 ▸」按钮。
              它**没有被删掉，是被挪到了中栏的页签行** —— 「专家工作台」与本控制台是同一个会话上的
              两套 UX，那正是「页签」该表达的东西（纪律第 6 条），藏在左栏页脚等于没有入口。
              testid 一字未改，故三个既有测试文件的 `enterExpert()` 照常可用。 */}
        </div>
      </aside>

      {/* ══ 主区 ══ */}
      <main className={styles.main}>
        {/* ══ WO-UX-UNIFY ① 标题行 —— **只在推演前渲染**（WO-C0828-COO-FIRST-SCREEN）══
            推演后这一行的三样（标题 / 状态徽章 / 重新推演）整体搬进了上方结论区的顶条，
            `c0828-run-badge` 与 `c0828-rerun` 两个 testid **一字未改**，
            且两处**互斥渲染** ⇒ 全屏任何时刻仍只有一个 `c0828-run-badge`。
            ⛔ 不是删了一行标题：推演后那一行的信息量更大（多了「N 件扰动」），
              且它挪到了**必定可见**的第一屏，而不是中栏页签之上。 */}
        {result === null ? (
          <div className={styles.pageHead} data-testid="c0828-pagehead">
            <h2 className={styles.pageTitle}>本次推演</h2>
            <span className={`${styles.badge} ${styles.badgeQuiet}`} data-testid="c0828-run-badge">
              {runM.isPending ? "推演中" : "未推演"}
            </span>
            <p className={styles.pageSub}>
              左栏选事件 → 开始推演 → 本屏第一层给四个数与「怎么办」，明细在下方页签；右栏给要点与建议。
              尚未推演，下方各格为空属正常。
            </p>
          </div>
        ) : null}

        {/* ══ ② 页签行 ═══════════════════════════════════════════════════════
            ⚠⚠ 本段原注释写的是「只有 2 个真页签…⛔ 没有把财务/客户/卡点/对策拆成页签，
               它们必须同时在场才能互相对账；拆开就正好是第 6 条禁止的『数据子集』」。
               **前半句已被本单推翻，后半句仍然成立** —— 差别在「同时在场」的含义：
               它讲的是 **DOM 与对账关系**，不是「同时可见」。
               五块面板现在**一块都没卸载**（见 `.tabPane`：`hidden` 切换，不是条件渲染），
               对账关系原样；而**第一屏恒定摆着四个数与「怎么办」**，
               任何页签下都能对账，不需要来回翻 —— 第 6 条禁的那种「切成几份逼人翻」并未发生。
               推翻它的是实测（**2026-09-15**，真后端 + 真 chromium 1600×900）：
               五块纵向摞着 = **4.28 屏**（`#main-content` 3601px / 842px），第 1 屏读不完一个完整结论。
               复验方式同本文件 `Console0828.tsx` 顶部 `TabKey` 头注给的那段浏览器控制台量法
               （含起真后端与 `pnpm --filter frontend-shell exec vite` 的命令）。 */}
        <div className={styles.lens} role="tablist" aria-label="推演控制台视图" data-testid="c0828-lens">
          {/* 会滚的那一段 —— 页签多到放不下时它自己横滚，⛔ 不折行（折行要多占一整行 37px）。 */}
          <div className={styles.lensScroll}>
          {result !== null && money !== null
            ? TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? `${styles.lensTab} ${styles.lensTabOn}` : styles.lensTab}
                  data-testid={`c0828-tab-${t.key}`}
                  onClick={() => { goTab(t.key); }}
                >
                  {t.label}
                  {/* 条数取自引擎回包，⛔ 不是写死的装饰；取不到时**不显示数字**而不是显示 0。 */}
                  {t.n === null ? null : <span className={styles.lensN}>{t.n}</span>}
                </button>
              ))
            : (
              <button
                type="button"
                role="tab"
                aria-selected={true}
                className={`${styles.lensTab} ${styles.lensTabOn}`}
                data-testid="c0828-lens-console"
              >
                推演与对策
              </button>
            )}
          </div>
          {/* ⚠ `c0828-expert` 这个 testid **原样保留**（3 个既有测试文件靠它进专家态）。
              它不是本页的一个切面而是**另一套 UX** ⇒ 钉在最右，**在滚动区之外** ——
              **2026-09-15 实测**：它排在滚动区末尾时七个按钮合计 676px > 条宽 608px，
              最后那个被切掉（标签后半截「· 8 档页签」看不见）；挪出滚动区后七个全不截断。
              复验：真浏览器 1600×900 进 `/v/sim-unified`（起服务的命令见本文件
              `Console0828.tsx` 顶部 `TabKey` 头注），读 `[data-testid="c0828-lens"]` 下每个
              button 的 `getBoundingClientRect().right` 与条本身的 `right` 比。 */}
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className={`${styles.lensTab} ${styles.lensRight}`}
            data-testid="c0828-expert"
            onClick={onExpert}
          >
            专家工作台 · 8 档页签
          </button>
        </div>

        {/* ══ 页签内容区 —— 高度由 `.tabBody` 吃掉剩余空间并**自己滚**，页面不滚 ══ */}
        <div className={styles.tabBody} ref={tabBodyRef} data-testid="c0828-tabbody">

        {/* ══ WO-SIM-DENSE ④ · 传导影响图 —— **本次不画**（诚实位，不是漏做）═══════════
            设计稿中栏是四列图：扰动落点 → 受阻环节 → 承载对象 → 敞口；红=本次被推动、灰=在册未触发。
            实测回包里缺两样，画出来就得编：
             ① 「本次被推动 vs 在册未触发」分不开 —— 受阻环节来自 `chain_impediments`，
                它只收 `{ scope }`，不收会话 / 世界态 / 扰动 ⇒ 加不加扰动，那批环节一字不变。
             ② 「某处环节压着哪些订单」没有承载物 —— 每条记录只有 locus / severity /
                evidence{ metricValue, threshold, unit, ruleKey }，**没有订单数、没有金额**。
            ⇒ 连线就是编一条不存在的归因。宁可留白并写明算不出，也不画一张看起来像真的图。 */}
        {/* ⚠ 这一处**降层了，没删字**（R-UI-3）：第一层只留「本次不画」这个**状态**，
            「凭什么不画」那两条原因整段进浮层，标签右边那个 `?` 就是降层留下的可见记号。
            ⛔ 这不是「改文案去躲门」—— 门在这一处**判得对**：那两条原因确实是
            「凭什么这么算」，按规范 §2 R-UI-3 本就属浮层；第一层留的是「这个数/这个块是什么」。
            ⚠ 浮层里的字与改前**逐字相同**（交付报告给了字符数守恒两个数）。 */}
        {result !== null ? (
          <p className={styles.calibre} data-testid="c0828-graph-absent">
            <b>传导影响图本次不画</b>
            <InfoPopover topic="传导影响图为什么不画" testId="c0828-graph-absent">
              —— 引擎回包缺两样：受阻环节<b>不随本次扰动变化</b>
              （全流程扫描只按范围裁，不按扰动裁），且每处环节<b>不带承载订单数与金额</b>。
              缺这两样，「哪件事推动了哪处、压住多少钱」这几条线只能靠猜 ——
              <b>画出来的线会像真的，但它是编的</b>。上游补齐后这里再画。
            </InfoPopover>
          </p>
        ) : null}

        {runM.isPending ? (
          <div className={styles.run} data-testid="c0828-running">
            <span className={styles.zoneNum}>2</span>
            {/* 与紧挨着它的「推演时长」那一格同源（`spanLabel`）——
                两行相邻却一行写「3 天」一行写「3 拍」，正是本单要治的那种不一致。 */}
            正在推演往后 {spanLabel(cal, horizon)}…
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
            {/* ══ WO-C0828-COO-FIRST-SCREEN · 页签「客户与订单」════════════════════
                ⚠⚠ 原注释在这里写着「两块都仍挂在 DOM 里（**没有做成互斥页签**）——
                  既有接缝门要求 money / cust / impediment / board **同时在场**」。
                **现在确实做成页签了，而那条约束一个字没破** ——
                `.tabPane` 用 `hidden` 属性切换，四块**全部留在 DOM 里**：
                `getByTestId` / `textContent` 都不看可见性 ⇒ 接缝门的「同时在场」照旧成立，
                而 `display:none` 的子树**不计入 `scrollHeight`** ⇒ 一屏也成立。两件事不冲突。
                ⛔ 这里**不许改成条件渲染**（`{tab === "cust" && …}`）：那才是真把它们拆散，
                  接缝门 ④ 与 ⑦ 会当场红，且红在「找不到 testid」这种**指向错误病因**的地方。 */}
            <div className={styles.tabPane} hidden={tab !== "cust"} data-testid="c0828-pane-cust">
            <div className={styles.grid2}>

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
                        {/* WO-EXPOSURE-STATUS：排除掉的那批必须上屏。只报 150 不报「另有 350 已完成
                            不计入」，读者无法判断少掉的单去哪了 —— 那和原来报 500 一样不可核。 */}
                        {money.settledExcluded > 0 ? (
                          <li>
                            <span>已完成·不计入</span>
                            <span className={styles.mono}>{money.settledExcluded} 张</span>
                          </li>
                        ) : null}
                        {/* WO-EXPOSURE-MAGNITUDE：「被推动的单」恒等于全部未完成单（判据是「动没动」
                            不是「动多少」），换扰动不变。真正随扰动变的是**幅度分布**，必须上屏，
                            否则屏上那个 150 读起来像「这次影响了 150 张」，而它其实是「全集」。 */}
                        {money.magnitude.max !== null ? (
                          <li>
                            <span>变化幅度 p90 / 最大</span>
                            <span className={styles.mono}>
                              {money.magnitude.deltaMagnitudeP90?.toFixed(2) ?? "—"} / {money.magnitude.max.toFixed(2)}
                            </span>
                          </li>
                        ) : null}
                        {money.magnitude.buckets.filter((b) => b.n > 0).map((b) => (
                          <li key={b.label}>
                            <span>· {b.label}</span>
                            <span className={styles.mono}>{b.n} 张</span>
                          </li>
                        ))}
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
                <div className={styles.drill}>
                  <button
                    type="button"
                    className={styles.drillBtn}
                    data-testid="c0828-drill-cust"
                    onClick={() => { goTab("board"); }}
                  >
                    查看逐处受阻环节与对策数 →
                  </button>
                </div>
              </section>
            ) : null}
            </div>
            </div>

            {/* ══ 页签「受阻环节」—— 默认页签。它是第一屏「怎么办」那几行的宿主：
                点进来就是逐处环节 + 每处几条对策，接着往下走。 ══ */}
            <div className={styles.tabPane} hidden={tab !== "board"} data-testid="c0828-pane-board">
            {/* ══ 区⑤ 对策看板 ══ */}
            {impGroups !== null && impGroups.all.length > 0 ? (
              <section className={styles.panel} data-testid="c0828-board">
                <div className={styles.head}>
                  {zone("5", "对策清单")}
                  <h3 className={styles.headTitle}>对策看板 · {impGroups.all.length} 处受阻环节</h3>
                  <span className={styles.headRight}>按严重度排序 · 系统不给推荐</span>
                </div>
                {/* ══ 诚实标：这一块**不随本次扰动变** ═══════════════════════════════
                  *
                  * 2026-09-15 真浏览器对照实验（同一会话，两个不同扰动）实测：
                  *   原材料涨价 → 被推动的单 150 张 · 敞口 156.6 亿 · 幅度 p90/max 11.27/18.49
                  *   设备故障   → 被推动的单  56 张 · 敞口  62.2 亿 · 幅度 p90/max  1.07/ 4.54
                  * 主数**随扰动变**；而本块 **18 处受阻环节、严重度、实测/红线、对策数逐字节相同**
                  * （头两行连 `电解液 59 · 121.00/90.00 · C28` 都一样）。
                  *
                  * 病因（实测非推断）：`chainImpediments`（`solvers/service.ts:4549`）读的是
                  * **对象层基线快照** —— `loadContext` + `listByType(MaterialBalance/OrderLine)` +
                  * `links.list`，**零 sessionId、零 getTickState、零世界态**；判定器本身是纯函数
                  * （`chain-impediment.ts` 里 `repos.` 命中 0）。
                  *
                  * ⚠ 这**不是**「传个 sessionId 就好」：推演世界是 0–100 的压力读数，本块判的是业务字段
                  * （`121.00 / 90.00 天`、`3974.32 / 1760.00 套/日`）—— 两边不在同一个量纲空间，
                  * 中间缺的是「压力数 → 天数/张数/金额」那座桥（本体已立账）。修它是另一件事。
                  *
                  * ⇒ 在桥接通之前，**必须在屏上说出来**。它和随扰动变的主数并排摆着，
                  *   读者只能理解成「这次推演算出来的」——**摆错位置比没有更糟**，
                  *   那正是仓主最初撞到的那个形态：「输入不同的扰动因素，该截屏数据没有变化」。
                  */}
                <p className={styles.calibre} data-testid="c0828-board-baseline-note">
                  ⚠ 本块为<b>基线扫描</b>：读的是对象层当前快照，<b>不随本次扰动变</b> ——
                  换一个扰动重跑，这 {impGroups.all.length} 处与各自的严重度、实测/红线都不会改变。
                  它回答的是「<b>现在哪里卡着</b>」，不是「<b>这次扰动会卡在哪</b>」。
                </p>
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
                              {/* 同名两行靠这一格分开（**实测于 2026-09-11**：同名标签 5 组 × 2 行）。
                                  复验：`POST /a/v1/solvers/chain_impediments/invoke` 读
                                  `data.impediments[].locus.label` 做词频；判据见本文件 `fixTag` 头注。 */}
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
                <div className={styles.drill}>
                  <button
                    type="button"
                    className={styles.drillBtn}
                    data-testid="c0828-drill-board"
                    disabled={picked === null}
                    title={picked === null ? "本次无可处置卡点，故无对策面板可去" : undefined}
                    onClick={() => { goTab("options"); }}
                  >
                    查看选中那一处的四栏对策 →
                  </button>
                </div>
              </section>
            ) : null}

            </div>

            {/* ══ 页签「对策方案」—— 四栏方案 + agent 补充对策（同一块区域，两段） ══ */}
            <div className={styles.tabPane} hidden={tab !== "options"} data-testid="c0828-pane-options">
            {/* ══ 区⑤b 四栏方案 ══ */}
            {picked !== null ? (
              <section className={styles.panel} data-testid="c0828-options">
                <div className={styles.head}>
                  {zone("5", "对策方案")}
                  <h3 className={styles.headTitle} data-testid="c0828-options-title">
                    {picked.locus.label} · {picked.candidates.length} 种对策
                  </h3>
                  {/* 重名的两处靠这一行分开（**实测于 2026-09-11**：同名标签 5 组 × 2 行）。
                      复验：`POST /a/v1/solvers/chain_impediments/invoke` 读
                      `data.impediments[].locus.label` 做词频；判据见上 `fixTag` 头注。 */}
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
                {/* WO-UI-LAYER-DEMOTE：第一层留事实（无按钮·不处置无需操作），理由降第二层。 */}
                <p className={styles.calibre} data-testid="c0828-donothing-note">
                  第四栏无按钮 —— 不处置无需操作，属默认发生。
                </p>
                <details className={styles.calibre}>
                  <summary>为什么要摆这一栏</summary>
                  没有它，前三栏的代价都读作净支出；有了它，前三栏才有参照基线。
                </details>
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

            </div>

            {/* ══ 页签「全流程扫描」════════════════════════════════════════════
                ⚠ 这一块与下面「财务影响」原本在 `.rowB` —— 一条**挂在三栏之外、整幅宽**的行，
                  实测落在第 **4.2 屏**。搬进页签后两块内部**一个字符没改**，既有 testid 全部原样
                  （`c0828-impediment` / `c0828-imp-error` / `c0828-tl-head` / `c0828-tl-calibre` …）。
                ⛔ `.rowB` 那个容器连同 `c0828-rowb` 一并退役：它的职责（把两块并排）
                  已由页签接手，留着就是两套版面机制并存。该 testid 全仓零引用（已核）。 */}
            <div className={styles.tabPane} hidden={tab !== "scan"} data-testid="c0828-pane-scan">
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
            </div>

            {/* ══ 页签「财务影响」—— 金额勾稽（第一屏只给敞口一个数，明细在这里）══ */}
            <div className={styles.tabPane} hidden={tab !== "money"} data-testid="c0828-pane-money">
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
                    {/* WO-UI-LAYER-DEMOTE：方法论解释降第二层；第一层只留「按全局差分计算」这个事实。 */}
                    <details>
                      <summary>波及面为什么按全局差分算，而不看被扰动的那一格</summary>
                      源变量常被约束在域上界附近，即使施加 100 倍量级，源格变动可能仅千分之几，
                      而下游变动显著 —— 拿源格判定「扰动生没生效」会误判。本屏波及面按全局差分计算。
                    </details>
                    {result.receipts.length === 0 ? null : (
                      <p>
                        落库回执：
                        {result.receipts.map((r) => ` ${r.name}（起始 ${r.startTick === null ? "未给" : tickLabel(cal, r.startTick)}）`).join(" ·")}
                      </p>
                    )}
                  </div>
                </details>
                {/* 下钻出口（纪律第 3 条）—— 目的地是**同屏已有**的受阻环节面板，不新建目的地。 */}
                <div className={styles.drill}>
                  <button
                    type="button"
                    className={styles.drillBtn}
                    data-testid="c0828-drill-money"
                    onClick={() => { goTab("scan"); }}
                  >
                    查看这笔敞口卡在哪些环节 →
                  </button>
                </div>
              </section>
            </div>

            {/* ══ 页签「执行记录」════════════════════════════════════════════════
                收三样，**全部是既有内容换了挂载点，一个字都不是新编的**：
                 ① 全屏诚实位 + 「本次推演的计算口径」披露层（原在中栏瀑布最底下）
                 ② 被挪下来的两张 KPI 卡（`fix` 可处置 / `entity` 可落点实体）——
                   它们**没有被删**，只是让出第一屏那四格；
                   `entity` 同时仍在左栏页脚 `c0828-entity-counts` 第一层可见。
                 ③ 本次扰动的**落库回执**（起始拍由后端定，不是前端猜的）。 */}
            <div className={styles.tabPane} hidden={tab !== "log"} data-testid="c0828-pane-log">
            {restKpis.length === 0 ? null : (
              <>
                <span className={styles.vSecHead}>本次推演的其余读数（从第一屏降层至此，取数一字未改）</span>
                <div
                  className={styles.kpis}
                  style={{ "--kpi-n": restKpis.length, padding: 0 } as React.CSSProperties}
                  data-testid="c0828-kpis-rest"
                >
                  {restKpis.map((k, i) => renderKpi(k, i, restKpis.length))}
                </div>
              </>
            )}
            {result.receipts.length === 0 ? null : (
              <p className={styles.calibre} data-testid="c0828-log-receipts">
                <b>本次施加的扰动落库回执</b>（起始拍由<b>后端</b>给定，不是前端猜的）：
                {result.receipts
                  .map((r) => ` ${r.name}（起始 ${r.startTick === null ? "未给" : tickLabel(cal, r.startTick)}）`)
                  .join(" ·")}
              </p>
            )}
            {/* 诚实位：参考稿每张卡都有走势线，本屏**没有数据源**画它。
                下面那句「只有两个观测点」是**真会过时**的一条（上游一给逐拍序列它就变假），
                故挂了一条可执行赌注。⚠ 赌注**钉在上游契约**（`endpoints.ts` 的 `simTick` 回包型）
                而不是本文件自己的字符串 —— 自指的赌注等于没赌。
                今天那个型是 `{ curTick; state; trace?; disclosure? }`：**一个终态，没有逐拍序列**。
                谁往回包里加了 `series`/`perTick`（或改了这四个字段），门当场红，
                届时要么屏上这句话改对、要么真把走势线画上，二选一。 */}
            {/* WO-UI-LAYER-DEMOTE：第一层只留两个**事实**（无走势线 · 第二行是同次对比），
              * 「为什么」整段降进 `<details>`。降层依据见本文件上方同名注释段。 */}
            <p className={`${styles.calibre} ${styles.footNote}`} data-testid="c0828-kpi-nospark">
              各卡<b>不带迷你走势线</b>；第二行是<b>同次推演内的对比</b>（占订单簿 / 占总数），<b>不是</b>「较上周」。
            </p>
            <details className={`${styles.calibre} ${styles.footNote}`}>
              <summary>为什么没有走势线 · 第二行为什么不是环比</summary>
              本次推演一次跳 {horizon} 拍后只读<b>一次</b>终态，
              全屏只有「扰动前」「扰动后」两个观测点，中间每一拍的读数从未取回{/* @stale-fact apps/frontend-shell/src/api/endpoints.ts /curTick: number; state: TickState; trace\?: unknown\[\]; disclosure\?: SimRunDisclosure/ ==1 */}
              —— 两点画不出走势，补一条就是编造历史。这是缺数据源，不是缺实现。
              本屏也不留存历史推演，没有上一期可比，故第二行给的是同次推演内的真实对比。
            </details>
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
            </div>
          </>
        ) : null}
        </div>
      </main>

      {/* ══ WO-UX-UNIFY · 右栏 AI 常驻（纪律第 1 与第 5 条）══════════════════════
       *
       * **不弹窗、不抽屉、不遮内容** —— 它与正文同时在场。
       * 四段恒定：① 会话流 → ② 结论要点（带 ✓，每条挂一个量化值）→ ③ 建议行动 → ④ 提问入口。
       *
       * ⛔ **本栏一个新数据源都没有，一个新求解器调用都没有。** 逐段出处：
       *   ① `result.disclosure` —— `simTick(…, disclose:true)` 本来就回带的披露层
       *   ② `money` / `custView` / `impGroups` —— 与中栏三块面板**同一份 memo**，
       *      ⛔ 不另算一遍（另算就是给同一个事实造第二个出处，本仓治过多次）
       *   ③ `picked.candidates` 与既有的 `agentM` mutation（「交由 agent 生成对策」
       *      原本埋在受阻环节面板里，本轮**挪到**这里 —— 它本来就是"AI 建议"，
       *      挪过来是归位，不是新增；原位置的按钮同时保留，两处调的是同一个 mutation）
       *   ④ **今天没有本栏独立的对话框** —— 如实写明，⛔ 不摆一个点了没反应的输入框（假旋钮）
       */}
      <aside className={styles.ai} data-testid="c0828-ai">
        <div className={styles.aiHead}>
          <h2 className={styles.aiTitle}>推演助手</h2>
          <span className={styles.calibre}>
            {result?.disclosure?.agentInvoked === true ? "本次调用了 agent" : "本次未调用 agent"}
          </span>
        </div>

        {/* ── ① 会话流 ───────────────────────────────────────────────── */}
        <div className={styles.aiSec} data-testid="c0828-ai-stream">
          <span className={styles.aiSecHead}>① 本次推演做了什么</span>
          {result === null ? (
            <div className={styles.aiBubble}>
              尚未推演。左栏选事件、定推演时长，点「开始推演」后，这里会逐项列出本次引用的数据、
              走过的本体切片、命中的规则与耗时。
              <br />
              <b>现在这里是空的，是因为还没算 —— 不是因为算不出来。</b>
            </div>
          ) : (
            <div className={styles.aiBubble}>
              一次操作依次执行：施加扰动 · 推进世界 · 财务影响 · 卡点识别 · 对策生成，共五次服务调用。
              世界态自 {tickLabel(cal, result.beforeTick)} 推进至 {tickLabel(cal, result.afterTick)}。
              {result.disclosure === null ? (
                <>
                  <br />
                  后端本次未返回披露层 —— <b>「未取到」不等于「不存在」</b>。
                </>
              ) : (
                <>
                  <br />
                  引用对象 <b className={styles.mono}>{result.disclosure.objects ?? "—"}</b> 个 · 关系{" "}
                  <b className={styles.mono}>{result.disclosure.links ?? "—"}</b> 条 · 切片{" "}
                  <b className={styles.mono}>{result.disclosure.sliceKey ?? "—"}</b> · 跳数{" "}
                  <b className={styles.mono}>{result.disclosure.hops ?? "—"}</b>。
                  <br />
                  规则已声明 <b className={styles.mono}>{result.disclosure.rulesDeclared ?? "—"}</b> 条，
                  本次触发 <b className={styles.mono}>{result.disclosure.rulesFired ?? "—"}</b> 条；
                  其中系数来自配置的 <b className={styles.mono}>{result.disclosure.withCoefficientRef ?? "—"}</b> 条
                  —— 其余是内联常数。耗时合计{" "}
                  <b className={styles.mono}>{result.disclosure.totalMs ?? "—"}</b> 毫秒。
                </>
              )}
            </div>
          )}
        </div>

        {/* ── ② 结论要点（带 ✓，每条挂一个量化值）─────────────────────── */}
        <div className={styles.aiSec} data-testid="c0828-ai-points">
          <span className={styles.aiSecHead}>② 本次结论要点</span>
          {result === null || money === null ? (
            <p className={styles.calibre}>推演后在此列出，每条后面挂它的量化值。</p>
          ) : (
            <ul className={styles.aiList}>
              <li>
                <span className={styles.aiTick}>✓</span>
                <span>
                  被推动的订单敞口 <span className={styles.aiQty}>{fmtMoney(money.exposure, "元")}</span>
                  （占订单簿 {pct(money.bookTotal === 0 ? 0 : money.exposure / money.bookTotal)}）
                  —— 是受影响订单的<b>金额规模</b>，不是利润损失。
                </span>
              </li>
              <li>
                <span className={styles.aiTick}>✓</span>
                <span>
                  受影响订单 <span className={styles.aiQty}>{money.exposedOrders}</span> 张 / 共{" "}
                  {money.bookOrders} 张
                  {custView === null ? null : (
                    <>
                      ，落在 <span className={styles.aiQty}>{custView.touchedCustomers}</span> 家客户上
                      （共 {custView.totalCustomers} 家）
                    </>
                  )}
                  。
                </span>
              </li>
              <li>
                <span className={styles.aiTick}>✓</span>
                <span>
                  {money.mainCause === null ? (
                    <>
                      <b>多因叠加，无法归因到单一事件</b> —— 本次施加{" "}
                      <span className={styles.aiQty}>{result.staged.length}</span> 件，
                      差分层看不出某一格是谁推的，<b>不猜</b>。
                    </>
                  ) : (
                    <>
                      主因是 <b>{money.mainCause}</b>（本次仅施加{" "}
                      <span className={styles.aiQty}>1</span> 件扰动，故可归因）。
                    </>
                  )}
                </span>
              </li>
              <li>
                <span className={styles.aiTick}>✓</span>
                <span>
                  {impGroups === null ? (
                    <>受阻环节本次<b>未取到</b> —— 这是调用失败，不是「无卡点」。</>
                  ) : (
                    <>
                      扫出受阻环节 <span className={styles.aiQty}>{impGroups.all.length}</span> 处：
                      可处置 <span className={styles.aiQty}>{impGroups.actionable.length}</span> 处、
                      仅可监控 <span className={styles.aiQty}>{impGroups.watchOnly.length}</span> 处。
                      {impGroups.watchOnly[0] === undefined ? null : (
                        <>
                          {" "}
                          超线倍数最高的是 <b>{impGroups.watchOnly[0].locus.label}</b>
                          {Number.isFinite(impGroups.ratioOf(impGroups.watchOnly[0])) ? (
                            <>（<span className={styles.aiQty}>{impGroups.ratioOf(impGroups.watchOnly[0]).toFixed(2)}×</span>）</>
                          ) : null}
                          ，当前<b>无对策</b>。
                        </>
                      )}
                    </>
                  )}
                </span>
              </li>
              <li>
                <span className={styles.aiTick}>✓</span>
                <span>
                  本次 <span className={styles.aiQty}>{result.deltas.length}</span> 格读数发生变化；
                  金丝雀：读到 <span className={styles.aiQty}>{money.ordersSeen}</span> 张单
                  （为 0 表示遍历失效，<b>不是「无波及」</b>）。
                </span>
              </li>
            </ul>
          )}
          {/* WO-UI-LAYER-DEMOTE：口径解释降第二层（规范 §1：口径降浮层/明细降第二层）。 */}
          <details className={styles.kpiCal}>
            <summary>这些数和中栏是同一份吗</summary>
            以上各数与中栏「财务影响 / 客户与订单敞口 / 受阻环节」<b>同源同一份计算</b>，
            不是本栏另算的第二份；两边若出现不一致，即为缺陷，不是口径差异。
          </details>
        </div>

        {/* ── ③ 建议行动 ─────────────────────────────────────────────── */}
        <div className={styles.aiSec} data-testid="c0828-ai-actions">
          <span className={styles.aiSecHead}>③ 可选行动</span>
          {picked === null ? (
            <p className={styles.calibre}>
              {result === null
                ? "推演后，这里列出引擎为选中那一处枚举出的对策。"
                : // 同 KPI「可处置」那条：这是**运行期条件文案**，只在 `picked === null`
                  // （即 `impGroups.actionable` 为空）时才渲染 ⇒ 它报的是本次这一跑的现算结果，
                  // 不是一条静态事实，故**不挂** `@stale-fact`，只把否定断言改成计数形态。
                  "本次带可用对策的处数为 0 —— 这是引擎枚举结果，不是本栏没取到。"}
            </p>
          ) : (
            <>
              <ul className={styles.aiList}>
                {picked.candidates.slice(0, 3).map((c) => (
                  <li key={c.candidateId}>
                    <span className={styles.aiTick}>▸</span>
                    <span>
                      {c.label}
                      <br />
                      <span className={styles.calibre}>
                        调到哪：{BIZ_RUNG[c.rung.kind].label} · 杠杆：{BIZ_JOIN[c.join.kind].label}
                      </span>
                    </span>
                  </li>
                ))}
                <li>
                  <span className={styles.aiTick}>▸</span>
                  <span>
                    <b>不处置</b> —— 该处将持续超线：实测{" "}
                    <span className={styles.aiQty}>{picked.evidence.metricValue.toFixed(2)}</span> / 红线{" "}
                    {picked.evidence.threshold.toFixed(2)}（超出{" "}
                    <span className={styles.aiQty}>{picked.evidence.breach.toFixed(2)}</span>）。
                  </span>
                </li>
              </ul>
              <p className={styles.kpiCal}>
                口径：<b>系统不给推荐，决策由使用方作出。</b>
                四栏完整比较（含「不处置」那一栏）在中栏「对策方案」面板里，本栏只列出名与两维。
              </p>
            </>
          )}
          <div className={styles.aiChips}>
            <button
              type="button"
              className={styles.aiChip}
              data-testid="c0828-ai-goto-options"
              disabled={picked === null}
              onClick={() => { goTab("options"); }}
            >
              查看四栏对策 →
            </button>
            {/* ⚠ 与受阻环节面板里那个「交由 agent 生成对策 ▸」是**同一个 mutation**。 */}
            <button
              type="button"
              className={styles.aiChip}
              data-testid="c0828-ai-ask-agent"
              disabled={picked === null || agentM.isPending}
              onClick={() => { if (picked !== null) agentM.mutate(picked.impedimentId); }}
            >
              {agentM.isPending ? "agent 生成中…" : "交由 agent 生成对策 →"}
            </button>
          </div>
          {agentErr === null ? null : (
            <p className={styles.calibre} data-testid="c0828-ai-agent-err">
              agent 未答成：{agentErr} —— 这是<b>调用失败</b>，不是「没有方案」。
            </p>
          )}
        </div>

        {/* ── ④ 提问入口 ─────────────────────────────────────────────── */}
        <div className={styles.aiSec} data-testid="c0828-ai-ask">
          <span className={styles.aiSecHead}>④ 追问</span>
          {/* ⛔⛔ 这里**刻意没有输入框**。参考稿第四段是「输入框 + 发送 + 快捷 chip」，
              而本控制台今天**没有自己的问答端点** —— 摆一个输入框上去，敲进去没有任何后端会收，
              那正是本仓最恨的假旋钮。⇒ 如实写明缺什么，并指向屏上**真的存在**的那个提问入口。 */}
          {/* ══ WO-UI-LAYER-DEMOTE（2026-09-15）· 自辩降层 ═══════════════════════════
            * 仓主：「页面上有哪些无效的描述型信息，都删除或放到第二层展示。」
            * 实测依据（同日，12 个扰动 vs 1 个扰动的**全页文本差分**）：
            *   两组**一模一样**的文本 773 处 / 16,236 字，其中 ≥40 字的长说明 95 处 / 8,773 字
            *   = **54.0%** —— 第一层过半的静态文字是说明，不是「数值 / 状态 / 名字」。
            *   与 `CONVENTION-ui-information-layering.md` §1 直接冲突，
            *   也是 `check-ui-first-layer.mjs` 今天判负 77 条里的一支。
            *
            * 本段原文含「摆一个敲进去没人收的输入框即是假旋钮」——**那是写给审核方的自辩**。
            * 第一层只留用户要用的那一句（去哪儿提问），理由降进 `<details>`（本文件既有范式，已用 14 处）。
            * ⛔ 降的是自辩，不是诚实位：「没有独立输入框」这个**事实**仍在第一层。 */}
          <p className={styles.calibre} data-testid="c0828-ai-noinput">
            本栏<b>没有独立的对话输入框</b>；自由提问请用<b>屏幕底部那条全局提问条</b>。
          </p>
          <details className={styles.calibre}>
            <summary>为什么这里不放输入框</summary>
            这块控制台今天没有自己的问答端点 —— 摆一个输入框上去，敲进去没有后端会收。
            底部那条全局提问条已接通查询编排，是真入口；本栏只负责把本次推演的结论与可选行动
            摆在正文旁边，不另起一套对话。
          </details>
        </div>
      </aside>
      </div>


    </div>
  );
}
