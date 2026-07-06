import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT, debugHeaders } from "./helpers.js";

/**
 * QUERY30 缺口③ Q01 样板 · 意图经 ONTO-SCEN 发育管道长成场景卡（DESIGN-query30 §2.5/§3）。
 * 铁律：**非 seed 手装 GOVERNED 卡**——卡 PROVISIONAL/DRAFT 起，maturity 由 growScenario 亲手把 triggerQuestion
 * 经 QOS 路径 A 跑通验证后设定，留痕 ScenarioOntogenesisRun（前端可见来源·闭 G-9）。
 * 意图 `what_if_displacement_q` + 计划 `plan_what_if_displacement_q_v1` 已注册（seed 一等·**不入 SCENARIO_CATALOG**·避横铺）。
 */
describe("QUERY30 缺口③ Q01 · 接单挤占推演意图经发育管道长成卡", () => {
  it("意图+计划一等注册（seed·不入 SCENARIO_CATALOG）：what_if_displacement_q → what_if_displacement 求解器", async () => {
    const t = await createTestApp();
    // 触发本租户场景包幂等 seed（含 4 内置 + Q01 一等意图/计划）。
    await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) });
    const intents = await t.repos.intents.listByPackage(PKG);
    const q01 = intents.find((i) => i.key === "what_if_displacement_q");
    expect(q01, "what_if_displacement_q 意图应一等注册").toBeDefined();
    expect(q01!.status).toBe("PUBLISHED");
    const plans = await t.repos.plans.listByPackage(PKG);
    const plan = plans.find((p) => p.key === "what_if_displacement_q");
    expect(plan, "Q01 计划应一等注册").toBeDefined();
    const solverStep = plan!.steps.find((s) => s.type === "invoke_solver");
    expect((solverStep!.params as { solverKey: string }).solverKey).toBe("what_if_displacement");
    void TENANT;
  });

  it("发育管道长成卡：DRAFT 创建 → 发布 → grow → 留痕 ScenarioOntogenesisRun + maturity 由发育设定（非手装）", async () => {
    const t = await createTestApp();
    // 1) 一等创建 Q01 卡（DRAFT·maturity 未设·非手装 GOVERNED）——挂 Q01 意图 + 挤占推演求解器 + C34/C35。
    const create = await t.app.inject({
      method: "POST", url: "/b/v1/scenarios", headers: debugHeaders(ADMIN),
      payload: {
        scenarioKey: "Q01", name: "接单挤占推演", targetView: "project",
        intentKey: "what_if_displacement_q",
        triggerQuestion: "4680-NCM 加 20% 六周能不能接？会挤占哪些订单？",
        solver: "what_if_displacement", rules: ["C34", "C35"], mode: "WORKFLOW_FIRST",
        presetContext: {
          targetView: "project",
          selectedObjects: [
            { objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" },
            { objectType: "Base", objectId: "常州", label: "常州" },
          ],
          slotPresets: { qty: 4200, advancePct: 0.2, weeks: 6 },
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { status: string; maturity?: string };
    expect(created.status).toBe("DRAFT");
    expect(created.maturity).toBeUndefined(); // 未手装成熟度——由发育管道设定

    // 2) 发布 → PUBLISHED（仍未 grow·maturity 未定）。
    const pub = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/Q01/publish", headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);

    // 3) grow：亲手把 triggerQuestion 经 QOS 路径 A（scenarioIntentKey→deterministic:scenario-bind）跑通验证。
    const grow = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/Q01/grow", headers: debugHeaders(ADMIN) });
    expect(grow.statusCode).toBe(200);
    const run = grow.json() as {
      runId: string; scenarioKey: string; rings: { data: boolean; ontology: boolean; capability: boolean };
      verification: { status: string; path: string; answerPreview: string | null }; maturity: string;
    };
    // 发育 run 留痕真实产出（非手装）。
    expect(run.runId).toBeTruthy();
    expect(run.scenarioKey).toBe("Q01");
    expect(run.rings.capability).toBe(true); // 意图发布 + 计划可绑定
    expect(run.rings.ontology).toBe(true);   // 意图/计划已落库
    expect(run.rings.data).toBe(true);       // triggerQuestion 经路径 A 真跑出挤占推演答案（非空非兜底）
    expect(run.verification.path).toBe("WORKFLOW");
    expect(run.verification.status).toBe("VERIFIED");
    expect(run.verification.answerPreview).toBeTruthy();
    expect(run.maturity).toBe("GOVERNED"); // 发育验证真出答案 → GOVERNED（由 grow 计算·非 seed 手装）

    // 4) 留痕落卡 → manage 可见来源（前端"知道从哪来、发育到哪一步"）。
    const manage = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) })).json()) as { scenarioKey: string; maturity?: string; lastOntogenesisRun?: { runId: string; verification: { status: string } } }[];
    const q01 = manage.find((s) => s.scenarioKey === "Q01")!;
    expect(q01.maturity).toBe("GOVERNED");
    expect(q01.lastOntogenesisRun?.runId).toBe(run.runId);
    expect(q01.lastOntogenesisRun?.verification.status).toBe("VERIFIED");
  });
});
