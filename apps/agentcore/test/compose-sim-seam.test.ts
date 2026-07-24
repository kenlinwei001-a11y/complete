import { describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { isSimComposeQuery, buildSimNavSlice, SIM_SCENARIO_SET } from "../src/agent/sim-planner.js";
import { compileSolverPlan } from "../src/router/compile-plan.js";

/**
 * WO-GSIM-4-AGENT · 全局推演 NL 大脑 SEAM（消费 Phase2-C 组合器·真接缝驱动·非各半绿）。
 *
 * 填补 compose-plan-seam 记录的缺口：portfolio 已登记 args schema 但不在 navigation-slice 通用 catalog → 通用 navSlice
 * 投不出 portfolio。本单 buildSimNavSlice 以 portfolio 为中心投影推演专属 slice → 推演 NL 经 compileSolverPlan
 * 真编出 portfolio 组合链 → executePlan 服务端多步 → 一次综合 · **runAgentLoop 零调用**（分水岭）。
 *
 * runAgentLoop-未调 判据：`t.llm.agentRequests.length===0`——runAgentLoop 是 llm.agent() 的**唯一**调用者
 * （executePlan 的一次综合走 llm.compose·与 agent() 完全分离），故 0 agent 往返 ⟺ 组合路径全程未落 runAgentLoop。
 */

const SIM_Q = "全部乘用车订单跨基地排到最优，考虑正极短缺";

function armPathB(t: TestApp): void {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
}

describe("WO-GSIM-4-AGENT · 推演 NL 大脑（纯投影 R6）", () => {
  it("推演意图识别 + buildSimNavSlice 以 portfolio 为中心（通用 catalog 投不出 portfolio·本单补）", () => {
    expect(isSimComposeQuery(SIM_Q)).toBe(true);
    expect(isSimComposeQuery("SO-12345 何时能交")).toBe(false); // 非推演题不劫持
    // §3.3 自由追问不被推演大脑劫持——「为什么X绑定」根因题 / 本体语义题由既有引擎路由
    //（path-B navSlice 投 gap_attribution/bottleneck_matrix · Phase3-B ontology_query 兜底·非本模块管辖）。
    expect(isSimComposeQuery("为什么邯郸被绑定生产")).toBe(false);
    expect(isSimComposeQuery("邯郸是什么类型的基地")).toBe(false);
    const slice = buildSimNavSlice(SIM_Q);
    expect(slice.primarySolver).toBe("portfolio");
    expect(slice.solvers.map((s) => s.key)).toContain("portfolio");
  });

  it("R6：同问句两次 compile 字节一致 + portfolio 真编入组合链（无 modelId→capacity_forecast 诚实落选）", () => {
    const a = compileSolverPlan(SIM_Q, buildSimNavSlice(SIM_Q), {});
    const b = compileSolverPlan(SIM_Q, buildSimNavSlice(SIM_Q), {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.plan.steps.map((s) => s.solverKey)).toContain("portfolio");
      expect(a.plan.steps.length).toBeGreaterThanOrEqual(2); // ≥2 步真组合（portfolio ⊕ affected_orders）
    }
  });
});

describe("WO-GSIM-4-AGENT · SEAM 端到端：推演 NL → 组合路径 portfolio 多步 → 一次综合 · runAgentLoop 未调", () => {
  it("推演 NL → executePlan 服务端跑 portfolio 组合步 · 综合一次 · runAgentLoop 零调用（命门·agentRequests==0）", async () => {
    const t = await createTestApp();
    armPathB(t);
    const composeSpy = vi.spyOn(t.llm, "compose");
    const invoked: { key: string; args: Record<string, unknown> }[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push({ key, args });
      return orig(ctx, key, args);
    };

    const { taskId } = await submitQuery(t, ADMIN, SIM_Q);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ★ 命门：runAgentLoop 零调用（0 agent 往返·组合全程不落 agent 盲选多跳）。
    expect(t.llm.agentRequests.length).toBe(0);
    // portfolio 服务端真跑（正是通用 navSlice 投不出、本单补上的求解器）。
    const pf = invoked.find((i) => i.key === "portfolio");
    expect(pf).toBeTruthy();
    // §3.2 多方案：portfolio 收到基线/激进/保守方案集（逐方案联合求解 → GlobalSimResponse.scenarios[] 供叙述权衡）。
    expect(pf!.args.scenarios).toEqual([...SIM_SCENARIO_SET]);
    // 一次综合（compose 单原语·非 agent 循环）。
    expect(composeSpy).toHaveBeenCalledTimes(1);
    // §3.2 数字红线：综合指令强制每业务数字 ⟦ref:N⟧ 溯步产物（executePlan compose instruction）。
    expect(String(composeSpy.mock.calls[0]?.[0]?.instruction ?? "")).toContain("⟦ref:N⟧");
    // 答案不劣化 + 溯源齐（R13·每步 provenance）。
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    expect((task.answer?.provenance?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("SEAM 不劫持：qos.compose-path 未开 → 推演题照落 path-B（组合分支不存在·既有行为字节兼容）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]); // 不含 qos.compose-path
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(() => ({
      content: [{ type: "tool_use", id: "tu1", name: "final_answer", input: { blocks: [{ type: "text", markdown: "path-B 答案" }], provenance: [] } }],
    }));
    const { taskId } = await submitQuery(t, ADMIN, SIM_Q);
    await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    // 组合分支不存在 → 落 runAgentLoop（≥1 agent 往返·既有 path-B 逐字节不变）。
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1);
    await t.app.close();
  });
});
