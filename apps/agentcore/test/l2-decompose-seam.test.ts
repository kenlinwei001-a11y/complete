import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { l2DecomposeEnabled } from "../src/router/orchestrator.js";
import { defaultOnKeys, FEATURE_REGISTRY } from "../src/features/registry.js";
import {
  buildSlotBag,
  validateSolverPlan,
  parseSolverPlan,
  KNOWN_SOLVER_KEYS,
} from "../src/router/l2-decompose.js";

/**
 * WO-L2-DECOMPOSE · L2 多意图真分解 SEAM（PRD-multi-intent §5 SEAM-L2·§6 P1）。
 *
 * 病根（实测）：novel 措辞「接不接得住」不含"产能"字面 → ②域族/⑤候选都漏意图 → 落 free-LLM 的**长度门**
 *（q.length≥24）被 `agent:ceo-free-llm` 慢路接走·绕过确定性 solver。**长≠开放**——这题其实高度确定。
 *
 * 头号判据 SEAM-L2-补漏：flag 开 + mock LLM 对 novel 问句返计划含 capacity_forecast → 确定性校验过 →
 * **走 solver 路（runParallelRoutes）·model=llm-l2-decompose ≠ agent:ceo-free-llm**·答案含该域分节 + ⟦ref⟧。
 * SEAM-零回归：flag 关 → 同题**逐字节现行为**（仍走 free-LLM·证不劫持既有默认路径）。
 *
 * R6 命门：buildSlotBag + validateSolverPlan + parseSolverPlan 全纯函数·零 LLM/随机/时钟·同输入字节一致。
 * KILL-MOCK-RED：LLM 只选 solver·**args 一律来自确定性 slotBag**·臆造求解器/缺必填槽的条目确定性丢弃（不硬凑）。
 */

/** novel 措辞：不含"产能/涂布/良率"字面（②漏）·长度≥24（落 free-LLM 长度门）·上下文丰富（focus.base）·却高度确定（有型号 token）。 */
const NOVEL_Q = "常州和宜宾两个基地一起，接不接得住 4680-NCM 这批新增订单？";

function riskPc(): PageContext {
  return { view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } };
}

describe("WO-L2-DECOMPOSE · 暗发门默认关（防回归锁）", () => {
  it("l2DecomposeEnabled('ALL')/空 Set → false（降级态不劫持·仅显式键启用）", () => {
    expect(l2DecomposeEnabled("ALL")).toBe(false);
    expect(l2DecomposeEnabled(new Set<string>())).toBe(false);
    expect(l2DecomposeEnabled(new Set(["qos.multi-intent-l2-decompose"]))).toBe(true);
  });
  it("registry defaultOn:false·defaultOnKeys() 不含（暗发）", () => {
    const def = FEATURE_REGISTRY.find((f) => f.key === "qos.multi-intent-l2-decompose");
    expect(def?.defaultOn).toBe(false);
    expect(defaultOnKeys()).not.toContain("qos.multi-intent-l2-decompose");
  });
});

describe("WO-L2-DECOMPOSE · 纯函数（R6·零 LLM·KILL-MOCK-RED）", () => {
  it("parseSolverPlan：裸 JSON / 代码块围栏 / 非法 / 非数组 / 缺 solverKey → 宽容解析", () => {
    expect(parseSolverPlan('[{"intentKey":"a","solverKey":"capacity_forecast"}]')).toEqual([
      { intentKey: "a", solverKey: "capacity_forecast" },
    ]);
    // 脱代码块围栏
    expect(parseSolverPlan('```json\n[{"solverKey":"lta_gap"}]\n```')).toEqual([{ solverKey: "lta_gap" }]);
    // 前后有杂散文字 → 仍截出首个数组
    expect(parseSolverPlan('计划如下：[{"solverKey":"yield_diagnosis"}] 完毕')).toEqual([{ solverKey: "yield_diagnosis" }]);
    // 缺 solverKey 的条目丢弃
    expect(parseSolverPlan('[{"intentKey":"x"},{"solverKey":"atp_check"}]')).toEqual([{ solverKey: "atp_check" }]);
    // 非法 / 非数组 / 空 → []
    expect(parseSolverPlan("not json")).toEqual([]);
    expect(parseSolverPlan('{"solverKey":"x"}')).toEqual([]);
    expect(parseSolverPlan("")).toEqual([]);
  });

  it("buildSlotBag：确定性抽取 modelId/demandDelta/weeks/base（R6 字节一致·无算数·只抽取）", () => {
    const bag = buildSlotBag("4680-NCM 加20% 六周还能接吗", riskPc());
    expect(bag.modelId).toBe("4680-NCM");
    expect(bag.demandDelta).toBe(0.2);
    expect(bag.weeks).toBe(6);
    expect(bag.base).toBe("常州"); // focus.base
    // R6：同输入字节一致
    expect(JSON.stringify(buildSlotBag("4680-NCM 加20% 六周还能接吗", riskPc()))).toBe(JSON.stringify(bag));
  });

  it("validateSolverPlan（头号护栏）：已注册+必填槽满→过；臆造求解器/重复/缺必填槽→确定性丢弃（诚实 gap）", () => {
    const slotBag = { modelId: "4680-NCM", base: "常州" };
    const { routes, rejected } = validateSolverPlan(
      [
        { intentKey: "产能可行性", solverKey: "capacity_forecast" }, // 过（modelId 抽满）
        { intentKey: "外协补缺", solverKey: "outsourcing_split" }, // 过（无硬必填槽）
        { solverKey: "capacity_forecast" }, // scope 冲突（重复）→ 丢
        { solverKey: "totally_made_up_solver" }, // 未注册 → 丢
      ],
      slotBag,
    );
    expect(routes.map((r) => r.solverKey)).toEqual(["capacity_forecast", "outsourcing_split"]);
    // args 一律来自确定性 slotBag（非 LLM）
    expect(routes[0]!.args.modelId).toBe("4680-NCM");
    // 丢弃留痕（诚实·可审计）
    expect(rejected.map((r) => r.solverKey).sort()).toEqual(["capacity_forecast", "totally_made_up_solver"]);
    // R6：同输入字节一致
    expect(JSON.stringify(validateSolverPlan([{ solverKey: "capacity_forecast" }], slotBag).routes)).toBe(
      JSON.stringify([
        { domain: "capacity_forecast", route: "capacity_forecast", solverKey: "capacity_forecast", args: { modelId: "4680-NCM", base: "常州" }, perDomainScore: 1, requiredArgs: ["modelId"] },
      ]),
    );
  });

  it("validateSolverPlan：capacity_forecast 缺 modelId（slotBag 无型号）→ 必填槽未抽满 → 丢弃（不带缺参跑错答）", () => {
    const { routes, rejected } = validateSolverPlan([{ solverKey: "capacity_forecast" }], { base: "常州" });
    expect(routes.length).toBe(0);
    expect(rejected[0]!.reason).toContain("必填槽未");
  });

  it("KNOWN_SOLVER_KEYS 覆盖金库真名 solver（Q2 依赖链全 5 域·治 LLM 选型的合法集）", () => {
    for (const k of ["yield_diagnosis", "capacity_forecast", "lta_gap", "affected_orders", "outsourcing_split"]) {
      expect(KNOWN_SOLVER_KEYS.has(k)).toBe(true);
    }
    expect(KNOWN_SOLVER_KEYS.has("nonexistent")).toBe(false);
  });
});

describe("WO-L2-DECOMPOSE · 活系统 SEAM（真跑 orchestrator）", () => {
  it("SEAM-L2-补漏（头号）：flag 开 + free-LLM 也开 → novel 问句被 L2 分解接住·model=llm-l2-decompose ≠ agent:ceo-free-llm·agentRequests=0·⟦ref⟧·臆造 solver 被丢", async () => {
    const t: TestApp = await createTestApp();
    // L2 开 + free-LLM 也开（证是"L2 排在 free-LLM 前接住"·非"free-LLM 没开才不进"）。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-l2-decompose", "ceo.free-llm"]);
    // mock LLM 对 novel 问句返一份计划：capacity_forecast（对口·会过）+ 一个臆造 solver（会被确定性校验丢弃·KILL-MOCK-RED）。
    t.llm.composeResults.push(
      JSON.stringify([
        { intentKey: "产能可行性", solverKey: "capacity_forecast" },
        { intentKey: "臆造", solverKey: "totally_made_up_solver" },
      ]),
    );

    const { taskId } = await submitQuery(t, ADMIN, NOVEL_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // 走 solver 路·不被 free-LLM 劫持。
    expect(task.classification?.model).toBe("llm-l2-decompose");
    expect(task.classification?.model).not.toBe("agent:ceo-free-llm");
    expect(task.path).toBe("WORKFLOW");
    expect(t.llm.agentRequests.length).toBe(0); // 零 agent（未落 free-LLM 的 runCeoFreeLLM→agent loop）
    expect(t.llm.classifyRequests.length).toBe(0); // L2 排在 classify 之前（free-LLM 门前）
    expect(t.llm.composeRequests.length).toBeGreaterThanOrEqual(1); // L2 真调了分解 LLM（compose）

    const plan = task.multiIntentPlan!;
    expect(plan.routeSource).toBe("llm-l2-decompose");
    const solvers = plan.selectedIntents.map((s) => s.solverKey);
    expect(solvers).toContain("capacity_forecast"); // ②/⑤ 漏的意图·L2 补上
    expect(solvers).not.toContain("totally_made_up_solver"); // 臆造 solver 被确定性校验丢（KILL-MOCK-RED）

    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("capacity_forecast"); // 该域分节
    expect(md).toContain("⟦ref:0⟧"); // 溯源指针（数字溯到真 invoke_solver）
    await t.app.close();
  });

  it("SEAM-零回归（根治证）：flag 关 + free-LLM 开 → 同题**仍走 free-LLM**（model=agent:ceo-free-llm·path=AGENT·agentRequests≥1）——证不劫持既有默认路径", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]); // L2 关·free-LLM 开
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "两基地综合承接分析（探索模式）。" }], provenance: [] })],
    }));

    const { taskId } = await submitQuery(t, ADMIN, NOVEL_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.classification?.model).toBe("agent:ceo-free-llm"); // 逐字节现行为（free-LLM 长度门）
    expect(task.path).toBe("AGENT");
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 落 free-LLM 的 agent loop（病根慢路）
    expect(task.multiIntentPlan).toBeUndefined(); // 未走多路装配
    expect(t.llm.composeRequests.length).toBe(0); // L2 门关·根本没调分解 LLM（证零回归·不触达 L2）
    await t.app.close();
  });

  it("SEAM-L2-真开放：flag 开但 mock LLM 判无对口 solver（返 []）→ 一条都不过 → 落 free-LLM（不硬凑真开放题）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-l2-decompose", "ceo.free-llm"]);
    t.llm.composeResults.push("[]"); // LLM 诚实：无对口 solver
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "开放题自由推理结论。" }], provenance: [] })],
    }));

    const { taskId } = await submitQuery(t, ADMIN, NOVEL_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(t.llm.composeRequests.length).toBeGreaterThanOrEqual(1); // L2 试过（调了分解 LLM）
    expect(task.classification?.model).toBe("agent:ceo-free-llm"); // 一条都不过 → 落 free-LLM（诚实·不劫持）
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1);
    await t.app.close();
  });
});
