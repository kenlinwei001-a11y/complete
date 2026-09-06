import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-CAPACITY-EDGE · 接缝门（SEAM-GATE）—— **产能从「节点上的标量」变成「可被消耗的边」**。
 *
 * ── 今天的行为 X → 应该的行为 Y ────────────────────────────────────────────────
 * **X**：产能只是 `Line.capacityDaily`(套/日) / `Line.max_capacity_day`(件/日) 这样的**节点标量**，
 *   图上一条产能边都没有；真正在排的活动（`WorkOrder`）与产能之间零连接，
 *   「吃掉多少」这个量在本体里**没有承载**（`consumes_capacity` 压根没被声明成边）。
 * **Y**：`Line --has_capacity--> CapacityPool`，`WorkOrder --consumes_capacity--> CapacityPool`
 *   且**消耗量写在边上**（`LinkInstance.props.consumedCellsDaily`）⇒
 *   余量 = 池产能 − Σ 入边消耗，沿图可算、超载可检出。
 *
 * ── 本文件的**头号判据**（缺则退单）───────────────────────────────────────────
 * 断言咬的是「**边上的量变了，余量按预言的方式跟着变**」，不是「边在库里」。
 * 后者是本仓登记过的假绿形态（测函数不测链路）。故 §4 是**变异反证**：
 * 把某条边上的 `consumedCellsDaily` 抹掉 ⇒ 读数必须当场变，且该边被记进 `unpricedEdges`。
 * 若求解器偷偷改成从 `WorkOrder.qtyPlanned ÷ spanDays` 现算，§4 会红 —— 那正是它存在的理由。
 *
 * ⚠ 全程走**真路由 + 真求解器**（`POST /a/v1/solvers/capacity_ledger/invoke`），不喂桩。
 */

/** 取一条**两张工单消耗量真不同**的产线（对照实验的载体）。找不到即工具/数据坏了，不是"没有"。 */
async function pickTwoConsumerLine(t: TestApp): Promise<{ lineId: string; poolId: string; capacity: number; woA: string; woB: string; amtA: number; amtB: number }> {
  const res = await invokeSolver(t, "capacity_ledger", {});
  expect(res.statusCode).toBe(200);
  const data = JSON.parse(res.body).data as { pools: { poolId: string; lineId: string; capacityCellsDaily: number; consumers: { woId: string; consumedCellsDaily: number }[] }[] };
  const pool = data.pools.find((p) => p.consumers.length === 2 && p.consumers[0]!.consumedCellsDaily !== p.consumers[1]!.consumedCellsDaily);
  expect(pool, "找不到「两张单消耗量不同」的池 —— 对照实验无载体，先查种子而不是改断言").toBeTruthy();
  const [a, b] = [pool!.consumers[0]!, pool!.consumers[1]!];
  return { lineId: pool!.lineId, poolId: pool!.poolId, capacity: pool!.capacityCellsDaily, woA: a.woId, woB: b.woId, amtA: a.consumedCellsDaily, amtB: b.consumedCellsDaily };
}

describe("WO-CAPACITY-EDGE · has_capacity / consumes_capacity 接缝", () => {
  it("§1 两条边真有实例，且**消耗量真的落在边上**（不是落在工单节点上）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 金丝雀：先证「我的查法是好的」——拿一个确定存在的东西跑同一条查法。
    // 不中 ⇒ 报「工具坏了」，不许报「产能边不存在」。
    const lines = await t.repos.objects.listByType("demo", "Line");
    expect(lines.length, "金丝雀：Line 必须有实例，否则下面的 0 是遍历坏了不是边没建").toBe(130);
    const certLinks = await t.repos.links.list("demo", (l) => l.type === "model_certified_on");
    expect(certLinks.length, "金丝雀：既有带 props 的边必须查得到，证明 links 面与 props 读法都是好的").toBeGreaterThan(0);

    // ① 结构半：产能池 + `has_capacity` 一线一条。
    const pools = await t.repos.objects.listByType("demo", "CapacityPool");
    expect(pools.length).toBe(130);
    const hasCap = await t.repos.links.list("demo", (l) => l.type === "has_capacity");
    expect(hasCap.length).toBe(130);

    // ② 量的半：`consumes_capacity` 每条边都带着量，且量**只在边上**。
    const consumes = await t.repos.links.list("demo", (l) => l.type === "consumes_capacity");
    expect(consumes.length).toBe(260); // 260 张工单全部连上（种子每线 2 张）
    expect(consumes.every((l) => typeof l.props?.consumedCellsDaily === "number")).toBe(true);
    // 边上的量 = qtyPlanned ÷ spanDays（件/日）：**存量换成速率**，这一步正是修前缺的那一项。
    for (const l of consumes.slice(0, 5)) {
      const q = l.props!.qtyPlanned as number;
      const s = l.props!.spanDays as number;
      expect(l.props!.consumedCellsDaily as number).toBeCloseTo(q / s, 6);
    }
    // ③ `WorkOrder` 节点上**没有** `consumedCellsDaily` —— 量的唯一承载是边，不是节点。
    const wos = await t.repos.objects.listByType("demo", "WorkOrder");
    expect(wos.every((w) => w.props.consumedCellsDaily === undefined)).toBe(true);
  });

  it("§2 对照实验：同一条产线两个消耗量不同的活动 → 余量必须按消耗量成比例地不同", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = await pickTwoConsumerLine(t);
    expect(c.amtA).not.toBe(c.amtB); // 前提：两个活动的消耗量真不同

    const read = async (woId: string) => {
      const res = await invokeSolver(t, "capacity_ledger", { lineId: c.lineId, loadWorkOrders: [woId] });
      expect(res.statusCode).toBe(200);
      const p = JSON.parse(res.body).data.pools[0] as { consumedCellsDaily: number; remainingCellsDaily: number };
      return p;
    };
    const a = await read(c.woA);
    const b = await read(c.woB);

    // 四个数：A 的消耗量 · 加载 A 后的余量 · B 的消耗量 · 加载 B 后的余量。
    expect(a.consumedCellsDaily).toBe(c.amtA);
    expect(b.consumedCellsDaily).toBe(c.amtB);
    expect(a.remainingCellsDaily).toBeCloseTo(c.capacity - c.amtA, 6);
    expect(b.remainingCellsDaily).toBeCloseTo(c.capacity - c.amtB, 6);
    // **两个余量必须不同**，且差额恰等于两个消耗量的差 —— 相同即「消耗量没被读到」，那正是本单要修的病。
    expect(a.remainingCellsDaily).not.toBe(b.remainingCellsDaily);
    expect(a.remainingCellsDaily - b.remainingCellsDaily).toBeCloseTo(c.amtB - c.amtA, 6);
  });

  it("§3 越界判据：消耗量之和超过产能 → 必须被检出（PASS → BLOCK + 可读违约信息）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = await pickTwoConsumerLine(t);
    const sum = c.amtA + c.amtB;
    // 求一个恰好跨过产能面的倍数：×below 仍在面内、×above 越面。用真数算，不写死魔数。
    const below = Math.floor(c.capacity / sum);
    const above = below + 1;
    expect(below).toBeGreaterThanOrEqual(1);

    const read = async (demandMultiplier: number) => {
      const res = await invokeSolver(t, "capacity_ledger", { lineId: c.lineId, demandMultiplier });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.body).data as {
        pools: { status: string; remainingCellsDaily: number }[];
        violations: { message: string; overByCellsDaily: number }[];
        violationCount: number;
      };
    };
    const beforeOver = await read(below);
    const afterOver = await read(above);

    // 两个状态：超载前 / 超载后。
    expect(beforeOver.pools[0]!.status).toBe("PASS");
    expect(beforeOver.pools[0]!.remainingCellsDaily).toBeGreaterThanOrEqual(0);
    expect(beforeOver.violationCount).toBe(0);
    expect(afterOver.pools[0]!.status).toBe("BLOCK");
    expect(afterOver.pools[0]!.remainingCellsDaily).toBeLessThan(0);
    expect(afterOver.violationCount).toBe(1);
    // 违约信息必须可读且**带单位**（单位来自本体 PropertyDef.unit，不是求解器手写的常量）。
    expect(afterOver.violations[0]!.message).toContain("超载");
    expect(afterOver.violations[0]!.message).toContain("件/日");
    expect(afterOver.violations[0]!.overByCellsDaily).toBeGreaterThan(0);
  });

  it("§4 变异反证（头号判据）：抹掉边上的量 → 读数当场变，且该边被记进 unpricedEdges", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = await pickTwoConsumerLine(t);

    const readPool = async () => {
      const res = await invokeSolver(t, "capacity_ledger", { lineId: c.lineId });
      expect(res.statusCode).toBe(200);
      const d = JSON.parse(res.body).data as {
        pools: { consumedCellsDaily: number; remainingCellsDaily: number; consumerCount: number }[];
        unpricedEdges: number;
      };
      return { pool: d.pools[0]!, unpricedEdges: d.unpricedEdges };
    };

    const before = await readPool();
    expect(before.pool.consumerCount).toBe(2);
    expect(before.unpricedEdges).toBe(0);

    // 变异：把 A 那条边上的量**抹掉**（端点、类型、其余 props 全不动）。
    const edges = await t.repos.links.list("demo", (l) => l.type === "consumes_capacity");
    const target = edges.find((l) => l.props?.qtyPlanned !== undefined && String(l.id).includes(c.woA.replace(/[^\p{L}\p{N}_-]/gu, "_")));
    expect(target, "变异靶子没找到 —— 先查边 id 拼法，不要改断言").toBeTruthy();
    const { consumedCellsDaily: _dropped, ...restProps } = target!.props as Record<string, unknown>;
    await t.repos.links.put({ ...target!, props: restProps });

    const after = await readPool();
    // ① 读数**必须变**：若求解器偷偷从工单节点重算，这里会纹丝不动 —— 那就是边成了装饰品。
    expect(after.pool.consumedCellsDaily).not.toBe(before.pool.consumedCellsDaily);
    expect(after.pool.consumedCellsDaily).toBeCloseTo(before.pool.consumedCellsDaily - c.amtA, 6);
    expect(after.pool.remainingCellsDaily).toBeCloseTo(before.pool.remainingCellsDaily + c.amtA, 6);
    expect(after.pool.consumerCount).toBe(1);
    // ② 「边在但没带量」被**如实回报**，不与「边不在」混成一个数。
    expect(after.unpricedEdges).toBe(1);
  });

  it("§5 可披露（铁律 1.5 判据二）：单位来自本体、公式与杠杆随结果下发、明写未调用 agent", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "capacity_ledger", { demandMultiplier: 2 });
    expect(res.statusCode).toBe(200);
    const d = JSON.parse(res.body).data as { disclosure: Record<string, unknown>; poolCount: number };
    const disc = d.disclosure as { units: Record<string, string>; demandMultiplier: number; agentInvolved: boolean; formula: string; edgeAmountSource: string };
    expect(d.poolCount).toBe(130);
    // 单位必须与本体声明**逐字一致**（求解器不许内联单位串）。
    const poolType = (await t.repos.ontologyTypes.list("demo", (x) => x.key === "CapacityPool"))[0]!;
    const woType = (await t.repos.ontologyTypes.list("demo", (x) => x.key === "WorkOrder"))[0]!;
    const unitOf = (ty: typeof poolType, k: string) => ty.properties.find((p) => p.propKey === k)!.unit;
    expect(disc.units.capacity).toBe(unitOf(poolType, "capacityCellsDaily"));
    expect(disc.units.consumed).toBe(unitOf(poolType, "consumedCellsDaily"));
    expect(disc.units.remaining).toBe(unitOf(poolType, "remainingCellsDaily"));
    expect(disc.units.qtyPlanned).toBe(unitOf(woType, "qtyPlanned"));
    expect(disc.units.spanDays).toBe(unitOf(woType, "spanDays"));
    // 量纲族：产能与消耗同为「件/日」，与 `Line.capacityDaily` 的「套/日」**刻意不同**（差 packCellCount 倍）。
    expect(disc.units.capacity).toBe("件/日");
    const lineType = (await t.repos.ontologyTypes.list("demo", (x) => x.key === "Line"))[0]!;
    expect(unitOf(lineType, "capacityDaily")).toBe("套/日");
    // 杠杆值与"本次未调用 agent"必须明写，不许留白让人以为调了。
    expect(disc.demandMultiplier).toBe(2);
    expect(disc.agentInvolved).toBe(false);
    expect(disc.edgeAmountSource).toContain("consumes_capacity");
  });

  it("§6 R6 确定性：同 (battery, S, seed=42) 两次播种，台账逐字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t);
      const res = await invokeSolver(t, "capacity_ledger", {});
      expect(res.statusCode).toBe(200);
      const d = JSON.parse(res.body).data as Record<string, unknown>;
      delete d.ruleSetVersion; // 规则集指纹不属本台账（与本单无关的活动部件）
      return JSON.stringify(d);
    };
    const [a, b] = [await run(), await run()];
    expect(a).toBe(b);
  });
});
