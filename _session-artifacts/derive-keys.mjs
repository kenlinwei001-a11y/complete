// Reads a pre-analysis report JSON on stdin, prints sorted propagation_rule/state_var keys.
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  const es = (r.gapAnalysis && r.gapAnalysis.entries) || [];
  const k = es
    .filter((e) => e.kind === "propagation_rule" || e.kind === "state_var")
    .flatMap((e) => e.items.map((i) => `${e.kind}:${i.key}:${i.status}`))
    .sort();
  console.log(k.join("\n"));
});
