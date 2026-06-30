import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-BUILDER-ROLE · 数据构建发动机+合成数据职责收敛（改造非重写）。
 *
 * 故事（用户视角·非内置 demo）：运营负责人打开「数据构建发动机」，他要分清两件事——
 * (1) 冷启动建域（onboarding）：把故事/原型/模板变成一套本体域（保留全部能力）；
 * (2) 运营态数据流：各源持续增量同步（走 WO-PIPE-INCR），他想看哪些源是真实接入、哪些是合成 bootstrap、
 *     每源最后同步多久前、是否走增量(CDC)、有没有隔离行。
 * 页面据此呈现两态可切换；运营态各源诚实标 synthetic vs real-sourced + last sync/新鲜度真值。
 */
describe("WO-BUILDER-ROLE · 建域/运营管线两态", () => {
  it("默认建域态：显示发动机职责边界（冷启动 onboarding · 运营走 WO-PIPE-INCR），两态可切换", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    // 两态切换器存在
    const sw = await screen.findByTestId("db-mode-switch");
    expect(within(sw).getByTestId("db-mode-onboarding")).toBeInTheDocument();
    expect(within(sw).getByTestId("db-mode-operational")).toBeInTheDocument();

    // 默认建域态：故事脚本输入框在（保留既有建域能力）
    expect(screen.getByTestId("db-script")).toBeInTheDocument();
    // 职责边界文案点明 WO-PIPE-INCR / 冷启动
    expect(sw).toHaveTextContent("冷启动");

    // 切到运营态 → 出现运营管线看板，建域输入框隐藏
    await user.click(within(sw).getByTestId("db-mode-operational"));
    expect(await screen.findByTestId("db-operational-board")).toBeInTheDocument();
    expect(screen.queryByTestId("db-script")).not.toBeInTheDocument();
  });

  it("运营管线态：各源标 synthetic vs real-sourced + last sync/新鲜度/增量(CDC)/隔离真值", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    await user.click(screen.getByTestId("db-mode-operational"));

    const table = await screen.findByTestId("db-pipeline-table");

    // 合成源（mock_erp = conn-synth/conn-erp）标 synthetic；真实源（rest_api = conn-crm/conn-iot）标 real
    const synthBadge = within(table).getByTestId("db-origin-conn-synth");
    expect(synthBadge).toHaveAttribute("data-origin", "synthetic");
    const erpBadge = within(table).getByTestId("db-origin-conn-erp");
    expect(erpBadge).toHaveAttribute("data-origin", "synthetic");
    const crmBadge = within(table).getByTestId("db-origin-conn-crm");
    expect(crmBadge).toHaveAttribute("data-origin", "real-sourced");
    const iotBadge = within(table).getByTestId("db-origin-conn-iot");
    expect(iotBadge).toHaveAttribute("data-origin", "real-sourced");

    // 真实源 iot 走真增量（有 watermark → 标"增量"）；新鲜度有真值（非裸空）
    expect(within(table).getByTestId("db-incremental-conn-iot")).toHaveTextContent("增量");
    expect(within(table).getByTestId("db-freshness-conn-iot")).not.toHaveTextContent("—");

    // 每源有手动触发增量同步入口（运营态常态由调度自动跑）
    expect(within(table).getByTestId("db-sync-conn-iot")).toBeInTheDocument();
  });
});
