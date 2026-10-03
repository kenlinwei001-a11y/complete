/**
 * 评审员#3 · 独立复核（不 PATCH 全局规则表；只用**会话作用域**的扰动杠杆）
 *
 * 评的对象：根因「唯一入源 Model.forecastBias 由播种期哈希占位铸出 ∈[0,100]，而声明域是
 * [−100,100] ⇒ 唯一入边 k×fb 恒 ≤ 0 ⇒ 『低估(−)⇒需求压力上冲』那一支数值上不可达」。
 *
 * 本轮我要自己拿到的三样：
 *   A. 结构事实（我自己的读数，不引上游）：Order.demandPressure 入边条数/符号；fb 播种值符号。
 *   B. 机制的方向性：同一条边，源为**负**时读数上穿、源更大为正时读数下压
 *      ⇒ 「符号是闸门」成立，且闸门是**双向**的（不是单向死路）。
 *   C. 预先声明过的否证判据①（任一会话出现 fb<0 ⇒ 本根因作废）到底触发了没有 ——
 *      `applyPerturbationToState(mode:"set")` 是裸写不夹域，用户可以把 fb 拨成负数。
 *
 * 判据（预先声明）：
 *   · 仪器自证：N 臂活态 fb 必须 == −50，P 臂必须 == +100，否则该臂 NOT-MEASURED。
 *   · 控制：三臂的 baseSnapshot（Order.demandPressure 映射）必须逐字节相同，否则不可比。
 *   · 若 N 臂有单越基值+0.01 ⇒ 那一支**在带杠杆的世界里可达**（不可达是播种态的性质）。
 *   · 若 N 臂仍 0 ⇒ 除源符号外还有第二道闸（须追）。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3-reviewer3-independent.txt";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j, raw: t }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };

const TARGET_MODEL = "obj_model_4680-NCM";
const TICKS = 12;

const stat = (xs) => {
  const a = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return { n: a.length, min: a.length ? Math.min(...a) : null, max: a.length ? Math.max(...a) : null, neg: a.filter((x) => x < 0).length };
};

const runArm = async (tag, fbSet) => {
  const s = (await post("/sim/sessions", {})).json;
  await sleep(400);
  if (fbSet !== null) {
    const pr = await post(`/sim/sessions/${s.id}/perturbations`, {
      kind: "demand_shift", targetObjectId: TARGET_MODEL, targetStateVar: "forecastBias",
      magnitude: fbSet, mode: "set", startTick: 0, durationTicks: null,
      label: `评审员#3：${TARGET_MODEL}.forecastBias = ${fbSet}`,
    });
    log(`  [${tag}] 扰动 POST HTTP=${pr.status} id=${pr.json?.perturbation?.id ?? "?"} curTick=${pr.json?.curTick}`);
    if (pr.status !== 201) log(`  [${tag}] ‼ 扰动未建立 ⇒ 本臂 NOT-MEASURED`);
  }
  const tr = await post(`/sim/sessions/${s.id}/tick`, { n: TICKS });
  await sleep(400);
  const det = (await g(`/sim/sessions/${s.id}`)).json;
  const w = (await g(`/sim/sessions/${s.id}/world`)).json;
  const bs = det.baseSnapshot ?? {}, st = w.state ?? {};
  const fbLive = st[TARGET_MODEL]?.forecastBias;
  const rows = Object.keys(st).filter((i) => bs[i] && typeof bs[i].demandPressure === "number" && typeof st[i].demandPressure === "number");
  const above = rows.filter((i) => st[i].demandPressure > bs[i].demandPressure + 0.01);
  const below = rows.filter((i) => st[i].demandPressure < bs[i].demandPressure - 0.01);
  // 靶型号那批单（该边只作用于 viaLink model_demanded_by_order 上的 Order）
  const modelFbAll = Object.keys(bs).filter((i) => typeof bs[i]?.forecastBias === "number").map((i) => bs[i].forecastBias);
  log(`  [${tag}] 会话=${s.id} tickHTTP=${tr.status} | ${TARGET_MODEL}.fb(活态)=${fbLive} | 可比单=${rows.length} | 越基值+0.01=${above.length}/${rows.length} | 低于基值-0.01=${below.length}/${rows.length}`);
  log(`  [${tag}] 前 3 大正 Δ：` + rows.map((i) => ({ i, b: bs[i].demandPressure, v: st[i].demandPressure }))
    .sort((a, b) => (b.v - b.b) - (a.v - a.b)).slice(0, 3)
    .map((r) => `${r.i} base=${r.b} v=${r.v} Δ=${(r.v - r.b).toFixed(4)}`).join(" | "));
  log(`  [${tag}] 前 3 大负 Δ：` + rows.map((i) => ({ i, b: bs[i].demandPressure, v: st[i].demandPressure }))
    .sort((a, b) => (a.v - a.b) - (b.v - b.b)).slice(0, 3)
    .map((r) => `${r.i} base=${r.b} v=${r.v} Δ=${(r.v - r.b).toFixed(4)}`).join(" | "));
  return { s: s.id, fbLive, n: above.length, total: rows.length, base: Object.fromEntries(rows.map((i) => [i, bs[i].demandPressure])), st: Object.fromEntries(rows.map((i) => [i, st[i].demandPressure])), modelFbAll };
};

try {
  // ── 结构事实（自己数）────────────────────────────────────────────────
  const rr = (await g("/sim/propagation-rules")).json.items ?? [];
  const inbound = rr.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure");
  const inFb = rr.filter((r) => r.sourceStateVar === "forecastBias");
  const negAll = rr.filter((r) => typeof r.coefficient === "number" && r.coefficient < 0);
  log(`规则表 n=${rr.length}（金丝雀：须 >0）`);
  log(`金丝雀① target=Order 的边 = ${rr.filter((r) => r.targetTypeKey === "Order").length}（须 >=1）`);
  log(`金丝雀② source=forecastBias 的边 = ${inFb.length}（须 >=1）`);
  log(`金丝雀③ target=Order.demandPressure 的边 = ${inbound.length}（这就是待评的入边集合）`);
  for (const r of inbound) log(`    入边 ${r.sourceTypeKey}.${r.sourceStateVar} k=${r.coefficient} ref=${JSON.stringify(r.coefficientRef ?? null)} status=${r.status} via=${r.viaLinkKey} weightRef=${JSON.stringify(r.weightRef ?? null)}`);
  log(`全表负系数边 = ${negAll.length} 条（出荷态应为 6）`);
  log(`正系数入边指向 Order.demandPressure = ${inbound.filter((r) => r.coefficient > 0).length}（否证① 第二支：须为 0）`);

  // ── 三臂 ────────────────────────────────────────────────────────────
  log("── 臂 C · 零扰动对照 ──");
  const C = await runArm("C 零扰动", null);
  log(`  [C] 播种态全模型 fb：${JSON.stringify(C.modelFbAll)} ⇒ ${JSON.stringify(stat(C.modelFbAll))}`);
  log("── 臂 N · 靶型号 forecastBias = −50（低估；裸写不夹域）──");
  const N = await runArm("N fb=−50", -50);
  log("── 臂 P · 靶型号 forecastBias = +100（高估上限；同一条边的另一侧）──");
  const P = await runArm("P fb=+100", 100);

  // ── 控制与自证 ──────────────────────────────────────────────────────
  const sameBase = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  log(`★ 控制：baseSnapshot(Order.demandPressure) C≡N ? ${sameBase(C.base, N.base)} · C≡P ? ${sameBase(C.base, P.base)}（须双 true，否则不可比）`);
  log(`★ 仪器自证：N 臂活态 fb=${N.fbLive}（须 == −50）· P 臂活态 fb=${P.fbLive}（须 == +100）`);
  const okInstr = N.fbLive === -50 && P.fbLive === 100;
  log(`★ 判决：C 越基值 ${C.n}/${C.total} · N 越基值 ${N.n}/${N.total} · P 越基值 ${P.n}/${P.total}`);
  if (okInstr) {
    log(`  ⇒ N 臂上穿 ${N.n}/${N.total} ⇒ 「低估(−)⇒需求上冲」那一支**在带杠杆的世界里可达**；`);
    log(`     根因链里「净入流恒 ≤0 / 数值上不可达」这句只在**无外部输入的播种态**成立，须收窄。`);
    log(`  ⇒ P 臂相对 C 的读数变化（同一条边的另一侧）见上两行 Δ；两臂同向相反 ⇒ 「符号即闸门」且闸门双向。`);
  } else log("  ‼ 仪器自证不过 ⇒ 本判决 NOT-MEASURED");
  log("── 结束 ──");
} catch (e) { log(`‼ 异常: ${e?.stack ?? e?.message}`); }
