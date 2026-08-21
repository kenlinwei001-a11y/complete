/**
 * WO-DSH-PROD-READY · F-1：生产档 governance http 裁决接线（engine 级缝）。
 *
 * **病灶**（W3 审计第四条前置）：packages/dsh-harness/cordis.yml（生产档）platform-governance
 * 曾 mode:'mock' + deny:[] ⇒ DSH 路径 ruleBindings PRE_CHECK 静默 allow-all；engine 分叉 env
 * 注入块只注 PLATFORM_LLM_*，不注 PLATFORM_GOV_URL/TOKEN。F-1 起：生产档 mode:'http'，
 * engine 分叉逐 run 注入 PLATFORM_GOV_URL（缺省推导本进程裁决端点，DSH_GOV_URL 覆盖）与
 * PLATFORM_GOV_TOKEN（= SERVICE_TOKEN，未配置不发头）。
 *
 * **fail-closed 链（四臂分别钉死，不许削弱）**：
 *   ① 真裁决端点 + 双侧同 token + 规则 BLOCK ⇒ pre-execute deny：理由（真 verdict 文案
 *     `ruleId: explanation`）逐字回灌模型面 ∧ 工具体零执行 ∧ step.completed status=ERROR；
 *   ② 同构放行 ⇒ 工具体真执行（server 侧 toolCalls===1）∧ 裁决计数覆盖 echo + final_answer；
 *   ③ PLATFORM_GOV_URL 指已关闭端口 ⇒ 插件 catch 转 deny（reason 含 unreachable）∧ 零执行
 *     ∧ rules.evaluate 零调用（根本没到端点）；
 *   ④ SERVICE_TOKEN 缺失 ⇒ 端点 requireServiceToken fail-closed 401 ⇒ 插件 HTTP !ok 转 deny
 *     （reason 含 HTTP 401）∧ 零执行 ∧ rules.evaluate 零调用（鉴权先于求值）。
 *
 * 与 L2（dsh-e2e-real-triad A2，runner 级 cordis.l2.yml）的关系：L2 证 http 缝本身可用，
 * 本缝证**生产档 + engine 分叉**这条出货链路真的把裁决端点/凭据注入子进程——缺注入时
 * ③④ 红、mode 回 mock 时 ①② 红（mutation 反证锚点）。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition, RuleVerdict } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import {
  STUB_DCP_SPEC,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRound,
} from "./helpers-dsh-stub.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { encryptSecret } from "../src/crypto.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

// apps/agentcore/test/ → 仓根 = ../../../
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");
const MOCK_SERVER = join(REPO_ROOT, "apps/agentcore/test/fixtures/mock-mcp-stdio-server.mjs");

const GOV_TIMEOUT = 90_000;
const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO"] as const;

/** 显式假凭据（泄凭扫描对象；绝非真凭据）。 */
const FAKE_LLM_KEY = "wo-f1-gov-fake-llm-key-00000000000000000000";
const FAKE_MCP_SECRET = "wo-f1-gov-fake-secret-00000000000000000";
const SERVICE_TOKEN = "wo-f1-gov-service-token-0000000000000000";

const MCP_CONFIG_ID = "mcpcfg_f1gov";
const CRED_ID = "cred_f1gov";
const SERVER_NAME = "fwdmock";
const ECHO_TOOL = `mcp__${SERVER_NAME}__echo`;

const RULE_ID = "GOV_RULE_X";
const RULE_EXPLANATION = "生产档治理命中";
const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const EXPECTS_SCHEMA = {
  type: "object",
  properties: { blocks: { type: "array" }, provenance: { type: "array" } },
  required: ["blocks", "provenance"],
};
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "f1 gov seam answer" }],
  provenance: [],
});

interface Emitted {
  event: string;
  payload: unknown;
}

/** 抓一个空闲端口再释放（engine cfg 在 listen 前定型 ⇒ DSH_GOV_URL 必须预知端口；竞态窗极小）。 */
async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function agentDef(): AgentDefinition {
  return {
    id: "agt_f1_gov",
    tenantId: TENANT,
    key: "f1_gov_agent",
    version: 1,
    name: "F1 Gov Seam Agent",
    description: "wo-dsh-prod-ready f1 seam",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是 F1 生产档治理缝测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [RULE_ID], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [{ mcpConfigId: MCP_CONFIG_ID }],
    scopeDeclaration: { objectTypes: [], toolNames: [ECHO_TOOL] },
    status: "PUBLISHED",
    kernel: "EXTERNAL", // per-agent 内核驱动分叉（进程 env 恒关，来源无歧义）
  } as AgentDefinition;
}

async function seedMcpConfig(t: TestApp, recordPath: string): Promise<void> {
  await t.repos.mcpConfigs.insert({
    id: MCP_CONFIG_ID,
    tenantId: TENANT,
    name: "F1 Gov Forward Mock",
    serverName: SERVER_NAME,
    transport: { type: "stdio", command: process.execPath, args: [MOCK_SERVER, recordPath] },
    credentialRef: CRED_ID,
    credentialKind: "static_bearer",
    status: "ACTIVE",
  } as never);
  await t.repos.credentials.insert({
    id: CRED_ID,
    tenantId: TENANT,
    name: "f1 gov mock credential",
    ciphertext: encryptSecret(FAKE_MCP_SECRET, t.config.CREDENTIAL_KEY),
    createdAt: new Date().toISOString(),
  });
}

/**
 * 生产档（**不钉 DSH_HARNESS_CORDIS_FILE** ⇒ 缺省 cordis.yml = http 模式）+ 真 listen 的
 * 测试 app：harness 子进程经 127.0.0.1 真 HTTP 打 /b/v1/governance/adjudicate（server.ts
 * 既有端点）。token 双侧同源 = cfg.SERVICE_TOKEN（engine 注 PLATFORM_GOV_TOKEN 的唯一来源）。
 */
async function startProductionGovApp(opts: {
  stubUrl: string;
  serviceToken?: string;
  govUrl?: string; // ③ 臂显式指已关闭端口
}): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    providerDirectory: stubDirectory(stubProvider(opts.stubUrl), FAKE_LLM_KEY) as never,
    // 进程内 MCP 面置空（本缝断言子进程世界转发执行，与 in-process mock 工具解耦）。
    mcp: new MockMcpClient({ [MCP_CONFIG_ID]: [] }),
    env: {
      DSH_GOV_URL: opts.govUrl ?? `http://127.0.0.1:${port}/b/v1/governance/adjudicate`,
      ...(opts.serviceToken ? { SERVICE_TOKEN: opts.serviceToken } : {}),
    },
  });
  if (!opts.govUrl) await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

async function runAgent(t: TestApp, taskId: string, emitted: Emitted[]) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: "agt_f1_gov",
    version: 1,
    prompt: "调 echo 探查后收尾",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", "agt_f1_gov"),
    emit: async (event, payload) => {
      emitted.push({ event, payload });
    },
  });
}

/** echo 调用帧的 step.completed status（isError ⇒ ERROR 落屏位，A3b 同形态）。 */
function echoStepStatus(emitted: Emitted[]): string | undefined {
  const started = emitted.find((f) => f.event === "step.started" && (f.payload as { type?: string }).type === ECHO_TOOL);
  if (!started) return undefined;
  const stepId = (started.payload as { stepId: string }).stepId;
  const completed = emitted.find((f) => f.event === "step.completed" && (f.payload as { stepId?: string }).stepId === stepId);
  return (completed?.payload as { status?: string } | undefined)?.status;
}

describe("WO-DSH-PROD-READY F-1 · 生产档 governance http 裁决接线（engine 级）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // per-agent kernel=EXTERNAL 驱动，进程 env 恒关——分叉来源无歧义
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("① 真端点 + 双侧同 token + 规则 BLOCK ⇒ deny 理由逐字回灌模型面 ∧ 工具体零执行 ∧ step ERROR", { timeout: GOV_TIMEOUT }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "f1-gov-deny-"));
    const recordPath = join(tmp, "record.json");
    const stub = await startStubOpenAi([
      { toolCall: { name: ECHO_TOOL, arguments: JSON.stringify({ text: "x" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startProductionGovApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedMcpConfig(t, recordPath);
      await t.repos.agents.insert(agentDef());
      // 规则求值经测试 dataCore mock（dsh-postcheck.seam 同手法）：只对 echo 调用 BLOCK，
      // final_answer 放行（真实规则按载荷求值形态；全 BLOCK 会把收尾工具一并拒掉）。
      const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate").mockImplementation(async (_ctx, _ids, payload) => {
        const blocking = JSON.stringify(payload).includes(ECHO_TOOL);
        return [
          {
            ruleId: RULE_ID,
            passed: !blocking,
            severity: blocking ? "BLOCK" : "INFO",
            explanation: blocking ? RULE_EXPLANATION : "通过",
            ruleVersion: 1,
          } satisfies RuleVerdict,
        ];
      });
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_f1_gov_deny", emitted);

      expect(result.run.kernel).toBe("EXTERNAL"); // 钉死真走了 DSH 分叉
      expect(result.outcome).toBe("ANSWERED"); // deny 后模型经 final_answer 诚实收尾
      expect(evaluateSpy).toHaveBeenCalled(); // 裁决真过了端点→rules.evaluate
      // 理由 = 端点真 verdict 文案 `ruleId: explanation`（server.ts 拼接形态），逐字到模型面
      expect(stub.requests.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(stub.requests[1]!.body), "deny 理由必须逐字回灌模型面").toContain(`${RULE_ID}: ${RULE_EXPLANATION}`);
      expect(JSON.stringify(stub.requests[1]!.body)).not.toContain("mock rule engine"); // 出处非 harness mock 档
      expect(echoStepStatus(emitted), "isError ⇒ step.completed status=ERROR").toBe("ERROR");
      // 工具体零执行（pre-execute 拒在派发前）
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: unknown[] };
      expect(record.toolCalls, "pre-execute deny ⇒ MCP server 零 tools/call").toHaveLength(0);
      // 答案不经被拒工具：final_answer 内容原样交付，无 echo 产物
      expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown.includes("f1 gov seam answer"))).toBe(true);
    } finally {
      await close();
      await stub.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("② 同构放行 ⇒ 工具体真执行 ∧ 裁决覆盖 echo + final_answer ∧ 答案原样交付", { timeout: GOV_TIMEOUT }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "f1-gov-allow-"));
    const recordPath = join(tmp, "record.json");
    const stub = await startStubOpenAi([
      { toolCall: { name: ECHO_TOOL, arguments: JSON.stringify({ text: "x" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startProductionGovApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedMcpConfig(t, recordPath);
      await t.repos.agents.insert(agentDef());
      const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
        { ruleId: RULE_ID, passed: true, severity: "INFO", explanation: "通过", ruleVersion: 1 } satisfies RuleVerdict,
      ]);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_f1_gov_allow", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      expect(echoStepStatus(emitted), "放行 ⇒ echo step 正常完成（非 ERROR）").not.toBe("ERROR");
      // 工具体真执行（server 侧 tools/call 计数 = 1）
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: unknown[] };
      expect(record.toolCalls, "放行 ⇒ MCP server 真执行一次").toHaveLength(1);
      // 裁决覆盖 echo 与 final_answer 两次 pre-execute（「放行」与「没跑裁决」必须可区分）
      expect(evaluateSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown.includes("f1 gov seam answer"))).toBe(true);
    } finally {
      await close();
      await stub.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("③ PLATFORM_GOV_URL 指已关闭端口 ⇒ fail-closed deny（reason 含 unreachable）∧ 零执行 ∧ 零求值", { timeout: GOV_TIMEOUT }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "f1-gov-dead-"));
    const recordPath = join(tmp, "record.json");
    const deadPort = await freePort(); // 抓起即放 ⇒ 端口已关闭
    const stub = await startStubOpenAi([
      { toolCall: { name: ECHO_TOOL, arguments: JSON.stringify({ text: "x" }) }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE }, // 全工具 fail-closed ⇒ 文本诚实收尾（mock-llm 默认剧本同形态）
    ] satisfies StubRound[]);
    const { t, close } = await startProductionGovApp({
      stubUrl: `${stub.url}/v1`,
      serviceToken: SERVICE_TOKEN,
      govUrl: `http://127.0.0.1:${deadPort}/b/v1/governance/adjudicate`,
    });
    try {
      await seedMcpConfig(t, recordPath);
      await t.repos.agents.insert(agentDef());
      const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_f1_gov_dead", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED"); // deny 不崩不静默，文本收尾
      expect(stub.requests.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(stub.requests[1]!.body), "不可达理由必须回灌模型面").toContain("unreachable");
      expect(echoStepStatus(emitted)).toBe("ERROR");
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: unknown[] };
      expect(record.toolCalls, "fail-closed deny ⇒ 零执行").toHaveLength(0);
      expect(evaluateSpy, "端点不可达 ⇒ rules.evaluate 零调用（根本没到端点）").not.toHaveBeenCalled();
    } finally {
      await close();
      await stub.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("④ SERVICE_TOKEN 缺失 ⇒ 端点 fail-closed 401 ⇒ 插件转 deny（reason 含 HTTP 401）∧ 零执行 ∧ 零求值", { timeout: GOV_TIMEOUT }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "f1-gov-401-"));
    const recordPath = join(tmp, "record.json");
    const stub = await startStubOpenAi([
      { toolCall: { name: ECHO_TOOL, arguments: JSON.stringify({ text: "x" }) }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    // 双侧都不配 SERVICE_TOKEN：engine 不注 PLATFORM_GOV_TOKEN（不发头），端点
    // requireServiceToken 未配置 ⇒ 恒 401（server.ts fail-closed 同口径）。
    const { t, close } = await startProductionGovApp({ stubUrl: `${stub.url}/v1` });
    try {
      await seedMcpConfig(t, recordPath);
      await t.repos.agents.insert(agentDef());
      const evaluateSpy = vi.spyOn(t.dataCore.rules, "evaluate");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_f1_gov_401", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      expect(stub.requests.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(stub.requests[1]!.body), "401 理由必须回灌模型面").toContain("HTTP 401");
      expect(echoStepStatus(emitted)).toBe("ERROR");
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { toolCalls: unknown[] };
      expect(record.toolCalls, "401 fail-closed ⇒ 零执行").toHaveLength(0);
      expect(evaluateSpy, "鉴权先于求值 ⇒ rules.evaluate 零调用").not.toHaveBeenCalled();
    } finally {
      await close();
      await stub.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
