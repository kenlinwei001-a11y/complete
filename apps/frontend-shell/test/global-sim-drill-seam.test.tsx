import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-GLOBALSIM-DRILL-SEAM · 全局↔项目推演下钻接缝一致性（SEAM-GATE 驱动接缝·非各半绿）。
 *
 * 病根（口径不一致·下钻语义断在接缝）：GlobalSim 需求项池 = 三源并集（portfolio.ts）——
 * 销售订单 `SO-xxxx`(kind order) ∪ 在产工单 `WIP:${woId}`(kind wip·预扣产能) ∪ 销售预测 `FC:${segId}`(kind forecast)；
 * ProjectSim 池仅 Order（searchObjects("Order")）。旧下钻对所有 item 一刀切 `?order=<item>`，把 WIP:/FC:
 * 前缀 id 塞进去 → ProjectSim 只认 Order.props.so，命中才 pickOrder → WIP/预测永远 hit=undefined → silent no-op。
 *
 * 前端 mock（simSolvers.mockPortfolio）只产 kind=order（不越范围边界·禁碰求解器），故三源并集态由 server.use
 * 注入三类 item 的 portfolio 响应驱动接缝——正是真 datacore portfolio.ts 的输出口径（order/wip/forecast）。
 *
 * SEAM 四条：
 *  ① order(SO-xxx) → alloc/被挤下钻**开同屏明细抽屉**（U8 改判后：看明细不换页——旧「跳 project-sim」
 *     正是判据点名的违反；跳页出口收进抽屉内 gs-drawer-goto-project，仅 order 类有）；
 *  ② wip(WIP:…)  → 不开抽屉也不产生指向 project-sim 的链接，改诚实标注（data-drill-blocked）；
 *  ③ forecast(FC:…) → 同上不空跳；
 *  ④ ProjectSim 收到无法匹配的 ?order=WIP:… → 渲诚实提示条 proj-order-notfound（不 silent）。
 * R13：每 item provenance 不丢（标注悬浮复用 provTitle）；口径差异 UI 显式（不装 1:1）。
 */

const PROV = (drillType: string, drillId: string, drillField: string, drillValue: number) => ({
  kind: "派生", drillType, drillId, drillField, drillValue,
});

/** 三源并集 portfolio 响应（order ∪ wip ∪ forecast）——与 datacore/solvers/portfolio.ts 输出口径一致。 */
const THREE_KIND_PORTFOLIO = {
  status: "OPTIMAL", optimal: true, feasible: false, reconciled: true,
  allocation: [
    { item: "SO-10001", kind: "order", committed: false, base: "changzhou", baseName: "常州", window: 0, qty: 100, delayDays: 0, onTime: true, provenance: PROV("Order", "SO-10001", "qty", 100) },
    { item: "WIP:WO-1", kind: "wip", committed: true, base: "changzhou", baseName: "常州", window: 0, qty: 50, delayDays: 0, onTime: true, provenance: PROV("WorkOrder", "WIP:WO-1", "qtyActual", 50) },
    { item: "FC:SEG-1", kind: "forecast", committed: false, base: "hefei", baseName: "合肥", window: 1, qty: 80, delayDays: 0, onTime: true, provenance: PROV("DemandSegment", "FC:SEG-1", "demandWanPerYearP50", 80) },
  ],
  displaced: [
    { orderId: "WIP:WO-2", kind: "wip", qty: 30, model: "4680-NCM", provenance: PROV("WorkOrder", "WIP:WO-2", "qtyActual", 30) },
    { orderId: "FC:SEG-2", kind: "forecast", qty: 40, model: "预测", provenance: PROV("DemandSegment", "FC:SEG-2", "demandWanPerYearP50", 40) },
  ],
  scenarios: [
    { key: "max_ontime", objectiveValues: { ontime: 3, delay: 0, changeover: 0, fgInventory: 40, cost: 10 }, servedCount: 3, displacedCount: 2, servedQty: 230 },
    { key: "min_cost", objectiveValues: { ontime: 2, delay: 5, changeover: 1, fgInventory: 12, cost: 8 }, servedCount: 3, displacedCount: 2, servedQty: 230 },
  ],
  objectiveValues: { ontime: 3, delay: 0, changeover: 0, fgInventory: 40, cost: 10 },
  capacityLedger: [
    { baseId: "changzhou", window: 0, cap: 500, allocated: 150 },
    { baseId: "hefei", window: 1, cap: 400, allocated: 80 },
  ],
  reconChecks: [{ ok: true }, { ok: true }],
  cost: { delay: 0, changeover: 0, unserved: 35, total: 35 },
  frozen: [],
  summary: "三源并集下钻接缝测：1 订单 + 1 在产 + 1 预测 获排；被挤 1 在产 + 1 预测。",
};

function usePortfolioThreeKind() {
  server.use(
    http.post("*/b/v1/solvers/portfolio/run", () =>
      HttpResponse.json({ data: THREE_KIND_PORTFOLIO, snapshotVersion: "ov-seam" }),
    ),
  );
}

describe("global-sim ↔ project-sim · 下钻接缝一致性（三源并集口径）", () => {
  it("SEAM ①②③：alloc/被挤下钻按 kind 分流——order 跳 project-sim；wip/forecast 不空跳只标注", async () => {
    usePortfolioThreeKind();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // ① order(SO-xxx)：alloc 下钻**不是链接、不带 href**（U8：看明细不换页）——点击开同屏明细抽屉，
    //    抽屉内才有跳 project-sim 的「做别的事」出口（判据明示不算违反）。
    const orderDrill = await screen.findByTestId("global-sim-alloc-drill-SO-10001");
    expect(orderDrill.tagName).toBe("BUTTON");
    expect(orderDrill).not.toHaveAttribute("href");
    orderDrill.click();
    const drawer = await screen.findByTestId("global-sim-order-drawer");
    expect(drawer.textContent).toContain("SO-10001");
    expect(within(drawer).getByTestId("gs-drawer-goto-project")).toHaveAttribute("href", "/v/project-sim?order=SO-10001");
    within(drawer).getByTestId("gs-drawer-close").click();

    // ② wip(WIP:…)：不产生指向 project-sim 的链接，改诚实标注（非 <a>·无 href·data-drill-blocked）。
    const wipDrill = await screen.findByTestId("global-sim-alloc-drill-WIP:WO-1");
    expect(wipDrill.tagName).not.toBe("A");
    expect(wipDrill).not.toHaveAttribute("href");
    expect(wipDrill).toHaveAttribute("data-drill-blocked", "true");
    expect(wipDrill.textContent).toContain("在产承诺");
    // R13：provenance 不丢（悬浮复用 provTitle）。
    expect(wipDrill.getAttribute("title")).toContain("WorkOrder");

    // ③ forecast(FC:…)：alloc 侧同样不空跳只标注。
    const fcDrill = await screen.findByTestId("global-sim-alloc-drill-FC:SEG-1");
    expect(fcDrill.tagName).not.toBe("A");
    expect(fcDrill).not.toHaveAttribute("href");
    expect(fcDrill).toHaveAttribute("data-drill-blocked", "true");
    expect(fcDrill.textContent).toContain("销售预测");

    // 被挤单卡侧亦分流：wip/forecast 被挤项不产生指向 project-sim 的空跳链接。
    const wipDisplaced = await screen.findByTestId("global-sim-drill-WIP:WO-2");
    expect(wipDisplaced.tagName).not.toBe("A");
    expect(wipDisplaced).toHaveAttribute("data-drill-blocked", "true");
    const fcDisplaced = await screen.findByTestId("global-sim-drill-FC:SEG-2");
    expect(fcDisplaced.tagName).not.toBe("A");
    expect(fcDisplaced).toHaveAttribute("data-drill-blocked", "true");

    // 全局态断言：alloc 表内不存在任何指向 project-sim 且携带 WIP:/FC: 前缀 order 的链接（无空跳源头）。
    const alloc = screen.getByTestId("global-sim-alloc");
    const badLinks = Array.from(alloc.querySelectorAll("a")).filter((a) => {
      const href = a.getAttribute("href") ?? "";
      return href.includes("project-sim") && /order=(WIP%3A|FC%3A|WIP:|FC:)/.test(href);
    });
    expect(badLinks).toHaveLength(0);
  });

  it("SEAM ④：ProjectSim 收到无法匹配的 ?order=WIP:… → 渲诚实提示条 proj-order-notfound（不 silent）", async () => {
    loginAs("planner");
    renderApp("/v/project-sim?order=WIP:WO-1");
    await screen.findByTestId("project-sim-view");

    const notFound = await screen.findByTestId("proj-order-notfound");
    expect(notFound.textContent).toContain("WIP:WO-1");
    expect(notFound.textContent).toContain("接单可行性仅细排销售订单");
    // 兜底提供返回全局的口子。
    expect(screen.getByTestId("proj-notfound-back-global")).toHaveAttribute("href", "/v/global-sim");
  });

  it("SEAM ④ 反向：合法订单 ?order=SO-… → 不误报 notfound（正常自动细排该单）", async () => {
    loginAs("planner");
    renderApp("/v/project-sim?order=SO-10003");
    await screen.findByTestId("project-sim-view");
    // 合法订单不出提示条。
    expect(screen.queryByTestId("proj-order-notfound")).toBeNull();
    // 仍渲下钻来源标注（携带订单号）。
    expect(await screen.findByTestId("proj-from-global")).toHaveTextContent("SO-10003");
  });
});
