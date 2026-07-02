import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-INTAKE-VISIBILITY（G-VIS-1）前端消费：SchemaReconcile 页（C3）——objectify 未命中列的 HITL 队列，
 * 逐列 USE/RENAME/NEW/MERGE/DISCARD 确认 → resolve → 重跑物化。注：C1/C4/C5 真浏览器由 FDE 手跑把关。
 */
describe("WO-INTAKE-VISIBILITY · SchemaReconcile 前端消费（C3）", () => {
  it("C3 · 页面列出待确认列 + 每列动作/目标控件 + resolve 提交", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // 含 admin 角色
    renderApp("/admin/schema-reconcile?connId=conn_proto_mock");

    await screen.findByTestId("schema-reconcile-page");
    const table = await screen.findByTestId("reconcile-table");
    // 后端候选列落表（carbon_ratio 带样本值 + 建议 USE）
    const row = await screen.findByTestId("reconcile-row-rcc_1");
    expect(within(row).getByText("carbon_ratio")).toBeTruthy();
    expect(within(table).getByTestId("reconcile-action-rcc_1")).toBeTruthy();
    expect(within(table).getByTestId("reconcile-target-rcc_1")).toBeTruthy();
    // resolve：点确认 → POST resolve 2xx（不抛）
    await user.click(within(table).getByTestId("reconcile-resolve-rcc_1"));
    // 重跑物化按钮存在（有 connId）
    expect(screen.getByTestId("reconcile-rematerialize")).toBeTruthy();
  });

  it("C3 · 空态诚实：无待确认列 → 引导（上传+objectify 后出现），不伪造行", async () => {
    server.use(http.get("*/a/v1/databuilder/reconcile-candidates", () => HttpResponse.json({ items: [] })));
    loginAs("planner");
    renderApp("/admin/schema-reconcile");
    expect(await screen.findByTestId("reconcile-empty")).toBeTruthy();
    expect(screen.queryByTestId("reconcile-table")).toBeNull();
  });
});
