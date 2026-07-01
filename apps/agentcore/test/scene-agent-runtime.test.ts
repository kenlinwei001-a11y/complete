import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse, text } from "../src/llm/mock.js";
import { seedRegistry, seedSceneEntries } from "../src/mocks/seed.js";

/**
 * WO-AGENT-BREADTH（R16）· C3/C7 runtime 实证：scripted-LLM 驱动真 orchestrator。
 *
 * 诚实拆解（本文件断言的真值来源）：
 *  - **LLM 分类/叙述是 mock**：queueClassification 让开放问句判 OUT_OF_CATALOG（走 runPathB），
 *    queueAgentTurn 脚本化 agent 循环的工具选择与 final_answer 文案。
 *  - **求解器数字/规则裁决/⟦ref:N⟧ 是确定性真值**：agent 循环里真调 invoke_solver(capacity_forecast)
 *    与 evaluate_rules(C03) —— 经 GuardedToolExecutor → MockDataCore 的**确定性** MockSolverClient/
 *    MockRuleEngineClient（prngFor 种子化、规则纯函数），审计入库；final_answer.provenance 引用**真实**
 *    tc_ toolCallId → loop.ts 从审计日志反查出 ProvenanceRef。⟦ref:N⟧ 指向的每个数字/裁决都可溯源。
 *
 * 即：runSceneAgent 真触发（C3 SSE note）+ 真求解器/规则组出带真 ref 的接地答复（C7 实质）。
 */

/** 把 seedSceneEntries + seedRegistry 的场景入口/agent/skill/workflow 灌进测试仓储（helper 默认只种意图/计划）。 */
async function seedSceneRuntime(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const s of skills) await t.repos.skills.insert(s);
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const ag of agents) await t.repos.agents.insert(ag);
  for (const scn of seedSceneEntries()) await t.repos.sceneEntries.upsert(scn);
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await seedSceneRuntime(t);
});

/**
 * plan-generate 视图上一个开放问句 → 分类判 OUT_OF_CATALOG → runPathB 见 scn_plan_generate 配了
 * 已发布 agt_plan_generate → 委派 runSceneAgent。scripted agent 循环：
 *   turn1 invoke_solver(capacity_forecast)  → 真求解器 p50/p90/gapPct（确定性）
 *   turn2 evaluate_rules(C03)               → 真规则裁决 verdict（确定性）
 *   turn3 final_answer 引 2 个真 tc_ id     → ⟦ref:0⟧⟦ref:1⟧ 接地答复
 * 断言 SSE routing.completed.note 以「场景入口模式」开头（证 runSceneAgent·非「进入探索模式」）。
 */
async function runOpenQuestionOnPlanGenerate(): Promise<{ taskId: string }> {
  // 分类落 OUT_OF_CATALOG → runPathB（top=undefined → 回落分支）
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
  // scripted agent 循环：真调求解器 + 规则，末轮引真 tc_ id 组接地答复
  t.llm.queueAgentTurn(
    { content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 } })] },
    { content: [toolUse("evaluate_rules", { ruleIds: ["C03"], payload: { demandDelta: 0.2 } })] },
    (req) => {
      // 上下文里两条 tool_result 已带真实 tool_call_id="tc_..."（executor 生成、审计入库）。
      const serialized = JSON.stringify(req.messages);
      const ids = [...serialized.matchAll(/tool_call_id=\\"(tc_[A-Za-z0-9]+)\\"/g)].map((m) => m[1]);
      const solverTc = ids[0] as string; // turn1 invoke_solver
      const ruleTc = ids[1] as string; // turn2 evaluate_rules
      return {
        content: [
          toolUse("final_answer", {
            blocks: [
              {
                type: "text",
                markdown:
                  "保毛利优先：4680-NCM +20% 六周 P50 产能见溯源 ⟦ref:0⟧；" +
                  "需求增量合规裁决见 ⟦ref:1⟧。据此给出管理动作。",
              },
            ],
            provenance: [
              { toolCallId: solverTc, outputPath: "$.data.p50" },
              { toolCallId: ruleTc, outputPath: "$.0.explanation" },
            ],
          }),
        ],
      };
    },
  );
  const { taskId, statusCode } = await submitQuery(t, PLANNER, "保毛利和保规模到底怎么选，给我管理动作", {
    view: "plan-generate",
    selectedObjects: [],
  });
  expect(statusCode).toBe(202);
  return { taskId };
}

describe("C3 · 场景 agent 回落的 SSE routing.completed note（runSceneAgent 真触发）", () => {
  it("plan-generate 开放问句 → path=AGENT · note 以「场景入口模式」开头（非「进入探索模式」）", async () => {
    const { taskId } = await runOpenQuestionOnPlanGenerate();
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    // (1) 持久事件流断言（SSE 序列化的同一载荷）
    const events = await t.repos.events.listAfter(taskId, 0);
    const routing = events.find((e) => e.event === "routing.completed");
    expect(routing).toBeDefined();
    const note = (routing?.payload as { path: string; note: string }).note;
    expect((routing?.payload as { path: string }).path).toBe("AGENT");
    // 证 runSceneAgent（orchestrator.ts:837）触发，非通用 path-B 的「进入探索模式」（:703）。
    expect(note.startsWith("场景入口模式")).toBe(true);
    expect(note).not.toContain("进入探索模式");

    // (2) 活取 SSE 线上帧（终态后 replay 持久事件）——证同一 note 真出现在 event-stream 上。
    const sse = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/events`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER) },
    });
    const wire = sse.payload;
    expect(wire).toContain("event: routing.completed");
    expect(wire).toContain("场景入口模式");
    expect(wire).not.toContain("进入探索模式");
  });

  // green→red→green 自证：期望「进入探索模式」应转红（证断言真区分两分支，非恒真）。
  it("[自证·预期红] 若断言期望「进入探索模式」则失败（证 note 确来自 runSceneAgent 分支）", async () => {
    const { taskId } = await runOpenQuestionOnPlanGenerate();
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const events = await t.repos.events.listAfter(taskId, 0);
    const note = (events.find((e) => e.event === "routing.completed")?.payload as { note: string }).note;
    // 反向断言：note 不等于「进入探索模式」——若 runSceneAgent 未触发（走通用 path-B），本断言会红。
    expect(note).not.toBe("进入探索模式");
    expect(note.startsWith("场景入口模式")).toBe(true);
  });
});

describe("C7 · 接地答复实质：确定性求解器数字 + 规则裁决 + 真实 ⟦ref:N⟧", () => {
  it("答复引真 tc_ toolCallId → provenance 溯源到真求解器/规则输出；不含「探索模式」兜底", async () => {
    const { taskId } = await runOpenQuestionOnPlanGenerate();
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const answer = task.answer;
    expect(answer).toBeDefined();

    // 答复文本含 ⟦ref:N⟧ 标注（接地叙述指向溯源条目）
    const textBlock = answer?.blocks.find((b) => b.type === "text");
    expect(textBlock?.type).toBe("text");
    if (textBlock?.type === "text") {
      expect(textBlock.markdown).toContain("⟦ref:0⟧");
      expect(textBlock.markdown).toContain("⟦ref:1⟧");
      // 不是通用探索兜底话术
      expect(textBlock.markdown).not.toContain("探索模式");
    }

    // provenance[0] 溯源真求解器调用（invoke_solver·capacity_forecast），非 LLM 编造。
    const provSolver = answer?.provenance[0];
    expect(provSolver?.toolName).toBe("invoke_solver");
    expect(provSolver?.toolCallId).toMatch(/^tc_/);
    // provenance[1] 溯源真规则裁决调用（evaluate_rules·C03）。
    const provRule = answer?.provenance[1];
    expect(provRule?.toolName).toBe("evaluate_rules");
    expect(provRule?.toolCallId).toMatch(/^tc_/);

    // 审计日志里的求解器输出是**确定性真值**（MockSolverClient·prngFor 种子化），ref 指向它。
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const solverCall = calls.find((c) => c.toolName === "invoke_solver" && c.id === provSolver?.toolCallId);
    expect(solverCall).toBeDefined();
    const solverOut = solverCall?.output as { data: { p50: number; p90: number; gapPct: number; mainBottleneck: string } };
    expect(typeof solverOut.data.p50).toBe("number"); // 真求解器算出的 P50 产能
    expect(typeof solverOut.data.gapPct).toBe("number");
    // 同入参再调一次 → 字节级一致（确定性铁律；证数字非随机/非编造）。
    const again = await t.dataCore.solver.invoke(
      { tenantId: "demo", userId: "user-planner", roles: ["planner"] },
      "capacity_forecast",
      { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    );
    expect((again.data as { p50: number }).p50).toBe(solverOut.data.p50);

    // 规则裁决亦为确定性真值（C03·纯函数），ref 指向它。
    const ruleCall = calls.find((c) => c.toolName === "evaluate_rules" && c.id === provRule?.toolCallId);
    const verdicts = ruleCall?.output as { ruleId: string; passed: boolean; severity: string; explanation: string }[];
    expect(Array.isArray(verdicts)).toBe(true);
    expect(verdicts[0]?.ruleId).toBe("C03");
    expect(typeof verdicts[0]?.passed).toBe("boolean");

    // 该答复来自场景 agent 回落（path=AGENT），非 Path A 工作流。
    expect(task.path).toBe("AGENT");
    // unverifiedNumerics=false：每个带数字的句子都带 ⟦ref⟧（数字红线满足）。
    expect(answer?.unverifiedNumerics).toBe(false);
  });

  // green→red→green 自证：若求解器/规则不进 provenance，或答复退回探索兜底文案，应转红。
  it("[自证·预期红] 若答复不带真求解器 provenance 或含「探索模式」则失败", async () => {
    const { taskId } = await runOpenQuestionOnPlanGenerate();
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const answer = task.answer;
    // 反向断言：provenance 首条必须是真求解器调用（若退回通用兜底则无此 provenance → 红）。
    expect(answer?.provenance[0]?.toolName).toBe("invoke_solver");
    const textBlock = answer?.blocks.find((b) => b.type === "text");
    if (textBlock?.type === "text") {
      expect(textBlock.markdown).not.toContain("进入探索模式");
    }
  });
});

describe("C3/C7 对照 · 无场景 agent 的视图走通用「进入探索模式」（证两分支真区分）", () => {
  it("无 defaultAgentId 的视图上开放问句回落通用 path-B → note=「进入探索模式」", async () => {
    // 该视图无 scene entry（byView 返回 undefined）→ runPathB 走通用 agent 分支（orchestrator.ts:703）。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "通用探索作答。" }], provenance: [] })],
    });
    const { taskId } = await submitQuery(t, PLANNER, "随便问个开放问题", { view: "graph-unconfigured", selectedObjects: [] });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");
    const events = await t.repos.events.listAfter(taskId, 0);
    const note = (events.find((e) => e.event === "routing.completed")?.payload as { note: string }).note;
    expect(note).toBe("进入探索模式"); // 对照组：通用兜底 note，不含「场景入口模式」
    expect(note).not.toContain("场景入口模式");
  });
});

// text import 保留（脚手架惯例：agent 循环脚本可插纯文本轮）；此处不额外使用。
void text;
