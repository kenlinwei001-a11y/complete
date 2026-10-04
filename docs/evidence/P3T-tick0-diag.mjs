// 诊断：A5 tick0 差分 677 里的 317「台账外变化」到底是什么
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const OLD = "http://127.0.0.1:4019/a/v1", FIX = "http://127.0.0.1:4401/a/v1";
const D = await import("/tmp/wt-p3/apps/datacore/dist/synthetic/battery.js");
const DOM = D.STATE_VAR_DOMAINS;
const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const mk = async (B) => { const s = (await g(B, "/sim/sessions", { method: "POST", body: "{}" })).j;
  const det = (await g(B, `/sim/sessions/${s.id}`)).j; return { id: s.id, base: det.baseSnapshot, create: s }; };
const F = await mk(FIX), O = await mk(OLD);
const wf = (await g(FIX, `/sim/sessions/${F.id}/world`)).j;
const wo = (await g(OLD, `/sim/sessions/${O.id}/world`)).j;
console.log(`FIX tick=${wf.tick} OLD tick=${wo.tick}（须同为 0）`);
const rep = wf.baseStateVarReport;
console.log(`baseStateVarReport 顶层键=[${Object.keys(rep || {}).join(",")}]`);
const sats = rep.saturations || rep.entries || [];
const named = new Set(sats.map((e) => `${e.objectId}|${e.stateVar}`));
const byVar = new Map(), byVarNamed = new Map(), samples = [];
let diffAll = 0, diffDom = 0, unnamedAll = 0, unnamedDom = 0;
for (const oid of Object.keys(wf.state)) for (const sv of Object.keys(wf.state[oid] ?? {})) {
  const a = wf.state[oid][sv], b = wo.state[oid]?.[sv];
  if (typeof a !== "number" || typeof b !== "number" || a === b) continue;
  diffAll += 1;
  const hasDom = !!DOM[sv]; if (hasDom) diffDom += 1;
  const isNamed = named.has(`${oid}|${sv}`);
  if (!isNamed) { unnamedAll += 1; if (hasDom) unnamedDom += 1;
    byVar.set(sv, (byVar.get(sv) ?? 0) + 1);
    if (samples.length < 8) samples.push(`${oid}.${sv} OLD=${b} FIX=${a} 有域=${hasDom} Δ=${Math.round((a - b) * 1e9) / 1e9}`);
  } else byVarNamed.set(sv, (byVarNamed.get(sv) ?? 0) + 1);
}
console.log(`总差分格=${diffAll}（其中声明域内 ${diffDom}）· 台账外=${unnamedAll}（其中声明域内 ${unnamedDom}）`);
console.log(`台账内按量名 top: ${[...byVarNamed.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => k + ":" + v).join(" ")}`);
console.log(`台账外按量名 top: ${[...byVar.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => k + ":" + v).join(" ")}`);
console.log(`台账外样例：`); for (const s of samples) console.log("   " + s);
// 域声明里这些量在不在？
for (const k of [...byVar.keys()].slice(0, 6)) console.log(`   域表有 ${k}? ${!!DOM[k]} ${DOM[k] ? JSON.stringify(DOM[k]) : ""}`);
console.log(`--- 台账样例 3 条 ---`); for (const e of sats.slice(0, 3)) console.log("   " + JSON.stringify(e));
