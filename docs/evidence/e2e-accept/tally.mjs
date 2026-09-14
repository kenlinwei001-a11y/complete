// 汇总各项取证的步数/点击/跳转与命中端口（证明每一次都打的是本单自起的 4051/4052）
import fs from "node:fs";
const files = ["item1-exp-log", "item1-knobs2-log", "item1-sweep-log", "items3to7-log", "item3-log", "item4-log", "item4b-log", "item5-log", "item6-chain-log", "item7-log", "item7-discard-log", "item2-log", "probe-log"];
const rows = [];
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(`docs/evidence/e2e-accept/${f}.json`, "utf8"));
    rows.push({ f, ...j.counters, ports: j.portsHit });
  } catch { rows.push({ f, missing: true }); }
}
let s = 0, c = 0, n = 0;
const allPorts = {};
for (const r of rows) {
  if (r.missing) { console.log(r.f.padEnd(22), "(缺)"); continue; }
  s += r.steps; c += r.clicks; n += r.navs;
  for (const [k, v] of Object.entries(r.ports ?? {})) allPorts[k] = (allPorts[k] ?? 0) + v;
  console.log(r.f.padEnd(22), `steps=${String(r.steps).padStart(2)} clicks=${String(r.clicks).padStart(2)} navs=${String(r.navs).padStart(2)}`, JSON.stringify(r.ports));
}
console.log("\n合计  步数=" + s + "  点击=" + c + "  跳转=" + n);
console.log("命中端口合计:", JSON.stringify(allPorts));
fs.writeFileSync("docs/evidence/e2e-accept/tally.json", JSON.stringify({ rows, total: { steps: s, clicks: c, navs: n }, allPorts }, null, 2));
