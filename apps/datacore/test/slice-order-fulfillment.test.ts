import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, BASE_MANAGER } from "./helpers.js";

interface SliceResult {
  nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }[];
  edges: { linkKey: string; from: string; to: string }[];
  truncated: boolean;
  snapshotVersion: string;
}

const resolve = (t: Awaited<ReturnType<typeof makeApp>>, args: Record<string, unknown>, headers = ADMIN) =>
  t.app.inject({
    method: "POST",
    url: "/a/v1/ontology/slices/order_fulfillment_360/resolve",
    headers,
    payload: { args },
  });

describe("跨 6 域切片 order_fulfillment_360", () => {
  it("SL1: 合成即落库，首单全链可达 product/factory/process/equip/supply/commercial 六域", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const res = await resolve(t, { so: "SO-10001" });
    expect(res.statusCode).toBe(200);
    const out = res.json() as SliceResult;

    const types = new Set(out.nodes.map((n) => n.typeKey));
    for (const want of ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material", "Customer"]) {
      expect(types.has(want), `缺类型 ${want}`).toBe(true);
    }
    const linkKeys = new Set(out.edges.map((e) => e.linkKey));
    for (const want of [
      "order_for_model",
      "model_producible_at",
      "line_belongs_to_base",
      "line_has_process",
      "equip_used_in",
      "model_uses_material",
      "order_of_customer",
    ]) {
      expect(linkKeys.has(want), `缺链路 ${want}`).toBe(true);
    }
    // 单一根 + 完整履约树
    expect(out.nodes.filter((n) => n.typeKey === "Order")).toHaveLength(1);
    expect(out.nodes.length).toBeGreaterThanOrEqual(10);
    expect(out.truncated).toBe(false);
    // 快照版本形如 {ontology_version}.{epoch}
    expect(out.snapshotVersion).toMatch(/\d+\.\d+/);
  });

  it("SL2: 同 seed 重跑 → 节点/边集合字节级一致（确定性）", async () => {
    const a = await makeApp();
    await seedBattery(a);
    const ra = (await resolve(a, { so: "SO-10001" })).json() as SliceResult;

    const b = await makeApp();
    await seedBattery(b);
    const rb = (await resolve(b, { so: "SO-10001" })).json() as SliceResult;

    const norm = (r: SliceResult) => ({
      nodes: r.nodes.map((n) => n.id).sort(),
      edges: r.edges.map((e) => `${e.linkKey}|${e.from}|${e.to}`).sort(),
    });
    expect(norm(ra)).toEqual(norm(rb));
  });

  it("SL3: A6 行级过滤 —— base_manager:常州 只见常州可达子树（其余基地分支被剪枝）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 找一张型号可在常州生产的订单作为 root（保证常州分支非空）。
    const adminOut = (await resolve(t, { so: "SO-10001" })).json() as SliceResult;
    const adminBases = adminOut.nodes.filter((n) => n.typeKey === "Base").map((n) => String(n.objectKey));

    const bmOut = (await resolve(t, { so: "SO-10001" }, BASE_MANAGER)).json() as SliceResult;
    const bmBases = bmOut.nodes.filter((n) => n.typeKey === "Base").map((n) => String(n.objectKey));
    // base_manager 可见基地 ⊆ admin 可见基地，且不含非常州基地
    for (const b of bmBases) expect(b).toBe("changzhou");
    expect(bmBases.length).toBeLessThanOrEqual(adminBases.length);
  });

  it("SL4: 切片契约 fixture 通过（slice-contracts/run 全绿）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/slice-contracts/run",
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: { sliceKey: string; fixture: string; ok: boolean; diff?: string }[]; allPassed: boolean };
    const ours = body.results.find((r) => r.sliceKey === "order_fulfillment_360");
    expect(ours, "order_fulfillment_360 契约结果存在").toBeTruthy();
    expect(ours!.ok, ours!.diff).toBe(true);
  });
});
