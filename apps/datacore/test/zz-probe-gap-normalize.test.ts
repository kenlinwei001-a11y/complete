import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

describe("PROBE · gap_attribution 缺省根指标选法", () => {
  it("现状：全部 Metric 的 key/unit/target/actual/floorVal + 越线集 + 缺省根", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rows = (await t.repos.objects.listByType(ADMIN.tenantId, "Metric")).map((o) => o.props);
    const table = rows.map((p) => ({
      metricId: String(p.metricId), key: String(p.key), unit: String(p.unit), level: String(p.level),
      target: Number(p.target), actual: Number(p.actual), floorVal: Number(p.floorVal),
      absGap: Number(p.target) - Number(p.actual),
      relGap: (Number(p.target) - Number(p.actual)) / Math.abs(Number(p.target)),
      breached: Number(p.actual) < Number(p.floorVal),
    }));
    // eslint-disable-next-line no-console
    console.log("=== ALL METRICS ===");
    for (const r of table) {
      // eslint-disable-next-line no-console
      console.log(`${r.metricId.padEnd(16)} key=${r.key.padEnd(18)} lvl=${r.level.padEnd(5)} unit=${r.unit.padEnd(3)} tgt=${r.target} act=${r.actual} floor=${r.floorVal} absGap=${r.absGap.toFixed(4)} relGap=${r.relGap.toFixed(4)} breached=${r.breached}`);
    }
    const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", {})) as unknown as {
      rootMetric: { key: string; name: string; gap: number; unit: string };
    };
    // eslint-disable-next-line no-console
    console.log("=== DEFAULT ROOT ===", JSON.stringify(g.rootMetric));
    expect(g.rootMetric).toBeTruthy();
  });

  it("PRE-EXISTING?：显式 metricKey=revenue + scope.baseId=jiangmen ⇒ scope 回显了吗", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const mk of ["revenue", "cash", "demand_attain", "seg_attain_ess", "gross_profit"]) {
      const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", {
        metricKey: mk, scope: { baseId: "jiangmen" },
      })) as unknown as { scope?: { baseId?: string }; levels: { depth: number; nodes: { id: string }[] }[] };
      const l1 = g.levels.find((L) => L.depth === 1);
      // eslint-disable-next-line no-console
      console.log(`metricKey=${mk.padEnd(16)} scope.baseId=${String(g.scope?.baseId)} L1nodes=[${(l1?.nodes ?? []).map((n) => n.id).join(",")}]`);
    }
    expect(true).toBe(true);
  });
});
