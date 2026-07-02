import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F40 · 运营自动化 OpsSchedule 管理台（回放编排器 §6）。
 * tenant_admin 可配置定期预测 / S&OP 自动开启 / 审批催办 / 低风险自动批准（默认关）。
 */
describe("F40 · 运营自动化（OpsSchedule）", () => {
  it("tenant_admin 配置定期预测并保存；autoApprove 默认关闭", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // mock planner 账号持 admin+tenant_admin 角色
    renderApp("/admin/ops-schedule");

    const page = await screen.findByTestId("ops-schedule-page");
    expect(page).toBeInTheDocument();

    // autoApprove 默认关闭（红线：开启需显式勾选）
    const autoApprove = screen.getByTestId("autoapprove-enabled") as HTMLInputElement;
    expect(autoApprove.checked).toBe(false);

    // 添加一条定期预测计划
    await user.click(screen.getByTestId("add-forecast"));
    expect(await screen.findByTestId("forecast-0")).toBeInTheDocument();

    // 启用审批催办
    await user.click(screen.getByTestId("reminder-enabled"));

    // 保存
    await user.click(screen.getByTestId("save-schedule"));
    await waitFor(() => expect(screen.getByText("运营自动化配置已保存")).toBeInTheDocument());
  });

  it("base_manager 无 tenant_admin → 直访被 AdminGuard 拦截 403", async () => {
    loginAs("base_manager");
    renderApp("/admin/ops-schedule");
    expect(await screen.findByTestId("page-403")).toBeInTheDocument();
  });
});

/**
 * WO-OPS-GOV-VISIBILITY §①：GET /a/v1/scheduler/jobs 显 nextRunAt/lastRunAt/lastError；
 * 展开 GET /a/v1/scheduler/jobs/:id/runs 出红绿运行历史表；pause/resume 真调后端状态翻转。
 */
describe("WO-OPS-GOV-VISIBILITY §① · 调度作业状态 + 最近运行面板", () => {
  it("调度页显示每个作业的状态/下次运行/最近运行/最近错误", async () => {
    loginAs("planner");
    renderApp("/admin/ops-schedule");
    const panel = await screen.findByTestId("scheduler-jobs-panel");
    expect(panel).toBeInTheDocument();

    const okJob = await within(panel).findByTestId("scheduler-job-sjob_demo_TS_AGGREGATE_ts-agg-daily");
    expect(within(okJob).getByTestId("job-status-sjob_demo_TS_AGGREGATE_ts-agg-daily")).toHaveTextContent("ACTIVE");
    expect(within(okJob).getByTestId("job-next-run-sjob_demo_TS_AGGREGATE_ts-agg-daily")).toHaveTextContent("2026-07-03T01:00:00Z");
    expect(within(okJob).getByTestId("job-last-run-sjob_demo_TS_AGGREGATE_ts-agg-daily")).toHaveTextContent("2026-07-02T01:00:00Z");

    const failingJob = within(panel).getByTestId("scheduler-job-sjob_demo_RULE_SCAN_rule-scan-hourly");
    expect(within(failingJob).getByTestId("job-last-error-sjob_demo_RULE_SCAN_rule-scan-hourly")).toHaveTextContent("401 unauthorized");
  });

  it("展开某作业出运行历史红绿表：成功/失败均可见，失败行带 error", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/ops-schedule");
    const panel = await screen.findByTestId("scheduler-jobs-panel");
    await within(panel).findByTestId("scheduler-job-sjob_demo_RULE_SCAN_rule-scan-hourly");

    await user.click(within(panel).getByTestId("job-expand-sjob_demo_RULE_SCAN_rule-scan-hourly"));
    const runsTable = await screen.findByTestId("job-runs-sjob_demo_RULE_SCAN_rule-scan-hourly");

    const failedRun = within(runsTable).getByTestId(
      "run-row-sjob_demo_RULE_SCAN_rule-scan-hourly@2026-07-02T12:00:00Z",
    );
    expect(within(failedRun).getByTestId("run-status-sjob_demo_RULE_SCAN_rule-scan-hourly@2026-07-02T12:00:00Z")).toHaveTextContent(
      "FAILED",
    );
    expect(failedRun).toHaveTextContent("401 unauthorized");

    const succeededRun = within(runsTable).getByTestId(
      "run-row-sjob_demo_RULE_SCAN_rule-scan-hourly@2026-07-02T11:00:00Z",
    );
    expect(
      within(succeededRun).getByTestId("run-status-sjob_demo_RULE_SCAN_rule-scan-hourly@2026-07-02T11:00:00Z"),
    ).toHaveTextContent("SUCCEEDED");
  });

  it("pause/resume 真调后端并翻转状态", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/ops-schedule");
    const panel = await screen.findByTestId("scheduler-jobs-panel");

    const pausedJob = await within(panel).findByTestId("scheduler-job-sjob_demo_CONNECTOR_SYNC_conn-erp");
    expect(within(pausedJob).getByTestId("job-status-sjob_demo_CONNECTOR_SYNC_conn-erp")).toHaveTextContent("PAUSED");
    await user.click(within(pausedJob).getByTestId("job-resume-sjob_demo_CONNECTOR_SYNC_conn-erp"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("scheduler-job-sjob_demo_CONNECTOR_SYNC_conn-erp")).getByTestId(
          "job-status-sjob_demo_CONNECTOR_SYNC_conn-erp",
        ),
      ).toHaveTextContent("ACTIVE"),
    );
  });
});
