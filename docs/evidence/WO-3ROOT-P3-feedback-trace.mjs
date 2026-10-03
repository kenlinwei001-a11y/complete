// A6 归因补证：三个「非规格」对照格（ArInvoice.overduePressure）t≥3 与 OLD 侧分叉常数 = 2.253834001123
// 是不是**上游被收回后经图传导的反馈**？判据：在分叉诞生拍（本实验逐拍找），
//   ① 存在上游格 FIX−OLD ≠ 0 且**被点名**（has ledger entry）—— 分叉有账；
//   ② 三格差为**同一常数**（共享入流项）—— 与「入口碰了这三格自身」互斥（那会各差各的，且它们会被点名）。
// 金丝雀：两实例身份可辨（FIX /world 有 baseStateVarReport）。
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const FIX = "http://127.0.0.1:4399/a/v1", OLD = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/complete/.claude/worktrees/wf_57a1536c-d93-26/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS;
const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}`); process.exit(3); } return x.j; };
const mk = async (B, l) => { const s = need(await g(B, "/sim/sessions", { method: "POST", body: "{}" }), l); return { B, id: s.id, l }; };
const F = await mk(FIX, "FIX"), O = await mk(OLD, "OLD");
const wf0 = need(await g(FIX, `/sim/sessions/${F.id}/world`), "wf0");
if (!Object.keys(wf0).includes("baseStateVarReport")) { console.log("❌ 工具坏了：4399 不是修后实例"); process.exit(2); }

const CELLS = ["obj_arinvoice_arinvoice_0_0.overduePressure", "obj_arinvoice_arinvoice_0_1.overduePressure", "obj_arinvoice_arinvoice_0_2.overduePressure"];
let prevA = wf0.state;
for (let t = 1; t <= 4; t++) {
  const ra = need(await g(FIX, `/sim/sessions/${F.id}/tick`, { method: "POST", body: '{"n":1}' }), `F t${t}`);
  const rb = need(await g(OLD, `/sim/sessions/${O.id}/tick`, { method: "POST", body: '{"n":1}' }), `O t${t}`);
  const wa = need(await g(FIX, `/sim/sessions/${F.id}/world`), `Fw${t}`);
  const wb = need(await g(OLD, `/sim/sessions/${O.id}/world`), `Ow${t}`);
  const named = new Map((ra.stateVarReport?.saturations ?? []).map((e) => [`${e.objectId}|${e.stateVar}`, e]));
  const deltas = [];
  let nDiff = 0;
  for (const oid of Object.keys(wa.state)) for (const sv of Object.keys(wa.state[oid] ?? {})) {
    const xa = wa.state[oid]?.[sv], xb = wb.state[oid]?.[sv];
    if (typeof xa !== "number" || typeof xb !== "number" || xa === xb) continue;
    nDiff += 1;
    const e = named.get(`${oid}|${sv}`);
    deltas.push({ k: `${oid}.${sv}`, d: Math.round((xa - xb) * 1e12) / 1e12, named: !!e, e });
  }
  deltas.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  const ar = CELLS.map((k) => { const [oid, sv] = k.split("."); return `${wa.state[oid]?.[sv]} (OLD ${wb.state[oid]?.[sv]}, 差 ${Math.round((wa.state[oid][sv] - wb.state[oid][sv]) * 1e12) / 1e12}${named.has(`${oid}|${sv}`) ? ", 被点名" : ", 未点名"})`; });
  const unnamed = deltas.filter((x) => !x.named);
  console.log(`t${t} 分叉格数=${nDiff}; 其中未点名=${unnamed.length}; 点名=${nDiff - unnamed.length}`);
  console.log(`   三对照格: ${ar.join(" | ")}`);
  console.log(`   最大 5 个分叉: ${deltas.slice(0, 5).map((x) => `${x.k} Δ=${x.d}${x.named ? "[点名 raw=" + x.e.raw + "→" + x.e.value + "]" : "[未点名]"}`).join("  ")}`);
  prevA = wa.state;
}
