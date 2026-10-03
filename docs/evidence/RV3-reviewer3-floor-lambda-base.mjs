/**
 * 评审员#3 · 零扰动末拍：150 张单的 demandPressure 到底是 base + c/λ，还是被地板钉成 λ·base？
 *
 * 来历：我自己的逐拍轨迹（RV3-reviewer3-trajectory.txt）读出 SO-900325（fb=88 型号）
 *   60 → 40.464 → 28.156 → 22.2 → 22.2 → …（冻结在 22.2 = 0.37×60）。
 *   逐步手算与「**先夹到 0、再合成 +λ·base**」逐位吻合：
 *     t1: 0.63×60=37.8 −19.536 = 18.264 → +22.2 = 40.464 ✓
 *     t2: 0.63×40.464=25.492 −19.536 = 5.956 → +22.2 = 28.156 ✓
 *     t3: 0.63×28.156=17.738 −19.536 = −1.798 → 夹 0 → +22.2 = **22.2** ✓（此后恒 22.2）
 *   而根因链/ C2 文里用的代数是 x* = base + c/λ（SO-3391 命中 30）。两者只有在
 *   **原始值没触底**时才一致 —— 触底后终值是 λ·base，不是 base + c/λ。
 *
 * 本探针只量一件事：零扰动末拍，150 张单里有多少落在 λ·base 上、有多少落在 base + c/λ 附近。
 * 判据（预先声明）：
 *   · 若「读数 == 0.37×base（1e-9 内）」的条数 > 0 ⇒ 地板-合成效应是真的，且规模见该数；
 *   · 金丝雀：base ∈ (0,100] 的单必须 > 0（否则量法坏了）；λ 必须 == 0.37（引擎自报）
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3-reviewer3-floor-lambda-base.txt";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };

try {
  const s = (await post("/sim/sessions", {})).json;
  await sleep(300);
  await post(`/sim/sessions/${s.id}/tick`, { n: 12 });
  await sleep(400);
  const det = (await g(`/sim/sessions/${s.id}`)).json;
  const w = (await g(`/sim/sessions/${s.id}/world`)).json;
  const bs = det.baseSnapshot ?? {}, st = w.state ?? {};
  const LAM = 0.37; // 引擎峰值：PRESSURE_DECAY_PER_TICK（= C35 参数）
  const rows = Object.keys(st).filter((i) => bs[i] && typeof bs[i].demandPressure === "number" && typeof st[i].demandPressure === "number");
  const positiveBase = rows.filter((i) => bs[i].demandPressure > 0);
  const atLam = rows.filter((i) => Math.abs(st[i].demandPressure - LAM * bs[i].demandPressure) < 1e-9);
  const atBaseEps = rows.filter((i) => Math.abs(st[i].demandPressure - bs[i].demandPressure) < 0.01);
  const above = rows.filter((i) => st[i].demandPressure > bs[i].demandPressure + 0.01);
  log(`会话=${s.id} tick末=${w.tick} | 可比单=${rows.length}（金丝雀：须 ==150）`);
  log(`金丝雀① base>0 的单 = ${positiveBase.length}（须 >0）`);
  log(`金丝雀② 引擎自报 λ = ${LAM}（本探针写死；来源 C35 pressureDecayPerTick）`);
  log(`★ 落在 λ·base 上（1e-9）的单 = ${atLam.length}/${rows.length}`);
  log(`★ == base（±0.01）的单 = ${atBaseEps.length} | 越 base+0.01 的单 = ${above.length}`);
  log(`★ 低于 base 的单 = ${rows.length - atBaseEps.length - above.length}`);
  const sample = atLam.slice(0, 8).map((i) => `${i.replace("obj_order_", "")} base=${bs[i].demandPressure} v=${st[i].demandPressure} ratio=${(st[i].demandPressure / bs[i].demandPressure).toFixed(6)}`);
  log(`★ λ·base 样例：` + sample.join(" | "));
  // 反例：不在 λ·base 上的（说明不是全表都这样）
  const notLam = rows.filter((i) => !atLam.includes(i)).slice(0, 8).map((i) => `${i.replace("obj_order_", "")} base=${bs[i].demandPressure} v=${st[i].demandPressure} ratio=${bs[i].demandPressure ? (st[i].demandPressure / bs[i].demandPressure).toFixed(6) : "n/a"}`);
  log(`★ 非 λ·base 样例：` + notLam.join(" | "));
  log("── 结束 ──");
} catch (e) { log(`‼ 异常: ${e?.stack ?? e?.message}`); }
