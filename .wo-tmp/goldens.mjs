// 金值现算（不抄派单里的数）。
import { readFileSync } from "node:fs";
const root = process.argv[2] ?? ".";
const R = (p) => readFileSync(`${root}/${p}`, "utf8");

// ① Operation.propCount：`operationProps` 数组里的 `{ propKey: "..." }` 条数。
const bat = R("apps/datacore/src/synthetic/battery.ts");
const opStart = bat.indexOf("const operationProps");
const opEnd = bat.indexOf("\nconst ", opStart + 10);
const opBody = bat.slice(opStart, opEnd);
const opProps = [...opBody.matchAll(/propKey:\s*"(\w+)"/g)].map((m) => m[1]);
console.log(`Operation.propCount = ${opProps.length}  [${opProps.join(",")}]`);

// ② SOLVER_KEYS 条数。
const svc = R("apps/datacore/src/solvers/service.ts");
const sk = svc.indexOf("SOLVER_KEYS");
const openIdx = svc.indexOf("[", sk);
let depth = 0, end = -1;
for (let i = openIdx; i < svc.length; i++) {
  if (svc[i] === "[") depth++;
  else if (svc[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
}
const skBody = svc.slice(openIdx, end + 1).split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const keys = [...skBody.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
console.log(`SOLVER_KEYS = ${new Set(keys).size}（去重后）/ ${keys.length}（字面量数）`);

// ③ B 侧镜像类型数 / 链路数（正则口径，与 mock-engine-parity 头注同款）。
const strip = (s) => s.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const mock = strip(R("apps/agentcore/src/mocks/ontology-graph.ts"));
const mTypes = new Set([...mock.matchAll(/\{\s*key:\s*"(\w+)",\s*domain:\s*"(\w+)"/g)].map((m) => `${m[1]}|${m[2]}`));
const mLinks = new Set([...mock.matchAll(/\{\s*linkKey:\s*"(\w+)",\s*fromTypeKey:\s*"(\w+)",\s*toTypeKey:\s*"(\w+)"/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`));
console.log(`B 侧镜像：类型 ${mTypes.size} · 链路 ${mLinks.size}`);
// 🐤 金丝雀：已知必中 / 已知必不中。
console.log(`🐤 必中 Base|factory=${mTypes.has("Base|factory")} model_producible_at=${mLinks.has("model_producible_at|Model|Base")} · 必不中 Zzz=${!mTypes.has("Zzz|x")}`);
