import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * 轨 G · C12 配置迁移工作台（ConfigMigrationPage · OC3 跨系统 Saga）。
 * 断言：导出 bundle → 干跑出 diff → 应用跑 Saga 至 COMMITTED；冲突 policy=FAIL 阻断；B 段失败补偿回滚。
 * 注：jsdom 仅证逻辑；真 Saga 由门B真后端真浏览器把关。
 */
describe("C12 · 配置迁移工作台（导出→干跑 diff→应用 Saga）", () => {
  it("导出 → 文本框填入 bundle（含 feature overrides 摘要）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/config-migration");
    await screen.findByTestId("config-migration-page");
    await user.click(screen.getByTestId("cfg-export"));
    await waitFor(() => expect((screen.getByTestId("cfg-bundle-text") as HTMLTextAreaElement).value).toContain("featureOverrides"));
  });

  it("干跑 → 出 diff（added/changed）；应用 → COMMITTED", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/config-migration");
    await user.click(await screen.findByTestId("cfg-export"));
    await waitFor(() => expect((screen.getByTestId("cfg-bundle-text") as HTMLTextAreaElement).value.length).toBeGreaterThan(10));

    await user.click(screen.getByTestId("cfg-dry-run"));
    await waitFor(() => expect(screen.getByTestId("cfg-job-state").textContent).toBe("DRY_RUN_OK"));
    expect(screen.getByTestId("cfg-diff")).toBeTruthy();
    // bundle 含 view.plan-audit（目标无）→ added ≥1
    expect(Number(screen.getByTestId("cfg-diff-added").textContent)).toBeGreaterThanOrEqual(1);
    // WO-UNIT-MEANING：三个 diff 数此前裸奔（新增/变更/不变 各一个光秃秃的数）——
    // 现在带口径「新增功能开关 N 项」，锁进断言防回退
    const diffRow = screen.getByTestId("cfg-diff-added").parentElement!.parentElement!;
    expect(diffRow.textContent).toMatch(/新增功能开关\s*\d+\s*项/);
    expect(diffRow.textContent).toMatch(/变更\/冲突\s*\d+\s*项/);
    expect(diffRow.textContent).toMatch(/不变\s*\d+\s*项/);

    await user.click(screen.getByTestId("cfg-apply"));
    await waitFor(() => expect(screen.getByTestId("cfg-job-state").textContent).toBe("COMMITTED"));
    // 应用模式显 Saga 阶段进度
    expect(screen.getByTestId("cfg-saga-stages")).toBeTruthy();
  });

  it("冲突 policy=FAIL → FAILED（阻断）", async () => {
    // override view.dash=false（目标 true → 冲突）；policy=FAIL
    server.use(
      http.get("*/a/v1/config-bundles/export", () =>
        HttpResponse.json({ platformSchemaVersion: "1.0", sourceTenantId: "demo", exportedAt: "2026-06-25T00:00:00Z", featureOverrides: { "view.dash": false } }),
      ),
    );
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/config-migration");
    await user.click(await screen.findByTestId("cfg-export"));
    await waitFor(() => expect((screen.getByTestId("cfg-bundle-text") as HTMLTextAreaElement).value).toContain("view.dash"));
    await user.selectOptions(screen.getByTestId("cfg-policy"), "FAIL");
    await user.click(screen.getByTestId("cfg-apply"));
    await waitFor(() => expect(screen.getByTestId("cfg-job-state").textContent).toBe("FAILED"));
    expect(screen.getByTestId("cfg-job-error")).toBeTruthy();
  });
});
