import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, debugHeaders, waitForTask, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";

/**
 * WO-S02-REGRESSION-GATE · S02 防误路由回归门（纯测试·锁现有行为·不动生产代码）。
 *
 * 来源：S02 测试报告 §6.5。锁「S02『交期风险与受影响订单』走确定性 scenario-bind → affected_orders(WORKFLOW)，
 * **不进 Coordinator·不落 LLM**」——防未来改动把 S02 误路由到 capacity_feasibility 或多角色 Coordinator。
 *
 * 依赖交底：本单原设计为在 `s01-variant-routing-seam.test.ts` 上加断言（含 `isCapacityFeasibilityQuery` 单元负例），
 * 但 WO-AGENT-RUNTIME-S01（造出该文件 + 该函数的前置单）**尚未落 canonical**——故只落端到端那半为独立回归门；
 * `isCapacityFeasibilityQuery` 单元负例待 S01 落地后补（见 WO 交底）。S02 卡单一来源：`scenarios-catalog.ts` S02
 * （intentKey=affected_orders·presetSlots{baseId:changzhou}）。
 */

describe("WO-S02-REGRESSION-GATE · S02 回归（不被误路由到 capacity_feasibility/Coordinator）", () => {
  it("命门：开 agent.coordinator 也不劫持——S02 launch → deterministic:scenario-bind → affected_orders(WORKFLOW)·agentRequests=0·无 coordinator.planned", async () => {
    const t: TestApp = await createTestApp();
    // 模拟部署态病根条件：coordinator 门开（若回归会抢在 path-B 前扇出多角色）。S02 仍须走确定性 scenario-bind。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);

    // 真调 affected_orders 求解器 + 入参核验（有牙：证 baseId 解析自 presetSlots changzhou）。
    const invoked: { key: string; args: Record<string, unknown> }[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push({ key, args });
      return orig(ctx, key, args);
    };

    // 走 S02 场景 launch 端点（faithful 到测试报告）。不 queueClassification——S02 走确定性 scenario-bind·不调分类 LLM；
    // 若回归掉进 classify，mock 无响应→任务 FAILED→下方 COMPLETED 断言失败=正好抓到回归。
    const launch = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S02/launch", headers: debugHeaders(ADMIN), payload: {} });
    expect(launch.statusCode).toBe(202);
    const { taskId } = launch.json() as { taskId: string };
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ── 命门断言 ──
    expect(task.classification?.model).toBe("deterministic:scenario-bind"); // 确定性绑定·非 classify LLM
    expect(task.classification?.model).not.toBe("coordinator"); // 非 Coordinator 编排
    expect(task.path).toBe("WORKFLOW"); // 工作流路径·非 AGENT/path-B
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("affected_orders"); // 命中 S02 意图
    expect(t.llm.agentRequests.length).toBe(0); // 不落 runAgentLoop（非 AGENT·非 Coordinator 扇出子 agent）

    // 无 coordinator.planned 事件（坐实未进多角色编排）。
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.find((e) => e.event === "coordinator.planned")).toBeFalsy();

    // 加强：affected_orders 真被调·args.baseId 解析自 presetSlots changzhou（编排器把预设基地归一为对象 id base_changzhou）。
    const ao = invoked.find((i) => i.key === "affected_orders");
    expect(ao).toBeTruthy();
    expect(String(ao!.args.baseId)).toContain("changzhou");

    await t.app.close();
  });
});
