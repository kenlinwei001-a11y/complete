import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-MODELING-INTERACTIVE · 已发布对象类型"来源数据集(provenance)"回填（KILL-MOCK：真有源标真源）。
 *
 * 症：合成 A 路（SEED_DEMO 走 viaModelingChain:false）里，batteryObjectTypes 未被 BINDINGS 覆盖的类型
 * 与全部 extendedObjectTypes 出厂 sourceBindings=[] → 已发布本体表大量"无来源"、左栏合成数据集"未建模"。
 * 治：instantiateBattery 末尾按 putAll 实际物化来源回填每个类型的 sourceBindings（指向它真落的 RawDataset）。
 *
 * SEAM-GATE（数据半 × 引擎半）：数据半 = putAll 建 RawDataset；引擎半 = 类型 sourceBindings 指向它。
 * 用 round-trip 驱动接缝：**每个"有物化对象"的类型，其 sourceBindings.dataset 必对应一张真实 RawDataset**
 * —— putAll 漏建表、或回填漏标/标错名，任一半断即红（非各半 unit 各自绿）。
 */
describe("WO-MODELING-INTERACTIVE · 对象类型 provenance 回填（合成 A 路）", () => {
  it("SEAM: 每个已物化对象类型标真实来源数据集，且可溯回真 RawDataset（数据半×引擎半 round-trip）", async () => {
    const t = await makeApp();
    await seedBattery(t); // A 路（viaModelingChain 默认 false，与 SEED_DEMO 一致）

    const types = (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
    ).json() as { key: string; sourceBindings?: { dataset: string; connId: string }[] }[];
    const datasets = (
      await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN })
    ).json() as { name: string }[];
    const dsNames = new Set(datasets.map((d) => d.name));
    const byKey = new Map(types.map((ty) => [ty.key, ty]));
    const stats = (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types/stats", headers: ADMIN })
    ).json() as { stats: { key: string; count: number }[] };

    // 数据半×引擎半 round-trip：凡有物化对象(count>0)的类型 → 必有非空 sourceBindings 且各来源指向真实 RawDataset。
    const materialized = stats.stats.filter((s) => s.count > 0);
    expect(materialized.length).toBeGreaterThanOrEqual(30);
    for (const s of materialized) {
      const ty = byKey.get(s.key)!;
      expect(ty, `类型 ${s.key} 应在已发布本体`).toBeTruthy();
      // 写成 `expect(<集合>.length)` 而不是 `expect(<布尔式>).toBe(true)`：
      // 二者语义等价，但后者把「基数下限」藏进一个布尔里，内层循环就成了"空集恒绿"的形态。
      expect(ty.sourceBindings!.length, `${s.key} 有物化对象却"无来源"`).toBeGreaterThan(0);
      for (const b of ty.sourceBindings!) {
        expect(dsNames.has(b.dataset), `${s.key} 来源 '${b.dataset}' 必对应真实 RawDataset`).toBe(true);
      }
    }

    // 多数已发布类型不再"无来源"（KILL-MOCK 命门）。
    const withSrc = types.filter((ty) => (ty.sourceBindings?.length ?? 0) > 0);
    expect(withSrc.length).toBeGreaterThan(types.length / 2);

    // 具体样例：此前恒 []（extendedObjectTypes）的 Material、未在 BINDINGS 的 battery 类型 AnnualScenario，现均标真源。
    for (const key of ["Material", "AnnualScenario"]) {
      const ty = byKey.get(key)!;
      expect(ty.sourceBindings?.length, `${key} 应有来源绑定`).toBeGreaterThan(0);
      expect(dsNames.has(ty.sourceBindings![0]!.dataset), `${key} 来源应是真实 RawDataset`).toBe(true);
    }

    // BINDINGS 覆盖的类型保留其更细的既有绑定（不被回填覆盖）：Base → mes_base_master。
    expect(byKey.get("Base")!.sourceBindings!.some((b) => b.dataset === "mes_base_master")).toBe(true);
  });

  it("R6 确定性：同 seed 重跑，对象类型 sourceBindings.dataset 集合字节一致", async () => {
    const collect = async (): Promise<string> => {
      const t = await makeApp();
      await seedBattery(t);
      const types = (
        await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
      ).json() as { key: string; sourceBindings?: { dataset: string }[] }[];
      return JSON.stringify(
        types
          .map((ty) => [ty.key, (ty.sourceBindings ?? []).map((b) => b.dataset).sort()] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      );
    };
    expect(await collect()).toBe(await collect());
  });
});
