import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN, PLANNER, TENANT } from "./helpers.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";

const list = (t: Awaited<ReturnType<typeof createTestApp>>, qs = "") =>
  t.app
    .inject({ method: "GET", url: `/b/v1/scenarios${qs}`, headers: debugHeaders(PLANNER) })
    .then((r) => r.json() as { launcherEnabled: boolean; total: number; items: { sNo: string; view: string; intentKey: string; triggerQuestion: string; summary: string; willProduceDraft: boolean; presetContext: { targetView: string; slotPresets: Record<string, unknown> } }[] });

describe("20 场景目录 §9 — 场景启动器（SL1/SL2）", () => {
  it("SL1: 20 卡齐全，每卡含意图/触发问句/一句话说明/presetContext（保证一键可推演）", async () => {
    const t = await createTestApp();
    const { items, total } = await list(t);
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(total).toBe(SCENARIO_CATALOG.length); // 端点 total vs 目录源·互校
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(items).toHaveLength(SCENARIO_CATALOG.length);
    for (const c of items) {
      expect(c.intentKey).toBeTruthy();
      expect(c.triggerQuestion.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.presetContext.targetView).toBe(c.view); // 预置上下文跳转目标 = 卡视图
    }
    // ACTION_DRAFT 类带"将产生待审批草稿"角标
    const adopt = items.find((c) => c.sNo === "S06");
    expect(adopt!.willProduceDraft).toBe(true);
    const compute = items.find((c) => c.sNo === "S01");
    expect(compute!.willProduceDraft).toBe(false);
  });

  it("SL1: 卡片数据来自单一来源目录（与 SCENARIO_CATALOG 一致）", async () => {
    const t = await createTestApp();
    const { items } = await list(t);
    expect(items.map((c) => c.sNo).sort()).toEqual(SCENARIO_CATALOG.map((c) => c.sNo).sort());
  });

  it("SL2: 关闭 risk 视图 feature → 该视图下的场景卡从 active 列表消失；includeInactive 仍可见且标记", async () => {
    const t = await createTestApp();
    const riskCards = SCENARIO_CATALOG.filter((c) => c.view === "risk").map((c) => c.sNo);
    expect(riskCards.length).toBeGreaterThan(0);

    t.deps.features.mock.disable(TENANT, "view.risk-board");
    const active = await list(t);
    for (const sNo of riskCards) expect(active.items.map((c) => c.sNo)).not.toContain(sNo);
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(active.total).toBe(SCENARIO_CATALOG.length - riskCards.length);

    const all = await list(t, "?includeInactive=true");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(all.items).toHaveLength(SCENARIO_CATALOG.length);
    const s02 = (all.items as unknown as { sNo: string; inactive: boolean }[]).find((c) => c.sNo === "S02");
    expect(s02!.inactive).toBe(true);
  });

  it("SLP2-1: Scenario 升一等持久化对象 —— 出厂 20 场景幂等 upsert 为 PUBLISHED，manage 列表完整可配", async () => {
    const t = await createTestApp();
    const r = await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) });
    expect(r.statusCode).toBe(200);
    const all = r.json() as { scenarioKey: string; status: string; mode: string; presetContext: unknown; intentKey: string }[];
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(all).toHaveLength(SCENARIO_CATALOG.length); // manage 端点 vs 目录源·互校
    expect(all.every((s) => s.status === "PUBLISHED")).toBe(true);
    // 每个场景都带 mode（WORKFLOW_FIRST 默认）+ presetContext + intentKey（完整可配）
    expect(all.every((s) => s.mode && s.presetContext && s.intentKey)).toBe(true);
  });

  it("SLP2-2: 管理 CRUD —— 创建 DRAFT → 编辑 presetContext → 发布 → 退役（状态机 + 启动门控）", async () => {
    const t = await createTestApp();
    // 创建 DRAFT（场景为主键 + mode + presetContext）
    const create = await t.app.inject({
      method: "POST", url: "/b/v1/scenarios", headers: debugHeaders(ADMIN),
      payload: { scenarioKey: "SX1", name: "自助场景X", targetView: "project", intentKey: "capacity_feasibility", triggerQuestion: "X 能接吗？", mode: "WORKFLOW_FIRST", presetContext: { targetView: "project", selectedObjects: [], slotPresets: { modelId: "M-X" } } },
    });
    expect(create.statusCode).toBe(201);
    expect((create.json() as { status: string }).status).toBe("DRAFT");

    // DRAFT 不可启动（未发布）
    const launchDraft = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/SX1/launch", headers: debugHeaders(PLANNER) });
    expect(launchDraft.statusCode).toBe(409);

    // 编辑 presetContext（仍 DRAFT）
    const edit = await t.app.inject({
      method: "PUT", url: "/b/v1/scenarios/SX1", headers: debugHeaders(ADMIN),
      payload: { scenarioKey: "SX1", name: "自助场景X", targetView: "project", intentKey: "capacity_feasibility", triggerQuestion: "X 能接吗？", mode: "WORKFLOW_FIRST", presetContext: { targetView: "project", selectedObjects: [{ objectType: "Model", objectId: "M-X", label: "型号X" }], slotPresets: { modelId: "M-X", weeks: 6 } } },
    });
    expect(edit.statusCode).toBe(200);
    expect((edit.json() as { presetContext: { slotPresets: Record<string, unknown> } }).presetContext.slotPresets.weeks).toBe(6);

    // 发布 → PUBLISHED，进入启动器目录
    const pub = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/SX1/publish", headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { status: string }).status).toBe("PUBLISHED");
    const afterPub = await list(t);
    expect(afterPub.items.map((c) => c.sNo)).toContain("SX1");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(afterPub.total).toBe(SCENARIO_CATALOG.length + 1); // +1 = 本用例新发布的 SX1

    // PUBLISHED 改字段 → 409（须先退役）
    const editPub = await t.app.inject({ method: "PUT", url: "/b/v1/scenarios/SX1", headers: debugHeaders(ADMIN), payload: { scenarioKey: "SX1", name: "改名", targetView: "project", intentKey: "capacity_feasibility", triggerQuestion: "X？" } });
    expect(editPub.statusCode).toBe(409);

    // 退役 → 从启动器目录消失
    const ret = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/SX1/retire", headers: debugHeaders(ADMIN) });
    expect(ret.statusCode).toBe(200);
    const afterRetire = await list(t);
    expect(afterRetire.items.map((c) => c.sNo)).not.toContain("SX1");
  });

  it("SLP2-4: 引用闭合（无死路）—— 断链场景不可发布；manage 列就绪态", async () => {
    const t = await createTestApp();
    // 坏意图：intentKey 不存在 → 闭包断链
    await t.app.inject({ method: "POST", url: "/b/v1/scenarios", headers: debugHeaders(ADMIN), payload: { scenarioKey: "SBAD", name: "断链场景", targetView: "project", intentKey: "no_such_intent", triggerQuestion: "?", mode: "WORKFLOW_FIRST" } });
    // 闭包端点报死路
    const cl = await t.app.inject({ method: "GET", url: "/b/v1/scenarios/SBAD/closure", headers: debugHeaders(ADMIN) });
    const closure = cl.json() as { ready: boolean; issues: string[] };
    expect(closure.ready).toBe(false);
    expect(closure.issues.join("")).toContain("意图");
    // 上架门：断链不可发布（409）
    const pub = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/SBAD/publish", headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(409);
    // manage 列表带 closure 就绪态：出厂 S01 就绪，SBAD 断链
    const mg = (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) })).json() as { scenarioKey: string; closure: { ready: boolean } }[];
    expect(mg.find((s) => s.scenarioKey === "S01")!.closure.ready).toBe(true);
    expect(mg.find((s) => s.scenarioKey === "SBAD")!.closure.ready).toBe(false);
  });

  it("SLP2-3: 非 catalog_admin 不可创建场景（403）", async () => {
    const t = await createTestApp();
    const r = await t.app.inject({ method: "POST", url: "/b/v1/scenarios", headers: debugHeaders(PLANNER), payload: { scenarioKey: "SX2", name: "x", targetView: "project", intentKey: "capacity_feasibility", triggerQuestion: "q" } });
    expect(r.statusCode).toBe(403);
  });

  it("目录内部一致性：solverStatus 标注复用/新增；新增求解器为分阶段建设项", () => {
    const reused = SCENARIO_CATALOG.filter((c) => c.solverStatus === "REUSED").map((c) => c.solver);
    // 复用的求解器是已落地的 8 个之一
    for (const s of reused) {
      expect(["capacity_forecast", "affected_orders", "risk_timeline", "plan_audit", "plan_generate", "bottleneck_matrix", "capex_scenario", "sop_balance"]).toContain(s);
    }
    // 新增求解器 13 个（分阶段建设）
    const news = new Set(SCENARIO_CATALOG.filter((c) => c.solverStatus === "NEW").map((c) => c.solver));
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(news.size).toBe(SCENARIO_CATALOG.filter((c) => c.solverStatus === "NEW").length); // 去重集大小 == NEW 卡数·互校（每张 NEW 卡求解器唯一）
  });
});
