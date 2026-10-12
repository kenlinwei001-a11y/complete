#!/usr/bin/env node
/**
 * WO-FORECASTBIAS-RETIRE · tick0 世界态里 `Model.forecastBias` 到底是多少、盖的什么出处章
 *
 *   node docs/evidence/wo-forecastbias-retire/fb-probe.mjs
 *
 * ⛔ 无桩、不读库、不跑 vitest：真起 datacore 的**生产装配路**（`buildApp` + `seedDemo` +
 *   合成作业 + `seedDemoPropagationRules` + `seedDemoDerivationSpecs` +
 *   `recomputeDemoDerivationsAtSeed` + `deriveSeedBaseSnapshot`），播种序列逐字节照抄
 *   `docs/evidence/wo-gain-reach/reach-table.mjs`（它就是 `server.ts:101/:105` 那一条）。
 *
 * ── 🐤 金丝雀（缺一条下面的读数就是空话）─────────────────────────────────────────
 *   ① 规格 / 物化两个数都非 0（这两步没生效 ⇒ 下面的「实测」章全假）
 *   ② 参与统计的 Model 数 = 6（对不上先解释再往下走）
 *   ③ 反向：与 forecastBias 无关的 `Material.priceShock` 8 格必须逐字节不变
 *   ④ tick0 出处表 measured/derived 两档都非空（证明它分得出两档，不是全盖一个章）
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
const { seedDemoDerivationSpecs, recomputeDemoDerivationsAtSeed } = await import(R + "seed-derivation-specs.js");
const { deriveSeedBaseSnapshot } = await import(R + "sim/seed-world.js");

const ADMIN = { "x-debug-user": "demo:admin:admin" };
const blobDir = await mkdtemp(join(tmpdir(), "fb-probe-"));
const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "test-secret" });
const repos = createMemoryRepos();
const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });
await seedDemo(repos);
const job = await built.app.inject({
  method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN,
  payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
});
if (job.statusCode !== 202) throw new Error(`合成作业失败 ${job.statusCode}: ${job.body.slice(0, 300)}`);
await seedDemoPropagationRules(repos);
const adminCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
const nSpecs = await seedDemoDerivationSpecs(repos, built.services.ontologyCore, built.services.governance, adminCtx);
const nDerived = await recomputeDemoDerivationsAtSeed(repos, built.services.ontologyCore, adminCtx);
if (nSpecs === 0 || nDerived === 0) {
  throw new Error(`🐤① 规格 ${nSpecs} 条 / 物化 ${nDerived} 个 —— 有一个为 0 说明这一步没生效，下面全是假的`);
}
console.log(`🐤① 生产播种序列：派生规格 ${nSpecs} 条 · 播种期全量初算物化 ${nDerived} 个对象`);

// ── 规格自身的状态（它坏没坏，是两回事）────────────────────────────────────────
const specs = await repos.derivationSpecs.list("demo", () => true);
const fb = specs.find((s) => s.specKey === "model_forecast_bias");
console.log(
  `\n══ model_forecast_bias 规格：${fb ? `status=${fb.status} unsatisfiedDeps=${JSON.stringify(fb.unsatisfiedDeps ?? null)}` : "**已退役（查无此规格）**"}`,
);

// ── tick0 世界态 ───────────────────────────────────────────────────────────────
const { state: t0, origin, provenance } = await deriveSeedBaseSnapshot(repos, "demo");
let nMeas = 0, nDeriv = 0;
for (const row of Object.values(provenance)) for (const o of Object.values(row)) (o === "measured" ? nMeas++ : nDeriv++);
if (nMeas === 0 || nDeriv === 0) throw new Error(`🐤④ 出处表只有一档（measured=${nMeas} derived=${nDeriv}）⇒ 它分不出两档`);
console.log(`🐤④ tick0 出处表两档都非空：measured=${nMeas} · derived=${nDeriv}（总 ${nMeas + nDeriv} 格）`);

const models = (await repos.objects.listByType("demo", "Model")).sort((a, b) => a.id.localeCompare(b.id));
const inWorld = models.filter((m) => t0[m.id] !== undefined);
console.log(`\n══ Model.forecastBias · tick0 世界态逐个 ══   (Model 对象 ${models.length} 个 / 进世界 ${inWorld.length} 个)`);
for (const m of inWorld) {
  console.log(
    `   ${m.id.padEnd(22)} forecastBias=${String(t0[m.id]?.forecastBias).padStart(6)}` +
    `  provenance=${String(provenance[m.id]?.forecastBias).padEnd(9)}` +
    `  o.props.forecastBias=${JSON.stringify(m.props.forecastBias)}`,
  );
}
if (inWorld.length !== 6) console.log(`   ⚠ 🐤② 进世界的 Model 数 = ${inWorld.length} ≠ 6 —— 先解释再往下走`);
else console.log(`   🐤② 进世界的 Model 数 = 6 ✅`);

// ── 🐤③ 反向金丝雀：与 forecastBias 无关的量纲必须逐字节不变 ────────────────────
const mats = (await repos.objects.listByType("demo", "Material")).sort((a, b) => a.id.localeCompare(b.id));
const ps = mats.filter((m) => t0[m.id]?.priceShock !== undefined).map((m) => t0[m.id].priceShock);
console.log(`\n🐤③ 反向金丝雀 Material.priceShock ${ps.length} 格 = [${ps.join(",")}]`);

// ── 下游：Order.demandPressure（那条 ×−0.6 负边的落点）──────────────────────────
const orders = (await repos.objects.listByType("demo", "Order")).sort((a, b) => a.id.localeCompare(b.id));
const dp = orders.filter((o) => t0[o.id]?.demandPressure !== undefined);
const dpv = dp.map((o) => t0[o.id].demandPressure);
const sum = dpv.reduce((a, b) => a + b, 0);
console.log(
  `\n══ Order.demandPressure · tick0（负边落点）n=${dpv.length}` +
  ` min=${Math.min(...dpv)} 均值=${(sum / dpv.length).toFixed(6)} max=${Math.max(...dpv)} 合计=${sum}`,
);

console.log(`\n══ 出处话术（屏上那句）══\n   ${origin.formula ?? "(无)"}`);

// ── 真跑推演：那条负边到底传不传导 ────────────────────────────────────────────
const feat = await built.app.inject({
  method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
  payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
});
if (feat.statusCode >= 400) throw new Error(`开特性失败 ${feat.statusCode}`);
const mk = await built.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: t0, scope: {} } });
if (mk.statusCode >= 400) throw new Error(`建会话失败 ${mk.statusCode}: ${mk.body.slice(0, 300)}`);
const sid = JSON.parse(mk.body).id;
const tk = await built.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
if (tk.statusCode >= 400) throw new Error(`tick 失败 ${tk.statusCode}: ${tk.body.slice(0, 300)}`);
const body = JSON.parse(tk.body);
const tr = body.trace ?? body.result?.trace ?? [];
if (tr.length === 0) throw new Error("🐤 反空绿：单拍 trace 是空的 ⇒ 一条边都没传导");
const FBEDGE = "demo_forecast_bias_to_order_demand";
const fbRows = tr.filter((t) => t.ruleKey === FBEDGE);
const fbSum = fbRows.reduce((a, t) => a + t.amount, 0);
console.log(
  `\n══ 真跑 1 拍 · 全图唯一负系数边 \`${FBEDGE}\`：trace ${fbRows.length} 行 / 传导量合计 ${fbSum}` +
  `   （全表 trace ${tr.length} 行 / ${new Set(tr.map((t) => t.ruleKey)).size} 条边 ⇐ 🐤 证明取法有鉴别力）`,
);
if (fbRows.length > 0) {
  const nz = fbRows.filter((t) => t.amount !== 0).length;
  console.log(`   其中 amount ≠ 0 的 ${nz} 行；样例 ${JSON.stringify(fbRows.slice(0, 3).map((t) => ({ to: t.toId, amount: t.amount })))}`);
}

// 推 24 拍后读落点
await built.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 23 } });
const w = await built.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN });
const st = JSON.parse(w.body).state;
for (const [tkk, sv] of [["Order", "demandPressure"], ["Model", "forecastBias"]]) {
  const ids = (await repos.objects.listByType("demo", tkk)).map((o) => o.id);
  const vals = ids.map((id) => st[id]?.[sv]).filter((v) => typeof v === "number");
  if (vals.length === 0) { console.log(`   ${tkk}.${sv} 🐤 一格都读不到 ⇒ 取数坏了`); continue; }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  console.log(
    `   24 拍后 ${`${tkk}.${sv}`.padEnd(24)} n=${String(vals.length).padStart(4)}` +
    ` min=${Math.min(...vals).toFixed(6).padStart(12)} 均值=${mean.toFixed(6).padStart(12)} max=${Math.max(...vals).toFixed(6).padStart(12)}`,
  );
}

await built.app.close();
