import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 增量3 · V11 · VLE 段级红绿矩阵 + 失败 diff 下钻（PRD-addendum-validation-loop §4-3）。
 * 列表 → 点行展开 → 七段×断言矩阵（段/point/oracle/pass/expected/actual/diff）+ 红绿行 +
 * ⑤参照双算失败项 diff 下钻 + 同 seed 复跑入口。
 */
describe("V11 · VLE 段级红绿矩阵下钻", () => {
  it("列表点行 → 展开段级矩阵，失败 ⑤参照双算行显 diff + 同 seed 复跑入口", async () => {
    const user = userEvent.setup();
    loginAs("padmin");
    renderApp("/admin/validation");

    // 列表渲染
    const row = await screen.findByTestId("vle-run-vrun_1");
    // 点行展开详情
    await user.click(row);
    const detail = await screen.findByTestId("vle-detail-vrun_1");

    // 七段矩阵：含 ⑤求解器执行段，且整体红（含失败断言）
    expect(within(detail).getByTestId("vle-seg-⑤求解器执行")).toBeTruthy();
    // 失败断言行存在（参照双算红）
    const failRows = within(detail).getAllByTestId("vle-assert-fail");
    expect(failRows.length).toBeGreaterThanOrEqual(1);
    // diff 下钻：精确指出期望/实际/Δ + 首个偏离对象
    expect(detail.textContent).toContain("Δ2.9585");
    expect(detail.textContent).toContain("reference");
    // 同 seed 复跑入口
    expect(within(detail).getByTestId("vle-rerun-vrun_1")).toBeTruthy();
  });
});
