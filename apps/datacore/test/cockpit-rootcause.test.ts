import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { generateBattery } from "../src/synthetic/battery.js";

/**
 * cockpit P2 · 规划决策推演 + 根因归因 DAG（铁律：KPI 与因果链均经本体关系算出，前后端零写死 R14；
 * R13 求解器溯源；R6 字节一致）。绿地 Metric(=PlanKpi 归一)/RootCauseChain 走真合成管线，plan_rootcause 求解器
 * 经营 KPI 越线沿归因模板逐层取证 → DAG 结构与每条边贡献占比全部从活数据算出。
 */
describe("cockpit P2 · 根因归因 DAG（L6 + L1 + R2）", () => {
  it("L6 确定性：generateBattery 同 seed Metric/RootCauseChain 字节级一致 + KPI 与 P1 数据交叉一致", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");
    expect(JSON.stringify(a.metrics)).toBe(JSON.stringify(b.metrics));
    expect(JSON.stringify(a.rootCauseChains)).toBe(JSON.stringify(b.rootCauseChains));
    expect(a.metrics.length).toBe(3);
    // 轨M 增量3（反事实排除层）：4 → 6（加 material 类 rc-material-logistics/rc-material-safety 候选根因，
    // 反算达标→DAG 显式排除可见）。加性扩充·旧 4 链字节不变（上行 toBe 同对象比对仍过）。
    expect(a.rootCauseChains.length).toBe(6);
    // 毛利率 KPI 的 actual 与财务"毛利"线/收入交叉一致（非写死）：actual = 毛利/收入×100。
    const margin = a.metrics.find((k) => k.metricId === "kpi-margin")!;
    const rev = (a.financePlans.find((f) => f.line === "收入")!.rolling as number);
    const gm = (a.financePlans.find((f) => f.line === "毛利")!.rolling as number);
    expect(margin.actual as number).toBeCloseTo(Math.round(gm / rev * 100 * 10) / 10, 1);
  });

  it("L1：合成 → plan_rootcause 求解器产出多根 DAG（KPI→因子→证据，边权重=活数据贡献占比）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    // 两绿地类型真物化
    const kpiRows = (await (await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType: "Metric", filter: {}, limit: 10 } })).json()) as { rows?: { props: Record<string, unknown> }[]; data?: { props: Record<string, unknown> }[] };
    const kpis = (kpiRows.rows ?? kpiRows.data ?? []);
    expect(kpis.length).toBe(3);
    // gapPct 派生回写（= (actual-target)/target*100）
    const k0 = kpis[0]!.props;
    expect(typeof k0.gapPct).toBe("number");
    expect(k0.gapPct as number).toBeCloseTo(((k0.actual as number) - (k0.target as number)) / (k0.target as number) * 100, 1);

    // 求解器：经营 KPI 越线 → 归因 DAG（结构=算）
    const res = await t.app.inject({ method: "POST", url: "/a/v1/solvers/plan_rootcause/invoke", headers: ADMIN, payload: { args: {} } });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { kpis: { kpiId: string; status: string; offTarget: boolean }[]; dag: { nodes: { id: string; kind: string }[]; edges: { from: string; to: string; weight: number }[] }; offTargetCount: number; summary: string } }).data;
    // 物料保障率必越线（齐套覆盖 94.6% < 95 floor，正极 654 吨缺口 C06 预警）→ 至少 1 项越线，DAG 恒有内容
    expect(out.offTargetCount).toBeGreaterThanOrEqual(1);
    const dag = out.dag;
    expect(dag.nodes.some((n) => n.kind === "kpi")).toBe(true);
    expect(dag.nodes.some((n) => n.kind === "factor")).toBe(true);
    expect(dag.nodes.some((n) => n.kind === "evidence")).toBe(true);
    // 每条 kpi→factor 边的权重（贡献占比）按 KPI 归一 ≈ 1（非写死，活数据聚合算出）
    const kpiRootIds = dag.nodes.filter((n) => n.kind === "kpi").map((n) => n.id);
    for (const rootId of kpiRootIds) {
      const kf = dag.edges.filter((e) => e.from === rootId);
      if (kf.length === 0) continue;
      const sumShare = kf.reduce((s, e) => s + e.weight, 0);
      expect(sumShare).toBeCloseTo(1, 2);
    }
    // 每条 factor 节点都有 ≥1 取证叶（factor→evidence 边）
    for (const f of dag.nodes.filter((n) => n.kind === "factor")) {
      expect(dag.edges.some((e) => e.from === f.id && e.to.startsWith("leaf:"))).toBe(true);
    }
  });

  it("L1：指定 kpiCategory 只归因该类 KPI（profit）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/solvers/plan_rootcause/invoke", headers: ADMIN, payload: { args: { kpiCategory: "profit" } } });
    const out = (res.json() as { data: { kpis: { category: string }[] } }).data;
    expect(out.kpis.every((k) => k.category === "profit")).toBe(true);
  });

  it("R2：另一租户无这些绿地对象（隔离）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const other = await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: { "x-debug-user": "acme:admin:admin" }, payload: { objectType: "Metric", filter: {}, limit: 10 } });
    const rows = (other.json() as { rows?: unknown[]; data?: unknown[] });
    expect((rows.rows ?? rows.data ?? []).length).toBe(0);
  });
});
