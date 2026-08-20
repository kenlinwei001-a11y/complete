/**
 * WO-DSH-E2E · L3 降级路径穿透 后端半（node-plan-E2E.md D-3 / L3.A1-A3，evidence 9/15 口径）。
 *
 * 路径选型（D-3 裁决）：engine 级直驱 + orchestrator G-9 段直证，**不经 scene/role 路径**
 * （该两路的运行时 agent_degraded 发射已由 dsh-degraded-seams.test.ts A1/A2 覆盖——收编 56afc9af3；
 * 本层只做口径声明不重复驱动）。
 *
 *   A1  STALL_LOOP 降级（L3.A1）：dsh 臂同参 MCP 工具剧本（mock stdio server echo ×8 同参）
 *       + QOS_AGENT_LOOP_REPEAT_CAP=3 ⇒ engine result.degraded{STALL_LOOP} ∧ outcome
 *       BUDGET_EXHAUSTED ∧ 诚实降级块（reassemble stall 模板，cap 从帧 cause 取）∧ tool/call
 *       帧数 === cap（dsh post-execute 口径，D-7 登记：与 native pre-dispatch 计数差 1）∧
 *       MCP server 侧真执行计数 === cap ∧ run.kernel === "EXTERNAL"。
 *       G-9 段直证（源码锚）：orchestrator.ts 全部 agent_degraded 发射位（现行 3 处）逐位断言
 *       if(result.degraded) 守卫 ∧ outcome: result.degraded.reason 原值透传（零转换）∧ 同段内
 *       早于 answer.final 发射 —— engine 级 runtime 值（STALL_LOOP）经此段上屏必逐字。
 *   A3a 两臂对齐规则 deny（L3.A3 主断言·逐字一致真对齐点）：skill 规则引用 precondition BLOCK
 *       —— engine 预检在分叉**之前**（engine.ts skill preRuleKeys 段，evidence 2b：两臂对称经过），
 *       flag off/on 双臂 ⇒ rule_violation Answer 逐字节等（拒绝文案 E 逐字一致）∧
 *       outcome 同 ∧ run.kernel 值差 {NATIVE, EXTERNAL}（PRD 钦定唯一允许差形态）。
 *   A3b dsh 特有 PRE_CHECK 执行点（L3.A3 的 isError 链）：governance mock 裁决器
 *       PLATFORM_GOV_DENY ⇒ pre-execute deny ⇒ tool/result isError ∧ 理由 R_d（插件模板原串）
 *       逐字到模型面（stub 第二轮回包 messages 含原串）∧ 工具体零执行（server 侧 toolCalls===0）
 *       ∧ SSE step.completed status=ERROR（落屏位，前端半断言 ERROR badge）。
 *       D-7 登记：native 无 ruleBindings PRE_CHECK 执行点（evidence 2a）⇒ A3b 无同文案对照臂，
 *       不冒充对称；dsh SSE 映射 tool/result 只出 status 键（reassemble createSseMapper），
 *       理由文本到模型面不到 SSE 面 ⇒ 「屏上理由逐字一致」由 A3a 承担；L2 真规则 http 臂
 *       reason 透传（真 verdict 文案）为已绿邻面资产（/tmp/dsh-e2e-l2-evidence/l2-notes.md），不重复。
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { startStubOpenAi, stubProvider, stubDirectory, type StubRound } from "./helpers-dsh-stub.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { encryptSecret } from "../src/crypto.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { RuleVerdict } from "@platform/contracts";

// apps/agentcore/test/ → 仓根 = ../../../
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");
const ORCHESTRATOR_SRC = join(REPO_ROOT, "apps/agentcore/src/router/orchestrator.ts");
const MOCK_SERVER = join(REPO_ROOT, "apps/agentcore/test/fixtures/mock-mcp-stdio-server.mjs");

const INTEGRATION_TIMEOUT = 90_000;
const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };

/** 显式假凭据（泄凭扫描对象；绝非真凭据）。 */
const FAKE_MCP_SECRET = "wo-l3-fake-secret-000000000000000000000000";
const FAKE_LLM_KEY = "wo-l3-fake-llm-key-00000000000000000000000000";

const MCP_CONFIG_ID = "mcpcfg_l3";
const CRED_ID = "cred_l3";
const SERVER_NAME = "fwdmock";
const ECHO_TOOL = `mcp__${SERVER_NAME}__echo`;
const CAP_KEY = "QOS_AGENT_LOOP_REPEAT_CAP"; // 与 dsh-watchdog.test.ts 同键（harness/native 同一 env 源）

const EXPECTS_SCHEMA = {
  type: "object",
  properties: { blocks: { type: "array" }, provenance: { type: "array" } },
  required: ["blocks", "provenance"],
};
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "l3 seam answer" }],
  provenance: [],
});
const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

/** ③b governance mock 裁决器模板原串（platform-governance.mjs mock 模式逐字）。 */
const DENY_REASON = `mock rule engine: tool ${ECHO_TOOL} denied by ruleBindings PRE_CHECK`;
/** ③a 对齐剧本的规则 verdict 文案（MockRuleEngineClient C03 真 verdict 形态，两臂同一双). */
const RULE_EXPLANATION = "需求增量 0.9 超过产能上限约束（>0.5 触发 BLOCK）";

interface Emitted {
  event: string;
  payload: unknown;
}

async function makeAgent(
  t: TestApp,
  id: string,
  overrides: { mcpServers?: { mcpConfigId: string }[]; scopeToolNames?: string[]; skills?: { skillId: string; version: number }[] } = {},
): Promise<string> {
  const agent = {
    id,
    tenantId: TENANT,
    key: id,
    version: 1,
    name: `L3 Seam Agent ${id}`,
    description: "wo-dsh-e2e l3 seam",
    model: "",
    systemPrompt: "你是 L3 降级穿透测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: overrides.skills ?? [],
    mcpServers: overrides.mcpServers ?? [],
    scopeDeclaration: { objectTypes: [], toolNames: overrides.scopeToolNames ?? [] },
    status: "PUBLISHED",
  } as const;
  await t.repos.agents.insert(agent as never);
  return agent.id;
}

async function seedMcpConfig(t: TestApp, recordPath: string): Promise<void> {
  await t.repos.mcpConfigs.insert({
    id: MCP_CONFIG_ID,
    tenantId: TENANT,
    name: "L3 Forward Mock",
    serverName: SERVER_NAME,
    transport: { type: "stdio", command: process.execPath, args: [MOCK_SERVER, recordPath] },
    credentialRef: CRED_ID,
    credentialKind: "static_bearer",
    status: "ACTIVE",
  } as never);
  await t.repos.credentials.insert({
    id: CRED_ID,
    tenantId: TENANT,
    name: "l3 mock credential",
    ciphertext: encryptSecret(FAKE_MCP_SECRET, t.config.CREDENTIAL_KEY),
    createdAt: new Date().toISOString(),
  });
}

/** 进程级 env 注入（runner 合并 {...process.env, ...opts.env} ⇒ 子进程可见）；返回还原函数。 */
function withEnv(patch: Record<string, string>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    saved[k] = process.env[k];
    process.env[k] = patch[k]!;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

async function runAgent(t: TestApp, agentId: string, taskId: string, emitted: Emitted[]) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId,
    version: 1,
    prompt: "调工具探查后收尾",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async (event, payload) => {
      emitted.push({ event, payload });
    },
    expectsSchema: EXPECTS_SCHEMA,
  });
}

describe("WO-DSH-E2E · L3 降级路径穿透（后端半）", () => {
  it(
    "A1 · dsh 臂同参工具环 + cap=3 ⇒ degraded{STALL_LOOP} + 诚实块 + tool/call===cap（dsh 口径）+ G-9 段源码锚直证",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "l3-stall-"));
      const recordPath = join(tmp, "record.json");
      // 8 轮同参 echo 剧本（watchdog cap=3 在第 3 次执行后中断，余轮打不到）。
      const script: StubRound[] = Array.from({ length: 8 }, () => ({
        toolCall: { name: ECHO_TOOL, arguments: JSON.stringify({ text: "stall" }) },
        usage: PLAIN_USAGE,
      }));
      const stub = await startStubOpenAi(script);
      const restore = withEnv({ DSH_HARNESS: "1", DSH_HARNESS_DIR: HARNESS_DIR, [CAP_KEY]: "3" });
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), FAKE_LLM_KEY) as never,
          mcp: new MockMcpClient({ [MCP_CONFIG_ID]: [] }),
        });
        await seedMcpConfig(t, recordPath);
        const agentId = await makeAgent(t, "agt_l3_stall", {
          mcpServers: [{ mcpConfigId: MCP_CONFIG_ID }],
          scopeToolNames: [ECHO_TOOL], // 进 setup.tools 允许表（pre-execute 闸放行，stall 由 watchdog post-execute 计数）
        });
        const emitted: Emitted[] = [];
        const result = await runAgent(t, agentId, "task_l3_stall", emitted);

        // 降级产物三件套
        expect(result.outcome).toBe("BUDGET_EXHAUSTED");
        expect(result.degraded, "engine 必须透出 degraded（G-9 的唯一数据源）").toEqual({ reason: "STALL_LOOP" });
        const header = result.answer.blocks[0];
        expect(header?.type === "text" && header.markdown, "诚实降级块（reassemble stall 模板）").toContain("预算耗尽·诚实摘要");
        expect(header?.type === "text" && header.markdown).toContain("loopRepeatCap=3"); // cap 从帧 cause 取（保纯不读 env）
        expect(result.run.kernel).toBe("EXTERNAL");

        // tool/call 计数 = cap（dsh post-execute 口径，D-7 登记 vs native 差 1）
        const starts = emitted.filter((f) => f.event === "step.started" && (f.payload as { type?: string }).type === ECHO_TOOL);
        expect(starts, "SSE 面 echo 调用帧应恰为 cap=3").toHaveLength(3);
        // MCP server 侧真执行计数同口径
        expect(existsSync(recordPath)).toBe(true);
        const record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: unknown[] };
        expect(record.toolCalls, "子进程世界真执行次数 === cap（post-execute 第 cap 次后才中断）").toHaveLength(3);
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }

      // ---- G-9 段直证（源码锚）：orchestrator 全部 agent_degraded 发射位逐位三断 ----
      const src = readFileSync(ORCHESTRATOR_SRC, "utf8");
      const sites: number[] = [];
      for (let i = src.indexOf('type: "agent_degraded"'); i >= 0; i = src.indexOf('type: "agent_degraded"', i + 1)) {
        sites.push(i);
      }
      expect(sites.length, "G-9 发射位现行 3 处（runPathB/runRolePathB/runSceneAgent）——增删即口径漂移").toBe(3);
      for (const site of sites) {
        const before = src.slice(Math.max(0, site - 600), site);
        const after = src.slice(site, site + 600);
        expect(before.includes("if (result.degraded)"), "发射位必须有 result.degraded 守卫（不无条件发射）").toBe(true);
        expect(after.includes("outcome: result.degraded.reason"), "outcome 必须取 result.degraded.reason 原值（零转换 ⇒ 屏上逐字前提）").toBe(true);
        const finalIdx = after.indexOf('"answer.final"');
        expect(finalIdx, "同段内 answer.final 必须在 agent_degraded 之后（G-9 硬次序）").toBeGreaterThan(0);
      }
    },
  );

  it(
    "A3a · 两臂对齐规则 deny：skill precondition BLOCK（分叉前预检·两臂对称）⇒ flag off/on 拒绝 Answer 逐字节等",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const t = await createTestApp({
        providerDirectory: stubDirectory(undefined, undefined) as never,
      });
      // 对齐剧本：规则双同一 verdict（C03 BLOCK，文案 E）——两臂共享同一 evaluate 缝（分叉前）。
      const verdict: RuleVerdict = { ruleId: "C03", passed: false, severity: "BLOCK", explanation: RULE_EXPLANATION };
      t.dataCore.rules.evaluate = (async () => [verdict]) as never;
      await t.repos.skills.insert({
        id: "skl_l3_deny",
        tenantId: TENANT,
        key: "l3_deny_skill",
        version: 1,
        name: "L3 Deny Skill",
        summary: "l3 deny arm",
        body: "deny body",
        resources: [],
        status: "PUBLISHED",
        references: [{ kind: "rule", key: "C03", role: "precondition" }],
      } as never);
      const agentId = await makeAgent(t, "agt_l3_deny_sym", { skills: [{ skillId: "skl_l3_deny", version: 1 }] });

      const nativeEmitted: Emitted[] = [];
      const nativeResult = await runAgent(t, agentId, "task_l3_deny_native", nativeEmitted);

      const restore = withEnv({ DSH_HARNESS: "1", DSH_HARNESS_DIR: HARNESS_DIR });
      let dshResult: Awaited<ReturnType<typeof runAgent>>;
      try {
        dshResult = await runAgent(t, agentId, "task_l3_deny_dsh", []);
      } finally {
        restore();
      }

      // 拒绝文案逐字一致（逐字节等）——预检在分叉之前，两臂同一码路径同一 verdict 双
      expect(nativeResult.outcome).toBe("ANSWERED");
      expect(dshResult.outcome).toBe("ANSWERED");
      expect(dshResult.answer, "dsh 臂拒绝 Answer 必须与旧路逐字节等").toEqual(nativeResult.answer);
      const block = nativeResult.answer.blocks[0];
      expect(block?.type).toBe("rule_violation");
      expect(block?.type === "rule_violation" && block.explanation).toBe(RULE_EXPLANATION); // 原值逐字不顶替
      // PRD 钦定唯一允许差形态：kernel 徽标值差（NATIVE/EXTERNAL），其余 run 字段不逐值对账（属 L1 面）
      expect(nativeResult.run.kernel).toBe("NATIVE");
      expect(dshResult.run.kernel).toBe("EXTERNAL");
    },
  );

  it(
    "A3b · dsh PRE_CHECK 执行点：governance mock deny ⇒ tool/result isError ∧ 理由原串到模型面 ∧ 工具体零执行",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "l3-deny-"));
      const recordPath = join(tmp, "record.json");
      const script: StubRound[] = [
        { toolCall: { name: ECHO_TOOL, arguments: JSON.stringify({ text: "x" }) }, usage: PLAIN_USAGE },
        { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
        { text: "stub final answer", usage: PLAIN_USAGE },
      ];
      const stub = await startStubOpenAi(script);
      const restore = withEnv({
        DSH_HARNESS: "1",
        DSH_HARNESS_DIR: HARNESS_DIR,
        PLATFORM_GOV_DENY: ECHO_TOOL, // mock 裁决器 deny 清单（env 优先于 config.deny）
      });
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), FAKE_LLM_KEY) as never,
          mcp: new MockMcpClient({ [MCP_CONFIG_ID]: [] }),
        });
        await seedMcpConfig(t, recordPath);
        const agentId = await makeAgent(t, "agt_l3_deny_dsh", {
          mcpServers: [{ mcpConfigId: MCP_CONFIG_ID }],
          scopeToolNames: [ECHO_TOOL], // 过允许表 → deny 落在 governance 裁决器（非 allow-list 闸）
        });
        const emitted: Emitted[] = [];
        const result = await runAgent(t, agentId, "task_l3_deny_dsh", emitted);

        expect(result.outcome).toBe("ANSWERED"); // deny 后模型经 final_answer 诚实收尾（不崩不静默）
        // tool/result isError ⇒ SSE step.completed status=ERROR（落屏位；dsh 映射只出 status 键——reassemble createSseMapper）
        const started = emitted.find((f) => f.event === "step.started" && (f.payload as { type?: string }).type === ECHO_TOOL);
        expect(started, "echo 调用帧缺失（剧本未发车）").toBeDefined();
        const stepId = (started!.payload as { stepId: string }).stepId;
        const completed = emitted.find(
          (f) => f.event === "step.completed" && (f.payload as { stepId?: string }).stepId === stepId,
        );
        expect((completed!.payload as { status?: string }).status, "isError ⇒ status=ERROR 落屏位").toBe("ERROR");
        // 理由原串逐字到模型面：stub 第二轮请求的 messages 含裁决器 R_d 原串（不顶替不截断）
        expect(stub.requests.length).toBeGreaterThanOrEqual(2);
        const secondRound = JSON.stringify(stub.requests[1]!.body);
        expect(secondRound, "deny 理由必须逐字回灌模型面").toContain(DENY_REASON);
        // 工具体零执行（pre-execute 拒在派发前）
        const record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: unknown[] };
        expect(record.toolCalls, "pre-execute deny ⇒ MCP server 零 tools/call").toHaveLength(0);
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
