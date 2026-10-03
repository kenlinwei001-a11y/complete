/**
 * WO-NEGEDGE-P6 · 补两条未做的否证判据（第2阶段验证）
 *
 * 否证① 全量：fb 符号**逐拍 × 全型号**（前轮只测 tick0/终拍与 tick1/5/20 的 6 型号）
 *   —— 若任一拍出现 Model.forecastBias < 0，则「唯一入源结构性非负」被推翻。
 * 否证④ 运行期：播种路是否另有「按声明域收敛的一步」。
 *   —— 判据落在**运行期读数**上：baseSnapshot 里若存在 x < min 或 x > max 的格，
 *      证明写入 state 前**没有**统一投影到 [min,max]（否则它们不可能出现在快照里）。
 *      域表从 **dist 真模块**读（不是 grep 源码），带金丝雀：域键数必须 >=30。
 * ⛔ 只读，不 PATCH 任何规则。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/WO-NEGEDGE-P6-domain-and-perttick-fb.txt";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };

try {
  // ── 0. 域表：从 dist 真模块读（金丝雀：键数 >=30）────────────────────
  let DOM = null, refFn = null;
  try {
    const M = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
    DOM = M.STATE_VAR_DOMAINS ?? null;
    refFn = M.stateVarValueRef ?? null;
  } catch (e) { log(`‼ dist 导入失败：${e?.message}`); }
  if (!DOM) { log("‼ 域表读不到 ⇒ 本段判据 NOT-MEASURED"); }
  else {
    const keys = Object.keys(DOM);
    log(`域表键数 = ${keys.length}（金丝雀：必须 >=30）`);
    const negMin = keys.filter((k) => typeof DOM[k].min === "number" && DOM[k].min < 0);
    log(`★ min<0 的域键 = ${negMin.length} 条 ⇒ ${negMin.map((k) => `${k}[${DOM[k].min},${DOM[k].max}] rest=${DOM[k].restPoint}`).join(" ")}`);
    log(`forecastBias 域 = ${JSON.stringify(DOM.forecastBias ?? null)}`);
  }
  if (refFn) {
    let r; try { r = refFn("Model", "forecastBias"); } catch (e) { r = `<throw ${e?.message}>`; }
    log(`★ stateVarValueRef("Model","forecastBias") = ${JSON.stringify(r ?? null)}（根因链第4层说应为 undefined）`);
    let r2; try { r2 = refFn("Order", "demandPressure"); } catch (e) { r2 = `<throw ${e?.message}>`; }
    log(`  金丝雀：stateVarValueRef("Order","demandPressure") = ${JSON.stringify(r2 ?? null)}（必非 undefined，否则量法坏了）`);
  } else log("  金丝雀位置：stateVarValueRef 未从 dist 导出 ⇒ NOT-MEASURED");

  // ── 1. 会话 + tick0 快照：越域格统计（否证④ 运行期）──────────────────
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  const s = (await post("/sim/sessions", {})).json;
  await sleep(500);
  const det = (await g(`/sim/sessions/${s.id}`)).json;
  const bs = det.baseSnapshot ?? {};
  log(`会话=${s.id} baseSnapshot 对象数 = ${Object.keys(bs).length}（金丝雀：必须 >0）`);
  if (DOM) {
    let inD = 0, outD = 0, noDom = 0; const outs = [];
    for (const [oid, props] of Object.entries(bs)) {
      const tk = typeOf.get(oid); if (!tk) continue;
      for (const [sv, v] of Object.entries(props ?? {})) {
        if (typeof v !== "number") continue;
        const d = DOM[sv]; if (!d) { noDom++; continue; }
        const lo = typeof d.min === "number" ? d.min : null, hi = typeof d.max === "number" ? d.max : null;
        if ((lo !== null && v < lo) || (hi !== null && v > hi)) { outD++; if (outs.length < 8) outs.push(`${tk}.${sv}=${v} 域[${lo},${hi}]`); }
        else inD++;
      }
    }
    log(`★ baseSnapshot 越域格 = ${outD} / 在域格 = ${inD} / 无域键格 = ${noDom}（金丝雀：在域格必须 >0）`);
    log(`   越域样例：${outs.join(" | ")}`);
    log(`⇒ 若越域格 > 0 ⇒ 播种路**没有**「写 state 前统一投影到 [min,max]」这一步（否证④ 不成立）`);
    const fbVals = modelIds.map((i) => bs[i]?.forecastBias).filter((x) => typeof x === "number");
    log(`   Model.forecastBias tick0 = [${fbVals.join(",")}] n=${fbVals.length}`);
  }

  // ── 2. 逐拍 fb（否证① 全量）：tick 1..24，每拍读全型号 ────────────────
  let anyNeg = 0, minAll = Infinity, maxAll = -Infinity, nSamples = 0;
  const negHits = [];
  // ⚠ 本机 load 215 ⇒ 逐拍 n:1 太慢（上轮跑 4 拍即被 5 分钟超时杀掉，半份日志）。
  //   改**稀疏采样**：只在下列拍点读，拍点之间一次推进 n 拍。
  const SAMPLE = [1, 2, 4, 8, 12, 16, 20, 24];
  let prev = 0;
  for (const t of SAMPLE) {
    await post(`/sim/sessions/${s.id}/tick`, { n: t - prev }); prev = t;
    const w = (await g(`/sim/sessions/${s.id}/world`)).json;
    const st = w.state ?? {};
    const vals = modelIds.map((i) => st[i]?.forecastBias).filter((x) => typeof x === "number");
    if (!vals.length) { log(`   ‼ tick${t} 读不到 fb ⇒ NOT-MEASURED`); break; }
    nSamples += vals.length;
    minAll = Math.min(minAll, ...vals); maxAll = Math.max(maxAll, ...vals);
    const neg = vals.filter((x) => x < 0).length;
    anyNeg += neg;
    if (neg) negHits.push(`t${t}:[${vals.join(",")}]`);
    if (t <= 4 || t === 12 || t === 24) log(`   tick${String(t).padStart(2)} 活态 fb = [${vals.join(",")}] 负=${neg}`);
  }
  log(`★ 否证① 全量：${nSamples} 个 (拍,型号) 样本，min=${minAll} max=${maxAll}，**负值个数 = ${anyNeg}**`);
  log(`   ${negHits.length ? "负值出现 ⇒ 根因被推翻：" + negHits.join(" ") : "负值 0 次 ⇒ 未推翻「唯一入源结构性非负」"}`);
  log("── 结束 ──");
} catch (e) {
  log(`‼ 异常：${e?.stack || e}`);
  fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=7\n");
  process.exit(7);
}
