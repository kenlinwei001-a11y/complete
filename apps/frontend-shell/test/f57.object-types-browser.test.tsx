import { describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * A4 · 对象/类型浏览器（前端）：按 14 域分组列已发布类型 + 物化计数 + 筛选 + 实例下钻。
 * 闭合用户实测"找不到已发布对象类型在哪看"。
 */
describe("A4 · 对象/类型浏览器（域分组 + 物化计数 + 筛选 + 实例下钻）", () => {
  it("列类型按域分组 + 物化数 + 域筛选 + 仅有物化 + 看实例下钻", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/object-types");
    const page = await screen.findByTestId("object-types-page");

    // 域分组（factory/product/external 各成组）+ 物化计数
    expect(await within(page).findByTestId("ot-domain-factory")).toBeTruthy();
    expect(within(page).getByTestId("ot-domain-product")).toBeTruthy();
    expect(within(page).getByTestId("ot-count-Base").textContent).toBe("3");
    expect(within(page).getByTestId("ot-count-Order").textContent).toBe("20");
    // WO-UNIT-MEANING：格内计数由列头带单位（「物化对象数(个)」/「属性数(源/派生·个)」），域徽章点明"个类型"。
    const factoryGroup = within(page).getByTestId("ot-domain-factory");
    expect(within(factoryGroup).getByText("物化对象数(个)")).toBeInTheDocument();
    expect(within(factoryGroup).getByText("属性数(源/派生·个)")).toBeInTheDocument();
    expect(within(page).getByTestId("ot-domain-count-factory").textContent ?? "").toMatch(/^\d+ 个类型$/);

    // 域筛选：选 product → 仅 product 组，factory 组消失
    await user.selectOptions(within(page).getByTestId("ot-domain-filter"), "product");
    await waitFor(() => expect(within(page).queryByTestId("ot-domain-factory")).toBeNull());
    expect(within(page).getByTestId("ot-domain-product")).toBeTruthy();

    // 清域筛选 → 仅有物化：ExternalSignal(count 0) 消失
    await user.selectOptions(within(page).getByTestId("ot-domain-filter"), "");
    expect(await within(page).findByTestId("ot-row-ExternalSignal")).toBeTruthy();
    await user.click(within(page).getByTestId("ot-only-mat"));
    await waitFor(() => expect(within(page).queryByTestId("ot-row-ExternalSignal")).toBeNull());
    expect(within(page).getByTestId("ot-row-Base")).toBeTruthy(); // 有物化的留下

    // 看实例下钻：点 Base「看实例」→ 实例面板 + Object360 链接
    await user.click(within(page).getByTestId("ot-instances-Base"));
    const panel = await within(page).findByTestId("ot-instance-panel");
    expect(panel).toBeTruthy();
    // WO-UNIT-MEANING：面板徽章此前是裸数（「3」看不出是实例数还是页码）→「共 N 个实例」。
    expect(within(panel).getByTestId("ot-instance-total").textContent ?? "").toMatch(/^共 \d+ 个实例$/);
    const links = within(panel).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toMatch(/^\/o\/Base\//); // 下钻到 Object360
  });

  /**
   * WO-OT-INSTANCE-REACH · 接缝驱动：「看实例」在**用户视角**真的有反应。
   *
   * 仓主实测报「点『看实例』没有反应」。真后端取证（SEED_DEMO·:4502）：94 个类型 / 15 个域，
   * 而实例面板修前挂在**全部 15 个域面板之后**（页面最底部）—— 点第 1 个域第 1 行时，
   * 被点行与面板之间隔着 93 个类型行 + 14 个域面板标题，面板落在视口外 = 「没反应」。
   *
   * ⚠️ 上面那个老用例**修前修后同色**：它只断言「点了之后面板出现」，从不问「出现在哪」。
   * 故本用例的断言一律咬**位置**（相对 DOM 顺序），这才是用户能看见的那个事实。
   */
  it("看实例：详情紧跟被点那一行（不再挂在整页最底部）+ 再点收起", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/object-types");
    const page = await screen.findByTestId("object-types-page");

    // product 域内有两行：Model / Order —— 点前一行，详情必须落在这两行**之间**。
    const rowModel = await within(page).findByTestId("ot-row-Model");
    await user.click(within(page).getByTestId("ot-instances-Model"));
    const panel = await within(page).findByTestId("ot-instance-panel");

    // ① 最紧的位置判据：详情行 = 被点行的**直接下一个兄弟**。
    expect(rowModel.nextElementSibling?.getAttribute("data-testid")).toBe("ot-instance-detail-row-Model");

    // ② 详情必须夹在「被点行」与「下一行 Order」之间。修前详情在整页最底部 ⇒ 此断言必红。
    const rowOrder = within(page).getByTestId("ot-row-Order");
    expect(rowModel.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowOrder.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    // ③ 详情必须与被点行在**同一张表**内。修前它是页面根 div 的子节点，closest("table") 为 null。
    expect(panel.closest("table")).not.toBeNull();
    expect(panel.closest("table")).toBe(rowModel.closest("table"));

    // ④ 展开行 colSpan 取自列定义**单一来源**（OT_COLUMNS），不是写死的数 —— 加列不错位。
    //    ⚠️ 列数必须只数**类型表自己**的表头：实例面板里还有一张嵌套表，
    //    用 getAllByRole("columnheader") 会把它那 3 个 th 一并数进来（5+3=8，本用例初版即被此坑咬红）。
    //    故用 `:scope >` 限定直接子代 —— 这才真的在度量「类型表有几列」。
    const typeTable = rowModel.closest("table")!;
    const headerCount = typeTable.querySelectorAll(":scope > thead > tr > th").length;
    expect(headerCount).toBeGreaterThan(1); // 金丝雀：选择器若失效会数出 0，那是工具坏了不是列数对了
    const detailCell = within(page).getByTestId("ot-instance-detail-row-Model").querySelector("td");
    expect(detailCell?.getAttribute("colspan")).toBe(String(headerCount));

    // ⑤ toggle：再点同一行收起。
    await user.click(within(page).getByTestId("ot-instances-Model"));
    await waitFor(() => expect(within(page).queryByTestId("ot-instance-detail-row-Model")).toBeNull());
  });

  /**
   * WO-OT-INSTANCE-REACH · 禁用态必须**说人话**，且这句话取自接口（R14 零业务常数）。
   * 真后端实测 94 类型中 8 个 count=0（ShiftPlan/WIPMove/OperatorAttendance…），
   * 修前这些按钮 disabled 且**一个字都不说** —— 用户看到「能点的样子」却点不动。
   */
  it("禁用态：count=0 的类型给出取自接口的解释，count>0 的不给", async () => {
    loginAs("planner");
    renderApp("/admin/object-types");
    const page = await screen.findByTestId("object-types-page");

    // ExternalSignal 在 mock 与真后端口径一致地 count=0 → 按钮禁用 + 必须有解释。
    const why = await within(page).findByTestId("ot-instances-why-ExternalSignal");
    expect(within(page).getByTestId("ot-instances-ExternalSignal")).toBeDisabled();
    // 解释里的**计数**来自 /a/v1/ontology/object-types/stats（不是写死的业务常数）。
    expect(why.textContent ?? "").toContain("0");
    // 解释里的**类型中文名**同样来自该接口 —— 写死的通用文案不可能逐行给出各自的 displayName。
    expect(why.getAttribute("title") ?? "").toContain("外部信号");

    // 数据驱动的反证：count>0 的行**没有**这句解释，且按钮可点。
    // 「有无解释」随接口 count 变 ⇒ 这句话确实来自数据，而非贴在页面上的死文案。
    expect(within(page).queryByTestId("ot-instances-why-Base")).toBeNull();
    expect(within(page).getByTestId("ot-instances-Base")).not.toBeDisabled();
  });
});
