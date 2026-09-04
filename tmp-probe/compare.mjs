import { deriveParetoMetrics, declaredObjectiveKeys, normalizeParetoWeights, rankParetoByWeights } from "../packages/contracts/dist/index.js";
const H = "demo:admin:admin|planner|catalog_admin";
const BASE = "http://127.0.0.1:4711";
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "X-Debug-User": H, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(p + " " + JSON.stringify(j.error));
  return j;
};
const asm = await post("/a/v1/sim/optimize-pareto/assemble", {});
const req = asm.request;
const ENGINE_W = ["revenue", "penalty", "cost"];

/** B 的路径：装配器 args（可施加杠杆档位）→ cross_object_occupancy → 契约包唯一那份读数折算。 */
export async function readB(leverSetting, weights) {
  const args = structuredClone(req.args);
  for (const l of leverSetting ?? []) {
    const [, id] = l.key.match(/^lines\.(.+)\.capacity$/);
    args.lines.find((x) => x.id === id).capacity = l.value;
  }
  // 权重不进 args（与面板改后一致：权重只排名次，不改解集）
  const out = await post("/a/v1/solvers/cross_object_occupancy/invoke", { args });
  return deriveParetoMetrics(out.data, declaredObjectiveKeys(req.objectives));
}
/** A 的路径：optimize-pareto 全网格。 */
export async function readA(weights) {
  return await post("/a/v1/sim/optimize-pareto", { ...req, weights });
}
export { req, ENGINE_W };

if (process.argv[2] === "run") {
  const w = { margin: 1, serviceRate: 1, revenue: 1, cost: 1 };
  const res = await readA(w);
  const pick = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId);
  const b = await readB(pick.levers, normalizeParetoWeights(res.objectives, w));
  console.log("杠杆:", pick.levers.map((l) => `${l.label ?? l.key}=${l.value}`).join(" · "));
  console.log("\n轴 | A 读数 | B 读数 | 一致");
  for (const o of res.objectives) {
    const a = pick.metrics[o.key], bb = b[o.key];
    console.log(`${o.key} | ${a} | ${bb} | ${a === bb ? "✓" : "✗"}`);
  }
  for (const g of req.unavailableObjectives) console.log(`${g.key} | 本系统今天算不出 | 本系统今天算不出 | ✓（缺席位·两侧同一份）`);
}
