import { describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { toolUse, text } from "../src/llm/mock.js";
import {
  isCapacityFeasibilityQuery,
  parseCapacityFeasibilityVariant,
  buildFeasibilityNavSlice,
  feasibilityComposeSlots,
} from "../src/agent/sim-planner.js";
import { compileSolverPlan } from "../src/router/compile-plan.js";
import { planCoordination, detectSingleRole } from "../src/router/coordinator.js";

/**
 * WO-AGENT-RUNTIME-S01 · 场景变体路由 + agent 停滞早停 SEAM（真接缝驱动·非各半绿）。
 *
 * 病根（decision-trace 铁证）：S01「订单可承接性评审」点卡带 presetSlots{modelId,demandDelta,weeks} 命中
 *   capacity_feasibility → capacity_forecast·3 秒出答。改写成自由问句「4680-NCM 上浮10%、8周还能接吗」后丢了
 *   scenarioIntentKey/presetSlots → 路由判开放题 → 进多角色 Coordinator（供应链/产能/质量三角会诊）→ 子 agent 不会把
 *   「上浮10%/8周/4680-NCM」映射成 {modelId,demandDelta,weeks} → workflow_capacity_check DENIED + invoke_solver ERROR
 *   + 反复 query_objects 烧预算 → 3 个「预算耗尽·我不会」拼成答案·~5min 像卡死。
 *
 * SEAM 门（头号判据 = 变体秒答·不进 Coordinator·不卡死）：
 *   ① 变体「4680-NCM 上浮10% 8周还能接」（带 conversationId 继承 S01）→ 命中 capacity_feasibility → capacity_forecast·
 *      path-A·非 AGENT·runAgentLoop 零调用（不进多角色 Coordinator·即便 agent.coordinator 已开）；
 *   ② 变体 compose 直路（无会话继承·qos.compose-path 开）→ compileSolverPlan 出 capacity_forecast·runAgentLoop 零调用；
 *   ③ 停滞早停：脚本化连续 invoke_solver ERROR + 无成功产出 → loop 在预算耗尽（24 轮）前**早 degrade**；先错后恢复不误伤；
 *   ④ 字节兼容：原 S01（presetSlots）路由逐字节不变（deterministic:scenario-bind·path-A）+ 真开放题仍 path-B。
 *
 * runAgentLoop-未调 判据：`t.llm.agentRequests.length===0`（runAgentLoop 是 llm.agent() 唯一调用者·compose 一次综合走 llm.compose）。
 */

const VARIANT_Q = "4680-NCM 上浮10%、8周还能接吗";
const S01_TRIGGER = "4680-NCM 加 20% 六周能不能接？";
const MODEL_SEL = [{ objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" }];

function spySolver(t: TestApp): { key: string; args: Record<string, unknown> }[] {
  const invoked: { key: string; args: Record<string, unknown> }[] = [];
  const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
  t.dataCore.solver.invoke = async (ctx, key, args) => {
    invoked.push({ key, args });
    return orig(ctx, key, args);
  };
  return invoked;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("WO-AGENT-RUNTIME-S01 · 变体识别 + 确定性解析（纯函数 R6）", () => {
  it("parseCapacityFeasibilityVariant：「型号+上浮X%+N周」→ {modelId,demandDelta,weeks}·R6 字节一致", () => {
    const a = parseCapacityFeasibilityVariant(VARIANT_Q);
    const b = parseCapacityFeasibilityVariant(VARIANT_Q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 同问句同解析
    expect(a).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.1, weeks: 8 });
    // S01 原问句（中文数字周 + 加 X%）同样解析（继承时以此为变体族）。
    expect(parseCapacityFeasibilityVariant(S01_TRIGGER)).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 });
  });

  it("isCapacityFeasibilityQuery：识别可行性变体·不劫持单订单重排/无关问句", () => {
    expect(isCapacityFeasibilityQuery(VARIANT_Q)).toBe(true);
    expect(isCapacityFeasibilityQuery(S01_TRIGGER)).toBe(true);
    expect(isCapacityFeasibilityQuery("4680-NCM 增加10% 6周产能够不够")).toBe(true);
    // 单订单重排（SO-号 + 重排/提前）归 sop_reschedule·不劫持。
    expect(isCapacityFeasibilityQuery("SO-3402 提前两周交跨基地重排，产能够不够")).toBe(false);
    // 纯开放题/无增量无周数 → 非可行性变体。
    expect(isCapacityFeasibilityQuery("综合分析连锁影响给个整体结论")).toBe(false);
    expect(isCapacityFeasibilityQuery("邯郸是什么类型的基地")).toBe(false);
  });

  it("compile：可行性变体 navSlice + slots → capacity_forecast 真编入（modelId/demandDelta/weeks）·R6 字节一致", () => {
    const slots = feasibilityComposeSlots(VARIANT_Q);
    const a = compileSolverPlan(VARIANT_Q, buildFeasibilityNavSlice(), slots);
    const b = compileSolverPlan(VARIANT_Q, buildFeasibilityNavSlice(), slots);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok).toBe(true);
    if (a.ok) {
      const cf = a.plan.steps.find((s) => s.solverKey === "capacity_forecast");
      expect(cf).toBeTruthy();
      expect(cf!.args).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.1, weeks: 8 });
    }
  });

  it("item 4：planCoordination / detectSingleRole 对可行性变体返 undefined（不拆多角色·不落单域角色 agent）", () => {
    expect(planCoordination(VARIANT_Q, undefined, [])).toBeUndefined();
    expect(detectSingleRole(VARIANT_Q)).toBeUndefined();
    // 对照：真跨域问句仍拆多角色（不回归）。
    const cross = planCoordination("常州交付风险：物料齐套、产能瓶颈、良率都看一下", undefined, []);
    expect(cross).toBeTruthy();
    expect((cross?.dispatches.length ?? 0)).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WO-AGENT-RUNTIME-S01 · SEAM ① 会话继承变体 → capacity_forecast · path-A · 非 AGENT · 不进 Coordinator", () => {
  it("带 conversationId 继承 S01 → capacity_feasibility → capacity_forecast{4680-NCM,0.1,8}·runAgentLoop 零调用·无 coordinator.planned", async () => {
    const t = await createTestApp();
    // 模拟部署态：coordinator 已开（病根就发生在 demo 全 feature 开·coordinator 抢在 path-B 前）。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    const invoked = spySolver(t);
    const conv = "conv-s01-inherit";

    // 步①：S01 点卡启动（scenarioIntentKey + presetSlots + 选中 4680-NCM）→ forcedKey path-A（deterministic:scenario-bind）。
    const launch = await submitQuery(t, ADMIN, S01_TRIGGER, {
      view: "project", conversationId: conv, scenarioIntentKey: "capacity_feasibility", scenarioKey: "S01",
      selectedObjects: MODEL_SEL, presetSlots: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    const launched = await waitForTask(t, launch.taskId, (x) => x.status === "COMPLETED");
    expect(launched.classification?.model).toBe("deterministic:scenario-bind");
    expect(launched.path).toBe("WORKFLOW");

    // 步②：同会话变体自由问句（丢了 scenarioIntentKey/presetSlots·不带选中对象）→ 继承意图 path-A。
    const variant = await submitQuery(t, ADMIN, VARIANT_Q, { view: "project", conversationId: conv });
    const vt = await waitForTask(t, variant.taskId, (x) => x.status === "COMPLETED");

    // ★ 命门：继承绑定（非 classify 开放题）·path-A·runAgentLoop 零调用（非 AGENT·非多角色 Coordinator）。
    expect(vt.classification?.model).toBe("deterministic:scenario-inherit");
    expect(vt.path).toBe("WORKFLOW");
    expect(t.llm.agentRequests.length).toBe(0);

    // capacity_forecast 真跑·变体槽映射正确（上浮10%→demandDelta 0.1·8周·4680 型号）。
    // 注：path-A 经意图 `model` objectRef 槽解析 → modelId 为本体解析后的对象 id（mock 前缀 model_4680_ncm；
    // 真 datacore 为解析后 objectId）——断言含 4680（前缀无关）+ 精确 demandDelta/weeks。
    const cf = invoked.filter((i) => i.key === "capacity_forecast").at(-1);
    expect(cf).toBeTruthy();
    expect(String(cf!.args.modelId)).toMatch(/4680/i);
    expect(cf!.args.demandDelta).toBe(0.1);
    expect(cf!.args.weeks).toBe(8);

    // 未进多角色 Coordinator（无 coordinator.planned 事件·model 非 coordinator）。
    const events = await t.repos.events.listAfter(variant.taskId, 0);
    expect(events.find((e) => e.event === "coordinator.planned")).toBeFalsy();
    expect(vt.classification?.model).not.toBe("coordinator");
    await t.app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WO-AGENT-RUNTIME-S01 · SEAM ② 变体 compose 直路（无会话继承）→ capacity_forecast · runAgentLoop 零调用", () => {
  it("qos.compose-path 开 · 自由变体落 path-B → compose 跑 capacity_forecast · agentRequests==0（不掉回 agent 盲跳）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} }); // 强制落 path-B
    const composeSpy = vi.spyOn(t.llm, "compose");
    const invoked = spySolver(t);

    const { taskId } = await submitQuery(t, ADMIN, VARIANT_Q, { view: "project", selectedObjects: MODEL_SEL });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(t.llm.agentRequests.length).toBe(0); // 命门：组合路径全程不落 runAgentLoop
    const cf = invoked.find((i) => i.key === "capacity_forecast");
    expect(cf).toBeTruthy();
    expect(cf!.args).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.1, weeks: 8 });
    expect(composeSpy).toHaveBeenCalledTimes(1); // 一次综合
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WO-AGENT-RUNTIME-S01 · SEAM ③ 停滞早停（连续工具失败 + 无成功产出 → 预算耗尽前早 degrade）", () => {
  it("脚本化连续 invoke_solver ERROR（无成功产出）→ loop 在 ~3 轮早 degrade（<< maxIterations 24）·BUDGET_EXHAUSTED", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} }); // path-B
    // invoke_solver 恒 throw → 执行器归一为 ERROR（isError）·无成功工具产出。
    t.dataCore.solver.invoke = async () => {
      throw new Error("solver boom (scripted stall)");
    };
    // 排满 20 轮 invoke_solver 失败（远超 maxIterations）——若无早停会烧到 24 轮。
    for (let i = 0; i < 20; i++) {
      t.llm.queueAgentTurn(() => ({ content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: {} })] }));
    }

    const { taskId } = await submitQuery(t, ADMIN, "把能查的求解器都跑一遍给我个可承接结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);

    expect(task.status).toBe("COMPLETED");
    // ★ 早停：连续失败 3 次 + 近 2 轮零成功 → 约 3 轮就 degrade（远小于 24 轮预算·不烧满）。
    expect(t.llm.agentRequests.length).toBeLessThanOrEqual(6);
    expect(t.metrics.agentBudgetExhausted.get()).toBe(1);
    // 降级事件 agent_degraded（BUDGET_EXHAUSTED）。
    const events = await t.repos.events.listAfter(taskId, 0);
    const degrade = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
    expect((degrade?.payload as { outcome?: string })?.outcome).toBe("BUDGET_EXHAUSTED");
    await t.app.close();
  });

  it("不误伤「先错后恢复」：失败与成功工具交替 → 计数复位 → 不早停·正常收尾", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    // invoke_solver throw（失败）；query_objects 走 mock 本体（成功）。
    t.dataCore.solver.invoke = async () => {
      throw new Error("solver boom");
    };
    // 交替：失败轮 → 成功轮 → 失败轮 → 成功轮 → final_answer 收尾（连续失败从不达 3·停滞早停不触发）。
    t.llm.queueAgentTurn(
      () => ({ content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: {} })] }),
      () => ({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] }),
      () => ({ content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: {} })] }),
      () => ({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] }),
      () => ({ content: [text("综合如上"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "已据可用数据作答。" }], provenance: [] })] }),
    );

    const { taskId } = await submitQuery(t, ADMIN, "先看订单再看基地给结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);

    // 正常经 final_answer 收尾（非早停降级）——跑满 5 轮才收尾，证成功产出复位了停滞计数（不误伤）。
    expect(t.llm.agentRequests.length).toBe(5);
    expect(t.metrics.agentBudgetExhausted.get()).toBe(0);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("已据可用数据作答。");
    expect(md).not.toMatch(/预算耗尽·诚实摘要/);
    await t.app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("WO-AGENT-RUNTIME-S01 · SEAM ④ 字节兼容（原 S01 + 真开放题路由不变·加性）", () => {
  it("原 S01（presetSlots·无继承）→ deterministic:scenario-bind · path-A · runAgentLoop 零调用（逐字节不变）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    const { taskId } = await submitQuery(t, ADMIN, S01_TRIGGER, {
      view: "project", scenarioIntentKey: "capacity_feasibility", scenarioKey: "S01",
      selectedObjects: MODEL_SEL, presetSlots: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("deterministic:scenario-bind");
    expect(task.path).toBe("WORKFLOW");
    expect(t.llm.agentRequests.length).toBe(0);
    await t.app.close();
  });

  it("真开放题（非可行性变体）仍走 path-B agent（不被变体路由误劫持）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "开放题 path-B 答案" }], provenance: [] })],
    }));
    const { taskId } = await submitQuery(t, ADMIN, "综合分析连锁影响给个整体结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.path).toBe("AGENT");
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 真落 path-B（既有行为不变）
    await t.app.close();
  });
});
