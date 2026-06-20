import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";

/**
 * 合成数据与字段对齐（用户铁律："所有的合成数据需要与字段对齐"）：出厂合成的每个对象,其属性键必须
 * 全部是该对象类型已建模的属性（无"凭空多出的字段"）;且每个非派生字段都应被合成填上（数据完整、可上传对齐）。
 */
describe("合成数据 ↔ 本体字段对齐", () => {
  it("每个合成对象的属性键 ⊆ 类型已建模属性（无孤儿字段）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await t.repos.ontologyTypes.list("demo");
    const orphans: string[] = [];
    for (const tp of types.filter((x) => x.status === "ACTIVE")) {
      // 已建模 = 声明属性 ∪ 派生属性（派生值会物化到对象上，属正常）。系统字段 __* 豁免。
      const defined = new Set([...tp.properties.map((p) => p.propKey), ...tp.derivedProperties.map((d) => d.propKey)]);
      const objs = await t.repos.objects.listByType("demo", tp.key);
      for (const o of objs) {
        for (const k of Object.keys(o.props)) {
          if (!k.startsWith("__") && !defined.has(k)) orphans.push(`${tp.key}.${k}`);
        }
      }
    }
    expect([...new Set(orphans)].sort()).toEqual([]); // 合成数据未越出本体字段（含派生）
  });

  it("每个非派生字段都被合成填上（按类型抽样首个对象，数据完整可上传对齐）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await t.repos.ontologyTypes.list("demo");
    const missing: string[] = [];
    for (const tp of types.filter((x) => x.status === "ACTIVE")) {
      const objs = await t.repos.objects.listByType("demo", tp.key);
      if (objs.length === 0) continue; // 无实例的类型跳过（非合成域对象）
      const derived = new Set(tp.derivedProperties.map((d) => d.propKey));
      const nonDerived = tp.properties.filter((p) => !derived.has(p.propKey)).map((p) => p.propKey);
      // 该类型所有对象的并集需覆盖全部非派生字段（不同对象可能稀疏，取并集判完整）
      const present = new Set<string>();
      for (const o of objs) for (const k of Object.keys(o.props)) present.add(k);
      for (const f of nonDerived) if (!present.has(f)) missing.push(`${tp.key}.${f}`);
    }
    expect(missing).toEqual([]);
  });
});
