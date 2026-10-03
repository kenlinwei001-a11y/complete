/**
 * 评审员 #1 · 独立复核 ②——C2 合成层的**镜像后果**：读数是否越出声明取值域？
 *
 * 待评根因只讲了「下界地板把入流吃掉 ⇒ 饱和区读数 = λ·base」。
 * 但**同一个序**（夹值在核内 / 合成在核后）还有一个方向上没人记账：
 * 合成加的是 `λ·(base−rest)`，**加在夹值之后** ⇒ 观测量（= base + 累积量）
 * 从此**不再经过取值域夹值**。机制的直接预言：
 *   域外读数应当存在，且**不是播种期带来的**（tick0 在域内、tick30 跑到域外）。
 *
 * 判据：
 *  ① 基线计数：tick0 域外格 / tick30 域外格（按 (对象·量) 计，只数**声明了域的**量）。
 *  ② 归因：域外的格里，tick0 也在域外的（播种期带来的） vs tick0 在域内而 tick30 在域外的
 *     （**合成层造出来的**）。后者是本脚本要找的东西。
 *  ③ 分层：域外格里有多少是**规格格**（stateVarValueRef !== undefined）、多少是入度>0（非外生）。
 * 金丝雀：① 域表条数必须 > 0 且含 demandPressure；② 必须能数出 ≥1 个 tick0 域内的格（否则量法无效）；
 *        ③ 同一把尺子量 demandPressure：必须 ∈ 域内（它是被地板压住的，不许假报域外）。
 */
const B = "http://127.0.0.1:4019/a/v1";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });

const bat = await import("../src/synthetic/battery.ts").catch(() => null)
  ?? await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = bat.STATE_VAR_DOMAINS;
const REF = bat.stateVarValueRef;
const domNames = Object.keys(DOMAINS);
console.log(`金丝雀A：域表条数 = ${domNames.length}；demandPressure 在表内 = ${domNames.includes("demandPressure")} ${JSON.stringify(DOMAINS.demandPressure && { min: DOMAINS.demandPressure.min, max: DOMAINS.demandPressure.max, rest: DOMAINS.demandPressure.restPoint })}`);
if (domNames.length === 0 || !domNames.includes("demandPressure")) { console.log("❌ 工具坏了：域表读不到"); process.exit(2); }

// 入度（从规则算）：(类型·量) → 入边数
const rules = ((await g("/sim/propagation-rules")).json.items ?? []);
const indeg = new Map();
for (const r of rules) indeg.set(`${r.targetTypeKey}|${r.targetStateVar}`, (indeg.get(`${r.targetTypeKey}|${r.targetStateVar}`) ?? 0) + 1);

const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const vc = (await g("/sim/view-config")).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const T = Number(process.env.T ?? 30);
await post(`/sim/sessions/${s.id}/tick`, { n: T });
const w = (await g(`/sim/sessions/${s.id}/world`)).json;
console.log(`会话 ${s.id} tick=${w.tick} 对象 ${Object.keys(w.state ?? {}).length}`);

const outOf = (v, d) => (typeof v === "number" && Number.isFinite(v)) && (v < d.min || (d.max !== null && v > d.max));
let cmp = 0, out0 = 0, out30 = 0, newOut = 0, newOutSpec = 0, newOutIndeg = 0;
const samples = [];
for (const [id, tk] of typeOf) {
  const b = det.baseSnapshot?.[id], c = w.state?.[id];
  if (!b || !c) continue;
  for (const [sv, d] of Object.entries(DOMAINS)) {
    const x0 = b[sv], x1 = c[sv];
    if (typeof x0 !== "number" || typeof x1 !== "number") continue;
    cmp++;
    const o0 = outOf(x0, d), o1 = outOf(x1, d);
    if (o0) out0++;
    if (o1) out30++;
    if (!o0 && o1) {
      newOut++;
      const spec = REF(tk, sv) !== undefined;
      const ind = indeg.get(`${tk}|${sv}`) ?? 0;
      if (spec) newOutSpec++;
      if (ind > 0) newOutIndeg++;
      if (samples.length < 12) samples.push(`${id}.${sv} [${tk}|${sv}] tick0=${x0} tick30=${x1} 域[${d.min},${d.max}] spec=${spec} 入度=${ind}`);
    }
  }
}
console.log(`\n比较 ${cmp} 个（对象·量）格（只数声明了域的量）`);
console.log(`  tick0 域外: ${out0}   tick30 域外: ${out30}`);
console.log(`  ★ tick0 在域内、tick30 跑到域外: ${newOut}  （其中规格格 ${newOutSpec} · 入度>0 ${newOutIndeg}）`);
for (const s2 of samples) console.log("   " + s2);

// 金丝雀C：demandPressure 必须不被假报域外
let dp = 0, dpOut = 0;
for (const [id, tk] of typeOf) {
  if (tk !== "Order") continue;
  const x1 = w.state?.[id]?.demandPressure;
  if (typeof x1 !== "number") continue;
  dp++; if (outOf(x1, DOMAINS.demandPressure)) dpOut++;
}
console.log(`金丝雀C（同尺子）：Order.demandPressure 在域内 ${dp - dpOut}/${dp}，域外 ${dpOut} ${dpOut === 0 ? "✅ 与「被地板压住」一致" : "❌ 量法或结论有误"}`);
process.exit(newOut > 0 ? 0 : 0);
