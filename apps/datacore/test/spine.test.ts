import { describe, expect, it } from "vitest";
import { GOAL_REGISTRY, PLAN_GOAL_TARGETS } from "@platform/contracts";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { generateBattery } from "../src/synthetic/battery.js";

/**
 * SPINE 经营目标-指标-责任骨架（Goal–Metric–Owner）：KSF/Metric/Principal 一等对象 + metric_rollup
 * 求解器（各视图 KPI 单一出处 R-一致，派生投影非新真值 R13，确定性 R6，租户隔离 R2）。
 */
describe("SPINE · 目标-指标-责任骨架（L6 + L1 + R2）", () => {
  it("L6 确定性：generateBattery 同 seed metrics/ksfs/principals 字节级一致 + Metric 归挂 KSF/责任人", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");
    expect(JSON.stringify(a.metrics)).toBe(JSON.stringify(b.metrics));
    expect(JSON.stringify(a.ksfs)).toBe(JSON.stringify(b.ksfs));
    expect(JSON.stringify(a.principals)).toBe(JSON.stringify(b.principals));
    expect(a.ksfs.length).toBe(5);
    expect(a.metrics.every((m) => m.ksfRef && m.ownerRef)).toBe(true);
  });

  it("L1：KSF/Metric/Principal 真物化 + 骨架链路（metric_affects_ksf / metric_ownedby）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const ksf = (await (await t.app.inject({ method: "GET", url: "/a/v1/ksf", headers: ADMIN })).json()) as { items: { key: string }[] };
    expect(ksf.items.length).toBe(5);
    const prin = (await (await t.app.inject({ method: "GET", url: "/a/v1/principals", headers: ADMIN })).json()) as { items: { kind: string }[] };
    expect(prin.items.length).toBeGreaterThanOrEqual(7); // 4 部门 + 3 细分业务线（WO-CEO-1a item3）
    const metrics = (await (await t.app.inject({ method: "GET", url: "/a/v1/metrics", headers: ADMIN })).json()) as { items: { metricId: string; ksfRef: string }[] };
    // WO-CEO-1a：3 运营指标 + 4 顶层目标(营收/毛利/份额/现金) + 3 细分 = 10（顶层目标已升一等 Metric）
    expect(metrics.items.length).toBe(26);
    expect(metrics.items.every((m) => m.ksfRef)).toBe(true);
    // 骨架链路：每 metric 有一条 metric_affects_ksf + metric_ownedby 边（26 指标[含月/季] → 26 边）
    const links = await t.repos.links.list("demo", (l) => l.type === "metric_affects_ksf");
    expect(links.length).toBe(26);
    const ownLinks = await t.repos.links.list("demo", (l) => l.type === "metric_ownedby");
    expect(ownLinks.length).toBe(26);
  });

  it("WO-CEO-1a：顶层目标(营收/毛利/份额/现金)已升一等 Metric（target/actual/floorVal/越线 齐备，year 级）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "metric_rollup", { level: "year" });
    const out = (res.json() as { data: { metrics: { metricId: string; key: string; level: string; target: number; actual: number; floorVal: number; delta: number; miss: boolean; ownerRef: string | null }[] } }).data;
    const byKey = new Map(out.metrics.map((m) => [m.key, m]));
    // 4 顶层目标齐备，全 year 级，均有 target/floorVal/ownerRef + delta/miss 派生
    for (const key of ["revenue", "gross_profit", "market_share", "cash"]) {
      const m = byKey.get(key)!;
      expect(m, `顶层目标 ${key} 应为一等 Metric`).toBeDefined();
      expect(m.level).toBe("year");
      expect(typeof m.target).toBe("number");
      expect(typeof m.floorVal).toBe("number");
      expect(m.ownerRef).toBeTruthy(); // 有责任人
      expect(m.delta).toBeCloseTo(m.actual - m.target, 3);
      expect(m.miss).toBe(m.actual < m.floorVal); // 越线判定
    }
    // 营收700亿此前仅 Σp50×price 局部变量 → 现为一等目标 Metric（target 取自 GOAL_REGISTRY）
    expect(byKey.get("revenue")!.target).toBe(GOAL_REGISTRY.revenue.target);
    expect(byKey.get("revenue")!.actual).toBe(700); // 真实聚合 Σ需求×单价
  });

  it("R-一致（Gap④ 杀漂移）：Metric.target/floorVal 全部取自 GOAL_REGISTRY 单一来源，毛利率底线不再漂移", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "metric_rollup", {});
    const out = (res.json() as { data: { metrics: { key: string; target: number; floorVal: number }[] } }).data;
    // 每个登记的指标：Metric.target === GOAL_REGISTRY[key].target（同目标同值，跨视图一致）
    for (const m of out.metrics) {
      const g = Object.values(GOAL_REGISTRY).find((x) => x.key === m.key);
      if (!g) continue; // 细分指标不入册（seg_attain_*），跳过
      expect(m.target, `${m.key} target 应等于 GOAL_REGISTRY 单一来源`).toBe(g.target);
      expect(m.floorVal, `${m.key} floorVal 应等于 GOAL_REGISTRY 单一来源`).toBe(g.floorVal);
    }
    // 毛利率底线单一来源 = PLAN_GOAL_TARGETS.gmFloorPct（此前 Metric 硬编码 13 与之漂移，现收敛 15.5）
    const gm = out.metrics.find((m) => m.key === "gm_rate")!;
    expect(gm.floorVal).toBe(PLAN_GOAL_TARGETS.gmFloorPct);
    expect(gm.floorVal).not.toBe(13); // 旧漂移值已杀
  });

  it("L1：metric_rollup 输出 Metric[] + delta/miss（actual<floor 越线，对齐目标树）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "metric_rollup", {});
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { metrics: { metricId: string; target: number; actual: number; delta: number; miss: boolean }[]; missCount: number; byLevel: Record<string, number>; summary: string } }).data;
    expect(out.metrics.length).toBe(26); // WO-PLANKPI: +16 月/季
    // delta = actual − target（派生一致）
    for (const m of out.metrics) expect(m.delta).toBeCloseTo(m.actual - m.target, 3);
    // 需求达成率(90.8<95) + 储能细分(72.2<95) 越线 → missCount ≥ 2
    expect(out.missCount).toBeGreaterThanOrEqual(2);
    expect(out.byLevel.op).toBe(6); // 3 运营 + 3 细分
    expect(out.byLevel.year).toBe(4); // 4 顶层目标
  });

  it("L1：level 过滤（op 6 项 / year 4 项顶层目标真对象，非系数编造）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "metric_rollup", { level: "op" });
    const out = (res.json() as { data: { metrics: { level: string }[] } }).data;
    expect(out.metrics.every((m) => m.level === "op")).toBe(true);
    expect(out.metrics.length).toBe(6);
    // year 级现返回 4 个真顶层目标 Metric（此前 0：顶层目标未对象化）
    const year = await invokeSolver(t, "metric_rollup", { level: "year" });
    expect((year.json() as { data: { metrics: unknown[] } }).data.metrics.length).toBe(4);
  });

  it("SPINE.2 责任闭环：目标树→责任人（plantarget_ownedby）+ Metric 血缘可溯到数据源（R13）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const ptOwn = await t.repos.links.list("demo", (l) => l.type === "plantarget_ownedby");
    expect(ptOwn.length).toBeGreaterThan(0);
    // Metric 血缘：GET /a/v1/metrics/:key 返回 lineage（源连接 → 原始表）
    const lin = (await (await t.app.inject({ method: "GET", url: "/a/v1/metrics/kpi-material", headers: ADMIN })).json()) as { metric: { metricId: string }; lineage: { connectionName: string | null; rawDatasetName: string | null } };
    expect(lin.metric.metricId).toBe("kpi-material");
    expect(lin.lineage.connectionName).toBeTruthy(); // 合成数据源可溯
    expect(lin.lineage.rawDatasetName).toBe("Metric"); // 原始表
  });

  it("SPINE.2 事件：指标快照回采发 metric.snapshot_recorded（每指标）+ 越线发 metric.breached", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/metrics/snapshot", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { recorded: number; breached: number };
    expect(out.recorded).toBe(26); // 3 运营 + 4 顶层目标 + 3 细分 + WO-PLANKPI 16 月/季（全入快照回采）
    expect(out.breached).toBeGreaterThanOrEqual(2); // 需求达成率(90.8<95) + 储能细分(72.2<95) 越线
    const snap = await t.repos.outboxEvents.list("demo", (e) => e.event === "metric.snapshot_recorded");
    expect(snap.length).toBe(26);
    const breach = await t.repos.outboxEvents.list("demo", (e) => e.event === "metric.breached");
    expect(breach.length).toBeGreaterThanOrEqual(2);
    // demand 规模锁定(375万套/700亿)后：物料保障率 95.8% 高于 95 底线（个体物料缺口经 C06/C16 覆盖），
    // 当前越线指标为需求达成率（demand_attain）。
    expect(breach.some((e) => (e.payload as { key?: string }).key === "demand_attain")).toBe(true);
  });

  it("R2：另一租户无 Metric/KSF/Principal（隔离）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const other = await t.app.inject({ method: "GET", url: "/a/v1/metrics", headers: { "x-debug-user": "acme:admin:admin" } });
    expect((other.json() as { items: unknown[] }).items.length).toBe(0);
  });
});
