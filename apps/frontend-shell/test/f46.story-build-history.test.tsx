import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F46 · g8 故事驱动建域 P1：数据构建发动机页「历史推演记录」时间线。
 * 提交故事脚本 → 建域 → StoryBuildRun 写入时间线 → 展开见闭包/全栈计划/产出源数据。
 */
describe("F46 · 历史推演记录时间线（StoryBuildRun）", () => {
  it("建域并记入历史 → 时间线出现记录 → 展开见闭包+产出连接器/数据集（可下钻连接器页）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    // 历史推演记录面板存在
    const timeline = await screen.findByTestId("sbr-timeline");

    // 点「建域并记入历史」→ 提交默认故事脚本
    await user.click(screen.getByTestId("sbr-run"));

    // 时间线出现一条 SUCCEEDED 记录 + 展开见产出源数据下钻
    expect(await within(timeline).findByText(/产出源数据/)).toBeTruthy();
    expect(within(timeline).getByText(/连接器页下钻/)).toBeTruthy();
    expect(within(timeline).getAllByText("SUCCEEDED").length).toBeGreaterThan(0);
    // 闭包门禁通过呈现（区6 全链闭包可视化：完整 ✓）
    expect(within(timeline).getByText(/完整 ✓/)).toBeTruthy();
    // g8-P3 跨系统 scaffold（B 栈）全链闭合呈现
    expect(within(timeline).getByText(/全链闭合 ✓/)).toBeTruthy();
    // g8-P4 功能缺失自检呈现（干净建域 → 通过）
    expect(within(timeline).getByText(/功能缺失自检：通过/)).toBeTruthy();
  });

  it("g8-P2：倒推建域 → 待补录表单（seed/复用连接器）→ 确认并建域 → 转 SUCCEEDED", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    // 点「倒推建域（先补录）」→ 出现 PENDING_INPUT 记录 + 自描述补录表单
    await user.click(screen.getByTestId("sbr-preview"));
    expect(await within(timeline).findByText("待补录")).toBeTruthy();
    // 表单含 ASK_USER seed 字段 + REUSE_EXISTING 连接器下拉
    const seedField = await within(timeline).findByTestId("sbr-field-seed");
    expect(seedField).toBeTruthy();
    expect(within(timeline).getByTestId("sbr-field-reuseConnectors")).toBeTruthy();

    // 补录 seed → 确认并建域
    await user.clear(seedField);
    await user.type(seedField, "21");
    const confirm = within(timeline).getAllByText("确认并建域")[0]!;
    await user.click(confirm);

    // 转 SUCCEEDED + 闭包通过
    expect(await within(timeline).findByText(/产出源数据/)).toBeTruthy();
    expect(within(timeline).getAllByText("SUCCEEDED").length).toBeGreaterThan(0);
  });

  it("g8-P6：存量回填 → 压测报告（覆盖率）+ 既有推演能力获时间线血缘", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-backfill"));

    // 压测报告呈现（覆盖率）
    const report = await within(timeline).findByTestId("sbr-backfill-report");
    expect(report).toHaveTextContent(/覆盖率 100%/);
    expect(report).toHaveTextContent(/覆盖/);
    // 既有推演能力回填进时间线（≥2 条 SUCCEEDED）
    expect(within(timeline).getAllByText("SUCCEEDED").length).toBeGreaterThanOrEqual(2);
    // g8-P5 推演回填：展开首条见 answer
    const firstItem = within(timeline).getAllByText("SUCCEEDED")[0]!.closest("[data-testid^='sbr-item-']") as HTMLElement;
    await user.click(within(firstItem).getByText(/针对|检查/));
    expect(await within(timeline).findByText(/推演答案（回填）/)).toBeTruthy();
  });

  it("g8-P5：自动生成脚本压测 → 报告（覆盖率）+ 脚本进时间线", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-generate"));
    const report = await within(timeline).findByTestId("sbr-backfill-report");
    expect(report).toHaveTextContent(/覆盖率 100%/);
    expect(within(timeline).getAllByText("SUCCEEDED").length).toBeGreaterThanOrEqual(2);
  });
});
