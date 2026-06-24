import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PLANNER, debugHeaders, waitForTask } from "./helpers.js";

/**
 * PRD-scenario-ontogenesis P1：卡=发育器官。
 * grow=亲手把 triggerQuestion 经 QOS 跑通验证 → maturity（GOVERNED/PROVISIONAL）+ 留痕 ScenarioOntogenesisRun（前端可见来源）。
 * §2.4 确定性绑定：点 GOVERNED 卡直接绑定意图→计划，跳过 LLM classify（不受 classifier 死活影响）。
 */
describe("场景卡发育闭环（grow + 验证门 + 留痕 + 确定性绑定）", () => {
  it("grow S01 → 经 QOS 跑通验证真出答案 → GOVERNED + 留痕落卡（manage 可见来源）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { scenarioKey: string; rings: { data: boolean; ontology: boolean; capability: boolean }; verification: { status: string; path: string; answerPreview: string | null }; maturity: string };
    expect(run.scenarioKey).toBe("S01");
    expect(run.rings.capability).toBe(true);
    expect(run.rings.ontology).toBe(true);
    expect(run.rings.data).toBe(true);           // triggerQuestion 真跑出答案
    expect(run.verification.status).toBe("VERIFIED");
    expect(run.verification.path).toBe("WORKFLOW"); // 确定性走 Path A（非探索）
    expect(run.verification.answerPreview).toBeTruthy(); // 留痕带答案预览（知道来源）
    expect(run.maturity).toBe("GOVERNED");
    // 留痕落在卡上 → manage 可见
    const manage = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) })).json()) as { scenarioKey: string; maturity?: string; lastOntogenesisRun?: { runId: string; verification: { status: string } } }[];
    const s01 = manage.find((s) => s.scenarioKey === "S01")!;
    expect(s01.maturity).toBe("GOVERNED");
    expect(s01.lastOntogenesisRun?.verification.status).toBe("VERIFIED");
  });

  it("§2.4 确定性绑定：launch S01 → classification.model=deterministic:scenario-bind（跳过 LLM classify）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(202);
    const { taskId } = res.json() as { taskId: string };
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).toBe("deterministic:scenario-bind");
    expect(task.path).toBe("WORKFLOW"); // 确定性走 Path A，非探索兜底
  });

  it("P2 闭 G-1：grow 一张曾占位的卡（S15 接单毛利）→ 渲染投影求解器真实输出（含承载数据块）→ GOVERNED", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S15/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { verification: { status: string; taskId: string | null }; maturity: string };
    expect(run.maturity).toBe("GOVERNED");
    expect(run.verification.status).toBe("VERIFIED");
    // 关键：答案块含 kpi/table（投影求解器输出），不再是单一占位文本（用户铁律：数据可见、知来源）。
    const task = await t.repos.tasks.get(run.verification.taskId!);
    const blocks = task?.answer?.blocks ?? [];
    expect(blocks.some((b) => b.type === "kpi" || b.type === "table")).toBe(true);
    expect(blocks.some((b) => b.type === "text" && /已完成推演.*结果详见步骤溯源/.test(String((b as { markdown?: string }).markdown ?? "")))).toBe(false);
  });

  it("P2 诚实门：纯占位指向文本（S18 sop 无求解器投影）→ 不充作 GOVERNED → PROVISIONAL + RENDER_NOT_PROJECTED", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S18/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { verification: { status: string; gapCode: string | null }; maturity: string };
    expect(run.maturity).toBe("PROVISIONAL");
    expect(run.verification.status).toBe("NOT_VERIFIED");
    expect(run.verification.gapCode).toBe("RENDER_NOT_PROJECTED");
  });

  it("P2 闭 G-2 残：S03 切片渲染不再硬引用缺失字段（旧 data.summary 真后端无→TEMPLATE_RESOLUTION_ERROR）→ 通用投影 GOVERNED", async () => {
    const t = await createTestApp();
    const run = (await (await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S03/grow", headers: debugHeaders(ADMIN) })).json()) as { verification: { status: string; taskId: string | null }; maturity: string };
    expect(run.maturity).toBe("GOVERNED");
    expect(run.verification.status).toBe("VERIFIED");
    const task = await t.repos.tasks.get(run.verification.taskId!);
    expect((task?.answer?.blocks ?? []).some((b) => b.type === "kpi" || b.type === "table")).toBe(true);
  });

  it("P2 闭 G-2 残：S06 action-draft payload 合契约（base/factor/planKey）→ 草稿创建成功 GOVERNED（旧 baseId/solutionName 真后端 400）", async () => {
    const t = await createTestApp();
    const run = (await (await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S06/grow", headers: debugHeaders(ADMIN) })).json()) as { verification: { status: string; taskId: string | null }; maturity: string };
    expect(run.maturity).toBe("GOVERNED");
    expect(run.verification.status).toBe("VERIFIED");
    const task = await t.repos.tasks.get(run.verification.taskId!);
    expect((task?.answer?.blocks ?? []).some((b) => b.type === "action_draft")).toBe(true);
  });
});
