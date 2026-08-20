/**
 * WO-DSH-E2E · L4 租户隔离穿透组合壳：双 tenant × 同 serverName 对撞 × dsh 路真子进程。
 *
 * 驱动级声明（task #20 裁决，interim）：runDshAgent 级 = engine 分叉（engine.ts:507-537）
 * 使用的同一执行缝——runner 真子进程 spawn + buildSessionSetup/mapMcpConfig 真映射 +
 * PLATFORM_LLM_* env 五件注入同款 + 生产档 cordis.yml + startStubOpenAi 确定性剧本
 * （裁决 A 形态；mock-llm 不可达是已登记现实）。engine 级（runRegisteredAgent）当前不转发
 * agent.mcpServers（静默丢弃，wo-mcp-forward 另单修复），落线后本壳可升级驱动级。
 * fork 选路正确性由 N2 dualrun 证明、tenantId→setup 流向由 N4 A11 证明，本文件不重复断言。
 *
 * 与 N4 既有套件的关系：namespace-tenant-seam A0-A12 是 harness 进程内缝测（无子进程、无
 * JSON-RPC wire、无 LLM、无重组装）；本文件是 wire 穿透组合——session/prompt setup 帧携带
 * mcpServers+tenantId 过真 wire、platform-sdk-server 真创建、mcp-client-tenant 真 spawn
 * 夹具子进程、stub LLM 真驱动工具调用、reassemble 真产出。池键/审计的同世界断言在
 * packages/dsh-harness/test/tenant-pool-collision-e2e.test.mjs（mutation #8 红位）。
 *
 * 标记选型：tenantAlpha/tenantBeta 大小写混合——base36 sessionId 只含 [0-9a-z]，
 * 大写字母标记杜绝「零跨租户串字」断言的假撞（sessionId 随机子串不可能命中）。
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentDefinition, McpServerConfig } from "@platform/contracts";
import {
  buildSessionSetup,
  mapMcpConfig,
  runDshAgent,
  type DshRunOutput,
  type DshSetupSpec,
} from "../src/dsh-runtime/index.js";
import { STUB_FAKE_KEY, STUB_MODEL_ID, startStubOpenAi, type StubRound } from "./helpers-dsh-stub.js";

// apps/agentcore/test/ → 仓根 = ../../../
const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../packages/dsh-harness/test/fixtures/mock-mcp-tenant.mjs", import.meta.url));
const INTEGRATION_TIMEOUT = 90_000;

const T_ALPHA = "tenantAlpha";
const T_BETA = "tenantBeta";
const SERVER_NAME = "erp"; // 双租户同名对撞点

const STUB_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

// ---------------------------------------------------------------------------
// E3′ 先例形态：租户作用域 credentialRef 前缀白名单解析器（dsh-poc-acceptance E3/E3′ 同款）
// ---------------------------------------------------------------------------
const CRED_STORE: Record<string, string> = {
  [`TENANT_${T_ALPHA}__MCP_ERP`]: "secret-alpha-value",
  [`TENANT_${T_BETA}__MCP_ERP`]: "secret-beta-value",
};
const tenantResolver =
  (tenantId: string) =>
  (ref: string): string | undefined =>
    ref.startsWith(`TENANT_${tenantId}__`) ? CRED_STORE[ref] : undefined;

function agentDef(tenantId: string): AgentDefinition {
  return {
    id: `agt_l4_${tenantId}`,
    tenantId,
    key: `l4-${tenantId}`,
    version: 1,
    name: `L4 ${tenantId}`,
    description: "L4 tenant collision composite agent",
    model: "",
    systemPrompt: `你是 L4 对撞测试 agent（${tenantId}）。`,
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
  };
}

/** McpServerConfig（stdio 夹具，marker=tenantId，凭据引用本租户前缀）→ dsh spec。 */
function mcpSpecFor(tenantId: string, pidFile: string) {
  const config: McpServerConfig = {
    id: `mcp_l4_${tenantId}`,
    tenantId,
    name: `ERP ${tenantId}`,
    serverName: SERVER_NAME,
    transport: { type: "stdio", command: process.execPath, args: [FIXTURE, tenantId, pidFile] },
    credentialRef: `TENANT_${tenantId}__MCP_ERP`,
    credentialKind: "static_bearer",
    status: "ACTIVE",
  };
  const spec = mapMcpConfig(config, tenantResolver(tenantId));
  // failOnStartupError 提 true：挂载 resolve ⇒ 首连+首轮工具同步已完成（N4 seam stdioCfg
  // 同款确定性形态；mapMcpConfig 缺省 false 是生产态「状态面 ERROR 由外壳管」语义，
  // E2E 缝测需要挂载时序确定）。
  return { ...spec, failOnStartupError: true };
}

/** 与 engine 分叉同源的 setup 组装：tenantId 来自 agent、allow-list = granted ∪ final_answer。 */
function setupFor(tenantId: string, pidFile: string, extraGrant: string[] = []): DshSetupSpec {
  return buildSessionSetup({
    agent: agentDef(tenantId),
    agentSystemCore: "L4-CORE",
    grantedToolNames: [`mcp__${SERVER_NAME}__whoami`, `mcp__${SERVER_NAME}__only_${tenantId}`, ...extraGrant],
    mcpServers: [mcpSpecFor(tenantId, pidFile)],
  });
}

/** engine 分叉 env 五件注入同款（engine.ts:530-537 形态）+ 生产档 cordis.yml。 */
async function runTenant(
  tenantId: string,
  script: StubRound[],
  pidFile: string,
  extraGrant: string[] = [],
): Promise<DshRunOutput> {
  const stub = await startStubOpenAi(script.map((r) => ({ ...r })));
  try {
    return await runDshAgent(
      {
        prompt: `L4 ${tenantId} 对撞：调用工具后收尾`,
        setup: setupFor(tenantId, pidFile, extraGrant),
        provider: "platform", // PRODUCTION_DSH_HARNESS_PROVIDER 同值（platform-llm 单一路由）
        model: STUB_MODEL_ID,
      },
      {
        harnessDir: HARNESS_DIR,
        cordisFile: "cordis.yml", // 生产档（platform-llm；MCP 由 setup 挂载不经 yml）
        requestTimeoutMs: 60_000,
        env: {
          PLATFORM_LLM_API: "openai-completions",
          PLATFORM_LLM_BASE_URL: `${stub.url}/v1`,
          PLATFORM_LLM_MODEL: STUB_MODEL_ID,
          PLATFORM_LLM_API_KEY: STUB_FAKE_KEY,
        },
      },
    );
  } finally {
    await stub.close();
  }
}

const eventsJson = (run: DshRunOutput): string => JSON.stringify(run.events);
const toolResultsJson = (run: DshRunOutput): string =>
  run.events
    .filter((e) => e.type === "tool/result")
    .map((e) => JSON.stringify(e.data))
    .join("\n");
const requestHeaderJson = (run: DshRunOutput): string => {
  const h = run.events.find((e) => e.type === "request/header");
  expect(h, "request/header 帧必在（工具表观测点）").toBeDefined();
  return JSON.stringify(h!.data);
};
const readPids = (pidFile: string): number[] =>
  readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number);

describe("WO-DSH-E2E · L4 租户隔离穿透（双 tenant × 同 serverName 对撞）", () => {
  it(
    "L4.A1 对撞双成：各回各 whoami 标记 / 事件流零跨租户串字 / 工具表各只见各 / pidFile 恰 2 异 pid",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l4-collide-"));
      const pidFile = join(dir, "pids");
      writeFileSync(pidFile, "");
      const scriptFor = (marker: string): StubRound[] => [
        { toolCall: { name: `mcp__${SERVER_NAME}__whoami`, arguments: "{}" }, usage: STUB_USAGE },
        { text: `${marker} done`, usage: STUB_USAGE },
      ];

      const runA = await runTenant(T_ALPHA, scriptFor(T_ALPHA), pidFile);
      const runB = await runTenant(T_BETA, scriptFor(T_BETA), pidFile);

      // 双成：两臂各自真调成功收尾。
      for (const [label, run] of [["A", runA], ["B", runB]] as const) {
        expect(run.result.ok, `run ${label} 重组装须 ok`).toBe(true);
        if (run.result.ok) expect(run.result.outcome).toBe("ANSWERED");
      }

      // whoami 各回各 marker（同名工具、同 serverName、路由不串）。
      expect(toolResultsJson(runA)).toContain(`whoami:${T_ALPHA}`);
      expect(toolResultsJson(runB)).toContain(`whoami:${T_BETA}`);

      // 零跨租户串字：tA 全程事件流无任何 tB 痕迹（工具名/标记/描述），反向同。
      expect(eventsJson(runA)).not.toContain(T_BETA);
      expect(eventsJson(runB)).not.toContain(T_ALPHA);

      // 工具表平级隔离：request/header 各只列各的独有工具（ScopedLayers 穿透复核）。
      const headerA = requestHeaderJson(runA);
      const headerB = requestHeaderJson(runB);
      expect(headerA).toContain(`mcp__${SERVER_NAME}__only_${T_ALPHA}`);
      expect(headerA).not.toContain(`only_${T_BETA}`);
      expect(headerB).toContain(`mcp__${SERVER_NAME}__only_${T_BETA}`);
      expect(headerB).not.toContain(`only_${T_ALPHA}`);

      // 连接各立：两个 harness 子进程各自 spawn 一只夹具（同 serverName 异 tenantId 不共享）。
      const pids = readPids(pidFile);
      expect(pids.length, "两租户各立一条夹具连接").toBe(2);
      expect(new Set(pids).size).toBe(2);
    },
  );

  it(
    "L4.A2 世界层互不可达：allow-list 误配异租户工具名 ⇒ 执行 isError（fail-closed），成功标记零出现",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l4-invisible-"));
      // 正向臂：本租户独有工具真调成功。
      const runOk = await runTenant(
        T_ALPHA,
        [
          { toolCall: { name: `mcp__${SERVER_NAME}__only_${T_ALPHA}`, arguments: "{}" }, usage: STUB_USAGE },
          { text: "alpha tool ok", usage: STUB_USAGE },
        ],
        join(dir, "pids-ok"),
      );
      expect(toolResultsJson(runOk)).toContain(`only_${T_ALPHA}:${T_ALPHA}`);

      // 负向臂：allow-list 显式误配 only_tenantBeta（治理闸放行），世界层仍不可达——
      // 隔离由 scoped 工具世界保证，不只是 allow-list 门面。
      const runDeny = await runTenant(
        T_ALPHA,
        [
          { toolCall: { name: `mcp__${SERVER_NAME}__only_${T_BETA}`, arguments: "{}" }, usage: STUB_USAGE },
          { text: "alpha close", usage: STUB_USAGE },
        ],
        join(dir, "pids-deny"),
        [`mcp__${SERVER_NAME}__only_${T_BETA}`], // 误配：allow-list 放行，测世界层
      );
      const results = toolResultsJson(runDeny);
      expect(results).toContain('"isError":true');
      expect(results, "异租户工具成功标记零出现").not.toContain(`only_${T_BETA}:${T_BETA}`);
      // 工具级错误不炸 run（E2 先例：deny 是工具级错误不是 run 级崩溃）。
      expect(runDeny.result.ok).toBe(true);
      if (runDeny.result.ok) expect(runDeny.result.outcome).toBe("ANSWERED");
    },
  );

  it("L4.A3 跨租户凭据解析 fail-closed（E3′ 前缀白名单形态）+ 凭据值零上帧", { timeout: INTEGRATION_TIMEOUT }, async () => {
    // E3′ 负例：tenantBeta 解析器解 tenantAlpha 的 ref ⇒ undefined ⇒ mapMcpConfig 抛（fail-closed，run 不出生）。
    const alphaConfig: McpServerConfig = {
      id: "mcp_l4_neg",
      tenantId: T_ALPHA,
      name: "ERP Alpha",
      serverName: SERVER_NAME,
      transport: { type: "stdio", command: process.execPath, args: [FIXTURE, T_ALPHA] },
      credentialRef: `TENANT_${T_ALPHA}__MCP_ERP`,
      credentialKind: "static_bearer",
      status: "ACTIVE",
    };
    expect(tenantResolver(T_BETA)(alphaConfig.credentialRef!)).toBeUndefined();
    expect(() => mapMcpConfig(alphaConfig, tenantResolver(T_BETA))).toThrow(/credentialRef unresolvable/);

    // 正向：本租户 ref 解析进 stdio env（MCP_CREDENTIAL），且是本位值不是异位值。
    const spec = mcpSpecFor(T_ALPHA, join(mkdtempSync(join(tmpdir(), "l4-cred-")), "pids"));
    expect(spec.env).toEqual({ MCP_CREDENTIAL: "secret-alpha-value" });

    // 凭据红线（L2.A4 形态在本层复核）：真跑一轮，全帧流任何凭据值零命中。
    const dir = mkdtempSync(join(tmpdir(), "l4-credrun-"));
    const run = await runTenant(
      T_ALPHA,
      [
        { toolCall: { name: `mcp__${SERVER_NAME}__whoami`, arguments: "{}" }, usage: STUB_USAGE },
        { text: "cred run done", usage: STUB_USAGE },
      ],
      join(dir, "pids"),
    );
    const all = eventsJson(run);
    expect(all).not.toContain("secret-alpha-value");
    expect(all).not.toContain("secret-beta-value");
    expect(all).not.toContain("MCP_CREDENTIAL");
  });
});
