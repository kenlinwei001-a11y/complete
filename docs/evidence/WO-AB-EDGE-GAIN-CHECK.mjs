import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/tmp/wt-ab/apps/datacore/");
const b = require("/tmp/wt-ab/apps/datacore/dist/synthetic/battery.js");
const P = b.PROPAGATION_COEF_PARAMS || {};
const seed = fs.readFileSync("/tmp/wt-ab/apps/datacore/src/seed.ts", "utf8");
const re = /\{\s*\n\s*id: "simpr_[^"]+",\s*\n\s*key: "(demo_[^"]+)",[\s\S]*?description:\s*"([^"]*)"/g;
let m, rows = [];
while ((m = re.exec(seed))) {
  const key = m[1], desc = m[2];
  const dn = [...desc.matchAll(/×\s*([0-9.]+)/g)].map((x) => Number(x[1]));
  const truth = P[key];
  if (dn.length && truth !== undefined) rows.push({ key, dn: dn[dn.length - 1], truth });
}
console.log("配对边数 =", rows.length);
let ok = 0, bad = 0;
for (const r of rows) {
  const q = r.truth / r.dn;
  const good = Math.abs(q - 1) < 1e-5 || Math.abs(q - 0.37) < 1e-4;
  if (good) ok++; else { bad++; console.log("  ❌", r.key, "描述", r.dn, "真值", r.truth, "比", q.toFixed(6)); }
}
console.log(`✅ ${ok} · ❌ ${bad}`);
