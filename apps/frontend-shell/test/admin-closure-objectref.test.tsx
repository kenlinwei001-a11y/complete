import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 轨 G · C10 objectRef refType + 试分类（CatalogPage · AC4/AC8 旁证）。
 * ① objectRef 槽位出"目标对象类型"下拉（引用本体对象类型）。
 * ② 试分类：输入示例问句 → 调 classify-preview → 显 top 命中 / 域外。
 * 闭 AC8 最后死路（意图 objectRef 槽未指向对象类型则无法校验/搜索）。
 */
async function openIntent(key: string) {
  loginAs("planner");
  renderApp("/admin/catalog");
  await waitFor(() => expect(screen.getByTestId(`intent-${key}`)).toBeTruthy());
  await userEvent.click(screen.getByTestId(`intent-${key}`));
  await screen.findByTestId("intent-editor");
}

describe("C10 · objectRef refType + 试分类", () => {
  it("objectRef 槽位渲染'目标对象类型'下拉（引用本体）", async () => {
    await openIntent("adopt_mitigation"); // 含 base(objectRef) + solutionName(enum)
    // 槽位0=base(objectRef) → 有 reftype 下拉；槽位1=enum → 无
    const refSelect = await screen.findByTestId("slot-reftype-0");
    expect(refSelect).toBeTruthy();
    // 候选含本体对象类型（demo 本体 Order/Base/Model…）
    await waitFor(() => expect((refSelect as HTMLSelectElement).options.length).toBeGreaterThan(1));
    expect(screen.queryByTestId("slot-reftype-1")).toBeNull();
  });

  it("试分类：示例问句 → top 命中行", async () => {
    const user = userEvent.setup();
    await openIntent("capacity_feasibility");
    await user.type(screen.getByTestId("intent-classify-query"), "4680 加 20% 六周能不能接");
    await user.click(screen.getByTestId("intent-classify-test"));
    const result = await screen.findByTestId("intent-classify-result");
    expect(result).toBeTruthy();
    // 命中表含若干意图行（top 标记存在）
    await waitFor(() => expect(within(result).getByTestId("intent-classify-top")).toBeTruthy());
  });

  it("试分类域外问句 → 未命中目录提示", async () => {
    const user = userEvent.setup();
    await openIntent("capacity_feasibility");
    await user.type(screen.getByTestId("intent-classify-query"), "zzzz qqqq xxxx");
    await user.click(screen.getByTestId("intent-classify-test"));
    await waitFor(() => expect(screen.getByTestId("intent-classify-ooc")).toBeTruthy());
  });
});
