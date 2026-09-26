// ⚠ 临时探针（WO-WEIGHT-BASIS-FIELD 取证用），跑完即删 —— 不是门、不入交付。
// 铁律 0.6 判据 3：判「X 是不是某对象的属性」只有一个可靠办法 = 真起数据、真读 o.props[X]。
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import { resolveSimScope } from "@platform/contracts";

const EDGES = [
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
  // 对照：不在名单里的「诚实 equal_share」边（判据 C 反向金丝雀）
  "demo_equipment_load_to_process_queue",
  "demo_inspection_queue_to_material_shortage",
  "demo_process_queue_to_line_blocked",
  "demo_equipment_failure_to_process_queue",
];

describe("tmp field probe", () => {
  it("逐边：真起数据读 o.props，列出源类型上所有数值字段 + 扇入 + 变异度", async () => {
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
    // `graph.objects` 是**裁剪过的投影**（只有 id/typeKey，无 props）—— 实测：直接读 o.props 抛
    // `Cannot convert undefined or null to object`。真 props 走 `repos.objects.listByType`，
    // 与 `pair-weights.ts` 的 `byType()` 同一支。
    const objById = new Map<string, { id: string; props: Record<string, unknown> }>();
    for (const tk of new Set(inp.graph.objects.map((o) => o.typeKey))) {
      for (const o of await t.repos.objects.listByType("demo", tk)) {
        if (!o.mergedInto) objById.set(o.id, { id: o.id, props: o.props });
      }
    }

    for (const key of EDGES) {
      const r = rules.find((x) => x.key === key);
      if (!r) { console.log(`\n### ${key}  ⛔ 规则不存在`); continue; }
      // 本规则的边（与 pair-weights 的 edgesOf 同一判据）
      const edges = inp.graph.links.filter(
        (l) => l.linkKey === r.viaLinkKey && typeOf.get(l.fromId) === r.sourceTypeKey && typeOf.get(l.toId) === r.targetTypeKey,
      );
      const byTarget = new Map<string, string[]>();
      for (const e of edges) (byTarget.get(e.toId) ?? byTarget.set(e.toId, []).get(e.toId)!).push(e.fromId);
      const srcIds = [...new Set(edges.map((e) => e.fromId))];
      const fanins = [...byTarget.values()].map((v) => v.length);
      console.log(
        `\n### ${key}\n  ${r.sourceTypeKey}.${r.sourceStateVar} -> ${r.targetTypeKey}.${r.targetStateVar}` +
          `  basis=${r.weightRef?.basis ?? "null"}  边=${edges.length} 源=${srcIds.length} 目标=${byTarget.size}` +
          `  扇入 min/max/mean=${Math.min(...fanins)}/${Math.max(...fanins)}/${(fanins.reduce((a, b) => a + b, 0) / fanins.length).toFixed(2)}`,
      );
      // 源类型上**真实存在**的数值字段（不是 grep 源码猜的）
      const keyStats = new Map<string, { n: number; pos: number; min: number; max: number }>();
      for (const id of srcIds) {
        const o = objById.get(id);
        if (!o) continue;
        for (const [k, v] of Object.entries(o.props)) {
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          const s = keyStats.get(k) ?? { n: 0, pos: 0, min: Infinity, max: -Infinity };
          s.n += 1; if (v > 0) s.pos += 1; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v);
          keyStats.set(k, s);
        }
      }
      const rows = [...keyStats.entries()]
        .filter(([, s]) => s.pos > 0)
        .sort((a, b) => a[0].localeCompare(b[0]));
      for (const [k, s] of rows) {
        // 组内变异度：有多少个目标组，其组内该字段**不是全部相同**（份额才有意义）
        let varied = 0;
        for (const [, sids] of byTarget) {
          const vals = sids.map((sid) => Number(objById.get(sid)?.props[k] ?? 0));
          if (new Set(vals).size > 1) varied += 1;
        }
        console.log(
          `    ${k.padEnd(26)} 有值 ${s.n}/${srcIds.length}  正 ${s.pos}` +
            `  范围 ${s.min}–${s.max}  组内有差异 ${varied}/${byTarget.size}`,
        );
      }
      if (rows.length === 0) console.log("    （零个正数值字段 ⇒ 本边拿不出计量字段）");
    }
    expect(true).toBe(true);
  }, 300000);
});
