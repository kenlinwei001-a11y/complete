/**
 * WO-DSH-E2E · L5 诚实层穿透组合断言（dsh 路 → reassemble → SSE 面）。
 *
 * 范围（WO 裁决）：后端语义链 + 既有五套件绿确认 + 缺口断言；前端上屏半（⟦ref:N⟧ 上标 /
 * scope 徽章 / 降级理由三件 + N6 两模对照）属 node-plan #7 文件 = L3 owner 面，本文件不建。
 * STALL_LOOP 链（watchdog/orchestrator G-9 伪步/落屏）整层 = L3 另派，本文件不断言；
 * 本文件降级臂用 maxTokens ⇒ BUDGET_EXHAUSTED（reassemble 同一条 degraded 通道）。
 *
 * 五组断言：
 *   P1 provenance 溯源到真对象：load_skill 真调用 → final_answer provenance 引用其 callId
 *      ⇒ answer.provenance 解析 toolName=load_skill 且 callId 在帧流可回查（不溯源到空气）；
 *      ⟦ref:1⟧ 标记过重组装逐字保真（后端半；上标渲染是前端半）。
 *   P2 governance 负向（engine 级，engine.ts:520 锚）：skill provenancePolicy=required 而剧本
 *      缺 provenance ⇒ reassemble 拒绝 ⇒ engine 返回 FAILED + 「dsh 重组装拒绝：…」诚实文案
 *      + provenance 空（不编造）；writeMode 而无 action_draft 同形一臂。
 *   P3 EMPTY 口径保真：无 final_answer 软收尾 ⇒ markdown 逐字 == 末 assistant 文本；
 *      空文本 ⇒ 「（探索模式未能产出回答）」逐字；provenance 空。
 *   P4 拒绝口径帧保真：PLATFORM_GOV_DENY 拒 MCP 工具 ⇒ 帧流 tool/result isError 理由逐字；
 *      SSE 面 step.started/step.completed(status ERROR) 不漂白成 OK（native 对照：loop.ts:848
 *      step.completed 载荷亦只带 outcome 不带理由原文 —— 理由原文的归档面 = 帧流/重组装，
 *      SSE 面的诚实义务 = 错误状态不漂白，两臂同口径，不冒充对称之外的保真）。
 *   P5 降级链：maxTokens 注入 ⇒ turn/end max-tokens ⇒ outcome BUDGET_EXHAUSTED +
 *      degraded.reason 原值 + 诚实块（末 assistant 文本复述，不编造结论）+ narration 帧文本保真。
 *
 * 驱动级同 L4（task #20 裁决）：runner 级 = engine 分叉同一执行缝；P2 为 engine 级
 * （runRegisteredAgent，DSH_HARNESS=1，裁决 A stub 缝）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentDefinition, McpServerConfig, SkillDefinition } from "@platform/contracts";
import {
  buildSessionSetup,
  mapMcpConfig,
  mapSkill,
  runDshAgent,
  type DshRunOutput,
  type DshSetupSpec,
  type SseEmission,
} from "../src/dsh-runtime/index.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { createTestApp, TENANT } from "./helpers.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  STUB_MODEL_ID,
  stubDirectory,
  stubProvider,
} from "./helpers-dsh-stub.js";
import { startScriptedOpenAi, type ScriptedRound } from "./helpers-dsh-scripted.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../packages/dsh-harness/test/fixtures/mock-mcp-tenant.mjs", import.meta.url));
const INTEGRATION_TIMEOUT = 90_000;
const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

// ---------------------------------------------------------------------------
// 共享构造
// ---------------------------------------------------------------------------

function skillDef(over: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "skl_l5",
    tenantId: TENANT,
    key: "l5_honesty",
    version: 1,
    name: "L5 Honesty",
    summary: "L5 诚实层测试技能。适用：探针问题。不适用：其他。",
    body: "## 目的\nL5-BODY-MARKER 诚实层探针。\n## 步骤\n1. 作答。",
    resources: [],
    status: "PUBLISHED",
    ...over,
  } as SkillDefinition;
}

function agentDef(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agt_l5",
    tenantId: TENANT,
    key: "l5-honesty",
    version: 1,
    name: "L5 honesty agent",
    description: "L5 honesty composite agent",
    model: "",
    systemPrompt: "你是 L5 诚实层测试 agent。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
    ...over,
  };
}

/** runner 级一次真跑（engine 分叉 env 五件注入同款 + 生产档 cordis.yml）。 */
async function runScripted(
  script: ScriptedRound[],
  opts: {
    setup?: DshSetupSpec;
    maxTokens?: number;
    extraEnv?: Record<string, string>;
    reassemble?: Parameters<typeof runDshAgent>[0]["reassemble"];
  } = {},
): Promise<{ run: DshRunOutput; sse: SseEmission[] }> {
  const stub = await startScriptedOpenAi(script.map((r) => ({ ...r })));
  const sse: SseEmission[] = [];
  try {
    const run = await runDshAgent(
      {
        prompt: "L5 诚实层探针",
        setup: opts.setup ?? buildSessionSetup({ agent: agentDef(), agentSystemCore: "L5-CORE", grantedToolNames: [] }),
        provider: "platform",
        model: STUB_MODEL_ID,
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.reassemble ? { reassemble: opts.reassemble } : {}),
        onSse: (e) => sse.push(e),
      },
      {
        harnessDir: HARNESS_DIR,
        cordisFile: "cordis.yml",
        requestTimeoutMs: 60_000,
        env: {
          PLATFORM_LLM_API: "openai-completions",
          PLATFORM_LLM_BASE_URL: `${stub.url}/v1`,
          PLATFORM_LLM_MODEL: STUB_MODEL_ID,
          PLATFORM_LLM_API_KEY: STUB_FAKE_KEY,
          ...opts.extraEnv,
        },
      },
    );
    return { run, sse };
  } finally {
    await stub.close();
  }
}

const eventsJson = (run: DshRunOutput): string => JSON.stringify(run.events);

describe("WO-DSH-E2E · L5 诚实层穿透", () => {
  it("L5.P1 provenance 溯源到真对象（load_skill 实调可回查）+ ⟦ref:1⟧ 标记逐字保真", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const setup = buildSessionSetup({
      agent: agentDef(),
      agentSystemCore: "L5-CORE",
      grantedToolNames: [],
      skills: [mapSkill(skillDef())],
    });
    const { run } = await runScripted([
      { toolCall: { name: "load_skill", arguments: JSON.stringify({ key: "l5_honesty" }), callId: "call_ls1" }, usage: USAGE },
      {
        toolCall: {
          name: "final_answer",
          arguments: JSON.stringify({
            blocks: [{ type: "text", markdown: "技能作答：L5-PROBE-4731 ⟦ref:1⟧" }],
            provenance: [{ toolCallId: "call_ls1", outputPath: "$" }],
          }),
          callId: "call_fa1",
        },
        usage: USAGE,
      },
      // final_answer 是「记录」不是终止信号：loop 在工具结果后再发一请求（dualrun 剧本同构），
      // 文本轮 stop 收尾 ⇒ turn/end completed。
      { text: "done", usage: USAGE },
    ], { setup });

    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;
    expect(run.result.outcome).toBe("ANSWERED");
    // ⟦ref:1⟧ 标记过重组装逐字保真（后端半）。
    const md = run.result.answer.blocks[0];
    expect(md?.type).toBe("text");
    expect(md && "markdown" in md ? md.markdown : "").toBe("技能作答：L5-PROBE-4731 ⟦ref:1⟧");
    // provenance 解析到真对象：toolName 由帧流真解析，不 "unknown"（不溯源到空气）。
    expect(run.result.answer.provenance).toHaveLength(1);
    const prov = run.result.answer.provenance[0]!;
    expect(prov.toolCallId).toBe("call_ls1");
    expect(prov.toolName).toBe("load_skill");
    expect(prov.source).toBe("TOOL_RESULT");
    // 回查：call_ls1 的 tool/call 与 tool/result 都在帧流，result 携技能正文标记（真对象内容）。
    const callFrame = run.events.find(
      (e) => e.type === "tool/call" && JSON.stringify(e.data).includes('"call_ls1"'),
    );
    expect(callFrame, "provenance 引用的 callId 必须在帧流可回查").toBeDefined();
    expect(JSON.stringify(callFrame!.data)).toContain('"load_skill"');
    const resultFrame = run.events.find(
      (e) => e.type === "tool/result" && JSON.stringify(e.data).includes('"call_ls1"'),
    );
    expect(resultFrame).toBeDefined();
    expect(JSON.stringify(resultFrame!.data)).toContain("L5-BODY-MARKER");
    expect(JSON.stringify(resultFrame!.data)).not.toContain('"isError":true');
  });

  it("L5.P2a governance 负向（engine 级·engine.ts:520 锚）：provenancePolicy=required 缺 provenance ⇒ FAILED + 诚实文案", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const stub = await startScriptedOpenAi([
      {
        toolCall: {
          name: "final_answer",
          arguments: JSON.stringify({ blocks: [{ type: "text", markdown: "无溯源作答" }], provenance: [] }),
        },
        usage: USAGE,
      },
      { text: "unused", usage: USAGE },
    ]);
    const t = await createTestApp({ providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never });
    await t.repos.skills.insert(skillDef({ provenancePolicy: "required" }));
    await t.repos.agents.insert(
      agentDef({ id: "agt_l5_req", model: STUB_DCP_SPEC, skills: [{ skillId: "skl_l5", version: 1 }] }),
    );
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    try {
      const result = await t.deps.engine.runRegisteredAgent({
        taskId: "task_l5_p2a",
        agentId: "agt_l5_req",
        version: "latest",
        prompt: "L5 governance 负向臂",
        ctx: { tenantId: TENANT, userId: "user-l5", roles: ["planner"] },
        nesting: { callChain: [], budget: new BudgetTracker() },
        emit: async () => {},
      });
      expect(result.outcome).toBe("FAILED");
      const md = result.answer.blocks[0];
      const text = md && "markdown" in md ? md.markdown : "";
      expect(text).toContain("dsh 重组装拒绝：Skill provenancePolicy=required：final_answer 必须包含 provenance");
      expect(result.answer.provenance).toEqual([]); // 拒绝臂不编造溯源
      expect(result.run.kernel, "dsh 路失败臂内核徽标 EXTERNAL（N5 锚）").toBe("EXTERNAL");
    } finally {
      delete process.env.DSH_HARNESS;
      delete process.env.DSH_HARNESS_DIR;
      await stub.close();
    }
  });

  it("L5.P2b governance 负向：writeMode 技能缺 action_draft ⇒ FAILED + 诚实文案", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const stub = await startScriptedOpenAi([
      {
        toolCall: {
          name: "final_answer",
          arguments: JSON.stringify({ blocks: [{ type: "text", markdown: "只说不做" }], provenance: [] }),
        },
        usage: USAGE,
      },
      { text: "unused", usage: USAGE },
    ]);
    const t = await createTestApp({ providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never });
    await t.repos.skills.insert(skillDef({ id: "skl_l5w", key: "l5_write", sideEffect: "WRITE" }));
    await t.repos.agents.insert(
      agentDef({ id: "agt_l5_wr", model: STUB_DCP_SPEC, skills: [{ skillId: "skl_l5w", version: 1 }] }),
    );
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    try {
      const result = await t.deps.engine.runRegisteredAgent({
        taskId: "task_l5_p2b",
        agentId: "agt_l5_wr",
        version: "latest",
        prompt: "L5 writeMode 负向臂",
        ctx: { tenantId: TENANT, userId: "user-l5", roles: ["planner"] },
        nesting: { callChain: [], budget: new BudgetTracker() },
        emit: async () => {},
      });
      expect(result.outcome).toBe("FAILED");
      const md = result.answer.blocks[0];
      const text = md && "markdown" in md ? md.markdown : "";
      expect(text).toContain("dsh 重组装拒绝：挂载的 Skill 为 WRITE/审批类型，final_answer 必须包含 action_draft 块");
    } finally {
      delete process.env.DSH_HARNESS;
      delete process.env.DSH_HARNESS_DIR;
      await stub.close();
    }
  });

  it("L5.P3 EMPTY 口径保真：软收尾逐字 == 末 assistant 文本；空文本 ⇒ 诚实兜底逐字；provenance 空", { timeout: INTEGRATION_TIMEOUT }, async () => {
    // 非空软收尾：markdown 逐字 == 剧本原文（不增不减）。
    const nonEmpty = await runScripted([{ text: "直接作答：L5-EMPTY-PROBE-7319", usage: USAGE }]);
    expect(nonEmpty.run.result.ok).toBe(true);
    if (nonEmpty.run.result.ok) {
      const md = nonEmpty.run.result.answer.blocks[0];
      expect(md && "markdown" in md ? md.markdown : "").toBe("直接作答：L5-EMPTY-PROBE-7319");
      expect(nonEmpty.run.result.answer.provenance).toEqual([]);
    }
    // 空文本：诚实兜底串逐字，不编造内容不编造溯源。
    const empty = await runScripted([{ text: "", usage: USAGE }]);
    expect(empty.run.result.ok).toBe(true);
    if (empty.run.result.ok) {
      const md = empty.run.result.answer.blocks[0];
      expect(md && "markdown" in md ? md.markdown : "").toBe("（探索模式未能产出回答）");
      expect(empty.run.result.answer.provenance).toEqual([]);
    }
  });

  it("L5.P4 拒绝口径帧保真：deny 理由帧流逐字 + SSE 面 ERROR 不漂白", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "l5-deny-"));
    const mcpConfig: McpServerConfig = {
      id: "mcp_l5",
      tenantId: "tenantL5",
      name: "ERP L5",
      serverName: "erp",
      transport: { type: "stdio", command: process.execPath, args: [FIXTURE, "tenantL5", join(dir, "pids")] },
      status: "ACTIVE",
    };
    const setup = buildSessionSetup({
      agent: agentDef({ tenantId: "tenantL5" }),
      agentSystemCore: "L5-CORE",
      grantedToolNames: ["mcp__erp__whoami"],
      mcpServers: [{ ...mapMcpConfig(mcpConfig, () => undefined), failOnStartupError: true }],
    });
    const DENY_REASON = "mock rule engine: tool mcp__erp__whoami denied by ruleBindings PRE_CHECK";
    const { run, sse } = await runScripted(
      [
        { toolCall: { name: "mcp__erp__whoami", arguments: "{}", callId: "call_deny1" }, usage: USAGE },
        { text: "被拒后诚实收尾", usage: USAGE },
      ],
      { setup, extraEnv: { PLATFORM_GOV_DENY: "mcp__erp__whoami" } },
    );
    // 帧流面：isError + 理由逐字（E2 先例形态）。
    const all = eventsJson(run);
    expect(all).toContain('"isError":true');
    expect(all).toContain(DENY_REASON);
    // SSE 面：拒绝事实不漂白 —— step.started 发出、step.completed status ERROR（非 OK）。
    const started = sse.find((e) => e.event === "step.started" && e.payload.stepId === "call_deny1");
    expect(started, "被拒调用 step.started 必发").toBeDefined();
    const completed = sse.find((e) => e.event === "step.completed" && e.payload.stepId === "call_deny1");
    expect(completed).toBeDefined();
    expect(completed!.payload.status, "拒绝在 SSE 面不许漂白成 OK").toBe("ERROR");
    // 工具级 deny 不炸 run（E2 先例），收尾文本逐字。
    expect(run.result.ok).toBe(true);
    if (run.result.ok) {
      expect(run.result.outcome).toBe("ANSWERED");
      const md = run.result.answer.blocks[0];
      expect(md && "markdown" in md ? md.markdown : "").toBe("被拒后诚实收尾");
    }
  });

  it("L5.P5 降级链：finish_reason=length ⇒ turn/end max-tokens ⇒ BUDGET_EXHAUSTED + degraded 原值 + 诚实复述 + narration 保真", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const { run, sse } = await runScripted(
      // finish_reason "length" = 模型截断 ⇒ dsh turn/end max-tokens（dsh-agent-loop :659）⇒ 重组装 BUDGET_EXHAUSTED。
      [{ text: "L5 部分发现：已探到一半", finish: "length", usage: USAGE }],
    );
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;
    expect(run.result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(run.result.degraded?.reason, "degraded 理由原值透出（不顶替）").toBe("BUDGET_EXHAUSTED");
    // 诚实块：末 assistant 文本复述（不编造结论、不伪造 final_answer）。
    const md = run.result.answer.blocks[0];
    expect(md && "markdown" in md ? md.markdown : "").toBe("L5 部分发现：已探到一半");
    expect(run.result.answer.provenance).toEqual([]);
    // SSE 面：narration 帧文本逐字保真（降级前的探索陈述不截不改）。
    const narration = sse.find((e) => e.payload.type === "agent_narration");
    expect(narration).toBeDefined();
    expect(narration!.payload.text).toBe("L5 部分发现：已探到一半");
  });
});
