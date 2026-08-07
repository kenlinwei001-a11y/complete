import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  RiskTimelineOutputSchema,
  deriveDisposition,
  deriveDispositionOptions,
  type DispositionLead,
  type DispositionOptionsInput,
  type RiskTimelineOutput,
} from "@platform/contracts";
import { getRenderer, resolveViewKey } from "@/views/registry";
import { orderCardsByExposure } from "@/views/DecisionInfoPanel";
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";
import { loginAs, renderApp, renderWithClient } from "./utils";
import { server } from "./setup";

/**
 * WO-DECISION-INFO 前端半 · 决策三块可达门 + 诚实渲染门。
 *
 * ## 由来（与 F3/F4/F2 三次同族，但换了一层）
 * 引擎半已并线（SEAM 9 例绿）：`risk_timeline` 输出里 `cards[].exposure` / `cards[].doNothing` /
 * `planRows[].options` / 顶层 `exposureOrder` / `steps[].leadTime` 全都真发得出来。
 * 但实测（本单 dev 在基线 704da3d7 上 `grep -rn "\.exposure\|exposureOrder\|doNothing" apps/frontend-shell/src`）
 * **零前端消费方** —— 命中的只有 `DecisionPlayView.tsx:187` 的 `DecisionOption.exposure` 与各处
 * `view.options`（ViewConfig 渲染器配置），两者都是同名不同物。
 * 形态 = 本仓记的假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的**上一层**：
 * 引擎侧测试咬的是**求解器函数**，不是**「字段 → 像素」这条链**；于是引擎永远绿、界面永远看不见。
 *
 * ## 本文件的两道门（两道咬的东西不同，缺一不可）
 *
 * **门 A · 可达（零 fixture 注入·跑真 mock 链）**
 *   从 `views/registry.ts` 的**字符串键**出发（用户点进来走的就是这条路：
 *   `pages/ViewPage.tsx` `getRenderer(renderer)` → `<Renderer view={…} />`），经 lazy 真加载渲染。
 *   ⚠ 刻意**不直接 import RiskBoardView / DecisionInfoPanel** —— 直接 import 咬的是组件、不是链路，
 *     那正是 F3/F4/F2 三次全绿却打不开页面的原因。
 *   门 A 的 `leadTime` 一例**完全不注入任何数据**：mock 的 `mockRiskTimeline` 本就调用与后端**同一份**
 *   `deriveDisposition`（@platform/contracts），而它给每一步都挂了 `leadTime`（未传前置期 ⇒ 诚实 EMPTY）。
 *   所以「前置期取不到」这条断言跑的是**真链路真数据**，一个字节的 fixture 都没喂。
 *
 * **门 B · 诚实渲染（server.use 在网络边界替换应答）**
 *   门 A 证明了链路通，但 mock 世界里没有 exposure/doNothing/options 这三块（mock 无订单敞口台账、
 *   无运费/罚则承载），所以要证明「**引擎发出来的字段真的会变成像素**」必须让服务端真的发这些字段。
 *   替换点选在**网络边界**（`server.use` 拦 `/a/v1/solvers/risk_timeline/invoke`），故被测链路仍是完整的
 *   字符串键 → lazy 加载 → 视图 → useQuery → HTTP → `RiskTimelineOutputSchema.parse` → 渲染；
 *   只有「服务端这次答什么」被替换 —— 而那正是本门要测的自变量。
 *   应答一律经 `RiskTimelineOutputSchema.parse` 校验（**造不出契约外的形状**），且 `options` 由
 *   **契约里那一份** `deriveDispositionOptions` 真派生（不手写方案数学·不造第二套算子）。
 *   引擎侧数值是否算得对由 datacore 的 SEAM 9 例负责，本门只咬「诚实渲染」：
 *   **EMPTY 不许渲染成 0 或空白 —— 那是把「不知道」说成「不用等 / 不用赔」。**
 *
 * ## 变异反证（本单 dev 亲手跑过，输出见交付报告）
 *   · 注释掉 `RiskBoardView.tsx` 里 `<ExposurePanel …>` / `<DoNothingPanel …>` 两行 → 门 B 相关例真红；
 *   · 把 `displayCards` 换回 `cards`（不吃 exposureOrder）→ 排序例真红；
 *   · 把 `LeadTimeTag` 的 EMPTY 分支改成渲染 `0` → 「前置期取不到」例真红。
 */

// ---------------------------------------------------------------------------
// 门 B 的应答构造（形状全部来自契约，数值只为驱动渲染分支，不代表任何真实基地）
// ---------------------------------------------------------------------------

const FS = "2026-06-12";
const UNITS = { qty: "套", revenue: "亿元" } as const;
const WINDOW = { fromDay: 0, toDay: 30, forecastStart: FS };

type Card = RiskTimelineOutput["cards"][number];
type Exposure = NonNullable<Card["exposure"]>;
type DoNothing = NonNullable<Card["doNothing"]>;

const series = (peak: number) => Array.from({ length: 30 }, (_, i) => Math.min(peak, 50 + i * 2));

/** 有敞口的影响面（① 这事有多大）。 */
function exposureOK(args: {
  baseId: string; baseName: string; rank: number; revenueYi: number; orderCount: number;
}): Exposure {
  const { baseId, baseName, rank, revenueYi, orderCount } = args;
  const orders = Array.from({ length: orderCount }, (_, i) => ({
    so: `SO-${baseId}-${i + 1}`,
    cust: i === 0 ? `${baseName}客户甲` : `${baseName}客户乙`,
    model: "4680-NCM",
    qty: 10000 + i * 1000,
    due: "2026-06-28",
    dueDay: 16 + i,
    pri: i === 0 ? "高" : "中",
    revenueYi: Number((revenueYi / orderCount).toFixed(2)),
    seg: "乘用车",
  }));
  const custNames = [...new Set(orders.map((o) => o.cust))];
  return {
    status: "OK",
    baseId,
    baseName,
    window: WINDOW,
    orderCount,
    totalQty: orders.reduce((a, o) => a + o.qty, 0),
    revenueYi,
    customerCount: custNames.length,
    customers: custNames.map((cust) => {
      const rs = orders.filter((o) => o.cust === cust);
      return {
        cust,
        seg: "乘用车",
        orderCount: rs.length,
        qty: rs.reduce((a, o) => a + o.qty, 0),
        revenueYi: Number(rs.reduce((a, o) => a + o.revenueYi, 0).toFixed(2)),
        earliestDue: rs[0]!.due,
        earliestDueDay: rs[0]!.dueDay,
      };
    }),
    orders,
    earliest: { so: orders[0]!.so, cust: orders[0]!.cust, due: orders[0]!.due, dueDay: orders[0]!.dueDay },
    rank,
    hasExposure: true,
    units: UNITS,
    provenance: [{ objectType: "Order", objectId: orders[0]!.so, field: "qty", value: orders[0]!.qty }],
  };
}

/** 零敞口的影响面（EMPTY 是一等结论：交代为什么 + 窗外最近一张在多远）。 */
function exposureEmpty(args: { baseId: string; baseName: string; rank: number; beyond: number }): Exposure {
  const { baseId, baseName, rank, beyond } = args;
  return {
    status: "EMPTY",
    baseId,
    baseName,
    window: WINDOW,
    orderCount: 0,
    totalQty: 0,
    revenueYi: 0,
    customerCount: 0,
    customers: [],
    orders: [],
    earliest: null,
    rank,
    hasExposure: false,
    emptyReason: `本窗（D+0–D+30）内该基地无到期订单 —— 不是查不到，是窗内确实没有`,
    nextOutsideWindow: {
      so: `SO-${baseId}-OUT`,
      cust: `${baseName}窗外客户`,
      qty: 21777,
      due: "2026-07-14",
      dueDay: 30 + beyond,
      daysBeyondWindow: beyond,
    },
    units: UNITS,
    provenance: [],
  };
}

/**
 * ③ 不作为后果。三块**各自独立标状态**：
 * catchUp OK（真派生）· delay OK 但逐单 `basis:"ESTIMATED"`（确定性估算·必须当面标出）·
 * penalty **恒 EMPTY**（本仓 C01–C33 无交付罚则承载 —— 渲染成 0 就是把「不知道」说成「不用赔」）。
 */
function doNothingOf(exp: Exposure): DoNothing {
  return {
    status: "PARTIAL",
    baseId: exp.baseId,
    baseName: exp.baseName,
    window: WINDOW,
    catchUp: {
      status: "OK",
      shortfall: 24000,
      freeDaily: 3200,
      days: 7.5,
      unit: "天",
      formula: "缺口(套) ÷ 空闲日产能(套/日) = 24000 ÷ 3200",
      provenance: [{ objectType: "Line", objectId: `line-${exp.baseId}-1`, field: "capacityDaily", value: 3200 }],
    },
    delay: {
      status: "OK",
      worstDays: 9,
      orders: exp.orders.map((o, i) => ({
        so: o.so,
        cust: o.cust,
        qty: o.qty,
        due: o.due,
        dueDay: o.dueDay,
        delayDays: 9 - i,
        basis: "ESTIMATED" as const,
        basisNote: "按缺口÷空闲日产能均摊到逐单（确定性估算）—— 仓内无逐单排产结果，故不是实测排程延误",
      })),
      note: "延误 = 缺口自然消化天数按交期先后摊到逐单",
    },
    penalty: {
      status: "EMPTY",
      reason: "C01–C33 逐条核过，没有一条承载「我方晚交客户单」的违约罚则；唯一带罚金的 LongTermAgreement.breachPenaltyWan 是供应商长协欠交罚金，挪用即死映射",
      missingFields: ["SalesContract.latePenaltyRate", "Order.penaltyRuleKey"],
      checked: ["C01", "C08", "C21", "LongTermAgreement.breachPenaltyWan"],
    },
    atRiskCustomers: exp.customers.map((c, i) => ({
      cust: c.cust,
      orderCount: c.orderCount,
      qty: c.qty,
      revenueYi: c.revenueYi,
      worstDelayDays: 9 - i,
      customerObject:
        i === 0
          ? ({ status: "OK", custId: `cust-${i}`, termDays: 60, creditLimit: 3000 } as const)
          : ({
              status: "EMPTY",
              reason: "该客户名在 Customer 对象库里查不到同名记录（订单里是自由文本客户名）",
              missingFields: ["Customer.name"],
              checked: ["Customer"],
            } as const),
    })),
    revenueAtRiskYi: exp.revenueYi,
    summary: `不处置：缺口自然消化 7.5 天 · 最坏延误 9 天 · 罚则算不出`,
    units: UNITS,
  };
}

/** 跨基地在途前置期（OK·带出处三元组）—— 用来驱动 `LeadTimeTag` 的 OK 分支。 */
const CROSS_LEAD: DispositionLead = {
  status: "OK",
  days: 3,
  source: { objectType: "InterBaseTransfer", objectId: "ibt-77", field: "transitDays", value: 3 },
};

const DISPOSITION_INPUT: DispositionOptionsInput = {
  baseId: "changzhou",
  forecastStart: FS,
  horizon: 30,
  trigDay: 5,
  shortfall: 24000,
  freeDaily: 3200,
  available: 96000,
  inProdTotal: 41000,
  futureQty: 120000,
  overtimeUpliftPct: 0.12,
  crossBaseAbsorbPct: 0.35,
  // 跨基地前置期给真值（OK 分支）；外协前置期**刻意不给** → EMPTY 分支 + readyInDays 拒绝按 0 天冒充。
  crossBaseLead: CROSS_LEAD,
  coefficients: [
    { key: "overtimeUpliftPct", value: 0.12, basis: "RULE_PARAMS", ruleKey: "C05", note: "规则参数" },
    { key: "crossBaseAbsorbPct", value: 0.35, basis: "DEFAULT_FALLBACK", ruleKey: "C05", note: "规则未配，代码兜底默认" },
  ],
};

/**
 * `options` 由**契约里那一份** `deriveDispositionOptions` 真派生，再镜像 datacore 侧
 * `solvers/decision-info.ts` 的装配把 `cost` / `sideEffects` 挂回（契约层刻意不编成本/副作用，
 * 因为它们要真对象：运费费率 / 被挤占的在手单 / C08 红线）。
 * 这里只挂 A 方案的成本与副作用，B/C 保持"尚未装配"的诚实初值 —— 正好覆盖 OK / PARTIAL / EMPTY 三态。
 */
function buildOptions() {
  const base = deriveDispositionOptions(DISPOSITION_INPUT);
  if (base.status === "EMPTY") throw new Error("[test] shortfall>0 却拿到 EMPTY —— 契约变了，先改测试再改断言");
  const options = base.options.map((o) => {
    if (o.optionId !== "A") return o;
    const levers = o.levers.map((lv) =>
      lv.leverKey === "cross_base"
        ? {
            ...lv,
            cost: {
              status: "OK" as const,
              amountYuan: 186000,
              unit: "元" as const,
              source: { objectType: "FreightRate", objectId: "fr-cz-jm", field: "yuanPerSet", value: 22, formula: "22 元/套 × 8455 套" },
            },
            sideEffects: [
              {
                kind: "DISPLACE_ORDERS" as const,
                leverKey: "cross_base",
                title: "挤占 2 张在手单",
                detail: "跨基地吸收的产能来自江门在手单的档期",
                displacedOrders: [
                  {
                    so: "SO-J-1", cust: "星河储能", baseId: "jiangmen", baseName: "江门",
                    qty: 8200, displacedQty: 5000, pri: "中", due: "2026-07-02", dueDay: 20,
                    delayDays: 4, provenance: { objectType: "Order", objectId: "SO-J-1", field: "qty", value: 8200 },
                  },
                  {
                    so: "SO-J-2", cust: "极光新能源", baseId: "jiangmen", baseName: "江门",
                    qty: 4100, displacedQty: 3455, pri: "低", due: "2026-07-06", dueDay: 24,
                    // 延后天数算不出 → null + 原因（**不是 0 天**）
                    delayDays: null, delayReason: "江门空闲日产能取不到（Line.capacityDaily 为空）",
                    provenance: { objectType: "Order", objectId: "SO-J-2", field: "qty", value: 4100 },
                  },
                ],
              },
            ],
          }
        : {
            ...lv,
            cost: {
              status: "EMPTY" as const,
              amountYuan: null,
              unit: "元" as const,
              reason: "本体无该杠杆的计价承载物",
              missingField: lv.leverKey === "overtime" ? "Line.overtimeRateYuanPerHour" : "Supplier.priceYuanPerSet",
            },
          },
    );
    const missing = levers
      .filter((lv) => lv.cost?.status !== "OK")
      .map((lv) => ({ leverKey: lv.leverKey, reason: lv.cost?.reason ?? "算不出", missingField: lv.cost?.missingField ?? "?" }));
    return {
      ...o,
      levers,
      // 有一条算得出、其余算不出 ⇒ PARTIAL（**不是**把算不出的当 0 加进去凑一个"合计"）
      cost: { status: "PARTIAL" as const, totalYuan: 186000, unit: "元" as const, missing },
      sideEffects: levers.flatMap((lv) => lv.sideEffects ?? []),
    };
  });
  return { ...base, options };
}

/**
 * 四张卡。**`cards[]` 数组序刻意与影响面序相反** —— 这正是该单症状取证里的真实形态：
 * 数组序前几张（越线日最早）窗内敞口各 0 张，真正压着单子的排在后面。
 * `exposureOrder` 则是引擎给的显式影响面序（零敞口一律沉底）。
 * 两个序**必须不同**，否则本门证不出前端到底吃了哪个（等于白测）。
 */
function buildPayload(): RiskTimelineOutput {
  const expJiangmen = exposureEmpty({ baseId: "jiangmen", baseName: "江门", rank: 3, beyond: 2 });
  const expHandan = exposureEmpty({ baseId: "handan", baseName: "邯郸", rank: 4, beyond: 9 });
  // 常州与自贡**营收相同**（6.2 亿）—— 引擎按 金额↓ → 单数↓ → 最早交期↑ → baseId↑ 的**复合序**
  // 判定常州在前（5 单 > 2 单）。前端若自己按单一指标（金额）排，这一对的次序就是不确定的 ⇒ 本例专咬这个。
  const expChangzhou = exposureOK({ baseId: "changzhou", baseName: "常州", rank: 1, revenueYi: 6.2, orderCount: 5 });
  const expZigong = exposureOK({ baseId: "zigong", baseName: "自贡", rank: 2, revenueYi: 6.2, orderCount: 2 });

  const mkCard = (exp: Exposure, factor: string, peak: number, crossDay: number): Card => ({
    base: exp.baseName,
    baseId: exp.baseId,
    factor,
    peak,
    crossDay,
    series: series(peak),
    events: [],
    exposure: exp,
    doNothing: doNothingOf(exp),
  });

  const d = deriveDisposition(DISPOSITION_INPUT);
  const opts = buildOptions();

  return RiskTimelineOutputSchema.parse({
    horizon: 30,
    threshold: 85,
    dataMode: "MOCK",
    // 数组序 = 既有排序契约（越线日↑）：零敞口的江门/邯郸在前，压着 5 张单的常州在后。
    cards: [
      mkCard(expJiangmen, "物料齐套", 96, 1),
      mkCard(expHandan, "设备OEE", 94, 2),
      mkCard(expZigong, "瓶颈工序", 92, 4),
      mkCard(expChangzhou, "化成柜张力", 90, 5),
    ],
    // 影响面序 = 引擎显式排序键（常州 → 自贡 → 江门 → 邯郸，零敞口沉底）。
    exposureOrder: ["changzhou", "zigong", "jiangmen", "handan"],
    planRows: [
      {
        act: "加班承接（本地空闲产能上浮）（常州）",
        det: d.summary,
        owner: "常州 王经理",
        start: "T+-2·06-10",
        done: "T+5·06-17",
        eff: `${d.steps.length} 步收窄 ${d.closedTotal}套 · 残留 ${d.residual}套`,
        rule: "C05",
        baseId: "changzhou",
        shortfall: DISPOSITION_INPUT.shortfall,
        residual: d.residual,
        steps: d.steps,
        options: opts,
      },
    ],
  });
}

/** 把 `risk_timeline` 的应答换成带决策三块的契约形状（**只换网络边界这一层**）。 */
function serveDecisionInfo(payload: RiskTimelineOutput = buildPayload()): void {
  server.use(
    http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
      HttpResponse.json({ data: payload, snapshotVersion: "ov-decision-info" }),
    ),
  );
}

const gridOrder = (): string[] =>
  Array.from(screen.getByTestId("risk-grid").children).map((el) =>
    (el.getAttribute("data-testid") ?? "").replace("risk-card-", ""),
  );

// ---------------------------------------------------------------------------
// 门 A · 可达（从注册表字符串键出发·零 fixture 注入）
// ---------------------------------------------------------------------------
describe("WO-DECISION-INFO 前端半 · 门A 可达（咬链路不咬组件）", () => {
  const mkView = (): ViewConfigVM =>
    ViewConfigVMSchema.parse({ viewKey: "risk-board", name: "产能推演", renderer: "risk-board" });

  it("registry 按字符串键取得到 risk-board（短键 risk 也解析得到），且 lazy 真渲染出看板", async () => {
    // 短键 → 规范键（场景启动器/URL 走的就是这条）
    expect(resolveViewKey("risk")).toBe("risk-board");
    const View = getRenderer("risk-board");
    expect(View, "registry 里没有 risk-board —— 决策三块再全也没有任何路由渲染得到").toBeDefined();
    const Lazy = View!;
    loginAs("planner");
    renderWithClient(
      <Suspense fallback={<div data-testid="loading" />}>
        <Lazy view={mkView()} />
      </Suspense>,
    );
    expect(await screen.findByTestId("risk-grid")).toBeInTheDocument();
  });

  it("③.2 前置期 EMPTY 真渲染成「前置期取不到」而**不是 0 天**（跑真 mock 链·零 fixture 注入）", async () => {
    // 此例**不调 serveDecisionInfo** —— mock 的 mockRiskTimeline 调的就是与后端同一份
    // deriveDisposition，它给每步都挂了 leadTime（未传前置期 ⇒ 诚实 EMPTY）。
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    const rows = within(table).getAllByRole("button");
    const target = rows.find((r) => (r.textContent ?? "").includes("触发缺口")) ?? rows[0]!;
    await user.click(target);
    await screen.findByTestId("disposition-detail-panel");

    const lead = await screen.findByTestId("disposition-step-lead-0");
    expect(lead, "steps[].leadTime 有值却没有任何前端消费方 = 数据发得出、用户看不见").toBeInTheDocument();
    expect(lead).toHaveAttribute("data-lead-status", "EMPTY");
    expect(lead.textContent ?? "").toContain("前置期取不到");
    // EMPTY 绝不能渲染成 0 天：0 天是一个断言（"当天就能到"），本体里没有对象支持它。
    expect(lead.textContent ?? "").not.toMatch(/前置期\s*0\s*天/);
    expect(lead).not.toHaveAttribute("data-lead-days");
  });

  /**
   * `steps[].leadTime` 的**第二个消费面**。
   *
   * 病（本单第二段·实测于 704da3d7 起的整条分支）：`base_capacity_outlook.dayPlan` 与
   * `risk_timeline.planRows[].steps` 是同一份 `deriveDisposition` 的两个出口（datacore
   * `solvers/base-outlook.ts:5` import 的正是 `decision-info.ts` 的 `crossBaseLeadOf/outsourceLeadOf`），
   * 但前端只接了处置表那一处 ⇒ 基地前瞻那块屏上，同一个字段照样看不见。
   * 更糟的是前端 mock `simSolvers.ts mockBaseOutlook` **手抄了第二套贪心**，里面原样留着引擎侧已经删掉的
   * `trigDay+7` / `trigDay+14` 两个魔数 —— 引擎把编的前置期删了，前端 mock 让它继续活着。
   *
   * 本例咬的就是这条：从注册表字符串键真渲染 → 点开基地卡 → 前瞻面板逐日处置 → 前置期如实报「取不到」，
   * 且**日期不带任何假设偏移**（跨基地/外协步不再落在 trigDay+7 / +14）。
   */
  it("③.2 第二消费面：基地前瞻 dayPlan 也报「前置期取不到」，且魔数 +7/+14 不再复活", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    // 走用户真路径：看板栅格 → 点开一张基地卡 → 详情面板里挂着 BaseOutlookPanel。
    const grid = await screen.findByTestId("risk-grid");
    const firstCard = Array.from(grid.children).find((el) => (el.getAttribute("data-testid") ?? "").startsWith("risk-card-"));
    expect(firstCard, "看板一张卡都没有 ⇒ 后面全部无从谈起").toBeTruthy();
    fireEvent.click(firstCard as HTMLElement);

    // 逐日处置过程（缺口窗才有）——前瞻面板是 lazy 拉真 mock 求解器，故用 findBy。
    await screen.findByTestId("outlook-dayplan");
    const lead0 = await screen.findByTestId("outlook-day-lead-0");
    expect(lead0, "base_capacity_outlook.dayPlan[].leadTime 仍无消费方 ⇒ 同一个字段在另一块屏上还是看不见").toBeInTheDocument();
    expect(lead0).toHaveAttribute("data-lead-status", "EMPTY");
    expect(lead0.textContent ?? "").toContain("前置期取不到");
    expect(lead0).not.toHaveAttribute("data-lead-days");

    // ⛔ 魔数反证：mock 若还在手抄那套，跨基地步会落在 trigDay+7、外协步落在 trigDay+14。
    //   现在三步一律不叠加偏移（前置期 EMPTY ⇒ 偏移 0，语义由随行的 EMPTY 声明，不是"0 天到货"这个断言），
    //   所以逐步的 D+N **必须全部相等**；一旦有人把 +7/+14 抄回来，这条当场红。
    const days = screen
      .getAllByTestId(/^outlook-day-\d+$/)
      .map((el) => Number(/D\+(\d+)/.exec(el.textContent ?? "")?.[1] ?? NaN));
    expect(days.length, "逐日处置至少要有一步").toBeGreaterThan(0);
    expect(days.some((d) => Number.isNaN(d))).toBe(false);
    expect(new Set(days).size, `dayPlan 各步日期出现偏移 ${JSON.stringify(days)} ⇒ 魔数前置期复活了`).toBe(1);
    // 每一步都必须带前置期读数（不是只有第 0 步接了线）。
    for (let i = 0; i < days.length; i++) {
      expect(screen.getByTestId(`outlook-day-lead-${i}`)).toHaveAttribute("data-lead-status", "EMPTY");
    }
  });
});

// ---------------------------------------------------------------------------
// 门 B · 诚实渲染（引擎真发这些字段时，用户到底看见什么）
// ---------------------------------------------------------------------------
describe("WO-DECISION-INFO 前端半 · 门B ① 影响面 + exposureOrder", () => {
  it("看板按 exposureOrder 渲染（零敞口沉底），**不是**按 cards[] 数组序", async () => {
    serveDecisionInfo();
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-常州");
    await waitFor(() => expect(gridOrder().length).toBe(4));

    // 数组序（既有排序契约·引擎刻意不动）与影响面序**确实不同** —— 不同才证得出前端吃的是哪个。
    const arrayOrder = ["江门", "邯郸", "自贡", "常州"];
    const exposureOrderNames = ["常州", "自贡", "江门", "邯郸"];
    expect(arrayOrder).not.toEqual(exposureOrderNames);
    expect(gridOrder(), "看板仍按 cards[] 数组序渲染 ⇒ exposureOrder 没有消费方（零敞口卡还在榜首）").toEqual(
      exposureOrderNames,
    );
    expect(screen.getByTestId("risk-grid")).toHaveAttribute("data-order", "exposure");
  });

  it("「首要风险」徽章仍挂在**原数组序**首张（最紧急 ≠ 影响面最大·重排不许把徽章语义弄丢）", async () => {
    serveDecisionInfo();
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-江门");
    // 数组序首张 = 江门（越线日最早），即便它被影响面序排到了第 3 位。
    expect(screen.getByTestId("risk-primary-江门")).toBeInTheDocument();
    expect(screen.queryByTestId("risk-primary-常州")).toBeNull();
  });

  it("卡面不点开就看得见影响面：有敞口报单数/数量/金额/客户数，零敞口报「本窗零敞口 + 窗外还有多少」", async () => {
    serveDecisionInfo();
    loginAs("planner");
    renderApp("/v/risk");
    const cz = await screen.findByTestId("risk-exposure-line-常州");
    expect(cz).toHaveAttribute("data-status", "OK");
    expect(cz).toHaveAttribute("data-rank", "1");
    expect(cz.textContent ?? "").toContain("5 单");
    expect(cz.textContent ?? "").toContain("6.20亿元");

    const jm = screen.getByTestId("risk-exposure-line-江门");
    expect(jm).toHaveAttribute("data-status", "EMPTY");
    // 零敞口**不留白**：窗外还有 2.18 万套这条真信息必须交出去。
    expect(jm.textContent ?? "").toContain("本窗零敞口");
    expect(jm.textContent ?? "").toContain("21777套");
  });

  it("点开卡 → ① 影响面面板：逐客户 + 逐订单 + 最早受影响交期，单位取自 units（前端不内联）", async () => {
    serveDecisionInfo();
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-常州"));
    const panel = await screen.findByTestId("risk-exposure-常州");
    expect(panel).toHaveAttribute("data-status", "OK");
    expect(within(panel).getByTestId("risk-exposure-常州-ordercount").textContent).toBe("5");
    expect(within(panel).getByTestId("risk-exposure-常州-revenue").textContent).toBe("6.20");
    expect(within(panel).getByTestId("risk-exposure-常州-earliest").textContent ?? "").toContain("SO-changzhou-1");
    // 逐客户与逐订单两张表都真渲染（"落在谁身上"的主语必须点得到名）
    expect(within(panel).getByTestId("risk-exposure-常州-customers")).toBeInTheDocument();
    expect(within(panel).getByTestId("risk-exposure-常州-order-SO-changzhou-1")).toBeInTheDocument();
    // 单位来自契约 units，不是前端内联的 "套/亿元"
    expect(panel.textContent ?? "").toContain("数量(套)");
    expect(panel.textContent ?? "").toContain("金额(亿元)");
  });

  it("零敞口卡点开 → 说清 emptyReason 且交出 nextOutsideWindow（EMPTY 是一等结论·不是留空让人猜）", async () => {
    serveDecisionInfo();
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-江门"));
    const panel = await screen.findByTestId("risk-exposure-江门");
    expect(panel).toHaveAttribute("data-status", "EMPTY");
    expect(within(panel).getByTestId("risk-exposure-江门-emptyreason").textContent ?? "").toContain("窗内确实没有");
    const next = within(panel).getByTestId("risk-exposure-江门-nextoutside");
    expect(next.textContent ?? "").toContain("SO-jiangmen-OUT");
    expect(next.textContent ?? "").toContain("超出本窗 2 天");
  });
});

describe("WO-DECISION-INFO 前端半 · 门B ③ 不作为后果（EMPTY 不许渲染成 0）", () => {
  async function openDoNothing(): Promise<HTMLElement> {
    serveDecisionInfo();
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-常州"));
    return screen.findByTestId("risk-donothing-常州");
  }

  it("catchUp OK → 真派生天数 + 公式；penalty **恒 EMPTY** → 「算不出」+ 缺哪个字段 + 查过哪些承载物", async () => {
    const panel = await openDoNothing();
    expect(within(panel).getByTestId("risk-donothing-常州-catchup")).toHaveAttribute("data-status", "OK");
    expect(within(panel).getByTestId("risk-donothing-常州-catchup").textContent ?? "").toContain("7.5");

    const pen = within(panel).getByTestId("risk-donothing-常州-penalty");
    expect(pen, "penalty 恒 EMPTY 却没渲染 ⇒ 用户以为'不用赔'").toHaveAttribute("data-status", "EMPTY");
    expect(pen.textContent ?? "").toContain("算不出");
    // 补哪个字段能点亮（机器可读·供数据侧排期）
    expect(within(panel).getByTestId("risk-donothing-常州-penalty-missing").textContent ?? "").toContain(
      "SalesContract.latePenaltyRate",
    );
    // 已逐条核过哪些承载物（证明是"查过确实没有"，不是"没查"）
    expect(within(panel).getByTestId("risk-donothing-常州-penalty-checked").textContent ?? "").toContain("C21");
    // ⛔ 最关键的一条：罚则块里不许出现任何金额数字（渲染成 0 元 = 把「不知道」说成「不用赔」）
    expect(pen.textContent ?? "").not.toMatch(/\d\s*元/);
  });

  it("delay 逐单 basis==='ESTIMATED' 当面标「确定性估算」并亮出 basisNote（不标 = 把估算当实测卖）", async () => {
    const panel = await openDoNothing();
    const row = within(panel).getByTestId("risk-donothing-常州-delay-SO-changzhou-1");
    expect(row).toHaveAttribute("data-basis", "ESTIMATED");
    expect(within(panel).getByTestId("risk-donothing-常州-basis-SO-changzhou-1").textContent).toBe("确定性估算");
    expect(within(panel).getByTestId("risk-donothing-常州-basisnote-SO-changzhou-1").textContent ?? "").toContain(
      "不是实测排程延误",
    );
  });

  it("受影响客户名单：连得上 Customer 的报账期/额度，连不上的**诚实说连不上**（不留白）", async () => {
    const panel = await openDoNothing();
    const ok = within(panel).getByTestId("risk-donothing-常州-custobj-常州客户甲");
    expect(ok).toHaveAttribute("data-status", "OK");
    expect(ok.textContent ?? "").toContain("账期 60 天");
    const empty = within(panel).getByTestId("risk-donothing-常州-custobj-常州客户乙");
    expect(empty).toHaveAttribute("data-status", "EMPTY");
    expect(empty.textContent ?? "").toContain("连不上");
    expect(empty.textContent ?? "").toContain("Customer.name");
  });
});

describe("WO-DECISION-INFO 前端半 · 门B ④ 方案对比与代价", () => {
  async function openOptions(): Promise<HTMLElement> {
    serveDecisionInfo();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    await user.click(within(table).getAllByRole("button")[0]!);
    await screen.findByTestId("disposition-detail-panel");
    return screen.findByTestId("decision-options");
  }

  it("A/B/C 三个方案并排渲染（有对比才有拍板依据·不是只给一条「系统认为该这么办」）", async () => {
    const panel = await openOptions();
    expect(panel).toHaveAttribute("data-status", "OK");
    for (const id of ["A", "B", "C"]) {
      const card = within(panel).getByTestId(`decision-options-opt-${id}`);
      expect(card).toHaveAttribute("data-option", id);
      expect(within(card).getByTestId(`decision-options-opt-${id}-strategy`).textContent ?? "").not.toHaveLength(0);
    }
  });

  it("readyInDays===null → 显示「算不出 + 原因」，**绝不显示 0 天到位**（外协前置期取不到）", async () => {
    const panel = await openOptions();
    const ready = within(panel).getByTestId("decision-options-opt-A-ready");
    expect(ready).toHaveAttribute("data-status", "EMPTY");
    expect(ready.textContent ?? "").toContain("算不出");
    expect(ready.textContent ?? "").toContain("前置期取不到");
    // ⚠ 这里**不能**用「文本里不许出现 0 天」这种正则：引擎自己的 readyInDaysReason 原文就写着
    //   「拒绝按 0 天冒充」—— 那正是诚实本身，拿它当失败判据会把对的东西判红（本单 dev 第一版就踩了，
    //   实测报错 `expected '…拒绝按 0 天冒充' not to match /\b0\s*天/`）。
    //   改咬**结构**：数值读数只在 OK 分支渲染成 `<b class="mono">`，EMPTY 分支必须一个数值读数都没有。
    expect(ready.querySelector("b.mono"), "readyInDays 为 null 却渲染出了数值读数 = 拿 0 冒充「马上到位」").toBeNull();
  });

  it("逐杠杆前置期：跨基地 OK 溯到 InterBaseTransfer.transitDays；外协 EMPTY 报「取不到」不报 0", async () => {
    const panel = await openOptions();
    const cross = within(panel).getByTestId("decision-options-opt-A-lever-cross_base-lead");
    expect(cross).toHaveAttribute("data-lead-status", "OK");
    expect(cross).toHaveAttribute("data-lead-days", "3");
    const out = within(panel).getByTestId("decision-options-opt-A-lever-outsource-lead");
    expect(out).toHaveAttribute("data-lead-status", "EMPTY");
    expect(out.textContent ?? "").toContain("Supplier.leadTime");
  });

  it("成本 PARTIAL → 亮出「不完整」并逐条列出算不出的杠杆与缺失字段（不拿 0 凑合计）", async () => {
    const panel = await openOptions();
    const cost = within(panel).getByTestId("decision-options-opt-A-cost");
    expect(cost).toHaveAttribute("data-status", "PARTIAL");
    const missing = within(panel).getByTestId("decision-options-opt-A-cost-missing");
    expect(missing.textContent ?? "").toContain("Line.overtimeRateYuanPerHour");
    expect(missing.textContent ?? "").toContain("Supplier.priceYuanPerSet");
    // B 方案未装配成本 → EMPTY（诚实"尚未装配"，不是 ¥0）
    expect(within(panel).getByTestId("decision-options-opt-B-cost")).toHaveAttribute("data-status", "EMPTY");
  });

  it("副作用点名到单：被挤占的在手单逐张列出；延后天数算不出的报原因而**不报 0**", async () => {
    const panel = await openOptions();
    const se = within(panel).getByTestId("decision-options-opt-A-se-0");
    expect(se).toHaveAttribute("data-kind", "DISPLACE_ORDERS");
    const displaced = within(panel).getByTestId("decision-options-opt-A-se-0-displaced");
    expect(within(displaced).getByText("SO-J-1")).toBeInTheDocument();
    expect(within(displaced).getByText("SO-J-2")).toBeInTheDocument();
    const d2 = within(panel).getByTestId("decision-options-opt-A-se-0-displaced-SO-J-2-delay");
    expect(d2).toHaveAttribute("data-status", "EMPTY");
    expect(d2.textContent ?? "").toContain("算不出");
    expect(d2.textContent ?? "").toContain("Line.capacityDaily 为空");
  });

  it("系数出处披露：DEFAULT_FALLBACK 必须与 RULE_PARAMS 区分开（不披露 = 让人把兜底默认当治理过的数）", async () => {
    const panel = await openOptions();
    expect(within(panel).getByTestId("decision-options-coeff-overtimeUpliftPct")).toHaveAttribute("data-basis", "RULE_PARAMS");
    const fallback = within(panel).getByTestId("decision-options-coeff-crossBaseAbsorbPct");
    expect(fallback).toHaveAttribute("data-basis", "DEFAULT_FALLBACK");
    expect(fallback.textContent ?? "").toContain("代码兜底默认");
  });
});

// ---------------------------------------------------------------------------
// 排序键的纯函数判据（DOM 例已咬链路，这一条咬"它是查表不是第二套排序算法"）
// ---------------------------------------------------------------------------
describe("WO-DECISION-INFO 前端半 · orderCardsByExposure 是查表不是重排", () => {
  const cards = [
    { baseId: "jiangmen", revenueYi: 0 },
    { baseId: "handan", revenueYi: 0 },
    { baseId: "zigong", revenueYi: 6.2 },
    { baseId: "changzhou", revenueYi: 6.2 },
  ];

  it("照引擎给的序渲 —— 金额打平时（自贡 6.2 = 常州 6.2）次序由引擎复合序定，前端不自己比指标", () => {
    const out = orderCardsByExposure(cards, ["changzhou", "zigong", "jiangmen", "handan"]);
    expect(out.map((c) => c.baseId)).toEqual(["changzhou", "zigong", "jiangmen", "handan"]);
    // 反向序同样照渲 —— 证明前端**没有**自己按 revenue 排（否则两次结果会一样）
    const rev = orderCardsByExposure(cards, ["zigong", "changzhou", "handan", "jiangmen"]);
    expect(rev.map((c) => c.baseId)).toEqual(["zigong", "changzhou", "handan", "jiangmen"]);
  });

  it("exposureOrder 缺席（旧后端）→ 原样返回；序里没有的卡沉底且保持原相对序（sort 稳定·R6）", () => {
    expect(orderCardsByExposure(cards, undefined).map((c) => c.baseId)).toEqual(cards.map((c) => c.baseId));
    expect(orderCardsByExposure(cards, []).map((c) => c.baseId)).toEqual(cards.map((c) => c.baseId));
    // 只给两张的序 → 其余两张沉底，且彼此仍按原数组相对序（jiangmen 在 handan 前）
    expect(orderCardsByExposure(cards, ["changzhou", "zigong"]).map((c) => c.baseId)).toEqual([
      "changzhou", "zigong", "jiangmen", "handan",
    ]);
  });
});
