import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoNothing, Exposure, RiskTimelineOutput } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { orderCardsByExposure } from "@/views/RiskBoardView";

/**
 * WO-DECISION-INFO-FE · 决策信息三块的**前端消费方**红咬。
 *
 * 病（审核方实测）：`doNothing` / `exposureOrder` 在 datacore + contracts 都有，**frontend 消费 0**；
 * RiskBoardView 只渲 series/planRows/cards —— 用户原话「风险曲线答得出几号越线，答不出该不该管、管了代价多大」。
 *
 * 本文件咬的是**链路**（真求解器口径的响应 → 屏幕上出现那几个数），不是组件内部形状：
 *   ① 影响面（OK / 零敞口一等结论 / 字段缺席 三分支各不相同，混一个就是撒谎）
 *   ② 不作为后果（catchUp 真派生 · delay 必标「估算」· penalty 必标「未承载」且**绝不出现金额 0**）
 *   ③ 多方案代价（A/B/C · 成本 OK/PARTIAL/EMPTY 三态 · 副作用点名到单 · C08 走 RuleRef）
 *   ④ 排序（按 exposureOrder·零敞口沉底；缺该字段则诚实回落，不自造一套）
 *   ⑤ 前置期 R13（OK 溯到真记录 · EMPTY 明说取不到且**不显示 0 天**）
 */

// ---------------------------------------------------------------------------
// 桩工厂：造**契约合法**的响应（RiskBoardView 必经 RiskTimelineOutputSchema.parse，形状错即当场炸）
// ---------------------------------------------------------------------------
const WINDOW = { fromDay: 0, toDay: 30, forecastStart: "2026-06-10" };

function mkExposure(baseId: string, baseName: string, rank: number, has: boolean): Exposure {
  const common = {
    baseId,
    baseName,
    window: WINDOW,
    rank,
    units: { qty: "套" as const, revenue: "亿元" as const },
  };
  if (!has) {
    return {
      ...common,
      status: "EMPTY",
      orderCount: 0,
      totalQty: 0,
      revenueYi: 0,
      customerCount: 0,
      customers: [],
      orders: [],
      earliest: null,
      hasExposure: false,
      emptyReason: `本窗无订单交期落入：${baseName}共 2 张可产单，全部在窗外`,
      nextOutsideWindow: { so: "SO-3458", cust: "南方电网", qty: 21777, due: "2026-07-12", dueDay: 32, daysBeyondWindow: 2 },
      provenance: [],
    };
  }
  return {
    ...common,
    status: "OK",
    orderCount: 1,
    totalQty: 1500,
    revenueYi: 0.33,
    customerCount: 1,
    customers: [{ cust: "蔚途汽车", seg: "乘用车", orderCount: 1, qty: 1500, revenueYi: 0.33, earliestDue: "2026-06-20", earliestDueDay: 8 }],
    orders: [{ so: `SO-${baseId}`, cust: "蔚途汽车", model: "4680-NCM", qty: 1500, due: "2026-06-20", dueDay: 8, pri: "高", revenueYi: 0.33, seg: "乘用车" }],
    earliest: { so: `SO-${baseId}`, cust: "蔚途汽车", due: "2026-06-20", dueDay: 8 },
    hasExposure: true,
    provenance: [{ objectType: "Order", objectId: `SO-${baseId}`, field: "qty", value: 1500 }],
  };
}

const PENALTY_EMPTY = {
  status: "EMPTY" as const,
  reason: "违约金/罚则当前本体无承载：规则库逐条核过，没有一条带交付延误罚金/费率。",
  missingFields: ["Order.latePenaltyRatePerDay"],
  checked: ["RuleEntry.C08", "LongTermAgreement.breachPenaltyWan（供应商长协欠交·非交付延误）"],
};

function mkDoNothing(baseId: string, baseName: string, exposure: Exposure): DoNothing {
  return {
    status: "PARTIAL",
    baseId,
    baseName,
    window: WINDOW,
    catchUp: {
      status: "OK",
      shortfall: 700,
      freeDaily: 100,
      days: 7,
      unit: "天",
      formula: "缺口(套) ÷ 空闲日产能(套/日)",
      provenance: [{ objectType: "Line", objectId: baseId, field: "capacityDaily", value: 100 }],
    },
    delay: {
      status: "OK",
      worstDays: 5,
      orders: [{ so: `SO-${baseId}`, cust: "蔚途汽车", qty: 1500, due: "2026-06-20", dueDay: 8, delayDays: 5, basis: "ESTIMATED", basisNote: "确定性估算（R6 可重跑），非实测交付延误" }],
      note: "确定性估算（R6 可重跑），非实测交付延误",
    },
    penalty: PENALTY_EMPTY,
    atRiskCustomers: [
      {
        cust: "蔚途汽车",
        orderCount: 1,
        qty: 1500,
        revenueYi: 0.33,
        worstDelayDays: 5,
        customerObject: {
          status: "EMPTY",
          reason: "order_of_customer 边按订单序轮转绑定，与 Order.cust 名称无对应关系",
          missingFields: ["Customer.custName ↔ Order.cust 的真实对应"],
          checked: ["link:order_of_customer"],
        },
      },
    ],
    revenueAtRiskYi: exposure.revenueYi,
    summary: "不处置：1 张单 / 1 个客户 / 0.33 亿元敞口受影响；违约金算不出",
    units: { qty: "套", revenue: "亿元" },
  };
}

function mkCard(base: string, baseId: string, opts: { exposure?: Exposure; doNothing?: DoNothing } = {}) {
  return {
    base,
    baseId,
    factor: "物料齐套",
    peak: 96,
    crossDay: 5,
    series: [80, 84, 88, 92, 96, 96, 96, 96],
    events: [],
    affectedOrders: [],
    ...opts,
  };
}

/** 桩：三张卡，数组序 = 甲乙丙，但影响面序 = 乙丙甲（甲零敞口·必须沉底）。 */
function orderingPayload(withExposureOrder: boolean): RiskTimelineOutput {
  const jia = mkExposure("jia", "甲基地", 3, false);
  const yi = mkExposure("yi", "乙基地", 1, true);
  const bing = mkExposure("bing", "丙基地", 2, true);
  return {
    horizon: 30,
    threshold: 85,
    cards: [
      mkCard("甲基地", "jia", { exposure: jia, doNothing: mkDoNothing("jia", "甲基地", jia) }),
      mkCard("乙基地", "yi", { exposure: yi, doNothing: mkDoNothing("yi", "乙基地", yi) }),
      mkCard("丙基地", "bing", { exposure: bing, doNothing: mkDoNothing("bing", "丙基地", bing) }),
    ],
    planRows: [],
    ...(withExposureOrder ? { exposureOrder: ["yi", "bing", "jia"] } : {}),
  };
}

const useRiskStub = (payload: unknown): void => {
  server.use(http.post("*/a/v1/solvers/risk_timeline/invoke", () => HttpResponse.json({ data: payload, snapshotVersion: "ov-di" })));
};

const cardOrderInDom = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="risk-card-"]')].map((el) => el.getAttribute("data-testid") ?? "");

// ---------------------------------------------------------------------------

describe("WO-DECISION-INFO-FE · ① 影响面（该不该管）", () => {
  it("有敞口：卡面出「影响面 #rank · N 张单 · X 亿元」，展开后逐单逐客户表都在（后端算了，屏幕必须有）", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    // 默认 mock（handlers.mockRiskTimeline）：常州 2 张单（1500+2200 套）→ 有敞口。
    const line = await screen.findByTestId("risk-exposure-line-常州");
    expect(line.getAttribute("data-exposure"), "常州有受影响订单，卡面必须是 OK 影响面").toBe("OK");
    expect(line).toHaveTextContent("2 张单");
    expect(line).toHaveTextContent("亿元");

    fireEvent.click(await screen.findByTestId("risk-card-常州"));
    const panel = await screen.findByTestId("decision-info-常州");
    const custTable = within(panel).getByTestId("exposure-cust-table-常州");
    // 客户名单 = "落在谁身上"的主语（真订单去重·非编造）。
    expect(custTable).toHaveTextContent("蔚途汽车");
    expect(custTable).toHaveTextContent("极光新能源");
    const orderTable = within(panel).getByTestId("exposure-order-table-常州");
    expect(orderTable).toHaveTextContent("SO-10001");
    expect(orderTable).toHaveTextContent("SO-10004");
    // 数量/金额 KPI 必须有真数（1500+2200=3700 套）。
    expect(within(panel).getByTestId("exposure-qty-常州")).toHaveTextContent("3700");
    expect(within(panel).getByTestId("exposure-ordercount-常州")).toHaveTextContent("2");
  });

  it("零敞口是**一等结论**：说清为什么没有 + 窗外最近一张在多远（不是留空让用户猜）", async () => {
    useRiskStub(orderingPayload(true));
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-甲基地"));

    const empty = await screen.findByTestId("exposure-empty-甲基地");
    expect(empty).toHaveTextContent("本窗无订单敞口");
    expect(within(empty).getByTestId("exposure-empty-reason-甲基地")).toHaveTextContent("全部在窗外");
    // 窗外那张单必须交出去（江门那条真信息就是这么丢的）。
    const nx = within(empty).getByTestId("exposure-next-outside-甲基地");
    expect(nx).toHaveTextContent("SO-3458");
    expect(nx).toHaveTextContent("21777");
    expect(nx).toHaveTextContent("超出本窗 2 天");
  });

  it("字段缺席 ≠ 没有影响：后端没下发 exposure/doNothing 时不崩、不渲空壳，明说「本次未返回」", async () => {
    useRiskStub({ horizon: 30, threshold: 85, cards: [mkCard("孤岛基地", "gudao")], planRows: [] });
    loginAs("planner");
    renderApp("/v/risk");

    const line = await screen.findByTestId("risk-exposure-line-孤岛基地");
    expect(line.getAttribute("data-exposure")).toBe("ABSENT");
    fireEvent.click(await screen.findByTestId("risk-card-孤岛基地"));
    const absent = await screen.findByTestId("exposure-absent-孤岛基地");
    expect(absent).toHaveTextContent("本次响应未返回");
    expect(absent).toHaveTextContent("cards[].exposure");
    expect(await screen.findByTestId("donothing-absent-孤岛基地")).toHaveTextContent("cards[].doNothing");
  });
});

describe("WO-DECISION-INFO-FE · ② 不作为后果（不管会怎样）", () => {
  it("catchUp 真派生 + delay 必标「估算」 + 客户档案连不上时诚实标 EMPTY", async () => {
    useRiskStub(orderingPayload(true));
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-乙基地"));

    const block = await screen.findByTestId("donothing-catchup-乙基地");
    expect(block).toHaveTextContent("缺口自然消化");
    expect(block).toHaveTextContent("7 天");
    // delay 是确定性估算（hash 抖动派生），裸渲染当"实测晚交几天" = KILL-MOCK-RED 红线。
    expect(await screen.findByTestId("donothing-delay-basis-乙基地")).toHaveTextContent("估算 · 非实测");
    expect(screen.getByTestId("donothing-delay-row-SO-yi")).toHaveTextContent("估算");
    // 账期/额度连不上 Customer 对象 → 明说连不上，不给张冠李戴的数。
    expect(screen.getByTestId("donothing-custobj-empty-蔚途汽车")).toHaveTextContent("连不到 Customer 对象");
  });

  it("penalty 恒 EMPTY 的诚实位：必须显式「未承载」，且该块**一个金额都不许出现**（0 也不行）", async () => {
    useRiskStub(orderingPayload(true));
    loginAs("planner");
    renderApp("/v/risk");
    fireEvent.click(await screen.findByTestId("risk-card-乙基地"));

    const pen = await screen.findByTestId("donothing-penalty-乙基地");
    expect(pen).toHaveTextContent("本平台未承载违约金口径");
    expect(within(pen).getByTestId("donothing-penalty-empty-乙基地-reason")).toHaveTextContent("无承载");
    // 补齐路径必须机器可读（供数据侧直接排期）。
    expect(within(pen).getByTestId("donothing-penalty-empty-乙基地-missing")).toHaveTextContent("Order.latePenaltyRatePerDay");
    // ★ 红线：违约金块里绝不能出现「0 元 / 0元 / ¥0」这类把"算不出"渲成"不赔钱"的写法。
    expect(pen.textContent ?? "", "违约金未承载却渲出了金额 = 把算不出伪装成 0").not.toMatch(/(?:^|[^0-9])0\s*元/);
    expect(within(pen).getByTestId("donothing-penalty-nozero-乙基地")).toHaveTextContent("刻意不显示金额");
    // OK 分支（本仓当前不可达）不得被误渲。
    expect(screen.queryByTestId("donothing-penalty-ok-乙基地")).toBeNull();
  });
});

describe("WO-DECISION-INFO-FE · ③ 方案与代价（管了代价多大）", () => {
  async function openMainPlanRow(): Promise<void> {
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    const rows = within(table).getAllByRole("button");
    // 主行 = det 带真派生摘要（「触发缺口」）；备份行写的是「峰值≥90 双保险」。
    const main = rows.find((r) => (r.textContent ?? "").includes("触发缺口"))!;
    expect(main, "mock 应至少有一条带真缺口的主行").toBeTruthy();
    await userEvent.click(main);
  }

  it("A/B/C 三方案并排可比：收窄/残留/几天到位/成本/副作用逐列在屏", async () => {
    await openMainPlanRow();
    const table = await screen.findByTestId("disposition-options-table");
    for (const id of ["A", "B", "C"]) {
      expect(within(table).getByTestId(`disposition-option-row-${id}`)).toBeInTheDocument();
    }
    // B「零挤占」的招牌就是不动在手单 —— 这条"没有副作用"本身是可比信息，必须渲出来。
    expect(screen.getByTestId("disposition-option-detail-B")).toHaveTextContent("不挤占任何在手单");
    // A 用了跨基地杠杆 → 副作用必须**点名到单**（不是一句"会有影响"）。
    const dispTable = document.querySelector('[data-testid^="disposition-sfx-A-"][data-testid$="-displaced"]');
    expect(dispTable, "跨基地调剂必须点名被挤占的在手单").not.toBeNull();
    expect(dispTable!.textContent).toContain("SO-20231");
  });

  it("成本三态照实渲：算得出的显金额、算不出的显「算不出 + 缺哪个字段」，**绝不按 0 并入总额**", async () => {
    await openMainPlanRow();
    await screen.findByTestId("disposition-options-table");
    // 跨基地有运费台账 → OK（金额来自 freightCost ÷ qty × 收窄量）。
    const crossCost = screen.getByTestId("disposition-lever-cost-A-cross_base");
    expect(crossCost).toHaveTextContent("元");
    expect(crossCost.textContent ?? "").not.toContain("算不出");
    // 加班/外协本体无单价承载 → EMPTY + 缺失字段名（不填 0）。
    expect(screen.getByTestId("disposition-lever-cost-A-overtime")).toHaveTextContent("Line.overtimeCostPerUnit");
    expect(screen.getByTestId("disposition-lever-cost-A-outsource")).toHaveTextContent("Supplier.outsourcePricePerUnit");
    // 汇总列因此是 PARTIAL（只报算得出的那部分并说明有几项没算）。
    expect(screen.getByTestId("disposition-option-cost-A").querySelector("[data-cost]")?.getAttribute("data-cost")).toBe("PARTIAL");
    // B 一项成本都算不出 → EMPTY，且不许出现金额。
    const bCost = screen.getByTestId("disposition-option-cost-B");
    expect(bCost.querySelector("[data-cost]")?.getAttribute("data-cost")).toBe("EMPTY");
    expect(bCost).toHaveTextContent("不填 0");
  });

  it("外协比例对 C08 红线走 RuleRef 两跳溯源 + 系数出处必须标「代码兜底默认」（否则被当成治理过的口径）", async () => {
    await openMainPlanRow();
    await screen.findByTestId("disposition-options-table");
    expect(screen.getAllByTestId("ruleref-C08").length, "外协比例判定必须挂真规则锚点").toBeGreaterThan(0);
    const coeff = screen.getByTestId("disposition-coeff-overtimeUpliftPct");
    expect(coeff.getAttribute("data-basis")).toBe("DEFAULT_FALLBACK");
    expect(coeff).toHaveTextContent("代码兜底默认");
  });

  it("options 只挂主行：备份行点开必须说明「为什么这行没有」，不渲空壳", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    const backup = within(table).getAllByRole("button").find((r) => (r.textContent ?? "").includes("双保险"))!;
    expect(backup, "mock 应有峰值≥90 的备份行").toBeTruthy();
    await userEvent.click(backup);
    const absent = await screen.findByTestId("disposition-options-absent");
    expect(absent).toHaveTextContent("planRows[].options");
    expect(absent).toHaveTextContent("主行");
  });
});

describe("WO-DECISION-INFO-FE · ④ 排序（别让零敞口的卡占榜首）", () => {
  it("按 exposureOrder 渲染，零敞口沉底；切「越线日序」→ 回到求解器数组序（两个序都留着）", async () => {
    useRiskStub(orderingPayload(true));
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-乙基地");

    // 数组序是 甲乙丙（甲零敞口）；影响面序必须把甲踢到最后。
    await waitFor(() => expect(cardOrderInDom()).toEqual(["risk-card-乙基地", "risk-card-丙基地", "risk-card-甲基地"]));
    expect(screen.getByTestId("risk-card-甲基地").getAttribute("data-has-exposure")).toBe("0");
    expect(screen.getByTestId("risk-card-乙基地").getAttribute("data-exposure-rank")).toBe("1");

    await userEvent.click(screen.getByTestId("risk-order-mode-solver"));
    await waitFor(() => expect(cardOrderInDom()).toEqual(["risk-card-甲基地", "risk-card-乙基地", "risk-card-丙基地"]));
  });

  it("exposureOrder 缺席 → 诚实回落数组序并说明原因（前端不自造一套影响面排序）", async () => {
    useRiskStub(orderingPayload(false));
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-甲基地");
    await waitFor(() => expect(cardOrderInDom()).toEqual(["risk-card-甲基地", "risk-card-乙基地", "risk-card-丙基地"]));
    expect(screen.getByTestId("risk-order-mode-note")).toHaveTextContent("未返回 exposureOrder");
  });

  it("纯函数 orderCardsByExposure：按序取序 · 缺席原样 · 不在序里的卡保持相对序附末尾（不编名次）", () => {
    const cards = [{ baseId: "a" }, { baseId: "b" }, { baseId: "c" }];
    expect(orderCardsByExposure(cards, ["c", "a", "b"]).map((c) => c.baseId)).toEqual(["c", "a", "b"]);
    expect(orderCardsByExposure(cards, undefined).map((c) => c.baseId)).toEqual(["a", "b", "c"]);
    expect(orderCardsByExposure(cards, []).map((c) => c.baseId)).toEqual(["a", "b", "c"]);
    // "c" 不在 exposureOrder 里 → 保持它在数组里的相对位置、整体附末尾。
    expect(orderCardsByExposure(cards, ["b", "a"]).map((c) => c.baseId)).toEqual(["b", "a", "c"]);
    // 原数组不得被就地改序（cards[] 的数组序是既有排序契约）。
    const src = [{ baseId: "a" }, { baseId: "b" }];
    orderCardsByExposure(src, ["b", "a"]);
    expect(src.map((c) => c.baseId)).toEqual(["a", "b"]);
  });
});

describe("WO-DECISION-INFO-FE · ⑤ 前置期溯源（R13）", () => {
  it("跨基地/外协前置期溯到真记录；加班前置期本体无承载 → 明说「取不到」且**不显示 0 天**", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    await userEvent.click(within(table).getAllByRole("button").find((r) => (r.textContent ?? "").includes("触发缺口"))!);
    await screen.findByTestId("disposition-options-table");

    const cross = screen.getByTestId("disposition-lead-A-cross_base");
    expect(cross.getAttribute("data-lead")).toBe("OK");
    expect(cross).toHaveTextContent("3 天");
    const out = screen.getByTestId("disposition-lead-A-outsource");
    expect(out.getAttribute("data-lead")).toBe("OK");
    expect(out).toHaveTextContent("6 天");
    // 加班：本体没有「加班启动前置期」承载字段 —— 写 0 天就是一个没有对象支持的断言。
    const ot = screen.getByTestId("disposition-lead-A-overtime");
    expect(ot.getAttribute("data-lead")).toBe("EMPTY");
    expect(ot).toHaveTextContent("取不到");
    expect(ot).toHaveTextContent("Line.overtimeLeadDays");
    // 结构判据（比文案指纹硬）：OK 分支才会把天数渲成 <b class="mono">N 天</b>；EMPTY 分支一个天数都不许有。
    expect(ot.querySelector("b.mono"), "前置期取不到却渲出了天数值 = 编了一个断言").toBeNull();
    expect(ot.textContent ?? "").not.toMatch(/前置期：\s*\d+\s*天/);
    // steps 的前置期读数（第二消费面）同样在屏。
    expect(screen.getByTestId("disposition-step-leadtimes")).toHaveTextContent("前置期");
  });

  it("「几天到位」算不出时显示「未知」+ 后端原因，绝不拿 0 天冒充马上到位", async () => {
    const payload = {
      horizon: 30,
      threshold: 85,
      cards: [mkCard("丁基地", "ding")],
      exposureOrder: ["ding"],
      planRows: [
        {
          act: "跨基地调剂（丁）", det: "触发缺口 700套", owner: "o", start: "T+1", done: "T+5", eff: "e", rule: "C05",
          baseId: "ding", shortfall: 700, residual: 0, steps: [],
          options: {
            status: "OK", baseId: "ding", shortfall: 700, trigDay: 5, unit: "套",
            coefficients: [{ key: "crossBaseAbsorbPct", value: 0.6, basis: "DEFAULT_FALLBACK", ruleKey: "base_outlook_coeffs", note: "代码兜底默认值" }],
            summary: "触发缺口 700套（第5天）",
            options: [
              {
                optionId: "A", label: "本地优先", strategy: "先榨本地加班",
                levers: [
                  {
                    leverKey: "cross_base", action: "跨基地调剂", closesGap: 420, day: 5, date: "2026-06-15", rationale: "r",
                    leadTime: { status: "EMPTY", days: null, reason: "本 ctx 无 InterBaseTransfer 可读", missingField: "InterBaseTransfer.transitDays" },
                    provenance: { kind: "实测", drillType: "WorkOrder", drillId: "ding", drillField: "qtyActual", drillValue: 0 },
                  },
                ],
                closedTotal: 420, residual: 280,
                readyInDays: null,
                readyInDaysReason: "跨基地调剂 的前置期取不到（缺 InterBaseTransfer.transitDays）→ 本方案「几天到位」无法给出，拒绝按 0 天冒充",
                cost: { status: "EMPTY", totalYuan: null, unit: "元", missing: [{ leverKey: "cross_base", reason: "无运费台账", missingField: "InterBaseTransfer.freightCost" }] },
                sideEffects: [],
              },
            ],
          },
        },
      ],
    };
    useRiskStub(payload);
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    await userEvent.click(within(table).getAllByRole("button")[0]!);

    const ready = await screen.findByTestId("disposition-option-ready-A");
    expect(ready).toHaveTextContent("未知（前置期取不到）");
    expect(ready.textContent ?? "").not.toMatch(/0\s*天/);
    expect(screen.getByTestId("disposition-option-readyreason-A")).toHaveTextContent("拒绝按 0 天冒充");
    // 该杠杆的前置期本身也走 EMPTY 分支（不是 0 天）。
    expect(screen.getByTestId("disposition-lead-A-cross_base").getAttribute("data-lead")).toBe("EMPTY");
  });
});
