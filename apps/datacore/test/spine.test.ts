import { describe, expect, it } from "vitest";
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
    expect(prin.items.length).toBeGreaterThanOrEqual(4);
    const metrics = (await (await t.app.inject({ method: "GET", url: "/a/v1/metrics", headers: ADMIN })).json()) as { items: { metricId: string; ksfRef: string }[] };
    expect(metrics.items.length).toBe(3);
    expect(metrics.items.every((m) => m.ksfRef)).toBe(true);
    // 骨架链路：每 metric 有一条 metric_affects_ksf 边
    const links = await t.repos.links.list("demo", (l) => l.type === "metric_affects_ksf");
    expect(links.length).toBe(3);
    const ownLinks = await t.repos.links.list("demo", (l) => l.type === "metric_ownedby");
    expect(ownLinks.length).toBe(3);
  });

  it("L1：metric_rollup 输出 Metric[] + delta/miss（actual<floor 越线，对齐目标树）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "metric_rollup", {});
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { metrics: { metricId: string; target: number; actual: number; delta: number; miss: boolean }[]; missCount: number; byLevel: Record<string, number>; summary: string } }).data;
    expect(out.metrics.length).toBe(3);
    // delta = actual − target（派生一致）
    for (const m of out.metrics) expect(m.delta).toBeCloseTo(m.actual - m.target, 3);
    // 物料保障率必越线（长协覆盖 < 92 floor）→ missCount ≥ 1
    expect(out.missCount).toBeGreaterThanOrEqual(1);
    expect(out.byLevel.op).toBe(3);
  });

  it("L1：level 过滤（op）只返回该层指标", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "metric_rollup", { level: "op" });
    const out = (res.json() as { data: { metrics: { level: string }[] } }).data;
    expect(out.metrics.every((m) => m.level === "op")).toBe(true);
    const none = await invokeSolver(t, "metric_rollup", { level: "year" });
    expect((none.json() as { data: { metrics: unknown[] } }).data.metrics.length).toBe(0);
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
    expect(out.recorded).toBe(3);
    expect(out.breached).toBeGreaterThanOrEqual(1); // 物料保障率越线
    const snap = await t.repos.outboxEvents.list("demo", (e) => e.event === "metric.snapshot_recorded");
    expect(snap.length).toBe(3);
    const breach = await t.repos.outboxEvents.list("demo", (e) => e.event === "metric.breached");
    expect(breach.length).toBeGreaterThanOrEqual(1);
    expect(breach.some((e) => (e.payload as { key?: string }).key === "material_cov")).toBe(true);
  });

  it("R2：另一租户无 Metric/KSF/Principal（隔离）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const other = await t.app.inject({ method: "GET", url: "/a/v1/metrics", headers: { "x-debug-user": "acme:admin:admin" } });
    expect((other.json() as { items: unknown[] }).items.length).toBe(0);
  });
});
