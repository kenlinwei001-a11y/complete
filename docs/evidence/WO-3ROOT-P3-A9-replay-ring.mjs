// A9 回放环一致性：`GET /metric-series` 的 actual 线 vs 落盘 `/world` 逐格逐拍 0 差。
// 装置：本会话**零扰动** ⇒ 回放环（metric-series）与实跑环（tick 路由）必须逐格相同
//   （两环共用 propagateTick + 同一份 stateVarDomains + **同一个投影入口**；分叉只可能来自入口没接上）。
// 金丝雀：① 对比格数 > 100（否则"0 差"是空集的平凡真）；② 错位对照臂 —— 拿 actual(t) 去比 world(t−1)，
//   必须在多数格上**不等**（证明比较有鉴别力，不是恒等比较）。
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const FIX = "http://127.0.0.1:4399/a/v1";
const g = async (p, o) => { const r = await fetch(FIX + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0, 200)}`); process.exit(3); } return x.j; };
const s = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "create");
const worlds = [need(await g(`/sim/sessions/${s.id}/world`), "w0").state];
for (let t = 1; t <= 3; t++) {
  need(await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: '{"n":1}' }), `t${t}`);
  worlds.push(need(await g(`/sim/sessions/${s.id}/world`), `w${t}`).state);
}
const ser = need(await g(`/sim/sessions/${s.id}/metric-series?from=0&to=3&limit=1000`), "series");
console.log(`回包：ticks=[${ser.ticks}] appliedLimit=${ser.appliedLimit} totalMetrics=${ser.totalMetrics} metrics=${ser.metrics.length} clamped=${ser.clamped} baselineOrigin.sessionId===本会话：${ser.baselineOrigin.sessionId === s.id}`);
if (!ser.ticks.includes(3)) { console.log("❌ 工具坏了：窗口没覆盖 t3"); process.exit(2); }

let cmp = 0, miss = 0, nulls = 0, shiftSame = 0, shiftCmp = 0, baseDiff = 0;
const samples = [];
for (const m of ser.metrics) {
  for (let i = 0; i < ser.ticks.length; i++) {
    const t = ser.ticks[i];
    const onDisk = worlds[t]?.[m.objectId]?.[m.stateVar];
    const act = m.actual[i];
    if (act === null || act === undefined) { nulls += 1; continue; }
    cmp += 1;
    if (onDisk !== act) { miss += 1; if (samples.length < 6) samples.push(`t${t} ${m.key} actual=${act} 落盘=${onDisk}`); }
    if (m.baseline[i] !== act) baseDiff += 1; // 零扰动 ⇒ 两线应相同
    // 错位对照臂：act(t) vs 落盘(t−1)
    if (t >= 1) { const prev = worlds[t - 1]?.[m.objectId]?.[m.stateVar]; if (typeof prev === "number") { shiftCmp += 1; if (prev === act) shiftSame += 1; } }
  }
}
console.log(`对比点位 = ${cmp}（金丝雀：须 >100）；actual ≠ 落盘 = ${miss}（须 0）；null = ${nulls}；baseline ≠ actual（零扰动下应为 0）= ${baseDiff}`);
for (const x of samples) console.log(`   🔴 ${x}`);
console.log(`错位对照臂：act(t) vs 落盘(t−1) 可比 ${shiftCmp} 点位，其中恰好相同 = ${shiftSame}（须**远小于**总数 ⇒ 比较有鉴别力）`);
const ok = miss === 0 && cmp > 100 && nulls === 0 && baseDiff === 0 && shiftSame / Math.max(shiftCmp, 1) < 0.5;
console.log(`判定：${ok ? "✅ A9 成立（回放环与落盘世界逐格同源）" : "❌ A9 有判据未成立"}`);
process.exit(ok ? 0 : 1);
