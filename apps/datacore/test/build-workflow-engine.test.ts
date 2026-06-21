import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { BuildWorkflowEngine, RetryableStepError, type WorkflowStepDef } from "../src/databuilder/workflow-engine.js";
import type { BuildWorkflowRun } from "@platform/contracts";
import type { Repos, Store } from "../src/repo/repo.js";

/** 最小内存 Store（put 快照防引用泄漏，模拟真实仓储边界 → 重入读到的是落库副本）。 */
function memStore<T extends { id: string; tenantId: string }>(): Store<T> {
  const m = new Map<string, T>();
  const k = (t: string, id: string) => `${t}/${id}`;
  return {
    async get(t, id) { const v = m.get(k(t, id)); return v ? structuredClone(v) : undefined; },
    async put(item) { m.set(k(item.tenantId, item.id), structuredClone(item)); },
    async remove(t, id) { m.delete(k(t, id)); },
    async list(t, pred) { return [...m.values()].filter((v) => v.tenantId === t && (!pred || pred(v))).map((v) => structuredClone(v)); },
  };
}

function harness() {
  const store = memStore<BuildWorkflowRun>();
  const events: { event: string; payload: Record<string, unknown> }[] = [];
  const outbox = { emit: async (_t: string, event: string, payload: Record<string, unknown>) => { events.push({ event, payload }); } };
  const engine = new BuildWorkflowEngine({ buildWorkflowRuns: store } as unknown as Repos, outbox as never, () => 0);
  const init = (id = "bwf_1", tenantId = "demo") => ({ id, tenantId, script: "s", scriptHash: "h", seed: 42, inference: false });
  return { store, events, engine, init };
}

describe("数据构建工作流引擎 · 工业级保证（持久化/可重入/可重试/可观测）", () => {
  it("happy：多步顺序执行 → 全 SUCCEEDED，context 跨步累积，发 run_started/step_succeeded/run_completed", async () => {
    const { engine, events, init } = harness();
    const calls: string[] = [];
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", run: async () => { calls.push("a"); return { patch: { x: 1 } }; } },
      { stepKey: "b", title: "B", run: async (c) => { calls.push("b"); return { patch: { y: (c.x as number) + 1 } }; } },
      { stepKey: "c", title: "C", run: async (c) => { calls.push("c"); return { detail: `y=${c.y}` }; } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("SUCCEEDED");
    expect(wf.steps.map((s) => s.status)).toEqual(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);
    expect(wf.context).toMatchObject({ x: 1, y: 2 });
    expect(calls).toEqual(["a", "b", "c"]);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe("buildworkflow.run_started");
    expect(names).toContain("buildworkflow.step_succeeded");
    expect(names.at(-1)).toBe("buildworkflow.run_completed");
  });

  it("瞬时失败 → 有界退避重试 → 成功（attempts 累加 + step_retry 事件）", async () => {
    const { engine, events, init } = harness();
    let n = 0;
    const steps: WorkflowStepDef[] = [
      { stepKey: "flaky", title: "F", maxAttempts: 3, run: async () => { n++; if (n < 3) throw new RetryableStepError("瞬时"); return { detail: "ok" }; } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("SUCCEEDED");
    expect(wf.steps[0]!.attempts).toBe(3);
    expect(events.filter((e) => e.event === "buildworkflow.step_retry")).toHaveLength(2);
  });

  it("致命失败（非可重试）→ 止于该步，run FAILED，后续步保持 PENDING，错误落库", async () => {
    const { engine, init } = harness();
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", run: async () => ({}) },
      { stepKey: "boom", title: "B", run: async () => { throw new Error("致命"); } },
      { stepKey: "c", title: "C", run: async () => ({}) },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("FAILED");
    expect(wf.steps.map((s) => s.status)).toEqual(["SUCCEEDED", "FAILED", "PENDING"]);
    expect(wf.steps[1]!.error?.code).toBe("FATAL");
    expect(wf.steps[1]!.error?.retryable).toBe(false);
  });

  it("重试上限耗尽 → FAILED（有界，不无限重试）", async () => {
    const { engine, init } = harness();
    let n = 0;
    const steps: WorkflowStepDef[] = [{ stepKey: "x", title: "X", maxAttempts: 2, run: async () => { n++; throw new RetryableStepError("永久瞬时"); } }];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("FAILED");
    expect(n).toBe(2); // maxAttempts 后停
    expect(wf.steps[0]!.error?.retryable).toBe(true);
  });

  it("崩溃后可重入：stopAfter 模拟进程在某步后死掉 → resume 从未完成步续跑，已成功步不重跑，context 复用", async () => {
    const { engine, store, init } = harness();
    const calls: string[] = [];
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", run: async () => { calls.push("a"); return { patch: { token: "T" } }; } },
      { stepKey: "b", title: "B", run: async () => { calls.push("b"); return {}; } },
      { stepKey: "c", title: "C", run: async (c) => { calls.push("c"); expect(c.token).toBe("T"); return {}; } },
    ];
    // 在 a 之后"崩溃"：run 仍 RUNNING，b/c 仍 PENDING，已落库
    const crashed = await engine.start(init("bwf_crash"), steps, { stopAfter: "a" });
    expect(crashed.status).toBe("RUNNING");
    expect(crashed.steps.map((s) => s.status)).toEqual(["SUCCEEDED", "PENDING", "PENDING"]);
    const persisted = await store.get("demo", "bwf_crash");
    expect(persisted?.steps[0]!.status).toBe("SUCCEEDED"); // 检查点确实落库
    // 重入：从 b 续跑，a 不再执行（已成功），context.token 复用
    const resumed = await engine.resume("demo", "bwf_crash", steps);
    expect(resumed.status).toBe("SUCCEEDED");
    expect(resumed.resumedCount).toBe(1);
    expect(calls).toEqual(["a", "b", "c"]); // a 仅执行一次
  });

  it("失败后修复再 resume：FAILED 步重置为 PENDING 重新尝试 → 成功（自愈闭环）", async () => {
    const { engine, init } = harness();
    let fixed = false;
    const calls: string[] = [];
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", run: async () => { calls.push("a"); return {}; } },
      { stepKey: "b", title: "B", run: async () => { calls.push("b"); if (!fixed) throw new Error("外部依赖未就绪"); return {}; } },
    ];
    const failed = await engine.start(init("bwf_fix"), steps);
    expect(failed.status).toBe("FAILED");
    fixed = true; // 修复外部依赖
    const ok = await engine.resume("demo", "bwf_fix", steps);
    expect(ok.status).toBe("SUCCEEDED");
    expect(calls).toEqual(["a", "b", "b"]); // a 不重跑；b 失败一次 + 成功一次
  });

  it("R2 租户隔离：A 租户的工作流，B 租户 resume 取不到 → 抛 not found", async () => {
    const { engine, init } = harness();
    await engine.start(init("bwf_iso", "tenantA"), [{ stepKey: "a", title: "A", maxAttempts: 1, run: async () => { throw new Error("x"); } }]);
    await expect(engine.resume("tenantB", "bwf_iso", [])).rejects.toThrow();
  });

  it("跳过步：业务条件不满足返回 skip → 标 SKIPPED（非错误），run 仍 SUCCEEDED", async () => {
    const { engine, init } = harness();
    const steps: WorkflowStepDef[] = [
      { stepKey: "gate", title: "G", run: async () => ({ patch: { ok: false } }) },
      { stepKey: "build", title: "B", run: async (c) => (c.ok ? {} : { skip: true, detail: "门未过→跳过" }) },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("SUCCEEDED");
    expect(wf.steps[1]!.status).toBe("SKIPPED");
  });
});

describe("数据构建工作流 · HTTP 端到端（真服务 · 故事建域经持久化步骤）", () => {
  const STORY = "5万套电芯订单提前15天交付能否满足？挤占哪些在产项目？影响哪些客户与利润损失？";

  it("POST /workflow-runs → 全步终态 + storyRunId 落 StoryBuildRun + GET 可观测逐步状态", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN, payload: { script: STORY, seed: 42 } });
    expect([200, 201]).toContain(res.statusCode);
    const wf = res.json() as BuildWorkflowRun;
    // 工作流执行成功（即便业务结论可能 BLOCKED，执行本身跑完）
    expect(wf.status).toBe("SUCCEEDED");
    // 每步都到终态（SUCCEEDED/SKIPPED），无 PENDING/RUNNING 残留 → 真跑完
    expect(wf.steps.every((s) => s.status === "SUCCEEDED" || s.status === "SKIPPED")).toBe(true);
    expect(wf.steps.map((s) => s.stepKey)).toEqual(["dry_build", "cross_scaffold", "gap_analysis", "publish_build", "validation", "inference", "record"]);
    // 比对现状步产出跨模块统一 diff（倒推 vs 现状）
    const gapStep = wf.steps.find((s) => s.stepKey === "gap_analysis")!;
    expect(gapStep.status).toBe("SUCCEEDED");
    expect(gapStep.detail).toMatch(/需 \d+ · 复用 \d+ · 新建 \d+ · 缺 \d+/);
    expect(wf.storyRunId).toBeTruthy();

    // 可观测：GET 单运行带逐步计时/尝试
    const detail = (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/workflow-runs/${wf.id}`, headers: ADMIN })).json() as BuildWorkflowRun;
    expect(detail.steps[0]!.attempts).toBeGreaterThanOrEqual(1);
    expect(detail.steps[0]!.durationMs).toBeGreaterThanOrEqual(0);

    // record 步确实落了 StoryBuildRun（与旧端点同源）
    const story = await t.app.inject({ method: "GET", url: `/a/v1/databuilder/runs/${wf.storyRunId}`, headers: ADMIN });
    expect(story.statusCode).toBe(200);
    expect((story.json() as { id: string }).id).toBe(wf.storyRunId);
  });

  it("GET /workflow-runs 列表 + resume 已成功运行幂等（不重复建域）", async () => {
    const t = await makeApp();
    const start = (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN, payload: { script: STORY, seed: 7 } })).json() as BuildWorkflowRun;
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN })).json() as BuildWorkflowRun[];
    expect(list.some((w) => w.id === start.id)).toBe(true);
    const resumed = (await t.app.inject({ method: "POST", url: `/a/v1/databuilder/workflow-runs/${start.id}/resume`, headers: ADMIN })).json() as BuildWorkflowRun;
    expect(resumed.status).toBe("SUCCEEDED"); // 已终态 → 幂等返回
  });

  it("旧端点 /databuilder/runs 仍走同一组持久化步骤（单一执行路径，无回归）", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: STORY, seed: 42 } });
    expect([200, 201]).toContain(res.statusCode);
    const run = res.json() as { id: string; status: string; buildPlan?: unknown };
    expect(run.id).toMatch(/^sbr_/);
    expect(run.buildPlan).toBeTruthy();
    // 同 seed 经工作流也产出一条工作流运行记录
    const wfList = (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN })).json() as BuildWorkflowRun[];
    expect(wfList.some((w) => w.storyRunId === run.id)).toBe(true);
  });
});
