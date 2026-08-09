import { describe, expect, it } from "vitest";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import type { AgentDefinition, SkillDefinition } from "@platform/contracts";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { lintSkill } from "../src/skill-lint.js";
import { ENFORCED_SKILL_REF_SLOTS, isEnforcedSkillRefSlot } from "../src/engine.js";

/**
 * WO-S05 · 欠账 #154：Skill 出厂态唯一的 precondition 声明被静默丢弃。
 *
 * 病灶：`capacity_action_draft` 声明 `{kind:"solver", key:"capacity_forecast", role:"precondition"}`，
 * 而 engine 的 `skillRuleRefs` 首判据是 `kind === "rule"` ⇒ 声明在、消费方在、两者对不上，
 * 被一行过滤器静默丢弃，不报错不告警（形态④）。
 *
 * 本文件的断言一律落在**效果层**：断言「模型实际收到了什么」，而不是「某函数返回了非空数组」。
 * 后者在修复前后都能绿（数组里有没有那个 key 与门有没有真的拦住是两回事）——那正是本仓反复栽的
 * 「绿测试 ≠ 能用」。
 */

const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };

/** 技能正文里的指纹串：模型收到它 = 真拿到了可执行正文；收不到 = 被门拦下。 */
const OPERATIVE_BODY_MARK = "把产能推演结论转成";

function seededSkill(key: string): SkillDefinition {
  const s = seedRegistry().skills.find((x) => x.key === key);
  if (!s) throw new Error(`seed skill not found: ${key}`);
  return s;
}

async function makeAgentWithSkill(t: TestApp, skill: SkillDefinition): Promise<AgentDefinition> {
  await t.repos.skills.insert(skill);
  const agent: AgentDefinition = {
    id: "agt_solver_precond",
    tenantId: TENANT,
    key: "solver_precond_agent",
    version: 1,
    name: "Solver Precondition Agent",
    description: "test",
    model: "",
    systemPrompt: "你是测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [{ skillId: skill.id, version: skill.version }],
    mcpServers: [],
    // executor 的 scope 门对空数组也生效（`[]` 为真值 → 全拒），故必须显式列出本用例要走的工具。
    scopeDeclaration: { objectTypes: [], toolNames: ["invoke_solver", "load_skill", "final_answer"] },
    status: "PUBLISHED",
  };
  await t.repos.agents.insert(agent);
  return agent;
}

/**
 * 取模型实际收到的全部 tool_result 文本（= 效果层观察点：模型到底看到了什么）。
 *
 * 只读**最后一轮请求**：每轮请求都带完整对话历史，跨轮累加会把同一条 tool_result 数很多遍
 * （初版就这么数出了 8 条）。最后一轮的 messages 即全量历史，顺序即发生顺序。
 */
function toolResultTexts(t: TestApp): string[] {
  const last = t.llm.agentRequests[t.llm.agentRequests.length - 1];
  if (!last) return [];
  const out: string[] = [];
  for (const m of last.messages) {
    if (typeof m.content === "string") continue;
    for (const block of m.content) {
      if ("type" in block && block.type === "tool_result") out.push(block.content);
    }
  }
  return out;
}

describe("WO-S05 · solver 类 skill precondition 真的被求值（#154）", () => {
  it("出厂声明驱动：capacity_forecast 未跑 → load_skill 拿不到正文；跑完 → 拿到正文", async () => {
    const t = await createTestApp();
    // ⚠️ 用**出厂那条声明本身**（seedRegistry），不是测试现编的 references —— 否则就是
    // 「生产实参与测试实参交集为空」那类假绿：测试验的那条路生产根本不走（铁律 0.5 判据 6）。
    const skill = seededSkill("capacity_action_draft");
    expect(skill.references).toEqual([
      { kind: "solver", key: "capacity_forecast", role: "precondition", required: true },
    ]);
    const agent = await makeAgentWithSkill(t, skill);

    // 第 1 轮：先取技能正文（此刻求解器还没跑）
    t.llm.queueAgentTurn(() => ({ content: [toolUse("load_skill", { skillId: skill.id })] }));
    // 第 2 轮：跑求解器（把前置条件从 unmet 翻成 met）
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", demandDelta: 0.1, weeks: 6 } })],
    }));
    // 第 3 轮：再取一次技能正文
    t.llm.queueAgentTurn(() => ({ content: [toolUse("load_skill", { skillId: skill.id })] }));
    // 第 4 轮：交卷（WRITE 技能 → final_answer 必须含 action_draft）
    t.llm.queueAgentTurn(() => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "action_draft", draftId: "d1", actionType: "adjust", summary: "加开一个班次" }],
          provenance: [{ toolCallId: "tc_001", outputPath: "$" }],
        }),
      ],
    }));

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_solver_precond",
      agentId: agent.id,
      version: 1,
      prompt: "按这个方案生成行动计划",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    expect(result.outcome).toBe("ANSWERED");

    const results = toolResultTexts(t);
    const skillLoads = results.filter((r) => r.includes("前置条件尚未满足") || r.includes(OPERATIVE_BODY_MARK));
    expect(skillLoads.length).toBe(2);

    // 🔴 效果层断言 1（本 WO 的核心·修复前必红）：求解器没跑过时，模型收到的是**门禁说明**而非技能正文。
    // 修复前 loadSkill 无条件下发 skill.body ⇒ 这里会收到 OPERATIVE_BODY_MARK，本断言立刻红。
    expect(skillLoads[0]).toContain("前置条件尚未满足");
    expect(skillLoads[0]).toContain("capacity_forecast");
    expect(skillLoads[0]).not.toContain(OPERATIVE_BODY_MARK);

    // 🔴 效果层断言 2：门不是「永远拦」——求解器成功跑过之后，正文照常下发。
    // 若把判据写成「只要声明了 precondition 就拦」，这条会红。
    expect(skillLoads[1]).toContain(OPERATIVE_BODY_MARK);
    expect(skillLoads[1]).not.toContain("前置条件尚未满足");
  });

  it("判据是「跑成功过」而不是「调用过」：求解器调用失败 → 正文仍不下发", async () => {
    const t = await createTestApp();
    const skill = seededSkill("capacity_action_draft");
    const agent = await makeAgentWithSkill(t, skill);

    // 求解器抛错 → toolCall outcome 记为 ERROR（非 OK）
    t.dataCore.solver.invoke = async () => {
      throw new Error("solver boom");
    };

    t.llm.queueAgentTurn(() => ({
      content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: {} })],
    }));
    t.llm.queueAgentTurn(() => ({ content: [toolUse("load_skill", { skillId: skill.id })] }));
    t.llm.queueAgentTurn(() => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "action_draft", draftId: "d1", actionType: "adjust", summary: "缺推演结论，先补" }],
          provenance: [{ toolCallId: "tc_001", outputPath: "$" }],
        }),
      ],
    }));

    await t.deps.engine.runRegisteredAgent({
      taskId: "task_solver_precond_failed",
      agentId: agent.id,
      version: 1,
      prompt: "按这个方案生成行动计划",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    const calls = await t.repos.toolCalls.listByTask("task_solver_precond_failed");
    const solverCall = calls.find((c) => c.toolName === "invoke_solver");
    expect(solverCall?.outcome).not.toBe("OK"); // 前提自证：这一跑确实失败了

    // 🔴 效果层断言：失败的求解调用不算「已满足前置」——否则 agent 可以靠空调一次求解器骗过门。
    const gate = toolResultTexts(t).find((r) => r.includes("前置条件尚未满足") || r.includes(OPERATIVE_BODY_MARK));
    expect(gate).toContain("前置条件尚未满足");
  });

  it("不带 solver precondition 的技能不受影响（门只在声明处生效）", async () => {
    const t = await createTestApp();
    const skill = seededSkill("capacity_analysis"); // references 只有 rule+postcheck
    expect((skill.references ?? []).some((r) => r.kind === "solver" && r.role === "precondition")).toBe(false);
    const agent = await makeAgentWithSkill(t, skill);

    t.llm.queueAgentTurn(() => ({ content: [toolUse("load_skill", { skillId: skill.id })] }));
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "答案" }], provenance: [] })],
    }));

    await t.deps.engine.runRegisteredAgent({
      taskId: "task_no_precond",
      agentId: agent.id,
      version: 1,
      prompt: "产能分析",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    expect(toolResultTexts(t).some((r) => r.includes("前置条件尚未满足"))).toBe(false);
  });
});

/**
 * 防复发机制（本 WO §3）：今天的病根不是「配错了一个字段」，是**配错了没人吭声**。
 * 下面这组咬的是那道门本身 —— 让「声明了运行时不会执行的引用」在发布 lint 处当场可见。
 */
describe("WO-S05 · 防复发：不可执行的引用声明必须被 lint 报出来", () => {
  const BASE = {
    summary: "测试用 Skill。当用户问测试问题时使用。不适用：非测试问题。",
    body: `## 目的
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
按 Skill 策略输出。`,
    resources: [],
  };

  const unenforceable = (r: { violations: { rule: string; message: string }[] }) =>
    r.violations.filter((x) => x.rule.endsWith(".unenforceable"));

  it("金丝雀：一条**已知必中**的不可执行声明确实被抓到（否则是门坏了，不是仓库干净）", () => {
    // constraint+precondition 是合法词表组合，但运行时无任何消费方 → 必须报。
    const v = lintSkill({
      ...BASE,
      references: [{ kind: "constraint", key: "C_X", role: "precondition", required: true }],
    });
    expect(unenforceable(v).length).toBe(1);
    expect(unenforceable(v)[0]!.message).toContain("运行时不会被执行");
  });

  it("修好的那种组合（solver+precondition）不再被报 —— 与 engine 取值共用同一份登记表", () => {
    const v = lintSkill({
      ...BASE,
      references: [{ kind: "solver", key: "capacity_forecast", role: "precondition", required: true }],
    });
    expect(unenforceable(v)).toEqual([]);
    // 判据同源自证：lint 与 engine 用的是同一个谓词，不是各抄一份正则（铁律 0.6）。
    expect(isEnforcedSkillRefSlot("solver", "precondition")).toBe(true);
    expect(isEnforcedSkillRefSlot("constraint", "precondition")).toBe(false);
  });

  it("告知性 role（context/fallback）不误报 —— 它们由资源图投影消费，本就不承诺执行", () => {
    const v = lintSkill({
      ...BASE,
      references: [
        { kind: "solver", key: "risk_timeline", role: "context", required: true },
        { kind: "workflow", key: "sop_balance_wf", role: "context", required: true },
        { kind: "agent", key: "analyst", role: "fallback", required: false },
      ],
    });
    expect(unenforceable(v)).toEqual([]);
  });

  it("出厂 7 个技能全部通过这道门（登记表与出厂声明一致，收窄登记表即红）", () => {
    for (const s of seedRegistry().skills) {
      const v = lintSkill({
        summary: s.summary,
        body: s.body,
        resources: s.resources,
        ...(s.references ? { references: s.references } : {}),
        ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}),
      });
      expect({ key: s.key, violations: unenforceable(v) }).toEqual({ key: s.key, violations: [] });
    }
    // 登记表本身别被悄悄清空（清空则上面全绿但门已失效）。
    expect(ENFORCED_SKILL_REF_SLOTS.length).toBeGreaterThanOrEqual(3);
  });
});
