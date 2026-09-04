import { createHash } from "node:crypto";
import { readA, readB, req } from "./compare.mjs";
const w = { margin: 1, serviceRate: 1, revenue: 1, cost: 1 };
for (let i = 1; i <= 2; i++) {
  const res = await readA(w);
  const pick = [...res.frontier, ...res.dominated].find((s) => s.id === res.recommendedId);
  const b = await readB(pick.levers, w);
  const h = createHash("sha256").update(JSON.stringify({ req, res, b })).digest("hex").slice(0, 16);
  console.log(`run#${i} sha256[0:16] = ${h}`);
}
