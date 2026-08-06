import { describe, it } from "vitest";
import { invokeSolver, makeApp, seedBattery } from "./helpers.js";

// 临时探针（验完即删）：把 kit_readiness 真实返回的采购段分解打出来，
// 人眼确认"能答出该找谁"，而不是只看测试绿。
describe("TMP D2 probe", () => {
  it("dump", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.repos.objects.put({
      id: "obj_order_SO-0001",
      tenantId: "demo",
      type: "Order",
      props: { so: "SO-0001", cust: "缺料压测客户", model: "4680-NCM", qty: 90000, due: "2026-09-01", status: "OPEN" },
      origin: { type: "SYNTHETIC" },
    });
    const res = await invokeSolver(t, "kit_readiness", {});
    const rows = (res.json().data as { rows: Record<string, unknown>[] }).rows;
    const row = rows.find((r) => r.orderId === "SO-0001")!;
    console.log("\n===== 整单 =====");
    console.log("orderId", row.orderId, "| kitRatio", row.kitRatio, "| earliestKitDay", row.earliestKitDay, "|", row.earliestKitDayStatus);
    for (const it2 of row.shortItems as Record<string, unknown>[]) {
      const p = it2.procurement as Record<string, unknown> | undefined;
      if (p === undefined) continue;
      console.log(`\n----- 缺料项 ${it2.material}（缺 ${it2.shortage}）-----`);
      console.log(`  供应商 ${p.supplierName}(${p.supplierId})  MOQ=${p.minOrderQty} → 实际采购 ${p.replenishQty} (MOQ抬高=${p.moqApplied})`);
      console.log(`  准时率 ${p.onTimeRate} → 期望滑期 ${p.expectedSlipDays} 天；承诺齐套日 ${p.earliestKitDay} / 期望齐套日 ${p.expectedKitDay}`);
      const lt = p.leadTime as { legs: Record<string, unknown>[]; totalDays: number | null };
      for (const l of lt.legs) console.log(`    ${String(l.leg).padEnd(20)} ${String(l.owner).padEnd(15)} ${String(l.days).padStart(6)}天  ${l.status}  责任方=${l.ownerRef ?? "—"} ${l.reason ? "· " + l.reason : ""}`);
      console.log(`    ${"合计".padEnd(20)} ${"".padEnd(15)} ${String(lt.totalDays).padStart(6)}天`);
      console.log(`  最该找：`, it2.criticalLeg);
      console.log(`  按责任方：`, JSON.stringify((it2.ownerDays as Record<string, unknown>).days));
    }
  });
});
