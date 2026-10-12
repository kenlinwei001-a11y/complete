import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, type TestApp } from "./helpers.js";
import type { SkillDefinition } from "@platform/contracts";

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };

const GOOD_SUMMARY =
  "产能阈值解读。当用户问某型号未来几周还能加多少量时使用。不适用：已给出具体百分比增量的正向 what-if 问题。";
const GOOD_BODY = `## 目的
回答还能加多少量。
## 适用边界
适用：问增量余量。不适用：给定增量问可不可行。
## 前置检查
确认 modelId 与 weeks 存在。
## 步骤
1. 调用 capacity_forecast mode=threshold。
## 示例
正例：问 4680-NCM 未来 6 周还能加多少 → 返回 thresholdQty。
反例：问加 10% 能不能接 → 应走 capacity_feasibility。
## 失败处理
求解器错误→转述，禁止编造。
## 输出要求
含 provenance 块。`;

async function createSkill(t: TestApp, payload: Record<string, unknown>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/b/v1/skills", headers: H, payload });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe("WO-SKILL-1 · Skill 工业级契约持久化", () => {
  it("创建 Skill 时新工业级字段可写入并原样读出", async () => {
    const t = await createTestApp();
    const payload = {
      key: "capacity_threshold_analysis",
      name: "产能阈值分析",
      summary: GOOD_SUMMARY,
      body: GOOD_BODY,
      resources: [],
      capability: "forecast",
      sideEffect: "READ",
      inputSchema: {
        type: "object",
        required: ["modelId", "weeks"],
        properties: {
          modelId: { type: "string" },
          weeks: { type: "number", default: 6 },
        },
      },
      outputSchema: {
        type: "object",
        required: ["thresholdQty", "unit"],
        properties: {
          thresholdQty: { type: "number" },
          unit: { type: "string" },
        },
      },
      references: [
        { kind: "rule", key: "C03", role: "postcheck", required: true },
        { kind: "slice", key: "model_capacity_network", role: "context", required: false },
      ],
      dependsOn: [],
      approvalGate: "none",
      provenancePolicy: "required",
      maxBudgetRounds: 12,
    };
    const id = await createSkill(t, payload);

    const get = await t.app.inject({ method: "GET", url: `/b/v1/skills/${id}`, headers: H });
    expect(get.statusCode).toBe(200);
    const skill = get.json() as SkillDefinition;

    expect(skill.capability).toBe("forecast");
    expect(skill.sideEffect).toBe("READ");
    expect(skill.approvalGate).toBe("none");
    expect(skill.provenancePolicy).toBe("required");
    expect(skill.maxBudgetRounds).toBe(12);
    expect(skill.inputSchema).toEqual(payload.inputSchema);
    expect(skill.outputSchema).toEqual(payload.outputSchema);
    expect(skill.references).toHaveLength(2);
    expect(skill.references![0]).toMatchObject({ kind: "rule", key: "C03", role: "postcheck", required: true });
  });

  it("skills.latestByKey 返回同 key 最高版本", async () => {
    const t = await createTestApp();
    const key = "latest_by_key_skill";
    await t.repos.skills.insert({
      id: "skl_v1",
      tenantId: TENANT,
      key,
      version: 1,
      name: "v1",
      summary: GOOD_SUMMARY,
      body: GOOD_BODY,
      resources: [],
      status: "PUBLISHED",
    } as SkillDefinition);
    await t.repos.skills.insert({
      id: "skl_v2",
      tenantId: TENANT,
      key,
      version: 2,
      name: "v2",
      summary: GOOD_SUMMARY,
      body: GOOD_BODY,
      resources: [],
      status: "DRAFT",
    } as SkillDefinition);

    const latest = await t.repos.skills.latestByKey(TENANT, key);
    expect(latest).toBeDefined();
    expect(latest!.version).toBe(2);
    expect(latest!.name).toBe("v2");
  });

  it("Agent 绑定 Skill 时可带 arguments 预填参数", async () => {
    const t = await createTestApp();
    const skillId = await createSkill(t, {
      key: "agent_bound_skill",
      name: "Agent Bound Skill",
      summary: GOOD_SUMMARY,
      body: GOOD_BODY,
      resources: [],
      inputSchema: { type: "object", properties: { weeks: { type: "number" } } },
    });

    const agentRes = await t.app.inject({
      method: "POST",
      url: "/b/v1/agents",
      headers: H,
      payload: {
        key: "agent_with_skill_args",
        name: "Agent With Skill Args",
        description: "test",
        systemPrompt: "you are a tester",
        tools: [],
        ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
        skills: [{ skillId, version: "latest", arguments: { weeks: 6 } }],
        mcpServers: [],
        scopeDeclaration: { objectTypes: [], toolNames: [] },
      },
    });
    expect(agentRes.statusCode).toBe(201);

    const agentId = (agentRes.json() as { id: string }).id;
    const agentGet = await t.app.inject({ method: "GET", url: `/b/v1/agents/${agentId}`, headers: H });
    expect(agentGet.statusCode).toBe(200);
    const agent = agentGet.json() as { skills: { skillId: string; version: number | "latest"; arguments?: Record<string, unknown> }[] };
    expect(agent.skills[0]!.arguments!).toEqual({ weeks: 6 });
  });
});
