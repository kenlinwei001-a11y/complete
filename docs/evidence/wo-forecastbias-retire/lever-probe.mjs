#!/usr/bin/env node
/**
 * WO-FORECASTBIAS-RETIRE · 附 · 「杠杆是死的」这句话到底对不对
 *
 *   node docs/evidence/wo-forecastbias-retire/lever-probe.mjs
 *
 * 派单 §2 断言「沙盘唯一的『需求高估』杠杆是死的」。但 `contracts/src/sim-drill.ts` 的
 * `FORECAST_BIAS.stateEffect.mode` 是 **`"delta"`**（不是 `"absolute"`）⇒ 用户拨杆是
 * **加在基线上**的。若如此，基线恒 0 时用户拨杆**仍会**让那条负边传导 —— 那么真正坏掉的
 * 不是「杠杆」，而是**基线**（一个盖着 "measured" 章的恒等式零）。
 *
 * ⛔ 这个问题不许靠读代码回答（铁律 0.5）。本探针**真起数据**：
 *   同一个引擎、同一批规则，只改 `baseSnapshot` 里 6 个型号的 `forecastBias`，
 *   A 组全设 0（复刻退役前的基线），B 组用退役后的哈希值；各自再叠一次 +20 的扰动。
 *   四种组合各数一次那条负边的 trace 行数与传导量。
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
const blobDir = await mkdtemp(join(tmpdir(), "fb-lever-"));
const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "test-secret" });
const repos = createMemoryRepos();
const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });
await seedDemo(repos);
const job = await built.app.inject({
  method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN,
  payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
});
if (job.statusCode !== 202) throw new Error(`合成作业失败 ${job.statusCode}`);
await seedDemoPropagationRules(repos);
const adminCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
await seedDemoDerivationSpecs(repos, built.services.ontologyCore, built.services.governance, adminCtx);
await recomputeDemoDerivationsAtSeed(repos, built.services.ontologyCore, adminCtx);
const { state: t0 } = await deriveSeedBaseSnapshot(repos, "demo");
await built.app.inject({
  method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
  payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
});

const models = (await repos.objects.listByType("demo", "Model")).map((m) => m.id).filter((id) => t0[id]);
const FBEDGE = "demo_forecast_bias_to_order_demand";

/** 建会话 → 按需叠扰动 → 跑一拍 → 数那条负边。 */
async function run(label, mutate, bump) {
  const snap = JSON.parse(JSON.stringify(t0));
  for (const id of models) mutate(snap, id);
  const fbIn = models.map((id) => snap[id].forecastBias);
  const mk = await built.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: snap, scope: {} },
  });
  if (mk.statusCode >= 400) throw new Error(`建会话失败 ${mk.statusCode}: ${mk.body.slice(0, 200)}`);
  const sid = JSON.parse(mk.body).id;
  if (bump) {
    // 用户拨杆 = 在基线上叠 +20（`sim-drill.ts` FORECAST_BIAS.stateEffect.mode === "delta"）。
    // 走生产路由 `/act`（`mode:"set"`）写「基线+20」这个终值 —— 与 delta 叠加同终态，
    // 而 `/act` 是沙盘今天真在用的那条扰动入口（app.ts `sim/sessions/:id/act`）。
    for (const id of models) {
      const p = await built.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: ADMIN,
        payload: { objectId: id, stateVar: "forecastBias", value: (snap[id].forecastBias ?? 0) + 20 },
      });
      if (p.statusCode >= 400) throw new Error(`扰动失败 ${p.statusCode}: ${p.body.slice(0, 300)}`);
    }
  }
  const tk = await built.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 },
  });
  if (tk.statusCode >= 400) throw new Error(`tick 失败 ${tk.statusCode}: ${tk.body.slice(0, 300)}`);
  const b = JSON.parse(tk.body);
  const tr = b.trace ?? b.result?.trace ?? [];
  const rows = tr.filter((t) => t.ruleKey === FBEDGE);
  console.log(
    `   ${label.padEnd(34)} 源值=[${fbIn.join(",")}]`.padEnd(70) +
    ` 负边 trace ${String(rows.length).padStart(4)} 行 · 传导量合计 ${rows.reduce((a, t) => a + t.amount, 0).toFixed(3).padStart(12)}` +
    `   (全表 ${String(tr.length).padStart(4)} 行 ⇐ 🐤)`,
  );
  return rows.length;
}

console.log(`══ 那条 ×−0.6 负边在四种组合下传不传导（源 = Model.forecastBias，${models.length} 个型号）══`);
const a0 = await run("A 退役前基线(全0) · 不拨杆", (s, id) => { s[id].forecastBias = 0; }, false);
const a1 = await run("A 退役前基线(全0) · 拨杆+20", (s, id) => { s[id].forecastBias = 0; }, true);
const b0 = await run("B 退役后基线(哈希) · 不拨杆", () => {}, false);
const b1 = await run("B 退役后基线(哈希) · 拨杆+20", () => {}, true);

console.log(`\n══ 判读 ══`);
console.log(`   · 「零扰动空转」时那条边传不传导：退役前 ${a0 > 0 ? "传" : "**不传**"} / 退役后 ${b0 > 0 ? "**传**" : "不传"}`);
console.log(`   · 「用户拨杆」时那条边传不传导：退役前 ${a1 > 0 ? "**传**" : "不传"} / 退役后 ${b1 > 0 ? "传" : "不传"}`);
console.log(
  a1 > 0
    ? `   ⇒ 拨杆这条路**退役前就是通的**（mode="delta" 叠在基线上）⇒ 「杠杆是死的」这句话**说过头了**；\n` +
      `     真正坏的是**基线**：6 个型号一个不差全是 0，还盖着 "measured" 章。`
    : `   ⇒ 拨杆这条路退役前也不通 ⇒ 「杠杆是死的」成立。`,
);
await built.app.close();
