import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnswerBlock, IntentDefinition } from "@platform/contracts";
import { createTestApp, PKG, PLANNER, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";

/**
 * WO-SANDBOX-AS-RENDER-TARGET（S1）· orchestrator 沙盘渲染钩子集成测（真跑 orchestrator·submitQuery→终态）。
 * 覆盖：① shock 时序意图命中 + feature 开 → sandbox_render 答案块（答案先行·归一 SimulationRequest·source=dialogue）；
 *       ② hold 意图 → 诚实 DEFERRED 文本（时序接地建设中·S6·不假跑）；③ feature 关 → 回落既有 Path A（无 sandbox_render·旧路径未删）。
 * 钩子 additive 落 runPathA 顶部·地标锚定（不碰 Dev-1 L1B serve/planner 区）。
 */

const now = "2026-07-11T00:00:00.000Z";
const simIntent = (key: string, examples: string[]): IntentDefinition => ({
  id: `int_${key}`,
  packageId: PKG,
  key,
  version: 1,
  status: "PUBLISHED",
  name: `时序推演·${key}`,
  description: "时序推演意图（渲染进沙盘）",
  examples,
  enabledViews: "*",
  slots: [],
  planId: undefined,
  riskLevel: "COMPUTE",
  owner: "seed",
  createdAt: now,
  updatedAt: now,
});

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  // 直接 seed 两个时序意图（不入 SCENARIO_CATALOG·避开 ontogenesis GOVERNED 门；钩子在 plan 执行前短路）。
  await t.repos.intents.insert(simIntent("sim.shock_whatif", ["常州二线停3周交付缺口多大", "急单挤占推演"]));
  await t.repos.intents.insert(simIntent("sim.hold_whatif", ["成品库存水位保持X未来60天利好利空"]));
});
afterEach(async () => {
  await t.app.close();
});

const blocksOf = (task: { answer?: { blocks: AnswerBlock[] } }): AnswerBlock[] => task.answer?.blocks ?? [];

describe("orchestrator 沙盘渲染钩子 · 五触发归一（对话侧·真跑）", () => {
  it("shock 意图命中 + feature 开 → sandbox_render 答案块（SimulationRequest 逐值·source=dialogue·shock 短程）", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "sim.shock_whatif", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { stateVar: "load", delta: 20, weeks: 3 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "常州二线停3周，交付缺口多大？", {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "常州二线" }],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    const blocks = blocksOf(task);
    const sr = blocks.find((b) => b.type === "sandbox_render");
    expect(sr, "应含 sandbox_render 答案块").toBeTruthy();
    if (sr?.type !== "sandbox_render") return;
    expect(sr.request.source).toBe("dialogue");
    expect(sr.request.targetView).toBe("sim-sandbox");
    expect(sr.request.horizonTicks).toBe(21); // 3周
    expect(sr.request.scope).toEqual({ objectType: "Base", objectIds: ["常州二线"] });
    expect(sr.request.compareBaseline).toBe(false); // MVP shock 短程·不双跑求解器维
    const act = sr.request.scenario[0]!;
    expect(act.kind).toBe("shock");
    if (act.kind === "shock") {
      expect(act.delta).toBe(20);
      expect(act.target.stateVar).toBe("load");
    }
    // 答案先行横幅（text 块在 sandbox_render 之前）
    const textIdx = blocks.findIndex((b) => b.type === "text");
    const srIdx = blocks.findIndex((b) => b.type === "sandbox_render");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeLessThan(srIdx);
  });

  it("hold 意图 → 诚实 DEFERRED 文本（时序接地建设中·S6·绝不假跑·无 sandbox_render 块）", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "sim.hold_whatif", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { stateVar: "inventory", value: 5000, days: 60 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "成品库存水位保持5000，未来60天利好利空？", {
      view: "dash",
      selectedObjects: [{ objectType: "Base", objectId: "常州" }],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    const blocks = blocksOf(task);
    expect(blocks.some((b) => b.type === "sandbox_render")).toBe(false); // 不渲染（诚实）
    const txt = blocks.find((b) => b.type === "text");
    expect(txt?.type === "text" && /时序接地|建设中|S6/.test(txt.markdown)).toBe(true);
  });

  it("回退演练：feature sim.sandbox_render 关 → 回落既有 Path A（无 sandbox_render·旧路径未删 RL9）", async () => {
    t.deps.features.mock.disable(TENANT, "sim.sandbox_render");
    t.llm.queueClassification({
      candidates: [{ intentKey: "sim.shock_whatif", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { stateVar: "load", delta: 20, weeks: 3 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "常州二线停3周，交付缺口多大？", {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "常州二线" }],
    });
    const task = await waitForTask(t, taskId);
    // 关闸 → 钩子不触发 → 落既有 Path A（sim.shock_whatif 无 plan → PLAN_NOT_FOUND 终态 FAILED·诚实回退）；
    // 关键断言：绝无 sandbox_render 块（暗发关=该能力不存在）。
    expect(blocksOf(task).some((b) => b.type === "sandbox_render")).toBe(false);
  });
});
