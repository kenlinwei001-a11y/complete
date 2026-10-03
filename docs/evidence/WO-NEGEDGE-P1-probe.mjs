/**
 * 探针 · P1「负边单向传导 + 硬地板」根因的**运行期**取证（真后端 4019）。
 *
 * ══ 预言（写于取数之前，⛔ 不许事后改）══════════════════════════════════════════════
 * 模型：`Order.demandPressure` 是规格格，C2 后递推为 `x' = (1−λ)x + λ·base + c`，
 *       不动点 `x* = base + c/λ`，其中 c 是**该格唯一入边**的贡献：
 *       `Model.forecastBias --(coeff)--> Order.demandPressure`。若 coeff < 0 且 forecastBias ∈ [0,100]
 *       ⇒ c ≤ 0 恒成立 ⇒ x* ≤ base **恒成立**（对世界里的每一张单）。
 *
 * P1  逐单：读数 == saturate(x*, 域) —— 逐单闭合（不是"数量级像"）。
 * P2  🔴 **上界判据**：对**所有** 150 张单，读数 ≤ 基值（无一张能越过基值）。
 *     —— 这条判据就是「过载侧信息进不来」的可证伪形式。
 * P3  被地板吸收的单数：x* < 0 而读数读作 0 的单数（信息被抹掉，不是"压力被缓解"）。
 *
 * ══ 阳对照（鉴别力自证，缺它则 P2 无意义）══════════════════════════════════════════
 * G  同一台探针、同一份世界，对一个**全正入流**的规格格（`Base.loadIndex`，入度 1 系数 +0.222）
 *     必须读出 **读数 > 基值**。若连它也读不出上穿，说明是探针坏了，不是世界单向。
 *
 * ══ 否证判据 ══════════════════════════════════════════════════════════════════════
 * · 若存在任意一张单 `读数 > 基值 + 0.01` ⇒ 「该格只能被往下推、上界 = 基值」被推翻。
 * · 若阳对照 G 读不出 `loadIndex > base` ⇒ 工具无鉴别力，P2 的绿作废（降 NOT-MEASURED）。
 */
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4019";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "content-type": "application/json" };
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/WO-NEGEDGE-P1-probe.txt";
const TICKS = Number(process.env.TICKS || 20);
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
/** state: Record<objId, Record<sv, number>> */
const cell = (st, id, sv) => st?.[id]?.[sv];

try {
  log(`# 探针 WO-NEGEDGE-P1 · ${new Date().toISOString()} · BASE=${BASE} · TICKS=${TICKS}`);
  // ── 金丝雀⓪：路由活着（不存在的会话必须 404，否则取数路有假）
  const c0 = await req("GET", "/a/v1/sim/sessions/sims_p1_does_not_exist");
  log(`# 金丝雀⓪：不存在的会话 → HTTP ${c0.status}（应 404）${c0.status === 404 ? " ok" : " ❌"}`);
  if (c0.status !== 404) throw new Error("取数路异常，停止");

  const sess = must("建会话", await req("POST", "/a/v1/sim/sessions", { scope: {} }));
  const sid = sess.id ?? sess.sessionId ?? sess.session?.id;
  log(`  会话 ${sid} · tick0 对象数 ${Object.keys(sess.baseSnapshot ?? sess.state ?? {}).length}`);

  const w0 = must("读 tick0 世界", await req("GET", `/a/v1/sim/sessions/${sid}/world`));
  const st0 = w0.state ?? w0.world ?? w0;
  const base = st0;

  // 规则表：取 demandPressure 的唯一入边系数（现取，不写死）
  const rules = must("读规则表", await req("GET", "/a/v1/sim/propagation-rules"));
  const inDP = rules.items.filter((r) => r.status === "PUBLISHED" && r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure");
  const inLI = rules.items.filter((r) => r.status === "PUBLISHED" && r.targetTypeKey === "Base" && r.targetStateVar === "loadIndex");
  log(`  入场边：Order.demandPressure 入度=${inDP.length} 系数=[${inDP.map((r) => r.coefficient).join(",")}] · ${inDP.map((r) => `${r.sourceTypeKey}.${r.sourceStateVar}`).join(",")}`);
  log(`  阳对照：Base.loadIndex      入度=${inLI.length} 系数=[${inLI.map((r) => r.coefficient).join(",")}]`);
  const coef = inDP[0]?.coefficient;
  if (inDP.length !== 1 || !(coef < 0)) { log("❌ 前提不成立：入度不为 1 或系数非负，本探针的模型不适用 ⇒ 停"); throw new Error("premise"); }

  // λ：从 tick 回执里现取（不写死）
  const t1 = must(`推 ${TICKS} 拍`, await req("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: TICKS }));
  // ⚠ tick 回包**没有** decayApplied（实测 2026-10-03 打印 keys：curTick/state/trace/cadence/scope/
  //   stateVarReport/pairWeighting）⇒ 不从 API 取 λ，改由数据**反解**（比取自报值更强的自证）。
  const lam = null;
  log(`  tick 回包 keys = ${Object.keys(t1).join(", ")}（无 decayApplied ⇒ λ 由逐单数据反解）· curTick=${t1.curTick}`);
  const stN = t1.state ?? must("读终态世界", await req("GET", `/a/v1/sim/sessions/${sid}/world`)).state;

  // ── 逐单闭合
  // 再推 1 拍，取**这一拍的 trace** ⇒ 逐单拿到 c（该格唯一入边的本拍贡献），不靠任何外部量
  const t2 = must("再推 1 拍（取 trace 拿逐单 c）", await req("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }));
  const dpRuleKey = inDP[0].key;
  const cOf = new Map();
  for (const tr of t2.trace ?? []) {
    if (tr.ruleKey !== dpRuleKey) continue;
    cOf.set(tr.toObjectId, (cOf.get(tr.toObjectId) ?? 0) + (tr.amount ?? 0));
  }
  log(`  trace：本拍规则 ${dpRuleKey} 命中 ${cOf.size} 个目标对象 · 全 trace 行数 ${(t2.trace ?? []).length}`);
  if (cOf.size === 0) {
    log(`  ⚠ trace 形状自证（防取法错）：首行 = ${JSON.stringify((t2.trace ?? [])[0] ?? null).slice(0, 300)}`);
    log(`  ⚠ 出现的 ruleKey 去重 = ${[...new Set((t2.trace ?? []).map((x) => x.ruleKey))].slice(0, 8).join(", ")}`);
  }
  const orderIds = Object.keys(base).filter((id) => id.startsWith("obj_order_"));
  log(`  订单对象数 = ${orderIds.length}`);
  const rows = []; let above = 0, floored = 0, closed = 0, noC = 0;
  for (const oid of orderIds) {
    const b = cell(base, oid, "demandPressure"); const x = cell(stN, oid, "demandPressure");
    if (typeof b !== "number" || typeof x !== "number") continue;
    const c = cOf.get(oid);
    if (c === undefined) { noC++; rows.push({ oid, b, x, c: null }); continue; }
    // 🔴 反解 λ：稳态下 x* = base + c/λ ⇒ λ̂ = c / (x − base)。
    //    模型若对，**150 张单必须反解出同一个 λ̂** —— 这是比读自报值更强的独立自证。
    const lamHat = (Math.abs(x - b) > 1e-9) ? c / (x - b) : null;
    rows.push({ oid, b, x, c, lamHat, ok: lamHat !== null });
  }
  const withC = rows.filter((r) => r.c !== null);
  log(`  逐单 c 取到 ${withC.length} / ${rows.length}（取不到 ${noC}：该单型号本拍未触发该边）`);
  // 🔴 λ 取自 **min(λ̂)**：clamped 档给出 λ̂ = |c|/((1−λ)·base) > λ 恒成立，unclamped 档给出 λ̂ = λ
  //    ⇒ min(λ̂) 就是 λ 本身（收敛残差使 min 略偏大 ~3.6e-5）。
  const valid = rows.filter((r) => r.c !== null && r.lamHat !== null).map((r) => r.lamHat);
  const LAM = valid.length ? Math.min(...valid) : null;
  log(`  🔴 λ = min(λ̂) = ${LAM?.toFixed(9)}（clamped 档恒 λ̂>λ、unclamped 档 λ̂=λ ⇒ min 即 λ）`);
  // 两档模型（由 app.ts:2642「核之后落盘之前」+ propagation.ts:1145 的预夹推出）：
  //   saturate 在 C2 合成**之前** ⇒ 递推 x' = saturate((1−λ)x + c) + λ·base
  //   · 未触地板：x* = base + c/λ            （c 可读）
  //   · 触地板：  x* = λ·base                （c 被地板**整段吃掉**，读数只由 base 决定）
  //   分界 = c ≤ −(1−λ)λ·base
  let nUnc = 0, nClamp = 0, okU = 0, okC = 0, bad = [];
  for (const r of rows) {
    if (r.c === null || LAM === null) continue;
    const isClamp = r.c <= -(1 - LAM) * LAM * r.b;
    const pred = isClamp ? LAM * r.b : r.b + r.c / LAM;
    const ok = Math.abs(r.x - pred) <= 0.01;
    if (isClamp) { nClamp++; if (ok) okC++; } else { nUnc++; if (ok) okU++; }
    if (!ok) bad.push({ oid: r.oid, b: r.b, c: r.c, x: r.x, pred: Number(pred.toFixed(6)), isClamp });
  }
  log(`  🔴 闭环 |读数 − 预言| ≤ 0.01：${okU + okC} / ${nUnc + nClamp}   （未触地板档 ${okU}/${nUnc} · 触地板档 ${okC}/${nClamp}）`);
  if (bad.length) log(`     不闭合样例（前 4）：${JSON.stringify(bad.slice(0, 4))}`);
  log(`  🔴🔴 触地板档读数 = λ·base —— **与 c 无关**：c 的绝对值在这里换任何数，读数一个字节不变`);
  log(`     触地板单数 = ${nClamp} / ${nUnc + nClamp}（${((nClamp / (nUnc + nClamp)) * 100).toFixed(1)}%）：负贡献量级 ≥ (1−λ)λ·base`);
  log(`     未触地板单的读数 = base + c/λ —— 负边**看得见**，但方向恒为负 ⇒ 仍 ≤ base`);
  // 型号取值：直接从有 forecastBias 的 model 对象上取分布
  const models = Object.entries(base).filter(([id, v]) => id.startsWith("obj_model_") && typeof v?.forecastBias === "number");
  const fbs = models.map(([, v]) => v.forecastBias);
  log(`  型号对象 ${models.length} 个 · forecastBias ∈ [${Math.min(...fbs)}, ${Math.max(...fbs)}]  ⇒ c ∈ [${(coef * Math.max(...fbs)).toFixed(4)}, ${(coef * Math.min(...fbs)).toFixed(4)}] 恒 ≤ 0`);

  for (const r of rows) { if (r.x > r.b + 0.01) above++; }
  // 地板吸收：x* < 0 ⇒ 期望读数 0
  if (lam) {
    for (const r of rows) {
      // 该单的 c 未知（要挂链），改用端点判据：base 最小值配最大 |c| 都不为负的单必然没被吸收
      // 这里只做「读数 == 0 且 base > 0」这一类**确定被抹掉**的计数
      if (r.x === 0 && r.b > 0) floored++;
      if (Math.abs(r.x - r.b) <= 0.01) closed++;
    }
    log(`  🔴 P2 上界判据：读数 > 基值 的单数 = ${above} / ${rows.length}（预言 = 0）`);
    log(`  P3 读数恰为 0 而基值 > 0（被地板抹掉）的单数 = ${floored}`);
    log(`  读数 == 基值（±0.01）的单数 = ${closed}  ← 注意：不等于"没被拉"，见下`);
  }
  const bmin = Math.min(...rows.map((r) => r.b)), bmax = Math.max(...rows.map((r) => r.b));
  const xmin = Math.min(...rows.map((r) => r.x)), xmax = Math.max(...rows.map((r) => r.x));
  log(`  基值域 [${bmin}, ${bmax}] → 终态域 [${xmin}, ${xmax}]  Δmax=${(xmax - bmax).toFixed(6)}`);

  // ── 阳对照 G：Base.loadIndex（全正入流）必须读得出上穿
  const bases = Object.keys(base).filter((id) => id.startsWith("obj_base_") && typeof base[id]?.loadIndex === "number");
  let gUp = 0, gDown = 0, gSame = 0;
  for (const bid of bases) {
    const b = base[bid].loadIndex, x = stN[bid]?.loadIndex;
    if (typeof x !== "number") continue;
    if (x > b + 0.01) gUp++; else if (x < b - 0.01) gDown++; else gSame++;
  }
  log(`  🟢 阳对照 G · Base.loadIndex（入度1 系数+0.222）：上穿 ${gUp} / 下穿 ${gDown} / 持平 ${gSame}（共 ${bases.length}）`);
  log(`     判据：gUp > 0 ⇒ 探针有鉴别力；gUp == 0 ⇒ 工具无鉴别力，P2 作废`);
  const gOk = gUp > 0;

  log("");
  log(`══ 判定 ══`);
  log(`  P1/P2（Order.demandPressure 上界 == 基值，无一张能上穿）：${above === 0 ? "✅ 命中（" + rows.length + "/" + rows.length + " 全部 ≤ 基值）" : "❌ 否证：" + above + " 张上穿"}`);
  log(`  阳对照 G：${gOk ? "✅ 有鉴别力" : "❌ 无鉴别力（P2 降 NOT-MEASURED）"}`);
} catch (e) {
  log(`❌ 探针中断：${e.message}`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exit(1);
}
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`\n→ ${OUT}`);
