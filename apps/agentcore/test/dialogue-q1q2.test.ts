import { describe, expect, it } from "vitest";
import type { PageContext, ComposePlan } from "@platform/contracts";
import { resolveCeoRoute, ceoIntentKeyForRoute, isCeoQuestion, isCeoIntentKey } from "../src/router/ceo-route.js";
import { executePlan, coreScalars, type ExecutePlanCtx } from "../src/router/execute-plan.js";
import { createTestApp, submitQuery, waitForTask, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-DIALOGUE-Q1Q2 · 人机对话两 bug 修（数据×引擎接缝驱动·非各半绿）。
 *
 * Q2「信阳基地未来30天有哪些瓶颈」此前返回全部基地：seed ceo_bottleneck slotNames:[] → solverArgs 丢 baseIds →
 *   risk.ts:106 baseIds ?? 全域。修：seed 补 baseIds（json 槽）+ solverArgs {baseIds:"{{slots.baseIds}}"}→真达 solver。
 * Q1「4680-NCM 加 多少需求量 六周就不能接了？」此前空壳：反向阈值问句无对口能力 → 落 forward qty=0 → 空 ⟦ref⟧。
 *   修：ceo-route 新增 capacity_threshold 路由 + seed ceo_capacity_threshold 意图(mode:"threshold") → 真反推余量。
 *
 * SEAM：真 orchestrator 端到端——route 落对口意图 × slot 真填 × args(baseIds/mode) 真达 solver（spy 坐实）。
 * 引擎半（thresholdQty=P90−baselineDemand·bottleneck 限域到信阳）由 datacore/test/capacity-threshold.test.ts 坐实。
 */

const pc = (focus: NonNullable<PageContext["focus"]> = {}, view = "risk"): PageContext => ({
  view,
  focus,
  entities: [],
  selection: [],
  drillPath: [],
  actions: [],
});

/** 包 solver.invoke 记录每次调用（+ 可选覆写返回）——坐实 args 真达求解器（SEAM 命门·非只测路由半）。 */
function spySolver(t: TestApp, override?: (key: string, args: Record<string, unknown>) => unknown) {
  const calls: { key: string; args: Record<string, unknown> }[] = [];
  const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
  t.dataCore.solver.invoke = async (ctx, key, args) => {
    calls.push({ key, args });
    const ov = override?.(key, args);
    if (ov !== undefined) return ov as Awaited<ReturnType<typeof orig>>;
    return orig(ctx, key, args);
  };
  return calls;
}

describe("WO-DIALOGUE-Q1Q2 · 纯函数路由 golden（resolveCeoRoute）", () => {
  it("Q2 信阳瓶颈 → bottleneck_matrix + baseIds:['xinyang']（问句基地名→id·非全域）", () => {
    const q = "信阳基地未来30天有哪些瓶颈";
    expect(isCeoQuestion(q)).toBe(true);
    const route = resolveCeoRoute(q, pc(), "ceo");
    expect(route.route).toBe("bottleneck_matrix");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_bottleneck");
    expect(route.args.baseIds).toEqual(["xinyang"]);
  });

  it("Q1 反向阈值 → capacity_threshold + modelId/weeks（'加 多少 … 就不能接了'）", () => {
    const q = "4680-NCM 加 多少需求量 六周就不能接了？";
    expect(isCeoQuestion(q)).toBe(true);
    const route = resolveCeoRoute(q, pc(), "ceo");
    expect(route.route).toBe("capacity_threshold");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_capacity_threshold");
    expect(route.args.modelId).toBe("4680-NCM");
    expect(route.args.weeks).toBe(6);
    expect(route.usedPageContext).toBe(true);
  });

  it("Q1 其它穿仓措辞也命中（穿仓/加满）", () => {
    expect(resolveCeoRoute("M3P 加多少订单八周就穿仓？", pc(), "ceo").route).toBe("capacity_threshold");
    expect(resolveCeoRoute("4680-LFP 加多少需求量十周加满？", pc(), "ceo").route).toBe("capacity_threshold");
  });

  it("回归：S01 前向「加 20% 六周能不能接」仍 capacity_forecast（非 threshold）+ demandDelta 不变", () => {
    const q = "4680-NCM 加 20% 六周能不能接？";
    const route = resolveCeoRoute(q, pc(), "ceo");
    expect(route.route).toBe("capacity_forecast");
    expect(ceoIntentKeyForRoute(route.route)).toBe("capacity_feasibility");
    expect(route.args.model).toBe("4680-NCM");
    expect(route.args.demandDelta).toBe(0.2);
    expect(route.args.weeks).toBe(6);
    expect(route.args.mode).toBeUndefined();
  });

  it("新意图 key 登记（ceo_capacity_threshold·进候选池门控）", () => {
    expect(isCeoIntentKey("ceo_capacity_threshold")).toBe(true);
  });
});

describe("WO-DIALOGUE-Q1Q2 · SEAM 真 orchestrator 端到端（数据 seed × 引擎路由 两半）", () => {
  it("Q2 信阳瓶颈 → matchedIntent=ceo_bottleneck · slots.baseIds=['xinyang'] · bottleneck_matrix 真收到 baseIds=['xinyang']（限信阳·非全域）", async () => {
    const t = await createTestApp();
    const calls = spySolver(t);
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "信阳基地未来30天有哪些瓶颈", { view: "risk", pageContext: pc() });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toMatch(/^deterministic:ceo-route/);
    expect(task.matchedIntent?.intentKey).toBe("ceo_bottleneck");
    // ★ Q2 命门：json 槽 baseIds 真填 ["xinyang"] 并原样（数组·非串化）达 bottleneck_matrix。
    expect(task.slots?.baseIds).toEqual(["xinyang"]);
    const bm = calls.find((c) => c.key === "bottleneck_matrix");
    expect(bm).toBeTruthy();
    expect(bm!.args.baseIds).toEqual(["xinyang"]); // 限信阳·非全域默认
    await t.app.close();
  });

  it("Q1 反向阈值 → matchedIntent=ceo_capacity_threshold · slots.modelId/weeks · capacity_forecast 真收到 mode='threshold' · 答案含 thresholdQty", async () => {
    const t = await createTestApp();
    // mock 的 capacity_forecast 不识别 mode（out of scope·见 clients.ts）；此处包一层令 mode:'threshold' 返回
    // **真 datacore 同形状**阈值产物（datacore/test 坐实其口径 thresholdQty=P90−baselineDemand），坐实 agentcore 渲染半
    // （summarizeSolverOutput 将 thresholdQty 投成 KPI）——真数值口径由 datacore 半保证，此处证「若 solver 出阈值→答案见得到」。
    const calls = spySolver(t, (key, args) =>
      key === "capacity_forecast" && args.mode === "threshold"
        ? {
            data: {
              mode: "threshold",
              weeks: args.weeks ?? 6,
              p50: 40,
              p90: 37.2,
              baselineDemand: 27.7,
              thresholdQty: 9.5,
              thresholdUnit: "万套",
              mainBottleneck: "化成",
              summary: "未来 6 周产能天花板 P90=37.2 万套，已占 27.7 万套，还能再接约 9.5 万套即穿仓。",
            },
            snapshotVersion: "test",
          }
        : undefined,
    );
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "4680-NCM 加 多少需求量 六周就不能接了？", {
      view: "project-sim",
      pageContext: pc({}, "project-sim"),
    });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toMatch(/^deterministic:ceo-route/);
    expect(task.matchedIntent?.intentKey).toBe("ceo_capacity_threshold");
    expect(task.slots?.modelId).toBe("4680-NCM");
    expect(task.slots?.weeks).toBe(6); // number 槽·非 "6" 字符串（solver num() 需数值）
    // ★ Q1 命门：mode:'threshold' + modelId + weeks 真达 capacity_forecast。
    const cf = calls.find((c) => c.key === "capacity_forecast");
    expect(cf).toBeTruthy();
    expect(cf!.args.mode).toBe("threshold");
    expect(cf!.args.modelId).toBe("4680-NCM");
    expect(cf!.args.weeks).toBe(6);
    // thresholdQty 经渲染半投成可见 KPI（答案不再是空 ⟦ref⟧ 壳）。
    const answerStr = JSON.stringify(task.answer);
    expect(answerStr).toContain("thresholdQty");
    expect(answerStr).toContain("9.5");
    await t.app.close();
  });

  it("回归：S01 前向「加 20% 六周能不能接」→ matchedIntent=capacity_feasibility · capacity_forecast 收 demandDelta 且 mode≠threshold", async () => {
    const t = await createTestApp();
    const calls = spySolver(t);
    const { taskId } = await submitQuery(t, ADMIN, "4680-NCM 加 20% 六周能不能接？", {
      view: "project-sim",
      pageContext: pc({}, "project-sim"),
      selectedObjects: [{ objectType: "Model", objectId: "model_4680_ncm" }],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.matchedIntent?.intentKey).toBe("capacity_feasibility");
    const cf = calls.find((c) => c.key === "capacity_forecast");
    expect(cf).toBeTruthy();
    expect(cf!.args.demandDelta).toBe(0.2);
    expect(cf!.args.mode).not.toBe("threshold"); // 前向不落阈值分支
    await t.app.close();
  });
});

describe("WO-DIALOGUE-Q1Q2 · executePlan 确定性兜底内嵌核心数字（治「未溯源空壳」类）", () => {
  it("coreScalars：抽 top-level 标量（thresholdQty/p90/baselineDemand/mainBottleneck）·跳过数组/对象", () => {
    const rows = coreScalars({
      mode: "threshold",
      p50: 40,
      p90: 37.2,
      baselineDemand: 27.7,
      thresholdQty: 9.5,
      thresholdUnit: "万套",
      mainBottleneck: "化成",
      perBaseRows: [{ base: "信阳" }],
      provenance: { x: 1 },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map.thresholdQty).toBe("9.5");
    expect(map.p90).toBe("37.2");
    expect(map.baselineDemand).toBe("27.7");
    expect(map.mainBottleneck).toBe("化成");
    expect(map.thresholdUnit).toBe("万套");
    expect(rows.some((r) => r.key === "perBaseRows")).toBe(false); // 数组跳过
    expect(rows.some((r) => r.key === "provenance")).toBe(false); // 对象跳过
  });

  it("无 LLM provider → deterministicSynthesis 内嵌可核数字（非空 ⟦ref⟧ 壳）+ usedLlm=false", async () => {
    const plan: ComposePlan = {
      planId: "plan_threshold_test",
      steps: [{ stepId: "s1", solverKey: "capacity_forecast", parallelGroup: 0, args: { mode: "threshold" }, argsFrom: [], reads: [] }],
      synthesizeBlocks: ["阈值"],
    };
    const executor = {
      run: async () => ({
        payload: { data: { mode: "threshold", p90: 37.2, baselineDemand: 27.7, thresholdQty: 9.5, thresholdUnit: "万套", mainBottleneck: "化成" }, snapshotVersion: "v1" },
        outcome: "ok",
        durationMs: 1,
        toolCallId: "tc_test",
        ok: true,
      }),
    } as unknown as ExecutePlanCtx["executor"];
    const llm = {
      compose: async () => {
        throw new Error("no provider");
      },
    } as unknown as ExecutePlanCtx["llm"];

    const res = await executePlan(plan, { executor, llm, model: "m", tenantId: "demo" });
    expect(res.usedLlm).toBe(false);
    const md = (res.answer.blocks[0] as { markdown: string }).markdown;
    // ★ 命门：核心数字内嵌可核（非旧「产物见 ⟦ref:0⟧」空壳）。
    expect(md).toContain("thresholdQty=9.5");
    expect(md).toContain("p90=37.2");
    expect(md).toContain("baselineDemand=27.7");
    expect(md).toContain("mainBottleneck=化成");
    expect(md).toContain("⟦ref:0⟧"); // 每数仍绑步溯源（R13）
    expect(res.answer.unverifiedNumerics).toBe(false); // 确定性兜底诚实标（非 LLM 裸编）
  });
});
