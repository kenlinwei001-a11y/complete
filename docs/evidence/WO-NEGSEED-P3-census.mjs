// P3 · 播种基值 vs domain 普查 —— 全 (类型·量) 格
// 取法：4019 真后端建会话 + dist 里的 STATE_VAR_DOMAINS / stateVarValueRef（与服务同一份 dist）
// ⛔ 自带金丝雀：必须至少命中 1 个已知越界格 + 1 个已知合法格，否则工具坏了
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  if (!r.ok) throw new Error(`${p} HTTP ${r.status} ${t.slice(0,200)}`); return JSON.parse(t); };
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef;

const s = await g("/sim/sessions", { method: "POST", body: "{}" });
const det = await g(`/sim/sessions/${s.id}`);
const w0 = await g(`/sim/sessions/${s.id}/world`);
await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
const w1 = await g(`/sim/sessions/${s.id}/world`);
const vc = await g("/sim/view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds)) for (const id of ids) typeOf.set(id, tk);

// 金丝雀⓪ 取法自证：映射必须覆盖 baseSnapshot 的绝大多数对象
const objs = Object.keys(det.baseSnapshot);
const mapped = objs.filter((o) => typeOf.has(o)).length;
console.log(`金丝雀⓪：baseSnapshot ${objs.length} 对象，nodeObjectIds 覆盖 ${mapped}（须 >0 且≈全部）`);
if (!(mapped > objs.length * 0.5)) { console.log("❌ 工具坏了：对象→类型映射没建起来"); process.exit(2); }

// 逐 (类型·量) 格
const cells = new Map(); // key -> {base:[], t1:[], dom}
for (const o of objs) {
  const tk = typeOf.get(o); if (!tk) continue;
  const b = det.baseSnapshot[o] ?? {};
  const t1 = w1.state[o] ?? {};
  for (const v of Object.keys(b)) {
    const val = b[v];
    const k = `${tk}|${v}`;
    if (!cells.has(k)) cells.set(k, { tk, v, dom: DOMAINS[v] ?? null, n: 0, bmin: Infinity, bmax: -Infinity, t1min: Infinity, t1max: -Infinity, neg: 0, outLo: 0, outHi: 0, t1back: 0, ref: valueRef(tk, v) !== undefined });
    const c = cells.get(k); c.n += 1;
    c.bmin = Math.min(c.bmin, val); c.bmax = Math.max(c.bmax, val);
    const x1 = typeof t1[v] === "number" ? t1[v] : NaN;
    if (Number.isFinite(x1)) { c.t1min = Math.min(c.t1min, x1); c.t1max = Math.max(c.t1max, x1); }
    if (val < 0) c.neg += 1;
    if (c.dom) {
      if (c.dom.min !== null && c.dom.min !== undefined && val < c.dom.min) c.outLo += 1;
      if (c.dom.max !== null && c.dom.max !== undefined && val > c.dom.max) c.outHi += 1;
      // tick1 是否被夹回 domain 内（对同一对象）
      if (Number.isFinite(x1)) {
        const lo = c.dom.min ?? -Infinity, hi = c.dom.max ?? Infinity;
        if ((val < lo && x1 >= lo) || (val > hi && x1 <= hi)) c.t1back += 1;
      }
    }
  }
}
const rows = [...cells.values()];
console.log(`金丝雀①：参与统计的 (类型·量) 格 = ${rows.length}（须 >30 且 <200）`);
if (!(rows.length > 30 && rows.length < 200)) { console.log("❌ 工具坏了：格数不合常理"); process.exit(2); }
const withDom = rows.filter((r) => r.dom);
const negRows = rows.filter((r) => r.neg > 0);
// 金丝雀② 正向：已知越界格必须被抓到（Material.shortageRisk 基值 −59.72，域 [0,100]）
const canary = rows.find((r) => r.tk === "Material" && r.v === "shortageRisk");
console.log(`金丝雀②（正向）：Material|shortageRisk 域=${JSON.stringify(canary?.dom)} base域=[${canary?.bmin?.toFixed(3)},${canary?.bmax?.toFixed(3)}] 负值格数=${canary?.outLo}`);
if (!canary || canary.outLo === 0) { console.log("❌ 工具坏了：已知越界格没被抓到"); process.exit(2); }

console.log(`\n=== 汇总 ===`);
console.log(`有域声明的格 ${withDom.length} / 全部 ${rows.length}；含负基值的格 ${negRows.length}`);
const oob = withDom.filter((r) => r.outLo > 0 || r.outHi > 0);
console.log(`🔴 播种基值越出 domain 的格 = ${oob.length}（越下界 ${oob.filter((r) => r.outLo > 0).length} / 越上界 ${oob.filter((r) => r.outHi > 0).length}）`);
console.log(`   其中 tick1 被夹回域内的对象数合计 = ${oob.reduce((a, r) => a + r.t1back, 0)}`);
console.log(`\n=== 越界格逐条（按下界越界对象数降序）===`);
console.log("类型|量                        域[min,max]rest   n  基值[min,max]            tick1[min,max]          越界obj 夹回");
for (const r of oob.sort((a, b) => b.outLo - a.outLo).slice(0, 30)) {
  const d = r.dom; const dm = `[${d.min ?? "-∞"},${d.max ?? "∞"}]r${d.restPoint}`;
  console.log(`${(r.tk + "|" + r.v).padEnd(30)} ${dm.padEnd(16)} ${String(r.n).padStart(3)} [${r.bmin.toFixed(3)},${r.bmax.toFixed(3)}]`.padEnd(78)
    + ` [${r.t1min.toFixed(3)},${r.t1max.toFixed(3)}]`.padEnd(26) + `${String(r.outLo).padStart(5)} ${String(r.t1back).padStart(5)}${r.ref ? "  规格" : ""}`);
}
console.log(`\n=== 无域声明但含负基值的格（域判据对它们无牙）===`);
console.log("类型|量                        入度类    n  基值[min,max]                tick1[min,max]");
for (const r of negRows.filter((r) => !r.dom).sort((a, b) => a.bmin - b.bmin).slice(0, 15)) {
  console.log(`${(r.tk + "|" + r.v).padEnd(30)} ${(r.ref ? "规格" : "  - ").padEnd(8)} ${String(r.n).padStart(3)} [${r.bmin.toFixed(3)},${r.bmax.toFixed(3)}]`.padEnd(70) + ` [${r.t1min.toFixed(3)},${r.t1max.toFixed(3)}]`);
}
fs.writeFileSync("/tmp/wo-3root/p3-census.json", JSON.stringify({ sid: s.id, rows }, null, 0));
