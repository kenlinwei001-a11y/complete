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
 * W8副（toolFilter 映射 + 注册期收窄）追加臂：
 *   A5  toolFilter 映射 e2e：双工具 mock server 滤一留一（echo 留 / echo2 全轮不可见），
 *       且 exotic 裸名 util.calc 即使被 filter 放行也因子进程 publicToolName 规范化缝
 *       fail-closed 丢弃（m2「匹配键错用裸拼接」有效性的前提）。
 *   A5b toolFilter 全名形态（mcp__fwdmock2__echo）同断言成立。
 *   A6  形态A e2e：无 toolFilter ⇒ 三工具全含（含 exotic 规范化名 mcp__fwdmock2__util_calc），
 *       零扰动锚；形态B unit：setup 层 toolAllowlist 键缺席（ref 无 filter，帧逐字节旧行为）/
 *       键内容直通。
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
import { startStubOpenAi, stubProvider, stubDirectory, type StubRound } from "./helpers-dsh-stub.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { encryptSecret } from "../src/crypto.js";
import { buildSessionSetup, type DshMcpServerSpec } from "../src/dsh-runtime/setup-spec.js";
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

// ---------------------------------------------------------------------------
// W8副：三工具夹具面（echo 留 / echo2 滤 / util.calc exotic 裸名——规范化缝咬点）
// ---------------------------------------------------------------------------
const MOCK_SERVER_MULTI = join(REPO_ROOT, "apps/agentcore/test/fixtures/mock-mcp-stdio-server-multi.mjs");
const MULTI_CONFIG_ID = "mcpcfg_forward_multi";
const MULTI_CRED_ID = "cred_forward_multi";
const SERVER2 = "fwdmock2";
/**
 * in-process MockMcpClient 用的镜像工具表——宿主 expandAgentTools 枚举面。
 * MockMcpClient 对未登记 id 回退 demo 工具（mock.ts listTools），必须显式给三工具镜像，
 * 否则宿主收窄面与子进程注册面对不上、A5/A6 断言失真。
 */
const MULTI_TOOLS = [
  { name: "echo", description: "Echo back the given text (mock fixture)", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "echo2", description: "Second echo (toolFilter drop target)", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "util.calc", description: "Exotic bare name with a dot (normalization seam)", inputSchema: { type: "object", properties: { expr: { type: "string" } } } },
];

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

async function makeAgent(
  t: TestApp,
  id: string,
  mcpServers: { mcpConfigId: string }[],
  scopeToolNames: string[] = [],
  tools: readonly { kind: "MCP"; mcpConfigId: string; toolFilter?: string[] }[] = [],
): Promise<string> {
  const agent = {
    id,
    tenantId: TENANT,
    key: id,
    version: 1,
    name: `MCP Forward Seam Agent ${id}`,
    description: "wo-mcp-forward seam",
    model: "",
    systemPrompt: "你是 MCP forward seam 测试助手。",
    tools,
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

/** 三工具 mock stdio server 配置一条（multi 夹具 + 独立 config/cred id，凭据同显式假值）。 */
async function seedMcpConfigMulti(t: TestApp, recordPath: string): Promise<void> {
  await t.repos.mcpConfigs.insert({
    id: MULTI_CONFIG_ID,
    tenantId: TENANT,
    name: "Forward Mock Multi",
    serverName: SERVER2,
    transport: { type: "stdio", command: process.execPath, args: [MOCK_SERVER_MULTI, recordPath] },
    credentialRef: MULTI_CRED_ID,
    credentialKind: "static_bearer",
    status: "ACTIVE",
  } as never);
  await t.repos.credentials.insert({
    id: MULTI_CRED_ID,
    tenantId: TENANT,
    name: "forward multi credential",
    ciphertext: encryptSecret(FAKE_MCP_SECRET, t.config.CREDENTIAL_KEY),
    createdAt: new Date().toISOString(),
  });
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
        // 骨架锚①：iterations 非空——step 分组（每 LLM 轮一迭代，team-lead 2026-08-21 裁决②）：
        // 剧本 3 轮 ⇒ 3 迭代（0 基顺编号对位 native index=i）；mcp echo 进、final_answer 轮与
        // 文本轮留空迭代（轮次证据与调用证据分离，native :1041 空轮同形态）。
        expect(result.run.iterations).toHaveLength(3);
        expect(result.run.iterations.map((it) => it.index)).toEqual([0, 1, 2]);
        const iteration = result.run.iterations[0];
        expect(iteration).toBeDefined();
        if (!iteration) return;
        expect(iteration.toolCalls.map((c) => c.toolName)).toEqual([`mcp__${SERVER_NAME}__echo`]);
        expect(result.run.iterations[1]?.toolCalls).toEqual([]); // final_answer 轮：调用剔除、轮次留痕
        expect(result.run.iterations[2]?.toolCalls).toEqual([]); // 纯文本收尾轮
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

  it(
    "A5 · W8副 toolFilter 映射 e2e：滤一留一（echo 留 / echo2 全轮不可见）+ exotic 裸名 util.calc 注册期 fail-closed 丢弃，outcome ANSWERED",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "mcp-forward-a5-"));
      const recordPath = join(tmp, "record.json");
      const stub = await startStubOpenAi(SCRIPT.map((r) => ({ ...r })));
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          // 宿主 expandAgentTools 经 in-process mock 枚举三工具（未登记 id 回退 demo 工具，必须显式给镜像表）。
          mcp: new MockMcpClient({ [MULTI_CONFIG_ID]: MULTI_TOOLS }),
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        await seedMcpConfigMulti(t, recordPath);
        // toolFilter 真源 = agent.tools 的 MCP ref（contracts AgentToolRefSchema）裸名形态：
        // echo 留；echo2 宿主 expandAgentTools 已剔除（filter 未含）；util.calc 宿主放行
        // （filter 含裸名）但子进程注册期 fail-closed 丢弃——publicToolName 规范化公开名
        // mcp__fwdmock2__util_calc ≠ 允许表裸拼接 mcp__fwdmock2__util.calc。
        const agentId = await makeAgent(
          t,
          "agt_mcp_forward_a5",
          [{ mcpConfigId: MULTI_CONFIG_ID }],
          [],
          [{ kind: "MCP", mcpConfigId: MULTI_CONFIG_ID, toolFilter: ["echo", "util.calc"] }],
        );
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_mcp_forward_a5",
          agentId,
          version: 1,
          prompt: "调 final_answer 收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: EXPECTS_SCHEMA,
        });
        expect(result.outcome).toBe("ANSWERED");
        expect(result.run.kernel).toBe("EXTERNAL"); // 钉死真走 DSH 分叉
        expect(stub.requests.length).toBeGreaterThanOrEqual(1);
        // 咬点①：留存件首轮可见。闭引号收尾——mcp__fwdmock2__echo 是 mcp__fwdmock2__echo2 的
        // 前缀，裸 contains 会把 echo2 误配进来（断言自污染陷阱）。
        const firstBody = JSON.stringify(stub.requests[0]?.body);
        expect(firstBody).toContain(`mcp__${SERVER2}__echo"`);
        // 咬点②：滤去件与 exotic 件全轮不可见（收窄=模型面消失，不止执行面 deny）。
        for (const r of stub.requests) {
          const body = JSON.stringify(r.body);
          expect(body).not.toContain("echo2");
          expect(body).not.toContain("util_calc"); // exotic：规范化公开名不得出现（fail-closed 丢弃）
          expect(body).not.toContain("util.calc"); // exotic：裸拼接名同样不得出现
        }
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it(
    "A5b · W8副 toolFilter 全名形态（mcp__fwdmock2__echo）同断言成立：echo 留、echo2/exotic 全轮不可见",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "mcp-forward-a5b-"));
      const recordPath = join(tmp, "record.json");
      const stub = await startStubOpenAi(SCRIPT.map((r) => ({ ...r })));
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          mcp: new MockMcpClient({ [MULTI_CONFIG_ID]: MULTI_TOOLS }),
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        await seedMcpConfigMulti(t, recordPath);
        // 全名形态：宿主 expandAgentTools :389 全名匹配分支放行 echo；echo2/util.calc 皆被剔除。
        const agentId = await makeAgent(
          t,
          "agt_mcp_forward_a5b",
          [{ mcpConfigId: MULTI_CONFIG_ID }],
          [],
          [{ kind: "MCP", mcpConfigId: MULTI_CONFIG_ID, toolFilter: [`mcp__${SERVER2}__echo`] }],
        );
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_mcp_forward_a5b",
          agentId,
          version: 1,
          prompt: "调 final_answer 收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: EXPECTS_SCHEMA,
        });
        expect(result.outcome).toBe("ANSWERED");
        expect(result.run.kernel).toBe("EXTERNAL");
        expect(stub.requests.length).toBeGreaterThanOrEqual(1);
        const firstBody = JSON.stringify(stub.requests[0]?.body);
        expect(firstBody).toContain(`mcp__${SERVER2}__echo"`);
        for (const r of stub.requests) {
          const body = JSON.stringify(r.body);
          expect(body).not.toContain("echo2");
          expect(body).not.toContain("util_calc");
          expect(body).not.toContain("util.calc");
        }
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it(
    "A6-A · 零扰动锚 e2e：无 toolFilter ⇒ 三工具全含（含 exotic 规范化名 mcp__fwdmock2__util_calc），帧行为逐字节旧",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "mcp-forward-a6-"));
      const recordPath = join(tmp, "record.json");
      const stub = await startStubOpenAi(SCRIPT.map((r) => ({ ...r })));
      const restore = withHarnessEnv();
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), "wo-mcp-forward-fake-llm-key") as never,
          mcp: new MockMcpClient({ [MULTI_CONFIG_ID]: MULTI_TOOLS }),
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        await seedMcpConfigMulti(t, recordPath);
        const agentId = await makeAgent(t, "agt_mcp_forward_a6", [{ mcpConfigId: MULTI_CONFIG_ID }]);
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_mcp_forward_a6",
          agentId,
          version: 1,
          prompt: "调 final_answer 收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: EXPECTS_SCHEMA,
        });
        expect(result.outcome).toBe("ANSWERED");
        expect(result.run.kernel).toBe("EXTERNAL");
        expect(stub.requests.length).toBeGreaterThanOrEqual(1);
        const firstBody = JSON.stringify(stub.requests[0]?.body);
        // 无 filter：注册面 = 全量三工具；exotic 以 publicToolName 规范化名出现（正向锚——
        // 与 A5 的 fail-closed 丢弃互为镜像：无 filter 时规范化名照常注册，有 filter 且允许表
        // 只有裸拼接名时才丢）。
        expect(firstBody).toContain(`mcp__${SERVER2}__echo"`);
        expect(firstBody).toContain(`mcp__${SERVER2}__echo2"`);
        expect(firstBody).toContain(`mcp__${SERVER2}__util_calc`);
      } finally {
        restore();
        await stub.close();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it("A6-B · setup 层 toolAllowlist 键语义 unit：ref 无 filter ⇒ 键缺席（帧逐字节旧行为）；有 ⇒ 内容直通", () => {
    const spec = {
      transport: "stdio",
      serverName: SERVER2,
      command: process.execPath,
      args: [MOCK_SERVER_MULTI],
      env: {},
      cwd: "",
      toolCallTimeoutMs: 20_000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    } satisfies DshMcpServerSpec;
    const agent = {
      tenantId: TENANT,
      systemPrompt: "p",
      scopeDeclaration: { objectTypes: [], toolNames: [] },
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    };
    const base = { agent: agent as never, agentSystemCore: "core", grantedToolNames: [] as string[] };
    // 键缺席形态：不带 toolAllowlist 的 spec 进，输出零 toolAllowlist 键（A6 形态B 咬点）。
    const out1 = buildSessionSetup({ ...base, mcpServers: [spec] });
    expect(out1.mcpServers).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(out1.mcpServers?.[0], "toolAllowlist")).toBe(false);
    // 直通形态：带 toolAllowlist 的 spec 原样过 wire，内容不改写。
    const allowlist = [`mcp__${SERVER2}__echo`];
    const out2 = buildSessionSetup({
      ...base,
      mcpServers: [{ ...spec, toolAllowlist: allowlist } as DshMcpServerSpec],
    });
    expect(out2.mcpServers?.[0]?.toolAllowlist).toEqual(allowlist);
  });
});
