const DC = process.env.DC ?? "http://127.0.0.1:4049";
const DBG = "demo:usr_demo_admin:admin";
async function j(p, opt = {}) {
  const r = await fetch(`${DC}${p}`, { headers: { "X-Debug-User": DBG, "Content-Type": "application/json" }, ...opt });
  return { status: r.status, body: await r.json() };
}
function deriveBaseSnapshot(cfg) {
  const state = {}; const vars = cfg.stateVars.length > 0 ? cfg.stateVars : ["v"];
  for (const t of cfg.nodeTypes) {
    const ids = cfg.nodeObjectIds?.[t] ?? []; const keys = ids.length > 0 ? ids : [`${t}#0`];
    for (const oid of keys) { const real = cfg.nodeObjectState?.[oid]; const row = {};
      for (const v of vars) { const rv = real?.[v]; row[v] = typeof rv === "number" && Number.isFinite(rv) ? rv : 0; }
      state[oid] = row; } }
  return state;
}
function computeNodeAttribution(typeKey, cfg, trace, propRules) {
  const ids = new Set(cfg.nodeObjectIds?.[typeKey] ?? []);
  const ruleByKey = new Map(propRules.map((r) => [r.key, r]));
  return trace.filter((t) => ids.has(t.toObjectId)).map((t) => { const r = ruleByKey.get(t.ruleKey);
    return { fromObjectId: t.fromObjectId, ruleKey: t.ruleKey, viaLinkKey: t.viaLinkKey, amount: t.amount,
      coefficient: r ? r.coefficient : null, delayTicks: r ? r.delayTicks : null }; });
}
const cfg = (await j("/a/v1/sim/view-config")).body;
const propRules = (await j("/a/v1/sim/propagation-rules")).body.items;
const base = deriveBaseSnapshot(cfg);
const sid = (await j("/a/v1/sim/sessions", { method: "POST", body: JSON.stringify({ baseSnapshot: base, scope: {} }) })).body.id;
for (let t = 1; t <= 3; t++) {
  const r = await j(`/a/v1/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
  const trace = r.body.trace ?? [];
  const attr = computeNodeAttribution("Base", cfg, trace, propRules);
  const byRule = {};
  for (const a of attr) byRule[a.ruleKey] = (byRule[a.ruleKey] ?? 0) + 1;
  const lineEntries = trace.filter(t => t.ruleKey === "demo_line_util_to_base_load");
  console.log(`--- tick ${r.body.curTick}: traceLen=${trace.length} baseAttr=${attr.length} rulesInAttr=${JSON.stringify(byRule)}`);
  const lineAttr = attr.filter(a => a.ruleKey === "demo_line_util_to_base_load");
  if (lineAttr.length) console.log(`    LINE-rule attribution sample:`, JSON.stringify(lineAttr[0]));
  if (lineEntries.length) console.log(`    raw line trace sample:`, JSON.stringify(lineEntries[0]));
}
