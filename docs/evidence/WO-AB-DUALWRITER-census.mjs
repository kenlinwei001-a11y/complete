#!/usr/bin/env node
/** 普查：哪些世界态格子同时被 ≥2 个写入方写。只读源码，不连服务。
 *  写入方 A = PropagationRule（seed.ts，targetTypeKey+targetStateVar）
 *  写入方 B = DerivationSpec（seed-derivation-specs.ts，targetType+targetProp）
 */
import { readFileSync } from "node:fs";
const WT = process.env.WT || "/tmp/wt-ab";
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");

const seed = strip(readFileSync(`${WT}/apps/datacore/src/seed.ts`, "utf8"));
const rules = new Map();          // "Type.var" -> [ruleId,...]
let curId = null, tType = null;
for (const line of seed.split("\n")) {
  const id = line.match(/\bid:\s*"(simpr_[^"]+)"/);            if (id) { curId = id[1]; tType = null; }
  const tk = line.match(/\btargetTypeKey:\s*"([^"]+)"/);        if (tk) tType = tk[1];
  const tv = line.match(/\btargetStateVar:\s*"([^"]+)"/);
  if (tv && tType) { const k = `${tType}.${tv[1]}`; if (!rules.has(k)) rules.set(k, []); if (curId) rules.get(k).push(curId); tType = null; }
}
const specs = strip(readFileSync(`${WT}/apps/datacore/src/seed-derivation-specs.ts`, "utf8"));
const specMap = new Map();        // "Type.prop" -> [specKey,...]
for (const line of specs.split("\n")) {
  const m = line.match(/targetType:\s*"([^"]+)"\s*,\s*targetProp:\s*"([^"]+)"/);
  if (m) { const k = `${m[1]}.${m[2]}`; if (!specMap.has(k)) specMap.set(k, []); const sk = line.match(/specKey:\s*"([^"]+)"/); specMap.get(k).push(sk ? sk[1] : "?"); }
}
const both = [...rules.keys()].filter((k) => specMap.has(k)).sort();
console.log("## 普查：世界态格子的写入方重叠（规则 × 派生规格）");
console.log(`> 源：seed.ts（PropagationRule ${rules.size} 格） · seed-derivation-specs.ts（DerivationSpec ${specMap.size} 格）`);
console.log("");
console.log(`### A · ⛔ 双写入方（既有传导边、又有派生规格）共 ${both.length} 格`);
console.log("格".padEnd(38) + "派生规格".padEnd(30) + "传导规则条数 / id");
for (const k of both) {
  const r = rules.get(k);
  console.log(k.padEnd(38) + specMap.get(k).join(",").padEnd(30) + `${r.length} 条 · ${r.slice(0, 3).join(" ")}${r.length > 3 ? " …" : ""}`);
}
console.log("");
console.log(`### B · 只有传导规则、无派生规格的格（${rules.size - both.length} 格）`);
console.log([...rules.keys()].filter((k) => !specMap.has(k)).sort().map((k) => `  ${k.padEnd(36)} ← ${rules.get(k).length} 条`).join("\n"));
console.log("");
const multi = [...rules.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length);
console.log(`### C · 单格被 ≥2 条传导规则写（同族多源，combine 设计如此）共 ${multi.length} 格`);
for (const [k, v] of multi) console.log(`  ${k.padEnd(36)} ← ${v.length} 条`);
console.log("");
console.log(`汇总：双写入方 ${both.length} 格 · 仅规则 ${rules.size - both.length} 格 · 仅规格 ${[...specMap.keys()].filter((k) => !rules.has(k)).length} 格 · 规则总数 ${[...rules.values()].reduce((a, b) => a + b.length, 0)}`);
console.log(`DONE ${new Date().toISOString()}`);
