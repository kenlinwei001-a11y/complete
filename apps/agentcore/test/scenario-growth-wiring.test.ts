import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT, debugHeaders } from "./helpers.js";
import type { ExecutionPlan, IntentDefinition, Scenario } from "@platform/contracts";

/**
 * 轨 F · 自成长发育闭环 P3（G-9 收尾）· O9 wiring 验收。
 *
 * O9 = growScenario 首验未通过且缺口可自动补（AUTO_DERIVE）→ 触发 runGrowthLoop（探针→补齐→重跑→收敛），
 * 收敛后重验，真出可验证答案才标 GOVERNED（RL4 不放水）；补不上的卡诚实保持 PROVISIONAL + 开 GrowthTicket（不静默/不假装）。
 *
 * 关键点：被调 runGrowthLoop / probe / fill **零重写**（RL3，单源 buildGrowthLoopWiring 与 /api/v1/growth/run 共用）。
 * 本测覆盖：① 缺件卡 grow → 触发自成长 LOOP（账本留痕 + 发 scenario.growth_triggered）；
 *          ② 边界诚实门：补不上 → PROVISIONAL + GrowthTicket，绝不假标 GOVERNED；
 *          ③ 已就绪卡（S01）grow 不触发 LOOP（无谓不浪费）。
 */
describe("O9 · growScenario 自动调 runGrowthLoop（缺件→自动补→诚实定级）", () => {
  it("缺件卡（无意图死路）grow → 触发自成长 LOOP（账本+ growth_triggered 事件）→ 诚实 PROVISIONAL + GrowthTicket（不假 GOVERNED）", async () => {
    const t = await createTestApp();
    // 缺件卡：指向不存在的意图（capability 死路）→ 首验 gapCode=MISSING_INTENT（AUTO_DERIVE）。
    const scenario: Scenario = {
      id: `scn_${TENANT}_GAP_CARD`,
      tenantId: TENANT,
      scenarioKey: "GAP_CARD",
      name: "缺件发育样本",
      targetView: "risk",
      intentKey: "nonexistent_intent_for_growth",
      triggerQuestion: "缺件卡：能自动长成可答吗？",
      solver: "",
      rules: [],
      riskLevel: "COMPUTE",
      summary: "O9 缺件样本",
      mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      status: "DRAFT",
      version: 1,
    };
    await t.repos.scenarios.upsert(scenario);

    // 监听场景通道 SSE 事件（scenario.growth_triggered 经 deps.events.emit 落 query_events）。
    const before = await t.repos.growthLedger.listByTenant(TENANT);
    expect(before.length).toBe(0);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/GAP_CARD/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { gapCode: string | null }; gaps: { gapCode: string; disposition: string }[] };

    // 诚实门（RL4）：补不上 → 不假标 GOVERNED。
    expect(run.maturity).toBe("PROVISIONAL");
    expect(run.gaps[0]?.disposition).toBe("AUTO_DERIVE"); // 缺意图=可自动补类（触发 LOOP）

    // O9 触发了 runGrowthLoop：成长账本留痕（demand-indexed）。
    const ledger = await t.repos.growthLedger.listByTenant(TENANT);
    expect(ledger.length).toBe(1);
    expect(ledger[0]!.report.question).toBe("缺件卡：能自动长成可答吗？");
    expect(["BOUNDARY", "MAX_ROUNDS"]).toContain(ledger[0]!.report.terminalState); // 缺件补不上 → 边界/未收敛

    // 诚实开 GrowthTicket（不静默）。
    const tickets = await t.repos.growthTickets.listByTenant(TENANT);
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    expect(tickets[0]!.status).toBe("OPEN");
    expect(tickets[0]!.fromQuestion).toBe("缺件卡：能自动长成可答吗？");

    // scenario.growth_triggered 事件已发（场景通道）。
    const events = await t.repos.events.listAfter("GAP_CARD", 0);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(true);
  });

  it("已就绪卡 S01 grow → 首验即 VERIFIED → 不触发 LOOP（无谓不浪费）→ GOVERNED", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { status: string } };
    expect(run.maturity).toBe("GOVERNED");
    expect(run.verification.status).toBe("VERIFIED");
    // 首验即通过 → 未触发自成长 LOOP（账本为空）。
    const ledger = await t.repos.growthLedger.listByTenant(TENANT);
    expect(ledger.length).toBe(0);
    const events = await t.repos.events.listAfter("S01", 0);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(false);
    expect(events.some((e) => e.event === "scenario.matured")).toBe(true);
  });

  it("RENDER_NOT_PROJECTED 纯指针卡 grow → 触发 LOOP（gapCode 可自动补类）但补不上 → PROVISIONAL + 诚实门保持（不假 GOVERNED）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "growth_pointer_only";
    const planId = "plan_growth_pointer_only_v1";
    const plan: ExecutionPlan = {
      id: planId, packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "明细见对应视图（无投影）。" }] } }],
    };
    const intent: IntentDefinition = {
      id: "int_growth_pointer_only_v1", packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      name: "纯指针发育样本", description: "无求解器投影占位卡", examples: ["纯指针发育问题"],
      enabledViews: "*", slots: [], planId, riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_GROWTH_POINTER`, tenantId: TENANT, scenarioKey: "GROWTH_POINTER",
      name: "纯指针发育样本", targetView: "risk", intentKey, triggerQuestion: "纯指针发育问题",
      solver: "", rules: [], riskLevel: "COMPUTE", summary: "诚实门发育样本", mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} }, status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/GROWTH_POINTER/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { gapCode: string | null } };
    // 首验 RENDER_NOT_PROJECTED（COMPLETED 但无承载数据）→ 触发 LOOP（在自动补类集合内）→ 补不上 → 诚实 PROVISIONAL。
    expect(run.maturity).toBe("PROVISIONAL");
    const ledger = await t.repos.growthLedger.listByTenant(TENANT);
    expect(ledger.length).toBe(1); // LOOP 真触发
    const events = await t.repos.events.listAfter("GROWTH_POINTER", 0);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(true);
  });
});

/**
 * O12 · ADVISORY 三态成熟（PROVISIONAL → ADVISORY → GOVERNED）验收。
 *
 * ADVISORY = 发育闭环经路径 B 探索（AGENT）自动推出非空、非 gap、非兜底答案，但未达 dataBearing 的 GOVERNED 标尺
 * ——自动发育所得、待人工坐实的中间态。诚实门（RL4）：不冒充 GOVERNED（未投影承载数据），也不含糊降级 PROVISIONAL（确有 advisory 答案）。
 * 关键边界：路径 A 工作流只渲染静态占位文本（RENDER_NOT_PROJECTED）≠ advisory（见上方 GROWTH_POINTER 仍 PROVISIONAL）。
 */
describe("O12 · ADVISORY 三态（自动发育所得待人工坐实，不冒充 GOVERNED 不降格 PROVISIONAL）", () => {
  it("grow 一张路径B探索出非空答案的卡（capability 在但当前视图无候选→agent 推出 advisory 答案）→ maturity=ADVISORY（诚实中间态）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "advisory_sample_intent";
    const planId = "plan_advisory_sample_v1";
    // 意图/计划已发布（capabilityOk=true），但 enabledViews 限定到 dash；卡 targetView=risk（错配）
    // → 该视图候选为空 → 跳过确定性绑定 → 走路径 B（agent 探索）。
    const plan: ExecutionPlan = {
      id: planId, packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "占位" }] } }],
    };
    const intent: IntentDefinition = {
      id: "int_advisory_sample_v1", packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      name: "ADVISORY 样本意图", description: "advisory 中间态样本", examples: ["advisory 样本问题"],
      enabledViews: ["dash"], slots: [], planId, riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_ADVISORY`, tenantId: TENANT, scenarioKey: "ADVISORY_CARD",
      name: "ADVISORY 样本", targetView: "risk", intentKey, triggerQuestion: "advisory 样本问题：本体外探索能给个参考吗？",
      solver: "", rules: [], riskLevel: "COMPUTE", summary: "advisory 样本", mode: "AGENT_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} }, status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    // 路径 B：分类 outOfCatalog + agent 给出**非空文本**最终答案（非 gap/非兜底，但无承载数据块）。
    // grow 首验 + 自成长 LOOP 探针会多次跑 QOS → 备足若干轮 agent turn（确定性、文本一致）。
    for (let i = 0; i < 8; i++) {
      t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
      t.llm.queueAgentTurn({ content: [{ type: "text", text: "参考分析" }, { type: "tool_use", id: `tu${i}`, name: "final_answer", input: { blocks: [{ type: "text", markdown: "据现有本体外推：建议关注产能与物流双约束（参考性，待人工核实）。" }], provenance: [] } }] } as never);
    }

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/ADVISORY_CARD/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { status: string; path: string } };
    // 三态诚实定级：路径 B 推出非空 advisory 答案、未达数据承载 GOVERNED → ADVISORY（不冒充 GOVERNED，不降格 PROVISIONAL）。
    expect(run.verification.path).toBe("AGENT");
    expect(run.maturity).toBe("ADVISORY");
    expect(run.maturity).not.toBe("GOVERNED"); // RL4：未投影承载数据，绝不冒充 GOVERNED
    // 留痕落卡，manage 可见 ADVISORY 相位。
    const manage = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) })).json()) as { scenarioKey: string; maturity?: string }[];
    expect(manage.find((s) => s.scenarioKey === "ADVISORY_CARD")?.maturity).toBe("ADVISORY");
  });
});

/**
 * O11 · 自动 planSlice（growScenario 据卡 sliceTargets 自动调 DataCore /a/v1/slices/plan 把切片纳入发育闭环）。
 *
 * 复用既有 OBO 客户端模式（OntologyClient.planSlice，透传用户 JWT/X-Debug-User）。DoD：声明 sliceTargets 的卡 grow → 真调
 * planSlice 出切片（事件携 plannedSlices）；规划不可达（NO_PATH）→ 诚实出 NO_SLICE 缺口，不静默；切片未长齐 → maturity 不得 GOVERNED。
 */
describe("O11 · growScenario 自动调 planSlice（sliceTargets→切片，诚实 NO_SLICE 不静默）", () => {
  const baseCard = (overrides: Partial<Scenario>): Scenario => ({
    id: `scn_${TENANT}_${overrides.scenarioKey}`, tenantId: TENANT, scenarioKey: "X", name: "切片样本",
    targetView: "capacity_view", intentKey: "capacity_feasibility", triggerQuestion: "4680-NCM 加 20% 六周产能？",
    solver: "", rules: [], riskLevel: "COMPUTE", summary: "O11 样本", mode: "WORKFLOW_FIRST",
    presetContext: { targetView: "capacity_view", selectedObjects: [], slotPresets: { model: { objectId: "4680-NCM" }, demandDelta: 0.2, weeks: 6 } as never },
    status: "PUBLISHED", version: 1, ...overrides,
  });

  it("声明可达 sliceTargets 的卡 grow → 真调 planSlice 出切片（事件携 plannedSlices）→ 无 NO_SLICE 缺口", async () => {
    const t = await createTestApp();
    await t.repos.scenarios.upsert(baseCard({
      scenarioKey: "SLICE_OK",
      sliceTargets: [{ rootType: "Order", targets: ["Model", "Base"] }],
    }));
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/SLICE_OK/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; gaps: { gapCode: string }[] };
    // planSlice 真被调用且可达 → 无 NO_SLICE 缺口。
    expect(run.gaps.some((g) => g.gapCode === "NO_SLICE")).toBe(false);
    // 事件携规划出的 sliceKey（确定性 biz.Order.Model_Base）。
    const events = await t.repos.events.listAfter("SLICE_OK", 0);
    const matured = events.find((e) => e.event === "scenario.matured" || e.event === "scenario.gap_detected");
    const planned = (matured?.payload as { plannedSlices?: string[] } | undefined)?.plannedSlices ?? [];
    expect(planned).toContain("biz.Order.Model_Base");
  });

  it("声明不可达 sliceTargets（NO_PATH）的卡 grow → 诚实出 NO_SLICE 缺口（NEEDS_HUMAN）→ 切片未长齐不冒充 GOVERNED", async () => {
    const t = await createTestApp();
    await t.repos.scenarios.upsert(baseCard({
      scenarioKey: "SLICE_NOPATH",
      sliceTargets: [{ rootType: "Order", targets: ["__unreachable_Type"] }],
    }));
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/SLICE_NOPATH/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; gaps: { gapCode: string; disposition: string }[] };
    // 诚实门：不可达 → NO_SLICE 缺口（不静默），NEEDS_HUMAN（需补本体链路）。
    const noSlice = run.gaps.find((g) => g.gapCode === "NO_SLICE");
    expect(noSlice).toBeDefined();
    expect(noSlice!.disposition).toBe("NEEDS_HUMAN");
    // 切片未长齐 → 即便答案验证通过也封顶 ADVISORY，绝不冒充 GOVERNED。
    expect(run.maturity).not.toBe("GOVERNED");
  });
});
