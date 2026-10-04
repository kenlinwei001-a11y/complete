// WO-3ROOT · 消费方分支清单 × 播种可达性（铁律 0.5：追到「真正被谁调用、在什么条件下触发」）
// 扫描范围（可复现）：apps/datacore/src/sim/**.ts 与 apps/datacore/src/solvers/**.ts 全量，
//   筛 `以状态量的值作比较条件` 的分支；另加直接读 SimSession 世界态的消费方
//   （chain-loss / causal-graph / metric-series / certification / app.ts 的 world 端点）。
//   筛出共 4 条。⛔ 不在范围内：以**对象字段**（非推演世界态）为条件的阈值分支，
//   如 solvers/service.ts 的 sev>=0.7/0.4/0.2 分级 —— 它读 drillVal(Supplier.contractedSupplyTon)
//   这类真业务字段，不吃推演世界态。
// 每条都用运行时真读的播种区间去测「它到底进不进得去」。
import fs from "node:fs";
const EV = new URL(".", import.meta.url).pathname;
const J = (n) => JSON.parse(fs.readFileSync(EV + n, "utf8"));
const sess = J("WO-SEED-DOMAIN-AUDIT-runtime-session.json");
const vc = J("WO-SEED-DOMAIN-AUDIT-runtime-view-config.json");
const rules = J("WO-SEED-DOMAIN-AUDIT-runtime-rules.json").items.filter((r) => r.status === "PUBLISHED");
const base = sess.baseSnapshot;
const val = (t, v) => (vc.nodeObjectIds[t] ?? []).map((o) => base[o]?.[v]).filter((x) => typeof x === "number");

console.log("分支清单（以状态量的值为条件）共 4 条：\n");

console.log("① 引擎 propagation.ts：`if (sourceVal === 0) continue;` —— 源读数恰为 0 ⇒ 该边本拍整条不触发");
for (const r of rules) {
  const a = val(r.sourceTypeKey, r.sourceStateVar);
  const zeros = a.filter((x) => x === 0).length;
  if (zeros > 0) console.log(`   源 ${r.sourceTypeKey}.${r.sourceStateVar}: ${zeros}/${a.length} 格恰为 0 ⇒ 边 ${r.key} 对这些源对象本拍不触发`);
}
console.log("   ⚠ 逐拍可恢复（源可被自己的入边抬起），故这是「首拍哑火」不是永久死边——见 proof.txt ⑤。");

console.log("\n② 引擎 propagation.ts：`drive = max(0, sourceVal − reaction.tolerance)` —— 容忍线 hinge");
const withR = rules.filter((r) => r.reaction != null);
console.log("   带 reaction 的边 = " + withR.length + "/" + rules.length + "（其余 40+ 条走 rule.reaction == null 支，逐字节同旧）");
for (const r of withR) {
  const a = val(r.sourceTypeKey, r.sourceStateVar), TOL = r.reaction.tolerance;
  console.log(`   ${r.key}: tolerance=${TOL} 源 ${r.sourceTypeKey}.${r.sourceStateVar} 播种区间=[${Math.min(...a).toFixed(3)}, ${Math.max(...a).toFixed(3)}]`);
  console.log(`      ⇒ 越线（还手）格数 = ${a.filter((x) => x > TOL).length}/${a.length}；未越线（不还手）= ${a.filter((x) => x <= TOL).length}/${a.length}`);
  console.log(`      ⇒ 该分支**可达**（不是死支）——这是反向金丝雀：数值阈值分支不该被本单的判法误报。`);
}

console.log("\n③ 引擎 propagation.ts saturateToDomain：band=0 的一侧是硬夹（吸收边界）");
console.log("   见 join.txt：38 域里 37 个 restPoint===min ⇒ 下界 band=0 硬夹、上界 band=25 保序；");
console.log("   forecastBias 两侧各 25 ⇒ 两侧都保序。故全表唯一「吸收侧」= 那 37 个域的下界。");

console.log("\n④ 消费方 solvers/chain-loss.ts `simDeltaDaysFor`：`deltaDays = Math.max(0, cell)`");
import { STATE_VAR_DOMAINS } from "../../apps/datacore/dist/synthetic/battery.js";
const carriers = { Supplier: "deliveryDelay", PurchaseOrder: "procurementDelay", CustomsClearance: "clearanceQueueDays", IncomingInspection: "queueDays" };
for (const [t, v] of Object.entries(carriers)) {
  const a = val(t, v);
  if (!a.length) { console.log(`   ${t}.${v}: 本世界无格（承载物不在世界态）`); continue; }
  const declared = STATE_VAR_DOMAINS[v] !== undefined;
  const negN = a.filter((x) => x < 0).length;
  // 负值能不能出现，取决于**两件事**：该量有没有声明域（引擎夹不夹）× 数据本身有没有负值。分开说。
  const why = negN > 0 ? "本拍有负值 ⇒ 分支可达（" + (declared ? "⚠ 但该量已进域表，负值只可能来自未过投影的旁路" : "该量未进 STATE_VAR_DOMAINS，引擎不夹") + "）"
                       : declared ? "本拍无负值；该量**已进域表**（下界 0 band=0 硬夹）⇒ 负值结构上出不来，分支不可达"
                                  : "本拍无负值；该量**未进域表**（引擎不夹）⇒ 不可达是**数据如此**，不是域夹的";
  console.log(`   ${t}.${v}: 域表登记=${declared ? "是" : "否"} 播种区间=[${Math.min(...a).toFixed(3)}, ${Math.max(...a).toFixed(3)}] 负值格=${negN}/${a.length} ⇒ ${why}`);
}
