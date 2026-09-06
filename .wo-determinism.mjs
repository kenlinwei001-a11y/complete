import { createHash } from "node:crypto";
import { generateBattery } from "./apps/datacore/dist/synthetic/battery.js";

const hashOf = () => {
  const g = generateBattery(42, "S");
  return createHash("sha256").update(JSON.stringify(g)).digest("hex");
};

const h1 = hashOf();
const h2 = hashOf();
console.log("HASH_1 =", h1);
console.log("HASH_2 =", h2);
console.log("IDENTICAL =", h1 === h2);

// 金丝雀：换一个 seed 必须得到**不同**的 hash —— 否则说明我压根没在哈希真数据。
const g3 = generateBattery(43, "S");
const h3 = createHash("sha256").update(JSON.stringify(g3)).digest("hex");
console.log("CANARY seed=43 differs =", h3 !== h1);

// 本单新增/改动的两个集合，单独给 hash（便于说明「哪些集合变了」）。
const g = generateBattery(42, "S");
const opsHash = createHash("sha256").update(JSON.stringify(g.operations)).digest("hex");
console.log("operations n =", g.operations.length, "hash =", opsHash.slice(0, 16));
console.log("operations[1].predecessorOperationId =", g.operations[1].predecessorOperationId);
console.log("operations[0].predecessorOperationId =", JSON.stringify(g.operations[0].predecessorOperationId));
