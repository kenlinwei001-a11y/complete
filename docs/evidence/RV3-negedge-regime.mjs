/**
 * 评审员#3 · 独立复核探针（自写，不复用上游/P1/P2/RV2 脚本）。
 *
 * 评的对象：根因「负边单向传导 + 硬地板 ⇒ 超载侧信息进不了 Order.demandPressure」，
 * 其声明里含一条**可判定的机制断言**：
 *   C2 合成点（app.ts restoreSpecBase）在核内夹值（propagation.ts 饱和段）**之后**
 *   ⇒ 递推是  x ← clamp((1−λ)x + c) + λ·base   【H1】
 *   而不是    x ← clamp((1−λ)x + λ·base + c)   【H3，把合成放回夹值之前】
 *   也不是    x ← (1−λ)x + λ·base + c           【H2，无夹值】
 *
 * ⛔ 这一条**上游没做过判别**：上游的 k× A/B 只能证明「夹住档读数与 c 无关」，
 *    对 H1 与 H3 都成立（两者在深夹区都落到 λ·base 或 0 的常数上，见下）。
 *    真正的判别器是**中带**：−λ·base < c < −(1−λ)λ·base 时
 *      H1 ⇒ λ·base（常数）   H3 ⇒ base + c/λ > 0（随 c 变）   两者**可分辨**。
 *    本探针从**逐单**取 c（engine 自己的 trace 行 amount，不依赖读 forecastBias 反解），
 *    逐单算三种递推的不动点，与实测读数逐单比 —— 单侧命中即为判别。
 *
 * 其它独立核（各带金丝雀）：
 *   · 上界判据（读数 ≤ 基值）逐单；阳对照 = 全世界范围里「读数 > 基值」的格必须 >0。
 *   · 域逃逸扫描（C2 合成写在夹值之后 ⇒ 合成值不经夹值）：声明域外的格逐个数。
 *   · 零扰动对照：同种子第二个会话，读数须逐字节相同（世界自己的行为，不是扰动的产物）。
 *
 * ⛔ 只读：不 PATCH 规则、不推扰动、不重启服务。
 */
import fs from "node:fs";

const BASE = "http://127.0.0.1:4019/a/v1";
const H = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3-negedge-regime.txt";
const SRC_BATTERY = "/Users/apple/deploy/wo-edge-wire/apps/datacore/src/synthetic/battery.ts";
const TICKS = Number(process.env.TICKS || 30);
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* 非 JSON 如实记 */ }
  return { status: r.status, json: j, text };
}
const must = (label, r) => {
  log(`  ${label}: HTTP ${r.status}`);
  if (r.status >= 300) throw new Error(`${label} HTTP ${r.status} :: ${r.text.slice(0, 300)}`);
  return r.json;
};
const round12 = (x) => Math.round(x * 1e12) / 1e12;
/** 真值表式的递推不动点（迭代到收敛，双精度下 300 次足够） */
const fixpoint = (f, x0) => { let x = x0; for (let i = 0; i < 300; i++) x = f(x); return x; };

try {
  log(`# 评审员#3 独立复核 · ${new Date().toISOString()} · BASE=${BASE} · TICKS=${TICKS}`);

  // ── 0) 金丝雀⓪：取数路活着（不存在的会话须 404）────────────────────────────
  const c0 = await req("GET", "/sim/sessions/sims_rv3_does_not_exist");
  log(`# 金丝雀⓪（取数路活着）：不存在的会话 → HTTP ${c0.status}（应 404）${c0.status === 404 ? " ✅" : " ❌"}`);
  if (c0.status !== 404) throw new Error("取数路异常，停止");

  // ── 1) 规则：demandPressure 入边集合（必然命中 + 必然不命中）────────────────
  const rules = must("GET /sim/propagation-rules", await req("GET", "/sim/propagation-rules"));
  const items = rules.items ?? rules;
  const inEdges = items.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure" && r.status === "PUBLISHED");
  const ghost = items.filter((r) => r.targetStateVar === "___rv3_no_such_var___");
  log(`# 金丝雀A（必然命中）：Order|demandPressure 入边 ${inEdges.length} 条 ${inEdges.length > 0 ? "✅" : "❌ 工具坏了"}`);
  log(`# 金丝雀B（必然不命中）：虚构量纲入边 ${ghost.length} 条 ${ghost.length === 0 ? "✅ 0 命中可信" : "❌ 取法有问题"}`);
  if (inEdges.length === 0 || ghost.length !== 0) throw new Error("规则取数路异常");
  for (const r of inEdges) log(`   入边 ${r.key} :: ${r.sourceTypeKey}.${r.sourceStateVar} --×${r.coefficient}--> ${r.targetTypeKey}.${r.targetStateVar}`);
  const fbIn = items.filter((r) => r.targetTypeKey === "Model" && r.targetStateVar === "forecastBias" && r.status === "PUBLISHED");
  log(`   Model.forecastBias 入度 = ${fbIn.length}（0 = 外生根 ⇒ 衰减相豁免、值取播种占位）`);

  // ── 2) 取值域：从**源码**现读（金丝雀：条数 38 / demandPressure 的形状）──────
  const src = fs.readFileSync(SRC_BATTERY, "utf8");
  const famBlock = src.slice(src.indexOf("export const STATE_VAR_DOMAINS"), src.indexOf("STATE_VAR_DOMAINS.forecastBias"));
  const famNames = [...famBlock.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]);
  const domShape = /min:\s*(-?\d+),\s*max:\s*(\d+),\s*restPoint:\s*(-?\d+)/.exec(famBlock);
  const domains = new Map();
  for (const n of famNames) domains.set(n, { min: Number(domShape[1]), max: Number(domShape[2]), rest: Number(domShape[3]) });
  // 显式覆盖（forecastBias / 天数族 / 件数族 …）：逐条现读，⛔ 不靠 32+1 的加法
  for (const m of src.matchAll(/STATE_VAR_DOMAINS\.([A-Za-z][A-Za-z0-9]*) = \{/g)) {
    const blk = src.slice(m.index + m[0].length, m.index + m[0].length + 700);
    const mi = /min:\s*(null|-?\d+)/.exec(blk); const ma = /max:\s*(null|-?\d+)/.exec(blk); const rp = /restPoint:\s*(-?\d+)/.exec(blk);
    if (mi && rp) domains.set(m[1], { min: mi[1] === "null" ? null : Number(mi[1]), max: ma && ma[1] !== "null" ? Number(ma[1]) : null, rest: Number(rp[1]) });
  }
  // ⛔ 剥注释后再数登记项（本仓实测过的坑：含注释扫会把退役注释里的引用数进来）
  const sNoComment = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const refKeys = [...sNoComment.matchAll(/"([A-Za-z]+)\|([A-Za-z]+)":\s*\{\s*specKey:/g)].map((m) => `${m[1]}|${m[2]}`);
  log(`\n# 金丝雀C（域表解析活着）：压力族名 ${famNames.length} 个 · 总域 ${domains.size} 条（期望 38）${domains.size === 38 ? " ✅" : " ❌"}`);
  log(`# 金丝雀D（正向必有）：demandPressure = ${JSON.stringify(domains.get("demandPressure"))} ${domains.get("demandPressure")?.min === 0 && domains.get("demandPressure")?.max === 100 && domains.get("demandPressure")?.rest === 0 ? "✅" : "❌"}`);
  log(`# 金丝雀E（规格归属表解析）：STATE_VAR_VALUE_REFS 命中 ${refKeys.length} 条（剥注释后上游读数 25）`);
  log(`   其中含 Order|demandPressure = ${refKeys.includes("Order|demandPressure")} · 含 Model|forecastBias = ${refKeys.includes("Model|forecastBias")}（退役，应 false）`);

  // ── 3) 会话 S1：tick0 读一次 + 推 TICKS 拍（最后一拍单独打，拿该拍 trace）────
  const s1 = must("POST /sim/sessions", await req("POST", "/sim/sessions", {}));
  const w0raw = must(`GET world@tick0 ${s1.id}`, await req("GET", `/sim/sessions/${s1.id}/world`));
  const w0 = w0raw.state ?? w0raw;
  const det1 = must(`GET session ${s1.id}`, await req("GET", `/sim/sessions/${s1.id}`));
  const baseSnap = det1.baseSnapshot ?? {};
  const orderIds = Object.keys(baseSnap).filter((id) => id.startsWith("obj_order_")).sort();
  log(`\n会话 S1 = ${s1.id} · Order ${orderIds.length} 个 · baseSnapshot ${Object.keys(baseSnap).length} 对象`);

  // tick0 锚：世界态 == baseSnapshot（规格值已物化）
  let tick0Same = 0;
  for (const id of orderIds) if (w0[id]?.demandPressure === baseSnap[id]?.demandPressure) tick0Same++;
  log(`# 金丝雀F（tick0 锚）：demandPressure 世界态 == baseSnapshot 的单 ${tick0Same}/${orderIds.length} ${tick0Same === orderIds.length ? "✅" : "⚠ 有差"}`);

  await req("POST", `/sim/sessions/${s1.id}/tick`, { n: Math.max(0, TICKS - 1) });
  const tk = must("POST /sim/sessions/{id}/tick (最后一拍 · disclose)", await req("POST", `/sim/sessions/${s1.id}/tick`, { n: 1, disclose: true }));
  const rep = tk.stateVarReport ?? tk.disclosure?.stateVarReport ?? null;
  const lam = rep?.decayApplied?.demandPressure;
  log(`# 引擎自报 λ(demandPressure) = ${lam} ${lam === 0.37 ? "✅" : "⚠ 与文档 0.37 不同"}`);
  if (typeof lam !== "number" || !(lam > 0 && lam < 1)) throw new Error("拿不到 λ，停止");
  const trace = tk.trace ?? [];
  const negRows = trace.filter((t) => t.ruleKey === "demo_forecast_bias_to_order_demand");
  log(`# 最后一拍 trace：行 ${trace.length} · 目标边行 ${negRows.length}（= Order 数？ ${negRows.length === orderIds.length ? "✅" : "⚠"}）`);
  if (negRows.length === 0) throw new Error("trace 没有目标边 ⇒ 判别器不可用，停止");
  const cOf = new Map(); const modelOf = new Map();
  for (const t of negRows) { cOf.set(t.toObjectId, t.amount); modelOf.set(t.toObjectId, t.fromObjectId); }

  const w1raw = must(`GET world@tick${TICKS}`, await req("GET", `/sim/sessions/${s1.id}/world`));
  const w1 = w1raw.state ?? w1raw;

  // ── 4) 逐单：base / 实测 / c → 三种递推的不动点 ─────────────────────────────
  log(`\n════ 逐单判别（H1 = 夹值在合成前[现行]，H3 = 合成在夹值前，H2 = 无夹值）════`);
  const rows = [];
  for (const id of orderIds) {
    const base = baseSnap[id]?.demandPressure;
    const obs = w1[id]?.demandPressure;
    const c = cOf.get(id);
    if (typeof base !== "number" || typeof obs !== "number" || typeof c !== "number") continue;
    const H1 = fixpoint((x) => Math.max(0, (1 - lam) * x + c) + lam * base, base);
    const H3 = fixpoint((x) => Math.max(0, (1 - lam) * x + lam * base + c), base);
    const H2 = fixpoint((x) => (1 - lam) * x + lam * base + c, base);
    const H0 = fixpoint((x) => Math.max(0, (1 - lam) * x + c), base); // C2 之前：纯传导积分器
    rows.push({ id, model: modelOf.get(id), base, c, obs, H0, H1, H2, H3 });
  }
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const score = (k) => rows.filter((r) => near(r.obs, r[k])).length;
  log(`逐单格数 ${rows.length}`);
  log(`  H0（无 C2 · 纯积分器，收敛到 0）        命中 ${score("H0")}/${rows.length}`);
  log(`  H1（现行：clamp((1−λ)x+c) + λ·base）      命中 ${score("H1")}/${rows.length}`);
  log(`  H2（无夹值：base + c/λ）                 命中 ${score("H2")}/${rows.length}`);
  log(`  H3（合成在夹值前：clamp((1−λ)x + λ·base + c)）命中 ${score("H3")}/${rows.length}`);
  // H1/H3 分歧带：H1 落到 λ·base 常数、而 H3 > 0
  const band = rows.filter((r) => near(r.H1, lam * r.base) && r.H3 > 0.01 && !near(r.H1, r.H3));
  log(`  ★ 判别带（H1 给出 λ·base 常数、H3 给出 >0 且二者可分辨）: ${band.length} 单`);
  for (const r of band.slice(0, 12)) {
    log(`     ${r.id} model=${r.model} base=${r.base} c=${r.c} 实测=${r.obs} · H1=${r.H1} H3=${r.H3} ⇒ 实测站 ${near(r.obs, r.H1) ? "H1" : near(r.obs, r.H3) ? "H3" : "两者都不站"}`);
  }
  if (band.length === 0) log(`     ⚠ 本会话无判别带样本 ⇒ H1/H3 未被分辨（只能靠 H2 深夹带的分辨，见下）`);
  // 深夹带：H1 → λ·base（常数）、H3 → 0（合成在夹值前 ⇒ 合成值也会被夹掉）—— 也可分辨
  const deep = rows.filter((r) => near(r.H1, lam * r.base) && near(r.H3, 0) && r.base > 0.01);
  const deepHit1 = deep.filter((r) => near(r.obs, r.H1)).length;
  log(`  ★ 深夹带（H1 → λ·base、H3 → 0）: ${deep.length} 单 · 实测站 H1 ${deepHit1}/${deep.length} ${deep.length > 0 && deepHit1 === deep.length ? "✅" : "⚠"}`);
  // 收敛残差自证：未夹值档的（实测 − H1）应恰为 (c/λ)·(1−λ)^TICKS —— 残差不是反例
  const resid = rows.filter((r) => !near(r.obs, r.H1) && Math.abs(r.H2 - r.H1) < 0.02);
  const residOK = resid.filter((r) => Math.abs((r.obs - r.H1) - (r.base - r.H1) * Math.pow(1 - lam, TICKS)) < 1e-8).length;
  log(`  # 未夹值档收敛残差自证：实测−H1 == (base−H1)·(1−λ)^${TICKS} 命中 ${residOK}/${resid.length} ${resid.length > 0 && residOK === resid.length ? `✅（那 ${resid.length} 条不是反例，是第 ${TICKS} 拍还没收敛完）` : "⚠"}`);
  const mismatchH1 = rows.filter((r) => !near(r.obs, r.H1));
  log(`  H1 反例（实测 ≠ H1）: ${mismatchH1.length} 单 ${mismatchH1.length === 0 ? "✅ 逐单闭合" : "⚠ 前 8 条："}`);
  for (const r of mismatchH1.slice(0, 8)) log(`     ${r.id} base=${r.base} c=${r.c} 实测=${r.obs} H1=${r.H1} H2=${r.H2} H3=${r.H3}`);

  // ── 5) 上界判据 + 阳对照 ────────────────────────────────────────────────────
  const overBase = rows.filter((r) => r.obs > r.base + 0.01);
  log(`\n# 上界判据（Order.demandPressure 读数 ≤ 基值 + 0.01）: 上穿 ${overBase.length}/${rows.length} ${overBase.length === 0 ? "✅" : "❌ 被推翻"}`);
  const ratio37 = rows.filter((r) => near(r.obs, lam * r.base));
  log(`# 「读数 == λ·base」常数档: ${ratio37.length}/${rows.length}（上游 98/150）`);
  // 阳对照：全世界里「读数 > 基值」的格（探针有鉴别力）
  let up = 0, upSample = [];
  for (const id of Object.keys(baseSnap)) {
    const b = baseSnap[id], x = w1[id];
    if (!b || !x) continue;
    for (const sv of Object.keys(x)) {
      if (typeof b[sv] !== "number" || typeof x[sv] !== "number") continue;
      if (x[sv] > b[sv] + 0.01) { up++; if (upSample.length < 5) upSample.push(`${id}.${sv} ${b[sv]}→${x[sv]}`); }
    }
  }
  log(`# 阳对照（同尺子 · 全世界）：读数 > 基值 的格 ${up} 个（须 >0，否则探针无鉴别力）${up > 0 ? "✅" : "❌"}`);
  for (const s of upSample) log(`     ${s}`);

  // ── 6) 域逃逸扫描（合成值不经夹值 ⇒ 声明的域被突破）────────────────────────
  const vc = must("GET /sim/view-config", await req("GET", "/sim/view-config"));
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  let esc = 0; let escSpec = 0; const escByVar = new Map(); const escSample = [];
  for (const id of Object.keys(w1)) {
    for (const sv of Object.keys(w1[id])) {
      const d = domains.get(sv);
      if (!d) continue;
      const v = w1[id][sv];
      if (typeof v !== "number") continue;
      if (v < d.min || (d.max !== null && v > d.max)) {
        esc++; escByVar.set(sv, (escByVar.get(sv) ?? 0) + 1);
        const tk = typeOf.get(id);
        const owned = tk !== undefined && refKeys.includes(`${tk}|${sv}`);
        if (owned) escSpec++;
        if (escSample.length < 6) escSample.push(`${id}.${sv} = ${v} 域[${d.min},${d.max}] 规格格=${owned}`);
      }
    }
  }
  log(`\n# 域逃逸扫描：声明域外的 (对象·量) 格 ${esc} 个（C2 前应为 0 —— 种子越界由夹值收回）`);
  for (const [k, n] of [...escByVar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) log(`     ${k}: ${n} 格`);
  for (const s of escSample) log(`     ${s}`);

  // ── 7) 零扰动对照：同种子第二会话，读数须逐字节同 ───────────────────────────
  const s2 = must("POST /sim/sessions (S2 对照)", await req("POST", "/sim/sessions", {}));
  await req("POST", `/sim/sessions/${s2.id}/tick`, { n: TICKS });
  const w2raw = must(`GET world@tick${TICKS} (S2)`, await req("GET", `/sim/sessions/${s2.id}/world`));
  const w2 = w2raw.state ?? w2raw;
  let same = 0, diff = 0, firstDiff = "";
  for (const id of orderIds) {
    if (w1[id]?.demandPressure === w2[id]?.demandPressure) same++;
    else { diff++; if (!firstDiff) firstDiff = `${id} S1=${w1[id]?.demandPressure} S2=${w2[id]?.demandPressure}`; }
  }
  log(`\n# 零扰动对照（S1 vs S2 同种子）：demandPressure 逐字节相同 ${same}/${orderIds.length} · 不同 ${diff} ${diff === 0 ? "✅ 世界自身行为，可复现" : `⚠ 首个差异 ${firstDiff}`}`);

  // ── 8) 涌现属性普查（独立重算：入边符号 × 硬地板 × 规格归属）──────────────
  const byCell = new Map();
  for (const r of items.filter((x) => x.status === "PUBLISHED")) {
    const k = `${r.targetTypeKey}|${r.targetStateVar}`;
    const e = byCell.get(k) ?? { inDeg: 0, coefs: [] };
    e.inDeg++; e.coefs.push(r.coefficient); byCell.set(k, e);
  }
  const allNeg = [...byCell].filter(([, e]) => e.coefs.every((c) => c < 0));
  const allPos = [...byCell].filter(([, e]) => e.coefs.every((c) => c > 0));
  const mixed = [...byCell].filter(([, e]) => e.coefs.some((c) => c > 0) && e.coefs.some((c) => c < 0));
  log(`\n# 涌现属性普查（自算）：有入边的目标格 ${byCell.size} · 全正 ${allPos.length} · 全负 ${allNeg.length} · 双向 ${mixed.length}`);
  log(`# 金丝雀G（普查有鉴别力）：全正 > 0 且 双向 > 0 —— 全正=${allPos.length} 双向=${mixed.length} ${allPos.length > 0 && mixed.length > 0 ? "✅" : "❌"}`);
  for (const [k, e] of allNeg) {
    const [tk, sv] = k.split("|");
    const d = domains.get(sv);
    const hardFloor = d !== undefined && d.rest === d.min;
    log(`   🔴 全负格 ${k} 入度=${e.inDeg} 系数=[${e.coefs.join(", ")}] · 域 rest=${d?.rest} min=${d?.min} ⇒ 硬地板=${hardFloor} · 规格格=${refKeys.includes(k)}`);
  }
  log(`# ⇒ 「符号单一 ∧ 指向硬地板 ∧ 规格格」的格共 ${allNeg.filter(([k]) => refKeys.includes(k)).length} 个 —— **全仓没有任何地方算过这个合取**（本行是现算的）`);

  log(`\n# 结论速览：H1 命中 ${score("H1")}/${rows.length}（现行递推）· H3 命中 ${score("H3")}/${rows.length}（合成在夹值前）`);
  log(`#          判别带 ${band.length} 单 · 上穿基值 ${overBase.length}/${rows.length} · 域逃逸 ${esc} 格`);
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  log(`\n落盘 ${OUT}`);
  console.log("RV3_DONE");
} catch (e) {
  log(`❌ 探针异常：${e.message}`);
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  process.exitCode = 2;
}
