import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET, SkillDefinitionSchema, type AgentDefinition, type Answer, type EvalCase, type SkillDefinition } from "@platform/contracts";
// AgentLoopResult 的出处是 `src/agent/loop.ts`，不是契约包（契约包从来没导出过它）。
// 原来从 "@platform/contracts" 取 ⇒ TS2305，隐式变成 any，`loopResult()` 的返回形状三年没人校验过。
import type { AgentLoopResult } from "../src/agent/loop.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { SkillProbeRunner, extractAnswerText } from "../src/skill-probe.js";
import type { ExecutionEngine } from "../src/engine.js";
import { seedScenarioPackage } from "../src/mocks/seed.js";
import type { RequestAuth } from "../src/auth.js";

const PKG = "pkg_test";
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

function auth(tenantId: string): RequestAuth {
  return { tenantId, userId: "u1", roles: ["catalog_admin"] };
}

/**
 * 出厂即过契约校验（`.strict().parse`），fixture **不许**自造契约里没有的字段/值。
 *
 * 旧写法是「假绿第 6 例」的产地：`as SkillDefinition` 强转 + `capability: "SKILL"` +
 * `sideEffect: "READ_ONLY"` —— 这三项都不在 `SkillDefinitionSchema` 里，生产中任何 skill 都
 * 不可能带上，于是 SP5「写回型追加 create_action_draft」的判定**永远不触发**，而测试自产自销
 * 一个 `"WRITE_BACK"` 照样绿。改用 strict parse 后：写错枚举值 → 抛；多写字段 → 抛。
 */
function skillFixture(overrides: Partial<SkillDefinition> & { key: string; name: string }): SkillDefinition {
  return SkillDefinitionSchema.strict().parse({
    id: overrides.id ?? `skl_${overrides.key}_v1`,
    tenantId: overrides.tenantId ?? TENANT_A,
    version: overrides.version ?? 1,
    // key / name 不在这里重复写：它们在参数类型上就是**必填**，末尾的 `...overrides`
    // 必定覆盖，写在前面纯属死代码（TS2783 点名的就是这个）。
    summary: "summary",
    body: overrides.body ?? "skill body",
    resources: [],
    status: overrides.status ?? "DRAFT",
    sideEffect: overrides.sideEffect ?? "READ",
    ...overrides,
  });
}

function answerFixture(text: string): Answer {
  return { trustLevel: "AGENT_EXPLORATORY", blocks: [{ type: "text", markdown: text }], provenance: [], unverifiedNumerics: false };
}

function loopResult(text: string): AgentLoopResult {
  return {
    outcome: "ANSWERED",
    answer: answerFixture(text),
    // 这个 fixture 原本与 AgentRunRecordSchema（qos.ts:744）**四处对不上**，全是 typecheck
    // 看不见测试文件期间攒下的：
    //   · `iterations: 1`  —— 契约里是 AgentIteration[]，不是计数
    //   · `toolCalls: 0`   —— AgentRunRecord 上没有这个字段（它是 AgentIteration 的）
    //   · `startedAt` / `finishedAt` —— 契约里没有这两个名字（时间字段叫 createdAt）
    //   · 缺 `model` / `budget` / `budgetExhausted` 三个**必填**字段
    run: {
      id: "ar_1",
      taskId: "task_1",
      model: "test-model",
      iterations: [],
      budget: DEFAULT_AGENT_BUDGET,
      budgetExhausted: false,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      tenantId: TENANT_A,
      agentId: "agt_probe",
      agentKey: "probe",
      createdAt: new Date().toISOString(),
    },
    sketch: [],
  };
}

function makeFakeEngine(resultText: string, emit?: (event: string, payload: unknown) => Promise<void>): ExecutionEngine {
  return {
    // opts 显式标注：本对象经 `as unknown as ExecutionEngine` 断言，拿不到上下文类型，
    // 不标注就是隐式 any（TS7006）。
    runRegisteredAgent: async (opts: { taskId: string }) => {
      await emit?.("answer.final", { taskId: opts.taskId });
      await emit?.("step.completed", { taskId: opts.taskId });
      return loopResult(resultText);
    },
  } as unknown as ExecutionEngine;
}

async function setup(resultText = "hello") {
  const repos = createMemoryRepos();
  await repos.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId: TENANT_A });
  const emitCalls: [string, unknown][] = [];
  // 块体而非表达式体：`push` 返回 number，简写箭头会让返回类型变成 Promise<number>，
  // 与形参声明的 Promise<void> 不符（TS2345）。
  const engine = makeFakeEngine(resultText, async (event, payload) => {
    emitCalls.push([event, payload]);
  });
  const runner = new SkillProbeRunner({
    repos,
    engine,
    emit: async (event, payload) => {
      emitCalls.push([event, payload]);
    },
  });
  return { repos, runner, emitCalls, engine };
}

describe("SkillProbeRunner · WO-1 生产化缺陷修复", () => {
  it("SP1 · 探针 agent ID 含 tenantId，多租户同 key 不冲突", async () => {
    const { repos, runner } = await setup();
    const sA = skillFixture({ key: "k", name: "S", tenantId: TENANT_A, id: "skl_k_a" });
    const sB = skillFixture({ key: "k", name: "S", tenantId: TENANT_B, id: "skl_k_b" });
    await repos.skills.insert(sA);
    await repos.skills.insert(sB);

    await runner.runSkill(auth(TENANT_A), "k");
    await runner.runSkill(auth(TENANT_B), "k");

    const a = await repos.agents.get(`agt_probe_${TENANT_A}_k`);
    const b = await repos.agents.get(`agt_probe_${TENANT_B}_k`);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.tenantId).toBe(TENANT_A);
    expect(b!.tenantId).toBe(TENANT_B);
  });

  it("SP2 · skill v2 发布后探针指向 v2", async () => {
    const { repos, runner } = await setup();
    const v1 = skillFixture({ key: "kv", name: "KV", id: "skl_kv_1", version: 1, body: "v1 body" });
    const v2 = skillFixture({ key: "kv", name: "KV", id: "skl_kv_2", version: 2, body: "v2 body" });
    await repos.skills.insert(v1);
    await repos.skills.insert(v2);

    await runner.runSkill(auth(TENANT_A), "kv");
    const agent = await repos.agents.get(`agt_probe_${TENANT_A}_kv`);
    expect(agent!.skills[0]!.skillId).toBe("skl_kv_2");
    expect(agent!.systemPrompt).toContain("v2 body");
  });

  it("SP3 · 显式 skillId 优先，避免测到更新的 DRAFT", async () => {
    const { repos, runner } = await setup();
    const v1 = skillFixture({ key: "ks", name: "KS", id: "skl_ks_1", version: 1, body: "v1" });
    const v2 = skillFixture({ key: "ks", name: "KS", id: "skl_ks_2", version: 2, body: "v2" });
    await repos.skills.insert(v1);
    await repos.skills.insert(v2);

    await runner.runSkill(auth(TENANT_A), "ks", { skillId: "skl_ks_1" });
    const agent = await repos.agents.get(`agt_probe_${TENANT_A}_ks`);
    expect(agent!.skills[0]!.skillId).toBe("skl_ks_1");
  });

  it("SP4 · timeoutMs 生效，engine 挂起时返回 timeout 失败", async () => {
    const repos = createMemoryRepos();
    await repos.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId: TENANT_A });
    const engine = {
      runRegisteredAgent: () => new Promise<AgentLoopResult>(() => {}),
    } as unknown as ExecutionEngine;
    const runner = new SkillProbeRunner({ repos, engine });

    const skill = skillFixture({ key: "to", name: "TO" });
    await repos.skills.insert(skill);
    await repos.evalCases.upsert({
      id: "ec_to_1",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "to",
      input: { query: "q", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: { answerMust: ["x"] },
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    const t0 = Date.now();
    const run = await runner.runSkill(auth(TENANT_A), "to", { timeoutMs: 100 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(run.total).toBe(1);
    expect(run.passed).toBe(0);
    expect(run.results[0]!.failures.some((f) => f.startsWith("probe timeout"))).toBe(true);
  });

  it("SP5 · 词表可达性（假绿第 6 例反证）：判定用的值必须是契约真枚举，生产 skill 才可能带上", () => {
    // 旧测试拿 "WRITE_BACK"/"READ_ONLY" 当输入——那是 CapabilityMeta 拟用词表，`SkillDefinitionSchema`
    // 里根本没有。若判定继续按那套词表写，生产永不触发；下面两条断言正是「不可达」的反证。
    for (const bogus of ["WRITE_BACK", "EXTERNAL_ACTION", "READ_ONLY", "NONE"]) {
      expect(
        () => skillFixture({ key: "x", name: "X", sideEffect: bogus as never }),
        `${bogus} 不在 SkillSideEffect 枚举内，fixture 必须拒收（旧写法用 as 强转绕过 → 假绿）`,
      ).toThrow();
    }
    // 真枚举三值必须都过得去（判定读的就是这套）
    for (const real of ["READ", "COMPUTE", "WRITE"] as const) {
      expect(skillFixture({ key: "x", name: "X", sideEffect: real }).sideEffect).toBe(real);
    }
  });

  it("SP5 · 工具集补全：只读 skill 含通用工具，WRITE 追加 create_action_draft", async () => {
    const { repos, runner } = await setup();
    const ro = skillFixture({ key: "ro", name: "RO", sideEffect: "READ" });
    const wr = skillFixture({ key: "wr", name: "WR", sideEffect: "WRITE" });
    await repos.skills.insert(ro);
    await repos.skills.insert(wr);

    await runner.runSkill(auth(TENANT_A), "ro");
    await runner.runSkill(auth(TENANT_A), "wr");

    const agentRo = await repos.agents.get(`agt_probe_${TENANT_A}_ro`);
    const agentWr = await repos.agents.get(`agt_probe_${TENANT_A}_wr`);
    expect(agentRo!.tools.some((t) => t.kind === "BUILTIN" && t.name === "invoke_solver")).toBe(true);
    // `name` 只在 BUILTIN 变体上有（MCP/WORKFLOW 变体没有这个字段），故先按 kind 收窄 ——
    // 与上一行同一写法。不收窄时 TS2339，且语义上也只有 BUILTIN 工具谈得上叫这个名字。
    expect(agentRo!.tools.some((t) => t.kind === "BUILTIN" && t.name === "create_action_draft")).toBe(false);
    expect(agentWr!.tools.some((t) => t.kind === "BUILTIN" && t.name === "create_action_draft")).toBe(true);
  });

  it("SP6 · twin systemPrompt 与 probe 一致（除 skills 为空）", async () => {
    const { repos, runner } = await setup();
    const skill = skillFixture({ key: "tw", name: "TW", body: "tw body" });
    await repos.skills.insert(skill);

    await runner.runSkill(auth(TENANT_A), "tw");
    const probe = await repos.agents.get(`agt_probe_${TENANT_A}_tw`);
    const twin = await repos.agents.get(`agt_probe_twin_${TENANT_A}_tw`);
    expect(twin!.systemPrompt).toBe(probe!.systemPrompt);
    expect(twin!.skills).toHaveLength(0);
    expect(probe!.skills).toHaveLength(1);
  });

  it("SP7 · engine 异常捕获：单 case 失败不阻断整体", async () => {
    const repos = createMemoryRepos();
    await repos.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId: TENANT_A });
    let calls = 0;
    const engine = {
      runRegisteredAgent: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return loopResult("ok");
      },
    } as unknown as ExecutionEngine;
    const runner = new SkillProbeRunner({ repos, engine });

    const skill = skillFixture({ key: "ex", name: "EX" });
    await repos.skills.insert(skill);
    await repos.evalCases.upsert({
      id: "ec_ex_1",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "ex",
      input: { query: "q1", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: {},
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });
    await repos.evalCases.upsert({
      id: "ec_ex_2",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "ex",
      input: { query: "q2", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: { answerMust: ["ok"] },
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    const run = await runner.runSkill(auth(TENANT_A), "ex");
    expect(run.total).toBe(2);
    expect(run.passed).toBe(1);
    expect(run.passRate).toBe(0.5);
  });

  it("SP8 · emit 透传", async () => {
    const { repos, runner, emitCalls } = await setup();
    const skill = skillFixture({ key: "em", name: "EM" });
    await repos.skills.insert(skill);
    await repos.evalCases.upsert({
      id: "ec_em_1",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "em",
      input: { query: "q", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: {},
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    await runner.runSkill(auth(TENANT_A), "em");
    expect(emitCalls.length).toBeGreaterThan(0);
  });

  it("SP13 · observed.intentKey 透传留痕", async () => {
    const { repos, runner } = await setup();
    const skill = skillFixture({ key: "in", name: "IN" });
    await repos.skills.insert(skill);
    await repos.evalCases.upsert({
      id: "ec_in_1",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "in",
      input: { query: "q", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: {},
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    const run = await runner.runSkill(auth(TENANT_A), "in", { intentKey: "my_intent" });
    expect(run.results[0]!.observed!.intentKey).toBe("my_intent");
  });

  it("behaviorGain · answerMust 为空时失败", async () => {
    const { repos, runner } = await setup();
    const skill = skillFixture({ key: "bg", name: "BG" });
    await repos.skills.insert(skill);
    await repos.evalCases.upsert({
      id: "ec_bg_1",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "bg",
      input: { query: "q", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: { behaviorGain: true },
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    const run = await runner.runSkill(auth(TENANT_A), "bg");
    expect(run.results[0]!.pass!).toBe(false);
    expect(run.results[0]!.failures.some((f) => f.includes("missing answerMust"))).toBe(true);
  });

  it("behaviorGain · 答案必须依赖 skill（twin 不出现）", async () => {
    const repos = createMemoryRepos();
    await repos.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId: TENANT_A });
    let calls = 0;
    const engine = {
      runRegisteredAgent: async (opts: { agentId: string }) => {
        calls++;
        // probe 含答案，twin 不含
        if (opts.agentId.includes("_twin_")) return loopResult("generic answer");
        return loopResult("skill-specific provenance");
      },
    } as unknown as ExecutionEngine;
    const runner = new SkillProbeRunner({ repos, engine });

    const skill = skillFixture({ key: "bg2", name: "BG2" });
    await repos.skills.insert(skill);
    await repos.evalCases.upsert({
      id: "ec_bg2_1",
      tenantId: TENANT_A,
      suite: "skill_quality",
      packageId: PKG,
      skillKey: "bg2",
      input: { query: "q", context: { view: "risk", selectedObjects: [], filters: {} } },
      expect: { behaviorGain: true, answerMust: ["provenance"] },
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    const run = await runner.runSkill(auth(TENANT_A), "bg2");
    expect(run.results[0]!.pass!).toBe(true);
  });
});

describe("extractAnswerText", () => {
  it("拼接多种 block 文本，不含 JSON 结构", () => {
    const answer: Answer = {
      trustLevel: "AGENT_EXPLORATORY",
      blocks: [
        { type: "text", markdown: "hello world" },
        { type: "kpi", label: "营收", value: "100", provId: "p1" },
        { type: "action_draft", draftId: "ad1", actionType: "approve", summary: "draft summary" },
      ],
      provenance: [],
      unverifiedNumerics: false,
    };
    expect(extractAnswerText(answer)).toContain("hello world");
    expect(extractAnswerText(answer)).toContain("营收 100");
    expect(extractAnswerText(answer)).toContain("draft summary");
    expect(extractAnswerText(answer)).not.toContain("[");
  });
});
