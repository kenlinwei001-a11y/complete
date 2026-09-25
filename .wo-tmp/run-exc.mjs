import { edgesVia } from "./probe.mjs";
const KEYS = [
  ["exc_sourced_from", "EquipmentDowntime"],
  ["exc_sourced_from_alarm", "EquipmentAlarm"],
  ["exc_sourced_from_defect", "DefectRecord"],
  ["exc_sourced_from_balance", "MaterialBalance"],
  ["exc_sourced_from_trigger", "TriggerRule"],
  ["line_belongs_to_base", "(🐤 金丝雀)"],
];
let total = 0;
console.log(`\n════ 溯源边拆边后 · 真后端 SEED_DEMO=1 (port ${process.argv[2]}) ════`);
for (const [k, tt] of KEYS) {
  const g = await edgesVia(`zzexc2-${k}`, k === "line_belongs_to_base" ? "Base" : "ExceptionEvent", k);
  if (g.err) { console.log(`${k.padEnd(28)} 检索失败 ${g.err}`); continue; }
  if (k !== "line_belongs_to_base") total += g.edges.length;
  console.log(`${k.padEnd(28)} →${String(tt).padEnd(20)} 检索边=${String(g.edges.length).padStart(4)}`);
}
console.log(`五条合计可检索 = ${total}（修前那一条多态边只看得见 166）`);
