import { describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { isCompoundQuery, validateSolverPlan, buildL2Instruction } from "../src/router/l2-decompose.js";

/**
 * PRD-multi-intent-L2L3 P1 · L2 真分解 SEAM（LLM 产 solver 计划 → 确定性校验 → 共享后半·真接缝驱动）。
 *
 * 头号判据 = SEAM-L2-补漏：novel 措辞问句（不含「产能」字面但问接单可行·② 关键词族漏 + ⑤ 分类候选拆不出）
 * → L2 让 LLM 产计划 → 确定性校验过 → 并行真跑计划内 solver·routeSource=llm-multi-intent·零 agent 往返。
 * 诚实红线：LLM 计划里的**未登记 solver / args 不过 schema 的条目被确定性丢弃**（不硬凑·SEAM-L2/L3-诚实）。
 */

/** Novel 措辞（PRD SEAM-3 原型）：没写"产能"，问"接不接得住" + 顺带问受影响订单——② 关键词族覆盖不到。 */
const NOVEL_Q = "4680-NCM 需求上调两成，六周内接不接得住，另外常州停一周会波及哪些在手订单？";

describe("L2 · 纯函数（R6·确定性校验）", () => {
  it("isCompoundQuery：复合问句命中·简单问句不触发（不多花 LLM 调用）", () => {
    expect(isCompoundQuery(NOVEL_Q)).toBe(true);
    expect(isCompoundQuery("常州毛利为什么下滑？")).toBe(false);
  });

  it("validateSolverPlan：合法条目保留·未登记 solver 丢弃·args 不过 schema 丢弃·同 solver 去重·<2 → null·R6 字节一致", () => {
    const plan = JSON.stringify([
      { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 6 }, section: "接单可行性" },
      { solverKey: "affected_orders", args: { baseId: "changzhou" }, section: "受影响订单" },
      { solverKey: "不存在的solver", args: {}, section: "应被丢弃" }, // ① 未登记 → 丢
      { solverKey: "capacity_forecast", args: { modelId: "重复" }, section: "应被去重" }, // ③ 去重
      { solverKey: "sop_reschedule", args: {}, section: "缺必填 targetOrderId 应被丢弃" }, // ② schema 不过 → 丢
    ]);
    const a = validateSolverPlan(plan, 4);
    const b = validateSolverPlan(plan, 4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 同文本同结果
    expect(a!.map((e) => e.solverKey)).toEqual(["capacity_forecast", "affected_orders"]);
    // 垃圾输出 → null（fail-open）。
    expect(validateSolverPlan("我觉得应该先分析一下……", 4)).toBeNull();
    expect(validateSolverPlan("[]", 4)).toBeNull();
    // 全被校验丢掉 → null（诚实 gap·不硬凑）。
    expect(validateSolverPlan(JSON.stringify([{ solverKey: "capacity_forecast", args: {} }]), 4)).toBeNull(); // 缺必填 modelId
  });

  it("菜单单一来源：instruction 只列已登记 args schema 的 solver + 标注必填（LLM 只选型·不产数字的硬约束在文）", () => {
    const ins = buildL2Instruction();
    expect(ins).toContain("capacity_forecast");
    expect(ins).toContain("modelId"); // 必填标注
    expect(ins).toContain("绝不产生任何业务数字");
    expect(ins).not.toContain("yield_diagnosis"); // 未登记 args schema 的 solver 不进菜单（fail-safe）
  });
});

describe("L2 · SEAM 端到端（novel 措辞补漏 → 共享后半并行·零 agent 往返）", () => {
  it("SEAM-L2-补漏：novel 问句 ② 漏 ⑤ 拆不出 → LLM 计划过确定性校验 → 并行 capacity_forecast+affected_orders·routeSource=llm-multi-intent", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-l2-decompose"]);
    // 分类器对 novel 措辞给不出 ≥2 高置信候选（out-of-catalog）→ ⑤ 无从拆 → L2 上场。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    // L2 的 LLM 计划（compose 用途·mock 注入·含一条应被丢弃的未登记 solver 证「确定性校验有牙」）。
    t.llm.composeResults = [
      JSON.stringify([
        { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 6 }, section: "接单可行性" },
        { solverKey: "affected_orders", args: { baseId: "changzhou" }, section: "受影响订单" },
        { solverKey: "编造solver", args: { fake: 1 }, section: "应被确定性校验丢弃" },
      ]),
    ];
    const invoked: string[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push(key);
      return orig(ctx, key, args);
    };

    const { taskId } = await submitQuery(t, ADMIN, NOVEL_Q);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.multiIntentPlan?.routeSource).toBe("llm-multi-intent"); // L2 = LLM 来源·诚实不冒充确定性
    expect(invoked).toContain("capacity_forecast");
    expect(invoked).toContain("affected_orders");
    expect(invoked).not.toContain("编造solver"); // 确定性校验丢弃（不硬凑·有牙）
    expect(t.llm.agentRequests.length).toBe(0); // 并行 solver + 确定性装配·零 agent 往返（不落 path-B 盲扫）
    expect(task.path).toBe("WORKFLOW");
    // 计划留痕（selectedIntents 带 LLM 抽出的 args·真值仍全来自 solver）。
    expect(task.multiIntentPlan?.selectedIntents.find((s) => s.solverKey === "capacity_forecast")?.slots).toMatchObject({ modelId: "4680-NCM" });
    await t.app.close();
  });

  it("fail-open：compose 抛错 → L2 静默让路·照落既有 path-B（不阻断）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-l2-decompose"]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    vi.spyOn(t.llm, "compose").mockRejectedValue(new Error("no provider"));
    t.llm.queueAgentTurn(() => ({
      content: [{ type: "tool_use", id: "tu1", name: "final_answer", input: { blocks: [{ type: "text", markdown: "path-B 答案" }], provenance: [] } }],
    }));
    const { taskId } = await submitQuery(t, ADMIN, NOVEL_Q);
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.multiIntentPlan).toBeUndefined(); // L2 未产计划
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 照落 path-B（既有行为）
    await t.app.close();
  });

  it("零回归：flag 默认关 → 同问句同分类照走既有 path-B（L2 分支不存在·compose 未被调）", async () => {
    const t: TestApp = await createTestApp();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const composeSpy = vi.spyOn(t.llm, "compose");
    t.llm.queueAgentTurn(() => ({
      content: [{ type: "tool_use", id: "tu1", name: "final_answer", input: { blocks: [{ type: "text", markdown: "path-B 答案" }], provenance: [] } }],
    }));
    const { taskId } = await submitQuery(t, ADMIN, NOVEL_Q);
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.multiIntentPlan).toBeUndefined();
    expect(composeSpy).not.toHaveBeenCalled(); // L2 的 LLM 调用不存在（"ALL" 降级 → false）
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1);
    await t.app.close();
  });
});
