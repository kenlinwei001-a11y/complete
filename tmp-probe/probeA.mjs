const H = "demo:admin:admin|planner|catalog_admin";
const BASE = "http://127.0.0.1:4711";
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "X-Debug-User": H, "content-type": "application/json" }, body: JSON.stringify(body) });
  return await r.json();
};
const asm = await post("/a/v1/sim/optimize-pareto/assemble", {});
if (!asm.applicable) { console.log("NOT APPLICABLE", JSON.stringify(asm, null, 2)); process.exit(1); }
const req = asm.request;
console.log("family", req.family);
console.log("objectives", JSON.stringify(req.objectives, null, 1));
console.log("unavailable", JSON.stringify(req.unavailableObjectives.map((u) => u.key)));
console.log("levers", JSON.stringify(req.levers));
console.log("args.orders n =", req.args.orders.length, " lines n =", req.args.lines.length);
console.log("args Σrevenue 亿 =", (req.args.orders.reduce((a, o) => a + o.revenue, 0) / 1e8).toFixed(2));
console.log("args lines", JSON.stringify(req.args.lines).slice(0, 400));
console.log("currencyAligned", req.args.currencyAligned, "assignCostBound", req.args.assignCostBound);
const res = await post("/a/v1/sim/optimize-pareto", req);
if (res.error) { console.log("ERR", JSON.stringify(res.error)); process.exit(1); }
console.log("iterations", res.iterations, "frontier", res.frontier.length, "dominated", res.dominated.length, "residual", res.residual);
console.log("recommendedId", res.recommendedId);
const best = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId);
console.log("best metrics", JSON.stringify(best?.metrics));
if (best) console.log("revenue 亿 =", (best.metrics.revenue / 1e8).toFixed(2), " serviceRate =", (best.metrics.serviceRate * 100).toFixed(1) + "%");
