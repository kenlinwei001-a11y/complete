#!/usr/bin/env node
/**
 * WO-AB-STABILITY-probe.mjs · 「用户看的那个数」稳定性/敏感性实测
 *
 * 仓主 2026-10-05 令：「为何用户看的那个数一位没动？测试三次，比较结果，
 *   每个环节每次连续问 10 次，比较差异，表格输出」
 *
 * 判据（三条，都不许靠推理）：
 *   ① 同输入同起点的**3 次独立运行** ⇒ 逐拍读数是否逐字节相同（跨运行确定性）
 *   ② 每个环节在**同一状态下连问 10 次** ⇒ 10 个回包是否逐字节相同（环节内确定性 = 有没有随机）
 *   ③ 扰动幅度 3 vs 20 ⇒ 同一环节的读数**差多少**（敏感性 = 那个数到底动不动）
 * ⛔ 只测量，不改任何源码。本脚本吃 BASE，默认 4051。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const RUNS = Number(process.env.RUNS || 3);
const REPS = Number(process.env.REPS || 10);
const TICKS = Number(process.env.TICKS || 12);
const SOLVER = process.env.SOLVER || "finance_world_projection";
const DEBUG_USER = process.env.DEBUG_USER || "demo:admin:admin|planner|catalog_admin";

const out = [];
const say = (s = "") => { out.push(s); process.stdout.write(s + "\n"); };
const num = (v, d = 6) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v ?? "—"));
const pad = (v, w) => String(v ?? "—").padEnd(w);
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, "0"); };

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-debug-user": DEBUG_USER },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 原样 */ }
  return { status: r.status, json, text };
}
const must = (r, what) => {
  if (r.status === null || r.status >= 400) throw new Error(`${what}: HTTP ${r.status} · ${(r.text ?? "").slice(0, 300)}`);
  return r.json;
};
const createSession = async () => must(await api("POST", "/a/v1/sim/sessions", {}), "createSession");
const readWorld = async (id) => must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "readWorld");
const tick = async (id, n) => must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n }), "tick");
const projection = async (id) => must(await api("POST", `/a/v1/solvers/${SOLVER}/invoke`, { args: { worldId: id } }), "projection");
const lineOf = (p, role) => (p?.data?.lines ?? p?.lines ?? []).find((l) => l?.role === role) ?? null;
const pressureOf = (p, sv) => (p?.data?.pressures ?? p?.pressures ?? []).find((x) => x?.stateVar === sv) ?? null;

/** 一个「环节」= 一次端点调用 + 从回包里取出的那组数（读数串） */
function stagesOf(world, proj) {
  const margin = lineOf(proj, "MARGIN");
  const cost = lineOf(proj, "COST");
  const cp = pressureOf(proj, "costPressure");
  return [
    { name: "S2 GET /world · 状态指纹", value: `${world?.tick}|${Object.keys(world?.state ?? {}).length}|${hash(JSON.stringify(world?.state ?? {}))}` },
    { name: "S3 POST /tick · 回包 tick", value: String(world?.tick ?? "—") },
    { name: "S4 MARGIN.rolling", value: num(margin?.rolling) },
    { name: "S4 MARGIN.projected", value: num(margin?.projected) },
    { name: "S4 MARGIN.delta", value: num(margin?.delta) },
    { name: "S4 COST.projected", value: num(cost?.projected) },
    { name: "S4 COST.delta", value: num(cost?.delta) },
    { name: "S5 costPressure.value", value: num(cp?.value) },
    { name: "S5 carriers/universe", value: `${cp?.carriers ?? "—"}/${cp?.universe ?? "—"}` },
  ];
}

/** 跑一次：建会话 → 扰动 → 逐拍 → 终态连问 REPS 次 */
async function runOnce(tag, magnitude) {
  const s = await createSession();
  const id = s?.session?.id ?? s?.id;
  if (!id) throw new Error(`${tag}: 建会话没拿到 id · ${JSON.stringify(s).slice(0, 200)}`);
  const pert = {
    kind: "supply_disruption",
    targetObjectId: "obj_order_SO-3391",
    targetStateVar: "leadDays",
    mode: "delta",
    magnitude,
    startTick: 0,
    durationTicks: null,
    label: `${tag} · 交期提前(${magnitude})`,
  };
  await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, pert);

  const series = [];
  for (let t = 0; t <= TICKS; t++) {
    const w = await readWorld(id);
    const p = await projection(id);
    series.push({ t, stages: stagesOf(w, p) });
    if (t < TICKS) await tick(id, 1);
  }

  // 终态：每个环节连问 REPS 次
  const reps = [];
  for (let k = 0; k < REPS; k++) {
    const w = await readWorld(id);
    const p = await projection(id);
    reps.push(stagesOf(w, p));
  }
  return { id, series, reps };
}

// ── 主 ──────────────────────────────────────────────────────────────────────
say("## WO-AB-STABILITY · 「用户看的那个数」稳定性/敏感性实测");
say(`> BASE=${BASE} · RUNS=${RUNS} · 每环节连问 REPS=${REPS} · 逐拍 TICKS=${TICKS} · solver=${SOLVER}`);
say(`> 扰动固定：obj_order_SO-3391.leadDays delta`);
say("");

const results = { mag3: [], mag20: [] };
for (const [key, mag] of [["mag3", -3], ["mag20", -20]]) {
  for (let r = 1; r <= RUNS; r++) {
    say(`── 运行 ${key} #${r} ──`);
    const res = await runOnce(`${key}#${r}`, mag);
    results[key].push(res);
    say(`   session=${res.id} 逐拍 ${res.series.length} 拍 · 连问 ${res.reps.length} 次`);
  }
}

// ── 表 A：跨 3 次运行 · 逐拍 MARGIN.projected ────────────────────────────────
say("");
say("## 表 A · 跨 3 次运行 · 逐拍 MARGIN.projected（同输入同起点 ⇒ 应逐字节相同）");
const keyOf = (st, nm) => st.stages.find((x) => x.name === nm)?.value;
for (const key of ["mag3", "mag20"]) {
  say("");
  say(`### ${key}`);
  say(pad("t", 4) + ["run#1", "run#2", "run#3", "3 次是否相同"].map((h) => pad(h, 18)).join(" "));
  for (let t = 0; t <= TICKS; t++) {
    const vs = results[key].map((R) => keyOf(R.series[t], "S4 MARGIN.projected"));
    say(pad(t, 4) + [...vs, new Set(vs).size === 1 ? "✅ 同" : "❌ 不同"].map((v) => pad(v, 18)).join(" "));
  }
}

// ── 表 B：每环节连问 REPS 次 · 10 个回包是否一致 ─────────────────────────────
say("");
say("## 表 B · 终态每环节连问 " + REPS + " 次 · 10 个回包差异");
say(pad("环节", 30) + ["run#1", "run#2", "run#3", "不同取值个数"].map((h) => pad(h, 22)).join(" "));
const stageNames = results.mag3[0].series[0].stages.map((x) => x.name);
for (const nm of stageNames) {
  const cells = [];
  let maxUniq = 1;
  for (const key of ["mag3", "mag20"]) {
    for (const R of results[key]) {
      const vals = R.reps.map((st) => st.find((x) => x.name === nm)?.value);
      const u = new Set(vals).size;
      maxUniq = Math.max(maxUniq, u);
      cells.push(u === 1 ? `✅ 1 种 (${String(vals[0]).slice(0, 12)})` : `❌ ${u} 种`);
    }
  }
  say(pad(nm, 30) + [...cells, maxUniq === 1 ? "1（无随机）" : `${maxUniq}（有随机）`].map((v) => pad(v, 22)).join(" "));
}

// ── 表 C：幅度 3 vs 20 · 同一环节差多少（敏感性 = 那个数到底动不动）──────────
say("");
say("## 表 C · 幅度 −3 vs −20 · 同环节读数对照（敏感性）");
say(pad("环节", 30) + ["幅度3(run#1)", "幅度20(run#1)", "幅度20(run#2)", "相对差"].map((h) => pad(h, 24)).join(" "));
for (const nm of stageNames) {
  const v3 = keyOf(results.mag3[0].series[TICKS], nm);
  const v20a = keyOf(results.mag20[0].series[TICKS], nm);
  const v20b = keyOf(results.mag20[1].series[TICKS], nm);
  const a = Number(v3), b = Number(v20a);
  const rel = Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? `${(((b - a) / Math.abs(a)) * 100).toFixed(4)}%` : "—";
  say(pad(nm, 30) + [v3, v20a, v20b, rel].map((v) => pad(String(v).slice(0, 22), 24)).join(" "));
}

// ── 表 D：逐拍 mag3 vs mag20 之差（「那个数到底动不动」）─────────────────────
say("");
say("## 表 D · 逐拍 · 幅度 −3 vs −20 之差（6.67 倍幅度 ⇒ 读数差多少？方向对不对？）");
/**
 * ⚠ 预期方向**逐量不同**，⛔ 不许用一个「越大越好」的通判据：
 *   「订单改交期 · 提前交付 N 天」⇒ 赶工 ⇒ **成本压力↑、利润↓**。
 *   ⇒ costPressure.value : 幅度大 ⇒ 读数**应更大**（d>0 符合预期）
 *   ⇒ MARGIN.projected   : 幅度大 ⇒ 读数**应更小**（d<0 符合预期）
 * （初版这里写成了「d>0 即同向」的通判据，把**正确的**利润下降判成了反向 —— 判据本身写错，已改。）
 */
const dirOf = (d, expectUp) => (d === 0 ? "不动" : (d > 0) === expectUp ? "符合预期" : "❌反预期");
const dumpDiff = (label, stage, expectUp) => {
  say(`### ${label}`);
  say(pad("t", 4) + ["幅度3", "幅度20", "差(20−3)", "相对差%", "相对预期方向"].map((h) => pad(h, 18)).join(" "));
  for (let t = 0; t <= TICKS; t++) {
    const a = Number(keyOf(results.mag3[0].series[t], stage));
    const b = Number(keyOf(results.mag20[0].series[t], stage));
    const d = b - a;
    say(pad(t, 4) + [num(a), num(b), num(d), a !== 0 ? (((d / Math.abs(a)) * 100).toFixed(5)) : "—", dirOf(d, expectUp)].map((v) => pad(v, 18)).join(" "));
  }
};
dumpDiff("MARGIN.projected（提前交付 ⇒ 预期 幅度大则更低）", "S4 MARGIN.projected", false);
dumpDiff("costPressure.value（提前交付 ⇒ 预期 幅度大则更高）", "S5 costPressure.value", true);

say("");
say("NOT-MEASURED 说明：凡本报告未给出数字的项，一律按 NOT-MEASURED 读，⛔ 不许拿别的臂的数推它。");
say(`DONE ${new Date().toISOString()}`);
