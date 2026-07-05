import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * 轨L 增量2：demo 本体经真建模链产出（chainMode）——provenance（R13）因果真实。
 * 验证根因方案（非 MAP_TO_EXISTING 盖戳捷径）：
 *  - 类型由 publishDraft 真 CREATE（存在性因果由链导致），sourceBindings 真由 publish 读真 rawDataset 算出；
 *  - 确定性策展 PATCH 保留 R14 派生属性 / 中文 displayName / 归域（零回归）；
 *  - obj id 统一 `obj_${type}_${pk}` → 与 A 路基线字节一致；R6 同 seed 重跑一致（无 LLM/时钟/随机）。
 */
describe("轨L 增量2 · demo 本体经真建模链（chainMode·provenance 因果真实）", () => {
  it("viaModelingChain → 34 类型由链 CREATE：sourceBindings 真、派生属性/中文名/域保留、obj id 字节同 A 路", async () => {
    const t = await makeApp();
    // 与 SEED_DEMO 启动路径一致：rawDataset→deriveModeling→确定性策展PATCH→publish→materialize 真链产出。
    await t.services.synthetic.runJob(t.adminCtx, {
      industry: "battery-manufacturing",
      scale: "S",
      seed: 42,
      viaModelingChain: true,
    });

    const types = (await (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
    ).json()) as Array<{
      key: string;
      displayName: string;
      domain: string;
      sourceBindings: Array<{ dataset: string; connId: string }>;
      derivedProperties: Array<{ propKey: string }>;
    }>;
    // 40 类全由链产（WO-7 LabTest·QUERY30-ONTOLOGY-EXT +5：Supplier/BomLine/LtaContract/LaborShift/CarbonPassport）。
    expect(types.length).toBe(40);
    // R13 provenance 因果真实：每类型 sourceBindings 非空且指向同名真 rawDataset（非硬编码模板/非空）。
    for (const ty of types) {
      expect(ty.sourceBindings.length).toBeGreaterThan(0);
      expect(ty.sourceBindings.some((b) => b.dataset === ty.key && !!b.connId)).toBe(true);
    }
    // 零回归：策展元数据（中文名 / 归域 / R14 派生属性叶子）保留。
    const base = types.find((x) => x.key === "Base")!;
    expect(base.displayName).toBe("生产基地");
    expect(base.domain).toBe("factory");
    expect(base.derivedProperties.map((d) => d.propKey).sort()).toEqual(["committedQty", "oeeIndex", "orderCount"]);
    const order = types.find((x) => x.key === "Order")!;
    expect(order.derivedProperties.map((d) => d.propKey)).toContain("value");
    // obj id 字节同 A 路基线：obj_base_changzhou 存在且 origin=MATERIALIZED（真经链物化，R13 可溯 rawDataset）。
    const obj = await t.repos.objects.get("demo", "obj_base_changzhou");
    expect(obj).toBeTruthy();
    expect(obj!.type).toBe("Base");
    expect(obj!.origin.type).toBe("MATERIALIZED");
    expect((obj!.origin as { datasetId?: string }).datasetId).toBeTruthy();
  });

  it("R6 确定性：viaModelingChain 同 seed 重跑 → 类型键集 + 对象 id 集字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      await t.services.synthetic.runJob(t.adminCtx, {
        industry: "battery-manufacturing",
        scale: "S",
        seed: 42,
        viaModelingChain: true,
      });
      const types = (await t.services.ontology.listTypes(t.adminCtx)).map((x) => x.key).sort();
      const objs = (await t.repos.objects.list("demo")).map((o) => o.id).sort();
      return { types, objs };
    };
    const a = await run();
    const b = await run();
    expect(a.types).toEqual(b.types);
    expect(a.objs).toEqual(b.objs);
    expect(a.types.length).toBe(40);
    // 加性冻结超集：467 → 469（+2 RootCauseChain）→ 493（WO-7 +24 LabTest）→ QUERY30-ONTOLOGY-EXT +5 类型实例。
    // 旧对象逐字节不变、一个不少（新类型生成置于 rng 末尾·R6 不移位）；此处只更新计数上界。
    expect(a.objs.length).toBe(560);
  });
});
