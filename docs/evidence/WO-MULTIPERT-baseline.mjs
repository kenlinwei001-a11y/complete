#!/usr/bin/env node
/**
 * WO-MULTIPERT-baseline.mjs · 「统一推演控制台」多扰动验收探针（**可复用**）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 仓主 2026-10-05 令：「要完整的解决『统一推演控制台』的问题，而不是输入某 1 个扰动
 * 因素的推演问题。我需要输入多个扰动因素也可以推演正确。」
 * ⇒ 后续每一张修法单都要用**同一套探针**做「同组同序 ⇒ 同结果」的对照。
 *   本脚本就是那套探针。**它不改任何源码，只测量。**
 *
 * ── 判据（⛔ 不是可加性）─────────────────────────────────────────────────────
 * 引擎**非线性**（`saturateToDomain` / 夹值 / 衰减）⇒ `f(p1+p2) ≠ f(p1)+f(p2)−f(0)`。
 * **拿可加性当判据会误报。** 本探针验的是四条：
 *   ① 零扰动 ⇒ **静息**：`MARGIN.projected` 逐拍恒定且 == `MARGIN.rolling`
 *   ② **确定性**：同组同序重跑 ⇒ 逐拍读数逐字节相同
 *   ③ **单调**：扰动方向与读数方向一致（描述性，不判「对错」）
 *   ④ **可回退**：`durationTicks` 到期后读数回到零扰动臂那条线
 *
 * ── 四臂（**A+B 那条不许省**）───────────────────────────────────────────────
 *   {零扰动对照, 单扰动 A, 单扰动 B, A+B}
 * ⛔ 「A+B ≡ A」若 B 推不动读数，是个**假结论**。⇒ 本探针打印 B 的**金丝雀**
 *   （B 相对零扰动臂的逐拍差），差全 0 ⇒ 报「B 无鉴别力」，不许读成「A+B 无损」。
 *
 * ── 用法（吃环境变量，后面每张修法单重跑同一个脚本）─────────────────────────
 *   PORT=4019 TICKS=40 node docs/evidence/WO-MULTIPERT-baseline.mjs
 *   BASE=http://127.0.0.1:4019 node docs/evidence/WO-MULTIPERT-baseline.mjs
 *   ARMS=zero,A,B,AB   只跑其中几臂（冒烟用）· TICKS=0 只读 t0
 *   A_OBJECT / A_VAR / A_MODE / A_MAG · B_OBJECT / B_VAR / B_MODE / B_MAG 覆盖扰动
 *   DETERMINISM=0 / REVERT=0 关掉对应判据
 *
 * ── 复现命令（含 rc 捕获，⛔ 不许 `cmd | tail; echo $?`）─────────────────────
 *   node docs/evidence/WO-MULTIPERT-baseline.mjs > docs/evidence/WO-MULTIPERT-baseline.txt 2>&1
 *   echo "CAPTURED_RC=$?" > docs/evidence/WO-MULTIPERT-baseline.rc
 *
 * ⚠ 端点/字段形状**以实测为准**（派单前提是线索不是结论）。本仓在这上面栽过三次：
 *   `ruleKey`（真键 `key`）· 扰动回执（真形状 `{perturbation,curTick,state}`）·
 *   `amounts`（**真位置是 `lines`**）。
 */

import { writeFileSync } from "node:fs";

// ── 配置（全部可经 env 覆盖，便于后续修法单复用）────────────────────────────
const CFG = {
  base: process.env.BASE || `http://127.0.0.1:${process.env.PORT || 4019}`,
  ticks: Number(process.env.TICKS ?? 40),
  tenant: process.env.TENANT || "demo",
  userId: process.env.USER_ID || "admin",
  roles: process.env.ROLES || "admin|planner|catalog_admin",
  solver: process.env.SOLVER || "finance_world_projection",
  arms: (process.env.ARMS || "zero,A,B,AB").split(",").filter(Boolean).map((s) => s.trim()),
  doDeterminism: process.env.DETERMINISM !== "0",
  doRevert: process.env.REVERT !== "0",
  revertDuration: Number(process.env.REVERT_DURATION ?? 5),
  provenanceSidecar:
    process.env.PROVENANCE_SIDECAR || "docs/evidence/WO-MULTIPERT-baseline.provenance.tsv",
  provenanceInlineLimit: Number(process.env.PROVENANCE_INLINE_LIMIT ?? 20000),
  // 链条实测格：逐拍记原值 —— 光记 MARGIN 三个数看不出「是不是撞了 saturateToDomain 边界」。
  // 默认 = A/B 两条扰动汇到的同一格（`Model.costPressure`）+ 两侧源格。
  // 拓扑实测（2026-10-05 · 本基线）：SO-3391 --order_for_model--> obj_model_4680-NCM；
  //   obj_material_pos_ncm --material_used_by_model--> obj_model_4680-NCM（8 个 Material 之一）。
  chainCells: (process.env.CHAIN_CELLS ||
    "obj_order_SO-3391|leadDays,obj_order_SO-3391|costPressure,obj_model_4680-NCM|costPressure," +
    "obj_customer_cust_14|receivablePressure,obj_material_pos_ncm|priceShock")
    .split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [o, v] = s.split("|");
      return { objectId: o, stateVar: v };
    }),
  // 「基值是否被加了两次」判别列：逐拍 `读数 / 该格 baseSnapshot`。
  // 比值 == 1 ⇒ 正常；比值 → 2 ⇒ 基值被加了两次（`x' = (1−λ)x + λ·base + c` 的 c 里又带了一份 base）。
  // ⚠ 只给 MARGIN 三个数定不了这件事，必须落到具体格（app.ts:2406 specBase / 2619 C2 合成层）。
  baseRatioCells: (process.env.BASE_RATIO_CELLS ||
    "obj_model_4680-NCM|costPressure,obj_order_SO-3391|costPressure,obj_customer_cust_14|receivablePressure")
    .split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [o, v] = s.split("|");
      return { objectId: o, stateVar: v };
    }),
};
const DEBUG_USER = `${CFG.tenant}:${CFG.userId}:${CFG.roles}`;

// ── 全量网络观测（⚠ 只记失败会被读成「没有」⇒ 每一次请求都记）────────────────
const NET = [];
let netSeq = 0;

async function api(method, path, body) {
  const seq = ++netSeq;
  const t0 = Date.now();
  let res = null;
  let text = null;
  let err = null;
  try {
    res = await fetch(`${CFG.base}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-debug-user": DEBUG_USER },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    text = await res.text();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - t0;
  let json = null;
  if (text !== null) {
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON 留 null，原文进 net 表 */
    }
  }
  NET.push({
    seq, method, path,
    status: res?.status ?? null,
    ms, err,
    bodyBytes: text === null ? 0 : Buffer.byteLength(text),
    ...(json === null && text !== null ? { textHead: text.slice(0, 200) } : {}),
  });
  return { status: res?.status ?? null, json, text, err };
}

const must = (r, what) => {
  if (r.err) throw new Error(`${what}: 连接失败 ${r.err}`);
  if (r.status === null || r.status >= 400) {
    throw new Error(`${what}: HTTP ${r.status} · ${(r.text ?? "").slice(0, 300)}`);
  }
  return r.json;
};

// ── 端点薄封装 ──────────────────────────────────────────────────────────────
const createSession = async () => must(await api("POST", "/a/v1/sim/sessions", {}), "createSession");
const readWorld = async (id) => must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "readWorld");
const tick = async (id, n) => must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n }), "tick");
const projection = async (id) =>
  must(await api("POST", `/a/v1/solvers/${CFG.solver}/invoke`, { args: { worldId: id } }), "projection");
const listPerturbations = async (id) =>
  must(await api("GET", `/a/v1/sim/sessions/${id}/perturbations`), "listPerturbations");
const addPerturbation = async (id, p) => api("POST", `/a/v1/sim/sessions/${id}/perturbations`, p);

// ── 读数提取：**钱在 lines[]**（⛔ 不在 `amounts`）────────────────────────────
const lineOf = (proj, role) => (proj?.data?.lines ?? proj?.lines ?? []).find((l) => l?.role === role) ?? null;
const pressureOf = (proj, sv) => (proj?.data?.pressures ?? proj?.pressures ?? []).find((p) => p?.stateVar === sv) ?? null;

function reading(proj, world) {
  const margin = lineOf(proj, "MARGIN");
  const cost = lineOf(proj, "COST");
  const rev = lineOf(proj, "REVENUE");
  const cp = pressureOf(proj, "costPressure");
  return {
    curTick: proj?.data?.curTick ?? proj?.curTick ?? world?.tick ?? null,
    available: proj?.data?.available ?? proj?.available ?? null,
    marginRolling: margin?.rolling ?? null,
    marginProjected: margin?.projected ?? null,
    marginDelta: margin?.delta ?? null,
    costRolling: cost?.rolling ?? null,
    costProjected: cost?.projected ?? null,
    costDelta: cost?.delta ?? null,
    revRolling: rev?.rolling ?? null,
    costPressureValue: cp?.value ?? null,
    costPressureCarriers: cp?.carriers ?? null,
    costPressureUniverse: cp?.universe ?? null,
    driver: margin?.driver ?? null,
  };
}
const round = (v, d = 6) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const countCells = (state) =>
  state && typeof state === "object"
    ? Object.values(state).reduce((a, r) => a + (r && typeof r === "object" ? Object.keys(r).length : 0), 0)
    : 0;

// ── 臂定义（A/B 可经 env 覆盖；默认值来历写在报告里）────────────────────────
function armPerturbations(name) {
  const A = {
    kind: process.env.A_KIND || "supply_disruption",
    targetObjectId: process.env.A_OBJECT || "obj_order_SO-3391",
    targetStateVar: process.env.A_VAR || "leadDays",
    mode: process.env.A_MODE || "delta",
    magnitude: Number(process.env.A_MAG ?? -3),
    startTick: 0,
    durationTicks: null,
    label: process.env.A_LABEL || "A · 交期提前 3 天（Order.leadDays −3）",
  };
  const B = {
    kind: process.env.B_KIND || "cost_shock",
    // 落点拓扑（实测，2026-10-05）：obj_material_pos_ncm --material_used_by_model--> obj_model_4680-NCM
    //   ⇒ 与 A 汇到**同一格** `obj_model_4680-NCM.costPressure`（combine:"sum"），是真正的组合。
    targetObjectId: process.env.B_OBJECT || "obj_material_pos_ncm",
    targetStateVar: process.env.B_VAR || "priceShock",
    mode: process.env.B_MODE || "delta",
    magnitude: Number(process.env.B_MAG ?? 15),
    startTick: 0,
    durationTicks: null,
    label: process.env.B_LABEL || "B · NCM 正极涨价（Material.priceShock +15）",
  };
  if (name === "zero") return [];
  if (name === "A") return [A];
  if (name === "B") return [B];
  if (name === "AB") return [A, B]; // ⛔ 顺序固定：先建 A 后建 B（= 建单先后）
  throw new Error(`未知臂 ${name}`);
}

// ── 跑一臂 ──────────────────────────────────────────────────────────────────
async function runArm(name, { perturbations = null, durationTicks = undefined, tag = name } = {}) {
  const t0 = Date.now();
  const session = await createSession();
  const id = session.id;
  const perts = perturbations ?? armPerturbations(name);

  const pertReceipts = [];
  for (const p of perts) {
    const body = durationTicks === undefined ? p : { ...p, durationTicks };
    const r = await addPerturbation(id, body);
    // ⚠ 真形状 = {perturbation, curTick, state}（**裸对象**，不是 {data:…}）
    pertReceipts.push({
      status: r.status,
      keys: r.json && typeof r.json === "object" ? Object.keys(r.json) : null,
      perturbation: r.json?.perturbation ?? null,
      curTick: r.json?.curTick ?? null,
    });
  }

  // 定序核验：`listPerturbations` 必须是 `startTick↑ → 建单先后`（⛔ 不以随机 id 为二级键）
  const listed = await listPerturbations(id);
  const listedSeq = (listed.items ?? []).map((p) => ({
    id: p.id, var: p.targetStateVar, obj: p.targetObjectId,
    startTick: p.startTick, mode: p.mode, magnitude: p.magnitude,
  }));

  // 该会话的 `baseSnapshot`（tick0 起点的**基值**）—— 判「基值是否被加了两次」的分母
  const detail = await must(await api("GET", `/a/v1/sim/sessions/${id}`), "sessionDetail");
  const baseSnap = detail?.baseSnapshot ?? {};

  const chainOf = (state) => {
    const o = {};
    for (const c of CFG.chainCells) o[`${c.objectId}.${c.stateVar}`] = state?.[c.objectId]?.[c.stateVar] ?? null;
    return o;
  };
  const baseOf = (state) => {
    const o = {};
    for (const c of CFG.baseRatioCells) o[`${c.objectId}.${c.stateVar}`] = state?.[c.objectId]?.[c.stateVar] ?? null;
    return o;
  };
  const baseVals = baseOf(baseSnap);

  const series = [];
  // t0 = 播种快照，**一次 tick 都别发**
  const w0 = await readWorld(id);
  const p0 = await projection(id);
  series.push({ t: w0.tick, worldTick: w0.tick, stateCells: countCells(w0.state), chain: chainOf(w0.state), baseV: baseOf(w0.state), ...reading(p0, w0), proj: p0?.data ?? p0 });

  for (let i = 1; i <= CFG.ticks; i++) {
    await tick(id, 1);
    const w = await readWorld(id);
    const p = await projection(id);
    series.push({ t: w.tick, worldTick: w.tick, stateCells: countCells(w.state), chain: chainOf(w.state), baseV: baseOf(w.state), ...reading(p, w), proj: p?.data ?? p });
  }

  return {
    tag, sessionId: id,
    status: session.status ?? null,
    perturbations: listedSeq,
    pertReceipts, series,
    baseSnapshotChain: baseVals,
    worldT0: { tick: w0.tick, topKeys: Object.keys(w0).sort(), baseProvenance: w0.baseProvenance ?? {}, baseStateVarReport: w0.baseStateVarReport ?? null },
    elapsedMs: Date.now() - t0,
  };
}

// ── provenance：origin × 格数（口径**唯一出处** = 契约 `tallyCellProvenance`）──
// ⚠ 缺键 = **未知**（第三态），⛔ 不许并进 derived。
async function provenanceTally(state, provenance) {
  let contract = null, contractErr = null, contractSrc = null;
  // 口径的**唯一出处**是契约的 `tallyCellProvenance`。包名在外层目录解析不到（pnpm 的
  // node_modules 不在 docs/evidence 下），故回落**同一个包的构建产物**相对路径 ——
  // 仍然是那一份实现，不是本地另写一套。两条都失败才退回本地复算并如实标注。
  const cands = [
    ["@platform/contracts", "@platform/contracts"],
    ["../../packages/contracts/dist/index.js", "packages/contracts/dist/index.js"],
  ];
  for (const [spec, label] of cands) {
    try {
      const c = await import(spec);
      if (typeof c.tallyCellProvenance === "function") { contract = c.tallyCellProvenance(state, provenance); contractSrc = label; break; }
      contractErr = `${label} 无 tallyCellProvenance 导出`;
    } catch (e) { contractErr = `${label}: ${e instanceof Error ? e.message : String(e)}`; }
  }
  // 本地独立复算（交叉核对；两者不一致即报错，不静默取一个）
  const local = { measured: 0, derived: 0, unknown: 0 };
  for (const [oid, row] of Object.entries(state ?? {})) {
    for (const v of Object.keys(row ?? {})) {
      const o = provenance?.[oid]?.[v];
      if (o === "measured") local.measured += 1;
      else if (o === "derived") local.derived += 1;
      else local.unknown += 1;
    }
  }
  const agree = contract === null ? null
    : contract.measured === local.measured && contract.derived === local.derived && contract.unknown === local.unknown;
  return { contract, contractErr, contractSrc, local, agree };
}

function provenanceListing(state, provenance) {
  const rows = [];
  for (const oid of Object.keys(state ?? {}).sort())
    for (const v of Object.keys(state[oid] ?? {}).sort()) {
      const o = provenance?.[oid]?.[v];
      rows.push(`${oid}\t${v}\t${o === "measured" || o === "derived" ? o : "MISSING"}`);
    }
  return rows;
}

// ── 打印 ────────────────────────────────────────────────────────────────────
const out = [];
const say = (s = "") => { out.push(s); process.stdout.write(s + "\n"); };
const pad = (v, w) => String(v ?? "—").padEnd(w);
const num = (v, d = 4) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v ?? "—"));
const uniq = (a) => [...new Set(a)];
const isConst = (a) => uniq(a).length === 1;

function chainTable(a) {
  const keys = Object.keys(a.series[0]?.chain ?? {});
  if (keys.length === 0) return;
  say(`── 链条实测格 · 臂 ${a.tag}（逐拍原值；看「是不是撞了 saturateToDomain 边界」）──`);
  say(["t", ...keys].map((h, i) => pad(h, i === 0 ? 4 : 30)).join(" "));
  for (const r of a.series) say([pad(r.t, 4), ...keys.map((k) => pad(num(r.chain?.[k], 6), 30))].join(" "));
}

/**
 * 基值比值表：逐拍 `读数 / baseSnapshot`。
 * 判据：比值 == 1 ⇒ 正常；比值 → 2 ⇒ **基值被加了两次**。
 */
function ratioTable(a) {
  const keys = Object.keys(a.baseSnapshotChain ?? {});
  if (keys.length === 0) return;
  say(`── 基值比值表 · 臂 ${a.tag}（逐拍 = 读数 ÷ baseSnapshot 值；1=正常，→2=基值加两次）──`);
  say(["t", ...keys.map((k) => `${k}[base=${num(a.baseSnapshotChain[k], 6)}]`)].map((h, i) => pad(h, i === 0 ? 4 : 34)).join(" "));
  for (const r of a.series) {
    say([pad(r.t, 4), ...keys.map((k) => {
      const b = a.baseSnapshotChain[k], v = r.baseV?.[k];
      const ratio = typeof b === "number" && b !== 0 && typeof v === "number" ? (v / b).toFixed(6) : "—";
      return pad(`${num(v, 6)} (×${ratio})`, 34);
    })].join(" "));
  }
}

function armTable(a) {
  say(`\n── 逐拍读数表 · 臂 ${a.tag}（session=${a.sessionId}）──`);
  const H = ["t", "worldTick", "cells", "avail", "MARGIN.rolling", "MARGIN.projected", "MARGIN.delta", "COST.projected", "costPressure", "carriers/univ"];
  const W = [4, 9, 7, 6, 15, 17, 14, 15, 13, 14];
  say(H.map((h, i) => pad(h, W[i])).join(" "));
  for (const r of a.series) {
    say([
      pad(r.t, 4), pad(r.worldTick, 9), pad(r.stateCells, 7), pad(r.available, 6),
      pad(num(r.marginRolling), 15), pad(num(r.marginProjected), 17), pad(num(r.marginDelta), 14),
      pad(num(r.costProjected), 15), pad(num(r.costPressureValue), 13),
      pad(`${r.costPressureCarriers}/${r.costPressureUniverse}`, 14),
    ].join(" "));
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  say("## WO-MULTIPERT · 多扰动验收探针 + 修前基线");
  say(`> 树龄探针 wc -l apps/datacore/src/sim/propagation.ts = ${process.env.PROP_LINES ?? "(未注入)"}`);
  say(`> base=${CFG.base} ticks=${CFG.ticks} tenant=${CFG.tenant} arms=${CFG.arms.join(",")}`);
  say(`> 取证时刻(UTC) = ${new Date().toISOString()}`);

  say("\n══ ⓪ 环境自证 ══");
  say(`回显 base（端口） = ${CFG.base}`);
  const probe = await api("GET", "/a/v1/sim/sessions");
  say(`GET /a/v1/sim/sessions → HTTP ${probe.status}（活服务）`);
  if (probe.status !== 200) throw new Error("服务不可达或未播种 —— 先核前置，别核代码");

  const arms = {};
  for (const name of CFG.arms) {
    say(`\n════════════════════════════════════════════════════════`);
    say(`══ 臂 ${name} ══`);
    const a = await runArm(name);
    arms[name] = a;
    say(`session=${a.sessionId} status=${a.status} 用时=${a.elapsedMs}ms`);
    say(`扰动回执形状 = ${JSON.stringify(a.pertReceipts.map((r) => r.keys))}（线索说裸对象 {perturbation,curTick,state}）`);
    say(`扰动定序（listPerturbations）= ${JSON.stringify(a.perturbations.map((p) => `${p.obj}.${p.var}@${p.startTick}/${p.mode}${p.magnitude}`))}`);
    armTable(a);
    chainTable(a);
    ratioTable(a);
  }

  // ── 跨臂链条对照（汇合格 `Model.costPressure` 逐拍，四臂并排）────────────────
  {
    const ks = Object.keys(arms[CFG.arms[0]]?.series[0]?.chain ?? {});
    const ts = arms[CFG.arms[0]]?.series.map((r) => r.t) ?? [];
    if (ks.length && ts.length) {
      say("\n══ 跨臂链条对照（逐拍 · 四臂并排）══");
      say(["t", ...CFG.arms.flatMap((n) => ks.map((k) => `${n}:${k}`))].join("\t"));
      for (const t of ts)
        say([t, ...CFG.arms.flatMap((n) => ks.map((k) => num(arms[n]?.series.find((r) => r.t === t)?.chain?.[k], 6)))].join("\t"));
    }
  }

  // ── ① 零扰动 ⇒ 静息 ──────────────────────────────────────────────────────
  say("\n════════════════════════════════════════════════════════");
  say("══ 判据① 零扰动 ⇒ 静息 ══");
  const z = arms.zero;
  if (!z) say("NOT-MEASURED：本跑未含零扰动臂");
  else {
    const proj = z.series.map((r) => r.marginProjected);
    const roll = z.series.map((r) => r.marginRolling);
    say(`MARGIN.projected 逐拍 = ${JSON.stringify(proj.map((v) => round(v)))}`);
    say(`MARGIN.rolling   逐拍 = ${JSON.stringify(roll.map((v) => round(v)))}`);
    say(`proj 恒定? ${isConst(proj) ? "是" : "**否（在漂）**"}（${uniq(proj.map((v) => round(v))).length} 种取值）`);
    say(`rolling 恒定? ${isConst(roll) ? "是" : "否"}`);
    const eq = proj.length === roll.length && proj.every((v, i) => v === roll[i]);
    say(`逐拍 projected == rolling ? ${eq ? "是" : "**否**"}`);
    say(`逐拍 (projected − rolling) = ${JSON.stringify(proj.map((v, i) => round(v - roll[i], 6)))}`);
    say(`⇒ 静息判据（恒定 ∧ ==rolling）：${isConst(proj) && eq ? "**PASS**" : "**FAIL**（派单说基线应当复现「在漂」）"}`);
    say(`⚠ 判据升级版（审核方 2026-10-05）：① 每格逐拍恒定；② 该值 == 该格 baseSnapshot（⛔ 不许是它的两倍）。`);
    say(`   ② 的逐格比值见上方「基值比值表」；零扰动臂的比值序列汇于下方 ①b 节。`);
  }

  // ── ①b 基值是否被加两次（读数 ÷ baseSnapshot）────────────────────────────
  say("\n══ 判据①b 基值是否被加两次（逐拍 读数 ÷ baseSnapshot 值）══");
  for (const nm of CFG.arms) {
    const a = arms[nm];
    if (!a) continue;
    for (const k of Object.keys(a.baseSnapshotChain ?? {})) {
      const b = a.baseSnapshotChain[k];
      const vals = a.series.map((r) => r.baseV?.[k] ?? null);
      const ratios = vals.map((v) => (typeof b === "number" && b !== 0 && typeof v === "number" ? round(v / b, 6) : null));
      const constV = isConst(vals);
      say(`[${nm}] ${k}  base=${num(b, 6)}`);
      say(`   读数逐拍 = ${JSON.stringify(vals.map((v) => round(v, 6)))}  恒定? ${constV ? "是" : "否"}`);
      say(`   比值逐拍 = ${JSON.stringify(ratios)}`);
      const anyDouble = ratios.some((r) => r !== null && Math.abs(r - 2) < 0.02);
      const allOne = ratios.every((r) => r !== null && Math.abs(r - 1) < 1e-9);
      say(`   ⇒ ${allOne ? "恒 == base（比值恒 1）" : anyDouble ? "**出现 ≈2 ⇒ 基值疑似被加两次**" : "既非恒 1 也非 ≈2（见比值序列）"}`);
    }
  }

  // ── ② 金丝雀：A / B 必须真的推动读数 ──────────────────────────────────────
  say("\n══ 判据② 金丝雀 · A / B 的鉴别力 ══");
  if (!z) say("NOT-MEASURED：缺零扰动臂");
  else {
    for (const nm of ["A", "B"]) {
      if (!arms[nm]) { say(`Δ${nm}：NOT-MEASURED（未跑该臂）`); continue; }
      const d = arms[nm].series.map((r, i) => round((r.marginProjected ?? 0) - (z.series[i]?.marginProjected ?? 0), 6));
      say(`Δ${nm}(t) = ${nm} − zero（MARGIN.projected 逐拍） = ${JSON.stringify(d)}`);
      say(`  Δ${nm} 有非零? ${d.some((v) => v !== 0) ? "**是（有鉴别力）**" : "**否 ⇒ 该扰动推不动读数；A+B≡A 会是假结论**"}`);
    }
  }

  // ── ③ A+B vs 单臂（描述性 · ⛔ 不是可加性检验）─────────────────────────────
  say("\n══ 判据③ A+B vs {zero,A,B}（描述性 · ⛔ 不是可加性）══");
  if (!arms.AB || !z) say("NOT-MEASURED");
  else {
    const at = (a, t) => a.series.find((r) => r.t === t)?.marginProjected ?? null;
    const ts = arms.AB.series.map((r) => r.t);
    say(`t\tzero\tA\tB\tA+B\t(A+B)−A\t(A+B)−B`);
    for (const t of ts)
      say([t, num(at(z, t)), num(arms.A ? at(arms.A, t) : null), num(at(arms.B, t)), num(at(arms.AB, t)),
           num(arms.A ? at(arms.AB, t) - at(arms.A, t) : null), num(at(arms.AB, t) - at(arms.B, t))].join("\t"));
    const abEqA = arms.A ? ts.every((t) => at(arms.AB, t) === at(arms.A, t)) : null;
    const abEqB = ts.every((t) => at(arms.AB, t) === at(arms.B, t));
    say(`逐拍 A+B ≡ A ? ${abEqA === null ? "NOT-MEASURED" : abEqA ? "**是**（先查 B 有没有鉴别力再定性）" : "否"}`);
    say(`逐拍 A+B ≡ B ? ${abEqB ? "**是**（先查 A 有没有鉴别力再定性）" : "否"}`);
    say(`⚠ 可加性 f(A+B) ≟ f(A)+f(B)−f(0) **不构成本单判据**（引擎非线性：saturateToDomain/夹值/衰减）。`);
  }

  // ── ④ 确定性 ──────────────────────────────────────────────────────────────
  if (CFG.doDeterminism && z) {
    say("\n══ 判据④ 确定性 · 零扰动臂同组同序重跑 ══");
    const z2 = await runArm("zero", { tag: "zero_rerun" });
    const key = (a) => JSON.stringify(a.series.map((r) => [r.t, r.marginRolling, r.marginProjected, r.marginDelta, r.costProjected, r.costPressureValue]));
    say(`zero session=${z.sessionId} · zero_rerun session=${z2.sessionId}`);
    say(`逐拍读数串逐字节相同? ${key(z) === key(z2) ? "**是**" : "**否**"}`);
    if (key(z) !== key(z2))
      for (let i = 0; i < Math.max(z.series.length, z2.series.length); i++) {
        const a = key([z.series[i]]), b = key([z2.series[i]]);
        if (a !== b) say(`  首个分歧 @t=${z.series[i]?.t}: ${a} vs ${b}`);
      }
    arms.zero_rerun = z2;
  } else say("\n判据④ 确定性：NOT-MEASURED（未跑）");

  // ── ⑤ 可回退 ──────────────────────────────────────────────────────────────
  if (CFG.doRevert) {
    say(`\n══ 判据⑤ 可回退 · durationTicks=${CFG.revertDuration} ══`);
    try {
      const rev = await runArm("A", { tag: `revert_A_d${CFG.revertDuration}`, durationTicks: CFG.revertDuration });
      say(`startTick=0 durationTicks=${CFG.revertDuration} ⇒ 生效 [0,${CFG.revertDuration})，t≥${CFG.revertDuration} 应回退`);
      say(`t\tMARGIN.projected(时长臂)\tzero\tA(永久)`);
      for (const r of rev.series)
        say([r.t, num(r.marginProjected), num(z?.series.find((x) => x.t === r.t)?.marginProjected),
             num(arms.A?.series.find((x) => x.t === r.t)?.marginProjected)].join("\t"));
      const after = rev.series.filter((r) => r.t > CFG.revertDuration);
      const back = after.every((r) => r.marginProjected === z?.series.find((x) => x.t === r.t)?.marginProjected);
      say(`到期后逐拍 == 零扰动臂 ? ${back ? "**是（可回退）**" : "**否**"}`);
    } catch (e) { say(`可回退臂失败：${e instanceof Error ? e.message : String(e)}`); }
  } else say("\n判据⑤ 可回退：NOT-MEASURED（未跑）");

  // ── ⑥ baseProvenance 全量 dump ────────────────────────────────────────────
  say("\n════════════════════════════════════════════════════════");
  say("══ ⑥ /world baseProvenance 全量 dump（runtime 侧静态普查）══");
  const firstArm = arms.zero ?? arms[CFG.arms[0]];
  const wz = firstArm?.worldT0;
  if (!wz) say("NOT-MEASURED：无 t0 world");
  else {
    say(`/world 顶层键 = ${JSON.stringify(wz.topKeys)}（线索说 tick,state,baseProvenance —— 以实测为准）`);
    const w0 = await readWorld(firstArm.sessionId);
    const tally = await provenanceTally(w0.state ?? {}, wz.baseProvenance);
    say(`契约 tallyCellProvenance 可用? ${tally.contract ? `是（来自 ${tally.contractSrc}）` : `**否**（${tally.contractErr}）`}`);
    if (tally.contract) say(`  契约口径  = ${JSON.stringify(tally.contract)}`);
    say(`  本地复算  = ${JSON.stringify(tally.local)}`);
    say(`  两者一致? = ${tally.agree === null ? "NOT-MEASURED" : tally.agree ? "**是**" : "**否（探针坏了，先别下结论）**"}`);
    say(`provenance 表覆盖对象数 = ${Object.keys(wz.baseProvenance ?? {}).length}`);
    say(`state 表对象数          = ${Object.keys(w0.state ?? {}).length}`);
    say(`baseStateVarReport = ${JSON.stringify(wz.baseStateVarReport)?.slice(0, 800)}`);
    const listing = provenanceListing(w0.state ?? {}, wz.baseProvenance);
    say(`逐格清单行数 = ${listing.length}`);
    try { writeFileSync(CFG.provenanceSidecar, listing.join("\n") + "\n"); say(`逐格清单已落盘 → ${CFG.provenanceSidecar}`); }
    catch (e) { say(`逐格清单落盘失败：${e instanceof Error ? e.message : String(e)}`); }
    if (listing.length <= CFG.provenanceInlineLimit) {
      say("── 逐格清单（state 中每一格的 origin；MISSING = 出处未知，⛔ 不许并进 derived）──");
      for (const r of listing) say(r);
    } else {
      say(`（清单 ${listing.length} 行 > 内联上限 ${CFG.provenanceInlineLimit}，仅前 200 行内联，全量见 sidecar）`);
      for (const r of listing.slice(0, 200)) say(r);
    }
  }

  // ── ⑥b 承载集分解 ─────────────────────────────────────────────────────────
  /**
   * 审核方 2026-10-05：`carriers/universe = 150/500` ⇒ 需要**承载集那一侧**的读数，
   * 与全域 `MARGIN.projected` 增量**并排**，才分得清「扰动没生效」与「生效了但被聚合稀释」。
   *
   * ⛔ 探针侧**只报原值差**，不重算求解器的加权口径（`finance-world.ts:224`
   * `orderValue = props.qty × props.unitPrice`）—— 复算是诊断，不是判据；
   * 求解器自己的 `costPressure.value` 并排给出，两者不一致时一眼可见。
   */
  say("\n════════════════════════════════════════════════════════");
  say("══ ⑥b 承载集分解（承载订单自己的读数 vs 全域加权读数）══");
  try {
    const carriersOf = async (a) => {
      const w = await readWorld(a.sessionId);
      const m = new Map();
      for (const [oid, row] of Object.entries(w.state ?? {})) {
        if (!oid.startsWith("obj_order_")) continue;
        const cp = row?.costPressure;
        if (typeof cp !== "number") continue; // 承载 = 世界态里真有这一格
        const qty = row?.qty, up = row?.unitPrice;
        const value = typeof qty === "number" && typeof up === "number" ? qty * up : null;
        m.set(oid, { cp, value });
      }
      return m;
    };
    const carrierMap = {};
    for (const nm of CFG.arms) if (arms[nm]) carrierMap[nm] = await carriersOf(arms[nm]);
    const ref = carrierMap.zero ?? carrierMap[CFG.arms[0]];
    if (!ref) say("NOT-MEASURED：无可用参照臂");
    else {
      say(`承载集（state 里真有 costPressure 的 Order）规模 = ${ref.size}（求解器报 carriers=${z?.series.at(-1)?.costPressureCarriers} / universe=${z?.series.at(-1)?.costPressureUniverse}）`);
      say(`⚠ 金丝雀：承载集必须非空，且至少一臂在承载集上真有非零 Δ —— 否则先怀疑承载集取法，⛔ 不许报「确实没变」。`);
      say("");
      say(`臂\t承载集规模\tΔ≠0 的承载数\tmax|Δ|\tΣ|Δ|\t承载集均值Δ(价值加权,诊断)\t求解器 costPressure.value\tΔ(value)\tMARGIN.projected\tΔ(MARGIN)`);
      for (const nm of CFG.arms) {
        const cm = carrierMap[nm];
        if (!cm) continue;
        const ids = [...new Set([...ref.keys(), ...cm.keys()])];
        let nz = 0, maxAbs = 0, sumAbs = 0, sw = 0, swd = 0;
        for (const id of ids) {
          const b = ref.get(id)?.cp, v = cm.get(id)?.cp;
          if (typeof b !== "number" || typeof v !== "number") continue;
          const d = v - b;
          if (d !== 0) nz += 1;
          if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
          sumAbs += Math.abs(d);
          const wgt = cm.get(id)?.value;
          if (typeof wgt === "number" && wgt > 0) { sw += wgt; swd += wgt * d; }
        }
        const last = arms[nm].series.at(-1), lz = z?.series.at(-1);
        say([nm, ids.length, nz, num(maxAbs, 6), num(sumAbs, 6),
             sw > 0 ? num(swd / sw, 6) : "—",
             num(last?.costPressureValue, 6),
             num((last?.costPressureValue ?? 0) - (lz?.costPressureValue ?? 0), 6),
             num(last?.marginProjected, 4),
             num((last?.marginProjected ?? 0) - (lz?.marginProjected ?? 0), 4)].join("\t"));
      }
      // 逐格明细：承载集上 Δ 最大的前 8 个（按 |Δ| 降序，同值按 id 升序 —— 遍历序即语义）
      for (const nm of CFG.arms) {
        const cm = carrierMap[nm];
        if (!cm || nm === "zero") continue;
        const rows = [];
        for (const id of [...new Set([...ref.keys(), ...cm.keys()])]) {
          const b = ref.get(id)?.cp, v = cm.get(id)?.cp;
          if (typeof b === "number" && typeof v === "number" && v !== b) rows.push({ id, b, v, d: v - b });
        }
        rows.sort((p, q) => Math.abs(q.d) - Math.abs(p.d) || (p.id < q.id ? -1 : 1));
        say(`\n[${nm} − zero] 承载集逐格 Δ 前 8（共 ${rows.length} 格有 Δ）：`);
        for (const r of rows.slice(0, 8)) say(`   ${r.id}  ${num(r.b, 6)} → ${num(r.v, 6)}  Δ=${num(r.d, 6)}`);
        if (rows.length === 0) say(`   （无 —— 若 ${nm} 是 B/AB 臂则**这就是探针坏了的信号**，先查承载集取法）`);
      }
    }
  } catch (e) { say(`承载集分解失败：${e instanceof Error ? e.message : String(e)}`); }

  // ── ⑦ 全量网络观测 ────────────────────────────────────────────────────────
  say("\n══ ⑦ 全量网络观测（每一次请求；⚠ 只记失败会被读成『没有』）══");
  say(`总请求数 = ${NET.length}`);
  const byStatus = {};
  for (const n of NET) byStatus[String(n.status)] = (byStatus[String(n.status)] ?? 0) + 1;
  say(`按状态码 = ${JSON.stringify(byStatus)}`);
  say(`非 GET 请求 = ${NET.filter((n) => n.method !== "GET").length}`);
  say("── 非 GET 与一切非 2xx（GET 成功已计入总数，未逐条展开）──");
  for (const n of NET) {
    if (n.method === "GET" && n.status !== null && n.status < 400) continue;
    say(`  #${n.seq} ${n.method} ${n.path} → ${n.status} ${n.ms}ms ${n.err ? `ERR=${n.err}` : ""} ${n.textHead ? `text=${n.textHead}` : ""}`);
  }
  const slow = [...NET].sort((a, b) => b.ms - a.ms).slice(0, 5);
  say(`最慢 5 条：${slow.map((n) => `${n.method} ${n.path}=${n.ms}ms`).join(" · ")}`);

  // ── ⑧ 复现命令 ────────────────────────────────────────────────────────────
  say("\n══ ⑧ 复现命令 ══");
  say(`PORT=${process.env.PORT || 4019} TICKS=${CFG.ticks} node docs/evidence/WO-MULTIPERT-baseline.mjs > docs/evidence/WO-MULTIPERT-baseline.txt 2>&1`);
  say(`echo "CAPTURED_RC=$?" > docs/evidence/WO-MULTIPERT-baseline.rc`);
  say("\nNOT-MEASURED 说明：凡本报告未给出数字的项，一律按 NOT-MEASURED 读，⛔ 不许拿别的臂的数推它。");
}

main()
  .then(() => { say(`\nDONE ${new Date().toISOString()}`); process.exit(0); })
  .catch((e) => { say(`\nFATAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`); process.exit(1); });
