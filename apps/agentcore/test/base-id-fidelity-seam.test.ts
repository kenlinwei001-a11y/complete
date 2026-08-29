import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import {
  parseCapacityFeasibilityVariant,
  feasibilityComposeSlots,
  buildFeasibilityNavSlice,
} from "../src/agent/sim-planner.js";
import { compileSolverPlan } from "../src/router/compile-plan.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { collectSlotRefs } from "../src/util/template.js";

/**
 * WO-BASE-ID-FIDELITY 症① · 数据/路由半 SEAM（agentcore：base 从 NL 解析 → compose → capacity_forecast args·真穿到求解器）。
 *
 * 病根：capacity_feasibility 意图槽 [model,demandDelta,weeks] **无 base 槽**（seed.ts）+ sim-planner
 *   parseCapacityFeasibilityVariant 只抽 {modelId,demandDelta,weeks} → 「常州基地 4680-NCM 加20%」的基地被静默丢 →
 *   capacity_forecast 恒全网 3 基地合计 → 与「4680-NCM 加20%」答案相同（引擎半 base 作用域见 datacore/test）。
 *
 * 本门驱动路由半接缝：parse「XX基地」→ baseId → feasibilityComposeSlots 带 base → compileSolverPlan 编入 solver args（compile-plan
 *   :111-112 非必填槽也带）；且 seed 意图声明 base 槽 + plan 专门透传 {{slots.base}}（fillSlots 才不丢·门 check-arg-drop-seam 守）。
 */

const CHANGZHOU_Q = "常州基地 4680-NCM 加20% 六周能不能接";
const NETWORK_Q = "4680-NCM 加20% 六周能不能接";

describe("WO-BASE-ID-FIDELITY 症① · 路由半解析/组合（纯函数 R6·无 LLM）", () => {
  it("parseCapacityFeasibilityVariant：「XX基地」→ baseId（三形态：常州基地/中文名/裸 baseId）；无基地 → 不带 baseId（全网·fail-safe）", () => {
    const a = parseCapacityFeasibilityVariant(CHANGZHOU_Q);
    const b = parseCapacityFeasibilityVariant(CHANGZHOU_Q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 同问句同解析
    expect(a).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.2, weeks: 6, baseId: "changzhou" });
    // 中文名（无「基地」后缀）/ 裸 baseId 亦命中。
    expect(parseCapacityFeasibilityVariant("常州 4680-NCM 加20% 六周能不能接").baseId).toBe("changzhou");
    expect(parseCapacityFeasibilityVariant("changzhou 4680-NCM 加20% 六周能不能接").baseId).toBe("changzhou");
    // ★ 无基地 → baseId undefined（不臆造·capacity_forecast 全网 scope:ALL）。
    expect(parseCapacityFeasibilityVariant(NETWORK_Q).baseId).toBeUndefined();
  });

  it("feasibilityComposeSlots：带基地 → slots.base=baseId；无基地 → 无 base 键（compile 直传 solver args）", () => {
    expect(feasibilityComposeSlots(CHANGZHOU_Q)).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.2, weeks: 6, base: "changzhou" });
    expect("base" in feasibilityComposeSlots(NETWORK_Q)).toBe(false);
  });

  it("compileSolverPlan：base 编入 capacity_forecast solver args（跨 compose 接缝·非各半绿）；无基地则 args 无 base", () => {
    const withBase = compileSolverPlan(CHANGZHOU_Q, buildFeasibilityNavSlice(), feasibilityComposeSlots(CHANGZHOU_Q));
    expect(withBase.ok).toBe(true);
    if (withBase.ok) {
      const cf = withBase.plan.steps.find((s) => s.solverKey === "capacity_forecast")!;
      // ★ 命门：base 真穿到 capacity_forecast args（此前丢 → 恒全网）。
      expect(cf.args).toMatchObject({ modelId: "4680-NCM", demandDelta: 0.2, weeks: 6, base: "changzhou" });
    }
    const noBase = compileSolverPlan(NETWORK_Q, buildFeasibilityNavSlice(), feasibilityComposeSlots(NETWORK_Q));
    if (noBase.ok) {
      const cf = noBase.plan.steps.find((s) => s.solverKey === "capacity_forecast")!;
      expect("base" in cf.args).toBe(false); // 无基地 → solver 全网 scope:ALL
    }
  });

  it("seed 意图/计划：capacity_feasibility 声明 base 槽 + plan invoke_solver 透传 {{slots.base}}（fillSlots 不丢·门守）", () => {
    const { intents, plans } = seedIntentsAndPlans("demo");
    const intent = intents.find((i) => i.key === "capacity_feasibility")!;
    expect(intent.slots.some((s) => s.name === "base")).toBe(true); // 声明半
    const plan = plans.find((p) => p.id === intent.planId)!;
    const refs = collectSlotRefs(plan.steps);
    expect(refs.has("base")).toBe(true); // 透传半（plan args 引用 {{slots.base}}）
    const cf = plan.steps.find((s) => s.type === "invoke_solver")!;
    expect(JSON.stringify(cf.params?.args)).toContain("{{slots.base}}");
  });
});

describe("WO-BASE-ID-FIDELITY 症① · compose 直路端到端（NL 解析 → compose → capacity_forecast 真收到 base）", () => {
  function spySolver(t: TestApp): { key: string; args: Record<string, unknown> }[] {
    const invoked: { key: string; args: Record<string, unknown> }[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push({ key, args });
      return orig(ctx, key, args);
    };
    return invoked;
  }

  it("qos.compose-path 开 · 「常州基地 4680-NCM 加20% 六周能不能接」→ capacity_forecast args.base='changzhou'（base 穿到求解器）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} }); // 强制落 path-B → compose
    const invoked = spySolver(t);

    const { taskId } = await submitQuery(t, ADMIN, CHANGZHOU_Q, { view: "project" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const cf = invoked.find((i) => i.key === "capacity_forecast");
    expect(cf, "capacity_forecast 应被调用").toBeTruthy();
    // ★ 命门：base 真穿到求解器 args（跨 router×compose×solver 接缝·非各半 unit）。
    expect(cf!.args.base).toBe("changzhou");
    expect(cf!.args).toMatchObject({ demandDelta: 0.2, weeks: 6 });
    await t.app.close();
  });

  it("无基地「4680-NCM 加20% 六周能不能接」→ capacity_forecast 不带 base（全网·诚实不冒充某基地）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const invoked = spySolver(t);

    const { taskId } = await submitQuery(t, ADMIN, NETWORK_Q, { view: "project" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const cf = invoked.find((i) => i.key === "capacity_forecast");
    expect(cf).toBeTruthy();
    expect(cf!.args.base == null).toBe(true); // 无 base（或 null）→ 全网 scope:ALL
    await t.app.close();
  });
});
