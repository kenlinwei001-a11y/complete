import { readA, readB, req } from "./compare.mjs";
import { normalizeParetoWeights } from "../packages/contracts/dist/index.js";
const yi = (x) => (x / 1e8).toFixed(2);
console.log("wRev | A: 推荐解营收(亿) | A: 成本(亿) | A: 获排率 || B: 营收(亿) | B: 成本(亿) | B: 获排率");
for (const wRev of [0, 1, 4, 16, 32]) {
  const w = { margin: 1, serviceRate: 1, revenue: wRev, cost: 1 };
  const res = await readA(w);
  const pick = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId);
  const nw = normalizeParetoWeights(res.objectives, w);
  const b = await readB(pick.levers, nw);
  console.log(
    `${wRev} | ${yi(pick.metrics.revenue)} | ${yi(pick.metrics.cost)} | ${(pick.metrics.serviceRate * 100).toFixed(2)}% || ` +
    `${yi(b.revenue)} | ${yi(b.cost)} | ${(b.serviceRate * 100).toFixed(2)}%`,
  );
}
// B 独有：权重进 args ⇒ 同一杠杆档位下换权重，解本身真漂移。
const lev = req.levers.map((l) => ({ key: l.key, value: l.values[l.values.length - 1] }));
console.log("\n(B 独有·权重进求解器) wRev | 营收(亿) | 成本(亿) | 获排率");
for (const wRev of [0, 1, 4, 16, 32]) {
  const b = await readB(lev, { revenue: wRev, penalty: 1, cost: 1 });
  console.log(`${wRev} | ${yi(b.revenue)} | ${yi(b.cost)} | ${(b.serviceRate * 100).toFixed(2)}%`);
}
