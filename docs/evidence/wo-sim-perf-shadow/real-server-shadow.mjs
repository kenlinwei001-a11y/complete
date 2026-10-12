/* eslint-disable */
/**
 * WO-SIM-PERF-SHADOW · **真服务**取证（铁律 1.5 判据三：交付验证必须来自真起的服务）。
 *
 * 接缝门（8/8）证明的是「复用真的发生了，且与重放逐字节等价」（计数 + 回包比对）。
 * 本跑证明的是另一半 —— **它真的把那 43% 省掉了**：同一台服务、同一份世界、同一个拍号，
 * 一个会话命中、另一个冷跑，读服务端自己报的分段耗时 `disclosure.timings.shadow`。
 *
 * 为什么用**双胞胎**：`/tick` 会推进世界，同一会话没法在同一个拍号上跑两次。
 * 两个会话各自从**同一份派生世界**（不传 baseSnapshot ⇒ 服务端 SEED_DEMO 派生，确定性）
 * 起步、同规格扰动、同样推进 16 拍，于是第 17 次请求时两者处在同一拍同一世界。
 */
const DC = process.env.DC ?? "http://127.0.0.1:4017";
const H = { "content-type": "application/json", "x-debug-user": "demo:admin:admin|planner|catalog_admin" };
const j = async (m, u, body) => {
  const r = await fetch(`${DC}${u}`, { method: m, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${u} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

const BASE_ID = "obj_base_changzhou";
const seedTwin = async (tag) => {
  const s = await j("POST", "/a/v1/sim/sessions", {});
  await j("POST", `/a/v1/sim/sessions/${s.id}/perturbations`, {
    kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex",
    magnitude: 45, mode: "set", label: `真服务取证 ${tag}`,
  });
  return s.id;
};
const phase = (resp, name) => {
  const t = resp?.disclosure?.timings;
  if (!t) return null;
  if (Array.isArray(t)) return t.find((x) => (x.phase ?? x.name) === name)?.ms ?? null;
  return t[name] ?? null;
};
const tickOne = async (sid) => j("POST", `/a/v1/sim/sessions/${sid}/tick?disclose=1`, { n: 1 });
const tickN = async (sid, n) => j("POST", `/a/v1/sim/sessions/${sid}/tick`, { n });

await j("PUT", "/a/v1/tenants/demo/features", { overrides: { "sim.sandbox": true, "sim.propagation": true } });

// ⚠ 顺序是判据的一部分：**先推 B 再推 A**，备忘录才是 LRU 的 [B, A]，
//   下面 3 个填充会话超容量时挤掉的才是 **B**（要冷跑的那个），A 留下来命中。
// ⚠ 两个会话都要推到 16 拍 —— 第一版漏了给 B 推进，于是「冷跑」跑的是 0 拍重放，
//   两条读数都是 33ms，什么也没比出来；是脚本自带的「两个会话同拍同世界？」那行当场报「否」。
const B = await seedTwin("B");
const wb = await tickN(B, 16);
const A = await seedTwin("A");
const wa = await tickN(A, 16);
console.log(`A 到 curTick=${wa.curTick} · B 到 curTick=${wb.curTick}`);

// 3 个填充会话各占一格 ⇒ 容量 4 超限 ⇒ 挤掉最老的 B
for (const tag of ["F1", "F2", "F3"]) await tickN(await seedTwin(tag), 1);

// ★ 头号读数：A 在 curTick=16 上再要一拍 ⇒ 命中；B 从没跑过 ⇒ 冷跑，必须从 0 重放 16 拍
const a = await tickOne(A);
const b = await tickOne(B);
const sa = phase(a, "shadow");
const sb = phase(b, "shadow");
const all = (r) => (Array.isArray(r?.disclosure?.timings) ? r.disclosure.timings : r?.disclosure?.timings);

console.log(`\nA（命中）  curTick ${a.curTick - 1}→${a.curTick}  shadow=${sa}ms`);
console.log(`B（冷跑）  curTick ${b.curTick - 1}→${b.curTick}  shadow=${sb}ms`);
console.log(`A 分段: ${JSON.stringify(all(a))}`);
console.log(`B 分段: ${JSON.stringify(all(b))}`);
const ta = (a.disclosure?.timings ?? []).reduce?.((s, x) => s + (x.ms ?? 0), 0) ?? null;
console.log(`\n两个会话同拍同世界？ ${JSON.stringify(a.state) === JSON.stringify(b.state) ? "是（双胞胎成立）" : "否 —— 下面的对比无效"}`);
console.log(`信噪比逐字节相同？ ${JSON.stringify(a.signalToNoise) === JSON.stringify(b.signalToNoise)}`);

const ok = sa !== null && sb !== null && sb > 0 && sa < sb / 4;
console.log(`\n结论：${ok ? "✅ 命中那次把影子线重放省掉了" : "❌ 读数不支持（sa/sb = " + sa + "/" + sb + "）"}`);
process.exit(0);
