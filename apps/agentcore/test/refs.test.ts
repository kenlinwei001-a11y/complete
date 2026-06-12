import { describe, expect, it } from "vitest";
import type { AgentDefinition, QueryTask, SkillDefinition } from "@platform/contracts";
import { ADMIN, createTestApp, debugHeaders, PKG, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { text } from "../src/llm/mock.js";

/**
 * 统一引用模式增量（Part 2）：L5 规则变更传播留痕 / L6 planRef latest vs pin /
 * L7 workflow 破坏性变更门禁 + force / L8 skill latest + 版本留痕。
 */

const RISK_CONTEXT = { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }] };

async function createRefPlan(t: TestApp, key: string, markdown: string): Promise<{ id: string }> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/catalog/packages/${PKG}/plans`,
    headers: debugHeaders(ADMIN),
    payload: {
      key,
      steps: [
        { id: "s1", type: "evaluate_rules", params: { ruleIds: ["C08"], payload: { outsourceRatio: 0.25 } } },
        { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown }] } },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function publishPlan(t: TestApp, planId: string): Promise<Record<string, unknown>> {
  const res = await t.app.inject({ method: "POST", url: `/api/v1/catalog/plans/${planId}/publish`, headers: debugHeaders(ADMIN) });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

async function createIntent(
  t: TestApp,
  key: string,
  planRef: { planKey: string; version: number | "latest" },
): Promise<{ id: string }> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/catalog/packages/${PKG}/intents`,
    headers: debugHeaders(ADMIN),
    payload: {
      key,
      name: `测试意图 ${key}`,
      description: "planRef 解析测试",
      examples: ["触发一下"],
      enabledViews: "*",
      slots: [{ name: "note", type: "string", required: false, description: "可选备注" }],
      planRef,
      riskLevel: "READ",
      owner: "test",
    },
  });
  expect(res.statusCode).toBe(201);
  const intent = res.json() as { id: string; planRef: unknown; planId?: string };
  // 过渡期响应同时含 planRef 与 planId（别名归一化）
  expect(intent.planRef).toMatchObject({ planKey: planRef.planKey });
  const pub = await t.app.inject({ method: "POST", url: `/api/v1/catalog/intents/${intent.id}/publish`, headers: debugHeaders(ADMIN) });
  expect(pub.statusCode).toBe(200);
  return intent;
}

async function runIntent(t: TestApp, intentKey: string): Promise<QueryTask> {
  t.llm.queueClassification({ candidates: [{ intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
  const { taskId } = await submitQuery(t, PLANNER, "触发一下", RISK_CONTEXT);
  return waitForTask(t, taskId);
}

describe("L6 · 意图 → 计划 planRef（修订 QOS-PRD §4.1：执行时解析）", () => {
  it("planRef=latest：计划发新版后下一次命中即执行新版；pin=1 的另一意图不变", async () => {
    const t = await createTestApp();
    const v1 = await createRefPlan(t, "ref_plan", "v1 的回答");
    const pubResp = await publishPlan(t, v1.id);
    // §2.3：plan publish 响应附影响面（此时尚无意图引用 → 0）
    expect(pubResp.impact).toMatchObject({ intents: 0 });

    await createIntent(t, "ref_latest", { planKey: "ref_plan", version: "latest" });
    await createIntent(t, "ref_pinned", { planKey: "ref_plan", version: 1 });

    const task1 = await runIntent(t, "ref_latest");
    expect(task1.status).toBe("COMPLETED");
    expect(task1.resolvedRefs).toContainEqual({ kind: "plan", key: "ref_plan", version: 1 });
    // §2.2：评估到的规则版本一并留痕（RuleVerdict.ruleVersion）
    expect(task1.resolvedRefs).toContainEqual({ kind: "rule", key: "C08", version: 1 });

    // 计划发新版（v2）——latest 引用方下一次执行即生效，零运营动作
    const v2 = await createRefPlan(t, "ref_plan", "v2 的回答");
    const pub2 = await publishPlan(t, v2.id);
    // 影响面：两个意图引用该 key（latest + pin）
    expect((pub2.impact as { intents: number }).intents).toBe(2);

    const task2 = await runIntent(t, "ref_latest");
    expect(task2.status).toBe("COMPLETED");
    expect(task2.resolvedRefs).toContainEqual({ kind: "plan", key: "ref_plan", version: 2 });
    expect(task2.answer?.blocks?.[0]).toMatchObject({ type: "text", markdown: "v2 的回答" });

    // pin=1 意图不受影响
    const task3 = await runIntent(t, "ref_pinned");
    expect(task3.status).toBe("COMPLETED");
    expect(task3.resolvedRefs).toContainEqual({ kind: "plan", key: "ref_plan", version: 1 });
    expect(task3.answer?.blocks?.[0]).toMatchObject({ type: "text", markdown: "v1 的回答" });

    // 旧任务留痕不受后续变更影响（重放/争议追溯用留痕版本）
    const old = await t.repos.tasks.get(task1.id);
    expect(old?.resolvedRefs).toContainEqual({ kind: "plan", key: "ref_plan", version: 1 });
  });

  it("planId 仍作为输入别名被接受（归一化为 planRef latest）", async () => {
    const t = await createTestApp();
    const v1 = await createRefPlan(t, "alias_plan", "别名回答");
    await publishPlan(t, v1.id);
    const res = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/packages/${PKG}/intents`,
      headers: debugHeaders(ADMIN),
      payload: {
        key: "alias_intent",
        name: "别名意图",
        description: "planId 过渡别名",
        examples: ["x"],
        enabledViews: "*",
        slots: [],
        planId: v1.id,
        riskLevel: "READ",
        owner: "test",
      },
    });
    expect(res.statusCode).toBe(201);
    const intent = res.json() as { planRef: { planKey: string; version: string }; planId: string };
    expect(intent.planRef).toEqual({ planKey: "alias_plan", version: "latest" });
    expect(intent.planId).toBe(v1.id);
  });
});

describe("L5 · 规则变更传播：下一次求值用新阈值；既有任务留痕仍是旧版本", () => {
  it("C08 阈值变更（模拟发布新版）→ 新任务 ruleVersion=2 且新阈值生效；旧任务留痕 v1", async () => {
    const t = await createTestApp();
    const v1 = await createRefPlan(t, "rule_plan", "规则评估完成");
    await publishPlan(t, v1.id);
    await createIntent(t, "rule_intent", { planKey: "rule_plan", version: "latest" });

    const task1 = await runIntent(t, "rule_intent");
    expect(task1.status).toBe("COMPLETED");
    expect(task1.resolvedRefs).toContainEqual({ kind: "rule", key: "C08", version: 1 });
    // v1 阈值 0.3：payload 0.25 → 通过（正常 render）
    expect(task1.answer?.blocks?.[0]).toMatchObject({ markdown: "规则评估完成" });

    // 源头一改（C08 阈值 0.3 → 0.2，版本 +1），引用方零动作
    t.dataCore.rules.publishC08(0.2);

    const task2 = await runIntent(t, "rule_intent");
    expect(task2.status).toBe("COMPLETED");
    // 新阈值生效：0.25 > 0.2 → WARN（非 BLOCK，不拦截），留痕 v2
    expect(task2.resolvedRefs).toContainEqual({ kind: "rule", key: "C08", version: 2 });

    // 既有任务留痕仍显示旧版本号
    const old = await t.repos.tasks.get(task1.id);
    expect(old?.resolvedRefs).toContainEqual({ kind: "rule", key: "C08", version: 1 });
  });
});

describe("L7 · workflow 破坏性变更门禁（§2.3）", () => {
  async function setup(t: TestApp): Promise<{ wfId: string }> {
    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "gate_wf",
        name: "门禁流程",
        inputs: { type: "object", properties: { modelId: { type: "string" }, weeks: { type: "number" } } },
        steps: [{ id: "s1", type: "query_objects", params: { objectType: "Base", filter: {} } }],
      },
    });
    expect(created.statusCode).toBe(201);
    const wf = created.json() as { id: string };
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wf.id}/publish`, headers: debugHeaders(ADMIN), payload: {} });
    expect((pub.json() as { ok: boolean }).ok).toBe(true);
    // latest 引用方：agent 以 WORKFLOW 工具引用该 workflow（version: latest）
    const agent: AgentDefinition = {
      id: "agt_gate_ref",
      tenantId: TENANT,
      key: "gate_ref_agent",
      version: 1,
      name: "门禁引用 Agent",
      description: "latest 引用方",
      model: "claude-opus-4-8",
      systemPrompt: "x",
      tools: [{ kind: "WORKFLOW", workflowId: wf.id, version: "latest" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Base"], toolNames: [] },
      status: "PUBLISHED",
    };
    await t.repos.agents.insert(agent);
    return { wfId: wf.id };
  }

  it("inputs 字段删除 + 存在 latest 引用方 → 409 BREAKING_CHANGE_WITH_LATEST_REFS 列出引用方；force=true 越过并标记审计", async () => {
    const t = await createTestApp();
    const { wfId } = await setup(t);

    // 派生新版本并做破坏性修改（删除 weeks 字段）
    const nv = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wfId}/new-version`, headers: debugHeaders(ADMIN) });
    const draft = nv.json() as { id: string };
    const put = await t.app.inject({
      method: "PUT",
      url: `/b/v1/workflows/${draft.id}`,
      headers: debugHeaders(ADMIN),
      payload: { inputs: { type: "object", properties: { modelId: { type: "string" } } } },
    });
    expect(put.statusCode).toBe(200);

    const rejected = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${draft.id}/publish`, headers: debugHeaders(ADMIN), payload: {} });
    expect(rejected.statusCode).toBe(409);
    const err = (rejected.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("BREAKING_CHANGE_WITH_LATEST_REFS");
    expect(err.message).toContain("weeks");
    expect(err.message).toContain("门禁引用 Agent"); // 列出引用方

    // force=true（catalog_admin）→ 发布成功 + forced 标记（全审计）+ impact
    const forced = await t.app.inject({
      method: "POST",
      url: `/b/v1/workflows/${draft.id}/publish`,
      headers: debugHeaders(ADMIN),
      payload: { force: true },
    });
    expect(forced.statusCode).toBe(200);
    const body = forced.json() as { ok: boolean; forced: boolean; impact: { agents: number }; breakingChanges: string[] };
    expect(body.ok).toBe(true);
    expect(body.forced).toBe(true);
    expect(body.impact.agents).toBe(1);
    expect(body.breakingChanges.join("")).toContain("weeks");
  });

  it("类型变更同样触发门禁；兼容性新增可选字段直接发布（响应附 impact）", async () => {
    const t = await createTestApp();
    const { wfId } = await setup(t);

    // 兼容变更：新增可选字段 → 直接发布
    const nv1 = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wfId}/new-version`, headers: debugHeaders(ADMIN) });
    const d1 = nv1.json() as { id: string };
    await t.app.inject({
      method: "PUT",
      url: `/b/v1/workflows/${d1.id}`,
      headers: debugHeaders(ADMIN),
      payload: { inputs: { type: "object", properties: { modelId: { type: "string" }, weeks: { type: "number" }, note: { type: "string" } } } },
    });
    const ok = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${d1.id}/publish`, headers: debugHeaders(ADMIN), payload: {} });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { ok: boolean; impact: { agents: number } }).impact.agents).toBe(1);

    // 类型变更：weeks number → string → 门禁
    const nv2 = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wfId}/new-version`, headers: debugHeaders(ADMIN) });
    const d2 = nv2.json() as { id: string };
    await t.app.inject({
      method: "PUT",
      url: `/b/v1/workflows/${d2.id}`,
      headers: debugHeaders(ADMIN),
      payload: { inputs: { type: "object", properties: { modelId: { type: "string" }, weeks: { type: "string" }, note: { type: "string" } } } },
    });
    const rejected = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${d2.id}/publish`, headers: debugHeaders(ADMIN), payload: {} });
    expect(rejected.statusCode).toBe(409);
    expect((rejected.json() as { error: { code: string } }).error.code).toBe("BREAKING_CHANGE_WITH_LATEST_REFS");
  });
});

describe("L8 · skill 更新：latest 引用下次加载即新内容；任务留痕含 skill 版本", () => {
  it("skill v2 发布后，引用 latest 的 agent 下次运行用 v2；resolvedRefs 记录实际版本", async () => {
    const t = await createTestApp();
    const skillV1: SkillDefinition = {
      id: "skl_ref_1",
      tenantId: TENANT,
      key: "ref_skill",
      version: 1,
      name: "引用技能",
      summary: "V1-SUMMARY 产能分析旧口径",
      body: "v1 body",
      resources: [],
      status: "PUBLISHED",
    };
    await t.repos.skills.insert(skillV1);
    const agent: AgentDefinition = {
      id: "agt_skill_ref",
      tenantId: TENANT,
      key: "skill_ref_agent",
      version: 1,
      name: "技能引用 Agent",
      description: "skill latest 引用方",
      model: "claude-opus-4-8",
      systemPrompt: "你是测试 agent",
      tools: [],
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
      skills: [{ skillId: skillV1.id, version: "latest" }],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Base"], toolNames: [] },
      status: "PUBLISHED",
    };
    await t.repos.agents.insert(agent);
    await t.repos.sceneEntries.upsert({
      id: "scn_skilltest",
      tenantId: TENANT,
      viewKey: "skilltest",
      mode: "AGENT_ONLY",
      defaultAgentId: agent.id,
      uiHints: { placeholder: "p", suggestedQuestions: [] },
    });

    // 第一次运行：渐进披露的技能摘要为 v1
    t.llm.queueAgentTurn({ content: [text("v1 回答")] });
    const r1 = await submitQuery(t, PLANNER, "技能测试", { view: "skilltest", selectedObjects: [] });
    const task1 = await waitForTask(t, r1.taskId);
    expect(task1.status).toBe("COMPLETED");
    expect(task1.resolvedRefs).toContainEqual({ kind: "agent", key: "skill_ref_agent", version: 1 });
    expect(task1.resolvedRefs).toContainEqual({ kind: "skill", key: "ref_skill", version: 1 });
    const sys1 = t.llm.agentRequests.at(-1)?.system ?? "";
    expect(sys1).toContain("V1-SUMMARY");

    // skill 发新版（同 key v2，PUBLISHED）
    await t.repos.skills.insert({ ...skillV1, id: "skl_ref_2", version: 2, summary: "V2-SUMMARY 产能分析新口径", body: "v2 body" });

    // 下次加载即新内容 + 留痕 v2
    t.llm.queueAgentTurn({ content: [text("v2 回答")] });
    const r2 = await submitQuery(t, PLANNER, "技能再测试", { view: "skilltest", selectedObjects: [] });
    const task2 = await waitForTask(t, r2.taskId);
    expect(task2.status).toBe("COMPLETED");
    expect(task2.resolvedRefs).toContainEqual({ kind: "skill", key: "ref_skill", version: 2 });
    const sys2 = t.llm.agentRequests.at(-1)?.system ?? "";
    expect(sys2).toContain("V2-SUMMARY");
    expect(sys2).not.toContain("V1-SUMMARY");

    // skill publish 响应附影响面（引用该 key 的 agent）
    const skl3 = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills",
      headers: debugHeaders(ADMIN),
      payload: { key: "ref_skill", name: "引用技能", summary: "V3", body: "v3 body", resources: [] },
    });
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${(skl3.json() as { id: string }).id}/publish`, headers: debugHeaders(ADMIN), payload: {} });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { impact: { agents: number } }).impact.agents).toBe(1);
  });
});
