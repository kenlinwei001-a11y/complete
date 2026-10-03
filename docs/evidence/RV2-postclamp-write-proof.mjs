/**
 * 评审员#2 · 决定性判据：**合成写在夹值之后**这一条，用引擎**自己的饱和记账**证。
 *
 * 论证（不依赖任何推断）：
 *   · `saturateToDomain` 的上带返回 `max − bandHi/(1+u)`，bandHi>0 ⇒ **恒 < max**；
 *     bandHi===0 支返回**恰为 max**。⇒ 夹值**不可能产出 > max 的值**。
 *   · 下带同理：pressure 族 bandLo=(rest−min)×0.25=0 ⇒ 硬地板返回**恰为 min=0**，不可能 < min。
 *   · `propagation.ts` 夹值循环（:1147）之后到 return 之间**没有任何** `bucket[...] =` 赋值
 *     （grep 全函数 5 个写点：583/585/892/1086 全在夹值之前，1147 是夹值自己）。
 *   ⇒ 世界态里任何越出声明域的值，**只能是夹值之后被写进去的** = `restoreSpecBase`（app.ts:2643）。
 *
 * 判据两步：
 *  ① 同拍对照：本拍 saturations 记账里该格被夹到域内（value<max），而**终态读数 > max** ⇒ 后写铁证。
 *  ② 逐格轨迹：抓一个 tick0 在域内、终态越域的格，打印它每一拍的值（看它怎么走出去的）。
 * ⛔ 只读。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { } return { status: r.status, ok: r.ok, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);
const bat = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const dom = bat.STATE_VAR_DOMAINS;
const typeOf = new Map();
for (const [tk, ids] of Object.entries((await g("/sim/view-config")).json.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
if (typeOf.size === 0) { log("❌ 金丝雀坏：typeOf 空"); process.exit(2); }

const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const w0 = (await g(`/sim/sessions/${s.id}/world`)).json;

// 披露回包形状先自证（金丝雀：decayApplied 必须拿得到，否则路径写错）
const t1 = await post(`/sim/sessions/${s.id}/tick`, { n: 1, disclose: true });
const disc = t1.json ?? {};  // ⛔ 顶层才有 stateVarReport；`disclosure` 是另一个键（第一版写错，金丝雀当场拦住）
log(`披露回包顶层键: ${Object.keys(t1.json ?? {}).join(", ")}`);
const rep = disc?.stateVarReport;
log(`金丝雀：stateVarReport.decayApplied.demandPressure = ${rep?.decayApplied?.demandPressure}  ${typeof rep?.decayApplied?.demandPressure === "number" ? "✅ 路径对" : "❌ 路径错"}`);
const sats = rep?.saturations ?? [];
log(`本拍 saturations 条目 ${sats.length} 条`);
const w1 = (await g(`/sim/sessions/${s.id}/world`)).json;

// ① 同拍对照：本拍被夹的格，终态读数却越域
log(`\n① 同拍对照（本拍 saturations 记 value<max，而同拍世界读数 > max）——后写铁证：`);
const byKey = new Map();
for (const x of sats) byKey.set(`${x.objectId}|${x.stateVar}`, x);
let proofs = 0;
for (const [k, x] of byKey) {
  const v = w1.state?.[x.objectId]?.[x.stateVar];
  const d = dom[x.stateVar];
  if (typeof v !== "number" || !d) continue;
  const breached = d.max !== null && v > d.max + 1e-9;
  if (breached) {
    if (proofs < 12) log(`   ${typeOf.get(x.objectId)}.${x.stateVar} (${x.objectId})\n      本拍夹值 raw=${x.raw} → value=${x.value}（<max）  但同拍世界读数 = ${v} > max=${d.max}  Δ=${(v - x.value).toFixed(6)}`);
    proofs++;
  }
}
log(`   ⇒ 同拍「夹了却又越域」的格: ${proofs}/${byKey.size}`);

// ② 逐格轨迹：tick0 在域内、终态越域
log(`\n② 逐格轨迹（tick0 在域内 ∧ 终态越出 max）：`);
const track = [];
for (const [id, b] of Object.entries(w0.state ?? {})) for (const [sv, v] of Object.entries(b)) {
  const d = dom[sv]; if (!d || d.max === null || typeof v !== "number") continue;
  if (v >= d.min - 1e-9 && v <= d.max + 1e-9) {
    const vt = w1.state?.[id]?.[sv];
    if (typeof vt === "number" && vt > d.max + 1e-9) track.push({ id, sv, v0: v, v1: vt, d, base: det.baseSnapshot?.[id]?.[sv] });
  }
}
log(`   本拍就有 ${track.length} 个（tick0→tick1）。各量纲前 3：`);
const shown = new Set();
for (const r of track) {
  if (shown.has(r.sv)) continue; shown.add(r.sv);
  log(`   ${typeOf.get(r.id)}.${r.sv} ${r.id}: tick0=${r.v0} base=${r.base} tick1=${r.v1} 域[${r.d.min},${r.d.max}] λ·base=${(0.37 * (r.base ?? 0)).toFixed(6)}`);
  log(`      C2 补的恰为 λ·(base−rest)=${(0.37 * ((r.base ?? 0) - r.d.restPoint)).toFixed(6)}；tick0 在域内 ⇒ 越域不是种子带来的`);
  if (shown.size >= 4) break;
}
log(`\n[eof]`);
