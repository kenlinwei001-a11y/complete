import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx, ObjectTypeDef, PropertyDef } from "../src/domain.js";

const CTX: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

/** Minimal type with one temporal prop (oee_current) and one non-temporal prop (takt). */
async function seedEquipment(t: TestApp): Promise<void> {
  const prop = (propKey: string, opts: Partial<PropertyDef> = {}): PropertyDef => ({
    propKey,
    dataType: "number",
    isPrimaryKey: false,
    ...opts,
  });
  const ty: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> = {
    key: "Equipment",
    displayName: "设备",
    properties: [
      prop("equipId", { dataType: "string", isPrimaryKey: true }),
      prop("takt"),
      prop("oee_current", { temporal: true }),
    ],
    derivedProperties: [],
    sourceBindings: [],
  };
  await t.services.ontology.upsertType(CTX, ty);
  await t.services.ontology.publishVersion(CTX);
}

const query = (t: TestApp, asOfEpoch?: number) =>
  t.services.ontology.queryObjects(CTX, "Equipment", { equipId: "EQ1" }, 10, asOfEpoch);

describe("并发一致性 §13.1 — 任务级快照读（CC1/CC2）", () => {
  it("CC1: temporal 属性任务执行中被改 → asOfEpoch 读到 taskEpoch 时值；任务后读到新值", async () => {
    const t = await makeApp();
    await seedEquipment(t);
    const e1 = await t.services.ontologyCore.beginEpoch("demo");
    await t.services.ontologyCore.upsertObject(CTX, "Equipment", "EQ1", { equipId: "EQ1", takt: 30, oee_current: 0.8 }, { epoch: e1 });
    const taskEpoch = e1;
    // concurrent temporal write mid-task
    const e2 = await t.services.ontologyCore.beginEpoch("demo");
    await t.services.ontologyCore.upsertObject(CTX, "Equipment", "EQ1", { oee_current: 0.95 }, { epoch: e2 });

    const snap = (await query(t, taskEpoch)).data as { props: Record<string, unknown>; epochApprox?: boolean }[];
    expect(snap[0]!.props.oee_current).toBe(0.8); // rolled back to taskEpoch value
    expect(snap[0]!.epochApprox).toBeUndefined(); // exact: only a temporal prop changed

    const live = (await query(t)).data as { props: Record<string, unknown> }[];
    expect(live[0]!.props.oee_current).toBe(0.95); // a later task sees the new value
  });

  it("CC2: 非 temporal 属性被改 → 结果带 epochApprox 且指标 dc_epoch_approx_reads_total +1", async () => {
    const t = await makeApp();
    await seedEquipment(t);
    const e1 = await t.services.ontologyCore.beginEpoch("demo");
    await t.services.ontologyCore.upsertObject(CTX, "Equipment", "EQ1", { equipId: "EQ1", takt: 30, oee_current: 0.8 }, { epoch: e1 });
    const taskEpoch = e1;
    const e2 = await t.services.ontologyCore.beginEpoch("demo");
    await t.services.ontologyCore.upsertObject(CTX, "Equipment", "EQ1", { takt: 25 }, { epoch: e2 });

    const before = t.services.metrics.get("dc_epoch_approx_reads_total", { type: "Equipment" });
    const snap = (await query(t, taskEpoch)).data as { props: Record<string, unknown>; epochApprox?: boolean }[];
    expect(snap[0]!.epochApprox).toBe(true); // non-temporal change cannot be rolled back — honestly flagged
    expect(snap[0]!.props.takt).toBe(25); // current value returned
    expect(t.services.metrics.get("dc_epoch_approx_reads_total", { type: "Equipment" })).toBe(before + 1);
  });

  it("objects untouched since the snapshot read exactly (no approx flag)", async () => {
    const t = await makeApp();
    await seedEquipment(t);
    const e1 = await t.services.ontologyCore.beginEpoch("demo");
    await t.services.ontologyCore.upsertObject(CTX, "Equipment", "EQ1", { equipId: "EQ1", takt: 30, oee_current: 0.8 }, { epoch: e1 });
    // advance epoch without touching EQ1
    await t.services.ontologyCore.beginEpoch("demo");
    const snap = (await query(t, await t.repos.epochs.current("demo"))).data as { epochApprox?: boolean; props: Record<string, unknown> }[];
    expect(snap[0]!.epochApprox).toBeUndefined();
    expect(snap[0]!.props.takt).toBe(30);
  });

  it("GET /a/v1/epoch/current exposes taskEpoch capture point", async () => {
    const t = await makeApp();
    await seedEquipment(t);
    await t.services.ontologyCore.beginEpoch("demo");
    const res = await t.app.inject({ method: "GET", url: "/a/v1/epoch/current", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { epoch: number; snapshotVersion: string };
    expect(body.epoch).toBeGreaterThanOrEqual(1);
    expect(body.snapshotVersion).toContain(".");
  });
});
