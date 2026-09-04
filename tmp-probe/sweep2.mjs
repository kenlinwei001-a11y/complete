import { readA, readB, req } from "./compare.mjs";
import { normalizeParetoWeights } from "../packages/contracts/dist/index.js";
const yi = (x) => (x / 1e8).toFixed(2);
console.log("wCost | A 推荐解 | A 营收(亿) | A 成本(亿) | A 获排率 || B 营收(亿) | B 成本(亿) | B 获排率");
for (const wCost of [0, 1, 4, 16, 32]) {
  const w = { margin: 1, serviceRate: 1, revenue: 1, cost: wCost };
  const res = await readA(w);
  const pick = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId);
  const b = await readB(pick.levers, normalizeParetoWeights(res.objectives, w));
  const cap = pick.levers.map((l) => l.value).join("/");
  console.log(
    `${wCost} | cap=${cap} | ${yi(pick.metrics.revenue)} | ${yi(pick.metrics.cost)} | ${(pick.metrics.serviceRate * 100).toFixed(2)}% || ` +
    `${yi(b.revenue)} | ${yi(b.cost)} | ${(b.serviceRate * 100).toFixed(2)}%`,
  );
}
