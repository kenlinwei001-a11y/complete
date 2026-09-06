import { createHash } from "node:crypto";
import { generateBattery } from "./apps/datacore/dist/synthetic/battery.js";

const g = generateBattery(42, "S");
const out = {};
for (const k of Object.keys(g).sort()) {
  const v = g[k];
  out[k] = createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16) + "|n=" + (Array.isArray(v) ? v.length : "?");
}
console.log(JSON.stringify(out, null, 0));
