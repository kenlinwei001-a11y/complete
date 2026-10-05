import { describe, expect, it, vi, afterEach } from "vitest";
import { SkillDefinitionSchema, type AgentDefinition, type EvalCase, type SkillDefinition } from "@platform/contracts";
import { createTestApp, TENANT, PKG, type TestApp } from "./helpers.js";
import { SkillProbeRunner } from "../src/skill-probe.js";
import { SKILL_LOADER_TOOL } from "../src/engine.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import type { RequestAuth } from "../src/auth.js";

/**
 * WO-SKILL-PROBE-KERNEL · SEAM：探针 / twin 的**运行内核不得由进程 env 决定**。
 *
 * **接缝在哪（三段，任一段漏都必须红）**
 *   探针构造（`skill-probe.ts` 的两个 `desired: AgentDefinition` 字面量，含不含 `kernel`）
 *   × 引擎分叉守卫（`engine.ts` `agent.kernel === "EXTERNAL" || (agent.kernel === undefined
 *     && process.env.DSH_HARNESS === "1")`）
 *   × 臂专属工具名（`engine.ts` `SKILL_LOADER_TOOL = { native: "load_skill", dsh: "skill" }`）。
 *
 * **为什么必须真引擎**：既有 `skill-probe.test.ts` 全程用 `makeFakeEngine`
 * （`runRegisteredAgent` 被替身顶掉）——那种测试咬的是**函数**不是**链路**，
 * 分叉守卫一行都不会被走到，本单的病在它眼皮底下恒绿。故本文件一律 `createTestApp()` 真引擎。
 *
 * **本文件的两个读数（对照实验）**
 *   · 钉住后（今日代码）：env 开/关两态，`run.kernel` **都**是 `NATIVE`（逐字节同）。
 *   · 钉住前（字段缺失的原形）：env=1 ⇒ 分叉守卫判真 ⇒ `run.kernel === "EXTERNAL"`。
 *   两读数只差「探针 agent 的 `kernel` 字段有没有」，其余 env / 剧本 / 工具面全同。
 */

const SKILL_KEY = "kernel_probe_skill";
const SKILL_ID = "skl_kernel_probe_v1";
const PROBE_AGENT_ID = `agt_probe_${TENANT}_${SKILL_KEY}`;
const TWIN_AGENT_ID = `agt_probe_twin_${TENANT}_${SKILL_KEY}`;

function auth(): RequestAuth {
  return { tenantId: TENANT, userId: "user-probe", roles: ["catalog_admin"] };
}

function skillFixture(): SkillDefinition {
  return SkillDefinitionSchema.strict().parse({
    id: SKILL_ID,
    tenantId: TENANT,
    version: 1,
    key: SKILL_KEY,
    name: "内核探针测试技能",
    summary: "探针内核接缝测试用技能。",
    body: "## 目的\n测试探针内核。\n## 步骤\n1. 直接作答。",
    resources: [],
    status: "PUBLISHED",
    sideEffect: "READ",
  });
}

function evalCaseFixture(): EvalCase {
  return {
    id: "ec_kernel_probe_1",
    tenantId: TENANT,
    suite: "skill_quality",
    packageId: PKG,
    skillKey: SKILL_KEY,
    input: { query: "这个技能怎么用", context: { view: "dash", selectedObjects: [], filters: {} } },
    // 工具名取自 `SKILL_LOADER_TOOL.native`（不写死字面量）——期望值与声明面同源，
    // 两臂若真名漂移，这里跟着红而不是各自写死一份。
    expect: { toolSequence: [{ name: SKILL_LOADER_TOOL.native }] },
    origin: "MANUAL",
    createdAt: new Date().toISOString(),
  };
}

/** 排好一次「探针挂载技能 → load_skill → final_answer」的剧本。 */
function queueProbeTurns(t: TestApp): void {
  t.llm.queueAgentTurn({ content: [toolUse(SKILL_LOADER_TOOL.native, { skillId: SKILL_ID })] });
  t.llm.queueAgentTurn({
    content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "探针作答。" }], provenance: [] })],
  });
}

/**
 * 真跑一次探针（真 SkillProbeRunner + 真引擎），返回 runner 结果与两个落库读回。
 *
 * ⚠ 本函数**不**读 `repos.agentRuns`：探针走的是 `engine.runRegisteredAgent` **直调**，
 * 而顶层 run 的落库点在编排层（`orchestrator.ts` 的 runPathB / runRolePathB / runSceneAgent，
 * `engine.ts` 那处 `agentRuns.insert` 只覆盖 FANOUT 子 run）——直调绕过了编排层，
 * 故探针这次 run **不落 `agentRuns` 表**（实测 `listByAgent` 读回 0 条）。
 * 「真走了哪条路」改由 `runPersistedAgentOnce` 从引擎**返回的** `result.run.kernel` 读
 * ——那也是 `propose-candidates.ts` 用的同一口径（「读实际发生的，不预测」）。
 */
async function runProbeOnce(t: TestApp) {
  await t.repos.skills.insert(skillFixture());
  await t.repos.evalCases.upsert(evalCaseFixture());
  queueProbeTurns(t);

  const runner = new SkillProbeRunner({ repos: t.repos, engine: t.deps.engine });
  const result = await runner.runSkill(auth(), SKILL_KEY);

  const probeAgent = await t.repos.agents.get(PROBE_AGENT_ID);
  const twinAgent = await t.repos.agents.get(TWIN_AGENT_ID);
  return { result, probeAgent, twinAgent };
}

/**
 * 把**落库读回的那份**探针 agent 原样喂给真引擎，返回 run 与其工具记账。
 * 与 `skill-probe.ts` 的 `runAgent` 同形（同 `engine.runRegisteredAgent` 实参形状、
 * 同 `newId("task")` 先插 task、同 BudgetTracker 缺省），只是把返回的 run 留在本函数里可断言。
 */
async function runPersistedAgentOnce(t: TestApp, agent: AgentDefinition, suffix: string) {
  const taskId = `task_probe_kernel_${suffix}`;
  await t.repos.tasks.insert({
    id: taskId,
    tenantId: TENANT,
    userId: "user-probe",
    packageId: PKG,
    conversationId: taskId,
    query: "这个技能怎么用",
    context: {},
    status: "ROUTING",
    clarificationRounds: 0,
    createdAt: new Date().toISOString(),
  });
  const run = await t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: agent.id,
    version: agent.version,
    prompt: "这个技能怎么用",
    ctx: { tenantId: TENANT, userId: "user-probe", roles: ["catalog_admin"] },
    nesting: { callChain: [], budget: new BudgetTracker({ maxIterations: 8, maxToolCalls: 12 }) },
    emit: async () => {},
  });
  const toolNames = (await t.repos.toolCalls.listByTask(taskId)).map((r) => r.toolName);
  return { loopResult: run, toolNames };
}

/** 引擎级直调（绕过探针封装），用于「字段有无」的 A/B——照 `agent-run-attribution.seam.test.ts` 的 runEngineOnce。 */
async function runEngineOnce(t: TestApp, agentId: string, taskId: string) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId,
    version: "latest",
    prompt: "内核接缝测试",
    ctx: { tenantId: TENANT, userId: "user-probe", roles: ["catalog_admin"] },
    nesting: { callChain: [], budget: new BudgetTracker({ maxIterations: 8 }) },
    emit: async () => {},
  });
}

/**
 * BLOCK 早退臂：`engine.ts` 里那条 `emptyAgentRunRecord(..., kernel 同一表达式)` 落在**分叉之前**，
 * 故 `run.kernel` 会在「不起 dsh 子进程」的前提下如实报出「本会走哪个内核」。
 * 用它做 A/B 的第二个理由：缺 kernel 那一臂若真进分叉就要拉 harness 子进程，
 * 而本单要验的是**守卫的判决**，不是子进程能不能起来。
 */
function blockSkill(): SkillDefinition {
  return {
    id: "skl_kernel_block_probe",
    tenantId: TENANT,
    version: 1,
    key: "kernel_block_probe",
    name: "Kernel Block Probe",
    summary: "探针内核 A/B 用技能。",
    body: "## 目的\n测试。\n## 步骤\n1. 直接作答。",
    references: [{ kind: "rule", key: "KERNEL_PRE_BLOCK", role: "precondition", required: true }],
    resources: [],
    status: "PUBLISHED",
  } as SkillDefinition;
}

/** 与探针 agent 同形（同工具面含 native 加载器名、同挂技能、同 model 空串），只差 kernel 字段。 */
function probeShapedAgent(suffix: string, kernel?: "NATIVE" | "EXTERNAL"): Partial<AgentDefinition> & { id: string; key: string } {
  return {
    id: `agt_probe_shaped_${suffix}`,
    key: `probe_shaped_${suffix}`,
    tenantId: TENANT,
    version: 1,
    name: `ProbeShaped: ${suffix}`,
    description: "探针同形 A/B",
    model: "",
    systemPrompt: "探针内核 A/B。",
    tools: [
      { kind: "BUILTIN", name: "query_objects" },
      { kind: "BUILTIN", name: SKILL_LOADER_TOOL.native },
      { kind: "BUILTIN", name: "final_answer" },
    ],
    ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
    skills: [{ skillId: "skl_kernel_block_probe", version: 1 }],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
    ...(kernel ? { kernel } : {}),
  };
}

/** 真走 skill 规则预检 BLOCK 早退，返回 run；先钉死「真的走了早退」，否则 kernel 断言测的不是那个构造点。 */
async function runBlockedOnce(suffix: string, kernel?: "NATIVE" | "EXTERNAL") {
  const t = await createTestApp();
  await t.repos.skills.insert(blockSkill());
  await t.repos.agents.insert(probeShapedAgent(suffix, kernel) as AgentDefinition);
  vi.spyOn(t.dataCore.rules, "evaluate").mockResolvedValue([
    { ruleId: "KERNEL_PRE_BLOCK", passed: false, severity: "BLOCK", explanation: "预检命中", ruleVersion: 1 },
  ]);
  const result = await runEngineOnce(t, `agt_probe_shaped_${suffix}`, `task_probe_shaped_${suffix}`);
  expect(result.run.iterations.length).toBe(0); // 未真执行任何循环 = 确在分叉前的早退点
  return result;
}

afterEach(() => {
  // env 是进程级的：不清会让同文件后续用例（以及并行 worker 的同进程文件）读到残留值。
  delete process.env.DSH_HARNESS;
});

describe("WO-SKILL-PROBE-KERNEL · 探针内核不得吃 env 兜底", () => {
  it("① DSH_HARNESS=1 下真跑探针：kernel 是具体值 NATIVE，且真走的那条路也是 NATIVE", { timeout: 60_000 }, async () => {
    process.env.DSH_HARNESS = "1"; // 评测进程若开着 POC 全局开关——本用例就是那个环境
    const t = await createTestApp();
    const { result, probeAgent, twinAgent } = await runProbeOnce(t);

    // —— 值校验：字段是**具体值**，不是 undefined（undefined 才会掉进 env 兜底）——
    expect(probeAgent).toBeTruthy();
    expect(probeAgent!.kernel).toBe("NATIVE");
    expect(twinAgent).toBeTruthy();
    expect(twinAgent!.kernel).toBe("NATIVE");

    // —— 探针真的跑到了用例（1 个用例 ⇒ total 1）——
    expect(result.total).toBe(1);

    // —— 判据落在「真的走了哪条路」上：把**落库读回的那份**探针 agent 原样喂回真引擎，
    //    读引擎跑完之后标的 `run.kernel`（出处：`agent/loop.ts` finishRun 回填 "NATIVE"；
    //    dsh 臂由 engine 填 "EXTERNAL"）。env=1 而这里仍是 NATIVE ⇒ 显式钉压过 env 兜底。
    queueProbeTurns(t);
    const { loopResult, toolNames } = await runPersistedAgentOnce(t, probeAgent!, "env1");
    expect(loopResult.run.kernel).toBe("NATIVE");

    // —— 且探针声明的 native 加载器面在那条路上**真的被执行并记账** ——
    // （若被翻到 dsh 臂，真名是 `skill`，这个 native 名不会出现在工具记账里。）
    expect(toolNames).toContain(SKILL_LOADER_TOOL.native);
  });

  it("② 同探针 env 关（缺省休眠）⇒ 逐字节相同（钉住不改变缺省行为）", { timeout: 60_000 }, async () => {
    delete process.env.DSH_HARNESS; // 出货缺省：docker-compose `DSH_HARNESS: ${DSH_HARNESS:-0}`
    const t = await createTestApp();
    const { result, probeAgent, twinAgent } = await runProbeOnce(t);

    expect(probeAgent!.kernel).toBe("NATIVE");
    expect(twinAgent!.kernel).toBe("NATIVE");
    expect(result.total).toBe(1);

    queueProbeTurns(t);
    const { loopResult, toolNames } = await runPersistedAgentOnce(t, probeAgent!, "env0");
    expect(loopResult.run.kernel).toBe("NATIVE");
    expect(toolNames).toContain(SKILL_LOADER_TOOL.native);
  });

  it("③ 对照实验：同 env=1、同工具面，「kernel 字段有无」决定走哪条路（可预言的两读数）", { timeout: 60_000 }, async () => {
    process.env.DSH_HARNESS = "1";
    // 读数 A（钉住前的原形 = 探针今天缺字段时的行为）：字段缺失 ⇒ 分叉守卫判真 ⇒ EXTERNAL。
    const withoutField = await runBlockedOnce("bare");
    expect(withoutField.run.kernel).toBe("EXTERNAL");

    // 读数 B（钉住后 = 本单落地形态）：同 env、同剧本，只多一个 kernel 字段 ⇒ NATIVE。
    const withField = await runBlockedOnce("pinned", "NATIVE");
    expect(withField.run.kernel).toBe("NATIVE");

    // 两读数只差一个字段——这就是「把 X 改成 X'，Y 按可预言方式变化」的那一对。
    expect(withoutField.run.kernel).not.toBe(withField.run.kernel);
  });
});
