import { describe, expect, it } from "vitest";
import { GapCodeSchema, type GapReport, type GrowthTicket } from "@platform/contracts";
import { gapDisposition } from "../src/growth/probe.js";
import { createTestApp, ADMIN, PLANNER, debugHeaders, waitForTask, type TestApp } from "./helpers.js";

/**
 * ONTO-SCEN-GROWTH-LOOP（PRD-scenario-ontogenesis §2.5/§2.6）齿：
 *  ① 二分处置**显式无静默残缺**：每个缺口码明确落 AUTO_DERIVE / NEEDS_HUMAN 一侧（穷尽）。
 *  ② AUTO_DERIVE 全环：人为退发布可确定性重建的意图（AUTO_DERIVE 缺口）→ 点卡 → 倒序发育 growScenario
 *     自动重建意图/计划 → 重验 → maturity 升回 GOVERNED（scenario.matured 双通道）→ 重新点卡出真 KPI。
 *  ③ NEEDS_HUMAN 分支：删求解器（SOLVER_NOT_FOUND=NEEDS_HUMAN）→ 不自动补、开工单、maturity 降 PROVISIONAL。
 *
 * revert 判定（齿心）：
 *  - 去掉 setScenarioGap 的 AUTO_DERIVE 分支 / deriveScenarioCapability → ②变红（点卡后 maturity 仍 PROVISIONAL、
 *    无 scenario.matured、grown!=true、重新点卡不出 KPI）。
 *  - gapDisposition 把 NO_INTENT 误归 NEEDS_HUMAN → ②变红；把 SOLVER_NOT_FOUND 误归 AUTO_DERIVE → ③变红。
 */

type GapBlock = { type: "gap"; report: GapReport; scenario?: { scenarioKey: string; maturity: string; ticketId: string | null; grown?: boolean } };

async function growToGoverned(t: TestApp, key: string): Promise<void> {
  const res = await t.app.inject({ method: "POST", url: `/b/v1/scenarios/${key}/grow`, headers: debugHeaders(ADMIN) });
  expect(res.statusCode).toBe(200);
  expect((res.json() as { maturity: string }).maturity).toBe("GOVERNED");
}

describe("ONTO-SCEN-GROWTH-LOOP · 二分处置 + AUTO_DERIVE 自动生长升相 + 相位", () => {
  it("① 二分单源穷尽（无静默残缺）：每个缺口码落 AUTO_DERIVE / NEEDS_HUMAN 一侧", () => {
    // 覆盖 GapCode 全枚举——任一码未分类即抛（编译期 never + 运行期总函数双保险）。
    for (const code of GapCodeSchema.options) {
      const d = gapDisposition(code);
      expect(["AUTO_DERIVE", "NEEDS_HUMAN"]).toContain(d);
    }
    // 二分语义钉死：意图/计划可确定性重建 → AUTO_DERIVE；缺真实实体/功能 → NEEDS_HUMAN。
    expect(gapDisposition("NO_INTENT")).toBe("AUTO_DERIVE");
    expect(gapDisposition("NO_PLAN")).toBe("AUTO_DERIVE");
    expect(gapDisposition("SOLVER_NOT_FOUND")).toBe("NEEDS_HUMAN");
    expect(gapDisposition("EMPTY_DATA")).toBe("NEEDS_HUMAN");
    expect(gapDisposition("NO_CAPABILITY")).toBe("NEEDS_HUMAN");
  });

  it("② AUTO_DERIVE 全环：退发布意图 → 点卡自动生长 → 升相 GOVERNED（matured 事件）→ 重新点卡出真 KPI", async () => {
    const t = await createTestApp();
    await growToGoverned(t, "S01");
    const before = await t.repos.scenarios.byKey("demo", "S01");
    expect(before?.maturity).toBe("GOVERNED");

    // 人为制造 AUTO_DERIVE 缺口：退发布 S01 的意图（capacity_feasibility）——可由出厂目录确定性重建，
    // **区别于** LAUNCH-DET 已验的"删求解器→NEEDS_HUMAN"（缺真实能力，不可自动补）。
    await t.deps.catalog.retireIntent("int_capacity_feasibility_v1");
    expect((await t.repos.intents.get("int_capacity_feasibility_v1"))?.status).toBe("RETIRED");

    // 点卡（planner）→ 意图不在候选 → INTENT_NOT_AVAILABLE → hook 判 AUTO_DERIVE → growScenario 倒序发育。
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(202);
    const task = await waitForTask(t, (res.json() as { taskId: string }).taskId, (x) => x.status === "FAILED", 15000);

    // 本次点卡任务返回"已自动补齐"发育卡（grown=true·升相 GOVERNED·无工单），非 NEEDS_HUMAN 工单卡。
    const gap = task.answer?.blocks.find((b) => b.type === "gap") as GapBlock | undefined;
    expect(gap?.scenario?.grown).toBe(true);
    expect(gap?.scenario?.maturity).toBe("GOVERNED");
    expect(gap?.scenario?.ticketId).toBeNull();
    expect(JSON.stringify(task.answer)).not.toContain("未能产出回答");

    // 意图被确定性重建为 PUBLISHED；卡 maturity 升回 GOVERNED（留痕 growth.triggered）。
    expect((await t.repos.intents.get("int_capacity_feasibility_v1"))?.status).toBe("PUBLISHED");
    const sc = await t.repos.scenarios.byKey(task.tenantId, "S01");
    expect(sc?.maturity).toBe("GOVERNED");
    const runs = await t.repos.ontogenesisRuns.listByScenario(task.tenantId, "S01");
    expect(runs.some((r) => r.maturity === "GOVERNED" && r.growth?.triggered === true)).toBe(true);

    // 双通道事件：正序喂倒序触发 growth_triggered + 升相 matured（SSE ⊕ outbox）。
    const events = await t.repos.domainEvents.listSince(task.tenantId);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(true);
    expect(events.some((e) => e.event === "scenario.matured")).toBe(true);

    // 重新点卡 → 现确定性走 Path A 出真承载数据（KPI/table）——发育闭环真闭合（非绿测试冒充）。
    const res2 = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    const task2 = await waitForTask(t, (res2.json() as { taskId: string }).taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task2.path).toBe("WORKFLOW");
    expect((task2.answer?.blocks ?? []).some((b) => b.type === "kpi" || b.type === "table")).toBe(true);
  });

  it("③ NEEDS_HUMAN 分支：删求解器（SOLVER_NOT_FOUND）→ 不自动补 → 开工单 + 降 PROVISIONAL（无 matured）", async () => {
    const t = await createTestApp();
    await growToGoverned(t, "S01");
    // 删求解器 = 缺真实能力（NEEDS_HUMAN，不可确定性自动补）。
    (t.dataCore.solver as unknown as { invoke: () => Promise<never> }).invoke = async () => {
      throw Object.assign(new Error("SOLVER_NOT_FOUND: capacity_forecast 已被删除"), { code: "SOLVER_NOT_FOUND", statusCode: 404 });
    };
    // 快照 launch 前事件数——只断言"点卡后无新增 matured"（初次 grow→GOVERNED 早已发过一次，需隔离）。
    const maturedBefore = (await t.repos.domainEvents.listSince("demo")).filter((e) => e.event === "scenario.matured").length;

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    const task = await waitForTask(t, (res.json() as { taskId: string }).taskId, (x) => x.status === "FAILED", 15000);

    const gap = task.answer?.blocks.find((b) => b.type === "gap") as GapBlock | undefined;
    expect(gap?.report.findings[0]?.gapCode).toBe("SOLVER_NOT_FOUND");
    // 不自动补 → 非 grown、降 PROVISIONAL、带工单（NEEDS_HUMAN 一侧）。
    expect(gap?.scenario?.grown).toBeFalsy();
    expect(gap?.scenario?.maturity).toBe("PROVISIONAL");
    expect(gap?.scenario?.ticketId).toBeTruthy();
    const tickets = (await t.repos.growthTickets.listByTenant(task.tenantId)).filter(
      (tk: GrowthTicket) => tk.status === "OPEN" && tk.gapCode === "SOLVER_NOT_FOUND",
    );
    expect(tickets.length).toBe(1);
    // 无静默残缺、也无假升相：NEEDS_HUMAN 缺口绝不发新的 scenario.matured。
    const maturedAfter = (await t.repos.domainEvents.listSince(task.tenantId)).filter((e) => e.event === "scenario.matured").length;
    expect(maturedAfter).toBe(maturedBefore);
    expect((await t.repos.scenarios.byKey(task.tenantId, "S01"))?.maturity).toBe("PROVISIONAL");
  });
});
