import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { CAPACITY_FACTOR_BINDINGS, factorBindingByMark } from "@platform/contracts";
import { computeByProcessModel } from "../src/solvers/capacity.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext, SolverParamsShape } from "../src/solvers/types.js";
import type { ObjectInstance } from "../src/domain.js";

// WO-CAPLIVE-1-ATOM · SEAM-GATE（datacore 内·变异反证非重言·treat G-CAPACITY-FACTOR-SHALLOW）：
//   ① 改一个 Process×Model 的 Process.yield_baseline / Material.onHand 原子值 → capacity_forecast.byProcessModel
//      对应格**真变**（红咬） + discoverLevers 反推出该原子因子且**敏感度非零**（数据半 × 引擎半同一原子因子）。
//   ② 改坏因子绑定表（CapacityFactorBinding）→ byProcessModel 逐格派生**跟着变**（证读绑定单源·非写死）。
//   ③ R6：同输入两跑字节一致。

const MODEL = "2170-NCM"; // 多基地可产型号（武汉/厦门/自贡·certByModel 非空）

interface Bpm { baseId: string; base: string; process: string; model: string; material?: string; p50: number; bottleneck: string; bottleneckMark?: string; tightness: number; gap: number; provenance: { objectType: string; objectId: string; prop: string; formula: string } }

async function byProcessModel(t: TestApp, modelId = MODEL): Promise<Bpm[]> {
  const res = await invokeSolver(t, "capacity_forecast", { modelId, granularity: "process-model" });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { byProcessModel?: Bpm[] } }).data.byProcessModel ?? [];
}

async function levers(t: TestApp, args: Record<string, unknown>) {
  const res = await invokeSolver(t, "generic_inference", { mode: "levers", ...args });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { levers: { objectType: string; prop: string; objectId: string; sensitivity: number; factorName: string }[]; count: number } }).data;
}

// ---- 纯函数最小 ctx（corrupt-binding 反证·不经服务·可注入 corrupted bindings） -----------------
function mk(type: string, id: string, props: Record<string, unknown>): ObjectInstance {
  return { id, type, props, origin: { type: "SYNTHETIC" } } as unknown as ObjectInstance;
}
function miniCtx(): SolverContext {
  const params = BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape;
  const bases = [mk("Base", "obj_b1", { baseId: "b1", name: "甲基地", formationCapDaily: 1e9, agingCapDaily: 1e9 })];
  const lines = [mk("Line", "obj_l1", { lineId: "l1", baseId: "b1", name: "线1", utilization: 70, target_yield: 0.97 })];
  const processes = [
    mk("Process", "obj_p1", { processId: "p1", lineId: "l1", baseId: "b1", name: "涂布", kind: "coating", yield: 0.95, yield_baseline: 0.9, shiftHours: 24, shifts: 1, attendance: 1, utilization: 1 }),
    mk("Process", "obj_p2", { processId: "p2", lineId: "l1", baseId: "b1", name: "卷绕", kind: "winding", yield: 0.95, yield_baseline: 0.95, shiftHours: 24, shifts: 1, attendance: 1, utilization: 1 }),
  ];
  const equipment = [
    mk("Equipment", "obj_e1", { equipId: "e1", processId: "p1", lineId: "l1", baseId: "b1", ctSeconds: 1, availFactor: 0.9, oee_current: 0.85 }),
    mk("Equipment", "obj_e2", { equipId: "e2", processId: "p2", lineId: "l1", baseId: "b1", ctSeconds: 1, availFactor: 0.9, oee_current: 0.85 }),
  ];
  const models = [mk("Model", "obj_m1", { modelId: "m1", name: "型号1", chem: "NCM" })];
  const materials = [mk("Material", "obj_mat1", { matId: "mat1", name: "正极", onHand: 200, dailyUse: 100, leadTime: 5, isKeyMaterial: true })];
  const certByModel = new Map([["m1", new Map([["b1", "量产"]])]]);
  return {
    tenantId: "demo", params, bases, lines, processes, equipment, maintPlans: [], models, orders: [], shipments: [],
    segments: [], dataHealth: [], certByModel, materials,
  } as unknown as SolverContext;
}

describe("WO-CAPLIVE-1-ATOM · 产能原子因子深化（byProcessModel + capacity levers·SEAM）", () => {
  it("byProcessModel 出 per-工序×型号-物料 颗粒行（每格真派生·provenance 齐全）；现有 per-base 字段零改", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 默认（无 granularity）→ 无 byProcessModel（向后兼容·per-base 不变）
    const baseRes = await invokeSolver(t, "capacity_forecast", { modelId: MODEL });
    const baseData = (baseRes.json() as { data: Record<string, unknown> }).data;
    expect(Array.isArray(baseData.perBaseRows)).toBe(true);
    expect(baseData.byProcessModel).toBeUndefined();
    // granularity:'process-model' → per-工序×型号 行
    const rows = await byProcessModel(t);
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows.slice(0, 20)) {
      expect(r.process).toBeTruthy();
      expect(r.model).toBe(MODEL);
      expect(typeof r.p50).toBe("number");
      expect(["良率波动", "设备OEE", "物料齐套"]).toContain(r.bottleneck);
      expect(r.provenance.formula).toContain("p50 =");
    }
    // 逐格真下钻：至少两个不同工序 + 不止一种主瓶颈（宽而浅 → 深而真）
    expect(new Set(rows.map((r) => r.process)).size).toBeGreaterThan(3);
    expect(new Set(rows.map((r) => r.bottleneck)).size).toBeGreaterThan(1);
  });

  it("SEAM 红咬①：改一个 Process.yield_baseline → 该格 byProcessModel.p50 真变 + discoverLevers 反推出该 Process.yield_baseline 敏感度非零", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await byProcessModel(t);
    const target = before[0]!; // 任取一格
    // 该格对应的 Process 对象
    const procs = await t.repos.objects.listByType("demo", "Process");
    const proc = procs.find((p) => String(p.props.processId) === target.process)!;
    expect(proc).toBeTruthy();
    const oldY = Number(proc.props.yield_baseline);
    proc.props.yield_baseline = Math.max(0.5, oldY - 0.2); // 显著下调良率基线
    await t.repos.objects.put(proc);

    const after = await byProcessModel(t);
    const afterCell = after.find((r) => r.process === target.process && r.baseId === target.baseId)!;
    expect(afterCell).toBeTruthy();
    // 红咬：该格 p50 真变（良率基线再基下降 → 产能降）
    expect(afterCell.p50).not.toBe(target.p50);
    expect(afterCell.p50).toBeLessThan(target.p50);

    // 引擎半同一原子因子：discoverLevers（grain·该工序·良率波动）反推出 Process.yield_baseline 且敏感度非零
    const lv = await levers(t, { grain: "process-model", modelId: MODEL, processKey: target.process, factors: ["良率波动"] });
    const yl = lv.levers.find((l) => l.objectType === "Process" && l.prop === "yield_baseline" && l.objectId === proc.id);
    expect(yl, "discoverLevers 应反推出该工序 Process.yield_baseline").toBeTruthy();
    expect(Math.abs(yl!.sensitivity)).toBeGreaterThan(0);
  });

  it("SEAM 红咬②：改一个 Material.onHand（层4 ∩ 物料齐套）→ byProcessModel Σp50 真变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await byProcessModel(t);
    const total0 = before.reduce((s, r) => s + r.p50, 0);
    // 取 byProcessModel 绑定的关键物料（provenance 里 objectType=Material 的那个 → material 名）
    const matName = before.find((r) => r.material)?.material;
    expect(matName).toBeTruthy();
    const mats = await t.repos.objects.listByType("demo", "Material");
    const mat = mats.find((m) => String(m.props.name) === matName)!;
    expect(mat).toBeTruthy();
    mat.props.onHand = Math.max(1, Number(mat.props.onHand) * 0.1); // 齐套骤降
    await t.repos.objects.put(mat);

    const after = await byProcessModel(t);
    const total1 = after.reduce((s, r) => s + r.p50, 0);
    expect(total1).not.toBe(total0);
    expect(total1).toBeLessThan(total0); // 物料齐套收紧 → ∩ 产能降
  });

  it("SEAM 红咬③：改坏因子绑定表（⑥ 工序良率落点属性）→ byProcessModel 逐格派生跟着变（证读绑定单源·非写死）", () => {
    const c = miniCtx();
    const correct = computeByProcessModel(c, "m1");
    expect(correct.length).toBe(2);
    // 改坏 ⑥ 绑定（Process.yield_baseline → 不存在的属性）→ 良率基线再基退化 + 良率张力口径变 → 逐格 p50/bottleneck 变
    const corrupted = CAPACITY_FACTOR_BINDINGS.map((b) => (b.mark === "⑥" ? { ...b, prop: "__corrupt_no_such_prop" } : b));
    const broken = computeByProcessModel(c, "m1", corrupted);
    expect(JSON.stringify(broken)).not.toBe(JSON.stringify(correct));
    // 具体：读不到 yield_baseline → 回落到运算良率 → yieldRebase=1 → p50 上抬（对良率<运算良率的工序）
    const p1c = correct.find((r) => r.process === "p1")!;
    const p1b = broken.find((r) => r.process === "p1")!;
    expect(p1b.p50).not.toBe(p1c.p50);
  });

  it("R6 确定性：byProcessModel 同输入两跑字节一致；levers 亦然", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await byProcessModel(t);
    const b = await byProcessModel(t);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const l1 = await levers(t, { grain: "process-model", modelId: MODEL, topK: 6 });
    const l2 = await levers(t, { grain: "process-model", modelId: MODEL, topK: 6 });
    expect(JSON.stringify(l1)).toBe(JSON.stringify(l2));
  });

  it("绑定单源覆盖 20 因子（marks ①–⑳·factorBindingByMark 可查·每格有 object.property 落点）", () => {
    expect(CAPACITY_FACTOR_BINDINGS.length).toBe(20);
    expect(new Set(CAPACITY_FACTOR_BINDINGS.map((b) => b.mark)).size).toBe(20);
    for (const b of CAPACITY_FACTOR_BINDINGS) {
      expect(b.objectType).toBeTruthy();
      expect(b.prop).toBeTruthy();
      expect(factorBindingByMark(b.mark)?.prop).toBe(b.prop);
    }
    // 关键落点：⑥ 工序良率 = Process.yield_baseline · ⑬ 物料齐套 = Material.onHand（SEAM 咬点）
    expect(factorBindingByMark("⑥")).toMatchObject({ objectType: "Process", prop: "yield_baseline" });
    expect(factorBindingByMark("⑬")).toMatchObject({ objectType: "Material", prop: "onHand" });
  });
});
