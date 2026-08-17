/**
 * WO-DSH-POC-S4 · 路 B（dsh harness）验收测试。
 *
 * 覆盖 /tmp/dsh-poc-plan.md E1–E4/E3′/E6（E5 = flag off 跑既有套件全绿，单独执行不进本文件）：
 *   E1  配置驱动行为：改 SetupSpec（AgentDefinition 映射产物）⇒ 事件流 request/header 随之变；还原即复原。
 *   E2  规则闸（集成）：PRE_CHECK deny ⇒ echo_tool 执行计数 0（跨进程 ECHO_COUNT_FILE 取证）
 *       且拦截以 tool/result isError 形式出现在帧流里；无 deny 基线计数 1。
 *   E3  租户密钥路由（单元）：credentialRef 形态 TENANT_<id>__<KEY>，前缀白名单解析器；
 *   E3′ 负例：租户 A 解租户 B 的 ref ⇒ undefined ⇒ mapMcpConfig MISSING_CREDENTIAL 类抛错。
 *   E4  MCP 工具名零迁移逐字节相等：从上游 dist 抽 publicToolName 原文 eval 对拍（含规整/截断边界）。
 *   E6  三档 verdict 表（直接映射 / 收尾重组装 / 外壳留痕）以数据编码并逐行断言。
 *
 * 集成用例（E1/E2）spawn packages/dsh-harness 子进程，走 src/dsh-runtime/runner.ts 真缝。
 */
import { mkdtempSync, readFileSync, readFileSync as readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@platform/contracts";
import {
  createSseMapper,
  dshPublicToolName,
  mapMcpConfig,
  runDshAgent,
  type DshSessionEvent,
  type DshSetupSpec,
} from "../src/dsh-runtime/index.js";

// apps/agentcore/test/ → 仓根 = ../../../
const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const INTEGRATION_TIMEOUT = 60_000;

function requestHeaders(events: readonly DshSessionEvent[]): Record<string, unknown>[] {
  return events
    .filter((e) => e.type === "request/header")
    .map((e) => ((e.data as { header: Record<string, unknown> }).header));
}

function echoCount(file: string): number {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}

describe("E1 · 配置驱动行为（request/header 为观测点）", () => {
  it("改 persona/finalAnswer ⇒ header.system/header.tools 随之变；还原即复原", { timeout: INTEGRATION_TIMEOUT }, async () => {
    // N4: DshSetupSpec.tenantId 必填化后的字面量补齐（本组 spec 均无 mcpServers，wire 语义不变）。
    const alpha: DshSetupSpec = { tenantId: "t1", persona: "PERSONA_ALPHA_MARKER" };
    const beta: DshSetupSpec = {
      tenantId: "t1",
      persona: "PERSONA_BETA_MARKER",
      finalAnswer: { description: "d", schema: { type: "object" } },
    };
    const runA1 = await runDshAgent(
      { prompt: "p", setup: alpha, provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000 },
    );
    const runB = await runDshAgent(
      { prompt: "p", setup: beta, provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000 },
    );
    const runA2 = await runDshAgent(
      { prompt: "p", setup: alpha, provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000 },
    );

    const hA1 = requestHeaders(runA1.events)[0]!;
    const hB = requestHeaders(runB.events)[0]!;
    const hA2 = requestHeaders(runA2.events)[0]!;
    expect(hA1).toBeDefined();
    expect(String(hA1.system)).toContain("PERSONA_ALPHA_MARKER");
    expect(String(hB.system)).toContain("PERSONA_BETA_MARKER");
    expect(hB.system).not.toBe(hA1.system);
    // finalAnswer 下发 ⇒ final_answer 进工具表；alpha 无 ⇒ 不在。
    const toolsB = JSON.stringify(hB.tools ?? []);
    const toolsA = JSON.stringify(hA1.tools ?? []);
    expect(toolsB).toContain("final_answer");
    expect(toolsA).not.toContain("final_answer");
    // 还原即复原（byte-level header 相等）。
    expect(hA2).toEqual(hA1);
    // 三次运行均正常收尾（turn/end completed ⇒ ANSWERED）。
    for (const r of [runA1, runB, runA2]) {
      expect(r.result.ok).toBe(true);
      if (r.result.ok) expect(r.result.outcome).toBe("ANSWERED");
    }
  });
});

describe("E2 · 规则闸（PRE_CHECK deny ⇒ 执行计数 0 + 拦截入流）", () => {
  const GOV: DshSetupSpec["governance"] = {
    ruleBindings: { ruleKeys: ["r_deny_echo"], mode: "PRE_CHECK" },
    scopeObjectTypes: [],
  };
  it("deny ⇒ count 0 且 tool/result isError 带 deny 理由；基线 ⇒ count 1", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-e2-"));
    const denyFile = join(dir, "deny-count");
    const baseFile = join(dir, "base-count");
    writeFileSync(denyFile, "");
    writeFileSync(baseFile, "");

    const denied = await runDshAgent(
      { prompt: "call echo_tool then answer", setup: { tenantId: "t1", governance: GOV }, provider: "mock", model: "mock" },
      {
        harnessDir: HARNESS_DIR,
        requestTimeoutMs: 30_000,
        env: { PLATFORM_GOV_DENY: "echo_tool", ECHO_COUNT_FILE: denyFile },
      },
    );
    expect(echoCount(denyFile)).toBe(0);
    // 拦截入流：tool/result isError，理由含规则闸措辞。
    const intercept = denied.events.find(
      (e) =>
        e.type === "tool/result" &&
        JSON.stringify(e.data).includes("denied by ruleBindings PRE_CHECK"),
    );
    expect(intercept).toBeDefined();
    expect(JSON.stringify((intercept as DshSessionEvent).data)).toContain('"isError":true');
    // turn 仍 completed（deny 是工具级错误，不是 run 级崩溃）。
    expect(denied.result.ok).toBe(true);
    if (denied.result.ok) expect(denied.result.outcome).toBe("ANSWERED");

    const baseline = await runDshAgent(
      { prompt: "call echo_tool then answer", setup: { tenantId: "t1", governance: GOV }, provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000, env: { ECHO_COUNT_FILE: baseFile } },
    );
    expect(echoCount(baseFile)).toBe(1);
    expect(baseline.result.ok).toBe(true);
  });
});

describe("E3/E3′ · 租户密钥路由（credentialRef 前缀白名单）", () => {
  const MCP: McpServerConfig = {
    id: "mcp_1",
    tenantId: "t1",
    name: "Solver API",
    serverName: "solver_api",
    transport: { type: "streamable_http", url: "https://mcp.example.com/sse" },
    credentialRef: "TENANT_t1__MCP_SOLVER",
    credentialKind: "static_bearer",
    status: "ACTIVE",
  };
  // 租户作用域解析器：只解本租户前缀的 ref（生产口径的测试替身）。
  const store: Record<string, string> = {
    TENANT_t1__MCP_SOLVER: "secret-t1",
    TENANT_t2__MCP_SOLVER: "secret-t2",
  };
  const tenantResolver =
    (tenantId: string) =>
    (ref: string): string | undefined =>
      ref.startsWith(`TENANT_${tenantId}__`) ? store[ref] : undefined;

  it("E3：本租户 ref 解析并注入 Bearer", () => {
    const spec = mapMcpConfig(MCP, tenantResolver("t1"));
    expect(spec.headers).toEqual({ Authorization: "Bearer secret-t1" });
  });
  it("E3′：租户 t2 持 t1 的 ref ⇒ undefined ⇒ MISSING_CREDENTIAL 类抛错（fail-closed）", () => {
    expect(tenantResolver("t2")(MCP.credentialRef!)).toBeUndefined();
    expect(() => mapMcpConfig(MCP, tenantResolver("t2"))).toThrow(/credentialRef unresolvable/);
  });
});

describe("E4 · MCP 工具名零迁移（与上游 dist 逐字节对拍）", () => {
  // 从上游 dist 原文抽出 publicToolName（模块私有，不进 export 表）eval 成对照实现。
  const dist = readSync(
    fileURLToPath(new URL("../../../packages/dsh-harness/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js", import.meta.url)),
    "utf8",
  );
  const fnMatch = dist.match(/function publicToolName\(serverName, rawName\) \{[\s\S]*?\n\}/);
  const upstream = new Function(
    "createHash",
    `const MAX_PUBLIC_NAME_LENGTH = 64; const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g; const HASH_LENGTH = 12;
     ${fnMatch![0]}; return publicToolName;`,
  )(createHash) as (s: string, r: string) => string;

  const corpus: [string, string][] = [
    ["solver_api", "solve_lp"],           // 干净路径
    ["solver_api", "solve.lp v2"],        // 非法字符规整 ⇒ 加 hash
    ["solver_api", "x".repeat(80)],       // 超 64 截断 + hash
    ["ab", "a"],                          // 最短合法 serverName
    ["a".repeat(24), "t"],                // 最长我方 serverName
    ["solver_api", "工具_β"],              // 非 ASCII 规整
    ["solver_api", "a".repeat(52)],       // 恰好压线（joined 64）
    ["solver_api", "a".repeat(53)],       // 压线 +1 ⇒ 触发截断分支
  ];
  it("全语料逐字节相等（含规整/截断/压线边界）", () => {
    for (const [s, r] of corpus) {
      expect(dshPublicToolName(s, r)).toBe(upstream(s, r));
    }
  });
});

describe("E6 · 三档 verdict 表（帧 → 外壳语义）", () => {
  // tier1 = 逐帧直接映射 SSE；tier2 = 收尾重组装（turn/end 后由 runner 发 answer.final/task.*）；
  // tier3 = 留痕不上流（request/* 观测帧；STALL_LOOP 不可重建——dsh 无环检测，文档化放弃项）。
  const ROWS: { frame: DshSessionEvent; tier: 1 | 2 | 3; expect?: { event: string; match: string } }[] = [
    {
      frame: { type: "tool/call", data: { turn: 0, step: 0, callId: "c1", name: "echo_tool", arguments: "{}" } },
      tier: 1,
      expect: { event: "step.started", match: "echo_tool" },
    },
    {
      frame: { type: "tool/result", data: { turn: 0, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", content: "ok", isError: false }] } } },
      tier: 1,
      expect: { event: "step.completed", match: '"status":"OK"' },
    },
    {
      frame: { type: "assistant/chunk", data: { turn: 0, step: 2, chunk: { type: "text-delta", text: "hi" } } },
      tier: 1,
      expect: { event: "step.completed", match: "agent_narration" },
    },
    { frame: { type: "assistant/message", data: { turn: 0, step: 3, message: { content: [{ type: "text", text: "final" }] } } }, tier: 2 },
    { frame: { type: "turn/end", data: { turn: 0, reason: { kind: "completed" } } }, tier: 2 },
    { frame: { type: "request/header", data: { header: { config: {} }, reason: "initial" } }, tier: 3 },
    { frame: { type: "request/context", data: { provider: "mock", model: "mock" } }, tier: 3 },
    { frame: { type: "session/created", data: { sessionId: "s" } }, tier: 3 },
  ];
  it("tier1 帧可映射且形状正确；tier2/tier3 帧 createSseMapper 返回 undefined", () => {
    const mapOne = createSseMapper();
    for (const row of ROWS) {
      const sse = mapOne(row.frame);
      if (row.tier === 1) {
        expect(sse, `tier1 ${row.frame.type} must map`).toBeDefined();
        expect(sse!.event).toBe(row.expect!.event);
        expect(JSON.stringify(sse!.payload)).toContain(row.expect!.match.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
      } else {
        expect(sse, `tier${row.tier} ${row.frame.type} must NOT map per-frame`).toBeUndefined();
      }
    }
  });
});
