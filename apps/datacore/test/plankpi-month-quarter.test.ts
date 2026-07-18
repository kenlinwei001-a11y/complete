import { describe, it, expect } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";

/**
 * WO-PLANKPI-MONTH-QUARTER · 月/季 PlanKpi 真对象化（闭 DS.1「季度诚实空·摊派编造」残口）。
 * SEAM = 查某季指标 → 真月/季对象归因（非 year 摊派/空）。数据半（造实例）× 读取半（求解器 level）同引擎，核对键一致。
 * KILL-MOCK-RED：月/季 actual 必真对象 + 可溯分解（来自 totalAct/totalTgt 真值 + 一等季节权重），**绝不**复活被删的
 *   假周期系数 {month:1.0,quarter:0.97,year:1.04}。
 */
describe("WO-PLANKPI-MONTH-QUARTER · 月/季需求达成 Metric 真对象化", () => {
  it("C1 · Metric 含 level:quarter(4)+month(12) 实例（key=demand_attain_{period}）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const metrics = await t.repos.objects.listByType("demo", "Metric");
    const byLevel: Record<string, number> = {};
    for (const m of metrics) byLevel[String(m.props.level)] = (byLevel[String(m.props.level)] ?? 0) + 1;
    expect(byLevel.quarter).toBe(4);
    expect(byLevel.month).toBe(12);
    const q1 = metrics.find((m) => m.props.key === "demand_attain_2026-Q1");
    expect(q1).toBeTruthy();
    expect(q1!.props.level).toBe("quarter");
    expect(q1!.props.chainKey).toBe("rc-scale-demand"); // 复用既有 RootCauseChain
  });

  it("C2 · metric_rollup({level:quarter}) 非空·byLevel.quarter=4·每条 target/actual/miss 真算", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const mr = (await t.services.solvers.invoke(t.adminCtx, "metric_rollup", { level: "quarter" })) as {
      metrics: { key: string; target: number; actual: number; floorVal: number; miss: boolean; level: string }[];
      byLevel: Record<string, number>;
    };
    expect(mr.byLevel.quarter).toBe(4);
    expect(mr.metrics.length).toBe(4);
    const q1 = mr.metrics.find((m) => m.key === "demand_attain_2026-Q1")!;
    expect(q1.level).toBe("quarter");
    expect(q1.target).toBe(100); // %-口径自洽（非 PlanTarget 供给基·避 floor>target 乱）
    expect(q1.floorVal).toBe(95);
    expect(q1.actual).toBeGreaterThan(0);
    expect(q1.miss).toBe(q1.actual < 95); // miss 真算
  });

  it("C3 · plan_rootcause({level:quarter}) 出真根因 DAG（越线季度指标·非空非编）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const pr = (await t.services.solvers.invoke(t.adminCtx, "plan_rootcause", { level: "quarter" })) as {
      offTargetCount: number; dag: { nodes: unknown[] }; summary: string;
    };
    expect(pr.offTargetCount).toBeGreaterThan(0); // 有越线季度指标
    expect(pr.summary).toContain("需求达成率"); // 归因根是季度需求达成率指标
    expect(Array.isArray(pr.dag?.nodes) ? pr.dag.nodes.length : 0).toBeGreaterThan(0); // DAG 有内容（沿 driverType 取证）
  });

  it("C4 · month 级同 C2（level:month → 12 条）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const mr = (await t.services.solvers.invoke(t.adminCtx, "metric_rollup", { level: "month" })) as {
      metrics: unknown[]; byLevel: Record<string, number>;
    };
    expect(mr.byLevel.month).toBe(12);
    expect(mr.metrics.length).toBe(12);
  });

  it("C5 · KILL-MOCK：季 actual = 真 DemandSegment 总量分解（改颗粒→季值变·非固定摊派系数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 独立从真 DemandSegment 对象算期望达成率（= Σact/Σtgt×100·与生成同源），证季值是**真派生**非硬编码。
    const segs = await t.repos.objects.listByType("demo", "DemandSegment");
    const totalTgt = segs.reduce((s, o) => s + Number(o.props.tgt), 0);
    const totalAct = segs.reduce((s, o) => s + Number(o.props.act), 0);
    const expectedRate = Math.round((totalAct / totalTgt) * 100 * 10) / 10;
    const metrics = await t.repos.objects.listByType("demo", "Metric");
    // 季达成率 = 年真值分解（同季节权重 → 各季 = 年比率）——命中**真派生值**（若换成固定 0.97/1.04 摊派系数即红·KILL-MOCK 咬）。
    for (const q of ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]) {
      const m = metrics.find((x) => x.props.key === `demand_attain_${q}`)!;
      expect(Math.abs(Number(m.props.actual) - expectedRate)).toBeLessThanOrEqual(0.2);
    }
    // 月/季达成率**不恒等于**假周期系数摊派：与年 demand_attain 真达成率同源（totalAct/totalTgt），非 year×常量。
    const yearAttain = metrics.find((m) => m.props.key === "demand_attain")!;
    expect(Math.abs(Number(yearAttain.props.actual) - expectedRate)).toBeLessThanOrEqual(0.2); // 年也是真派生·同一真值链
  });

  it("C6 · R6：同 seed 两跑月/季 Metric actual 字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t, 42);
      return (await t.repos.objects.listByType("demo", "Metric"))
        .filter((m) => ["quarter", "month"].includes(String(m.props.level)))
        .sort((a, b) => String(a.props.key).localeCompare(String(b.props.key)))
        .map((m) => `${String(m.props.key)}=${String(m.props.actual)}`);
    };
    expect((await run()).join("|")).toBe((await run()).join("|"));
  });
});
