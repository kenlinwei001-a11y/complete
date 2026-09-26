// ⚠ 临时探针（WO-WEIGHT-BASIS-FIELD 对照实验），跑完即删 —— 不是门、不入交付。
// 同一个文件跑两次：改种子**之前** = 修前四数；改种子**之后** = 修后四数。
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import { pairWeightKey } from "../src/sim/propagation.js";
import { resolveSimScope } from "@platform/contracts";

const WATCH = [
  "demo_wo_release_to_model_cost",
  "demo_wo_release_to_model_supply_risk",
  "demo_po_expedite_to_supplier_review",
  "demo_po_procurement_delay_to_material_shortage",
  "demo_batch_procurement_delay_to_material_shortage",
  "demo_fg_cover_days_to_model_demand",
  "demo_fg_drawdown_relieves_model_demand",
  "demo_supplier_delay_to_material_shortage",
  "demo_supplier_procurement_delay_to_material_shortage",
  "demo_model_demand_to_base_load",
  // 反向金丝雀（判据 C）：不该动的两条
  "demo_equipment_load_to_process_queue", // 诚实 equal_share
  "demo_material_price_to_model_cost",    // bom_cost_share（扇入多，口径不同）
  "demo_order_cost_to_customer_receivable", // source_value_relative
];

describe("tmp A/B", () => {
  it("Σw 逐目标 + 字段等值核对 + PurchaseOrder.qty 对照实验四数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const inp = await buildPropagationInputs(
      t.repos,
      { tenantId: "demo", userId: "admin", roles: ["admin"] } as never,
      resolveSimScope(null),
      rules,
    );
    const typeOf = new Map(inp.graph.objects.map((o) => [o.id, o.typeKey]));
    const propsOf = new Map<string, Record<string, unknown>>();
    for (const tk of new Set(inp.graph.objects.map((o) => o.typeKey))) {
      for (const o of await t.repos.objects.listByType("demo", tk)) if (!o.mergedInto) propsOf.set(o.id, o.props);
    }

    // ── 字段等值核对：两个候选字段是不是同一个数（判断题要的独立旁证）──────────────
    for (const [tk, a, b] of [
      ["FinishedGoodsInventory", "qtyAvailable", "qtyOnHand"],
      ["Supplier", "contractedSupplyTon", "actualSupplyTon"],
      ["WorkOrder", "qtyPlanned", "qtyActual"],
    ] as const) {
      const rows = (await t.repos.objects.listByType("demo", tk)).filter((o) => !o.mergedInto);
      let same = 0, diff = 0;
      for (const o of rows) if (Number(o.props[a]) === Number(o.props[b])) same += 1; else diff += 1;
      console.log(`[字段等值] ${tk}.${a} vs .${b}: 逐实例相同 ${same} / 不同 ${diff}（共 ${rows.length}）`);
    }

    // ── Σw 逐目标（判据 B / C）──────────────────────────────────────────────────
    console.log("\n[Σw 逐目标]");
    for (const key of WATCH) {
      const r = rules.find((x) => x.key === key);
      if (!r) { console.log(`  ${key}  ⛔ 不存在`); continue; }
      const w = inp.pairWeights[r.key] ?? null;
      const byTarget = new Map<string, number>();
      for (const l of inp.graph.links) {
        if (l.linkKey !== r.viaLinkKey) continue;
        if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
        byTarget.set(l.toId, (byTarget.get(l.toId) ?? 0) + (w === null ? 1 : (w[pairWeightKey(l.fromId, l.toId)] ?? 0)));
      }
      const sums = [...byTarget.values()];
      const uniq = [...new Set(sums.map((x) => x.toFixed(12)))].sort();
      const unres = (inp.pairWeightReport.unresolved ?? []).filter((u) => u.ruleKey === key);
      console.log(
        `  ${key.padEnd(50)} basis=${(r.weightRef?.basis ?? "null").padEnd(20)} field=${String(r.weightRef?.field ?? "-").padEnd(20)}` +
          ` 目标=${byTarget.size} Σw∈{${uniq.join(", ")}}${unres.length > 0 ? `  ⚠unresolved: ${unres[0]!.reason.slice(0, 80)}` : ""}`,
      );
    }

    // ── 对照实验（判据 A）：PurchaseOrder.qty 差异最大的一组 ───────────────────────
    const RULE = "demo_po_expedite_to_supplier_review";
    const r = rules.find((x) => x.key === RULE)!;
    const bySupplier = new Map<string, string[]>();
    for (const l of inp.graph.links) {
      if (l.linkKey !== r.viaLinkKey) continue;
      if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
      (bySupplier.get(l.toId) ?? bySupplier.set(l.toId, []).get(l.toId)!).push(l.fromId);
    }
    // 挑「组内 qty 极差最大」的那个供应商（R6：平手按 id 升序）
    const ranked = [...bySupplier.entries()]
      .filter(([, pos]) => pos.length >= 2)
      .map(([sup, pos]) => {
        const qs = pos.map((p) => ({ id: p, q: Number(propsOf.get(p)?.qty ?? 0) })).sort((a, b) => a.q - b.q || a.id.localeCompare(b.id));
        return { sup, qs, spread: qs[qs.length - 1]!.q / Math.max(1, qs[0]!.q) };
      })
      .sort((a, b) => b.spread - a.spread || a.sup.localeCompare(b.sup));
    const pick = ranked[0]!;
    const lo = pick.qs[0]!, hi = pick.qs[pick.qs.length - 1]!;
    console.log(
      `\n[对照实验] 供应商 ${pick.sup}  组内 ${pick.qs.length} 张 PO  qty=${pick.qs.map((x) => x.q).join("/")}` +
        `  Σqty=${pick.qs.reduce((s, x) => s + x.q, 0)}  极差 ${pick.spread.toFixed(3)}×`,
    );
    const COEFF = r.coefficient;
    console.log(`  系数=${COEFF}  delayTicks=${r.delayTicks}`);
    const drive = async (poId: string) => {
      const mk = await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [poId]: { expeditePressure: 15 }, [pick.sup]: { reviewPressure: 0 } } },
      });
      expect(mk.statusCode, mk.body.slice(0, 200)).toBeLessThan(400);
      const sid = (mk.json() as { id: string }).id;
      const tk = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 2 },
      });
      expect(tk.statusCode, tk.body.slice(0, 300)).toBeLessThan(400);
      const body = tk.json() as {
        state: Record<string, Record<string, number>>;
        pairWeighting?: { report: { explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number; numerator: number; denominator: number; formula: string }[]; unresolved: { ruleKey: string; reason: string }[] } };
      };
      const bad = (body.pairWeighting?.report.unresolved ?? []).filter((u) => u.ruleKey === RULE);
      const ex = body.pairWeighting?.report.explain.find((e) => e.ruleKey === RULE && e.sourceObjectId === poId && e.targetObjectId === pick.sup);
      return { read: body.state[pick.sup]?.reviewPressure ?? 0, ex, bad };
    };
    const rLo = await drive(lo.id), rHi = await drive(hi.id);
    console.log(`  ↓ 小单 ${lo.id} qty=${lo.q}  →  Supplier.reviewPressure = ${rLo.read}   w=${rLo.ex?.weight ?? "—"}`);
    console.log(`     formula: ${rLo.ex?.formula ?? "（无 explain）"}`);
    console.log(`  ↑ 大单 ${hi.id} qty=${hi.q}  →  Supplier.reviewPressure = ${rHi.read}   w=${rHi.ex?.weight ?? "—"}`);
    console.log(`     formula: ${rHi.ex?.formula ?? "（无 explain）"}`);
    console.log(`  两数相同？ ${rLo.read === rHi.read ? "**是 —— 平摊的指纹**" : `否，比值 ${(rHi.read / rLo.read).toFixed(6)}（qty 比 ${(hi.q / lo.q).toFixed(6)}）`}`);
    if (rLo.bad.length > 0) console.log(`  ⚠ unresolved: ${rLo.bad[0]!.reason}`);
    expect(true).toBe(true);
  }, 300000);
});
