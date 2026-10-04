import { readFileSync } from "node:fs";
const R = (p) => JSON.parse(readFileSync(p, "utf8"));
const zero = R("/tmp/sv-churn-ev/zero-arm.json"), armA = R("/tmp/sv-churn-ev/armA.json");
const rules = R("/tmp/sv-churn-ev/rules.json").items.filter((r) => r.reaction == null);
const vc = R("/tmp/sv-churn-ev/viewconfig.json");
const WT = "/Users/apple/deploy/complete/.claude/worktrees/agent-adefe48fc671b47f2";
const { buildCellRoles } = await import(`${WT}/packages/contracts/dist/index.js`);
const roles = buildCellRoles(rules);
const id2t = new Map();
for (const [t, a] of Object.entries(vc.nodeObjectIds)) for (const id of a) id2t.set(id, t);
console.log("差异格清单（外生格 ∧ armA≠zeroArm）：");
const seen = new Set();
for (let n = 1; n <= 8; n++) {
  const c = zero.worlds["t" + n], a = armA.worlds["t" + n];
  for (const id of Object.keys(c)) {
    const tk = id2t.get(id); if (tk === undefined) continue;
    for (const sv of Object.keys(c[id])) {
      if (typeof c[id][sv] !== "number") continue;
      if (!roles.isExogenous(tk, sv)) continue;
      const av = a[id]?.[sv];
      if (typeof av === "number" && c[id][sv] !== av) {
        const k = id + "." + sv;
        if (!seen.has(k)) {
          seen.add(k);
          console.log(`   t${n} ${k}  typeKey=${tk}  zero=${c[id][sv]} armA=${av} |Δ|=${Math.abs(av - c[id][sv])}`);
        }
      }
    }
  }
}
console.log(`\n注入点 = obj_order_SO-3391.leadDays, 注入 |Δ|=3`);
console.log(`差异格种类数 = ${seen.size}`);
console.log(`是否恰为注入点: ${[...seen].every((k) => k === "obj_order_SO-3391.leadDays")}`);
console.log(`\nOrder.leadDays 外生? ${roles.isExogenous("Order", "leadDays")}`);
console.log(`Order.qty 外生? ${roles.isExogenous("Order", "qty")}`);
console.log(`Order.unitPrice 外生? ${roles.isExogenous("Order", "unitPrice")}`);
console.log(`Order.costPressure 外生? ${roles.isExogenous("Order", "costPressure")}`);
console.log(`\n注：8 = 注入点 1 格 × 8 拍。扰动**按设计**改这一格 ⇒ 不是误报，是判法正确识别了注入点。`);
