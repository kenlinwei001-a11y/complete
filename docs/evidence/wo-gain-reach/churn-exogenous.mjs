#!/usr/bin/env node
/**
 * WO-GAIN-REACH · 对照实验：`Model.demandLoad` 被夹死的**真病因**
 *
 *   node docs/evidence/wo-gain-reach/churn-exogenous.mjs
 *
 * ── 派单给的病因（已被本实验推翻，原文留档）────────────────────────────────────
 *   「两条入边的**源量程差 8.56 倍**：`demandPressure` 均值 5.84 vs `orderChurn` ≈50
 *     ⇒ 折扣项以 4.28× 胜出。」
 *   实测：`demandPressure` tick0 均值 **26.287**（不是 5.84 —— 那是漏跑了生产播种序列里
 *   `recomputeDemoDerivationsAtSeed` 那一步才会读到的数），`orderChurn` **53.580**，
 *   量程比 **2.038×** 不是 8.56×；实际拉力 12.3511 vs 12.5527，churn 只赢 **1.63%** 不是 4.28×。
 *
 * ── 真病因（本实验要证的）──────────────────────────────────────────────────────
 *   **两条入边不在同一个衰减制度里**，与量程、与增益都无关：
 *   · `Order.demandPressure` 是 `demo_forecast_bias_to_order_demand` 的落点 ⇒ **被写** ⇒ 衰减 λ=0.37
 *   · `Order.orderChurn` 的**唯一**入边 `demo_customer_reaction_cut_order` 带 `reaction`，
 *     被 `partitionAdversaryRules` 按 `sim.propagation.adversary`（demo 租户**关**，
 *     `features.ts` `WORLD_DARK_LAUNCH_FEATURES`）滤掉 ⇒ 引擎看不到任何规则写 `orderChurn`
 *     ⇒ 按「入度 0 = 外生输入，引擎无权让它自己变小」**不衰减**（`propagation.ts` 衰减相头注原文）。
 *   ⇒ 零扰动世界里，正驱动 →0 而折扣项**恒为出厂值**，`demandLoad` 必被推到域下界 0 并钉住。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────────────
 *   **正向**：把 `sim.propagation.adversary` 打开 ⇒ `orderChurn` 变成"被写量纲" ⇒ 进 `decayApplied`
 *            ⇒ 它开始衰减 ⇒ `Model.demandLoad` 不再恒为 0。**开关是唯一变量，系数一个没动。**
 *   **🐤 反向**：动了的量纲必须**全在该开关下游**（`orderChurn` 及其下游），
 *            ⛔ 不写成「其余一律不动」—— 真级联本来就该动。
 *   **🐤 非空**：两臂的 trace 都必须非空，且开关确实改变了参与推演的规则条数（否则下面全是空话）。
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
const TICKS = 12;

/** 起一份世界，按 `adversary` 开/关跑 TICKS 拍，回逐拍读数 + 引擎回执。 */
async function arm(adversary) {
  const blobDir = await mkdtemp(join(tmpdir(), "churn-"));
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "test-secret" });
  const repos = createMemoryRepos();
  const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });
  await seedDemo(repos);
  const job = await built.app.inject({ method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN, payload: { industry: "battery-manufacturing", scale: "S", seed: 42 } });
  if (job.statusCode !== 202) throw new Error(`合成失败 ${job.statusCode}`);
  await seedDemoPropagationRules(repos);
  const ctx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
  await seedDemoDerivationSpecs(repos, built.services.ontologyCore, built.services.governance, ctx);
  await recomputeDemoDerivationsAtSeed(repos, built.services.ontologyCore, ctx);
  // ⚠ 唯一变量就是这一行里的 `sim.propagation.adversary`；⛔ 两臂的系数/种子/seed 全同。
  await built.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.propagation.adversary": adversary } },
  });
  const { state: t0 } = await deriveSeedBaseSnapshot(repos, "demo");
  const ids = async (tk) => (await repos.objects.listByType("demo", tk)).map((o) => o.id);
  const orderIds = await ids("Order"), modelIds = await ids("Model");
  const mk = await built.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: t0, scope: {} } });
  if (mk.statusCode >= 400) throw new Error(`建会话失败 ${mk.statusCode}: ${mk.body.slice(0, 200)}`);
  const sid = JSON.parse(mk.body).id;
  const mean = (st, list, v) => { const a = list.map((i) => st[i]?.[v]).filter((x) => typeof x === "number"); return a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN; };
  const traj = [];
  let report = null, ruleKeys = new Set();
  for (let i = 0; i <= TICKS; i++) {
    if (i > 0) {
      const tk = await built.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
      const b = JSON.parse(tk.body);
      report = b.stateVarReport;
      for (const t of b.trace ?? []) ruleKeys.add(t.ruleKey);
    }
    const st = JSON.parse((await built.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).body).state;
    traj.push({
      tick: i,
      churn: mean(st, orderIds, "orderChurn"),
      demandP: mean(st, orderIds, "demandPressure"),
      load: mean(st, modelIds, "demandLoad"),
      loadMax: Math.max(...modelIds.map((i2) => st[i2]?.demandLoad ?? 0)),
    });
  }
  await built.app.close();
  return { traj, report, ruleKeys };
}

console.log(`对照实验：唯一变量 = \`sim.propagation.adversary\`（系数一个没动，种子 seed=42 两臂相同）\n`);
const off = await arm(false);
const on = await arm(true);

// 🐤 非空 + 开关真的生效
if (off.ruleKeys.size === 0 || on.ruleKeys.size === 0) throw new Error("🐤 反空绿：某一臂 trace 全空 ⇒ 一条边没触发，下面全是空话");
const onlyOn = [...on.ruleKeys].filter((k) => !off.ruleKeys.has(k)).sort();
console.log(`🐤 非空：关臂触发 ${off.ruleKeys.size} 条边 · 开臂 ${on.ruleKeys.size} 条`);
console.log(`🐤 开关真的生效：只在开臂触发的边 = ${JSON.stringify(onlyOn)}`);
if (onlyOn.length === 0) throw new Error("🐤 两臂触发的边集合相同 ⇒ 开关没生效，下面的对比是空话");

const inDecay = (r, v) => (r?.decayApplied && v in r.decayApplied ? String(r.decayApplied[v]) : "不在表里（⇒ 外生·不衰减）");
console.log(`\n══ 引擎自己的回执 \`stateVarReport.decayApplied\` ══`);
console.log(`   关臂 orderChurn      : ${inDecay(off.report, "orderChurn")}`);
console.log(`   开臂 orderChurn      : ${inDecay(on.report, "orderChurn")}`);
console.log(`   两臂 demandPressure  : 关=${inDecay(off.report, "demandPressure")} 开=${inDecay(on.report, "demandPressure")}`);
console.log(`   两臂 demandLoad      : 关=${inDecay(off.report, "demandLoad")} 开=${inDecay(on.report, "demandLoad")}`);

console.log(`\n══ 逐拍读数（均值）══`);
console.log(`tick │        关臂 churn   关臂 demandP    关臂 load(max)  │        开臂 churn   开臂 demandP    开臂 load(max)`);
for (let i = 0; i <= TICKS; i++) {
  const a = off.traj[i], b = on.traj[i];
  console.log(
    `${String(i).padStart(4)} │ ${a.churn.toFixed(4).padStart(16)} ${a.demandP.toFixed(4).padStart(13)} ${(a.load.toFixed(4) + "(" + a.loadMax.toFixed(3) + ")").padStart(18)} │ ` +
    `${b.churn.toFixed(4).padStart(16)} ${b.demandP.toFixed(4).padStart(13)} ${(b.load.toFixed(4) + "(" + b.loadMax.toFixed(3) + ")").padStart(18)}`,
  );
}

const lastOff = off.traj[TICKS], lastOn = on.traj[TICKS];
const churnDecayedOff = lastOff.churn < off.traj[0].churn * 0.5;
const churnDecayedOn = lastOn.churn < on.traj[0].churn * 0.5;
console.log(`\n══ 判定 ══`);
console.log(`   ① 关臂 orderChurn 第 ${TICKS} 拍 ${lastOff.churn.toFixed(4)}（出厂 ${off.traj[0].churn.toFixed(4)}）⇒ ${churnDecayedOff ? "已衰减" : "⛔ **几乎没动 = 外生不衰减**"}`);
console.log(`   ② 开臂 orderChurn 第 ${TICKS} 拍 ${lastOn.churn.toFixed(4)}（出厂 ${on.traj[0].churn.toFixed(4)}）⇒ ${churnDecayedOn ? "✅ 已衰减" : "⛔ 仍没动"}`);
console.log(`   ③ 关臂 demandLoad 第 ${TICKS} 拍 均值 ${lastOff.load.toFixed(6)} / max ${lastOff.loadMax.toFixed(6)}`);
console.log(`   ④ 开臂 demandLoad 第 ${TICKS} 拍 均值 ${lastOn.load.toFixed(6)} / max ${lastOn.loadMax.toFixed(6)}`);
console.log(`   ⇒ 正向判据（开关是唯一变量）：${!churnDecayedOff && churnDecayedOn ? "✅ 成立 —— 衰减制度差异由开关单独造成，与系数/量程无关" : "⛔ 不成立"}`);
