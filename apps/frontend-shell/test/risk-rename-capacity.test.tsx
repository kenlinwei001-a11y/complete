import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { workspaceForAccount, ACCOUNTS } from "@/mocks/fixtures";

/**
 * SANDBOX-RENAME-BASECARDS ①（名实相符·闭用户两次追问「预判推演看板为何没有调整为产能推演」）牙齿：
 *  /v/risk 视图标题 + nav 标签 改名『产能推演』（驾驶舱磁贴早已叫产能推演·点进 /v/risk 却仍显旧名『预判推演看板』）。
 *  nav 标签由 ViewDef.title 派生（fixtures workspaceForAccount navigation 映射 + 真后端同源）→ 改 title 即同步页标题 + nav 标签。
 * 齿：把 ViewDef.risk.title 改回『预判推演看板』→ 下两断言红。
 */
describe("SANDBOX-RENAME-BASECARDS ① · /v/risk 改名『产能推演』（名实相符·牙齿）", () => {
  it("ViewDef.risk.title == 『产能推演』（nav 标签/页标题真值源·非旧名『预判推演看板』）", () => {
    const account = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(account, {}, 1);
    const riskView = (ws.views ?? []).find((v) => v.key === "risk");
    expect(riskView?.title).toBe("产能推演");
    const riskNav = (ws.navigation ?? []).find((n) => n.key === "risk");
    expect(riskNav?.label).toBe("产能推演");
    // 全 nav 无旧名残留（名实相符·彻底）。
    expect((ws.navigation ?? []).some((n) => n.label === "预判推演看板")).toBe(false);
  });

  it("左导渲染：/v/risk nav 项显『产能推演』（非旧名·真渲染）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    // risk 项在「推演」组内，标签为改名后的『产能推演』。
    const tuiyan = within(nav).getByTestId("nav-group-推演");
    expect(within(tuiyan).getByText("产能推演")).toBeInTheDocument();
    // 旧名『预判推演看板』不再出现于左导。
    expect(within(nav).queryByText("预判推演看板")).not.toBeInTheDocument();
  });
});
