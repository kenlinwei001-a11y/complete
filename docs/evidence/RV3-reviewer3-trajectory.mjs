/**
 * 评审员#3 · 逐拍轨迹：上穿/下压到底按什么代数走？
 *
 * 疑点（我自己 C/P 两臂里读出来的，与上游叙事的代数不符）：
 *   · N 臂 fb=−50：SO-3391 base=60 → 89.88（预言 x* = base + c/λ = 60 + 11.1/0.37 = 90 ✓）
 *   · P 臂 fb=+100：SO-3391 base=60 → 22.2（同一代数应给 x* = 60 − 22.2/0.37 = 0 ✗）
 *   · C 臂 SO-900325 base=60 → 22.2、SO-3476 base=48 → 17.76（= 0.37×base，看着像 λ×base）
 * ⇒ 本探针逐拍读 /world（不猜），把三条轨迹摊开：C 臂（零扰动）与 P 臂（fb=+100）。
 * 判据：若 12 拍后仍不收敛到预言值，则「收敛到 base + c/λ」这条代数在**这一格**上不成立，
 *       上界=基值这个结论须另找机制证明（或证明它只在某些格成立）。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3-reviewer3-trajectory.txt";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };

const WATCH = ["obj_order_SO-3391", "obj_order_SO-900325", "obj_order_SO-3476"];
const TARGET_MODEL = "obj_model_4680-NCM";

const runArm = async (tag, fbSet) => {
  const s = (await post("/sim/sessions", {})).json;
  await sleep(300);
  if (fbSet !== null) {
    const pr = await post(`/sim/sessions/${s.id}/perturbations`, {
      kind: "demand_shift", targetObjectId: TARGET_MODEL, targetStateVar: "forecastBias",
      magnitude: fbSet, mode: "set", startTick: 0, durationTicks: null, label: `评审员#3 轨迹臂 fb=${fbSet}`,
    });
    log(`  [${tag}] 扰动 HTTP=${pr.status}`);
  }
  const det = (await g(`/sim/sessions/${s.id}`)).json;
  const bs = det.baseSnapshot ?? {};
  const w0 = (await g(`/sim/sessions/${s.id}/world`)).json;
  log(`  [${tag}] 会话=${s.id} tick0=${w0.tick} | fb(靶)=${w0.state?.[TARGET_MODEL]?.forecastBias}`);
  log(`  [${tag}] base: ` + WATCH.map((i) => `${i.replace("obj_order_", "")}=${bs[i]?.demandPressure}`).join(" "));
  log(`  [${tag}] t0  : ` + WATCH.map((i) => `${i.replace("obj_order_", "")}=${w0.state?.[i]?.demandPressure}`).join(" "));
  let prev = w0.tick;
  for (let t = 1; t <= 12; t++) {
    await post(`/sim/sessions/${s.id}/tick`, { n: 1 });
    await sleep(120);
    const w = (await g(`/sim/sessions/${s.id}/world`)).json;
    const st = w.state ?? {};
    log(`  [${tag}] t${String(w.tick).padStart(2)}: ` + WATCH.map((i) => `${i.replace("obj_order_", "")}=${st[i]?.demandPressure}`).join(" "));
    if (w.tick <= prev) log(`  [${tag}] ‼ tick 未前进（${prev}→${w.tick}）⇒ 轨迹不可用`);
    prev = w.tick;
  }
  return s.id;
};

try {
  const wc = (await g("/sim/view-config")).json;
  const types = new Map();
  for (const [tk, ids] of Object.entries(wc.nodeObjectIds ?? {})) for (const id of ids) types.set(id, tk);
  log(`金丝雀 view-config：Model=${[...types.values()].filter((t) => t === "Model").length} Order=${[...types.values()].filter((t) => t === "Order").length}（须 >0）`);
  log(`金丝雀 靶对象类型：${TARGET_MODEL}=${types.get(TARGET_MODEL)}（须 Model）· ${WATCH[0]}=${types.get(WATCH[0])}（须 Order）`);
  log("── 臂 C · 零扰动 · 逐拍 ──");
  await runArm("C", null);
  log("── 臂 P · 靶型号 fb=+100 · 逐拍 ──");
  await runArm("P", 100);
  log("── 结束 ──");
} catch (e) { log(`‼ 异常: ${e?.stack ?? e?.message}`); }
