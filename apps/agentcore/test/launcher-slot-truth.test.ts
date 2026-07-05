import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { fillSlots, normalizeExtractedSlots } from "../src/router/slots.js";
import { applyExtractedArgOverrides, buildSlotTruthBlocks } from "../src/router/orchestrator.js";
import { deriveSlotsFromCard, seedIntentsAndPlans } from "../src/mocks/seed.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import type { ExecutionPlan, IntentDefinition, SessionContext } from "@platform/contracts";

/**
 * LAUNCHER-SLOT-TRUTH 齿检（P0·最恶性静默错答·问合肥答常州绿标照发）。
 * ① extractedSlots 形状归一（嵌套→扁平→绑上；不归一→miss→错答·revert 红）；
 * ② 派生意图有可绑定槽（键==slotPresets）+ 求解器入参本轮显式覆盖；
 * ③ 优先级 本轮显式 > 上一轮 chip > preset；
 * ④ 答案回显所用关键实体/参数；
 * ⑤ 无法映射 → 诚实横幅（非静默换题）。
 */

const CZ = { objectType: "Base", objectId: "base_changzhou", label: "常州" };
const affected = () => seedIntentsAndPlans("demo").intents.find((i) => i.key === "affected_orders")!;

// helper：直接跑 fillSlots（用 mock ontology），不经 HTTP。
async function fill(intent: IntentDefinition, extracted: Record<string, unknown>, context: Partial<SessionContext>) {
  const dc = createMockDataCore();
  const ctx = { tenantId: "demo", userId: "u", roles: ["planner"], token: undefined } as never;
  const full: SessionContext = { view: "risk", selectedObjects: [], filters: {}, ...context } as SessionContext;
  return fillSlots(intent, extracted, full, dc.ontology, ctx);
}

describe("① extractedSlots 形状归一（单一真相源）", () => {
  it("按意图键嵌套 {affected_orders:{base:合肥}} → 压扁成 {base:合肥}", () => {
    const flat = normalizeExtractedSlots({ affected_orders: { base: "合肥" } }, affected());
    expect(flat).toEqual({ base: "合肥" });
  });
  it("已扁平 {base:合肥} → 原样（丢弃噪声键）", () => {
    const flat = normalizeExtractedSlots({ base: "合肥", noise: "x" }, affected());
    expect(flat).toEqual({ base: "合肥" });
  });
  it("泛化其他意图键嵌套 {some_intent:{base:合肥}} → 吸收内层槽名", () => {
    const flat = normalizeExtractedSlots({ some_intent: { base: "合肥" } }, affected());
    expect(flat).toEqual({ base: "合肥" });
  });

  it("归一后 fillSlots 绑上合肥；revert（不归一·原样嵌套）→ 全 miss 落 chip 常州（红线复现）", async () => {
    const intent = affected();
    // 归一路径：本轮显式 合肥 胜出（即便 chip=常州）。
    const normalized = normalizeExtractedSlots({ affected_orders: { base: "合肥" } }, intent);
    const good = await fill(intent, normalized, { selectedObjects: [CZ] });
    expect((good.slots.base as { label: string }).label).toBe("合肥");
    expect(good.sources.base).toBe("extracted");

    // revert：把嵌套原样喂进 fillSlots（= 修复前 orchestrator 的行为）→ base miss → 落 chip 常州。
    const bad = await fill(intent, { affected_orders: { base: "合肥" } }, { selectedObjects: [CZ] });
    expect((bad.slots.base as { label: string }).label).toBe("常州");
    expect(bad.sources.base).toBe("chip");
  });
});

describe("③ 优先级 本轮显式 > 上一轮 chip > preset", () => {
  it("本轮显式 合肥 胜过 chip 常州", async () => {
    const r = await fill(affected(), { base: "合肥" }, { selectedObjects: [CZ] });
    expect((r.slots.base as { label: string }).label).toBe("合肥");
    expect(r.sources.base).toBe("extracted");
  });
  it("chip 胜过 preset（本轮未给显式时）", async () => {
    const r = await fill(affected(), {}, { selectedObjects: [CZ], presetSlots: { base: "合肥" } });
    expect((r.slots.base as { label: string }).label).toBe("常州"); // chip 常州 > preset 合肥
    expect(r.sources.base).toBe("chip");
  });
  it("无 chip 时 preset 兜底（点卡零反问）", async () => {
    const r = await fill(affected(), {}, { selectedObjects: [], presetSlots: { base: "合肥" } });
    expect((r.slots.base as { label: string }).label).toBe("合肥");
    expect(r.sources.base).toBe("preset");
  });
});

describe("⑤ 无法映射 → 记 substitution（诚实横幅源·非静默）", () => {
  it("显式给域外实体 火星基地 + chip 常州 → 记 substitution（attempted=火星基地·usedSource=chip）", async () => {
    const r = await fill(affected(), { base: "火星基地" }, { selectedObjects: [CZ] });
    expect((r.slots.base as { label: string }).label).toBe("常州");
    expect(r.substitutions).toHaveLength(1);
    expect(r.substitutions[0]).toMatchObject({ slotName: "base", attempted: "火星基地", usedSource: "chip" });
    expect(r.outOfDomain.length).toBeGreaterThan(0);
  });
});

describe("② 派生意图有可绑定槽 + 求解器入参本轮显式覆盖", () => {
  it("deriveSlotsFromCard：键 == slotPresets 键·非空", () => {
    const s20 = SCENARIO_CATALOG.find((c) => c.sNo === "S20")!; // carbon_q: {modelId, baseName}
    const slots = deriveSlotsFromCard(s20);
    expect(slots.map((s) => s.name).sort()).toEqual(["baseName", "modelId"]);
    expect(slots.every((s) => !s.required)).toBe(true); // 可选·点卡零反问
  });
  it("派生意图（种子）slots 非空且键 == 该卡 slotPresets 键", () => {
    const intents = seedIntentsAndPlans("demo").intents;
    const s14 = SCENARIO_CATALOG.find((c) => c.sNo === "S14")!; // outsourcing_q: {gap, weeks}
    const intent = intents.find((i) => i.key === s14.intentKey)!;
    expect(intent.slots.map((s) => s.name).sort()).toEqual(Object.keys(s14.presetContext.slotPresets).sort());
    expect(intent.slots.length).toBeGreaterThan(0);
  });
  it("applyExtractedArgOverrides：extracted 覆盖烘焙入参；preset/chip 不覆盖", () => {
    const steps: ExecutionPlan["steps"] = [
      { id: "s1", type: "invoke_solver", params: { solverKey: "outsourcing_split", args: { gap: 80000, weeks: 6 } } },
    ];
    // extracted gap=120000 覆盖；weeks 来自 preset → 保留烘焙 6。
    const out = applyExtractedArgOverrides(steps, { gap: 120000, weeks: 8 }, { gap: "extracted", weeks: "preset" });
    const args = (out[0]!.params as { args: Record<string, unknown> }).args;
    expect(args.gap).toBe(120000); // 本轮显式覆盖
    expect(args.weeks).toBe(6); // preset 不覆盖·保留烘焙
    // 不改共享对象
    expect((steps[0]!.params as { args: Record<string, unknown> }).args.gap).toBe(80000);
  });
  it("objectRef 槽覆盖时压成标量 objectId 入求解器", () => {
    const steps: ExecutionPlan["steps"] = [
      { id: "s1", type: "invoke_solver", params: { solverKey: "affected_orders", args: { baseId: "base_changzhou" } } },
    ];
    const out = applyExtractedArgOverrides(
      steps,
      { baseId: { objectType: "Base", objectId: "base_hefei", label: "合肥" } },
      { baseId: "extracted" },
    );
    const args = (out[0]!.params as { args: Record<string, unknown> }).args;
    expect(args.baseId).toBe("base_hefei"); // 标量 objectId，非对象
  });
});

describe("④ 回显块 + ⑤ 横幅块（buildSlotTruthBlocks）", () => {
  it("回显所用实体（基地=合肥）", () => {
    const intent = affected();
    const blocks = buildSlotTruthBlocks(
      intent,
      { base: { objectType: "Base", objectId: "base_hefei", label: "合肥" }, timeWindow: null },
      { sources: { base: "extracted" }, substitutions: [] },
    );
    const text = blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(text).toContain("基地=合肥");
  });
  it("substitution → 顶部诚实横幅（含 attempted + 改用值·非静默）", () => {
    const intent = affected();
    const blocks = buildSlotTruthBlocks(
      intent,
      { base: { objectType: "Base", objectId: "base_changzhou", label: "常州" } },
      { sources: { base: "chip" }, substitutions: [{ slotName: "base", attempted: "火星基地", usedSource: "chip", usedValue: { label: "常州" } }] },
    );
    const text = blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(text).toContain("火星基地");
    expect(text).toContain("未能对应");
    expect(text).toContain("常州");
    // 横幅在回显之前（顶部醒目）
    expect(text.indexOf("未能对应")).toBeLessThan(text.indexOf("本次回答所用参数"));
  });
});

describe("e2e：问合肥答合肥（真管线·嵌套 extractedSlots·chip=常州）", () => {
  it("嵌套 {affected_orders:{base:合肥}} + chip 常州 → 答案关于合肥 + 回显 基地=合肥（非静默常州）", async () => {
    const t: TestApp = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      // 根 A 复现：思维型分类器按意图键嵌套回参。
      extractedSlots: { affected_orders: { base: "合肥" } } as never,
    });
    const { taskId } = await submitQuery(t, PLANNER, "合肥基地影响哪些订单？", { view: "risk", selectedObjects: [CZ] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    // 槽真相：base=合肥（非旧 chip 常州）。
    expect((task.slots?.base as { label: string }).label).toBe("合肥");
    // 答案回显 基地=合肥（④）。
    const text = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(text).toContain("基地=合肥");
    expect(text).not.toContain("基地=常州");
  });

  it("域外 火星基地 + chip 常州 → 诚实横幅（⑤·非静默换题）", async () => {
    const t: TestApp = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { affected_orders: { base: "火星基地" } } as never,
    });
    const { taskId } = await submitQuery(t, PLANNER, "火星基地影响哪些订单？", { view: "risk", selectedObjects: [CZ] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    const text = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(text).toContain("火星基地");
    expect(text).toContain("未能对应");
  });
});
