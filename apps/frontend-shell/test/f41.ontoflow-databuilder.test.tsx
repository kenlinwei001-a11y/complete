import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F41 · OntoFlow 本体建模工作流", () => {
  it("导航入口 + 画布渲染 + 配置面板（存储模式/三页签）+ 准备度 + 生成应用", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 admin 角色
    renderApp("/admin/data-builder");

    // 导航中出现入口（管理台分组）
    const nav = await screen.findByTestId("nav-admin");
    expect(within(nav).getByText("本体建模工作流")).toBeInTheDocument();

    // 画布渲染种子工作流节点（含实体节点）
    await screen.findByTestId("wf-canvas");
    await screen.findByTestId("wf-node-entity-1");
    expect(screen.getByTestId("wf-node-src-1")).toBeInTheDocument();

    // 默认选中实体节点 → 配置面板显示存储模式切换 + 实体三页签
    const panel = await screen.findByTestId("node-config-panel");
    expect(within(panel).getByTestId("storage-mode-toggle")).toBeInTheDocument();
    expect(within(panel).getByTestId("tab-source")).toBeInTheDocument();
    expect(within(panel).getByTestId("tab-process")).toBeInTheDocument();
    expect(within(panel).getByTestId("tab-modeling")).toBeInTheDocument();

    // 数据处理页签：加一条映射
    await user.click(within(panel).getByTestId("tab-process"));
    await user.click(await screen.findByTestId("mapping-add"));
    expect(await screen.findByTestId("mapping-row-0")).toBeInTheDocument();

    // 子图建模页签：六页面（属性/类型/函数/行动/派生/安全）齐备
    await user.click(within(panel).getByTestId("tab-modeling"));
    expect(await screen.findByTestId("facet-properties")).toBeInTheDocument();
    expect(screen.getByTestId("facet-type")).toBeInTheDocument();
    expect(screen.getByTestId("facet-functions")).toBeInTheDocument();
    expect(screen.getByTestId("facet-actions")).toBeInTheDocument();
    expect(screen.getByTestId("facet-derived")).toBeInTheDocument();
    expect(screen.getByTestId("facet-security")).toBeInTheDocument();

    // 准备度 → gauge 显示评分
    await user.click(screen.getByTestId("act-readiness"));
    const gauge = await screen.findByTestId("readiness-gauge");
    const overall = within(gauge).getByTestId("readiness-overall");
    expect(Number(overall.textContent?.replace(/\D/g, ""))).toBeGreaterThan(0);
    expect(within(gauge).getByTestId("readiness-entity-entity-1")).toBeInTheDocument();

    // 提升 STATIC→ONTOLOGY
    await user.click(screen.getByTestId("act-promote"));
    await waitFor(() => expect(screen.getByTestId("storage-mode-ONTOLOGY")).toBeInTheDocument());

    // 校验通过（种子实体有主键）
    await user.click(screen.getByTestId("act-validate"));
    await screen.findByTestId("validate-result");

    // 生成应用 → scaffold 结果渲染
    await user.click(screen.getByTestId("act-scaffold"));
    const scaffold = await screen.findByTestId("scaffold-result");
    expect(within(scaffold).getByTestId("scaffold-views")).toHaveTextContent("台账");
    expect(within(scaffold).getByTestId("scaffold-agents")).toHaveTextContent("Agent");
  });

  it("创建新工作流（图谱先行）并出现在列表", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");

    await screen.findByTestId("wf-canvas");
    const selectBefore = screen.getByTestId<HTMLSelectElement>("wf-select");
    const countBefore = selectBefore.options.length;

    await user.click(screen.getByTestId("wf-new-graph"));

    // 新建后列表新增一项，画布渲染图谱先行骨架（实体 + 关系节点）
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("wf-select").options.length).toBe(countBefore + 1));
    await screen.findByTestId("wf-node-link-1");
    expect(screen.getByTestId("wf-node-entity-1")).toBeInTheDocument();

    // 发布该工作流 → 产出类型/链路/切片
    await user.click(screen.getByTestId("act-publish"));
    const publish = await screen.findByTestId("publish-result");
    expect(publish).toHaveTextContent("sliceKey");
  });
});
