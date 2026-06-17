import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F43 · 七管理页整簇（admin-console-closure §6，后端已就绪补前端）：
 * 闭环验证(VLE) / 隔离区 / 通知中心 / 域管理 —— 修审计暴露的"后端有·前端缺"。
 */
describe("F43 · 管理页整簇", () => {
  it("VLE 运行历史：列出运行 + 工程验证度", async () => {
    loginAs("planner");
    renderApp("/admin/validation");
    await screen.findByTestId("validation-page");
    const run = await screen.findByTestId("vle-run-vrun_1");
    expect(run).toHaveTextContent("SMOKE");
    expect(run).toHaveTextContent("通过");
    expect(run).toHaveTextContent("94%"); // 工程验证度
  });

  it("隔离区：只列 PENDING，重入按钮可点", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/quarantine");
    await screen.findByTestId("quarantine-page");
    expect(await screen.findByTestId("q-row-qr_1")).toHaveTextContent("结构不符");
    expect(screen.queryByTestId("q-row-qr_2")).toBeNull(); // DISCARDED 不列
    await user.click(screen.getByTestId("q-reprocess-qr_1"));
    await screen.findByText("已重入正门");
  });

  it("通知中心：未读角标 + 跳转引用对象", async () => {
    loginAs("planner");
    renderApp("/admin/notifications");
    await screen.findByTestId("notifications-page");
    expect(await screen.findByTestId("notif-unread")).toHaveTextContent("1 未读");
    const n1 = await screen.findByTestId("notif-ntf_1");
    expect(within(n1).getByTestId("notif-goto-ntf_1")).toHaveAttribute("href", "/admin/actions");
  });

  it("域管理：列出域 + 新建域", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/domains");
    await screen.findByTestId("domains-page");
    expect(await screen.findByTestId("domain-factory")).toHaveTextContent("工厂");
    await user.type(screen.getByTestId("domain-key"), "supplier");
    await user.click(screen.getByTestId("domain-create"));
    await screen.findByText("域已创建");
  });
});
