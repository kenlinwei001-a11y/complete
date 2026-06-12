import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import type { SyntheticJob } from "../src/domain.js";

async function runJob(t: Awaited<ReturnType<typeof makeApp>>, seed = 42): Promise<SyntheticJob> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/synthetic/jobs",
    headers: ADMIN,
    payload: { industry: "battery-manufacturing", scale: "S", seed },
  });
  expect(res.statusCode).toBe(202);
  return res.json() as SyntheticJob;
}

describe("A7 synthetic data", () => {
  it("SY1: seed 42 deterministic — validation report passes, rerun is deep-equal", async () => {
    const t = await makeApp();
    const job1 = await runJob(t);
    expect(job1.status).toBe("SUCCEEDED");
    const report = job1.report!;
    expect(report.rowCounts).toMatchObject({ Base: 12, Model: 6, Order: 20 });
    for (const check of report.fkChecks) expect(check, check.check).toMatchObject({ passed: true });
    for (const spot of report.derivationSpotChecks) expect(spot.ok, `${spot.typeKey}.${spot.propKey}`).toBe(true);
    expect(report.views).toEqual(["dash", "risk", "order"]);
    expect(report.accounts).toEqual(["admin", "planner", "base_manager"]);

    const snapshot1 = (await t.repos.objects.list("demo")).sort((a, b) => (a.id < b.id ? -1 : 1));
    const totalFromReport = Object.values(report.rowCounts).reduce((a, b) => a + b, 0);
    expect(snapshot1).toHaveLength(totalFromReport);
    expect(snapshot1.length).toBeGreaterThanOrEqual(12 + 6 + 20);
    // a 常州 base exists
    expect(snapshot1.some((o) => o.type === "Base" && o.props.name === "常州")).toBe(true);

    // idempotent re-run with the same seed: byte-identical objects + report
    const job2 = await runJob(t);
    const snapshot2 = (await t.repos.objects.list("demo")).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(snapshot2).toEqual(snapshot1);
    expect(job2.report).toEqual(job1.report);

    // different seed → different data
    await runJob(t, 7);
    const snapshot3 = (await t.repos.objects.list("demo")).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(snapshot3).not.toEqual(snapshot1);
  });

  it("seeds rules C03/C08/C13 with origin SYNTHETIC; C03 blocks at demandDelta > 0.5", async () => {
    const t = await makeApp();
    await runJob(t);
    const rules = (
      await t.app.inject({ method: "GET", url: "/a/v1/rules?status=PUBLISHED", headers: ADMIN })
    ).json() as { key: string; origin: { type: string }; severity: string }[];
    const keys = rules.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["C03", "C08", "C13"]));
    expect(rules.find((r) => r.key === "C03")!.origin.type).toBe("SYNTHETIC");

    const verdicts = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/rules/evaluate",
        headers: ADMIN,
        payload: { ruleIds: ["C03"], payload: { demandDelta: 0.6 } },
      })
    ).json() as { ruleId: string; passed: boolean; severity: string }[];
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ ruleId: "C03", passed: false, severity: "BLOCK" });

    const pass = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/rules/evaluate",
        headers: ADMIN,
        payload: { ruleIds: "ALL_APPLICABLE", payload: { demandDelta: 0.2, outsourceRatio: 0.5 } },
      })
    ).json() as { ruleId: string; passed: boolean; severity: string }[];
    expect(pass.find((v) => v.ruleId === "C03")!.passed).toBe(true);
    expect(pass.find((v) => v.ruleId === "C08")).toMatchObject({ passed: false, severity: "WARN" });
  });

  it("SY2: cross-module consistency — same numbers come from the same object instance", async () => {
    const t = await makeApp();
    await runJob(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const models = await t.repos.objects.listByType("demo", "Model");
    const bases = await t.repos.objects.listByType("demo", "Base");

    const order = orders[0]!;
    const model = models.find((m) => m.props.modelId === order.props.model)!;
    // ledger detail (Order.qty) aggregates exactly into the dashboard KPI (Model.totalDemand)
    const ledgerSum = orders
      .filter((o) => o.props.model === model.props.modelId)
      .reduce((a, o) => a + (o.props.qty as number), 0);
    expect(model.props.totalDemand).toBe(ledgerSum);

    // base-level commitment derived from the same order instances
    const base = bases.find((b) => b.props.baseId === "changzhou")!;
    const baseSum = orders
      .filter((o) => (o.props.bases as string[]).includes("changzhou"))
      .reduce((a, o) => a + (o.props.qty as number), 0);
    expect(base.props.committedQty).toBe(baseSum);
    expect(base.props.orderCount).toBe(
      orders.filter((o) => (o.props.bases as string[]).includes("changzhou")).length,
    );

    // derived order value comes from the same instance (qty × unitPrice)
    expect(order.props.value).toBe((order.props.qty as number) * (order.props.unitPrice as number));

    // solver input consistency: affected_orders draws from the same Order objects
    const solver = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/solvers/affected_orders/invoke",
        headers: ADMIN,
        payload: { args: { baseId: "changzhou", fromDay: 0, toDay: 7 } },
      })
    ).json() as { data: { affected: { so: string; qty: number }[] } };
    const soSet = new Map(orders.map((o) => [o.props.so as string, o.props.qty as number]));
    for (const a of solver.data.affected) {
      expect(soSet.get(a.so)).toBe(a.qty);
    }
  });

  it("SY3: unknown industry → LLM-generated template, stored for reuse, full flow runs", async () => {
    const t = await makeApp();
    t.llm.enqueue({
      industryKey: "vertical-farming",
      ontology: {
        objectTypes: [
          {
            key: "Farm",
            displayName: "农场",
            properties: [{ propKey: "farmId", dataType: "string", isPrimaryKey: true }],
            derivedProperties: [{ propKey: "batchCount", formula: "COUNT(Batch.batchId BY farm)" }],
          },
          {
            key: "Batch",
            displayName: "批次",
            properties: [
              { propKey: "batchId", dataType: "string", isPrimaryKey: true },
              { propKey: "farm", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Farm" },
              { propKey: "yieldKg", dataType: "number", isPrimaryKey: false },
            ],
            derivedProperties: [],
          },
        ],
        linkTypes: [],
      },
      generation: [
        {
          typeKey: "Farm",
          count: { S: 3, M: 5, L: 10 },
          propGenerators: { farmId: { kind: "pattern", pattern: "FARM-{seq:3}" } },
        },
        {
          typeKey: "Batch",
          count: { S: 9, M: 30, L: 100 },
          propGenerators: {
            batchId: { kind: "pattern", pattern: "B-{seq:4}" },
            farm: { kind: "fkSample", refTypeKey: "Farm" },
            yieldKg: { kind: "number", min: 50, max: 500, precision: 1 },
          },
        },
      ],
      rules: [{ key: "F01", name: "产量下限", expression: "Batch.yieldKg < 50", severity: "WARN" }],
      scenarioSeed: { views: ["dash"], intents: [] },
    });
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "vertical-farming", scale: "S", seed: 1 },
    });
    expect(res.statusCode).toBe(202);
    const job = res.json() as SyntheticJob;
    expect(job.status).toBe("SUCCEEDED");
    expect(job.report!.rowCounts).toMatchObject({ Farm: 3, Batch: 9 });

    // template stored for reuse → rerun must NOT need another LLM call
    expect(t.llm.calls).toHaveLength(1);
    const rerun = await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "vertical-farming", scale: "S", seed: 1 },
    });
    expect(rerun.statusCode).toBe(202);
    expect(t.llm.calls).toHaveLength(1);

    // referential integrity by construction + derivation ran
    const batches = await t.repos.objects.listByType("demo", "Batch");
    const farms = await t.repos.objects.listByType("demo", "Farm");
    const farmIds = new Set(farms.map((f) => f.props.farmId));
    for (const b of batches) expect(farmIds.has(b.props.farm)).toBe(true);
    const totalBatchCount = farms.reduce((a, f) => a + (f.props.batchCount as number), 0);
    expect(totalBatchCount).toBe(9);
  });
});
