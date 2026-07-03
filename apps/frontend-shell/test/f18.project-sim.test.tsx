import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

/**
 * F18（增量 §7.13 / 验收表）：project-sim 切到分批并加一紧批 →
 * 批次表 wkEff 列正确（净窗口 = 交付日 − 地址物流时长）；④步合计行 P90 系数显示；
 * DAG 随 stepper 点亮且「本步」角标移动。
 */
describe("F18 · 项目推演（project-sim）分批 + 六步 stepper + DAG", () => {
  it("分批模式加一紧批：wkEff/物流时长正确，✓/✗ 混合；④合计行 P90=×healthFactor；DAG 点亮随步移动", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 默认整单（4680-NCM · 40 万套 · 6 周）首次重算完成 → 六步 stepper + 常显 DAG 面板
    await screen.findByTestId("pm-stepper");
    expect(screen.getByTestId("pm-dag-panel")).toBeInTheDocument();
    expect(screen.getByTestId("pm-step-counter")).toHaveTextContent("1/6");

    // 切到分批：批次表格编辑器（数量/交付日/地址下拉 + 物流时长列）
    await user.click(screen.getByTestId("mode-batch"));
    const editor = screen.getByTestId("batch-editor");
    expect(within(editor).getByTestId("batch-logi-0")).toHaveTextContent("物流 3 天"); // 上海
    expect(within(editor).getByTestId("batch-logi-1")).toHaveTextContent("物流 14 天"); // 海外

    // 加一紧批（默认 10 万套 @2026-08-24 上海）→ 改交付日 2026-07-20 制造紧批
    await user.click(screen.getByTestId("batch-add"));
    fireEvent.change(screen.getByLabelText("第3批交付日期"), { target: { value: "2026-07-20" } });

    // ① 场景解析（分批）：净窗口 wkEff = (交付日 − 物流) / 7（输出按交付日排序）
    await waitFor(() => expect(screen.getByTestId("batch-wkeff-1")).toHaveTextContent("4 周"));
    expect(screen.getByTestId("batch-wkeff-0")).toHaveTextContent("3 周"); // 07-13 上海：(28−3)/7
    expect(screen.getByTestId("batch-wkeff-2")).toHaveTextContent("6 周"); // 08-10 海外：(56−14)/7
    // 累计需求 vs 累计 P90 校验：✓/✗ 混合（紧批 28 > 25.5 → ✗）
    expect(screen.getByTestId("batch-ok-0")).toHaveTextContent("✓ 按期");
    expect(screen.getByTestId("batch-ok-1")).toHaveTextContent("✗ 缺");

    // ④ 逐级聚合：合计行展示 P50 与 P90（METHOD-MC-STOCHASTIC：种子化蒙特卡洛真实分位·非 P50×0.93 伪分位）
    await user.click(screen.getByTestId("pm-step-chip-4"));
    const total = await screen.findByTestId("pm-step4-total");
    expect(total).toHaveTextContent("P50");
    expect(total).toHaveTextContent("蒙特卡洛真实分位");

    // DAG 随步骤点亮：step4 →「本步」在聚合求解器；瓶颈求解器（st=5）未点亮（透明度 0.28）
    expect(screen.getByTestId("pm-dag-current-agg")).toBeInTheDocument();
    expect(screen.getByTestId("pm-dag-node-bn")).toHaveAttribute("data-lit", "0");
    expect(screen.getByTestId("pm-dag-node-fc")).toHaveAttribute("data-lit", "0");

    // 下一步 → step5：「本步」角标移动到瓶颈求解器，agg 不再是当前步
    await user.click(screen.getByTestId("pm-next"));
    expect(screen.getByTestId("pm-step-counter")).toHaveTextContent("5/6");
    expect(screen.getByTestId("pm-dag-current-bn")).toBeInTheDocument();
    expect(screen.queryByTestId("pm-dag-current-agg")).not.toBeInTheDocument();
    expect(screen.getByTestId("pm-dag-node-bn")).toHaveAttribute("data-lit", "1");

    // ⑤ 瓶颈定位：多维瓶颈矩阵弹窗（基地×7因素热力，主瓶颈 ◉）
    await user.click(screen.getByTestId("bn-matrix-open"));
    const modal = await screen.findByTestId("bn-matrix-modal");
    await waitFor(() => expect(within(modal).getByTestId("bn-matrix-table")).toBeInTheDocument());
    expect(within(modal).getByTestId("bn-cell-常州-瓶颈工序")).toHaveTextContent("◉");
  });

  it("DAG 节点点穿（#3 · R13）：点聚合求解器 → 抽屉看判定/推导公式/输入/关联规则", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 默认整单首次重算完成 → 常显 DAG
    await screen.findByTestId("pm-dag-panel");

    // 点聚合求解器节点 → 详情抽屉（六要素：来源/推导/输入/规则）
    await user.click(screen.getByTestId("pm-dag-node-agg"));
    const drawer = await screen.findByTestId("dag-node-drawer");
    expect(within(drawer).getByTestId("dag-node-verdict")).toHaveTextContent("P50");
    expect(within(drawer).getByTestId("dag-node-src")).toHaveTextContent("capacity_forecast");
    expect(drawer).toHaveTextContent("P50 = Σ可产基地"); // 推导公式
    expect(within(drawer).getByTestId("dag-node-rule")).toHaveTextContent("C01"); // 关联规则两跳锚点

    // 关掉，再点结论节点 → 缺口/健康度推导可溯
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("dag-node-drawer")).not.toBeInTheDocument());
    await user.click(screen.getByTestId("pm-dag-node-fc"));
    const concl = await screen.findByTestId("dag-node-drawer");
    expect(concl).toHaveTextContent("健康度");
    expect(within(concl).getByTestId("dag-node-rule")).toHaveTextContent("C09");
  });

  it("DAG 直接操纵（#3）：缩放按钮改 viewBox 缩放级别，复位还原", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    const svg = await screen.findByTestId("pm-dag");
    expect(svg).toHaveAttribute("data-zoom", "1.00");
    // 放大 → zoom 上升、viewBox 收窄
    const vb0 = svg.getAttribute("viewBox")!;
    await user.click(screen.getByTestId("pm-dag-zoom-in"));
    expect(Number(screen.getByTestId("pm-dag").getAttribute("data-zoom"))).toBeGreaterThan(1);
    expect(screen.getByTestId("pm-dag").getAttribute("viewBox")).not.toBe(vb0);
    // 复位 → 还原
    await user.click(screen.getByTestId("pm-dag-zoom-reset"));
    expect(screen.getByTestId("pm-dag")).toHaveAttribute("data-zoom", "1.00");
    expect(screen.getByTestId("pm-dag").getAttribute("viewBox")).toBe(vb0);
  });

  it("②可产网络收敛（PRD-IND-model 缺口①）：N/总数 注解 + 不可产基地✗带派生原因（chem×业态）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 默认 4680-NCM（动力 · NCM）首算完成 → 跳到②可产基地步
    await screen.findByTestId("pm-stepper");
    await user.click(screen.getByTestId("pm-step-chip-2"));
    await screen.findByTestId("pm-step2");

    // 收敛注解：仅在 3/12 个基地可产（producibleCount/totalBases，前端零写死）
    const conv = screen.getByTestId("pm-step2-converge");
    expect(conv).toHaveTextContent("3");
    expect(conv).toHaveTextContent("12");

    // 不可产基地：储能基地业态不匹配（江门·储能 vs 动力型号）
    expect(screen.getByTestId("nonproducible-江门")).toHaveTextContent("不匹配");
    // 动力基地但 NCM 产线未铺/认证（厦门·动力）
    expect(screen.getByTestId("nonproducible-厦门")).toHaveTextContent("产线未");
  });

  it("CSV 上传分批交货表（PRD-IND-model §4.3）：解析 → 切分批 → 导入提示", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("pm-stepper");

    // 切分批 → 见上传/模板工具条
    await user.click(screen.getByTestId("mode-batch"));
    const input = screen.getByTestId("batch-upload");
    const csv = "数量(万套),交付日期,交付地址\n15,2026/07/10,华东 · 上海\n25,2026-08-07,华南 · 深圳\n30,2026-09-04,海外 · 欧洲（海运）\n";
    const file = new File(["﻿" + csv], "批次.csv", { type: "text/csv" });
    await user.upload(input, file);

    // 三行导入 + 提示；地址模糊匹配（上海/深圳/欧洲）、日期归一（2026/07/10→2026-07-10）
    await waitFor(() => expect(screen.getByTestId("batch-upload-msg")).toHaveTextContent("已导入 3 批"));
    expect(screen.getByTestId("batch-editor")).toBeInTheDocument();
  });

  it("⑥对症对策表（PRD-IND-model §4.4-⑥）：缺口时显示方案库 acts 三行（i18n 零写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("pm-stepper");

    // 放大需求制造缺口（单批 200 万套 · 6 周 → P90 远不足）
    fireEvent.change(screen.getByLabelText("需求(万套)"), { target: { value: "200" } });
    await user.click(screen.getByTestId("pm-step-chip-6"));
    await screen.findByTestId("pm-step6");

    // 缺口结论 → 对症对策表三行
    const acts = await screen.findByTestId("pm-acts-table");
    expect(within(acts).getByTestId("pm-act-加 2 夜班")).toHaveTextContent("+12%");
    expect(within(acts).getByTestId("pm-act-扩化成通道")).toHaveTextContent("直击主瓶颈");
    expect(within(acts).getByTestId("pm-act-部分外协")).toHaveTextContent("C08");
  });

  it("型号选择器/订单点击写入 selectedObjects（查询 Dock 上下文）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 订单列表点击 → selectedObjects = Order
    await user.click(await screen.findByTestId("proj-order-SO-10001"));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Order", label: "SO-10001" }),
    ]);

    // 型号选择器 → selectedObjects = Model（§7.13 参数区）
    await user.selectOptions(screen.getByLabelText("型号"), "储能-280Ah");
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Model", objectId: "model-储能-280Ah", label: "储能-280Ah" }),
    ]);
  });
});
