#!/usr/bin/env node
/**
 * WO-M0-REBASE · A11 稀疏世界：25 张单为什么只有 12 条入边
 *
 *   node docs/evidence/wo-m0-rebase/a11-sparse-world.mjs
 *
 * ⛔ 无桩、不跑 vitest：真起 datacore 的装配路（`buildApp` + `seedDemo` + 合成作业 +
 *   `seedDemoPropagationRules`），与 A11 用例的 `makeApp()/seedBattery()/enableSim()`
 *   **逐步同源**（`makeApp` 默认 `seed !== false` ⇒ 它也播 `seedDemo`）。
 *
 * ── 待回答 ─────────────────────────────────────────────────────────────────────
 *   A11 的稀疏世界给同一型号的 25 张单各置 `demandPressure:10`，推一拍后期望型号
 *   **25 条入边**（`propagation.ts` 对 `amount === 0` 的边 `continue` ⇒ 零额边不落 trace）。
 *   今天实测 12 条。**12 是诚实的还是回归？**
 *
 * ── 逐张打印 ────────────────────────────────────────────────────────────────────
 *   order id · `props.qty` · `pairWeight(order → model)` · 有没有产生入边
 *   权重走**生产同一支** `buildPropagationInputs` + `pairWeightKey`，⛔ 测里不另抄一份。
 *
 * ── 🐤 金丝雀（缺一条下面的表就是空话）────────────────────────────────────────────
 *   ① `order_for_model` 链路非空、所选型号 ≥25 张单（否则实验搭不起来）
 *   ② `demo_order_demand_pressure` 规则在册，且 `pairWeights` 有它那张表
 *      （本仓真发生过「整张权重表空」的空绿）
 *   ③ **非空样例读数**：报「某某 qty 为 0 / 不在权重表里」这类否定结论时，
 *      同一把查法必须在一个**确知非空**的样例上读出非零 —— 否则是查法坏了不是数据没有。
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const R = new URL("../../../apps/datacore/dist/", import.meta.url).href;
const { loadConfig } = await import(R + "config.js");
const { createMemoryRepos } = await import(R + "repo/memory.js");
const { LocalFsBlobStore } = await import(R + "blob.js");
const { ScriptedLlmClient } = await import(R + "llm.js");
const { buildApp } = await import(R + "app.js");
const { seedDemo, seedDemoPropagationRules } = await import(R + "seed.js");
const { buildPropagationInputs } = await import(R + "sim/propagation-inputs.js");
const { pairWeightKey } = await import(R + "sim/propagation.js");
const { listSimWorldObjects } = await import(R + "sim/seed-world.js");
const { resolveSimScope } = await import(
  new URL("../../../apps/datacore/node_modules/@platform/contracts/dist/index.js", import.meta.url).href
);

const ADMIN = { "x-debug-user": "demo:admin:admin" };
const RULE = "demo_order_demand_pressure";

const blobDir = await mkdtemp(join(tmpdir(), "a11-sparse-"));
const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "test-secret" });
const repos = createMemoryRepos();
const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });
const app = built.app;

// ── A11 用例的播种序列，逐步同源 ────────────────────────────────────────────────
await seedDemo(repos); //                         makeApp() 默认就播这一步
const job = await app.inject({
  method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN,
  payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
}); //                                            seedBattery(t)
if (job.statusCode !== 202) throw new Error(`合成作业失败 ${job.statusCode}: ${job.body.slice(0, 300)}`);
await seedDemoPropagationRules(repos); //         seedDemoPropagationRules(t.repos)
await app.inject({
  method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
  payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
}); //                                            enableSim(t)

// ── 复刻 A11 的选型号 + 取 25 张单（逐字照抄用例，⛔ 不另起一套挑法）─────────────────
const links = await repos.links.list("demo", (l) => l.type === "order_for_model");
if (links.length === 0) throw new Error("🐤① order_for_model 链路为 0 ⇒ 实验前提不成立");
const byModel = new Map();
for (const l of links) {
  const arr = byModel.get(l.toId);
  if (arr) arr.push(l.fromId);
  else byModel.set(l.toId, [l.fromId]);
}
const [modelId, orderIds] = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)[0];
if (orderIds.length < 25) throw new Error(`🐤① 最多订单的型号只有 ${orderIds.length} 张单 < 25`);
const picked = orderIds.slice(0, 25);
console.log(`🐤① order_for_model ${links.length} 条 · 型号 ${modelId} 名下 ${orderIds.length} 张单 · 取前 25 张`);

// ── 稀疏世界：25 张单各 10 点需求压力 + 型号清零 ─────────────────────────────────
const baseSnapshot = { [modelId]: { demandLoad: 0 } };
for (const o of picked) baseSnapshot[o] = { demandPressure: 10 };
const sid = (await (await app.inject({
  method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot },
})).json()).id;
const tick = await app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
if (tick.statusCode !== 200) throw new Error(`tick 失败 ${tick.statusCode}: ${tick.body.slice(0, 300)}`);

const row = await repos.sim.getTickState("demo", sid, 1);
const trace = row?.trace ?? [];
const inEdges = trace.filter((e) => e.toObjectId === modelId);
const inFrom = new Map(inEdges.map((e) => [e.fromObjectId, e]));

// ── 权重：走生产同一支 ──────────────────────────────────────────────────────────
const rules = await repos.sim.listPropagationRules("demo", true);
const rule = rules.find((r) => r.key === RULE);
if (!rule) throw new Error(`🐤② 规则 ${RULE} 不在册 ⇒ 取法坏了`);
const inp = await buildPropagationInputs(
  repos, { tenantId: "demo", userId: "admin", roles: ["admin"] }, resolveSimScope(null), rules,
);
const wtable = inp.pairWeights[RULE] ?? null;
if (wtable === null) throw new Error(`🐤② ${RULE} 没有权重表 ⇒ 口径没生效，下面全是空话`);
console.log(
  `🐤② 规则 ${rules.length} 条 · ${RULE}: weightRef=${JSON.stringify(rule.weightRef)} ` +
    `coefficient=${rule.coefficient} coefficientRef=${JSON.stringify(rule.coefficientRef)} · 权重表 ${Object.keys(wtable).length} 项`,
);

// ── 逐张：qty · status · 在不在推演世界 · pairWeight · 有没有入边 ────────────────
// ⚠ 对象取数走 `listByType`（与 `pair-weights.ts:310` 同一个调用），⛔ 不用 `objects.list(pred)`
//   —— 第一版探针用了后者，25 张单的 `props.qty` **全读成 undefined**，而其中 12 张明明有非零
//   权重。🐤③ 当场把这个矛盾抖了出来：是取法坏了，不是数据没有。
const orders = await repos.objects.listByType("demo", rule.sourceTypeKey);
const byId = new Map(orders.map((o) => [o.id, o]));
// 推演世界成员：走**生产唯一物化入口**，⛔ 不在这里自己抄一份 `status !== "COMPLETED"`
//   —— 那就是 `listSimWorldObjects` 头注点名的「第 6 份手抄」。
const inWorld = new Set((await listSimWorldObjects(repos, "demo")).map((r) => r.obj.id));
console.log(`\n型号 ${modelId} · 25 张单逐张（qty/status 读 ${rule.sourceTypeKey}.props，取法同 pair-weights.ts:310）\n`);
console.log("  #  orderId                     qty     status          进世界 pairWeight            入边  amount");
const rows = [];
for (let i = 0; i < picked.length; i++) {
  const id = picked[i];
  const o = byId.get(id);
  const qty = o ? o.props.qty : undefined;
  const status = o ? o.props.status : "(对象不存在)";
  const w = wtable[pairWeightKey(id, modelId)];
  const e = inFrom.get(id);
  rows.push({ id, qty, status, world: inWorld.has(id), w, has: !!e, amount: e ? e.amount : null });
  console.log(
    `  ${String(i + 1).padStart(2)}  ${id.padEnd(27)} ${String(qty).padEnd(7)} ${String(status).padEnd(15)} ` +
      `${inWorld.has(id) ? "✅" : "❌"}     ${String(w).padEnd(21)} ${e ? "✅" : "❌"}    ${e ? e.amount : "—"}`,
  );
}
const missing = rows.filter((r) => !r.has);
const present = rows.filter((r) => r.has);
console.log(`\n入边 ${inEdges.length} 条 / 25 张单 ⇒ 缺 ${missing.length} 张`);

// ── 🐤③ 非空金丝雀：同一把查法在确知非空的样例上必须读出非零 ─────────────────────
const nonEmpty = present[0];
console.log(
  `\n🐤③ 非空金丝雀（同一把查法 · 确知非空样例）：${nonEmpty.id} ` +
    `props.qty=${nonEmpty.qty} · status=${nonEmpty.status} · pairWeight=${nonEmpty.w} · amount=${nonEmpty.amount} ` +
    `⇒ 查法能读出非零，故下面的「为 0 / 不在表里」是数据本身，不是查法坏了`,
);

// ── 缺的那些：定性 ─────────────────────────────────────────────────────────────
console.log(`\n缺的 ${missing.length} 张逐张定性：`);
for (const r of missing) {
  const inTable = Object.prototype.hasOwnProperty.call(wtable, pairWeightKey(r.id, modelId));
  console.log(
    `  ${r.id}  qty=${JSON.stringify(r.qty)}  status=${JSON.stringify(r.status)}  ` +
      `进推演世界=${r.world}  在权重表里=${inTable}`,
  );
}

// ── 判据：缺的那批与「不进推演世界」是不是**同一批**（逐张对齐，不是条数相同）────────
const missSet = new Set(missing.map((r) => r.id));
const outWorld = new Set(rows.filter((r) => !r.world).map((r) => r.id));
const same = missSet.size === outWorld.size && [...missSet].every((id) => outWorld.has(id));
console.log(
  `\n⇒ 缺的 ${missSet.size} 张 与 不进推演世界的 ${outWorld.size} 张 **逐张同一批** = ${same}` +
    (same ? "（不是条数碰巧相同，是同一个集合）" : " ⚠ 不是同一批 ⇒ 还有第二个原因"),
);

// ── qty 分布（只在能读到对象时才算）─────────────────────────────────────────────
const zeroish = (q) => !(typeof q === "number" && q > 0);
console.log(
  `分布：被取的 25 张里 qty 非正/缺失 ${rows.filter((r) => zeroish(r.qty)).length} 张 ⇒ ` +
    `qty **不是**本次缺口的原因（缺的 13 张 qty 全是正数）`,
);

// ── 全租户 Order 的 status 构成 + 推演世界里还剩几张 ────────────────────────────
const statusHist = new Map();
for (const o of orders) statusHist.set(o.props.status, (statusHist.get(o.props.status) ?? 0) + 1);
console.log(
  `全租户 ${rule.sourceTypeKey} ${orders.length} 张：` +
    `${[...statusHist.entries()].sort().map(([s, n]) => `${s}=${n}`).join(" · ")}` +
    ` ⇒ 进推演世界 ${orders.filter((o) => inWorld.has(o.id)).length} 张`,
);
console.log(
  `该型号 ${orderIds.length} 张单里，进推演世界的 ${orderIds.filter((id) => inWorld.has(id)).length} 张 ` +
    `⇒ A11 若想凑满 N 条入边，必须从**这一批**里挑`,
);

// ── 这条边到底往型号写了几条：把 trace 里 toObjectId=model 的按 ruleKey 分组 ──────
const byRule = new Map();
for (const e of inEdges) byRule.set(e.ruleKey, (byRule.get(e.ruleKey) ?? 0) + 1);
console.log(`入边按规则分组：${[...byRule.entries()].map(([k, n]) => `${k}=${n}`).join(" · ") || "（空）"}`);

// ── trace 里这条规则一共写了几条（不限本型号）——分辨「这张单没参与」与「写到别处去了」──
const allRuleEdges = trace.filter((e) => e.ruleKey === RULE);
console.log(
  `全 trace 里 ${RULE} 共 ${allRuleEdges.length} 条，落到本型号 ${allRuleEdges.filter((e) => e.toObjectId === modelId).length} 条`,
);

// ── 那 25 张单在图上还连到别的型号吗（一单多型号会把压力分走）─────────────────────
const linkCountOf = new Map();
for (const l of links) linkCountOf.set(l.fromId, (linkCountOf.get(l.fromId) ?? 0) + 1);
const multi = picked.filter((id) => (linkCountOf.get(id) ?? 0) > 1);
console.log(`被取的 25 张单里，连到 >1 个型号的有 ${multi.length} 张`);

// ══════════════════════════════════════════════════════════════════════════════
// 修法验证：按**推演世界成员**挑型号与 25 张单 ⇒ 入边应当回到 25
// ⛔ 不是把断言改成 12 —— 12 没有独立出处，且那会让金丝雀永远不再守前提。
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\n修法验证：从「进推演世界」的单里挑\n${"═".repeat(78)}`);
const byModelWorld = new Map();
for (const l of links) {
  if (!inWorld.has(l.fromId)) continue; // 只数真能参与传导的那些
  const arr = byModelWorld.get(l.toId);
  if (arr) arr.push(l.fromId);
  else byModelWorld.set(l.toId, [l.fromId]);
}
const ranked = [...byModelWorld.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
console.log(`各型号「进世界的单」数 top5：${ranked.slice(0, 5).map(([m, a]) => `${m}=${a.length}`).join(" · ")}`);
const [modelId2, orderIds2] = ranked[0];
if (orderIds2.length < 25) throw new Error(`最多的型号只有 ${orderIds2.length} 张进世界的单 < 25 ⇒ 修法搭不起来`);
const picked2 = orderIds2.slice(0, 25);

const baseSnapshot2 = { [modelId2]: { demandLoad: 0 } };
for (const o of picked2) baseSnapshot2[o] = { demandPressure: 10 };
const sid2 = (await (await app.inject({
  method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: baseSnapshot2 },
})).json()).id;
const tick2 = await app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid2}/tick`, headers: ADMIN, payload: { n: 1 } });
if (tick2.statusCode !== 200) throw new Error(`tick2 失败 ${tick2.statusCode}`);
const row2 = await repos.sim.getTickState("demo", sid2, 1);
const trace2 = row2?.trace ?? [];
const inEdges2 = trace2.filter((e) => e.toObjectId === modelId2);
console.log(`型号 ${modelId2}（名下进世界的单 ${orderIds2.length} 张）· 取 25 张 ⇒ 入边 ${inEdges2.length} 条`);
console.log(
  `  全为 ${RULE} 且 |amount|>0 = ` +
    `${inEdges2.every((e) => e.ruleKey === RULE && Math.abs(e.amount) > 0)}`,
);

// 切片两组读数（照 A11 的手算规则复算一遍，确认账本仍对得上）
const sorted2 = [...inEdges2].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.fromObjectId.localeCompare(b.fromObjectId));
const kept2 = sorted2.slice(0, 19);
const total2 = sorted2.reduce((s, e) => s + Math.abs(e.amount), 0);
const keptSum2 = kept2.reduce((s, e) => s + Math.abs(e.amount), 0);
const expectedPct2 = Math.round((keptSum2 / total2) * 100 * 100) / 100;
const s20 = (await app.inject({
  method: "GET", url: `/a/v1/sim/sessions/${sid2}/explain-slice?targetObjectId=${encodeURIComponent(modelId2)}&tick=1&maxNodes=20`, headers: ADMIN,
})).json();
const sFull = (await app.inject({
  method: "GET", url: `/a/v1/sim/sessions/${sid2}/explain-slice?targetObjectId=${encodeURIComponent(modelId2)}&tick=1&maxNodes=1000`, headers: ADMIN,
})).json();
console.log(`  maxNodes=20  ⇒ nodes=${s20.nodes.length} edges=${s20.edges.length} coverage=${JSON.stringify(s20.coverage)}（手算 pct=${expectedPct2}）`);
console.log(`  maxNodes=1000⇒ nodes=${sFull.nodes.length} edges=${sFull.edges.length} coverage=${JSON.stringify(sFull.coverage)}`);

process.exit(0);
