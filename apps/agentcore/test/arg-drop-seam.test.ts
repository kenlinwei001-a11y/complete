import { describe, expect, it } from "vitest";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { collectSlotRefs } from "../src/util/template.js";
import { resolveCeoRoute, ceoIntentKeyForRoute, CEO_INTENT_KEYS } from "../src/router/ceo-route.js";

/**
 * WO-SEAM-ARG-DROP · 数据半守卫（agentcore 包内快测·配合 datacore 全接缝测 arg-drop-seam.test.ts）。
 * 守 R-ARG-FIDELITY 结构不变量：CEO 意图的 plan solverArgs 里每个 {{slots.X}} 都有对口声明槽（无孤儿模板引用 →
 * 无运行期 TemplateResolutionError），且两 CONFIRMED 项（custName/scopeObjectIds）真进声明。
 */
describe("SEAM-ARG-DROP · CEO 种子数据半（slotNames × plan 模板 一致）", () => {
  const { intents, plans } = seedIntentsAndPlans("demo");
  const intentByKey = new Map(intents.map((i) => [i.key, i]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  it("每个 CEO 意图：plan solverArgs 的 {{slots.X}} 引用 ⊆ 声明槽（无孤儿模板引用）", () => {
    for (const key of CEO_INTENT_KEYS) {
      const intent = intentByKey.get(key);
      expect(intent, `缺 CEO 意图 ${key}`).toBeTruthy();
      const declared = new Set((intent!.slots ?? []).map((s) => s.name));
      const plan = planById.get(intent!.planId)!;
      const invoke = (plan.steps as { type: string; params?: { args?: unknown } }[]).find((s) => s.type === "invoke_solver");
      const refs = invoke ? collectSlotRefs(invoke.params?.args ?? {}) : new Set<string>();
      for (const r of refs) {
        expect(declared.has(r), `意图 ${key} 的 plan 引用 {{slots.${r}}} 但未声明为槽（会 TemplateResolutionError）`).toBe(true);
      }
    }
  });

  it("CONFIRMED-1 ceo_credit_exposure：custName 已声明为槽 + plan 映射 {{slots.custName}}", () => {
    const intent = intentByKey.get("ceo_credit_exposure")!;
    expect((intent.slots ?? []).map((s) => s.name)).toContain("custName");
    const plan = planById.get(intent.planId!)!;
    const invoke = (plan.steps as { type: string; params: { args: unknown } }[]).find((s) => s.type === "invoke_solver")!;
    expect([...collectSlotRefs(invoke.params.args)]).toContain("custName");
    // 数据半 seam：credit 深问路由真解析出 custName（供该槽承接）。
    const route = resolveCeoRoute("电网公司F 的信用敞口有多大？", undefined, "ceo");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_credit_exposure");
    expect((route.args as { custName?: string }).custName).toBe("电网公司");
  });

  it("CONFIRMED-2 ceo_whatif：槽名对齐路由输出 scopeObjectIds（非 baseId）+ plan 映射 {{slots.scopeObjectIds}}", () => {
    const intent = intentByKey.get("ceo_whatif")!;
    const names = (intent.slots ?? []).map((s) => s.name);
    expect(names).toContain("scopeObjectIds");
    expect(names).not.toContain("baseId"); // 修前的错名（路由发 scopeObjectIds → 会丢）
    const plan = planById.get(intent.planId!)!;
    const invoke = (plan.steps as { type: string; params: { args: unknown } }[]).find((s) => s.type === "invoke_solver")!;
    expect([...collectSlotRefs(invoke.params.args)]).toContain("scopeObjectIds");
    // 数据半 seam：whatif 深问路由真发 scopeObjectIds（数组·供 json 槽承接）。
    const route = resolveCeoRoute("常州化成扩2通道能补多少缺口？", { focus: { base: "changzhou" } } as never, "ceo");
    expect((route.args as { scopeObjectIds?: string[] }).scopeObjectIds).toEqual(["changzhou"]);
  });
});
