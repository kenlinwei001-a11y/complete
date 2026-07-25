import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM_CORE } from "../src/agent/prompts.js";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * WO-HARNESS-PROMPT · 七要素 SEAM（每个 agent 的**有效系统提示词** = agent 自身结构块 ⊕ 共享核 AGENT_SYSTEM_CORE）。
 *
 * 接缝驱动（非各半绿）：agent 提示词只写 角色/目标/对象域/对口能力/交卷（5 段）；推理循环/错误恢复/求解纪律/结果结构
 * 四段由共享核继承（engine.ts 组合 `${agent.systemPrompt}\n\n${AGENT_SYSTEM_CORE}`）。本测断言**组合态**七要素齐——
 * 任一半漏（agent 缺结构块 或 核缺 harness 段）即红；且锁定短语（数字红线/写降级/能力边界/注入防护/本题导航图）不因重构丢失。
 */

// 组合有效系统提示词（镜像 engine.ts:205 的拼装口径·不含 skill 段）。
function effectivePrompt(agentSystemPrompt: string): string {
  return `${agentSystemPrompt}\n\n${AGENT_SYSTEM_CORE}`;
}

/** 共享核新增四段（Task A·叠加不删改）。 */
const CORE_HARNESS_SECTIONS = ["【推理循环】", "【错误恢复】", "【求解纪律】", "【结果结构】"];
/** agent 结构块五段（Task B）。 */
const AGENT_STRUCT_MARKERS = ["【角色】", "【目标】", "【对象域】", "【对口能力】", "【交卷】"];
/** 测试锁定短语（硬约束·全文保留·跨重构不弱化）。 */
const LOCKED_PHRASES = ["数字红线", "写降级", "能力边界", "注入防护", "本题导航图"];

describe("WO-HARNESS-PROMPT · 共享核 AGENT_SYSTEM_CORE 叠加四段 + 锁定短语保留", () => {
  it("Task A：四段 harness 已叠加进共享核（推理循环/错误恢复/求解纪律/结果结构）", () => {
    for (const s of CORE_HARNESS_SECTIONS) {
      expect(AGENT_SYSTEM_CORE, `共享核缺 ${s}`).toContain(s);
    }
  });

  it("锁定短语一字不丢（叠加不删改·四红线语义保留）", () => {
    for (const kw of LOCKED_PHRASES) {
      expect(AGENT_SYSTEM_CORE, `共享核缺锁定短语 ${kw}`).toContain(kw);
    }
    // 求解纪律段带 solver 名（不自己算的硬指令）·结果结构段带 create_action_draft 写出口。
    expect(AGENT_SYSTEM_CORE).toContain("必须调对口 solver");
    expect(AGENT_SYSTEM_CORE).toContain("create_action_draft");
  });
});

describe("WO-HARNESS-PROMPT · 每个 agent 结构块五段齐（Task B）", () => {
  const { agents } = seedRegistry("2026-07-25T00:00:00Z");

  it("覆盖全部 agent + Coordinator（10 agent + coordinator）", () => {
    // 出厂种子：analyst/explore/risk/capacity/quality/supply/finance/carbon/market/code + coordinator。
    expect(agents.length).toBeGreaterThanOrEqual(11);
    expect(agents.some((a) => a.key === "coordinator")).toBe(true);
  });

  for (const key of [
    "analyst", "explore_agent", "risk_advisor", "capacity_planner", "quality_inspector",
    "supply_chain", "finance_analyst", "carbon_auditor", "external_market", "code_assistant", "coordinator",
  ]) {
    it(`agent[${key}] 自身提示词含五段结构块（角色/目标/对象域/对口能力/交卷）`, () => {
      const a = agents.find((x) => x.key === key);
      expect(a, `未找到 agent ${key}`).toBeTruthy();
      for (const m of AGENT_STRUCT_MARKERS) {
        expect(a!.systemPrompt, `agent[${key}] 缺结构段 ${m}`).toContain(m);
      }
    });
  }
});

describe("WO-HARNESS-PROMPT · SEAM 组合态七要素齐（agent 结构块 ⊕ 共享核 harness 段·任一半漏即红）", () => {
  const { agents } = seedRegistry("2026-07-25T00:00:00Z");
  // 七要素 = agent 侧 角色/目标/对象域 ⊕ 核侧 推理循环/错误恢复/求解纪律/结果结构（组合后才齐）。
  const SEVEN_ELEMENTS = ["【角色】", "【目标】", "【对象域】", ...CORE_HARNESS_SECTIONS];

  for (const a of agents) {
    it(`agent[${a.key}] 组合有效提示词七要素齐 + 锁定短语齐（真跑组合口径·非各半绿）`, () => {
      const eff = effectivePrompt(a.systemPrompt);
      for (const el of SEVEN_ELEMENTS) {
        expect(eff, `agent[${a.key}] 组合态缺七要素 ${el}`).toContain(el);
      }
      // 锁定短语在组合态（核继承）恒在——即使 agent 自身不重复红线（除 analyst 外）。
      for (const kw of LOCKED_PHRASES) {
        expect(eff, `agent[${a.key}] 组合态缺锁定短语 ${kw}`).toContain(kw);
      }
    });
  }

  it("出厂默认 analyst 自身提示词仍含四红线短语（lived-in 锁定不回归·四要素出厂即发布）", () => {
    const analyst = agents.find((a) => a.key === "analyst");
    for (const kw of ["数字红线", "写降级", "能力边界", "注入防护"]) {
      expect(analyst!.systemPrompt, `analyst 缺 ${kw}`).toContain(kw);
    }
  });
});
