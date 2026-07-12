import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * F41 · OntoFlow 本体建模工作流（WO-MERGE-02 移植）。
 * 「数据构建」页单一入口（adminRegistry `data-builder`），两页签：数据构建发动机（默认）/ 本体建模工作流（画布）。
 * 本套先切到「本体建模工作流」页签，再验证画布/配置/准备度/发布/推演/门控。
 */
async function openStudio(user: ReturnType<typeof userEvent.setup>) {
  renderApp("/admin/data-builder");
  await user.click(await screen.findByTestId("db-tab-studio"));
  await screen.findByTestId("wf-canvas");
}

describe("F41 · OntoFlow 本体建模工作流", () => {
  it("单一入口页签 + 画布渲染 + 配置面板（存储模式/三页签）+ 准备度 + 生成应用", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 admin 角色

    // 「数据构建」为单一 adminRegistry 入口（导航标签＝数据构建发动机），页内两页签合并（非双页并列，C4）。
    renderApp("/admin/data-builder");
    const nav = await screen.findByTestId("left-nav");
    expect(within(nav).getByText("数据构建发动机")).toBeInTheDocument();
    expect(await screen.findByTestId("db-tab-engine")).toBeInTheDocument();
    await user.click(await screen.findByTestId("db-tab-studio"));

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

    // 生成应用 → scaffold 结果渲染 + 真落库回执（persisted 视图键）
    await user.click(screen.getByTestId("act-scaffold"));
    const scaffold = await screen.findByTestId("scaffold-result");
    expect(within(scaffold).getByTestId("scaffold-views")).toHaveTextContent("台账");
    expect(within(scaffold).getByTestId("scaffold-agents")).toHaveTextContent("Agent");
    expect(within(scaffold).getByTestId("scaffold-persisted")).toHaveTextContent("viewConfig");
  });

  it("创建新工作流（图谱先行）并发布 → 校验真类型/链路值（WO-MERGE-02 B4，非仅 sliceKey）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    await openStudio(user);

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
    // 图谱先行骨架实体 typeKey = Supplier / Order，链路 linkKey = SUPPLIES（后端 string[]，逐值校验）
    const types = within(publish).getByTestId("publish-types");
    expect(types).toHaveTextContent("Supplier");
    expect(types).toHaveTextContent("Order");
    expect(within(publish).getByTestId("publish-links")).toHaveTextContent("SUPPLIES");
  });

  it("WO-MERGE-02 B3 通用推演入口：施加 Δ → 受影响对象 before → after 前后对比", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    await openStudio(user);

    // 新建图谱先行工作流（含 Supplier/Order 实体）→ 打开推演表单
    await user.click(screen.getByTestId("wf-new-graph"));
    await screen.findByTestId("wf-node-link-1");

    await user.click(screen.getByTestId("act-inference"));
    const form = await screen.findByTestId("inference-form");

    // 选实体 Order + 属性 qty + Δ=10 → 提交
    await user.selectOptions(within(form).getByTestId("inference-typekey"), "Order");
    await user.clear(within(form).getByTestId("inference-prop"));
    await user.type(within(form).getByTestId("inference-prop"), "qty");
    await user.clear(within(form).getByTestId("inference-delta"));
    await user.type(within(form).getByTestId("inference-delta"), "10");
    await user.click(within(form).getByTestId("inference-submit"));

    // 前后对比面板：direct 行 100 → 110，derived 行 via=derived:total → 220
    const panel = await screen.findByTestId("inference-panel");
    const row0 = within(panel).getByTestId("inference-row-0");
    expect(row0).toHaveTextContent("Order#Order-0001.qty");
    expect(within(row0).getByTestId("inference-before-0")).toHaveTextContent("100");
    expect(within(row0).getByTestId("inference-after-0")).toHaveTextContent("110");
    expect(within(row0).getByTestId("inference-via-0")).toHaveTextContent("direct");

    const row1 = within(panel).getByTestId("inference-row-1");
    expect(within(row1).getByTestId("inference-via-1")).toHaveTextContent("derived:total");
    expect(within(row1).getByTestId("inference-after-1")).toHaveTextContent("220");
  });

  it("WO-SWEEP-02 所选工作流跨刷新/离开再回持久化：选第 2 条 → 重挂载 → 仍第 2 条", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    await openStudio(user);

    // 造出第 2 条工作流（种子 owf-seed + 新建图谱先行），使下拉有 ≥2 项
    await user.click(screen.getByTestId("wf-new-graph"));
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("wf-select").options.length).toBe(2));

    // 显式选中下拉「第 2 项」（非默认 auto-select 的首项）
    const select = screen.getByTestId<HTMLSelectElement>("wf-select");
    const secondId = select.options[1]!.value;
    await user.selectOptions(select, secondId);
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("wf-select").value).toBe(secondId));

    // 持久化机制：localStorage 记住所选 id
    expect(localStorage.getItem("ontoflow.selectedWorkflow")).toBe(secondId);

    // 模拟「刷新 / 离开再回」——卸载后重新挂载整个应用
    cleanup();
    renderApp("/admin/data-builder");
    await user.click(await screen.findByTestId("db-tab-studio"));
    await screen.findByTestId("wf-canvas");

    // 恢复态：仍是第 2 条（若无持久化则会退回 auto-select 首项 → 不等于 secondId）
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("wf-select").value).toBe(secondId));
  });

  it("WO-MERGE-02 B1 feature data-builder 关闭 → 导航入口消失 + 页面诚实 404", async () => {
    db.tenantOverrides["data-builder"] = false;
    loginAs("planner");
    renderApp("/admin/data-builder");

    // 页面降级为 404（FEATURE_NOT_FOUND 语义），不白屏/不崩
    await screen.findByTestId("page-404");
    // 左导航不含「数据构建发动机」入口（单一入口整体随 feature 关而隐）
    const nav = await screen.findByTestId("left-nav");
    expect(within(nav).queryByText("数据构建发动机")).not.toBeInTheDocument();
  });
});
