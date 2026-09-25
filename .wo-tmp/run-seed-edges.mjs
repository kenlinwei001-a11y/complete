import { edgesVia } from "./probe.mjs";

const TAG = process.argv[3] ?? "?";
console.log(`\n════ 出厂种子边 · ${TAG} (port ${process.argv[2]}) ════`);

const CASES = [
  ["model_in_segment", "Model"],
  ["model_uses_material", "Model"],
  ["material_used_by_model", "Material"],
  ["line_belongs_to_workshop", "Workshop"],
  ["order_to_plantarget", "Order"],
  ["plantarget_ownedby", "PlanTarget"],
  ["base_data_health", "Base"],
  ["scenario_to_capex", "AnnualScenario"],
  ["exc_sourced_from", "ExceptionEvent"],
  // 🐤 金丝雀：一条我确定有实例的出厂边。它报 0 ⇒ 「我的尺子坏了」，上面任何 0 都不算数。
  ["line_belongs_to_base", "Base"],
];

for (const [k, root] of CASES) {
  const g = await edgesVia(`zzseed-${k}`, root, k);
  if (g.err) { console.log(`${k.padEnd(26)} 检索失败 ${g.err}`); continue; }
  const targets = new Set(g.edges.map((e) => e.split("->")[1]));
  console.log(`${k.padEnd(26)} 边=${String(g.edges.length).padStart(5)}  不同目标端=${String(targets.size).padStart(4)}  样例: ${g.edges.slice(0, 2).join(" | ")}`);
  if (k === "model_in_segment") {
    const byTarget = {};
    for (const e of g.edges) { const t = e.split("->")[1]; byTarget[t] = (byTarget[t] ?? 0) + 1; }
    console.log(`   └ 细分分布: ${JSON.stringify(byTarget)}`);
  }
  if (k === "model_uses_material") {
    const byFrom = {};
    for (const e of g.edges) { const f = e.split("->")[0]; byFrom[f] = (byFrom[f] ?? 0) + 1; }
    console.log(`   └ 每型号料数: ${JSON.stringify(byFrom)}`);
  }
}
