import { readFileSync } from "node:fs";

// 独立复算：不 import 测试里的抽取器，自己跑正则（本注释要求的「第三方口径」）。
const battery = readFileSync("./apps/datacore/src/synthetic/battery.ts", "utf8");
const mock = readFileSync("./apps/agentcore/src/mocks/ontology-graph.ts", "utf8");

// ── 链路：两侧同一条 fromTypeKey 正则 ────────────────────────────────────────
const bLinks = new Set();
for (const m of battery.matchAll(/\{\s*key:\s*"([a-z0-9_]+)",\s*fromTypeKey:\s*"(\w+)",\s*toTypeKey:\s*"(\w+)"/g))
  bLinks.add(`${m[1]}|${m[2]}|${m[3]}`);
const mLinks = new Set();
for (const m of mock.matchAll(/\{\s*linkKey:\s*"([a-z0-9_]+)",\s*fromTypeKey:\s*"(\w+)",\s*toTypeKey:\s*"(\w+)"/g))
  mLinks.add(`${m[1]}|${m[2]}|${m[3]}`);

// ── 类型：battery 侧 plain(/plainD(/{ key:, displayName:, domain: ── mock 侧 { key:, domain: }
const bTypes = new Set();
for (const m of battery.matchAll(/\bplainD?\(\s*"(\w+)"/g)) bTypes.add(m[1]);
for (const m of battery.matchAll(/\{\s*key:\s*"(\w+)",\s*displayName:\s*"[^"]*",\s*domain:\s*"(\w+)"/g)) bTypes.add(m[1]);
const mTypes = new Set();
for (const m of mock.matchAll(/\{\s*key:\s*"(\w+)",\s*domain:\s*"(\w+)"\s*\}/g)) mTypes.add(m[1]);

// ── 金丝雀（必中 / 必不中）────────────────────────────────────────────────────
console.log("金丝雀 links: model_producible_at|Model|Base  battery=" + bLinks.has("model_producible_at|Model|Base") + " mock=" + mLinks.has("model_producible_at|Model|Base"));
console.log("金丝雀 links 合成键必不中: " + bLinks.has("zzz_not_a_link|X|Y"));
console.log("金丝雀 types: Base  battery=" + bTypes.has("Base") + " mock=" + mTypes.has("Base"));
console.log("金丝雀 types 合成键必不中: " + bTypes.has("ZzzNotAType"));

const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();
console.log("\nLINKS  battery=" + bLinks.size + "  mock=" + mLinks.size);
console.log("  missing(battery 有 mock 无) =", JSON.stringify(diff(bLinks, mLinks)));
console.log("  extra  (mock 有 battery 无) =", JSON.stringify(diff(mLinks, bLinks)));
console.log("\nTYPES  battery=" + bTypes.size + "  mock=" + mTypes.size);
console.log("  missing =", JSON.stringify(diff(bTypes, mTypes)));
console.log("  extra   =", JSON.stringify(diff(mTypes, bTypes)));
