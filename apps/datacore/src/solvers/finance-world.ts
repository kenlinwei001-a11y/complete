/**
 * WO-FINANCE-WORLDSTATE · `finance_world_projection` —— 财务**金额**随世界态扰动的投影。
 *
 * ── 这个文件补的是哪一半（三形态判定 · 铁律 0.5 逐层追到底）────────────────────────
 * 「财务指标随扰动动态变化」由两半组成，今天只有一半在工作：
 *
 *  ✅ **压力指数那一半已通**：`seed.ts` 的 13 条 `demo_*` 传导规则里，成本/现金两条是真规则：
 *       `Material.priceShock --×0.65--> Model.costPressure --×0.9--> Order.costPressure`
 *       `Order.costPressure --×0.5--> Customer.receivablePressure --×0.4--> ARInvoice.overduePressure`
 *     `seed-demo-propagation.test.ts` 的「六方向逐条真触发」门逐条咬着它们。
 *
 *  ❌ **金额那一跳缺**：`financePnl(ctx: AuthCtx)` **零世界态入参**，读 `listByType("FinancePlan")`
 *     的本体真值 ⇒ 同一租户下施加任何扰动它都返回**逐字节相同**的一组数。
 *     全仓 `worldId`/`sessionId` 在 `solvers/` 下 **0 命中**
 *     （金丝雀：同目录同命令 `financePnl` 命中 2 ⇒ 是真零命中，不是 grep 坏了）。
 *
 * 故本文件**新增**一条通路，**不动** `finance_pnl`（它有既有调用方与金值；动签名会连坐）：
 *   `finance_pnl`               = 本体真值口径（不吃世界态，行为逐字节不变）
 *   `finance_world_projection`  = 世界态**推演投影**口径（吃 `args.worldId`）
 *
 * ── 取世界态：照抄现成先例，不自创 ────────────────────────────────────────────────
 * `sim/impact-analysis.ts:87–90` 已经把这件事做对了（`getSession` → `getTickState` → 回落
 * `baseSnapshot`），连同它那句「世界的态为空时如实说明本次实质跑在真本体当前值上」的诚实处置。
 * 本文件走同一条，**只是把结论从"没影响"改成 `available:false` + 原因** —— 因为金额面板显示
 * 一个 0 比不显示更坏（0 会被读成"扰动不影响钱"，那是静默错答）。
 *
 * ── 换算口径（可解释 · 可溯源 · 禁止写死系数而不说它从哪来）───────────────────────
 *   金额投影 = 基线 ×（1 + 压力 ÷ divisor）
 * 三个因子全部可溯：
 *   · **基线** = `FinancePlan.{budget,rolling}` / `ARInvoice.amount` 的**真值**，provenance 带真主键；
 *   · **压力** = 世界态里真承载对象上的 stateVar 真值，按**该对象的真金额加权**聚合
 *     （权重量纲在加权平均里自动相消 ⇒ `Order.qty×unitPrice` 与 `FinancePlan` 的万元口径不必同量纲）；
 *   · **divisor** = 唯一一处声明式量纲桥（压力按百分点读 ⇒ 100），**随回包下发**且可由
 *     `args.pressureUnit` 改写 —— 这就是本单对「禁止写死系数」的兑现：说清它从哪来、当场可改。
 * 另外把产生这些压力的 `PropagationRule` 的**真 id 与真系数**一并下发（`chain[]`），
 * 改种子系数 → 回包里的链跟着变，界面上"凭什么是这个数"当场可查。
 *
 * ── R4 / R6 ──────────────────────────────────────────────────────────────────
 * R4：**只读**。不写世界态、不写本体真值、不落 Action —— 沙盘只推演不写真值。
 * R6：无 `Date.now`、无随机；明细一律按稳定键排序；同 (worldId, tick, args) 两跑字节一致。
 */
import {
  FINANCE_WORLD_DEFAULT_LINE_ROLES,
  FINANCE_WORLD_PRESSURE_DIVISOR,
  type FinanceWorldBasis,
  type FinanceWorldCash,
  type FinanceWorldChainHop,
  type FinanceWorldLine,
  type FinanceWorldPressure,
  type FinanceWorldProjectionOutput,
  type FinanceWorldRecon,
  type FinanceWorldStateSource,
  type PropagationRule,
  type TickState,
} from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "../domain.js";
import { notFound, validationError } from "../errors.js";
import type { Repos } from "../repo/repo.js";
import { round } from "../prng.js";
import { num, str } from "./types.js";

/** 勾稽容差（与 `GapReconCheckSchema` 同一把尺子，不另立一套）。 */
const RECON_EPS = 1e-4;

/** 金额一律留两位（万元口径下两位 = 百元级，够读且不放大浮点噪声）。 */
const money = (v: number): number => round(v, 2);

/**
 * 世界态里某个对象的某个 stateVar。
 * **区分「键不存在」与「值为 0」**：前者 `undefined`（该对象不承载这个变量），后者 `0`（承载着、正好是 0）。
 * 这两件事在 `carriers` 计数上是不同的，混了就分不清「台账空」与「查过了没中」。
 */
const stateOf = (world: TickState, objectId: string, stateVar: string): number | undefined => {
  const v = world[objectId]?.[stateVar];
  return typeof v === "number" ? v : undefined;
};

/** 对象在本次金额口径下的权重（真金额；拿不到 → 0，由调用方回落等权）。 */
type WeightFn = (o: ObjectInstance) => number;

interface PressureAgg {
  value: number;
  carriers: number;
  universe: number;
  weighting: "VALUE" | "EQUAL";
  weightingNote: string;
  /** 承载对象里权重最大的那个（provenance 下钻落点；无承载对象 → null）。 */
  topCarrier: { id: string; pressure: number } | null;
}

/**
 * 按真金额加权聚合一个压力量。
 *
 * **分母是全域（universe），不是承载集**：没被世界态覆盖的对象压力读作 0 —— 它们确实
 * 在财务基数里、确实没受这次扰动影响。只对承载集取平均会把「10 张单里 1 张涨价」
 * 报成「全域涨价」，那是把局部推演放大成全局结论（静默错答的一种）。
 */
function aggregatePressure(
  objects: ObjectInstance[],
  world: TickState,
  stateVar: string,
  weightOf: WeightFn,
): PressureAgg {
  const universe = objects.length;
  if (universe === 0) {
    return {
      value: 0,
      carriers: 0,
      universe: 0,
      weighting: "EQUAL",
      weightingNote: "本租户该对象类型 0 条 —— 这个 0 是「台账空」，不是「压力为 0」。",
      topCarrier: null,
    };
  }
  let sumW = 0;
  let sumWP = 0;
  let sumP = 0;
  let carriers = 0;
  let top: { id: string; pressure: number; w: number } | null = null;
  // R6：按 id 升序遍历 —— 浮点加法不满足结合律，遍历序变则末位可能漂。
  for (const o of [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const raw = stateOf(world, o.id, stateVar);
    if (raw !== undefined) carriers += 1;
    const p = raw ?? 0;
    const w = Math.max(0, weightOf(o));
    sumP += p;
    sumW += w;
    sumWP += w * p;
    if (raw !== undefined && (top === null || w > top.w || (w === top.w && o.id < top.id))) {
      top = { id: o.id, pressure: p, w };
    }
  }
  const valueWeighted = sumW > 0;
  return {
    value: valueWeighted ? sumWP / sumW : sumP / universe,
    carriers,
    universe,
    weighting: valueWeighted ? "VALUE" : "EQUAL",
    weightingNote: valueWeighted
      ? `按承载对象真金额加权（Σ权重=${round(sumW, 2)}，量纲在加权平均里相消）`
      : "金额权重字段全为 0/缺失 ⇒ 回落等权平均；这不是「金额无关」，是「拿不到金额权重」，据实标注。",
    topCarrier: top ? { id: top.id, pressure: top.pressure } : null,
  };
}

export interface FinanceWorldDeps {
  repos: Repos;
}

export interface FinanceWorldArgs {
  worldId?: unknown;
  pressureUnit?: unknown;
  revenueLine?: unknown;
  costLine?: unknown;
  marginLine?: unknown;
}

/**
 * 跑一次财务世界态投影。
 *
 * @throws `validationError` —— 没给 `worldId`（**不静默回落到"随便哪个世界"**：那正是
 *   "以为在看这个世界、屏上却是另一个"的路径）。
 * @throws `notFound("sim world")` —— worldId 不存在**或**属于别的租户（R2 暗发，同 impact-analysis）。
 */
export async function projectFinanceWorld(
  deps: FinanceWorldDeps,
  ctx: AuthCtx,
  args: FinanceWorldArgs,
): Promise<FinanceWorldProjectionOutput> {
  const { repos } = deps;
  const worldId = str(args.worldId);
  if (!worldId) {
    throw validationError(
      "finance_world_projection 需要 args.worldId（哪个推演世界）—— 不给就没有世界态可读。" +
        "本求解器**拒绝**回落到「本体真值口径」：那条路已经有 `finance_pnl` 了，" +
        "回落只会让调用方以为自己拿到的是随扰动变的数。",
    );
  }

  // ── ① 取世界（照抄 `sim/impact-analysis.ts:87–90`，含它的诚实处置）─────────────────
  const world = await repos.sim.getSession(ctx.tenantId, worldId);
  if (!world) throw notFound("sim world");
  const tickState = await repos.sim.getTickState(ctx.tenantId, world.id, world.curTick);
  const worldState: TickState = tickState?.state ?? world.baseSnapshot;
  const worldStateSource: FinanceWorldStateSource = tickState ? "TICK" : "BASE_SNAPSHOT";
  const worldObjectCount = Object.keys(worldState).length;

  const notes: string[] = [];
  if (worldObjectCount === 0) {
    notes.push(
      `世界 ${world.id} 的态为空（baseSnapshot/tick 态均无对象）—— 本次实质跑在真本体当前值上，` +
        "未发生世界隔离。金额投影恒等于基线，那不是「扰动不影响钱」，是「这个世界里还没有任何态」。",
    );
  }

  // ── ② 量纲桥（唯一一处除数声明，随回包下发·可由 args 改写）────────────────────────
  const unitArg = str(args.pressureUnit);
  const pressureUnit: "pp" | "ratio" = unitArg === "ratio" ? "ratio" : "pp";
  if (unitArg && unitArg !== "pp" && unitArg !== "ratio") {
    throw validationError(`pressureUnit 只认 "pp" | "ratio"，收到 ${JSON.stringify(unitArg)} —— 不静默当缺省（静默会让调用方以为口径生效了）。`);
  }
  const divisor = FINANCE_WORLD_PRESSURE_DIVISOR[pressureUnit];
  const basis: FinanceWorldBasis = {
    kind: "PROJECTION",
    pressureUnit,
    divisor,
    source: unitArg ? "ARG" : "DEFAULT_DECLARED",
    note:
      `金额 = 基线 ×（1 + 压力 ÷ ${divisor}）。压力指数按${pressureUnit === "pp" ? "百分点(pp)" : "比率(ratio)"}读；` +
      "这是**推演投影**不是实测值 —— 基线取本体真值，增量由世界态压力沿传导规则折算。",
  };

  // ── ③ 三个压力量（各自带 carriers / universe / 加权口径）──────────────────────────
  const orders = await repos.objects.listByType(ctx.tenantId, "Order");
  const customers = await repos.objects.listByType(ctx.tenantId, "Customer");
  const invoices = await repos.objects.listByType(ctx.tenantId, "ARInvoice");

  /** 订单金额 = 数量 × 单价（种子里没有现成的 `value` 字段，这两个是真字段·`battery.ts:3793–3794`）。 */
  const orderValue: WeightFn = (o) => num(o.props.qty) * num(o.props.unitPrice);
  /** 客户金额权重 = 该客户名下发票金额之和（经真链路 `customer_has_invoice` 归集，见下）。 */
  const invoiceAmount: WeightFn = (o) => num(o.props.amount);

  // 发票 → 客户（经**传导规则自己走的那条边**，不另找一套映射：两套映射必然漂移）。
  const custLinks = await repos.links.list(ctx.tenantId, (l) => l.type === "customer_has_invoice");
  const custOfInvoice = new Map<string, string>();
  for (const l of [...custLinks].sort((a, b) => (a.toId < b.toId ? -1 : a.toId > b.toId ? 1 : 0))) {
    if (!custOfInvoice.has(l.toId)) custOfInvoice.set(l.toId, l.fromId);
  }
  const custWeight = new Map<string, number>();
  for (const inv of invoices) {
    const cid = custOfInvoice.get(inv.id);
    if (cid) custWeight.set(cid, (custWeight.get(cid) ?? 0) + invoiceAmount(inv));
  }

  const costAgg = aggregatePressure(orders, worldState, "costPressure", orderValue);
  const arAgg = aggregatePressure(customers, worldState, "receivablePressure", (o) => custWeight.get(o.id) ?? 0);
  const overdueAgg = aggregatePressure(invoices, worldState, "overduePressure", invoiceAmount);

  const pressureRow = (
    stateVar: string,
    objectType: string,
    agg: PressureAgg,
  ): FinanceWorldPressure => ({
    stateVar,
    objectType,
    value: round(agg.value, 6),
    carriers: agg.carriers,
    universe: agg.universe,
    weighting: agg.weighting,
    weightingNote: agg.weightingNote,
    provenance: {
      kind: "派生", // 世界态的值由传导引擎沿 PropagationRule 算出，不是实测录入
      drillType: objectType,
      // 聚合值 → `"*"`（契约 `GapProvenanceSchema.drillId` 既有约定）；有承载对象时给**真主键**下钻落点。
      drillId: agg.topCarrier?.id ?? "*",
      drillField: stateVar,
      drillValue: round(agg.topCarrier?.pressure ?? agg.value, 6),
    },
  });

  const pressures: FinanceWorldPressure[] = [
    pressureRow("costPressure", "Order", costAgg),
    pressureRow("receivablePressure", "Customer", arAgg),
    pressureRow("overduePressure", "ARInvoice", overdueAgg),
  ];

  // ── ④ 科目行投影（基线 = FinancePlan 真值）───────────────────────────────────────
  const roles = {
    revenueLine: str(args.revenueLine) || FINANCE_WORLD_DEFAULT_LINE_ROLES.revenueLine,
    costLine: str(args.costLine) || FINANCE_WORLD_DEFAULT_LINE_ROLES.costLine,
    marginLine: str(args.marginLine) || FINANCE_WORLD_DEFAULT_LINE_ROLES.marginLine,
  };
  const plans = [...(await repos.objects.listByType(ctx.tenantId, "FinancePlan"))].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const planOf = (line: string) => plans.find((o) => str(o.props.line) === line);
  const finId = (o: ObjectInstance | undefined) => (o ? str(o.props.finId) || o.id : "*");

  const costFactor = 1 + costAgg.value / divisor;
  const revenuePlan = planOf(roles.revenueLine);
  const costPlan = planOf(roles.costLine);
  const marginPlan = planOf(roles.marginLine);

  const revRolling = num(revenuePlan?.props.rolling);
  const cogsRolling = num(costPlan?.props.rolling);
  const gmRolling = num(marginPlan?.props.rolling);
  const revProjected = revRolling; // 本链不驱动收入 —— 理由写在下面 note 里，不擅自折算
  const cogsProjected = money(cogsRolling * costFactor);
  // 毛利用**增量法**而不是恒等式重算：`毛利' = 毛利 + Δ收入 − Δ成本`。
  // 恒等式重算（收入'−成本'）会在基线本身不满足恒等式时**悄悄改掉那个残差** —— 那就是引擎在编数。
  const gmProjected = money(gmRolling + (revProjected - revRolling) - (cogsProjected - cogsRolling));

  const pct = (deltaV: number, baseV: number) => (baseV === 0 ? 0 : round((deltaV / Math.abs(baseV)) * 100, 4));

  const lines: FinanceWorldLine[] = [];
  const projectedOf = new Map<string, number>([
    ...(revenuePlan ? ([[revenuePlan.id, revProjected]] as [string, number][]) : []),
    ...(costPlan ? ([[costPlan.id, cogsProjected]] as [string, number][]) : []),
    ...(marginPlan ? ([[marginPlan.id, gmProjected]] as [string, number][]) : []),
  ]);
  const roleOf = (o: ObjectInstance): FinanceWorldLine["role"] =>
    o.id === costPlan?.id ? "COST" : o.id === revenuePlan?.id ? "REVENUE" : o.id === marginPlan?.id ? "MARGIN" : "PASSTHROUGH";

  for (const o of plans) {
    const role = roleOf(o);
    const rolling = money(num(o.props.rolling));
    const projected = money(projectedOf.get(o.id) ?? rolling);
    const delta = money(projected - rolling);
    lines.push({
      subject: str(o.props.line),
      role,
      budget: money(num(o.props.budget)),
      rolling,
      projected,
      delta,
      deltaPct: pct(delta, rolling),
      driver: role === "COST" ? "Order.costPressure" : role === "MARGIN" ? "Order.costPressure（经 收入Δ − 成本Δ 传导）" : "",
      formula:
        role === "COST"
          ? `${rolling} ×（1 + ${round(costAgg.value, 6)} ÷ ${divisor}）= ${projected}`
          : role === "MARGIN"
            ? `${gmRolling} +（Δ收入 ${money(revProjected - revRolling)}）−（Δ成本 ${money(cogsProjected - cogsRolling)}）= ${projected}`
            : role === "REVENUE"
              ? `${rolling}（本链不驱动收入 —— 世界态需求侧变量与 FinancePlan 收入行之间今天没有传导规则）`
              : `${rolling}（本行未被任何角色认领 ⇒ 原样透传，不擅自折算）`,
      provenance: {
        kind: "实测", // FinancePlan 是本体里录入的真值对象
        drillType: "FinancePlan",
        drillId: finId(o), // 单对象 → **真主键**（不是 "*"）
        drillField: "rolling",
        drillValue: num(o.props.rolling),
      },
    });
  }
  if (!revenuePlan) notes.push(`FinancePlan 里没有 line="${roles.revenueLine}" 的收入行 ⇒ 收入侧诚实缺席（可用 args.revenueLine 指定行名）。`);
  if (!costPlan) notes.push(`FinancePlan 里没有 line="${roles.costLine}" 的成本行 ⇒ 成本压力无处落地（可用 args.costLine 指定行名）。`);
  if (!marginPlan) notes.push(`FinancePlan 里没有 line="${roles.marginLine}" 的毛利行 ⇒ 毛利侧诚实缺席（可用 args.marginLine 指定行名）。`);
  const passthrough = lines.filter((l) => l.role === "PASSTHROUGH").map((l) => l.subject);
  if (passthrough.length > 0) {
    notes.push(`${passthrough.length} 个科目行未被角色认领（${passthrough.join("/")}）⇒ 原样透传并在此点名，**不静默漏行**。`);
  }
  notes.push(
    "收入行**故意不动**：世界态的需求侧变量（demandPressure/demandLoad）与 FinancePlan 收入行之间" +
      "今天**没有任何传导规则**（`seed.ts` 13 条里六方向全查过）。凭空折算一个收入弹性" +
      "就是引擎自己发明一个系数 —— 这是诚实缺席，不是「收入不受影响」。",
  );

  // ── ⑤ 现金侧（逐张发票用真 amount，不是拿一个总额乘系数）───────────────────────────
  let arBaseline = 0;
  let arProjected = 0;
  let overdueExposure = 0;
  let invoiceCarriers = 0;
  let customerLinked = 0;
  let topInvoice: { id: string; amount: number; invoiceId: string } | null = null;
  for (const inv of [...invoices].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const amount = invoiceAmount(inv);
    arBaseline += amount;
    const cid = custOfInvoice.get(inv.id);
    if (cid) customerLinked += 1;
    const custPressure = cid ? (stateOf(worldState, cid, "receivablePressure") ?? 0) : 0;
    arProjected += amount * (1 + custPressure / divisor);
    const od = stateOf(worldState, inv.id, "overduePressure");
    if (od !== undefined) invoiceCarriers += 1;
    overdueExposure += amount * ((od ?? 0) / divisor);
    // 下钻落点 = 金额最大的那张发票（平手取 id 小者 ⇒ R6 稳定）。**在循环里就把真主键 `invoiceId` 记下**，
    // 不留到下面再去 `invoices.find(...)` 回查 —— 回查那种写法既多一次 O(n) 扫描、又把"取哪张"的规则
    // 拆到两处，改一处忘一处就会静默指错发票。
    if (topInvoice === null || amount > topInvoice.amount || (amount === topInvoice.amount && inv.id < topInvoice.id)) {
      topInvoice = { id: inv.id, amount, invoiceId: str(inv.props.invoiceId) || inv.id };
    }
  }
  const cash: FinanceWorldCash = {
    available: invoices.length > 0,
    ...(invoices.length === 0
      ? { unavailableReason: "本租户 ARInvoice 台账 0 条 —— 应收/逾期口径无承载物。这是「查不到」，不是「应收为 0」。" }
      : {}),
    arBaseline: money(arBaseline),
    arProjected: money(arProjected),
    arDelta: money(arProjected - arBaseline),
    overdueExposure: money(overdueExposure),
    overdueSharePct: arBaseline === 0 ? 0 : round((overdueExposure / arBaseline) * 100, 4),
    invoiceUniverse: invoices.length,
    invoiceCarriers,
    customerLinked,
    formula:
      `应收投影 = Σ_发票 amount ×（1 + 该发票客户 receivablePressure ÷ ${divisor}）；` +
      `逾期敞口 = Σ_发票 amount × overduePressure ÷ ${divisor}。` +
      "客户经真链路 `customer_has_invoice` 反查（= 传导规则自己走的那条边，不另造映射）。",
    provenance: {
      kind: "实测",
      drillType: "ARInvoice",
      // 单对象 → **真主键**；无承载对象才落 `"*"`（契约 `GapProvenanceSchema.drillId` 的既有约定）。
      drillId: topInvoice?.invoiceId ?? "*",
      drillField: "amount",
      drillValue: topInvoice?.amount ?? 0,
    },
  };
  if (invoices.length > 0 && customerLinked === 0) {
    notes.push(
      "一张发票都没经 `customer_has_invoice` 找到客户 ⇒ 应收压力（落在 Customer 上）传不到金额侧，" +
        "应收投影恒等于基线。这是**链路缺失**，不是「客户没有回款压力」。",
    );
  }

  // ── ⑥ 传导链（真规则 id + 真系数 —— 改种子即改这里）────────────────────────────────
  const rules = await repos.sim.listPropagationRules(ctx.tenantId, true);
  const CHAIN_TARGETS = new Set(["costPressure", "receivablePressure", "overduePressure"]);
  const chain: FinanceWorldChainHop[] = [...rules]
    .filter((r: PropagationRule) => CHAIN_TARGETS.has(r.targetStateVar))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({
      ruleId: r.id,
      ruleKey: r.key,
      from: `${r.sourceTypeKey}.${r.sourceStateVar}`,
      to: `${r.targetTypeKey}.${r.targetStateVar}`,
      viaLinkKey: r.viaLinkKey,
      coefficient: r.coefficient,
      delayTicks: r.delayTicks,
      provenance: {
        kind: "派生",
        drillType: "PropagationRule",
        drillId: r.id, // 单对象 → 真主键
        drillField: "coefficient",
        drillValue: r.coefficient,
      },
    }));
  if (chain.length === 0) {
    notes.push(
      "本租户没有任何 PUBLISHED 传导规则的 target 落在 costPressure/receivablePressure/overduePressure 上 ⇒ " +
        "世界态里这三个压力**不可能被传导产生**（只能靠直接扰动写入）。这是「链没接」，不是「压力为 0」。",
    );
  }

  // ── ⑦ 勾稽：投影不许改掉「收入−成本−毛利」的既有残差 ───────────────────────────────
  const reconChecks: FinanceWorldRecon[] = [];
  if (revenuePlan && costPlan && marginPlan) {
    const baselineResidual = round(revRolling - cogsRolling - gmRolling, 6);
    const projectedResidual = round(revProjected - cogsProjected - gmProjected, 6);
    reconChecks.push({
      label: `${roles.revenueLine} − ${roles.costLine} − ${roles.marginLine}`,
      baselineResidual,
      projectedResidual,
      ok: Math.abs(projectedResidual - baselineResidual) <= RECON_EPS,
    });
  }
  const reconciled = reconChecks.length > 0 && reconChecks.every((c) => c.ok);

  // ── ⑧ 可用性判定（不可用**必须**给原因；前端据此退回诚实缺口记号，不许显示 0）──────────
  const missingPlans = !revenuePlan && !costPlan && !marginPlan;
  let available = true;
  let unavailableReason: string | undefined;
  if (plans.length === 0) {
    available = false;
    unavailableReason = "本租户 FinancePlan 台账 0 条 —— 没有金额基线，投影无从谈起（先合成/接入财务预算）。";
  } else if (missingPlans) {
    available = false;
    unavailableReason = `FinancePlan 有 ${plans.length} 行，但没有一行匹配收入/成本/毛利角色（当前找的是 ${roles.revenueLine}/${roles.costLine}/${roles.marginLine}）—— 用 args.{revenueLine,costLine,marginLine} 指定真实行名。`;
  } else if (worldObjectCount === 0) {
    available = false;
    unavailableReason = `世界 ${world.id} 的态为空（0 个对象有态）—— 金额投影会恒等于基线，摆上屏等于"看起来是财务、实际永远不动"。据实报缺，不给一个不动的数。`;
  }

  const summary = available
    ? `世界 ${world.id} @tick${world.curTick}：成本压力 ${round(costAgg.value, 3)}（${costAgg.carriers}/${costAgg.universe} 张单承载）` +
      ` ⇒ ${roles.costLine} ${cogsRolling} → ${cogsProjected}（${cogsProjected - cogsRolling >= 0 ? "+" : ""}${money(cogsProjected - cogsRolling)}）、` +
      `${roles.marginLine} ${gmRolling} → ${gmProjected}；逾期敞口 ${money(overdueExposure)}。**推演投影，非实测**。`
    : `世界 ${world.id} @tick${world.curTick}：金额口径不可用 —— ${unavailableReason}`;

  return {
    worldId: world.id,
    curTick: world.curTick,
    worldStateSource,
    worldObjectCount,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    notes,
    basis,
    pressures,
    lines,
    cash,
    chain,
    reconChecks,
    reconciled,
    summary,
  };
}
