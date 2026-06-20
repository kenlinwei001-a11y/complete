import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import { generateRelatedDatasets, applyScenarioTopology, type DatasetSpec } from "../src/synthetic/schema-gen.js";
import type { AuthCtx, ObjectInstance } from "../src/domain.js";

/**
 * 大数据量压测（回应"不能只用几条数据测"）：1000 工序 / 10000 订单规模上验证
 * FK 一致生成 + 场景拓扑 + shared_bottleneck 求解 的**正确性 + 规模 + 确定性 + 性能**。
 */
const N_PROC = 1000;
const N_ORD = 10000;
const SHARED = 20; // 把全部订单挤到 20 道工序 → 20 个瓶颈
const SPECS: DatasetSpec[] = [
  { datasetKey: "Proc", rowCount: N_PROC, fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "capacity", dataType: "number" }] },
  { datasetKey: "Ord", rowCount: N_ORD, fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "procRef", dataType: "ref", refToDataset: "Proc" }, { name: "qty", dataType: "number" }, { name: "prio", dataType: "number" }] },
];
function parse(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split("\n");
  return { header: lines[0]!.split(","), rows: lines.slice(1).filter(Boolean).map((l) => l.split(",")) };
}

describe("大数据量压测 · 1000 工序 / 10000 订单", () => {
  it("FK 一致生成在 10k 行规模闭合 + 确定性（R6 字节级一致）", () => {
    const t0 = Date.now();
    const a = generateRelatedDatasets(SPECS, 42);
    const genMs = Date.now() - t0;
    const proc = parse(a.Proc!);
    const ord = parse(a.Ord!);
    expect(proc.rows.length).toBe(N_PROC);
    expect(ord.rows.length).toBe(N_ORD);
    // FK 闭合（全量校验,非抽样）：每个 Ord.procRef ∈ Proc.procId
    const pkSet = new Set(proc.rows.map((r) => r[0]));
    const refIdx = ord.header.indexOf("procRef");
    expect(ord.rows.every((r) => pkSet.has(r[refIdx]!))).toBe(true);
    // 确定性：重生成字节级一致
    expect(generateRelatedDatasets(SPECS, 42).Ord).toEqual(a.Ord);
    console.log(`[stress] gen 11k 行 ${genMs}ms`);
    expect(genMs).toBeLessThan(5000);
  });

  it("场景拓扑在 10k 规模植入争用：全部订单收敛到 20 道工序", () => {
    const scen = applyScenarioTopology(generateRelatedDatasets(SPECS, 42), SPECS, {
      sharedResources: [{ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", count: SHARED }],
      plantedValues: [{ typeKey: "Proc", field: "capacity", value: 5, everyN: 1 }],
    });
    const ord = parse(scen.Ord!);
    const refIdx = ord.header.indexOf("procRef");
    expect(new Set(ord.rows.map((r) => r[refIdx])).size).toBe(SHARED); // 收敛到 20 个
  });

  it("shared_bottleneck 在 10k 对象上正确求解 + 线性性能", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await t.repos.ontologyTypes.put({ id: "ot_p", tenantId: "demo", key: "Proc", displayName: "工序", domain: "process", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] });
    await t.repos.ontologyTypes.put({ id: "ot_o", tenantId: "demo", key: "Ord", displayName: "订单", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "procRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Proc" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "prio", dataType: "number", isPrimaryKey: false }] });

    // 物化 11k 对象（拓扑：全部订单挤 20 道工序,产能植成 5）
    const scen = applyScenarioTopology(generateRelatedDatasets(SPECS, 42), SPECS, {
      sharedResources: [{ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", count: SHARED }],
      plantedValues: [{ typeKey: "Proc", field: "capacity", value: 5, everyN: 1 }],
    });
    const put = async (csv: string, type: string, pk: string) => {
      const p = parse(csv);
      for (const r of p.rows) {
        const props: Record<string, unknown> = {};
        p.header.forEach((h, i) => { props[h] = ["capacity", "qty", "prio"].includes(h) ? Number(r[i]) : r[i]; });
        await t.repos.objects.put({ id: `${type}_${props[pk]}`, tenantId: "demo", type, props } as ObjectInstance);
      }
    };
    await put(scen.Proc!, "Proc", "procId");
    await put(scen.Ord!, "Ord", "so");
    expect((await t.repos.objects.listByType("demo", "Ord")).length).toBe(N_ORD);

    const t0 = Date.now();
    const out = await t.services.solvers.invoke(ctx, "shared_bottleneck", { resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" });
    const solveMs = Date.now() - t0;
    const bn = out.bottlenecks as { resourceId: string; capacity: number; demand: number; sharerCount: number }[];
    // 20 道被挤的工序全是瓶颈（每道 ~500 单需求 >> 产能 5）
    expect(bn.length).toBe(SHARED);
    expect(bn.every((b) => b.demand > b.capacity)).toBe(true);
    expect((out.downgraded as unknown[]).length).toBe(SHARED);
    // 全部 10000 单都在争用名单里
    const totalSharers = (out.contention as { sharers: string[] }[]).reduce((s, c) => s + c.sharers.length, 0);
    expect(totalSharers).toBe(N_ORD);
    console.log(`[stress] solve 11k 对象 ${solveMs}ms · ${bn.length} 瓶颈 · ${totalSharers} 单争用`);
    expect(solveMs).toBeLessThan(10000); // 线性,不应 O(n²) 爆炸
  }, 60000);
});
