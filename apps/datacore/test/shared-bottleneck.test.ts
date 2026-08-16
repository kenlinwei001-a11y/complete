import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * PRD-fde §8d/Q4 共享瓶颈求解器（净室,零依赖）：在 P2 造的瓶颈数据上**真答出**"谁挤占谁/哪单降级"——
 * 报表做不到的"对象关系 + 行为规则"联合推理。
 *
 * 故事脚本（~100 字）：星辰、蓝海两单都路由到同一道化成工序(产能 10),需求 7+8=15>10 → 瓶颈真实存在。
 * 蓝海优先级低(2<3)。求解器读对象图、按工序分组、需求和比产能 → 判这道工序是瓶颈、两单争用、蓝海被降级。
 */
describe("PRD-fde §8d/Q4 · shared_bottleneck 求解器（谁挤占谁/哪单降级）", () => {
  async function seedContention(t: TestApp, ctx: AuthCtx) {
    // 本体类型 Proc(procId pk, capacity) / Ord(so pk, procRef→Proc, qty, prio)
    await t.repos.ontologyTypes.put({ id: "ot_proc", tenantId: ctx.tenantId, key: "Proc", displayName: "工序", domain: "process", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] });
    await t.repos.ontologyTypes.put({ id: "ot_ord", tenantId: ctx.tenantId, key: "Ord", displayName: "订单", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "procRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Proc" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "prio", dataType: "number", isPrimaryKey: false }] });
    // 化成工序产能 10；另一道宽松工序产能 100
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_p1", tenantId: ctx.tenantId, type: "Proc", props: { procId: "化成", capacity: 10 } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_p2", tenantId: ctx.tenantId, type: "Proc", props: { procId: "卷绕", capacity: 100 } });
    // 星辰(7,prio3)、蓝海(8,prio2) 都挤化成 → 瓶颈;第三单走卷绕不瓶颈
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_o1", tenantId: ctx.tenantId, type: "Ord", props: { so: "星辰", procRef: "化成", qty: 7, prio: 3 } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_o2", tenantId: ctx.tenantId, type: "Ord", props: { so: "蓝海", procRef: "化成", qty: 8, prio: 2 } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_o3", tenantId: ctx.tenantId, type: "Ord", props: { so: "远景", procRef: "卷绕", qty: 5, prio: 1 } });
  }

  it("读对象图 → 判化成是瓶颈、星辰蓝海争用、蓝海(优先级低)被降级", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedContention(t, ctx);

    const out = await t.services.solvers.invoke(ctx, "shared_bottleneck", {
      resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio",
    });
    const bn = out.bottlenecks as { resourceId: string; capacity: number; demand: number; sharerCount: number }[];
    // 只有化成是瓶颈(需求 15 > 产能 10);卷绕不瓶颈(5 < 100)
    expect(bn.map((b) => b.resourceId)).toEqual(["化成"]);
    expect(bn[0]!.demand).toBe(15);
    expect(bn[0]!.capacity).toBe(10);
    expect(bn[0]!.sharerCount).toBe(2);
    // 谁挤占谁:星辰、蓝海
    const cont = out.contention as { resourceId: string; sharers: string[] }[];
    expect(cont[0]!.sharers.sort()).toEqual(["星辰", "蓝海"].sort());
    // 哪单降级:蓝海(prio 2 < 星辰 3)
    const dg = out.downgraded as { resourceId: string; objectId: string }[];
    expect(dg[0]!.objectId).toBe("蓝海");
    expect(String(out.summary)).toContain("1 个共享瓶颈");
  });

  it("无争用(各走各的) → 零瓶颈;缺参数 → 报错", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await t.repos.ontologyTypes.put({ id: "ot_proc", tenantId: ctx.tenantId, key: "Proc", displayName: "工序", domain: "process", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_p1", tenantId: ctx.tenantId, type: "Proc", props: { procId: "化成", capacity: 100 } });
    const out = await t.services.solvers.invoke(ctx, "shared_bottleneck", { resourceType: "Proc", sharedByType: "Ord", viaField: "procRef" });
    expect((out.bottlenecks as unknown[]).length).toBe(0);

    await expect(t.services.solvers.invoke(ctx, "shared_bottleneck", { resourceType: "Proc" })).rejects.toThrow();
  });
});
