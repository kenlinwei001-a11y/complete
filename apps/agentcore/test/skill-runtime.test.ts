import { describe, expect, it, vi } from "vitest";
import { createTestApp, ADMIN, TENANT, type TestApp } from "./helpers.js";
import type { AgentDefinition, SkillDefinition } from "@platform/contracts";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };

const GOOD_SUMMARY =
  "测试用 Skill。当用户问测试问题时使用。不适用：非测试问题。";
const GOOD_BODY = `## 目的
测试。
## 适用边界
适用：测试。不适用：其他。
## 前置检查
无。
## 步骤
1. 直接 final_answer。
## 示例
正例：问测试 → 返回测试答案。
反例：无。
## 失败处理
无。
## 输出要求
按 Skill 策略输出。`;

async function makeAgentWithSkill(t: TestApp, skill: SkillDefinition): Promise<AgentDefinition> {
  await t.repos.skills.insert(skill);
  const agent: AgentDefinition = {
    id: "agt_test_skill_runtime",
    tenantId: TENANT,
    key: "test_skill_runtime",
    version: 1,
    name: "Test Skill Runtime Agent",
    description: "test",
    model: "",
    systemPrompt: "你是测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [{ skillId: skill.id, version: 1 }],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
  };
  await t.repos.agents.insert(agent);
  return agent;
}

function baseSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "skl_runtime_base",
    tenantId: TENANT,
    key: "runtime_base",
    version: 1,
    name: "Runtime Base",
    summary: GOOD_SUMMARY,
    body: GOOD_BODY,
    resources: [],
    status: "PUBLISHED",
    ...overrides,
  } as SkillDefinition;
}

describe("WO-SKILL-2 · Skill 运行时策略", () => {
  it("provenancePolicy=required 时无 provenance 的 final_answer 被拒，含 provenance 的被接受", async () => {
    const t = await createTestApp();
    const skill = baseSkill({ provenancePolicy: "required" });
    const agent = await makeAgentWithSkill(t, skill);

    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "第一版答案" }], provenance: [] })],
    }));
    t.llm.queueAgentTurn(() => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "第二版带溯源" }],
          provenance: [{ toolCallId: "tc_001", outputPath: "$" }],
        }),
      ],
    }));

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_prov_test",
      agentId: agent.id,
      version: 1,
      prompt: "测试溯源策略",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    expect(result.outcome).toBe("ANSWERED");
    const text = result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("");
    expect(text).toContain("第二版带溯源");
    expect(text).not.toContain("第一版答案");
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(2);
  });

  it("writeMode 下 final_answer 必须含 action_draft，否则被拒", async () => {
    const t = await createTestApp();
    const skill = baseSkill({ sideEffect: "WRITE" });
    const agent = await makeAgentWithSkill(t, skill);

    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "只有文本" }], provenance: [] })],
    }));
    t.llm.queueAgentTurn(() => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "action_draft", draftId: "d1", actionType: "adjust", summary: "调整产能" }],
          provenance: [],
        }),
      ],
    }));

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_write_test",
      agentId: agent.id,
      version: 1,
      prompt: "测试写模式",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    expect(result.outcome).toBe("ANSWERED");
    expect(result.answer.blocks.some((b) => b.type === "action_draft")).toBe(true);
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(2);
  });

  it("Skill precondition 规则 BLOCK → 不调用 LLM 直接返回 rule_violation", async () => {
    const t = await createTestApp();
    const skill = baseSkill({
      references: [{ kind: "rule", key: "PRE_BLOCK", role: "precondition", required: true }],
    });
    const agent = await makeAgentWithSkill(t, skill);

    const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
      { ruleId: "PRE_BLOCK", passed: false, severity: "BLOCK", explanation: "预检规则命中", ruleVersion: 1 },
    ]);

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_pre_test",
      agentId: agent.id,
      version: 1,
      prompt: "测试预检",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    expect(evaluateSpy).toHaveBeenCalledWith(CTX, ["PRE_BLOCK"], expect.objectContaining({ queryText: "测试预检" }));
    expect(result.outcome).toBe("ANSWERED");
    expect(result.answer.blocks.some((b) => b.type === "rule_violation" && b.ruleId === "PRE_BLOCK")).toBe(true);
    expect(t.llm.agentRequests.length).toBe(0);
  });

  it("Skill postcheck 规则 BLOCK → 最终答案被替换为 rule_violation", async () => {
    const t = await createTestApp();
    const skill = baseSkill({
      references: [{ kind: "rule", key: "POST_BLOCK", role: "postcheck", required: true }],
    });
    const agent = await makeAgentWithSkill(t, skill);

    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "原始答案" }], provenance: [] })],
    }));

    const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
      { ruleId: "POST_BLOCK", passed: false, severity: "BLOCK", explanation: "后验规则命中", ruleVersion: 1 },
    ]);

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_post_test",
      agentId: agent.id,
      version: 1,
      prompt: "测试后验",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    expect(evaluateSpy).toHaveBeenCalledWith(CTX, ["POST_BLOCK"], expect.objectContaining({ answerText: "原始答案" }));
    expect(result.outcome).toBe("ANSWERED");
    expect(result.answer.blocks.some((b) => b.type === "rule_violation" && b.ruleId === "POST_BLOCK")).toBe(true);
    expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown === "原始答案")).toBe(false);
  });
});
