import { describe, expect, it } from "vitest";
import { ADMIN, BASE_MANAGER, PLANNER, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * 回归锁：invoke_solver 必须经 A6 行级过滤的 visibleOrders 取数（ontology.invokeSolver →
 * queryObjects("Order") → rowAllowed）。base_manager:常州 经求解器**不得**看到本基地范围外的
 * 订单——验证显微镜分析中的安全不变量（#1 已由 visibleOrders 机制处理，此测试防回归）。
 */

const affected = (t: TestApp, headers: Record<string, string>, baseId: string) =>
  invokeSolver(t, "affected_orders", { baseId }, headers).then(
    (r) => (r.json() as { data: { affected: { props?: Record<string, unknown> }[]; total: number } }).data,
  );

const ordersVia = (t: TestApp, headers: Record<string, string>) =>
  t.app
    .inject({ method: "POST", url: "/a/v1/objects/query", headers, payload: { objectType: "Order", filter: {}, limit: 1000 } })
    .then((r) => (r.json() as { data: { props: Record<string, unknown> }[] }).data);

describe("A6 行级权限贯穿求解器（#1 回归锁）", () => {
  it("query_objects 与 invoke_solver 同源：base_manager 只见含本基地的订单", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 直接查询：base_manager 可见订单全部含 changzhou（行过滤生效）
    const bmOrders = await ordersVia(t, BASE_MANAGER);
    const plOrders = await ordersVia(t, PLANNER);
    expect(bmOrders.length).toBeGreaterThan(0);
    expect(bmOrders.length).toBeLessThan(plOrders.length); // 严格子集（存在非常州订单）
    for (const o of bmOrders) {
      const bases = (o.props.bases as string[]) ?? [];
      expect(bases).toContain("changzhou");
    }
  });

  it("求解器经 visibleOrders 取数：base_manager 的 affected 数 ≤ planner，且不泄露纯外基地订单", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 本基地：base_manager 能正常工作（非空）
    const bmOwn = await affected(t, BASE_MANAGER, "changzhou");
    const plOwn = await affected(t, ADMIN, "changzhou");
    expect(bmOwn.total).toBeLessThanOrEqual(plOwn.total); // 永不多于全量

    // 外基地：base_manager 看到的订单仍受行过滤约束（不会多于 planner）
    const bmForeign = await affected(t, BASE_MANAGER, "hefei");
    const plForeign = await affected(t, ADMIN, "hefei");
    expect(bmForeign.total).toBeLessThanOrEqual(plForeign.total);
    // 任何 base_manager 经求解器见到的订单都在其权限范围内（含 changzhou）
    for (const o of [...bmOwn.affected, ...bmForeign.affected]) {
      const bases = ((o.props?.bases as string[]) ?? (o as { bases?: string[] }).bases) ?? [];
      if (bases.length) expect(bases).toContain("changzhou");
    }
  });
});

/**
 * WO-2：A6 行级过滤补到求解器**读出层**（非仅 Order）——capacity_rollup/bottleneck_matrix 读
 * Base/Line/Process/Equipment 此前全量不过滤；现 loadContext 带 ctx 经同一策略引擎过滤。
 * FDE 判据：base_manager:常州 → bases/rows 只含常州（length 1）；admin 仍见全 12。
 */
describe("WO-2 · A6 行级过滤求解器读出层（capacity_rollup / bottleneck_matrix）", () => {
  it("capacity_rollup：base_manager 只见常州（1 基地），admin 见全 12", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bm = (await invokeSolver(t, "capacity_rollup", {}, BASE_MANAGER).then((r) => (r.json() as { data: { bases: { baseId?: string; base?: string }[] } }).data));
    const ad = (await invokeSolver(t, "capacity_rollup", {}, ADMIN).then((r) => (r.json() as { data: { bases: unknown[] } }).data));
    expect(bm.bases.length).toBe(1);
    expect(JSON.stringify(bm.bases)).toContain("changzhou");
    expect(ad.bases.length).toBe(12);
  });

  it("bottleneck_matrix：base_manager 只见常州一行，admin 见全 12", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bm = (await invokeSolver(t, "bottleneck_matrix", {}, BASE_MANAGER).then((r) => (r.json() as { data: { rows: { base: string }[] } }).data));
    const ad = (await invokeSolver(t, "bottleneck_matrix", {}, ADMIN).then((r) => (r.json() as { data: { rows: unknown[] } }).data));
    expect(bm.rows.length).toBe(1);
    expect(ad.rows.length).toBe(12);
  });
});
