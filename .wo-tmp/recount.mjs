/**
 * 金值独立复算：**不 import** mock-engine-parity 的抽取器，自己对两份源文件跑同一条正则求差集。
 * （该测试头注明令：不许照抄报错里的 received，必须两侧独立复算。）
 */
import { readFileSync } from "node:fs";
const A = readFileSync("apps/datacore/src/synthetic/battery.ts", "utf8");
const B = readFileSync("apps/agentcore/src/mocks/ontology-graph.ts", "utf8");

// 只取 batteryLinkTypes() 的 return 数组体（粗切：从声明处到文件里下一个 `\n}` 之后的 `export`）。
const start = A.indexOf("export function batteryLinkTypes()");
if (start < 0) throw new Error("工具坏了：找不到 batteryLinkTypes");
const ltText = A.slice(start, A.indexOf("\nexport ", start + 10));
// 剥行注释（`//`），否则注释里举例的 `key: "x", fromTypeKey:` 会被算进去。
const strip = (s) => s.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const RE = /\{\s*key:\s*"(\w+)",\s*fromTypeKey:\s*"(\w+)",\s*toTypeKey:\s*"(\w+)"/g;
const RE_B = /\{\s*linkKey:\s*"(\w+)",\s*fromTypeKey:\s*"(\w+)",\s*toTypeKey:\s*"(\w+)"/g;

const aSet = new Set([...strip(ltText).matchAll(RE)].map((m) => `${m[1]}|${m[2]}|${m[3]}`));
const bSet = new Set([...strip(B).matchAll(RE_B)].map((m) => `${m[1]}|${m[2]}|${m[3]}`));

// 🐤 金丝雀：一条我确定两侧都有的边必中；一条合成键必不中（单向测不出恒真匹配器）。
const canaryHit = aSet.has("model_producible_at|Model|Base") && bSet.has("model_producible_at|Model|Base");
const canaryMiss = !aSet.has("zzz_nonexistent|Foo|Bar") && !bSet.has("zzz_nonexistent|Foo|Bar");
console.log(`🐤 金丝雀：必中=${canaryHit}  必不中=${canaryMiss}${canaryHit && canaryMiss ? "" : "  ⛔ 工具坏了，下面的数不算数"}`);

console.log(`battery(A) 链路 = ${aSet.size}`);
console.log(`mock(B)    链路 = ${bSet.size}`);
console.log(`missing (A 有 B 缺) = ${JSON.stringify([...aSet].filter((k) => !bSet.has(k)))}`);
console.log(`extra   (B 有 A 缺) = ${JSON.stringify([...bSet].filter((k) => !aSet.has(k)))}`);
