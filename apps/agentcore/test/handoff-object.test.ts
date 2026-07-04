import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, debugHeaders, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { SEED_UNIVERSAL_AGENT_ID } from "../src/agents/universal.js";

/**
 * WO-C · AGENT-HANDOFF-OBJECT 咬合测试（Agent-Native 吸收·不换框架·借模式）。
 *
 * 治本核实（本文件断言的真值来源）：
 *  - 交接真持久化：runPathB 委派点——本入口配了场景 agent 但**不可用**（DRAFT/未发布）→ 回落 agt_universal，
 *    落一等 Handoff（fromAgentId=真持久场景 agent id·toAgentId=真持久 agentRun.agentId=agt_universal·
 *    carriedSlots/carriedEvidence=真值·非合成）。GET decision-trace/trace 均可见交接（可审计·谁→谁·带什么·为何）。
 *  - R2 隔离：listByTask 带 tenantId，跨租户不可见。
 *  - 诚实：无场景 agent 配置的视图不产生交接（委派点条件为真·非恒开）。
 */

const HANDOFF_VIEW = "wo-c-handoff-view";
const DRAFT_SCENE_AGENT_ID = "agt_scene_draft_unpublished";

/** 灌 agt_universal（PUBLISHED）+ 一个 DRAFT（未发布）场景 agent + 指向它的场景入口。 */
async function seedHandoffCase(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const s of skills) await t.repos.skills.insert(s);
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const ag of agents) await t.repos.agents.insert(ag);
  // 场景配了的 agent 是 DRAFT（未发布）→ runPathB 见其不可用 → scene→universal 回落委派。
  const analyst = agents.find((a) => a.id === "agt_seed_analyst")!;
  await t.repos.agents.insert({ ...analyst, id: DRAFT_SCENE_AGENT_ID, tenantId: TENANT, status: "DRAFT" });
  await t.repos.sceneEntries.upsert({
    id: "scn_wo_c_handoff",
    tenantId: TENANT,
    viewKey: HANDOFF_VIEW,
    mode: "WORKFLOW_FIRST",
    defaultAgentId: DRAFT_SCENE_AGENT_ID,
    uiHints: { placeholder: "问点开放问题", suggestedQuestions: [] },
  });
}

/** 提交一个开放问句到该视图 → 分类 OUT_OF_CATALOG（带真槽位）→ 场景 agent 不可用 → 回落 universal（记交接）。 */
async function triggerHandoff(t: TestApp): Promise<{ taskId: string }> {
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: { modelId: "4680-NCM" } });
  t.llm.queueAgentTurn(
    { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已综合本体作答。" }], provenance: [] })] },
  );
  const { taskId, statusCode } = await submitQuery(t, PLANNER, "帮我综合回答个开放问题", {
    view: HANDOFF_VIEW,
    selectedObjects: [{ objectType: "Order", objectId: "SO-3470" }],
  });
  expect(statusCode).toBe(202);
  return { taskId };
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await seedHandoffCase(t);
});

describe("WO-C · scene→universal 回落委派落一等 Handoff（真持久化·可审计）", () => {
  it("委派点记录 Handoff：fromAgentId=场景 agent·toAgentId=agt_universal·taskId 关联·carriedSlots/evidence 真", async () => {
    const { taskId } = await triggerHandoff(t);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    const handoffs = await t.repos.handoffs.listByTask(TENANT, taskId);
    expect(handoffs).toHaveLength(1);
    const h = handoffs[0]!;
    // fromAgentId = 真持久场景 agent id（不可用/DRAFT）；toAgentId = 真持久运行 agentRun.agentId（agt_universal）。
    expect(h.fromAgentId).toBe(DRAFT_SCENE_AGENT_ID);
    expect(h.toAgentId).toBe(SEED_UNIVERSAL_AGENT_ID);
    expect(h.taskId).toBe(taskId);
    expect(h.tenantId).toBe(TENANT);
    expect(h.reason).toContain("scene→universal");
    // toAgentId 与 agentRun.agentId 同坐标系（AGENT-UNIVERSAL C2 物证一致）。
    const run = await t.repos.agentRuns.getByTask(taskId);
    expect(run?.agentId).toBe(h.toAgentId);
    // carriedSlots 是真槽位（分类抽取 modelId），非合成。
    expect(h.carriedSlots).toMatchObject({ modelId: "4680-NCM" });
    // carriedEvidence 是真携带证据（本次上下文选中的对象 ref），非合成。
    expect(h.carriedEvidence).toContain("obj:Order:SO-3470");
    // GET 回读（tenantId+id）拿回同一记录。
    const got = await t.repos.handoffs.get(TENANT, h.id);
    expect(got?.id).toBe(h.id);
    expect(got?.fromAgentId).toBe(DRAFT_SCENE_AGENT_ID);
  });

  it("decision-trace 端点透出交接（监管一站出示·谁→谁·带什么·为何）", async () => {
    const { taskId } = await triggerHandoff(t);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/decision-trace`,
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(200);
    const dt = res.json() as { handoffs: { fromAgentId: string; toAgentId: string; reason: string }[] };
    expect(dt.handoffs).toHaveLength(1);
    expect(dt.handoffs[0]!.fromAgentId).toBe(DRAFT_SCENE_AGENT_ID);
    expect(dt.handoffs[0]!.toAgentId).toBe(SEED_UNIVERSAL_AGENT_ID);
  });

  it("推演 DAG（trace）渲染交接节点：handoffs 透出 + ①解析节点血缘标交接", async () => {
    const { taskId } = await triggerHandoff(t);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/trace`,
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(200);
    const trace = res.json() as {
      handoffs: { fromAgentId: string; toAgentId: string }[];
      nodes: { id: number; agents: string[] }[];
    };
    expect(trace.handoffs).toHaveLength(1);
    expect(trace.handoffs[0]!.fromAgentId).toBe(DRAFT_SCENE_AGENT_ID);
    // ①解析/路由节点血缘显式标交接（真持久 agent id·谁→谁）。
    const node1 = trace.nodes.find((n) => n.id === 1)!;
    expect(node1.agents).toContain(`交接:${DRAFT_SCENE_AGENT_ID}→${SEED_UNIVERSAL_AGENT_ID}`);
  });

  it("R2 跨租户隔离：他租户 listByTask/get 均不可见（返回空）", async () => {
    const { taskId } = await triggerHandoff(t);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const mine = await t.repos.handoffs.listByTask(TENANT, taskId);
    expect(mine).toHaveLength(1);
    // 他租户视角同 taskId → 空（R2）。
    const other = await t.repos.handoffs.listByTask("tenant-other", taskId);
    expect(other).toHaveLength(0);
    const otherGet = await t.repos.handoffs.get("tenant-other", mine[0]!.id);
    expect(otherGet).toBeUndefined();
  });

  // green→red→green 自证：委派点若不记录 Handoff（revert 委派点），本断言转红。
  it("[自证·预期红] 委派点确记录了交接（若移除委派点 Handoff.insert 则此断言红）", async () => {
    const { taskId } = await triggerHandoff(t);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const handoffs = await t.repos.handoffs.listByTask(TENANT, taskId);
    // 委派点必须已落一条真交接；恒真断言 handoffs.length>=1 会因 revert 委派点而红。
    expect(handoffs.length).toBeGreaterThanOrEqual(1);
    expect(handoffs[0]!.toAgentId).toBe(SEED_UNIVERSAL_AGENT_ID);
  });

  // 诚实：无场景 agent 配置的视图 → universal 兜底但**非交接**（委派点条件为真·非恒开）。
  it("无场景 agent 的视图上回落 universal → 不产生交接（fromAgentId 须真存在方记）", async () => {
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已作答。" }], provenance: [] })] },
    );
    const { taskId } = await submitQuery(t, PLANNER, "另一个开放问题", { view: "graph-unconfigured", selectedObjects: [] });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");
    const handoffs = await t.repos.handoffs.listByTask(TENANT, taskId);
    expect(handoffs).toHaveLength(0);
  });
});
