/**
 * 标定输入：列出 Model.demandLoad 现有入边的**真实生效系数与口径**。
 * 加边后要按 f_g = min(1, 0.75/S_g) 整格重跑，这四条的现值就是重跑的输入。
 * 只读。
 */
const BASE = "http://127.0.0.1:4001";
const H = { "X-Debug-User": "demo:admin:admin" };
const rules = (await (await fetch(`${BASE}/a/v1/sim/propagation-rules?published=true`, { headers: H })).json()).items ?? [];
const params = (await (await fetch(`${BASE}/a/v1/sim/rule-params`, { headers: H })).json()).items ?? [];

const cell = rules.filter((r) => r.targetTypeKey === "Model" && r.targetStateVar === "demandLoad");
console.log(`# Model.demandLoad 入边 ${cell.length} 条（实测）`);
let S = 0;
for (const r of cell) {
  const p = params.find((x) => x.key === r.key) ?? {};
  const g = p.params?.coefficient ?? p.coefficient ?? null;
  const w = r.weightRef?.basis ?? "equal_share(default)";
  console.log(`  ${r.key}`);
  console.log(`     源 ${r.sourceTypeKey}.${r.sourceStateVar}  combine=${r.combine} delay=${r.delayTicks} weightRef=${w} cadence=${r.cadenceNodeId ?? "-"}`);
  console.log(`     coefficient=${g}  desc="${r.description}"`);
}
console.log(`\n# 供对照：目标格 domain`);
console.log(`  ${JSON.stringify(params.find((x) => x.key === cell[0]?.key)?.params ?? {}, null, 0)}`);

console.log(`\n# ── 目标格所在组的全部边（增益预算按组算）──────────────`);
const grp = [...new Set(cell.map((r) => `${r.targetTypeKey}.${r.targetStateVar}`))];
console.log(`  组 = ${grp.join(", ")} ⇒ 本组就是上面 ${cell.length} 条`);
