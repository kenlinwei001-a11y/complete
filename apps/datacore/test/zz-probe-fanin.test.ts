/**
 * 🔬 临时探针（**不提交**）：实测 5 条 `weightRef: null` 边的**逐目标扇入 N**。
 *
 * 为什么必须真起数据而不是 grep：`weightRef: null` 的语义是「每源各加一份满额」
 * ⇒ Σw = N ⇒ 该边对落点格增益预算（`Σ_e g_e × W_e ≤ 0.75`）的占用是 **g × N**。
 * N 是**链路物化之后的图形状**，源码里一个字都看不见。
 */
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";

const EDGES = [
  { edge: "demo_alt_switch_to_material_shortage", via: "alt_for_material", tgt: "Material.shortageRisk", g: -0.111 },
  { edge: "demo_inspection_queue_to_material_shortage", via: "inspection_for_material", tgt: "Material.shortageRisk", g: 0.074 },
  { edge: "demo_balance_gap_to_po_expedite", via: "balance_drives_po", tgt: "PurchaseOrder.expeditePressure", g: 0.185 },
  { edge: "demo_equipment_load_to_process_queue", via: "equip_used_in", tgt: "Process.queuePressure", g: 0.185 },
  { edge: "demo_fg_cover_days_to_model_demand", via: "fg_of_model", tgt: "Model.demandLoad", g: -0.185 },
];

describe("🔬 PROBE 扇入", () => {
  it("逐目标扇入 N", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = await t.repos.links.list("demo");

    // 🐤 金丝雀：一个已知必中的链路必须量得到（证明量法活着，不是"图是空的"）。
    const canaryN = all.filter((l) => l.type === "material_used_by_model").length;
    // eslint-disable-next-line no-console
    console.log(`\n🐤 金丝雀 material_used_by_model 边数 = ${canaryN}（已登记实测 42；为 0 ⇒ 量法坏了，不许读成"图是空的"）`);
    expect(canaryN, "金丝雀链路必须非空").toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(`\n总边数 = ${all.length}；链路类型数 = ${new Set(all.map((l) => l.type)).size}\n`);
    for (const { edge, via, tgt, g } of EDGES) {
      const rows = all.filter((l) => l.type === via);
      const byTarget = new Map<string, number>();
      for (const l of rows) byTarget.set(l.toId, (byTarget.get(l.toId) ?? 0) + 1);
      const ns = [...byTarget.values()];
      const max = ns.length ? Math.max(...ns) : 0;
      const min = ns.length ? Math.min(...ns) : 0;
      const mean = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
      // eslint-disable-next-line no-console
      console.log(
        `${edge}\n` +
          `    via=${via}  边数=${rows.length}  目标数=${byTarget.size}  扇入 N: min=${min} max=${max} mean=${mean.toFixed(3)}\n` +
          `    g=${g}  ⇒ 该边预算占用 g×W(=N) 最坏 = ${(Math.abs(g) * max).toFixed(6)}  (预算上限 0.75)\n`,
      );
    }
    expect(true).toBe(true);
  }, 120_000);
});
