/**
 * P4 · 独立否证探针（第3轮 · 补上一轮没做的两项）
 *
 * 本脚本不 PATCH 任何东西（纯只读 + 建会话），专门补两个**上一轮空缺**的对照：
 *
 *  ① 零扰动对照臂（本仓铁律：数变了 != 扰动生效）
 *     两个全新会话、**零 PATCH**、调用序列逐字相同 ⇒ 若读数有差异，说明「新会话读数」
 *     本身就带漂移；那么 P3-signflip 的「翻转臂 150/150 变化」就不能单独充当扰动生效的证据。
 *     判据：zeroDist.changed 必须 = 0。!=0 ⇒ P3-signflip 的正对照作废，需重做。
 *
 *  ② 否证判据①（钉死核心前提）全轨迹版
 *     上一轮只在 tick0/终拍测了 fb 符号（n=6）。本轮追 tick0/1/5/20 的**全部**型号，
 *     并要求 negatives=0；同时扫「指向 Order.demandPressure 的**正系数**入边」= 0 条。
 *     任一不成立 ⇒ 待验根因作废。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = [];
const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync("/tmp/wo-3root/p4.out", L.join("\n") + "\n"); console.log(...a); };

try {
  // 金丝雀：必然命中的请求（不存在的会话 → 404）
  const canary = await g("/sim/sessions/sims_doesnotexist000000");
  log(`金丝雀⓪ 不存在会话 HTTP=${canary.status}（须 404）`);

  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  log(`对象: Order=${orderIds.length} Model=${modelIds.length}`);

  // 规则表：目标含 demandPressure 的边 + 全表正系数入边扫描
  const rules = (await g("/sim/propagation-rules")).json.items ?? [];
  const pub = rules.filter((r) => r.status === "PUBLISHED");
  log(`规则: 全=${rules.length} PUBLISHED=${pub.length}`);
  log(`rule[0] keys = ${Object.keys(pub[0] ?? {}).join(",")}`);
  const dp = pub.filter((r) => JSON.stringify(r).includes("demandPressure"));
  for (const r of dp) log(`  DP边 id=${r.id} k=${r.coefficient} ref=${JSON.stringify(r.coefficientRef)} status=${r.status} src=${r.sourceVar ?? r.source ?? "?"} tgt=${r.targetVar ?? r.target ?? "?"}`);
  const intoDP = dp.filter((r) => String(r.targetVar ?? r.target ?? "").includes("demandPressure"));
  log(`★指向 Order.demandPressure 的 PUBLISHED 边 = ${intoDP.length} 条`);
  log(`★其中**正系数** = ${intoDP.filter((r) => typeof r.coefficient === "number" && r.coefficient > 0).length} 条（否证① 要求 0）`);
  // 指向 Model.forecastBias 的入边（决定它是不是外生、会不会被推负）
  const intoFB = pub.filter((r) => String(r.targetVar ?? r.target ?? "").includes("forecastBias"));
  log(`★指向 Model.forecastBias 的 PUBLISHED 边 = ${intoFB.length} 条（0 ⇒ 外生恒定）`);
  for (const r of intoFB.slice(0, 8)) log(`   fb入边 ${r.id} k=${r.coefficient} src=${r.sourceVar ?? r.source ?? "?"}`);

  const arm = async (tag) => {
    const s = (await post("/sim/sessions", {})).json;
    await sleep(400);
    const det = (await g(`/sim/sessions/${s.id}`)).json;
    const shots = [];
    let done = 0;
    for (const n of [1, 4, 15]) { await post(`/sim/sessions/${s.id}/tick`, { n }); done += n; await sleep(400); const w = (await g(`/sim/sessions/${s.id}/world`)).json; shots.push({ t: done, st: w.state ?? {} }); }
    const fbByTick = shots.map((sh) => { const v = modelIds.map((i) => sh.st[i]?.forecastBias).filter((x) => typeof x === "number"); return { t: sh.t, n: v.length, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, neg: v.filter((x) => x < 0).length }; });
    const last = shots[shots.length - 1].st, bs = det.baseSnapshot ?? {};
    const rows = orderIds.map((i) => ({ i, base: bs[i]?.demandPressure, v: last[i]?.demandPressure })).filter((p) => typeof p.base === "number" && typeof p.v === "number");
    log(`${tag}: 会话=${s.id} Order读数=${rows.length}`);
    log(`  fb 轨迹(t:n:min:max:负) = ${fbByTick.map((f) => `${f.t}:${f.n}:${f.min}:${f.max}:${f.neg}`).join(" | ")}`);
    log(`  fb 负值出现拍数 = ${fbByTick.filter((f) => f.neg > 0).length}/${fbByTick.length}（否证① 要求 0）`);
    log(`  读数 > 基值+0.01 = ${rows.filter((p) => p.v > p.base + 0.01).length}/${rows.length}（须 0）`);
    return { rows, last, id: s.id };
  };
  const A = await arm("臂A（零扰动·第1次）");
  const Bb = await arm("臂B（零扰动·第2次）");

  // 零扰动对照：两个会话在同一 tick 的世界态逐格比
  const keys = new Set([...Object.keys(A.last), ...Object.keys(Bb.last)]);
  let cells = 0, diff = 0; const sample = [];
  for (const k of keys) {
    for (const v of new Set([...Object.keys(A.last[k] ?? {}), ...Object.keys(Bb.last[k] ?? {})])) {
      const x = A.last[k]?.[v], y = Bb.last[k]?.[v];
      if (typeof x !== "number" || typeof y !== "number") continue;
      cells++; if (x !== y) { diff++; if (sample.length < 5) sample.push(`${k}.${v}: ${x} vs ${y}`); }
    }
  }
  log(`★★零扰动对照臂：可比格 ${cells} · 不同 ${diff}（要求 0；!=0 ⇒ P3 正对照作废）`);
  for (const s of sample) log(`   差异样本 ${s}`);
  const mA = new Map(A.rows.map((p) => [p.i, p.v]));
  const chg = Bb.rows.filter((p) => mA.get(p.i) !== p.v).length;
  log(`★★零扰动对照臂 · Order.demandPressure 逐单不同 = ${chg}/${Bb.rows.length}（要求 0）`);
} catch (e) { log(`‼ 异常：${e.message}`); process.exitCode = 1; }
log(`CAPTURED_RC=${process.exitCode ?? 0}`);
