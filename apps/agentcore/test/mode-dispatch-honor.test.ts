import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { seedRegistry, seedSceneEntries } from "../src/mocks/seed.js";
import { ensureMaterializedIntents } from "../src/intents/reconcile.js";
import { INTENT_MODE, intentModeFor } from "../src/intents/intent-mode.js";
import { INTENT_MODE as REEXPORTED_INTENT_MODE, materializeIntents } from "../src/intents/materialize.js";
import { SCENARIO_CATALOG, seedScenarios } from "../src/scenarios-catalog.js";

/**
 * WO MODE-DISPATCH-HONOR（审计簇⑦·mode 钉死表被场景实体架空）齿检。
 *
 * 根因：intents/materialize 按审核方钉死表把 yield_diag/maint_stagger/outsourcing_q/capex_review/
 * quarterly_gap_q（7 agent-first 之五）标 AGENT_FIRST，但一等 Scenario 一揽子 WORKFLOW_FIRST 且
 * orchestrator 只看 scene.mode → 实测 10/10 走 Path A，「为什么/哪个好/怎么选」问句拿到工作流表格
 * 而非 agent 推理。治：分发尊重一等权威链 MaterializedIntent.mode（R14 数据驱动·勿重定 modes）。
 *
 * 牙齿（revert→red）：
 *  ① 5 个被审计的 agent-first 意图分类命中后真走 agent-first（path=AGENT·agentRun.agentId 持久化=
 *     该意图绑定 agent·AGENT-UNIVERSAL C2 同坐标系）——回退「orchestrator 只看 scene.mode」即红；
 *  ② workflow-first（capacity_feasibility）照旧 Path A（零回归）；
 *  ③ mode 单一来源：一等 Scenario 投影 mode == 钉死表 == 物化 Intent mode（回退 scenarios-catalog
 *     一揽子 WORKFLOW_FIRST 即红）；
 *  ④ 权威=一等对象（数据驱动）：把 repo 里 yield_diag 的 mode 改回 WORKFLOW_FIRST → 分发回 Path A
 *     （证分发读一等 Intent 而非硬编码表）。
 */

/** helper 默认只种意图/计划——补 agent/skill/workflow/场景入口 + 一等 Intent（20·mode 13/7）。 */
async function seedModeDispatchRuntime(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const s of skills) await t.repos.skills.insert(s);
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const ag of agents) await t.repos.agents.insert(ag);
  for (const scn of seedSceneEntries()) await t.repos.sceneEntries.upsert(scn);
  await ensureMaterializedIntents(t.repos, "demo");
}

/** 5 个被审计架空的 agent-first 意图（钉死表之五）+ 各自问句（为什么/怎么调/还是/值得吗/用什么组合）。 */
const AUDITED_AGENT_FIRST: { intentKey: string; view: string; query: string }[] = [
  { intentKey: "yield_diag", view: "risk", query: "涂布良率为什么掉了？" },
  { intentKey: "maint_stagger", view: "risk", query: "检修计划和交付高峰撞了怎么调？" },
  { intentKey: "outsourcing_q", view: "generate", query: "缺口 8 万套自产加班还是外协？" },
  { intentKey: "capex_review", view: "generate", query: "枣庄储能线值得投吗？" },
  { intentKey: "quarterly_gap_q", view: "quarter", query: "Q2 缺口用什么组合补？" },
];

function queueAgentFinalAnswer(t: TestApp, markdown: string): void {
  t.llm.queueAgentTurn({
    content: [toolUse("final_answer", { blocks: [{ type: "text", markdown }], provenance: [] })],
  });
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await seedModeDispatchRuntime(t);
});

describe("① 审计的 5 个 agent-first 意图：分类命中 → 分发尊重一等 Intent mode（真走 agent·可审计）", () => {
  for (const { intentKey, view, query } of AUDITED_AGENT_FIRST) {
    it(`${intentKey}：path=AGENT · note=意图权威模式 · agentRun.agentId=绑定 agent（C2 坐标系）`, async () => {
      const mi = (await t.repos.materializedIntents.byKey("demo", intentKey))!;
      expect(mi.mode).toBe("AGENT_FIRST"); // 前提：钉死表已物化（勿重定 modes）
      const boundAgentId = mi.bindings.agentId as string;
      expect(boundAgentId).toBeTruthy();

      t.llm.queueClassification({ candidates: [{ intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
      queueAgentFinalAnswer(t, "基于本页数据的推理结论（无业务数字·见工具溯源）。");

      const { taskId, statusCode } = await submitQuery(t, PLANNER, query, { view });
      expect(statusCode).toBe(202);
      const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));

      // 回退簇⑦（只看 scene.mode=WORKFLOW_FIRST）→ path=WORKFLOW → 本断言红。
      expect(task.status).toBe("COMPLETED");
      expect(task.path).toBe("AGENT");
      expect(task.matchedIntent?.intentKey).toBe(intentKey);

      // routing.completed 载荷：委派来源=意图权威 mode（非「场景入口模式」/「进入探索模式」）。
      const events = await t.repos.events.listAfter(taskId, 0);
      const routing = events.find((e) => e.event === "routing.completed")?.payload as { path: string; intentKey?: string; note: string };
      expect(routing.path).toBe("AGENT");
      expect(routing.intentKey).toBe(intentKey);
      expect(routing.note).toContain("意图权威模式 AGENT_FIRST");

      // C2 归属可审计（AGENT-UNIVERSAL 同坐标系）：agentRun.agentId 持久化 = 该意图绑定 agent。
      const run = await t.repos.agentRuns.getByTask(taskId);
      expect(run).toBeDefined();
      expect(run?.agentId).toBe(boundAgentId);
    });
  }
});

describe("② workflow-first 零回归", () => {
  it("affected_orders（钉死 WORKFLOW_FIRST）分类命中 → 照旧 Path A 工作流", async () => {
    t.llm.queueClassification({ candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(t, PLANNER, "常州基地影响哪些订单？", {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }],
    });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    const events = await t.repos.events.listAfter(taskId, 0);
    const routing = events.find((e) => e.event === "routing.completed")?.payload as { path: string };
    expect(routing.path).toBe("WORKFLOW");
    // 13 个 workflow-first 键在物化层全部保持 WORKFLOW_FIRST（钉死表不重定）。
    const wfKeys = Object.entries(INTENT_MODE).filter(([, m]) => m === "WORKFLOW_FIRST").map(([k]) => k);
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(wfKeys.length).toBe(SCENARIO_CATALOG.filter((c) => intentModeFor(c.intentKey) === "WORKFLOW_FIRST").length); // 钉死表 WF 键 == 场景卡投影 WF（两独立注册表互校）
    for (const k of wfKeys) {
      expect((await t.repos.materializedIntents.byKey("demo", k))?.mode).toBe("WORKFLOW_FIRST");
    }
  });
});

describe("③ mode 单一来源（勿两处各写一套·回退场景一揽子 WORKFLOW_FIRST 即红）", () => {
  it("一等 Scenario 投影 mode == 审核方钉死表 == 物化 Intent mode（20/20）", () => {
    expect(REEXPORTED_INTENT_MODE).toBe(INTENT_MODE); // materialize re-export = 同一张表（非拷贝）
    const scenarios = seedScenarios("demo");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(scenarios.length).toBe(SCENARIO_CATALOG.length); // 场景投影产出 == 场景卡目录（产出 vs 源·互校）
    for (const s of scenarios) {
      expect(s.mode, `Scenario ${s.scenarioKey}(${s.intentKey}) 的 mode 必须派生自钉死表`).toBe(intentModeFor(s.intentKey));
    }
    const agentFirstCards = scenarios.filter((s) => s.mode === "AGENT_FIRST");
    expect(agentFirstCards.map((s) => s.intentKey).sort()).toEqual(
      ["capex_review", "maint_stagger", "outsourcing_q", "plan_recommend", "quarterly_gap_q", "risk_root_cause", "yield_diag"].sort(),
    );
    for (const mi of materializeIntents("demo")) {
      expect(mi.mode).toBe(intentModeFor(mi.key));
    }
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(SCENARIO_CATALOG.length).toBe(Object.keys(INTENT_MODE).length); // 场景卡目录 == mode 钉死表键数（两独立注册表互校）
  });
});

describe("④ 权威=一等对象（R14 数据驱动·非硬编码表分派）", () => {
  it("把 repo 里 yield_diag 的 mode 编辑回 WORKFLOW_FIRST → 分发跟随一等对象走 Path A", async () => {
    const mi = (await t.repos.materializedIntents.byKey("demo", "yield_diag"))!;
    await t.repos.materializedIntents.upsert({ ...mi, mode: "WORKFLOW_FIRST" });

    t.llm.queueClassification({ candidates: [{ intentKey: "yield_diag", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(t, PLANNER, "涂布良率为什么掉了？", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.path).toBe("WORKFLOW"); // 分发读一等 Intent（可编辑对象），非静态表
  });

  it("查无一等 Intent（未物化租户）→ 回落既有链（Path A·全 -first 保兜底）", async () => {
    const fresh = await createTestApp(); // 不 seed 一等 Intent
    fresh.llm.queueClassification({ candidates: [{ intentKey: "yield_diag", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(fresh, PLANNER, "涂布良率为什么掉了？", { view: "risk" });
    const task = await waitForTask(fresh, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.path).toBe("WORKFLOW");
    await fresh.app.close();
  });
});
