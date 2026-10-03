/**
 * 只读探针 · 「规格基值是不是一个可失效的量」—— 4019 真后端（SEED_DEMO=1）。
 *
 * 问三件事，全部只读（一次 POST 都不发，零副作用）：
 *   ① 会话记录里有没有**任何一个字段**能表达「我的基值比对象库旧」？（列全字段名）
 *   ② 今天 base 值 == 对象 props 按规格式算出来的值吗？（等价是否今天成立）
 *   ③ 这条等价靠什么维持？—— 会话记录里有没有对象库的修订号？
 *
 * ⛔ 本探针不建会话、不 tick、不写任何东西。会话 id 由参数给（缺省取列表里第一条）。
 * 金丝雀：两个读数各自必须取到「数」，取不到就报工具坏了，不许把 undefined 读成「没有字段」。
 */
const BASE = "http://127.0.0.1:4019";
const H = { "X-Debug-User": "demo:admin:admin" };

const j = async (path) => {
  const r = await fetch(BASE + path, { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
};

const SID = process.argv[2] ?? "sims_demo_seed_world";
let bad = 0;
const say = (s) => console.log(s);

// ── ① 会话记录字段全集（单条读：含 baseSnapshot）──────────────────────────────
const s = await j(`/a/v1/sim/sessions/${SID}`);
const keys = Object.keys(s).sort();
say(`[1] 会话 ${SID} 字段全集（${keys.length}）：${keys.join(", ")}`);
// 金丝雀：确认取的是一条真会话（缺这两个键 ⇒ 取法坏了）
if (!s.baseSnapshot || typeof s.baseSnapshot !== "object") { say("  ❌ 金丝雀未中：baseSnapshot 取不到 ⇒ 取法坏了，后续否定结论作废"); bad++; }
if (typeof s.curTick !== "number") { say("  ❌ 金丝雀未中：curTick 不是数"); bad++; }
// 扫描「能表达基值新鲜度」的字段名（版本/修订/时刻/失效/来源世代）
const freshness = keys.filter((k) => /ver|rev|epoch|snapshotAt|updatedAt|derivedAt|stale|fresh|worldRev|sourceRev/i.test(k));
say(`[1b] 名称上像「新鲜度信号」的字段：${freshness.length === 0 ? "（0 个）" : freshness.join(", ")}`);
say(`     注：baseSnapshotScale = ${JSON.stringify(s.baseSnapshotScale ?? null)}（尺寸合计，不是新鲜度）`);
// 反向金丝雀：同一个正则在一份我知道含该形态的文本上必须命中
const canaryKeys = ["worldRev", "derivedAt", "baseSnapshot"].filter((k) => /ver|rev|epoch|snapshotAt|updatedAt|derivedAt|stale|fresh|worldRev|sourceRev/i.test(k));
say(`[1c] 反向金丝雀（正则必须能认出这类名）：命中 ${JSON.stringify(canaryKeys)} ⇒ 正则活着${canaryKeys.length ? "" : " ❌"}`);
if (canaryKeys.length === 0) bad++;

// ── ② 今天：base 值 vs props 按规格式算的值 ───────────────────────────────────
const ORDER = "obj_order_SO-3391";
const baseCell = s.baseSnapshot?.[ORDER]?.["demandPressure"];
say(`[2] baseSnapshot[${ORDER}].demandPressure = ${baseCell}（类型 ${typeof baseCell}）`);
const obj = await j(`/a/v1/objects/Order/${ORDER}`);
const first = obj.item ?? obj.data ?? obj;
if (!first || typeof first !== "object") { say("  ❌ 金丝雀未中：GET 对象取不到 ⇒ 取法坏了"); bad++; }
// 形状自证：取到的必须就是 SO-3391 那一行（按拿错形状的历史教训，先证形状再读数）
say(`[2a] 取回对象 id=${first?.id} type=${first?.type}（必须 id=${ORDER}）`);
if (first?.id !== ORDER) { say("  ❌ 金丝雀未中：取到的不是 SO-3391 ⇒ 形状不对"); bad++; }
const props = first?.props ?? {};
const delta = props["demandDelta"];
say(`[2b] 对象 props.demandDelta = ${delta}（类型 ${typeof delta}）  ⇒ 规格式 demandDelta×100 = ${typeof delta === "number" ? Math.round(delta * 100 * 1e6) / 1e6 : "N/A"}`);
if (typeof delta !== "number") { say("  ❌ 金丝雀未中：demandDelta 取不到 ⇒ 取法坏了（别读成「没有这个属性」）"); bad++; }
if (typeof baseCell === "number" && typeof delta === "number") {
  const specNow = Math.round(delta * 100 * 1e6) / 1e6;
  say(`[2c] 等价今天成立？ baseCell=${baseCell} specNow=${specNow} ⇒ ${baseCell === specNow ? "相等（等价成立，但没有任何东西在守它）" : "不等（不等价！模型需修正）"}`);
}

// ── ③ 会话记录里有没有对象库的修订号 ─────────────────────────────────────────
const hasRev = JSON.stringify(s).includes("revision") || JSON.stringify(s.scope ?? {}).includes("rev");
say(`[3] 会话记录（含 scope）里出现 "revision"/"rev" 字样：${hasRev ? "有" : "没有"}`);
say(`    scope 键：${Object.keys(s.scope ?? {}).sort().join(", ")}`);

say(bad === 0 ? "VERDICT: 金丝雀全中，读数可用" : `VERDICT: 金丝雀未中 ${bad} 处，本份读数作废`);
process.exit(bad === 0 ? 0 : 2);
