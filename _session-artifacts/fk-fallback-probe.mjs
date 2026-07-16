// Independent probe: imports the REAL compiled deriveSliceHops (product code), feeds it the
// EXACT object-type schema Kimi produced in the real run, then simulates the 洞E failure mode
// (LLM drops refToTypeKey but keeps the FK-named property) to verify FK-name fallback recovers it.
import { deriveSliceHops } from "/home/user/complete/apps/datacore/dist/databuilder/comprehend.js";

// Real Kimi output (verbatim from /a/v1/ontology/object-types), as PlanObjectType shape.
const P = (propKey, ref = null, pk = false) => ({ propKey, sourceField: propKey, dataType: ref ? "ref" : "string", isPrimaryKey: pk, refToTypeKey: ref });
const T = (typeKey, domain, properties) => ({ typeKey, displayName: typeKey, domain, sourceDataset: typeKey.toLowerCase(), properties });

const real = [
  T("Order", "sales", [P("orderId", null, true), P("customer", "Customer"), P("orderDate"), P("dueDate")]),
  T("Process", "factory", [P("processId", null, true), P("orderId", "Order"), P("processName")]),
  T("Equipment", "factory", [P("equipmentId", null, true), P("workshop", "Workshop"), P("equipmentName")]),
  T("Customer", "sales", [P("customerId", null, true), P("customerName")]),
  T("Workshop", "factory", [P("workshopId", null, true), P("workshopName")]),
];

// 洞E scenario: LLM DROPS Process.orderId's refToTypeKey (=null) but keeps the property named "orderId".
const dropped = JSON.parse(JSON.stringify(real));
const procOrderId = dropped.find(t => t.typeKey === "Process").properties.find(p => p.propKey === "orderId");
procOrderId.refToTypeKey = null;         // simulate the drop
procOrderId.dataType = "string";

const show = (label, m) => {
  console.log("\n== " + label + " ==");
  for (const k of ["Process", "Customer", "Order"]) console.log("  " + k + ": [" + (m.get(k) || []).join(", ") + "]");
};

// (a) real explicit refs
show("A. real Kimi schema (explicit refs)", deriveSliceHops(real));
// (b) dropped ref + FK fallback ON (default)
const bMap = deriveSliceHops(dropped);
show("B. LLM dropped Process.orderId ref, fkFallback ON (default)", bMap);
// (c) dropped ref + FK fallback OFF
const cMap = deriveSliceHops(dropped, { fkFallback: false });
show("C. LLM dropped Process.orderId ref, fkFallback OFF", cMap);
// (d) R6 determinism on dropped schema
const r1 = JSON.stringify([...deriveSliceHops(dropped)].sort());
const r2 = JSON.stringify([...deriveSliceHops(dropped)].sort());

console.log("\n== ASSERTIONS ==");
const has = (m, k, link) => (m.get(k) || []).includes(link);
const A_multi = (deriveSliceHops(real).get("Process") || []).length >= 2;
const B_recovered = has(bMap, "Process", "Process_orderId_ref");
const C_lost = !has(cMap, "Process", "Process_orderId_ref");
const R6 = r1 === r2;
console.log("A. explicit refs → Process multi-hop (>=2 links): " + A_multi);
console.log("B. dropped ref + FK-name fallback recovered Process_orderId_ref: " + B_recovered);
console.log("C. fallback OFF → Process_orderId_ref lost (fallback truly load-bearing): " + C_lost);
console.log("D. R6 two runs byte-identical: " + R6);
console.log("\nProcess chain B (recovered): " + JSON.stringify(bMap.get("Process")));
console.log("Process chain C (no fallback): " + JSON.stringify(cMap.get("Process")));
console.log("\nALL PASS: " + (A_multi && B_recovered && C_lost && R6));
