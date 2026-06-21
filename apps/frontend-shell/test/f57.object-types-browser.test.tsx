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
    const links = within(panel).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toMatch(/^\/o\/Base\//); // 下钻到 Object360
  });
});
