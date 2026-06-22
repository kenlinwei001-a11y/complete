import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import type { BootstrapReport } from "@platform/contracts";

/**
 * CL.4 · 空租户冷启动引导（计划域 seed → SopVersion 定稿 FINAL · 可执行清单）。
 * 把"从空到可用计划域"理成幂等、确定、可一键跑的 7 步；任一步核对未达 → 停并报结构化缺口（诚实）。
 * 定稿走 R4（单 admin 经 SA 自审；demo 默认 ALLOW_ADMIN）。
 */
describe("CL.4 · 空租户冷启动引导（POST /a/v1/bootstrap）", () => {
  it("空租户 → 7 步全通 → currentPlanVersion=FINAL（plan_audit 有料）", async () => {
    const t = await makeApp(); // demo 用户已种，但计划域为空
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/bootstrap",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "M", seed: 42, month: "2026-07" },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as BootstrapReport;
    expect(report.ok).toBe(true);
    expect(report.steps).toHaveLength(7);
    expect(report.finalVersionId).toBeTruthy();
    expect(report.gap).toBeUndefined();
    // 步骤诚实：每步有状态，无 FAILED
    expect(report.steps.every((s) => s.status !== "FAILED")).toBe(true);

    // currentPlanVersion 真为 FINAL（"从空到可用"达成）
    const cur = (await t.app.inject({ method: "GET", url: "/a/v1/plan-versions/current", headers: ADMIN })).json() as { status: string; versionId: string | null };
    expect(cur.status).toBe("FINAL");
    expect(cur.versionId).toBeTruthy();
  });

  it("幂等可重入：重跑不重复污染（PlanTarget 跳过重合成、版本已 FINAL 跳过定稿）", async () => {
    const t = await makeApp();
    const run = () => t.app.inject({ method: "POST", url: "/a/v1/bootstrap", headers: ADMIN, payload: { month: "2026-07" } });

    const first = (await run()).json() as BootstrapReport;
    expect(first.ok).toBe(true);

    const second = (await run()).json() as BootstrapReport;
    expect(second.ok).toBe(true);
    // 重跑：① 合成跳过（PlanTarget 已在）、⑥ 定稿跳过（已 FINAL）
    expect(second.steps.find((s) => s.step === 1)?.status).toBe("SKIPPED");
    expect(second.steps.find((s) => s.step === 6)?.status).toBe("SKIPPED");
    // 终态版本一致（不产生重复 FINAL）
    expect(second.finalVersionId).toBe(first.finalVersionId);
  });
});
