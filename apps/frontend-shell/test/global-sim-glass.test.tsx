import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-GLOBALSIM-GLASS-REDESIGN · 全局在先重设计 + 去重 + 双向下钻（新壳测）。
 *
 * 覆盖 DoD/SEAM：① 磨砂重设计骨架（Hero 产能占用矩阵 + 目标 segmented + 守恒台账）到位、诚实徽标；
 * ② 目标切换真消费 portfolio（切主目标 → 重求解 → 读数标签/主方案高亮随之切，非写死）；
 * ③ 双向下钻：全局分配/被挤单卡开**同屏订单明细抽屉**（2026-08-17 U8 改判：看明细不换页——
 *    旧「跳 /v/project-sim?order=…」正是判据点名的违反；跳页出口收进抽屉内·gs-drawer-goto-project）；
 * ④ 项目推演常驻「受全局主计划约束」条 + 跳回全局重排口 + ?order= 自动细排该单。
 *
 * 目标间「解真变」的 KILL-MOCK 判据由迁入本页的 MultiObjWhatifPanel 承担（改权重→被挤单翻转，
 * 见 multiobj-whatif.test.tsx·现已在 /v/global-sim）；本 portfolio demo 数据产能充裕故 20 单皆按期、
 * 各方案目标值同值属真实无争用（诚实非写死），矩阵逐方案值直读求解器输出。
 */
describe("global-sim · 磨砂重设计 + 全局在先 + 双向下钻", () => {
  it("Hero 产能占用矩阵 + 目标 segmented + 守恒 ✓ + 诚实徽标；切目标 → 读数标签随主方案切", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");

    await screen.findByTestId("global-sim");
    // 诚实徽标（绝不「数据库事实」）。
    expect(screen.getByTestId("global-sim-badge")).toHaveTextContent("推演结果");
    // Hero 产能占用矩阵热力（基地×窗口·从 capacityLedger 派生）。
    const heat = await screen.findByTestId("global-sim-heatmatrix");
    // WO-UNIT-MEANING：热力格此前是裸数「87」——同一个量（产能占用率）在本页「业务类型」表里是带 % 的，
    // 热力格漏 % 即歧义（87 套？87%？）。锁死带单位渲染。
    const filled = within(heat).getAllByTestId(/^global-sim-heat-/).filter((td) => td.textContent!.trim() !== "");
    expect(filled.length).toBeGreaterThanOrEqual(1);
    for (const td of filled) expect(td.textContent).toMatch(/\d+%/);
    // 守恒台账通过。
    expect(screen.getByTestId("global-sim-verdict").textContent).toContain("守恒通过");

    // 求解结果读数默认主方案=最多按期。
    const readout = await screen.findByTestId("global-sim-readout");
    expect(readout.textContent).toContain("最多按期");

    // 目标 segmented 切到「最低代价」→ 重求解 → 读数标签随主方案切（真消费·非写死）。
    await user.click(screen.getByTestId("global-sim-obj-min_cost"));
    await screen.findByText(/按期率（最低代价）/);
    // 方案对比矩阵逐方案直读求解器 objectiveValues（≥2 行）。
    const matrix = screen.getByTestId("global-sim-matrix");
    expect(within(matrix).getAllByTestId(/global-sim-scen-row-/).length).toBeGreaterThanOrEqual(2);
  });

  it("双向下钻：台账行「明细」开同屏抽屉（U8：看明细不换页）· 跳页出口收进抽屉内", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    const drill = await screen.findByTestId("global-sim-alloc-drill-SO-10001");
    // 改前是 <a href=/v/project-sim?order=…>（想看细节 ⇒ 被带走）；改后是按钮开抽屉。
    expect(drill.tagName).toBe("BUTTON");
    drill.click();
    const drawer = await screen.findByTestId("global-sim-order-drawer");
    expect(drawer.textContent).toContain("SO-10001");
    expect(within(drawer).getByTestId("gs-drawer-goto-project")).toHaveAttribute("href", "/v/project-sim?order=SO-10001");
  });

  it("项目推演常驻「受全局主计划约束」条 + 回全局重排口；?order= 自动细排该单", async () => {
    loginAs("planner");
    renderApp("/v/project-sim?order=SO-10003");
    await screen.findByTestId("project-sim-view");

    // 常驻约束条 + 两个跳回全局的口子。
    expect(screen.getByTestId("proj-global-constraint")).toBeInTheDocument();
    expect(screen.getByTestId("proj-goto-global-batch")).toHaveAttribute("href", "/v/global-sim");
    expect(screen.getByTestId("proj-goto-global-reraise")).toHaveAttribute("href", "/v/global-sim");

    // 自全局页下钻标注（携带订单号）。
    expect(await screen.findByTestId("proj-from-global")).toHaveTextContent("SO-10003");
  });
});
