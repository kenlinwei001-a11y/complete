/**
 * WO-NUMERIC-REDLINE-BLOCK · **分路处置**的引擎级接缝断言（两条路各自的交付出口）。
 *
 * 本文件与 `numeric-redline-block.seam.test.ts` 分工：
 *   · 那份钉 **dsh 路重组装**层（拒绝判据本身）；
 *   · 本份钉 **engine 交付出口**层——同一份「凭空的数」在两条路上得到**不同处置**，
 *     且两个处置都能被机器读出来（outcome + 屏上原文 + 计数器）。
 *
 * 分路处置（不是一刀切，改动前先读）：
 *   | 路     | 处置                       | 为什么 |
 *   | dsh    | **无条件阻断**             | 新能力·defaultOn:false·不破坏既有流 |
 *   | 原生   | **先只报不断**，只计数     | 无条件阻断会改既有行为·先拿数，收紧是产品裁决 |
 *
 * ⚠ 原生路的断言**故意断言「放行」**：哪天有人顺手把原生路也改成阻断，这里会红。
 *   那是产品裁决不是实现细节 —— 红了要去找仓主，不是改这条测试。
 *
 * LLM 全程 mock（`ScriptedLlmClient`），确定性 R6。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { hasUnverifiedNumerics } from "../src/util/numerics.js";

const planner = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

/** 凭空来的数（无 ⟦ref:N⟧ 溯源指针）——agent 自己编的口径。 */
const FABRICATED = "常州基地 9 月产能缺口 1200 台，建议下调接单量。";
/** 同一结论，但数字挂了溯源指针（平台既有的「已溯源」表达法）。 */
const SOURCED = "根据求解器结果，常州基地 9 月产能缺口 1200 台 ⟦ref:0⟧。建议优先保交付。";

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "numeric redline path test agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
    ...partial,
  } as AgentDefinition;
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

/** 原生路跑一次：模型直接 final_answer 给定正文。 */
async function runNative(taskId: string, markdown: string, provenance: unknown[] = []) {
  await t.repos.agents.insert(agentDef({ id: `agt_${taskId}`, key: `k_${taskId}` }));
  t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown }], provenance })] });
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: `agt_${taskId}`,
    version: "latest",
    prompt: "常州基地 9 月产能缺口多少",
    ctx: planner,
    nesting: { callChain: [], budget: new BudgetTracker() },
    emit: async () => undefined,
  });
}

const wouldBlock = () => t.metrics.numericRedline.get({ path: "AGENT_NATIVE", action: "would_block" });
const blocked = () => t.metrics.numericRedline.get({ path: "AGENT_DSH", action: "blocked" });

describe("§1 实验 1 · 同一份凭空数字，两条路处置不同", () => {
  it("1.1 原生路：**放行**（outcome ANSWERED·正文原样上屏），但 would_block 计数 +1", async () => {
    // 金丝雀：先证检测器咬得动这句话，否则下面的「计数 +1」不度量任何东西
    expect(hasUnverifiedNumerics(FABRICATED), "金丝雀不中 ⇒ 【检测器坏了】").toBe(true);
    expect(wouldBlock()).toBe(0);

    const r = await runNative("task_native_bad", FABRICATED);

    expect(r.outcome, "原生路本单**刻意不阻断**；此处变红＝有人把产品裁决当实现细节改了").toBe("ANSWERED");
    const md = r.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("1200"); // 编的数确实送达了用户
    expect(r.answer.unverifiedNumerics).toBe(true); // 只打了诚实标
    expect(wouldBlock(), "「若阻断会拦下多少」= 1").toBe(1);
    expect(blocked(), "原生路不该记 dsh 的 blocked 桶").toBe(0);
  });

  it("1.2 计数记在**交付出口**：一次运行至多 +1（不随 final_answer 尝试次数膨胀）", async () => {
    await runNative("task_native_once", FABRICATED);
    expect(wouldBlock()).toBe(1);
  });
});

describe("§2 实验 2 · 反向对照：合法产出必须放行且计数不增", () => {
  it("2.1 原生路：数字全部挂 ⟦ref:0⟧ ⇒ 放行 ∧ unverifiedNumerics=false ∧ would_block 不增", async () => {
    expect(hasUnverifiedNumerics(SOURCED), "已溯源的句子若被咬 ⇒ 无差别拦截").toBe(false);

    const r = await runNative("task_native_ok", SOURCED);

    expect(r.outcome).toBe("ANSWERED");
    expect(r.answer.unverifiedNumerics).toBe(false);
    expect(wouldBlock(), "合法产出把计数顶起来 ⇒ 这个数就不再是「该拦多少」").toBe(0);
    expect(blocked()).toBe(0);
  });

  it("2.2 反向对照的**判别力**：同一条路，换成裸数就计数、换回溯源就不计数", async () => {
    await runNative("task_pair_ok", SOURCED);
    expect(wouldBlock()).toBe(0);
    await runNative("task_pair_bad", FABRICATED);
    expect(wouldBlock(), "两个用例结果必须相反，否则这把尺子恒真/恒假").toBe(1);
  });
});
