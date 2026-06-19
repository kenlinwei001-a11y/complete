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
