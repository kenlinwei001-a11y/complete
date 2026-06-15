import { describe, expect, it } from "vitest";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { fillSlots } from "../src/router/slots.js";

/**
 * G-1（系统本体 §8）回归：20 场景目录此前仅 4 个有意图/执行计划，其余 16 个路径A 够不着。
 * 本测试断言种子从 SCENARIO_CATALOG 单一来源派生出**全部 20** 个意图+计划，且每个意图绑定的
 * 执行计划真实存在、含 ≥1 步、首个非渲染步对齐场景声明的求解器 —— 场景→意图→计划→求解器全链接通。
 */
describe("G-1 · 20 场景全部接通意图与执行计划（场景→意图→计划→求解器）", () => {
  const { intents, plans } = seedIntentsAndPlans();
  const intentByKey = new Map(intents.map((i) => [i.key, i]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  it("每个场景目录卡都有同 key 的已发布意图", () => {
    for (const card of SCENARIO_CATALOG) {
      const intent = intentByKey.get(card.intentKey);
      expect(intent, `场景 ${card.sNo} 缺意图 ${card.intentKey}`).toBeTruthy();
      expect(intent!.status).toBe("PUBLISHED");
    }
    // 20 个意图键全覆盖（不再只有 4 个）
    expect(SCENARIO_CATALOG.every((c) => intentByKey.has(c.intentKey))).toBe(true);
    expect(intents.length).toBeGreaterThanOrEqual(SCENARIO_CATALOG.length);
  });

  it("每个意图绑定的执行计划存在、已发布、含 ≥1 步", () => {
    for (const card of SCENARIO_CATALOG) {
      const intent = intentByKey.get(card.intentKey)!;
      const plan = planById.get(intent.planId!);
      expect(plan, `意图 ${card.intentKey} 的计划 ${intent.planId} 不存在`).toBeTruthy();
      expect(plan!.status).toBe("PUBLISHED");
      expect(plan!.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan!.steps[plan!.steps.length - 1]!.type).toBe("render_answer"); // 末步必为渲染
    }
  });

  // 4 个预置场景的计划为手写（可能用 resolve_slice 等结构，已由各自测试覆盖）；
  // 本断言只校验 G-1 新派生的 16 个：计划须 invoke_solver 其声明的求解器（sop_balance 除外）。
  const PRESEEDED = new Set(["capacity_feasibility", "affected_orders", "risk_root_cause", "adopt_mitigation"]);
  it("G-1 新派生场景的计划调用其声明的求解器；ACTION_DRAFT 风险级一致", () => {
    const generated = SCENARIO_CATALOG.filter((c) => !PRESEEDED.has(c.intentKey));
    expect(generated.length).toBe(16); // 确认确实补了 16 个
    for (const card of generated) {
      const plan = planById.get(intentByKey.get(card.intentKey)!.planId!)!;
      if (card.solver !== "sop_balance") {
        const solverStep = plan.steps.find((s) => s.type === "invoke_solver") as { params: { solverKey: string } } | undefined;
        expect(solverStep, `场景 ${card.sNo} 计划未 invoke_solver`).toBeTruthy();
        expect(solverStep!.params.solverKey).toBe(card.solver);
      }
      const intent = intentByKey.get(card.intentKey)!;
      if (card.riskLevel === "ACTION_DRAFT") expect(intent.riskLevel).toBe("ACTION_DRAFT");
    }
  });

  /**
   * R11 全链闭包 · 场景启动器零反问门（PRD-scenario-launcher §3.6/§7）：
   * 每张场景卡经启动器注入 presetContext（selectedObjects + slotPresets → SessionContext）后，
   * 其意图的**必填槽位必须全部被满足**（fillSlots.missing 为空），否则点场景启动会触发反问澄清、
   * "打开即可推演"破功。此门以运行时真跑 fillSlots 校验（比静态解析更可靠），故障注入（删某卡
   * slotPreset / 去掉 objectRef 的 defaultFrom）即变红。
   */
  it("R11 零反问：每张场景卡 presetContext 注入后必填槽位全满足（fillSlots 无 missing）", async () => {
    // objectRef 校验只需能解析；用确定性桩，避免依赖真实本体/网络（R6 测试不依赖网络）。
    const ontology = {
      getObject: async (_ctx: unknown, objectType: string, objectId: string) => ({ data: { objectType, objectId, name: objectId } }),
    } as unknown as Parameters<typeof fillSlots>[3];
    const ctx = { tenantId: "demo", userId: "u", roles: [], token: "t" } as unknown as Parameters<typeof fillSlots>[4];
    for (const card of SCENARIO_CATALOG) {
      const intent = intentByKey.get(card.intentKey)!;
      const context = {
        view: card.presetContext.targetView,
        selectedObjects: card.presetContext.selectedObjects,
        filters: {},
        presetSlots: card.presetContext.slotPresets,
      } as unknown as Parameters<typeof fillSlots>[2];
      const { missing } = await fillSlots(intent, {}, context, ontology, ctx);
      expect(missing.map((m) => m.name), `场景 ${card.sNo}(${card.intentKey}) 启动后仍反问槽位: [${missing.map((m) => m.name).join(", ")}]`).toEqual([]);
    }
  });
});
