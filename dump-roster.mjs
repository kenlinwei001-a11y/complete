import { readFileSync } from "node:fs";
import { computeRoster, SIM_SOURCE_FILES } from "./scripts/lib/sim-page-roster.mjs";
const texts = Object.fromEntries(Object.entries(SIM_SOURCE_FILES).map(([k, p]) => [k, readFileSync(p, "utf8")]));
const r = computeRoster(texts);
console.log("=== pages (" + r.pages.length + ") ===");
for (const p of r.pages) console.log(p.key.padEnd(20), "|", p.why.join(" ; "));
console.log("\n=== byRule ===");
for (const [k, v] of Object.entries(r.sources.byRule)) console.log(k, "(" + v.length + ")", v.join(" "));
