import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { fillSlots, solverVocabObjectId, validateSlotValue } from "../src/router/slots.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import type { OntologyClient, ToolAuthCtx } from "../src/tools/clients.js";
import type { IntentDefinition, SessionContext, ToolPayload } from "@platform/contracts";

/**
 * LAUNCHER-SLOT-TRUTH 二轮齿检（词表接缝·G-3·live-Kimi 复验 BLOCK 的两条断点）：
 *
 * (a) CJK 标签无键解析：「合肥」只在 props.name（二级键 hefei）——datacore getObject 只认
 *     存储 id / 主键值 → 裸串 CJK 名全类型 miss → 此前落域外澄清（唯一 score-1 候选也不自动绑）。
 *     FIX-②：跨类型 name 精确匹配（objects/query 服务端过滤）·**全局唯一**命中才自动绑定；
 *     多命中/零命中仍澄清（不猜）。
 *
 * (b) objectRef 规范化压错键：回填/选候选后规范化取 data.objectId=obj_base_hefei（datacore 序列化
 *     不一致：Base 载荷带 objectId·Model 不带）→ 模板 {{slots.base.objectId}} 压长 id 入求解器 →
 *     affected_orders 词表只认 props.baseId=hefei → 400 unknown base → FAILED。
 *     FIX-①：规范化即存**求解器词表键（props 主键）**（solverVocabObjectId），两种载荷形态都对。
 *
 * 本文件的 ontology 替身**复刻真 datacore 语义与载荷形状**（getObject 只认 id/主键·不认 name；
 * Base 载荷带顶层 objectId·Model 不带；queryObjects data 为数组 [{id,type,props}]），
 * 求解器替身**词表严格**（只认 props 主键·否则抛 unknown base = live 400 形态）→ revert 任一 FIX 即红。
 */

// ---------------------------------------------------------------------------
// 真 datacore 形状替身（getObject 语义 = apps/datacore/src/ontology.ts getObject：
// 按存储 id 或 props[pk] 查，绝不按 name；Base 载荷带 objectId（live 实证形态）、Model 不带）
// ---------------------------------------------------------------------------

interface WorldObj {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

const WORLD: Record<string, { pk: string; objectIdInPayload: boolean; rows: WorldObj[] }> = {
  Base: {
    pk: "baseId",
    objectIdInPayload: true, // live 实证：GET Base/hefei → data.objectId=obj_base_hefei
    rows: [
      { id: "obj_base_hefei", type: "Base", props: { baseId: "hefei", name: "合肥", util: 0.81 } },
      { id: "obj_base_changzhou", type: "Base", props: { baseId: "changzhou", name: "常州", util: 0.92 } },
    ],
  },
  Model: {
    pk: "modelId",
    objectIdInPayload: false, // live 实证：GET Model/2170-NCM 无 objectId 字段
    rows: [{ id: "obj_model_2170-NCM", type: "Model", props: { modelId: "2170-NCM", name: "2170 三元" } }],
  },
};

function payloadOf(o: WorldObj, objectIdInPayload: boolean): Record<string, unknown> {
  // 真 datacore GET 形状 {id,type,props}；Base 形态额外带顶层 objectId（datacore 序列化不一致·live 实证）
  return objectIdInPayload
    ? { id: o.id, type: o.type, objectId: o.id, props: o.props }
    : { id: o.id, type: o.type, props: o.props };
}

function realShapedOntology(world: typeof WORLD = WORLD): OntologyClient {
  return {
    async getObject(_ctx, objectType, objectId): Promise<ToolPayload> {
      const t = world[objectType];
      if (!t) throw new Error(`object not found: ${objectType}/${objectId}`);
      // 真语义：先按存储 id，再按 props[pk]。绝不按 name（「合肥」在此必 miss）。
      const found = t.rows.find((o) => o.id === objectId) ?? t.rows.find((o) => o.props[t.pk] === objectId);
      if (!found) throw new Error(`object not found: ${objectType}/${objectId}`);
      return { data: payloadOf(found, t.objectIdInPayload), snapshotVersion: "v1" } as ToolPayload;
    },
    async queryObjects(_ctx, objectType, filter, limit): Promise<ToolPayload> {
      const t = world[objectType];
      const rows = (t?.rows ?? [])
        .filter((o) => Object.entries(filter ?? {}).every(([k, v]) => o.props[k] === v))
        .slice(0, limit ?? 100)
        .map((o) => ({ id: o.id, type: o.type, props: o.props }));
      // 真 datacore queryObjects：data 为数组
      return { data: rows, snapshotVersion: "v1" } as ToolPayload;
    },
    async listObjectTypeKeys(): Promise<string[]> {
      return Object.keys(world);
    },
  } as unknown as OntologyClient;
}

const CTX = { tenantId: "demo", userId: "u", roles: ["planner"] } as ToolAuthCtx;
const affected = () => seedIntentsAndPlans("demo").intents.find((i) => i.key === "affected_orders")!;

async function fillReal(
  intent: IntentDefinition,
  extracted: Record<string, unknown>,
  context: Partial<SessionContext>,
  world: typeof WORLD = WORLD,
) {
  const full: SessionContext = { view: "risk", selectedObjects: [], filters: {}, ...context } as SessionContext;
  return fillSlots(intent, extracted, full, realShapedOntology(world), CTX);
}

describe("FIX-① solverVocabObjectId：规范化存求解器词表键（两种载荷形态都对）", () => {
  it("Base 形态（带顶层 objectId=obj_base_hefei）→ props.baseId=hefei（非长 id）", () => {
    const data = { id: "obj_base_hefei", type: "Base", objectId: "obj_base_hefei", props: { baseId: "hefei", name: "合肥" } };
    expect(solverVocabObjectId(data, "Base", "obj_base_hefei")).toBe("hefei");
  });
  it("Model 形态（无 objectId 字段）→ props.modelId", () => {
    const data = { id: "obj_model_2170-NCM", type: "Model", props: { modelId: "2170-NCM", name: "2170 三元" } };
    expect(solverVocabObjectId(data, "Model", "obj_model_2170-NCM")).toBe("2170-NCM");
  });
  it("非约定主键（Order.so）→ 剥长 id 前缀且后缀命中 prop 值才取（不猜）", () => {
    const data = { id: "obj_order_PO-1001", type: "Order", props: { so: "PO-1001", cust: "客户A" } };
    expect(solverVocabObjectId(data, "Order", "obj_order_PO-1001")).toBe("PO-1001");
    // 后缀不在 props 里（sanitize 变形）→ 不猜，兜底原 id
    const weird = { id: "obj_order_PO_1001", type: "Order", props: { so: "PO-1001" } };
    expect(solverVocabObjectId(weird, "Order", "x")).toBe("obj_order_PO_1001");
  });
  it("mock 扁平行（旧形状 objectId=base_hefei·无 props/主键）→ 兜底原 objectId（零回归）", () => {
    const flat = { objectId: "base_hefei", name: "合肥", util: 0.81 };
    expect(solverVocabObjectId(flat, "Base", "合肥")).toBe("base_hefei");
  });
});

describe("FIX-① 断点复现（b）：回填/选候选 objectRef 规范化（真 datacore 载荷）", () => {
  it("ObjectRef{Base, obj_base_hefei}（候选回填形态）→ 规范化 objectId=hefei（revert→obj_base_hefei→live 400）", async () => {
    const slot = affected().slots.find((s) => s.name === "base")!;
    const r = await validateSlotValue(slot, { objectType: "Base", objectId: "obj_base_hefei", label: "合肥" }, realShapedOntology(), CTX);
    expect(r.ok).toBe(true);
    expect((r.value as { objectId: string }).objectId).toBe("hefei"); // 求解器词表键·非长存储 id
    expect((r.value as { label: string }).label).toBe("合肥"); // props.name 人话标签
  });
  it("ObjectRef{Model, obj_model_2170-NCM}（无 objectId 载荷形态）→ objectId=2170-NCM", async () => {
    const slot = { name: "model", type: "objectRef" as const, required: true };
    const r = await validateSlotValue(slot, { objectType: "Model", objectId: "obj_model_2170-NCM" }, realShapedOntology(), CTX);
    expect(r.ok).toBe(true);
    expect((r.value as { objectId: string }).objectId).toBe("2170-NCM");
  });
  it("裸串主键 hefei（getObject 按 pk 命中）→ objectId 保持 hefei（不被 data.objectId 压成长 id）", async () => {
    const slot = affected().slots.find((s) => s.name === "base")!;
    const r = await validateSlotValue(slot, "hefei", realShapedOntology(), CTX);
    expect(r.ok).toBe(true);
    expect((r.value as { objectId: string }).objectId).toBe("hefei");
  });
});

describe("FIX-② 断点复现（a）：CJK 标签无键解析（唯一精确匹配才自动绑）", () => {
  it("裸串「合肥」（只在 props.name·getObject 必 miss）→ name 精确匹配唯一命中 → 自动绑定 objectId=hefei·免澄清", async () => {
    const r = await fillReal(affected(), { base: "合肥" }, {});
    expect(r.missing).toHaveLength(0); // 免澄清
    expect(r.sources.base).toBe("extracted");
    expect((r.slots.base as { objectId: string }).objectId).toBe("hefei"); // 词表键·非 obj_base_hefei
    expect((r.slots.base as { label: string }).label).toBe("合肥");
    expect(r.outOfDomain).toHaveLength(0);
  });
  it("多类型同名（Base 合肥 + Warehouse 合肥）→ **不**自动绑（不猜）·仍走域外/澄清", async () => {
    const world: typeof WORLD = {
      ...WORLD,
      Warehouse: {
        pk: "whId",
        objectIdInPayload: false,
        rows: [{ id: "obj_warehouse_hf01", type: "Warehouse", props: { whId: "hf01", name: "合肥" } }],
      },
    };
    const r = await fillReal(affected(), { base: "合肥" }, {}, world);
    expect(r.slots.base ?? null).toBeNull(); // 未绑定
    expect(r.missing.map((m) => m.name)).toContain("base"); // required → 澄清
  });
  it("多同名但本轮有 chip → 落 chip 并记 substitution（诚实横幅源·非静默）", async () => {
    const world: typeof WORLD = {
      ...WORLD,
      Warehouse: {
        pk: "whId",
        objectIdInPayload: false,
        rows: [{ id: "obj_warehouse_hf01", type: "Warehouse", props: { whId: "hf01", name: "合肥" } }],
      },
    };
    const chip = { objectType: "Base", objectId: "obj_base_changzhou", label: "常州" };
    const r = await fillReal(affected(), { base: "合肥" }, { selectedObjects: [chip] }, world);
    expect(r.sources.base).toBe("chip");
    expect((r.slots.base as { objectId: string }).objectId).toBe("changzhou"); // chip 也压成词表键
    expect(r.substitutions).toHaveLength(1);
    expect(r.substitutions[0]).toMatchObject({ slotName: "base", attempted: "合肥", usedSource: "chip" });
  });
  it("域外「火星基地」（name 也无精确匹配）→ 仍 outOfDomain（FIX-② 不吞域外信号）", async () => {
    const r = await fillReal(affected(), { base: "火星基地" }, {});
    expect(r.slots.base ?? null).toBeNull();
    expect(r.outOfDomain.some((o) => o.slotName === "base" && o.value === "火星基地")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// e2e（真管线 HTTP·真 datacore 载荷形状·词表严格求解器）：问「合肥」端到端 COMPLETED 且答案含合肥。
// 求解器只认 props.baseId=hefei（否则抛 unknown base = live 400 形态）→
//   revert FIX-① → 求解器收到 obj_base_hefei → FAILED → 红；
//   revert FIX-② → 「合肥」解析不到 → 澄清（非 COMPLETED）→ 红。
// ---------------------------------------------------------------------------

function patchRealSeam(t: TestApp): { solverSeen: unknown[] } {
  const seen: unknown[] = [];
  const real = realShapedOntology();
  const onto = t.dataCore.ontology as unknown as Record<string, unknown>;
  onto.getObject = real.getObject.bind(real);
  onto.queryObjects = real.queryObjects.bind(real);
  onto.listObjectTypeKeys = real.listObjectTypeKeys.bind(real);
  const solver = t.dataCore.solver as unknown as Record<string, unknown>;
  solver.invoke = async (_ctx: unknown, solverKey: string, args: Record<string, unknown>) => {
    if (solverKey !== "affected_orders") throw new Error(`unexpected solver: ${solverKey}`);
    seen.push(args.baseId);
    // 词表严格（= 真 affected_orders resolveBaseId：只认 props.baseId / props.name）：长 id 即 400。
    if (args.baseId !== "hefei") throw new Error(`unknown base: ${String(args.baseId)}`);
    return {
      data: {
        baseId: args.baseId,
        count: 2,
        columns: ["so", "cust", "model", "qty", "due"],
        rows: [
          ["PO-1002", "车企B", "4680-NCM", 800, "2026-08-01"],
          ["PO-1017", "储能C", "2170-NCM", 500, "2026-08-15"],
        ],
        problems: [],
      },
      snapshotVersion: "v1",
    };
  };
  return { solverSeen: seen };
}

describe("e2e 合肥端到端（真 datacore 载荷形状·词表严格求解器·revert→400→红）", () => {
  it("问「合肥」（CJK 名·无 chip）→ 唯一精确匹配自动绑 → 求解器收到 hefei（非 obj_base_hefei）→ COMPLETED·答案含合肥", async () => {
    const t: TestApp = await createTestApp();
    const { solverSeen } = patchRealSeam(t);
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { affected_orders: { base: "合肥" } } as never, // 复刻思维型分类器嵌套形态
    });
    const { taskId } = await submitQuery(t, PLANNER, "合肥基地影响哪些订单？", { view: "risk", selectedObjects: [] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED"); // 免澄清·免 400
    expect(solverSeen).toEqual(["hefei"]); // 求解器真收到词表键
    expect((task.slots?.base as { objectId: string }).objectId).toBe("hefei");
    const text = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(text).toContain("合肥"); // 答案含合肥（④回显 基地=合肥）
    expect(text).toContain("基地=合肥");
    expect(text).not.toContain("基地=常州");
  });

  it("chip=ObjectRef{obj_base_hefei}（候选回填/页面选中长 id 形态）→ 规范化压成 hefei → COMPLETED·答案含合肥", async () => {
    const t: TestApp = await createTestApp();
    const { solverSeen } = patchRealSeam(t);
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const chip = { objectType: "Base", objectId: "obj_base_hefei", label: "合肥" };
    const { taskId } = await submitQuery(t, PLANNER, "这个基地影响哪些订单？", { view: "risk", selectedObjects: [chip] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(solverSeen).toEqual(["hefei"]); // 长 id 已被规范化为词表键（revert→unknown base→FAILED→红）
    const text = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(text).toContain("基地=合肥");
  });
});
