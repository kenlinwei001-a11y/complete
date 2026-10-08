#!/usr/bin/env node
/** 采样守卫（WO-2 评估列的第 ④ 项）：
 *  3pert 探针只采 6 个量名 ⇒ 恰好全落带外 ⇒ 造成「全绿假象」。
 *  本守卫的判据：**采样清单必须覆盖【全部在带内的量名】**，否则报「采样不足，绿不作数」。
 */
const B = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const get = async (p) => (await (await fetch(B + p, { headers: { "x-debug-user": DU } })).json());
const newSess = async () => {
  const r = await (await fetch(B + "/a/v1/sim/sessions", { method: "POST", headers: { "content-type": "application/json", "x-debug-user": DU }, body: "{}" })).json();
  return (r.session || r).id;
};
const SAMPLED = ["costPressure","receivablePressure","loadIndex","utilPressure","demandPressure","overduePressure"]; // 3pert 的 6 名

/**
 * ★ 带内判据的适用面（本守卫自己踩过的坑，2026-10-08）：
 *   「|值| > 75 ⇒ 在带内」**只对【域声明 max 有限】的量名成立**（压力族 max=100，knee=75）。
 *   最初我对**全部**量名用这条 ⇒ `qty=7259`、`unitPrice=22198` 被误判成「带内」——
 *   它们是**绝对量**，75 对它们毫无意义。
 *   ⛔ 形态：拿 A 类的判据去判 B 类 —— 与「判据不度量目标」同族（本单第 14 次）。
 *   ⇒ 现在先读域表：只有 max 有限量名才参与带内统计。
 */
import { createRequire } from "node:module";
const require = createRequire("/tmp/wt-ab/apps/datacore/");
const _b = require("/tmp/wt-ab/apps/datacore/dist/synthetic/battery.js");
const DOM = (_b.stateVarDomains ? _b.stateVarDomains() : _b.STATE_VAR_DOMAINS) || {};
const bandApplies = (name) => {
  const d = DOM[name];
  if (d === undefined || typeof d.max !== "number" || !Number.isFinite(d.max)) return false;
  // ★ 再排除【内点支（散布型）】：restPoint 严格落在 min/max 之间 ⇒ 该量天然有正负散布
  //   （如 forecastBias min=-100 max=100 restPoint=0），其「带内/带外」须按**偏离量**判，
  //   按绝对值判会把设计的正常态误报成异常（本守卫第二轮踩的坑）。
  //   ⛔ 形态同族：拿「端点支（压力族）的判据」去判「内点支（散布型）」。
  const innerPoint = d.restPoint > d.min && d.restPoint < d.max;
  return !innerPoint;
};

const s = await newSess();
const st = (await get(`/a/v1/sim/sessions/${s}/world`)).state || {};
// 从世界态现算：哪些量名有格、各自有多少格、有多少在带内
const byName = {};
for (const oid of Object.keys(st)) for (const [k, v] of Object.entries(st[oid])) {
  if (typeof v !== "number") continue;
  if (!bandApplies(k)) continue;            // ← 只有 max 有限的量名参与带内统计
  (byName[k] ??= { n: 0, inBand: 0 });
  byName[k].n++;
  if (Math.abs(v) > 75) byName[k].inBand++;
}
const all = Object.entries(byName).sort((a, b) => b[1].n - a[1].n);
const withBand = all.filter(([, x]) => x.inBand > 0);
const missed = withBand.filter(([k]) => !SAMPLED.includes(k));

console.log(`## 采样守卫 · BASE=${B}`);
console.log(`世界态量名总数 = ${all.length} · 有格且%在带内>0 的量名 = ${withBand.length}`);
console.log("");
if (withBand.length === 0) {
  console.log("✅ 全仓无「在带内」的格 ⇒ 采样清单不构成假绿风险（当前改后世界即是这一档）");
} else {
  console.log(`⚠ 存在带内格，量名如下（${withBand.length} 个）：`);
  for (const [k, x] of withBand) console.log(`   ${k.padEnd(24)} 格数=${String(x.n).padStart(5)}  带内=${x.inBand}  ${SAMPLED.includes(k) ? "[已采样]" : "❌ 未采样"}`);
  console.log("");
  console.log(missed.length === 0
    ? `✅ 采样清单覆盖了全部 ${withBand.length} 个带内量名 ⇒ 绿作数`
    : `❌【采样不足】${missed.length} 个带内量名未被采样：${missed.map(([k]) => k).join(", ")} ⇒ 这些量名上的超差【看不见】⇒ 绿不作数`);
}
console.log("");
console.log("判据：采样清单必须覆盖【全部在带内的量名】。未覆盖 ⇒ 报「采样不足」，⛔ 不许报绿。");
console.log(`DONE ${new Date().toISOString()}`);
