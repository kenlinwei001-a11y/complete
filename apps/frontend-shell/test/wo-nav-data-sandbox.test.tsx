import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { accountFromAuth } from "@/mocks/db";

/**
 * WO-NAV-DATA + WO-NAV-SANDBOX：导航 IA 重组验证。
 * - 「数据接入」→「数据」组：含 连接器/外部数据/规则文档/合成数据/数据构建发动机/订单台账/隔离区。
 * - sim-sandbox/sim-init 并入「推演」组，仍受 sim.sandbox entitlement 门控（R3 不破）。
 */
describe("WO-NAV-DATA / WO-NAV-SANDBOX · 导航 IA 重组", () => {
  it("WO-NAV-DATA：「数据」组含连接器/外部数据/数据构建发动机/订单台账/隔离区（admin 角色）", async () => {
    loginAs("planner"); // 含 admin 角色 → 见全部管理页
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const dataGroup = within(nav).getByTestId("nav-group-数据");
    // 组内含移入/原有各叶项（管理页 label 见 zh.nav.*）
    for (const label of ["连接器与上传", "外部数据", "规则文档审核", "合成数据", "数据构建发动机", "订单台账", "隔离区"]) {
      expect(within(dataGroup).getByText(label)).toBeInTheDocument();
    }
    // 旧组名「数据接入」不再存在
    expect(within(nav).queryByTestId("nav-group-数据接入")).not.toBeInTheDocument();
    // order（订单台账）已从「台账与地图」移出 → 该组只剩 geo-map（基地地理视图）
    const ledgerInLandmap = within(within(nav).getByTestId("nav-group-台账与地图")).queryByText("订单台账");
    expect(ledgerInLandmap).not.toBeInTheDocument();
  });

  it("WO-NAV-SANDBOX：sim.sandbox 关 → 推演组无沙盘/初始化项（R3 门控，默认态）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    // mock 默认无 sim.sandbox entitlement → 沙盘项不出现
    expect(within(nav).queryByTestId("nav-sim-sandbox")).not.toBeInTheDocument();
    expect(within(nav).queryByTestId("nav-sim-init")).not.toBeInTheDocument();
  });

  it("WO-NAV-SANDBOX：sim.sandbox 开 → 沙盘/初始化项出现在「推演」组内（并入·非游离）", async () => {
    // 经 server.use 给 workspace.features 注入 sim.sandbox（entitlement 开通）
    server.use(
      http.get("*/a/v1/me/workspace", ({ request }) => {
        const account = accountFromAuth(request.headers.get("authorization")) ?? ACCOUNTS[0]!;
        const ws = workspaceForAccount(account, {}, 1);
        return HttpResponse.json({ ...ws, features: [...(ws.features ?? []), "sim.sandbox"] });
      }),
    );
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const tuiyan = await within(nav).findByTestId("nav-group-推演");
    // 沙盘项并入「推演」组内（非游离于 nav 末尾）
    await waitFor(() => expect(within(tuiyan).getByTestId("nav-sim-sandbox")).toBeInTheDocument());
    expect(within(tuiyan).getByTestId("nav-sim-init")).toBeInTheDocument();
    expect(within(tuiyan).getByText("推演沙盘")).toBeInTheDocument();
    expect(within(tuiyan).getByText("推演初始化向导")).toBeInTheDocument();
  });
});
