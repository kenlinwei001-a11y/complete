import { describe, expect, it, vi, afterEach } from "vitest";
import { SkillDefinitionSchema, type AgentDefinition, type EvalCase, type SkillDefinition } from "@platform/contracts";
import { createTestApp, setKernelRuntime, TENANT, PKG, type TestApp } from "./helpers.js";
import { SkillProbeRunner } from "../src/skill-probe.js";
import { SKILL_LOADER_TOOL } from "../src/engine.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import type { RequestAuth } from "../src/auth.js";

/**
 * WO-SKILL-PROBE-KERNEL → WO-CLOSE-NATIVE-GAPS · SEAM：探针 / twin 的**运行内核**全链。
 *
 * ⚑ 口径变更（2026-10-09「都改掉，不考虑回退」）：原口径守「探针内核不得由**进程 env** 决定」
 *（钉 `kernel: "NATIVE"` 压过 env 兜底）。本单起旧内核入口**整体退役**——`agent.kernel` 不再是
 * 内核选择器（写侧拒 "NATIVE"、存量值不被读）、`DSH_HARNESS` 引擎侧零消费方 ⇒ 探针不再钉字段，
 * 与平台同路。故本文件改守新命题：**探针跑哪条路只跟装配位走，agent 字段（含旧回退取值）翻不动它**。
 *
 * **接缝在哪（三段，任一段漏都必须红）**
 *   探针构造（`skill-probe.ts` 的两个 `desired: AgentDefinition` 字面量，**不写** `kernel`）
 *   × 引擎内核判据（`engine.agentKernelRuntimeMode()`：产品恒 "dsh"；测试装配可 "inprocess"）
 *   × 载荷层工具名（`engine.ts` `SKILL_LOADER_TOOL`，探针侧别名表见 `skill-probe.ts`）。
 *
 * **为什么必须真引擎**：既有 `skill-probe.test.ts` 全程用 `makeFakeEngine`
 * （`runRegisteredAgent` 被替身顶掉）——那种测试咬的是**函数**不是**链路**，
 * 分叉守卫一行都不会被走到，本单的病在它眼皮底下恒绿。故本文件一律 `createTestApp()` 真引擎。
 *
 * **本文件的两个读数（对照实验）**
 *   · 装配位 = "dsh"（产品态）：`run.kernel === "EXTERNAL"`。
 *   · 装配位 = "inprocess"（测试装配）：`run.kernel === "NATIVE"`。
 *   两读数只差装配位一个变量；`agent.kernel` 字段在两条上都塞着旧回退取值 `"NATIVE"` 且**不改变读数**。
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
    // context 形状照 `EvalCase.input.context`（tasks 仓储的 context 是同一套必填面，
    // 传 `{}` 会被 tsc 挡下：TS2739 缺 view/selectedObjects/filters）。
    context: { view: "dash", selectedObjects: [], filters: {} },
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
async function runBlockedOnce(suffix: string, kernel?: "NATIVE" | "EXTERNAL", kernelRuntime?: "dsh" | "inprocess") {
  const t = await createTestApp(kernelRuntime ? { kernelRuntime } : undefined);
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

describe("WO-CLOSE-NATIVE-GAPS · 探针内核随平台（旧内核入口退役：agent 字段不再决定内核）", () => {
  it("① 探针/twin 都不带 kernel 字段，真跑一次探针仍成立（装配位=inprocess ⇒ NATIVE）", { timeout: 60_000 }, async () => {
    delete process.env.DSH_HARNESS;
    const t = await createTestApp();
    const { result, probeAgent, twinAgent } = await runProbeOnce(t);

    // —— 旧口径（WO-SKILL-PROBE-KERNEL）要求这两个字段**显式钉 "NATIVE"**；本单起不写 ——
    expect(probeAgent).toBeTruthy();
    expect(probeAgent!.kernel, "探针不再钉内核字段（旧内核入口已整体退役）").toBeUndefined();
    expect(twinAgent).toBeTruthy();
    expect(twinAgent!.kernel).toBeUndefined();

    // —— 探针真的跑到了用例（1 个用例 ⇒ total 1）——
    expect(result.total).toBe(1);

    // —— 判据落在「真的走了哪条路」上：把落库读回的那份原样喂回真引擎，读 run.kernel ——
    queueProbeTurns(t);
    const { loopResult, toolNames } = await runPersistedAgentOnce(t, probeAgent!, "nofield");
    expect(loopResult.run.kernel, "测试装配（进程内循环）⇒ NATIVE").toBe("NATIVE");
    // 探针声明的加载器面在那条路上真的被执行并记账（进程内装配下真名仍是 native 那个）
    expect(toolNames).toContain(SKILL_LOADER_TOOL.native);
  });

  it("② 反向金丝雀：塞回旧回退开关取值 kernel:\"NATIVE\" ⇒ 读数与前臂**逐字节相同**（字段不改变任何东西）", { timeout: 60_000 }, async () => {
    delete process.env.DSH_HARNESS;
    const t = await createTestApp();
    const { probeAgent } = await runProbeOnce(t);

    // 模拟「存量记录里还留着旧回退开关的值」——旧口径下这一行会让本 run 落 native，
    // 新口径下它**一个字节都不被读**（写侧已拒新写入；存量值不再被引擎读）。
    const pinned = { ...probeAgent!, kernel: "NATIVE" as const };
    queueProbeTurns(t);
    const { loopResult, toolNames } = await runPersistedAgentOnce(t, pinned, "pinned");
    expect(loopResult.run.kernel).toBe("NATIVE"); // 与 ① 同读数 ⇒ 字段是惰性的（无第二变量）
    expect(toolNames).toContain(SKILL_LOADER_TOOL.native);
  });

  it("③ 对照实验：字段恒塞 NATIVE（试图钉回），只翻**装配位** ⇒ 两读数按可预言方式变化", { timeout: 60_000 }, async () => {
    // 读数 A：装配位 = DSH（产品态）—— BLOCK 早退在分叉之前，标值不起子进程即可读。
    const dsh = await runBlockedOnce("dsh", "NATIVE", "dsh");
    expect(dsh.run.kernel).toBe("EXTERNAL");

    // 读数 B：装配位 = 进程内循环（测试装配）—— 同字段、同剧本，只差装配位。
    const inproc = await runBlockedOnce("inproc", "NATIVE", "inprocess");
    expect(inproc.run.kernel).toBe("NATIVE");

    // 两读数只差装配位一个变量 —— 旧口径下这一对差的是「kernel 字段」，
    // 本单把它翻成「装配位」，而字段恒为 NATIVE 不动（受控变量只有一个）。
    expect(dsh.run.kernel).not.toBe(inproc.run.kernel);
  });
});
