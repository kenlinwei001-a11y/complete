import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F49 · 数据构建发动机页面统一规格 P1+P2（区2 故事理解 + 区4 快速合成收编 + 区5 模块同步矩阵）。
 * - 区2：建域后展开 → BuildPlan 全栈分组卡片（看到 LLM 完整理解，含工作流/技能/Agent/MCP/场景/切片/知识库）。
 * - 区4：快速合成入口（模板驱动，收编合成数据页生成）→ 报告内嵌 + 连接器核对深链。
 * - 区5：模块同步矩阵（本次新增到各下游模块 + DRAFT/已发布 R4 + 深链核对）。
 */
describe("F49 · 数据构建发动机控制台 P1+P2（区2 理解 + 区4 快速合成 + 区5 同步矩阵）", () => {
  it("区2：建域并记入历史 → 展开见全栈分组理解卡片（13 组中的全栈制品齐全）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-run"));
    // 时间线出现记录并自动展开 → 故事理解分组卡片渲染
    const comprehension = await within(timeline).findByTestId("sbr-comprehension");
    // 全栈分组齐全：A 栈（对象/切片/规则/求解器/数据源）+ B 栈（意图/计划/工作流/技能/Agent/MCP/场景）+ KB
    for (const g of ["dataSources", "objectTypes", "sliceNeeds", "rules", "solverNeeds", "intentNeeds", "planNeeds", "workflowNeeds", "skillNeeds", "agentNeeds", "mcpNeeds", "sceneNeeds", "kbDocs"]) {
      expect(within(comprehension).getByTestId(`comprehend-${g}`)).toBeTruthy();
      // WO-UNIT-MEANING：分组徽章此前是裸数（「规则 5」可读成规则编号 5）——label 是品类名不是量词 → 必须带"项"
      expect(within(comprehension).getByTestId(`comprehend-count-${g}`).textContent).toMatch(/^\d+ 项$/);
    }
    // 条目内容可见（非 JSON dump）：工作流/Agent/场景读出的具体制品名
    expect(within(comprehension).getByText("risk_workflow")).toBeTruthy();
    expect(within(comprehension).getByText("risk_agent")).toBeTruthy();
    expect(within(comprehension).getByText("risk_scene")).toBeTruthy();
  });

  it("区5：建域后展开 → 模块同步矩阵（本次新增到各下游模块 + DRAFT/已发布 + 深链核对）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-run"));
    const matrix = await within(timeline).findByTestId("sbr-syncmatrix");
    // 多模块行：本体/连接器/场景/Agent 等本次触及的模块
    expect(within(matrix).getByTestId("syncrow-ontology")).toBeTruthy();
    expect(within(matrix).getByTestId("syncrow-connector")).toBeTruthy();
    expect(within(matrix).getByTestId("syncrow-scene")).toBeTruthy();
    // R4：A 栈已发布、B 栈 scaffold 草稿（未生效）同时可见
    expect(within(matrix).getAllByText("已发布").length).toBeGreaterThan(0);
    expect(within(matrix).getAllByText(/草稿（未生效）/).length).toBeGreaterThan(0);
    // 深链：点击去对应模块管理页核对
    const ontologyRow = within(matrix).getByTestId("syncrow-ontology");
    expect(within(ontologyRow).getByText("去核对 →").closest("a")?.getAttribute("href")).toBe("/admin/modeling");
  });

  it("区4：快速合成（模板驱动，收编合成数据页）→ 报告内嵌 + 连接器核对深链", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    const panel = await screen.findByTestId("db-quick-synth");
    // 行业模板下拉 + 规模 + seed 入口齐全
    expect(within(panel).getByTestId("qs-industry")).toBeTruthy();
    expect(within(panel).getByTestId("qs-scale")).toBeTruthy();
    expect(within(panel).getByTestId("qs-seed")).toBeTruthy();

    await user.click(within(panel).getByTestId("qs-run"));
    // 报告内嵌（行数表）+ 连接器页核对深链
    const report = await within(panel).findByTestId("qs-report", undefined, { timeout: 15000 });
    expect(report).toHaveTextContent("行数表");
    expect(within(report).getByText(/连接器页核对产物/)).toBeTruthy();
  });
});

/**
 * F49b · D 瀑布流逐产物 HITL + diff（unified §5.3 核心 UX）：100 字故事建域 → 区5 模块行可展开为
 * 逐产物卡片，每卡带 before→after diff + DRAFT/已发布；DRAFT 产物surface逐产物 HITL（复用就地审批 R4）。
 */
describe("F49b · 逐产物瀑布流卡片 + diff（D · 100 字故事完整呈现）", () => {
  const STORY100 = "常州动力电池基地三季度产能持续紧张，多条产线利用率越线，叠加 4680 型号认证排期延误，影响星辰汽车与蓝海储能的订单交期与客户信用敞口，请系统推演交期风险、产能缺口与信用冻结，并给出补救处置的优先级。";

  it("100 字故事建域 → 区5 模块行展开 → 逐产物 diff 卡（已发布 A 栈 + DRAFT B 栈含逐产物 HITL）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    // 输入 100 字真实故事脚本 → 建域
    const ta = screen.getByTestId("db-script");
    await user.clear(ta);
    await user.type(ta, STORY100);
    await user.click(screen.getByTestId("sbr-run"));

    const matrix = await within(timeline).findByTestId("sbr-syncmatrix");

    // 展开「本体建模」模块 → 逐产物卡片 + diff（已发布 A 栈：Order/Base CREATED）
    await user.click(within(matrix).getByTestId("syncrow-toggle-ontology"));
    const ontoDetail = await within(matrix).findByTestId("syncrow-detail-ontology");
    expect(within(ontoDetail).getByTestId("artifact-objectType-Order")).toBeTruthy();
    expect(within(ontoDetail).getByTestId("artifact-objectType-Base")).toBeTruthy();
    // diff：CREATED → before"（无）" + after"新建"
    const orderDiff = within(ontoDetail).getByTestId("artifact-diff-objectType-Order");
    expect(orderDiff).toHaveTextContent("（无）");
    expect(orderDiff).toHaveTextContent("新建 objectType:Order");
    // A 栈已发布，不带 DRAFT HITL 提示
    expect(within(ontoDetail).queryByText(/逐产物 HITL/)).toBeNull();

    // 展开「场景」模块（B 栈 scaffold DRAFT）→ 逐产物卡 + DRAFT HITL（复用就地审批）
    await user.click(within(matrix).getByTestId("syncrow-toggle-scene"));
    const sceneDetail = await within(matrix).findByTestId("syncrow-detail-scene");
    expect(within(sceneDetail).getByTestId("artifact-scene-risk_scene")).toBeTruthy();
    expect(within(sceneDetail).getByText(/逐产物 HITL/)).toBeTruthy(); // DRAFT → 待就地审批
  });
});
