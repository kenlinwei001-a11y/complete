import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { FinanceWorldProjectionOutputSchema, type FinanceWorldProjectionOutput } from "@platform/contracts";

/**
 * ══ WO-SIM-MONEY-HONESTY · 接缝门：占位基线印不出「看起来像真数的假毛利」══════════════
 *
 * ── 这道门跨的是哪两半（SEAM-GATE：不是各半 unit 各绿就算）────────────────────────
 *  ① **基线来源标注半**：t0 基线探测（与播种器同一条「有限 number 即实测」规则）
 *     真的逐 stateVar 落到回包 `pressures[].baseline`；
 *  ② **金额投影半**：占位/混合基线 ⇒ 受影响绝对水位逐项 `absoluteAvailable:false`，
 *     而 `deltaVsT0`（锚在世界自己的 t0）在占位/实测两种基线下**同值且都可用**。
 * 任一半漏都必须红：只标注不闸门 ⇒ 屏上照样印假数；只闸门不给 Δ ⇒ 把能说的也禁掉了。
 *
 * ── 头号判据 · 对照实验（铁律 1.5 判据一，工单验收线）─────────────────────────────
 * **同一次推演，基线为「占位」与基线为「实测」两种情况下，回包必须不同：
 * 占位时绝对投影被标为不可用，实测时可用；而两种情况下的 Δ 必须相同。**
 * 四个数：两种基线各给「绝对投影是否可用」与「Δ 的值」。
 * ⚠ 第二半（Δ 相同）同样重要：只验前一半的话，把 Δ 也一起禁掉也会通过 ——
 * 故断言写成 `deltaVsT0 严格相等` **且** `deltaVsT0 > 0`（扰动真落地，不是两边都禁）。
 *
 * ── 真跑，不是桩 ────────────────────────────────────────────────────────────────
 * 全程走真 HTTP 端点：真建会话 → 真扰动（`POST …/perturbations`）→ 真 tick → 真调求解器。
 * 「实测基线」一臂用**真对象属性**（`repos.objects.put` 写真读数）驱动探测，
 * 不改求解器入参 —— 探测走的那条路就是生产走的那条路。
 */

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function createWorld(t: TestApp, baseSnapshot: Record<string, Record<string, number>>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(res.statusCode, `建会话失败：${res.body}`).toBe(201);
  return (res.json() as { id: string }).id;
}

const tick = (t: TestApp, sid: string, n: number) =>
  t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });

const perturb = (t: TestApp, sid: string, materialId: string) =>
  t.app.inject({
    method: "POST",
    url: `/a/v1/sim/sessions/${sid}/perturbations`,
    headers: ADMIN,
    payload: { kind: "cost_shock", targetObjectId: materialId, targetStateVar: "priceShock", magnitude: 12, mode: "set", label: "碳酸锂涨价 12%" },
  });

async function project(t: TestApp, worldId: string): Promise<FinanceWorldProjectionOutput> {
  const res = await invokeSolver(t, "finance_world_projection", { worldId });
  expect(res.statusCode, `求解器失败：${res.body}`).toBe(200);
  const raw = (res.json() as { data: unknown }).data;
  const parsed = FinanceWorldProjectionOutputSchema.safeParse(raw);
  expect(
    parsed.success,
    `引擎回包不符合 FinanceWorldProjectionOutputSchema：${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))}`,
  ).toBe(true);
  return raw as FinanceWorldProjectionOutput;
}

const lineOf = (out: FinanceWorldProjectionOutput, role: string) => out.lines.find((l) => l.role === role)!;
const pressureOf = (out: FinanceWorldProjectionOutput, v: string) => out.pressures.find((p) => p.stateVar === v)!;

/** 取一条真成本链实例（真链路表里的真 id，与 WO-FINANCE-WORLDSTATE 同一取法）。 */
async function costChainInstance(t: TestApp) {
  const links = await t.repos.links.list("demo");
  const mubm = links.find((l) => l.type === "material_used_by_model")!;
  const materialId = mubm.fromId;
  const modelId = mubm.toId;
  const mdbo = links.find((l) => l.type === "model_demanded_by_order" && l.fromId === modelId)!;
  return { materialId, orderId: mdbo.toId };
}

describe("WO-SIM-MONEY-HONESTY · 推演金额的诚实位（G-DATAMODE-PROV 金额侧）", () => {
  it("🔴 头号判据 · 对照实验：占位 vs 实测基线 —— 绝对水位可用性必须不同，Δ 必须相同（四个数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);

    // ── 第一臂 · 占位基线：订单对象上**没有** costPressure 真读数（demo 台账常态）────────
    const snapshot: Record<string, Record<string, number>> = { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 50 } };
    const sidPh = await createWorld(t, snapshot);
    expect((await perturb(t, sidPh, materialId)).statusCode).toBe(201);
    expect((await tick(t, sidPh, 2)).statusCode).toBe(200);
    const ph = await project(t, sidPh);

    const phCostBase = pressureOf(ph, "costPressure").baseline!;
    const phCost = lineOf(ph, "COST");
    const phMargin = lineOf(ph, "MARGIN");
    // 数 ①：占位臂 · 绝对投影是否可用 = false
    expect(phCostBase.kind).toBe("PLACEHOLDER");
    expect(phCostBase.measuredCells).toBe(0);
    expect(phCostBase.placeholderCells).toBeGreaterThan(0);
    expect(phCost.absoluteAvailable).toBe(false);
    expect(phCost.absoluteUnavailableReason, "占位 ⇒ 不可用必须配原因，不许只给一个 false").toBeTruthy();
    expect(phMargin.absoluteAvailable).toBe(false);
    // 占位臂里应收/逾期侧同样不许印绝对水位（这两个 stateVar 在此世界无承载 ⇒ 同样不可用）
    expect(ph.cash.arAbsoluteAvailable).toBe(false);
    expect(ph.cash.overdueAbsoluteAvailable).toBe(false);
    // notes 诚实位必须点名（前端第一层读 notes）
    expect(ph.notes.some((n) => n.includes("基线诚实位"))).toBe(true);

    // ── 第二臂 · 实测基线：同一个订单对象补上**真读数属性**（探测走生产同一条路）─────────
    const order = (await t.repos.objects.get("demo", orderId))!;
    await t.repos.objects.put({ ...order, props: { ...order.props, costPressure: 50 } });
    const sidM = await createWorld(t, snapshot);
    expect((await perturb(t, sidM, materialId)).statusCode).toBe(201);
    expect((await tick(t, sidM, 2)).statusCode).toBe(200);
    const m = await project(t, sidM);

    const mCostBase = pressureOf(m, "costPressure").baseline!;
    const mCost = lineOf(m, "COST");
    const mMargin = lineOf(m, "MARGIN");
    // 数 ②：实测臂 · 绝对投影是否可用 = true
    expect(mCostBase.kind).toBe("MEASURED");
    expect(mCostBase.measuredCells).toBeGreaterThan(0);
    expect(mCostBase.placeholderCells).toBe(0);
    expect(mCost.absoluteAvailable).toBe(true);
    expect(mMargin.absoluteAvailable).toBe(true);

    // 数 ③④：两臂的 Δ —— **严格相等**（传导增量不依赖起点值）且 **> 0**（扰动真落地，
    // 不是两边一起禁掉 Δ 也能过的那种绿）。
    expect(phCost.deltaVsT0).toBeGreaterThan(0);
    expect(phCost.deltaVsT0).toBe(mCost.deltaVsT0);
    expect(phMargin.deltaVsT0).toBe(mMargin.deltaVsT0);
    expect(phMargin.deltaVsT0).toBeLessThan(0); // 成本涨 ⇒ 毛利 Δ 为负（方向与压力一致）

    // Δ 的算式恒等式（写死数值 = 赌种子不变）：Δ = rolling ×（当前压力 − t0 压力）÷ divisor
    const pCur = pressureOf(ph, "costPressure").value;
    const expectDelta = Math.round(phCost.rolling * ((pCur - phCostBase.t0Value) / ph.basis.divisor) * 100) / 100;
    expect(phCost.deltaVsT0!).toBeCloseTo(expectDelta, 1);
    // Δ 锚在 t0 而不是绝对 0：t0 压力非 0 时，deltaVsT0 ≠ 旧的绝对锚 delta ——
    // 两者相等才说明锚错了地方（t0=0 的世界除外，这里 t0=50 ≠ 0）。
    expect(phCostBase.t0Value).toBeGreaterThan(0);
    expect(phCost.deltaVsT0).not.toBe(phCost.delta);
  });

  it("金丝雀 + MIXED 档：探测法对「实测/占位」有鉴别力（全报占位或全报实测的坏法在此变红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    // 第二张订单：同一类型、**不补**属性 ⇒ 占位格。
    const orders = await t.repos.objects.listByType("demo", "Order");
    const other = orders.find((o) => o.id !== orderId)!;
    // 第一张补上真读数属性 ⇒ 实测格。
    const order = (await t.repos.objects.get("demo", orderId))!;
    await t.repos.objects.put({ ...order, props: { ...order.props, costPressure: 40 } });

    const sid = await createWorld(t, {
      [materialId]: { priceShock: 0 },
      [orderId]: { costPressure: 40 },
      [other.id]: { costPressure: 60 },
    });
    const out = await project(t, sid);
    const base = pressureOf(out, "costPressure").baseline!;
    expect(base.kind).toBe("MIXED");
    expect(base.measuredCells).toBe(1);
    expect(base.placeholderCells).toBe(1);
    // 混合同样不许印绝对水位（占位占比说不清），但 Δ 照样给
    expect(lineOf(out, "COST").absoluteAvailable).toBe(false);
    expect(lineOf(out, "COST").deltaVsT0).toBeDefined();
  });

  it("反向判据 · R6：同一世界重复投影，新字段一起逐字节相同", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { materialId, orderId } = await costChainInstance(t);
    const sid = await createWorld(t, { [materialId]: { priceShock: 0 }, [orderId]: { costPressure: 50 } });
    const a = await project(t, sid);
    const b = await project(t, sid);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
