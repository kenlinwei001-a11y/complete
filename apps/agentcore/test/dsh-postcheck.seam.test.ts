import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition, SkillDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
} from "./helpers-dsh-stub.js";

/**
 * WO-DSH-PROD-READY · W1：DSH 路径挂 postcheck 规则后验（生产可接第一前提）。
 *
 * **接缝在哪**：原生路径出 loop 后过两段后验（engine.ts「Skill 规则引用后验」+
 * 「ruleBindings POST_CHECK」），BLOCK ⇒ answer 替换为 rule_violation；
 * DSH 分叉此前在二者**之前**提前 return —— 同一条 agent 配置，选原生被规则拦、
 * 选 DSH 直接放行 = 治理语义按内核分裂（DSH vs 原生最大语义差，WO-AGENT-KERNEL-SELECT
 * 把内核选择权交给 per-agent 配置后，这条缝从「POC 内部事项」升级为「管理台可见的产品行为」）。
 *
 * **对拍基准**：断言形状逐字对齐原生两段后验（provId / rule_violation blocks / fail-open），
 * 双路差异只允许为零。
 */
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO"] as const;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "postcheck 对拍 agent",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "echo_tool" }],
    // 与原生 postcheck 测试同形态：ALL_APPLICABLE 之外的显式 key，便于精确 mock evaluate
    ruleBindings: { ruleKeys: ["POST_RULE_X"], mode: "POST_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["echo_tool"] },
    status: "PUBLISHED",
    ...partial,
  };
}

/** skill 带 postcheck 规则引用（WO-SKILL-2 后验段的触发构造）。 */
function postcheckSkill(): SkillDefinition {
  return {
    id: "skl_postcheck_dsh",
    tenantId: TENANT,
    key: "postcheck_dsh",
    version: 1,
    name: "Postcheck DSH",
    summary: "测试用 Skill。当用户问后验问题时使用。不适用：非测试问题。",
    body: "## 目的\n测试。\n## 适用边界\n适用：测试。不适用：其他。\n## 前置检查\n无。\n## 步骤\n1. 直接 final_answer。\n## 示例\n正例：问测试 → 返回答案。\n反例：无。\n## 失败处理\n无。\n## 输出要求\n按 Skill 策略输出。",
    references: [{ kind: "rule", key: "SKILL_POST_RULE", role: "postcheck", required: true }],
    resources: [],
    status: "PUBLISHED",
  } as SkillDefinition;
}

describe("WO-DSH-PROD-READY W1 · DSH 路径 postcheck 后验对拍", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // per-agent kernel 驱动，进程 env 恒关——分叉来源无歧义
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function runDshOnce(t: TestApp, agentId: string, taskId: string) {
    return t.deps.engine.runRegisteredAgent({
      taskId,
      agentId,
      version: "latest",
      prompt: "看一下基地情况",
      ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
      nesting: {
        callChain: [],
        budget: new BudgetTracker(computeResidualBudget(loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv))),
      },
      emit: async () => {},
    });
  }

  /** stub DSH 两轮（final_answer 文本 + 收尾），agent kernel=EXTERNAL。 */
  async function setupDshAgent(agent: AgentDefinition) {
    const stub = await startStubOpenAi([
      { toolCall: { name: "final_answer", arguments: JSON.stringify({ blocks: [{ type: "text", markdown: "未经规则把关的回答。" }], provenance: [] }) }, usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
      { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
    ]);
    const t = await createTestApp({
      providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
      // F-1：生产档 cordis.yml 治理已切 http 模式；本缝验 postcheck 不验 pre-execute 裁决，
      // 钉 poc 档（mock 治理放行）保持既有语义。
      env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
    });
    await t.repos.agents.insert(agent);
    return { stub, t };
  }

  it("① ruleBindings POST_CHECK BLOCK ⇒ DSH 答案同样被替换为 rule_violation（prov_post_check）", { timeout: 60_000 }, async () => {
    const { stub, t } = await setupDshAgent(agentDef({ id: "agt_post_dsh", key: "post_dsh", kernel: "EXTERNAL" }));
    try {
      vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
        { ruleId: "POST_RULE_X", passed: false, severity: "BLOCK", explanation: "后验命中", ruleVersion: 1 },
      ]);
      const result = await runDshOnce(t, "agt_post_dsh", "task_post_dsh");
      // 钉死「真走了 DSH 分叉」——否则本臂测的是原生路径，结论整个反掉。
      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.answer.blocks.some((b) => b.type === "rule_violation" && b.ruleId === "POST_RULE_X" && b.provId === "prov_post_check")).toBe(true);
      expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown.includes("未经规则把关"))).toBe(false);
      // stats 回声与治理替换正交（N2·D-2）：后验换掉的是答案内容，运行观测回声必须存活——
      // 与对拍驱动 A4 锚「dsh 臂必带 stats」同一份语义，此处钉在本缝内。
      expect((result.answer as { stats?: unknown }).stats).toBeDefined();
    } finally {
      await stub.close();
    }
  });

  it("② 对拍 · ruleBindings POST_CHECK 通过 ⇒ DSH 答案原样放行（后验真跑了但不冤枉好人）", { timeout: 60_000 }, async () => {
    const { stub, t } = await setupDshAgent(agentDef({ id: "agt_post_pass", key: "post_pass", kernel: "EXTERNAL" }));
    try {
      const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
        // severity 词表是 `["BLOCK","WARN"]`（contracts `common.ts` RuleVerdictSchema）——**没有 INFO**。
        // 原写 "INFO" 时 vitest 照绿（它不做类型检查），`tsc` 才红 ⇒ 这一臂曾是「测试绿但四包 typecheck 红」。
        // 本臂验的是「passed:true ⇒ 放行」，severity 取值与断言无关，取词表内的非阻断档即可。
        { ruleId: "POST_RULE_X", passed: true, severity: "WARN", explanation: "通过", ruleVersion: 1 },
      ]);
      const result = await runDshOnce(t, "agt_post_pass", "task_post_pass");
      expect(result.run.kernel).toBe("EXTERNAL");
      expect(evaluateSpy).toHaveBeenCalled(); // 「通过后放行」与「压根没跑后验」必须可区分
      expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown.includes("未经规则把关"))).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it("③ skill postcheck 引用 BLOCK ⇒ DSH 答案被替换（prov_skill_rule_check，先于 ruleBindings 段）", { timeout: 60_000 }, async () => {
    const { stub, t } = await setupDshAgent(
      agentDef({ id: "agt_post_skill", key: "post_skill", kernel: "EXTERNAL", ruleBindings: { ruleKeys: [], mode: "POST_CHECK" }, skills: [{ skillId: "skl_postcheck_dsh", version: 1 }] }),
    );
    try {
      await t.repos.skills.insert(postcheckSkill());
      vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
        { ruleId: "SKILL_POST_RULE", passed: false, severity: "BLOCK", explanation: "技能后验命中", ruleVersion: 1 },
      ]);
      const result = await runDshOnce(t, "agt_post_skill", "task_post_skill");
      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.answer.blocks.some((b) => b.type === "rule_violation" && b.ruleId === "SKILL_POST_RULE" && b.provId === "prov_skill_rule_check")).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it("④ 诚实位 · rules 引擎抛错 ⇒ fail-open 放行（与原生 catch 语义一致，不把后验故障变成答案故障）", { timeout: 60_000 }, async () => {
    const { stub, t } = await setupDshAgent(agentDef({ id: "agt_post_failopen", key: "post_failopen", kernel: "EXTERNAL" }));
    try {
      vi.spyOn(t.dataCore.rules, "evaluate").mockRejectedValue(new Error("rules engine down"));
      const result = await runDshOnce(t, "agt_post_failopen", "task_post_failopen");
      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown.includes("未经规则把关"))).toBe(true);
    } finally {
      await stub.close();
    }
  });
});
