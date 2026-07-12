import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
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
    // NAV-DROP-LEDGER-MAP（用户亲定 2026-07-06）：order（订单台账）早移入「数据」组（上方已断言在该组内）；
    // 「台账与地图」组本身（仅剩基地地理视图·低价值）已整组退役删除——组头不再存在。
    expect(within(nav).queryByTestId("nav-group-台账与地图")).not.toBeInTheDocument();
  });

  it("WO-NAV-SANDBOX：sim.sandbox 关 → 推演组无沙盘/初始化项（R3 门控，默认态）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    // mock 默认无 sim.sandbox entitlement（暗发·默认关）→ 沙盘项不出现
    expect(within(nav).queryByTestId("nav-sim-sandbox")).not.toBeInTheDocument();
    expect(within(nav).queryByTestId("nav-sim-init")).not.toBeInTheDocument();
  });

  it("WO-CAPSIM-IA-UNIFY（M1）：sim.sandbox **开** 也不再有「推演沙盘/初始化」左导航项——沙盘退役为产能推演看板下钻态（§5·唯一 surface·非独立导航）", async () => {
    // 经 server.use 给 workspace.features 注入 sim.sandbox（entitlement 开通）——证退役与 entitlement 无关（IA 收敛）。
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
    // 推演组仍在（project-sim/risk/order-chain）但**无沙盘/初始化叶项**（left-nav 无「推演沙盘」·green→red 验收①）。
    expect(within(nav).queryByTestId("nav-sim-sandbox")).not.toBeInTheDocument();
    expect(within(nav).queryByTestId("nav-sim-init")).not.toBeInTheDocument();
    expect(within(tuiyan).queryByText("推演沙盘")).not.toBeInTheDocument();
    expect(within(tuiyan).queryByText("推演初始化向导")).not.toBeInTheDocument();
    // 唯一 surface = 产能推演（risk）仍在推演组内
    expect(within(tuiyan).getByText("产能推演")).toBeInTheDocument();
  });
});
