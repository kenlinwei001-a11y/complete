/**
 * RV3 · 评审员 #2 独立复核「负边单向传导 + 硬地板」根因（第3阶段·第2轮）
 *
 * ⛔ 不复用上一轮脚本：本脚本自己写读数、自己带金丝雀、自己算哈希。
 *
 * 复核的四件事（每条都带「必然命中」对照）：
 *  ① 入边扫描：Order.demandPressure 的入边条数/系数/ref/status（金丝雀：Order 为靶 ≥1、forecastBias 为源 ≥1）
 *  ② 铸造层：把 live baseSnapshot 的 Model.forecastBias 与**独立实现的 FNV-1a（%1000）**预测值逐一对表
 *     —— 对上 ⇒ 「运行时真值是那条哈希占位式铸的」这条从间接变直接
 *  ③ 符号判决：A 出荷态 k=−0.222 / B 保号置空 ref / C 翻正 k=+0.222，各新会话 tick12，
 *     数「读数 > 基值+0.01」的条数（自带上穿正对照：C 臂必须大面积上穿，否则量法坏了）
 *  ④ 机制算术：本拍 trace 里该边的 amount 是否恰为 k×fb、且靶格**只有这一条入流**；
 *     以及地板吸收后的读数是不是 λ·base（call order: 核内先夹、C2 合成在核之后加 λ·base）
 *
 * ⛔ 不动产品代码；跑完必定回退规则（try/finally）。
 */
import fs from "node:fs";

const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3-reviewer2-negedge-independent.txt";
const K0 = -0.222;
const REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };

const L = [];
const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 独立实现的 FNV-1a 32 → [0,1) 千分位（与仓里那份**分开写**，只按算法定义）。 */
function fnv1a01(s) {
  let h = 0x811c9dc5;              // FNV offset basis（2166136261）
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } // prime 16777619
  return ((h >>> 0) % 1000) / 1000;
}

const getRule = async () => ((await g("/sim/propagation-rules")).json?.items ?? []).find((r) => r.id === RID);
let restored = false;
const setArm = async (tag, coeff, ref) => {
  const p = await patch(`/sim/propagation-rules/${RID}`, { coefficient: coeff, coefficientRef: ref });
  const r = await getRule();
  const ok = r?.coefficient === coeff && JSON.stringify(r?.coefficientRef ?? null) === JSON.stringify(ref ?? null);
  log(`  [PATCH ${tag}] HTTP=${p.status} 回读 k=${r?.coefficient} ref=${JSON.stringify(r?.coefficientRef ?? null)} status=${r?.status} ⇒ ${ok ? "扰动已落地（回读两字段）" : "‼未落地"}`);
  return ok;
};
const restore = async () => {
  if (restored) return; restored = true;
  const p = await patch(`/sim/propagation-rules/${RID}`, { coefficient: K0, coefficientRef: REF0 });
  const r = await getRule();
  log(`回退 PATCH HTTP=${p.status} 回读 k=${r?.coefficient} ref=${JSON.stringify(r?.coefficientRef ?? null)} status=${r?.status}（须 ${K0} / ${JSON.stringify(REF0)}）`);
};

const above = (rows) => rows.filter((p) => p.v > p.base + 0.01).length;
const LAMBDA = 0.37;
const ACC12 = 1 - Math.pow(1 - LAMBDA, 12); // 0.996…

try {
  // ── ① 入边扫描 ──────────────────────────────────────────────────
  const rr = (await g("/sim/propagation-rules")).json?.items ?? [];
  log(`① 规则表 n=${rr.length}`);
  const canA = rr.filter((r) => r.targetTypeKey === "Order").length;
  const canB = rr.filter((r) => r.sourceStateVar === "forecastBias").length;
  log(`   金丝雀① Order 为靶的边 = ${canA}（必然 ≥1）｜金丝雀② forecastBias 为源的边 = ${canB}（必然 ≥1）`);
  const inEdges = rr.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure");
  log(`   ★ Order.demandPressure 入边 = ${inEdges.length} 条，其中 k>0 的 = ${inEdges.filter((r) => r.coefficient > 0).length} 条`);
  for (const r of inEdges) log(`     ${r.sourceTypeKey}.${r.sourceStateVar} k=${r.coefficient} ref=${JSON.stringify(r.coefficientRef ?? null)} status=${r.status} reaction=${JSON.stringify(r.reaction ?? null)}`);
  log(`   全表负系数边 = ${rr.filter((r) => typeof r.coefficient === "number" && r.coefficient < 0).length} 条`);

  // ── ② 世界 + 铸造层对表 ─────────────────────────────────────────
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc?.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  log(`② 金丝雀③ 视图配置 Order=${orderIds.length} Model=${modelIds.length}（必然 >0）`);
  const objs = (await g("/objects?type=Model&page=1&pageSize=50")).json;
  const propsFb = (objs?.items ?? []).map((o) => `${o.id}:props.forecastBias=${JSON.stringify(o.props?.forecastBias ?? null)}`);
  log(`   活对象 Model n=${(objs?.items ?? []).length} 的 props.forecastBias = ${propsFb.join(" | ") || "(空)"}`);

  const readWorld = async (sid) => {
    const det = (await g(`/sim/sessions/${sid}`)).json;
    const w = (await g(`/sim/sessions/${sid}/world`)).json;
    return { base: det?.baseSnapshot ?? {}, st: w?.state ?? {} };
  };

  const runArm = async (tag, ticks = 12) => {
    const s = (await post("/sim/sessions", {})).json;
    await sleep(500);
    const first = await readWorld(s.id);
    const tr = await post(`/sim/sessions/${s.id}/tick`, { n: ticks });
    await sleep(300);
    const last = await readWorld(s.id);
    const rows = orderIds.map((i) => ({ i, base: first.base[i]?.demandPressure, v: last.st[i]?.demandPressure }))
      .filter((p) => typeof p.base === "number" && typeof p.v === "number");
    const fbBase = modelIds.map((i) => first.base[i]?.forecastBias).filter((x) => typeof x === "number");
    // 铸造层对表：live 值 vs 独立哈希预测
    const hashRows = modelIds.map((i) => ({
      id: i, live: first.base[i]?.forecastBias,
      pred: Math.round(fnv1a01(`${i}|forecastBias`) * 100),
    }));
    const hashHit = hashRows.filter((r) => r.live === r.pred).length;
    const ratio = rows.filter((p) => p.base > 0).map((p) => p.v / p.base);
    // 「被夹后读 λ·base」假说计数
    const lamRows = rows.filter((p) => p.base > 0 && Math.abs(p.v - LAMBDA * p.base) < 1e-6);
    const up = rows.filter((p) => p.v > p.base + 0.01);
    const trace = tr.json?.trace ?? null;
    const edgeTrace = Array.isArray(trace) ? trace.filter((t) => t.ruleKey === (rr.find((r) => r.id === RID)?.key)) : null;
    // 靶格的饱和回执
    const sats = (tr.json?.stateVarReport?.saturations ?? []).filter((x) => x.stateVar === "demandPressure");
    const fbLive = modelIds.map((i) => last.st[i]?.forecastBias).filter((x) => typeof x === "number");
    log(`── ${tag} ──`);
    log(`   会话=${s.id} tickHTTP=${tr.status} 可比单=${rows.length}`);
    log(`   铸造对表：live vs round(fnv1a01(id|forecastBias)*100) 命中 ${hashHit}/${hashRows.length} :: ${hashRows.map((r) => `${r.id.split("_").slice(-2).join("_")} live=${r.live} pred=${r.pred}`).join(" | ")}`);
    log(`   fb 基值 n=${fbBase.length} = [${fbBase.join(",")}] 负数=${fbBase.filter((x) => x < 0).length}；fb 12拍后 负数=${fbLive.filter((x) => x < 0).length}`);
    log(`   ★上穿(>基值+0.01) = ${up.length}/${rows.length}｜比值 min=${Math.min(...ratio).toFixed(6)} max=${Math.max(...ratio).toFixed(6)}`);
    log(`   ★读数 ≈ λ×基值 的单数 = ${lamRows.length}/${rows.filter((p) => p.base > 0).length}（λ=0.37：核内先夹、C2 在核之后补 λ·base）`);
    if (edgeTrace) {
      const amts = [...new Set(edgeTrace.map((t) => t.amount))].sort((a, b) => a - b);
      const tgt = new Set(edgeTrace.map((t) => t.toObjectId));
      log(`   本拍该边 trace 行 = ${edgeTrace.length}｜不同 amount = ${amts.length} 个 [${amts.slice(0, 8).join(",")}${amts.length > 8 ? ",…" : ""}]｜靶对象 = ${tgt.size}`);
      const preds = modelIds.map((i) => Math.round((K0 * (first.base[i]?.forecastBias ?? 0)) * 1e12) / 1e12);
      const inGrid = edgeTrace.filter((t) => preds.some((p) => Math.abs(Math.abs(t.amount) - Math.abs(p)) < 1e-9)).length;
      log(`   trace amount 落在 {|k|×fb} 网格内的行 = ${inGrid}/${edgeTrace.length}`);
    } else log(`   (本拍回包无 trace：${JSON.stringify(Object.keys(tr.json ?? {}))})`);
    log(`   饱和回执 demandPressure 条目 = ${sats.length}${sats.length ? " 例：" + sats.slice(0, 3).map((x) => `raw=${x.raw}→${x.value} bound=${x.bound}`).join(" | ") : ""}`);
    return { rows, up: up.length, hashHit, fbBase, fbLive };
  };

  // ── ③ 三臂 ─────────────────────────────────────────────────────
  log("③ 三臂（各自新会话，同一后端、同一时刻）");
  await setArm("A 出荷态", K0, REF0);
  const A = await runArm("臂 A · 出荷态 k=−0.222 ref={C36}");
  await setArm("B 保号置空ref", K0, null);
  const Bm = await runArm("臂 B · k=−0.222 ref=null（分离「置空 ref」这个混淆变量）");
  await setArm("C 翻正", 0.222, null);
  const C = await runArm("臂 C · k=+0.222 ref=null（正对照：扰动必须落地）");

  const sum = (R) => R.rows.reduce((a, p) => a + p.v, 0);
  const diffs = (X, Y) => X.rows.filter((p, k) => { const q = Y.rows[k]; return q && q.i === p.i && q.v !== p.v; }).length;
  log(`★A=${A.up}/${A.rows.length} B=${Bm.up}/${Bm.rows.length} C=${C.up}/${C.rows.length}（上穿计数）`);
  log(`★B vs A 逐单变化 = ${diffs(Bm, A)} ⇒ 0 表示「置空 ref」本身不改变读数`);
  log(`★A vs C 逐单变化 = ${diffs(A, C)} ⇒ 大表示扰动真的改变世界（正对照）`);
  log(`★A/B 读数和之差 = ${(sum(A) - sum(Bm)).toFixed(6)}（应为 0 或极小）`);

  await restore();
  log("── 结束 ──");
} catch (e) {
  log(`‼ 异常：${e?.stack || e}`);
  L.push("CAPTURED_RC=7");
  fs.writeFileSync(OUT, L.join("\n") + "\n");
  try { await restore(); } catch { /* 忽略 */ }
  process.exit(7);
}
