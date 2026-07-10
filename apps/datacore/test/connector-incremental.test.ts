import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/** Create a mock_incremental connection whose upstream rows live in config.rows. */
async function createIncremental(t: TestApp, rows: Record<string, unknown>[]): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/connections",
    headers: ADMIN,
    payload: { connectorTypeKey: "mock_incremental", name: "inc", config: { datasetName: "events", rows } },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const sync = (t: TestApp, connId: string) =>
  t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });

const listDatasets = async (t: TestApp, connId: string) =>
  (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as {
    id: string;
    name: string;
    rowCount: number;
  }[];

const readRows = async (t: TestApp, dsId: string) =>
  ((await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${dsId}/rows`, headers: ADMIN })).json() as {
    rows: Record<string, unknown>[];
  }).rows;

const quarantine = async (t: TestApp) =>
  (await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: ADMIN })).json() as {
    items: { reason: string; detail?: string }[];
    byReason: Record<string, number>;
    total: number;
  };

describe("E1 incremental cursor checkpoint", () => {
  it("persists cursor, resumes across syncs, appends only new rows, no-op when nothing new", async () => {
    const t = await makeApp();
    const connId = await createIncremental(t, [
      { id: 1, val: "a" },
      { id: 2, val: "b" },
    ]);

    // sync 1: full initial pull → 2 rows, cursor persisted at offset 2
    await sync(t, connId);
    let ds = (await listDatasets(t, connId)).find((d) => d.name === "events")!;
    expect(ds.rowCount).toBe(2);
    let conn = await t.repos.connections.get("demo", connId);
    expect(conn!.cursorState?.events).toBe("2");
    const dsId = ds.id;

    // sync 2: no upstream change → no-op (same row count, same cursor, no duplicates)
    await sync(t, connId);
    ds = (await listDatasets(t, connId)).find((d) => d.name === "events")!;
    expect(ds.id).toBe(dsId);
    expect(ds.rowCount).toBe(2);
    conn = await t.repos.connections.get("demo", connId);
    expect(conn!.cursorState?.events).toBe("2");

    // upstream appends a new row
    await t.app.inject({
      method: "PATCH",
      url: `/a/v1/connections/${connId}`,
      headers: ADMIN,
      payload: { config: { datasetName: "events", rows: [{ id: 1, val: "a" }, { id: 2, val: "b" }, { id: 3, val: "c" }] } },
    });

    // sync 3: appends only the new row → cumulative 3, cursor advances to 3
    await sync(t, connId);
    ds = (await listDatasets(t, connId)).find((d) => d.name === "events")!;
    expect(ds.id).toBe(dsId);
    expect(ds.rowCount).toBe(3);
    conn = await t.repos.connections.get("demo", connId);
    expect(conn!.cursorState?.events).toBe("3");
    const rows = await readRows(t, dsId);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);

    // incremental resume did not trigger any schema drift (stable schema)
    expect((await quarantine(t)).total).toBe(0);
  });
});

describe("E1 schema drift detection → quarantine", () => {
  it("first sync is not drift; added/removed/type-changed column records exactly one SCHEMA_DRIFT; stable repeat does not re-quarantine", async () => {
    // NOTE: the rest_api (RowsAdapter) calls fetch twice per sync (listDatasets +
    // fetchBatch), so version by sync boundary: first 2 calls = v1 (sync 1), rest = v2.
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      const rows =
        call <= 2
          ? [
              { id: 1, status: "OPEN", score: 5 },
              { id: 2, status: "CONFIRMED", score: 8 },
            ]
          : [
              { id: 1, region: "east", score: "high" },
              { id: 2, region: "west", score: "low" },
            ];
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const t = await makeApp({ fetchImpl });
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "rest_api", name: "api", config: { url: "https://x/y.json", datasetName: "events" } },
    });
    const connId = (create.json() as { id: string }).id;

    // sync 1 (schema v1): no prior fingerprint → NOT drift
    await sync(t, connId);
    expect((await quarantine(t)).total).toBe(0);

    // sync 2 (schema v2: +region, -status, score number→string): exactly one SCHEMA_DRIFT
    await sync(t, connId);
    const q2 = await quarantine(t);
    expect(q2.total).toBe(1);
    expect(q2.byReason.SCHEMA_DRIFT).toBe(1);
    const detail = q2.items[0]!.detail!;
    expect(detail).toContain("added: [region]");
    expect(detail).toContain("removed: [status]");
    expect(detail).toContain("score number→string");

    // sync 3 (identical to v2): fingerprint updated → no new drift row
    await sync(t, connId);
    const q3 = await quarantine(t);
    expect(q3.total).toBe(1);
    expect(q3.byReason.SCHEMA_DRIFT).toBe(1);
  });
});
