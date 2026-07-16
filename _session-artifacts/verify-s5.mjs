// Independent verification of WO-SANDBOX-TICK-CALENDAR node attribution.
// Replicates the exact frontend flow (deriveBaseSnapshot -> createSimSession -> tick -> computeNodeAttribution)
// against the REAL running datacore, and cross-checks coefficients vs real PropagationRule definitions.
const DC = process.env.DC ?? "http://127.0.0.1:4049";
const DBG = "demo:usr_demo_admin:admin";

async function j(p, opt = {}) {
  const r = await fetch(`${DC}${p}`, {
    headers: { "X-Debug-User": DBG, "Content-Type": "application/json" },
    ...opt,
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body };
}

// ---- replicate frontend deriveBaseSnapshot (SandboxView.tsx:72) ----
function deriveBaseSnapshot(cfg) {
  const state = {};
  const vars = cfg.stateVars.length > 0 ? cfg.stateVars : ["v"];
  for (const t of cfg.nodeTypes) {
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length > 0 ? ids : [`${t}#0`];
    for (const oid of keys) {
      const real = cfg.nodeObjectState?.[oid];
      const row = {};
      for (const v of vars) {
        const rv = real?.[v];
        row[v] = typeof rv === "number" && Number.isFinite(rv) ? rv : 0;
      }
      state[oid] = row;
    }
  }
  return state;
}

// ---- replicate frontend computeNodeAttribution (SandboxView.tsx:637) ----
function computeNodeAttribution(typeKey, cfg, trace, propRules) {
  const ids = new Set(cfg.nodeObjectIds?.[typeKey] ?? []);
  const ruleByKey = new Map(propRules.map((r) => [r.key, r]));
  return trace
    .filter((t) => ids.has(t.toObjectId))
    .map((t) => {
      const r = ruleByKey.get(t.ruleKey);
      return {
        fromObjectId: t.fromObjectId, ruleKey: t.ruleKey, viaLinkKey: t.viaLinkKey,
        amount: t.amount,
        coefficient: r ? r.coefficient : null,
        delayTicks: r ? r.delayTicks : null,
      };
    });
}

const out = {};
const vc = await j("/a/v1/sim/view-config");
if (vc.status !== 200) { console.log("view-config FAILED", vc.status, JSON.stringify(vc.body).slice(0,300)); process.exit(2); }
const cfg = vc.body;
out.nodeTypes = cfg.nodeTypes;
out.stateVars = cfg.stateVars;
out.baseObjectIds = cfg.nodeObjectIds?.Base ?? [];
out.hasNodeObjectState = !!cfg.nodeObjectState;

const pr = await j("/a/v1/sim/propagation-rules");
const propRules = pr.body.items ?? [];
out.ruleCount = propRules.length;
out.rulesSample = propRules.map(r => ({ key: r.key, coefficient: r.coefficient, delayTicks: r.delayTicks, src: r.sourceTypeKey, tgt: r.targetTypeKey, via: r.viaLinkKey }));

const base = deriveBaseSnapshot(cfg);
out.baseSnapshotObjCount = Object.keys(base).length;
const base0 = out.baseObjectIds[0];
out.base0_id = base0;
out.base0_tick0 = base0 ? base[base0] : null;

const sess = await j("/a/v1/sim/sessions", { method: "POST", body: JSON.stringify({ baseSnapshot: base, scope: {} }) });
if (sess.status !== 200 && sess.status !== 201) { console.log("createSession FAILED", sess.status, JSON.stringify(sess.body).slice(0,300)); process.exit(2); }
const sid = sess.body.id;
out.sessionId = sid;

const tick1 = await j(`/a/v1/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
out.tick1_curTick = tick1.body.curTick;
const trace1 = tick1.body.trace ?? [];
out.tick1_traceLen = trace1.length;
out.tick1_hasTraceField = Array.isArray(tick1.body.trace);

const baseAttr = computeNodeAttribution("Base", cfg, trace1, propRules);
out.baseAttrCount = baseAttr.length;
out.baseAttrSample = baseAttr.slice(0, 6);

const ruleByKey = new Map(propRules.map(r => [r.key, r]));
const mismatches = [];
for (const a of baseAttr) {
  const r = ruleByKey.get(a.ruleKey);
  if (r && a.coefficient !== r.coefficient) mismatches.push({ ruleKey: a.ruleKey, attr: a.coefficient, ruleDef: r.coefficient });
}
out.coefficientMismatches = mismatches;

out.base0_after_tick1 = tick1.body.state?.[base0] ?? null;

const sess2 = await j("/a/v1/sim/sessions", { method: "POST", body: JSON.stringify({ baseSnapshot: base, scope: {} }) });
const sid2 = sess2.body.id;
const tick2 = await j(`/a/v1/sim/sessions/${sid2}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
const trace2 = tick2.body.trace ?? [];
out.determinism_traceEqual = JSON.stringify(trace1) === JSON.stringify(trace2);
out.determinism_stateEqual = JSON.stringify(tick1.body.state) === JSON.stringify(tick2.body.state);

out.rawBaseTraceSample = trace1.filter(t => (cfg.nodeObjectIds?.Base ?? []).includes(t.toObjectId)).slice(0, 4);

console.log(JSON.stringify(out, null, 2));
