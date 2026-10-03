/**
 * 评审员#2 · 独立追问 3：上游登记为「未解释·独立账」的那条 ——
 *   「阳对照里 Base.loadIndex 入边全正，13 个对象中却有 8 个相对基值**下穿**」
 * 是不是**同一条顺序事实的另一侧**（上夹 + 合成在夹值之后）？
 *
 * 可判据的预言（写于取数之前）：
 *   若下穿由「基值 > 声明上界 max ⇒ 上夹把值压到 <max，而合成只补 λ·base、下一拍又被压回」
 *   造成，则：
 *     ① 下穿的对象 = 基值 > max 的对象，**不是**入边符号决定；
 *     ② 观测终态 ≈ 递推不动点 x = clamp((1−λ)x + c) + λ·base 的数值解（用同一 λ、同一域）；
 *     ③ 基值在域内的对象不下穿。
 *   任一条不成立 ⇒ 该账另有机制，本追问作废。
 * ⛔ 只读。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { } return { status: r.status, ok: r.ok, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);
const bat = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const dom = bat.STATE_VAR_DOMAINS;
const rules = (await g("/sim/propagation-rules")).json.items;
const typeOf = new Map();
for (const [tk, ids] of Object.entries((await g("/sim/view-config")).json.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);

const clamp = (raw, d, lambda) => { // 复刻 saturateToDomain（含上下带）+ rest
  const rest = Math.min(d.max ?? Infinity, Math.max(d.min, d.restPoint));
  if (d.max === null) return Math.max(raw, d.min);
  if (!(d.max > d.min)) return raw;
  const bandHi = (d.max - rest) * 0.25;
  if (bandHi > 0) { const k = d.max - bandHi; if (raw > k) return d.max - bandHi / (1 + (raw - k) / bandHi); }
  else if (raw > d.max) return d.max;
  const bandLo = (rest - d.min) * 0.25;
  if (bandLo > 0) { const k = d.min + bandLo; if (raw < k) return d.min + bandLo / (1 + (k - raw) / bandLo); }
  else if (raw < d.min) return d.min;
  return raw;
};

const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 30 });
const w = (await g(`/sim/sessions/${s.id}/world`)).json;
const rep = null;
const LAM = 0.37; // 引擎自报（前一探针已独立取到，见 RV2-negedge-independent.txt）

// ⛔ Object.keys(Map) 恒为 [] —— 第一版踩了这个坑，读成「Base 对象 0 个」。
//    双金丝雀：Map 必须非空，且必须命中 Base（否则下面全是空转）。
if (typeOf.size === 0) { log("❌ 金丝雀坏：typeOf 为空 ⇒ 取法错，结论作废"); process.exit(2); }
const bases = [...typeOf.entries()].filter(([, tk]) => tk === "Base").map(([id]) => id).sort();
if (bases.length === 0) { log("❌ 金丝雀坏：Base 命中 0 个（必然 >0，见 type 直方图 13）⇒ 取法错"); process.exit(2); }
log(`会话 ${s.id} · Base 对象 ${bases.length} 个 · λ=${LAM}（引擎自报，见 RV2-negedge-independent.txt）`);
log(`\n① 逐 Base：入边符号 vs 基值是否越上界 vs 终态是否下穿`);
log(`id                          基值        终态        下穿?  基值>max?  入边符号`);
let tab = [];
for (const id of bases) {
  const b = det.baseSnapshot?.[id]?.loadIndex, x = w.state?.[id]?.loadIndex;
  const edges = rules.filter((r) => r.targetTypeKey === "Base" && r.targetStateVar === "loadIndex");
  const signs = edges.map((r) => (r.coefficient > 0 ? "+" : "-")).join("");
  const below = typeof b === "number" && typeof x === "number" && x < b - 1e-9;
  tab.push({ id, b, x, below, over: typeof b === "number" && b > 100 + 1e-9 });
  log(`${id.padEnd(28)} ${String(b).padEnd(11)} ${String(x).padEnd(11)} ${below ? "是" : "否"}    ${typeof b === "number" && b > 100 ? "是" : "否"}       ${signs}`);
}
const down = tab.filter((r) => r.below), upc = tab.filter((r) => r.over);
log(`\n   下穿 ${down.length}/${tab.length} · 基值>max 的 ${upc.length}/${tab.length}`);
log(`   ✔ 判据①（下穿集合 == 基值>max 集合）：下穿∖越界 = ${down.filter((r) => !r.over).length} 个，越界∖下穿 = ${upc.filter((r) => !r.below).length} 个`);
log(`   ✔ 判据③（基值域内不下穿）：域内对象 ${tab.filter((r) => !r.over).length} 个，其中下穿 ${tab.filter((r) => !r.over && r.below).length} 个`);

// ② 递推不动点数值解：x_{n+1} = clamp((1−λ)x_n + c) + λ·base —— 取 c=0（零入流近似，loadIndex 入边系数 ≤0.0069 量级）
log(`\n② 递推解（clamp 在合成之前）：x ← clamp((1−λ)x) + λ·base，迭代 400 次`);
log(`id                          基值        递推解      实测         |递推−实测|`);
for (const r of tab) {
  let x = r.b;
  for (let i = 0; i < 400; i++) x = clamp((1 - LAM) * x, dom.loadIndex, LAM) + LAM * r.b;
  const d = Math.abs(x - r.x);
  log(`${r.id.padEnd(28)} ${String(r.b).padEnd(11)} ${x.toFixed(6).padEnd(11)} ${String(r.x).padEnd(11)} ${d.toFixed(6)}`);
}
// 反向臂：合成在夹值**之前**（正确顺序）的不动点 —— 应当 ≈ base
log(`\n③ 反向臂（合成在夹值之前，即本根因的修法）：x ← clamp((1−λ)x + λ·base)`);
log(`id                          基值        正序解      实测`);
for (const r of tab) {
  let x = r.b;
  for (let i = 0; i < 400; i++) x = clamp((1 - LAM) * x + LAM * r.b, dom.loadIndex, LAM);
  log(`${r.id.padEnd(28)} ${String(r.b).padEnd(11)} ${x.toFixed(6).padEnd(11)} ${String(r.x)}`);
}
log(`\n[eof]`);
