import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { profileRows } from "../src/connectors/profiler.js";
import type { RawDataset } from "../src/domain.js";
import { runTransform } from "../src/transform/engine.js";
import type { TransformSpec } from "@platform/contracts";

// ---------------------------------------------------------------------------
// helpers: seed a RawDataset + rows directly through repos (memory)
// ---------------------------------------------------------------------------
async function seedDataset(t: TestApp, name: string, rows: Record<string, unknown>[], syncedAt = "2026-01-01T00:00:00.000Z"): Promise<string> {
  const id = `rds_${name}`;
  const ds: RawDataset = {
    id,
    tenantId: "demo",
    sourceConnId: "conn_test",
    name,
    fields: profileRows(rows),
    rowCount: rows.length,
    syncedAt,
  };
  await t.repos.rawDatasets.put(ds);
  await t.repos.rawRows.replace("demo", id, rows);
  return id;
}

const ORDERS = [
  { so: "SO-1", region: "east", model: "A", qty: 100, price: 10 },
  { so: "SO-2", region: "west", model: "B", qty: 50, price: 20 },
  { so: "SO-3", region: "east", model: "A", qty: 200, price: 10 },
  { so: "SO-4", region: "east", model: "C", qty: 30, price: 5 },
];
const MODELS = [
  { model: "A", chemistry: "NCM" },
  { model: "B", chemistry: "LFP" },
];

async function createSpec(t: TestApp, spec: Record<string, unknown>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/transforms", headers: ADMIN, payload: spec });
  if (res.statusCode !== 201) throw new Error(`create failed ${res.statusCode}: ${res.body}`);
  return (res.json() as { id: string }).id;
}
const materialize = (t: TestApp, id: string) => t.app.inject({ method: "POST", url: `/a/v1/transforms/${id}/materialize`, headers: ADMIN });
const validate = (t: TestApp, id: string) => t.app.inject({ method: "POST", url: `/a/v1/transforms/${id}/validate`, headers: ADMIN });

// ===========================================================================
describe("E2 transform engine · pure ops", () => {
  it("MAP computed column + drop", () => {
    const spec = {
      id: "tf1", tenantId: "demo", name: "m", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "m", kind: "MAP", inputs: ["s"], columns: [{ name: "amount", expr: "qty * price" }], drop: ["price"] },
      ],
    } as unknown as TransformSpec;
    const { rows, columns, lineage } = runTransform(spec, { s: ORDERS });
    expect(rows[0]).toMatchObject({ so: "SO-1", qty: 100, amount: 1000 });
    expect(columns).not.toContain("price");
    expect(columns).toContain("amount");
    const amt = lineage.columns.find((c) => c.outputColumn === "amount")!;
    expect(amt.via).toBe("MAP");
    expect(amt.derivedFrom).toEqual([
      { stepId: "s", column: "price" },
      { stepId: "s", column: "qty" },
    ]);
  });

  it("FILTER keeps matching rows", () => {
    const spec = {
      id: "tf", tenantId: "demo", name: "f", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "f", kind: "FILTER", inputs: ["s"], predicate: "region == 'east' and qty > 50" },
      ],
    } as unknown as TransformSpec;
    const { rows } = runTransform(spec, { s: ORDERS });
    expect(rows.map((r) => r.so)).toEqual(["SO-1", "SO-3"]);
  });

  it("JOIN inner + left (unmatched → null right cols)", () => {
    const inner = {
      id: "tf", tenantId: "demo", name: "j", outputDatasetName: "out",
      steps: [
        { id: "o", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "m", kind: "SOURCE", inputs: [], datasetRef: { name: "models" } },
        { id: "j", kind: "JOIN", inputs: ["o", "m"], left: "o", right: "m", on: [{ leftCol: "model", rightCol: "model" }], type: "inner" },
      ],
    } as unknown as TransformSpec;
    const ri = runTransform(inner, { o: ORDERS, m: MODELS });
    // SO-4 (model C) unmatched → excluded by inner
    expect(ri.rows.map((r) => r.so)).toEqual(["SO-1", "SO-2", "SO-3"]);
    expect(ri.rows[0]).toMatchObject({ so: "SO-1", chemistry: "NCM" });
    // right "model" collides → renamed model_right; lineage traces to right source
    const mr = ri.lineage.columns.find((c) => c.outputColumn === "model_right")!;
    expect(mr.derivedFrom).toEqual([{ stepId: "m", column: "model" }]);
    const chem = ri.lineage.columns.find((c) => c.outputColumn === "chemistry")!;
    expect(chem.derivedFrom).toEqual([{ stepId: "m", column: "chemistry" }]);

    const leftSpec = { ...inner, steps: [inner.steps[0], inner.steps[1], { ...(inner.steps[2] as object), type: "left" }] } as unknown as TransformSpec;
    const rl = runTransform(leftSpec, { o: ORDERS, m: MODELS });
    expect(rl.rows.map((r) => r.so)).toEqual(["SO-1", "SO-2", "SO-3", "SO-4"]);
    const so4 = rl.rows.find((r) => r.so === "SO-4")!;
    expect(so4.chemistry).toBeNull();
  });

  it("AGGREGATE group-by with sum/avg/count/min/max", () => {
    const spec = {
      id: "tf", tenantId: "demo", name: "a", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "a", kind: "AGGREGATE", inputs: ["s"], groupBy: ["region"], aggs: [
          { name: "total", fn: "sum", col: "qty" },
          { name: "avgQty", fn: "avg", col: "qty" },
          { name: "n", fn: "count" },
          { name: "minQty", fn: "min", col: "qty" },
          { name: "maxQty", fn: "max", col: "qty" },
        ] },
      ],
    } as unknown as TransformSpec;
    const { rows, lineage } = runTransform(spec, { s: ORDERS });
    // groups sorted by key: east then west
    expect(rows).toEqual([
      { region: "east", total: 330, avgQty: 110, n: 3, minQty: 30, maxQty: 200 },
      { region: "west", total: 50, avgQty: 50, n: 1, minQty: 50, maxQty: 50 },
    ]);
    const total = lineage.columns.find((c) => c.outputColumn === "total")!;
    expect(total.via).toBe("AGGREGATE");
    expect(total.derivedFrom).toEqual([{ stepId: "s", column: "qty" }]);
    const region = lineage.columns.find((c) => c.outputColumn === "region")!;
    expect(region.derivedFrom).toEqual([{ stepId: "s", column: "region" }]);
  });

  it("WINDOW row_number + running_sum + lag", () => {
    const spec = {
      id: "tf", tenantId: "demo", name: "w", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "w", kind: "WINDOW", inputs: ["s"], partitionBy: ["region"], orderBy: [{ col: "qty", dir: "asc" }], functions: [
          { name: "rn", fn: "row_number" },
          { name: "rk", fn: "rank" },
          { name: "cumQty", fn: "running_sum", col: "qty" },
          { name: "prevQty", fn: "lag", col: "qty" },
        ] },
      ],
    } as unknown as TransformSpec;
    const { rows, lineage } = runTransform(spec, { s: ORDERS });
    // east partition ordered by qty asc: SO-4(30), SO-1(100), SO-3(200)
    const east = rows.filter((r) => r.region === "east");
    const bySo = Object.fromEntries(east.map((r) => [r.so as string, r]));
    expect(bySo["SO-4"]).toMatchObject({ rn: 1, cumQty: 30, prevQty: null });
    expect(bySo["SO-1"]).toMatchObject({ rn: 2, cumQty: 130, prevQty: 30 });
    expect(bySo["SO-3"]).toMatchObject({ rn: 3, cumQty: 330, prevQty: 100 });
    // output preserves input row order
    expect(rows.map((r) => r.so)).toEqual(["SO-1", "SO-2", "SO-3", "SO-4"]);
    const cum = lineage.columns.find((c) => c.outputColumn === "cumQty")!;
    expect(cum.via).toBe("WINDOW");
    expect(cum.derivedFrom).toEqual([{ stepId: "s", column: "qty" }]);
  });

  it("multi-step DAG (SOURCE→FILTER→JOIN→MAP→AGGREGATE) chains + lineage to source", () => {
    const spec = {
      id: "tf", tenantId: "demo", name: "chain", outputDatasetName: "out",
      steps: [
        { id: "o", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "m", kind: "SOURCE", inputs: [], datasetRef: { name: "models" } },
        { id: "f", kind: "FILTER", inputs: ["o"], predicate: "qty >= 50" },
        { id: "j", kind: "JOIN", inputs: ["f", "m"], left: "f", right: "m", on: [{ leftCol: "model", rightCol: "model" }], type: "inner" },
        { id: "mp", kind: "MAP", inputs: ["j"], columns: [{ name: "amount", expr: "qty * price" }] },
        { id: "ag", kind: "AGGREGATE", inputs: ["mp"], groupBy: ["chemistry"], aggs: [{ name: "rev", fn: "sum", col: "amount" }] },
      ],
    } as unknown as TransformSpec;
    const { rows, lineage } = runTransform(spec, { o: ORDERS, m: MODELS });
    // qty>=50 keeps SO-1,SO-2,SO-3; join on model A/B → SO-1(A,1000) SO-3(A,2000) SO-2(B,1000)
    // NCM: 1000+2000=3000 ; LFP: 1000
    expect(rows).toEqual([
      { chemistry: "LFP", rev: 1000 },
      { chemistry: "NCM", rev: 3000 },
    ]);
    // rev traces transitively to the amount→qty/price source columns (origin = MAP-computed amount's origins)
    const rev = lineage.columns.find((c) => c.outputColumn === "rev")!;
    expect(rev.derivedFrom).toEqual([
      { stepId: "o", column: "price" },
      { stepId: "o", column: "qty" },
    ]);
  });

  it("deterministic: same spec+input → identical rows + lineage", () => {
    const spec = {
      id: "tf", tenantId: "demo", name: "d", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "a", kind: "AGGREGATE", inputs: ["s"], groupBy: ["region"], aggs: [{ name: "total", fn: "sum", col: "qty" }] },
      ],
    } as unknown as TransformSpec;
    const r1 = runTransform(spec, { s: ORDERS });
    const r2 = runTransform(spec, { s: ORDERS });
    expect(JSON.stringify(r1.rows)).toEqual(JSON.stringify(r2.rows));
    expect(JSON.stringify(r1.lineage)).toEqual(JSON.stringify(r2.lineage));
  });
});

// ===========================================================================
describe("E2 transform service · validate", () => {
  it("cycle detected", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, {
      name: "cyc", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "a", kind: "MAP", inputs: ["b"], columns: [] },
        { id: "b", kind: "MAP", inputs: ["a"], columns: [] },
      ],
    });
    const res = await validate(t, id);
    const body = res.json() as { ok: boolean; issues: { code: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.code === "CYCLE")).toBe(true);
  });

  it("missing input ref", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, {
      name: "miss", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "f", kind: "FILTER", inputs: ["ghost"], predicate: "qty > 0" },
      ],
    });
    const body = (await validate(t, id)).json() as { ok: boolean; issues: { code: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.code === "INPUT_MISSING")).toBe(true);
  });

  it("unknown column ref", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, {
      name: "col", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "a", kind: "AGGREGATE", inputs: ["s"], groupBy: ["nonexistent"], aggs: [{ name: "n", fn: "count" }] },
      ],
    });
    const body = (await validate(t, id)).json() as { ok: boolean; issues: { code: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.code === "UNKNOWN_COLUMN")).toBe(true);
  });

  it("unresolvable SOURCE dataset", async () => {
    const t = await makeApp();
    const id = await createSpec(t, {
      name: "src", outputDatasetName: "out",
      steps: [{ id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "does-not-exist" } }],
    });
    const body = (await validate(t, id)).json() as { ok: boolean; issues: { code: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.code === "SOURCE_UNRESOLVED")).toBe(true);
  });

  it("valid spec → ok", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, {
      name: "good", outputDatasetName: "out",
      steps: [
        { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
        { id: "a", kind: "AGGREGATE", inputs: ["s"], groupBy: ["region"], aggs: [{ name: "total", fn: "sum", col: "qty" }] },
      ],
    });
    const body = (await validate(t, id)).json() as { ok: boolean; issues: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.issues).toEqual([]);
  });
});

// ===========================================================================
describe("E2 transform service · materialize + incremental", () => {
  const aggSpec = {
    name: "mat", outputDatasetName: "region_totals",
    steps: [
      { id: "s", kind: "SOURCE", inputs: [], datasetRef: { name: "orders" } },
      { id: "a", kind: "AGGREGATE", inputs: ["s"], groupBy: ["region"], aggs: [{ name: "total", fn: "sum", col: "qty" }] },
    ],
  };

  it("materialize produces a RawDataset with correct rows + profiled fields", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, aggSpec);
    const res = await materialize(t, id);
    expect(res.statusCode).toBe(200);
    const run = res.json() as { status: string; outputDatasetId: string; rowsOut: number; epoch: number };
    expect(run.status).toBe("SUCCEEDED");
    expect(run.rowsOut).toBe(2);
    expect(run.epoch).toBeGreaterThan(0);

    const ds = await t.repos.rawDatasets.get("demo", run.outputDatasetId);
    expect(ds?.name).toBe("region_totals");
    expect(ds?.rowCount).toBe(2);
    expect(ds?.fields.map((f) => f.name).sort()).toEqual(["region", "total"]);
    const rows = await t.repos.rawRows.list("demo", run.outputDatasetId);
    expect(rows).toEqual([
      { region: "east", total: 330 },
      { region: "west", total: 50 },
    ]);
  });

  it("re-run with unchanged inputs → SKIPPED_UP_TO_DATE (same output dataset)", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, aggSpec);
    const first = (await materialize(t, id)).json() as { status: string; outputDatasetId: string; epoch: number };
    expect(first.status).toBe("SUCCEEDED");
    const second = (await materialize(t, id)).json() as { status: string; outputDatasetId: string; epoch: number };
    expect(second.status).toBe("SKIPPED_UP_TO_DATE");
    expect(second.outputDatasetId).toBe(first.outputDatasetId);
    expect(second.epoch).toBe(first.epoch); // no new epoch bump on skip
  });

  it("re-run after an input syncedAt changes → recompute", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS, "2026-01-01T00:00:00.000Z");
    const id = await createSpec(t, aggSpec);
    const first = (await materialize(t, id)).json() as { status: string; epoch: number };
    expect(first.status).toBe("SUCCEEDED");
    // input updated: new rows + new syncedAt
    await seedDataset(t, "orders", [...ORDERS, { so: "SO-5", region: "west", model: "B", qty: 25, price: 20 }], "2026-02-01T00:00:00.000Z");
    const second = (await materialize(t, id)).json() as { status: string; epoch: number; outputDatasetId: string };
    expect(second.status).toBe("SUCCEEDED");
    expect(second.epoch).toBeGreaterThan(first.epoch);
    const rows = await t.repos.rawRows.list("demo", second.outputDatasetId);
    expect(rows).toEqual([
      { region: "east", total: 330 },
      { region: "west", total: 75 },
    ]);
  });

  it("lineage endpoint returns latest run lineage; 404 before materialize; identical across runs", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, aggSpec);
    const pre = await t.app.inject({ method: "GET", url: `/a/v1/transforms/${id}/lineage`, headers: ADMIN });
    expect(pre.statusCode).toBe(404);

    await materialize(t, id);
    const l1 = (await t.app.inject({ method: "GET", url: `/a/v1/transforms/${id}/lineage`, headers: ADMIN })).json() as { columns: { outputColumn: string; via: string }[] };
    const total = l1.columns.find((c) => c.outputColumn === "total")!;
    expect(total.via).toBe("AGGREGATE");

    // materialize again (skipped run reuses lineage) → identical
    await materialize(t, id);
    const l2 = (await t.app.inject({ method: "GET", url: `/a/v1/transforms/${id}/lineage`, headers: ADMIN })).json();
    expect(JSON.stringify(l2)).toEqual(JSON.stringify(l1));
  });

  it("tenant isolation: other tenant cannot see the spec (404)", async () => {
    const t = await makeApp();
    await seedDataset(t, "orders", ORDERS);
    const id = await createSpec(t, aggSpec);
    const other = { "x-debug-user": "acme:u1:admin" };
    const res = await t.app.inject({ method: "GET", url: `/a/v1/transforms/${id}`, headers: other });
    expect(res.statusCode).toBe(404);
  });
});
