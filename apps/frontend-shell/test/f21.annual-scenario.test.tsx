import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";
import { createSimSession } from "@/api/endpoints";

describe("F21 · 年度规划（annual-scenario）", () => {
  it("三情景卡渲染 + 已拍板态 + 规则徽章可点开 expression", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/annual-scenario");

    // 三情景卡（保守/基准/激进）
    const conservative = await screen.findByTestId("scen-card-conservative");
    const baseline = screen.getByTestId("scen-card-baseline");
    const aggressive = screen.getByTestId("scen-card-aggressive");
    expect(conservative).toHaveTextContent("1,420");
    expect(baseline).toHaveTextContent("1,580");
    expect(aggressive).toHaveTextContent("1,760");
    // 财务测算行
    expect(baseline).toHaveTextContent("收入 3,400 亿 · CAPEX 14 亿 · IRR 19%");

    // 已拍板：基准卡带 chip + 描边态；其余两卡无
    expect(screen.getByTestId("scen-finalized-baseline")).toHaveTextContent("已拍板 AOP");
    expect(baseline).toHaveAttribute("data-finalized", "true");
    expect(conservative).toHaveAttribute("data-finalized", "false");

    // 规则校验徽章可点开 expression（嵌入响应 explanation）
    await user.click(within(baseline).getByTestId("scen-rule-baseline-C18"));
    expect(screen.getByTestId("scen-rule-detail-baseline")).toHaveTextContent("cashCushion >= 50");
  });

  it("C1 项目测算：项目级 IRR/24月利用率/C23 判定渲染（基准通过、激进江门不通过）", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    const baseProj = await screen.findByTestId("scen-project-baseline-ZZ");
    expect(baseProj).toHaveTextContent("枣庄储能线");
    expect(baseProj).toHaveTextContent("IRR 19.0%");
    expect(baseProj).toHaveTextContent("24月利用率 81.0%");
    expect(baseProj).toHaveTextContent("C23 ✓");

    const jm = screen.getByTestId("scen-project-aggressive-JM");
    expect(jm).toHaveTextContent("江门动力线");
    expect(jm).toHaveTextContent("IRR 12.5%");
    expect(jm).toHaveTextContent("C23 ⚠");
  });

  it("触发条件挂牌：已触发行高亮 + 触发时间与通知记录；监测中行 ⏳", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    const triggered = await screen.findByTestId("aop-trigger-trg-ess");
    expect(triggered).toHaveAttribute("data-status", "TRIGGERED");
    expect(triggered).toHaveTextContent("✓ 已触发");
    expect(triggered).toHaveTextContent("触发时间 2026-06-08");
    expect(triggered).toHaveTextContent("已通知：投资委员会、规划部");
    expect(triggered.className).toContain("trgTriggered");

    const monitoring = screen.getByTestId("aop-trigger-trg-overseas");
    expect(monitoring).toHaveAttribute("data-status", "MONITORING");
    expect(monitoring).toHaveTextContent("⏳ 监测中");
  });

  it("目标分解流：月份 chips + 尾注同源说明 + 节点悬停溯源 targetRef（S&OP 目标线同源）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/annual-scenario");

    await screen.findByTestId("aop-dec-flow");
    expect(screen.getByTestId("aop-dec-footnote")).toHaveTextContent("分解值 = S&OP 平衡台目标线（同源勾稽）");

    // 2026-07 分解值 127.6 → 悬停溯源指向 sop-target-2026-07（与 S&OP 目标线同源勾稽）
    const month = screen.getByTestId("dec-month-2026-07");
    expect(month).toHaveTextContent("127.6");
    await user.hover(month);
    const pop = await screen.findByTestId("dec-prov-pop");
    expect(pop).toHaveTextContent("sop-target-2026-07");
    expect(pop).toHaveTextContent("S&OP 平衡台目标线");
  });

  it("1:1 补齐：三情景对比 chip + 情景前提 note 行 + 分解 header 基准数字 + 缺口/过剩窗口曲线", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    // 头部"三情景对比" chip（取情景数，非写死）
    const chip = await screen.findByTestId("aop-compare-chip");
    expect(chip).toHaveTextContent("三情景对比 · 3 情景");

    // 情景卡 note 行（电池域种子文案，经契约下发）
    const conservative = screen.getByTestId("scen-card-conservative");
    expect(within(conservative).getByTestId("scen-note-conservative")).toHaveTextContent("守现金");

    // 目标分解 header 基准情景数字（取 finalized=基准 demand=1580，非写死）
    expect(screen.getByTestId("aop-dec-baseline")).toHaveTextContent("基准情景 1,580 万套");

    // 缺口/过剩窗口曲线：消费基准 capexScenario.windows（基准含一段 2027-Q1 过剩窗）
    const curve = screen.getByTestId("aop-window-curve");
    expect(within(curve).getByTestId("aop-window-surplus-2027-Q1")).toHaveTextContent("过剩窗口 2027-Q1");
    expect(within(curve).getByTestId("aop-window-chart")).toBeTruthy();
    // WO-UNIT-MEANING：纵轴此前是裸刻度（「1150」是万套？亿元？GWh？）→ 现落 caption + 轴名，
    // 量纲单源沿用页面唯一单位常量 zh.aop.demandUnit（"万套/年"）取数量部分，粒度换成本曲线真实的季。
    expect(within(curve).getByTestId("aop-window-axis-caption").textContent)
      .toBe("纵轴：万套/季（需求 / 供给 / 缺口三序列同尺 · 年需求按季节权重卷积到季）");
  });

  it("拍板情景（catalog_admin + act.aop-finalize）→ actionType=AOP情景拍板 草稿", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 catalog_admin
    renderApp("/v/annual-scenario");

    await user.click(await screen.findByTestId("scen-finalize-aggressive"));
    await waitFor(() => {
      const draft = db.actionDrafts.find((d) => d.actionTypeKey === "AOP情景拍板");
      expect(draft).toBeTruthy();
      expect(draft!.payload).toMatchObject({ scenarioKey: "aggressive" });
      expect(draft!.status).toBe("PENDING_APPROVAL");
    });
  });

  /**
   * ══ WO-HV-B ① ·「今天做这个决定 → 未来某期结果」：年度情景页接上推演世界 ══════════
   *
   * **改前的病**：本页只有一行查表的钱（`finance: {revenue, capex, irr}` 直读
   * `AnnualScenario` 的种子常数）⇒ **在哪个推演世界里、施加了什么扰动，它都是同一组数**。
   * 真后端实测（SEED_DEMO=1·世界 sims_demo_seed_world·2026-09-12）：
   * 把 SO-3391 的 costPressure set 到 900 之后，`capex` 前后都是 **8**（逐字节不动），
   * 而世界态投影的销售成本从 **1122.12 → 1138.73**（聚合压力 93.102246 → 95.960556）。
   *
   * 这道门咬三条：
   *  ① **没有世界时不许编数** —— 屏上是「还没有任何推演世界」，**不是 0**；
   *  ② **有世界时真接线** —— 投影行、压力行、可披露算式都来自回包；
   *  ③ **口径不许混** —— 「推演投影 · 非实测」常驻第一层，且**不许**把 capex/IRR
   *     说成被投影过（该求解器压根不产这两样，改个标签就是编数）。
   */
  it("WO-HV-B ① · 没有推演世界时据实留空（不显示 0、不编数）", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    const band = await screen.findByTestId("aop-world-projection");
    // ① 诚实缺口记号在，且明说「不是 0」
    // ⚠ 必须 `find*` 等清单查询落地：`aop-world-projection` 这个壳在 loading 态就已经渲染，
    //   拿它当"查询已完成"的证据会在 loading 那一帧断言失败 —— 壳在不度量数据到了。
    // 第一层是**短记号**（成段理由按 R-UI-3 进 `?` 浮层 —— check-ui-first-layer D2b 棘轮咬这条）。
    const none = await within(band).findByTestId("aop-world-none");
    expect(none).toHaveTextContent("暂无推演世界");
    expect(none).toHaveTextContent("不是 0");
    // ⛔ 静默降层等于删除：浮层必须**常驻可见**，不是 hover 才存在
    expect(within(none).getByTestId("info-aop-world-none-why")).toBeInTheDocument();
    // 反向判据：没有世界时**不许**出现任何金额行（只咬一向会漏掉「两个都渲染了」）
    expect(within(band).queryByTestId("aop-world-lines")).toBeNull();
    // ③ 口径行常驻第一层（不 hover、不点开就在）
    expect(within(band).getByTestId("aop-world-caliber")).toHaveTextContent("推演投影 · 非实测");
  });

  it("WO-HV-B ① · 有推演世界 ⇒ 逐行读出基线/投影/Δ + 可披露算式；收入行诚实标『本链不驱动』", async () => {
    loginAs("planner");
    // 先造一个世界（走 mock 的真 POST /a/v1/sim/sessions，不在测试里手塞 store）
    await createSimSession({ baseSnapshot: { obj_order_SO_3391: { costPressure: 900 } }, scope: {} });

    renderApp("/v/annual-scenario");
    const band = await screen.findByTestId("aop-world-projection");

    // ② 真接线：三行都渲染，数字来自回包（不写死在断言里 —— 从 DOM 现取再互相校验）
    const lines = await within(band).findByTestId("aop-world-lines");
    const cost = within(lines).getByTestId("aop-world-line-COST");
    expect(cost).toHaveTextContent("销售成本");
    expect(within(cost).getByTestId("aop-world-projected-COST")).toHaveTextContent("1,138.73");
    expect(within(cost).getByTestId("aop-world-delta-COST")).toHaveTextContent("557.63");
    // 可披露：算式逐字来自回包（一个看不到代码的人能自己判断这是推演不是查表）
    expect(within(cost).getByTestId("aop-world-formula-COST")).toHaveTextContent("581.1 ×（1 + 95.960556 ÷ 100）");

    // 毛利与成本反向、且 Δ 互为相反数（增量法：毛利' = 毛利 + Δ收入 − Δ成本）
    const margin = within(lines).getByTestId("aop-world-line-MARGIN");
    expect(within(margin).getByTestId("aop-world-delta-MARGIN")).toHaveTextContent("-557.63");

    // 收入行：driver 为空 ⇒ 屏上必须写「本链不驱动」——诚实缺席，不是「不受影响」
    const rev = within(lines).getByTestId("aop-world-line-REVENUE");
    expect(within(rev).getByTestId("aop-world-formula-REVENUE")).toHaveTextContent("本链不驱动");

    // 压力来源（这就是「那个决定」在世界里留下的痕迹）
    expect(within(band).getByTestId("aop-world-pressures")).toHaveTextContent("costPressure");
    expect(within(band).getByTestId("aop-world-pressures")).toHaveTextContent("500/500");

    // ③ 反向判据：有数时**不许**再出现「没有推演世界」的缺口记号
    expect(within(band).queryByTestId("aop-world-none")).toBeNull();

    // 情景卡那三个查表数**照旧**（它们按设计不随世界态动 —— 这不是 bug，是真值口径）
    expect(screen.getByTestId("scen-card-baseline")).toHaveTextContent("收入 3,400 亿 · CAPEX 14 亿 · IRR 19%");
  });
});
