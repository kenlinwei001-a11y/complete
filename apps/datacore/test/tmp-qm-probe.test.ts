import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { CUSTOMER_REGISTRY } from "../src/synthetic/battery.js";

describe("TMP 探针 · quote_margin 逐客户", () => {
  it("打印每家客户的 modelId / bomRows / orders 数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const c of CUSTOMER_REGISTRY) {
      const res = await invokeSolver(t, "quote_margin", { custName: c.name });
      if (res.statusCode !== 200) { console.log(`[QM] ${c.name} → HTTP ${res.statusCode} ${res.body.slice(0, 160)}`); continue; }
      const d = (res.json() as { data: Record<string, unknown> }).data;
      const s = d.scope as Record<string, unknown>;
      console.log(`[QM] ${c.name} model=${String(s.modelId)} bomRows=${String(s.bomRows)} orders=${(s.orders as string[]).length} dataMode=${String(s.dataMode)} margin=${String(d.margin)} bomCost=${String((d.breakdown as { bomCost: number }).bomCost)}`);
    }
    expect(true).toBe(true);
  });
});
