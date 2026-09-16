import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import {
  DEMO_DERIVATION_SPECS,
  seedDemoDerivationSpecs,
  recomputeDemoDerivationsAtSeed,
} from "../src/seed-derivation-specs.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot, seedHash01 } from "../src/sim/seed-world.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-SIM-REAL-DATA · **接缝组合门**（验收判据 7）：从派生规格编译 → recompute → 播种世界
 * → `deriveSeedBaseSnapshot` 的 measuredCells，**整条链一起跑**，不是只测 `parseFormula`。
 *
 * ══ 五道臂（WO §6.3，缺一道不算交付）══
 *   臂1 锚定：算出的数 = 独立手算的数（输入从对象层独立取，⛔ 不许从式子中间结果取 = 自证）。
 *   臂2 量纲：算出的数与该量已知真值同量级（差一个数量级 = 退回重写）。
 *   臂3 敏感性：改输入，输出按**可预言方式**变（线性式 ×2 ⇒ ×2，不许「变了就行」）。
 *   臂4 反向：拿掉输入，必须退回且计数精确变（防「写死常数」）。
 *   臂5 变异反证：故意把实现改坏，这条测试必须红。
 *
 * ══ 播种只铺一次（beforeAll），臂 3/4/5 用 dryRun / 独立小世界，⛔ 不污染共享世界 ══
 * 守门员 `sim-order-real-fields` 实测单次播种 ~30–97s，重复铺会把整条门拖垮。
 *
 * ⛔ 判据一律是对照实验（CLAUDE.md 铁律 1.5 判据一）。本文件**不是新增门** ——
 * 它是 WO-SIM-REAL-DATA 验收判据 7 明文要求的「接缝组合测试」（仓主冻结令豁免：
 * 该 WO 本身就是仓主派的，且这条测的是本单交付物自己的链路，非审核方自我维护的度量装置）。
 */

/** 本单 §2 落地的 25 条规格（从 DEMO_DERIVATION_SPECS 现算，⛔ 不写死字面量 —— 写死不度量今天真的登记了谁）。
 *  25 = Customer 1 + A 档 18 + Model.supplyRisk 链核实后升级 1 + A⚠ 档 5（仓主 2026-09-16 ③全批落 5；
 *  orderChurn 无诚实源停笔，理由见规格表段尾）（3 条旧规格 order_value/fgi/ibt 不在内）。 */
const A_TIER = DEMO_DERIVATION_SPECS.filter((s) => s.specKey !== "order_value" && s.specKey !== "fgi_qty_available" && s.specKey !== "ibt_eta_day");

/** 从对象层**独立**取一个数值属性（臂 1 手算的输入，⛔ 不许走式子中间结果）。 */
function propOf(objs: ObjectInstance[], id: string, prop: string): number {
  const o = objs.find((x) => x.id === id);
  const v = o?.props[prop];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`独立取数失败：${id}.${prop} 不是有限数（得 ${String(v)}）`);
  return v;
}

describe("WO-SIM-REAL-DATA · 真业务数进推演世界（SEAM 组合）", () => {
  let t: TestApp;
  let measuredCells = 0;
  let totalCells = 0;
  /** 各类型对象缓存（臂 1 手算输入 + 臂 2 对照真值都从对象层独立取）。 */
  const objsByType = new Map<string, ObjectInstance[]>();
  const objectsOf = async (type: string): Promise<ObjectInstance[]> => {
    if (!objsByType.has(type)) objsByType.set(type, await t.repos.objects.listByType("demo", type));
    return objsByType.get(type)!;
  };

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    // §1：编译规格 → 播种期全量初算（生产 SEED_DEMO=1 的同一条链）。
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);
    // 铺世界读 measuredCells（与 GET /a/v1/sim/sessions 的 baseSnapshotOrigin 同源）。
    const { origin } = await deriveSeedBaseSnapshot(t.repos, "demo");
    measuredCells = origin.measuredCells;
    totalCells = origin.cells;
  }, 180_000);

  // ── ⓒ 接缝驱动（验收判据 7）：编译→recompute→播种→读数 整条通 ─────────────────
  it("ⓒ 接缝驱动：25 条规格编译入库 + 物化后 measuredCells 从 470 涨到 4171（主判据 3,896 过线）", () => {
    // 前态锚点：§1 只带 3 条旧规格时 measuredCells=470（WO 实测基线，含 Customer 那条 20 格）。
    // 20 条 A 档物化 +3,221 ⇒ 3691；A⚠ 5 条（仓主 2026-09-16 ③批）再 +480（Order 150×3 +
    // MaterialBatch 24 + Model 6）⇒ 4171 ≥ 主判据 3,896（+275）。orderChurn 停笔不减格（它从未物化）。
    expect(totalCells).toBe(6363);
    expect(measuredCells).toBe(4171);
  });

  // ── ⓑ 指认粒度（验收判据 ⓑ）：逐条点名物化数，红了能指出是哪一条 ─────────────────
  it("ⓑ 指认粒度：25 条规格逐条物化数 = 该类型进世界对象数（逐条点名，不一锅断言）", async () => {
    // 每条规格的物化数 = 其 targetType 上进世界的对象数（独立数，不从 measuredCells 反推）。
    const expected: Record<string, number> = {};
    for (const s of A_TIER) {
      const n = (await objectsOf(s.targetType)).length;
      expected[s.specKey] = n;
    }
    for (const s of A_TIER) {
      // 逐条断言：物化了 ⇒ 该类型每个对象的 targetProp 都是有限数。
      const objs = await objectsOf(s.targetType);
      const materialized = objs.filter((o) => typeof o.props[s.targetProp] === "number" && Number.isFinite(o.props[s.targetProp])).length;
      expect(
        { key: s.specKey, n: materialized },
        `规格 ${s.specKey} 物化 ${materialized}/${expected[s.specKey]}（红了就指这条）`,
      ).toEqual({ key: s.specKey, n: expected[s.specKey] });
    }
  });

  // ── 臂 1 锚定（抽 5 条代表：自属性 / 单跳聚合 / 链方向易错各覆盖）────────────────
  it("臂1 锚定：Equipment.equipmentFailure = 100 − health_score（独立手算）", async () => {
    const eqs = await objectsOf("Equipment");
    const sample = eqs[0]!;
    const hand = 100 - propOf(eqs, sample.id, "health_score");
    expect(propOf(eqs, sample.id, "equipmentFailure")).toBeCloseTo(hand, 4);
  });

  it("臂1 锚定：Line.utilPressure = utilization 逐字节（同量纲直取）", async () => {
    const lines = await objectsOf("Line");
    const sample = lines[0]!;
    expect(propOf(lines, sample.id, "utilPressure")).toBe(propOf(lines, sample.id, "utilization"));
  });

  it("臂1 锚定：Model.costPressure = unitCost×100÷unitPrice（先乘后除 4 位定点）", async () => {
    const models = await objectsOf("Model");
    const sample = models[0]!;
    const hand = (propOf(models, sample.id, "unitCost") * 100) / propOf(models, sample.id, "unitPrice");
    expect(propOf(models, sample.id, "costPressure")).toBeCloseTo(hand, 4);
  });

  it("臂1 锚定：Process.queuePressure = utilization × 100", async () => {
    const procs = await objectsOf("Process");
    const sample = procs[0]!;
    expect(propOf(procs, sample.id, "queuePressure")).toBeCloseTo(propOf(procs, sample.id, "utilization") * 100, 4);
  });

  it("臂1 锚定：Supplier.deliveryDelay = (1 − onTimeRate) × 100", async () => {
    const sups = await objectsOf("Supplier");
    const sample = sups[0]!;
    expect(propOf(sups, sample.id, "deliveryDelay")).toBeCloseTo((1 - propOf(sups, sample.id, "onTimeRate")) * 100, 4);
  });

  // ── 臂 1 锚定 · A⚠ 档（仓主 ③批 5 条抽 3：ratio 代理 / 恒等直取 / 双字段比率各覆盖）────────
  it("臂1 锚定：Order.shortageRisk = outsourceRatio × 100（A⚠ 仓主批口径代理）", async () => {
    const orders = await objectsOf("Order");
    const sample = orders[0]!;
    expect(propOf(orders, sample.id, "shortageRisk")).toBeCloseTo(propOf(orders, sample.id, "outsourceRatio") * 100, 4);
  });

  it("臂1 锚定：MaterialBatch.procurementDelay = ageDays 逐字节（恒等直取）", async () => {
    const batches = await objectsOf("MaterialBatch");
    const sample = batches[0]!;
    expect(propOf(batches, sample.id, "procurementDelay")).toBe(propOf(batches, sample.id, "ageDays"));
  });

  it("臂1 锚定：Model.demandLoad = orderCount × 100 ÷ capacity（先乘后除 4 位定点）", async () => {
    const models = await objectsOf("Model");
    const sample = models[0]!;
    const hand = (propOf(models, sample.id, "orderCount") * 100) / propOf(models, sample.id, "capacity");
    expect(propOf(models, sample.id, "demandLoad")).toBeCloseTo(hand, 4);
  });

  // ── 臂 2 量纲（验收判据 3：任选 5 条，与已知真值同量级，差一个数量级 = 退回）────────────────
  it("臂2 量纲：5 条抽样全部落在各自业务域内（不越域 = 量纲未错配）", async () => {
    // 量纲判据的硬锚：压力族 ∈ [0,100]，forecastBias ∈ [−100,100]，天数/比率族不越出实测分布。
    // 越域 = 量纲错配的指纹（utilPressure 460 vs 91 那次的教训），⛔ 不许写进注释了事。
    const checks: Array<[string, string, number, number]> = [
      // [type, prop, min, max] —— 上下界取自 STATE_VAR_DOMAINS / 台账实测分布
      ["Equipment", "equipmentFailure", 0, 100],
      ["Line", "utilPressure", 0, 100],
      ["Process", "queuePressure", 0, 100],
      ["Model", "costPressure", 0, 100],
      ["Model", "forecastBias", -100, 100],
      // A⚠ 档 5 条中实测分布入域的 2 条（③批）；costPressure 40–115 / demandLoad 23.6–138
      // 越上界是仓主批的「如实」口径（同 expeditePressure 212 / loadIndex 552 先例），不入本表不是错配。
      ["Order", "demandPressure", 0, 100],
      ["Order", "shortageRisk", 0, 100],
    ];
    for (const [type, prop, lo, hi] of checks) {
      const objs = await objectsOf(type);
      for (const o of objs) {
        const v = o.props[prop];
        if (typeof v !== "number") continue;
        expect(v >= lo && v <= hi, `${type}.${prop}=${v} 越出 [${lo},${hi}] = 量纲错配`).toBe(true);
      }
    }
  });

  // ── ⓐ 引擎归属（验收判据 ⓐ 方式 2 釜底抽薪）：清掉规格 ⇒ 本单值全消失 ─────────────────
  it("ⓐ 引擎归属：derivationSpecs 清成 0 条 ⇒ 25 个 targetProp 全部消失（证明是引擎②算的）", async () => {
    // 独立小世界：不碰共享 t。规格库空 ⇒ §3 校验收窄跳过 ⇒ 这 24 格走哈希（仍 measured），
    // 但**对象 props 上没有 targetProp**（没 recompute 物化）⇒ 釜底抽薪的证明是「属性本身消失」。
    const t2 = await makeApp();
    await seedBattery(t2);
    await seedDemoPropagationRules(t2.repos);
    // ⛔ 不 seedDemoDerivationSpecs ⇒ 规格库 0 条。
    for (const s of A_TIER) {
      const objs = await t2.repos.objects.listByType("demo", s.targetType);
      const withProp = objs.filter((o) => s.targetProp in o.props).length;
      expect(withProp, `清规格后 ${s.specKey} 的 ${s.targetType}.${s.targetProp} 仍有 ${withProp} 对象带值 = 不是引擎②算的`).toBe(0);
    }
  }, 120_000);

  // ── 臂 3 敏感性（dryRun what-if，不污染共享世界）：改输入 ⇒ 输出按预言变 ─────────────────
  it("臂3 敏感性：Customer.receivables ×2 ⇒ receivablePressure 精确 ×2（线性式）", async () => {
    const custs = await objectsOf("Customer");
    const sample = custs.find((c) => typeof c.props.receivables === "number" && typeof c.props.receivablePressure === "number" && c.props.receivablePressure > 0);
    expect(sample, "要一个 receivablePressure>0 的样本做 ×2 对照").toBeTruthy();
    const before = sample!.props.receivablePressure as number;
    const r = sample!.props.receivables as number;
    const res = await t.services.ontologyCore.recompute(
      t.adminCtx,
      [{ typeKey: "Customer", prop: "receivables", objectIds: [sample!.id] }],
      { dryRun: true, apply: [{ objectId: sample!.id, prop: "receivables", value: r * 2 }] },
    );
    const delta = res.dryRunDeltas?.find((d) => d.objId === sample!.id && d.prop === "receivablePressure");
    expect(delta, "dryRun 必须给出 receivablePressure 的 before/after").toBeTruthy();
    // 线性式 receivables×100/creditLimit：receivables ×2 ⇒ 输出精确 ×2（4 位定点内）。
    expect((delta!.after as number) / before).toBeCloseTo(2, 3);
  });

  it("臂3 敏感性：Equipment.health_score ↓10 ⇒ equipmentFailure 精确 ↑10（反向线性）", async () => {
    const eqs = await objectsOf("Equipment");
    const sample = eqs.find((e) => (e.props.health_score as number) >= 20);
    const before = sample!.props.equipmentFailure as number;
    const hs = sample!.props.health_score as number;
    const res = await t.services.ontologyCore.recompute(
      t.adminCtx,
      [{ typeKey: "Equipment", prop: "health_score", objectIds: [sample!.id] }],
      { dryRun: true, apply: [{ objectId: sample!.id, prop: "health_score", value: hs - 10 }] },
    );
    const delta = res.dryRunDeltas?.find((d) => d.objId === sample!.id && d.prop === "equipmentFailure");
    // equipmentFailure = 100 − health_score：hs ↓10 ⇒ failure 精确 ↑10。
    expect((delta!.after as number) - before).toBeCloseTo(10, 4);
  });

  // ── 臂 4 反向（dryRun：拿掉输入 ⇒ 退回 null/0，防写死常数）─────────────────────────
  it("臂4 反向：拿掉 Line.max_capacity_day ⇒ blockedPressure 退回（COALESCE 兜 0，非写死 22.9285）", async () => {
    const lines = await objectsOf("Line");
    const sample = lines.find((l) => (l.props.blockedPressure as number) > 0);
    const res = await t.services.ontologyCore.recompute(
      t.adminCtx,
      [{ typeKey: "Line", prop: "max_capacity_day", objectIds: [sample!.id] }],
      // 拿掉分母（dryRun apply 成 undefined ⇒ div-zero ⇒ COALESCE 兜 0）。
      { dryRun: true, apply: [{ objectId: sample!.id, prop: "max_capacity_day", value: undefined }] },
    );
    const delta = res.dryRunDeltas?.find((d) => d.objId === sample!.id && d.prop === "blockedPressure");
    // 不是写死常数 ⇒ 分母没了输出必须变（兜 0 或变，不是停在原值）。
    expect(delta!.after as number).not.toBe(sample!.props.blockedPressure as number);
    expect(delta!.after as number).toBe(0); // COALESCE(...,0) 兜除零
  });

  // ── 臂 5 变异反证：把实现改坏 ⇒ 这条测试必须红（在独立小世界变异，⛔ 不改共享实现）────────────────
  it("臂5 变异反证：把 equipmentFailure 的『100 −』改成『100 +』⇒ 臂1 锚定断言当场红", async () => {
    // 在独立小世界编译一条**变异规格**（同 targetType/targetProp，公式改坏），
    // recompute 后读值必须 ≠ 手算（证明臂1 真的咬得住「式子被改坏」这种病）。
    const t3 = await makeApp();
    await seedBattery(t3);
    await seedDemoDerivationSpecs(t3.repos, t3.services.ontologyCore, t3.services.governance, t3.adminCtx);
    // 编译变异规格：把 100 - health_score 改成 100 + health_score。
    const versions = await t3.repos.ontologyVersions.list("demo");
    const ov = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
    await t3.services.ontologyCore.compileSpecs(t3.adminCtx, ov, [
      { specKey: "equipment_failure_rate", targetType: "Equipment", targetProp: "equipmentFailure", formula: "100 + this.health_score" },
    ]);
    await recomputeDemoDerivationsAtSeed(t3.repos, t3.services.ontologyCore, t3.adminCtx);
    const eqs = await t3.repos.objects.listByType("demo", "Equipment");
    const sample = eqs[0]!;
    const handCorrect = 100 - propOf(eqs, sample.id, "health_score");
    const actual = propOf(eqs, sample.id, "equipmentFailure");
    // 变异后实测 = 100 + hs ≠ 手算 100 − hs ⇒ 若此处 actual 仍等于 handCorrect，说明臂1 咬不住。
    expect(actual, "变异没生效（式子没真被改坏）").not.toBeCloseTo(handCorrect, 4);
    expect(actual).toBeCloseTo(100 + propOf(eqs, sample.id, "health_score"), 4);
  }, 120_000);

  // ── R6 确定性（验收判据 4）：同 seed 重铺 ⇒ measuredCells 逐字节一致 ─────────────────
  it("R6 确定性：同 (seed=42) 重铺世界 ⇒ measuredCells / totalCells 逐字节一致", async () => {
    const a = await deriveSeedBaseSnapshot(t.repos, "demo");
    const b = await deriveSeedBaseSnapshot(t.repos, "demo");
    expect(a.origin.measuredCells).toBe(b.origin.measuredCells);
    expect(a.origin.cells).toBe(b.origin.cells);
    // 逐格字节一致（派生必须是纯函数，⛔ 无时钟无随机）。
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  // ── §3 绑定判据（验收判据 5）：valueRef 指向查无 specKey ⇒ 必须红 ─────────────────
  it("§3 绑定判据：valueRef 指向不存在的 specKey ⇒ 播种当场抛错变红（⛔ 不静默回落哈希）", async () => {
    const battery = await import("../src/synthetic/battery.js");
    const orig = battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"];
    battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"] = { specKey: "NONEXISTENT_spec_key_变异" };
    try {
      // 规格库非空（beforeAll 已播种）⇒ 校验生效 ⇒ 断引用必红。
      await expect(deriveSeedBaseSnapshot(t.repos, "demo")).rejects.toThrow(/绑定断裂|NONEXISTENT_spec_key_变异/);
    } finally {
      // 恢复注册表（变异复原 = cp 备份思路：先存原值再改，finally 复原并核验）。
      if (orig === undefined) delete battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"];
      else battery.STATE_VAR_VALUE_REFS["Equipment|equipmentFailure"] = orig;
    }
    // 复原后必须能正常播种（证明变异真的被复原，不留残毒）。
    const ok = await deriveSeedBaseSnapshot(t.repos, "demo");
    expect(ok.origin.measuredCells).toBe(4171);
  });

  // ── seedHash01 金丝雀（校验哈希兜底路径仍在，占位格仍可复现）────────────────────────
  it("金丝雀：seedHash01 确定性（占位格的哈希兜底未受本单影响）", () => {
    expect(seedHash01("obj_x|qty")).toBe(seedHash01("obj_x|qty"));
    expect(seedHash01("obj_x|qty")).toBeGreaterThanOrEqual(0);
    expect(seedHash01("obj_x|qty")).toBeLessThanOrEqual(1);
  });
});
