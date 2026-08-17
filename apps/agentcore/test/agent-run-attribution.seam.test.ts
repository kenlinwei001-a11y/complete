import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition, SkillDefinition } from "@platform/contracts";
import { AgentRunRecordSchema } from "@platform/contracts";
import { createTestApp, debugHeaders, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { loadConfig } from "../src/config.js";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";

/**
 * WO-AGENTRUN-ATTRIBUTION · SEAM：一次运行归属到具体 Agent（`G-AGENTRUN-NO-AGENT-ATTRIBUTION` 可归属半边）。
 *
 * **接缝在哪（三段，任一段漏都必须红）**
 *   契约（`AgentRunRecord.agentId/agentKey/tenantId/attribution`）
 *   × 引擎（`agent/loop.ts finishRun` 单点回填 · `engine.runRegisteredAgent` 供归属实参）
 *   × 仓储（`agentRuns.listByAgent(tenantId, agentKey)` 双实现）
 *   × 读端（`GET /b/v1/agents/:id/runs`）。
 *
 * **刻意不走的捷径**：全程**不** `repos.agentRuns.insert({...agentId})` 造记录再读 ——
 * 那只证明「仓储会存会取」，恰好把本单要验的那一段（引擎到底填没填）跳过去了。
 * 这里一律 **真 submitQuery → 真 runPipeline → 真 runSceneAgent/runPathB → 真 runAgentLoop →
 * 真 insert → 真 HTTP 读**。引擎少填一个字段、归属取错版本、仓储漏掉租户过滤，都会在这里当场红。
 *
 * **诚实位同样被断言（③④⑤）**：
 *  - 通用探索路（`runPathB`）真的没有 AgentDefinition ⇒ 必须是 `EXPLORATORY` 且**不出现在任何 agent 的运行里**；
 *  - 未绑 LLM provider 的环境（`completeNoLlmDegradation`·`orchestrator.ts:2657`）压根不写 run ⇒
 *    端点必须返空列表而不是报错，也不许凭空造一条；
 *  - 归属上线**之前**写的旧记录（无归属字段）⇒ 一条都不许挂到某个 agent 名下充数。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "归属测试 agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
    ...partial,
  };
}

/** 挂一条 AGENT_FIRST 场景入口：该 view 上的问句直落 runSceneAgent → runRegisteredAgent（真注册 agent 路）。 */
async function bindSceneAgent(t: TestApp, viewKey: string, agentId: string): Promise<void> {
  await t.repos.sceneEntries.upsert({
    id: `scn_${viewKey}`,
    tenantId: TENANT,
    viewKey,
    mode: "AGENT_FIRST",
    defaultAgentId: agentId,
    uiHints: { placeholder: "随便问", suggestedQuestions: [] },
  });
}

/** 真跑一次注册 agent 循环（一轮工具 + 一轮 final_answer），返回 taskId。 */
async function runRegisteredOnce(t: TestApp, viewKey: string, query: string): Promise<string> {
  t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] });
  t.llm.queueAgentTurn({
    content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "归属测试回答。" }], provenance: [] })],
  });
  const { taskId } = await submitQuery(t, PLANNER, query, { view: viewKey });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
  return taskId;
}

async function listRuns(t: TestApp, agentId: string, user = PLANNER) {
  return t.app.inject({ method: "GET", url: `/b/v1/agents/${agentId}/runs`, headers: debugHeaders(user) });
}

describe("WO-AGENTRUN-ATTRIBUTION · 运行归属接缝", () => {
  it("① 真跑注册 agent → 引擎把归属写进库 → 端点按 agent 读回同一条（不是端点自己拼的）", async () => {
    const t = await createTestApp();
    await t.repos.agents.insert(agentDef({ id: "agt_attr_a", key: "attr_agent_a" }));
    await bindSceneAgent(t, "attr_a", "agt_attr_a");

    const taskId = await runRegisteredOnce(t, "attr_a", "这个 agent 帮我看一下基地情况");

    // —— 库里那条：归属**必须**由引擎写好，不许靠读端事后补 ——
    const persisted = await t.repos.agentRuns.getByTask(taskId);
    expect(persisted).toBeDefined();
    expect(persisted!.agentId).toBe("agt_attr_a");
    expect(persisted!.agentKey).toBe("attr_agent_a");
    expect(persisted!.agentVersion).toBe(1);
    expect(persisted!.tenantId).toBe(TENANT);
    expect(persisted!.attribution).toBe("REGISTERED");
    expect(persisted!.createdAt).toBeTruthy();
    // WO-DSH-P2-UX（N5）· A6：native 路显式写内核标识 —— runAgentLoop 永不在 dsh 分叉下执行
    // （engine.ts DSH_HARNESS=1 分叉在进 loop 之前已返回），故这里恒为 "NATIVE"。
    expect(persisted!.kernel).toBe("NATIVE");

    // —— HTTP 读端：按 agent 能查到，且就是库里那条（id 对得上）——
    const res = await listRuns(t, "agt_attr_a");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agentId: string; agentKey: string; runs: unknown[] };
    expect(body.agentId).toBe("agt_attr_a");
    expect(body.agentKey).toBe("attr_agent_a");
    expect(body.runs.length).toBe(1);
    const run = AgentRunRecordSchema.parse(body.runs[0]);
    expect(run.id).toBe(persisted!.id);
    expect(run.taskId).toBe(taskId);
    // 归属之外的运行数据仍是**引擎真产出**（不是空壳）：真调过工具、真有 token 计数维度。
    expect(run.iterations.flatMap((i) => i.toolCalls).some((c) => c.toolName === "query_objects")).toBe(true);
  });

  it("② 跨版本按 key 聚合：同一 Agent 升到 v2 再跑 → 两条都在（按 id 查会当场归零，故必须按 key）", async () => {
    const t = await createTestApp();
    await t.repos.agents.insert(agentDef({ id: "agt_v1", key: "attr_versioned" }));
    await bindSceneAgent(t, "attr_v1", "agt_v1");
    await runRegisteredOnce(t, "attr_v1", "v1 跑一次");

    // 同 key 的第二版（真实场景：new-version 派生后发布）
    await t.repos.agents.insert(agentDef({ id: "agt_v2", key: "attr_versioned", version: 2 }));
    await bindSceneAgent(t, "attr_v2", "agt_v2");
    await runRegisteredOnce(t, "attr_v2", "v2 跑一次");

    // 拿 v2 的 id 问 → 应看到**这个 Agent** 的两次运行（含 v1 那次），且能分辨各是哪版跑的。
    const res = await listRuns(t, "agt_v2");
    expect(res.statusCode).toBe(200);
    const runs = (res.json() as { runs: unknown[] }).runs.map((r) => AgentRunRecordSchema.parse(r));
    expect(runs.length).toBe(2);
    expect(new Set(runs.map((r) => r.agentVersion))).toEqual(new Set([1, 2]));
    // 版本号取的是**真解析出来的那一版**，不是入参说法（v1 那条绝不能被记成 2）。
    expect(runs.filter((r) => r.agentId === "agt_v1").every((r) => r.agentVersion === 1)).toBe(true);
  });

  it("③ 诚实位 · 通用探索路真的无归属对象 → EXPLORATORY，且**不挂到任何 agent 名下**", async () => {
    const t = await createTestApp({ env: { QOS_AGENT_MAX_ROUND_TRIPS: "2" } });
    await t.repos.agents.insert(agentDef({ id: "agt_bystander", key: "attr_bystander" }));

    // 不绑场景入口 → 走分类 → outOfCatalog → runPathB 探索模式（工具集当场算，全程无 AgentDefinition）。
    t.llm.queueClassification(OUT_OF_CATALOG);
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] });
    }
    const { taskId } = await submitQuery(t, PLANNER, "把所有能查的都翻一遍并给我一个综合自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT"); // 确实走了 AGENT 路

    const run = await t.repos.agentRuns.getByTask(taskId);
    expect(run).toBeDefined();
    // 正面声明「本次真的没有 Agent 定义」——不是漏填。
    expect(run!.attribution).toBe("EXPLORATORY");
    expect(run!.agentId).toBeUndefined();
    expect(run!.agentKey).toBeUndefined();
    expect(run!.tenantId).toBe(TENANT); // 租户仍在（tenant_id everywhere）

    // 关键：它绝不许因为"列表里得有东西"而被算进某个 agent 的运行。
    const res = await listRuns(t, "agt_bystander");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { runs: unknown[] }).runs.length).toBe(0);
  });

  it("④ 诚实位 · 归属上线前的旧记录（无归属字段）一条都不许挂到 agent 名下充数", async () => {
    const t = await createTestApp();
    await t.repos.agents.insert(agentDef({ id: "agt_legacy", key: "attr_legacy" }));
    // 复刻旧记录：没有 tenantId / agentKey / attribution —— 归属**未知**，不等于"确知没有"。
    await t.repos.agentRuns.insert({
      id: "run_legacy",
      taskId: "task_legacy",
      model: "m",
      iterations: [],
      budget: { maxIterations: 1, maxToolCalls: 1, maxSolverCalls: 1, maxDurationMs: 1, maxClarifications: 0, maxDiscoverCalls: 1, maxRoundTrips: 1 },
      budgetExhausted: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });

    const res = await listRuns(t, "agt_legacy");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { runs: unknown[] }).runs.length).toBe(0);
  });

  it("⑤ 诚实位 · 未绑 LLM provider 的环境（AGENT 路但引擎没进循环）→ 空列表而非报错，也不凭空造记录", async () => {
    const t = await createTestApp();
    await t.repos.agents.insert(agentDef({ id: "agt_noprov", key: "attr_noprov" }));
    // completeNoLlmDegradation 的真实形态：task 标成 path=AGENT + COMPLETED，却从不 insert run。
    await t.repos.tasks.insert({
      id: "task_nollm",
      tenantId: TENANT,
      userId: "user-planner",
      packageId: "pkg_battery_manufacturing",
      conversationId: "conv_nollm",
      query: "自由问句",
      context: { view: "dash", selectedObjects: [], filters: {} },
      status: "COMPLETED",
      path: "AGENT",
      clarificationRounds: 0,
      createdAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:01.000Z",
    });

    const res = await listRuns(t, "agt_noprov");
    expect(res.statusCode).toBe(200); // 不是 404、不是 500 —— 「没有运行」是常态不是故障
    expect((res.json() as { runs: unknown[] }).runs.length).toBe(0);
  });

  it("⑥ 租户隔离：别家租户的 agent 一律 404，且它的运行绝不经本租户的 key 漏出去", async () => {
    const t = await createTestApp();
    // 同一个 key 在两个租户各有一版（这正是"只按 key 过滤"会翻车的形态）。
    await t.repos.agents.insert(agentDef({ id: "agt_mine", key: "attr_shared_key" }));
    await t.repos.agents.insert(agentDef({ id: "agt_theirs", key: "attr_shared_key", tenantId: "other-tenant" }));
    await t.repos.agentRuns.insert({
      id: "run_theirs",
      taskId: "task_theirs",
      model: "m",
      iterations: [],
      budget: { maxIterations: 1, maxToolCalls: 1, maxSolverCalls: 1, maxDurationMs: 1, maxClarifications: 0, maxDiscoverCalls: 1, maxRoundTrips: 1 },
      budgetExhausted: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      tenantId: "other-tenant",
      agentId: "agt_theirs",
      agentKey: "attr_shared_key",
      agentVersion: 1,
      attribution: "REGISTERED",
      createdAt: "2026-08-10T00:00:00.000Z",
    });

    // ① 直接问别家的 agent → 404（与"不存在"同码，不泄漏存在性）
    const cross = await listRuns(t, "agt_theirs");
    expect(cross.statusCode).toBe(404);
    expect((cross.json() as { error: { code: string } }).error.code).toBe("AGENT_NOT_FOUND");

    // ② 问自己的同名 key → 必须看不到别家那条（listByAgent 的 tenantId 是硬过滤，不是装饰）
    const mine = await listRuns(t, "agt_mine");
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { runs: unknown[] }).runs.length).toBe(0);
  });

  it("⑦ 归属不干扰既有读端：同一条运行经 /queries/:taskId/agent-run 读回时也带着归属（两个读端同源）", async () => {
    const t = await createTestApp();
    await t.repos.agents.insert(agentDef({ id: "agt_both", key: "attr_both" }));
    await bindSceneAgent(t, "attr_both", "agt_both");
    const taskId = await runRegisteredOnce(t, "attr_both", "两个读端应当看到同一条");

    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/agent-run`,
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(200);
    const run = AgentRunRecordSchema.parse(res.json());
    expect(run.agentId).toBe("agt_both");
    expect(run.attribution).toBe("REGISTERED");
  });
});

/**
 * WO-DSH-P2-UX（N5）· A7 内核标识写入对拍（engine 级，DSH_HARNESS 休眠分叉两臂）。
 *
 *  - flag on（DSH_HARNESS=1）⇒ engine.ts 分叉走 dsh harness 子进程 ⇒ `run.kernel === "EXTERNAL"`；
 *  - flag off（缺省休眠）⇒ 同入口落 native `runAgentLoop` ⇒ `run.kernel === "NATIVE"`。
 *
 * 对拍的是**同一个写入面**（`engine.ts emptyAgentRunRecord` 分叉两点 / `agent/loop.ts finishRun`），
 * 前端徽标（agent-kernel-badge.test.tsx A1/A2）读的就是这里写下的值。
 *
 * env 卫生：engine fork 读的是**进程 env**（engine.ts `process.env.DSH_HARNESS`），
 * createTestApp 的 env 只进 config 管不到这层 ⇒ 本 describe 显式 save/restore 进程 env
 * （模式照 N3 deploy-governance-seam.test.ts :185-198）。
 */
describe("WO-DSH-P2-UX · 内核标识写入对拍（A7）", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const HARNESS_DIR = join(ROOT, "packages/dsh-harness");
  const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO"] as const;
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  /** engine 级直调 runRegisteredAgent（绕过 HTTP/编排层 —— 对拍的是引擎写入点本身）。 */
  async function runEngineOnce(t: TestApp, agentId: string, taskId: string) {
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

  it("DSH_HARNESS=1 ⇒ dsh 分叉产出的 run.kernel === \"EXTERNAL\"", { timeout: 60_000 }, async () => {
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR; // vitest cwd=apps/agentcore，缺省解析不到 packages/dsh-harness
    delete process.env.MOCK_SCENARIO; // 缺省剧本：echo_tool 一轮 + 文本收尾
    const t = await createTestApp();
    // echo_tool 是 harness 侧世界插件（非 native BUILTIN），对 runtime 而言是 UNKNOWN（照 N3 对位形态）。
    await t.repos.agents.insert(
      agentDef({
        id: "agt_kernel_dsh",
        key: "kernel_dsh_agent",
        tools: [{ kind: "BUILTIN", name: "echo_tool" }],
        scopeDeclaration: { objectTypes: [], toolNames: ["echo_tool"] },
      }),
    );

    const result = await runEngineOnce(t, "agt_kernel_dsh", "task_kernel_dsh");
    expect(result.run.kernel).toBe("EXTERNAL");
  });

  it("flag off（缺省休眠）⇒ 同入口落 native 循环 run.kernel === \"NATIVE\"", async () => {
    delete process.env.DSH_HARNESS;
    const t = await createTestApp();
    await t.repos.agents.insert(agentDef({ id: "agt_kernel_native", key: "kernel_native_agent" }));
    t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] });
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "内核测试回答。" }], provenance: [] })],
    });

    const result = await runEngineOnce(t, "agt_kernel_native", "task_kernel_native");
    expect(result.run.kernel).toBe("NATIVE");
  });

  /**
   * A10（verifier 自加变异盲区销账）· BLOCK 早退构造点（engine.ts 分叉**前**那一处
   * `emptyAgentRunRecord(..., DSH_HARNESS === "1" ? "EXTERNAL" : "NATIVE")`）的 kernel 值断言。
   * 该点标的是「本会走哪个内核」（run 未真执行任何循环）——若静默烂成恒 NATIVE，
   * flag-on 部署下屏上会把「本会走外部运行时」的运行说成「原生」= 说假话。
   * mutation 反证：该点改恒 "NATIVE" ⇒ 下面 flag-on 臂必须红。
   */
  function blockSkill(): SkillDefinition {
    return {
      id: "skl_kernel_block",
      tenantId: TENANT,
      key: "kernel_block",
      version: 1,
      name: "Kernel Block",
      summary: "测试用 Skill。当用户问内核预检问题时使用。不适用：非测试问题。",
      body: "## 目的\n测试。\n## 适用边界\n适用：测试。不适用：其他。\n## 前置检查\n无。\n## 步骤\n1. 直接 final_answer。\n## 示例\n正例：问测试 → 返回答案。\n反例：无。\n## 失败处理\n无。\n## 输出要求\n按 Skill 策略输出。",
      references: [{ kind: "rule", key: "KERNEL_PRE_BLOCK", role: "precondition", required: true }],
      resources: [],
      status: "PUBLISHED",
    } as SkillDefinition;
  }

  /** 真走 skill 规则预检 BLOCK 早退（engine 级），返回 run。 */
  async function runBlockedOnce(suffix: string) {
    const t = await createTestApp();
    await t.repos.skills.insert(blockSkill());
    await t.repos.agents.insert(
      agentDef({ id: `agt_kernel_block_${suffix}`, key: `kernel_block_${suffix}`, skills: [{ skillId: "skl_kernel_block", version: 1 }] }),
    );
    vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
      { ruleId: "KERNEL_PRE_BLOCK", passed: false, severity: "BLOCK", explanation: "预检命中", ruleVersion: 1 },
    ]);
    const result = await runEngineOnce(t, `agt_kernel_block_${suffix}`, `task_kernel_block_${suffix}`);
    // 先钉死「真的走了 BLOCK 早退」——否则下面的 kernel 断言测的就不是那个构造点。
    expect(result.answer.blocks.some((b) => b.type === "rule_violation" && b.ruleId === "KERNEL_PRE_BLOCK")).toBe(true);
    expect(result.run.iterations.length).toBe(0); // 未真执行任何循环
    return result;
  }

  it("A10 BLOCK 早退 · DSH_HARNESS=1 ⇒ kernel === \"EXTERNAL\"（本会走外部运行时，未真执行）", async () => {
    process.env.DSH_HARNESS = "1"; // 注意：BLOCK 早退在分叉**之前**，不会真起 dsh 子进程
    const result = await runBlockedOnce("on");
    expect(result.run.kernel).toBe("EXTERNAL");
  });

  it("A10 对拍 · 同剧本 flag off ⇒ kernel === \"NATIVE\"", async () => {
    delete process.env.DSH_HARNESS;
    const result = await runBlockedOnce("off");
    expect(result.run.kernel).toBe("NATIVE");
  });
});
