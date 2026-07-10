import { describe, expect, it } from "vitest";
import {
  INTENT_MODE,
  materializeIntents,
  seedIntentSlices,
  registeredSolverKeys,
  sliceKeyForIntent,
} from "../src/intents/materialize.js";
import { seedRegistry, seedIntentsAndPlans } from "../src/mocks/seed.js";
import { ensureMaterializedIntents } from "../src/intents/reconcile.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { createTestApp, ADMIN, debugHeaders, type TestApp } from "./helpers.js";

/** 在测试 app 上把出厂注册表（agents/workflows/skills）+ 计划补齐（reconcile 依赖）。 */
async function seedRegistryInto(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const s of skills) await t.repos.skills.insert(s);
  for (const a of agents) await t.repos.agents.insert(a);
}

describe("WO-INTENT-MATERIALIZE-BINDING-COMPLETE · 物化（纯函数·R6）", () => {
  it("物化 20 一等 PUBLISHED Intent，mode 分派 14 workflow-first / 6 agent-first（审核方钉死·COVERAGE-FILL 返工后 risk_root_cause 转 WF）", () => {
    const intents = materializeIntents("demo");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(intents).toHaveLength(SCENARIO_CATALOG.length); // 物化产出 == 场景卡目录（产出 vs 源·互校）
    expect(intents.every((i) => i.status === "PUBLISHED")).toBe(true);
    const wf = intents.filter((i) => i.mode === "WORKFLOW_FIRST");
    const ag = intents.filter((i) => i.mode === "AGENT_FIRST");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(wf).toHaveLength(Object.values(INTENT_MODE).filter((m) => m === "WORKFLOW_FIRST").length); // 物化 WF 产出 == 钉死表 WF 计数
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(ag).toHaveLength(Object.values(INTENT_MODE).filter((m) => m === "AGENT_FIRST").length); // 物化 AGENT 产出 == 钉死表 AGENT 计数
    // mode 逐意图 = INTENT_MODE 钉死表（R14 数据驱动·非硬编码分派）
    for (const i of intents) expect(i.mode).toBe(INTENT_MODE[i.key]);
    // agent-first 精确集（UPG-L0-COVERAGE-FILL 返工：risk_root_cause 重定向 WORKFLOW_FIRST → agent-first 7→6）
    expect(ag.map((i) => i.key).sort()).toEqual(
      ["capex_review", "maint_stagger", "outsourcing_q", "plan_recommend", "quarterly_gap_q", "yield_diag"].sort(),
    );
  });

  it("每个 Intent 全绑定链 6 项齐（按 mode）", () => {
    const solvers = registeredSolverKeys();
    const sliceKeys = new Set(seedIntentSlices("demo").map((s) => s.sliceKey));
    const { plans } = seedIntentsAndPlans("demo");
    const planIds = new Set(plans.map((p) => p.id));
    const { agents, skills } = seedRegistry();
    const agentIds = new Set(agents.filter((a) => a.status === "PUBLISHED").map((a) => a.id));
    const skillIds = new Set(skills.map((s) => s.id));
    for (const i of materializeIntents("demo")) {
      const b = i.bindings;
      expect(solvers.has(b.solverKey)).toBe(true); // 求解器 ∈ 注册表
      expect(b.ruleKeys.length).toBeGreaterThan(0); // ≥1 evaluation 规则
      expect(skillIds.has(b.skillId)).toBe(true); // skill 存在
      expect(sliceKeys.has(b.ontologySliceKey)).toBe(true); // 本体切片存在
      if (i.mode === "WORKFLOW_FIRST") {
        expect(b.workflowId).toBeTruthy();
        expect(planIds.has(b.workflowId!)).toBe(true); // 绑 PUBLISHED 计划
        expect(b.agentId).toBeUndefined();
      } else {
        expect(b.agentId).toBeTruthy();
        expect(agentIds.has(b.agentId!)).toBe(true); // 绑 PUBLISHED agent
        expect(b.workflowId).toBeUndefined();
      }
    }
  });

  it("R6 确定性：同 catalog 物化字节级一致", () => {
    expect(JSON.stringify(materializeIntents("demo", "2026-01-01T00:00:00.000Z"))).toBe(
      JSON.stringify(materializeIntents("demo", "2026-01-01T00:00:00.000Z")),
    );
  });

  it("一等切片注册表 20 片·键与 Intent 绑定对齐·rootType 为本体类型（R14 零实例名）", () => {
    const slices = seedIntentSlices("demo");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(slices).toHaveLength(SCENARIO_CATALOG.length); // 切片注册表产出 == 场景卡目录（产出 vs 源·互校）
    for (const i of materializeIntents("demo")) {
      expect(i.bindings.ontologySliceKey).toBe(sliceKeyForIntent(i.key));
    }
    // rootType 为对象类型 key（首字母大写·非 4680-NCM 等实例名）
    expect(slices.every((s) => /^[A-Z]/.test(s.rootType))).toBe(true);
  });
});

describe("WO-INTENT-MATERIALIZE-BINDING-COMPLETE · 端点（真起 server）", () => {
  it("GET /b/v1/intents 返 20 一等 Intent（mode 过滤生效）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/b/v1/intents", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { key: string; mode: string; status: string }[];
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(list).toHaveLength(SCENARIO_CATALOG.length); // 端点产出 == 场景卡目录（产出 vs 源·互校）
    const wf = await t.app.inject({ method: "GET", url: "/b/v1/intents?mode=AGENT_FIRST", headers: debugHeaders(ADMIN) });
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect((wf.json() as unknown[]).length).toBe(Object.values(INTENT_MODE).filter((m) => m === "AGENT_FIRST").length); // 端点 AGENT 过滤产出 == 钉死表 AGENT 计数
  });

  it("PUT /b/v1/intents/:key 部分改绑定不清空其它键（浅合并·mode 钉死不可改）", async () => {
    const t = await createTestApp();
    await t.app.inject({ method: "GET", url: "/b/v1/intents", headers: debugHeaders(ADMIN) }); // 触发播种
    const before = (await t.repos.materializedIntents.byKey("demo", "kit_analysis"))!;
    const res = await t.app.inject({
      method: "PUT",
      url: "/b/v1/intents/kit_analysis",
      headers: debugHeaders(ADMIN),
      payload: { name: "改名", bindings: { workflowId: "" }, mode: "AGENT_FIRST" },
    });
    expect(res.statusCode).toBe(200);
    const after = res.json() as { name: string; mode: string; bindings: { ruleKeys: string[]; workflowId: string } };
    expect(after.name).toBe("改名");
    expect(after.mode).toBe(before.mode); // mode 不可经编辑改派
    expect(after.bindings.ruleKeys).toEqual(before.bindings.ruleKeys); // 未传的键保留
    expect(after.bindings.workflowId).toBe("");
  });

  it("POST /b/v1/intents/reconcile 缺项 scaffold DRAFT（R4·非自动发布）+ 补齐报告；R6 幂等", async () => {
    const t = await createTestApp();
    await seedRegistryInto(t);
    await ensureMaterializedIntents(t.repos, "demo");
    // 清掉 risk_root_cause 的 ruleKeys（agent-first）
    const it0 = (await t.repos.materializedIntents.byKey("demo", "risk_root_cause"))!;
    await t.repos.materializedIntents.upsert({ ...it0, bindings: { ...it0.bindings, ruleKeys: [] } });

    const r1 = await t.app.inject({ method: "POST", url: "/b/v1/intents/reconcile", headers: debugHeaders(ADMIN) });
    expect(r1.statusCode).toBe(200);
    const rep = r1.json() as { total: number; scaffoldedCount: number; intents: { key: string; status: string; bindings: Record<string, string>; scaffolded: unknown[] }[] };
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(rep.total).toBe(SCENARIO_CATALOG.length); // reconcile 报告 total == 场景卡目录（产出 vs 源·互校）
    expect(rep.scaffoldedCount).toBeGreaterThanOrEqual(1);
    const row = rep.intents.find((i) => i.key === "risk_root_cause")!;
    expect(row.bindings.ruleKeys).toBe("SCAFFOLDED");
    expect(row.status).toBe("DRAFT"); // R4：补齐回落 DRAFT，不自动发布

    // 补齐后 Intent 落 DRAFT + ruleKeys 恢复 + reconcile 留痕
    const healed = (await t.repos.materializedIntents.byKey("demo", "risk_root_cause"))!;
    expect(healed.status).toBe("DRAFT");
    expect(healed.bindings.ruleKeys.length).toBeGreaterThan(0);
    expect(healed.reconcile?.scaffolded.length).toBeGreaterThan(0);

    // R6 幂等：再跑无新 scaffold（已补齐）
    const r2 = await t.app.inject({ method: "POST", url: "/b/v1/intents/reconcile", headers: debugHeaders(ADMIN) });
    expect((r2.json() as { scaffoldedCount: number }).scaffoldedCount).toBe(0);
  });

  it("非 catalog_admin 不得 reconcile / 编辑（authz）", async () => {
    const t = await createTestApp();
    const planner = `demo:user-planner:planner`;
    const res = await t.app.inject({ method: "POST", url: "/b/v1/intents/reconcile", headers: debugHeaders(planner) });
    expect(res.statusCode).toBe(403);
  });
});
