/**
 * 评审员#1 · 独立普查：**铸造值域 [0,100] 与 38 项声明域的交集**，找出所有「半轴不可达」格
 * 以及这些格里有没有别的**规则源**（把根因从「这一格」推广成「这一类」，或证伪推广）。
 * 判据（预先声明）：
 *   · 铸造式 = round(seedHash01×100)，值域 [0,100]（seed-world.ts:483 + seedHash01:353 已读源码）
 *   · 某域「下侧不可达」⇔ min < 0；「上侧不可达」⇔ max !== null 且 max < 100
 *   · 金丝雀：min<0 至少 1 条（forecastBias），否则量法坏了
 * ⛔ 只读。
 */
import fs from "node:fs";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/REV1-domain-reach-census.txt";
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };
const g = async (p, o = {}) => { const r = await fetch("http://127.0.0.1:4019/a/v1" + p, { headers: { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" }, ...o }); const t = await r.text(); let j=null; try{j=t?JSON.parse(t):null}catch{} return {status:r.status, json:j}; };

try {
  const M = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
  const DOM = M.STATE_VAR_DOMAINS, refFn = M.stateVarValueRef;
  const keys = Object.keys(DOM);
  log(`域表键数 = ${keys.length}`);
  const lowUnreach = keys.filter((k) => DOM[k].min < 0);
  const highUnreach = keys.filter((k) => DOM[k].max !== null && DOM[k].max < 100);
  log(`★ 下侧不可达（min<0 ⇒ 铸造式产不出负值）= ${lowUnreach.length} 条：${lowUnreach.map(k=>`${k}[${DOM[k].min},${DOM[k].max}]`).join(" ")}`);
  log(`★ 上侧不可达（max<100 ⇒ 铸造式产不出上侧）= ${highUnreach.length} 条：${highUnreach.map(k=>`${k}[${DOM[k].min},${DOM[k].max}]`).join(" ")}`);
  log(`  金丝雀：min<0 命中数 = ${lowUnreach.length}（须 >=1，否则量法坏了）`);
  log(`  forecastBias.stateVarValueRef = ${JSON.stringify(refFn("Model","forecastBias") ?? null)}（须 null）`);
  log(`  金丝雀 order_demand_pressure ref = ${JSON.stringify(refFn("Order","demandPressure") ?? null)}（须非 null 否则量法坏了）`);

  // 这些格里，哪些有 PUBLISHED 边当**源**（= 会进生产链）
  const rr = (await g("/sim/propagation-rules")).json.items ?? [];
  log(`规则表 n = ${rr.length}（金丝雀：须 >0）`);
  const srcVars = new Set(rr.filter(r=>r.status==="PUBLISHED").map(r=>r.sourceStateVar));
  log(`PUBLISHED 边里出现过的 source 状态变量 = ${srcVars.size} 个`);
  for (const k of [...lowUnreach, ...highUnreach]) {
    const asSrc = rr.filter(r=>r.sourceStateVar===k && r.status==="PUBLISHED");
    log(`  ${k}: 作源的 PUBLISHED 边 ${asSrc.length} 条 ${asSrc.map(r=>`[${r.sourceTypeKey}→${r.targetTypeKey}.${r.targetStateVar} k=${r.coefficient}]`).join(" ")}`);
  }
  // 反向：PUBLISHED 边的源里，有多少是**无规格式（valueRef=null）**⇒ 只能吃哈希占位
  const noRef = new Set();
  for (const k of srcVars) {
    // 源类型未知时逐类型试
    let has = false;
    for (const tk of ["Order","Model","Base","Line","Material","Customer","Supplier","PurchaseOrder","WorkOrder","Equipment","Process","WIPLot","DefectRecord","MaterialBatch","InterBaseTransfer","FinishedGoodsInventory","OrderLine"]) {
      if (refFn(tk, k) !== undefined) { has = true; break; }
    }
    if (!has) noRef.add(k);
  }
  log(`★ PUBLISHED 边的源变量里，stateVarValueRef 解析不到（无规格式）= ${noRef.size} 个：${[...noRef].sort().join(" ")}`);
  log("── 结束 ──");
} catch (e) { log(`‼ 异常: ${e?.stack ?? e?.message}`); }
