// 归属判定：299 个「声明域内却无台账」的差分，是**播种期**就分叉了，还是投影入口造成的？
// 判据：若 baseSnapshot（投影入口之前的那一份）在两实例就已不同 ⇒ 分叉在播种，不在本单的入口。
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const OLD = "http://127.0.0.1:4019/a/v1", FIX = "http://127.0.0.1:4401/a/v1";
const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const mk = async (B) => { const s = (await g(B, "/sim/sessions", { method: "POST", body: "{}" })).j;
  const det = (await g(B, `/sim/sessions/${s.id}`)).j; return { id: s.id, det }; };
const F = await mk(FIX), O = await mk(OLD);
const wf = (await g(FIX, `/sim/sessions/${F.id}/world`)).j, wo = (await g(OLD, `/sim/sessions/${O.id}/world`)).j;
const bf = F.det.baseSnapshot, bo = O.det.baseSnapshot;
console.log(`det 顶层键 FIX=[${Object.keys(F.det).join(",")}]`);
console.log(`baseSnapshot 顶层键 FIX=[${Object.keys(bf || {}).slice(0, 6).join(",")}...]`);
const bp = wf.baseProvenance, bpo = wo.baseProvenance;
console.log(`baseProvenance 类型 FIX=${typeof bp} OLD=${typeof bpo}${bp && typeof bp === "object" ? " FIX键样例=" + Object.keys(bp).slice(0, 5).join(",") : ""}`);
let nBaseDiff = 0, nSameBase = 0;
const probe = [];
for (const oid of Object.keys(wf.state)) for (const sv of Object.keys(wf.state[oid] ?? {})) {
  const a = wf.state[oid][sv], b = wo.state[oid]?.[sv];
  if (typeof a !== "number" || typeof b !== "number" || a === b) continue;
  const ba = bf?.[oid]?.[sv], bb = bo?.[oid]?.[sv];
  if (typeof ba === "number" && typeof bb === "number" && ba !== bb) nBaseDiff += 1; else nSameBase += 1;
  if (probe.length < 6) probe.push(`${oid}.${sv}: base FIX=${ba} OLD=${bb} | world FIX=${a} OLD=${b}`);
}
console.log(`差分格中 baseSnapshot 已不同 = ${nBaseDiff} ；base 相同只 world 不同 = ${nSameBase}`);
for (const p of probe) console.log("   " + p);
// 那 3 个 loadIndex 的 base 到底等于谁
for (const [oid, sv] of [["obj_base_jiangmen", "loadIndex"], ["obj_customer_cust_0", "receivablePressure"]]) {
  console.log(`检查 ${oid}.${sv}: base FIX=${bf?.[oid]?.[sv]} OLD=${bo?.[oid]?.[sv]} · world FIX=${wf.state[oid]?.[sv]} OLD=${wo.state[oid]?.[sv]}`);
}
