/**
 * WO-NUMERIC-REDLINE-BLOCK · **分路处置**的引擎级接缝断言（两条路各自的交付出口）。
 *
 * 本文件与 `numeric-redline-parity.seam.test.ts` 分工：
 *   · 那份钉 **dsh 路重组装**层（拒绝判据本身）；
 *   · 本份钉 **engine 交付出口**层——同一份「凭空的数」在两条路上得到**不同处置**，
 *     且两个处置都能被机器读出来（outcome + 屏上原文 + 计数器）。
 *
 * 分路处置（不是一刀切，改动前先读）：
 *   | 路     | 处置                       | 为什么 |
 *   | dsh    | **无条件阻断**             | 新能力·defaultOn:false·不破坏既有流 |
 *   | 原生   | **先只报不断**，只计数     | 无条件阻断会改既有行为·先拿数，收紧是产品裁决 |
 *
 * ⚠ 原生路的断言**故意断言「放行」**：哪天有人顺手把原生路也改成阻断，这里会红。
 *   那是产品裁决不是实现细节 —— 红了要去找仓主，不是改这条测试。
 *
 * LLM 全程 mock（`ScriptedLlmClient`），确定性 R6。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition, ComposePlan } from "@platform/contracts";
import { ADMIN, createTestApp, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { hasUnverifiedNumerics, scanBlocks } from "../src/util/numerics.js";
import { executePlan } from "../src/router/execute-plan.js";
import type { GuardedToolExecutor } from "../src/tools/executor.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { planCoordination, synthesize, type RoleAnswerInput } from "../src/router/coordinator.js";

const planner = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

/** 凭空来的数（无 ⟦ref:N⟧ 溯源指针）——agent 自己编的口径。 */
const FABRICATED = "常州基地 9 月产能缺口 1200 台，建议下调接单量。";
/** 同一结论，但数字挂了溯源指针（平台既有的「已溯源」表达法）。 */
const SOURCED = "根据求解器结果，常州基地 9 月产能缺口 1200 台 ⟦ref:0⟧。建议优先保交付。";
/** 使 `SOURCED` 的 `⟦ref:0⟧` **指得出东西**的那一条 provenance（修后：有标记 ≠ 有出处）。 */
const PROVIDED_1 = [{ toolCallId: "tc_paths_1", outputPath: "$" }];

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "numeric redline path test agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
    ...partial,
  } as AgentDefinition;
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

/** 原生路跑一次：模型直接 final_answer 给定正文。 */
async function runNative(taskId: string, markdown: string, provenance: unknown[] = []) {
  await t.repos.agents.insert(agentDef({ id: `agt_${taskId}`, key: `k_${taskId}` }));
  t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown }], provenance })] });
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: `agt_${taskId}`,
    version: "latest",
    prompt: "常州基地 9 月产能缺口多少",
    ctx: planner,
    nesting: { callChain: [], budget: new BudgetTracker() },
    emit: async () => undefined,
  });
}

const wouldBlock = () => t.metrics.numericRedline.get({ path: "AGENT_NATIVE", action: "would_block" });
const blocked = () => t.metrics.numericRedline.get({ path: "AGENT_DSH", action: "blocked" });

describe("§1 实验 1 · 同一份凭空数字，两条路处置不同", () => {
  it("1.1 原生路：**放行**（outcome ANSWERED·正文原样上屏），但 would_block 计数 +1", async () => {
    // 金丝雀：先证检测器咬得动这句话，否则下面的「计数 +1」不度量任何东西
    expect(hasUnverifiedNumerics(FABRICATED, 0), "金丝雀不中 ⇒ 【检测器坏了】").toBe(true);
    expect(wouldBlock()).toBe(0);

    const r = await runNative("task_native_bad", FABRICATED);

    expect(r.outcome, "原生路本单**刻意不阻断**；此处变红＝有人把产品裁决当实现细节改了").toBe("ANSWERED");
    const md = r.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("1200"); // 编的数确实送达了用户
    expect(r.answer.unverifiedNumerics).toBe(true); // 只打了诚实标
    expect(wouldBlock(), "「若阻断会拦下多少」= 1").toBe(1);
    expect(blocked(), "原生路不该记 dsh 的 blocked 桶").toBe(0);
  });

  it("1.2 计数记在**交付出口**：一次运行至多 +1（不随 final_answer 尝试次数膨胀）", async () => {
    await runNative("task_native_once", FABRICATED);
    expect(wouldBlock()).toBe(1);
  });
});

describe("§2 实验 2 · 反向对照：合法产出必须放行且计数不增", () => {
  it("2.1 原生路：数字全部挂 ⟦ref:0⟧ ⇒ 放行 ∧ unverifiedNumerics=false ∧ would_block 不增", async () => {
    // WO-NUM-FLAG-TRUTH：`⟦ref:0⟧` 要指得出东西，**表里必须有 0 号**（修前这里传空表，
    // 断言 false 靠的是「有标记即豁免」那个谎）。
    expect(hasUnverifiedNumerics(SOURCED, 1), "已溯源的句子若被咬 ⇒ 无差别拦截").toBe(false);

    const r = await runNative("task_native_ok", SOURCED, PROVIDED_1);

    expect(r.outcome).toBe("ANSWERED");
    expect(r.answer.unverifiedNumerics).toBe(false);
    expect(wouldBlock(), "合法产出把计数顶起来 ⇒ 这个数就不再是「该拦多少」").toBe(0);
    expect(blocked()).toBe(0);
  });

  it("2.2 反向对照的**判别力**：同一条路，换成裸数就计数、换回溯源就不计数", async () => {
    await runNative("task_pair_ok", SOURCED, PROVIDED_1);
    expect(wouldBlock()).toBe(0);
    await runNative("task_pair_bad", FABRICATED);
    expect(wouldBlock(), "两个用例结果必须相反，否则这把尺子恒真/恒假").toBe(1);
  });

  it("2.3 ★ 病根对照：同一句 ⟦ref:0⟧，表空 ⇒ 计数 +1（修前此处是 0 = 那个谎）", async () => {
    const r = await runNative("task_pair_dangling", SOURCED, []); // ← 唯一变量：provenance 表空

    expect(r.outcome, "指空不该被拒（降的是处置不是检测）").toBe("ANSWERED");
    expect(
      r.answer.unverifiedNumerics,
      "正文引 0 号而表是空的 ⇒ 1200 台没有任何出处 ⇒ 诚实标必须是 true",
    ).toBe(true);
    expect(wouldBlock(), "指空却没计数 ⇒ 这个数不再度量「该拦多少」").toBe(1);
    expect(hasUnverifiedNumerics(SOURCED, 0), "纯函数侧同判据（与上面同一组实参）").toBe(true);
  });
});

// ===========================================================================
// §3 · WO-NUM-REDLINE-SECOND-IMPL · **组合路径**（executePlan）的数字红线
//
// 这一路曾自写**第二份**判据（`scanUnverified`：把 `⟦…⟧` 一律剥掉，只要还剩数字字符就算
// 「未溯源」），于是同一个判据在仓里有两份实现，改一份不会红。实测（provenance 长 2）：
//   | 输入                                   | 旧实现（自写） | 单源判据 | 差在哪 |
//   | 产能缺口 1200 万套 ⟦ref:0⟧（指得出）   | **true**       | false    | 合法答案被无差别标记 —— 这才是旧实现真实的分叉 |
//   | 产能缺口 1200 万套 ⟦ref:99⟧（指空）    | true           | true     | 一致 |
//   | 产能缺口 1200 万套（无标记）           | true           | true     | 一致 |
// 修法 = **删掉自写那一份**，改调 `util/numerics.ts` 的 `scanBlocks`（与本文件 §1/§2、dsh 路、
// 原生 agent 循环**同一个函数**）。
//
// ⚠ `⟦ref:N⟧` **只**出现在标记里、句内没有别的数字时（如「产能是 ⟦ref:99⟧ 万套」），
//   单源判据判 **false** —— 这是**刻意的**：悬空标记**自身的字符**（`ref:99` 里的 99）不是业务数字，
//   「指空」这件事由另一条判据管（`agent/reflect.ts` 的 `refsWithinRange` → 屏上自披露块）。
//   同一条规则在 `numeric-redline-parity.seam.test.ts` 里早有断言（「详见 ⟦ref:9⟧。」→ false）。
// ===========================================================================

/** 两步组合计划（`provenance` 逐位对齐 plan.steps ⇒ 表长 2）。 */
const PLAN_2STEP = {
  planId: "plan_num_redline_2step",
  synthesizeBlocks: ["根因"],
  steps: [
    { stepId: "s1", solverKey: "capacity_forecast", args: {}, parallelGroup: 0, argsFrom: [], reads: [] },
    { stepId: "s2", solverKey: "mrp_netting", args: {}, parallelGroup: 0, argsFrom: [], reads: [] },
  ],
} as unknown as ComposePlan;

/** 只回一个 OK 产物（本组断言只看综合文本如何被判，不看求解器）。 */
const stubExecutor = {
  run: async () => ({ ok: true, payload: { data: { v: 1 } }, toolCallId: "tc_num", outcome: "OK", durationMs: 1 }),
} as unknown as GuardedToolExecutor;

/** 真过 `executePlan`：LLM 综合返回给定正文 → 读它打到交付面上的 `unverifiedNumerics`。 */
async function composeRedFlag(markdown: string): Promise<boolean> {
  const t = await createTestApp();
  t.llm.composeResults.push(markdown);
  const r = await executePlan(PLAN_2STEP, {
    executor: stubExecutor,
    llm: t.llm,
    model: "m",
    tenantId: TENANT,
    emit: async () => undefined,
  });
  await t.app.close();
  return r.answer.unverifiedNumerics ?? false;
}

describe("§3 组合路径 · 交付出口的判据与单源同口径（不再有第二份实现）", () => {
  it("3.1 金丝雀：检测器两侧都中（表长 2）", () => {
    expect(hasUnverifiedNumerics("产能缺口 1200 万套", 2), "裸数不咬 ⇒ 检测器坏了").toBe(true);
    expect(hasUnverifiedNumerics("产能缺口 1200 万套 ⟦ref:0⟧", 2), "已溯源被咬 ⇒ 无差别标记").toBe(false);
  });

  it("3.2 ★ 真分叉点：`⟦ref:N⟧` 指得出东西 ⇒ 不再被误标（修前此处是 true）", async () => {
    // 同一个业务数字，**唯一变量**是它后面那个指针指不指得出东西。
    expect(await composeRedFlag("产能缺口 1200 万套 ⟦ref:0⟧"), "指得出出处却被标未溯源 ⇒ 合法答案被误杀").toBe(false);
    expect(await composeRedFlag("产能缺口 1200 万套 ⟦ref:99⟧"), "越界指空 ⇒ 1200 万套没有出处 ⇒ 必须咬").toBe(true);
    expect(await composeRedFlag("产能缺口 1200 万套"), "裸数 ⇒ 必须咬").toBe(true);
    // 反向金丝雀（缺这一半，上面那些 false 可能只是判据被改瞎了）：同一句纯文字无数字 ⇒ 不许咬
    expect(await composeRedFlag("建议优先保交付"), "无业务数字却报未溯源 ⇒ 判据变瞎").toBe(false);
  });

  it("3.3 与单源判据**逐条同结论**（含「标记自身不是业务数字」这一条）", async () => {
    const cases = [
      "产能是 ⟦ref:99⟧ 万套", // 指空，但句内除标记外无数字
      "产能是 ⟦ref:0⟧ 万套",
      "产能是 ⟦ref:abc⟧ 万套", // 形态不合 = 指不出
      "建议优先保交付",
      "产能缺口 1200 万套 ⟦ref:99⟧",
      "产能缺口 1200 万套 ⟦ref:0⟧",
      "产能缺口 1200 万套",
    ];
    for (const c of cases) {
      expect(await composeRedFlag(c), `executePlan 与单源判据对「${c}」结论不同 ⇒ 又是两份判据`).toBe(
        hasUnverifiedNumerics(c, 2),
      );
    }
    // 单源那一侧的定值（上表逐条原始读数；防「两边一起漂」也算同口径）
    expect([
      hasUnverifiedNumerics("产能是 ⟦ref:99⟧ 万套", 2),
      hasUnverifiedNumerics("产能是 ⟦ref:0⟧ 万套", 2),
      hasUnverifiedNumerics("产能是 ⟦ref:abc⟧ 万套", 2),
      hasUnverifiedNumerics("建议优先保交付", 2),
      hasUnverifiedNumerics("产能缺口 1200 万套 ⟦ref:99⟧", 2),
      hasUnverifiedNumerics("产能缺口 1200 万套 ⟦ref:0⟧", 2),
      hasUnverifiedNumerics("产能缺口 1200 万套", 2),
    ]).toEqual([false, false, false, false, true, false, true]);
  });
});

// ===========================================================================
// §4 · WO-NUM-REDLINE-SECOND-IMPL · **Coordinator 路**的交付出口
//
// 病灶：`synthesize()` 的返回里 `unverifiedNumerics: false` 是**写死的**，而它组的那几块里嵌的是
//   各角色 agent（**走 LLM**）的产出文本，**逐字上屏**（无过滤、无模板加工）；本答案的 `provenance`
//   又恒为 `[]`（角色的取证留在各自那次运行的审计里，本函数不并表、不重编号）。
// 实测（引擎级真跑 · 角色答含「物料缺口 1200 台」与角色自己的 `⟦ref:0⟧`）：修前 `flag=false`
//   而块里 `1200` 与 `⟦ref:0⟧` 都在 ⇒ 交付面上「有数字、且指针指不出任何东西」，却被标成「已注明出处」。
// 修法 = **据实**拿角色答那几块过单源判据（表长 0 ⇒ 角色答里的指针在本答案里指空）。
// ⚠ 首尾两块是**本函数确定性模板**（我们自己写的字），其中的数字是角色计数不是业务数字；
//   把它算进扫描面会让每个 Coordinator 答案**恒真**（实测：仅脚手架那句即触发）⇒ 诚实标退化成零信息。
// ===========================================================================

function roleAnswer(role: RoleAnswerInput["role"], answerText: string): RoleAnswerInput {
  return {
    role,
    agentId: `agt_${role}`,
    subQuestion: "物料齐套与供应保障",
    answerText,
    scope: { allBases: true, baseIds: [] },
    objectTypes: ["Material"],
  };
}

describe("§4 Coordinator 路 · 交付出口的数字红线据实判定", () => {
  const plan = planCoordination("常州这批订单的交付风险怎么解", undefined, [])!;

  it("4.1 角色答含裸数 ⇒ true；零业务数字 ⇒ false（双向咬住，防恒真）", () => {
    const bad = synthesize(plan, [
      roleAnswer("supply-chain", "物料缺口 1200 台，正极粉短缺。"),
      roleAnswer("production", "产能可承接 ⟦ref:0⟧，无瓶颈。"), // 指空（本答案表为空）
    ]);
    expect(bad.unverifiedNumerics, "角色答里的裸数进了交付面却报「已注明出处」").toBe(true);

    const clean = synthesize(plan, [
      roleAnswer("supply-chain", "物料存在缺口，正极粉短缺。"),
      roleAnswer("production", "产能可承接，无瓶颈。"),
    ]);
    expect(
      clean.unverifiedNumerics,
      "零业务数字却报警 ⇒ 判据变瞎（也说明脚手架的角色计数没把这一路顶成恒真）",
    ).toBe(false);
    // 同一对实参在单源判据上必须同结论（角色答那几块 · 表长 0）
    const roleBlocks = bad.blocks.filter((b) => b.type === "text" && b.markdown.includes("agent（"));
    expect(scanBlocks(roleBlocks, bad.provenance.length)).toBe(true);
    expect(scanBlocks(clean.blocks.filter((b) => b.type === "text" && b.markdown.includes("agent（")), clean.provenance.length)).toBe(
      false,
    );
  });

  it("4.2 ★ 引擎级真跑：交付面上真有「指不出出处的数字」时，诚实标必须是 true（修前是 false）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    for (const ag of seedRegistry().agents) if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
    // 分类器域外 ⇒ 合法进入 Coordinator（门序见 coordinator-a2a 的 D1 说明）。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    // 供应链：答里带裸数；生产：答里带一个指向**它自己**那张 provenance 的 ⟦ref:0⟧；质量：零数字。
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料缺口 1200 台，齐套受阻。" }], provenance: [] })],
    }));
    t.llm.queueAgentTurn(() => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "产能可承接 ⟦ref:0⟧，无瓶颈。" }],
          provenance: [{ toolCallId: "tc_child", outputPath: "$" }],
        }),
      ],
    }));
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "良率稳定达标。" }], provenance: [] })],
    }));

    const { taskId } = await submitQuery(t, ADMIN, "常州这批订单的交付风险怎么解", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");

    // 先证**交付面上真有这两样**（否则下面的 true 不度量任何东西）
    expect(md, "角色答没进交付面 ⇒ 本用例不度量本病灶").toContain("1200");
    expect(md, "角色答里的指针没进交付面 ⇒ 本用例不度量「指空」那一半").toContain("⟦ref:0⟧");
    expect(task.answer?.provenance.length, "本答案的 provenance 表为空 ⇒ 上面那个指针指不出东西").toBe(0);
    expect(task.answer?.unverifiedNumerics, "交付面有指不出出处的数字，却报「已注明出处」").toBe(true);
    await t.app.close();
  }, 60_000);
});
