import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

describe("F10 · 建模工作台", () => {
  it("PATCH 乐观更新与失败回滚；发布校验错误定位到卡片", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/modeling");

    // 画布渲染：MAP_TO_EXISTING 徽章 + 主键星标
    await screen.findByTestId("type-card-Order");
    expect(screen.getByTestId("map-existing-badge")).toHaveTextContent("复用");
    expect(within(screen.getByTestId("prop-Order-so")).getByTitle("主键")).toBeInTheDocument();

    // 失败回滚：改名为 FAIL → 422 → 卡片标题恢复原 typeKey
    await user.type(screen.getByLabelText("新 typeKey"), "FAIL");
    await user.click(screen.getByTestId("op-rename"));
    // 失败 toast
    await screen.findByText("操作失败，已回滚");
    // 回滚后 Plant 卡仍在（typeKey 默认选第一个 Order；确保 Order 卡仍存在）
    await waitFor(() => expect(screen.getByTestId("type-card-Order")).toBeInTheDocument());

    // 乐观更新成功路径：加属性立即出现在卡片上
    await user.type(screen.getByLabelText("新属性 propKey"), "priority");
    await user.type(screen.getByLabelText("新属性 sourceField"), "prio");
    await user.click(screen.getByTestId("op-add-prop"));
    await waitFor(() => expect(screen.getByTestId("prop-Order-priority")).toBeInTheDocument());

    // 发布校验：Plant 缺主键 → 错误内联定位到 Plant 卡
    // （本例只验类型校验错误：关掉默认 HARD 的字段全建模门，避免叠加未建模字段错误）
    await user.click(screen.getByTestId("require-full-coverage"));
    await user.click(screen.getByTestId("publish-draft"));
    const err = await screen.findByTestId("publish-error-Plant");
    expect(err).toHaveTextContent("缺少主键");
    const plantCard = screen.getByTestId("type-card-Plant");
    expect(within(plantCard).getByTestId("publish-error-Plant")).toBeInTheDocument();
  });

  it("确定性建模（#7 字段全建模工作台）：选数据集→全字段建模 100% 覆盖→字段全建模门发布", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/modeling");
    await screen.findByTestId("type-card-Order");

    // 新建草案 → 确定性建模（无 LLM）
    await user.click(screen.getByTestId("modeling-new-draft"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("checkbox")[0]!); // 选一个原始数据集
    await user.click(within(dialog).getByTestId("modeling-derive-run"));

    // 确定性映射 → 每个导入字段都建模（100% 覆盖徽章）
    const badge = await screen.findByTestId("modeling-coverage-badge");
    await waitFor(() => expect(badge).toHaveTextContent("100%"));
    expect(badge).toHaveTextContent("字段全建模");

    // 字段全建模门默认 HARD（勾选态）：全覆盖 → 直接发布通过（无需手动开门）
    expect(screen.getByTestId("require-full-coverage")).toBeChecked();
    await user.click(screen.getByTestId("publish-draft"));
    await screen.findByText(/发布成功/);
  });

  it("未建模数据集可点击 → 触发 A3 半自动建模 flow（点击建模 → 草案 → 发布 端到端）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/modeling");
    await screen.findByTestId("type-card-Order"); // 应用与左栏数据源面板均已加载

    // 左栏"未建模"数据集的徽章是**可点击按钮**（解决"这么多未建模的、无法点击"）。
    await screen.findByTestId("data-source-panel");
    const modelBtns = await screen.findAllByRole("button", { name: /未建模/ });
    expect(modelBtns.length).toBeGreaterThan(0);

    // 点击"未建模"数据集 → 打开建模弹窗并预选该数据集（≥1 个 checkbox 勾选）。
    await user.click(modelBtns[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked).length,
      ).toBeGreaterThan(0),
    );

    // 确定性建模 → 全字段覆盖 → 一键发布为本体（点击 → 建模 → 发布 端到端接缝）。
    await user.click(within(dialog).getByTestId("modeling-derive-run"));
    const badge = await screen.findByTestId("modeling-coverage-badge");
    await waitFor(() => expect(badge).toHaveTextContent("100%"));
    await user.click(screen.getByTestId("publish-draft"));
    await screen.findByText(/发布成功/);
  });

  /**
   * WO-UNIT-BARE-NUMBERS：无活动草案（发布完的**稳态**，真实用户日常所见）→「已发布本体」表。
   * 病灶：「属性 12 / 派生 3」两列格内是**计数**，列头却只有名词 → 12 易被读成属性值本身。
   * 计数字段在契约里是纯 length（无 unit 可消费），故列头就近带「数(个)」。退回裸列头即红。
   */
  it("已发布本体（无草案稳态）：属性/派生列头带计数单位（不裸奔）", async () => {
    // 清空草案 → ModelingPage 走 PublishedOntologyView 分支。
    server.use(http.get("*/a/v1/modeling/drafts", () => HttpResponse.json([])));
    loginAs("planner");
    renderApp("/admin/modeling");

    const pub = await screen.findByTestId("published-ontology");
    expect(within(pub).getByText("属性数(个)")).toBeInTheDocument();
    expect(within(pub).getByText("派生数(个)")).toBeInTheDocument();
    // 顶部计数本来就带「个对象类型」（不回退）。
    expect(screen.getByTestId("published-ontology-count").textContent ?? "").toMatch(/\d+ 个对象类型/);
  });
});
