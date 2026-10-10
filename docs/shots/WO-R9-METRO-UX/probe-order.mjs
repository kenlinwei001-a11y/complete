/**
 * WO-R9-METRO-UX · 「后端到底有没有下发流程间先后」的**实测取证**（真后端，不是读代码推的）。
 *
 * 铁律 0.6：报「没下发」这类**否定结论**之前先跑金丝雀 —— 拿一个**确定存在**的字段同法查，
 * 它若也报"没有"，那是探针坏了，不是后端没发。
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:4802";
const H = { "X-Debug-User": "demo:admin:admin" };

const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
};

const res = await get("/a/v1/process-definitions");
const defs = res.definitions;
const doms = res.domains;

console.log("═".repeat(78));
console.log("① GET /a/v1/process-definitions —— 这一档的取数端点");
console.log("═".repeat(78));
console.log("流程条数 =", defs.length, "· 域条数 =", doms.length);
console.log("ProcessDefinition 的字段全集（对全部条目取并集，不是只看第一条）：");
const defFields = [...new Set(defs.flatMap((d) => Object.keys(d)))].sort();
console.log("  ", defFields.join(" · "));
console.log("ProcessDomain 的字段全集：");
console.log("  ", [...new Set(doms.flatMap((d) => Object.keys(d)))].sort().join(" · "));

// ── 金丝雀：拿**确定存在**的字段同法查（探针自证）
const ORDERING = ["predecessor", "predecessors", "successor", "successors", "nextKeys", "prevKeys", "stationIndex", "flowKey", "upstream", "downstream", "dependsOn", "order", "seq", "sequence"];
const CANARY = ["carrierTypeKey", "waitKind", "domainKey"];
const hit = (f) => defFields.includes(f);
console.log("\n金丝雀（这些字段**确定存在**，探针必须都命中）：");
for (const f of CANARY) console.log(`   ${hit(f) ? "✅ 命中" : "🔴 未命中 ⇒ 探针坏了"}  ${f}`);
const canaryOk = CANARY.every(hit);
console.log(canaryOk ? "⇒ 探针是好的，下面的否定结论可信" : "🔴 探针坏了 —— 不许据此下任何否定结论");

console.log("\n先后关系类字段（逐个查 ProcessDefinition）：");
for (const f of ORDERING) console.log(`   ${hit(f) ? "⚠️ 命中" : "— 无"}  ${f}`);
const found = ORDERING.filter(hit);
console.log(`⇒ ProcessDefinition 上的先后关系字段：${found.length === 0 ? "**一个都没有**" : found.join(" / ")}`);
console.log(`   （ProcessDomain 上有 order，但契约原文写的是「展示序」，不是业务先后）`);

console.log("\n" + "═".repeat(78));
console.log("② 实测站序**确实存在**，只是不经上面那个端点 —— /{key}/instances 下发它");
console.log("═".repeat(78));
/* ⚠ 本探针的**第一版写错了字段名**（读 `inst.timelines`，而响应里叫 `flowTime`）——
   于是每条都打出 `timelines=0`，差一点据此报出「实测站序也没有数据」这个**与事实相反**的结论。
   这正是铁律 0.6 那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」：
   `undefined ?? 0` 得到的 0 度量的是"我字段名写错了"，不是"后端没数据"。
   故此处**先把响应的键集合打出来**（自证探针读的是真存在的字段），再读值。 */
for (const k of ["P34", "P43", "P01"]) {
  try {
    const inst = await get(`/a/v1/process-definitions/${k}/instances?limit=5`);
    const chains = inst.flowTime ?? [];
    console.log(`  ${k}: 响应键=[${Object.keys(inst).join(",")}] · available=${inst.available} · instanceCount=${inst.instanceCount} · 链数=${chains.length}`);
    for (const t of chains) {
      console.log(`      flowKey=${t.flowKey} · 站序=[${(t.stations ?? []).map((s) => `${s.stationIndex}:${s.processKey}`).join(" → ")}]`);
    }
    if (chains.length === 0) console.log(`      （本条反推不出链 —— absence=${JSON.stringify(inst.absence)}）`);
  } catch (e) {
    console.log(`  ${k}: ${e.message}`);
  }
}
console.log("\n⇒ 结论：先后关系在平台里是**真的**（flowKey + stationIndex），");
console.log("   但它只在 /{key}/instances 与 process_flow_time 上；本档的 /process-definitions **不带它**。");
console.log("   要在本图画实测站序 = 改 datacore 补一条下发（本单范围边界之外）。");

// ── 顺带把「本图会画成什么样」的现算量也打出来，供报告对账
const byDomain = new Map();
for (const d of defs) byDomain.set(d.domainKey, (byDomain.get(d.domainKey) ?? 0) + 1);
const byCarrier = new Map();
for (const d of defs) {
  if (!byCarrier.has(d.carrierTypeKey)) byCarrier.set(d.carrierTypeKey, []);
  byCarrier.get(d.carrierTypeKey).push(d.key);
}
const shared = [...byCarrier.entries()].filter(([, v]) => v.length > 1);
console.log("\n本图现算量：线数 =", byDomain.size, "· 站数 =", defs.length, "· 换乘组 =", shared.length);
for (const [c, v] of shared) console.log(`   换乘：${c} ← ${v.sort().join(" / ")}`);
