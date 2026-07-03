import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalibrationHistoryEntrySchema,
  CalibrationProposalSchema,
  CalibrationReportSchema,
  DataHealthResponseSchema,
} from "@platform/contracts";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import { round } from "../src/prng.js";

async function approveDraft(t: TestApp, draftId: string) {
  return (
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} })
  ).json() as { status: string };
}

describe("剩余视图增量 · 校准（§7.21）与数据健康度（§7.22）", () => {
  it("F28/report: MAPE 序列（无 tick 历史 → 确定性基线）+ C12 阈值 8 + 触发标记", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "GET",
      url: "/a/v1/calibration/report?objectType=Model&solverKey=capacity_forecast",
      headers: PLANNER,
    });
    expect(res.statusCode).toBe(200);
    const report = CalibrationReportSchema.parse(res.json());
    expect(report.thresholdPct).toBe(8); // 解析自已发布 C12 表达式（0.08 → 8%）
    expect(report.points.length).toBeGreaterThanOrEqual(10);
    expect(report.triggerMarks.length).toBeGreaterThan(0);
    expect(report.triggerMarks.every((m) => m.ruleKey === "C12")).toBe(true);
    // 触发标记与阈值口径一致：标记点的 MAPE 都越线
    const byDate = new Map(report.points.map((p) => [p.date, p.mape]));
    for (const m of report.triggerMarks) expect(byDate.get(m.date)!).toBeGreaterThan(report.thresholdPct);
    // 确定性：重复请求同一序列
    const again = CalibrationReportSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/calibration/report", headers: PLANNER })).json(),
    );
    expect(again.points).toEqual(report.points);
    // from= 过滤
    const fromDate = report.points[5]!.date;
    const filtered = CalibrationReportSchema.parse(
      (await t.app.inject({ method: "GET", url: `/a/v1/calibration/report?from=${fromDate}`, headers: PLANNER })).json(),
    );
    expect(filtered.points[0]!.date).toBe(fromDate);
  });

  it("F28/proposals: 批准走 Action —— EXECUTED 前 solver_params 不变；执行后 APPLIED + 历史；回滚还原", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const list = z.array(CalibrationProposalSchema).parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/calibration/proposals", headers: PLANNER })).json(),
    );
    expect(list.filter((p) => p.status === "PENDING")).toHaveLength(2); // 种子 2 条 PENDING
    const ramp = list.find((p) => p.id.endsWith("seed_ramp"))!;
    expect(ramp.currentValue).toBe(0.88);
    expect(ramp.proposedValue).toBe(0.9);
    expect(ramp.basis.samples).toBeGreaterThan(0);

    // 批准 → 仅创建 Action 草稿（无直改）
    const approve = await t.app.inject({
      method: "POST",
      url: `/a/v1/calibration/proposals/${ramp.id}/approve`,
      headers: PLANNER,
      payload: {},
    });
    expect(approve.statusCode).toBe(202);
    const { draftId, status } = approve.json() as { draftId: string; status: string };
    expect(status).toBe("PENDING_APPROVAL");
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.88); // 审批前参数未动
    expect(
      ((await t.app.inject({ method: "GET", url: "/a/v1/calibration/proposals", headers: PLANNER })).json() as { id: string; status: string }[])
        .find((p) => p.id === ramp.id)!.status,
    ).toBe("PENDING");

    // admin 审批 → EXECUTED → 参数落 solver_params + 提案 APPLIED + 历史新增
    const done = await approveDraft(t, draftId);
    expect(done.status).toBe("EXECUTED");
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.9);
    const applied = ((await t.app.inject({ method: "GET", url: "/a/v1/calibration/proposals", headers: PLANNER })).json() as {
      id: string; status: string;
    }[]).find((p) => p.id === ramp.id)!;
    expect(applied.status).toBe("APPLIED");
    const history = z.array(CalibrationHistoryEntrySchema).parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/calibration/history", headers: PLANNER })).json(),
    );
    expect(history.length).toBeGreaterThanOrEqual(2); // 种子 1 条 + 本次应用
    const entry = history.find((h) => h.changedParams.includes(ramp.parameter))!;
    expect(entry).toBeDefined();
    expect(entry.trigger).toBe("C12");
    expect(entry.mapeAfter).toBeLessThan(entry.mapeBefore);

    // 校准后的参数真实生效：爬坡基线 0.9 进入 capacity_forecast 周曲线
    const out = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 1 })).json() as {
      data: { perBaseRows: { weeklyCap: number; certFactor: number; maintWeek: number }[]; p50: number };
    };
    const indep = out.data.perBaseRows.reduce((a, r) => a + r.weeklyCap * r.certFactor * 0.9, 0);
    expect(out.data.p50).toBe(round(indep, 4));

    // 回滚：同样走 Action；EXECUTED 后还原旧值，状态 ROLLED_BACK
    const rb = await t.app.inject({
      method: "POST",
      url: `/a/v1/calibration/proposals/${ramp.id}/rollback`,
      headers: PLANNER,
      payload: {},
    });
    expect(rb.statusCode).toBe(202);
    const rbDraft = (rb.json() as { draftId: string }).draftId;
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.9); // 审批前仍是新值
    expect((await approveDraft(t, rbDraft)).status).toBe("EXECUTED");
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.88);
    const rolled = ((await t.app.inject({ method: "GET", url: "/a/v1/calibration/proposals", headers: PLANNER })).json() as {
      id: string; status: string;
    }[]).find((p) => p.id === ramp.id)!;
    expect(rolled.status).toBe("ROLLED_BACK");
  });

  it("F28/C12 钩子：无配对样本（n < nMin）时只报告不提案（M11 §2 INSUFFICIENT_SAMPLES）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = (await t.repos.calibrationProposals.list("demo")).length;
    // 尚无任何 calibration_pairs（未跑预测、未 tick）→ C12 钩子不得凭空出提案
    const p1 = await t.services.calibration.onCalibrationRequired("demo", "4680-NCM");
    expect(p1).toBeUndefined();
    const gen = await t.services.calibration.generateForSlice("demo", "4680-NCM", "C12");
    expect(gen.insufficient).toBe(true);
    expect((await t.repos.calibrationProposals.list("demo")).length).toBe(before); // 零新提案
  });

  it("F29/data-health: 正常 OK → markSourceStale → DELAYED + 降级影响 0.93→0.90，与 capacity_forecast 同源", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ok = DataHealthResponseSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/data-health", headers: ADMIN })).json(),
    );
    expect(ok.overall).toBe("OK");
    const iot = ok.sources.find((s) => s.connId === "iot-scada")!;
    expect(iot.status).toBe("OK");
    expect(iot.thresholdMin).toBe(120); // staleHours 2h，与 C09 同一参数
    expect(iot.degradeImpact).toBeUndefined();

    // iot_delay 情景同款钩子（A8.6 §6.2）
    await t.services.solvers.markSourceStale("demo", "iot-scada", 4.2);
    const degraded = DataHealthResponseSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/data-health", headers: ADMIN })).json(),
    );
    expect(degraded.overall).toBe("DELAYED");
    const iot2 = degraded.sources.find((s) => s.connId === "iot-scada")!;
    expect(iot2.status).toBe("DELAYED");
    expect(iot2.latencyMin).toBe(252); // 4.2h
    expect(iot2.degradeImpact).toMatchObject({ p90From: 0.93, p90To: 0.9 });
    expect(iot2.degradeImpact!.affectedSolvers.length).toBeGreaterThan(0);
    expect(iot2.degradeImpact!.affectedSolvers).toContain("capacity_forecast");

    // 同一事实源：capacity_forecast 输出同时降级（P90 0.93→0.90 + 降级说明文案同源）
    const out = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 })).json() as {
      data: { healthFactor: number; degradeNote?: string };
    };
    expect(out.data.healthFactor).toBe(0.9);
    // METHOD-MC-STOCHASTIC：degradeNote 改述为「陈旧→蒙特卡洛离散度 cv 放大→分布变宽→P90 下探」（诚实真分位·非 0.93 伪系数）。
    expect(String(out.data.degradeNote)).toContain("蒙特卡洛离散度");
    expect(String(out.data.degradeNote)).toContain("C09");
  });
});
