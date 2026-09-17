import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";

describe("SCRATCH PROPS", () => {
  it("dump props of candidate source types", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const objs = await t.repos.objects.list("demo");
    for (const tk of ["FinishedGoodsInventory", "Line", "WorkOrder", "Order", "Model", "InventoryTxn", "CapacityPool", "MaterialBatch", "OrderPromise"]) {
      const sample = objs.filter((o) => o.type === tk);
      if (sample.length === 0) { console.log(`${tk}: NONE`); continue; }
      const s = sample[0]!;
      const withQty = sample.filter((o) => typeof o.props.qty === "number" && (o.props.qty as number) > 0).length;
      console.log(`--- ${tk} (n=${sample.length}, qty>0: ${withQty}) keys=${Object.keys(s.props).join(",")}`);
      console.log(`    sample=${JSON.stringify(s.props).slice(0, 400)}`);
    }
    expect(objs.length).toBeGreaterThan(0);
  }, 300_000);
});
