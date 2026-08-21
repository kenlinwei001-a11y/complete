/**
 * WO-MCP-FORWARD · engine dsh 分叉 mcpServers 静默丢弃修复的 SEAM 组合测试。
 *
 * 病灶（静默丢字段同族病第四例）：engine.ts 分叉块 buildSessionSetup 实参仅
 * agent/agentSystemCore/grantedToolNames/skills/expectsSchema —— agent.mcpServers 被静默丢弃，
 * mapMcpConfig（dsh-runtime/setup-spec.ts）全仓生产零调用点。后果：配了 MCP server 的 agent
 * 走 dsh 路时 MCP 工具静默消失（诚实性缺口）。
 *
 * 裁决：additive 转发——agent.mcpServers 非空时经 mapMcpConfig 逐个映射（映射期解密注入，
 * 同 setup-spec.ts 安全注记形态），空/缺省则零 mcpServers 键（逐字节旧行为）。
 *
 * 断言：
 *   A1  engine 级 SEAM：DSH_HARNESS=1 + stub-OpenAi 剧本（Ruling A 形态）+ agent.mcpServers
 *       配 mock stdio server 一条 ⇒ 子进程世界收到该 MCP 工具（stub 首轮请求 tools 含
 *       mcp__fwdmock__echo），且映射期解密注入的凭据到达 mock server 进程
 *       （记录文件 credential == 明文假凭据）。
 *   A2  阴性臂：agent.mcpServers 空 ⇒ stub 请求 tools 零 mcp__ 前缀工具，运行照常 ANSWERED
 *       （零扰：mcpServers 键不出现在 setup，流形态不变）。
 *   A3  fail-closed：credentialRef 指向的凭据行不存在 ⇒ runRegisteredAgent 诚实抛错
 *       （/credentialRef unresolvable/），不静默降级为无凭据连接。
 *
 * 注：测试里的凭据是显式假值（"wo-mcp-forward-fake-secret-…"），绝不写真凭据；
 * 泄凭扫描（真凭据前缀模式 grep）必须为 0。
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { startStubOpenAi, stubProvider, stubDirectory, STUB_MODEL_ID, type StubRound } from "./helpers-dsh-stub.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { encryptSecret } from "../src/crypto.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

// apps/agentcore/test/ → 仓根 = ../../../
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");
const MOCK_SERVER = join(REPO_ROOT, "apps/agentcore/test/fixtures/mock-mcp-stdio-server.mjs");

const INTEGRATION_TIMEOUT = 90_000;
const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };

/** 显式假凭据（红线断言的扫描对象；形如真 secret 但绝非凭据）。 */
const FAKE_MCP_SECRET = "wo-mcp-forward-fake-secret-0000000000000000";

const MCP_CONFIG_ID = "mcpcfg_forward";
const CRED_ID = "cred_forward";
/** serverName 过契约正则 ^[a-z0-9_]{2,24}$；公开工具名 = mcp__fwdmock__echo。 */
const SERVER_NAME = "fwdmock";

const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "mcp forward seam answer" }],
  provenance: [],
});
const EXPECTS_SCHEMA = {
  type: "object",
  properties: { blocks: { type: "array" }, provenance: { type: "array" } },
  required: ["blocks", "provenance"],
};
const SCRIPT: StubRound[] = [
  { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
  { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
];

async function makeAgent(t: TestApp, id: string, mcpServers: { mcpConfigId: string }[], scopeToolNames: string[] = []): Promise<string> {
  const agent = {
    id,
    tenantId: TENANT,
    key: id,
    version: 1,
    name: `MCP Forward Seam Agent ${id}`,
    description: "wo-mcp-forward seam",
    model: "",
    systemPrompt: "你是 MCP forward seam 测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers,
    scopeDeclaration: { objectTypes: [], toolNames: scopeToolNames },
    status: "PUBLISHED",
  } as const;
  await t.repos.agents.insert(agent as never);
  return agent.id;
}

/** mock stdio server 配置一条（command=node，args=[fixture, recordPath]，credentialRef 挂假凭据）。 */
async function seedMcpConfig(t: TestApp, recordPath: string, opts?: { withCredentialRow?: boolean }): Promise<void> {
  await t.repos.mcpConfigs.insert({
    id: MCP_CONFIG_ID,
    tenantId: TENANT,
    name: "Forward Mock",
    serverName: SERVER_NAME,
    transport: { type: "stdio", command: process.execPath, args: [MOCK_SERVER, recordPath] },
    credentialRef: CRED_ID,
    credentialKind: "static_bearer",
    status: "ACTIVE",
  } as never);
  if (opts?.withCredentialRow !== false) {
    await t.repos.credentials.insert({
      id: CRED_ID,
      tenantId: TENANT,
      name: "forward mock credential",
      ciphertext: encryptSecret(FAKE_MCP_SECRET, t.config.CREDENTIAL_KEY),
      createdAt: new Date().toISOString(),
    });
  }
}

/** engine 分叉 env 需要的进程级旗标；返回还原函数。 */
function withHarnessEnv(): () => void {
  const prevHarnessDir = process.env.DSH_HARNESS_DIR;
  const prevHarness = process.env.DSH_HARNESS;
  process.env.DSH_HARNESS_DIR = HARNESS_DIR;
  process.env.DSH_HARNESS = "1"; // engine 守卫直读 process.env（D3 休眠门判据形态）
  return () => {
    if (prevHarnessDir === undefined) delete process.env.DSH_HARNESS_DIR;
    else process.env.DSH_HARNESS_DIR = prevHarnessDir;
    if (prevHarness === undefined) delete process.env.DSH_HARNESS;
    else process.env.DSH_HARNESS = prevHarness;
  };
}

describe("WO-MCP-FORWARD · engine dsh 分叉 mcpServers 转发", () => {
  it(
    "A1 · agent.mcpServers 配 mock stdio server ⇒ 子进程世界收到 mcp__fwdmock__echo 工具且解密凭据到达 server 进程",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "mcp-forward-a1-"));
      const recordPath = join(tmp, "record.json");
      const stub = await startStubOpenAi(SCRIPT.map((r) => ({ ...r })));
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          // 进程内 MCP 面置空（本 WO 断言子进程世界转发，与 in-process mock 工具解耦）。
          mcp: new MockMcpClient({ [MCP_CONFIG_ID]: [] }),
          // F-1：生产档治理切 http 后，本缝钉 poc 档（mock 治理放行）保持既有语义。
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        await seedMcpConfig(t, recordPath);
        const agentId = await makeAgent(t, "agt_mcp_forward_a1", [{ mcpConfigId: MCP_CONFIG_ID }]);
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_mcp_forward_a1",
          agentId,
          version: 1,
          prompt: "调 final_answer 收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: EXPECTS_SCHEMA,
        });
        expect(result.outcome).toBe("ANSWERED");
        expect(stub.requests.length).toBeGreaterThanOrEqual(1);
        // 咬点①：子进程世界 ToolRuntime 注册了转发 spec 的 MCP 工具（模型可见 tools 含公开名）。
        const firstBody = JSON.stringify(stub.requests[0]?.body);
        expect(firstBody).toContain(`mcp__${SERVER_NAME}__echo`);
        // 咬点②：mock server 进程真被拉起，且映射期解密注入的 MCP_CREDENTIAL == 明文假凭据。
        expect(existsSync(recordPath)).toBe(true);
        const record = JSON.parse(readFileSync(recordPath, "utf8")) as { credential: string | null };
        expect(record.credential).toBe(FAKE_MCP_SECRET);
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it(
    "A2 · 阴性臂：agent.mcpServers 空 ⇒ stub 请求 tools 零 mcp__ 前缀工具，运行照常 ANSWERED（零扰）",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const stub = await startStubOpenAi(SCRIPT.map((r) => ({ ...r })));
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          // F-1：生产档治理切 http 后，本缝钉 poc 档（mock 治理放行）保持既有语义。
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        const agentId = await makeAgent(t, "agt_mcp_forward_a2", []);
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_mcp_forward_a2",
          agentId,
          version: 1,
          prompt: "调 final_answer 收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: EXPECTS_SCHEMA,
        });
        expect(result.outcome).toBe("ANSWERED");
        expect(stub.requests.length).toBeGreaterThanOrEqual(1);
        for (const r of stub.requests) {
          expect(JSON.stringify(r.body)).not.toContain("mcp__");
        }
      } finally {
        restore();
        await stub.close();
      }
    },
  );

  it(
    "A3 · fail-closed：credentialRef 凭据行缺失 ⇒ 诚实抛错 /credentialRef unresolvable/，不静默降级",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "mcp-forward-a3-"));
      const stub = await startStubOpenAi(SCRIPT.map((r) => ({ ...r })));
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          mcp: new MockMcpClient({ [MCP_CONFIG_ID]: [] }),
          // F-1：生产档治理切 http 后，本缝钉 poc 档（mock 治理放行）保持既有语义。
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        // 只插 mcpConfig，不插凭据行 —— credentialRef 解析不出。
        await seedMcpConfig(t, join(tmp, "record.json"), { withCredentialRow: false });
        const agentId = await makeAgent(t, "agt_mcp_forward_a3", [{ mcpConfigId: MCP_CONFIG_ID }]);
        await expect(
          t.deps.engine.runRegisteredAgent({
            taskId: "task_mcp_forward_a3",
            agentId,
            version: 1,
            prompt: "调 final_answer 收尾",
            ctx: CTX,
            nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
            emit: async () => {},
            expectsSchema: EXPECTS_SCHEMA,
          }),
        ).rejects.toThrow(/credentialRef unresolvable/);
        // 子进程根本没出生（映射期抛错先于 spawn）⇒ stub 零请求。
        expect(stub.requests.length).toBe(0);
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it(
    "A4 · WO-DSH-PROD-READY W9-lite 审计骨架 e2e：dsh 臂 run.iterations 非空（两态+推导 duration）+ run.total* == 剧本 usage 折出和（B11 同源等值）",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "mcp-forward-a4-"));
      const recordPath = join(tmp, "record.json");
      // 剧本：① mcp echo 真工具调用（帧流 tool/call↔tool/result 配对源；MCP 不过宿主=REC §3 #10 实景）
      //       ② final_answer（meta，不进 iterations）③ 文本收尾。三轮各 50/10 ⇒ 折出和 150/30。
      const script: StubRound[] = [
        { toolCall: { name: `mcp__${SERVER_NAME}__echo`, arguments: JSON.stringify({ text: "w9lite" }) }, usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
        { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
        { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
      ];
      const stub = await startStubOpenAi(script);
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          mcp: new MockMcpClient({ [MCP_CONFIG_ID]: [] }),
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        await seedMcpConfig(t, recordPath);
        // scope 声明白名单含 echo 公开名——harness 治理闸允许表 = scopeDeclaration ∪ granted ∪ meta
        // （setup-spec.ts :218/:240），表外即 pre-execute deny（本单 TEMP-DIAG 实证：2ms ERROR、server 零到达）。
        const agentId = await makeAgent(t, "agt_mcp_forward_a4", [{ mcpConfigId: MCP_CONFIG_ID }], [`mcp__${SERVER_NAME}__echo`]);
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_mcp_forward_a4",
          agentId,
          version: 1,
          prompt: "先 echo 再收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: EXPECTS_SCHEMA,
        });
        expect(result.outcome).toBe("ANSWERED");
        expect(result.run.kernel).toBe("EXTERNAL"); // 钉死真走 DSH 分叉（否则全臂结论反掉）
        expect(stub.requests.length).toBe(3); // 剧本三轮真走完（wire 实证）
        // 骨架锚①：iterations 非空——单 turn（单 prompt 形态）⇒ 单迭代；mcp echo 进、final_answer 不进
        expect(result.run.iterations).toHaveLength(1);
        const iteration = result.run.iterations[0];
        expect(iteration).toBeDefined();
        if (!iteration) return;
        expect(Number.isInteger(iteration.index)).toBe(true);
        expect(iteration.toolCalls.map((c) => c.toolName)).toEqual([`mcp__${SERVER_NAME}__echo`]);
        const echo = iteration.toolCalls[0];
        expect(echo).toBeDefined();
        if (!echo) return;
        expect(echo.outcome).toBe("OK"); // mock echo 放行；两态物理上限（OK|ERROR，REC §3 #10）
        // 真到达 server 的交叉实证（防「假 OK」——deny/未派发也落 iterations，只是 outcome 不同）：
        const a4Record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: { name: string | null }[] };
        expect(a4Record.toolCalls.map((c) => c.name)).toEqual(["echo"]);
        expect(echo.input).toEqual({ text: "w9lite" });
        expect(echo.durationMs).toBeGreaterThanOrEqual(0); // 墙钟推导值，只锚非负形态（A4 时间量豁免同口径）
        expect(typeof echo.toolCallId).toBe("string"); // dsh 帧 callId 原值（非 tc_ 形态，合流待 W9-full）
        // 骨架锚②：run.total* == 剧本 usage 折出和（3×50 / 3×10）
        expect(result.run.totalInputTokens).toBe(150);
        expect(result.run.totalOutputTokens).toBe(30);
        // 骨架锚③：B11 同源等值（ROLLOUT §6.5 验收判据）——run.total* 与 answer.stats 对应桶互等，各读各的不相加
        const stats = (result.answer as { stats?: { tokenUsage: { uncachedInputTokens: number; outputTokens: number } } }).stats;
        expect(stats).toBeDefined();
        expect(result.run.totalInputTokens).toBe(stats?.tokenUsage.uncachedInputTokens);
        expect(result.run.totalOutputTokens).toBe(stats?.tokenUsage.outputTokens);
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
