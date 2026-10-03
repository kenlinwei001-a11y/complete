/**
 * WO-NEGEDGE-P5 · 第2阶段验证 · 分离「符号」与「置空 coefficientRef」这个混淆变量
 *
 * 来历（上一轮自己留下的口子）：P3-signflip 的判决实验把 k 从 −0.222 翻成 +0.222 的**同时**
 *   把 coefficientRef 置空 ⇒ 「+0.222 导致上穿」与「置空 ref 导致上穿」没分离。
 *   p3b 的教训是「ref 非空时 inline 被忽略」，但**它从未在 ref=null 且 k 仍为负**的臂上验过。
 *
 * 本轮四臂（同一时刻、同一后端、各自新会话、tick 12）：
 *   A 出荷态      k=−0.222 ref={C36,...}   ← 期望 0/150 上穿（复现「上界=基值」）
 *   B 空ref保号   k=−0.222 ref=null        ← ★判决臂：若此臂也上穿 ⇒ 「符号是闸门」被推翻
 *   C 翻转        k=+0.222 ref=null        ← 复现 P3 的 150/150
 *   D 翻转保ref   k=+0.222 ref={C36,...}   ← ref 优先性对照：D==A ⇒ ref 赢；D==C ⇒ inline 赢
 *
 * 仪器自证（铁律）：PATCH 后必须回读**两个**字段（coefficient 与 coefficientRef）；
 *   并须有**同臂正对照**（某臂读数相对 A 发生大范围变化），否则不发结论。
 * ⛔ 本脚本不改产品代码；跑完必定回退到出荷态（try/finally）。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/WO-NEGEDGE-P5-signflip-confound.txt";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };
const K0 = -0.222, REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };
const getRule = async () => ((await g("/sim/propagation-rules")).json.items ?? []).find((r) => r.id === RID);

let restored = false;
const setArm = async (tag, coeff, ref) => {
  const p = await patch(`/sim/propagation-rules/${RID}`, { coefficient: coeff, coefficientRef: ref });
  const r = await getRule();
  const ok = r?.coefficient === coeff && JSON.stringify(r?.coefficientRef ?? null) === JSON.stringify(ref ?? null);
  log(`  [PATCH ${tag}] HTTP=${p.status} 回读 k=${r?.coefficient} ref=${JSON.stringify(r?.coefficientRef ?? null)} status=${r?.status} ⇒ ${ok ? "扰动已落地" : "‼未落地"}`);
  return ok;
};
const restore = async () => { if (restored) return; restored = true; const p = await patch(`/sim/propagation-rules/${RID}`, { coefficient: K0, coefficientRef: REF0 }); const r = await getRule(); log(`回退 PATCH HTTP=${p.status} 回读 k=${r?.coefficient} ref=${JSON.stringify(r?.coefficientRef ?? null)}（须 ${K0} / ${JSON.stringify(REF0)}）`); };

try {
  // ── 0. 规则表 + 入边扫描（带金丝雀） ────────────────────────────────
  const rr = (await g("/sim/propagation-rules")).json.items ?? [];
  log(`规则表 n=${rr.length}`);
  const tgt = rr.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure");
  const canaryTarget = rr.filter((r) => r.targetTypeKey === "Order");           // 金丝雀①：Order 为靶的边必 >=1
  const canarySrc = rr.filter((r) => r.sourceStateVar === "forecastBias");      // 金丝雀②：forecastBias 为源的边必 >=1
  log(`金丝雀① Order 为靶的边 = ${canaryTarget.length}（必须 >=1，否则量法坏了）`);
  log(`金丝雀② forecastBias 为源的边 = ${canarySrc.length}（必须 >=1，否则量法坏了）`);
  log(`★ Order.demandPressure 入边 = ${tgt.length} 条（正系数条数 = ${tgt.filter((r) => r.coefficient > 0).length}）`);
  for (const r of tgt) log(`    入边 ${r.sourceTypeKey}.${r.sourceStateVar} k=${r.coefficient} ref=${JSON.stringify(r.coefficientRef ?? null)} status=${r.status}`);
  let negAll = 0; for (const r of rr) if (typeof r.coefficient === "number" && r.coefficient < 0) negAll++;
  log(`全表负系数边 = ${negAll} 条（出荷态 6 条）`);

  const r0 = await getRule();
  log(`金丝雀⓪ 目标边开跑态 k=${r0?.coefficient} ref=${JSON.stringify(r0?.coefficientRef ?? null)}`);

  // ── 1. 世界读取器 ────────────────────────────────────────────────
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  log(`金丝雀③ 视图配置解出 Order=${orderIds.length} Model=${modelIds.length}（均须 >0）`);

  const runArm = async (tag) => {
    const s = (await post("/sim/sessions", {})).json;
    await sleep(400);
    const det = (await g(`/sim/sessions/${s.id}`)).json;
    const tr = await post(`/sim/sessions/${s.id}/tick`, { n: 12 });
    await sleep(400);
    const w = (await g(`/sim/sessions/${s.id}/world`)).json;
    const bs = det.baseSnapshot ?? {}, st = w.state ?? {};
    const rows = orderIds.map((i) => ({ i, base: bs[i]?.demandPressure, v: st[i]?.demandPressure }))
      .filter((p) => typeof p.base === "number" && typeof p.v === "number");
    const fbBase = modelIds.map((i) => bs[i]?.forecastBias).filter((x) => typeof x === "number");
    const fbLive = modelIds.map((i) => st[i]?.forecastBias).filter((x) => typeof x === "number");
    const above = rows.filter((p) => p.v > p.base + 0.01);
    const ratio = rows.filter((p) => p.base > 0).map((p) => p.v / p.base);
    log(`${tag}: 会话=${s.id} tickHTTP=${tr.status} 可比单=${rows.length} | fb(base) n=${fbBase.length} min=${Math.min(...fbBase)} max=${Math.max(...fbBase)} 负=${fbBase.filter((x) => x < 0).length} | fb(活) 负=${fbLive.filter((x) => x < 0).length} | 读数>基值+0.01 = ${above.length}/${rows.length} | 比值 min=${Math.min(...ratio).toFixed(6)} max=${Math.max(...ratio).toFixed(6)}`);
    return { rows, above, fbBase, fbLive };
  };

  // ── 2. 四臂 ──────────────────────────────────────────────────────
  log("── 臂 A · 出荷态 k=−0.222 ref={C36} ──");
  await setArm("A", K0, REF0);
  const A = await runArm("A 出荷态");
  log("── 臂 B · ★判决臂 k=−0.222 ref=null（符号不变，只置空 ref）──");
  await setArm("B", K0, null);
  const Bm = await runArm("B 空ref保号");
  log("── 臂 C · 翻转 k=+0.222 ref=null（复现 P3）──");
  await setArm("C", 0.222, null);
  const C = await runArm("C 翻转");
  log("── 臂 D · 翻转保ref k=+0.222 ref={C36}（ref 优先性对照）──");
  await setArm("D", 0.222, REF0);
  const D = await runArm("D 翻转保ref");

  // ── 3. 交叉比较（逐单） ──────────────────────────────────────────
  const idx = (R) => new Map(R.rows.map((p) => [p.i, { v: p.v, base: p.base }]));
  const iA = idx(A), iB = idx(Bm), iC = idx(C), iD = idx(D);
  const common = [...iA.keys()].filter((k) => iB.has(k) && iC.has(k) && iD.has(k));
  const diff = (X, Y) => common.filter((k) => X.get(k).v !== Y.get(k).v).length;
  log(`共同可比单 = ${common.length}`);
  log(`★B vs A（只把 ref 置空、符号不变）变化 = ${diff(iB, iA)}/${common.length}  ⇒ 若为 0，ref 置空本身不改变读数`);
  log(`★C vs A（翻符号+置空ref）变化 = ${diff(iC, iA)}/${common.length}  ⇒ 正对照：扰动必须落地`);
  log(`★D vs A（翻符号但保留 ref）变化 = ${diff(iD, iA)}/${common.length}  ⇒ 0 ⇒ ref 赢（inline 被忽略）；大 ⇒ inline 赢`);
  log(`★四臂上穿计数： A=${A.above.length} B=${Bm.above.length} C=${C.above.length} D=${D.above.length} / 各 ${A.rows.length}`);

  const top = (R, n) => [...R.rows].sort((x, y) => (y.v - y.base) - (x.v - x.base)).slice(0, n)
    .map((p) => `${p.i} base=${p.base} v=${p.v.toFixed(6)} Δ=${(p.v - p.base).toFixed(4)}`);
  log(`A 前 ${3} 大 Δ：${top(A, 3).join(" | ")}`);
  log(`B 前 ${3} 大 Δ：${top(Bm, 3).join(" | ")}`);
  log(`C 前 ${3} 大 Δ：${top(C, 3).join(" | ")}`);

  await restore();
  log("── 结束 ──");
} catch (e) {
  log(`‼ 异常：${e?.stack || e}`);
  L.push("CAPTURED_RC=7");
  fs.writeFileSync(OUT, L.join("\n") + "\n");
  try { await restore(); } catch { }
  process.exit(7);
}
