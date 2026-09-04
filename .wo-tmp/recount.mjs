// 独立复算（**不 import 测试里的抽取器**）：对 battery.ts 与 ontology-graph.ts 各跑一遍
// 同一条 `fromTypeKey:` 正则，求差集。先跑金丝雀自证正则没瞎。
import { readFileSync } from "node:fs";

const R = /\{[^{}]*?key:\s*"([^"]+)"[^{}]*?fromTypeKey:\s*"([^"]+)"[^{}]*?toTypeKey:\s*"([^"]+)"[^{}]*?\}/g;
const RM = /\{[^{}]*?linkKey:\s*"([^"]+)"[^{}]*?fromTypeKey:\s*"([^"]+)"[^{}]*?toTypeKey:\s*"([^"]+)"[^{}]*?\}/g;

const grab = (file, re) => {
  const src = readFileSync(file, "utf8");
  const out = new Set();
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) out.add(`${m[1]}|${m[2]}|${m[3]}`);
  return out;
};

const A = grab("apps/datacore/src/synthetic/battery.ts", R);
const B = grab("apps/agentcore/src/mocks/ontology-graph.ts", RM);

// 🐤 金丝雀：一条已知必中 ∧ 一个已知不存在必不中 —— 正则若瞎，这里先说话。
const CAN_HIT = "model_producible_at|Model|Base";
const CAN_MISS = "zz_no_such_link|Nope|Nope";
console.log("CANARY battery hit  :", A.has(CAN_HIT));
console.log("CANARY battery miss :", A.has(CAN_MISS));
console.log("CANARY mock    hit  :", B.has(CAN_HIT));
console.log("CANARY mock    miss :", B.has(CAN_MISS));
if (!A.has(CAN_HIT) || A.has(CAN_MISS) || !B.has(CAN_HIT) || B.has(CAN_MISS)) {
  console.log("!! 工具坏了，下面的数不许信");
  process.exit(2);
}
console.log("battery links:", A.size);
console.log("mock    links:", B.size);
console.log("missing (A 有 mock 缺):", [...A].filter((k) => !B.has(k)).sort());
console.log("extra   (mock 有 A 无):", [...B].filter((k) => !A.has(k)).sort());
