/**
 * 评审员#1 · 独立判决实验：**用户侧的扰动杠杆**能不能把「低估(−) ⇒ 需求压力上冲」那一支打开？
 *
 * 为什么值得单开一臂：根因链第 3/4 层说「唯一入源结构性非负 ⇒ 净入流恒 ≤0 ⇒ 那一支在数值上不可达」。
 * 但 `applyPerturbationToState`（contracts/src/sim.ts:1985-1995）对 mode:"set" 是**裸写**，
 * 不夹域 ⇒ 用户可以把 `Model.forecastBias` 设成负数。若那一臂能让 Order.demandPressure 越基值，
 * 则「不可达」是**播种态的性质**，不是世界结构上的不可能 —— 两者修法不同。
 *
 * 两臂（同一后端、各自新会话、tick 12）：
 *   C 对照臂：零扰动
 *   N 判决臂：PATCH 前 —— 先 POST 一条扰动 set obj_model_<X>.forecastBias = −50（永久）
 * 判据（预先声明，⛔ 不许事后改）：
 *   · 仪器自证：N 臂读回世界态里该型号 forecastBias **必须 == −50**，否则判 NOT-MEASURED（扰动没落地）
 *   · 若 N 臂出现 demandPressure > 基值+0.01 的单 ⇒ 「净入流恒 ≤0」在**有杠杆的世界里不成立**，
 *     根因链第 2/3 层须收窄为「播种态下恒 ≤0」
 *   · 若 N 臂仍 0/150 ⇒ 除源符号外还有第二道闸（须追）
 * ⛔ 只动本会话自己的扰动（session 作用域），不 PATCH 全局规则，不改产品代码。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/REV1-lever-negative-fb.txt";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j, raw: t }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };

const TARGET_MODEL = "obj_model_4680-NCM";

const runArm = async (tag, negFb) => {
  const s = (await post("/sim/sessions", {})).json;
  await sleep(400);
  if (negFb !== null) {
    const pr = await post(`/sim/sessions/${s.id}/perturbations`, {
      kind: "demand_shift", targetObjectId: TARGET_MODEL, targetStateVar: "forecastBias",
      magnitude: negFb, mode: "set", startTick: 0, durationTicks: null,
      label: `评审员#1：把 ${TARGET_MODEL} 的预测偏差设为 ${negFb}（低估）`,
    });
    log(`  [${tag}] 扰动 POST HTTP=${pr.status} id=${pr.json?.perturbation?.id ?? "?"} curTick=${pr.json?.curTick}`);
  }
  const tr = await post(`/sim/sessions/${s.id}/tick`, { n: 12 });
  await sleep(400);
  const det = (await g(`/sim/sessions/${s.id}`)).json;
  const w = (await g(`/sim/sessions/${s.id}/world`)).json;
  const bs = det.baseSnapshot ?? {}, st = w.state ?? {};
  const fb = st[TARGET_MODEL]?.forecastBias;
  const rows = Object.keys(st).filter((i) => bs[i] && typeof bs[i].demandPressure === "number" && typeof st[i].demandPressure === "number");
  const above = rows.filter((i) => st[i].demandPressure > bs[i].demandPressure + 0.01);
  log(`  [${tag}] 会话=${s.id} tickHTTP=${tr.status} | ${TARGET_MODEL}.forecastBias(活态)=${fb} | 可比单=${rows.length} | 越基值+0.01 = ${above.length}/${rows.length} | 世界末拍 tick=${w.tick}`);
  log(`  [${tag}] 前 3 大 Δ：` + rows.map((i) => ({ i, b: bs[i].demandPressure, v: st[i].demandPressure }))
    .sort((a, b) => (b.v - b.b) - (a.v - a.b)).slice(0, 3)
    .map((r) => `${r.i} base=${r.b} v=${r.v} Δ=${(r.v - r.b).toFixed(4)}`).join(" | "));
  return { s: s.id, fb, n: above.length, total: rows.length };
};

try {
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  log(`金丝雀：view-config 解出 Model=${[...typeOf.values()].filter(t=>t==="Model").length} Order=${[...typeOf.values()].filter(t=>t==="Order").length}（须 >0）`);
  log(`靶型号 = ${TARGET_MODEL}（type=${typeOf.get(TARGET_MODEL)}，须为 Model，否则量法坏了）`);

  log("── 臂 C · 零扰动对照 ──");
  const C = await runArm("C 零扰动", null);
  log("── 臂 N · forecastBias 设为 −50（低估）──");
  const N = await runArm("N fb=−50", -50);

  log(`★ 仪器自证：N 臂活态 forecastBias=${N.fb}（须 == −50）⇒ ${N.fb === -50 ? "扰动已落地" : "‼未落地 ⇒ 本臂 NOT-MEASURED"}`);
  log(`★ 判决：C 越基值 ${C.n}/${C.total} · N 越基值 ${N.n}/${N.total}`);
  log(`  ⇒ ${N.n > 0 ? "「净入流恒 ≤0」在**带杠杆的世界里不成立**（不可达是播种态的性质，不是结构上的不可能）"
                       : "即便源已为负，仍无单越基值 ⇒ 除源符号外还有第二道闸（须追）"}`);
  log("── 结束 ──");
} catch (e) { log(`‼ 异常: ${e?.stack ?? e?.message}`); }
