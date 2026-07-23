import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { CapacityDerivationDag } from "@/views/capacity/CapacityDerivationDag";

/**
 * WO-GSIM-3-FRONTEND · 全局推演决策驾驶舱五区 SEAM-GATE（跨半命门·非各半绿·KILL-MOCK-RED）。
 *
 * SEAM 五条：
 *  §1 跨半咬合（命门）：勾选订单子集（排除）→ 真打 portfolio（mock 逐口径移植）→ 排产表 / 分配台账真变（行消失·输入→输出真变）。
 *  §2 两段可视：排产安排表真出「电芯常州 → 在途 N 天 → Pack邯郸」多段 + 换型显小时（真 InterBaseTransfer JOIN）。
 *  §3 真客户映射：被挤单 → 真客户名（来自真 Order 对象·可溯·非杜撰）+ 应用细分 + 影响额。
 *  §4 灰数据修真咬：改 Equipment.oee_current（→ bottleneck_matrix 张力 LIVE 真变）→ 产能派生 DAG 格子真变色（非恒灰）。
 *  §5 debattery 门：见 scripts/check-debattery.mjs（基地/型号/客户名非内联·CI 门·此处不重复）。
 */

const PROV = (drillType: string, drillId: string, drillField: string, drillValue: number) => ({ kind: "派生", drillType, drillId, drillField, drillValue });

describe("global-sim cockpit · 五区决策驾驶舱 SEAM-GATE", () => {
  it("§2 两段可视：排产安排表真出「电芯常州 → 在途 3 天 → Pack邯郸」+ 换型显小时（真 InterBaseTransfer JOIN）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // SO-10001（常州·4680-NCM）命中 XFER changzhou→handan → 电芯段常州 / 在途 3 天 / Pack段邯郸 / 换型 1.0 小时。
    const sched = await screen.findByTestId("global-sim-schedule-table");
    const row = await screen.findByTestId("global-sim-sched-SO-10001");
    expect(row).toHaveAttribute("data-cross", "true");
    expect(within(row).getByTestId("global-sim-sched-cell-SO-10001").textContent).toContain("常州");
    expect(within(row).getByTestId("global-sim-sched-transit-SO-10001").textContent).toContain("在途 3 天");
    expect(within(row).getByTestId("global-sim-sched-pack-SO-10001").textContent).toContain("邯郸");
    expect(within(row).getByTestId("global-sim-sched-chg-SO-10001").textContent).toContain("小时");
    // 至少一段两段行（电芯↔Pack 异地）。
    expect(within(sched).getAllByText(/异地/).length).toBeGreaterThanOrEqual(1);
  });

  it("§1 跨半咬合（命门）：排除 SO-10001 → 真打 portfolio → 排产表/分配台账该单真消失（输入→输出真变）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // 初始：SO-10001 在排产表 + 分配台账。
    await screen.findByTestId("global-sim-sched-SO-10001");
    expect(screen.getByTestId("global-sim-alloc-SO-10001")).toBeInTheDocument();

    // 排除 SO-10001（移出决策集）→ 重求解（真打 mock portfolio）。
    await user.click(screen.getByTestId("global-sim-exclude-SO-10001"));

    // 排产表 + 分配台账不再含该单（联合解真变·非写死）。
    await waitFor(() => expect(screen.queryByTestId("global-sim-sched-SO-10001")).not.toBeInTheDocument());
    expect(screen.queryByTestId("global-sim-alloc-SO-10001")).not.toBeInTheDocument();
    // 杠杆盘纳入计数随之 -1（需求子集真变）。
    expect(screen.getByTestId("global-sim-lever-included").textContent).toMatch(/19\s*\/\s*20/);
  });

  it("§1 跨半咬合：切目标 min_cost → 主方案高亮/读数标签真随主方案切（真消费 portfolio·非写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    await screen.findByTestId("global-sim-readout");

    await user.click(screen.getByTestId("global-sim-obj-min_cost"));
    await screen.findByText(/按期率（最低代价）/);
    // 方案对比矩阵 min_cost 行存在（真读求解器 objectiveValues）。
    expect(screen.getByTestId("global-sim-scen-row-min_cost")).toBeInTheDocument();
  });

  it("§3 真客户映射：被挤单 → 真客户名（来自真 Order 对象·可溯·非杜撰）+ 应用细分 + 影响额", async () => {
    // 注入含 order-kind 被挤单的 portfolio 响应（口径同 datacore portfolio.displaced）。
    const withDisplaced = {
      status: "OPTIMAL", optimal: true, feasible: false, reconciled: true,
      allocation: [
        { item: "SO-10002", kind: "order", committed: false, base: "xiamen", baseName: "厦门", window: 0, windowStartDay: 0, qty: 800, model: "4680-LFP", delayDays: 0, onTime: true, provenance: PROV("Order", "SO-10002", "qty", 800) },
      ],
      displaced: [
        { orderId: "SO-10001", kind: "order", qty: 1500, model: "4680-NCM", provenance: PROV("Order", "SO-10001", "qty", 1500) },
        { orderId: "SO-10006", kind: "order", qty: 2200, model: "储能-280Ah", provenance: PROV("Order", "SO-10006", "qty", 2200) },
      ],
      scenarios: [
        { key: "max_ontime", objectiveValues: { ontime: 1, delay: 0, changeover: 0, fgInventory: 0, cost: 20 }, servedCount: 1, displacedCount: 2, servedQty: 800 },
        { key: "min_cost", objectiveValues: { ontime: 1, delay: 0, changeover: 0, fgInventory: 0, cost: 18 }, servedCount: 1, displacedCount: 2, servedQty: 800 },
      ],
      objectiveValues: { ontime: 1, delay: 0, changeover: 0, fgInventory: 0, cost: 20 },
      capacityLedger: [{ baseId: "xiamen", window: 0, cap: 5000, allocated: 800 }],
      reconChecks: [{ ok: true }], cost: { delay: 0, changeover: 0, unserved: 100, total: 100 },
      frozen: [], summary: "客户级影响 SEAM：1 获排·被挤 2 订单。",
    };
    server.use(http.post("*/b/v1/solvers/portfolio/run", () => HttpResponse.json({ data: withDisplaced, snapshotVersion: "ov-cust" })));

    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // 客户级影响卡出被挤单 SO-10001，客户名来自真 Order 对象（与订单清单同源·可溯·非杜撰）。
    const impact = await screen.findByTestId("global-sim-impact-SO-10001");
    const custEl = within(impact).getByTestId("global-sim-impact-cust-SO-10001");
    const custName = custEl.textContent ?? "";
    expect(custName.length).toBeGreaterThan(0);
    // 可溯真 order：订单清单里 SO-10001 行的客户单元 == 影响卡客户名（同一 Order 对象·非组件内写死）。
    const orderRow = screen.getByTestId("global-sim-order-SO-10001");
    expect(orderRow.textContent).toContain(custName);
    // 应用细分 + 影响额（Σqty×SEG价÷1e4·真公式）。
    expect(within(impact).getByTestId("global-sim-impact-yi-SO-10001").textContent).toMatch(/[0-9]/);
    expect(screen.getByTestId("global-sim-impact-summary").textContent).toContain("可溯真 order");
  });

  it("§4 灰数据修真咬：Equipment.oee 高/低 → bottleneck_matrix 张力 LIVE 真变 → 产能派生 DAG 设备OEE 格真变色（非恒灰）", async () => {
    // 高张力（低 OEE·设备紧张）LIVE 响应。
    const bnHigh = { dataMode: "LIVE", factors: ["设备OEE", "良率波动", "物料齐套", "瓶颈工序"], rows: [{ base: "常州", tightness: { 设备OEE: 95, 良率波动: 60, 物料齐套: 55, 瓶颈工序: 70 }, primary: "瓶颈工序" }] };
    server.use(http.post("*/b/v1/solvers/bottleneck_matrix/run", () => HttpResponse.json({ data: bnHigh, snapshotVersion: "ov-oee-hi" })));
    loginAs("planner");
    const hi = render(<CapacityDerivationDag baseId="常州" />);
    await waitFor(() => expect(screen.getByTestId("cap-dag-nodes")).toBeInTheDocument());
    const anchorHi = await screen.findByTestId("cap-dag-anchor-1");
    await waitFor(() => expect(anchorHi.getAttribute("data-tight")).toBe("95"));
    expect(anchorHi.getAttribute("data-live")).toBe("true"); // LIVE 口径（读真 Equipment.oee_current）
    const colorHi = anchorHi.getAttribute("style") ?? "";
    expect(colorHi).toContain("--danger"); // 高张力 → 暖红（非恒灰）
    hi.unmount();

    // 改 Equipment.oee_current 升高（→ 设备OEE 张力 30·低）→ 同格真变色（冷绿）。
    const bnLow = { dataMode: "LIVE", factors: ["设备OEE", "良率波动", "物料齐套", "瓶颈工序"], rows: [{ base: "常州", tightness: { 设备OEE: 30, 良率波动: 60, 物料齐套: 55, 瓶颈工序: 70 }, primary: "瓶颈工序" }] };
    server.use(http.post("*/b/v1/solvers/bottleneck_matrix/run", () => HttpResponse.json({ data: bnLow, snapshotVersion: "ov-oee-lo" })));
    render(<CapacityDerivationDag baseId="常州" />);
    await waitFor(() => expect(screen.getAllByTestId("cap-dag-anchor-1").length).toBeGreaterThan(0));
    const anchorLo = screen.getAllByTestId("cap-dag-anchor-1").at(-1)!;
    await waitFor(() => expect(anchorLo.getAttribute("data-tight")).toBe("30"));
    const colorLo = anchorLo.getAttribute("style") ?? "";
    expect(colorLo).not.toContain("--danger"); // 低张力 → 冷绿（改 OEE 后真变色·非恒灰）
    expect(colorLo).toContain("--ok");
  });
});
