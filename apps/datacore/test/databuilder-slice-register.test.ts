import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

/**
 * 故事倒推切片落库：build 成功后把 plan.sliceNeeds 注册为真实 SliceSpec → 切片库
 * （GET /a/v1/ontology/slices）能看到每条故事倒推的本体切片（此前只记 key、库里看不到）。
 *
 * 故事脚本（~100 字）：管理员用"常州基地产能紧张、影响订单交期与客户信用、请做风险推演"建域。
 * 此前切片库空空、看不到这次倒推的切片；修复后建完即在切片库看到 slice_order/slice_base/
 * slice_customer 三条（rootType 对应 Order/Base/Customer、带契约 fixture），R2 租户隔离。
 */
const STORY = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";
type SliceRow = { sliceKey: string; rootType: string; fixtures: number };
const listSlices = async (app: { inject: (o: unknown) => Promise<{ json: () => unknown }> }, headers: Record<string, string>) =>
  (await (await app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers })).json()) as SliceRow[];

describe("故事倒推切片落库 → 切片库可见", () => {
  it("建域后倒推切片注册进切片库（slice_order/base/customer），带 rootType + fixture", async () => {
    const t = await makeApp();
    const before = new Set((await listSlices(t.app, ADMIN)).map((s) => s.sliceKey));

    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: STORY, seed: 11 } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { status: string }).status).toBe("SUCCEEDED");

    const after = await listSlices(t.app, ADMIN);
    const newOnes = after.filter((s) => !before.has(s.sliceKey));
    const keys = newOnes.map((s) => s.sliceKey).sort();
    // 倒推的三类对象 → 三条切片新入库
    expect(keys).toEqual(["slice_base", "slice_customer", "slice_order"]);
    // rootType 正确对应
    expect(after.find((s) => s.sliceKey === "slice_order")!.rootType).toBe("Order");
    expect(after.find((s) => s.sliceKey === "slice_base")!.rootType).toBe("Base");
    // 每条切片带契约 fixture（治理 §7.2，库里展示 fixtures>0）
    for (const s of newOnes) expect(s.fixtures).toBeGreaterThanOrEqual(1);
  });

  it("幂等（R6）：同故事同 seed 重建不产生重复切片", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: STORY, seed: 11 } });
    const once = (await listSlices(t.app, ADMIN)).filter((s) => s.sliceKey.startsWith("slice_")).length;
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: STORY, seed: 11 } });
    const twice = (await listSlices(t.app, ADMIN)).filter((s) => s.sliceKey.startsWith("slice_")).length;
    expect(twice).toBe(once); // 同 key 覆盖，无重复
  });

  it("R2 隔离：别的租户切片库看不到本租户倒推的切片", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: STORY, seed: 11 } });
    const other = await listSlices(t.app, debugUser("other-tenant", "u2", "admin"));
    expect(other.some((s) => s.sliceKey === "slice_order")).toBe(false);
  });
});
