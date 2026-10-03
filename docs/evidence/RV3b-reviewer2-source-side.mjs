/**
 * RV3b · 评审员 #2 · **源侧**干预（上一轮只做了系数侧）
 *
 * 待评根因的判决句是「**符号即闸门**」—— 上一轮与我这轮都只在**系数**侧翻符号。
 * 本脚本在**源**侧动手：保持出荷态 k=−0.222 一个字节不改，把 baseSnapshot 里 6 个 Model 的
 * forecastBias 全设成 **−88**（= 声明域负半轴里最负的一档），其余每一格逐字节照抄种子世界。
 *
 * 预言（若根因成立）：靶单读数应**越过基值**，且增量 ≈ 0.6×88×(1−0.63^12) ≈ +52.59。
 * 证伪（若根因不成立）：仍 0/150 上穿 ⇒ 「签名即闸门」这一条被推翻，缺口另有其因。
 *
 * 金丝雀：
 *  ① 注入前后 baseSnapshot 里 Order.demandPressure 一格未动（只有 forecastBias 6 格变）
 *  ② 注入后回读：6/6 型号 = −88
 *  ③ 同机对照：同一时刻另建一个**不注入**的会话（= 出荷态世界），它必须 0/150 上穿
 */
import fs from "node:fs";

const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3b-reviewer2-source-side.txt";
const L = [];
const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc?.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  log(`金丝雀③ Order=${orderIds.length} Model=${modelIds.length}（必然 >0）`);

  // ── 取一份真种子世界当底本 ─────────────────────────────────────
  const s0 = (await post("/sim/sessions", {})).json;
  await sleep(500);
  const det0 = (await g(`/sim/sessions/${s0.id}`)).json;
  const base0 = det0.baseSnapshot ?? {};
  log(`底本会话=${s0.id} 对象数=${Object.keys(base0).length}（金丝雀：必然 >0）`);
  const fb0 = modelIds.map((i) => base0[i]?.forecastBias);
  log(`底本 fb = [${fb0.join(",")}] 负数=${fb0.filter((x) => typeof x === "number" && x < 0).length}`);

  // ── 注入：只改 6 格 forecastBias ⇒ −88 ─────────────────────────
  const injected = JSON.parse(JSON.stringify(base0));
  for (const i of modelIds) injected[i].forecastBias = -88;
  let changed = 0;
  for (const oid of Object.keys(base0)) {
    for (const sv of Object.keys(base0[oid])) {
      if (base0[oid][sv] !== injected[oid][sv]) { changed++; if (!(modelIds.includes(oid) && sv === "forecastBias")) log(`‼ 非目标格被改动：${oid}.${sv}`); }
    }
  }
  log(`注入改动格数 = ${changed}（须恰为 ${modelIds.length}）`);

  // ── 臂 S · 注入负源，出荷系数不动 ──────────────────────────────
  const sS = (await post("/sim/sessions", { baseSnapshot: injected })).json;
  await sleep(500);
  const detS = (await g(`/sim/sessions/${sS.id}`)).json;
  const fbS = modelIds.map((i) => detS.baseSnapshot?.[i]?.forecastBias);
  log(`臂 S 会话=${sS.id} 回读 fb = [${fbS.join(",")}]（须 6/6 = −88）`);
  const dpmS0 = orderIds.map((i) => detS.baseSnapshot?.[i]?.demandPressure);
  const dpm00 = orderIds.map((i) => base0[i]?.demandPressure);
  log(`金丝雀① 注入会话的 Order.demandPressure 与底本逐单相同 = ${dpmS0.filter((v, k) => v === dpm00[k]).length}/${orderIds.length}`);
  const wS0 = (await g(`/sim/sessions/${sS.id}/world`)).json;
  const trS = await post(`/sim/sessions/${sS.id}/tick`, { n: 12 });
  await sleep(300);
  const wS = (await g(`/sim/sessions/${sS.id}/world`)).json;
  const rowsS = orderIds.map((i) => ({ i, base: detS.baseSnapshot?.[i]?.demandPressure, v: wS?.state?.[i]?.demandPressure }))
    .filter((p) => typeof p.base === "number" && typeof p.v === "number");
  const upS = rowsS.filter((p) => p.v > p.base + 0.01);
  const ratioS = rowsS.filter((p) => p.base > 0).map((p) => p.v / p.base);
  const dS = rowsS.map((p) => p.v - p.base);
  log(`── 臂 S · 负源 + 出荷系数 k=−0.222 ──`);
  log(`   tickHTTP=${trS.status} 可比单=${rowsS.length}`);
  log(`   ★上穿(>基值+0.01) = ${upS.length}/${rowsS.length}｜比值 min=${Math.min(...ratioS).toFixed(6)} max=${Math.max(...ratioS).toFixed(6)}`);
  log(`   Δ 分布 min=${Math.min(...dS).toFixed(6)} max=${Math.max(...dS).toFixed(6)}（预言 ≈ +52.5936）`);
  const tr = trS.json?.trace ?? [];
  const edge = tr.filter((t) => t.toObjectId && Math.abs(t.amount) === 19.536);
  log(`   本拍 amount=+19.536 的 trace 行 = ${edge.length}（= k×(−88)，须 >0，否则源侧干预没进引擎）`);
  log(`   样例靶单：${upS.slice(0, 3).map((p) => `${p.i} base=${p.base} v=${p.v.toFixed(4)}`).join(" | ")}`);

  // ── 臂 T · 同机对照：不注入（出荷态世界）必须 0/150 ────────────
  const sT = (await post("/sim/sessions", {})).json;
  await sleep(500);
  const detT = (await g(`/sim/sessions/${sT.id}`)).json;
  await post(`/sim/sessions/${sT.id}/tick`, { n: 12 });
  await sleep(300);
  const wT = (await g(`/sim/sessions/${sT.id}/world`)).json;
  const rowsT = orderIds.map((i) => ({ i, base: detT.baseSnapshot?.[i]?.demandPressure, v: wT?.state?.[i]?.demandPressure }))
    .filter((p) => typeof p.base === "number" && typeof p.v === "number");
  const upT = rowsT.filter((p) => p.v > p.base + 0.01);
  log(`── 臂 T · 同机对照（不注入）──`);
  log(`   ★上穿 = ${upT.length}/${rowsT.length}  ⇒ 必须 0，否则本机此刻的世界已被别处污染`);

  const mine = new Set(orderIds);
  const common = rowsS.filter((p) => mine.has(p.i) && rowsT.some((q) => q.i === p.i));
  log(`★S vs T 逐单读数不同条数 = ${common.filter((p) => { const q = rowsT.find((x) => x.i === p.i); return q && q.v !== p.v; }).length}/${common.length}`);
  log("── 结束 ──");
} catch (e) {
  log(`‼ 异常：${e?.stack || e}`);
  L.push("CAPTURED_RC=7");
  fs.writeFileSync(OUT, L.join("\n") + "\n");
  process.exit(7);
}
